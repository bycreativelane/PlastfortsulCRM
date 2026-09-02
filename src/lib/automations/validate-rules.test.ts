import { describe, expect, it } from 'vitest';

import {
  collectActivationWarnings,
  validateAutomationSettings,
  validateStepsForActivation,
  validateTriggerForActivation,
} from './validate';

const paths = (issues: { path: string }[]) => issues.map((i) => i.path).sort();

describe('the steps of migration 065', () => {
  it('move_deal_stage needs a stage', () => {
    expect(
      paths(
        validateStepsForActivation([
          { step_type: 'move_deal_stage', step_config: {} },
        ])
      )
    ).toEqual(['steps[0].stage_id']);
    expect(
      validateStepsForActivation([
        { step_type: 'move_deal_stage', step_config: { stage_id: 's1' } },
      ])
    ).toEqual([]);
  });

  it('update_deal accepts the four deal fields and nothing else', () => {
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'update_deal',
            step_config: { field: 'owner', value: 'x' },
          },
        ])
      )
    ).toEqual(['steps[0].field']);
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'update_deal',
            step_config: { field: 'notes', value: '' },
          },
        ])
      )
    ).toEqual(['steps[0].value']);
  });

  it('cancel_automations and end need nothing beyond a sane scope', () => {
    expect(
      validateStepsForActivation([
        { step_type: 'cancel_automations', step_config: { scope: 'contact' } },
        { step_type: 'end', step_config: {} },
      ])
    ).toEqual([]);
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'cancel_automations',
            step_config: { scope: 'everyone' },
          },
        ])
      )
    ).toEqual(['steps[0].scope']);
  });

  it('a wait until a contact date validates the field and the time, not the amount', () => {
    expect(
      validateStepsForActivation([
        {
          step_type: 'wait',
          step_config: {
            mode: 'until_contact_date',
            field: 'next_purchase_expected_at',
            at: '09:00',
          },
        },
      ])
    ).toEqual([]);
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'wait',
            step_config: {
              mode: 'until_contact_date',
              field: 'created_at',
              at: '25:00',
            },
          },
        ])
      )
    ).toEqual(['steps[0].at', 'steps[0].field']);
  });

  it('the deal conditions ask for what they need and no operand otherwise', () => {
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'condition',
            step_config: { subject: 'deal_in_stage', stage_ids: [] },
          },
        ])
      )
    ).toEqual(['steps[0].stage_ids']);
    expect(
      validateStepsForActivation([
        {
          step_type: 'condition',
          step_config: { subject: 'deal_in_stage', stage_ids: ['s1'] },
        },
        { step_type: 'condition', step_config: { subject: 'deal_is_open' } },
        {
          step_type: 'condition',
          step_config: {
            subject: 'customer_replied_since',
            operand: 'run_start',
          },
        },
      ])
    ).toEqual([]);
    expect(
      paths(
        validateStepsForActivation([
          {
            step_type: 'condition',
            step_config: {
              subject: 'customer_replied_since',
              operand: 'yesterday',
            },
          },
        ])
      )
    ).toEqual(['steps[0].operand']);
  });
});

describe('the triggers of migration 065', () => {
  it('deal_stage_entered needs a stage', () => {
    expect(
      paths(validateTriggerForActivation('deal_stage_entered', {}))
    ).toEqual(['trigger.stage_id']);
    expect(
      validateTriggerForActivation('deal_stage_entered', { stage_id: 's1' })
    ).toEqual([]);
  });

  it('team_message_sent needs a quick reply or a template', () => {
    expect(
      paths(validateTriggerForActivation('team_message_sent', {}))
    ).toEqual(['trigger.quick_reply_id']);
    expect(
      validateTriggerForActivation('team_message_sent', {
        template_name: 'orcamento_enviado',
      })
    ).toEqual([]);
  });

  it('date_field_reached needs a known field and a real time', () => {
    expect(
      paths(
        validateTriggerForActivation('date_field_reached', {
          field: 'created_at',
          at: '9h',
        })
      )
    ).toEqual(['trigger.at', 'trigger.field']);
    expect(
      validateTriggerForActivation('date_field_reached', {
        field: 'birthday',
        at: '09:00',
      })
    ).toEqual([]);
  });
});

describe('validateAutomationSettings', () => {
  it('accepts the defaults and a full rule set', () => {
    expect(validateAutomationSettings({})).toEqual([]);
    expect(
      validateAutomationSettings({
        pipeline_id: 'p1',
        cancel_on_reply: true,
        cancel_when_stage_in: ['s1', 's2'],
        reentry_policy: 'after_days',
        reentry_days: 30,
      })
    ).toEqual([]);
  });

  it('rejects a malformed stage list, an unknown policy, and after_days without days', () => {
    expect(
      paths(
        validateAutomationSettings({
          cancel_when_stage_in: ['s1', ''],
          reentry_policy: 'sometimes',
        })
      )
    ).toEqual(['cancel_when_stage_in', 'reentry_policy']);
    expect(
      paths(
        validateAutomationSettings({
          reentry_policy: 'after_days',
          reentry_days: 0,
        })
      )
    ).toEqual(['reentry_days']);
  });
});

describe('collectActivationWarnings', () => {
  it('warns about a plain message a day or more after a wait', () => {
    const warnings = collectActivationWarnings([
      { step_type: 'wait', step_config: { amount: 1, unit: 'days' } },
      { step_type: 'send_message', step_config: { text: 'oi' } },
    ]);
    expect(warnings.map((w) => w.path)).toEqual(['steps[1].text']);
  });

  it('does not warn below 24 h, nor for a template', () => {
    expect(
      collectActivationWarnings([
        { step_type: 'wait', step_config: { amount: 23, unit: 'hours' } },
        { step_type: 'send_message', step_config: { text: 'oi' } },
      ])
    ).toEqual([]);
    expect(
      collectActivationWarnings([
        { step_type: 'wait', step_config: { amount: 3, unit: 'days' } },
        {
          step_type: 'send_template',
          step_config: { template_name: 'followup_d3' },
        },
      ])
    ).toEqual([]);
  });

  it('adds waits up and looks inside branches', () => {
    const warnings = collectActivationWarnings([
      { step_type: 'wait', step_config: { amount: 12, unit: 'hours' } },
      { step_type: 'wait', step_config: { amount: 12, unit: 'hours' } },
      {
        step_type: 'condition',
        step_config: { subject: 'deal_is_open' },
        branches: {
          yes: [{ step_type: 'send_message', step_config: { text: 'oi' } }],
          no: [],
        },
      },
    ]);
    expect(warnings.map((w) => w.path)).toEqual(['steps[2].yes.steps[0].text']);
  });
});
