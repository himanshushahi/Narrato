import time
import threading
from backend.core.logger import logger
from backend.database.db import (
    get_project, update_project, create_task, update_task, get_project_tasks, get_task
)
from backend.core.power import power_manager

# ── Content-aware Smart Resume propagation ─────────────────────────────
# An upstream (re-)run pulls in only the downstream stages that consume its
# output — never a blanket invalidation:
#   script        -> voiceover, transcribe, visuals, assets, render
#                    (new narration invalidates everything)
#   voiceover     -> transcribe, render
#                    (new audio => new word timings + new mix. Visual ASTs are
#                    narration-driven, so visuals and asset downloads are NOT
#                    invalidated; sub-visual durations are rescaled in place by
#                    the voiceover pipeline instead.)
#   transcribe    -> render (new word timings affect subtitles)
#   visuals       -> assets, render (new queries need downloads)
#   assets        -> render (new files affect frames/audio)
_PROPAGATE = {
    'generate_script': {'generate_voiceover', 'transcribe', 'generate_visuals', 'fetch_assets', 'render'},
    'generate_voiceover': {'transcribe', 'render'},
    'transcribe': {'render'},
    'generate_visuals': {'fetch_assets', 'render'},
    'fetch_assets': {'render'},
    'render': set(),
}


def resolve_steps_to_queue(pipeline_steps, completed_steps, is_stale_fn, forced_steps=None):
    """Pure step-resolution for Smart Resume (unit-testable, no DB/file IO).

    A step is queued when it was never completed, is explicitly forced
    (first stage of a forced re-run), or its own staleness checker reports
    stale — plus fixpoint propagation of content-dependent downstream steps
    via _PROPAGATE. Returns the queued steps in pipeline order.
    """
    forced_steps = forced_steps or set()
    stale_steps = set(forced_steps)
    for step in pipeline_steps:
        if step in stale_steps:
            continue
        if step not in completed_steps:
            stale_steps.add(step)
        elif is_stale_fn(step):
            stale_steps.add(step)

    queued = set()
    changed = True
    while changed:
        changed = False
        for step in pipeline_steps:
            if step in queued:
                continue
            if step in stale_steps or any(
                step in _PROPAGATE.get(q, set()) for q in queued
            ):
                queued.add(step)
                changed = True
    return [step for step in pipeline_steps if step in queued]


def _check_step_stale(proj, proj_dir, step):
    """Run the owning staleness checker for one stage. True on error (safe)."""
    try:
        if step == 'generate_script':
            from backend.pipeline.ai import is_script_stale
            return is_script_stale(proj, proj_dir)
        elif step == 'generate_voiceover':
            from backend.pipeline.tts import is_voiceover_stale
            return is_voiceover_stale(proj, proj_dir)
        elif step == 'transcribe':
            from backend.pipeline.transcribe import is_transcribe_stale
            return is_transcribe_stale(proj, proj_dir)
        elif step == 'generate_visuals':
            from backend.pipeline.assets import is_visuals_stale
            return is_visuals_stale(proj, proj_dir)
        elif step == 'fetch_assets':
            from backend.pipeline.assets import is_assets_stale
            return is_assets_stale(proj, proj_dir)
        elif step == 'render':
            from backend.pipeline.render import is_render_stale
            return is_render_stale(proj, proj_dir)
    except Exception as e:
        logger.error(f"Error checking staleness for {step}: {e}")
        return True
    return True

class QueueManager:
    def __init__(self):
        self._running = False
        self._thread = None
        self._queue = []
        self._active_project_id = None
        self._cancel_events = {} # project_id -> threading.Event()
        self._progress_callbacks = []

    def register_progress_callback(self, cb):
        self._progress_callbacks.append(cb)

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._thread.start()
        logger.info("Background queue manager worker thread started successfully.")

    def stop(self):
        self._running = False
        # Cancel any active project
        if self._active_project_id:
            self.cancel_project(self._active_project_id)
        if self._thread:
            self._thread.join(timeout=2)
        logger.info("Background queue manager stopped.")

    def queue_project(self, project_id, steps, is_resume=False):
        """
        Adds a project to the queue list for sequential processing.
        
        Steps: 'generate_script', 'generate_voiceover', 'transcribe', 
               'generate_visuals', 'fetch_assets', 'render'
        """
        # ── Deduplication guard ────────────────────────────────────────────
        # Reject if this project is already actively processing or waiting
        # in the queue.  This prevents double-renders caused by the frontend
        # firing both start_processing_pipeline and resume_processing_pipeline
        # before the queue-status broadcast propagates back to the UI.
        if self._active_project_id == project_id:
            logger.warning(f"Project {project_id} is already actively processing — ignoring duplicate queue request.")
            return True  # Return True so the frontend doesn't show an error
        if any(q[0] == project_id for q in self._queue):
            logger.warning(f"Project {project_id} is already queued — ignoring duplicate queue request.")
            return True

        # Always create a new cancel event when queuing so active workers retaining the old event stay cancelled
        self._cancel_events[project_id] = threading.Event()

        # Update database project status
        update_project(project_id, status='queued')
        
        # Determine steps to execute.
        # Forced runs ("Resume from Stage") and Smart Resume share ONE
        # content-aware evaluation: the explicitly requested first stage of a
        # forced run is treated as forced-stale, everything else — including
        # downstream stages of a forced run — is decided by its own checker
        # plus _PROPAGATE. A forced voiceover re-run therefore still skips
        # visuals/assets entirely instead of running them as no-ops.
        all_steps = ['generate_script', 'generate_voiceover', 'transcribe', 'generate_visuals', 'fetch_assets', 'render']
        pipeline_steps = steps if steps else (list(all_steps) if is_resume else [])

        proj = get_project(project_id)
        from backend.core.config import get_storage_dir
        proj_dir = get_storage_dir() / project_id

        if pipeline_steps:
            tasks = get_project_tasks(project_id)
            completed_steps = {t['step'] for t in tasks if t['status'] == 'completed'}

            forced_steps = set() if is_resume else {pipeline_steps[0]}
            steps_to_queue = resolve_steps_to_queue(
                pipeline_steps,
                completed_steps,
                lambda s: _check_step_stale(proj, proj_dir, s),
                forced_steps,
            )

            if not steps_to_queue and 'render' in pipeline_steps:
                from backend.pipeline.render import is_render_stale
                if is_render_stale(proj, proj_dir):
                    steps_to_queue = ['render']
        else:
            steps_to_queue = []

        if not is_resume:
            # Reset tasks for downstream stages not included in this forced run
            if steps_to_queue:
                try:
                    first_step_idx = all_steps.index(steps_to_queue[0])
                    for s in all_steps[first_step_idx:]:
                        if s not in steps_to_queue:
                            update_task(f"{project_id}_{s}", status='pending', progress=0.0, message='Pending upstream changes')
                except ValueError:
                    pass

        # Create/reset database task entries
        for step in steps_to_queue:
            create_task(project_id, step)

        self._queue.append((project_id, steps_to_queue, is_resume))
        logger.info(f"Queued project {project_id} for steps: {steps_to_queue} (is_resume={is_resume})")
        self._broadcast_queue_status()
        return True

    def cancel_project(self, project_id):
        """Cancels a project if it's currently processing or removes it from queue."""
        logger.info(f"Cancellation request received for project: {project_id}")
        
        # 1. If active, trigger cancel event
        if project_id in self._cancel_events:
            self._cancel_events[project_id].set()

        # 2. Remove from queue if waiting
        self._queue = [q for q in self._queue if q[0] != project_id]
        
        # 3. Mark database statuses
        update_project(project_id, status='cancelled')
        tasks = get_project_tasks(project_id)
        for t in tasks:
            if t['status'] == 'running':
                update_task(t['id'], status='failed', error_message='Step cancelled by user.', message='Cancelling...')
                self._broadcast_task_progress(project_id, t['step'], 0.0, 'Cancelling...', 'failed', error_message='Step cancelled by user.')
            elif t['status'] == 'pending':
                update_task(t['id'], status='pending', message='Cancelled')
                self._broadcast_task_progress(project_id, t['step'], 0.0, 'Cancelled', 'pending')

        self._broadcast_queue_status()
        logger.info(f"Project {project_id} cancel requested.")

    def get_queue_status(self):
        return {
            "active": self._active_project_id,
            "queued": [q[0] for q in self._queue]
        }

    def _broadcast_queue_status(self):
        status = self.get_queue_status()
        for cb in self._progress_callbacks:
            try:
                cb({"type": "queue_update", "status": status})
            except Exception as e:
                logger.error(f"Failed to run queue update progress callback: {e}")

    def _broadcast_task_progress(self, project_id, step, progress, message, status, error_message=None):
        data = {
            "type": "progress_update",
            "project_id": project_id,
            "step": step,
            "progress": progress,
            "message": message,
            "status": status,
            "error_message": error_message
        }
        for cb in self._progress_callbacks:
            try:
                cb(data)
            except Exception as e:
                logger.error(f"Failed to run task progress callback: {e}")

    def _worker_loop(self):
        while self._running:
            if not self._queue:
                time.sleep(0.5)
                continue

            project_id, steps, _is_resume = self._queue.pop(0)
            self._active_project_id = project_id
            self._broadcast_queue_status()

            cancel_event = self._cancel_events.get(project_id)
            if not cancel_event:
                cancel_event = threading.Event()
                self._cancel_events[project_id] = cancel_event

            logger.info(f"Starting processing pipeline for project: {project_id}")
            update_project(project_id, status='processing')

            success = True
            power_manager.acquire()
            try:
                for step in steps:
                    if cancel_event.is_set():
                        logger.info("Cancel event detected between pipeline steps.")
                        success = False
                        break

                    task_id = f"{project_id}_{step}"
                    update_task(task_id, status='running', progress=0.0, message='Starting...')
                    self._broadcast_task_progress(project_id, step, 0.0, 'Starting...', 'running')

                    try:
                        # Run the specific pipeline step
                        from backend.pipeline.ai import usage_tracking_context
                        with usage_tracking_context(task_id):
                            self._execute_step(project_id, step, cancel_event)
                        
                        update_task(task_id, status='completed', progress=100.0, message='Step completed.')
                        self._broadcast_task_progress(project_id, step, 100.0, 'Step completed.', 'completed')
                    except InterruptedError:
                        logger.warning(f"Step {step} interrupted/cancelled.")
                        update_task(task_id, status='failed', progress=0.0, error_message='Step cancelled by user.', message='Cancelled')
                        self._broadcast_task_progress(project_id, step, 0.0, 'Cancelled', 'failed')
                        success = False
                        break
                    except Exception as e:
                        logger.error(f"Error executing step {step} for project {project_id}: {e}", exc_info=True)
                        err_msg = str(e)
                        # Full traceback already captured via exc_info=True above; no
                        # separate stack variable needed.
                        # Don't reset progress to 0.0 on failure
                        update_task(task_id, status='failed', error_message=err_msg, message=f'Failed: {err_msg[:50]}...')
                        
                        # Broadcast the last known progress instead of 0.0
                        task_rec = get_task(task_id)
                        cur_prog = task_rec['progress'] if task_rec else 0.0
                        self._broadcast_task_progress(project_id, step, cur_prog, f'Failed: {err_msg[:50]}...', 'failed')
                        
                        success = False
                        break

                # End of project processing
                if success:
                    logger.info(f"Pipeline completed successfully for project: {project_id}")
                    update_project(project_id, status='completed')
                else:
                    logger.warning(f"Pipeline failed or was cancelled for project: {project_id}")
                    # Don't overwrite if it was already marked cancelled
                    proj = get_project(project_id)
                    if proj and proj['status'] != 'cancelled':
                        update_project(project_id, status='failed')
            finally:
                power_manager.release()

            self._active_project_id = None
            self._broadcast_queue_status()

    def _execute_step(self, project_id, step, cancel_event):
        """Router to execute pipeline steps.

        Every stage runs in smart mode: content hashes decide what is
        (re-)generated, so even an explicitly re-requested stage reuses
        whatever is still valid (unchanged voiceover segments, unchanged
        visual scenes, existing asset files, cached frames/audio). The only
        exception is a stage whose own checker reports stale — then it runs
        fully. There is deliberately no cache-wiping "force" path anymore:
        to truly redo everything, delete the stage artifacts on disk.
        """
        if cancel_event.is_set():
            raise InterruptedError("Cancelled")

        proj = get_project(project_id)
        if not proj:
            raise ValueError(f"Project {project_id} not found in database.")

        # Resolve project directories
        from backend.core.config import get_storage_dir
        proj_dir = get_storage_dir() / project_id
        proj_dir.mkdir(parents=True, exist_ok=True)

        def make_progress_callback(s):
            def cb(pct, msg=None):
                update_task(f"{project_id}_{s}", progress=pct)
                msg_str = msg if msg else f"Processing... {pct:.0f}%"
                self._broadcast_task_progress(project_id, s, pct, msg_str, "running")
            return cb

        progress_cb = make_progress_callback(step)

        if step == 'generate_script':
            from backend.pipeline.ai import generate_script_pipeline
            generate_script_pipeline(proj, proj_dir, progress_cb, cancel_event)
            
        elif step == 'generate_voiceover':
            from backend.pipeline.tts import generate_voiceover_pipeline
            generate_voiceover_pipeline(proj, proj_dir, progress_cb, cancel_event)
            
        elif step == 'transcribe':
            from backend.pipeline.transcribe import transcribe_pipeline
            transcribe_pipeline(proj, proj_dir, progress_cb, cancel_event)
            
        elif step == 'fetch_assets':
            from backend.pipeline.assets import fetch_assets_pipeline
            fetch_assets_pipeline(proj, proj_dir, progress_cb, cancel_event)
            
        elif step == 'generate_visuals':
            from backend.pipeline.ai import generate_visuals_pipeline
            # force=False: per-scene preservation decides LLM regen scene by
            # scene, even for an explicitly re-requested visuals run.
            generate_visuals_pipeline(proj, proj_dir, progress_cb, cancel_event, force=False)

        elif step == 'render':
            logger.info(f"Smart Resume: Starting render step — cache hashes will determine incremental scope.")
            from backend.pipeline.render import render_pipeline
            # force=False: an explicit render re-run reuses valid frame/audio
            # caches (fast-mux when nothing changed) instead of wiping them.
            render_pipeline(proj, proj_dir, progress_cb, cancel_event, force=False)
            
        else:
            raise ValueError(f"Unknown pipeline step: {step}")

# Global instance
global_queue_manager = QueueManager()
