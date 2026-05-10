---
"overmind-mcp": patch
---

## v2.3.2 - Fix Lint Errors & Dependency Updates

### Fixed Lint Errors
- `dispatcher.ts`: Refactored to use `const` inline in each branch (no-useless-assignment)
- `MemoryFactory.ts`: Fixed `preserve-caught-error` - using `error` directly as cause
- `PostgresMemoryProvider.ts`: Added `{ cause: err }` to thrown error
- `AgentManager.ts`: Fixed `preserve-caught-error` - using `_e` as cause
- `ClaudeRunner.ts`: Simplified to use inline `const` declarations
- `vector_only_lock.test.ts`: Added `{ cause: err }` to thrown error

### Dependency Updates
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