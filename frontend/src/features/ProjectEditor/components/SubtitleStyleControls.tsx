import React, { useState } from 'react';
import { VscChevronDown, VscChevronRight } from 'react-icons/vsc';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomColorInput } from '../../../components/ui/CustomColorInput';
import { CustomRange } from '../../../components/ui/CustomRange';
import { SUBTITLE_DEFAULTS, SUBTITLE_FONT_OPTIONS } from '../../../utils/subtitleSchema';

interface SubtitleStyleControlsProps {
  settings: any;
  onUpdate: (newSettings: any) => void;
  setSelectedPresetId: (id: string) => void;
  handleFontChange: (fontFamily: string) => void;
}

const D = SUBTITLE_DEFAULTS as any;

/** One-click return to '' ("follow the active color") once overridden. */
const FollowActiveButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    className="text-[10px] font-bold text-zinc-500 hover:text-zinc-200 underline underline-offset-2 cursor-pointer transition-colors"
  >
    Follow active color
  </button>
);

const Section = ({ title, hint, defaultOpen = true, children }: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-zinc-950/60 rounded-xl border border-zinc-800/70 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-zinc-800/30 transition-colors"
      >
        {open
          ? <VscChevronDown className="text-[10px] text-zinc-500" />
          : <VscChevronRight className="text-[10px] text-zinc-500" />}
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">{title}</span>
        {hint && <span className="text-[9px] text-zinc-600 ml-auto">{hint}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800/40">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-2">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

export const SubtitleStyleControls: React.FC<SubtitleStyleControlsProps> = ({
  settings,
  onUpdate,
  setSelectedPresetId,
  handleFontChange,
}) => {
  const set = (patch: any) => {
    setSelectedPresetId('');
    onUpdate({ ...settings, ...patch });
  };
  const v = (k: string) => (settings?.[k] !== undefined ? settings[k] : D[k]);

  const showHighlight = v('backgroundStyle') === 'highlight';
  const showFullBlock = v('backgroundStyle') === 'full_block';
  const showStroke = (v('strokeWidth') || 0) > 0;
  const showPill = v('pillStyle') === 'active';
  const showKaraoke = v('layoutMode') === 'karaoke';
  const showTop = v('position') === 'top';
  const showCenter = v('position') === 'center';

  return (
    <div className="space-y-2.5">
      {/* ── Typography ─────────────────────────────────────────── */}
      <Section title="Typography" hint="Font & sizing">
        <CustomSelect
          label="Font Family"
          options={SUBTITLE_FONT_OPTIONS}
          value={v('fontFamily')}
          onChange={handleFontChange}
        />
        <CustomSelect
          label="Text Transform"
          options={[
            { value: 'uppercase', label: 'UPPERCASE' },
            { value: 'lowercase', label: 'lowercase' },
            { value: 'capitalize', label: 'Capitalize' },
            { value: 'none', label: 'Normal' },
          ]}
          value={v('textTransform')}
          onChange={(val) => set({ textTransform: val })}
        />
        <CustomRange
          label="Font Size"
          min="20" max="150"
          value={v('fontSize')}
          valueDisplay={`${v('fontSize')}px`}
          onChange={(e) => set({ fontSize: parseInt(e.target.value) || D.fontSize })}
        />
        <CustomRange
          label="Font Weight"
          min="400" max="900" step="100"
          value={v('fontWeight')}
          valueDisplay={`${v('fontWeight')}`}
          onChange={(e) => set({ fontWeight: parseInt(e.target.value) || D.fontWeight })}
        />
        <CustomRange
          label="Word Spacing"
          min="0" max="50"
          value={v('wordSpacing')}
          valueDisplay={`${v('wordSpacing')}px`}
          onChange={(e) => set({ wordSpacing: parseInt(e.target.value) || 0 })}
        />
        <CustomRange
          label="Line Height"
          min="0.9" max="2" step="0.05"
          value={v('lineHeight')}
          valueDisplay={`${Number(v('lineHeight')).toFixed(2)}`}
          onChange={(e) => set({ lineHeight: parseFloat(e.target.value) || D.lineHeight })}
        />
      </Section>

      {/* ── Word colors ────────────────────────────────────────── */}
      <Section title="Word Colors" hint="Spoken · read · upcoming">
        <CustomColorInput
          label="Spoken Word"
          value={v('activeColor')}
          onChange={(e) => set({ activeColor: e.target.value })}
        />
        <CustomColorInput
          label="Already Spoken"
          value={v('pastColor')}
          onChange={(e) => set({ pastColor: e.target.value })}
        />
        <div className="col-span-2 max-w-[50%] pr-2">
          <CustomColorInput
            label="Upcoming"
            value={v('futureColor')}
            onChange={(e) => set({ futureColor: e.target.value })}
          />
        </div>
      </Section>

      {/* ── Animation ──────────────────────────────────────────── */}
      <Section title="Word Animation" hint="Motion on each spoken word">
        <div className="col-span-2">
          <CustomSelect
            label="Entrance Style"
            options={[
              { value: 'bounce', label: 'Bounce (Default)' },
              { value: 'pop', label: 'Pop In' },
              { value: 'jump', label: 'Jump' },
              { value: 'slide', label: 'Slide Up' },
              { value: 'fade', label: 'Fade' },
              { value: 'scale', label: 'Scale' },
              { value: 'tilt', label: 'Tilt' },
              { value: 'none', label: 'None' },
            ]}
            value={v('activeAnimation')}
            onChange={(val) => set({ activeAnimation: val })}
          />
        </div>
      </Section>

      {/* ── Layout & position ──────────────────────────────────── */}
      <Section title="Layout & Position" hint="Grouping & placement">
        <div className="col-span-2">
          <CustomSelect
            label="Layout Mode"
            options={[
              { value: 'sentence', label: 'Sentence (Classic)' },
              { value: 'karaoke', label: 'Karaoke Line (Viral)' },
              { value: 'stack', label: 'Two-Line Stack' },
            ]}
            value={v('layoutMode')}
            onChange={(val) => set({ layoutMode: val })}
          />
        </div>
        <CustomRange
          label="Words Per Screen"
          min="1" max="20"
          value={v('wordsPerScreen')}
          valueDisplay={`${v('wordsPerScreen')} words`}
          onChange={(e) => set({ wordsPerScreen: parseInt(e.target.value) || D.wordsPerScreen })}
        />
        {showKaraoke && (
          <CustomRange
            label="Karaoke Window"
            min="3" max="9" step="1"
            value={v('karaokeWindow')}
            valueDisplay={`${v('karaokeWindow')} words`}
            onChange={(e) => set({ karaokeWindow: parseInt(e.target.value) || D.karaokeWindow })}
          />
        )}
        <CustomSelect
          label="Screen Position"
          options={[
            { value: 'bottom', label: 'Bottom' },
            { value: 'center', label: 'Center' },
            { value: 'top', label: 'Top' },
          ]}
          value={v('position')}
          onChange={(val) => set({ position: val })}
        />
        {showTop ? (
          <CustomRange
            label="Top Offset"
            min="0" max="1500"
            value={v('topOffset')}
            valueDisplay={`${v('topOffset')}px`}
            onChange={(e) => set({ topOffset: parseInt(e.target.value) || D.topOffset })}
          />
        ) : showCenter ? (
          <p className="text-[10px] text-zinc-500 self-center px-1">
            Centered vertically — offsets don't apply.
          </p>
        ) : (
          <CustomRange
            label="Bottom Offset"
            min="0" max="1500"
            value={v('bottomOffset')}
            valueDisplay={`${v('bottomOffset')}px`}
            onChange={(e) => set({ bottomOffset: parseInt(e.target.value) || D.bottomOffset })}
          />
        )}
      </Section>

      {/* ── Outline & glow ─────────────────────────────────────── */}
      <Section title="Outline & Glow" hint="Viral edge treatment" defaultOpen={showStroke}>
        <CustomRange
          label="Text Outline"
          min="0" max="8"
          value={v('strokeWidth')}
          valueDisplay={v('strokeWidth') === 0 ? 'Off' : `${v('strokeWidth')}px`}
          onChange={(e) => set({ strokeWidth: parseInt(e.target.value) || 0 })}
        />
        {showStroke && (
          <CustomColorInput
            label="Outline Color"
            value={v('strokeColor')}
            onChange={(e) => set({ strokeColor: e.target.value })}
          />
        )}
        <CustomRange
          label="Active Glow"
          min="0" max="40"
          value={v('glowRadius')}
          valueDisplay={v('glowRadius') === 0 ? 'Off' : `${v('glowRadius')}px`}
          onChange={(e) => set({ glowRadius: parseInt(e.target.value) || 0 })}
        />
        <CustomColorInput
          label="Glow Color = active"
          value={settings?.glowColor || v('activeColor')}
          onChange={(e) => set({ glowColor: e.target.value })}
        />
        {settings?.glowColor ? (
          <div className="col-span-2 -mt-1">
            <FollowActiveButton onClick={() => set({ glowColor: '' })} />
          </div>
        ) : null}
      </Section>

      {/* ── Spoken-word box ────────────────────────────────────── */}
      <Section title="Spoken-Word Box" hint="Hormozi pill" defaultOpen={showPill}>
        <div className="col-span-2">
          <CustomSelect
            label="Box Style"
            options={[
              { value: 'none', label: 'None' },
              { value: 'active', label: 'Box behind spoken word' },
            ]}
            value={v('pillStyle')}
            onChange={(val) => set({ pillStyle: val })}
          />
        </div>
        {showPill && (
          <>
            <CustomColorInput
              label="Box Color = active"
              value={settings?.pillBgColor || v('highlightBgColor') || v('activeColor')}
              onChange={(e) => set({ pillBgColor: e.target.value })}
            />
            <CustomColorInput
              label="Box Text Color"
              value={settings?.pillTextColor || v('activeColor')}
              onChange={(e) => set({ pillTextColor: e.target.value })}
            />
            {(settings?.pillBgColor || settings?.pillTextColor) ? (
              <div className="col-span-2 -mt-1 flex gap-3">
                {settings?.pillBgColor ? <FollowActiveButton onClick={() => set({ pillBgColor: '' })} /> : null}
                {settings?.pillTextColor ? <FollowActiveButton onClick={() => set({ pillTextColor: '' })} /> : null}
              </div>
            ) : null}
            <CustomRange
              label="Corner Radius"
              min="0" max="30"
              value={v('pillRadius')}
              valueDisplay={`${v('pillRadius')}px`}
              onChange={(e) => set({ pillRadius: parseInt(e.target.value) || 0 })}
            />
            <CustomSelect
              label="Box Padding"
              options={[
                { value: '0 8px', label: 'Compact' },
                { value: '2px 14px', label: 'Regular' },
                { value: '6px 20px', label: 'Loose' },
              ]}
              value={v('pillPadding')}
              onChange={(val) => set({ pillPadding: val })}
            />
          </>
        )}
      </Section>

      {/* ── Background ─────────────────────────────────────────── */}
      <Section title="Background" hint="Behind full caption">
        <div className="col-span-2">
          <CustomSelect
            label="Background Style"
            options={[
              { value: 'none', label: 'None' },
              { value: 'highlight', label: 'Highlight Read Text' },
              { value: 'full_block', label: 'Entire Subtitle Block' }
            ]}
            value={v('backgroundStyle')}
            onChange={(val) => set({ backgroundStyle: val })}
          />
        </div>
        {showHighlight && (
          <div className="col-span-2 max-w-[50%] pr-2">
            <CustomColorInput
              label="Highlight Color"
              value={settings?.highlightBgColor || v('activeColor')}
              onChange={(e) => set({ highlightBgColor: e.target.value })}
            />
          </div>
        )}
        {showFullBlock && (
          <div className="col-span-2 max-w-[50%] pr-2">
            <CustomColorInput
              label="Full Background Color"
              value={v('fullBgColor')}
              onChange={(e) => set({ fullBgColor: e.target.value })}
            />
          </div>
        )}
      </Section>
    </div>
  );
};
