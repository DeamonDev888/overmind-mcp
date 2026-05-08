# Changelog

All notable changes to this project will be documented in this file.

## 1.11.0 (2026-05-07)

### Patch Changes

- **Fix 401 detection in JSON result**: Claude CLI can exit with code 0 while embedding `api_error_status: 401` in the JSON response. Retry now triggers on both stderr patterns AND `jsonEnvelope.api_error_status === 401` AND auth error strings in `result` field.

## 1.9.0 (2026-05-07)

### Minor Changes

- **KiloRunner 401 fallback retry**: Same automatic retry logic as ClaudeRunner — `AUTH_FALLBACK_1` → `AUTH_FALLBACK_2` → `AUTH_FALLBACK_3`
- **New `overmind` provider in `config_example` tool**: Complete guide on `$VAR` substitution and fallback token system with examples for both ClaudeRunner and KiloRunner

## 1.8.0 (2026-05-07)

### Minor Changes

- **Automatic 401 retry with fallback tokens**: Overmind now detects auth errors (401) from Claude CLI and automatically retries with `AUTH_FALLBACK_1` → `AUTH_FALLBACK_2` → `AUTH_FALLBACK_3` tokens
- Detection covers: `401`, `unauthorized`, `invalid api key`, `authentication failed`, `auth error`
- Each fallback token is resolved via `$VAR` substitution from `.env`

## 1.7.0 (2026-05-07)

### Minor Changes

- Add `cwd` parameter to `run_agent` tool for ClaudeRunner and KiloRunner
- Add `$VAR` environment variable substitution in agent settings (e.g. `$ANTHROPIC_AUTH_TOKEN_2` resolves to actual token value)
- Fix workspace directory resolution for agent settings (`settingsPath` now uses correct directory)
- Add `ANTHROPIC_AUTH_FALLBACK_1/2/3` fields as resolvable references for automatic token retry
- Update documentation with new `cwd` parameter, `$VAR` substitution, and fallback tokens sections

## 1.6.0 (2026-05-07)

- Initial granular token support for npm publish

## 1.5.11 (2026-05-06)

- Security: lint warnings cleanup and removal of hardcoded API keys from scratch/test.js

## 1.5.10 (2026-05-03)

- Adjust Minimax fleet to 3 agents and update documentation
- Integration of 4 Minimax agents with ClaudeRunner

## 1.5.9 (2026-04-26)

- Fix Hermes runner ENOENT error on Windows and improve runner robustness
- Add envUtils interpolation and improve session handling

## 1.5.8 (2026-04-26)

- Improve Kilo runner for polyglot agents
- Enhance CLI tester with dual-mode support

## 1.5.7 (2026-04-26)

- Expand Mistral fleet to 6 parallel agents
- Add Kilo Parallel orchestrator documentation

## 1.5.6 (2026-04-25)

- Implement DeepSeek V4 Pro default, NVIDIA fallback
- Update docs site

## 1.5.5 (2026-04-25)

- Convert Kilo & Hermes mode to Hermes Solo in prompts and documentation

## 1.5.3 (2026-04-25)

- Full 1:1 sync across all markdown files and frontend

## 1.5.2 (2026-04-25)

- Restore grandiose header and implement full markdown rendering

## 1.5.1 (2026-04-25)

- Full premium redesign of all engine sections
- Add real runner logic and CLI pipelines extracted from source code

## 1.5.0 (2026-04-25)

- Grandiose dashboard upgrade with SVG architectures and live metrics
- Orchestrator prompts: expand mission to include agent creation and supervision
- Authorize agent to proactively create and edit agents
- Authorize proactive use of `list_agents` and `get_agent_configs`

## 1.4.7 (2026-04-19)

- Bump pnpm dependencies

## 1.4.3 (2026-04-06)

- Add additional anonymized MCP examples (memory, X) to config_example

## 1.4.2 (2026-04-06)

- Security: anonymize local paths in config_example examples

## 1.4.1 (2026-04-06)

- Enhance config_example tool with MCP examples and naming conventions

## 1.4.0 (2026-04-06)

- Standardize agent configuration
- Add `config_example` tool
- Security: redact API tokens in examples
