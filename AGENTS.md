# LocalAgents Studio — Collaborator Briefing (Cursor)

> **Import this into Cursor:** clone the repo, open the folder as the workspace, and keep this file + `.cursor/rules/cluster-architecture.mdc` in context. Cursor already picks up `AGENTS.md` and always-applied rules.
>
> **Repo:** https://github.com/HipHopGrinch/LocalAgents-Studio  
> **Wiki / What’s new:** https://github.com/HipHopGrinch/LocalAgents-Studio/wiki  
> **Latest release (as of this briefing):** **1.2.26**  
> **Discord:** https://discord.gg/ZVkmUfXwW

This document is the fast path from zero → productive. It covers *why the product exists*, *what was built in order*, *where the code lives*, *how the reference cluster is supposed to behave*, and *how we ship*.

---

## 1. What this product is

**LocalAgents Studio** is a Windows Electron + React 19 + TypeScript + Vite desktop IDE that orchestrates a **distributed local Ollama multi-GPU cluster**, with an optional **Cloud Frontier** API (Gemini / Grok / OpenAI / OpenRouter).

**Goal:** replace day-to-day reliance on Cursor / Claude Code / Antigravity for *local* coding agents — keep work on your GPUs, parallelize multi-file jobs across machines, and only spend frontier tokens when you choose to (Planner / Strategist / hard heals).

It is **not** a thin chat wrapper. It is an IDE with:

- Monaco editor + file tree + PowerShell terminal
- Agent Conductor (Planner / Coder / Reviewer personas + Swarm)
- Durable plans, verify gates, heal loops, project brain
- Hardware-aware routing (VRAM, bandwidth, benchmarks, specialties)
- Optional LAN **Web Console** (authenticated mirror of the desktop session)

Settings (including API keys) live in plaintext at:

`%APPDATA%\LocalAgents Studio\settings.json`

Never commit that file. Keys must not appear in logs (see `redactLog` in `electron/main.cjs`).

---

## 2. Clone, run, verify (day-one)

```powershell
git clone https://github.com/HipHopGrinch/LocalAgents-Studio.git
cd LocalAgents-Studio
npm install
npx tsc --noEmit
npm run dev          # Vite + Electron
# or packaged:
npm run dist         # builds into release\ (or use a release-NNN output dir if release\ is locked)
```

Useful selftests:

```powershell
node scripts/mcp-selftest.cjs
npx tsx src/lib/cursorClass.selftest.ts
npx tsx src/lib/buildGate.selftest.ts
```

**Ollama** must be installed separately on each GPU machine. On LAN nodes set `OLLAMA_HOST=0.0.0.0` and open TCP 11434.

Install builds from [Releases](https://github.com/HipHopGrinch/LocalAgents-Studio/releases): prefer `*-setup.exe` for in-app updates (`latest.yml` + electron-updater). Portable EXE is manual replace only.

---

## 3. Reference cluster topology (design target)

This is the hardware story the auto-configurator and routing were tuned for. Your friend’s cluster can differ; the *profiles* still apply.

| Machine | GPU | Overhead profile | Usable VRAM | Specialty | Typical `num_ctx` |
|--------|-----|------------------|------------|-----------|-------------------|
| Main Windows desktop | RTX 5070 Ti 16 GB (Blackwell) | `windows_desktop` (1.0 GB reserve) | ~15.0 GB | `architect` (planner, coder, reviewer) | 16K–32K |
| Headless Linux | GTX 1080 Ti 11 GB (Pascal) | `headless_linux` (0.2 GB) | ~10.8 GB | `module_coder` (coder, reviewer) | 8K–12K |
| Laptop (display on iGPU) | RTX 3060 6 GB (Ampere) | `igpu_display` (0.1 GB) | ~5.9 GB | `scout` (coder, docs, reviewer) | 8K |
| Cloud Frontier | OpenAI-compatible | n/a | n/a | `strategist` (planner, reviewer) | large (e.g. Gemini Studio default 256k) |

**Invariant:** pin **one primary generative model per GPU** (`activeModel`) and disable the rest so Ollama does not thrash weights mid-run.

Details live in `.cursor/rules/cluster-architecture.mdc` (always applied in this workspace).

---

## 4. Architecture (how the app is layered)

```
Renderer (React)                    Main (electron/main.cjs)
─────────────────                   ─────────────────────────
App.tsx  state, live session  ←IPC→  fs:*, tools:exec, terminal
AgentChat.tsx  Conductor/Swarm       ollama:chat / status / benchmark
HardwareSettingsModal                webConsole.cjs (LAN WS+HTTP)
agentLoop / tools / swarmContract    mcpClient.cjs (stdio MCP)
clusterAdvisor                       PowerShell runner (user vs agent procs)
```

### Privileged boundary
- **All** network I/O to Ollama/Frontier, filesystem, and PowerShell run in the **main process**.
- Renderer talks through `preload.cjs` → `window.electronAPI` (also bridged to the Web Console over authenticated WebSocket RPC).
- Agent file tools go through `tools:exec` + `resolveScoped(root, path)` so paths cannot escape the open workspace.
- Raw `fs:*` handlers are also workspace-gated (fixed in 1.2.24).

### Conductor mental model
1. **Planner** locks a durable plan (`.localagents/plans/…`).
2. **Coder** workers implement steps with `<edit_file>` / `<write_file>` / `<run_command>`.
3. **Reviewer** Yay/Nay via verify gate (`tsc` / project verify / web entry gate).
4. Failures **heal** (compiler feedback) instead of inventing duplicate Fix steps.
5. **Swarm** (optional): Pass-1 Lead Architect writes a shared **contract** + task list; Pass-2 fans files out across GPUs; then workspace repair.

### Live session / Web Console
- Desktop owns cluster status and token totals.
- Web clients mirror UI; they must not wipe API keys or zero out tokens.
- API keys are stripped for web `settings:load` / live session; main process rehydrates keys from disk for chat/status/bench when `e.webConsole` is set.

---

## 5. Progress timeline — how we got here

### Phase 1 — Foundations
Multi-node defaults, live status polling (online / latency / tags / loaded), Monaco + file tree, settings persistence under AppData.

### Phase 2 — Hardware & benchmarking
Hardware Settings modal, VRAM fit estimator, catalog pulls, live tok/s benchmarks (`ollama:benchmark`). Seeded speeds are `provisional: true` until measured.

### Phase 3 — Autonomous tools
Tool protocol in `tools.ts` + `agentLoop.ts`: write/edit/read/list/search/run_command, immutable tool cards, bounded continuations, SEARCH/REPLACE hunks.

### Phase 4 — Contract-first Swarm
Lead Architect JSON manifest → contract file → isolated `tsc` → GPU workers with contract injected → post-fanout repair. Local-first; frontier as backup.

### Phase 5 — Pillar A (1.2.25): Smart Cluster + Cloud Strategist
- `clusterAdvisor.ts`: physics scorer, overhead profiles, `num_ctx` caps, 1-model-per-GPU pin, Cloud Strategist JSON audit.
- Swarm Pass-1 can prefer Cloud Strategist (`cloudStrategistEnabled`).
- Wave-aware load balancing across GPUs (`targetNodeId`, specialties).

### Cursor-class agent stack (1.2.x mid-line)
Built to close the gap with Cursor-like workflows **on local hardware**:

| Capability | Where |
|------------|--------|
| Durable Planner plans + Pause/Play resume | `plannerPlan.ts`, AgentChat |
| Verify-gated Yay / Nay | `verifyGate.ts`, project verify |
| Heal + continue-past-failed-step | `stuckEscalation.ts`, plannerPlan |
| Model Fit (prompt sized to GPU context) | `contextSize.ts`, inventory prompts |
| Repo map + symbol-led search | `repoMap.ts` |
| Hunk accept/reject, inline edit | ToolActionCard, AgentChat |
| Git panel (status/stage/commit; no force-push) | `GitPanel.tsx` |
| Project rules (`AGENTS.md`, `.localagents/rules`) | projectBrain / AgentChat |
| Local MCP stdio | `mcpClient.cjs`, Hardware Settings JSON |
| Largest-model Planner/Reviewer routing | tools / AgentChat resolveRoute |
| Context monitor (~85% fill → shrink/resubmit) | `contextMonitor.ts` (1.2.23) |
| Blank-page / unwired Tailwind web gate | `webEntryGate.ts` (1.2.23) |
| Final source review after checklist | continuationReview / frontier heal |

### Security & reliability hardening (1.2.24)
From an external pitfalls review (16 items), landed:

- Workspace sandbox for `fs:*` + `edit_file`; reject out-of-workspace absolute writes (no basename clobber)
- Web console: strip API keys, login rate-limit, 8-char password min, safe `serveStatic` root check
- PowerShell-safe git commit quoting; stronger destructive-command filter
- Unique `.tmp` + serialized atomic writes
- GitPanel uses command stdout; Terminal Stop does not kill agent procs
- MCP: Content-Length *and* NDJSON
- Plus medium fixes: frontier bench headers, contract lock after typecheck, live-session poll only on web, redactLog expansions, AMD/Intel detect, gitignore `release-*` / zips

### Patch (1.2.26)
Local Ollama **Bench** broke after 1.2.24 dropped the `url` binding used by `/api/generate` and `/api/embed`. Restored in 1.2.26.

---

## 6. Release ladder (recent) — skim this first

Full notes: [Wiki → What’s new](https://github.com/HipHopGrinch/LocalAgents-Studio/wiki/Whats-new).

| Ver | Theme |
|-----|--------|
| **1.2.26** | Fix local benchmark `url is not defined` |
| **1.2.25** | Smart Cluster Auto-Configure + Cloud Strategist Pass-1 + wave load-balance |
| **1.2.24** | Sandbox, web console secrets, MCP framing, terminal isolation, atomic writes |
| **1.2.23** | Context monitor; blank-page / Tailwind web entry gate |
| **1.2.22** | Live disable/enable; largest model for heavy work (not speed-first) |
| **1.2.21** | Web console header + token totals + Node Work mirror; Electron dist after Yay |
| **1.2.20** | Planner/Reviewer → largest local model; first-run Swarm/Auto toggles on |
| **1.2.19** | Finish plans after heal budget; repo map; hunks; git; rules; MCP |
| **1.2.18** | Heal instead of duplicate Fix stop |
| **1.2.17** | Frontier / Gemini Studio context default 256k |
| **1.2.16–1.2.12** | Model Fit, self-heal, escalation caps, project brain, delivery chooser |
| **1.2.0–1.2.11** | Web console live sync maturation, Planner-owned flow, Node Work, contract tsc |

Older architectural narrative: [`HISTORY.md`](HISTORY.md).

---

## 7. Key source map (edit here, not everywhere)

| Path | Role |
|------|------|
| `electron/main.cjs` | IPC, fs sandbox, terminal (user vs agent), Ollama/Frontier, benchmark, updater |
| `electron/webConsole.cjs` | LAN HTTP+WS console |
| `electron/mcpClient.cjs` | MCP stdio (CL + NDJSON) |
| `electron/preload.cjs` | contextBridge API |
| `src/App.tsx` | Top state, live session, scoped writes (`clampWritePath`) |
| `src/components/AgentChat.tsx` | Conductor monolith (Swarm, plans, routing UI) — large; change carefully |
| `src/components/HardwareSettingsModal.tsx` | Nodes, hub, auto-configure banner |
| `src/lib/clusterAdvisor.ts` | Physics plan + cloud audit merge |
| `src/lib/swarmContract.ts` | Manifest, Lead Architect, assignment |
| `src/lib/tools.ts` | Parsers, prompts, `selectBestEndpointForTask`, job assign |
| `src/lib/agentLoop.ts` | Tool execution, destructive filter |
| `src/lib/plannerPlan.ts` / `verifyGate.ts` / `contextMonitor.ts` / `webEntryGate.ts` | Plan durability, verify, context, blank-page |
| `src/types.ts` | `NodeSpecialty`, `vramOverheadMode`, settings flags |
| `src/config/defaults.ts` | Default nodes/settings (`cloudStrategistEnabled` default on) |

Project artifacts inside an open workspace:

- `.localagents/chats.json`, `plans/`, `progress/`, `rules/`, project brain JSON

---

## 8. Product behaviors collaborators must not regress

1. **Workspace boundary** — agent and `fs:*` paths stay inside the open folder.
2. **One primary model per GPU** after Smart Auto-Configure — no multi-model thrash.
3. **Largest capable local model** for Planner / Reviewer / heavy coder (speed only breaks ties).
4. **Disabled / offline models** are never routed; re-enable is live (1.2.22).
5. **Web console** never receives raw API keys; never zeros desktop token counters.
6. **Terminal Stop** kills user procs only; agent `run_command` keeps running.
7. **Contract lock** only after typecheck succeeds (or stack has no checker).
8. **Bench** must work for local Ollama (`url` bound) and frontier (`normalizeFrontierEndpoint` + Gemini header).
9. **Do not commit** `release/`, `release-*/`, `*.zip`, AppData settings, or garbled path artifacts.

---

## 9. How we ship a release (Windows)

1. Bump `package.json` + first version fields in `package-lock.json`.
2. `npx tsc --noEmit` + relevant selftests.
3. Build to a fresh folder if `release\win-unpacked` is locked:
   ```powershell
   $env:CSC_IDENTITY_AUTO_DISCOVERY='false'
   npx vite build
   npx electron-builder --win --config.directories.output=release-NNN
   ```
4. Commit with message like `Release 1.2.xx: <why>.`
5. Push + `gh release create` with setup + portable + blockmap + `latest.yml`.
   - `gh auth` token is often stale; use **Git Credential Manager** password as `GH_TOKEN` and push via `https://x-access-token:…@github.com/…` (never print the token; clear env after).
6. Update wiki `Whats-new.md` in the separate `LocalAgents-Studio.wiki` repo.

---

## 10. Suggested first tasks for a new collaborator

1. Run `npm run dev`, open Hardware Settings, ping nodes, run one **Bench** on a local model.
2. Click **Smart Cluster Auto-Configure**; confirm specialties + one primary model per node.
3. Toggle **Cloud Strategist** in Conductor; run a small Swarm “create two files” task; watch Pass-1 vs Pass-2 assignment.
4. Read `clusterAdvisor.ts` + `assignSwarmTasksToCluster` before changing routing.
5. If touching IPC/web console, re-read the 1.2.24 security notes in §5 and §8.

---

## 11. Open / known sharp edges

- `AgentChat.tsx` is a large monolith — prefer extracting helpers over growing it blindly.
- `typescript` is in production `dependencies` so packaged Studio can `tsc` user projects; it inflates installer size.
- Auto-updater may run unsigned personal builds (`verifyUpdateCodeSignature = false`) — treat release assets as trust boundary.
- Hardware detect prefers `nvidia-smi`, then WMI fallback (AMD/Intel); bandwidth guess still needs good GPU name matching.
- MCP servers are **one-shot spawn per call** (no long-lived session yet).

---

## 12. Quick links

| Resource | URL / path |
|----------|------------|
| GitHub | https://github.com/HipHopGrinch/LocalAgents-Studio |
| Releases | https://github.com/HipHopGrinch/LocalAgents-Studio/releases |
| Wiki | https://github.com/HipHopGrinch/LocalAgents-Studio/wiki |
| What’s new | https://github.com/HipHopGrinch/LocalAgents-Studio/wiki/Whats-new |
| Architecture rule | `.cursor/rules/cluster-architecture.mdc` |
| Longer HISTORY | `HISTORY.md` |
| README | `README.md` |
