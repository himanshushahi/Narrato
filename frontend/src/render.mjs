/**
 * render.mjs — Custom Remotion render script using the programmatic API.
 * 
 * This replaces the `remotion render` CLI to enable:
 *   1. Hardware-accelerated encoding (NVENC) via `hardwareAcceleration` param
 *   2. Custom FFmpeg/FFprobe binaries via `ffmpegExecutable`/`ffprobeExecutable`
 *   3. Resumable chunked rendering via fast JPEG frames and audio extraction
 *   4. Low-latency static asset server with in-memory caching and keep-alive
 * 
 * Called from Python: node render.mjs --props <path> --output <path> [options]
 */

import http from "http";
import { renderMedia, selectComposition, renderFrames } from "@remotion/renderer";
import { readFileSync, existsSync, statSync, createReadStream } from "fs";
import { resolve, extname } from "path";
import os from "os";

// ─── MIME Types ───────────────────────────────────────────────────────────────
const MIME_MAP = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// ─── In-Memory Asset Cache ────────────────────────────────────────────────────
// Caches frequently requested small assets (< 5 MB, e.g. logos, badges, textures, subtitles)
// directly in Node.js RAM to eliminate redundant disk I/O across concurrent Chromium workers.
const memoryCache = new Map();
const MAX_ITEM_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_TOTAL_CACHE = 256 * 1024 * 1024; // 256 MB
let currentCacheSize = 0;

function getCachedBuffer(filePath, fileSize) {
  if (memoryCache.has(filePath)) {
    return memoryCache.get(filePath);
  }
  if (fileSize > MAX_ITEM_SIZE || currentCacheSize + fileSize > MAX_TOTAL_CACHE) {
    return null;
  }
  try {
    const buf = readFileSync(filePath);
    memoryCache.set(filePath, buf);
    currentCacheSize += buf.length;
    return buf;
  } catch {
    return null;
  }
}

// ─── Static Asset Server ──────────────────────────────────────────────────────
/**
 * Starts a high-throughput local static file server with Keep-Alive support
 * and RAM caching. This avoids Chrome's net::ERR_UNKNOWN_URL_SCHEME for file:///
 * while maximizing concurrency throughput.
 */
function startAssetServer() {
  return new Promise((resolveServer) => {
    const server = http.createServer((req, res) => {
      try {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const fullPath = urlObj.searchParams.get("path");

        if (!fullPath || !existsSync(fullPath)) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }

        const ext = extname(fullPath).toLowerCase();
        const contentType = MIME_MAP[ext] || 'application/octet-stream';
        const stats = statSync(fullPath);
        const fileSize = stats.size;
        const range = req.headers.range;

        // Common headers with Keep-Alive
        const baseHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Accept-Ranges': 'bytes',
          'Connection': 'keep-alive',
          'Keep-Alive': 'timeout=120, max=2000',
        };

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          let start = parseInt(parts[0], 10);
          let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          if (isNaN(start)) {
            start = Math.max(0, fileSize - end);
            end = fileSize - 1;
          }
          if (isNaN(end) || end >= fileSize) {
            end = fileSize - 1;
          }
          if (start > end || start < 0) {
            res.writeHead(416, {
              ...baseHeaders,
              'Content-Range': `bytes */${fileSize}`,
            });
            res.end();
            return;
          }

          const chunksize = (end - start) + 1;
          const file = createReadStream(fullPath, { start, end });
          
          res.writeHead(206, {
            ...baseHeaders,
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Content-Length': chunksize,
            'Content-Type': contentType,
          });
          file.on('error', () => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          req.on('close', () => file.destroy());
          file.pipe(res);
        } else {
          // Serve from memory cache if available for small static assets
          const cachedBuf = getCachedBuffer(fullPath, fileSize);
          if (cachedBuf) {
            res.writeHead(200, {
              ...baseHeaders,
              'Content-Length': cachedBuf.length,
              'Content-Type': contentType,
            });
            res.end(cachedBuf);
            return;
          }

          res.writeHead(200, {
            ...baseHeaders,
            'Content-Length': fileSize,
            'Content-Type': contentType,
          });
          const stream = createReadStream(fullPath);
          stream.on('error', () => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
          req.on('close', () => stream.destroy());
          stream.pipe(res);
        }
      } catch {
        res.statusCode = 500;
        res.end("Server Error");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}`;
      console.log(`   📡 Node.js Asset server active (Keep-Alive + Cache): ${url}`);
      resolveServer({ server, url });
    });
  });
}

// ─── CLI Argument Parsing ─────────────────────────────────────────────────────
const args = process.argv.slice(2);

const getArg = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const propsPath    = getArg("--props");
const outputPath   = getArg("--output");

if (!propsPath) {
  console.error("Usage: node render.mjs --props <path> [options]");
  process.exit(1);
}

// Parse all options with defaults
const mode             = getArg("--mode") ?? "video"; // "video" | "frames" | "audio"
const fps              = parseInt(getArg("--fps") ?? "30", 10);
const codec            = getArg("--codec") ?? "h264";
const crf              = parseInt(getArg("--crf") ?? "18", 10);
const scale            = parseFloat(getArg("--scale") ?? "1");
const ffmpegExecutable = getArg("--ffmpeg")  ? resolve(getArg("--ffmpeg"))  : undefined;
const ffprobeExecutable= getArg("--ffprobe") ? resolve(getArg("--ffprobe")) : undefined;
const hwAccelValue     = getArg("--hw-accel") ?? "disable";
const glMode           = getArg("--gl") ?? undefined;
const framesArg        = getArg("--frames");
const resumeFromArg    = getArg("--resume-from");
const framesDir        = getArg("--frames-dir");
const concurrencyArg   = getArg("--concurrency");
const bundleDir        = getArg("--bundle-dir");
const timeoutArg       = getArg("--timeout");

if (!bundleDir) {
  console.error("Missing required argument: --bundle-dir");
  process.exit(1);
}

// Concurrency: use explicit value or CPUs - 1
const cpuCount = os.cpus().length;
let concurrencyValue;
if (concurrencyArg) {
  if (concurrencyArg.endsWith("%")) {
    concurrencyValue = Math.max(1, Math.round(cpuCount * parseInt(concurrencyArg, 10) / 100));
  } else {
    concurrencyValue = Math.max(1, parseInt(concurrencyArg, 10));
  }
} else {
  concurrencyValue = Math.max(1, cpuCount - 1);
}

// ─── Main Render ──────────────────────────────────────────────────────────────
async function main() {
  const inputPropsRaw = JSON.parse(readFileSync(resolve(propsPath), "utf-8"));

  // ── Start Asset Server ──────────────────────────────────────────────────────
  const { server: assetServer, url: assetServerUrl } = await startAssetServer();

  function rewriteUrls(obj) {
    if (typeof obj === "string" && obj.startsWith("file:///")) {
      const actualPath = obj.replace("file:///", "");
      return `${assetServerUrl}/?path=${encodeURIComponent(actualPath)}`;
    } else if (Array.isArray(obj)) {
      return obj.map(rewriteUrls);
    } else if (obj !== null && typeof obj === "object") {
      const newObj = {};
      for (const [k, v] of Object.entries(obj)) {
        newObj[k] = rewriteUrls(v);
      }
      return newObj;
    }
    return obj;
  }
  
  const inputProps = rewriteUrls(inputPropsRaw);
  
  // Inject the dynamically bound static file server port into props so the 
  // frontend `getMediaUrlSync` utility knows where to request local files from 
  // during headless Remotion rendering instead of falling back to the Vite dev server.
  inputProps.__file_server_port__ = assetServer.address().port;
  // Headless export: full-quality motion blur (3 samples) + higher glass cap.
  // Preview Player sends qualityMode='preview' for cheap interactive scrubbing.
  if (!inputProps.qualityMode) inputProps.qualityMode = 'export';

  const bundleLocation = resolve(bundleDir);
  console.log(`Using pre-bundled project at: ${bundleLocation}`);

  // ── Select Composition ──────────────────────────────────────────────────────
  const scenes = inputProps.scenes || [];
  const totalDuration = scenes.reduce((sum, sc) => sum + (sc.duration || 0), 0);
  const durationInFrames = Math.max(fps * 5, Math.ceil(totalDuration * fps));

  console.log(`Selecting composition (${totalDuration.toFixed(1)}s @ ${fps}fps = ${durationInFrames} frames)...`);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "NitishRajputVideo",
    inputProps,
  });

  composition.durationInFrames = durationInFrames;
  composition.fps = fps;

  // Parse frame ranges
  let frameRanges = [];
  if (resumeFromArg) {
    frameRanges.push([parseInt(resumeFromArg, 10), durationInFrames - 1]);
  } else if (framesArg) {
    const segments = framesArg.split(",");
    for (const seg of segments) {
      const parts = seg.split("-");
      if (parts.length === 2) {
        frameRanges.push([parseInt(parts[0], 10), parseInt(parts[1], 10)]);
      }
    }
  }

  // ── Build Common Render Options ──────────────────────────────────────────────
  const timeoutMs = timeoutArg ? parseInt(timeoutArg, 10) : 300_000;
  const commonOptions = {
    composition,
    serveUrl: bundleLocation,
    inputProps,
    scale,
    concurrency: concurrencyValue,
    timeoutInMilliseconds: timeoutMs,
    chromiumOptions: {
      disableWebSecurity: true,
      args: [
        "--disable-dev-shm-usage",
        "--allow-file-access-from-files",
        "--enable-accelerated-2d-canvas",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-breakpad",
        "--disable-component-update",
        "--no-default-browser-check",
        "--force-color-profile=srgb",
        "--font-render-hinting=medium",
        "--disable-font-subpixel-positioning",
        "--disable-skia-runtime-opts",
      ],
      forceDeviceScaleFactor: 1,
    },
  };

  if (ffmpegExecutable) commonOptions.ffmpegExecutable = ffmpegExecutable;
  if (ffprobeExecutable) commonOptions.ffprobeExecutable = ffprobeExecutable;
  if (glMode) commonOptions.gl = glMode;
  // Frame range will be set per renderFrames call

  // ── Render ──────────────────────────────────────────────────────────────────
  console.log(`Rendering in ${mode} mode...`);
  const t1 = Date.now();
  
  try {
    if (mode === "frames") {
      if (!framesDir) throw new Error("--frames-dir is required for frames mode");
      
      const ranges = frameRanges.length > 0 ? frameRanges : [[0, durationInFrames - 1]];
      let totalToRender = 0;
      for (const r of ranges) totalToRender += (r[1] - r[0] + 1);
      
      let overallRendered = 0;
      
      for (const range of ranges) {
        await renderFrames({
          ...commonOptions,
          frameRange: range,
          outputDir: resolve(framesDir),
          imageFormat: "jpeg",
          jpegQuality: 95,
          onFrameUpdate: (renderedCount) => {
            const pct = (((overallRendered + renderedCount) / totalToRender) * 100).toFixed(1);
            process.stdout.write(`\rRender progress: ${pct}%  `);
          },
        });
        overallRendered += (range[1] - range[0] + 1);
      }
      console.log(`\nFrames rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${framesDir}`);
    } 
    else if (mode === "audio") {
      if (!outputPath) throw new Error("--output is required for audio mode");
      
      await renderMedia({
        ...commonOptions,
        outputLocation: resolve(outputPath),
        codec: outputPath.endsWith(".mp3") ? "mp3" : "wav",
        onProgress: ({ progress }) => {
          const pct = (progress * 100).toFixed(1);
          process.stdout.write(`\rRender progress: ${pct}%  `);
        },
      });
      console.log(`\nAudio rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${outputPath}`);
    } 
    else {
      // "video" mode fallback
      if (!outputPath) throw new Error("--output is required for video mode");
      
      await renderMedia({
        ...commonOptions,
        outputLocation: resolve(outputPath),
        codec,
        crf,
        hardwareAcceleration: hwAccelValue,
        imageFormat: "jpeg",
        jpegQuality: 95,
        onProgress: ({ progress }) => {
          const pct = (progress * 100).toFixed(1);
          process.stdout.write(`\rRender progress: ${pct}%  `);
        },
      });
      console.log(`\nVideo rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${outputPath}`);
    }
  } finally {
    assetServer.close();
  }
}

main()
  .then(() => {
    // Force-exit even if a child (headless Chromium, ffmpeg worker) keeps the
    // event loop alive — otherwise the process never exits and the parent
    // pipeline hangs waiting for this process's stdout pipe to close.
    process.stdout.write("\rRender progress: 100.0%  \n", () => {
      process.exit(0);
    });
  })
  .catch((err) => {
    process.stderr.write(`\nRender failed: ${err.stack || err.message || err}\n`, () => {
      process.exit(1);
    });
  });
