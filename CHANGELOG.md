# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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