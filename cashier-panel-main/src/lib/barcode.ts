/**
 * Code 128 barcode renderer (subset B — printable ASCII 32-127).
 *
 * Self-contained, zero-dependency. Returns an HTML fragment (an inline
 * SVG for the bars + a `<div>` text label below) so it can be:
 *   - dropped into React via `dangerouslySetInnerHTML`
 *   - embedded directly into the print-popup HTML string (which is a
 *     stand-alone document, no React runtime)
 *
 * Why physical millimetre sizing
 * ------------------------------
 * Thermal printers go through the browser's print rasteriser. If we let
 * the SVG inherit its size from CSS percentages, the bar widths land
 * wherever the print engine decides — often blurred and merged together
 * which makes the symbol unscannable. Sizing the SVG in `mm` with
 * `preserveAspectRatio="none"` produces a barcode whose narrow bar is
 * exactly `widthMm / totalModules` mm wide on the paper, every time.
 *
 * Code 128 was chosen because:
 *   - it's the de-facto standard for retail / ticketing barcodes
 *   - supported by every commodity USB / Bluetooth scanner with no
 *     config — they read it out of the box as keyboard input
 *   - compact for short alphanumeric ids like "SBK-XXXXXXXX" or the
 *     legacy numeric coupon codes
 */

// Code 128 module patterns (values 0..106). Each entry is a run-length
// string of alternating bars and spaces starting with a bar; ordinary
// symbols total 11 modules, STOP (value 106) totals 13.
const PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

export interface BarcodeOptions {
  /** Physical bar-area width on paper in millimetres. Default `65`. */
  widthMm?: number;
  /** Physical bar height on paper in millimetres. Default `14`. */
  heightMm?: number;
  /** Show the human-readable text below the bars. Default `true`. */
  showText?: boolean;
  /** Quiet-zone width on each side, in modules. Default `12`. */
  quietModules?: number;
}

/**
 * Build a Code 128B barcode for `rawValue`. Always returns a valid HTML
 * fragment — unsupported characters are silently dropped so callers
 * never need to wrap this in try/catch.
 */
export function renderCode128Svg(
  rawValue: string,
  options: BarcodeOptions = {},
): string {
  const widthMm = options.widthMm ?? 65;
  const heightMm = options.heightMm ?? 14;
  const showText = options.showText !== false;
  const quietModules = options.quietModules ?? 12;

  // Code 128B encodes ASCII 32-127. Anything outside is silently dropped;
  // the human-readable text below still shows the full original value so
  // the cashier can fall back to manual entry on the rare edge case.
  const data: number[] = [];
  for (let i = 0; i < rawValue.length; i++) {
    const code = rawValue.charCodeAt(i);
    if (code >= 32 && code <= 127) {
      data.push(code - 32);
    }
  }

  if (data.length === 0) {
    return '<span></span>';
  }

  // Checksum: start + Σ position * value, mod 103. Position is 1-based
  // from the first data character.
  let checksum = START_B;
  for (let i = 0; i < data.length; i++) {
    checksum += (i + 1) * data[i];
  }
  checksum %= 103;

  const codes = [START_B, ...data, checksum, STOP];

  // Module-width totals: 11 per ordinary symbol, 13 for STOP.
  let dataModules = 0;
  for (const c of codes) {
    dataModules += c === STOP ? 13 : 11;
  }
  const totalModules = dataModules + quietModules * 2;

  // Build the bar rects in "module units" (each module = 1 viewBox unit
  // wide, viewBox is 100 tall). `preserveAspectRatio="none"` then
  // stretches each module to exactly `widthMm/totalModules` mm wide and
  // `heightMm` mm tall on paper.
  const rects: string[] = [];
  let x = quietModules;
  for (const c of codes) {
    const pattern = PATTERNS[c];
    let isBar = true; // every pattern starts with a bar; spaces stay transparent
    for (let i = 0; i < pattern.length; i++) {
      const w = parseInt(pattern[i], 10);
      if (isBar) {
        rects.push(
          `<rect x="${x}" y="0" width="${w}" height="100" fill="#000"/>`,
        );
      }
      x += w;
      isBar = !isBar;
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${widthMm}mm" height="${heightMm}mm" ` +
    `viewBox="0 0 ${totalModules} 100" ` +
    `preserveAspectRatio="none" shape-rendering="crispEdges" ` +
    `style="display:block;margin:0 auto;image-rendering:pixelated;">` +
    rects.join('') +
    `</svg>`;

  if (!showText) return svg;

  // Human-readable text rendered as HTML (not inside the SVG) so it stays
  // crisp and unsquashed when the bars are stretched with
  // preserveAspectRatio="none".
  return (
    `<span style="display:inline-block;text-align:center;line-height:1;">` +
    svg +
    `<span style="display:block;font-family:'Courier New',Courier,monospace;font-weight:700;font-size:11px;letter-spacing:1.5px;color:#000;margin-top:1mm;">` +
    escapeXml(rawValue) +
    `</span>` +
    `</span>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
