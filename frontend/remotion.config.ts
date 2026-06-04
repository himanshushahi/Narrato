import { Config } from '@remotion/cli/config';

Config.overrideFfmpegCommand(({ args }) => {
  // If the Python backend set REMOTION_CUDA_ENABLED, we attempt to use NVENC
  if (process.env.REMOTION_CUDA_ENABLED === '1') {
    const codecIndex = args.indexOf('-c:v');
    
    if (codecIndex !== -1) {
      const currentCodec = args[codecIndex + 1];
      
      // Swap out the software encoder for the Nvidia hardware encoder
      if (currentCodec === 'libx264') {
        args[codecIndex + 1] = 'h264_nvenc';
      } else if (currentCodec === 'libx265') {
        args[codecIndex + 1] = 'hevc_nvenc';
      }
    }
  }

  return args;
});
