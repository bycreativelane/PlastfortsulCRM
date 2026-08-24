import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the proxy returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    }
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { proxy, PROTECTED_PATHS } = await import('./proxy');

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => vi.clearAllMocks());

const ROTATED = {
  name: 'sb-test-auth-token',
  value: 'rotated-refresh-token',
  options: { path: '/', httpOnly: true },
};

describe('proxy — refreshed auth cookies survive redirects', () => {
  it('carries the rotated token when redirecting a signed-in user off /login', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/login'));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('carries the rotated token when redirecting an unauth user to /login', async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: 'cleared' }];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.cookies.get(ROTATED.name)?.value).toBe('cleared');
  });

  it('redirects a signed-in user with an invite token to /join/<token>', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(
      new NextRequest('https://app.test/login?invite=abc123')
    );

    expect(res.headers.get('location')).toContain('/join/abc123');
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it('passes through (no redirect) for a signed-in user on a protected page', async () => {
    mockUser = { id: 'user-1' };
    refreshedCookies = [ROTATED];

    const res = await proxy(new NextRequest('https://app.test/dashboard'));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get('location')).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

describe('proxy — every dashboard route is guarded', () => {
  // The authed app lives under src/app/(dashboard)/. Middleware only
  // guards what PROTECTED_PATHS names, and that list is hand-maintained,
  // so it drifts in both directions: /flows, /agents and /notifications
  // once shipped unguarded, and /agents later outlived its own route.
  // Read the route segments off disk instead of restating them, so
  // neither drift survives CI.
  const dashboardRoutes = readdirSync(
    join(process.cwd(), 'src', 'app', '(dashboard)'),
    { withFileTypes: true }
  )
    .filter((entry) => entry.isDirectory())
    // Skip Next's non-routable folder conventions: route groups "(x)",
    // private folders "_x", and dynamic segments "[x]" (a dynamic segment
    // can't be a literal prefix, and none exists at this level today).
    .filter((entry) => !/^[([_]/.test(entry.name))
    .map((entry) => `/${entry.name}`);

  it('finds the dashboard route segments on disk', () => {
    // Guards the guard: if the directory scan ever returns nothing, the
    // parity test below would pass vacuously.
    expect(dashboardRoutes.length).toBeGreaterThan(5);
  });

  it('lists every dashboard route in PROTECTED_PATHS', () => {
    const missing = dashboardRoutes.filter(
      (route) => !PROTECTED_PATHS.includes(route)
    );
    expect(missing).toEqual([]);
  });

  it('has no stale entries pointing at routes that no longer exist', () => {
    const stale = PROTECTED_PATHS.filter(
      (path) => !dashboardRoutes.includes(path)
    );
    expect(stale).toEqual([]);
  });

  it.each(['/flows', '/notifications'])(
    'redirects an unauthenticated visitor away from %s',
    async (path) => {
      mockUser = null;

      const res = await proxy(new NextRequest(`https://app.test${path}`));

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login');
    }
  );

  // `/agents` is the one dashboard path that is deliberately absent from
  // PROTECTED_PATHS: the route is gone and next.config.ts redirects it.
  // Config redirects run BEFORE the proxy, so nothing here can assert
  // it — but the pair still has to hold, or an old bookmark 404s (or,
  // worse, lands somewhere unguarded). Read the config as text, the way
  // theme-contrast.test.ts reads globals.css.
  it('redirects the retired /agents path at a guarded destination', () => {
    const config = readFileSync(
      join(process.cwd(), 'next.config.ts'),
      'utf8'
    );
    const entry = config.match(
      /source:\s*["']\/agents["'],\s*destination:\s*["']([^"']+)["']/
    );
    expect(entry, 'next.config.ts no longer redirects /agents').not.toBeNull();

    const destination = new URL(entry![1], 'https://app.test');
    expect(PROTECTED_PATHS).toContain(destination.pathname);
  });
});
