'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { RiviumFlagsClient } from './rivium-flags-client';
import {
  AttributeValue,
  EvaluatedFlag,
  FlagDetail,
  JsonValue,
  RiviumFlagsClientConfig,
  ValueType,
} from './types';

export interface RiviumFlagsContextValue {
  /** The underlying client. */
  client: RiviumFlagsClient;
  /** Results (cached or fetched) are available for the current user. */
  isReady: boolean;
  isEnabled: (key: string, defaultValue?: boolean) => boolean;
  getBoolean: (key: string, defaultValue: boolean) => boolean;
  getString: (key: string, defaultValue: string) => string;
  getNumber: (key: string, defaultValue: number) => number;
  getJson: <T = JsonValue>(key: string, defaultValue: T) => T;
  getDetail: <T = unknown>(key: string, defaultValue: T, valueType?: ValueType) => FlagDetail<T>;
  getAll: () => Record<string, EvaluatedFlag>;
  identify: (userId: string | null, attributes?: Record<string, AttributeValue>) => Promise<void>;
  setUserId: (userId: string | null) => Promise<void>;
  setAttributes: (attributes: Record<string, AttributeValue>) => Promise<void>;
  reset: () => Promise<void>;
  resetAnonymousId: () => Promise<void>;
  refresh: () => Promise<void>;
}

const RiviumFlagsContext = createContext<RiviumFlagsContextValue | null>(null);

export type RiviumFlagsProviderProps =
  | { config: RiviumFlagsClientConfig; client?: never; children: React.ReactNode }
  | { client: RiviumFlagsClient; config?: never; children: React.ReactNode };

/**
 * Provides Rivium Flags to client components. Pass a `config` (public key
 * only) or your own `client`. Results re-render consumers when they change.
 *
 * @example
 * ```tsx
 * // app/providers.tsx
 * 'use client';
 * import { RiviumFlagsProvider } from '@rivium/flags-nextjs/client';
 *
 * export function Providers({ children }: { children: React.ReactNode }) {
 *   return (
 *     <RiviumFlagsProvider config={{ apiKey: process.env.NEXT_PUBLIC_RIVIUM_API_KEY!, environment: 'production' }}>
 *       {children}
 *     </RiviumFlagsProvider>
 *   );
 * }
 * ```
 */
export function RiviumFlagsProvider(props: RiviumFlagsProviderProps) {
  const { children } = props;
  const [owned] = useState(() => !props.client);
  const [client] = useState(() => props.client ?? new RiviumFlagsClient(props.config!));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const offs = [client.on('ready', bump), client.on('change', bump)];
    void client.init().then(bump);
    return () => {
      offs.forEach((off) => off());
      if (owned) client.close();
    };
  }, [client, owned]);

  // Stable functions (safe in effect dependency lists); the value changes when results change.
  const actions = useMemo(
    () => ({
      client,
      isEnabled: (key: string, defaultValue = false) => client.isEnabled(key, defaultValue),
      getBoolean: (key: string, defaultValue: boolean) => client.getBoolean(key, defaultValue),
      getString: (key: string, defaultValue: string) => client.getString(key, defaultValue),
      getNumber: (key: string, defaultValue: number) => client.getNumber(key, defaultValue),
      getJson: <T = JsonValue,>(key: string, defaultValue: T) => client.getJson<T>(key, defaultValue),
      getDetail: <T = unknown,>(key: string, defaultValue: T, valueType?: ValueType) =>
        client.getDetail<T>(key, defaultValue, valueType),
      getAll: () => client.getAll(),
      identify: (userId: string | null, attributes?: Record<string, AttributeValue>) => client.identify(userId, attributes),
      setUserId: (userId: string | null) => client.setUserId(userId),
      setAttributes: (attributes: Record<string, AttributeValue>) => client.setAttributes(attributes),
      reset: () => client.reset(),
      resetAnonymousId: () => client.resetAnonymousId(),
      refresh: () => client.refresh(),
    }),
    [client],
  );

  const value = useMemo<RiviumFlagsContextValue>(
    () => ({ ...actions, isReady: client.isReady() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, version],
  );

  return <RiviumFlagsContext.Provider value={value}>{children}</RiviumFlagsContext.Provider>;
}

/**
 * Rivium Flags in a client component. Must be inside a `RiviumFlagsProvider`.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { useRiviumFlags } from '@rivium/flags-nextjs/client';
 *
 * export function Checkout() {
 *   const { isEnabled, getString } = useRiviumFlags();
 *   return isEnabled('new-checkout') ? <NewCheckout theme={getString('theme', 'light')} /> : <OldCheckout />;
 * }
 * ```
 */
export function useRiviumFlags(): RiviumFlagsContextValue {
  const ctx = useContext(RiviumFlagsContext);
  if (!ctx) throw new Error('Rivium Flags: useRiviumFlags must be used within a RiviumFlagsProvider');
  return ctx;
}
