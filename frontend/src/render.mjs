/**
 * render.mjs — Custom Remotion render script using the programmatic API.
 * 
 * This replaces the `remotion render` CLI to enable:
 *   1. Hardware-accelerated encoding (NVENC) via `hardwareAcceleration` param
 *   2. Custom FFmpeg/FFprobe binaries via `ffmpegExecutable`/`ffprobeExecutable`
 *   3. Webpack cache persistence for faster subsequent renders
 * 
 * Called from Python: node render.mjs --props <path> --output <path> [options]
 */

import http from "http";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readFileSync, existsSync, rmSync, mkdirSync, statSync, createReadStream } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(__dirname, "..");

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
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          const head = {
            'Content-Length': fileSize,
            'Content-Type': fullPath.endsWith('.mp4') ? 'video/mp4' : 
                            fullPath.endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream',
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

if (!propsPath || !outputPath) {
  console.error(
    "Usage: node render.mjs --props <path> --output <path> [options]\n" +
    "Options:\n" +
    "  --fps <value>          Frames per second (default: 30)\n" +
    "  --codec <name>         Video codec: h264, h265, vp8, vp9 (default: h264)\n" +
    "  --crf <value>          Constant rate factor (default: 18)\n" +
    "  --scale <value>        Output scale multiplier (default: 1)\n" +
    "  --concurrency <n>      Parallel render workers (default: 75% of CPUs)\n" +
    "  --ffmpeg <path>        Path to ffmpeg binary\n" +
    "  --ffprobe <path>       Path to ffprobe binary\n" +
    "  --hw-accel <mode>      Hardware acceleration: disable | if-possible | required (default: disable)\n" +
    "  --gl <mode>            Chromium GL mode: angle, egl, swiftshader, etc.\n" +
    "  --frames <range>       Frame range: start-end (e.g., 0-4639)"
  );
  process.exit(1);
}

// Parse all options with defaults
const fps              = parseInt(getArg("--fps") ?? "30", 10);
const codec            = getArg("--codec") ?? "h264";
const crf              = parseInt(getArg("--crf") ?? "18", 10);
const scale            = parseFloat(getArg("--scale") ?? "1");
const ffmpegExecutable = getArg("--ffmpeg")  ? resolve(getArg("--ffmpeg"))  : undefined;
const ffprobeExecutable= getArg("--ffprobe") ? resolve(getArg("--ffprobe")) : undefined;
const hwAccelValue     = getArg("--hw-accel") ?? "disable";
const glMode           = getArg("--gl") ?? undefined;
const framesArg        = getArg("--frames");
const concurrencyArg   = getArg("--concurrency");

// Concurrency: use explicit value or 75% of CPUs (floor at 2)
const cpuCount = os.cpus().length;
let concurrencyValue;
if (concurrencyArg) {
  if (concurrencyArg.endsWith("%")) {
    concurrencyValue = Math.max(2, Math.floor(cpuCount * parseInt(concurrencyArg) / 100));
  } else {
    concurrencyValue = parseInt(concurrencyArg, 10);
  }
} else {
  concurrencyValue = Math.max(2, Math.floor(cpuCount * 0.75));
}

// Parse frame range
let frameRange = null;
if (framesArg) {
  const parts = framesArg.split("-");
  if (parts.length === 2) {
    frameRange = [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }
}

// ─── Temp & Cache Directories ─────────────────────────────────────────────────
// Persistent webpack cache survives across renders (biggest speed win)
const persistentCacheDir = resolve(frontendRoot, "..", ".cache", "remotion-webpack");
// Bundle output gets wiped each render
const bundleOutputDir = resolve(frontendRoot, "..", ".cache", "remotion-bundle");

try {
  if (existsSync(bundleOutputDir)) {
    rmSync(bundleOutputDir, { recursive: true, force: true });
  }
} catch (_) {}
mkdirSync(persistentCacheDir, { recursive: true });

// ─── Logging ──────────────────────────────────────────────────────────────────
console.log(`   ⚙️  Codec:        ${codec} (CRF ${crf})`);
console.log(`   ⚙️  Resolution:   scale=${scale}`);
console.log(`   ⚙️  FPS:          ${fps}`);
console.log(`   ⚙️  Concurrency:  ${concurrencyValue} / ${cpuCount} CPUs`);
console.log(`   ⚙️  HW accel:     ${hwAccelValue}`);
if (ffmpegExecutable)  console.log(`   ⚙️  FFmpeg:       ${ffmpegExecutable}`);
if (ffprobeExecutable) console.log(`   ⚙️  FFprobe:      ${ffprobeExecutable}`);
if (glMode)            console.log(`   ⚙️  GL mode:      ${glMode}`);
if (frameRange)        console.log(`   ⚙️  Frames:       ${frameRange[0]}-${frameRange[1]}`);

// ─── Main Render ──────────────────────────────────────────────────────────────
async function main() {
  const inputPropsRaw = JSON.parse(readFileSync(resolve(propsPath), "utf-8"));

  // ── Start Asset Server ──────────────────────────────────────────────────────
  const { server: assetServer, url: assetServerUrl } = await startAssetServer();

  // Rewrite file:/// URLs to point to our highly-concurrent Node.js server
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

  // ── Bundle ──────────────────────────────────────────────────────────────────
  console.log("Bundling Remotion project...");
  const t0 = Date.now();

  const bundleLocation = await bundle({
    entryPoint: resolve(frontendRoot, "src", "components", "video", "root.ts"),
    enableCaching: true,
    cacheLocation: persistentCacheDir,
    outDir: bundleOutputDir,
  });

  console.log(`Bundle ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

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

  // Override composition dimensions/timing from our settings
  composition.durationInFrames = durationInFrames;
  composition.fps = fps;
  // Scale is handled by the scale parameter in renderMedia, not by changing dimensions

  // ── Build Render Options ────────────────────────────────────────────────────
  const renderOptions = {
    composition,
    serveUrl: bundleLocation,
    codec,
    outputLocation: resolve(outputPath),
    inputProps,
    crf,
    scale,
    imageFormat: "jpeg",
    jpegQuality: 80,
    concurrency: concurrencyValue,
    hardwareAcceleration: hwAccelValue,
    offthreadVideoCacheSizeInBytes: 1 * 1024 * 1024 * 1024, // 1 GB cache
    timeoutInMilliseconds: 300_000, // 5 min per frame timeout
    chromiumOptions: {
      disableWebSecurity: true,
      args: [
        "--disable-dev-shm-usage", // Prevents memory crashes
        "--allow-file-access-from-files", // Allows direct local file loading
        "--enable-accelerated-2d-canvas", // Enable GPU-accelerated 2D canvas
        "--enable-gpu-rasterization", // Enable GPU rasterization
        "--enable-zero-copy", // Enable zero-copy rasterizer
        "--force-color-profile=srgb", // Ensure consistent color
        "--font-render-hinting=medium", // Reduce font hinting artifacts
        "--disable-font-subpixel-positioning", // Fix font subpixel flickering
        "--disable-skia-runtime-opts", // Disable SIMD that can cause flickering
      ],
      forceDeviceScaleFactor: 1, // Prevent DPI-based scaling artifacts
    },
    onProgress: ({ progress }) => {
      const pct = (progress * 100).toFixed(1);
      // Write progress in a format Python can parse
      process.stdout.write(`\rRender progress: ${pct}%  `);
    },
  };

  // Add FFmpeg executables if provided
  if (ffmpegExecutable) {
    renderOptions.ffmpegExecutable = ffmpegExecutable;
  }
  if (ffprobeExecutable) {
    renderOptions.ffprobeExecutable = ffprobeExecutable;
  }

  // Add frame range if specified
  if (frameRange) {
    renderOptions.frameRange = frameRange;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  console.log("Rendering video...");
  const t1 = Date.now();
  
  try {
    await renderMedia(renderOptions);
    console.log(`\nVideo rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s: ${outputPath}`);
  } finally {
    // ── Cleanup ─────────────────────────────────────────────────────────────────
    assetServer.close();
    
    // Delay bundle cleanup to avoid file lock issues
    setTimeout(() => {
      try {
        if (existsSync(bundleOutputDir)) {
          rmSync(bundleOutputDir, { recursive: true, force: true });
        }
      } catch (_) {}
    }, 2000);
  }
}

main().catch((err) => {
  console.error("Render failed:", err.message || err);
  process.exit(1);
});
