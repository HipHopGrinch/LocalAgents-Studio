# LocalAgents Studio - Project History & Technical Overview

> **Collaborators:** for a Cursor-ready briefing (clone → run → release ladder → “do not regress”), use [`AGENTS.md`](AGENTS.md). This file is the longer architecture / phase narrative.

## 1. Project Background & Motivation
**LocalAgents Studio** was created to bridge a critical capability gap in modern AI coding environments: tools like Google Antigravity and Cursor rely heavily on cloud-hosted frontier LLMs and lack first-class native multi-agent execution targeting locally hosted Ollama/vLLM endpoints across a local hardware cluster.

Designed for mixed local hardware clusters, for example:
- **High-end gaming PC:** 16–24 GB VRAM (RTX 4080 / 4090 class)
- **Mid-range desktop:** 8–12 GB VRAM (RTX 3060 12GB / 4070 class)
- **Budget / thin laptop:** ~6 GB VRAM (RTX 3060 Laptop class)
- **Frontier APIs (optional):** Grok / OpenAI when cloud reasoning is explicitly required.

The core goal of LocalAgents Studio is to eliminate costly API token consumption by maximizing local hardware utilization, parallelizing code generation tasks across multiple physical GPU nodes simultaneously, and providing a standalone desktop IDE (built on Electron, React 19, Vite, TailwindCSS, and Monaco Editor) with direct filesystem execution capabilities.

---

## 2. Architecture & Design Principles

### A. Electron & React Dual-Process Architecture
- **Main Process (`electron/main.cjs`):**
  - Manages native OS operations, Electron BrowserWindow lifecycle, and IPC handlers.
  - Safe filesystem access for the explorer (`readFile`, `writeFile`, `createFile`, `createFolder`, `deleteTarget`, `readDir`).
  - Agent tools are **workspace-scoped** via `tools:exec` (`resolveScoped`) so relative agent paths cannot escape the open folder.
  - PowerShell child-process execution with streaming output to the Terminal panel (`TerminalPanel.tsx` — command runner, not a full PTY/xterm session).
  - Cluster status polling (`clusterStatus`) measuring ping latency, active models, and loaded VRAM models across all configured LAN endpoints.
  - Remote model pull commands (`ollama pull <model>`) via streaming HTTP endpoints on remote nodes.
  - Automated benchmark engine (`ollama:benchmark`) measuring generation speed (`evalTokPerSec`), prompt processing speed (`promptTokPerSec`), and model load times using a short coding generate prompt (`num_predict: 64`).
- **Renderer Process (`src/`):**
  - React 19 + TypeScript + Vite.
  - Monaco Editor integration for syntax-highlighted multi-tab code editing.
  - Resizable split pane layout (File Explorer, Monaco Editor + Terminal, Agent Conductor sidebar).

### B. Settings & secrets
- Settings (including optional Frontier API keys) persist to Electron `userData/settings.json` in **plaintext** on the local machine. Keys are not encrypted and must not be committed or logged.

---

## 3. Major Evolution & Milestones

### Phase 1: Foundations & Cluster Connectivity
- Configured multi-node cluster defaults (local Ollama + LAN peers + optional frontier API) with DNS aliases and live status polling.
- Built cluster polling logic to detect node online status, ping latency, and running models in real time (merges status without wiping user model toggles / benchmarks).
- Integrated multi-tab Monaco editor with dirty-state tracking, language detection, and file tree operations.

### Phase 2: Hardware Configuration & Real-Time Benchmarking
- Added the **Cluster & Hardware Settings** modal (`HardwareSettingsModal.tsx` + `hardware/*` panels):
  - Hardware specification inputs (CPU, GPU, VRAM, RAM, memory bandwidth).
  - VRAM estimation calculator computing parameter size, context window memory (`f16`/`q8`/`q4`), and max KV cache limits.
  - Automated Token/sec benchmark runner; seeded default speeds are marked `provisional: true` until a live benchmark succeeds.
  - Catalog of recommended models based on hardware specs.
  - Filtering out non-generative embedding models from code generation dropdowns and benchmarks.
  - Remote model pull trigger enabling remote endpoints to pull new models from Ollama without needing SSH.

### Phase 3: File System Tooling & Autonomous Execution
- Designed and implemented the **Autonomous Tool Protocol** (`tools.ts` + `agentLoop.ts`):
  - `<write_file path="...">` for direct full-file creation.
  - `<edit_file path="...">` with unified SEARCH/REPLACE diff matching and fuzzy indentation handling.
  - `<read_file>`, `<list_dir>`, `<search>`, and `<run_command>` (PowerShell; stdout returned to the agent).
  - **Tool Result Continuation Loop:** Fresh message history + `stripThinking`, auto-apply for writes *and* edits, bounded re-continues (max 2).
  - **Immutable tool card state** so running/done/error updates reliably in React.
  - **Universal Fallback Parser:** Markdown fences become writes only when create-intent is detected, an explicit path is present, or the Conductor assigned `expectedFilePath`.

### Phase 4: Conductor Swarm — Contract-First Two-Pass
- **Pass 1 (Lead Architect):** High-VRAM `@coder` (or frontier backup) emits a JSON manifest — shared `contractCode` + per-file tasks with locked imports/exports. Thinking blocks stripped before `JSON.parse`.
- **Contract verify:** Electron writes the contract file and runs isolated `tsc --noEmit`; architect self-corrects once on failure before workers wake.
- **Pass 2 (GPU workers):** Tasks assigned by live tok/s × complexity × role bonus (`assignSwarmTasksToCluster`); each worker gets the contract injected read-only.
- **Workspace repair:** After `Promise.allSettled`, project `tsc --noEmit` routes errors back to the owning GPU for a targeted re-prompt.
- Local-first routing; frontier only when no local Ollama workers are online.
- Per-node model toggles, soft `roles`, and resizable sidebars unchanged.

### Phase 5: Pillar A — Smart Cluster Auto-Configurator & Cloud Strategist Multi-GPU Router (Current State)
- **Smart Cluster Auto-Configurator (`src/lib/clusterAdvisor.ts` & `HardwareSettingsModal.tsx`):**
  - Deterministic **Hardware-Physics Scorer** + 1-click **Cloud Strategist Audit** (sends full cluster JSON inventory to the Frontier model and merges recommendations).
  - **OS / Display VRAM Overhead Profiles:** `windows_desktop` (`1.0 GB` reserve), `headless_linux` (`0.2 GB` reserve -> `10.8 GB` usable on an 11 GB GTX 1080 Ti), and `igpu_display` (`0.1 GB` reserve -> `5.9 GB` usable on a 6 GB Laptop RTX 3060).
  - **Zero-Thrashing Model Pinning:** Automatically pins 1 optimal primary generative model (`activeModel`) per local GPU and disables secondary/spilling models (`disabledModels`) so Ollama never unloads/reloads multi-GB weights mid-workflow.
  - **Architecture-Aware Context Caps (`num_ctx`):** Caps Pascal (`GTX 1080 Ti`) at `8K–12K` so FP32 prefill stays snappy, 6 GB Ampere (`RTX 3060`) at `8K` to prevent system RAM spill, and 16 GB Blackwell/Ada (`RTX 5070 Ti`) at `16K–32K`.
  - **Cluster Role Specialties (`NodeSpecialty`):** Assigns `architect`, `heavy_coder`, `module_coder`, `reviewer`, `scout`, and `strategist` badges across nodes and recommends 1-click `ollama pull` tags from `MODEL_CATALOG`.
- **Cloud Strategist Pass-1 Routing & Wave-Balanced Multi-GPU Scheduling (`src/lib/swarmContract.ts`, `src/lib/tools.ts`, `src/components/AgentChat.tsx`):**
  - Optional **Cloud Strategist** toggle (`cloudStrategistEnabled`) in Conductor routes Pass-1 Swarm decomposition (~500 tokens) to an online Cloud Frontier node (or falls back to the local `architect` GPU) with the full `CLUSTER WORKER ROSTER`.
  - Wave-aware GPU load balancing (`waveLoadByGpu` in `assignSwarmTasksToCluster` and `loadByNodeId` in `assignJobsToCluster`) honors `targetNodeId` and spreads concurrent tasks across all online GPUs simultaneously (`high` -> `architect`, `medium` -> `module_coder`, `low` -> `scout`).

---

## 4. Key Source Code Map

| File Path | Description |
|---|---|
| [`electron/main.cjs`](electron/main.cjs) | Electron main process, IPC tools, PowerShell, cluster pinging, and benchmarks. |
| [`electron/preload.cjs`](electron/preload.cjs) | Context-bridge API for the sandboxed renderer. |
| [`src/types.ts`](src/types.ts) | Core TypeScript types for nodes (`NodeSpecialty`, `vramOverheadMode`), benchmarks, tool calls, chat messages, and settings (`cloudStrategistEnabled`). |
| [`src/config/defaults.ts`](src/config/defaults.ts) | Default nodes, roles, personas, and settings. |
| [`src/lib/clusterAdvisor.ts`](src/lib/clusterAdvisor.ts) | Smart Cluster Auto-Configurator (Hardware-Physics scorer, VRAM overhead profiles, `num_ctx` tuner, 1-model-per-GPU pinning, and Cloud Strategist JSON audit). |
| [`src/lib/clusterInventory.ts`](src/lib/clusterInventory.ts) | Formats live cluster roster (including node IDs, specialties, and usable VRAM) for prompts. |
| [`src/lib/tools.ts`](src/lib/tools.ts) | System prompts, parsers, diff patcher, specialty-aware `selectBestEndpointForTask`, and load-balanced `assignJobsToCluster`. |
| [`src/lib/swarmContract.ts`](src/lib/swarmContract.ts) | Contract-first Swarm manifest parse/prompts, Cloud Strategist `findLeadArchitect`, and wave-balanced `assignSwarmTasksToCluster`. |
| [`src/lib/agentLoop.ts`](src/lib/agentLoop.ts) | Immutable tool execution, auto-apply, continuation helpers. |
| [`src/lib/ollamaClient.ts`](src/lib/ollamaClient.ts) | Streaming chat client (Ollama + OpenAI-compatible Frontier). |
| [`src/components/AgentChat.tsx`](src/components/AgentChat.tsx) | Agent Conductor chat, pipeline dispatch, tool review cards. |
| [`src/components/agent/ToolActionCard.tsx`](src/components/agent/ToolActionCard.tsx) | Per-tool apply / preview UI. |
| [`src/components/HardwareSettingsModal.tsx`](src/components/HardwareSettingsModal.tsx) | Node settings shell; delegates hub/installed-model panels. |
| [`src/components/hardware/`](src/components/hardware/) | Model hub + installed models / benchmark / pull UI. |
| [`src/components/FileTree.tsx`](src/components/FileTree.tsx) | Workspace file tree explorer with drag-resizable width support. |
| [`src/components/EditorView.tsx`](src/components/EditorView.tsx) | Multi-tab Monaco editor with dirty indicator and file save triggers. |
| [`src/components/TerminalPanel.tsx`](src/components/TerminalPanel.tsx) | Embedded PowerShell command runner with streaming output. |
| [`src/App.tsx`](src/App.tsx) | Top-level state, cluster poll merge, scoped agent writes, layout. |

---

## 5. Development & Run Commands

```powershell
# Install dependencies
npm install

# Type-check TypeScript
npx tsc --noEmit

# Production build
npm run build

# Run Electron desktop app in development
npm run dev
```
