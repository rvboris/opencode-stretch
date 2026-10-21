# Compatibility spike results

## Verdict

The native OpenTUI renderer path is feasible in the **test renderer** with the exact OpenTUI version used by OpenCode 2.0.28. This is not yet a full host-loading or production acceptance pass.

## Executed validation

From `/home/boris/mygit/opencode-stretch`:

- `bun test tests/renderer.test.ts` — **1 passed, 0 failed** (Bun 1.3.14).
- `./node_modules/.bin/tsc --noEmit` — **passed**.
- Final `npm test && npm run typecheck` — **passed**, 1 test, 13 assertions. An earlier broad `bun test tests` also discovered ignored upstream Claude-specific tests and failed on missing Claude/React test runtime; the package script now names only the owned test file.
- Installed binary reports `opencode v2.0.28`.

The test mounts an actual native MarkdownRenderable and registers the stretch callback with `createMarkdownCodeBlockRenderer`. It uses OpenTUI's `mockMouse.click`, so clicks pass through native coordinate hit testing rather than calling the handler directly. It verifies collapsed text, opening, visible detail, resizing from 32 to 16 columns, content-change recreation, destruction of the old instance, restoration of open state, closing, and incomplete-input fallback destroying the custom block. Renderer and SyntaxStyle are destroyed in a finally block. This is simulated terminal input, not a human click in a PTY.

## Versions and install notes

- `@opencode/plugin`: 2.0.28
- `@opentui/core`, `@opentui/solid`: 0.5.17 (confirmed in the host tag's catalog)
- `solid-js`: 1.9.12 for the published OpenTUI peer; host uses patched 1.9.15. No Solid components are used by this renderer.
- TypeScript 5.9.3, @types/node 24.6.0.

Initial npm dependency resolution hung repeatedly. A background retry was explicitly terminated after successful installation with bounded fetches. Working local install used `--ignore-scripts --legacy-peer-deps --fetch-retries=0 --fetch-timeout=15000`. npm warns Node 24.16.0 is below core's Node >=26.4.0 requirement; runtime tests use supported Bun instead. No global packages or configurations were changed.

## Not verified / limitations

- Loading and interacting inside an isolated OpenCode host/PTY was **not run**. Therefore module-sharing, host sandbox/config loading and actual terminal mouse behavior remain acceptance gates.
- Plugin export is a root `tui.ts` and package `./tui` export, matching the inspected host resolver. Host import is not claimed tested.
- No persistent state, provenance validation, server RPC, guide injection or next-turn feedback. The spike's in-memory identity tuple is only an example, not authenticated session isolation.
- The test changes a complete block's content and then supplies partial JSON. It does not emulate every streaming cadence or assert host-specific message reconciliation.
- One summary/detail pair, not upstream's nested inline phrases. Keyboard activation, theme integration, animation and accessibility remain unimplemented.
- Registry cleanup returns the host unregister callback and clears memory; full host hot-reload behavior was source-inspected, not executed.

## Handoff

Core/backend should supply validated `StretchView` and implement `StretchState`. The renderer must not infer identity from the currently visible session, token text or a text hash. The current JSON format is provisional. Before deployment, replace the adapter with the agreed parser/provenance layer and run an isolated-host load/click/disposal check. Do not install this spike into the user's harness yet.
