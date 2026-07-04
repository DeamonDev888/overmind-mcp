# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).



## [3.2.4] - 2026-07-04

### Changed
- install-overmind-native.sh: refonte complète — 8 steps, 5 package managers (brew/apt/dnf/pacman/apk), compilation pgvector fallback
- install-overmind-native.sh: macOS launchd LaunchAgents + KeepAlive au lieu de systemctl
- install-overmind-native.sh: idempotent — détecte si déjà installé avant d'installer
- install-overmind-native.sh: anti-cassure — set -uo pipefail, track_error()/track_warn(), compteur ERRORS+WARNINGS

### Added
- install-overmind-native.sh: .env auto avec openssl rand, chmod 600, POSTGRES_SSL=false, POSTGRES_HOST=127.0.0.1
- install-overmind-native.sh: validation finale HTTP ping + SQL test
- install-overmind-native.sh: fallback postgresql@18 → postgresql@16 si non disponible

## [3.2.3] - 2026-07-04

### Fixed
- install-overmind-native.sh: multi-OS (Homebrew/apt/yum/pacman) + superuser auto (P0)
- postgres-manager.mjs: docker run direct au lieu de docker-compose (P0)
- postgres-manager.mjs: lecture password depuis ~/.overmind/.env + fallback POSTGRES_DATABASE
- postinstall.mjs: require('minimist') ESM → process.argv.includes

## [3.2.2] - 2026-07-04

### Fixed
- postinstall.mjs: single source of truth pour PG_PASSWORD (randomBytes 1x au boot)
- Docker setupPostgreSQL/startPostgreSQL utilisent le même password que .env
- Ordre: createEnvConfig() avant setupPostgreSQL()
- Summary: password masqué (substring 8 chars)

## [3.2.1] - 2026-07-02

### Fixed
- postinstall.mjs: await import('crypto') dans fonction sync → import statique (P0)
- ClaudeRunner: shell:true pour résolution 'claude' via PATH
- README: cleanup section migration v3.1

## [3.2.0] - 2026-07-02

### Breaking
- config.ts getAgentHermesHome: profiles/ uniquement, fallback legacy supprimé
- sessions.ts: .claude/sessions.json → bridge/agents.json
- processRegistry.ts: .claude/process-registry.json → bridge/process-registry.json
- HermesProfileManager.getProfilePath: ~/.overmind/hermes/profiles/ uniquement

### Changed
- config.ts getWorkspaceDir: fallback ~/.overmind-mcp/ → ~/.overmind/
- config.ts getSharedHermesHome: simplifié (supprimé workspace fallback)
- HermesProfileManager.create(): profile.yaml + workspace.yaml + README.md
- HermesProfileManager: require_os() supprimé, execSync importé proprement
- BridgeConfig: McpServerSpec + defaultMcpServers
- OverBridgeService.runAgent(): injecte mcp_servers par défaut
- WebhookAdapter: Telegram natif
- create_agent: DEFAULT_MCP_SERVERS=['memory'] pour Hermes
- install-overmind-native.sh: getent → multi-OS (P0)
- install-overmind-unix.sh: Node 25+ → auto nvm 24 (P2)
- postinstall.mjs: POSTGRES_DATABASE, password aléatoire, Docker, embedding vars (P0/P1)
- engines.node: >=24.18.0
- deps: fastmcp 4.3.2, pg 8.22.0, overmind-postgres-mcp 1.4.2
- devDeps: @types/node 26.0.1, eslint 10.6.0, prettier 3.9.4, vitest 4.1.9
- Lint: 0 warnings (all any, unused vars, imports corrigés)

### Added
- overmind-verify: smoke test post-install
- overmind-ngrok: tunnel ngrok unifié
- overmind-keygen: inclus package npm

### Removed
- getAgentOvermindHome (deprecated)
- Symlinks runs/, agents/, sessions/
- PLAN_MIGRATION_V3.md
- AgentManager: unused var hermesAgentNames

### Docs
- README.md refonte complète (arborescence, 14 outils)
- .mcp.json.example: discord-server → serveur_discord
- docs/agent_control, sniperbot flow, setup hermes mis à jour

## [3.1.1] - 2026-07-02

### Fixed
- install-overmind-native.sh: getent macOS → multi-OS resolution (P0)
- install-overmind-unix.sh: Node 25+ non détecté → warning + auto nvm 24 (P2)
- postinstall.mjs: POSTGRES_DB → POSTGRES_DATABASE + password aléatoire (P0)
- postinstall.mjs: POSTGRES_DB=overmind_memory dans Docker (P1)

### Added
- overmind-verify: outil de diagnostic (binaire, .env, PostgreSQL, MCP health)
- overmind-keygen: inclus dans le package npm (bin entry + README doc)

## [3.1.0] - 2026-06-29

### Added
- BridgeConfig.defaultMcpServers: tout agent créé via le bridge hérite automatiquement du MCP memory
- create_agent: DEFAULT_MCP_SERVERS pour Hermes (memory MCP automatique)
- WebhookAdapter: Telegram natif (multi-tenant, photo support, edited_message)
- scripts/ngrok-webhook.mjs: tunnel ngrok unifié avec URLs préformatées par provider

### Changed
- BridgeProxy: getter defaultMcpServers
- OverBridgeService.runAgent(): injecte mcp_servers dans chaque appel run_agent

## [3.0.4] - 2026-06-29

### Changed
- deps: fastmcp 4.3.2, pg 8.22.0, overmind-postgres-mcp 1.4.2, tinyglobby 0.2.17
- devDeps: @types/node 26.0.1, eslint 10.6.0, globals 17.7.0, prettier 3.9.4, typescript-eslint 8.62.1, vitest 4.1.9
- engines: node >=24.18.0
- bin/launch.cjs: process.title for window ID, windowsHide on exec
- docs: removed obsolete PLAN_MIGRATION_V3.md (superseded by MIGRATION_V3.md)

## [3.0.3] - 2026-06-29

### Changed
- docs: README indentation fix, symlinks legacy section removed from MIGRATION_V3.md

## [3.0.2] - 2026-06-29

### Changed
- **Docs refonte v3.1**: README entièrement réécrit (arborescence canonique, 14 outils listés, exemples à jour, section anti-zombie).
- **Docs**: `.mcp.json.example` — `discord-server` → `serveur_discord` (nom réservé Hermes), version 3.0+.
- **Docs**: `agent_control.md` — `.claude/sessions.json` → `bridge/agents.json`.
- **Docs**: `OVERMIND_HERMES_SNIPERBOT_FLOW.md` — chemins `Workflow/.overmind/hermes/agents/` → `~/.overmind/hermes/profiles/`.
- **Docs**: `SETUP_HERMES_AGENT_FROM_SCRATCH.md` — versions 2.8.40 → 3.0+, Hermes 0.16 → 0.17.
- **Code**: `processRegistry.ts` — commentaire `.claude/` → `bridge/`.
- **Code**: `config.ts`, `HermesProfileManager.ts`, `agentHermesHome.test.ts` — alignement docs/code post-refonte.

## [3.0.1] - 2026-06-29

### Fixed
- **[CI]**: Added `vitest.config.ts` to constrain test discovery. Previously, vitest scanned `.kilo/node_modules/`, `.claude/`, `.hermes/` and other agent-internal directories, which broke the GitHub Actions `Unit Tests` job (#280, failed after ~58s on v3.0.0 push). Local dev masked the bug because vitest auto-selected the `forks` pool without an explicit config.
- **[CI]**: Pinned `pool: 'forks'` in vitest config. Test `agentHermesHome.test.ts:165` calls `process.chdir()` which throws `"process.chdir() is not supported in workers"` under vitest v4 `threads` pool. Local dev masked this because vitest defaulted to `forks` when no config was present.
- **[Repo hygiene]**: Added `bridge/agents.json` and `bridge/process-registry.json` to `.gitignore` — these runtime registries are created on first run and should not be committed.

## [3.0.0] - 2026-06-29

### Breaking Changes — Architecture v3.1 (Profile layout refactor)
- **[Config] `src/lib/config.ts`**:
  - `getWorkspaceDir()`: fallback `~/.overmind-mcp/` → `~/.overmind/` (canonical).
  - `getSharedHermesHome()`: simplified to `~/.overmind/hermes/` (removed legacy 3-level resolution + workspace fallback).
  - `getAgentHermesHome()`: now searches `profiles/<name>/` instead of `agents/<name>/` (v3.1).
  - Legacy `agents/<name>/` fallback kept for retro-compat.
  - Native `~/.hermes/profiles/<name>/` fallback kept for Hermes retro-compat.
  - Removed deprecated `getAgentOvermindHome()`.
- **[Sessions] `src/lib/sessions.ts`**: `.claude/sessions.json` → `bridge/agents.json` (unified registry).
- **[ProcessRegistry] `src/lib/processRegistry.ts`**: `.claude/process-registry.json` → `bridge/process-registry.json`.
- **[Profiles] `src/services/HermesProfileManager.ts`**:
  - `getProfilePath()`: searches `~/.overmind/hermes/profiles/<name>/` first, fallback `~/.hermes/profiles/<name>/`.
  - `create()`: now generates `profile.yaml` + `workspace.yaml` + `README.md` (3 new files per profile).
  - Added `writeProfileYaml()`, `writeWorkspaceYaml()`, `writeReadme()`.
  - Removed inline `require_execSync` helper (was `@typescript-eslint/no-require-imports` trap).
- **[Agents] `src/services/AgentManager.ts`**: Layout comments aligned with v3.1 (profiles/ instead of agents/).

### Added
- **New files per profile**: `profile.yaml`, `workspace.yaml`, `README.md` auto-generated on `create_agent`.
- **Bridge directory**: `bridge/agents.json` and `bridge/process-registry.json` now used as canonical runtime registries.

### Migration
- Existing agents in `~/.hermes/profiles/` continue to work (automatic fallback).
- `.claude/sessions.json` will be migrated to `bridge/agents.json` at next startup.
- See `docs/MIGRATION_V3.md` for the full upgrade guide.

### Compatibility
- Windows: `%LOCALAPPDATA%\overmind\hermes\profiles\<name>\`
- Linux: `~/.overmind/hermes/profiles\<name>/`
- Fallback: `~/.hermes/profiles\<name>/` (if already exists)

### Post-Refactor Cleanup
- Removed unused imports in `cli.ts`, `overmind-bridge.ts`, `ArgParser.ts`, `OverBridgeServer.ts`, `PromptSource.ts`.
- Replaced `require_execSync` helper with native `execSync` import in `HermesProfileManager.ts`.
- Fixed TypeScript strict-mode warnings (`_opts`, `_err`, explicit types).
- Removed dead code path filtering `default` profile in `AgentManager.ts`.
- Renamed `docs/MIGRATION_V3.1.md` → `docs/MIGRATION_V3.md`.

## [2.8.53] - 2026-06-28



















## [2.8.53] - 2026-06-28

### Added & Fixed
- **[Hermes Integration]**: Migrated `NousHermesRunner.ts` into a clean refactored module under `HermesRunner.ts` and `HermesProfileManager.ts`.
- **[Build/Scripts]**: Updated the prebuild scripts to copy `launch.cjs` instead of `launch.js`.
- **[Cleanup]**: Removed deprecated swarm code files and legacy tests.

## [2.8.52] - 2026-06-20

### Fixed
- **[Services] `ClaudeRunner.ts`**: Force-inject `ANTHROPIC_BASE_URL` and `ANTHROPIC_MODEL` from agent settings directly into the spawn environment variables, bypassing/correcting potentially corrupted or mismatched entries inside `.env` configuration (such as typos like `minimax` vs `minimaxi`).

## [2.8.51] - 2026-06-17

### Fixed & Cleaned
- **[Logger]**: Replaced ad-hoc `pino` logger instantiations with `rootLogger` children across all services (e.g. `NousHermesRunner.ts`) to unify log streams and format consistency.
- **[Documentation]**: Cleaned up deprecated refactoring plans and updated guides.

## [2.8.50] - 2026-06-13

### Security
- **[Git/CI]**: Hardened project safety by removing PAT credentials from the git config, configuring Windows credential manager integration, introducing a pre-commit anti-secrets check hook, and strictly expanding the `.gitignore` to shield backup, auth, and session dump files.
- **[Clean/Refactor]**: Cleared legacy prompts and old verification files.

## [2.8.49] - 2026-06-13

### Added & Improved
- **[Bridge] `OverBridgeServer.ts`**:
  - Implemented client IP rate limiting (defaults to 100 requests per 60 seconds on the `/rpc` endpoint, configurable via `rateLimitMax`).
  - Added configurable CORS allowlist (`allowedOrigins` parameter) to control which origins can query the bridge.
  - Hardened authorization check using timing-safe buffer comparison (`crypto.timingSafeEqual`) to prevent timing side-channel attacks on authorization headers.
- **[Bridge] `BridgeHttpClient.ts`**: Implemented automatic retry with backoff for transient network issues or HTTP 5xx errors (up to 2 retries, skipping standard application-level JSON-RPC errors).
- **[Session] `SessionStore.ts`**: Added lightweight base64 obfuscation for stored `sessionId` values to prevent accidental exposure (e.g. via logs or screens).

## [2.8.48] - 2026-06-13

### Security & Robustness
- **[CLI] `cli.ts`**:
  - Implemented network security policy: refuses non-loopback network bindings without SSL certificates (prevents exposing sensitive MCP tools over local networks).
  - Fixed Node.js `http.createServer` monkey patch: scope is now restricted to the main FastMCP server initialization by restoring the original handler immediately.
  - Added try-catch handler around server start to log errors properly (e.g. `EADDRINUSE` port collision) instead of throwing.

## [2.8.47] - 2026-06-13

### Fixed & Cleaned
- **[Services] `NousHermesRunner.ts`**: Cleaned up deprecated `filterConfigYaml` helper and local binary scanners since path resolution has been refactored into modular subdirectories.
- **[Database/Memory] `PostgresMemoryProvider.ts` / Sessions & Process Registry**: Cleaned up legacy maintenance jobs and sessions mapping.

## [2.8.46] - 2026-06-12

### Fixed
- **[Services] `AgentManager.ts`**:
  - Refactored Hermes agent creation and retrieval logic to comply with the native `settings.json` layout (`<HERMES_HOME>/agents/<name>/settings.json` instead of deprecated `.hermes/` nested folder).
  - Fixed configuration retrieval to directly read from the native layout.
- **[Documentation]**: Updated README and SETUP guides to reflect the latest native Hermes agent configuration setup.

## [2.8.45] - 2026-06-09

### Fixed
- **[Services] `NousHermesRunner.ts`**:
  - Removed `--toolsets` flag passed to the Hermes CLI to prevent `Warning: Unknown toolsets` warnings (MCP servers are already loaded via `config.yaml`).
  - Added auto-creation of directories in `linkDirRobust` to prevent link creation failure when sources don't exist yet.
  - Refactored native settings handling cycle to avoid `.claude/` setting conversions and instead read/write in native format.
  - Updated logs and internal comment documentation to french.

## [2.8.44] - 2026-06-08

### Improved
- **[Services] `NousHermesRunner.ts`** — Comprehensive logging, robustness and kill-chain improvements:
  - **`killProcessTree()`**: Split into 3 guard checks with structured `[KILL]` log prefix at each phase (no-ref / already-dead / initiating). Logs `taskkill` stdout/stderr on Windows and SIGTERM/SIGKILL dispatch outcomes.
  - **`filterConfigYaml()`**: Wrapped entire body in `try/catch` — unexpected YAML parse failures now log `[YAML_FILTER]` error and return safe `mcp_servers: {}` instead of throwing.
  - **`cleanupTempFiles()` / `runAgent()`**: Added `[CLEANUP]` and `[RUN_AGENT]` structured log prefixes for entry, session-save and error paths.
  - **`runAgentInternal()`**: `[RUN_AGENT_INTERNAL]` log on entry; `.env` loading is now guarded with `fs.existsSync` before calling `loadEnvQuietly` (avoids spurious warnings); auto-resume logic logs found/not-found session ID.
  - **`abortListener`**: Extracted into a named function so it can be properly removed from `AbortSignal` via `removeEventListener` after resolution, preventing double-fire.
  - **SOUL.md resolution order**: `claudeSoul` (`.claude/agents/<name>.md`) is now checked **first**, before canonical then legacy paths. Allows `.claude/` overrides to win without touching the shared home.
  - **`--toolsets` prefix**: MCP server names are now automatically prefixed with `mcp-` when the prefix is absent (Hermes upstream expects `mcp-<name>` format).
  - **`[TOKEN_RESOLVER]`**: Renamed internal log prefix from `[SUBTILISATION]` to `[TOKEN_RESOLVER]` for English-friendly log filtering.
  - **`PYTHONUTF8`**: Removed from spawn env (redundant with `PYTHONIOENCODING=utf-8` and caused warnings on some Python builds).
  - **`this.MAX_BUF`**: Fixed `MAX_BUF` reference from module-level to `this.MAX_BUF` (class property) in stdout/stderr accumulators.
  - **`linkDirRobust()`**: Replaced ad-hoc `if (!fs.existsSync(...))` junction/symlink creation with a safe helper that uses `lstatSync` (survives broken symlinks), logs skip/create decisions.

### Tests
- 64/64 tests pass. TSC clean. ESLint 0 errors.

## [2.8.43] - 2026-06-07

### Fixed
- **sniperbot_analyst SOUL.md minimal rewrite** - Replaced 8133-byte prescriptive persona with 1187-byte factual one. The LLM was over-prioritizing the "no greeting" rule and refusing to act even on explicit user requests.

### Test results
- prompt "pong" → "pong" ✅
- prompt "list tools" → 17 tools listed correctly ✅
- prompt "create embed" → Sniperbot created embed on Discord ✅

### Lesson
For Hermes system prompts: keep SHORT (under 50 lines), state tools factually, avoid prescriptive rule lists.

## [2.8.40] - 2026-06-07

### Updated
- **sniperbot_analyst SOUL.md** — Full rewrite of the persona to reflect the REAL state of the Discord MCP server:
  - **17 tools confirmed working** against the real VIBE DEV server (ID 804393160092024832, 9 members, 30 channels, 6 roles, created 2021-01-28)
  - Tools listed by actual registered name (`gestion_messages`, `creer_embed`, `gestion_membres`, `gestion_serveur`, etc.) with their `action` parameter
  - Added explicit anti-confusion: "ne dis jamais que tu n'as pas accès à Discord"
  - Added 4 minimax_* (with underscore) clarification: those are **agent names** for `mcp_overmind_server_run_agents_parallel`, NOT tools
  - Confirmed end-to-end via `mainteneur_agent_divers` (which has a healthy SOUL.md): successfully called `mcp_discord_server_gestion_serveur` and got VIBE DEV server info

### Tests
- 64/64 tests pass. TSC clean.

### Why the sniperbot_analyst still says "j'attends une première demande"
The persona is now aligned with reality, but the `Règle Absolue — Pas de Message Non Sollicité` (no unsolicited greeting on Discord startup) is being **over-applied**: when invoked via `mcp__overmind__run_agent` (NOT via Discord), the persona treats it as a "Discord session start" and refuses to act.

This is a UX-level fix: the persona should distinguish "real Discord start" (no greeting) from "Overmind test invocation" (act on the prompt). For now, the `mainteneur_agent_divers` agent demonstrates the MCP tools work end-to-end.

## [2.8.39] - 2026-06-07

### Fixed
- **CRITICAL: `--toolsets` names mismatch** - The runner was passing MCP server names from `Workflow/.mcp.json` (e.g. `serveur_discord`, `X`, `serveur_PostGreSQL`) to Hermes upstream's `--toolsets` flag, but Hermes upstream's `--toolsets` expects names from the **`mcp_servers:` block of its own config.yaml** (e.g. `discord-server`, `x_server`, `postgres`). The names didn't match, so Hermes upstream printed `Warning: Unknown toolsets: ...` and silently dropped those tools. The MCP tools were still auto-loaded from the config.yaml mcp_servers block, but the warning confused agents into thinking they had no MCP.
- **Fix:** The runner now reads the Hermes config.yaml (in `<HERMES_HOME>/config.yaml`) and extracts the keys under the `mcp_servers:` block, then passes those to `--toolsets`. Falls back to `.mcp.json` only if the Hermes config has no mcp_servers. The Overmind registry and the Hermes registry remain separate (different naming conventions, different format), but at least the toolsets flag now matches what Hermes upstream actually accepts.

### Tests
- 64/64 tests pass. TSC clean.

## [2.8.38] - 2026-06-07

### Fixed
- **sniperbot_analyst SOUL.md tool name mismatch** - The persona mentioned `mcp_discord_server_envoyer_message`, but the actual registered tool is `mcp_discord_server_gestion_messages` (with `action: "envoyer"`). The sniperbot would search for the wrong tool name and report "aucun MCP" even when the 17 `mcp_discord_server_*` tools were registered.
- **Fix:** Replaced `envoyer_message` with `gestion_messages` in the SOUL.md. Also added the full suite of management tools (sondages, boutons, menus, membres, roles, canaux) so the persona is no longer out of sync with reality.

### Why the sniperbot kept saying "j'ai pas de MCP" even with 69 tools registered
This is a **prompting artifact** more than a config bug. The 2.8.37 fix correctly bootstrapped `Workflow/.overmind/hermes/config.yaml` and the agent.log shows `MCP: registered 69 tool(s) from 5 server(s)`. The sniperbot_analyst had all 17 `mcp_discord_server_*` tools available — but its SOUL.md was so prescriptive about "Discord-first" that it would prefer to say "I don't have MCP tools" rather than admit the prompt is wrong.

### Long-term recommendation
Rewrite the SOUL.md to be more **fact-checking-oriented** ("here are the tools I have, here is what each one does") rather than **rule-based** ("you don't have X tool"). The current persona causes the model to confabulate limitations it doesn't have.

### Tests
- 64/64 tests pass. TSC clean.

## [2.8.35] - 2026-06-07

### Fixed
- **Sniperbot_analyst MCP server names mismatch** - The settings referenced MCP server names that did NOT exist in `Workflow/.mcp.json`:
  - Settings had `discord-server`, `x-mcp-server`, `postgresql-server` (kebab-case style).
  - `.mcp.json` actually has `serveur_discord`, `X`, `serveur_PostGreSQL` (french-mixed case).
  - Only `memory-server` matched, so the sniperbot loaded 1/4 expected MCP servers.
- **Fix:** Flipped `enableAllProjectMcpServers: true` in `Workflow/.claude/settings_sniperbot_analyst.json`. Now ALL 9 MCP servers load.

### Why the sniperbot reported "no MCP tools"
Hermes upstream looks up each name in `Workflow/.mcp.json` and **silently skips** names that don't exist. The sniperbot saw only `memory-server` (the one that matched) — and interpreted the rest as missing.

### Tests
- All 64/64 tests pass. TSC clean.

## [2.8.32] - 2026-06-07

### Fixed
- **[Services] `NousHermesRunner.ts`** - The canonical `agents/<name>/settings.json` now INJECTS the provider-specific env var that the upstream Hermes plugin actually reads. Detection logic:
  - MiniMax token (`sk-cp-*` or `sk-mm-*`) + URL contains `minimaxi` (with the `i`) -> seed `MINIMAX_CN_API_KEY` only (CN plugin).
  - MiniMax token + URL contains `minimax` (no `i`) -> seed `MINIMAX_API_KEY` only (GLOBAL plugin).
  - MiniMax token + no URL -> default to CN per `OVERMIND_MINIMAX_DEFAULT=cn`, seed `MINIMAX_CN_API_KEY`.
  - Z.AI token (32hex or 32hex.32hex) -> seed `ZAI_ANTHROPIC_FALLBACK_KEY` + `GLM_API_KEY`.
  - **`ANTHROPIC_AUTH_TOKEN` is kept** as a generic fallback for any code path that still reads it.
- **ROOT CAUSE of 13:20 404 -> 13:33 401 -> 13:34 401 progression**:
  1. `Workflow/.claude/settings_sniperbot_analyst.json` only had `ANTHROPIC_AUTH_TOKEN`, not `MINIMAX_CN_API_KEY`. The plugin `minimax-cn` reads `MINIMAX_CN_API_KEY` from the per-agent `agents/<name>/settings.json`, so it failed to find the credential.
  2. Without the right env var, Hermes upstream's plugin resolver fell back to `nvidia` (then 404 because `MiniMax-M3` is not a NVIDIA model), then `openrouter` (then 401 because there's no `OPENROUTER_API_KEY` and we explicitly purge it).
  3. The 2.8.31 fix that seeded `MINIMAX_CN_API_KEY` in the **process env** was correct, but the bug 2.8.30 introduced was that I seeded BOTH `MINIMAX_CN_API_KEY` AND `MINIMAX_API_KEY`. The plugin resolver's first-match logic picked the GLOBAL one (`minimax`, no `i`) and went to `api.minimax.io` (GLOBAL endpoint) with a CN token -> 401 "invalid api key".
  4. 2.8.32 fixes this by writing the env var into `settings.json` (which is what the plugin actually reads) AND by only seeding the matching one (CN vs GLOBAL based on URL).

### Manual fix
- **Wrote the canonical `Workflow/.overmind/hermes/agents/sniperbot_analyst/settings.json`** with `MINIMAX_CN_API_KEY` set to `$ANTHROPIC_AUTH_TOKEN_5` (interpolated from `.env`). The sniperbot_analyst external Discord bot can now spawn Hermes and the `minimax-cn` plugin will find the credential.

### Tests
- All 64/64 tests pass. TSC clean.

## [2.8.31] - 2026-06-07

### Fixed
- **[Services] `NousHermesRunner.ts`** - Spawn env plugin-compat seed: when the agent's resolved token starts with `sk-cp-` or `sk-mm-` (MiniMax), also seed `MINIMAX_CN_API_KEY` + `MINIMAX_API_KEY` in the spawn env (in addition to the generic `ANTHROPIC_AUTH_TOKEN`). Same for Z.AI 32hex tokens: seed `ZAI_ANTHROPIC_FALLBACK_KEY` + `GLM_API_KEY`. Reason: the Hermes `minimax` plugin reads `MINIMAX_CN_API_KEY` (not `ANTHROPIC_AUTH_TOKEN`); without the seed, Hermes fell back to the wrong plugin (we observed it pick `nvidia` and 404 on `MiniMax-M3` because that model does not exist at `integrate.api.nvidia.com`). The seed is process-env-only and scoped to a single spawn - it does NOT write to any file on disk.
- **[Services] `NousHermesRunner.ts`** - Stale provider env var purge: before seeding, delete `MINIMAX_CN_API_KEY`, `MINIMAX_API_KEY`, `ZAI_ANTHROPIC_FALLBACK_KEY`, `GLM_API_KEY`, `Z_AI_API_KEY`, `Z_AI_BASE_URL`, `GLM_BASE_URL`, `NVIDIA_API_KEY`, `NVIDIA_API_BASE` from the spawn env. Reason: a `Workflow/.env` from a previous provider config (e.g. Z.AI legacy) could leak a stale `MINIMAX_CN_API_KEY` into the spawn env and shadow the correct credential.

### Cleaned
- **Migrated 35/37 legacy `agent_<name>/.hermes/` dirs** to the canonical `<HERMES_HOME>/agents/<name>/` layout. Total: 35 agents, 35/35 successful.
  - 2 path-too-long edge cases (Windows 260 char limit) on `agent_pdf_bon_travail` and `agent_minimax_test_placeholder` - skipped; will need a manual xcopy / robocopy workaround. The runner's legacy fallback (`getAgentHermesHome` checks both layouts) keeps them working.
- **Deleted duplicate HERMES_HOME** at `Backup\Serveur MCP\.overmind\` (193 MB, 5 legacy agent dirs). The canonical root is now `Backup\Serveur MCP\Workflow\.overmind\hermes\`.
- **Deleted 34 empty `agent_<name>/` parent dirs** left behind after migration.
- **Deleted `settings_zai_test.json`** (stale Z.AI test settings from May 2026).
- **Deleted temp backups** `agents\sniperbot_analyst.bak.pre-2.8.30\` and `agents\sniperbot_analyst.bak.pre-2.8.30_sessions\` (~45 MB).
- **Kept `agents._migrate_backup_20260607_131751/`** (262 MB) for one session in case anything broke. User can remove with: `rm -rf 'Workflow/.overmind/hermes/agents._migrate_backup_20260607_131751'`.

### Tests
- All 64/64 tests pass. TSC clean. ESLint 0 errors (12 pre-existing warnings).

## [2.8.30] - 2026-06-07

### Changed (BREAKING internal layout - runtime behavior preserved)
- **[Lib] `config.ts`** - Refactored `getAgentHermesHome()` and added `getSharedHermesHome()` to match the canonical Hermes upstream layout:
  - `HERMES_HOME` is now the **SHARED root**: `<workspace>/.overmind/hermes/`
  - Per-agent state lives at `HERMES_HOME/agents/<name>/` (NOT `<HERMES_HOME>/agent_<name>/.hermes/`)
  - This matches Hermes upstream's appdirs-style resolution (e.g. `~/.hermes/agents/<name>/`).
  - `getAgentOvermindHome()` is now a deprecated alias for `getAgentHermesHome()`.
  - The new env var `OVERMIND_HERMES_HOME` lets operators pin the shared root explicitly (e.g. systemd EnvironmentFile).
  - **Backward compat:** if `agents/<name>/` doesn't exist but `agent_<name>/.hermes/` does (legacy pre-2.8.30 state), the helper returns the legacy path. So existing agents keep working without a one-shot migration.

### Removed
- **[Services] `NousHermesRunner.ts`** - Vired the entire "polylgot" 3-pass subtilisation + `writeAuthJson()` function that wrote `agents/<name>/.env`, `config.yaml`, and `auth.json`. These files are now owned by **Hermes upstream**, not the runner. The runner's only writes are:
  - `<HERMES_HOME>/agents/<name>/settings.json` - converted from `Workflow/.claude/settings_<name>.json` (Overmind runner format to Hermes canonique).
  - `<HERMES_HOME>/agents/<name>/SOUL.md` - already-written persona (no-op for the runner).
- **[Services] `NousHermesRunner.ts`** - `HERMES_HOME` env var passed to Hermes spawn is now the **shared root** (`getSharedHermesHome()`), not the per-agent home. This tells Hermes upstream "look for `agents/<name>/`, `config.yaml`, `auth.json` relative to this root", which matches its appdirs resolver.

### Fixed
- **[Services] `NousHermesRunner.ts`** - The `.hermes/.env` stale-write bug (2.8.29 fallback `=== undefined` check) is no longer relevant: the runner does NOT write a `.hermes/.env` anymore. Hermes upstream reads env from the per-agent `settings.json` and the shared `HERMES_HOME/.env` (if it exists).
- **[Hermes] `auth.json`/`config.yaml` chaos** - Old agents that ran Z.AI then switched to MiniMax had a stale `auth.json` with both `zai` (exhausted) and `minimax` (token Z.AI legacy) buckets. With the new layout, Hermes upstream regenerates `auth.json` from its own credential pool on first run, so the stale state is gone.

### Migration (one-shot, manual)
- For the `sniperbot_analyst` agent: moved `Workflow/.overmind/hermes/agent_sniperbot_analyst/.hermes/` to `Workflow/.overmind/hermes/agents/sniperbot_analyst/`. The old Z.AI-stale `config.yaml`/`auth.json`/`.env`/`state.db`/`sessions/` were backed up to `Workflow/.overmind/hermes/agents/sniperbot_analyst.bak.pre-2.8.30/`. The runner will re-create `settings.json` (and Hermes upstream will re-create `config.yaml`/`auth.json`) on the next spawn with the correct MiniMax CN config from `Workflow/.claude/settings_sniperbot_analyst.json`.
- The other ~40 `agent_*` directories under `Workflow/.overmind/hermes/` are still in the legacy layout; they will continue to work via the `getAgentHermesHome` backward-compat fallback. New writes will be redirected to `agents/<name>/` only when an agent is first invoked in 2.8.30+.

### Tests
- **`agentHermesHome.test.ts`** - Rewrote to test the new layout (canonical + legacy fallback). 9 tests, all green.
- Total: 64/64 tests pass.

## [2.8.25] - 2026-06-07

### Fixed
- **[Lib] `envUtils.ts`** — `interpolateEnvVars()` regex bug: the previous `\$(\w+)|\${(\w+)}` had only ONE capture group (so the callback received `undefined` for the second arg and `${VAR}` crashed on `process.env[undefined]`), and it did not consume the closing `}` (leaked as literal text). Fixed regex: `\$\{(\w+)\}|\$(\w+)` with explicit capture group on each alternation branch and closing brace consumed.
- **[Services] `NousHermesRunner.ts`** — Token re-map hijack bug: when both a generic key (e.g. `ANTHROPIC_AUTH_TOKEN=*** and a provider-specific key (e.g. `MINIMAX_API_KEY=sk-cp-...DIFFERENT`) were set, the old code took `ANTHROPIC_AUTH_TOKEN` first, re-mapped it to `MINIMAX_API_KEY`, and ignored the user explicit choice. New 3-pass strategy: Pass A prefers the candidate whose env-var name already matches its detected provider; Pass B re-maps the first candidate to the right provider; Pass C is the rare fallback.
- **[Docs] `provider-config-map.md`** — Corrected the priority order (was inverted: HERMES_HOME/.env listed first, but the code reads process.env first then settings then .hermes/.env which has the last word). Added a "Niveau 1 vs Niveau 2" section explaining that the runner votes 3-signal to seed auth.json, and Hermes upstream re-reads with its own model-name-based logic.
- **[Docs] `SUBTILISATION_EXPLAINED.txt`** — Added the CN vs GLOBAL disambiguation case (sk-cp- prefix is shared between both, URL is the only signal that disambiguates). Documented the new 3-pass strategy and the canonical vs local-closure split.

### Added
- **[Services] `hermesTokenResolver.ts`** — Canonical, side-effect-free module exporting `detectTokenProvider` and `resolveTokenWithDetection`. The runner keeps its local closure for ergonomics, but the canonical version is the source of truth and is what the tests exercise.
- **[Tests] `envUtils.test.ts`** — 10 unit tests covering the `${VAR}` bug fix, recursing into objects/arrays, and defensive behavior.
- **[Tests] `hermesSubtilisation.test.ts`** — 15 unit tests covering Z.AI token detection (32hex.32hex, 32hex, 16+hex), MiniMax (sk-cp-, sk-mm-), anthropic, openrouter, openai, unknown; 3-pass resolution strategy; Pass A re-map hijack fix; real Z.AI + MiniMax end-to-end scenarios.
## [2.8.28] - 2026-06-07

### Fixed
- **[Services] `NousHermesRunner.ts`** — Removed `--provider` flag from CLI args
  when spawning Hermes. Empirical observation: `hermes chat -q --provider minimax-cn`
  returns 401 from `api.minimaxi.com`, while `hermes chat --yolo` (no `--provider`)
  with the same env vars succeeds. The explicit `--provider` flag activates a
  buggy code path in the Hermes plugin that sends an auth header the upstream
  rejects. Letting Hermes auto-detect the provider from the env vars
  (`MINIMAX_CN_API_KEY`, `ZAI_ANTHROPIC_FALLBACK_KEY`, etc.) is more reliable.
  The resolved provider is still logged at INFO level for debugging.
  Reference: `C:\Users\Deamon\Desktop\launcher\Hermes-MiniMax-2.bat` works
  with `hermes chat --yolo` (no `--provider`).

## [2.8.27] - 2026-06-07

### Fixed
- **[Lib] `config.ts`** — Added canonical `getAgentHermesHome(agentName)` and
  `getAgentOvermindHome(agentName)` helpers. Previous code computed HERMES_HOME
  from `process.cwd()` which was non-deterministic (any process spawned from
  a different cwd would create or read a different HERMES_HOME). This caused
  "two HERMES_HOME" drift where one process wrote `.hermes/.env` to
  `<workflow>/.overmind/...` while another read from
  `<backup root>/.overmind/...` — leading to stale credentials, auth.json
  drift, and silent 401s on the wrong endpoint.
- **[Services] `NousHermesRunner.ts`** — Switched all HERMES_HOME references
  to the new helper. The runner no longer cares about cwd for path resolution.
- **[Services] `NousHermesRunner.ts`** — `auth.json` write now PRUNES stale
  `credential_pool` entries from previous provider configurations instead
  of merging them. Previously, an agent that switched from Z.AI to MiniMax
  would have both buckets in auth.json, and Hermes could pick the stale
  `zai` entry with `last_status="exhausted"` instead of the freshly-seeded
  `minimax-cn` entry. The version + oauth providers from the existing
  auth.json are preserved; only `credential_pool` is re-seeded from scratch
  with the effectiveProvider's entries.

### Multi-OS / multi-install
- **`OVERMIND_AGENT_HOME`** env var now wins (operator-declared, e.g. via
  systemd EnvironmentFile or `npm -g sudo` install script).
- **Linux/Mac prod** (`sudo npm i -g overmind-mcp`): uses
  `$HOME/.overmind/hermes/agent_<name>/.hermes` as canonical HOME-based path.
- **Windows prod** (npm -g): uses
  `%LOCALAPPDATA%\overmind\hermes\agent_<name>\.hermes`.
- **Dev local** (`pnpm dev` from source repo): uses workspace-relative path
  if it already exists (backward compat), else falls through to HOME.
- **HOME override** (`HOME` / `USERPROFILE` / `LOCALAPPDATA`) is propagated
  to the spawned Hermes subprocess so relative `~/.hermes/.env` lookups
  inside Hermes resolve to the same canonical location.

### Added
- **[Tests] `agentHermesHome.test.ts`** — 9 tests covering all 3 install modes
  (operator-declared, legacy workspace, HOME-based) on both Linux and Windows
  platforms. Validates cwd-independence explicitly.

## [2.8.26] - 2026-06-07

### Fixed
- **[Services] `NousHermesRunner.ts`** — MiniMax CN/GLOBAL disambiguation: when a token with the `sk-cp-` prefix is detected WITHOUT an explicit `ANTHROPIC_BASE_URL` (or with an ambiguous URL), the runner now defaults to `minimax-cn` instead of `minimax` (GLOBAL). The previous behavior caused silent 401s for users whose setup exclusively uses CN tokens. Configurable via `OVERMIND_MINIMAX_DEFAULT` env var (`cn` | `global` | `auto`).
- **[Services] `NousHermesRunner.ts`** — Default `base_url` per provider is now baked into the runner (`defaultBaseUrlFor()`). Previously the fallback was always Z.AI, causing `auth.json` to be seeded with the wrong endpoint for non-Z.AI providers. Each provider now has its canonical endpoint as the fallback.

### Changed
- **[Settings] `sniperbot_analyst`** — Switched to MiniMax CN. `ANTHROPIC_BASE_URL` now points to `https://api.minimaxi.com/anthropic` and `ANTHROPIC_PROVIDER=minimax-cn` (was GLOBAL).

### Added
- **[Env] `OVERMIND_MINIMAX_DEFAULT`** — New env var controlling the MiniMax CN vs GLOBAL default. Defaults to `cn`. Documented in `provider-config-map.md` and `SUBTILISATION_EXPLAINED.txt`.
- **[Tests] `hermesSubtilisation.test.ts`** — 7 new tests covering `OVERMIND_MINIMAX_DEFAULT` behavior and `defaultBaseUrlFor()` mapping.
## [2.8.15] - 2026-06-06

### Fixed
- **[Services] `NousHermesRunner.ts`** — Token resolution & diagnostics for `minimax-cn` / `zai` providers
  - Drop the `GLM_API_KEY: ''` pre-seed that was clobbering `settings_<agent>.json` values whenever `interpolateEnvVars()` returned an empty string (root cause of the cryptic `EXIT_CODE_1` / 401 on hermes runs). The empty string used to win against `Object.assign()` when the shell parent didn't export `GLM_API_KEY`.
  - Expand `TOKEN_KEYS` to 16 variants: `ANTHROPIC_AUTH_TOKEN` plus `_E` / `_F` / `_Y` / `_1`..`_5` suffixes, `GLM_API_KEY` plus `_E` / `_Y`, `Z_AI_API_KEY`, `ZAI_ANTHROPIC_FALLBACK_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`, `OPENAI_API_KEY`, `OPENAI_AUTH_TOKEN`. Covers the convention observed in real `.env` files.
  - Add `warn()` diagnostic when `settings_<agent>.json` is missing at the expected path — lists the alternative paths that DO exist (e.g. `.claude/agents/settings_<name>.json`).
  - Add `error()` diagnostic inside `getTokenForIndex(0)` showing which TOKEN_KEYS were empty / present (length only, no values), plus paths of the temp settings file and `.hermes/.env`.
  - Add early-return `NO_LLM_TOKEN` error instead of silently spawning hermes with an empty API key (the misleading `EXIT_CODE_1` is gone).
  - Fix Linux path handling: detect venv install before overriding `VIRTUAL_ENV` / `PATH`; use `:` separator on POSIX; do not override PATH for system installs (e.g. `/usr/local/bin/hermes`). Fixes `ENOENT` on Ubuntu servers where the old code wrote a Windows-only PATH with `;` separator.
  - Add inline comment block documenting the provider → env-var mapping (the minimax plugin in Hermes v0.16.0 decides the env var name, not Overmind).

### Changed
- **[Tools] `config_example.ts`** — Provider `minimax` example now uses `MINIMAX_CN_API_KEY` (not `ANTHROPIC_AUTH_TOKEN`) and documents the full provider → env-var mapping table to prevent silent 401s.

## [0.9.0] - 2025-05-24

### Refactored

- **[Services] `GeminiRunner.ts`** — Complete refactor to use **Antigravity CLI** (`Antigravity IDE.exe`) instead of the deprecated `@google/gemini-cli` npm package
  - Removed `gemini-cli` npm dependency
  - Detects Antigravity IDE installation at `C:\Users\Deamon\AppData\Local\Programs\Antigravity IDE\`
  - Spawns `Antigravity IDE.exe --mode <MODE> --prompt-file <FILE> --session <ID> ...`
  - Supports 11 Antigravity modes: `GENERAL`, `CONTEXT_CHECK`, `PLAN`, `COMMAND`, `CASCADE`, `EVAL`, `ANTIGRAVITY_REVIEW`, `MQUERY`, `COMMIT_MESSAGE`, `CHECKPOINT`, `FAST_APPLY`
  - Agent config stored in `.antigravity/<agent>/` directory
  - JSON output parsing with structured error handling (`ANTIGRAVITY_NOT_INSTALLED`, `SPAWN_FAILED`, `PARSE_ERROR`, `AGENT_TIMEOUT`)
  - Removed unused `createHash` import and `isWin` variable

- **[Tools] `run_gemini.ts`** — Added `mode` parameter to the tool schema
  - New enum with 11 Antigravity mode values
  - Mode passed through to `runner.runAgent()` calls (including session error retry loop)

- **[Tools] `run_agent.ts`** — Fixed type compatibility for `gemini` runner
  - `gemini` case now uses `antigravityParamsSchema` (strict typing with `mode` enum) instead of `genericParamsSchema`
  - Resolves TypeScript error TS2345 on `genericParamsSchema` assignment

- **[Docs] `provider-config-map.md`** — Unified "Gemini / Antigravity" section
  - Before/after comparison table
  - Environment variables documented (`ANTIGRAVITY_PATH`, `ANTIGRAVITY_AGENT_DIR`)
  - Antigravity mode reference table
  - Usage examples with `run_agent` tool calls

### Fixed

- TypeScript: TS2345 error in `run_agent.ts:172` — `genericParamsSchema` incompatible with `antigravityParamsSchema` for `mode` field
- ESLint: `createHash` unused import removed from `GeminiRunner.ts`
- ESLint: `isWin` unused variable removed from `GeminiRunner.ts`

### Dependencies

- **Removed:** `@google/gemini-cli` (npm package) — replaced by bundled Antigravity IDE CLI

### Notes

- The runner enum value remains `gemini` (not `antigravity`) to maintain backwards compatibility with existing agent configurations
- Antigravity IDE installation is auto-detected; no manual `ANTIGRAVITY_PATH` env var required unless the IDE is installed in a non-default location
- 46 vitest tests passing (3 skipped — optional feature flag tests)