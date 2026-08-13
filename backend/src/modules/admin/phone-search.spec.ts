import { describe, expect, it } from 'vitest';

import { phoneSearchPattern, phoneDigitsSql } from './admin-shared';

describe('phoneSearchPattern', () => {
  it('strips the Ethiopian country code from full international numbers', () => {
    expect(phoneSearchPattern('+251911223344')).toBe('%911223344%');
    expect(phoneSearchPattern('251911223344')).toBe('%911223344%');
  });

  it('strips the trunk 0 from local-format numbers', () => {
    expect(phoneSearchPattern('0911223344')).toBe('%911223344%');
  });

  it('makes all common Ethiopian formats produce the same pattern', () => {
    const expected = '%911223344%';
    for (const input of [
      '+251911223344',
      '251911223344',
      '0911223344',
      '911223344',
      '+251 91 122 3344',
      '0911-22-33-44',
    ]) {
      expect(phoneSearchPattern(input)).toBe(expected);
    }
  });

  it('keeps partial searches usable', () => {
    expect(phoneSearchPattern('0911')).toBe('%911%');
    expect(phoneSearchPattern('911')).toBe('%911%');
  });

  it('does not strip a short 251… prefix that is not a country code', () => {
    // Too short to be a full international number — treat digits literally.
    expect(phoneSearchPattern('2519')).toBe('%2519%');
  });

  it('returns null when the input has no digits', () => {
    expect(phoneSearchPattern('')).toBeNull();
    expect(phoneSearchPattern('abc')).toBeNull();
    expect(phoneSearchPattern('+-() ')).toBeNull();
  });

  it('leaves non-Ethiopian international numbers intact', () => {
    expect(phoneSearchPattern('+1 (555) 123-4567')).toBe('%15551234567%');
  });
});

describe('phoneDigitsSql', () => {
  it('builds a digits-only LIKE fragment for the given column and param', () => {
    expect(phoneDigitsSql('u.phone', 3)).toBe(
      `regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $3`
    );
  });
});
