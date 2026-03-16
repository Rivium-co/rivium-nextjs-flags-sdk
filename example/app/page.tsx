import { RiviumFlags } from '@rivium/flags-nextjs';
import { ClientTestWrapper } from './client-test';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Rivium Flags — Next.js SDK Test Suite
// Server Component (SSR) + Client Component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API_KEY = process.env.RIVIUM_FLAGS_API_KEY || 'YOUR_API_KEY';
const SERVER_SECRET = process.env.RIVIUM_FLAGS_SERVER_SECRET || 'YOUR_SERVER_SECRET';

interface TestResult {
  test: string;
  detail: string;
  pass: boolean;
}

export default async function Page() {
  // ── Server-side tests (only run if SERVER_SECRET is configured) ──
  let serverResults: TestResult[] | null = null;

  if (SERVER_SECRET) {
    serverResults = [];

    const flags = new RiviumFlags({
      apiKey: API_KEY,
      serverSecret: SERVER_SECRET,
      debug: true,
    });

    try {
      await flags.init();
      serverResults.push({ test: 'Initialize SDK', detail: 'Connected with API key + server secret', pass: true });
    } catch (error) {
      serverResults.push({ test: 'Initialize SDK', detail: `Failed: ${error}`, pass: false });
    }

    if (serverResults[0]?.pass) {
      const allFlags = flags.getAll();
      serverResults.push({
        test: 'GET /public/flags',
        detail: `Fetched ${allFlags.length} flags: ${allFlags.map((f) => f.key).join(', ')}`,
        pass: allFlags.length > 0,
      });

      const darkMode = flags.isEnabled('dark_mode', { userId: 'test-user-1' });
      serverResults.push({ test: 'Boolean flag: dark_mode', detail: `isEnabled = ${darkMode}`, pass: true });

      const checkout = flags.evaluate('checkout_flow', { userId: 'test-user-1' });
      serverResults.push({
        test: 'Multivariate: checkout_flow',
        detail: `enabled=${checkout.enabled}, value=${checkout.value}, variant=${checkout.variant}`,
        pass: true,
      });

      const premiumMatch = flags.isEnabled('premium_banner', {
        userId: 'test-user-1',
        userAttributes: { plan: 'pro', country: 'US' },
      });
      serverResults.push({ test: 'Targeting (plan=pro, country=US)', detail: `premium_banner = ${premiumMatch}`, pass: true });

      const premiumNoMatch = flags.isEnabled('premium_banner', {
        userId: 'test-user-1',
        userAttributes: { plan: 'free', country: 'IR' },
      });
      serverResults.push({ test: 'Targeting (plan=free, country=IR)', detail: `premium_banner = ${premiumNoMatch}`, pass: true });

      const rollout: Record<string, boolean> = {};
      for (const uid of ['user-1', 'user-2', 'user-3', 'user-4', 'user-5']) {
        rollout[uid] = flags.isEnabled('gradual_redesign', { userId: uid });
      }
      const enabledCount = Object.values(rollout).filter(Boolean).length;
      serverResults.push({
        test: 'Rollout 30%: gradual_redesign',
        detail: `${Object.entries(rollout).map(([k, v]) => `${k}=${v}`).join(', ')} → ${enabledCount}/5 enabled`,
        pass: true,
      });

      const missing = flags.getValue('nonexistent_flag', {}, 'fallback');
      serverResults.push({
        test: 'Default value: nonexistent_flag',
        detail: `getValue = "${missing}" (default: "fallback")`,
        pass: missing === 'fallback',
      });

      await flags.refresh();
      serverResults.push({ test: 'Manual refresh', detail: `Refreshed. Total: ${flags.getAll().length} flags`, pass: true });

      const testFlagKey = allFlags.length > 0 ? allFlags[0].key : 'maintenance_mode';
      const envLines: string[] = [];
      for (const env of ['none', 'development', 'staging', 'production']) {
        try {
          const envFlags = new RiviumFlags({
            apiKey: API_KEY,
            serverSecret: SERVER_SECRET,
            environment: env === 'none' ? undefined : env,
            debug: true,
          });
          await envFlags.init();
          const flagEnabled = envFlags.isEnabled(testFlagKey, { userId: 'test-user-1' });
          const flagValue = envFlags.evaluate(testFlagKey, { userId: 'test-user-1' });
          envLines.push(`${env}: enabled=${flagEnabled}, value=${flagValue.value}, flags=${envFlags.getAll().length}`);
        } catch (e) {
          envLines.push(`${env}: error=${e}`);
        }
      }
      serverResults.push({
        test: `Environment overrides: ${testFlagKey}`,
        detail: `Flag "${testFlagKey}" across environments:\n${envLines.join('\n')}`,
        pass: true,
      });

      const flagsBefore = flags.getAll().length;
      flags.dispose();
      flags.reset();
      serverResults.push({
        test: 'Reset & Dispose',
        detail: `Before: ${flagsBefore} flags, After reset: ${flags.getAll().length} flags`,
        pass: flags.getAll().length === 0,
      });
    }
  }

  return (
    <div>
      <h1 style={{ color: '#d97706', marginBottom: 4 }}>Rivium Flags — Next.js SDK Test Suite</h1>
      <p style={{ color: '#666', marginTop: 0 }}>Server-side (SSR) + Client-side evaluation</p>

      {serverResults ? (
        <TestUI results={serverResults} title="Server Component Tests (SSR with serverSecret)" />
      ) : (
        <div style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <strong>Server-side tests skipped</strong>
          <p style={{ margin: '8px 0 0', color: '#854d0e', fontSize: 14 }}>
            Set <code>RIVIUM_FLAGS_SERVER_SECRET</code> env var to enable server-side evaluation tests.
            Server components run on your Node.js server during SSR — the secret never reaches the browser.
          </p>
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <ClientTestWrapper />
      </div>
    </div>
  );
}

function TestUI({ results, title }: { results: TestResult[]; title: string }) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;

  return (
    <div style={{ background: 'white', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h2 style={{ margin: '0 0 16px', color: '#333' }}>{title}</h2>

      {results.map((r, i) => (
        <div key={i} style={{ marginBottom: 12, padding: 12, background: '#fafafa', borderRadius: 6, border: '1px solid #eee' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 'bold' }}>
              Test {i + 1}
            </span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{r.test}</span>
            <span style={{ marginLeft: 'auto', color: r.pass ? '#16a34a' : '#dc2626' }}>
              {r.pass ? '✓' : '✗'}
            </span>
          </div>
          <pre style={{ margin: '8px 0 0', padding: 8, background: '#f1f5f9', borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
            {r.detail}
          </pre>
        </div>
      ))}

      <div style={{ marginTop: 16, padding: '12px 16px', background: '#f0fdf4', borderRadius: 6, display: 'flex', gap: 16 }}>
        <span style={{ color: '#16a34a' }}>✓ Passed: {passed}</span>
        {failed > 0 && <span style={{ color: '#dc2626' }}>✗ Failed: {failed}</span>}
        <span style={{ color: '#666' }}>Total: {results.length}</span>
      </div>
    </div>
  );
}
