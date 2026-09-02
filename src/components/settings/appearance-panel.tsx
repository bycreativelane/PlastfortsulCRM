'use client';

import { Check, Moon, Palette, SunMoon, Sun } from 'lucide-react';

import { useTheme } from '@/hooks/use-theme';
import { MODES, THEMES, type Mode, type ThemeId } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import { InstallAppCard } from './install-app-card';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Appearance panel — light/dark mode + accent-color picker.
 *
 * Two independent controls: a mode toggle (light / dark) and the
 * accent grid. Either applies + persists immediately. No save button:
 * each change is a single attribute swap on <html>, there's nothing
 * to roll back.
 *
 * Persistence: localStorage only (device-scoped). The boot script in
 * layout.tsx replays both choices before first paint on subsequent
 * loads.
 */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  const t = useTranslations('Settings.appearance');

  return (
    <section className="animate-in fade-in-50 max-w-3xl duration-(--dur-3)">
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {/* Above the appearance controls rather than below them, and the
          reason is who reads this page. Somebody opens Aparência to
          change the theme; they arrive with no idea the app can leave
          the browser at all. This is the only surface in the product
          that can tell them, and it renders nothing at all on a browser
          that cannot install (see the component), so it costs the
          desktop reader nothing. */}
      <InstallAppCard />

      <div className="space-y-4">
        <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <SunMoon className="text-muted-foreground size-4" />
          {t('mode')}
        </h3>

        <div
          role="radiogroup"
          aria-label={t('colorModeAria')}
          className="grid max-w-md grid-cols-1 gap-3 @xs:grid-cols-2"
        >
          {MODES.map((m) => (
            <ModeCard
              key={m}
              mode={m}
              isActive={m === mode}
              onPick={() => setMode(m)}
            />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
          <Palette className="text-muted-foreground size-4" />
          {t('accentColor')}
        </h3>

        {/* Container queries, not `lg:`. The settings rail turns into a
            236px column at the same 1024px `lg:` breakpoint, so a viewport
            ladder went from two ~490px cards to three ~137px ones the
            instant the window got WIDER. Measuring the panel keeps the
            step monotonic. */}
        {/* A RADIOGROUP, like the mode picker above it.
            These were plain buttons with `aria-pressed`, so the same
            interaction — pick exactly one of N — was a radiogroup in the
            top half of this panel and a row of independent toggles in
            the bottom half. Arrow keys walked one and not the other, and
            a screen reader said "selected" for one and "pressed" for the
            other. */}
        <div
          role="radiogroup"
          aria-label={t('accentColor')}
          className="grid grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3"
        >
          {THEMES.map((tObj) => (
            <ThemeCard
              key={tObj.id}
              id={tObj.id}
              name={tObj.name}
              tagline={t(`themes.${tObj.id}.tagline`)}
              swatch={tObj.swatch}
              isActive={tObj.id === theme}
              onPick={() => setTheme(tObj.id)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ModeCard({
  mode,
  isActive,
  onPick,
}: {
  mode: Mode;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations('Settings.appearance');
  const isLight = mode === 'light';
  const Icon = isLight ? Sun : Moon;
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={t('useMode', { mode })}
      className={cn(
        'bg-card flex items-center gap-3 rounded-lg border p-4 text-left transition-colors duration-(--dur-1)',
        isActive
          ? 'border-primary/60 ring-primary/40 ring-2'
          : 'border-border hover:border-border hover:bg-muted/40'
      )}
    >
      <span
        aria-hidden
        className="bg-muted text-foreground flex size-9 shrink-0 items-center justify-center rounded-full"
      >
        <Icon className="size-4" />
      </span>
      <span className="text-foreground flex-1 text-sm font-semibold capitalize">
        {mode}
      </span>
      {isActive && (
        <span className="bg-primary-soft text-primary text-2xs inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 font-medium">
          <Check className="size-3" />
          {t('active')}
        </span>
      )}
    </button>
  );
}

function ThemeCard({
  id,
  name,
  tagline,
  swatch,
  isActive,
  onPick,
}: {
  id: ThemeId;
  name: string;
  tagline: string;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
}) {
  const t = useTranslations('Settings.appearance');
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={t('useTheme', { name })}
      className={cn(
        'bg-card flex flex-col gap-3 rounded-lg border p-4 text-left transition-colors duration-(--dur-1)',
        isActive
          ? 'border-primary/60 ring-primary/40 ring-2'
          : 'border-border hover:border-border hover:bg-muted/40'
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="ring-border size-8 shrink-0 rounded-full ring-1 ring-inset"
          style={{ background: swatch }}
        />
        {isActive && (
          <span className="bg-primary-soft text-primary text-2xs inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 font-medium">
            <Check className="size-3" />
            {t('active')}
          </span>
        )}
      </div>
      <div>
        <div className="text-foreground text-sm font-semibold">{name}</div>
        <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {tagline}
        </div>
      </div>
      {/* `mt-auto` pins the bar to the bottom of the card.
          Without it the card is `flex flex-col gap-3` with nothing
          claiming the slack, so a two-line tagline and a three-line one
          put their bars at two different heights in the same row —
          which the grid's own `stretch` then made obvious by making the
          cards equal height and leaving the difference as dead space.

          The last segment was `bg-card`, which is the surface the card
          is ALREADY painted in: two of the four swatches measured about
          1.1:1 against each other and the strip read as an accent, a
          grey, and then nothing. `bg-background` is the page behind the
          card, which is a real second surface and the one the accent
          actually has to work on. */}
      <div className="mt-auto flex h-2 overflow-hidden rounded-full" aria-hidden>
        <span className="flex-1" style={{ background: swatch }} />
        <span className="bg-muted-foreground/60 w-3" />
        <span className="bg-muted w-3" />
        <span className="bg-background w-3" />
      </div>
      <span className="sr-only">Theme id: {id}</span>
    </button>
  );
}
