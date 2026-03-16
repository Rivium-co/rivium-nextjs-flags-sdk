'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { RiviumFlagsClient } from './rivium-flags-client';
import { RiviumFlagsClientConfig, FeatureFlag, FlagEvalResult } from './types';

interface RiviumFlagsContextValue {
  isEnabled: (flagKey: string, defaultValue?: boolean) => boolean;
  getValue: (flagKey: string, defaultValue?: any) => any;
  evaluate: (flagKey: string) => FlagEvalResult;
  getAll: () => FeatureFlag[];
  setUserId: (userId: string) => void;
  getUserId: () => string | undefined;
  setUserAttributes: (attributes: Record<string, any>) => void;
  refresh: () => Promise<void>;
  isLoading: boolean;
  isReady: boolean;
}

const RiviumFlagsContext = createContext<RiviumFlagsContextValue | null>(null);

interface RiviumFlagsProviderProps {
  config: RiviumFlagsClientConfig;
  children: React.ReactNode;
}

/**
 * RiviumFlagsProvider - Wraps your app with feature flag context
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { RiviumFlagsProvider } from '@rivium/flags-nextjs';
 *
 * export default function Layout({ children }) {
 *   return (
 *     <RiviumFlagsProvider config={{ apiKey: process.env.NEXT_PUBLIC_RIVIUM_FLAGS_API_KEY! }}>
 *       {children}
 *     </RiviumFlagsProvider>
 *   );
 * }
 * ```
 */
export function RiviumFlagsProvider({ config, children }: RiviumFlagsProviderProps) {
  const [client] = useState(() => new RiviumFlagsClient(config));
  const [isLoading, setIsLoading] = useState(true);
  const [isReady, setIsReady] = useState(false);
  const [, setVersion] = useState(0);

  useEffect(() => {
    client.init().then(() => {
      setIsLoading(false);
      setIsReady(true);
    });
  }, [client]);

  const isEnabled = useCallback(
    (flagKey: string, defaultValue = false) => client.isEnabled(flagKey, defaultValue),
    [client, isReady],
  );

  const getValue = useCallback(
    (flagKey: string, defaultValue?: any) => client.getValue(flagKey, defaultValue),
    [client, isReady],
  );

  const evaluate = useCallback(
    (flagKey: string) => client.evaluate(flagKey),
    [client, isReady],
  );

  const getAll = useCallback(() => client.getAll(), [client, isReady]);

  const setUserId = useCallback(
    (userId: string) => client.setUserId(userId),
    [client],
  );

  const getUserId = useCallback(() => client.getUserId(), [client]);

  const setUserAttributes = useCallback(
    (attributes: Record<string, any>) => client.setUserAttributes(attributes),
    [client],
  );

  const refresh = useCallback(async () => {
    await client.refresh();
    setVersion((v) => v + 1);
  }, [client]);

  return (
    <RiviumFlagsContext.Provider
      value={{ isEnabled, getValue, evaluate, getAll, setUserId, getUserId, setUserAttributes, refresh, isLoading, isReady }}
    >
      {children}
    </RiviumFlagsContext.Provider>
  );
}

/**
 * useRiviumFlags - React hook for client-side feature flags
 *
 * @example
 * ```tsx
 * 'use client';
 * import { useRiviumFlags } from '@rivium/flags-nextjs';
 *
 * export function MyComponent() {
 *   const { isEnabled, isLoading } = useRiviumFlags();
 *
 *   if (isLoading) return <div>Loading...</div>;
 *
 *   return (
 *     <div>{isEnabled('new-feature') ? 'New Feature!' : 'Old Feature'}</div>
 *   );
 * }
 * ```
 */
export function useRiviumFlags(): RiviumFlagsContextValue {
  const context = useContext(RiviumFlagsContext);
  if (!context) {
    throw new Error('useRiviumFlags must be used within a RiviumFlagsProvider');
  }
  return context;
}
