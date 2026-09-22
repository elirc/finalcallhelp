/**
 * Coach-window placement math. Pure (no Electron imports) so it is unit-testable.
 *
 * "Eye line" placement puts the window horizontally centred at the very top
 * of the display's work area: on a laptop or a monitor with a top-mounted
 * webcam, that is the spot closest to the camera, so reading the response
 * keeps the user's gaze near the lens instead of dropping to a corner.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Wide and short: enough for a spoken answer, low enough not to cover the call. */
export const EYE_LINE_SIZE = { width: 760, height: 420 } as const;

export const COACH_MIN_SIZE = { width: 440, height: 300 } as const;

/** Bounds centred at the top of `workArea`, shrunk to fit if the display is small. */
export function eyeLinePlacement(
  workArea: Rect,
  size: { width: number; height: number } = EYE_LINE_SIZE,
): Rect {
  const width = Math.max(COACH_MIN_SIZE.width, Math.min(size.width, workArea.width));
  const height = Math.max(COACH_MIN_SIZE.height, Math.min(size.height, workArea.height));
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y,
    width: Math.min(width, workArea.width),
    height: Math.min(height, workArea.height),
  };
}

/**
 * True when at least half of `bounds` lies inside one of `displays`. Saved
 * bounds from an unplugged monitor fail this and are replaced, so the window
 * never comes back off-screen.
 */
export function isMostlyVisible(bounds: Rect, displays: readonly Rect[]): boolean {
  const area = bounds.width * bounds.height;
  if (area <= 0) return false;
  return displays.some((d) => {
    const w = Math.min(bounds.x + bounds.width, d.x + d.width) - Math.max(bounds.x, d.x);
    const h = Math.min(bounds.y + bounds.height, d.y + d.height) - Math.max(bounds.y, d.y);
    return w > 0 && h > 0 && (w * h) / area >= 0.5;
  });
}

/** Validate a persisted rect; anything malformed yields null. */
export function sanitizeRect(raw: unknown): Rect | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nums = [r.x, r.y, r.width, r.height];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const rect = { x: r.x, y: r.y, width: r.width, height: r.height } as Rect;
  if (rect.width < COACH_MIN_SIZE.width || rect.height < COACH_MIN_SIZE.height) return null;
  return rect;
}
