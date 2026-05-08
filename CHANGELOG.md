# Changelog

All notable changes to this project will be documented in this file.

## 1.13.9-alpha (2026-05-08)

### Fixed

- **ClaudeRunner fast-fail on retryable errors**: Le retry n'attendait plus la fermeture complète du processus (slow). Ajout de `triggerRetry()` qui kill immédiatement le processus, clear tous les timers, et relance via `setImmediate`. Flag `earlyExitTriggered` empêche le double-exit.

## 1.13.8-alpha (2026-05-08)

### Fixed

- **ClaudeRunner retry token switch**: Le retry ne changeait pas de token correctement (utilisait encore le primary après 429). Logique corrigée : index 0 = primary, index 1+ = AUTH_FALLBACK_1/2/3 directement.

## 1.13.7-alpha (2026-05-08)

### Changed

- **`config_example` tool**: Documentation complète des fallback tokens (401, 429, 5xx). Exemples clairs avec syntaxe `$ANTHROPIC_AUTH_TOKEN_2`, etc.

## 1.13.6-alpha (2026-05-08)

### Fixed

- **`ClaudeRunner fallback retry`**: Le fallback ne se déclenchait que sur les erreurs 401 (auth). Ajout de la détection des erreurs retryable : 429 (rate limit/quota exhausted), 500/502/503 (server errors) et leurs messages correspondants dans stderr. Les tokens fallback (AUTH_FALLBACK_1/2/3) sont désormais essayés pour toutes ces erreurs.

## 1.13.5-alpha (2026-05-08)

### Fixed

- **`getDetailedConfigs` fallback path**: Les paths de fallback utilisaient `.overmind/agents/` hardcodé au lieu de passer par `getWorkspaceDir()` qui lit `OVERMIND_WORKSPACE`. Maintenant le fallback utilise le workspace dynamiques depuis la variable d'environnement, cohérence avec `listAgents`.

## 1.13.4-alpha (2026-05-08)

### Fixed

- **OOM-1 (vrai)** : le cap stdout/stderr de 10 Mo n'était auparavant présent que dans `OpenClawRunner`. Désormais aussi appliqué dans `ClaudeRunner.ts`, `KiloRunner.ts`, `GeminiRunner.ts` (rotation `slice(-MAX_BUF)` quand l'accumulation dépasserait 10 Mo).
- **ASYNC-3 (vrai)** : `GeminiRunner.ts` reçoit un helper `cleanup()` qui retire les listeners (`removeAllListeners()` sur stdout/stderr/child) et est appelé après timeout et après `close`.

### Changed

- Corrections appliquées en parallèle par 3 agents Minimax (claude runner) via `dispatchAgents()` — preuve de bout en bout du parallélisme local.

## 1.13.3-alpha (2026-05-08)

### Fixed

- **`tools/list` MCP error** : `runAgentSchema` exposait un champ `signal: z.custom<AbortSignal>()` que FastMCP ne pouvait pas sérialiser en JSON Schema (`Custom types cannot be represented in JSON Schema`), ce qui empêchait la découverte des outils côté client MCP. Le champ `signal` est désormais retiré du schéma public et passé en interne via le type `RunAgentInternalArgs`.

## 1.13.2-alpha (2026-05-08)

### Fixed

- **Telemetry no-op span** : `withSpan()` retournait `{} as Span` quand `OTEL_ENABLED!=true`, ce qui plantait dès le premier `span.setAttribute(...)` (`TypeError: span.setAttribute is not a function`) et empêchait `runAgent` de s'exécuter sans OpenTelemetry. Désormais `withSpan()` passe systématiquement par `tracer.startActiveSpan(...)` — l'API OpenTelemetry fournit un `NonRecordingSpan` no-op valide quand le SDK n'est pas démarré.
- **Chargement du `.env` utilisateur** : la binaire installée globalement (`npm i -g overmind-mcp`) ne lisait que son propre `.env` (`<install-dir>/.env`) et ignorait le `.env` du projet (`OVERMIND_WORKSPACE`, etc.). Ajout d'une cascade de chargement : `$OVERMIND_ENV_FILE` → `<process.cwd()>/.env` → fallback historique. Les valeurs déjà présentes dans `process.env` (injectées par le client MCP) restent prioritaires.

## 1.13.1-alpha (2026-05-08)

### Fixed

- **Dispatcher Temporal fallback** : `dispatchAgents()` n'attendait pas la promesse retournée par `dispatchViaTemporal()` (`return` sans `await`), ce qui faisait fuir les rejets asynchrones hors du `try/catch` et provoquait un `uncaughtException` (`Failed to start Workflow`/`ECONNREFUSED ::1:7233`) lorsque Temporal n'était pas joignable. Désormais le fallback local est bien déclenché si Temporal est indisponible.

## 1.13.0-alpha (2026-05-08)

### Recovered

- **Prompt files recovered**: Restored `Claude_code.md`, `Kilo.md`, `Kilo_Hermes.md`, `Minimax4.md` from git history (were deleted in commit 86ca1da).

## 1.12.1-alpha (2026-05-08)

### Changed

- `preferGlobal: true` ajouté dans package.json (CLI tool — recommande install global)

## 1.12.0-alpha.1 (2026-05-08)

### Removed

- Docker infrastructure files (out of scope, users wire their own RabbitMQ/Temporal/Jaeger)
- `infra:up/down/logs` npm scripts

## 1.12.0-alpha (2026-05-08)

### Added

- OpenTelemetry tracing : module `src/lib/telemetry.ts` (init no-op si OTEL_ENABLED!=true), spans sur ClaudeRunner/KiloRunner/GeminiRunner et tools clés
- RabbitMQ broker : `src/lib/broker/rabbitmq.ts` (publisher/consumer queues durables) + `rabbitmqDispatch.ts` + worker `src/bin/rabbitmq-worker.ts`
- Temporal workflow engine : activities/workflows/client/dispatch + worker `src/bin/temporal-worker.ts` (retry x2, timeout 15min)
- Orchestration dispatcher : `src/lib/orchestration/dispatcher.ts` route vers Temporal/RabbitMQ/local selon flags (fallback automatique)
- AbortSignal propagé à ClaudeRunner pour annulation propre
- Scripts npm : `worker:rabbitmq`, `worker:temporal`
- Dépendance `async-mutex` pour sérialisation d'écritures concurrentes

### Fixed

- OOM-1 : stdout/stderr bornés à 10 MB dans ClaudeRunner, KiloRunner, GeminiRunner
- OOM-2 : `run_agents_parallel` mode `waitAll:false` — abort des promesses perdantes via AbortController par agent
- OOM-3 : `metadata` — `depth.max(8)` + skip des fichiers >1 MB
- OOM-4 : OpenClawRunner — SIGTERM→SIGKILL fallback 5s + cleanup listeners + cap stdout/stderr
- ASYNC-1 : ClaudeRunner — détection deconnexion MCP via AbortSignal, kill propre du child process
- ASYNC-2 : KiloRunner — fuite killTimer corrigée (clearTimeout avant retry 401)
- ASYNC-3 : GeminiRunner — helper `cleanup()` retire tous les listeners après timeout/close
- ASYNC-4 : `sessions.ts` — race condition supprimée via `async-mutex` autour des read-modify-write

### Changed

- `run_agents_parallel.ts` simplifié (38 lignes) — délègue toute la logique au dispatcher
- Workers de tests validés : `tests/feature_flags.test.ts` (3 tests passants)

## 0.0.2-alpha (2026-05-08)

### Fixes

- **OVERMIND_WORKSPACE protection**: Fixed auto-injection in cli.ts that was overwriting `OVERMIND_WORKSPACE` on every boot. Now preserves existing value if already set.

### Maintenance

- **Overmind MCP cleanup**: Removed duplicate `overmind-mcp` from root `node_modules` — now uses only the Workflow repo instance.
- **Lint fix**: Installed missing `tinyglobby` dependency.

## 0.0.0.1a (2026-05-07)

### Alpha Release — Versioning Switch

- **Switch to alpha versioning**: Abandoned semantic versioning (`1.x.0`) in favor of alpha format (`0.0.0.1a`)
- **Fix 401 detection in JSON result**: Claude CLI can exit with code 0 while embedding `api_error_status: 401` in the JSON response. Retry now triggers on both stderr patterns AND `jsonEnvelope.api_error_status === 401` AND auth error strings in `result` field.
- **KiloRunner 401 fallback retry**: Same automatic retry logic as ClaudeRunner — `AUTH_FALLBACK_1` → `AUTH_FALLBACK_2` → `AUTH_FALLBACK_3`
- **New `overmind` provider in `config_example` tool**: Complete guide on `$VAR` substitution and fallback token system with examples for both ClaudeRunner and KiloRunner

## 1.11.0 (2026-05-07)

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
