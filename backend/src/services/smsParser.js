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
 */

function isTelebirrSender(sender) {
  return (
    /telebirr/i.test(sender || '') ||
    /ethio.?telecom/i.test(sender || '') ||
    sender === '6040' ||
    sender === '8282'
  );
}

function parseTelebirrSms(body) {
  const amountMatch = body.match(/ETB ([\d,]+\.?\d*)/i);
  const senderMatch =
    body.match(/from ([A-Za-z]+[\s\n]+[A-Za-z]+)\(/i) ||
    body.match(/from ([A-Za-z ]+)\(/i);
  const phoneMatch = body.match(/\((\d{4}\*+\d+)\)/) || body.match(/\((\d{9,13})\)/);
  const refMatch = body.match(/transaction number is ([A-Z0-9]+)/i);
  const balanceMatch = body.match(/balance is ETB ([\d,]+\.?\d*)/i);
  const dateMatch = body.match(/on (\d{2}\/\d{2}\/\d{4})/);
  const timeMatch = body.match(/(\d{2}:\d{2}:\d{2})/);

  if (!amountMatch || !refMatch) {
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
