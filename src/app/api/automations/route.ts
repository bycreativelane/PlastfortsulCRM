import { NextResponse } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { createClient } from '@/lib/supabase/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getTemplate, localizeTemplate } from '@/lib/automations/templates';
import {
  insertSteps,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree';
import {
  collectActivationWarnings,
  validateAutomationSettings,
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate';
import { isUnknownColumn } from '@/lib/supabase/pg-errors';
import { readRuleFields } from '@/lib/automations/rule-fields';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .order('created_at', { ascending: false });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ automations: data ?? [] });
}

export async function POST(request: Request) {
  // Creating an automation is a write — the RLS automations_insert policy
  // requires `agent`, but this route inserts via the service-role client
  // which bypasses RLS, so the role must be enforced here.
  try {
    await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Resolve the caller's account_id — `automations.account_id` is NOT
  // NULL post-017, so an INSERT without it trips the not-null constraint
  // even though the admin client bypasses RLS.
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .single();
  const accountId = profile?.account_id as string | undefined;
  if (!accountId) {
    return NextResponse.json(
      { error: 'Your profile is not linked to an account.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const {
    name,
    description,
    trigger_type,
    trigger_config,
    is_active,
    steps,
    template,
  } = body;

  let effectiveSteps: BuilderStepInput[] | undefined = steps;
  let effectiveName = name;
  let effectiveDescription = description;
  let effectiveTriggerType = trigger_type;
  let effectiveTriggerConfig = trigger_config;

  if (template && (!steps || steps.length === 0)) {
    const def = getTemplate(template);
    if (def) {
      // Same catalogue the UI reads, so an automation created straight
      // from the API is seeded in the instance's language rather than in
      // whatever language the template file happened to be written in.
      const t = localizeTemplate(
        def,
        await getTranslations('Automations.templates')
      );
      effectiveName = effectiveName ?? t.name;
      effectiveDescription = effectiveDescription ?? t.description;
      effectiveTriggerType = effectiveTriggerType ?? t.trigger_type;
      effectiveTriggerConfig = effectiveTriggerConfig ?? t.trigger_config;
      effectiveSteps = t.steps as unknown as BuilderStepInput[];
    }
  }

  if (!effectiveName || !effectiveTriggerType) {
    return NextResponse.json(
      { error: 'name and trigger_type are required' },
      { status: 400 }
    );
  }

  // The rules are checked on every save, active or not — a malformed
  // stage list would otherwise sit in the row until the day it silently
  // cancelled nothing.
  const ruleFields = readRuleFields(body);
  const ruleIssues = validateAutomationSettings(ruleFields);
  if (ruleIssues.length > 0) {
    return NextResponse.json(
      { error: 'Invalid automation rules', issues: ruleIssues },
      { status: 400 }
    );
  }

  // Block activation of a clearly broken automation up-front instead of
  // letting every trigger silently produce a failed log row. Drafts
  // (is_active=false) are allowed to be incomplete so users can save
  // progress mid-build.
  const stepsForChecks = (effectiveSteps ?? []) as unknown as {
    step_type: string;
    step_config: Record<string, unknown>;
  }[];
  let warnings: ReturnType<typeof collectActivationWarnings> = [];
  if (is_active) {
    const issues = [
      ...validateTriggerForActivation(
        effectiveTriggerType,
        effectiveTriggerConfig ?? {}
      ),
      ...validateStepsForActivation(stepsForChecks),
    ];
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate automation with invalid configuration',
          issues,
        },
        { status: 400 }
      );
    }
    warnings = collectActivationWarnings(stepsForChecks);
  }

  const admin = supabaseAdmin();
  const baseRow = {
    user_id: user.id,
    account_id: accountId,
    name: effectiveName,
    description: effectiveDescription ?? null,
    trigger_type: effectiveTriggerType,
    trigger_config: effectiveTriggerConfig ?? {},
    is_active: !!is_active,
  };
  let { data: automation, error: insertErr } = await admin
    .from('automations')
    .insert({ ...baseRow, ...ruleFields })
    .select()
    .single();

  // Pre-065 the rule columns do not exist. Creating an automation must not
  // stop working for the day between deploying this and running the
  // migration; the rules are dropped and the row is written as before.
  if (
    insertErr &&
    Object.keys(ruleFields).length > 0 &&
    isUnknownColumn(insertErr)
  ) {
    ({ data: automation, error: insertErr } = await admin
      .from('automations')
      .insert(baseRow)
      .select()
      .single());
  }

  if (insertErr || !automation) {
    return NextResponse.json(
      { error: insertErr?.message ?? 'insert failed' },
      { status: 500 }
    );
  }

  if (effectiveSteps && effectiveSteps.length > 0) {
    const err = await insertSteps(automation.id, effectiveSteps);
    if (err) return NextResponse.json({ error: err }, { status: 500 });
  }

  return NextResponse.json({ automation, warnings }, { status: 201 });
}
