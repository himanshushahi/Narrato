import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { callApi } from '../../../utils/call-api';

export interface AssetEntry {
  /** Unique key "<sceneIndex>-<subIndex>" for React list keys */
  key: string;
  /** Global index in the manifest array */
  sceneIndex: number;
  /** Scene title from script data */
  sceneTitle: string;
  /** "introduction" | "scene" | "conclusion" */
  sectionType: string;
  /** Index within the scene's sub_visuals */
  subIndex: number;
  /** Visual type: youtube, scene, image, portrait, parallax, map, etc. */
  visualType: string;
  /** Visual cue / search query text */
  visualCue: string;
  /** Local filesystem path to the asset (undefined if not yet downloaded) */
  visualPath?: string;
  /** /api/media URL for preview (empty if not yet downloaded) */
  visualUrl: string;
  /** Duration of this sub-visual in frames (from manifest) */
  duration?: number;
  /** Whether the asset file physically exists on disk */
  fileExists: boolean;
  /** File size in bytes (from disk scan) */
  fileSize?: number;
  /** Last modified timestamp (from disk scan) */
  lastModified?: number;
  /** File extension e.g. ".mp4", ".jpg" */
  extension?: string;
  /** Timing info for seeking */
  timing?: { start: number; end: number };
  /** Whether this is a programmatic-only visual type (map, document, network) */
  isProgrammatic: boolean;
}

interface DiskFileInfo {
  filename: string;
  path: string;
  size_bytes: number;
  last_modified: number;
  extension: string;
}

interface DiskScanResult {
  files: DiskFileInfo[];
  total_size: number;
  total_files: number;
}

/**
 * Programmatic visual types that have no downloaded asset file.
 */
const PROGRAMMATIC_TYPES = new Set(['map', 'document', 'network', 'thread']);

/**
 * Hook that provides a flattened, real-time view of all visual assets for a project.
 *
 * Merges data from two sources:
 * 1. Manifest JSON (authoritative for scene context, visual_type, visual_cue)
 * 2. Disk scan (real-time file existence, size, modification time)
 *
 * During the fetch_assets pipeline step, this hook polls the filesystem
 * every 3 seconds so newly downloaded files appear as they land on disk.
 */
export function useProjectAssets(
  projectId: string | undefined,
  manifestData: any[],
  sceneTimings: Array<{ start: number; end: number; subs: Array<{ start: number; end: number }> }>,
  sceneTitles: string[],
  reloadTrigger: number,
  isFetchingAssets: boolean,
) {
  const [diskFiles, setDiskFiles] = useState<Record<string, DiskFileInfo>>({});
  const [isScanning, setIsScanning] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Filename (without extension) -> disk info, for O(1) asset lookups. */
  const diskFilesByBase = useMemo(() => {
    const map: Record<string, DiskFileInfo> = {};
    for (const f of Object.values(diskFiles)) {
      const base = f.filename.replace(/\.[^.]+$/, '');
      if (!(base in map)) map[base] = f;
    }
    return map;
  }, [diskFiles]);

  /** Flatten manifest into per-asset entries, merged with disk info */
  const assets: AssetEntry[] = (() => {
    const result: AssetEntry[] = [];
    if (!manifestData || manifestData.length === 0) return result;

    manifestData.forEach((scene: any, sceneIdx: number) => {
      const subVisuals = scene.sub_visuals || [];
      const sceneTitle = sceneTitles[sceneIdx] || scene.title || `Scene ${sceneIdx + 1}`;
      const timing = sceneTimings[sceneIdx];

      subVisuals.forEach((sv: any, subIdx: number) => {
        const key = `${sceneIdx}-${subIdx}`;
        const isProgrammatic = PROGRAMMATIC_TYPES.has(sv.visual_type);

        // Derive the expected filename for disk-info lookup
        const expectedFilename = `asset_${String(sceneIdx).padStart(3, '0')}_${String(subIdx).padStart(2, '0')}`;
        let diskInfo: DiskFileInfo | undefined = diskFilesByBase[expectedFilename];
        if (!diskInfo) {
          // Fallback for unusual filenames with suffixes (rare)
          diskInfo = Object.values(diskFiles).find(
            (f) => f.filename.startsWith(expectedFilename),
          ) as DiskFileInfo | undefined;
        }

        result.push({
          key,
          sceneIndex: sceneIdx,
          sceneTitle,
          sectionType: scene.section_type || 'scene',
          subIndex: subIdx,
          visualType: sv.visual_type || 'unknown',
          visualCue: sv.visual_cue || '',
          visualPath: sv.visual_path,
          visualUrl: sv.visual_url || '',
          duration: sv.duration,
          fileExists: !!diskInfo,
          fileSize: diskInfo?.size_bytes,
          lastModified: diskInfo?.last_modified,
          extension: diskInfo?.extension,
          timing: timing?.subs?.[subIdx],
          isProgrammatic,
        });
      });
    });

    return result;
  })();

  /** Amount of disk space consumed by assets (bytes) */
  const totalSize = assets.reduce((sum, a) => sum + (a.fileSize || 0), 0);

  /** Number of assets that have been downloaded (file exists) */
  const downloadedCount = assets.filter((a) => a.fileExists).length;

  /** Number of non-programmatic assets still pending download */
  const pendingCount = assets.filter((a) => !a.isProgrammatic && !a.fileExists).length;

  /** Total non-programmatic assets */
  const totalDownloadable = assets.filter((a) => !a.isProgrammatic).length;

  /** Scan the assets directory for real-time file info */
  const scanDisk = useCallback(async () => {
    if (!projectId) return;
    setIsScanning(true);
    try {
      const result = await callApi<DiskScanResult>('scan_assets_directory', projectId);
      if (result && result.files) {
        const map: Record<string, DiskFileInfo> = {};
        result.files.forEach((f) => {
          map[f.filename] = f;
        });
        setDiskFiles(map);
      }
    } catch (e) {
      console.error('Failed to scan assets directory:', e);
    } finally {
      setIsScanning(false);
    }
  }, [projectId]);

  // Scan on mount and when reloadTrigger changes
  useEffect(() => {
    scanDisk();
  }, [scanDisk, reloadTrigger]);

  // Poll during the fetch_assets step for real-time updates
  useEffect(() => {
    if (isFetchingAssets) {
      // Poll every 3 seconds while assets are being downloaded
      const poll = () => {
        scanDisk();
        pollTimerRef.current = setTimeout(poll, 3000);
      };
      poll();
    } else {
      // Clear polling when step finishes
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      // Do one final scan after the step completes to catch any stragglers
      if (pendingCount > 0) {
        scanDisk();
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isFetchingAssets, scanDisk]);

  return {
    assets,
    totalSize,
    downloadedCount,
    pendingCount,
    totalDownloadable,
    isScanning,
    refresh: scanDisk,
  } as const;
}
