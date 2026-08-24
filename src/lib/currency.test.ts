import { describe, expect, it } from 'vitest';
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  formatCurrency,
  formatCurrencyShort,
} from './currency';

/**
 * Digits only, separators stripped.
 *
 * `formatCurrency` renders in `APP_LOCALE` — the language the INSTANCE is
 * configured for, not the viewer's browser. It used to pass `undefined`,
 * which follows the browser, and that produced two spellings of the same
 * number on one screen: a deal card grouped 143123421 as "143,123,421" for
 * an operator with an en-US Chrome while the field they had typed it into
 * grouped it "143.123.421" from the message catalogue.
 *
 * The separator is still not asserted here. `NEXT_PUBLIC_APP_LOCALE` is unset
 * under vitest, so these run at the 'en' default; pinning the en-US spelling
 * would make the suite fail the moment someone runs it with the app's own
 * .env loaded. Comparing digits tests the thing we actually care about — the
 * amount rendered, and rendered without minor units — in every locale.
 */
function digitsOf(formatted: string): string {
  return formatted.replace(/\D/g, '');
}

describe('formatCurrency', () => {
  it('formats whole amounts with no minor units', () => {
    // Exactly "1234": minor units would make it "123400".
    expect(digitsOf(formatCurrency(1234, 'USD'))).toBe('1234');
  });

  it('defaults to USD when no currency is given', () => {
    expect(formatCurrency(10)).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('treats an empty-string currency as the default', () => {
    expect(formatCurrency(10, '')).toBe(formatCurrency(10, DEFAULT_CURRENCY));
  });

  it('coerces non-finite values to 0', () => {
    expect(formatCurrency(Number.NaN, 'USD')).toContain('0');
  });

  it('renders a well-formed but unknown ISO code without throwing', () => {
    // Intl is lenient here — it uses the code as the symbol.
    const out = formatCurrency(1234, 'ZZZ');
    expect(out).toContain('ZZZ');
    expect(digitsOf(out)).toBe('1234');
  });

  it('never throws on a structurally invalid code (no DB CHECK on deals.currency)', () => {
    for (const bad of ['United States', 'US', 'USDD', '12', 'u$d']) {
      expect(() => formatCurrency(1234, bad)).not.toThrow();
      // digitsOf, not toBe: a numeric code like "12" contributes digits
      // of its own to the fallback string.
      expect(digitsOf(formatCurrency(1234, bad))).toContain('1234');
    }
  });

  it('formats every offered currency without throwing', () => {
    for (const c of CURRENCIES) {
      expect(() => formatCurrency(1000, c.code)).not.toThrow();
    }
  });
});

describe('formatCurrencyShort', () => {
  it('abbreviates millions and thousands with the currency symbol', () => {
    expect(formatCurrencyShort(2_500_000, 'USD')).toBe('$2.5M');
    expect(formatCurrencyShort(3_400, 'USD')).toBe('$3.4k');
    expect(formatCurrencyShort(900, 'USD')).toBe('$900');
  });

  it('uses the matching symbol for non-USD currencies', () => {
    expect(formatCurrencyShort(1_000, 'EUR')).toBe('€1.0k');
    expect(formatCurrencyShort(1_000, 'INR')).toBe('₹1.0k');
  });

  it('falls back to the code prefix for unknown currencies (no throw)', () => {
    expect(formatCurrencyShort(1_000, 'ZZZ')).toBe('ZZZ 1.0k');
  });
});
