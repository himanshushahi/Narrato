import os
import time
import threading
import traceback
from backend.core.logger import logger
from backend.database.db import (
    get_project, update_project, create_task, update_task, get_project_tasks, get_task
)

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
        """Adds a project to the queue list for sequential processing."""
        # Clean cancel event if it exists
        if project_id in self._cancel_events:
            self._cancel_events[project_id].clear()
        else:
            self._cancel_events[project_id] = threading.Event()

        # Update database project status
        update_project(project_id, status='queued')
        
        # Determine steps to execute
        if is_resume:
            # Look at completed tasks and run the remaining ones
            tasks = get_project_tasks(project_id)
            completed_steps = {t['step'] for t in tasks if t['status'] == 'completed'}
            all_steps = ['generate_script', 'generate_voiceover', 'transcribe', 'fetch_assets', 'render']
            remaining_steps = [s for s in all_steps if s not in completed_steps]
            # Ensure we have at least render
            if not remaining_steps:
                remaining_steps = ['render']
            steps_to_queue = remaining_steps
        else:
            steps_to_queue = steps

        # Create/reset database task entries
        for step in steps_to_queue:
            create_task(project_id, step)

        self._queue.append((project_id, steps_to_queue))
        logger.info(f"Queued project {project_id} for steps: {steps_to_queue}")
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
            if t['status'] in ('running', 'pending'):
                update_task(t['id'], status='failed', message='Cancelled by user')

        if self._active_project_id == project_id:
            self._active_project_id = None

        self._broadcast_queue_status()
        logger.info(f"Project {project_id} cancelled.")

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

    def _broadcast_task_progress(self, project_id, step, progress, message, status):
        data = {
            "type": "progress_update",
            "project_id": project_id,
            "step": step,
            "progress": progress,
            "message": message,
            "status": status
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

            project_id, steps = self._queue.pop(0)
            self._active_project_id = project_id
            self._broadcast_queue_status()

            cancel_event = self._cancel_events.get(project_id)
            if not cancel_event:
                cancel_event = threading.Event()
                self._cancel_events[project_id] = cancel_event

            logger.info(f"Starting processing pipeline for project: {project_id}")
            update_project(project_id, status='processing')

            success = True
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
                    stack = traceback.format_exc()
                    
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

            self._active_project_id = None
            self._broadcast_queue_status()

    def _execute_step(self, project_id, step, cancel_event):
        """Router to execute pipeline steps."""
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
            
        elif step == 'render':
            from backend.pipeline.render import render_pipeline
            render_pipeline(proj, proj_dir, progress_cb, cancel_event)
            
        else:
            raise ValueError(f"Unknown pipeline step: {step}")

# Global instance
global_queue_manager = QueueManager()
