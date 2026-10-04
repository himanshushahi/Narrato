import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { usePlaybackStore } from '../../../store/usePlaybackStore';
import {
  Image as ImageIcon, Map as MapIcon, Layers,
  BarChart3, Shapes, Type, Video as VideoIcon,
  Code, Sparkles, Sparkle, Zap, ZoomIn, ZoomOut, MoveRight, MoveLeft,
  MoveUp, MoveDown, SeparatorVertical,
  Minus, Hash, Palette, Trash2, Target, X, Focus, Sun,
  Circle, ArrowUp, FlipHorizontal2
} from 'lucide-react';
import { formatTime } from '../../../features/ProjectEditor/constants';
import { FPS, HEADER_WIDTH } from '../timelineConstants';
import { getMediaUrlSync } from '../../../utils/mediaUrl';
import { TrackHeader } from './TrackHeader';

const SCENE_COLORS = [
  'from-blue-600/40 to-cyan-600/30 border-blue-500/50',
  'from-violet-600/40 to-purple-600/30 border-violet-500/50',
  'from-emerald-600/40 to-teal-600/30 border-emerald-500/50',
  'from-amber-600/40 to-orange-600/30 border-amber-500/50',
  'from-rose-600/40 to-pink-600/30 border-rose-500/50',
  'from-sky-600/40 to-indigo-600/30 border-sky-500/50',
  'from-lime-600/40 to-green-600/30 border-lime-500/50',
  'from-cyan-600/40 to-blue-600/30 border-cyan-500/50',
];

export const TRANSITION_OPTIONS = [
  { id: 'cut', label: 'Hard Cut', icon: Minus, desc: 'Instant frame cut' },
  { id: 'fade', label: 'Fade In/Out', icon: Layers, desc: 'Smooth cross-dissolve' },
  { id: 'slide_left', label: 'Slide Left', icon: MoveLeft, desc: 'Push from right to left' },
  { id: 'slide_right', label: 'Slide Right', icon: MoveRight, desc: 'Push from left to right' },
  { id: 'slide_up', label: 'Slide Up', icon: MoveUp, desc: 'Push from bottom to top' },
  { id: 'slide_down', label: 'Slide Down', icon: MoveDown, desc: 'Push from top to bottom' },
  { id: 'zoom_in', label: 'Zoom In', icon: ZoomIn, desc: 'Dramatic punch-in scale' },
  { id: 'zoom_out', label: 'Zoom Out', icon: ZoomOut, desc: 'Reveal scale-down' },
  { id: 'blur_focus', label: 'Blur Focus', icon: Focus, desc: 'Rack-focus pull sharp' },
  { id: 'flash', label: 'Flash', icon: Sun, desc: 'Light-leak overexposure pop' },
  { id: 'wipe_right', label: 'Wipe Right', icon: SeparatorVertical, desc: 'Mask edge reveals L to R' },
  { id: 'iris_open', label: 'Iris Open', icon: Circle, desc: 'Circle iris expands' },
  { id: 'rise', label: 'Rise', icon: ArrowUp, desc: 'Soft float-up settle' },
  { id: 'flip', label: 'Flip', icon: FlipHorizontal2, desc: '3D card turn' },
  { id: 'glitch', label: 'Glitch Shift', icon: Zap, desc: 'Digital chromatic glitch' },
  { id: 'crossfade', label: 'Crossfade', icon: Sparkles, desc: 'Seamless layer blend' },
  { id: 'dissolve', label: 'Dissolve', icon: Sparkles, desc: 'Soft film dissolve' },
  { id: 'none', label: 'None', icon: Minus, desc: 'Instant frame cut' },
];

const AST_PRIMITIVE_BADGES: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  Chart: { label: 'Chart', icon: BarChart3, color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  Shape: { label: 'Shape', icon: Shapes, color: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
  Text: { label: 'Text', icon: Type, color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  Image: { label: 'Image', icon: ImageIcon, color: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
  Video: { label: 'Video', icon: VideoIcon, color: 'bg-red-500/20 text-red-300 border-red-500/30' },
  Map: { label: 'Map', icon: MapIcon, color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  HTML: { label: 'HTML', icon: Code, color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
  Lottie: { label: 'Lottie', icon: Sparkles, color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  Particles: { label: 'Particles', icon: Sparkle, color: 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30' },
  Counter: { label: 'Counter', icon: Hash, color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  Background: { label: 'Background', icon: Palette, color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
};

const extractAstPrimitives = (subVisual: any): string[] => {
  if (!subVisual) return [];
  const layers = subVisual.composition?.children || [];
  const types = new Set<string>();

  for (const layer of layers) {
    const t = layer.content?.type;
    if (t && AST_PRIMITIVE_BADGES[t]) {
      types.add(t);
    }
  }

  if (types.size === 0) {
    const legacy = (subVisual.visual_type || 'scene').toLowerCase();
    if (legacy === 'image') types.add('Image');
    else if (legacy === 'video' || legacy === 'youtube') types.add('Video');
    else if (legacy === 'portrait') types.add('Image');
    else if (legacy === 'map') types.add('Map');
    else types.add('Video');
  }

  return Array.from(types);
};

const extractMediaThumbnail = (subVisual: any): string | null => {
  if (!subVisual) return null;
  const layers = subVisual.composition?.children || [];
  for (const l of layers) {
    if ((l.content?.type === 'Image' || l.content?.type === 'Video') && l.content?.local_path) {
      return getMediaUrlSync(l.content.local_path);
    }
  }
  if (subVisual.visual_path) {
    return getMediaUrlSync(subVisual.visual_path);
  }
  return null;
};

interface SubVisualBlockData {
  subX: number;
  subW: number;
  isSubActive: boolean;
  subIdx: number;
  subStart: number;
  subEnd: number;
  raw: any;
  astTypes: string[];
  thumbnailUrl: string | null;
  transition: string;
  exitTransition: string;
}

interface SceneBlockProps {
  idx: number;
  timing: { start: number; end: number; subs: Array<{ start: number; end: number }> };
  scene: any;
  timelineZoom: number;
  isActive: boolean;
  activeSubIdx: number;
  isDraggingScene: boolean;
  readOnly: boolean;
  isLast: boolean;
  onSeek: (frame: number) => void;
  onSubVisualResizeStart: (e: React.MouseEvent, idx: number, subIdx: number) => void;
  onSceneBoundaryResizeStart: (e: React.MouseEvent, idx: number) => void;
  onSceneAbsoluteResizeStart: (e: React.MouseEvent, idx: number) => void;
  onDeleteScene: ((index: number) => void) | undefined;
  onOpenTransitionMenu: (sceneIdx: number, subIdx: number, btnRect: DOMRect, currentTransition: string, kind: 'entrance' | 'exit') => void;
  onOpenContextMenu?: (e: React.MouseEvent, sceneIdx: number, subIdx: number) => void;
  onSelectSubVisual?: (sceneIdx: number, subIdx: number) => void;
}

const SceneBlock: React.FC<SceneBlockProps> = React.memo(({
  idx, timing, scene, timelineZoom, isActive, activeSubIdx, isDraggingScene,
  readOnly, isLast, onSeek,
  onSubVisualResizeStart, onSceneBoundaryResizeStart, onSceneAbsoluteResizeStart, onDeleteScene,
  onOpenTransitionMenu, onOpenContextMenu, onSelectSubVisual
}) => {
  const x = (timing.start / FPS) * timelineZoom;
  const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
  const colorIdx = idx % SCENE_COLORS.length;
  const subVisuals = scene?.sub_visuals || [];
  const isIntroOrConclusion = scene?.section_type === 'introduction' || scene?.section_type === 'conclusion';
  const subsCount = timing.subs?.length ?? 0;

  // Static per-sub data (primitive badges, thumbnail URLs) depends only on
  // scene content — hoisted out of the geometry memo so zoom ticks (which
  // only change x/w) don't redo string/URL work for every cut.
  const staticSubs = useMemo(() => {
    return Array.from({ length: subsCount }, (_, subIdx) => {
      const raw = subVisuals[subIdx] || {};
      return {
        raw,
        astTypes: extractAstPrimitives(raw),
        thumbnailUrl: extractMediaThumbnail(raw),
        transition: raw.transition || 'fade',
        exitTransition: (raw as any).exit_transition || 'none',
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, subsCount]);

  const subBlocks: SubVisualBlockData[] = useMemo(() => {
    if (!timing.subs) return [];
    return timing.subs.map((sub, subIdx) => {
      const subX = ((sub.start - timing.start) / FPS) * timelineZoom;
      const subW = Math.max(4, ((sub.end - sub.start) / FPS) * timelineZoom);
      const st = staticSubs[subIdx] || { raw: {}, astTypes: [], thumbnailUrl: null, transition: 'fade', exitTransition: 'none' };

      return {
        subX,
        subW,
        isSubActive: activeSubIdx === subIdx,
        subIdx,
        subStart: sub.start,
        subEnd: sub.end,
        raw: st.raw,
        astTypes: st.astTypes,
        thumbnailUrl: st.thumbnailUrl,
        transition: st.transition,
        exitTransition: (st as any).exitTransition || 'none',
      };
    });
  }, [timing, timelineZoom, activeSubIdx, staticSubs, idx]);

  return (
    <div
      className={`absolute top-2 rounded-none border-2 ${SCENE_COLORS[colorIdx]}
        ${isActive ? 'ring-2 ring-cyan-400/80 z-20' : 'z-10'}
        group/scene cursor-pointer overflow-hidden select-none`}
      style={{ left: x + HEADER_WIDTH, width: w, height: 44 }}
      onClick={(e) => {
        if (!isDraggingScene) {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const clickFrame = timing.start + Math.floor((clickX / w) * (timing.end - timing.start));
          onSeek(clickFrame);
        }
      }}
      onContextMenu={(e) => {
        if (onOpenContextMenu && subBlocks.length > 0) {
          e.preventDefault();
          onOpenContextMenu(e, idx, 0);
        }
      }}
    >
      {subBlocks.length > 0 ? (
        <div className="flex h-full">
          {subBlocks.map((sb) => (
            <SubVisualBlock
              key={sb.subIdx}
              block={sb}
              isDraggingScene={isDraggingScene}
              readOnly={readOnly}
              isLast={sb.subIdx === subBlocks.length - 1}
              onSeek={onSeek}
              onResizeStart={onSubVisualResizeStart}
              sceneIdx={idx}
              onOpenTransitionMenu={onOpenTransitionMenu}
              onOpenContextMenu={onOpenContextMenu}
              onSelectSubVisual={onSelectSubVisual}
            />
          ))}
        </div>
      ) : (
        <SceneLabel title={scene?.title || `Scene ${idx + 1}`} startTime={timing.start} />
      )}

      {/* Scene Title in Bottom Corner */}
      {subBlocks.length > 0 && (
        <div className="absolute bottom-0.5 right-1 pointer-events-none z-10">
          <span className="text-[7.5px] font-bold text-white/80 truncate bg-black/80 px-1.5 py-0.2 rounded-none border border-white/10">
            {scene?.title || `Scene ${idx + 1}`}
          </span>
        </div>
      )}

      {/* Scene Delete Button on Hover */}
      {!readOnly && !isIntroOrConclusion && !isDraggingScene && onDeleteScene && (
        <div className="absolute -top-6 right-1 flex gap-0.5 z-30 opacity-0 group-hover/scene:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteScene(idx); }}
            className="w-5 h-5 flex items-center justify-center rounded-none bg-red-600 text-white hover:bg-red-500 shadow-md cursor-pointer"
            title="Delete full scene"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Scene Boundary Drag Resize Handle */}
      {!readOnly && !isDraggingScene && (
        <div
          className="absolute right-0 top-0 bottom-0 w-3 translate-x-1/2 z-30 flex justify-center opacity-70 hover:opacity-100 transition-opacity"
          style={{ cursor: isLast ? 'ew-resize' : 'col-resize' }}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (isLast || e.altKey) {
              onSceneAbsoluteResizeStart(e, idx);
            } else {
              onSceneBoundaryResizeStart(e, idx);
            }
          }}
          title={isLast ? "Drag to resize scene duration" : "Drag to adjust scene split. Hold Alt for absolute resize."}
        >
          <div className="w-[3px] h-4/5 self-center rounded-none bg-emerald-400 hover:bg-emerald-300 transition-colors shadow-md shadow-emerald-500/50" />
        </div>
      )}
    </div>
  );
});
SceneBlock.displayName = 'SceneBlock';

interface SubVisualBlockProps {
  block: SubVisualBlockData;
  isDraggingScene: boolean;
  readOnly: boolean;
  isLast: boolean;
  onSeek: (frame: number) => void;
  onResizeStart: (e: React.MouseEvent, sceneIdx: number, subIdx: number) => void;
  sceneIdx: number;
  onOpenTransitionMenu: (sceneIdx: number, subIdx: number, btnRect: DOMRect, currentTransition: string, kind: 'entrance' | 'exit') => void;
  onOpenContextMenu?: (e: React.MouseEvent, sceneIdx: number, subIdx: number) => void;
  onSelectSubVisual?: (sceneIdx: number, subIdx: number) => void;
}

const SubVisualBlock: React.FC<SubVisualBlockProps> = React.memo(({
  block, isDraggingScene, readOnly, isLast, onSeek, onResizeStart, sceneIdx,
  onOpenTransitionMenu, onOpenContextMenu, onSelectSubVisual
}) => {
  const isEven = block.subIdx % 2 === 0;
  const cutBg = isEven ? 'bg-zinc-900/90 hover:bg-zinc-850/95' : 'bg-zinc-950/95 hover:bg-zinc-900/95';

  const activeTransition = TRANSITION_OPTIONS.find(t => t.id === block.transition || (block.transition === 'none' && t.id === 'cut')) || TRANSITION_OPTIONS[0];
  const TransitionIcon = activeTransition.icon;
  const activeExit = TRANSITION_OPTIONS.find(t => t.id === block.exitTransition) || TRANSITION_OPTIONS.find(t => t.id === 'none')!;
  const ExitIcon = activeExit.icon;
  const hasExit = !!block.exitTransition && block.exitTransition !== 'none' && block.exitTransition !== 'cut';

  return (
    <div
      className={`relative h-full border-r-2 border-black/90 last:border-r-0 ${cutBg}
        ${block.isSubActive ? 'ring-2 ring-inset ring-cyan-400 z-20 shadow-inner' : ''}
        rounded-none transition-colors cursor-pointer group/sub overflow-hidden`}
      style={{ width: block.subW, minWidth: 6 }}
      onClick={(e) => {
        if (!isDraggingScene) {
          e.stopPropagation();
          onSelectSubVisual?.(sceneIdx, block.subIdx);
          onSeek(block.subStart);
        }
      }}
      onContextMenu={(e) => {
        if (onOpenContextMenu) {
          e.preventDefault();
          e.stopPropagation();
          onOpenContextMenu(e, sceneIdx, block.subIdx);
        }
      }}
    >
      {/* Background Image/Video Thumbnail */}
      {block.thumbnailUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center opacity-30 pointer-events-none mix-blend-luminosity"
          style={{ backgroundImage: `url(${block.thumbnailUrl})` }}
        />
      )}

      {/* Main Content & AST Badges */}
      {block.subW > 14 && (
        <div className="absolute inset-0 flex flex-col justify-between p-1 overflow-hidden z-10 pointer-events-none">
          <div className="flex items-center gap-1 overflow-hidden">
            {/* Cut identifier badge */}
            <span className="text-[7px] font-mono font-bold px-1 py-0.2 rounded-none bg-black/80 text-cyan-300 border border-cyan-500/30 shrink-0">
              #{block.subIdx + 1}
            </span>

            {/* Punch-in emphasis marker */}
            {Array.isArray((block.raw as any)?.emphasis) && (block.raw as any).emphasis.length > 0 && (
              <span
                className="text-[7px] font-mono font-bold px-1 py-0.2 rounded-none bg-black/80 text-amber-300 border border-amber-500/30 shrink-0 inline-flex items-center gap-0.5"
                title={`${(block.raw as any).emphasis.length} punch-in zoom${(block.raw as any).emphasis.length > 1 ? 's' : ''} — edit in Visuals tab`}
              >
                <Target className="w-2.5 h-2.5 text-amber-400" aria-hidden="true" />
                <span>{(block.raw as any).emphasis.length}</span>
              </span>
            )}

            {/* Primitive type badges */}
            {block.astTypes.map((t) => {
              const badge = AST_PRIMITIVE_BADGES[t];
              if (!badge) return null;
              const Icon = badge.icon;
              return (
                <div
                  key={t}
                  className={`flex items-center gap-0.5 px-1 py-0.2 rounded-none text-[7px] font-bold border shrink-0 ${badge.color}`}
                  title={`Primitive: ${badge.label}`}
                >
                  <Icon className="w-2.5 h-2.5" />
                  {block.subW > 70 && <span>{badge.label}</span>}
                </div>
              );
            })}
          </div>

          {block.subW > 45 && (
            <span className="text-[7.5px] font-mono font-semibold text-zinc-300/90 truncate block">
              {((block.subEnd - block.subStart) / FPS).toFixed(1)}s
            </span>
          )}
        </div>
      )}

      {/* Transition Badge on Cut Left Edge — Left-click opens floating menu */}
      {!readOnly && block.subW > 28 && (
        <div className="absolute left-1 bottom-1 z-30 pointer-events-auto opacity-0 group-hover/sub:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenTransitionMenu(sceneIdx, block.subIdx, rect, block.transition, 'entrance');
            }}
            className="flex items-center gap-1 px-1 py-0.5 rounded-none bg-zinc-950 border border-zinc-700 text-[7px] text-zinc-200 hover:text-white hover:border-cyan-500 cursor-pointer shadow-lg active:scale-95"
            title={`Transition: ${activeTransition.label} (Click to change)`}
          >
            <TransitionIcon className="w-2 h-2 text-cyan-400" />
            {block.subW > 80 && <span>{activeTransition.label.split(' ')[0]}</span>}
          </button>
        </div>
      )}

      {/* Exit Transition Badge on Cut Right Edge — Left-click opens floating menu */}
      {!readOnly && block.subW > 52 && (
        <div className="absolute right-1 bottom-1 z-30 pointer-events-auto opacity-0 group-hover/sub:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onOpenTransitionMenu(sceneIdx, block.subIdx, rect, block.exitTransition, 'exit');
            }}
            className={`flex items-center gap-1 px-1 py-0.5 rounded-none bg-zinc-950 border text-[7px] cursor-pointer shadow-lg active:scale-95 ${hasExit ? 'border-amber-500/60 text-amber-300 hover:text-amber-200 hover:border-amber-400' : 'border-zinc-700 text-zinc-400 hover:text-white hover:border-amber-500'}`}
            title={`Exit transition: ${activeExit.label} (Click to change)`}
          >
            <ExitIcon className={`w-2 h-2 ${hasExit ? 'text-amber-400' : ''}`} />
            {block.subW > 110 && <span>{activeExit.label.split(' ')[0]}</span>}
          </button>
        </div>
      )}

      {/* Visible High-Contrast Resize Handle Between Sub-Visual Cuts */}
      {!readOnly && !isDraggingScene && !isLast && (
        <div
          className="absolute right-0 top-0 bottom-0 w-3 translate-x-1/2 z-30 cursor-col-resize flex flex-col items-center justify-center group-hover/sub:opacity-100 opacity-50 hover:opacity-100 transition-opacity"
          onMouseDown={(e) => onResizeStart(e, sceneIdx, block.subIdx)}
          title="Drag to adjust cut timing ratio"
        >
          <div className="w-[2px] h-full bg-cyan-400 shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
          <div className="absolute w-1.5 h-3 bg-zinc-900 border border-cyan-400 rounded-none" />
        </div>
      )}
    </div>
  );
});
SubVisualBlock.displayName = 'SubVisualBlock';

const SceneLabel: React.FC<{ title: string; startTime: number }> = React.memo(({ title, startTime }) => (
  <div className="flex items-center gap-1 px-2 h-full overflow-hidden">
    <span className="text-[8px] font-bold text-white/90 truncate whitespace-nowrap">{title}</span>
    <span className="text-[7px] font-mono text-white/50 shrink-0">{formatTime(startTime)}</span>
  </div>
));
SceneLabel.displayName = 'SceneLabel';

interface VideoTrackProps {
  localTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>;
  liveScenes: any[];
  timelineZoom: number;
  isDraggingScene: boolean;
  readOnly: boolean;
  onSeek: (frame: number) => void;
  onSubVisualResizeStart: (e: React.MouseEvent, idx: number, subIdx: number) => void;
  onSceneBoundaryResizeStart: (e: React.MouseEvent, idx: number) => void;
  onSceneAbsoluteResizeStart: (e: React.MouseEvent, idx: number) => void;
  onDeleteScene: ((index: number) => void) | undefined;
  onUpdateSubVisualTransition?: (sceneIdx: number, subIdx: number, transition: string) => void;
  onUpdateSubVisualExitTransition?: (sceneIdx: number, subIdx: number, transition: string) => void;
  onOpenContextMenu?: (e: React.MouseEvent, sceneIdx: number, subIdx: number) => void;
  onSelectSubVisual?: (sceneIdx: number, subIdx: number) => void;
  // Drag reordering props
  index?: number;
  onDragStart?: (e: React.DragEvent, index: number) => void;
  onDragOver?: (e: React.DragEvent, index: number) => void;
  onDragEnter?: (e: React.DragEvent, index: number) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, index: number) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  isDragOver?: boolean;
}

interface ActiveTransitionMenuState {
  sceneIdx: number;
  subIdx: number;
  x: number;
  y: number;
  currentTransition: string;
  kind: 'entrance' | 'exit';
}

export const VideoTrack: React.FC<VideoTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom,
  isDraggingScene, readOnly,
  onSeek,
  onSubVisualResizeStart, onSceneBoundaryResizeStart, onSceneAbsoluteResizeStart, onDeleteScene,
  onUpdateSubVisualTransition, onUpdateSubVisualExitTransition, onOpenContextMenu, onSelectSubVisual,
  index, onDragStart, onDragOver, onDragEnter, onDragLeave, onDrop, onDragEnd, isDragOver
}) => {
  // Single active transition popover state across the entire video track
  const [activeTransitionMenu, setActiveTransitionMenu] = useState<ActiveTransitionMenuState | null>(null);

  // Global dismiss on pointerdown outside
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const el = document.getElementById('timeline-transition-menu');
      if (el && !el.contains(e.target as Node)) {
        setActiveTransitionMenu(null);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  const handleOpenTransitionMenu = useCallback((sceneIdx: number, subIdx: number, btnRect: DOMRect, currentTransition: string, kind: 'entrance' | 'exit' = 'entrance') => {
    setActiveTransitionMenu({
      sceneIdx,
      subIdx,
      x: btnRect.left,
      y: Math.max(10, btnRect.top - 200),
      currentTransition,
      kind,
    });
  }, []);

  const [activeSceneIdx, activeSubIdxInScene] = useStoreWithEqualityFn(
    usePlaybackStore,
    (s) => {
      const sceneIdx = localTimings.findIndex(t => s.currentFrame >= t.start && s.currentFrame < t.end);
      let subIdx = -1;
      if (sceneIdx !== -1) {
        const timing = localTimings[sceneIdx];
        if (timing && timing.subs) {
          subIdx = timing.subs.findIndex(x => s.currentFrame >= x.start && s.currentFrame < x.end);
        }
      }
      return [sceneIdx, subIdx] as const;
    },
    (a, b) => a[0] === b[0] && a[1] === b[1]
  );

  return (
    <div
      className={`relative h-[60px] border-b border-zinc-800/40 bg-zinc-900/10 hover:bg-zinc-900/30 transition-colors ${
        isDragOver ? 'bg-cyan-950/40 ring-2 ring-inset ring-cyan-400' : ''
      }`}
      onDragOver={(e) => { e.preventDefault(); if (index !== undefined) onDragOver?.(e, index); }}
      onDragEnter={(e) => { if (index !== undefined) onDragEnter?.(e, index); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); if (index !== undefined) onDrop?.(e, index); }}
    >
      <TrackHeader
        title="Video"
        dotColorClass="bg-cyan-500"
        trackKey="video"
        badgeText={localTimings.length > 0 ? `${localTimings.length}` : undefined}
        index={index}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        isDragOver={isDragOver}
      />
      {localTimings.map((timing, idx) => {
        const scene = liveScenes?.[idx];
        const isSceneActive = idx === activeSceneIdx;
        // Clamp: liveScenes is deferred (stale for a beat after add/delete
        // cut) while localTimings is urgent — an out-of-range highlight index
        // must never ring a phantom cut. Clicks/seeks already use urgent
        // timing geometry; per-sub badges fall back to {} until deferred
        // catches up (see staticSubs).
        const subsLen = timing.subs?.length ?? 0;
        const currentActiveSubIdx = isSceneActive && activeSubIdxInScene >= 0 && activeSubIdxInScene < subsLen
          ? activeSubIdxInScene
          : -1;
        // Fix 7: stable keys — index keys remounted the whole lane on
        // add/delete. Prefer persistent scene id, fall back to index.
        const sceneKey = (scene as any)?.id ?? (scene as any)?.scene_id ?? `scene-${idx}`;
        return (
          <SceneBlock
            key={sceneKey}
            idx={idx}
            timing={timing}
            scene={scene}
            timelineZoom={timelineZoom}
            isActive={isSceneActive}
            activeSubIdx={currentActiveSubIdx}
            readOnly={readOnly}
            isDraggingScene={isDraggingScene}
            isLast={idx === localTimings.length - 1}
            onSeek={onSeek}
            onSubVisualResizeStart={onSubVisualResizeStart}
            onSceneBoundaryResizeStart={onSceneBoundaryResizeStart}
            onSceneAbsoluteResizeStart={onSceneAbsoluteResizeStart}
            onDeleteScene={onDeleteScene}
            onOpenTransitionMenu={handleOpenTransitionMenu}
            onOpenContextMenu={onOpenContextMenu}
            onSelectSubVisual={onSelectSubVisual}
          />
        );
      })}

      {/* Floating High-Z-Index Single Transition Popover */}
      {activeTransitionMenu && (
        <div
          id="timeline-transition-menu"
          key={`transition-menu-${activeTransitionMenu.sceneIdx}-${activeTransitionMenu.subIdx}`}
          className="fixed z-[9999] w-48 bg-zinc-900 border border-zinc-700 rounded-none shadow-2xl p-1.5 space-y-0.5 text-xs select-none pointer-events-auto"
          style={{
            top: Math.max(10, Math.min(window.innerHeight - 250, activeTransitionMenu.y)),
            left: Math.max(10, Math.min(window.innerWidth - 200, activeTransitionMenu.x)),
            transition: 'none',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
            <span>{activeTransitionMenu.kind === 'exit' ? 'Select Exit Transition' : 'Select Transition'}</span>
            <button
              onClick={() => setActiveTransitionMenu(null)}
              className="text-zinc-500 hover:text-white p-0.5 cursor-pointer inline-flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {TRANSITION_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isSelected = activeTransitionMenu.currentTransition === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    if (activeTransitionMenu.kind === 'exit') {
                      onUpdateSubVisualExitTransition?.(activeTransitionMenu.sceneIdx, activeTransitionMenu.subIdx, opt.id);
                    } else {
                      onUpdateSubVisualTransition?.(activeTransitionMenu.sceneIdx, activeTransitionMenu.subIdx, opt.id);
                    }
                    setActiveTransitionMenu(null);
                  }}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded-none text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <Icon className={`w-3 h-3 ${isSelected ? 'text-cyan-400' : 'text-zinc-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] leading-tight truncate">{opt.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
VideoTrack.displayName = 'VideoTrack';
