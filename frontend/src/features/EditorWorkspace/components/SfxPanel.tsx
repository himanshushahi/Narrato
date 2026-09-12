import React, { useCallback, useMemo, useState } from 'react';
import { VscSearch, VscMusic, VscTrash, VscCloudDownload, VscAdd } from 'react-icons/vsc';
import { callApi } from '../../../utils/call-api';
import { useEditorStore } from '../../../store/useEditorStore';
import { usePlaybackStore } from '../../../store/usePlaybackStore';
import { useSettingsStore } from '../../../store/useSettingsStore';
import type { SfxClip } from '../../../components/video/NitishRajputComposition';

interface SfxResult {
  id: string;
  name: string;
  duration: number;
  preview_url: string;
  license: string;
  author: string;
  tags: string[];
  downloads: number;
  rating: number;
  source: string;
}

interface SfxPanelProps {
  projectId?: string;
  sfxClips: SfxClip[];
  onUpdateSfxClips: (clips: SfxClip[]) => Promise<boolean | void>;
  onUploadSfxClip: (startFrame?: number) => Promise<void>;
  /** Refresh editor state after the bridge already wrote clips to the DB (avoids a redundant second write). */
  onRefreshSfx?: () => Promise<void>;
  onSeek?: (frame: number) => void;
}

export const SfxPanel: React.FC<SfxPanelProps> = ({
  projectId, sfxClips, onUpdateSfxClips, onUploadSfxClip, onRefreshSfx, onSeek,
}) => {
  const [query, setQuery] = useState('whoosh');
  const [results, setResults] = useState<SfxResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState('');
  const [addingManual, setAddingManual] = useState(false);
  const selectedSfxClipId = useEditorStore((s) => s.selectedSfxClipId);
  const setSelectedSfxClipId = useEditorStore((s) => s.setSelectedSfxClipId);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const masterVol = parseFloat(settings.sfx_volume || '0.5') || 0;
  const [masterDraft, setMasterDraft] = useState<number | null>(null);
  const commitMasterDraft = useCallback((v: number | null) => {
    setMasterDraft(null);
    if (v === null) return;
    const cur = useSettingsStore.getState().settings;
    saveSettings({ ...cur, sfx_volume: String(v) });
  }, [saveSettings]);

  const doSearch = useCallback(async (override?: string) => {
    const q = (override ?? query).trim();
    if (!q || searching) return;
    if (override !== undefined) setQuery(override);
    setSearching(true);
    setSearchError('');
    try {
      const res = await callApi<{ success: boolean; sfx?: SfxResult[]; error?: string }>('search_sfx', q, 10, 'downloads_desc');
      if (!res) {
        setSearchError('Backend not connected.');
        setResults([]);
      } else if (!res.success || res.error) {
        setSearchError(res.error || 'Search failed. Add your Freesound API key in Settings.');
        setResults(res.sfx || []);
      } else {
        setResults(res.sfx || []);
        if ((res.sfx || []).length === 0) setSearchError('No SFX found. Try whoosh, applause, rain.');
      }
    } catch (e) {
      setSearchError('Search failed.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, searching]);

  const EXAMPLE_QUERIES = useMemo(() => ['whoosh', 'applause', 'rain', 'riser', 'impact'], []);

  // Fix 12: read frame via getState inside handler — previously whole panel
  // re-rendered at 20Hz while playing when SFX tab open.
  const handleDownload = useCallback(async (r: SfxResult) => {
    if (!projectId || !r.preview_url || downloadingId) return;
    const currentFrame = usePlaybackStore.getState().currentFrame;
    setDownloadingId(r.id);
    try {
      const res = await callApi<{ success: boolean; clip?: any; clips?: any[]; error?: string }>(
        'download_sfx_to_project', projectId, r.preview_url, r.name, currentFrame || 0,
      );
      if (res?.success) {
        // Bridge already persisted the clip — just refresh, don't re-save.
        if (onRefreshSfx) await onRefreshSfx();
        else await onUpdateSfxClips((res.clips || []) as SfxClip[]);
        if (res.clip?.id) setSelectedSfxClipId(res.clip.id);
      } else {
        setSearchError(res?.error || 'Download failed.');
      }
    } finally {
      setDownloadingId(null);
    }
  }, [projectId, downloadingId, onUpdateSfxClips, onRefreshSfx, setSelectedSfxClipId]);

  const handleAddManualUrl = useCallback(async () => {
    const url = manualUrl.trim();
    if (!projectId || !url || addingManual) return;
    const currentFrame = usePlaybackStore.getState().currentFrame;
    setAddingManual(true);
    try {
      const name = url.split('/').pop()?.split('?')[0] || 'manual sfx';
      const res = await callApi<{ success: boolean; clip?: any; clips?: any[]; error?: string }>(
        'download_sfx_to_project', projectId, url, name, currentFrame || 0,
      );
      if (res?.success) {
        // Bridge already persisted the clip — just refresh, don't re-save.
        if (onRefreshSfx) await onRefreshSfx();
        else await onUpdateSfxClips((res.clips || []) as SfxClip[]);
        setManualUrl('');
        if (res.clip?.id) setSelectedSfxClipId(res.clip.id);
      } else {
        setSearchError(res?.error || 'Could not download that URL.');
      }
    } finally {
      setAddingManual(false);
    }
  }, [manualUrl, projectId, addingManual, onUpdateSfxClips, onRefreshSfx, setSelectedSfxClipId]);

  const handleDelete = useCallback(async (id: string) => {
    const next = sfxClips.filter((c) => c.id !== id);
    await onUpdateSfxClips(next);
    if (selectedSfxClipId === id) setSelectedSfxClipId(next[0]?.id || null);
  }, [sfxClips, onUpdateSfxClips, selectedSfxClipId, setSelectedSfxClipId]);

  const selectedClip = useMemo(
    () => sfxClips.find((c) => c.id === selectedSfxClipId) || null,
    [sfxClips, selectedSfxClipId],
  );

  const patchSelected = useCallback(async (patch: Partial<SfxClip>) => {
    if (!selectedClip) return;
    const next = sfxClips.map((c) => (c.id === selectedClip.id ? { ...c, ...patch } : c));
    await onUpdateSfxClips(next);
  }, [selectedClip, sfxClips, onUpdateSfxClips]);

  // Draft volume while dragging: commit to the DB only on release so every
  // slider pixel doesn't fire a SQLite write + media remount.
  const [volDraft, setVolDraft] = useState<{ id: string; v: number } | null>(null);
  const commitVolDraft = useCallback(() => {
    if (!volDraft || !selectedClip || volDraft.id !== selectedClip.id) {
      setVolDraft(null);
      return;
    }
    const next = sfxClips.map((c) => (c.id === volDraft.id ? { ...c, volume: volDraft.v } : c));
    setVolDraft(null);
    onUpdateSfxClips(next);
  }, [volDraft, selectedClip, sfxClips, onUpdateSfxClips]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2.5 border-b border-zinc-800/40 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sound Effects</h3>
          <span className="text-[9px] font-mono text-zinc-600">{sfxClips.length} on timeline</span>
        </div>
        <label className="flex items-center gap-2 text-[10px] text-zinc-400" title="Master SFX gain applied at preview and export">
          Master
          <input
            type="range" min={0} max={1} step={0.01}
            value={masterDraft ?? masterVol}
            onChange={(e) => setMasterDraft(parseFloat(e.target.value))}
            onPointerUp={(e) => commitMasterDraft(parseFloat((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => commitMasterDraft(parseFloat((e.target as HTMLInputElement).value))}
            className="flex-1 h-1 accent-amber-500"
          />
          <span className="font-mono w-10 text-right">{Math.round((masterDraft ?? masterVol) * 100)}%</span>
        </label>
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/40">
          <VscSearch className="text-zinc-500 text-xs shrink-0" />
          <input
            type="text"
            placeholder="Search trending SFX: whoosh, applause..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            className="bg-transparent text-[11px] text-zinc-300 placeholder-zinc-600 outline-none w-full"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); setSearchError(''); }}
              className="text-zinc-600 hover:text-zinc-400 text-xs shrink-0 cursor-pointer"
              title="Clear search"
            >
              &times;
            </button>
          )}
          <button
            onClick={() => doSearch()}
            disabled={searching}
            className="text-[10px] font-bold text-amber-400 hover:text-amber-300 disabled:opacity-50 cursor-pointer"
          >
            {searching ? '...' : 'GO'}
          </button>
        </div>
        {searchError && <p className="text-[10px] text-amber-500/90">{searchError}</p>}
        {/* Manual URL add (Pixabay CDN / any direct mp3) */}
        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 bg-zinc-900/60 border border-zinc-800/40">
          <VscAdd className="text-zinc-500 text-xs shrink-0" />
          <input
            type="text"
            placeholder="Paste direct mp3 URL (Pixabay CDN...)"
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            className="bg-transparent text-[11px] text-zinc-300 placeholder-zinc-600 outline-none w-full"
          />
          <button
            onClick={handleAddManualUrl}
            disabled={addingManual || !manualUrl.trim()}
            className="text-[10px] font-bold text-blue-400 hover:text-blue-300 disabled:opacity-50 cursor-pointer"
          >
            {addingManual ? '...' : 'ADD'}
          </button>
        </div>
        <button
          onClick={() => onUploadSfxClip(usePlaybackStore.getState().currentFrame || 0)}
          className="w-full text-[10px] font-bold uppercase tracking-wider py-1.5 rounded-md bg-amber-600/20 text-amber-300 border border-amber-700/40 hover:bg-amber-600/30 cursor-pointer"
        >
          + Upload audio file at playhead
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
        {results.length === 0 && !searching && !searchError && (
          <div className="text-center py-6 px-4">
            <p className="text-[11px] text-zinc-500 mb-2">Search trending sound effects, or try:</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {EXAMPLE_QUERIES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => doSearch(ex)}
                  className="text-[10px] font-mono px-2 py-1 rounded-md bg-amber-600/15 text-amber-300 border border-amber-700/40 hover:bg-amber-600/30 cursor-pointer"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {results.map((r) => {
          const isCC0 = /zero|creative commons 0/i.test(r.license || '');
          return (
          <div key={`${r.source}-${r.id}`} className="rounded-lg border border-zinc-800/50 bg-zinc-900/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-zinc-200 truncate">
                  {r.name}{' '}
                  <span className={`text-[8px] font-mono px-1 py-px rounded border ${isCC0 ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' : 'text-zinc-500 bg-zinc-800/60 border-zinc-700/60'}`}>
                    {isCC0 ? 'CC0' : r.source}
                  </span>
                </p>
                <p className="text-[9px] font-mono text-zinc-500">
                  {(r.duration || 0).toFixed(1)}s · ⬇{r.downloads} · {r.author || 'unknown'}
                </p>
              </div>
              <button
                onClick={() => handleDownload(r)}
                disabled={downloadingId !== null || !r.preview_url}
                className="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md bg-amber-600/20 text-amber-300 border border-amber-700/40 hover:bg-amber-600/30 disabled:opacity-50 cursor-pointer"
                title={r.preview_url ? 'Download to SFX track at playhead' : 'No preview available for this sound'}
              >
                <VscCloudDownload /> {downloadingId === r.id ? '...' : 'USE'}
              </button>
            </div>
            {r.preview_url && (
              <audio controls controlsList="nodownload" preload="none" src={r.preview_url} className="w-full h-7 mt-1.5 opacity-80" />
            )}
          </div>
          );
        })}

        {/* Timeline clips — manual edit */}
        {sfxClips.length === 0 && (
          <p className="text-[10px] text-zinc-600 text-center py-3">
            Timeline empty — USE a result above or upload a file.
          </p>
        )}
        {sfxClips.length > 0 && (
          <div className="pt-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-1 pb-1">On timeline</p>
            {sfxClips.map((c) => (
              <div
                key={c.id}
                onClick={() => { setSelectedSfxClipId(c.id); if (onSeek) onSeek(c.start_frame || 0); }}
                className={`rounded-lg border p-2 mb-1 cursor-pointer ${selectedSfxClipId === c.id ? 'border-amber-500/60 bg-amber-950/20' : 'border-zinc-800/50 bg-zinc-900/40'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <VscMusic className="text-amber-400 text-xs shrink-0" />
                    <span className="text-[11px] text-zinc-200 truncate">{c.name}</span>
                    <span className="text-[9px] font-mono text-zinc-500 shrink-0">
                      @{((c.start_frame || 0) / 30).toFixed(1)}s · {((c.duration_frames || 0) / 30).toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                      className="text-zinc-500 hover:text-red-400 text-xs px-1 cursor-pointer"
                      title="Remove from timeline"
                    >
                      <VscTrash />
                    </button>
                  </div>
                </div>
                {c.audio_url && (
                  <audio controls controlsList="nodownload" preload="none" src={c.audio_url} className="w-full h-7 mt-1 opacity-80" onClick={(e) => e.stopPropagation()} />
                )}
                {selectedSfxClipId === c.id && (
                  <div className="mt-1.5 space-y-1" onClick={(e) => e.stopPropagation()}>
                    <label className="flex items-center gap-2 text-[10px] text-zinc-400">
                      Vol
                      <input
                        type="range" min={0} max={1} step={0.01}
                        value={volDraft?.id === c.id ? volDraft.v : (c.volume ?? 0.5)}
                        onChange={(e) => setVolDraft({ id: c.id, v: parseFloat(e.target.value) })}
                        onPointerUp={() => commitVolDraft()}
                        onKeyUp={() => commitVolDraft()}
                        className="flex-1 h-1 accent-amber-500"
                      />
                      <span className="font-mono w-8 text-right">{(volDraft?.id === c.id ? volDraft.v : (c.volume ?? 0.5)).toFixed(2)}</span>
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-zinc-400">
                      <input
                        type="checkbox" checked={!(c.loop ?? false)}
                        onChange={(e) => patchSelected({ loop: !e.target.checked })}
                        className="accent-amber-500"
                      />
                      One-shot
                      <input
                        type="checkbox" checked={!!c.is_muted}
                        onChange={(e) => patchSelected({ is_muted: e.target.checked })}
                        className="accent-amber-500 ml-2"
                      />
                      Muted
                    </label>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
