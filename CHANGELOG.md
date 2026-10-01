# Changelog

## 0.2.0

Breaking release. See the README for the short migration from 0.1.x.

- Two entry points: `@rivium/flags-nextjs/server` (server secret, local evaluation) and
  `@rivium/flags-nextjs/client` (public key only, browser-safe; the package root is the client).
- Client: flags are evaluated on the Rivium Flags server; targeting rules never reach the browser.
- Typed getters with a reason for every value; anonymous id so rollouts work for signed-out users.
- Rollouts and variant splits use a new hash, so users are re-bucketed once.

## 0.1.0

- Initial release.
