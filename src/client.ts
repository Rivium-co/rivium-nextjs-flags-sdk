/**
 * `@rivium/flags-nextjs/client` — browser-safe entry. Public key only; flags
 * are evaluated by Rivium Flags and the client never holds targeting rules or
 * the server secret.
 */
export { RiviumFlagsClient } from './rivium-flags-client';
export { RiviumFlagsProvider, useRiviumFlags } from './use-rivium-flags';
export type { RiviumFlagsContextValue, RiviumFlagsProviderProps } from './use-rivium-flags';
export { ANONYMOUS_ID_KEY } from './storage';
export { SDK_VERSION } from './version';
export type {
  RiviumFlagsClientConfig,
  RiviumFlagsClientEvent,
  RiviumFlagsClientEventPayload,
  RiviumFlagsClientListener,
  EvaluatedFlag,
  EvaluateResponse,
  KeyValueStorage,
  FlagDetail,
  Reason,
  ValueType,
  JsonValue,
  AttributeValue,
  Logger,
} from './types';
