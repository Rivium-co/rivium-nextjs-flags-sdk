'use client';

import { RiviumFlagsProvider, useRiviumFlags } from '@rivium/flags-nextjs/client';
import { useState } from 'react';

// Public key only (NEXT_PUBLIC_…). Never put the server secret in client code.
const API_KEY = process.env.NEXT_PUBLIC_RIVIUM_API_KEY || 'YOUR_API_KEY';
const ENVIRONMENTS = ['default', 'development', 'staging', 'production'];

export function ClientDemo() {
  const [env, setEnv] = useState('default');
  return (
    <RiviumFlagsProvider
      key={env}
      config={{ apiKey: API_KEY, environment: env === 'default' ? undefined : env, debug: true }}
    >
      <ClientPanel env={env} setEnv={setEnv} />
    </RiviumFlagsProvider>
  );
}

function ClientPanel({ env, setEnv }: { env: string; setEnv: (e: string) => void }) {
  const { client, isReady, getAll, getDetail, identify, reset, resetAnonymousId, refresh } = useRiviumFlags();
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  const all = getAll();
  const missing = getDetail('nonexistent_flag', 'fallback');

  return (
    <section style={{ background: 'white', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h2 style={{ margin: '0 0 12px' }}>Client Component (useRiviumFlags)</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13 }}>
        {isReady ? 'Ready' : 'Loading…'} · user: {client.getUserId() ?? '(signed out)'} · anonymous id: {client.getAnonymousId()}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button disabled={busy} onClick={run(() => identify('user-1', { plan: 'pro', country: 'AM' }))}>identify user-1 (pro)</button>
        <button disabled={busy} onClick={run(() => identify('user-2', { plan: 'free', country: 'US' }))}>identify user-2 (free)</button>
        <button disabled={busy} onClick={run(reset)}>reset (sign out)</button>
        <button disabled={busy} onClick={run(resetAnonymousId)}>new anonymous id</button>
        <button disabled={busy} onClick={run(refresh)}>refresh</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {ENVIRONMENTS.map((e) => (
          <button key={e} onClick={() => setEnv(e)} style={{ fontWeight: env === e ? 700 : 400 }}>
            {e}
          </button>
        ))}
      </div>

      <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: 16, borderRadius: 8, fontSize: 13, overflow: 'auto' }}>
        {Object.values(all)
          .map((r) => `${r.key}: enabled=${r.enabled} value=${JSON.stringify(r.value)} variant=${r.variant} reason=${r.reason}`)
          .join('\n') || '(no results yet)'}
        {`\nnonexistent_flag → value=${missing.value} reason=${missing.reason}`}
      </pre>
    </section>
  );
}
