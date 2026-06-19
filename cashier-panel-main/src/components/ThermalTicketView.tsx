"use client";

/**
 * ThermalTicketView
 * ---------------------------------------------------------------------------
 * 80 mm receipt-style ticket renderer for the **cashier panel**. Visually
 * matches the user-panel `ThermalTicket` so a slip looks identical
 * whether the player picked it up at the till or from their own device.
 *
 * Notes:
 *   - Designed for both screen preview (after `Lookup Ticket`) AND for the
 *     popup print window. The print path serialises the rendered DOM via
 *     `renderToStaticMarkup`, keeping a single source of truth for the
 *     layout — no more drift between on-screen and printed slips.
 *   - The "Bural" / "Bet By" row is now the **cashier user name** (per
 *     branch operations request — walk-in tickets shouldn't display the
 *     placeholder `walkin@playcore.local` email).
 *   - Tax / bonus formula mirrors the user-panel `Betslip`:
 *       bonus%  = lookup(bets count)  // 2:3%, 3:5%, 4:7%, 5:10%, 6-8:15%,
 *                                     // 9-11:20%, 12-15:25%, 16+:30%
 *       WIN     = stake * totalOdds * (1 + bonus%)
 *       S.Tax   = stake * 0.15
 *       W.Tax   = 0
 *       NET PAY = WIN * 0.85
 */

import { useEffect, useState } from "react";
import type { CashierTicket } from "@/lib/api";
import { renderBarcode, renderBarcodeImgTag } from "@/lib/barcode";

interface ThermalTicketViewProps {
  ticket: CashierTicket;
  cashierName: string;
  branchLabel: string;
}

interface NormalisedSelection {
  match: string;
  league: string;
  market: string;
  selection: string;
  odds: number;
  starts_at: string;
}

/**
 * The backend can attach selections under a few legacy shapes (string,
 * raw array of objects, nested `result.selections`). Normalise into a
 * single typed array so the renderer stays simple.
 */
function normaliseSelections(raw: unknown): NormalisedSelection[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalisedSelection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const home = String(o.home_team ?? o.homeTeam ?? "");
    const away = String(o.away_team ?? o.awayTeam ?? "");
    const fallbackMatch = home && away ? `${home} V ${away}` : "—";
    out.push({
      match: String(o.match ?? fallbackMatch),
      league: String(o.league ?? ""),
      market: String(o.market ?? o.market_type ?? "Match Result"),
      selection: String(o.selection ?? o.label ?? "—"),
      odds: Number(o.odds ?? 0) || 0,
      starts_at: String(o.starts_at ?? ""),
    });
  }
  return out;
}

function calculateAccumulatorBonus(numBets: number): number {
  if (numBets < 2) return 0;
  if (numBets === 2) return 3;
  if (numBets === 3) return 5;
  if (numBets === 4) return 7;
  if (numBets === 5) return 10;
  if (numBets >= 6 && numBets <= 8) return 15;
  if (numBets >= 9 && numBets <= 11) return 20;
  if (numBets >= 12 && numBets <= 15) return 25;
  if (numBets >= 16) return 30;
  return 0;
}

function formatMatchDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day}-${month}-${year} ${hh}:${mm}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export function ThermalTicketView({
  ticket,
  cashierName,
  branchLabel,
}: ThermalTicketViewProps) {
  const legs = normaliseSelections(ticket.selections);
  const numBets = legs.length || 1;
  // The barcode encodes the SHORT ticket code (TKT-XXXXXXXX /
  // SBK-XXXXXXXX, ~12 chars), NOT the long printed_ticket_code
  // (TKT-{BRANCH}-{YYYYMMDD}-{SEQ}, ~22-30 chars). A 22+ char Code 128
  // is too long/dense to print scannably on thermal paper. The cashier
  // lookup matches ticket_code / coupon_code / printed_ticket_code
  // interchangeably, so scanning the short code finds the same ticket.
  const couponForBarcode =
    ticket.ticket_code ||
    ticket.coupon_code ||
    ticket.ticket_id;

  // Generate the barcode PNG after mount so the canvas API is available.
  // We keep the computed width (mm) so the <img> prints 1:1 at 203 DPI —
  // a downscaled barcode bitmap drops bars and won't scan.
  const [barcode, setBarcode] = useState({ dataUrl: "", widthMm: 0 });
  useEffect(() => {
    const bc = renderBarcode(couponForBarcode);
    setBarcode({ dataUrl: bc.dataUrl, widthMm: bc.widthMm });
  }, [couponForBarcode]);
  const totalOdds =
    legs.length > 0
      ? legs.reduce((acc, leg) => acc * (leg.odds || 1), 1)
      : ticket.stake > 0
        ? ticket.potential_win / ticket.stake
        : 1;

  const stake = ticket.stake;
  const bonusPct = calculateAccumulatorBonus(legs.length);
  const baseWin = stake * totalOdds;
  const bonusAmount = (baseWin * bonusPct) / 100;
  const winGross = baseWin + bonusAmount;
  const stakeTax = stake * 0.15;
  const winTax = 0;
  const netPay = winGross * 0.85;

  const dashedLine = "-".repeat(32);
  const coupon =
    ticket.printed_ticket_code ||
    ticket.coupon_code ||
    ticket.ticket_code ||
    ticket.ticket_id;
  const timestamp = ticket.sold_at || ticket.placed_at || ticket.issued_at;

  return (
    <div
      className="thermal-ticket"
      data-testid="cashier-thermal-ticket"
      style={{
        width: "302px",
        margin: "0 auto",
        padding: "10px",
        background: "#fff",
        color: "#000",
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "10.5px",
        lineHeight: 1.25,
        // Every line of the ticket is rendered at full font-weight so
        // small text (league names, kick-off times, cashier / branch
        // labels) is just as legible as the bold headers when printed
        // on an 80 mm thermal head — thin regular-weight Courier New
        // tends to fade to gray on low-DPI thermal output. Font sizes
        // are unchanged; only the stroke weight is increased.
        fontWeight: 700,
        // Force the browser to print exact colours (full black ink)
        // even when the user has "print backgrounds = off" or a
        // monochrome economy mode that grayscales regular weight text.
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: "13px",
            letterSpacing: "2px",
          }}
        >
          1BIRR.BET
        </div>
        <div style={{ fontSize: "9.5px", letterSpacing: "0.5px" }}>
          Sports Betting
        </div>
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      <div style={{ textAlign: "center", marginBottom: "4px" }}>
        <div style={{ fontWeight: 700 }}>BETTING SLIP</div>
        <div>{formatTimestamp(timestamp)}</div>
        <div>
          Coupon: <span style={{ fontWeight: 700 }}>{coupon}</span>
        </div>
        <div>Cashier: {cashierName}</div>
        <div>Branch: {branchLabel}</div>
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {legs.length === 0 ? (
        <div style={{ textAlign: "center", margin: "4px 0" }}>
          (no selections recorded)
        </div>
      ) : (
        legs.map((leg, idx) => (
          <div key={`${leg.match}-${idx}`} style={{ marginBottom: "4px" }}>
            {leg.league && (
              <div style={{ fontSize: "9.5px" }}>{leg.league}</div>
            )}
            <div style={{ fontWeight: 700 }}>{leg.match}</div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "6px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{leg.market}</div>
                {leg.starts_at && (
                  <div style={{ fontSize: "9.5px" }}>
                    {formatMatchDate(leg.starts_at)}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div style={{ fontWeight: 700 }}>{leg.selection}</div>
                <div style={{ fontWeight: 700 }}>{leg.odds.toFixed(2)}</div>
              </div>
            </div>
            {idx < legs.length - 1 && (
              <div style={{ margin: "3px 0" }}>{dashedLine}</div>
            )}
          </div>
        ))
      )}

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>BETS: {numBets}</span>
          <span>ODD: {totalOdds.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>STAKE: {stake.toFixed(2)}</span>
          <span>S.Tax: {stakeTax.toFixed(2)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>WIN: {winGross.toFixed(2)}</span>
          <span>W.Tax: {winTax.toFixed(2)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: "4px",
            paddingTop: "3px",
            borderTop: "1px dashed #000",
            fontWeight: 700,
            fontSize: "12px",
          }}
        >
          <span>NET PAY</span>
          <span>{netPay.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {/* Canvas-based Code 128 barcode. Rendered as a PNG data-URL so
          bars are pixel-perfect on-screen and on the thermal printout —
          no SVG anti-aliasing or GDI rounding artifacts. */}
      {barcode.dataUrl && (
        <div aria-hidden style={{ margin: "6px 0 4px", textAlign: "center" }}>
          <img
            src={barcode.dataUrl}
            alt={couponForBarcode}
            decoding="sync"
            loading="eager"
            style={{
              display: "block",
              margin: "0 auto",
              width: `${barcode.widthMm.toFixed(1)}mm`,
              height: "auto",
            }}
          />
        </div>
      )}

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      <div style={{ textAlign: "center", fontSize: "9.5px", lineHeight: 1.3 }}>
        <div>*** All bets after kick-off are invalid ***</div>
        <div style={{ fontWeight: 700, marginTop: "2px" }}>1birr.bet</div>
        <div style={{ marginTop: "4px" }}>Under 21s are strictly forbidden!</div>
        <div>Terms and Conditions apply.</div>
      </div>
    </div>
  );
}

/**
 * Render the ticket as a self-contained HTML document for the print
 * popup. Keeps the layout in lock-step with the React component above
 * by reusing the same numeric math; if we ever change the visual format
 * we only edit `ThermalTicketView` and this string template.
 */
export function buildThermalTicketPrintHtml(args: {
  ticket: CashierTicket;
  cashierName: string;
  branchLabel: string;
}): string {
  const { ticket, cashierName, branchLabel } = args;
  const legs = normaliseSelections(ticket.selections);
  const numBets = legs.length || 1;
  const totalOdds =
    legs.length > 0
      ? legs.reduce((acc, leg) => acc * (leg.odds || 1), 1)
      : ticket.stake > 0
        ? ticket.potential_win / ticket.stake
        : 1;
  const stake = ticket.stake;
  const bonusPct = calculateAccumulatorBonus(legs.length);
  const baseWin = stake * totalOdds;
  const winGross = baseWin + (baseWin * bonusPct) / 100;
  const stakeTax = stake * 0.15;
  const winTax = 0;
  const netPay = winGross * 0.85;
  const coupon =
    ticket.printed_ticket_code ||
    ticket.coupon_code ||
    ticket.ticket_code ||
    ticket.ticket_id;
  // Short code for the barcode (see note in ThermalTicketView) — keeps
  // the printed symbol within a scannable width on thermal paper.
  const barcodeValue =
    ticket.ticket_code ||
    ticket.coupon_code ||
    ticket.ticket_id;
  const timestamp = formatTimestamp(
    ticket.sold_at || ticket.placed_at || ticket.issued_at
  );
  const dashedLine = "-".repeat(32);

  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const legsHtml = legs.length
    ? legs
        .map((leg, idx) => {
          const sep =
            idx < legs.length - 1
              ? `<div style="margin:3px 0;">${dashedLine}</div>`
              : "";
          const startsAt = leg.starts_at
            ? `<div style="font-size:9.5px;">${escape(
                formatMatchDate(leg.starts_at)
              )}</div>`
            : "";
          const league = leg.league
            ? `<div style="font-size:9.5px;">${escape(leg.league)}</div>`
            : "";
          return `
            <div style="margin-bottom:4px;">
              ${league}
              <div style="font-weight:700;">${escape(leg.match)}</div>
              <div style="display:flex;justify-content:space-between;gap:6px;">
                <div style="flex:1;min-width:0;">
                  <div>${escape(leg.market)}</div>
                  ${startsAt}
                </div>
                <div style="text-align:right;white-space:nowrap;">
                  <div style="font-weight:700;">${escape(leg.selection)}</div>
                  <div style="font-weight:700;">${leg.odds.toFixed(2)}</div>
                </div>
              </div>
              ${sep}
            </div>`;
        })
        .join("")
    : `<div style="text-align:center;margin:4px 0;">(no selections recorded)</div>`;

  return `
<html>
<head>
  <title>Ticket ${escape(coupon)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body {
      width: 80mm;
      margin: 0;
      padding: 10px;
      color: #000;
      background: #fff;
      font-family: 'Courier New', Courier, monospace;
      font-size: 10.5px;
      line-height: 1.25;
      /* Bold every line (sizes unchanged) so small Courier New text
         survives the thermal head without fading; visual hierarchy
         is preserved via size + spacing. */
      font-weight: 700;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  </style>
</head>
<body>
  <div style="text-align:center;margin-bottom:6px;">
    <div style="font-weight:700;font-size:13px;letter-spacing:2px;">1BIRR.BET</div>
    <div style="font-size:9.5px;letter-spacing:0.5px;">Sports Betting</div>
  </div>

  <div style="margin:4px 0;">${dashedLine}</div>

  <div style="text-align:center;margin-bottom:4px;">
    <div style="font-weight:700;">BETTING SLIP</div>
    <div>${escape(timestamp)}</div>
    <div>Coupon: <span style="font-weight:700;">${escape(coupon)}</span></div>
    <div>Cashier: ${escape(cashierName)}</div>
    <div>Branch: ${escape(branchLabel)}</div>
  </div>

  <div style="margin:4px 0;">${dashedLine}</div>

  ${legsHtml}

  <div style="margin:4px 0;">${dashedLine}</div>

  <div>
    <div style="display:flex;justify-content:space-between;">
      <span>BETS: ${numBets}</span>
      <span>ODD: ${totalOdds.toFixed(2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <span>STAKE: ${stake.toFixed(2)}</span>
      <span>S.Tax: ${stakeTax.toFixed(2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;">
      <span>WIN: ${winGross.toFixed(2)}</span>
      <span>W.Tax: ${winTax.toFixed(2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:4px;padding-top:3px;border-top:1px dashed #000;font-weight:700;font-size:12px;">
      <span>NET PAY</span>
      <span>${netPay.toFixed(2)}</span>
    </div>
  </div>

  <div style="margin:4px 0;">${dashedLine}</div>

  <!-- PNG barcode — pixel-perfect on thermal printers; no SVG
       anti-aliasing. Scanned by USB/Bluetooth HID scanners which type
       the Ticket ID + Enter into the focused Ticket ID input. -->
  ${renderBarcodeImgTag(barcodeValue)}

  <div style="margin:4px 0;">${dashedLine}</div>

  <div style="text-align:center;font-size:9.5px;line-height:1.3;">
    <div>*** All bets after kick-off are invalid ***</div>
    <div style="font-weight:700;margin-top:2px;">1birr.bet</div>
    <div style="margin-top:4px;">Under 21s are strictly forbidden!</div>
    <div>Terms and Conditions apply.</div>
  </div>

  <!--
    Trigger print only after the page (including the inline PNG barcode)
    has fully loaded. Calling window.print() synchronously from the
    opener right after document.write() races the image decoder and
    causes the barcode slot to print blank.
  -->
  <script>
    window.addEventListener('load', function () {
      window.print();
      // Close the popup after a short delay so the OS print spooler
      // has received the job before the window disappears.
      setTimeout(function () { window.close(); }, 800);
    });
  </script>
</body>
</html>`;
}
