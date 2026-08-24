import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  listFlowTemplates,
  localizeFlowTemplate,
  type FlowTemplateCatalogue,
} from "./templates";

/**
 * Same contract as the automation templates, with one extra hazard: a
 * flow template's copy is keyed by `node_key` and `reply_id`, and those
 * are also the flow's WIRING. A catalogue entry that renames a node key
 * silently stops matching and the node keeps its English; a localizer
 * that translated `next_node_key` would break the flow outright.
 *
 * So this checks both directions — every string swapped, no identifier
 * touched.
 */

const LOCALES = ["pt-BR", "en", "ko"] as const;

function catalogue(locale: string): FlowTemplateCatalogue {
  const raw = readFileSync(
    join(process.cwd(), "messages", `${locale}.json`),
    "utf8",
  );
  return JSON.parse(raw).Flows.templates;
}

describe("localizeFlowTemplate", () => {
  it.each(LOCALES)("covers every node of every template in %s", (locale) => {
    const copy = catalogue(locale);
    for (const template of listFlowTemplates()) {
      const entry = copy[template.slug];
      expect(entry, `${locale}: no copy for ${template.slug}`).toBeDefined();
      expect(entry.name).toBeTruthy();
      expect(entry.description).toBeTruthy();

      // Every node key named in the catalogue must exist in the flow —
      // this is the check that catches a typo'd or renamed node key,
      // which would otherwise just leave that node untranslated.
      const nodeKeys = new Set(template.nodes.map((n) => n.node_key));
      for (const key of Object.keys(entry.nodes ?? {})) {
        expect(nodeKeys, `${locale}/${template.slug}`).toContain(key);
      }
    }
  });

  it.each(LOCALES)("translates prose and nothing else in %s", (locale) => {
    const copy = catalogue(locale);
    for (const template of listFlowTemplates()) {
      const localized = localizeFlowTemplate(template, copy);

      expect(localized.entry_node_id).toBe(template.entry_node_id);
      expect(localized.nodes.map((n) => n.node_key)).toEqual(
        template.nodes.map((n) => n.node_key),
      );
      expect(localized.nodes.map((n) => n.node_type)).toEqual(
        template.nodes.map((n) => n.node_type),
      );

      for (const [index, node] of localized.nodes.entries()) {
        const original = template.nodes[index].config as Record<
          string,
          unknown
        >;
        const config = node.config as Record<string, unknown>;

        // Wiring survives untouched.
        expect(config.next_node_key).toBe(original.next_node_key);

        const buttons = config.buttons as
          | { reply_id: string; title?: string; next_node_key?: string }[]
          | undefined;
        if (buttons) {
          const originals = original.buttons as {
            reply_id: string;
            next_node_key?: string;
          }[];
          buttons.forEach((button, i) => {
            expect(button.reply_id).toBe(originals[i].reply_id);
            expect(button.next_node_key).toBe(originals[i].next_node_key);
            expect(button.title).toBeTruthy();
          });
        }

        const sections = config.sections as
          | { title?: string; rows?: { reply_id: string; title?: string }[] }[]
          | undefined;
        if (sections) {
          for (const section of sections) {
            for (const row of section.rows ?? []) {
              expect(row.title, `${locale}/${template.slug}`).toBeTruthy();
            }
          }
        }
      }
    }
  });

  it("swaps the trigger keywords for the localized list", () => {
    const [welcome] = listFlowTemplates().filter(
      (t) => t.slug === "welcome_menu",
    );
    const localized = localizeFlowTemplate(welcome, catalogue("pt-BR"));
    const keywords = (localized.trigger_config as { keywords?: string[] })
      .keywords;
    expect(keywords).toBeDefined();
    expect(keywords).toContain("suporte");
    expect(keywords).not.toContain("support");
  });

  it("returns the definition untouched when the locale has no entry", () => {
    const [template] = listFlowTemplates();
    expect(localizeFlowTemplate(template, {})).toBe(template);
    expect(localizeFlowTemplate(template, undefined)).toBe(template);
  });

  it("does not mutate the shared definition", () => {
    const template = listFlowTemplates()[1];
    const before = JSON.stringify(template);
    localizeFlowTemplate(template, catalogue("ko"));
    expect(JSON.stringify(template)).toBe(before);
  });
});
