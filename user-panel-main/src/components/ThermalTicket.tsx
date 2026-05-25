"use client";

import { useBets } from "@/context/BetContext";

interface ThermalTicketProps {
  ticketNumber: string;
  stake: number;
  totalOdds: number;
  potentialWin: number;
  netPayout: number;
  stakeTax: number;
  winTax: number;
  betsCount: number;
  timestamp: string;
  buralNumber?: string;
}

/**
 * ThermalTicket
 * ---------------------------------------------------------------------------
 * 80 mm (302 px) wide receipt designed for direct printing on standard ESC/POS
 * thermal printers (Epson TM-T20/T88, Star, Citizen, generic Windows thermal
 * drivers). Width is intentionally fixed at 302 px on screen and `80mm` for
 * the print media (see `@media print` in `globals.css`).
 *
 * Layout is compact and structured:
 *   logo  → ticket meta → bets list → summary block → footer
 * with thin dashed dividers so the printout reads cleanly without colour.
 */
export function ThermalTicket({
  ticketNumber,
  stake,
  totalOdds,
  potentialWin,
  netPayout,
  stakeTax,
  winTax,
  betsCount,
  timestamp,
  buralNumber,
}: ThermalTicketProps) {
  const { bets } = useBets();

  const formatDate = (date: string) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const formatMatchDate = (dateStr: string, timeStr: string) => {
    const [day, month] = dateStr.split("/");
    const year = new Date().getFullYear().toString().slice(-2);
    return `${day}-${month}-${year} ${timeStr}`;
  };

  // Single 32-char dashed line works well at 80 mm with a 10.5 px monospace
  // font — fills the row edge-to-edge without wrapping.
  const dashedLine = "-".repeat(32);

  return (
    <div
      className="thermal-ticket font-mono"
      style={{
        width: "302px",
        margin: "0 auto",
        padding: "10px 10px",
        background: "#fff",
        color: "#000",
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: "10.5px",
        lineHeight: "1.25",
      }}
    >
      {/* Logo + brand header — clean, structured, prints reliably even on
          monochrome thermal heads because we keep a textual fallback below
          the image. */}
      <div className="text-center" style={{ marginBottom: "6px" }}>
        <img
          src="/play-core-logo.png"
          alt="Play Core"
          style={{
            width: "64px",
            height: "64px",
            margin: "0 auto",
            display: "block",
            objectFit: "contain",
          }}
        />
        <div
          style={{
            fontWeight: 700,
            fontSize: "13px",
            letterSpacing: "2px",
            marginTop: "4px",
          }}
        >
          PLAYCORE
        </div>
        <div style={{ fontSize: "9.5px", letterSpacing: "0.5px" }}>
          Sports Betting
        </div>
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {/* Ticket meta */}
      <div className="text-center" style={{ marginBottom: "4px" }}>
        <div style={{ fontWeight: 700 }}>BETTING SLIP</div>
        <div>{formatDate(timestamp)}</div>
        <div>
          Coupon: <span style={{ fontWeight: 700 }}>{ticketNumber}</span>
        </div>
        {buralNumber && <div>Bural: {buralNumber}</div>}
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {/* Bets list */}
      {bets.map((bet, idx) => (
        <div key={bet.id} style={{ marginBottom: "4px" }}>
          <div style={{ fontSize: "9.5px" }}>{bet.league}</div>
          <div style={{ fontWeight: 700 }}>{bet.match}</div>
          <div className="flex justify-between items-start" style={{ gap: "6px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{bet.market}</div>
              <div style={{ fontSize: "9.5px" }}>
                {formatMatchDate(bet.date, bet.time)}
              </div>
            </div>
            <div className="text-right" style={{ whiteSpace: "nowrap" }}>
              <div style={{ fontWeight: 700 }}>{bet.selection}</div>
              <div style={{ fontWeight: 700 }}>{bet.odds.toFixed(2)}</div>
            </div>
          </div>
          {idx < bets.length - 1 && (
            <div style={{ margin: "3px 0" }}>{dashedLine}</div>
          )}
        </div>
      ))}

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {/* Summary */}
      <div>
        <div className="flex justify-between">
          <span>BETS: {betsCount}</span>
          <span>ODD: {totalOdds.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>STAKE: {stake.toFixed(2)}</span>
          <span>S.Tax: {stakeTax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>WIN: {potentialWin.toFixed(2)}</span>
          <span>W.Tax: {winTax.toFixed(2)}</span>
        </div>
        <div
          className="flex justify-between"
          style={{
            marginTop: "4px",
            paddingTop: "3px",
            borderTop: "1px dashed #000",
            fontWeight: 700,
            fontSize: "12px",
          }}
        >
          <span>NET PAY</span>
          <span>{netPayout.toFixed(2)}</span>
        </div>
      </div>

      <div style={{ margin: "4px 0" }}>{dashedLine}</div>

      {/* Footer */}
      <div className="text-center" style={{ fontSize: "9.5px", lineHeight: 1.3 }}>
        <div>*** All bets after kick-off are invalid ***</div>
        <div style={{ fontWeight: 700, marginTop: "2px" }}>playcore.bet</div>
        <div style={{ marginTop: "4px" }}>Under 21s are strictly forbidden!</div>
        <div>Terms and Conditions apply.</div>
      </div>
    </div>
  );
}
