import { describe, it, expect } from 'vitest';

import { median, responseTimesByAgent, scoreFor } from './performance';

/**
 * The arithmetic behind who gets the next conversation.
 *
 * Every one of these fails silently when it is wrong — a score is just
 * a number, and a wrong one looks exactly like a right one until
 * somebody notices the work is going to the wrong person for a month.
 */

const at = (minutes: number) =>
  new Date(Date.UTC(2026, 7, 1, 12, minutes)).toISOString();

const customer = (conversation: string, minutes: number) => ({
  conversation_id: conversation,
  sender_type: 'customer',
  sender_id: null,
  created_at: at(minutes),
});

const agent = (conversation: string, who: string, minutes: number) => ({
  conversation_id: conversation,
  sender_type: 'agent',
  sender_id: who,
  created_at: at(minutes),
});

describe('responseTimesByAgent', () => {
  it('measures from the customer message to the reply', () => {
    const times = responseTimesByAgent([
      customer('c1', 0),
      agent('c1', 'ana', 7),
    ]);
    expect(times.get('ana')).toEqual([7]);
  });

  /**
   * A burst of customer messages is ONE wait, and it starts at the
   * first. Measuring from the last would make a slow reply to an
   * impatient customer look fast — the opposite of what happened.
   */
  it('counts a burst of customer messages as one wait, from the first', () => {
    const times = responseTimesByAgent([
      customer('c1', 0),
      customer('c1', 2),
      customer('c1', 5),
      agent('c1', 'ana', 10),
    ]);
    expect(times.get('ana')).toEqual([10]);
  });

  /**
   * Three messages in a row is one answer and two follow-ups. Counting
   * all three would reward talking rather than answering.
   */
  it('does not count follow-ups as responses', () => {
    const times = responseTimesByAgent([
      customer('c1', 0),
      agent('c1', 'ana', 4),
      agent('c1', 'ana', 5),
      agent('c1', 'ana', 6),
    ]);
    expect(times.get('ana')).toEqual([4]);
  });

  /**
   * An auto-reply has answered nobody — the same rule the Esperando
   * queue applies. If a bot reply cleared the wait, the human who
   * actually answered would get credit for the gap after the bot,
   * which is somebody else's speed.
   */
  it('a bot reply neither scores nor clears the wait', () => {
    const times = responseTimesByAgent([
      customer('c1', 0),
      { conversation_id: 'c1', sender_type: 'bot', sender_id: null, created_at: at(1) },
      agent('c1', 'ana', 9),
    ]);
    expect(times.get('ana')).toEqual([9]);
  });

  it('keeps conversations apart', () => {
    const times = responseTimesByAgent([
      customer('c1', 0),
      customer('c2', 0),
      agent('c2', 'ana', 3),
      agent('c1', 'ana', 20),
    ]);
    expect(times.get('ana')?.sort((a, b) => a - b)).toEqual([3, 20]);
  });

  it('ignores an agent message nobody was waiting for', () => {
    // An outbound-first conversation: the business wrote first.
    const times = responseTimesByAgent([agent('c1', 'ana', 0)]);
    expect(times.get('ana')).toBeUndefined();
  });

  it('drops a negative gap rather than letting it pull the median', () => {
    const times = responseTimesByAgent([
      customer('c1', 10),
      { ...agent('c1', 'ana', 0) }, // clock skew / backfill
    ]);
    expect(times.get('ana') ?? []).toEqual([]);
  });
});

describe('median', () => {
  it('is the middle of an odd sample', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the two middles of an even sample', () => {
    expect(median([1, 3, 5, 7])).toBe(4);
  });

  it('is null with nothing to measure', () => {
    expect(median([])).toBeNull();
  });

  /**
   * THE WHOLE REASON IT IS A MEDIAN.
   *
   * One conversation answered Monday morning after sitting all weekend
   * drags the mean of ten four-minute replies to three hundred. The
   * median moves by one position.
   */
  it('survives one weekend-long outlier that would wreck an average', () => {
    const values = [4, 4, 4, 4, 4, 4, 4, 4, 4, 3000];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(300);
    expect(median(values)).toBe(4);
  });
});

describe('scoreFor', () => {
  it('is null when there is nothing to go on', () => {
    expect(scoreFor(null, null)).toBeNull();
  });

  it('gives full marks for answering inside the target', () => {
    expect(scoreFor(1, 1)).toBe(100);
    expect(scoreFor(5, 1)).toBe(100);
  });

  it('falls as the reply gets slower', () => {
    const fast = scoreFor(5, 0.5)!;
    const slower = scoreFor(30, 0.5)!;
    const slowest = scoreFor(120, 0.5)!;
    expect(fast).toBeGreaterThan(slower);
    expect(slower).toBeGreaterThan(slowest);
  });

  it('never goes below zero, however slow', () => {
    expect(scoreFor(100_000, 0)).toBe(0);
  });

  /**
   * Resolution outweighs speed, 60/40. A router optimising purely for
   * speed would send everything to whoever answers fastest — and the
   * fastest way to answer is to say something, not to finish anything.
   */
  it('prefers finishing over answering fast', () => {
    const fastAndUnfinished = scoreFor(1, 0)!;
    const slowAndFinished = scoreFor(60, 1)!;
    expect(slowAndFinished).toBeGreaterThan(fastAndUnfinished);
  });

  /**
   * Somebody with replies but nothing closed yet must not rank BELOW
   * somebody with no data at all — that would make a new hire's first
   * week a penalty.
   */
  it('treats a missing half as neutral, not as zero', () => {
    expect(scoreFor(5, null)!).toBeGreaterThan(scoreFor(5, 0)!);
  });
});
