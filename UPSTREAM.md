# Upstream attribution

This feasibility spike adapts the interaction idea of [pro-vi/cc-stretch](https://github.com/pro-vi/cc-stretch), revision `4466e112824cdf6c1f3530d1588080c8a5a1441e` (0.3.3), inspected on 2026-10-15.

Original license: MIT, preserved in `licenses/cc-stretch-MIT.txt`. Source checkout is locally available in ignored `upstream/cc-stretch`. No upstream source code has been copied into `src/`; the spike renderer is newly written. The upstream parser/layout/animation are not yet ported.

OpenCode API and host lifecycle inspected at tag `v2.0.28`: `packages/plugin/src/tui/context.ts`, `packages/plugin/src/host.ts`, `packages/tui/src/plugin/api.tsx`, `packages/tui/src/plugin/markdown.ts`, root `package.json`. Published `@opencode/plugin@2.0.28` and `@opentui/core@0.5.17` declarations were also inspected.

The host catalog pins OpenTUI core/solid 0.5.17 and patched solid-js 1.9.15. Published OpenTUI solid 0.5.17 declares an exact peer of solid-js 1.9.12. This spike does not use Solid or JSX; local 1.9.12 only satisfies the published peer constraint. Do not bundle these runtimes into a production plugin; verify the host's runtime module sharing.
