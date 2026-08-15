export interface Frame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface TripMetrics {
  colorfulness: number;
  hueEntropy: number;
  saturation: number;
  edgeDensity: number;
  temporalFlux: number;
  mirrorSymmetry: number;
  multiScaleDetail: number;
}

export function colorfulness(frame: Frame): number;
export function hueEntropy(frame: Frame, bins?: number): number;
export function saturation(frame: Frame): number;
export function edgeDensity(frame: Frame): number;
export function temporalFlux(a: Frame, b: Frame): number;
export function mirrorSymmetry(frame: Frame): number;
export function halveFrame(frame: Frame): Frame;
export function multiScaleDetail(frame: Frame): number;
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number };
export function tripScore(a: Frame, b?: Frame): { score: number; metrics: TripMetrics };
export const TRIP_WEIGHTS: Readonly<Record<keyof TripMetrics, number>>;
export const TRIP_THRESHOLD: number;
export const TRIP_FLOOR: number;
