import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Page prefixes that require a session. An unauthenticated request to
 * any of these is redirected to /login before the page renders.
 *
 * This MUST list every route segment under `src/app/(dashboard)/`.
 * `/flows`, `/agents`, and `/notifications` were added to the app but
 * not to this list, so an unauthenticated visit rendered the dashboard
 * shell and only bounced once client-side JS ran `DashboardShell`'s
 * redirect — a flash of the app for anyone, and no redirect at all with
 * JS disabled. No data leaked (every route under /api enforces its own
 * auth), but the guard is supposed to be server-side.
 *
 * `middleware.test.ts` walks the (dashboard) directory and fails when a
 * route is missing here — and when an entry outlives the route it named,
 * which is how `/agents` left this list after the AI agent moved into
 * Settings, and `/admin` after Configurações merged back into one door.
 * Both are `redirects()` entries in next.config.ts now, and config
 * redirects resolve at step 2 of Next's routing order, ahead of
 * middleware at step 3: the request becomes `/settings?tab=…` before
 * this file ever sees it, and `/settings` is guarded below.
 */
export const PROTECTED_PATHS = [
  '/automations',
  '/broadcasts',
  '/contacts',
  '/dashboard',
  '/flows',
  '/inbox',
  '/notifications',
  '/pipelines',
  '/products',
  '/reports',
  '/settings',
];

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (
    user &&
    (request.nextUrl.pathname === '/login' ||
      request.nextUrl.pathname === '/signup' ||
      request.nextUrl.pathname === '/forgot-password')
  ) {
    const url = request.nextUrl.clone();
    const inviteToken = request.nextUrl.searchParams.get('invite');
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = '';
    } else {
      /**
       * `?next=` WINS OVER `/dashboard`, and that is a bug fix, not a
       * refinement.
       *
       * Reported as "se está numa página e dá atualizar, vai
       * aleatoriamente para outra". It is not random — it is a race, and
       * this branch was the second half of it:
       *
       *   1. F5 on /reports. The access token happens to be expiring, so
       *      `getUser()` below returns null for this one request.
       *   2. The protected-path branch redirects to
       *      `/login?next=/reports`, carefully preserving where you were.
       *   3. The refreshed cookie lands. The very next request hits THIS
       *      branch — signed in, on /login — and sent you to /dashboard
       *      with `url.search = ''`, throwing away the `next` that step 2
       *      had just written.
       *
       * So the destination existed the whole time and this line deleted
       * it. Whether it happened depended on token timing, which is what
       * made it look random.
       *
       * Only a relative path is honoured. `next` arrives in a URL a user
       * can edit, and following an absolute one would make the login
       * screen an open redirect — somebody's phishing link with
       * `?next=https://…` would bounce off a domain the team trusts.
       */
      const next = request.nextUrl.searchParams.get('next');
      const safeNext =
        next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      if (safeNext) {
        const target = new URL(safeNext, request.nextUrl.origin);
        url.pathname = target.pathname;
        url.search = target.search;
      } else {
        url.pathname = '/dashboard';
        url.search = '';
      }
    }
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Sign-up is invite-only. This is an internal tool for one company, and
  // a public registration form on it is a door with no lock: anybody who
  // finds the URL gets an account and a look at the shell of the CRM.
  //
  // The invite carries a token, and `/join/<token>` is the front door — it
  // hands the token to `/signup?invite=…` itself, so a signup that has one
  // came from an invitation and a signup that does not came from somebody
  // typing the URL.
  //
  // WHAT THIS IS NOT. It is not a lock on account creation — Supabase's own
  // sign-up endpoint is reachable with the anon key whatever this file says.
  // Closing that means turning off "Allow new users to sign up" in the
  // Supabase dashboard and minting the user server-side after validating the
  // token, which is a decision with a cost (do it without the server route
  // and invited people cannot sign up either). This removes the door from
  // the building; it does not brick up the wall.
  if (
    !user &&
    request.nextUrl.pathname === '/signup' &&
    !request.nextUrl.searchParams.get('invite')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // The root, in one hop instead of two.
  //
  // `/` is not protected, so it fell through to `src/app/page.tsx`,
  // which server-redirects to `/dashboard`, which comes back through
  // this middleware, finds no session, and redirects again to `/login`.
  // Two network round-trips before the first screen for anybody who
  // types the bare domain — visible on a phone on 3G, which is where a
  // warehouse operator opens it. Deciding here costs nothing and the
  // page-level redirect stays as a fallback.
  if (request.nextUrl.pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = user ? '/dashboard' : '/login';
    url.search = '';
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // Protected pages - redirect to login if not authenticated
  if (
    !user &&
    PROTECTED_PATHS.some((path) => request.nextUrl.pathname.startsWith(path))
  ) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Where they were actually going.
    //
    // The clone kept the ORIGINAL query while overwriting the pathname,
    // so `/inbox?c=abc123` became `/login?c=abc123`: the destination was
    // dropped and a conversation id leaked onto the login screen. Both
    // halves of that were wrong. The whole target — path and query —
    // now travels as a single `next` parameter, and the login page
    // sends you there instead of to `/dashboard`.
    //
    // This is the difference between opening a broadcast link somebody
    // pasted into a WhatsApp group and landing on it, versus landing on
    // the dashboard and having to find it yourself. The session expires
    // daily; the link does not.
    url.search = '';
    const target = request.nextUrl.pathname + request.nextUrl.search;
    if (target !== '/dashboard') url.searchParams.set('next', target);
    return withRefreshedCookies(NextResponse.redirect(url));
  }

  // API routes that need auth (not webhooks)
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook')
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
