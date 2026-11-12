/*
 * Where a wedding car's picture stands on the website's stage (/wedding-cars). The SAME maths is in the
 * website (src/components/WeddingShowcase.jsx + .wed-car__place in global.css), so keep them in step.
 *
 * Unit: the podium's width on the stage picture (60% of the picture's width) = 1.
 *   x, y    the bottom-middle of the (cropped) picture, from the middle of the podium's top; y down
 *   scale   the cropped picture's width, in podium widths
 *   rotate  degrees, round the bottom-middle
 *   crop    how much is cut off each side, as fractions of the full picture
 *   aspect  the full picture's width ÷ height (saved, so the website knows the shape before it loads)
 */
export interface WeddingStage {
  x: number; y: number; scale: number; rotate: number; flip: boolean;
  crop: { t: number; r: number; b: number; l: number };
  aspect: number;
}

export const STAGE_IMG = '/wedding-stage.jpg';
export const STAGE_W = 1672;
export const STAGE_H = 941;
export const PODIUM = { x: 0.5, y: 0.815, width: 0.6 };

/** How the website places a car that has no placement yet (as wide as the podium, at most .72 of that tall). */
export function defaultStage(aspect: number): WeddingStage {
  return { x: 0, y: 0, scale: Math.min(1, 0.72 * aspect), rotate: 0, flip: false, crop: { t: 0, r: 0, b: 0, l: 0 }, aspect };
}

/** The cropped picture's width ÷ height. */
export const croppedAspect = (s: WeddingStage) =>
  (s.aspect * (1 - s.crop.l - s.crop.r)) / Math.max(0.01, 1 - s.crop.t - s.crop.b);

/** Parse what the database holds; anything odd → null (= place it automatically). */
export function readStage(v: unknown): WeddingStage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const n = (k: unknown, d: number) => (typeof k === 'number' && Number.isFinite(k) ? k : d);
  const c = (o.crop ?? {}) as Record<string, unknown>;
  const aspect = n(o.aspect, 0);
  if (aspect <= 0) return null;
  return {
    x: n(o.x, 0), y: n(o.y, 0), scale: n(o.scale, 1), rotate: n(o.rotate, 0), flip: o.flip === true,
    crop: { t: n(c.t, 0), r: n(c.r, 0), b: n(c.b, 0), l: n(c.l, 0) }, aspect,
  };
}
