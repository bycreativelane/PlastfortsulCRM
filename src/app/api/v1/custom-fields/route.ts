// ============================================================
// GET /api/v1/custom-fields — the account's custom field definitions
//                             (scope: fields:read)
//
// The id-lookup nobody could do before.
//
// Writing a custom value — through this API or through an automation —
// needs the field's UUID, and there was no way to learn one except
// reading it out of a URL in the browser. That turned "grave o gclid no
// campo Origem" into a copy-paste from a screen, which is exactly the
// kind of step that makes an integration undocumentable.
//
// Read-only on purpose. Creating a field is a schema decision for the
// account, made once, on a screen where somebody can see what already
// exists — not something an integration should do on the fly and
// certainly not twice under two spellings.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'fields:read');

    const { data, error } = await ctx.supabase
      .from('custom_fields')
      .select('id, field_name, field_type, field_options, created_at')
      .eq('account_id', ctx.accountId)
      .order('field_name');

    if (error) return toApiErrorResponse(error);

    return ok({
      custom_fields: (data ?? []).map((row) => {
        const field = row as {
          id: string;
          field_name: string;
          field_type: string;
          field_options: unknown;
          created_at: string;
        };
        return {
          id: field.id,
          name: field.field_name,
          type: field.field_type,
          options: field.field_options ?? null,
          created_at: field.created_at,
          // The exact string an automation's `update_contact_field`
          // wants. Publishing the encoding means an integrator never has
          // to know it — and means changing it later is a change in one
          // place rather than in everybody's n8n flow.
          automation_field_key: `custom:${field.id}`,
        };
      }),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
