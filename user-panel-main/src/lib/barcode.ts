/**
 * Code 128 barcode renderer (subset B — printable ASCII 32-127).
 *
 * Mirrors `cashier-panel-main/src/lib/barcode.ts` exactly so tickets
 * printed from the user panel are scannable by the cashier panel's
 * Ticket ID inputs (the same Code 128B encoding both sides expect).
 *
 * See the cashier-panel copy for the full design rationale (mm sizing
 * for scan-reliable bars, HTML text label outside the SVG, etc.).
 */

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

export function renderCode128Svg(
  rawValue: string,
  options: BarcodeOptions = {},
): string {
  const widthMm = options.widthMm ?? 65;
  const heightMm = options.heightMm ?? 14;
  const showText = options.showText !== false;
  const quietModules = options.quietModules ?? 12;

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

  let checksum = START_B;
  for (let i = 0; i < data.length; i++) {
    checksum += (i + 1) * data[i];
  }
  checksum %= 103;

  const codes = [START_B, ...data, checksum, STOP];

  let dataModules = 0;
  for (const c of codes) {
    dataModules += c === STOP ? 13 : 11;
  }
  const totalModules = dataModules + quietModules * 2;

  const rects: string[] = [];
  let x = quietModules;
  for (const c of codes) {
    const pattern = PATTERNS[c];
    let isBar = true;
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
