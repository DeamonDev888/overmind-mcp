---
"overmind-mcp": patch
---

fix: ClaudeRunner fallback retry now properly kills process tree on Windows

## Problem
When a Claude API request returned 401/429/5xx, the fallback retry mechanism
failed because `child.kill()` only terminated the `cmd.exe` wrapper on Windows,
leaving the actual `claude.exe` process orphaned. This orphaned process kept
the provider session bound to the original token, so retrying with a fallback
token resulted in the same 429 error.

## Solution
- Added `killProcessTree()` helper that uses `taskkill /F /T /PID` on Windows
  to recursively kill the entire process tree (cmd.exe → claude.exe).
- On Unix, uses SIGTERM with 2s fallback to SIGKILL.
- `triggerRetry()` now awaits the process tree kill before respawning.
- Removed the `--resume` strip on fallback retry — new process resumes the
  same session with a different token (as intended).
- Re-enabled `FALLBACK_RETRY_ENABLED = true`.

## Impact
- Fallback tokens (AUTH_FALLBACK_1/2/3) now rotate correctly when quota is
  exhausted.
- No more orphaned `claude.exe` processes on Windows.
- Hard timeout and AbortSignal handlers also use `killProcessTree()` for
  consistent cleanup.

## Files Changed
- `Workflow/src/services/ClaudeRunner.ts`: Added `killProcessTree()`, async
  `triggerRetry()`, re-enabled fallback retry.
