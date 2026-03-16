'use client';

import { useRiviumFlags, RiviumFlagsProvider, RiviumFlagsClient } from '@rivium/flags-nextjs';
import { useState } from 'react';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Client Component — uses apiKey only (no serverSecret)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const API_KEY = 'YOUR_API_KEY'; // Use NEXT_PUBLIC_ prefix in real usage

export function ClientTestWrapper() {
  const [selectedEnv, setSelectedEnv] = useState('none');

  return (
    <RiviumFlagsProvider config={{ apiKey: API_KEY, environment: selectedEnv === 'none' ? undefined : selectedEnv, debug: true }} key={selectedEnv}>
      <ClientTest selectedEnv={selectedEnv} setSelectedEnv={setSelectedEnv} />
    </RiviumFlagsProvider>
  );
}

function ClientTest({ selectedEnv, setSelectedEnv }: { selectedEnv: string; setSelectedEnv: (env: string) => void }) {
  const { isEnabled, getValue, evaluate, getAll, setUserId, getUserId, setUserAttributes, refresh, isLoading, isReady } = useRiviumFlags();
  const [userId, setUserIdState] = useState('test-user-1');
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog((prev) => [...prev, msg]);

  if (isLoading) {
    return <div style={{ padding: 20 }}>Loading flags...</div>;
  }

  const runTests = async () => {
    setLog([]);

    // Set user
    setUserId(userId);
    setUserAttributes({ plan: 'pro', country: 'US' });
    addLog(`Set userId: ${userId}, attributes: {plan: "pro", country: "US"}`);

    // All flags
    const all = getAll();
    addLog(`Fetched ${all.length} flags: ${all.map((f) => f.key).join(', ')}`);

    // Boolean flag
    const dm = isEnabled('dark_mode');
    addLog(`dark_mode: isEnabled = ${dm}`);

    // Multivariate (getValue)
    const cv = getValue('checkout_flow');
    addLog(`checkout_flow: getValue = ${cv}`);

    // Evaluate (full result)
    const evalResult = evaluate('checkout_flow');
    addLog(`checkout_flow: evaluate = enabled=${evalResult.enabled}, value=${evalResult.value}, variant=${evalResult.variant}`);

    // Targeting
    const pm = isEnabled('premium_banner');
    addLog(`premium_banner (pro/US): ${pm}`);

    // Default value
    const missing = getValue('nonexistent_flag', 'fallback');
    addLog(`nonexistent_flag: getValue = "${missing}" (default: "fallback")`);

    // getUserId
    const currentId = getUserId();
    addLog(`getUserId = "${currentId}" (expected: "${userId}")`);

    // Refresh
    await refresh();
    addLog(`Refreshed flags. Total: ${getAll().length}`);

    // Environment overrides
    // Setup in dashboard:
    //   1. Create a flag (e.g. "maintenance_mode") → globally disabled
    //   2. Create environments: development, staging, production
    //   3. Override: development → enabled, staging → enabled, production → keep default
    const allCurrent = getAll();
    const testFlagKey = allCurrent.length > 0 ? allCurrent[0].key : 'maintenance_mode';
    const envLines: string[] = [];

    for (const env of ['none', 'development', 'staging', 'production']) {
      try {
        const envClient = new RiviumFlagsClient({
          apiKey: API_KEY,
          environment: env === 'none' ? undefined : env,
          debug: true,
        });
        await envClient.init();
        envClient.setUserId(userId);
        const flagEnabled = envClient.isEnabled(testFlagKey);
        const flagValue = envClient.getValue(testFlagKey);
        envLines.push(`${env}: enabled=${flagEnabled}, value=${flagValue}, flags=${envClient.getAll().length}`);
      } catch (e) {
        envLines.push(`${env}: error=${e}`);
      }
    }
    addLog(`Environment overrides (${testFlagKey}):\n${envLines.join('\n')}`);

    // Reset & Dispose (standalone client)
    const standaloneClient = new RiviumFlagsClient({ apiKey: API_KEY, debug: true });
    await standaloneClient.init();
    const beforeReset = standaloneClient.getAll().length;
    standaloneClient.dispose();
    standaloneClient.reset();
    const afterReset = standaloneClient.getAll().length;
    addLog(`Reset & Dispose: before=${beforeReset} flags, dispose() called, after=${afterReset} flags`);
  };

  return (
    <div style={{ background: 'white', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
      <h2 style={{ margin: '0 0 16px', color: '#333' }}>Client Component Tests (useRiviumFlags hook)</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <label style={{ fontWeight: 600 }}>User:</label>
        {['test-user-1', 'test-user-2', 'test-user-3'].map((uid) => (
          <button
            key={uid}
            onClick={() => { setUserIdState(uid); setUserId(uid); }}
            style={{
              padding: '4px 12px',
              border: userId === uid ? '2px solid #d97706' : '1px solid #ddd',
              borderRadius: 6,
              background: userId === uid ? '#fef3c7' : 'white',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {uid}
          </button>
        ))}
        <button
          onClick={runTests}
          style={{
            marginLeft: 'auto',
            padding: '6px 16px',
            background: '#d97706',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Run Tests
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <label style={{ fontWeight: 600 }}>Env:</label>
        {['none', 'development', 'staging', 'production'].map((env) => (
          <button
            key={env}
            onClick={() => setSelectedEnv(env)}
            style={{
              padding: '4px 12px',
              border: selectedEnv === env ? '2px solid #3b82f6' : '1px solid #ddd',
              borderRadius: 6,
              background: selectedEnv === env ? '#dbeafe' : 'white',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {env === 'none' ? 'Global' : env}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <span style={{
          padding: '4px 10px',
          borderRadius: 4,
          fontSize: 12,
          background: isReady ? '#dcfce7' : '#fef9c3',
          color: isReady ? '#166534' : '#854d0e',
        }}>
          {isReady ? '● Ready' : '○ Initializing'}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 4, fontSize: 12, background: '#e0f2fe', color: '#0c4a6e' }}>
          {getAll().length} flags loaded
        </span>
      </div>

      {log.length > 0 && (
        <pre style={{
          background: '#1e293b',
          color: '#e2e8f0',
          padding: 16,
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.6,
          overflow: 'auto',
          maxHeight: 400,
        }}>
          {log.map((l, i) => `${i + 1}. ${l}`).join('\n')}
        </pre>
      )}
    </div>
  );
}
