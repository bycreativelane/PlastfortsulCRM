import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

import {
  AUTOMATION_TEMPLATES,
  localizeTemplate,
  type TemplateSlug,
} from './templates'

/**
 * The template definitions carry shape and no words; the words come
 * from `Automations.templates` in each catalogue. That split only holds
 * if every key a definition asks for actually exists in every locale —
 * and a missing one does not throw. next-intl renders the KEY PATH, so
 * the failure mode is a customer receiving the literal string
 * "Automations.templates.welcome_message.copy.greeting" over WhatsApp.
 *
 * These tests read the real catalogues, so adding a fifth template with
 * no `copy` entry fails here rather than in production.
 */

const LOCALES = ['pt-BR', 'en', 'ko'] as const

function catalogue(locale: string): Record<string, unknown> {
  const raw = readFileSync(
    join(process.cwd(), 'messages', `${locale}.json`),
    'utf8',
  )
  return JSON.parse(raw).Automations.templates
}

/** Mirrors what `useTranslations('Automations.templates')` resolves. */
function translator(locale: string) {
  const root = catalogue(locale)
  return (key: string): string => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        root,
      )
    if (typeof value !== 'string') {
      throw new Error(`missing key: Automations.templates.${key}`)
    }
    return value
  }
}

const SLUGS = Object.keys(AUTOMATION_TEMPLATES) as TemplateSlug[]

describe('localizeTemplate', () => {
  it.each(LOCALES)('resolves every template in %s', (locale) => {
    const t = translator(locale)
    for (const slug of SLUGS) {
      const result = localizeTemplate(AUTOMATION_TEMPLATES[slug], t)
      expect(result.name.length).toBeGreaterThan(0)
      expect(result.description.length).toBeGreaterThan(0)
    }
  })

  it.each(LOCALES)('fills every send step with real copy in %s', (locale) => {
    const t = translator(locale)
    for (const slug of SLUGS) {
      const { steps } = localizeTemplate(AUTOMATION_TEMPLATES[slug], t)
      for (const step of steps) {
        if (!step.copyKey) continue
        const text = (step.step_config as { text?: string }).text
        expect(text, `${locale}/${slug}`).toBeTruthy()
        // A key path leaking through as the value is the exact failure
        // this file exists to catch.
        expect(text).not.toContain('Automations.templates')
      }
    }
  })

  it('splits the localized keyword list into trimmed words', () => {
    const result = localizeTemplate(
      AUTOMATION_TEMPLATES.lead_qualifier,
      translator('pt-BR'),
    )
    const keywords = (result.trigger_config as { keywords?: string[] }).keywords
    expect(keywords).toBeDefined()
    expect(keywords!.length).toBeGreaterThan(1)
    for (const word of keywords!) {
      expect(word).toBe(word.trim())
      expect(word).not.toContain(',')
    }
  })

  it('leaves a template without localized keywords alone', () => {
    const def = AUTOMATION_TEMPLATES.welcome_message
    const result = localizeTemplate(def, translator('en'))
    expect(result.trigger_config).toEqual(def.trigger_config)
  })

  it('does not mutate the shared definition', () => {
    const before = JSON.stringify(AUTOMATION_TEMPLATES.out_of_office)
    localizeTemplate(AUTOMATION_TEMPLATES.out_of_office, translator('ko'))
    expect(JSON.stringify(AUTOMATION_TEMPLATES.out_of_office)).toBe(before)
  })
})
