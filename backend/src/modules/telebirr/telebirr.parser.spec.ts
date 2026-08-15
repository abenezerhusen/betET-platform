import { describe, expect, it } from 'vitest';

import { parseSms } from './telebirr.parser';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseTelebirrSms } = require('../../services/smsParser');

/** Live English Telebirr credit SMS (verified real format — must keep parsing). */
const ENGLISH_RECEIVED = `Dear Abenezer
You have received ETB 1,000.00 from Daniel Tesfaye(2519****0964) on 18/05/2026 02:45:53. Your transaction number is DEI24SSS22. Your current E-Money Account balance is ETB 3,959.35.
Thank you for using telebirr
Ethio telecome`;

/** New Amharic Telebirr credit SMS (additional supported format). */
const AMHARIC_RECEIVED = `ውድ Abenezer

ከ Rihan Sultan(2519****1374) 570.00 ብር በ 08/08/2026 18:08:10 ተቀብለዋል፡፡ የሂሳብ እንቅስቃሴ ቁጥርዎ DH87MOJD7R ነዉ፡፡ አሁን ያለዎት ቀሪ ሂሳብ 4,969.93 ብር ነዉ፡፡

በቴሌብር ስለተገለገሉ እናመሰግናለን

ኢትዮ ቴሌኮም`;

describe('telebirr.parser parseSms', () => {
  it('still parses the live English received format (regression)', () => {
    const p = parseSms(ENGLISH_RECEIVED);
    expect(p.type).toBe('received');
    expect(p.amount).toBe(1000);
    expect(p.telebirrRef).toBe('DEI24SSS22');
    // Pre-existing behaviour: the live wording "current E-Money Account
    // balance" is not captured by NEW_BALANCE_RE — must stay unchanged.
    expect(p.newBalance).toBeNull();
    expect(p.senderName).toBe('Daniel Tesfaye');
  });

  it('parses the Amharic received format', () => {
    const p = parseSms(AMHARIC_RECEIVED);
    expect(p.type).toBe('received');
    expect(p.amount).toBe(570);
    expect(p.telebirrRef).toBe('DH87MOJD7R');
    expect(p.newBalance).toBe(4969.93);
    expect(p.senderName).toBe('Rihan Sultan');
    // Phone is masked in the SMS → cannot be normalised.
    expect(p.senderPhone).toBeNull();
    // DATE_RE captures an optional trailing space (pre-existing) — trim.
    expect(p.rawDate?.trim()).toBe('08/08/2026 18:08:10');
    // received + amount + ref (no phone) → medium is enough for matching.
    expect(p.confidence).toBe('medium');
  });

  it('classifies an Amharic sent/debit SMS as sent (never credits)', () => {
    const p = parseSms(
      'ወደ Abebe Kebede(2519****0964) 200.00 ብር በ 08/08/2026 10:00:00 ልከዋል፡፡ የሂሳብ እንቅስቃሴ ቁጥርዎ AB12CD34EF ነዉ፡፡'
    );
    expect(p.type).toBe('sent');
  });

  it('still returns unknown for unrelated SMS (ignored by the matcher)', () => {
    const p = parseSms('Selam! Your OTP code is 123456.');
    expect(p.type).toBe('unknown');
  });
});

describe('legacy smsParser parseTelebirrSms', () => {
  it('still parses the live English format (regression)', () => {
    const r = parseTelebirrSms(ENGLISH_RECEIVED);
    expect(r.parsed).toBe(true);
    expect(r.amount).toBe(1000);
    expect(r.telebirr_ref).toBe('DEI24SSS22');
    expect(r.sender_name).toContain('Daniel');
    expect(r.balance_after).toBe(3959.35);
  });

  it('parses the Amharic received format', () => {
    const r = parseTelebirrSms(AMHARIC_RECEIVED);
    expect(r.parsed).toBe(true);
    expect(r.amount).toBe(570);
    expect(r.telebirr_ref).toBe('DH87MOJD7R');
    expect(r.sender_name).toBe('Rihan Sultan');
    expect(r.balance_after).toBe(4969.93);
    expect(r.sender_phone).toBe('2519****1374');
    expect(r.date).toBe('08/08/2026');
    expect(r.time).toBe('18:08:10');
  });

  it('rejects an Amharic sent/debit SMS (never queued as a deposit)', () => {
    const r = parseTelebirrSms(
      'ወደ Abebe Kebede(2519****0964) 200.00 ብር በ 08/08/2026 10:00:00 ልከዋል፡፡ የሂሳብ እንቅስቃሴ ቁጥርዎ AB12CD34EF ነዉ፡፡'
    );
    expect(r.parsed).toBe(false);
  });

  it('rejects SMS matching neither format', () => {
    const r = parseTelebirrSms('Selam! Your OTP code is 123456.');
    expect(r.parsed).toBe(false);
  });
});
