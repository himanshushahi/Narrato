/**
 * render.mjs — Custom Remotion render script using the programmatic API.
 * 
 * This replaces the `remotion render` CLI to enable:
 *   1. Hardware-accelerated encoding (NVENC) via `hardwareAcceleration` param
 *   2. Custom FFmpeg/FFprobe binaries via `ffmpegExecutable`/`ffprobeExecutable`
 *   3. Resumable chunked rendering via frames and audio extraction
 * 
 * Called from Python: node render.mjs --props <path> --output <path> [options]
 */

import http from "http";
import { renderMedia, selectComposition, renderFrames } from "@remotion/renderer";
import { readFileSync, existsSync, statSync, createReadStream } from "fs";
import { resolve } from "path";
import os from "os";

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Starts a minimal static file server to serve absolute file paths.
 * This avoids Chrome's net::ERR_UNKNOWN_URL_SCHEME for file:/// media.
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

        const stats = statSync(fullPath);
        const fileSize = stats.size;
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = createReadStream(fullPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': fullPath.endsWith('.mp4') ? 'video/mp4' : 
                            fullPath.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
            'Connection': 'close'
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize,
            'Content-Type': fullPath.endsWith('.mp4') ? 'video/mp4' : 
                            fullPath.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
            'Connection': 'close'
          };
          res.writeHead(200, head);
          createReadStream(fullPath).pipe(res);
        }
      } catch (e) {
        res.statusCode = 500;
        res.end("Server Error");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}`;
      console.log(`   📡 Node.js Asset server active: ${url}`);
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
    concurrencyValue = Math.max(2, Math.floor(cpuCount * parseInt(concurrencyArg) / 100));
  } else {
    concurrencyValue = parseInt(concurrencyArg, 10);
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
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
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
          imageFormat: "webp",
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
        imageFormat: "webp",
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
    //
    // process.exit() terminates without flushing pending async pipe writes on
    // Windows, which could drop the final progress line and stall the UI
    // below 100%. Write the completion line through the async stdout queue
    // and exit only after it has been flushed.
    process.stdout.write("\rRender progress: 100.0%  \n", () => {
      process.exit(0);
    });
  })
  .catch((err) => {
    // Same flush concern on the error path — the parent reads this text to
    // build failure diagnostics.
    process.stderr.write(`\nRender failed: ${err.message || err}\n`, () => {
      process.exit(1);
    });
  });
