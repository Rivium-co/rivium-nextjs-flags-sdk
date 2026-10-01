import { flags } from './flags';
import { ClientDemo } from './client-test';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rivium Flags — Next.js SDK example (0.2.0)
// Server Component: local evaluation with @rivium/flags-nextjs/server
// Client Component: server-evaluated results with @rivium/flags-nextjs/client
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const dynamic = 'force-dynamic';

const contexts = [
  { label: 'user-1 (pro, AM)', ctx: { userId: 'user-1', attributes: { plan: 'pro', country: 'AM' } } },
  { label: 'user-2 (free, US)', ctx: { userId: 'user-2', attributes: { plan: 'free', country: 'US' } } },
  { label: 'anonymous', ctx: { anonymousId: '3f1c2b8e-9d0a-4c51-a1f2-6f0b7e2d9c11' } },
];

export default async function Page() {
  await flags.init();

  return (
    <div>
      <h1 style={{ color: '#d97706', marginBottom: 4 }}>Rivium Flags — Next.js SDK example</h1>
      <p style={{ color: '#666', marginTop: 0 }}>
        Server rules loaded: {String(flags.isReady())} · {flags.getFlagKeys().length} flags
      </p>

      <section style={card}>
        <h2 style={{ margin: '0 0 12px' }}>Server Component (local evaluation)</h2>
        {contexts.map(({ label, ctx }) => (
          <div key={label} style={{ marginBottom: 12 }}>
            <strong>{label}</strong>
            <pre style={pre}>
              {Object.entries(flags.getAll(ctx))
                .map(([key, d]) => `${key}: enabled=${d.enabled} value=${JSON.stringify(d.value)} variant=${d.variant} reason=${d.reason}`)
                .join('\n') || '(no flags)'}
            </pre>
          </div>
        ))}
        <pre style={pre}>
          {(() => {
            const d = flags.getDetail('nonexistent_flag', { userId: 'user-1' }, 'fallback');
            return `nonexistent_flag → value=${d.value} reason=${d.reason}`;
          })()}
        </pre>
      </section>

      <ClientDemo />
    </div>
  );
}

const card = { background: 'white', borderRadius: 8, padding: 20, marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const pre = { margin: '6px 0 0', padding: 8, background: '#f1f5f9', borderRadius: 4, fontSize: 12, overflow: 'auto' as const };
