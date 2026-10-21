# Real-host validation — 2026-10-16

## Multiline collapse failure: reproduced and fixed

Root cause: OpenTUI `paragraph.lineInfo.lineStartCols` contains paragraph-wide display-column offsets, including earlier source lines. Renderer zones reset to column zero after each newline. The old hit test compared these different coordinate spaces. Example from the failing test: source lines `[0,0,1,1,2,2,3]`, starts `[0,79,88,167,176,255,264]`; the visible arrow at x=1 on source line 3 was tested at column 265 against zone `[1,2)`. Single-source-line wrapping passed, explaining the earlier simplistic host result.

Targeted fix in `src/renderer.ts`: subtract the first visual row start for the clicked source line before comparing to zones. No aesthetics, state, backend, RPC, configuration, host prototypes or runtime patches changed. Session-scoped queued RPC routing in `src/tui.ts` is untouched.

Test-first evidence: `npm test -- tests/collapse.test.ts` initially failed on LF/CRLF cases at widths 80/40/13/8. Emoji failures were a test-coordinate error (UTF-16 indexing), corrected by native display-width measurement before accepting the regression. Reverted the renderer fix for a second controlled reproduction: `npm test -- tests/collapse.test.ts -t '80 extra "\\n"'` failed (open set remains size 1); the same old renderer also fails `python3 .host-test/collapse-pty.py` with `AssertionError: collapse failed`. Restored the targeted fix afterwards.

Isolated real host: session `ses_ebe568c0fffewV73ktKucFt8QG`, OpenCode 2.0.28; local deterministic provider only. `.host-test/collapse-fixture.txt` includes three long Cyrillic paragraphs and a nested multiline fragment. `collapse-pty.py` reconstructs screen cells with pyte and finds visible text/«, never hardcodes the old click coordinate. Successful outer collapse at zero-based (101,10), nested collapse (44,10), resized 110→70 collapse (39,14), then height 18 + wheel scroll collapse (39,7). Assertions inspect the actual resulting screen. Before-fix evidence: `.host-test/collapse-before-fix-results.json`, `collapse-before-fix-closed.txt`. Passing evidence: `.host-test/collapse-pty-results.json`, `collapse-pty.bin`, `collapse-{expanded,closed,nested,nested-closed,resized,resize-closed,scrolled,scroll-closed}.txt`.

Commands/results after fix: `npm test` **33 passed / 4 files**, `npm run typecheck` **exit 0**; `npm run lint` reports **60 warnings, 11 infos, no errors**. `python3 .host-test/collapse-pty.py` **passed**. `node .host-test/e2e.mjs` next-turn provider request retains read telemetry exactly `["Кратко","вложено"]` after both were closed, no unrelated short text. Full local request evidence remains private in `.host-test/provider-requests.jsonl`.

Only this run's provider PID 1896345, isolated server PID 1896393 and launcher PID 1896392 were terminated after validation. User's host untouched. Installed entrypoint references project source; restart the user's host to load the corrected renderer. HARNESS-STATE current-state section updated.

## Session-location routing fix: fresh isolated gate

Cause: optional setup-level api.location is absent in the actual host. Unscoped resolve RPCs used server cwd `.host-test`, unlike the project-scoped turn token. SDK Data.session.get(sessionID) returns SessionInfo.location (public declaration exposes directory; runtime workspaceID is preserved when present). TUI now binds scope into its local block key, retains it with verified identity for queued recordOpened, waits for metadata/data events, and rejects stale scope results. No backend or renderer changes.

Test-first reproduction failed on an unexpected resolve with undefined location. Updated test verifies missing metadata deferral and identical project-directory/workspace location for resolution and queued opens. Final independent gates: npm run lint exit 0 (existing informational diagnostics remain), npm run typecheck exit 0, npm test exit 0: all 13 tests, 3 files, Vitest 5.0.5.

Fresh isolated session: `ses_ebe67dd23ffe5NS1kHehcTYGGb`; session directory `/home/boris/mygit/opencode-stretch`, server cwd `/home/boris/mygit/opencode-stretch/.host-test`. Commands: run-isolated.py serve --hostname 127.0.0.1 --port 43829 --print-logs; local provider.mjs; request.mjs session creation with explicit location; happy.mjs start; pty-check.py --happy; e2e.mjs. No external provider costs or manual recordOpened calls. Scratch CLI plugin entrypoint corrected to explicit project tui.ts; stale debug setup reference removed.

Fresh tui-rpc.jsonl reports resolveBlock valid:true and recordOpened recorded:true from the real PTY mouse click. Screen reconstruction: pty-before-expand.bin shows Host summary, pty-before-collapse.bin shows HOST DETAIL visible after clicking expand. «, pty-before-resize.bin and pty-output.bin show Host summary after collapse and 110→70 resize. PTY exit 130 is deliberate teardown.

The first follow-up helper incorrectly omitted location and received empty telemetry; e2e.mjs now sends explicit session directory. Its next provider request for the same fresh session contains ["Host summary"] after collapse, demonstrating persisted history across requests. e2e-result.json records promptStatus 200. Direct on-disk durable storage inspection was not established (data-directory JSON scan found none), so persistence evidence is the subsequent independent server request, not a fabricated storage dump. Second fresh session `ses_ebe66b60bffebKUiNes2OAS7pe` received []; evidence scope-isolation.json. All artifacts are under .host-test and were regenerated; earlier entries below are historical, not evidence for this run. Only owned isolated server/provider process groups 1793295/1793296 were stopped; no global restart.

## Inline refinement: native interaction PASS; fresh telemetry gate NOT PASSED

The UI now renders a single ordinary, unboxed paragraph. Underlined cyan short phrases replace themselves with their long text; an inline `«` collapses each independently. Surrounding words are not clickable. Nested fragments retain their own keys and only explicit opens call `setOpen`. The supported Markdown fence boundary remains. No host source, prototype, private field, or global renderer patches were used.

Public OpenTUI `StyledText` supplies spans. Public `TextRenderable.lineInfo` maps visual rows to logical lines and display columns. Temporary, explicitly destroyed `TextBuffer`/`TextBufferView` instances measure target columns with the host's native width method. All constructors come from the same host runtime already injected by `src/tui.ts`.

### Executed validation

- `npm run lint`: exit 0 (52 warnings, 11 informational notices; not a warning-free result). An initial run failed formatting; formatting was corrected. The final npm invocation was captured through a Node subprocess because the shell wrapper misclassified its output as ESLint JSON.
- `npm run typecheck`: exit 0.
- `npm test`: 13/13 passed using existing project-local Node 26.12.0 and Vitest 5.0.5. Original ten tests preserved and adapted to the new collapse target; three added cases cover independent spans, non-target clicks, Cyrillic, wide `界`, widths 40/13/8, resize, and inline collapse. Existing nested/recreation/disposal and queued RPC tests pass.
- Actual installed OpenCode 2.0.28 isolated PTY, deterministic provider only: `python3 .host-test/pty-check.py --happy`. SGR mouse click column 8, row 7 opens; column 49, row 7 clicks `«`; terminal resized 110→70 columns. `pyte` screen reconstruction confirms `Host summary` before open, `HOST DETAIL visible after clicking expand. «` before collapse, `Host summary` after collapse and after resize. Evidence: `.host-test/inline-evidence.json`, `pty-before-*.bin`, `pty-output.bin`. No native destroy errors observed. PTY exit 130 is intentional teardown.
- Scratch provider token matcher updated for the current guide wording (`first line is exactly:`); initial attempts produced ordinary deterministic text, not stretch, and are not counted as UI success.

### Remaining limit requiring parent integration follow-up

Fresh real-host `resolveBlock` returned `{valid:false}` twice. The actual click produced a TUI `send` event but no successful `recordOpened`; no next-turn telemetry success is claimed for this revision. No manual `recordOpened` substitution or backend/core/RPC change was made. This is separate from successful visual open/collapse/resize and the passing mocked RPC regression. Earlier end-to-end results below are historical, not proof that this fresh gate passed. Exotic grapheme boundaries and terminal tab behavior are not separately validated; Cyrillic and wide CJK are.

Only isolated processes started for this run were stopped. Scratch `pyte` dependency is under `.host-test/python-libs`, not system Python. No global config or running user host was restarted.

---

# Earlier real-host validation — 2026-10-15

## End-to-end UI telemetry gate PASSED (latest)

The previously failing chain — real PTY click → TUI `recordOpened` → durable record → next model request telemetry — now passes against the installed OpenCode 2.0.28 host with the deterministic local provider. No backend/core/RPC files were changed; no manual `recordOpened` substitution was used.

### Diagnosis of the earlier empty-telemetry run

`src/tui.ts` was temporarily instrumented (kept behind the `STRETCH_DEBUG` env var, zero effect when unset) to log setup, transcript matching, `resolveBlock` results, validation, `send`, and `recordOpened` outcomes/exceptions. The re-run could not reproduce the failure: every stage succeeded. Evidence (`/.host-test/tui-rpc.jsonl`, timestamps ms):

1. `setup` with a live RPC client.
2. `resolveBlock` → `valid:true`, canonical identity, `stretchKeys:["0"]`.
3. `validated` — TUI identity cross-check passed (backend `view.blockID === identity`, session/message/detail matched the transcript match).
4. PTY mouse click at 5 s → `send` with fragment `0`, verified identity present.
5. `recordOpened` → `{recorded:true}` ~4.9 s into the run, well before the 20 s PTY termination.
6. Next real prompt: provider-captured system instruction ends with `Prior-turn UI telemetry ... : ["Host summary"]`.

Collapse was clicked at 9 s and the following turn still carried `["Host summary"]`: collapsing is a local view change and does not erase the durable record. A second, unrelated real session received telemetry `[]` — session isolation intact.

The earlier failure is therefore classified as a run-specific timing/scope artifact rather than a reproducible production defect: with the current code, the pending queue is flushed both when validation completes and on data events, so a click racing an in-flight `resolveBlock` is covered. One confirmed scope subtlety remains worth knowing: RPC calls must resolve to the session's location scope; the HTTP gate earlier showed a plain `directory` query selecting the wrong scope. The TUI passes its ambient location and that resolved correctly here.

### Actual commands and artifacts

```sh
python3 .host-test/run-isolated.py serve --hostname 127.0.0.1 --port 43829 --print-logs   # isolated server
node .host-test/provider.mjs                                                            # deterministic provider, port 43830
node .host-test/happy.mjs start && node .host-test/happy.mjs                           # real session + issued-token answer
python3 .host-test/pty-check.py --happy                                                # real PTY: expand(5s), collapse(9s), resize(12s)
node .host-test/e2e.mjs                                                                # real follow-up prompt + telemetry check
```

- `.host-test/tui-rpc.jsonl` — full instrumented RPC chain.
- `.host-test/e2e-result.json` / `provider-requests.jsonl` — next-request telemetry `["Host summary"]`; isolation session `[]`.
- `pty-before-*.bin` deltas — expand shows `HOST DETAIL ...`, collapse returns `Expand`.

### Regression test added

`tests/renderer.test.ts` now asserts that collapsing after a successful record neither un-records nor re-reports, that re-expanding may idempotently re-report, and that a late reply after disposal adds nothing. `npm run typecheck && npm test`: **10 pass, 0 fail, 81 assertions**.

### Remaining gates (parent installation acceptance)

- Human visual check of expand/collapse in a real interactive terminal (current evidence is simulated PTY mouse plus captured frames).
- Theme switching and session-navigation cleanup were not explicitly exercised this round.
- Diagnostic `STRETCH_DEBUG` logging remains env-gated in `src/tui.ts`; parent may request removal before installation.
- `.host-test/` contains an expired local server credential in `server.log`; keep it out of commits.

## Deterministic real-host backend gate (latest follow-up)

**Backend API happy path passed; end-to-end TUI persistence gate remains blocked.** Production sources were not modified during this gate. Added root `index.ts` as a direct re-export of `src/index.ts`; isolated config loads the actual project directory, not `.host-test/plugin`.

- Started isolated installed OpenCode 2.0.28 server on loopback port 43829 and a local OpenAI-compatible streaming provider on 43830. Provider configuration uses `aisdk:@ai-sdk/openai-compatible`. No external model request or cost was involved.
- Created a real session with the host session API and submitted a real prompt. The provider captured a system instruction containing a generated UUID turn token, copied it into a stretch response, and streamed a normal stop completion. No session import, token fabrication, or database edits were used.
- Real transcript contained completed assistant text with the issued token. `resolveBlock` returned `valid:true`, a canonical identity, key `0`, and the expected server-derived view. RPC HTTP calls must use deep-object `location[directory]`; a plain `directory` query selected a different scope and returned false.
- Attached the real TUI to this session using the actual project directory. PTY mouse input expanded the block: captured output changed from `Host summary · Expand` to `Collapse` and `HOST DETAIL visible after clicking expand.` Collapse and resize inputs were also delivered.
- **Failure:** the subsequent actual model request still contained telemetry `[]`. Thus an actual UI expansion did not produce durable feedback through this run's TUI RPC path. This is not approved as an end-to-end pass. Investigate production TUI resolution/recording/location handling; changing that code is outside this gate's write scope.
- Separately verified the backend without pretending it was the click path: explicit HTTP `recordOpened` returned `{recorded:true}` for a resolved completed block. Opening the immediately preceding reply via this API and submitting another real prompt produced bounded telemetry `["Host summary"]` in the provider-captured system request. This proves real host hook → transcript → RPC → durable storage → next hook, but does not substitute for the failed UI recording gate.
- `npm run typecheck && npm test`: exit 0; TypeScript clean; **10 tests passed, 0 failed, 79 assertions**, across two files.
- Isolated server/provider process groups were terminated afterward; the PTY helper terminates its own client. No global config was modified.

Reproduction/evidence (ignored local directory): `.host-test/provider.mjs`, `happy.mjs`, `backend-gate.mjs`, `pty-check.py --happy`, `happy-session.json`, `happy-context.json`, `happy-resolve.json`, `happy-open.json`, `backend-gate.json`, `provider-requests.jsonl`, and PTY captures. Server logs contain an ephemeral local password and must not be published; credentials are intentionally omitted here.

Remaining acceptance gates: fix and rerun actual click → durable opened record → next-request telemetry; then parent-controlled final install approval. Restart durability was not independently exercised in this run.


## Latest result: native host interaction PASSED; backend happy path still pending

Follow-up validation fixed the cross-runtime lifecycle failure. `src/tui.ts` now imports the host's registered virtual module `opentui:runtime-module:%40opentui%2Fcore` (the ID produced by OpenTUI's exported `runtimeModuleIdForSpecifier('@opentui/core')`). It passes those constructors explicitly into `createStretchRenderer`. The renderer factory keeps its local default only for standalone tests. Setup asserts that `api.renderer.root instanceof runtime.BaseRenderable`; incompatible runtime construction is rejected rather than silently accepted. No destruction suppression, timer reconstruction, or host-removal override is used in production code.

The host's normal import rewriting reached the diagnostic entrypoint but did not give the transitive project renderer matching constructors in the earlier run. Explicitly selecting the registered shared module avoids depending on transitive rewrite discovery. Peer dependencies alone would not fix this.

### New real-host evidence

- Minimal `stretch-probe` language: a shared-runtime Box + Text displays `click me`; two PTY SGR mouse clicks reached the child (`probe-click` logged twice). Style refresh produced create → destroy → create, and shutdown destroyed the replacement and called cleanup.
- Full stretch: constructor identity check passes; style refresh logs callback sequence 1 → successful destroy → callback sequence 2. Current root has width 103, height 1, x=5, y=6 and one child. No destroy error is logged.
- PTY full stretch: initial summary present; mouse down/up at terminal column 8, row 7 displays `HOST DETAIL visible after clicking expand.`; second click returns heading to Expand and removes detail. `.host-test/interaction-results.json` records `initial:true`, `expanded:true`, `collapsed:true` from separate output intervals.
- Resize from 110 to 70 columns with SIGWINCH produces a real redraw. Native replacement survives; shutdown destroys it cleanly. Explicit theme switching and session-navigation cleanup have not been exercised.
- Actual run commands: `node .host-test/import-fixture.mjs --probe`, `python3 .host-test/pty-check.py --probe`, then `python3 .host-test/pty-check.py` for full stretch.
- Final typecheck and UI test results are recorded below; no backend files or global configuration were changed.

The test fixture still uses an unissued token. Positive guide execution, valid identity resolution and next-turn feedback remain an acceptance gate; neither the shared-runtime fix nor synthetic import establishes those. The smallest remaining integration step is a local deterministic provider/context run that obtains the actual server-issued token and returns it in a completed stretch answer, followed by the same PTY clicks and RPC/storage assertions. No remote model call was made.

## Earlier result (superseded for native rendering): acceptance gate NOT PASSED

The installed OpenCode **2.0.28** was started with a real local server and a Python PTY. Both plugin entrypoints loaded through an isolated directory adapter, and the server RPC was callable. However, the custom block's children were destroyed by the host Markdown lifecycle before display. Expand/collapse and successful identity resolution were therefore **not established**. Do not install globally on the strength of unit tests alone.

## Isolation and commands

All explicit test data, config, source downloads, temporary files and scripts are under `.host-test/` in this project. `run-isolated.py` clears inherited OPENCODE/OPENCHAMBER variables, sets HOME and all XDG roots under `.host-test`, sets TMPDIR there and uses the installed binary by absolute path.

Executed:

```sh
python3 .host-test/run-isolated.py debug paths
python3 .host-test/run-isolated.py serve --hostname 127.0.0.1 --port 43829 --print-logs > .host-test/server.log 2>&1
node .host-test/import-fixture.mjs
python3 .host-test/pty-check.py
npm run typecheck
bun test ./tests/renderer.test.ts
```

`debug paths` confirmed config, data, state, cache, temporary files and DB are inside the project. The server was terminated after validation. No global configuration or harness-state files were edited. No dependencies installed. Source cloned locally at `v2.0.28`, commit `026b106bc5d41b679ffc413264229c340871e4d3`.

An early `debug config` without `--server` attempted the isolated managed service and hit the already-used default port. Subsequent checks used only an explicit dedicated server URL. The config API also lists `/home/boris/.opencode` as an ancestor discovery directory despite isolated HOME; it was not modified. For strict future isolation, disable ancestor discovery through a supported option if available or verify its plugin contents are not activated.

## Exact configuration / entrypoint finding

V2 uses **two files**, not a `tui` field inside server configuration:

- Server: `.host-test/config/opencode/opencode.jsonc`, `plugins` array.
- Terminal: `.host-test/config/opencode/cli.json`, top-level `plugins` array.

Initially both pointed at the project directory. No stretch server plugin appeared. The published host resolver for a directory looks for **`server` or `index`, plus `tui`** at that directory root. The package has exports `.` → `src/index.ts` and `./tui` → `tui.ts`, but no root server/index file. Absolute directory loading is therefore not equivalent to npm package-name export resolution.

For diagnosis, both configs now point at `.host-test/plugin`, containing:

- `server.ts`: reexports `../../src/index.ts`.
- `tui.ts`: wraps `../../src/tui.ts` for diagnostic setup/render/lifecycle logging.

This is test scaffolding, not a production installation recommendation. The package owner should add a root server entrypoint or use a properly resolved package-name installation and verify both exports. Backend/package files were not changed here.

## Positive evidence

- `GET /api/plugin?location[directory]=<project>/.host-test`: entry `opencode-stretch`, local `.../.host-test/plugin/server.ts`, features `{server:true,tui:true}`, state `active`.
- `POST /api/rpc/opencode-stretch/resolveBlock` with `{input:{sessionID,turnToken,blockLabel},location:{directory}}`: HTTP 200, `{output:{valid:false}}`. Confirms actual server registration and transport, not successful provenance validation.
- `POST /api/experimental/session/import`: HTTP 200. Imported a normal user message and a completed assistant message containing the agreed fenced format, without any model call or database edits.
- PTY started installed terminal with `--server http://127.0.0.1:43829 --session ses_stretch_host_fixture <project>/.host-test` at 110×32. Terminal rendered session title, user prompt and assistant footer.
- TUI wrapper logged setup with version `2.0.28`; registered callback received the actual stretch payload and returned a native `BoxRenderable2` with one child.
- Final `npm run typecheck && bun test ./tests/renderer.test.ts`: passed, 3 tests, 0 failures.

## Blocking native lifecycle evidence

Actual PTY output does **not** include `Host summary`, `Expand` or the detail. The diagnostic wrapper observed:

1. Renderer returned root with one native fragment child.
2. That child emitted `destroyed` during host `updateTopLevelBlocks` → `updateBlocks` → `rerenderBlocks` → `renderSelf`.
3. One second later root still reported layout width 103, height 1, x=5, y=6, but **zero children**.

Only one callback invocation was observed per run: the destroyed view was not replaced through another callback. This reproduces on repeated real-host runs while the standalone test renderer passes. The relevant stack is in `.host-test/tui-evidence.jsonl` and refers to the installed binary's bundled Markdown implementation. An experimental namespaced-ID change did not fix it and was reverted; no speculative UI fix remains.

Likely next investigation: compare the installed binary's top-level Markdown lifecycle with the published 0.5.17 implementation, and reproduce using `internalBlockMode: 'top-level'` plus the host's surrounding reconciliation. Do not work around this by returning prompt-only text or claiming test-renderer success proves host behavior.

## Remaining gates

- Fix real-host destruction/reuse; then assert summary exists in PTY output, send SGR mouse press/release at the measured heading coordinates, and assert detail appears/disappears.
- Obtain a **server-issued** token through a real context hook. Imported fixture token was intentionally fabricated, so `valid:false` is expected. Guide execution and positive identity resolution/read feedback are unverified. Use a local deterministic provider or a scoped fixture plugin invoking supported APIs rather than editing storage directly.
- Verify paired production entrypoints without diagnostic wrappers.
- No human visual check was performed; current evidence is PTY byte capture plus native lifecycle logging.

## Artifacts / privacy

Scripts: `.host-test/run-isolated.py`, `request.mjs`, `import-fixture.mjs`, `pty-check.py`. Evidence: `tui-evidence.jsonl`, `pty-output.bin`, `pty-output.txt`, `import-result.json`, server log and isolated DB. The raw server log contains a short-lived local server credential; **do not publish or commit `.host-test/`**. This report contains no credentials. The server is stopped.
