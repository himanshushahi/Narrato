import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscChevronDown, VscChevronRight, VscInfo, VscLayers } from 'react-icons/vsc';
import { CustomInput, CustomTextarea } from '../../../components/ui/CustomInput';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomRange } from '../../../components/ui/CustomRange';
import { TRANSITION_TYPE_OPTIONS } from '../../ProjectEditor/constants';

interface SceneTabProps {
  scriptData: any;
  selectedSceneIndex: number | null;
  onUpdateScene?: (index: number, updates: any) => void;
}

export const SceneTab: React.FC<SceneTabProps> = ({ scriptData, selectedSceneIndex, onUpdateScene }) => {
  const [contentOpen, setContentOpen] = useState(true);
  const [animationOpen, setAnimationOpen] = useState(true);

  const scenes = scriptData?.scenes || [];
  const scene = selectedSceneIndex !== null ? scenes[selectedSceneIndex] : null;

  if (selectedSceneIndex === null || !scene) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-zinc-800/50 border border-zinc-700/50 flex items-center justify-center">
            <VscLayers className="text-xl text-zinc-600" />
          </div>
          <p className="text-sm text-zinc-500 font-medium">Select a Scene</p>
          <p className="text-[10px] text-zinc-600 max-w-[180px]">
            Click on a scene in the timeline or script tab to edit its details
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3">
      {/* Scene header */}
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-600/30 to-cyan-600/30 border border-blue-600/30 flex items-center justify-center">
          <span className="text-[9px] font-bold text-blue-400">{selectedSceneIndex + 1}</span>
        </div>
        <h3 className="text-xs font-bold text-zinc-200 truncate">{scene.title || `Scene ${selectedSceneIndex + 1}`}</h3>
      </div>

      {/* Content section */}
      <AccordionSection title="Content" isOpen={contentOpen} onToggle={() => setContentOpen(!contentOpen)}>
        <div className="space-y-3">
          <CustomInput
            label="Scene Title"
            type="text"
            value={scene.title || ''}
            onChange={(e) => onUpdateScene?.(selectedSceneIndex, { title: e.target.value })}
          />
          <CustomTextarea
            label="Narration / Description"
            rows={4}
            value={scene.narration || ''}
            onChange={(e) => onUpdateScene?.(selectedSceneIndex, { narration: e.target.value })}
          />
          <CustomInput
            label="AI Prompt"
            type="text"
            placeholder="Context for AI generation..."
            value={scene.ai_prompt || ''}
            onChange={(e) => onUpdateScene?.(selectedSceneIndex, { ai_prompt: e.target.value })}
          />
          <CustomSelect
            label="Image Style"
            options={[
              { value: 'realistic', label: 'Realistic' },
              { value: 'cinematic', label: 'Cinematic' },
              { value: 'vintage', label: 'Vintage' },
              { value: 'animated', label: 'Animated' },
            ]}
            value={scene.image_style || 'realistic'}
            onChange={(val) => onUpdateScene?.(selectedSceneIndex, { image_style: val })}
          />
          <CustomSelect
            label="Video Style"
            options={[
              { value: 'documentary', label: 'Documentary' },
              { value: 'cinematic', label: 'Cinematic' },
              { value: 'news', label: 'News Broadcast' },
              { value: 'historical', label: 'Historical' },
            ]}
            value={scene.video_style || 'documentary'}
            onChange={(val) => onUpdateScene?.(selectedSceneIndex, { video_style: val })}
          />
        </div>
      </AccordionSection>

      {/* Animation section */}
      <AccordionSection title="Animation" isOpen={animationOpen} onToggle={() => setAnimationOpen(!animationOpen)}>
        <div className="space-y-3">
          <CustomSelect
            label="Camera Movement"
            options={[
              { value: 'static', label: 'Static' },
              { value: 'pan_left', label: 'Pan Left' },
              { value: 'pan_right', label: 'Pan Right' },
              { value: 'zoom_in', label: 'Zoom In (Ken Burns)' },
              { value: 'zoom_out', label: 'Zoom Out' },
            ]}
            value={scene.camera_movement || 'static'}
            onChange={(val) => onUpdateScene?.(selectedSceneIndex, { camera_movement: val })}
          />
          <CustomSelect
            label="Transition"
            options={TRANSITION_TYPE_OPTIONS}
            value={scene.transition_type || scene.transition || 'fade'}
            onChange={(val) => onUpdateScene?.(selectedSceneIndex, { transition: val })}
          />
          <CustomRange
            label="Motion Intensity"
            min={1}
            max={10}
            step={1}
            defaultValue={5}
            valueDisplay={`${scene.motion_intensity || 5}/10`}
          />
        </div>
      </AccordionSection>

      {/* Scene info */}
      <div className="bg-zinc-900/30 border border-zinc-800/40 rounded-xl p-3">
        <div className="flex items-start gap-2">
          <VscInfo className="text-zinc-500 text-xs mt-0.5 shrink-0" />
          <div className="text-[9px] text-zinc-500">
            <p><strong className="text-zinc-400">Duration:</strong> ~{scene.narration ? Math.ceil(scene.narration.length / 15) : 5}s</p>
            <p className="mt-0.5"><strong className="text-zinc-400">Sub-visuals:</strong> {(scene.sub_visuals || []).length}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

/* Accordion Section */
interface AccordionSectionProps {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const AccordionSection: React.FC<AccordionSectionProps> = ({ title, isOpen, onToggle, children }) => (
  <div className="glass-panel rounded-xl overflow-hidden">
    <button
      onClick={onToggle}
      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{title}</span>
      {isOpen ? <VscChevronDown className="text-zinc-500 text-xs" /> : <VscChevronRight className="text-zinc-500 text-xs" />}
    </button>
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="px-4 pb-4 space-y-3">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);
