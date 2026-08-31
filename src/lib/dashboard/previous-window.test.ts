import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadConversationsPrevious } from './queries'
import { daysAgoStart } from './date-utils'
import { periodFromDates, periodFromPreset } from './period'

/**
 * The window arithmetic, which is the whole risk in this function.
 *
 * A comparison against "the period before" is only worth printing if the
 * two periods are the same length and do not overlap. Off by one day at
 * either edge and the chart quietly reports a change that is an artefact
 * of the bounds — the kind of wrong that looks completely plausible.
 *
 * The arithmetic itself moved to `previousPeriod` when the custom range
 * landed (`period.test.ts` pins it directly). What is checked HERE is
 * that the query actually asks the database for that window — the rule
 * and its application are two different things to get wrong.
 */
function captureDb(rows: unknown[]) {
  const calls: { gte?: string; lt?: string; ordered?: string; paged?: boolean } =
    {}
  const chain = {
    from: () => chain,
    select: () => chain,
    gte: (_col: string, v: string) => {
      calls.gte = v
      return chain
    },
    lt: (_col: string, v: string) => {
      calls.lt = v
      return chain
    },
    order: (col: string) => {
      calls.ordered = col
      return chain
    },
    // The loader pages through `range()`; one short page ends it.
    range: () => {
      calls.paged = true
      return Promise.resolve({ data: rows, error: null })
    },
  }
  return { db: chain as unknown as SupabaseClient, calls }
}

describe('loadConversationsPrevious', () => {
  it('ends exactly where the visible window begins', async () => {
    const { db, calls } = captureDb([])
    await loadConversationsPrevious(db, periodFromPreset(30))
    expect(calls.lt).toBe(daysAgoStart(29).toISOString())
  })

  /**
   * The one that matters.
   *
   * The visible window is 29 whole days plus however much of today has
   * happened. Measuring the previous one in whole days instead would
   * make it LONGER than the thing it is compared against, and the chart
   * would report a fall every morning that is nothing but the clock.
   */
  it('is exactly as long as the window it is compared against', async () => {
    for (const range of [7, 30, 90] as const) {
      const { db, calls } = captureDb([])
      const before = Date.now()
      await loadConversationsPrevious(db, periodFromPreset(range))
      const after = Date.now()

      const previousSpan =
        new Date(calls.lt!).getTime() - new Date(calls.gte!).getTime()
      const visibleStart = daysAgoStart(range - 1).getTime()

      // The visible span is measured against the clock, which moved a
      // millisecond or two while the call ran — so it is bracketed
      // rather than asserted exactly.
      expect(previousSpan).toBeGreaterThanOrEqual(before - visibleStart)
      expect(previousSpan).toBeLessThanOrEqual(after - visibleStart)
    }
  })

  it('the upper bound is exclusive, so no message is counted twice', async () => {
    const { db, calls } = captureDb([])
    await loadConversationsPrevious(db, periodFromPreset(7))
    // `lt`, never `lte`: a message exactly on the boundary belongs to
    // the period being reported, not to the one it is measured against.
    expect(calls.lt).toBeDefined()
    expect(calls.gte).not.toBe(calls.lt)
  })

  /**
   * A hand-picked window gets the same treatment, which is the reason the
   * arithmetic moved out of here: a period ending in the past cannot be
   * expressed as a count of days back from now, and the comparison had to
   * keep working for it without being written a second time.
   */
  it('compares a hand-picked month against the month-length before it', async () => {
    const result = periodFromDates('2026-07-01', '2026-07-31')
    if (!result.ok) throw new Error('unreachable')

    const { db, calls } = captureDb([])
    await loadConversationsPrevious(db, result.period)

    // Ends where July begins…
    expect(calls.lt).toBe(result.period.from.toISOString())
    // …and is exactly as long as July.
    const span = new Date(calls.lt!).getTime() - new Date(calls.gte!).getTime()
    expect(span).toBe(
      result.period.to.getTime() - result.period.from.getTime()
    )
  })

  /**
   * `range()` is OFFSET/LIMIT, and Postgres promises no row order without
   * an ORDER BY — so two pages of an unordered query can repeat one row
   * and skip another. This function COUNTS rows, and that count is the
   * baseline the chart's +/-% is measured against, so an unordered page
   * is a wrong number rather than a wrong order.
   *
   * It shipped unordered. Only above a thousand rows in the comparison
   * window, and entirely invisible when it happened.
   */
  it('pages an ORDERED query, or the counts are wrong', async () => {
    const { db, calls } = captureDb([])
    await loadConversationsPrevious(db, periodFromPreset(30))
    expect(calls.paged).toBe(true)
    expect(calls.ordered).toBe('created_at')
  })

  it('splits customer messages from ours', async () => {
    const { db } = captureDb([
      { sender_type: 'customer' },
      { sender_type: 'customer' },
      { sender_type: 'agent' },
      // Bot counts as outgoing, same rule the visible series uses: from
      // the customer's side there is one number, and it is not them.
      { sender_type: 'bot' },
    ])
    await expect(
      loadConversationsPrevious(db, periodFromPreset(7))
    ).resolves.toEqual({ incoming: 2, outgoing: 2 })
  })

  it('a period with nothing in it is zero, not an error', async () => {
    const { db } = captureDb([])
    await expect(
      loadConversationsPrevious(db, periodFromPreset(30))
    ).resolves.toEqual({ incoming: 0, outgoing: 0 })
  })
})
