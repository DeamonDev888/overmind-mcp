# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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