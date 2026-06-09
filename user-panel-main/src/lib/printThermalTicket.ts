/**
 * printThermalTicket
 * ---------------------------------------------------------------------------
 * Prints the currently-rendered `.thermal-ticket` element to a thermal POS
 * printer (POS80, Epson TM-T20/T88, Star, Citizen, etc.) using a hidden
 * iframe. This is the technique every reliable POS web app uses because the
 * iframe is a fully isolated document — the printer only ever sees the
 * receipt, the page chrome (header / sidebar / bet-slip) cannot leak in,
 * and the document height equals exactly the ticket height, so you never
 * get blank trailing pages.
 *
 * Trade-offs vs. plain `window.print()` + @media print:
 *   - No visibility/display fight with the rest of the page
 *   - Single page output, regardless of how tall the host page is
 *   - Crisp `@page { size: 80mm auto; margin: 0 }` honoured by all browsers
 *   - Logo / images load before printing thanks to the load-await loop
 *
 * Returns true if it found a ticket and dispatched the print job. Returns
 * false (and falls back to `window.print()`) if it could not locate one.
 */
export function printThermalTicket(): boolean {
  if (typeof document === "undefined") return false;

  const ticketEl = document.querySelector<HTMLElement>(".thermal-ticket");
  if (!ticketEl) {
    // Defensive fallback — shouldn't normally happen because the Print
    // buttons are only rendered next to a visible ticket.
    if (typeof window !== "undefined") window.print();
    return false;
  }

  // Snapshot the ticket markup as-is. We rely on the inline styles in
  // ThermalTicket.tsx for the bulk of the visual layout, then re-declare
  // the print-only @page + body resets in the iframe.
  const ticketHtml = ticketEl.outerHTML;

  // Tear down any leftover frame from a previous click before mounting a
  // fresh one. Some browsers cache frame state across rapid clicks.
  const existing = document.getElementById("__pc_print_frame");
  if (existing) existing.remove();

  const frame = document.createElement("iframe");
  frame.id = "__pc_print_frame";
  frame.setAttribute("aria-hidden", "true");
  // Park it off-screen so it cannot be seen and never affects layout.
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:80mm;height:0;border:0;visibility:hidden;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument || frame.contentWindow?.document;
  if (!doc) {
    if (typeof window !== "undefined") window.print();
    return false;
  }

  const printDocHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>1birr.bet Ticket</title>
<style>
  /* Standard 80 mm thermal receipt page. ESC/POS drivers (POS80, Epson,
     Star, Citizen, generic Windows) all honour this. Margin 0 means the
     printer feeds exactly the ticket height with no top/bottom padding. */
  @page {
    size: 80mm auto;
    margin: 0;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    color: #000000 !important;
    width: 80mm !important;
    font-family: 'Courier New', Courier, monospace !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* Mirror the on-screen ThermalTicket styling so what users preview is
     exactly what prints. Inline styles inside the markup carry most of the
     layout — these are pure resets. */
  .thermal-ticket {
    display: block !important;
    width: 80mm !important;
    max-width: 80mm !important;
    margin: 0 !important;
    padding: 3mm !important;
    background: #ffffff !important;
    color: #000000 !important;
    font-family: 'Courier New', Courier, monospace !important;
    font-size: 10.5px !important;
    line-height: 1.25 !important;
    box-shadow: none !important;
    border: none !important;
  }
  .thermal-ticket img {
    display: block !important;
    margin: 0 auto !important;
    max-width: 64px !important;
    max-height: 64px !important;
    filter: none !important;
    object-fit: contain;
  }
  /* Tailwind utility classes used inside the ticket — re-declare so the
     iframe (which has no Tailwind) still lays them out correctly. */
  .text-center { text-align: center !important; }
  .text-right { text-align: right !important; }
  .flex { display: flex !important; }
  .justify-between { justify-content: space-between !important; }
  .items-start { align-items: flex-start !important; }
  .font-mono { font-family: 'Courier New', Courier, monospace !important; }
</style>
</head>
<body>
${ticketHtml}
<script>
  (function() {
    function fire() {
      try { window.focus(); } catch (_) {}
      try { window.print(); } catch (_) {}
    }
    var imgs = document.images;
    if (!imgs || imgs.length === 0) {
      // Small delay lets the layout engine settle before printing.
      setTimeout(fire, 50);
      return;
    }
    var done = false;
    function go() { if (!done) { done = true; setTimeout(fire, 30); } }
    var pending = 0;
    for (var i = 0; i < imgs.length; i++) {
      if (!imgs[i].complete) {
        pending++;
        imgs[i].addEventListener('load', onOne);
        imgs[i].addEventListener('error', onOne);
      }
    }
    function onOne() { if (--pending <= 0) go(); }
    if (pending === 0) go();
    // Hard fallback in case an image hangs — never block the user.
    setTimeout(go, 1500);
  })();
</script>
</body>
</html>`;

  doc.open();
  doc.write(printDocHtml);
  doc.close();

  // Remove the iframe shortly after the print dialog has had a chance to
  // open. We can't reliably hook `afterprint` from the parent (cross-frame
  // event support is uneven), so a generous timeout is the safest cleanup.
  setTimeout(() => {
    const f = document.getElementById("__pc_print_frame");
    if (f) f.remove();
  }, 60_000);

  return true;
}
