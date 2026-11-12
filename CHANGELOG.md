# Changelog

All notable changes to LocalAgents Studio are listed here. Older releases are summarized in [`AGENTS.md`](AGENTS.md) §6 and the [wiki](https://github.com/HipHopGrinch/LocalAgents-Studio/wiki/Whats-new).

## Unreleased

### Fixed

- **Review fixes, plan option picks, "Retry differently" and the paid-API solution kept running after Stop, or ran inside a new message.** Each of these runs a Planner or Coder turn and then a review, but each turn started its own run. A Send made between the turns cleared Stop, and the next turn then ran as part of that new message. When they ran inside another run, they could also cancel a Stop pressed just before. They now hold one run from start to finish, so Stop ends them and a new Send never picks them up.

## 1.3.1 — 2026-11-11

Bug-fix release: Studio no longer shows work as still running after it has finished, failed, or been stopped. See [PR #5](https://github.com/HipHopGrinch/LocalAgents-Studio/pull/5).

### Fixed

- **Node Work card stuck on "running · working" after a turn finished.** A turn's card was filed under `workspace` when it started and under the file it wrote when it finished, so a second card appeared and the first never ended. The turn now updates its own card and always ends it as done, failed, or stopped. This was the visible symptom after a Frontier model finished a task.
- **Retries and reroutes ran in the background.** When a request failed and Studio retried it or moved it to another computer, the turn was treated as over while the retry was still generating. Stop turned back into Send, the run lock was released early, and the card was marked failed. The retry is now awaited.
- **"Retrying …" and "Rerouting to …" stayed on screen.** The first message now says what happened (for example "Main Rig failed (…) — rerouted to Laptop.").
- **Swarm after Stop.** The message no longer stays on "Pass 1 — Lead Architect … is locking the shared TypeScript contract…", and file cards that had not started are marked Stopped instead of "waiting…".
- **Swarm files that were skipped or failed.** A file skipped because its computer went offline, or one that failed after a retry, no longer leaves its Node Work card waiting or running through the rest of the run.
- **Stop and chat switches clean up.** Any Node Work card still pending or running is marked Stopped, and the activity indicator clears. A run that ends with cards still open marks them "Stopped before finishing".
- **A late finish from a stopped run no longer clears the next one.** Work that was still finishing (a command, a typecheck) after Stop could clear the Stop button and activity of a run you had just started.
- **Spinner and disabled Play after a run ended.** A leftover plan notice kept the activity indicator moving and the plan's Play button disabled until the notice was dismissed. The notice now only counts as busy while a run is active.
- **Planner escalation after Stop or a chat switch** left "Escalating step #N" on screen, and could change the plan in the chat you switched to.
- **Tool follow-up message after Stop** kept its placeholder ("Analyzed project files. Now generating implementation...") and now says "Stopped."
- **Review-fix task stuck on IN PROGRESS after Stop.** It goes back to pending and stays selected, so Resume picks it up.
- **Chats reopened after a stop or after restarting Studio** showed Swarm steps still running and review tasks in progress. They now read Stopped and pending. Step and review-task status changes are also saved now; before, they were dropped when nothing else in the message changed.
- **Terminal pane stuck on "Running"** when a command failed to start.

## 1.3.0 — 2026-11-11

This release implements the November 2026 codebase audit: 84 findings across UI/UX (UX-*), Conductor flow (FLOW-*), model management (MODEL-*), context use (CTX-*), and platform/security (PLAT-*). Two independent review passes then found 28 more issues, and those are fixed too. See [PR #2](https://github.com/HipHopGrinch/LocalAgents-Studio/pull/2).

### Upgrade notes

- **Fresh installs start with automation off.** Swarm, Auto-Node, Auto-apply, Auto-review, and Cloud Strategist now default to off. Saved settings are kept exactly as they were.
- **Electron 34.5.8 → 45.3.0**, and electron-builder 25 → 26.18.0. The bump resolves later high-severity advisories, including a context-isolation bypass and an ASAR integrity bypass.
- **API keys are encrypted at rest** with the OS keychain (`safeStorage`) when it is available. Plaintext and older encrypted keys migrate automatically. If encryption is unavailable, the key stays plaintext.
- **Web console defaults to localhost only.** LAN access requires a TLS certificate and key. Logged-in browsers can no longer change web-console settings, read or kill the terminal, pull or delete models, or delete nodes unless **Allow shell** is turned on from the desktop.
- **In-app git commits do not run repository hooks.** This blocks code planted in a cloned repo. Commit from a terminal if you need hooks.
- **Unsigned updates wait for “Restart to install”** instead of installing as soon as the app is idle. Builds are still unsigned (code signing is pending, PLAT-10).
- **Truncated file writes are rejected** instead of being saved partially.
- **Verify never uses `npx` and never runs `npm install` on its own.** It uses the project’s `node_modules/.bin/tsc` when present, otherwise Studio’s bundled compiler.
- From source: if `npm run dev` reports Electron is not installed, run `node node_modules/electron/install.js` once.

### Security and platform

- **Web console (PLAT-1)**
  - Binds `127.0.0.1` by default. LAN mode needs real TLS material and stays on localhost with an error if the certificate isn’t loaded.
  - WebSocket auth uses a first-message token (`{type:'auth'}` → `{type:'hello'}`) with an Origin check.
  - Adds CSP and X-Frame-Options headers, async `scrypt` login, rate limiting, and an 8-character password minimum.
  - RPC is limited to an allowlist. `webConsole:update`, `webConsole:setPassword`, and `update:*` are desktop-only.
  - With **Allow shell** off, terminal read/kill, `read_terminal`, `ollama:pull`/`delete`, and `web:search` are denied. Web `ollama:*` and search URLs must match configured nodes or the stored search base.
  - Web `settings:save` merges nodes by id, never deletes omitted nodes, and keeps stored URLs, keys, web-console settings, and the MCP server list.
- **API keys (PLAT-2, PLAT-3)**
  - Stored keys are released only when the request URL matches the node.
  - Keys are sealed with async `safeStorage`, re-encrypted when Electron asks for it, and never sent to the renderer or web console.
  - Reloading the window no longer drops keys from settings.
- **Workspace jail (PLAT-4, PLAT-7, PLAT-14)**
  - Paths are resolved with `realpath`. Junctions, UNC paths, `\\?\` and `\\.\` device paths, and alternate data streams are rejected.
  - The parent folder is checked again immediately before each read or write, and symlink or junction leaves are refused.
  - Renderer `clampWritePath` (`src/lib/writePath.ts`) rejects `..`, device names, and escapes instead of silently rewriting them.
  - Deleting the workspace root is refused.
- **Agent commands (PLAT-5)**
  - A denylist in the main process catches encoded-command prefixes (`-e`, `-en`, `-enc`…), backtick and `^` obfuscation, `Start-Process`, and junction or link creation.
  - Agent commands run with their working directory jailed to the workspace and with idle and absolute timeouts.
  - The denylist is a backstop, not a sandbox.
- **In-app git (PLAT-8)**
  - New `git:run` IPC with a subcommand allowlist (`status`, `diff`, `rev-parse`, `branch`, `add`, `commit`, `log`), `shell: false`, a 20 s timeout, and a 1 MB output cap. Push is not allowed.
  - Repo `core.fsmonitor`, `diff.external`, hooks, pager, editor, and credential/ssh helpers are overridden, and `GIT_*` environment variables are scrubbed.
  - Blocks `--output`, `--no-index`, `--upload-pack`, `--ext-diff`, `--git-dir`, `--work-tree`, and pathspecs outside the workspace (`electron/gitGuard.cjs`).
  - The Git panel no longer echoes `git status` into your terminal.
- **IPC and content security (PLAT-11)**
  - Every IPC call must come from the app’s own frame.
  - `will-navigate` and `will-redirect` guards are in place.
  - The production CSP is injected into the built `index.html` without `unsafe-eval`. The dev server keeps its own policy.
- **Electron 45 (PLAT-6)**
  - Fuses: ASAR integrity validation, OnlyLoadAppFromAsar, and cookie encryption on; `NODE_OPTIONS` and inspect arguments off.
  - `RunAsNode` stays on because the bundled `tsc` needs it.
  - Uses the new `console-message` event shape and the async `safeStorage` API.
  - File dialogs remember the last folder.
- **Settings durability (PLAT-9):** a corrupt `settings.json` aborts the save. Writes use a lock, a unique temp file, and a `.bak` copy.
- **Process lifecycle (PLAT-12, PLAT-13)**
  - Child processes are tracked, and quitting waits (up to about 2 s) for `taskkill`.
  - Chat and image streams abort and cancel their readers on every failure.
  - Error bodies are capped at 1 MB.
- **Updates (PLAT-10):** the banner says the build is unsigned, and installing needs an explicit desktop confirmation. `publish-github-release.ps1` creates a draft on `v<version>`.
- **Other:** MCP supports both Content-Length and NDJSON framing. Frontier `max_tokens` is clamped to 8192. Node export uses async `scrypt` (PLAT-15).

### Conductor flow

- **Run control (FLOW-1, 2, 3, 13, 14)**
  - Each chat has one `ConductorSession` with run tokens and a lock. Send, Play, and Heal can’t overlap.
  - Stop and chat switches abort every stream. Late or stale results skip tool apply, plan commits, and message updates.
  - A stopped run can’t unlock or join the next one. Run control lives in `src/hooks/useConductorSession.ts` and `src/lib/conductor.ts`.
- **Verdict gate (FLOW-7):** a missing Pass/Fail pauses the plan and asks for an explicit verdict instead of counting as a pass. A Yay is refused while every write is still failed or pending.
- **Heal (FLOW-4, FLOW-9)**
  - A green typecheck no longer overrides a reviewer Nay.
  - An unchanged error fingerprint stops the heal, and each plan gets at most one frontier brief.
  - An exhausted step stays exhausted until you press Retry.
- **Step selection (FLOW-5, FLOW-6):** failed or abandoned steps aren’t picked again automatically. Final review and the Electron dist step run only when the plan is actually ready.
- **Verify (FLOW-8):** one verify command, no hidden extra typecheck, no `npx`, no automatic `npm install`. A missing workspace or command counts as a failure.
- **Writes (FLOW-10):** a cut-off write is saved only when the continuation emits the closing tag.
- **Swarm (FLOW-11)**
  - Workers start only after the contract locks on a passing typecheck.
  - A failed contract repair stops in Pass 1 with the error shown.
  - Diagnostics are attached to the files that own them, and a second repair runs only when the errors actually changed.
- **Work log and edit guard (FLOW-12, FLOW-16):** saved-file notes include before and after fingerprints. Each run gets a fresh edit-repeat guard.
- **Plan durability (FLOW-15)**
  - Plan writes are awaited.
  - A `final-review` resume phase survives restarts.
  - The Planner panel has Skip, Edit task, Retry, and Undo (restores the snapshot taken before the coder ran).

### Models and context

- **Pinned context (MODEL-1, MODEL-13):** every chat request sends one fixed `num_ctx` per model (`pinnedNumCtx`), so Ollama stops reloading weights. Retries reuse the same window and send a smaller prompt.
- **Keep-alive and warm-up (MODEL-2, MODEL-12):** requests send `keep_alive`. Models are warmed before Pass 1, each Swarm wave, and repair. The coder model is warmed again after image generation.
- **Benchmark (MODEL-3):** runs at each model’s pinned context, after an unscored warm-up, with `think: false`. Cloud benchmarks also record time to first token.
- **Timeouts (MODEL-4):** streams time out after 120 s idle or 15 min total, with distinct error codes. A retriable stream error is retried once on the same node.
- **Output budgets (MODEL-5, MODEL-11):** `num_predict` comes from per-role budgets. Reviewer, Pass-1, and audit calls use `top_p 0.9`. Frontier calls send `max_tokens` and `include_usage`.
- **Fit-aware routing (MODEL-6, MODEL-14)**
  - Models that fit fully in VRAM are preferred.
  - Failover never uses a disabled or offline model or a node that doesn’t allow the role, and never a spilling model when a fitting one exists.
  - Quick tasks stay on the pinned model.
- **Recommender and catalog (MODEL-8):** closest-tag matching, KV-cache sizing, partial and CPU fit penalties, and quant suggestions. Model Hub offers **Pull {tag}** when the default would spill.
- **Polling (MODEL-9):** `/api/tags` is cached about 3 min, frontier `/models` about 5 min, and `/api/ps` about 5 s. Manual refresh bypasses the cache. Polling slows while an agent is busy.
- **Stable prompt prefix (MODEL-10, CTX-8):** the system prompt stays identical between turns so Ollama can reuse its KV cache. Date, inventory, work log, overview, and plan move to the user message.
- **Thinking (MODEL-15):** per-persona thinking levels. Side calls (warm, bench, image, assist) send `think: false`.
- **Prompt order (CTX-1, CTX-7):** the user task goes last. Plan steps, tasks, contracts, and Nay notes are protected when a prompt is shrunk. Compaction keeps the plan summary, contract path, and work log.
- **Lighter Swarm prompts (CTX-2, CTX-3, CTX-4, CTX-13)**
  - Plan steps that name their files skip Pass 1.
  - Workers get a short system stub, sibling export signatures instead of the work log, and tier-sized repair prompts.
  - Cloud Strategist gets a short prompt. Local Pass 1 uses JSON format and an output cap.
- **Token calibration (CTX-5):** chars-per-token is learned from real `prompt_eval_count` values and saved across restarts.
- **Repo map (CTX-9):** Pass-1 snippets come from the files most relevant to the task. Successful writes refresh the map.
- **Active file and images (CTX-10, CTX-12):** the open file is trimmed by tier around the cursor line. Images are sized by tier and dropped before text when the prompt is over budget.
- **Small models (CTX-11, CTX-14):** small planner, reviewer, and coder models get a compact tool protocol. Fresh step turns drop the repo map and generic directives.
- **Tool results and continuation review (CTX-15, CTX-16):** tool results are capped by tier. Continuation review preloads the touched files instead of spending a round on read tools.

### UI / UX

- **Layout (UX-1):** the message column stays at least 320 px wide. Node Work collapses to a slim rail when idle, and you can collapse it yourself (the choice is remembered). Agent pane default and minimum width is 880 px.
- **Streaming performance (UX-2):** message bubbles are memoized, so only the streaming message re-renders. Auto-scroll follows only when you’re near the bottom, with a **Jump to latest** button otherwise. Long chats show **Show earlier**.
- **First run (UX-3):** an empty chat shows a checklist: open a folder, connect a computer, pick a model, try a sample prompt. The editor’s empty state offers **Open folder**.
- **Plain labels (UX-4):** automation switches (Split across GPUs, Cloud, Choose a computer for me, Save files automatically, Continue after review) sit in a collapsible **Automation** section with help tips. Verdicts read Pass/Fail.
- **Errors (UX-5):** run, Swarm, routing, cloud-assist, benchmark, and model-delete failures show inline error cards with Retry and Open Hardware instead of `alert()`.
- **Hardware & Models (UX-6, UX-7):** the modal is split into tabs: Endpoints, Models, and Integrations under nodes, plus Model Hub, Appearance, Token Stats, Web Console, and Support. Header chips open the matching tab. Dialogs share one focus-trap and Escape helper.
- **Context meter (UX-8):** a meter by the composer shows last prompt tokens against the pinned context, colored past 70% and 85%.
- **Smart Auto-Configure (UX-9):** shows a preview and waits for confirmation, with Undo, in both the Hardware modal and the chat quick button.
- **Git, explorer, editor, terminal (UX-10 to UX-13)**
  - The Git panel shows branch, changed-file count, and diff.
  - The file tree has full keyboard navigation and tree roles.
  - The editor adds Ctrl+W and a confirm before closing a tab with unsaved changes, and Monaco loads lazily.
  - The terminal is resizable, keeps 2000 chunks, and only sticks to the bottom when you’re already there.
- **Accessibility (UX-14, UX-15)**
  - Icon-only controls have labels.
  - Ctrl+K opens a command palette.
  - Splitters are keyboard-resizable separators.
  - Ctrl+L starts a new chat and focuses the message box.
  - Zoom shortcuts don’t fire inside inputs, Monaco, or the terminal.
- **Web console password (UX-16):** at least 8 characters.
- **Status line (UX-17):** says who is working, for example `Coder on 1080 Ti · model · writing src/App.tsx`.

### Engineering

- **CI** (`.github/workflows/ci.yml`, Windows): `npm ci`, typecheck, Electron syntax check, selftests, lint, production dependency audit, Electron advisory check (non-blocking), and a Vite build.
- **Branch exe builds** (`.github/workflows/build-exe.yml`): every branch push builds the unsigned setup and portable exe and attaches them to the run as a 14-day artifact. Nothing is published.
- **Release workflow** (`.github/workflows/release.yml`): pushing `v<version>` builds installers into a **draft** release (`--publish never` during the build).
- **Scripts:** `npm run typecheck`, `typecheck:strict` (opt-in `noUncheckedIndexedAccess`), `check:electron`, `test` (auto-discovers 31 selftests), `lint` (ESLint + typescript-eslint + react-hooks), and `release` (version bump, checks, unsigned installers into `release-<version>\`).
- **Bundle:** Vite manual chunks cut the entry bundle from 4.1 MB to about 590 kB. Packaging trims TypeScript down to the files `tsc` needs.
- **Dev:** `npm run dev` now really loads the Vite dev server. Before, `VITE_DEV_SERVER` never reached Electron, so it always loaded `dist/`.
- **Docs:** `CONTRIBUTING.md`, a PR template, a bug template, and updated `AGENTS.md`.

### Known limitations

- Builds are unsigned (PLAT-10). SmartScreen warns on first run.
- The agent command denylist is a backstop, not a sandbox. Commands can still read files outside the workspace.
- Workspace re-checks before each write are best-effort. Node on Windows has no non-following open.
- Project search still runs on the main thread.
- `noUncheckedIndexedAccess` stays opt-in (336 errors).
- A multi-file step on a single model still uses the full system prompt.
