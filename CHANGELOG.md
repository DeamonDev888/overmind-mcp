# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- 
  Changesets release notes are generated from `.changeset/*.md` files.
  Run `pnpm run changeset version` to produce the release notes below.
  Run `pnpm run changeset release` to publish to npm.
-->

---

## [2.8.3] - 2026-05-18

### 🐛 Fixes

- **Hermes MemoryProvider install path** — Plugin was placed in `hermes/plugins/memory/overmind/` (user dir) but Hermes Agent's venv `sys.path` resolves `plugins.memory` to `hermes-agent/plugins/memory/` (bundled). Fixed by copying the plugin to the bundled location so Hermes can discover and activate it.

### 📦 Installation Fix for Hermes Users

- Copy `plugins/memory/overmind/` to `hermes-agent/plugins/memory/overmind/` (bundled plugins directory) so Hermes Agent loads the MemoryProvider correctly


### 📝 Documentation

- **README.md** — Removed outdated "Démarrage des Serveurs HTTP" section (servers are now auto-managed via Docker/setup scripts)

---

## [2.8.1] - 2026-05-18

### 📝 Documentation

- **Memory plugin README** — Added PostgreSQL init steps + full `.env` config reference (DB + OpenRouter/embedding vars)
- **MCP expose config** — Added `memory: { type: http, url: http://localhost:3099/mcp }` to Step 3
- **overmind-pool.mjs** — Moved to `bin/`
- **overmind-serve.bat** — Removed (redundant with `bin/install-overmind-windows.bat`)
- **agent-http-tutorial.md** — Updated paths for relocated files

---

## [2.8.0] - 2026-05-18

### 🧠 Hermes Memory Plugin — Overmind RAG Memory Provider

Overmind Cortex MemoryProvider using Hermes Agent's memory infrastructure with PostgreSQL + pgvector RAG.

#### 🚀 Features

- **OvermindMemoryProvider** — Full MemoryProvider implementation with sync_turn, prefetch, on_session_end, on_memory_write, and on_delegation hooks
- **HTTP MCP client** — Bypasses broken SDK (v3Schema.safeParse SSE bug) with direct HTTP/SSE implementation
- **Per-agent isolation** — Separate PostgreSQL database per agent namespace (agent_hermes, agent_sniper, etc.)
- **4096D semantic search** — Qwen 8B embeddings via OpenRouter with pgvector HNSW indexing
- **Auto-store/search** — Every turn automatically stored and prefetched before next turn

#### 🐛 Fixes

- **EACCES during global install** — Corrected overmind-postgres-mcp binary name
- **Session parsing** — hermes: session parsing + minimal valid args only
- **Invalid CLI flags** — Removed invalid --exit-after and --name flags from Hermes CLI args

#### 🔧 Infrastructure

- **Two-layer lifecycle** — Lifecycle + security hardening
- **Gitignore audit** — Cleaned gitignore for proper packaging

---

## [2.7.0] - 2026-05-15

### 🪶 Hermes MiniMaxi Integration — Final Fix

After the polyglote Hermes integration in 2.6.0, the MiniMaxi provider routing was broken due to hardcoded `api.minimax.io` URLs and missing API key environment variable.

#### 🔧 Corrections

- **Provider routing** : Changed from `--provider minimax` (hardcodes `api.minimax.io/anthropic`) to `--provider minimax-cn` which correctly uses `https://api.minimaxi.com/anthropic` → rewritten to `/v1`
- **API key injection** : Added `MINIMAX_CN_API_KEY` environment variable — the `minimax-cn` provider reads this specific variable name (not `MINIMAXI_API_KEY`)
- **Model type guard** : Fixed `model.toLowerCase is not a function` error — `settings.model` was an object `{provider:"custom",base_url:"..."}` instead of a string. Added `typeof settings.model === 'string'` guard before assignment
- **Removed unused import** : `resolveKiloModel` was imported but not used after removing the provider prefix transformation

#### 📊 Routing provider updated

| Modèle détecté | Provider | Endpoint |
| :--- | :--- | :--- |
| `minimax*`, `mini-max*` | `--provider minimax-cn` | `api.minimaxi.com/v1` |

#### ✅ Validation

- `build` : `dist/` généré
- `lint` : 2 warnings (types `any` acceptables, 0 errors)
- Test node direct : `Bonjour ! Comment allez-vous ?` ✓

---

## [2.6.0] - 2026-05-14

### 🪶 Hermes Runner — Polyglote, Windows-safe, Interpolation Universelle

Intégration **Hermes Agent** désormais nominale dans l'écosystème Overmind, au même niveau que Claude/Kilo/Gemini.

#### 🔧 Corrections critiques Windows

- **`killProcessTree()`** : remplace `child.kill('SIGKILL')` (signal POSIX invalide sur Windows) par `taskkill /F /T /PID <pid>`. Le sous-arbre de process Hermes est désormais tué proprement (plus de processus orphelin).
- **Vrai PID Hermes tracké** : `spawn` utilise `shell: false` lorsque le chemin du binaire est absolu, donc `child.pid` correspond au véritable `hermes.exe` au lieu du wrapper `cmd.exe`. `agent_control({ action: 'kill' })` cible maintenant le bon process.
- **Découverte du binaire** : ajout en priorité du chemin natif `%LOCALAPPDATA%\hermes\bin\hermes.exe` (installer officiel `install.ps1`) avant les chemins pip legacy.

#### 🌐 Routing provider polyglote

Hermes route maintenant chaque modèle vers son provider natif au lieu de tout coller sur OpenAI :

| Modèle détecté | Provider | Clé requise |
| :--- | :--- | :--- |
| `gpt-*`, `o1`, `o3` | `--provider openai` | `OPENAI_API_KEY` |
| `minimax*` | `--provider minimax` | `MINIMAXI_API_KEY` |
| `glm*` | `--provider zhipuai` | `Z_AI_API_KEY` |
| `mistral*`, `codestral*`, `devstral*` | `--provider mistral` | `MISTRAL_API_KEY` |
| `deepseek*`, `nvidia*` | `--provider nvidia` | `NVIDIA_API_KEY` |
| Tout autre | `--provider openrouter` (fallback) | `OPENROUTER_API_KEY` |

Liste `criticalKeys` étendue : MiniMax, ZhipuAI, Google (`GOOGLE_API_KEY`, `GEMINI_API_KEY`), Anthropic (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`), NVAPI préservées dans la fusion d'environnement.

#### 💉 Interpolation `$VAR` universelle

- `interpolateEnvVars()` appliqué sur l'**objet `settings` complet** (plus seulement `settings.env`) → `"model": "$MY_MODEL"` est désormais résolu.
- `interpolateEnvVars()` appliqué sur `mcpConfig` avant génération de `mcp.json` / `config.yaml` → les `env` des serveurs MCP avec `$VAR` sont résolus pour Hermes.

#### 📜 Convention `.claude/` partagée

Hermes lit les **3 fichiers standard** comme tous les autres runners :

- `.claude/agents/<agentName>.md` (prompt système)
- `.claude/settings_<agentName>.json` (config, env, modèle)
- `.claude/.mcp.<agentName>.json` (serveurs MCP)

Aucune divergence d'arborescence — un même agent peut être exécuté par Claude, Kilo, ou Hermes sans modification de fichier.

#### 📦 Installation cross-platform

`InstallHelper.ts` propose désormais l'installateur officiel :

- **Windows** : `irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1 | iex`
- **Linux/macOS** : `curl -fsSL .../install.sh | bash`

(au lieu du `pip install git+...` obsolète)

#### ✅ Validation

- `check-types` : 0 erreur
- `lint` : 0 warning
- `build` : `dist/` généré
- `test` : 76 passed, 3 skipped

---

## [2.3.3] - 2026-05-10

### 🐛 Fixes

- **dispatcher.ts**: Refactored to use `const` inline in each branch (no-useless-assignment)
- **MemoryFactory.ts**: Fixed `preserve-caught-error` — using `error` directly as cause
- **PostgresMemoryProvider.ts**: Added `{ cause: err }` to thrown error
- **AgentManager.ts**: Fixed `preserve-caught-error` — using `_e` as cause
- **ClaudeRunner.ts**: Simplified to use inline `const` declarations
- **vector_only_lock.test.ts**: Added `{ cause: err }` to thrown error

### 📦 Dependencies

- `overmind-postgres-mcp`: 1.1.6 → 1.2.0
- `fastmcp`: 3.35.0 → 4.0.1
- `pino`: 9.14.0 → 10.3.1
- `pino-roll`: 2.2.0 → 4.0.0
- `typescript`: 5.9.3 → 6.0.3
- `vitest`: 4.1.4 → 4.1.5
- `globals`: 17.5.0 → 17.6.0
- `typescript-eslint`: 8.58.2 → 8.59.2
- `eslint`: 9.39.4 → 10.3.0
- `@eslint/js`: 9.39.4 → 10.0.1
- `@types/node`: 22.19.17 → 25.6.2
- `zod`: 4.3.6 → 4.4.3

---

## [2.3.0] - 2026-05-10

### ✨ Features

- **Process Registry**: New async agent lifecycle management system — tracks `pid ↔ sessionId ↔ agentName` mapping in `sessions.json` with status (`running`, `done`, `failed`, `orphaned`), output buffer, and exit codes
- **`agent_control`** — Unified MCP tool for async agent lifecycle control:
  - `status`: Get current status + output buffer of a running agent
  - `stream`: Stream accumulated output in real-time with `isComplete` flag
  - `kill`: Kill a running agent by PID (Windows: `taskkill /F /T /PID`, Unix: `kill -9`)
  - `wait`: Poll until agent completes or timeout (15min default)
  - Replaces 4 separate tools: `get_agent_status`, `stream_agent_output`, `kill_agent`, `wait_agent`
  - Structured error codes: `AGENT_NOT_FOUND`, `AGENT_NOT_RUNNING`, `KILL_FAILED`, `WAIT_TIMEOUT`, `ORPHANED_PROCESS`
- **All 8 runners** now register with the Process Registry:
  - `registerProcess()` called immediately after `spawn()` with PID
  - `appendOutput()` called on every stdout/stderr chunk for live streaming
  - `linkSessionToPid()` called when runner emits a sessionId
  - `updateProcessStatus()` called on process close (done/failed)

### 🐛 Fixes

- **ClaudeRunner**: Process tree kill on Windows now properly uses `taskkill /F /T /PID` to kill orphaned `claude.exe` processes during fallback retry
- **ClaudeRunner**: Fallback retry mechanism re-enabled with async `triggerRetry()` that awaits process tree death before respawning
- **ClaudeRunner**: Unused `const timeout` variable removed (was shadowing the `let timeout` in closure)
- **ClaudeRunner**: Debug logs sanitized — no longer expose raw token presence with `***SET***` strings, only boolean flags
- **Hermes Runner**: Prompt truncation added — prompts exceeding 7000 chars are now truncated (not just warned) to prevent Windows 8191 limit crashes
- **setup.mjs**: Fixed `destDbPath` undefined bug in `createOvermindDatabase()` — was referencing undeclared variable
- **setup.mjs**: Container name normalized — `postgres-pgvector` → `overmind-postgres-pgvector` (coherent with postinstall.mjs)
- **setup.mjs**: Volume name normalized — `postgres_data` → `overmind_postgres_data`
- **auto-install.mjs**: Docker service filters corrected — `rabbitmq` → `overmind-rabbitmq`, `temporal` → `overmind-temporal`, etc. (now match actual docker-compose naming)
- **auto-install.mjs**: Network timeouts added — `curl` commands now have `--max-time 30` to prevent indefinite hangs
- **postinstall.mjs**: Network timeouts added — `curl` commands now have `--max-time 30` to prevent indefinite hangs
- **InstallHelper**: `trae` runner install command fixed — was pointing to a download URL (non-executable), now uses `npm install -g @trae-ai/trae`

### 🔧 Infrastructure

- **InstallHelper**: `trae` runner metadata added to CLI registry with correct npm install command
- **auto-install.mjs**: All docker service filters prefixed with `overmind-` to match docker-compose naming convention
- **setup.mjs**: PostgreSQL container name and volume now use `overmind-postgres-pgvector` / `overmind_postgres_data` (consistent across all scripts)

### 📦 Dependencies

- No dependency changes in this release.

---

## [2.3.2] - 2026-05-10

### 🔧 Infrastructure

- **Docker integration**: Removed RabbitMQ/Temporal/Prometheus/Grafana/Jaeger infrastructure for simplified setup
- **Process Registry**: Refactored into dedicated `processRegistry.ts` module

---

## [2.3.1] - 2026-05-10

### 🐛 Fixes

- **env interpolation**: Fixed GLM-5.1 environment variable interpolation for ClaudeRunner
- **Process Registry**: Improved session linking for GeminiRunner

---

## [2.2.6] - 2026-05-10

### ✅ Improvements

- **All 8 runners** reached 10/10 quality score with unified architecture:
  - Pino logger for structured logging
  - OpenTelemetry integration for tracing
  - 10MB buffer management (prevents memory leaks)
  - Hard timeout (SIGTERM → 5s → SIGKILL)
  - Automatic cleanup of temporary files
  - Session persistence
- **Hermes**: Cross-platform binary detection with HERMES_BIN_PATH env override
- **QwenCLI**: Added buffer management and hard timeout
- **Cline**: Added telemetry with mode attribute
- **OpenCode / OpenClaw**: Added structured logging and telemetry

### 🐛 Fixes

- **ClaudeRunner**: Process tree kill on Windows now uses `taskkill /F /T /PID` to kill orphaned `claude.exe` during 401/429 fallback retry
- **ClaudeRunner**: Fallback retry re-enabled — `AUTH_FALLBACK_1/2/3` tokens now rotate correctly when quota exhausted

---

## [2.2.5] - 2026-05-09

### ✅ Improvements

- **PostgreSQL setup**: Docker container auto-installed on `npm install -g`
- **pgvector extension**: Automatically enabled on first install
- **Config files**: `.env`, `.env.postgres`, `.mcp.json` created automatically in `~/.overmind/`

### 🐛 Fixes

- **OTEL collector**: Fixed restart loop caused by missing config file
- **Temporal service**: Disabled (requires complex DB initialization) — can be enabled manually via `overmind-setup --full`
- **PostgreSQL init**: Full table creation (memory, agents, runs) in init-db.sql
- **init-db.sql mount**: Fixed Docker volume mount path issue

---

## [2.2.4] - 2026-05-09

### 🚀 Features

- **Docker implementations**: Support for all Docker implementations (Desktop, Engine, Podman)
- **GLM-5.1**: Environment variable interpolation for ClaudeRunner with GLM-5.1 support

### 🐛 Fixes

- **env interpolation**: Fixed correct environment variable interpolation for ClaudeRunner

---

## [2.2.3] - 2026-05-09

### 📝 Documentation

- Simplified README installation section

---

## [2.2.2] - 2026-05-09

### 🚀 Features

- **Docker integration**: Simplified Docker integration with automatic PostgreSQL MCP installation

### 🐛 Fixes

- **Postinstall**: Improved detection of existing PostgreSQL to avoid container conflicts
- **Uninstall script**: Critical security fix - protect user containers from accidental deletion

---

## [2.1.1] - 2026-05-08

### 🐛 Fixes

- **Installation**: Fix installation and Docker services
- **PostgreSQL**: Improved postinstall to detect existing PostgreSQL and avoid container conflicts
- **Security**: Critical security fix in uninstall script - protect user containers

---

## [2.1.0] - 2026-05-07

### 🚀 Features

- **Intelligent install scripts**: Infrastructure detection with automated setup

---

## [2.0.9] - 2026-05-06

### 🐛 Fixes

- **PostgreSQL**: Disable postgres service when existing one detected

---

## [2.0.8] - 2026-05-05

### 🐛 Fixes

- **Windows compatibility**: Disable node-exporter on Windows for compatibility

---

## [2.2.4] - 2026-05-09

### 🚀 Features

- **Custom-Nickname Protocol**: Identify agents with original nicknames (`The Chaos Prophet`, `Shadow Sniper`, etc.)
- **Private Memory Context**: Isolated memory for each agent
- **QwenCli Runner**: Support for Qwen Code CLI
- **Nous Hermes Runner**: Support for Hermes agent via OpenRouter/NVIDIA/Mistral providers
- **8 Runners Total**: claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes

### 🔧 Infrastructure

- **Docker infrastructure** (via `overmind-setup --full`):
  - RabbitMQ (Message Broker)
  - Temporal (Workflow Orchestrator)
  - PostgreSQL + pgvector (Vector DB 4096D)
  - Prometheus, Grafana, Jaeger (Observability)

---

## [2.2.0] - 2026-05-07

### 🚀 Features

- **Swarm Orchestration**:
  - Dynamic task allocation to specialized agents
  - Automatic load balancing with intelligent scoring
  - Multi-capability support per agent (code, analysis, scraping, etc.)
  - Task priority management (1-10)
  - Real-time statistics (completed, failed, running, pending)

- **Long-Running Temporal Workflows**:
  - `longRunningWorkflow` for stateful tasks (OSINT, full analyses)
  - Up to 7-day workflow support
  - Control signals: `cancel`, `pause`, `resume`
  - Real-time state queries
  - Crash survival (Temporal persistence)

### ✅ Improvements

- **TypeScript**: Clean build (0 errors, 0 warnings)
- **ESLint**: Clean linting (0 errors, 0 warnings)
- **Tests**: 69 passed, 3 skipped

---

## [2.0.7] - 2026-05-05

### 🐛 Fixes

- **Temporal Web image**: Downgraded from `1.24.0` (not found on Docker Hub) to `1.15.0` (last stable)
- **tslib dependency**: Added as regular dependency to fix UNMET DEPENDENCY warnings

---

## [2.0.6] - 2026-05-04

### 🚀 Features

- **Auto-install system**:
  - CLI binaries: `overmind-setup`, `overmind-infra`
  - Automated dependency detection and installation
  - Post-install hook guides users through setup
  - Scripts: `install-dependencies.mjs`, `setup.mjs`, `docker-manager.mjs`
  - Docker compose files included in NPM package

---

## [2.0.0] - 2026-05-01

### 🎉 Major Release

- Complete OverMind-MCP infrastructure
- 8 AI agent runners
- Swarm orchestration
- Docker-based observability stack

---

<!--
  Version reference (update with each release):
  2.3.3 - 2026-05-10
  2.3.2 - 2026-05-10
  2.3.1 - 2026-05-10
  2.3.0 - 2026-05-10
  2.2.6 - 2026-05-10
  2.2.4 - 2026-05-09
  2.2.3 - 2026-05-09
  2.2.2 - 2026-05-09
  2.1.1 - 2026-05-08
  2.1.0 - 2026-05-07
  2.0.9 - 2026-05-06
  2.0.8 - 2026-05-05
  2.0.7 - 2026-05-05
  2.0.6 - 2026-05-04
  2.0.0 - 2026-05-01
-->
