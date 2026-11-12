# Contributing to LocalAgents Studio

LocalAgents Studio is a Windows Electron + React + TypeScript desktop IDE for a distributed local Ollama cluster.

Architecture, product rules, and how we ship live in [AGENTS.md](AGENTS.md). Release notes are on the [wiki](https://github.com/HipHopGrinch/LocalAgents-Studio/wiki).

Questions: HipHopGrinch@gmail.com

## Setup

```powershell
git clone https://github.com/HipHopGrinch/LocalAgents-Studio.git
cd LocalAgents-Studio
npm install
npm run dev
```

Ollama is installed separately on each GPU machine. Day-one checks are in AGENTS.md §2.

## Branches and pull requests

1. Branch from the default branch. Keep the change focused.
2. Before opening a pull request, run:

```powershell
npm run typecheck
npm test
npm run lint
```

3. Open a pull request. CI (`.github/workflows/ci.yml`) runs those commands on `windows-latest`, plus `npm run check:electron`, `npm audit --omit=dev --audit-level=high`, and `npx vite build`.

## Do not commit

From AGENTS.md §8:

- `release/`, `release-*/`, `*.zip`
- AppData settings (`%APPDATA%\LocalAgents Studio\settings.json`) or API keys
- Garbled path artifacts (see `.gitignore`)

Also leave `node_modules/` untracked.

## Where to read the design

Start with [AGENTS.md](AGENTS.md): cluster topology, process layering, and behaviors that must not regress. The longer narrative is [HISTORY.md](HISTORY.md). The wiki is https://github.com/HipHopGrinch/LocalAgents-Studio/wiki.
