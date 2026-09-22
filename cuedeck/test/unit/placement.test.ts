import { describe, expect, it } from 'vitest';
import {
  COACH_MIN_SIZE,
  EYE_LINE_SIZE,
  eyeLinePlacement,
  isMostlyVisible,
  sanitizeRect,
} from '../../src/main/windows/placement';

const FULL_HD = { x: 0, y: 0, width: 1920, height: 1040 }; // work area minus taskbar

describe('eyeLinePlacement', () => {
  it('centres the window horizontally at the very top of the work area', () => {
    const rect = eyeLinePlacement(FULL_HD);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(EYE_LINE_SIZE.width);
    expect(rect.height).toBe(EYE_LINE_SIZE.height);
    expect(rect.x + rect.width / 2).toBe(FULL_HD.width / 2);
  });

  it('respects a work area that does not start at the origin (secondary display)', () => {
    const second = { x: 1920, y: 200, width: 1280, height: 720 };
    const rect = eyeLinePlacement(second);
    expect(rect.y).toBe(200);
    expect(rect.x).toBe(1920 + (1280 - EYE_LINE_SIZE.width) / 2);
  });

  it('shrinks to fit a small display but never below the minimum size', () => {
    const tiny = { x: 0, y: 0, width: 600, height: 380 };
    const rect = eyeLinePlacement(tiny);
    expect(rect.width).toBeLessThanOrEqual(tiny.width);
    expect(rect.height).toBeLessThanOrEqual(tiny.height);
    expect(rect.width).toBeGreaterThanOrEqual(Math.min(COACH_MIN_SIZE.width, tiny.width));
    expect(rect.x).toBeGreaterThanOrEqual(0);
  });
});

describe('isMostlyVisible', () => {
  it('accepts bounds fully inside a display', () => {
    expect(isMostlyVisible({ x: 100, y: 100, width: 500, height: 400 }, [FULL_HD])).toBe(true);
  });

  it('rejects bounds left behind on an unplugged monitor', () => {
    expect(isMostlyVisible({ x: 2500, y: 0, width: 500, height: 400 }, [FULL_HD])).toBe(false);
  });

  it('accepts a window that is half on-screen and rejects one that is mostly off', () => {
    expect(isMostlyVisible({ x: 1670, y: 0, width: 500, height: 400 }, [FULL_HD])).toBe(true);
    expect(isMostlyVisible({ x: 1800, y: 0, width: 500, height: 400 }, [FULL_HD])).toBe(false);
  });

  it('rejects degenerate rectangles', () => {
    expect(isMostlyVisible({ x: 0, y: 0, width: 0, height: 0 }, [FULL_HD])).toBe(false);
  });
});

describe('sanitizeRect', () => {
  it('round-trips a valid rect', () => {
    const rect = { x: 10, y: 20, width: 800, height: 500 };
    expect(sanitizeRect(rect)).toEqual(rect);
  });

  it('rejects malformed, non-numeric, or too-small input', () => {
    expect(sanitizeRect(null)).toBeNull();
    expect(sanitizeRect('nope')).toBeNull();
    expect(sanitizeRect({ x: '1', y: 2, width: 800, height: 500 })).toBeNull();
    expect(sanitizeRect({ x: 1, y: 2, width: 10, height: 500 })).toBeNull();
    expect(sanitizeRect({ x: NaN, y: 2, width: 800, height: 500 })).toBeNull();
  });
});
