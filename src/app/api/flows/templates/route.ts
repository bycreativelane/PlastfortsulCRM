import { NextResponse } from 'next/server'
import { getMessages } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import {
  listFlowTemplates,
  localizeFlowTemplate,
  type FlowTemplateCatalogue,
} from '@/lib/flows/templates'

/**
 * GET /api/flows/templates
 *
 * Returns the static template gallery (slug + name + description +
 * icon hint + node_count) so the New-flow dialog can render cards
 * without bundling the full template payloads client-side. Bodies
 * are fetched only on actual clone via POST /api/flows.
 *
 * Available to any signed-in user. Flows is in soft-GA.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Localised here rather than in the gallery: the client would
  // otherwise need the catalogue AND the knowledge that a template's
  // name is not the name the API sent it.
  const catalogue = (await getMessages()) as unknown as {
    Flows?: { templates?: FlowTemplateCatalogue }
  }
  const copy = catalogue?.Flows?.templates

  // Shallow shape so the client gallery doesn't have to know about
  // the full node tree.
  const templates = listFlowTemplates().map((template) => {
    const t = localizeFlowTemplate(template, copy)
    return {
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      trigger_type: t.trigger_type,
      node_count: t.nodes.length,
    }
  })
  return NextResponse.json({ templates })
}
