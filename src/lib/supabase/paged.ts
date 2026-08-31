/**
 * Read every row a filter matches, in pages.
 *
 * ------------------------------------------------------------------
 * WHY THIS EXISTS
 * ------------------------------------------------------------------
 *
 * PostgREST caps a response at `db-max-rows` and does NOT say it
 * truncated: the request succeeds and the array is simply short. A
 * reporting query that buckets rows in the browser therefore produces a
 * believable, wrong chart rather than an error — the worst failure a
 * number can have, because nothing anywhere says it happened.
 *
 * At seven days that never bit. The custom period on Relatórios allows
 * up to a year, so it would.
 *
 * ------------------------------------------------------------------
 * TWO RULES, AND BOTH ARE LOAD-BEARING
 * ------------------------------------------------------------------
 *
 * 1. THE QUERY MUST BE ORDERED. `range()` is OFFSET/LIMIT, and Postgres
 *    promises no row order without an ORDER BY — so two pages of an
 *    unordered query can repeat one row and skip another. For a caller
 *    that counts rows that is a wrong total, not a wrong order. This
 *    cannot be enforced from here, so it is the caller's contract and
 *    it is stated at every call site.
 *
 * 2. THE CEILING IS LOUD. Stopping quietly at the last page would
 *    reintroduce the exact bug this function exists to remove, just at a
 *    higher threshold. Hitting it throws, and a caller is expected to
 *    turn that into something a person can read — "the period is too
 *    big to add up here" is a true sentence; a chart that is missing
 *    four fifths of its data is not.
 */

export const PAGE_SIZE = 1000;

/** Beyond this, a report is the wrong tool and an aggregate is the right one. */
export const MAX_PAGES = 40;

export class TooManyRowsError extends Error {
  constructor(readonly rowsRead: number) {
    super(`Refusing to read past ${rowsRead} rows`);
    this.name = 'TooManyRowsError';
  }
}

type PageResult = { data: unknown; error: unknown };

/**
 * @param build Called once per page with an inclusive `[from, to]` row
 *   range. It MUST apply a stable `.order(...)` — see rule 1 above.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult>
): Promise<T[]> {
  const all: T[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_SIZE;
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;

    const rows = (data ?? []) as T[];
    all.push(...rows);

    // A short page is the only reliable end signal. An exact multiple of
    // the page size costs one extra empty request, which is the cheap
    // side of the trade.
    if (rows.length < PAGE_SIZE) return all;
  }

  throw new TooManyRowsError(all.length);
}
