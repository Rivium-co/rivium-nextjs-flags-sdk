import { RiviumFlagsConfig, FeatureFlag, FlagEvalResult, FeatureFlagCallback } from './types';
import { evaluateFlag } from './evaluate';

const DEFAULT_BASE_URL = 'https://flags.rivium.co';

/**
 * RiviumFlags - Server-side SDK for Next.js (App Router, API Routes, Middleware)
 *
 * Uses both x-api-key and x-server-secret for secure server-side access.
 *
 * @example
 * ```typescript
 * // app/page.tsx (Server Component)
 * import { RiviumFlags } from '@rivium/flags-nextjs';
 *
 * const flags = new RiviumFlags({
 *   apiKey: process.env.RIVIUM_FLAGS_API_KEY!,
 *   serverSecret: process.env.RIVIUM_FLAGS_SERVER_SECRET!,
 * });
 *
 * export default async function Page() {
 *   await flags.init();
 *   const darkMode = flags.isEnabled('dark-mode', { userId: 'user-123' });
 *   return <div>{darkMode ? 'Dark' : 'Light'}</div>;
 * }
 * ```
 */
export class RiviumFlags {
  private config: RiviumFlagsConfig;
  private flags: FeatureFlag[] = [];
  private initialized = false;
  private callback?: FeatureFlagCallback;

  constructor(config: RiviumFlagsConfig) {
    if (!config.apiKey) throw new Error('apiKey is required');
    if (!config.serverSecret) throw new Error('serverSecret is required for server-side usage');
    this.config = { ...config, baseUrl: config.baseUrl || DEFAULT_BASE_URL };
  }

  async init(callback?: FeatureFlagCallback): Promise<void> {
    this.callback = callback;
    await this.fetchFlags();
    this.initialized = true;
    this.callback?.('initialized', { count: this.flags.length });
  }

  isEnabled(
    flagKey: string,
    context?: { userId?: string; userAttributes?: Record<string, any> },
    defaultValue = false,
  ): boolean {
    const flag = this.flags.find((f) => f.key === flagKey);
    if (!flag) return defaultValue;
    return evaluateFlag(flag, context?.userId, context?.userAttributes).enabled;
  }

  getValue(
    flagKey: string,
    context?: { userId?: string; userAttributes?: Record<string, any> },
    defaultValue?: any,
  ): any {
    const flag = this.flags.find((f) => f.key === flagKey);
    if (!flag) return defaultValue;
    const result = evaluateFlag(flag, context?.userId, context?.userAttributes);
    return result.value ?? defaultValue;
  }

  evaluate(
    flagKey: string,
    context?: { userId?: string; userAttributes?: Record<string, any> },
  ): FlagEvalResult {
    const flag = this.flags.find((f) => f.key === flagKey);
    if (!flag) return { enabled: false, value: false };
    return evaluateFlag(flag, context?.userId, context?.userAttributes);
  }

  getAll(): FeatureFlag[] {
    return [...this.flags];
  }

  async refresh(): Promise<void> {
    await this.fetchFlags();
    this.callback?.('featureFlagsRefreshed', { count: this.flags.length });
  }

  reset(): void {
    this.flags = [];
    this.initialized = false;
  }

  dispose(): void {
    this.reset();
  }

  private get flagsUrl(): string {
    const base = `${this.config.baseUrl}/public/flags`;
    if (this.config.environment) {
      return `${base}?environment=${encodeURIComponent(this.config.environment)}`;
    }
    return base;
  }

  private async fetchFlags(): Promise<void> {
    try {
      const response = await fetch(this.flagsUrl, {
        headers: {
          'x-api-key': this.config.apiKey,
          'x-server-secret': this.config.serverSecret,
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this.flags = (data.flags || []) as FeatureFlag[];

      if (this.config.debug) {
        console.log(`[RiviumFlags] Fetched ${this.flags.length} flags`);
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('[RiviumFlags] Failed to fetch flags:', error);
      }
      this.callback?.('error', { message: `Failed to fetch flags: ${error}` });
    }
  }
}
