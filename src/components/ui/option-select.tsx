'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
 * sites write `<option value={x}>{label}</option>` inside a map, and every one
 * of them is a plain list of names — no icons, no descriptions, no groups.
 * Rewriting all of them into Trigger/Value/Content/Item would be twenty-one
 * chances to change behaviour while changing appearance. The parts are still
 * there for the nine call sites that need them (`@/components/ui/select`);
 * this is the shorthand for the rest.
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
  // children are read for their value and label and thrown away.
  const options = React.useMemo(() => {
    const out: Array<{ value: string; label: React.ReactNode; key: string }> =
      [];
    React.Children.forEach(children, (child, index) => {
      if (!React.isValidElement(child) || child.type !== 'option') return;
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>;
      out.push({
        value: String(props.value ?? ''),
        label: props.children as React.ReactNode,
        key: String(child.key ?? props.value ?? index),
      });
    });
    return out;
  }, [children]);

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(String(next ?? ''))}
      disabled={disabled}
      items={options}
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
        {options.map((option) => (
          <SelectItem key={option.key} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export { OptionSelect };
