import React, { useMemo } from 'react';
import { VscTrash } from 'react-icons/vsc';
import { Clapperboard, Image, User, BarChart2, Map, Layers, MonitorPlay, Link, FileText } from 'lucide-react';
import { formatTime } from '../../../features/ProjectEditor/constants';

const FPS = 30;
const HEADER_WIDTH = 110;

const SCENE_COLORS = [
  'from-blue-600/40 to-cyan-600/30 border-blue-500/40',
  'from-violet-600/40 to-purple-600/30 border-violet-500/40',
  'from-emerald-600/40 to-teal-600/30 border-emerald-500/40',
  'from-amber-600/40 to-orange-600/30 border-amber-500/40',
  'from-rose-600/40 to-pink-600/30 border-rose-500/40',
  'from-sky-600/40 to-indigo-600/30 border-sky-500/40',
  'from-lime-600/40 to-green-600/30 border-lime-500/40',
  'from-cyan-600/40 to-blue-600/30 border-cyan-500/40',
];

const SUBVISUAL_ICONS: Record<string, React.ElementType> = {
  scene: Clapperboard,
  image: Image,
  portrait: User,
  chart: BarChart2,
  map: Map,
  parallax: Layers,
  youtube: MonitorPlay,
  network: Link,
  document: FileText,
};

const SUBVISUAL_COLORS: Record<string, string> = {
  scene: 'from-blue-500/40 to-cyan-500/30 border-blue-500/50',
  image: 'from-sky-500/40 to-indigo-500/30 border-sky-500/50',
  portrait: 'from-purple-500/40 to-fuchsia-500/30 border-purple-500/50',
  chart: 'from-amber-500/40 to-orange-500/30 border-amber-500/50',
  map: 'from-emerald-500/40 to-green-500/30 border-emerald-500/50',
  parallax: 'from-pink-500/40 to-rose-500/30 border-pink-500/50',
  youtube: 'from-red-500/40 to-rose-500/30 border-red-500/50',
  network: 'from-teal-500/40 to-cyan-500/30 border-teal-500/50',
  document: 'from-stone-500/40 to-zinc-500/30 border-stone-500/50',
};

interface SubVisualBlock {
  subX: number;
  subW: number;
  svType: string;
  svColor: string;
  isSubActive: boolean;
  isSubHovered: boolean;
  subIdx: number;
  subStart: number;
  subEnd: number;
  IconComponent: React.ElementType;
}

interface SceneBlockProps {
  idx: number;
  timing: { start: number; end: number; subs: Array<{ start: number; end: number }> };
  scene: any;
  timelineZoom: number;
  currentFrame: number;
  isHovered: boolean;
  isDraggingScene: boolean;
  readOnly: boolean;
  hoveredSubVisual: { scene: number; sub: number } | null;
  onSeek: (frame: number) => void;
  onHoverEnter: (idx: number) => void;
  onHoverLeave: () => void;
  onSubHoverEnter: (scene: number, sub: number) => void;
  onSubHoverLeave: () => void;
  onSubVisualResizeStart: (e: React.MouseEvent, idx: number, subIdx: number) => void;
  onDeleteScene: ((index: number) => void) | undefined;
}

const SceneBlock: React.FC<SceneBlockProps> = React.memo(({
  idx, timing, scene, timelineZoom, currentFrame, isHovered, isDraggingScene,
  readOnly, hoveredSubVisual, onSeek, onHoverEnter,
  onHoverLeave, onSubHoverEnter, onSubHoverLeave,
  onSubVisualResizeStart, onDeleteScene
}) => {
  const x = (timing.start / FPS) * timelineZoom;
  const w = Math.max(8, ((timing.end - timing.start) / FPS) * timelineZoom);
  const isActive = currentFrame >= timing.start && currentFrame < timing.end;
  const colorIdx = idx % SCENE_COLORS.length;
  const subVisuals = scene?.sub_visuals || [];
  const isIntroOrConclusion = scene?.section_type === 'introduction' || scene?.section_type === 'conclusion';

  const subBlocks: SubVisualBlock[] = useMemo(() => {
    if (!timing.subs) return [];
    return timing.subs.map((sub, subIdx) => {
      const subX = ((sub.start - timing.start) / FPS) * timelineZoom;
      const subW = Math.max(4, ((sub.end - sub.start) / FPS) * timelineZoom);
      const svType = subVisuals[subIdx]?.visual_type || 'scene';
      const svColor = SUBVISUAL_COLORS[svType] || SUBVISUAL_COLORS.scene;
      const isSubActive = currentFrame >= sub.start && currentFrame < sub.end;
      const isSubHovered = hoveredSubVisual?.scene === idx && hoveredSubVisual?.sub === subIdx;
      const IconComponent = SUBVISUAL_ICONS[svType] || Clapperboard;
      return { subX, subW, svType, svColor, isSubActive, isSubHovered, subIdx, subStart: sub.start, subEnd: sub.end, IconComponent };
    });
  }, [timing, timelineZoom, currentFrame, subVisuals, hoveredSubVisual, idx]);

  return (
    <div
      className={`absolute top-2 rounded-md border bg-gradient-to-r ${SCENE_COLORS[colorIdx]}
        ${isActive ? 'ring-2 ring-cyan-400/60 z-20' : 'z-10 shadow-md'}
        ${isHovered ? 'ring-1 ring-white/40 brightness-110' : ''}
        cursor-pointer overflow-hidden`}
      style={{ left: x + HEADER_WIDTH, width: w, height: 40 }}
      onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); const clickX = e.clientX - rect.left; const clickFrame = timing.start + Math.floor((clickX / w) * (timing.end - timing.start)); onSeek(clickFrame); } }}
      onMouseEnter={() => onHoverEnter(idx)}
      onMouseLeave={() => onHoverLeave()}
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
              onHoverEnter={onSubHoverEnter}
              onHoverLeave={onSubHoverLeave}
              onResizeStart={onSubVisualResizeStart}
              sceneIdx={idx}
            />
          ))}
        </div>
      ) : (
        <SceneLabel title={scene?.title || `Scene ${idx}`} startTime={timing.start} />
      )}

      {subBlocks.length > 0 && (
        <div className="absolute bottom-0 left-1 right-1 flex items-center justify-between pointer-events-none">
          <span className="text-[7px] font-bold text-white/70 truncate">
            {scene?.title || `Scene ${idx}`}
          </span>
        </div>
      )}

      {!readOnly && isHovered && !isIntroOrConclusion && !isDraggingScene && onDeleteScene && (
        <div className="absolute -top-6 right-1 flex gap-0.5 z-30">
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteScene(idx); }}
            className="w-5 h-5 flex items-center justify-center rounded bg-red-600/80 text-white hover:bg-red-500"
          >
            <VscTrash className="text-[8px]" />
          </button>
        </div>
      )}
    </div>
  );
});
SceneBlock.displayName = 'SceneBlock';

interface SubVisualBlockProps {
  block: SubVisualBlock;
  isDraggingScene: boolean;
  readOnly: boolean;
  isLast: boolean;
  onSeek: (frame: number) => void;
  onHoverEnter: (scene: number, sub: number) => void;
  onHoverLeave: () => void;
  onResizeStart: (e: React.MouseEvent, sceneIdx: number, subIdx: number) => void;
  sceneIdx: number;
}

const SubVisualBlock: React.FC<SubVisualBlockProps> = React.memo(({
  block, isDraggingScene, readOnly, isLast, onSeek, onHoverEnter, onHoverLeave, onResizeStart, sceneIdx
}) => {
  return (
    <div
      className={`relative h-full border-r border-zinc-950/30 last:border-r-0 bg-gradient-to-r ${block.svColor}
        ${block.isSubActive ? 'ring-1 ring-inset ring-white/40 z-10' : ''}
        ${block.isSubHovered ? 'brightness-125' : ''}
        transition-all cursor-pointer group/sub`}
      style={{ width: block.subW, minWidth: 4 }}
      onClick={(e) => { if (!isDraggingScene) { e.stopPropagation(); onSeek(block.subStart); } }}
      onMouseEnter={() => onHoverEnter(sceneIdx, block.subIdx)}
      onMouseLeave={() => onHoverLeave()}
    >
      {block.subW > 16 && (
        <div className="absolute inset-0 flex items-center gap-1.5 px-2 overflow-hidden opacity-70">
          <block.IconComponent className="w-[10px] h-[10px] shrink-0" />
          {block.subW > 40 && <span className="text-[8px] font-medium tracking-wide capitalize truncate">{block.svType}</span>}
        </div>
      )}

      {!readOnly && !isDraggingScene && !isLast && (
        <div
          className="absolute right-0 top-0 bottom-0 w-2 translate-x-1/2 z-20 cursor-col-resize flex justify-center opacity-0 group-hover/sub:opacity-100 transition-opacity"
          onMouseDown={(e) => onResizeStart(e, sceneIdx, block.subIdx)}
        >
          <div className="w-[2px] h-full bg-cyan-400" />
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
  currentFrame: number;
  hoveredSceneIdx: number | null;
  hoveredSubVisual: { scene: number; sub: number } | null;
  isDraggingScene: boolean;
  readOnly: boolean;
  onSeek: (frame: number) => void;
  onSceneHoverEnter: (idx: number) => void;
  onSceneHoverLeave: () => void;
  onSubHoverEnter: (scene: number, sub: number) => void;
  onSubHoverLeave: () => void;
  onSubVisualResizeStart: (e: React.MouseEvent, idx: number, subIdx: number) => void;
  onDeleteScene: ((index: number) => void) | undefined;
}

export const VideoTrack: React.FC<VideoTrackProps> = React.memo(({
  localTimings, liveScenes, timelineZoom, currentFrame,
  hoveredSceneIdx, hoveredSubVisual, isDraggingScene, readOnly,
  onSeek, onSceneHoverEnter, onSceneHoverLeave,
  onSubHoverEnter, onSubHoverLeave,
  onSubVisualResizeStart, onDeleteScene
}) => {
  return (
    <div className="relative h-14 border-b border-zinc-800/40 bg-zinc-900/10 hover:bg-zinc-900/30 transition-colors">
      <div
        className="sticky left-0 top-0 h-full bg-zinc-950/90 border-r border-zinc-800/60 flex items-center justify-between px-3 z-[60] backdrop-blur-md"
        style={{ width: HEADER_WIDTH, boxShadow: '4px 0 15px rgba(0,0,0,0.5)' }}
      >
        <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-500" />
          Video
        </span>
      </div>
      {localTimings.map((timing, idx) => {
        const scene = liveScenes?.[idx];
        return (
          <SceneBlock
            key={idx}
            idx={idx}
            timing={timing}
            scene={scene}
            timelineZoom={timelineZoom}
            currentFrame={currentFrame}
            isHovered={hoveredSceneIdx === idx}
            readOnly={readOnly}
            isDraggingScene={isDraggingScene}
            hoveredSubVisual={hoveredSubVisual}
            onSeek={onSeek}
            onHoverEnter={onSceneHoverEnter}
            onHoverLeave={onSceneHoverLeave}
            onSubHoverEnter={onSubHoverEnter}
            onSubHoverLeave={onSubHoverLeave}
            onSubVisualResizeStart={onSubVisualResizeStart}
            onDeleteScene={onDeleteScene}
          />
        );
      })}
    </div>
  );
});
VideoTrack.displayName = 'VideoTrack';
