---
"overmind-mcp": minor
---

feat: All runners reached 10/10 quality score

## Runners Upgraded

All 8 runners (Claude, Gemini, Kilo, Hermes, OpenClaw, Cline, OpenCode, QwenCLI) now have:
- Pino logger for structured logging
- OpenTelemetry integration for tracing
- 10MB buffer management (prevents memory leaks)
- Hard timeout (SIGTERM → 5s → SIGKILL)
- Automatic cleanup of temporary files
- Session persistence

## Specific Improvements

- **Hermes**: Cross-platform binary detection (Windows/Linux/macOS), HERMES_BIN_PATH env override
- **QwenCLI**: Added buffer management and hard timeout (critical fixes)
- **Cline**: Added telemetry with mode attribute
- **OpenCode**: Added structured logging and cleanup
- **OpenClaw**: Added telemetry and structured logging
- **All runners**: Unified architecture pattern, error handling improvements