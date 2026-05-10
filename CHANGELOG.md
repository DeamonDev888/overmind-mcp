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
  2.2.6 - 2026-05-10
  2.2.5 - 2026-05-09
  2.2.4 - 2026-05-09
  2.2.0 - 2026-05-07
  2.0.7 - 2026-05-05
  2.0.6 - 2026-05-04
  2.0.0 - 2026-05-01
-->
