---
"overmind-mcp": minor
---

feat: restore agent_control tool with full process lifecycle management

- Restore `agent_control` tool (status/stream/kill/wait actions) from npm package
- Restore `processRegistry.ts` for PID↔session↔agent tracking with mutex-based concurrency
- Add processRegistry integration to all runners: Claude, Gemini, Kilo, Qwen, Cline, OpenClaw, OpenCode, Trae
- Register process on spawn, append output on stdout data, update status on close
- Fix unit test mocks for async-mutex Mutex class and child_process exec
- Add agent_control tool to server.ts with full Zod schema