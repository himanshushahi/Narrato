import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  VscFiles, VscLayers, VscPackage, VscAccount, VscMusic, VscSymbolClass,
  VscSearch, VscAdd
} from 'react-icons/vsc';
import { ScrollableTabBar } from '../../components/ui/ScrollableTabBar';
import { useEditorStore, LeftPanelTab } from '../../store/useEditorStore';
import { formatTime } from '../../features/ProjectEditor/constants';

interface MediaSidebarProps {
  scriptData: any;
  sceneTimings: Array<{ start: number; end: number }>;
  onSeek?: (frame: number) => void;
  onAddScene?: () => void;
}

const tabConfig: { id: LeftPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'media', label: 'Media', icon: <VscFiles /> },
  { id: 'scenes', label: 'Scenes', icon: <VscLayers /> },
  { id: 'assets', label: 'Assets', icon: <VscPackage /> },
  { id: 'voice', label: 'Voice', icon: <VscAccount /> },
  { id: 'music', label: 'Music', icon: <VscMusic /> },
  { id: 'templates', label: 'Templates', icon: <VscSymbolClass /> },
];

export const MediaSidebar: React.FC<MediaSidebarProps> = ({ scriptData, sceneTimings, onSeek, onAddScene }) => {
  const leftPanelWidth = useEditorStore((s) => s.leftPanelWidth);
  const leftPanelTab = useEditorStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useEditorStore((s) => s.setLeftPanelTab);

  const scenes = scriptData?.scenes || [];
  const hasIntro = !!scriptData?.introduction;
  const hasConclusion = !!scriptData?.conclusion;

  const renderScenesTab = () => (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800/40">
        <div className="flex items-center gap-2 bg-zinc-900/50 rounded-lg px-3 py-2 border border-zinc-800/40">
          <VscSearch className="text-zinc-500 text-sm" />
          <input
            type="text"
            placeholder="Search scenes..."
            className="bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none w-full"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
        {/* Introduction */}
        {hasIntro && (
          <SceneListItem
            number="0"
            title="Introduction"
            subtitle="Hook"
            timing={sceneTimings[0]}
            onClick={() => onSeek?.(sceneTimings[0]?.start || 0)}
          />
        )}

        {/* Scenes */}
        {scenes.length === 0 ? (
          <div className="text-center py-8 px-4">
            <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
              <VscLayers className="text-lg text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 mb-3">No scenes created</p>
            {onAddScene && (
              <button
                onClick={onAddScene}
                className="flex items-center gap-1.5 mx-auto px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 rounded-lg text-[10px] font-bold transition-all"
              >
                <VscAdd className="text-xs" /> Generate Scene
              </button>
            )}
          </div>
        ) : (
          scenes.map((scene: any, idx: number) => {
            const globalIdx = (hasIntro ? 1 : 0) + idx;
            const timing = sceneTimings[globalIdx];
            return (
              <SceneListItem
                key={idx}
                number={String(idx + 1)}
                title={scene.title || `Scene ${idx + 1}`}
                subtitle={scene.narration ? scene.narration.slice(0, 60) + (scene.narration.length > 60 ? '...' : '') : 'No narration'}
                timing={timing}
                onClick={() => onSeek?.(timing?.start || 0)}
              />
            );
          })
        )}

        {/* Conclusion */}
        {hasConclusion && (
          <SceneListItem
            number={String(scenes.length + 1)}
            title="Conclusion"
            subtitle="Summary & CTA"
            timing={sceneTimings[sceneTimings.length - 1]}
            onClick={() => onSeek?.(sceneTimings[sceneTimings.length - 1]?.start || 0)}
          />
        )}

        {onAddScene && (
          <button
            onClick={onAddScene}
            className="w-full flex items-center justify-center gap-1 py-2 mt-2 text-zinc-500 hover:text-blue-400 border border-dashed border-zinc-700 hover:border-blue-600/40 rounded-lg text-[10px] transition-all"
          >
            <VscAdd className="text-xs" /> Add Scene
          </button>
        )}
      </div>
    </div>
  );

  const renderMediaTab = () => (
    <div className="flex flex-col h-full p-4 text-center">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
          <VscFiles className="text-2xl text-zinc-600" />
        </div>
        <p className="text-sm text-zinc-400 font-medium mb-1">Media Library</p>
        <p className="text-[10px] text-zinc-600 mb-4 max-w-45">Upload images and videos for your documentary</p>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/30 rounded-lg text-xs font-bold transition-all">
          <VscAdd /> Upload Media
        </button>
      </div>
    </div>
  );

  const renderPlaceholderTab = (label: string, icon: React.ReactNode) => (
    <div className="flex flex-col h-full p-4 text-center">
      <div className="flex-1 flex flex-col items-center justify-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
          {icon}
        </div>
        <p className="text-sm text-zinc-400 font-medium mb-1">{label}</p>
        <p className="text-[10px] text-zinc-600">Coming soon</p>
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (leftPanelTab) {
      case 'scenes': return renderScenesTab();
      case 'media': return renderMediaTab();
      case 'assets': return renderPlaceholderTab('Assets', <VscPackage className="text-xl text-zinc-600" />);
      case 'voice': return renderPlaceholderTab('Voice Library', <VscAccount className="text-xl text-zinc-600" />);
      case 'music': return renderPlaceholderTab('Music Library', <VscMusic className="text-xl text-zinc-600" />);
      case 'templates': return renderPlaceholderTab('Templates', <VscSymbolClass className="text-xl text-zinc-600" />);
    }
  };

  return (
    <div className="h-full bg-zinc-950/80 border-r border-zinc-800/60 flex flex-col overflow-x-hidden" style={{ width: leftPanelWidth }}>
      {/* Tab bar — scrollable with hover-reveal buttons */}
      <ScrollableTabBar
        tabs={tabConfig.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        activeTab={leftPanelTab}
        onChange={(id) => setLeftPanelTab(id as LeftPanelTab)}
      />

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={leftPanelTab}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col h-full min-h-0"
          >
            {renderTabContent()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

interface SceneListItemProps {
  number: string;
  title: string;
  subtitle: string;
  timing?: { start: number; end: number };
  onClick: () => void;
}

const SceneListItem: React.FC<SceneListItemProps> = ({ number, title, subtitle, timing, onClick }) => (
  <div
    onClick={onClick}
    className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-zinc-800/40 border border-transparent hover:border-zinc-700/50 cursor-pointer transition-all group"
  >
    <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-600/30 to-cyan-600/30 border border-blue-600/30 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-[9px] font-bold text-blue-400">{number}</span>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200 truncate">{title}</span>
        {timing && (
          <span className="text-[8px] font-mono text-zinc-500 shrink-0 ml-2">{formatTime(timing.start)}</span>
        )}
      </div>
      <p className="text-[9px] text-zinc-500 truncate mt-0.5">{subtitle}</p>
    </div>
  </div>
);
