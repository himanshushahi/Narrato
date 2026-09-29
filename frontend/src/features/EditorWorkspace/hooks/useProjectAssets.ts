import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { callApi } from '../../../utils/call-api';
import { getMediaUrlSync } from '../../../utils/mediaUrl';

export type AssetCategory = 'all' | 'video' | 'image' | 'html' | 'map' | 'audio' | 'other';

export interface AssetEntry {
  /** Unique key for React list keys */
  key: string;
  /** Global index in the manifest array */
  sceneIndex: number;
  /** Scene title from script data */
  sceneTitle: string;
  /** "introduction" | "scene" | "conclusion" */
  sectionType: string;
  /** Index within the scene's sub_visuals */
  subIndex: number;
  /** Index of layer in the AST Sequence (or undefined) */
  layerIndex?: number;
  /** Asset category */
  category: 'video' | 'image' | 'html' | 'map' | 'audio' | 'other';
  /** Display type e.g. 'Video' | 'Image' | 'HTML / Canvas' | 'Map' */
  assetType: string;
  /** Search query, prompt, or title */
  title: string;
  /** Source provider: 'Pexels' | 'Pixabay' | 'Generated AST' | 'Local' | etc. */
  source?: string;
  /** Local filesystem path to the asset */
  filePath?: string;
  /** Filename only */
  filename?: string;
  /** Media serving URL for preview */
  mediaUrl: string;
  /** Duration of this sub-visual in seconds/frames */
  duration?: number;
  /** Whether the asset file physically exists on disk or is generated code */
  fileExists: boolean;
  /** File size in bytes (from disk scan) */
  fileSize?: number;
  /** Last modified timestamp (from disk scan) */
  lastModified?: number;
  /** File extension e.g. ".mp4", ".jpg", ".html" */
  extension?: string;
  /** Timing info for seeking */
  timing?: { start: number; end: number };
  /** Extra details (e.g. HTML snippet or locations summary) */
  extraDetails?: string;
  /** Whether this is a programmatic-only visual type (map, html, document) */
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

const isVideoExt = (ext?: string): boolean => {
  if (!ext) return false;
  const e = ext.toLowerCase();
  return e === '.mp4' || e === '.webm' || e === '.mov' || e === '.mkv' || e === '.avi';
};

const isImageExt = (ext?: string): boolean => {
  if (!ext) return false;
  const e = ext.toLowerCase();
  return e === '.jpg' || e === '.jpeg' || e === '.png' || e === '.webp' || e === '.gif' || e === '.svg';
};

const isAudioExt = (ext?: string): boolean => {
  if (!ext) return false;
  const e = ext.toLowerCase();
  return e === '.mp3' || e === '.wav' || e === '.ogg' || e === '.m4a' || e === '.flac';
};

/**
 * Hook that provides a comprehensive, real-time view of ALL visual and media assets for a project.
 *
 * Extracts assets from:
 * 1. AST Composition layers (Videos, Images, HTML/Canvas animations, 3D Maps)
 * 2. Scene/sub-visual media paths
 * 3. Physical files in project's assets directory on disk
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

  /** Filename -> disk info lookup */
  const diskFilesMap = useMemo(() => diskFiles, [diskFiles]);

  /** Flatten AST manifest into rich per-asset entries, merged with disk info */
  const assets: AssetEntry[] = useMemo(() => {
    const result: AssetEntry[] = [];
    const claimedFilenames = new Set<string>();

    if (manifestData && manifestData.length > 0) {
      manifestData.forEach((scene: any, sceneIdx: number) => {
        const subVisuals = scene.sub_visuals || [];
        const sceneTitle = sceneTitles[sceneIdx] || scene.title || `Scene ${sceneIdx + 1}`;
        const sectionType = scene.section_type || 'scene';
        const sceneTiming = sceneTimings[sceneIdx];

        subVisuals.forEach((sv: any, subIdx: number) => {
          const subTiming = sceneTiming?.subs?.[subIdx] || sceneTiming;
          const composition = sv.composition;

          if (composition && composition.type === 'Sequence' && Array.isArray(composition.children) && composition.children.length > 0) {
            // Traverse each AST layer inside the Sequence
            composition.children.forEach((layer: any, layerIdx: number) => {
              const content = layer.content || {};
              const contentType = content.type;
              const layerKey = `sc-${sceneIdx}-sub-${subIdx}-lay-${layerIdx}`;

              if (contentType === 'Video' || contentType === 'Image') {
                const isVideo = contentType === 'Video';
                const filePath = content.local_path || sv.visual_path || '';
                const filename = filePath ? filePath.split(/[/\\]/).pop() || '' : '';
                if (filename) claimedFilenames.add(filename);
                const diskInfo = filename ? diskFilesMap[filename] : undefined;

                result.push({
                  key: layerKey,
                  sceneIndex: sceneIdx,
                  sceneTitle,
                  sectionType,
                  subIndex: subIdx,
                  layerIndex: layerIdx,
                  category: isVideo ? 'video' : 'image',
                  assetType: contentType,
                  title: content.query || filename || `${contentType} Layer ${layerIdx + 1}`,
                  source: content.source ? (content.source.toLowerCase() === 'archive' ? 'Internet Archive' : content.source.charAt(0).toUpperCase() + content.source.slice(1)) : 'Pexels',
                  filePath: filePath || diskInfo?.path,
                  filename: filename || diskInfo?.filename,
                  mediaUrl: filePath ? getMediaUrlSync(filePath) : (diskInfo?.path ? getMediaUrlSync(diskInfo.path) : ''),
                  duration: sv.duration,
                  fileExists: !!diskInfo || (!!filePath && !filePath.startsWith('http')),
                  fileSize: diskInfo?.size_bytes,
                  lastModified: diskInfo?.last_modified,
                  extension: diskInfo?.extension || (filePath ? '.' + filePath.split('.').pop()?.toLowerCase() : (isVideo ? '.mp4' : '.jpg')),
                  timing: subTiming,
                  isProgrammatic: false,
                });
              } else if (contentType === 'HTML') {
                result.push({
                  key: layerKey,
                  sceneIndex: sceneIdx,
                  sceneTitle,
                  sectionType,
                  subIndex: subIdx,
                  layerIndex: layerIdx,
                  category: 'html',
                  assetType: 'HTML / Canvas',
                  title: 'Interactive Canvas / Code Animation',
                  source: 'Generated AST',
                  filePath: '',
                  filename: 'canvas_code.html',
                  mediaUrl: '',
                  duration: sv.duration,
                  fileExists: true,
                  extension: '.html',
                  timing: subTiming,
                  extraDetails: content.html_content,
                  isProgrammatic: true,
                });
              } else if (contentType === 'Map') {
                const numLocs = content.locations?.length || 0;
                result.push({
                  key: layerKey,
                  sceneIndex: sceneIdx,
                  sceneTitle,
                  sectionType,
                  subIndex: subIdx,
                  layerIndex: layerIdx,
                  category: 'map',
                  assetType: '3D Map Route',
                  title: `3D Map Route (${content.map_style || 'vintage'})`,
                  source: 'D3 Geo / TopoJSON',
                  filePath: '',
                  filename: 'map_route.geo',
                  mediaUrl: '',
                  duration: sv.duration,
                  fileExists: true,
                  extension: '.geo',
                  timing: subTiming,
                  extraDetails: `${numLocs} location${numLocs === 1 ? '' : 's'}`,
                  isProgrammatic: true,
                });
              }
            });
          } else {
            // Fallback for sub-visual without AST children or legacy structure
            const filePath = sv.visual_path || '';
            const filename = filePath ? filePath.split(/[/\\]/).pop() || '' : '';
            if (filename) claimedFilenames.add(filename);
            const diskInfo = filename ? diskFilesMap[filename] : undefined;
            const ext = (diskInfo?.extension || (filePath ? '.' + filePath.split('.').pop()?.toLowerCase() : '')).toLowerCase();
            const isVid = isVideoExt(ext);
            const isImg = isImageExt(ext);

            result.push({
              key: `sc-${sceneIdx}-sub-${subIdx}`,
              sceneIndex: sceneIdx,
              sceneTitle,
              sectionType,
              subIndex: subIdx,
              category: isVid ? 'video' : isImg ? 'image' : 'other',
              assetType: isVid ? 'Video' : isImg ? 'Image' : 'Visual',
              title: sv.visual_cue || filename || `Visual ${subIdx + 1}`,
              source: 'Media',
              filePath: filePath || diskInfo?.path,
              filename: filename || diskInfo?.filename,
              mediaUrl: filePath ? getMediaUrlSync(filePath) : (diskInfo?.path ? getMediaUrlSync(diskInfo.path) : ''),
              duration: sv.duration,
              fileExists: !!diskInfo || !!filePath,
              fileSize: diskInfo?.size_bytes,
              lastModified: diskInfo?.last_modified,
              extension: ext,
              timing: subTiming,
              isProgrammatic: false,
            });
          }
        });
      });
    }

    // Also include any physical assets on disk in the project assets folder not matched above
    Object.values(diskFilesMap).forEach((df) => {
      if (claimedFilenames.has(df.filename)) return;
      if (df.filename === 'assets_manifest.json') return;

      const ext = df.extension.toLowerCase();
      const isVid = isVideoExt(ext);
      const isImg = isImageExt(ext);
      const isAud = isAudioExt(ext);
      const category: AssetEntry['category'] = isVid ? 'video' : isImg ? 'image' : isAud ? 'audio' : 'other';

      // Parse asset_000_01_00.mp4 naming pattern
      const match = df.filename.match(/asset_(\d+)_(\d+)(?:_(\d+))?/);
      const sceneIdx = match ? parseInt(match[1], 10) : 0;
      const subIdx = match ? parseInt(match[2], 10) : 0;
      const layerIdx = match && match[3] !== undefined ? parseInt(match[3], 10) : undefined;
      const sceneTitle = sceneTitles[sceneIdx] || `Scene ${sceneIdx + 1}`;
      const timing = sceneTimings[sceneIdx]?.subs?.[subIdx] || sceneTimings[sceneIdx];

      result.push({
        key: `disk-${df.filename}`,
        sceneIndex: sceneIdx,
        sceneTitle,
        sectionType: 'scene',
        subIndex: subIdx,
        layerIndex: layerIdx,
        category,
        assetType: isVid ? 'Video' : isImg ? 'Image' : isAud ? 'Audio' : 'File',
        title: df.filename,
        source: 'Downloaded Asset',
        filePath: df.path,
        filename: df.filename,
        mediaUrl: getMediaUrlSync(df.path),
        fileExists: true,
        fileSize: df.size_bytes,
        lastModified: df.last_modified,
        extension: ext,
        timing,
        isProgrammatic: false,
      });
    });

    return result;
  }, [manifestData, sceneTimings, sceneTitles, diskFilesMap]);

  /** Amount of disk space consumed by assets (bytes) */
  const totalSize = useMemo(() => {
    return Object.values(diskFiles).reduce((sum, f) => sum + (f.size_bytes || 0), 0);
  }, [diskFiles]);

  /** Number of assets that have been downloaded (file exists) */
  const downloadedCount = useMemo(() => {
    return assets.filter((a) => a.fileExists && !a.isProgrammatic).length;
  }, [assets]);

  /** Number of non-programmatic assets still pending download */
  const pendingCount = useMemo(() => {
    return assets.filter((a) => !a.isProgrammatic && !a.fileExists).length;
  }, [assets]);

  /** Total non-programmatic assets */
  const totalDownloadable = useMemo(() => {
    return assets.filter((a) => !a.isProgrammatic).length;
  }, [assets]);

  /** Category breakdown counts */
  const categoryCounts = useMemo(() => {
    const counts = {
      all: assets.length,
      video: 0,
      image: 0,
      html: 0,
      map: 0,
      audio: 0,
      other: 0,
    };
    assets.forEach((a) => {
      if (a.category in counts) {
        counts[a.category as keyof typeof counts]++;
      } else {
        counts.other++;
      }
    });
    return counts;
  }, [assets]);

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
      const poll = () => {
        scanDisk();
        pollTimerRef.current = setTimeout(poll, 3000);
      };
      poll();
    } else {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }

    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [isFetchingAssets, scanDisk]);

  // Do one final scan after the step completes to catch any stragglers
  useEffect(() => {
    if (!isFetchingAssets && pendingCount > 0) {
      scanDisk();
    }
  }, [isFetchingAssets]);

  return {
    assets,
    totalSize,
    downloadedCount,
    pendingCount,
    totalDownloadable,
    categoryCounts,
    isScanning,
    refresh: scanDisk,
  } as const;
}

