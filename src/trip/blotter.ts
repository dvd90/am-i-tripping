/**
 * BLOTTER SHEET GEOMETRY
 * ----------------------
 * The experience opens as a sheet of perforated tabs — the classic blotter
 * grid — and each tab dissolves on its own schedule as the dose comes up.
 * All of that is grid maths, so it lives here, pure and tested.
 *
 * UV convention: (0,0) top-left, (1,1) bottom-right. Tabs are numbered
 * row-major from the top-left, exactly how you'd tear them off a sheet.
 */

import { clamp, fract, hash21, smoothstep } from '../util/mathx';

export interface SheetSpec {
  cols: number;
  rows: number;
}

export const DEFAULT_SHEET: SheetSpec = { cols: 6, rows: 6 };

function assertSheet({ cols, rows }: SheetSpec): void {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    throw new RangeError('sheet must have positive integer cols/rows');
  }
}

/** Total tabs on the sheet. */
export const tabCount = (sheet: SheetSpec = DEFAULT_SHEET): number => {
  assertSheet(sheet);
  return sheet.cols * sheet.rows;
};

/** Row-major index of the tab containing (u,v). Out-of-range UVs clamp to the sheet. */
export function tabIndex(u: number, v: number, sheet: SheetSpec = DEFAULT_SHEET): number {
  assertSheet(sheet);
  const col = Math.min(sheet.cols - 1, Math.max(0, Math.floor(clamp(u) * sheet.cols)));
  const row = Math.min(sheet.rows - 1, Math.max(0, Math.floor(clamp(v) * sheet.rows)));
  return row * sheet.cols + col;
}

/** Centre UV of a tab. Round-trips through `tabIndex`. */
export function tabCenter(index: number, sheet: SheetSpec = DEFAULT_SHEET): { u: number; v: number } {
  assertSheet(sheet);
  const total = sheet.cols * sheet.rows;
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new RangeError(`tab index ${index} out of range 0..${total - 1}`);
  }
  const col = index % sheet.cols;
  const row = Math.floor(index / sheet.cols);
  return { u: (col + 0.5) / sheet.cols, v: (row + 0.5) / sheet.rows };
}

/** Position within the containing tab, always in [0,1). */
export function tabLocal(u: number, v: number, sheet: SheetSpec = DEFAULT_SHEET): { u: number; v: number } {
  assertSheet(sheet);
  return { u: fract(clamp(u, 0, 0.999999) * sheet.cols), v: fract(clamp(v, 0, 0.999999) * sheet.rows) };
}

/**
 * Perforation mask: 1 on the little punched holes that run along every tab
 * seam, 0 in the body of a tab. `pitch` is holes per tab edge.
 */
export function perforationMask(
  u: number,
  v: number,
  sheet: SheetSpec = DEFAULT_SHEET,
  dotRadius = 0.06,
  pitch = 8,
): number {
  assertSheet(sheet);
  const local = tabLocal(u, v, sheet);
  // Distance to the nearest tab seam, in tab-local units.
  const du = Math.min(local.u, 1 - local.u);
  const dv = Math.min(local.v, 1 - local.v);
  const onVerticalSeam = du <= dv;
  const along = onVerticalSeam ? local.v : local.u;
  const across = onVerticalSeam ? du : dv;
  // Punch holes at regular intervals along the seam.
  const holePhase = Math.abs(fract(along * pitch) - 0.5) * 2; // 0 at hole centre
  const dist = Math.hypot(across / dotRadius, (holePhase * 0.5) / dotRadius);
  return 1 - smoothstep(0.7, 1.15, dist);
}

/**
 * Per-tab dissolve threshold in 0..1. Tabs melt away in a scattered order as
 * intensity rises, so the sheet doesn't vanish as one flat wipe.
 */
export function dissolveThreshold(index: number, sheet: SheetSpec = DEFAULT_SHEET, seed = 1): number {
  const { u, v } = tabCenter(index, sheet);
  const noise = hash21(u * 37.7 + seed * 5.3, v * 17.3 + seed * 2.1);
  // Bias slightly toward the centre going first — it tears from the middle out.
  const radial = Math.hypot(u - 0.5, v - 0.5) / Math.SQRT1_2;
  return clamp(noise * 0.65 + radial * 0.35);
}

/** Whether a tab sits on the outer border of the sheet. */
export function isEdgeTab(index: number, sheet: SheetSpec = DEFAULT_SHEET): boolean {
  assertSheet(sheet);
  const total = sheet.cols * sheet.rows;
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new RangeError(`tab index ${index} out of range 0..${total - 1}`);
  }
  const col = index % sheet.cols;
  const row = Math.floor(index / sheet.cols);
  return col === 0 || row === 0 || col === sheet.cols - 1 || row === sheet.rows - 1;
}
