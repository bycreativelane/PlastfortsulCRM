import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEGMENTATION,
  applySegmentation,
  idleCutoff,
  isSegmentationActive,
  type FilterTarget,
  type Segmentation,
} from './segmentation';

/** Records the calls a real PostgREST builder would receive. */
type Call = [method: string, ...args: unknown[]];

/** A builder that is its own return type — declared, not inferred, because
 *  `typeof target` inside its own annotation is circular. */
type SpyTarget = FilterTarget<SpyTarget>;

function spy() {
  const calls: Call[] = [];
  const target: SpyTarget = {
    eq(c, v) {
      calls.push(['eq', c, v]);
      return target;
    },
    is(c, v) {
      calls.push(['is', c, v]);
      return target;
    },
    not(c, op, v) {
      calls.push(['not', c, op, v]);
      return target;
    },
    lt(c, v) {
      calls.push(['lt', c, v]);
      return target;
    },
  };
  return { target, calls };
}

const seg = (over: Partial<Segmentation> = {}): Segmentation => ({
  ...EMPTY_SEGMENTATION,
  ...over,
});

// Local-time constructor: the date-only form parses as UTC and would shift
// the cutoff by the runner's offset.
const NOW = new Date('2026-05-18T12:00:00');

describe('idleCutoff', () => {
  it('counts back from the start of today', () => {
    expect(idleCutoff(60, NOW)).toBe('2026-03-19');
  });

  it('returns today for zero', () => {
    expect(idleCutoff(0, NOW)).toBe('2026-05-18');
  });

  it('crosses a month boundary', () => {
    expect(idleCutoff(30, new Date('2026-03-05T09:00:00'))).toBe('2026-02-03');
  });
});

describe('applySegmentation', () => {
  it('excludes opted-out contacts by default', () => {
    // The safe setting has to be the default. Making somebody remember to
    // switch it on is how a person who asked to be left alone gets messaged.
    const { target, calls } = spy();
    applySegmentation(target, EMPTY_SEGMENTATION, NOW);
    expect(calls).toContainEqual(['eq', 'opted_out', false]);
  });

  it('can be told to include them', () => {
    const { target, calls } = spy();
    applySegmentation(target, seg({ excludeOptedOut: false }), NOW);
    expect(calls.some(([, c]) => c === 'opted_out')).toBe(false);
  });

  it('filters city and state exactly', () => {
    const { target, calls } = spy();
    applySegmentation(target, seg({ city: 'Porto Alegre', state: 'RS' }), NOW);
    expect(calls).toContainEqual(['eq', 'state', 'RS']);
    expect(calls).toContainEqual(['eq', 'city', 'Porto Alegre']);
  });

  it("'never bought' asks for a null purchase date", () => {
    const { target, calls } = spy();
    applySegmentation(target, seg({ purchase: 'never' }), NOW);
    expect(calls).toContainEqual(['is', 'last_purchase_at', null]);
  });

  it("'bought' asks for a non-null purchase date", () => {
    const { target, calls } = spy();
    applySegmentation(target, seg({ purchase: 'bought' }), NOW);
    expect(calls).toContainEqual(['not', 'last_purchase_at', 'is', null]);
  });

  it('idle implies having bought at all', () => {
    // Somebody who never bought is not idle, they are new. Both conditions
    // have to go on the wire.
    const { target, calls } = spy();
    applySegmentation(target, seg({ idleDays: 60 }), NOW);
    expect(calls).toContainEqual(['not', 'last_purchase_at', 'is', null]);
    expect(calls).toContainEqual(['lt', 'last_purchase_at', '2026-03-19']);
  });

  it('adds nothing for idleDays of zero', () => {
    const { target, calls } = spy();
    applySegmentation(target, seg({ idleDays: 0 }), NOW);
    expect(calls.some(([m]) => m === 'lt')).toBe(false);
  });

  it('composes every filter at once', () => {
    const { target, calls } = spy();
    applySegmentation(
      target,
      seg({
        purchase: 'bought',
        idleDays: 90,
        city: 'Caxias do Sul',
        state: 'RS',
      }),
      NOW
    );
    expect(calls).toEqual([
      ['eq', 'opted_out', false],
      ['eq', 'state', 'RS'],
      ['eq', 'city', 'Caxias do Sul'],
      ['not', 'last_purchase_at', 'is', null],
      ['not', 'last_purchase_at', 'is', null],
      ['lt', 'last_purchase_at', '2026-02-17'],
    ]);
  });
});

describe('isSegmentationActive', () => {
  it('is false for the defaults', () => {
    // Excluding opt-outs is the default, so it must not light up Clear —
    // a button that is always active is a button nobody reads.
    expect(isSegmentationActive(EMPTY_SEGMENTATION)).toBe(false);
  });

  it('is true once anything is narrowed', () => {
    for (const over of [
      { purchase: 'never' as const },
      { idleDays: 30 },
      { city: 'Porto Alegre' },
      { state: 'RS' },
      { excludeOptedOut: false },
    ]) {
      expect(isSegmentationActive(seg(over)), JSON.stringify(over)).toBe(true);
    }
  });
});
