# Spike handoff and ownership

The bounded compatibility spike is finished. Native OpenTUI 0.5.17 mouse hit testing, wrapping, recreation and disposal pass the owned test. Actual isolated-host loading remains an acceptance gate; no production backend is implemented here.

## Confirmed dependency boundary

Published @opencode/plugin 2.0.28 declares OpenTUI >=0.5.17, and the inspected OpenCode v2.0.28 host catalog uses 0.5.17. The project pins that version, not 0.5.8.

## Ownership for the next phase

- **Core/parser owner:** owns the wire-format parser, upstream `{{short|long}}` parsing adaptation and attribution, streaming/incomplete-input policy, stable fragment identifiers and parsed view model. No production parser was implemented by this spike.
- **Backend owner:** owns guide injection, server-issued turn tokens, transcript validation, session/message/block provenance, storage, RPC, and read-state feedback. Oracle reports these APIs available; this spike did not exercise them.
- **Renderer owner:** owns native Renderable construction, interaction, wrapping, theme/keyboard follow-up and cleanup. Renderer accepts the core's view model and delegates state transitions through an adapter; it does not authenticate IDs or discover the active session.

The proposed next-phase envelope is a fenced `stretch` body beginning with `v1 <server-issued-turn-token> <block-label>`, followed by `{{short|long}}` markup. This proposal is recorded, **not implemented**. `parseSpikeBlock` in `src/tui.ts` is a disposable JSON fixture parser; replace it instead of extending it into a parallel production parser.

Keep unvalidated interaction state local. Do not send durable read-state events until the completed transcript validates provenance. The current `StretchView` identity tuple describes the post-validation boundary; a production adapter must distinguish provisional from validated state rather than supplying guessed session/message IDs.

## Existing interface

`createStretchRenderer(context, view, state)` returns a native Renderable. `state.isOpen(view)` restores state during recreation and `state.setOpen(view, open)` receives toggles. Current `view` contains summary/detail and a validated-identity-shaped tuple; it is a feasibility interface, not the final nested-fragment schema. Agree the core AST and fragment event type before implementing nested phrase rendering.

No further implementation is underway in this spike. Core/backend may replace the fixture adapter without overlapping ongoing work.
