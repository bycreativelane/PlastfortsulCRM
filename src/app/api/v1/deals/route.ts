// ============================================================
// GET  /api/v1/deals — list deals   (scope: deals:read)
// POST /api/v1/deals — create one   (scope: deals:write)
//
// The endpoint whose absence blocked the whole thing.
//
// "n8n loads it through the public API" could not do the one job it was
// wanted for — open an opportunity when a lead arrives from an ad —
// because there was no deals route at all. This is it.
//
// ------------------------------------------------------------------
// THE VALUE IS NOT WRITABLE, AND THAT IS THE POINT
// ------------------------------------------------------------------
//
// `deals.value` is maintained by a trigger from `deal_items` (migration
// 054): line totals are GENERATED and their sum lands on the deal. A
// value posted here would be overwritten the moment somebody adds a
// line, and until then the report would show a number nobody can trace
// to a product.
//
// So `value` is accepted ONLY for a deal with no items — which is the
// honest version of what it always was: the number somebody typed,
// standing in until the items exist.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveAuditUserId } from '@/lib/api/v1/contacts';

const DEAL_SELECT =
  'id, title, value, currency, status, expected_close_date, notes, contact_id, pipeline_id, stage_id, created_at, updated_at, stage:pipeline_stages(id, name, position)';

interface DealRow {
  id: string;
  title: string;
  value: number | null;
  currency: string | null;
  status: string | null;
  expected_close_date: string | null;
  notes: string | null;
  contact_id: string;
  pipeline_id: string;
  stage_id: string;
  created_at: string;
  updated_at: string;
  stage?: { id: string; name: string; position: number } | { id: string; name: string; position: number }[] | null;
}

function serialize(row: DealRow) {
  const stage = Array.isArray(row.stage) ? row.stage[0] : row.stage;
  return {
    id: row.id,
    title: row.title,
    value: row.value,
    currency: row.currency,
    status: row.status,
    expected_close_date: row.expected_close_date,
    notes: row.notes,
    contact_id: row.contact_id,
    pipeline_id: row.pipeline_id,
    stage: stage
      ? { id: stage.id, name: stage.name, position: stage.position }
      : { id: row.stage_id, name: null, position: null },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const url = new URL(request.url);
    const { limit, cursor } = parseListParams(request);

    let query = ctx.supabase
      .from('deals')
      .select(DEAL_SELECT)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const contactId = url.searchParams.get('contact_id');
    if (contactId) query = query.eq('contact_id', contactId);
    const status = url.searchParams.get('status');
    if (status) query = query.eq('status', status);
    const pipelineId = url.searchParams.get('pipeline_id');
    if (pipelineId) query = query.eq('pipeline_id', pipelineId);

    // `keysetFilter` returns the PostgREST `or()` grammar, not a
    // builder — same shape the contacts route uses.
    const filter = keysetFilter(cursor);
    if (filter) query = query.or(filter);

    const { data, error } = await query;
    if (error) return toApiErrorResponse(error);

    const page = buildPage((data ?? []) as DealRow[], limit);
    return okList(page.items.map(serialize), page.nextCursor);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

interface CreateBody {
  contact_id?: unknown;
  stage_id?: unknown;
  title?: unknown;
  value?: unknown;
  currency?: unknown;
  expected_close_date?: unknown;
  notes?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const body = (await request.json().catch(() => ({}))) as CreateBody;

    const contactId =
      typeof body.contact_id === 'string' ? body.contact_id.trim() : '';
    const stageId = typeof body.stage_id === 'string' ? body.stage_id.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';

    if (!contactId) return fail('invalid_request', 'contact_id is required', 400);
    if (!stageId) return fail('invalid_request', 'stage_id is required', 400);
    if (!title) return fail('invalid_request', 'title is required', 400);

    // TENANCY, CHECKED ON BOTH REFERENCES.
    //
    // A key is scoped to one account, but `contact_id` and `stage_id`
    // arrive from the caller. Without these two lookups a valid key
    // could attach a deal to somebody else's contact, or file it in
    // another account's pipeline — a foreign UUID is not something RLS
    // catches on an INSERT whose own `account_id` is correct.
    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contact) return fail('not_found', 'contact not found', 404);

    const { data: stageRow } = await ctx.supabase
      .from('pipeline_stages')
      .select('id, pipeline_id, pipeline:pipelines!inner(id, account_id)')
      .eq('id', stageId)
      .maybeSingle();

    // PostgREST returns an embedded row as an object or an array
    // depending on the relationship it infers; both shapes appear in
    // this codebase, so neither is assumed.
    const embedded = (stageRow as { pipeline?: unknown } | null)?.pipeline;
    const pipeline = (
      Array.isArray(embedded) ? embedded[0] : embedded
    ) as { id: string; account_id: string } | undefined;

    if (!stageRow || !pipeline || pipeline.account_id !== ctx.accountId) {
      return fail('not_found', 'stage not found', 404);
    }

    // `deals.user_id` is NOT NULL and an API key is not a person, so
    // the same stand-in the contacts route uses: the account's WhatsApp
    // config owner, falling back to the account owner. Audit points at
    // somebody real rather than at a null.
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const insert: Record<string, unknown> = {
      account_id: ctx.accountId,
      user_id: auditUserId,
      contact_id: contactId,
      pipeline_id: pipeline.id,
      stage_id: stageId,
      title,
      status: 'active',
    };

    // Only when it is a number. A string "5.000,00" silently becoming
    // NaN and landing as 0 is worse than a 400.
    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value) || value < 0) {
        return fail('invalid_request', 'value must be a non-negative number', 400);
      }
      insert.value = value;
    }
    if (typeof body.currency === 'string' && body.currency.trim()) {
      insert.currency = body.currency.trim().toUpperCase().slice(0, 3);
    }
    if (typeof body.expected_close_date === 'string') {
      insert.expected_close_date = body.expected_close_date;
    }
    if (typeof body.notes === 'string') insert.notes = body.notes.slice(0, 5_000);

    const { data, error } = await ctx.supabase
      .from('deals')
      .insert(insert)
      .select(DEAL_SELECT)
      .single();

    if (error) return toApiErrorResponse(error);
    return ok({ deal: serialize(data as DealRow) }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
