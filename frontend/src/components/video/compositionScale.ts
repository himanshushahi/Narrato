/**
 * Canvas resolution scaling helpers.
 *
 * The Player is configured at full resolution (1920x1080 / 1080x1920) so
 * visuals are authored in "logical" pixels. Fast preview mode halves the
 * Player's composition size (960x540 / 540x960), which cuts GPU rasterization
 * load ~75% while every visual lays out identically: the composition root
 * scales its logical 1080p content down to the smaller canvas.
 */
export const getCanvasScaleFactor = (width: number, height: number): number =>
  Math.min(width, height) / 1080;

export const getLogicalCanvasSize = (
  width: number,
  height: number
): { width: number; height: number } => {
  const factor = getCanvasScaleFactor(width, height);
  return { width: width / factor, height: height / factor };
};
