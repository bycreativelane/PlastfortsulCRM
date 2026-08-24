# Security

PlastfortSul CRM holds the company's customer conversations, phone
numbers and commercial pipeline, and it authenticates against the
WhatsApp Business API with long-lived credentials. Treat a
vulnerability here as an incident, not a bug.

## Reporting

Report privately, never in a public issue:

- [GitHub Security Advisories](https://github.com/gabrielspencerf/Plastfortsul-CRM/security/advisories/new)
  — the private disclosure flow on this repository.
- Or contact Creative Lane directly through the usual channel.

Include what you did, what happened, and what you expected. A
reproduction beats a description.

## What matters most here

In rough order of blast radius:

1. **`SUPABASE_SERVICE_ROLE_KEY`** — bypasses row-level security
   entirely. It is used only by server routes and by the three admin
   clients under `src/lib/*/admin-client.ts`. It must never reach a
   `'use client'` module, a `NEXT_PUBLIC_*` variable, or a log line.
2. **`ENCRYPTION_KEY`** — the WhatsApp access token is stored
   encrypted at rest with it. Losing it means re-registering the
   number; leaking it means the token is readable.
3. **Row-level security** — every table is account-scoped. A missing
   or over-broad policy is a cross-tenant read, which in this product
   means one company reading another's conversations.
4. **Webhook egress** — automation webhook URLs are attacker-influenced
   (any account admin can set one). `src/lib/webhooks/ssrf.ts` rejects
   private and reserved address space, including the cloud metadata
   endpoint. Changes there need the accompanying tests to stay green.
5. **The invite flow** — `/join/<token>` carries a plaintext token in
   the URL path. The route sets `Referrer-Policy: no-referrer` and is
   marked `noindex` for that reason.

## Supported versions

This is a single-tenant product running one deployment. The supported
version is whatever is on `main`.
