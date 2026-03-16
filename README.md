<p align="center">
  <a href="https://rivium.co">
    <img src="https://rivium.co/logo.png" alt="Rivium" width="120" />
  </a>
</p>

<h3 align="center">Rivium Flags Next.js SDK</h3>

<p align="center">
  Feature flag management for Next.js with server-side and client-side evaluation, targeting rules, and rollout control.
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

## Quick Start

### Server Component (SSR)

```typescript
import { RiviumFlags } from '@rivium/flags-nextjs';

const flags = new RiviumFlags({
  apiKey: 'YOUR_API_KEY',
  serverSecret: 'YOUR_SERVER_SECRET',
  environment: 'production',
});

await flags.init();

const darkMode = flags.isEnabled('dark_mode', { userId: 'user-123' });
const variant = flags.evaluate('checkout_flow', {
  userId: 'user-123',
  userAttributes: { plan: 'pro', country: 'US' },
});
```

### Client Component (React Hook)

```tsx
'use client';

import { RiviumFlagsProvider, useRiviumFlags } from '@rivium/flags-nextjs';

// Wrap your app
export default function Layout({ children }) {
  return (
    <RiviumFlagsProvider config={{ apiKey: 'YOUR_API_KEY', environment: 'production' }}>
      {children}
    </RiviumFlagsProvider>
  );
}

// Use in any client component
function MyComponent() {
  const { isEnabled, getValue, isReady } = useRiviumFlags();

  if (!isReady) return <div>Loading...</div>;

  return (
    <div>
      {isEnabled('dark_mode') && <DarkModeToggle />}
      <p>Checkout: {getValue('checkout_flow')}</p>
    </div>
  );
}
```

### Standalone Client

```typescript
import { RiviumFlagsClient } from '@rivium/flags-nextjs';

const client = new RiviumFlagsClient({
  apiKey: 'YOUR_API_KEY',
  environment: 'production',
});

await client.init();
client.setUserId('user-123');
client.setUserAttributes({ plan: 'pro', country: 'US' });

const enabled = client.isEnabled('dark_mode');
```

## Features

- **Server & Client Evaluation** — Full SSR support with `serverSecret`, client-side with `apiKey` only
- **React Hook & Provider** — `useRiviumFlags()` hook with `RiviumFlagsProvider` context
- **Boolean & Multivariate Flags** — Simple on/off toggles or multi-variant flags with weighted distribution
- **Targeting Rules** — Target users by attributes (equals, contains, regex, in, greater_than, and more)
- **Rollout Percentages** — Gradual rollouts with deterministic MD5-based bucketing
- **Environment Overrides** — Separate flag values per environment (development, staging, production)
- **TypeScript** — Full type safety with exported types and declarations

## Documentation

For full documentation, visit [rivium.co/docs](https://rivium.co/docs).

## License

MIT License — see [LICENSE](LICENSE) for details.
