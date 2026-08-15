const crypto = require('crypto');

/**
 * Real Telebirr SMS format (verified against live message):
 *
 * "Dear Abenezer
 *  You have received ETB 1,000.00 from Daniel
 *  Tesfaye(2519****0964) on 18/05/2026
 *  02:45:53. Your transaction number is DEI24SSS22.
 *  Your current E-Money Account balance is ETB 3,959.35.
 *  Thank you for using telebirr
 *  Ethio telecome"
 *
 * Amharic variant (some SIM/network providers deliver the notification in
 * Amharic — supported via ADDITIVE fallbacks; the English regexes always
 * run first and are unchanged):
 *
 * "ውድ Abenezer
 *  ከ Rihan Sultan(2519****1374) 570.00 ብር በ 08/08/2026 18:08:10 ተቀብለዋል፡፡
 *  የሂሳብ እንቅስቃሴ ቁጥርዎ DH87MOJD7R ነዉ፡፡ አሁን ያለዎት ቀሪ ሂሳብ 4,969.93 ብር ነዉ፡፡
 *  በቴሌብር ስለተገለገሉ እናመሰግናለን
 *  ኢትዮ ቴሌኮም"
 */

function isTelebirrSender(sender) {
  const s = (sender || '').trim();
  return (
    /telebirr/i.test(s) ||
    /ethio.?telecom/i.test(s) ||
    // Ethio Telecom / Telebirr short codes seen on live payment SMS.
    s === '127' ||
    s === '6040' ||
    s === '8282' ||
    s === '8978'
  );
}

function parseTelebirrSms(body) {
  const amountMatch =
    body.match(/ETB ([\d,]+\.?\d*)/i) ||
    // Amharic: "570.00 ብር" — the first occurrence is the transfer amount
    // (the remaining balance appears later in the message).
    body.match(/([\d,]+\.?\d*)\s*ብር/);
  const senderMatch =
    body.match(/from ([A-Za-z]+[\s\n]+[A-Za-z]+)\(/i) ||
    body.match(/from ([A-Za-z ]+)\(/i) ||
    // Amharic: "ከ Rihan Sultan(2519****1374)" — "ከ" = "from".
    body.match(/ከ\s+([^()\n፡]{1,80}?)\s*\(/);
  const phoneMatch = body.match(/\((\d{4}\*+\d+)\)/) || body.match(/\((\d{9,13})\)/);
  const refMatch =
    body.match(/transaction number is ([A-Z0-9]+)/i) ||
    // Amharic: "የሂሳብ እንቅስቃሴ ቁጥርዎ DH87MOJD7R ነዉ".
    body.match(/እንቅስቃሴ\s*ቁጥር\S*\s+([A-Za-z0-9]+)/);
  const balanceMatch =
    body.match(/balance is ETB ([\d,]+\.?\d*)/i) ||
    // Amharic: "ቀሪ ሂሳብ 4,969.93 ብር".
    body.match(/ቀሪ\s*ሂሳብ\s*([\d,]+\.?\d*)/);
  const dateMatch =
    body.match(/on (\d{2}\/\d{2}\/\d{4})/) ||
    // Amharic: "በ 08/08/2026 18:08:10".
    body.match(/(\d{2}\/\d{2}\/\d{4})/);
  const timeMatch = body.match(/(\d{2}:\d{2}:\d{2})/);

  if (!amountMatch || !refMatch) {
    return { parsed: false };
  }

  // Only treat the SMS as a CREDIT (money received by the agent). The
  // English format is implicitly credit-only ("You have received…");
  // the Amharic format distinguishes received (ተቀብለዋል) from sent
  // (ልከዋል/ተልኳል) — never queue a debit notification as a deposit.
  const isAmharic = /ብር/.test(body);
  if (isAmharic && !/ተቀብለዋል|ገቢ\s*ተደርጓል/.test(body) && !/received/i.test(body)) {
    return { parsed: false };
  }

  return {
    parsed: true,
    amount: parseFloat(amountMatch[1].replace(/,/g, '')),
    sender_name: senderMatch ? senderMatch[1].replace(/\s+/g, ' ').trim() : null,
    sender_phone: phoneMatch ? phoneMatch[1] : null,
    telebirr_ref: refMatch[1],
    balance_after: balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g, '')) : null,
    date: dateMatch ? dateMatch[1] : null,
    time: timeMatch ? timeMatch[1] : null,
  };
}

function computeDedupHash(body, receivedAt, sender) {
  const input = `${body.trim()}|${receivedAt}|${sender}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

module.exports = { parseTelebirrSms, isTelebirrSender, computeDedupHash };
