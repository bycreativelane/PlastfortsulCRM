'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** One row of the listbox, as one `<option>` the caller wrote. */
interface OptionRow {
  value: string;
  label: React.ReactNode;
  key: string;
}

/** A run of rows, headed by an `<optgroup label>` when there is one. */
interface OptionGroup {
  key: string;
  label: React.ReactNode | null;
  rows: OptionRow[];
}

/**
 * A select written as a list of `<option>`s, rendered as the app's listbox.
 *
 * This replaces `NativeSelect`, and the name change is the point: it used to
 * be a real `<select>` with `appearance: none` and our chevron drawn over it.
 * Closed, that was indistinguishable from every other field. Open, it handed
 * the browser control of the panel — and the browser's panel on Windows is a
 * light-grey list with black text and a blue highlight, which lands on a dark
 * form as a hole in the interface. No CSS reaches it. Reported, exactly, as
 * "um tapa no olho".
 *
 * The argument for the native control was the phone, where the platform's
 * picker wheel beats anything we would build, and it is a real argument. It
 * loses to a simpler one: a control that looks like the app until you open it
 * is worse than one that never pretended to.
 *
 * WHY `<option>` CHILDREN and not the Select parts directly. Twenty-one call
 * sites write `<option value={x}>{label}</option>` inside a map, and almost
 * every one of them is a plain list of names — no icons, no descriptions.
 * Rewriting all of them into Trigger/Value/Content/Item would be twenty-one
 * chances to change behaviour while changing appearance. The parts are still
 * there for the nine call sites that need them (`@/components/ui/select`);
 * this is the shorthand for the rest.
 *
 * `<optgroup label>` is read too, and it has to be: the first version of this
 * component walked only its direct `<option>` children, so the stage pickers
 * in the automation builder — which group their stages by funnel — came out
 * of the rewrite as an empty list you could not pick a stage from, and, once
 * a stage was picked, as a raw UUID in the closed field, because the option
 * carrying its name was never registered. A group renders as a heading over
 * its rows; its rows count as options like any other.
 *
 * An `<option>` with an empty value stays a real row, exactly as it was
 * natively: "Selecionar contato" is a choice you can make, not a placeholder
 * the list hides.
 */
function OptionSelect({
  value,
  onValueChange,
  children,
  className,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  // `<option>` is markup the caller writes, not markup that renders: the
  // children are read for their value and label and thrown away. Rows are
  // kept in runs so an `<optgroup>` can put a heading over its own, and only
  // its own.
  const groups = React.useMemo(() => {
    const out: OptionGroup[] = [];
    // The run currently taking rows: an open `<optgroup>`, or the unlabelled
    // run that loose `<option>`s fall into. Null means the next row starts a
    // new unlabelled run — which is how a group closes.
    let run: OptionGroup | null = null;
    const runFor = (path: string) => {
      if (run) return run;
      const started: OptionGroup = {
        key: `rows:${path}`,
        label: null,
        rows: [],
      };
      out.push(started);
      run = started;
      return started;
    };

    const walk = (nodes: React.ReactNode, path: string) => {
      React.Children.forEach(nodes, (child, index) => {
        if (!React.isValidElement(child)) return;
        const here = `${path}.${index}`;

        if (child.type === 'option') {
          const props =
            child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
          runFor(here).rows.push({
            value: String(props.value ?? ''),
            label: props.children as React.ReactNode,
            key: String(child.key ?? props.value ?? here),
          });
          return;
        }

        if (child.type === 'optgroup') {
          const props =
            child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement> & {
              children?: React.ReactNode;
            };
          const group: OptionGroup = {
            key: String(child.key ?? here),
            label: props.label ?? null,
            rows: [],
          };
          out.push(group);
          run = group;
          walk(props.children, here);
          run = null;
          return;
        }

        // A fragment is a caller writing `<>...</>` around a couple of rows,
        // not a row itself — look through it.
        if (child.type === React.Fragment) {
          walk((child.props as { children?: React.ReactNode }).children, here);
        }
      });
    };

    walk(children, 'root');
    // An `<optgroup>` whose map produced nothing would otherwise render as a
    // heading with no list under it.
    return out.filter((group) => group.rows.length > 0);
  }, [children]);

  // `items` is flat on purpose: it is what `<SelectValue>` reads to turn the
  // stored value back into its label, and it has to see grouped rows too.
  const items = React.useMemo(
    () =>
      groups.flatMap((group) =>
        group.rows.map(({ value: rowValue, label }) => ({
          value: rowValue,
          label,
        }))
      ),
    [groups]
  );

  const row = (option: OptionRow) => (
    <SelectItem key={option.key} value={option.value}>
      {option.label}
    </SelectItem>
  );

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(String(next ?? ''))}
      disabled={disabled}
      items={items}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        data-slot="option-select"
        className={cn('w-full', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {groups.map((group) =>
          group.label === null ? (
            <React.Fragment key={group.key}>
              {group.rows.map(row)}
            </React.Fragment>
          ) : (
            <SelectGroup key={group.key}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.rows.map(row)}
            </SelectGroup>
          )
        )}
      </SelectContent>
    </Select>
  );
}

export { OptionSelect };
