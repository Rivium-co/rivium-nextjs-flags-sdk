/**
 * `@rivium/flags-nextjs/server` — server-only entry (Server Components, Route
 * Handlers, Server Actions, middleware). Needs the server secret; evaluates
 * every flag locally. Never import it from a client component.
 */
export { RiviumFlags } from './rivium-flags';
export { evaluate, bucket, bucketingId, buildSnapshot } from './engine';
export type { Snapshot } from './engine';
export { SDK_VERSION } from './version';
export type {
  RiviumFlagsConfig,
  EvaluationContext,
  AttributeValue,
  FlagDetail,
  EvalResult,
  Reason,
  ValueType,
  JsonValue,
  Logger,
  FlagConfig,
  SegmentConfig,
  Group,
  Condition,
  Variant,
  Prerequisite,
  ServerFlagsPayload,
  RiviumFlagsEvent,
  RiviumFlagsEventPayload,
  RiviumFlagsListener,
} from './types';
