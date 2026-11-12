# LocalAgents Studio

[![CI](https://github.com/HipHopGrinch/LocalAgents-Studio/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/HipHopGrinch/LocalAgents-Studio/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/HipHopGrinch/LocalAgents-Studio)](https://github.com/HipHopGrinch/LocalAgents-Studio/releases/latest)

An autonomous, distributed local-agent IDE built for a multi-PC Ollama cluster with optional Frontier Cloud fallback (Gemini, xAI Grok, OpenAI, OpenRouter).

**Download:** [latest release](https://github.com/HipHopGrinch/LocalAgents-Studio/releases/latest). Use `…-setup.exe` for in-app updates, or `…-portable.exe` for no install. Builds are unsigned, so Windows SmartScreen asks once: choose **More info**, then **Run anyway**.

**User guide:** [GitHub wiki](https://github.com/HipHopGrinch/LocalAgents-Studio/wiki) covers install, Ollama, nodes, models, projects, the agent, durable plans / heal / Model Fit, Swarm, and logs. **What's new:** [1.3 notes](https://github.com/HipHopGrinch/LocalAgents-Studio/wiki/Whats-new) · full [`CHANGELOG.md`](CHANGELOG.md).

**Discord:** https://discord.gg/ZVkmUfXwW

---

<img width="1116" height="686" alt="Screenshot 2026-10-29 182925" src="https://github.com/user-attachments/assets/d2920865-2620-4556-8a7a-79b54ec13149" />


## Example Cluster Templates

A fresh install starts with no nodes. Add your machines in **Hardware & Models → Endpoints**, then run **Smart Auto-Configure** to pin one model per GPU. Typical layouts:

| Node |  Example hardware | Best Fit Role |
| :--- | :--- | :--- |
| **High-End Gaming PC** | 16–24GB VRAM (e.g. RTX 5070 Ti / 4090) · 64GB RAM | Lead Architect, Planner & Coder |
| **Mid-Range PC / headless Linux** | 8–12GB VRAM (e.g. RTX 3060 12GB / GTX 1080 Ti) · 32GB RAM | Module coder & reviewer |
| **Budget Laptop** | ~6GB VRAM (e.g. RTX 3060 Laptop) · 16GB RAM | Fast scout: coder, docs, reviewer |
| **Frontier API** | Cloud frontier model | Cloud Strategist: planning & audits (optional) |

---

## Key Features

### Smart Cluster Auto-Configure
- Scores each GPU's VRAM, bandwidth, and OS overhead, then pins **one primary model per GPU** so Ollama never swaps weights mid-run.
- Shows a preview of the plan and asks before applying, with **Undo**.
- Each model gets one fixed context size and is kept loaded and warmed before Swarm waves, so requests don't trigger reloads.

### Conductor: Planner, Coder, Reviewer
- **Planner** locks a durable step plan. **Coder** implements each step. **Reviewer** must answer **Pass** or **Fail**, and a Pass only sticks when the project's typecheck or build passes.
- Failures **heal** with real compiler output, within a bounded budget. Each step has **Skip**, **Edit**, **Retry**, and **Undo**.
- **Stop** cancels every stream. One run at a time per chat, and late results are discarded instead of written.

### Conductor Swarm
- A Lead Architect (local, or the optional **Cloud Strategist**) writes a shared contract. Files then fan out across online GPUs, with routing that prefers models that fit fully in VRAM.

### Live Benchmarking
- In **Hardware & Models**, click **Benchmark** next to any installed model.
- Warms the model at its real context size, then measures generation tok/s, prompt tok/s, and load time. Cloud benchmarks also record time to first token.
- Seeded speeds show as **(estimate)** until you benchmark. Live results drive routing.

### Hybrid Local + Frontier API Support
- Route routine coding to local GPUs; optionally send planning, audits, or hard heals to Gemini / Grok / OpenAI / OpenRouter.
- Enter an API key in **Hardware & Models → Endpoints**. Keys are stored in `%APPDATA%\LocalAgents Studio\settings.json` on that PC (never baked into the EXE), encrypted with the Windows keychain when it is available. Don't commit or share that file.

### Hardware Recommender & Model Hub
- Catalog with VRAM fit (full GPU / offload / won't fit), smaller-quant suggestions when a model would spill, and one-click remote **Pull Model**.

### Autonomous Workspace Tools
- `edit_file` SEARCH/REPLACE preview, `write_file` apply, `run_command` with captured PowerShell output.
- All file access is jailed to the open workspace folder. Agent commands run through a blocklist with timeouts.
- Monaco editor, file tree, PowerShell terminal, and a Git panel (status, diff, stage, commit; no push).

### Chat & Window
- Context meter, a status line that names the role, computer, model, and file, and inline error cards with **Retry**.
- **Ctrl+K** command palette, keyboard-resizable panels, and a first-run checklist.
- Automation switches (Swarm, auto node choice, auto-save, auto-review) live in one **Automation** section and start **off** on a fresh install.

### Web Console (optional)
- A password-protected browser mirror of the desktop session. It listens on this PC only by default; LAN access requires a TLS certificate. API keys are never sent to the browser.

### Token Economy Tracker
- Header badge tracks free local tokens vs frontier tokens and estimated API cost avoided.

---

## Running the App

```powershell
cd path\to\LocalAgents-Studio
.\start.bat
# or
npm start
```

Development:

```powershell
npm install
npm run dev        # Vite dev server + Electron with live reload
```

If Electron reports it is not installed, run `node node_modules/electron/install.js` once.

Checks (the same ones CI runs on every push and pull request):

```powershell
npm run typecheck
npm run check:electron
npm test
npm run lint
```

### Windows EXE (self-contained)

```powershell
.\build-exe.bat
# or
npm run dist
```

Artifacts land in `release\`:

- **`LocalAgents-Studio-*-portable.exe`** — single portable EXE (no installer)
- **`LocalAgents-Studio-*-setup.exe`** — NSIS installer with Start Menu / desktop shortcuts

Every branch push also builds both EXEs in GitHub Actions (**Build exe** workflow, under the run's **Artifacts**).

Ollama is still installed separately on each machine; the EXE only packages LocalAgents Studio. Your endpoints and API keys stay in `%APPDATA%\LocalAgents Studio\` and are not part of the build.

**Contributing:** see [`CONTRIBUTING.md`](CONTRIBUTING.md). Changes land through pull requests.

**Collaborators / Cursor onboarding:** start with [`AGENTS.md`](AGENTS.md) (history, cluster topology, release ladder, ship process). Architecture evolution notes: [`HISTORY.md`](HISTORY.md).
