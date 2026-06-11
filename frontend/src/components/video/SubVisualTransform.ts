export interface SubVisualTransform {
  /** Base zoom/scale for the visual (0.1 – 5.0, default 1.0 = no zoom) */
  zoom: number;
  /** Horizontal offset in pixels (-500 to +500, default 0) */
  offsetX: number;
  /** Vertical offset in pixels (-500 to +500, default 0) */
  offsetY: number;
}

export const DEFAULT_TRANSFORM: SubVisualTransform = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};
