'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Search } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

/**
 * Find a customer from anywhere, with the keyboard.
 *
 * This is what earns the top bar its height. In a WhatsApp CRM the question
 * asked more often than any other is "where is this person's chat" — and the
 * answer used to require going to the inbox, then scrolling or filtering. From
 * here it is Ctrl+K, three letters, Enter.
 *
 * It searches CONTACTS, not conversations, so somebody imported last week but
 * never messaged is still findable. Selecting one opens their thread when they
 * have one and their record when they do not, which is the right destination
 * in each case without asking.
 */
interface Hit {
  id: string;
  name: string | null;
  phone: string;
  company: string | null;
  conversations: { id: string }[] | null;
}

/**
 * PostgREST's `or=` takes a comma-separated list inside parentheses, so a
 * query containing either character would be parsed as filter syntax rather
 * than as text. Stripping them costs nothing — no one searches for a bare
 * comma — and skipping it turns a typed `(` into a 400.
 */
function sanitize(query: string): string {
  return query.replace(/[,()*\\]/g, ' ').trim();
}

export function GlobalSearch({
  autoFocus = false,
  onNavigate,
  className,
}: {
  /** The mobile dialog opens straight into the field. */
  autoFocus?: boolean;
  /** Lets the dialog close itself once a result is chosen. */
  onNavigate?: () => void;
  className?: string;
} = {}) {
  const t = useTranslations('Search');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // Results are stored WITH the term they were fetched for, so "are these
  // stale?" is a comparison instead of a second piece of state that has to be
  // cleared from an effect. `hits` and `loading` fall out of it.
  const [result, setResult] = useState<{ term: string; hits: Hit[] } | null>(
    null
  );
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);

  const term = sanitize(query);
  // Two characters is where the result set stops being "most of the base".
  const active = term.length >= 2;
  const hits = result?.term === term ? result.hits : null;
  const loading = active && hits === null;

  // Ctrl/⌘+K from anywhere. Not bound while a field already has focus, so it
  // can't steal the shortcut from a text editor the user is typing in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        // Only if this instance is on screen. The bar's copy lives
        // inside `hidden lg:block`, and `display: none` does not stop a
        // component from mounting — so on a tablet with a keyboard the
        // shortcut used to focus an input nobody could see, and the
        // next keystroke went somewhere invisible. `offsetParent` is
        // null for a display:none subtree, which is the cheapest honest
        // test for "is this actually rendered".
        if (!inputRef.current?.offsetParent) return;
        e.preventDefault();
        inputRef.current.focus();
        inputRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const pattern = `%${term}%`;
      const { data } = await createClient()
        .from('contacts')
        .select('id, name, phone, company, conversations(id)')
        .or(
          `name.ilike.${pattern},phone.ilike.${pattern},company.ilike.${pattern}`
        )
        .limit(8);

      if (cancelled) return;
      setResult({ term, hits: (data ?? []) as Hit[] });
      setCursor(0);
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, active]);

  const go = useCallback(
    (hit: Hit) => {
      const conversationId = hit.conversations?.[0]?.id;
      // The file's own promise, two paragraphs up: "their record when
      // they do not". It pushed a bare `/contacts` — the unfiltered
      // table — so after typing a name and pressing Enter you arrived
      // at a list of everyone and had to search a second time, in a
      // different box. `?id=` is read by the contacts page, which opens
      // that contact's panel on mount.
      router.push(
        conversationId ? `/inbox?c=${conversationId}` : `/contacts?id=${hit.id}`
      );
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
      onNavigate?.();
    },
    [router, onNavigate]
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hits?.length) {
      if (e.key === 'Escape') inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(hits[cursor]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  const showResults = open && active;

  return (
    <div className={cn('relative w-full max-w-sm', className)}>
      <label className="border-border bg-card-2 text-muted-foreground focus-within:border-primary/50 focus-within:bg-card flex h-9 items-center gap-2 rounded-lg border px-2.5">
        <Search className="size-4 shrink-0" />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          // A click on a result fires after blur, so closing is deferred by a
          // frame — otherwise the list unmounts before the click lands.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="text-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {loading ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <kbd className="border-border bg-card text-muted-foreground hidden shrink-0 rounded border border-b-2 px-1.5 text-3xs font-semibold xl:block">
            {t('shortcut')}
          </kbd>
        )}
      </label>

      {showResults && (
        <div className="border-border bg-popover absolute top-[calc(100%+4px)] right-0 left-0 z-50 overflow-hidden rounded-lg border shadow-lg">
          {/* `!hits` rather than `loading`: identical here (inside this branch
              `active` is true, so the two are the same condition) but it also
              narrows the type, which `loading` — a separate boolean — cannot. */}
          {!hits ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">
              {t('searching')}
            </p>
          ) : hits.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-xs">
              {t('noResults')}
            </p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={hit.id}
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(hit)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left',
                  i === cursor && 'bg-muted'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="text-foreground block truncate text-sm font-medium">
                    {hit.name || hit.phone}
                  </span>
                  <span className="text-muted-foreground block truncate text-2xs">
                    {[hit.company, hit.phone].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {!hit.conversations?.length && (
                  <span className="text-muted-foreground shrink-0 text-3xs">
                    {t('noThread')}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
