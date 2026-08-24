'use client';

/**
 * View-switcher + chrome for the flow editor.
 *
 * Lays the editor out as one app-like column that fills the dashboard
 * content area (toolbar → mode row → stage → validation bar), matching
 * the Flow Builder design handoff:
 *   - A segmented Canvas / List control on the left of the mode row.
 *   - A node-type legend on the right so the canvas's per-type colors
 *     are decodable at a glance.
 *   - The active view is mounted inside a rounded "stage" that owns its
 *     own scroll/overflow, so the canvas can fill available height and
 *     the list scrolls internally.
 *
 * Why a separate component:
 *   - The page itself stays trivially small (loading + error + this).
 *   - Either view can stay unaware of the other — they share data
 *     (`{flow, nodes}`) and nothing else.
 *
 * View choice persists per-browser via localStorage so a power user
 * who prefers the list isn't fighting the default on every load.
 * Canvas is the default for everyone else — the original user
 * feedback was that the list shape made flows "hard to understand".
 */

import { useEffect, useState } from 'react';
import { GitFork, List } from 'lucide-react';

import { FlowBuilder } from './flow-builder';
import { FlowCanvas } from './flow-canvas';
import { Palette } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { FlowEditorProvider } from './flow-editor-state';
import { EditorHeader } from './header';
import { ValidationPanel } from './validation-panel';
import { NODE_META, nodeColors, type NodeType } from './shared';
import { cn } from '@/lib/utils';
import type { FlowRow, FlowNodeRow } from '@/lib/flows/types';
import { useTranslations } from 'next-intl';

/**
 * Below this viewport width we force list view and hide the toggle.
 * Canvas with drag-to-connect on a phone is unusable — handles are
 * ~10px and live finger drags from one node to another aren't a
 * practical workflow. Matches Tailwind's `md` breakpoint.
 */
const MOBILE_BREAKPOINT = '(max-width: 767px)';

type View = 'canvas' | 'list';

const STORAGE_KEY = 'wacrm.flowEditor.view';

// Legend covers every node type, derived from NODE_META so a new type
// can't silently go undocumented. NODE_META's key order already reads
// the way a flow flows: start → talk → capture → branch → mutate → end.
const LEGEND_TYPES = Object.keys(NODE_META) as NodeType[];

interface Props {
  initialFlow: FlowRow;
  initialNodes: FlowNodeRow[];
}

export function FlowEditorShell({ initialFlow, initialNodes }: Props) {
  const t = useTranslations('Flows.builder');

  // Read the persisted choice in the useState initializer. Safe even
  // though this is a client component because the parent page only
  // mounts us AFTER a client-side fetch resolves — there's no SSR
  // pass for this subtree, so no hydration mismatch to worry about.
  // Default to `canvas` (the new default) when nothing is saved.
  const [view, setView] = useState<View>(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'canvas' || saved === 'list') return saved;
    } catch {
      // Private browsing / disabled storage — fall through to default.
    }
    return 'canvas';
  });

  // Live mobile detection. We don't render canvas under the
  // breakpoint regardless of `view` — but we keep `view` itself
  // intact so the user's preference comes back when they widen
  // again (e.g. rotating a tablet, resizing a window).
  const isMobile = useMatchMedia(MOBILE_BREAKPOINT);
  const effectiveView: View = isMobile ? 'list' : view;

  const choose = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  return (
    <FlowEditorProvider initialFlow={initialFlow} initialNodes={initialNodes}>
      <div className="flex min-h-0 flex-1 flex-col">
        <EditorHeader />

        {/* ---- mode row: view toggle + node-type legend ----
            Omitted entirely on mobile (canvas is unavailable there and
            the legend is lg-only), so there's no empty band above the
            stage on small screens. */}
        {!isMobile && (
          <div className="flex items-center gap-4 px-4 pt-1 pb-3 sm:px-6 lg:px-8">
            <div
              role="group"
              aria-label={t('editorView')}
              className="border-border bg-muted inline-flex gap-0.5 rounded-lg border p-0.5"
            >
              <SegButton
                active={effectiveView === 'canvas'}
                onClick={() => choose('canvas')}
                icon={<GitFork className="h-3.5 w-3.5" />}
                label={t('canvasView')}
              />
              <SegButton
                active={effectiveView === 'list'}
                onClick={() => choose('list')}
                icon={<List className="h-3.5 w-3.5" />}
                label={t('listView')}
              />
            </div>
            {/* THE LEGEND, BEHIND A CLICK.
                
                It was ten labelled dots laid out across the full width of
                the row — a band of 10px text that runs off the edge below
                about 1400px and is read approximately once, on the first
                visit. Reference material, not a control, and it was taking
                the most valuable horizontal space on the screen to be
                permanently available.
                
                The colours are also already on the nodes themselves, so
                the legend answers a question you can only have while
                looking at a node you do not recognise — which is a moment
                you can afford one click. */}
            <Popover>
              <PopoverTrigger className="border-border bg-card text-secondary-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors">
                <Palette className="size-3.5" />
                {t('legend')}
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="grid w-auto grid-cols-2 gap-x-4 gap-y-1.5 p-3"
              >
                {LEGEND_TYPES.map((t_type) => (
                  <span
                    key={t_type}
                    className="text-2xs text-secondary-foreground inline-flex items-center gap-1.5 whitespace-nowrap"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: nodeColors(t_type).solid }}
                    />
                    {t(`nodes.${t_type}.label`)}
                  </span>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}

        {/* ---- stage: the active view, owning its own overflow ----

            THE CANVAS IS THE PAGE, not a card sitting on it.

            This was `mx-4 rounded-lg border bg-card-2 sm:mx-6 lg:mx-8`: a
            bordered box inset from every edge, with the dotted grid inside
            it and the toolbar, legend and validation bar stacked outside on
            a different surface. Two backgrounds, one frame between them, and
            the thing you actually manipulate getting the smaller share of
            the screen — on a laptop the gutters and the bar under it cost
            roughly a fifth of the working area, which on an editor you pan
            around is the expensive fifth.

            Now the grid runs the full width and height of what is left below
            the header, and everything else floats on top of it. Same idea as
            the canvas controls and the minimap, which were already overlaid;
            they were just overlaid on a small canvas.

            The list view keeps a surface of its own — a column of rows on a
            dot grid is unreadable, and the grid means "you can drag things
            here", which in the list is a lie. */}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {effectiveView === 'canvas' ? (
            <>
              <FlowCanvas />

              {/* Floated over the grid, bottom-anchored and centred, with
                  a `max-w` so a long validation sentence does not span a
                  1600px screen. `pointer-events-none` on the wrapper keeps
                  the strip from stealing drags that pass under its empty
                  margins; the panel itself takes its events back. */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-4 sm:px-6 lg:px-8">
                <div className="pointer-events-auto w-full max-w-3xl">
                  <ValidationPanel />
                </div>
              </div>
            </>
          ) : (
            <div className="bg-card-2 border-border absolute inset-0 overflow-y-auto border-t">
              <FlowBuilder />
              <div className="px-4 pt-3 pb-5 sm:px-6 lg:px-8">
                <ValidationPanel />
              </div>
            </div>
          )}
        </div>
      </div>
    </FlowEditorProvider>
  );
}

/**
 * Tiny `useMatchMedia` shim. We could pull in `react-responsive` but
 * this is the only consumer and matchMedia is one of those browser
 * APIs that doesn't need a dependency.
 */
function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Safari < 14 still uses addListener; addEventListener is the
    // modern path. Both fire identically.
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

function SegButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // A raw <button>, so the shell's coarse-pointer expansion for
        // `[data-slot="button"]` misses it — and this row is live from
        // 768px up, which is every tablet.
        'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-(--dur-1) pointer-coarse:min-h-11',
        active
          ? 'bg-card text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
