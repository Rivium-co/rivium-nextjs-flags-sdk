<p align="center">
  <a href="https://rivium.co">
    <img src="https://rivium.co/logo.png" alt="Rivium" width="120" />
  </a>
</p>

<h3 align="center">Rivium Flags Next.js SDK</h3>

<p align="center">
  Feature flags for Next.js: local evaluation on the server, server-evaluated results in the browser.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rivium/flags-nextjs"><img src="https://img.shields.io/npm/v/@rivium/flags-nextjs.svg" alt="npm" /></a>
  <img src="https://img.shields.io/badge/Next.js-13+-000000?logo=next.js&logoColor=white" alt="Next.js 13+" />
  <img src="https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=black" alt="React 18+" />
  <img src="https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5+" />
  <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
</p>

---

## Installation

```bash
npm install @rivium/flags-nextjs
```

## Two entry points

| Import | Runs in | Key | How flags are evaluated |
|---|---|---|---|
| `@rivium/flags-nextjs/server` | Server Components, Route Handlers, Server Actions, middleware | public key **+ server secret** | locally, from rules downloaded with `GET /server/v2/flags` |
| `@rivium/flags-nextjs/client` (also the package root) | Client Components, the browser | public key only | by Rivium Flags (`POST /public/v2/evaluate`); the browser only gets results |

The server secret can read every rule of your project. Keep it in a server-only env var (no `NEXT_PUBLIC_` prefix) and
import it only from `/server`. The client entry never loads the server SDK, and the server SDK refuses to start in a
browser.

## Server: local evaluation

```typescript
// lib/flags.ts — one instance per process
import { RiviumFlags } from '@rivium/flags-nextjs/server';

export const flags = new RiviumFlags({
  apiKey: process.env.RIVIUM_API_KEY!,
  serverSecret: process.env.RIVIUM_FLAGS_SERVER_SECRET!,
  environment: 'production', // omit for the Default layer
});
```

```tsx
// app/page.tsx (Server Component)
import { flags } from '@/lib/flags';

export default async function Page() {
  await flags.init(); // first call fetches the rules, later calls return at once

  const user = { userId: 'user-123', attributes: { plan: 'pro', country: 'AM' } };
  const newCheckout = flags.isEnabled('new-checkout', user);
  const theme = flags.getString('theme', user, 'light');

  return <main data-theme={theme}>{newCheckout ? <NewCheckout /> : <OldCheckout />}</main>;
}
```

Context per call: `{ userId?, anonymousId?, attributes? }`. Rollouts and splits bucket by `userId`, else
`anonymousId` (for example the id the client entry sends, `client.getAnonymousId()`).

| Method | |
|---|---|
| `init()` | fetch rules, start ETag polling (30 s); resolves after the first fetch or `initTimeoutMs` (5 s), never rejects |
| `isEnabled(key, context?, defaultValue = false)` | `true` only when served on (`ON` / `VARIANT`) |
| `getBoolean / getString / getNumber / getJson(key, context, defaultValue)` | typed value or the default |
| `getDetail(key, context, defaultValue, valueType?)` | `{ key, value, enabled, variant, reason, version, valueType }` |
| `getAll(context?)`, `getFlagKeys()` | every flag evaluated for the context / loaded keys |
| `refresh()`, `close()`, `on('ready' \| 'update' \| 'error', fn)` | |

Options: `pollIntervalSeconds` (30, min 10, 0 = off), `initTimeoutMs` (5000), `sendUsage` (false — sends aggregated
evaluation counts to the dashboard, not billed, no user ids), `debug`, `logger`, `baseUrl`. Fetching rules and local
evaluations are not billed. The engine has no `node:crypto` dependency.

## Client: results for the current user

```tsx
// app/providers.tsx
'use client';
import { RiviumFlagsProvider } from '@rivium/flags-nextjs/client';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RiviumFlagsProvider config={{ apiKey: process.env.NEXT_PUBLIC_RIVIUM_API_KEY!, environment: 'production' }}>
      {children}
    </RiviumFlagsProvider>
  );
}
```

```tsx
'use client';
import { useEffect } from 'react';
import { useRiviumFlags } from '@rivium/flags-nextjs/client';

export function Checkout({ userId, plan }: { userId: string | null; plan: string }) {
  const { isReady, isEnabled, getString, identify } = useRiviumFlags();

  useEffect(() => {
    identify(userId, { plan }); // null = signed out
  }, [identify, userId, plan]);

  if (!isReady) return <Spinner />;
  return isEnabled('new-checkout') ? <NewCheckout theme={getString('theme', 'light')} /> : <OldCheckout />;
}
```

Without React:

```typescript
import { RiviumFlagsClient } from '@rivium/flags-nextjs/client';

const client = new RiviumFlagsClient({ apiKey: 'rv_live_…', userId: 'user-123', attributes: { plan: 'pro' } });
await client.init();
client.getBoolean('new-checkout', false);
```

| Method | |
|---|---|
| `init()` | serve cached results, fetch fresh ones; resolves after the first answer or `initTimeoutMs` (5 s) |
| `isEnabled(key, defaultValue = false)` | `true` only when served on |
| `getBoolean / getString / getNumber / getJson(key, defaultValue)` | typed value or the default |
| `getDetail(key, defaultValue, valueType?)`, `getAll()` | full results with reasons |
| `identify(userId \| null, attributes?)` | set the user (and replace attributes); refetches (debounced 250 ms) |
| `setUserId(userId \| null)`, `setAttributes(attributes)` | change one part; `setAttributes` replaces the whole set |
| `reset()` | sign out: clears user, attributes and cached results, keeps the anonymous id |
| `resetAnonymousId()` | new anonymous id |
| `refresh()`, `close()`, `on('ready' \| 'change' \| 'error', fn)` | |
| `getUserId()`, `getAttributes()`, `getAnonymousId()` | |

- **Anonymous id**: a UUID v4 kept in `localStorage` (`rivium_flags_anonymous_id`, memory if storage is blocked) and sent
  with every request, so percentage rollouts work for signed-out visitors too.
- **Cache**: the last results are kept in `localStorage` and served at start. When the user id changes, the previous
  user's results are dropped at once. On errors or offline, the last results keep being served.
- **Refresh**: on `init`, `identify` / `setUserId` / `setAttributes`, when the tab becomes visible and the last fetch is
  older than 15 min, and on `refresh()`. Optional polling `refreshIntervalSeconds` (off by default, minimum 60).
  **Every evaluate request is a billed usage event**, which is why polling is off by default.
- Options: `environment`, `userId`, `attributes`, `flagKeys`, `refreshIntervalSeconds`, `initTimeoutMs`, `storage`,
  `debug`, `logger`, `baseUrl`.

## Reasons

`ON`, `VARIANT`, `DISABLED`, `PREREQUISITE_FAILED`, `NOT_TARGETED`, `OUTSIDE_ROLLOUT`, `NO_BUCKETING_ID`, `ERROR`;
getters return your default with `FLAG_NOT_FOUND`, `NOT_READY` (nothing loaded yet) or `TYPE_MISMATCH` (flag of
another value type).

## Migrating from 0.1.x

| 0.1.x | 0.2.0 |
|---|---|
| `import { RiviumFlags } from '@rivium/flags-nextjs'` | `import { RiviumFlags } from '@rivium/flags-nextjs/server'` |
| `import { RiviumFlagsProvider, useRiviumFlags, RiviumFlagsClient } from '@rivium/flags-nextjs'` | same names from `'@rivium/flags-nextjs/client'` (the root still works) |
| server `isEnabled(key, { userId, userAttributes })` | `isEnabled(key, { userId, attributes })` |
| `getValue(key, …, default)` | `getBoolean` / `getString` / `getNumber` / `getJson` |
| `evaluate(key, …)` | `getDetail(key, …, default)` (with `reason` and `version`) |
| client `setUserId` + `setUserAttributes` | `identify(userId, attributes)` / `setUserId` / `setAttributes` (async, refetch) |
| client `getAll()` returned rules | `getAll()` returns this user's results |
| `dispose()` | `close()` |
| browser downloaded every rule and evaluated with MD5 | browser gets results only; server SDK uses SHA-256 — users are re-bucketed once |

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/docs).

## License

MIT License — see [LICENSE](LICENSE) for details.
