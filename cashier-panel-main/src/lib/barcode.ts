/**
 * Code 128 barcode renderer — powered by JsBarcode.
 *
 * We use the industry-standard `jsbarcode` library rather than a
 * hand-rolled encoder so the symbology is guaranteed correct and
 * decodable by any commodity 1D scanner.
 *
 * KEY SIZING RULES FOR THERMAL PRINTERS
 * -------------------------------------
 * 1. Render to a canvas → export PNG. PNG bitmaps print with crisp,
 *    integer-pixel bars (no SVG / GDI anti-aliasing).
 *
 * 2. The barcode MUST physically fit inside the paper's printable width
 *    INCLUDING quiet zones. If it's wider, the printer driver scales it
 *    down to fit, and that downscale drops/merges bars → unscannable.
 *    We therefore use a narrow module (2 px) which keeps a 12-char id
 *    under ~50 mm — comfortably inside both 58 mm and 80 mm printers.
 *
 * 3. The <img> is sized so 1 source pixel maps to 1 printer dot at the
 *    203-DPI receipt-printer standard (8 dots/mm): widthMm = widthPx / 8.
 *    → at 203 DPI: exact 1:1, no resampling.
 *    → at 300 DPI: clean up-scale (safe direction, bars never dropped).
 */

import JsBarcode from 'jsbarcode';

/** Thermal printer dot pitch. 203 DPI ≈ 8 dots/mm (receipt standard). */
const DOTS_PER_MM = 8;

export interface BarcodeOptions {
  /** Pixels per narrow module. Default `3` (≈0.375 mm at 203 DPI). */
  moduleWidth?: number;
  /** Bar height in canvas pixels. Default `90`. */
  barHeight?: number;
  /** Quiet-zone width in pixels on each side. Default `20`. */
  margin?: number;
}

/**
 * Max on-paper width (mm). Keeps the symbol inside the printable area of
 * an 80 mm thermal head (≈72 mm) with margin. Downscaling to this size is
 * safe because we use SMOOTH rendering (never `pixelated`), which blurs
 * slightly but never drops bars.
 */
const MAX_WIDTH_MM = 62;

export interface BarcodeResult {
  /** base64 PNG data URL, or '' if it could not be generated. */
  dataUrl: string;
  /** Intrinsic bitmap width in pixels. */
  widthPx: number;
  /** Intrinsic bitmap height in pixels. */
  heightPx: number;
  /** Recommended on-paper width (mm) for the <img>'s CSS width. */
  widthMm: number;
}

const EMPTY: BarcodeResult = { dataUrl: '', widthPx: 0, heightPx: 0, widthMm: 0 };

/**
 * Render a Code 128 barcode to a PNG bitmap using JsBarcode + canvas.
 * Browser-only (needs `document`). Returns EMPTY on any failure so
 * callers never need try/catch.
 */
export function renderBarcode(
  rawValue: string,
  opts: BarcodeOptions = {},
): BarcodeResult {
  if (!rawValue || typeof document === 'undefined') return EMPTY;

  const moduleWidth = opts.moduleWidth ?? 3;
  const barHeight = opts.barHeight ?? 90;
  const margin = opts.margin ?? 20;

  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, rawValue, {
      format: 'CODE128',
      width: moduleWidth,
      height: barHeight,
      displayValue: true,
      font: 'monospace',
      fontOptions: 'bold',
      fontSize: 18,
      textMargin: 2,
      margin,
      background: '#ffffff',
      lineColor: '#000000',
    });

    const widthPx = canvas.width;
    const heightPx = canvas.height;
    if (!widthPx || !heightPx) return EMPTY;

    return {
      dataUrl: canvas.toDataURL('image/png'),
      widthPx,
      heightPx,
      // 1:1 at 203 DPI would be widthPx/8, but cap so the symbol always
      // fits inside the printable width. Smooth scaling keeps every bar.
      widthMm: Math.min(widthPx / DOTS_PER_MM, MAX_WIDTH_MM),
    };
  } catch {
    return EMPTY;
  }
}

/** Convenience wrapper returning only the PNG data URL. */
export function renderBarcodeDataUrl(
  rawValue: string,
  opts: BarcodeOptions = {},
): string {
  return renderBarcode(rawValue, opts).dataUrl;
}

/**
 * Self-contained `<img>` tag with the barcode embedded as a base64 PNG.
 * Safe to drop into a standalone print-popup document. The CSS width is
 * the computed `widthMm` so the bitmap prints 1:1 at 203 DPI.
 */
export function renderBarcodeImgTag(rawValue: string): string {
  const bc = renderBarcode(rawValue);
  if (!bc.dataUrl) return '';
  const esc = rawValue.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  // NOTE: deliberately NO `image-rendering:pixelated`. Pixelated drops
  // whole bar columns when the bitmap is downscaled (screen preview,
  // fit-to-page prints) → unscannable. Default smooth rendering blurs
  // edges slightly but preserves every bar, which scanners read fine.
  return (
    `<img src="${bc.dataUrl}" alt="${esc}" decoding="sync" loading="eager" ` +
    `style="display:block;margin:4px auto 0;width:${bc.widthMm.toFixed(1)}mm;height:auto;` +
    `-webkit-print-color-adjust:exact;print-color-adjust:exact;"/>`
  );
}
