# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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