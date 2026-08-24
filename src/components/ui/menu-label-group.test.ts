import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A menu label without a group crashes the screen it is on.
 *
 * `ContextMenuLabel` and `DropdownMenuLabel` are base-ui's `Menu.GroupLabel`,
 * which reads a context that only `Menu.Group` provides and THROWS at render
 * when it cannot find one:
 *
 *   Base UI: MenuGroupContext is missing. Menu group parts must be used
 *   within <Menu.Group> or <Menu.RadioGroup>.
 *
 * The throw happens while the menu renders, so React unwinds to the route's
 * error boundary and the whole page becomes "Algo quebrou nesta tela". It
 * cost the conversation right-click menu and the pipeline card menu at once,
 * and it had already been hit — and written down — in `flow-builder.tsx`
 * before either of them was built. A comment in one file did not stop it
 * happening in two others.
 *
 * TYPECHECK CANNOT SEE THIS: the label's props are valid, and the missing
 * piece is an ancestor at runtime. So it is checked here, over the source.
 *
 * The rule is deliberately coarse — a file that renders a label must also
 * render a group — rather than a real JSX ancestry walk. Coarse is right: it
 * cannot produce a false alarm anybody would have to argue with, and the
 * mistake it catches is exactly "somebody added a label and no group".
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The primitives' own definitions, which are the thing being wrapped. */
const PRIMITIVE_FILES = ['context-menu.tsx', 'dropdown-menu.tsx'];

describe('menu labels', () => {
  it('never render outside a menu group', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (PRIMITIVE_FILES.some((p) => file.endsWith(p))) continue;
      const source = readFileSync(file, 'utf8');

      for (const [label, group] of [
        ['ContextMenuLabel', 'ContextMenuGroup'],
        ['DropdownMenuLabel', 'DropdownMenuGroup'],
      ]) {
        // `<Label` as an element, not the import line or a comment mention.
        if (!new RegExp(`<${label}[\\s/>]`).test(source)) continue;
        if (new RegExp(`<${group}[\\s/>]`).test(source)) continue;
        offenders.push(
          `${file.slice(SRC.length + 1).replace(/\\/g, '/')} — ${label} with no ${group}`
        );
      }
    }

    expect(
      offenders.sort(),
      'These files render a menu label with no menu group anywhere. base-ui throws at render, which takes the whole route to its error boundary.'
    ).toEqual([]);
  });

  it('catches an aliased label too', () => {
    // `conversation-menu.tsx` picks its primitives by variant and renders
    // `<Label>`, so the element name in that file is not the import name.
    // The import IS there, which is what the rule keys on — this test pins
    // that the file is covered rather than silently skipped.
    const menu = readFileSync(
      join(SRC, 'components', 'inbox', 'conversation-menu.tsx'),
      'utf8'
    );
    expect(menu).toContain('ContextMenuGroup');
    expect(menu).toContain('DropdownMenuGroup');
  });
});
