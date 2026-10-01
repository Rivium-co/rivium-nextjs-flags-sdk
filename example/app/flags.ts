import { RiviumFlags } from '@rivium/flags-nextjs/server';

// One server SDK instance per process. The server secret stays on the server.
export const flags = new RiviumFlags({
  apiKey: process.env.RIVIUM_API_KEY || 'YOUR_API_KEY',
  serverSecret: process.env.RIVIUM_FLAGS_SERVER_SECRET || 'YOUR_SERVER_SECRET',
  environment: process.env.RIVIUM_FLAGS_ENVIRONMENT || undefined,
  initTimeoutMs: 3000,
});
