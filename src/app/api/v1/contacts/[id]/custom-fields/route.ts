// ============================================================
// GET /api/v1/contacts/<id>/custom-fields  (scope: contacts:read)
// PUT /api/v1/contacts/<id>/custom-fields  (scope: contacts:write)
//
// The values behind the definitions `/v1/custom-fields` lists.
//
// A SEPARATE ROUTE, not a field on the contact body, and the reason is
// the shape: custom values live in their own table, keyed by
// (contact, field). Folding them into `PATCH /v1/contacts` would make
// one request write two tables with two failure modes and no way to
// report which half succeeded.
//
// PUT and not PATCH: the body is the set of values to write, and each
// key is set outright. Fields the body does not name are LEFT ALONE —
// so a caller updating `gclid` cannot blank `utm_campaign` by omission,
// which is the mistake a real PUT would invite.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

/** `{ "<field_id>": "value" }` — ids come from GET /v1/custom-fields. */
type ValuesBody = Record<string, unknown>;

async function ownedContact(
  ctx: { supabase: import('@supabase/supabase-js').SupabaseClient; accountId: string },
  contactId: string
): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', ctx.accountId)
    .maybeSingle();
  return !!data;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;

    if (!(await ownedContact(ctx, id))) {
      return fail('not_found', 'contact not found', 404);
    }

    const { data, error } = await ctx.supabase
      .from('contact_custom_values')
      .select('custom_field_id, value, custom_fields!inner(field_name, account_id)')
      .eq('contact_id', id);

    if (error) return toApiErrorResponse(error);

    const rows = (data ?? []) as {
      custom_field_id: string;
      value: string | null;
      custom_fields: { field_name: string; account_id: string } | { field_name: string; account_id: string }[];
    }[];

    return ok({
      custom_fields: rows
        .map((row) => {
          const def = Array.isArray(row.custom_fields)
            ? row.custom_fields[0]
            : row.custom_fields;
          return { def, row };
        })
        // Defence in depth: the client is service-role, so a value whose
        // definition belongs to another account would otherwise come
        // back on this account's contact.
        .filter(({ def }) => def?.account_id === ctx.accountId)
        .map(({ def, row }) => ({
          id: row.custom_field_id,
          name: def.field_name,
          value: row.value,
        })),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;

    if (!(await ownedContact(ctx, id))) {
      return fail('not_found', 'contact not found', 404);
    }

    const body = (await request.json().catch(() => null)) as ValuesBody | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail('invalid_request', 'body must be an object of field id → value', 400);
    }

    const entries = Object.entries(body).slice(0, 50);
    if (entries.length === 0) return ok({ written: 0 });

    // EVERY FIELD ID IS CHECKED AGAINST THIS ACCOUNT, in one query.
    //
    // The client bypasses RLS, so an id from another account would
    // otherwise write a value that this account can neither see nor
    // clean up — and `contact_custom_values` has no `account_id` of its
    // own to catch it.
    const { data: fields } = await ctx.supabase
      .from('custom_fields')
      .select('id')
      .eq('account_id', ctx.accountId)
      .in(
        'id',
        entries.map(([fieldId]) => fieldId)
      );

    const known = new Set(((fields ?? []) as { id: string }[]).map((f) => f.id));
    const unknown = entries
      .map(([fieldId]) => fieldId)
      .filter((fieldId) => !known.has(fieldId));

    // Named, rather than skipped quietly. A caller whose `gclid` never
    // appears has no way to tell "wrong id" from "wrote fine but the
    // screen does not show it", and would look in the wrong place for
    // an hour.
    if (unknown.length > 0) {
      return fail(
        'invalid_request',
        `unknown custom field ids: ${unknown.join(', ')}`,
        400
      );
    }

    const rows = entries.map(([fieldId, value]) => ({
      contact_id: id,
      custom_field_id: fieldId,
      value:
        value === null || value === undefined
          ? null
          : String(value).slice(0, 5_000),
    }));

    const { error } = await ctx.supabase
      .from('contact_custom_values')
      .upsert(rows, { onConflict: 'contact_id,custom_field_id' });

    if (error) return toApiErrorResponse(error);
    return ok({ written: rows.length });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
