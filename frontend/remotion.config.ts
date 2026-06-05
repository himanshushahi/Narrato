import { Config } from '@remotion/cli/config';

Config.overrideFfmpegCommand(({ args }) => {
  // NOTE: NVENC hardware encoding is NOT supported by Remotion's bundled FFmpeg
  // (which only has libx264/libx265 enabled). The --ffmpeg-executable flag is
  // also deprecated in Remotion v4 (replaced by --binaries-directory).
  // GPU acceleration via --gl=angle speeds up frame rendering in the browser,
  // but video encoding will use the software libx264/libx265 encoder.
  return args;
});
