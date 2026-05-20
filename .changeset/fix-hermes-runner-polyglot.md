---
"overmind-mcp": patch
---

fix(NousHermesRunner): aligner Hermes avec les autres runners (Claude, Kilo)

Changements NousHermesRunner:
- runAgentWrapper inlined dans runAgent (cleanup pattern utilisé par les autres runners)
- linkSessionToPid ajouté après spawn (manquait par rapport à ClaudeRunner/KiloRunner)
- fallbackUsed ajouté dans RunAgentResult (4 safeResolve mis à jour)
- killProcessTree gardé localement (signature incompatible avec processRegistry: ChildProcess vs number)

Changements config:
- CONFIG.HERMES.PATHS.SETTINGS: .hermes/settings.json → .claude/settings.json
- CONFIG.HERMES.DEFAULT_MODEL: 'MiniMax-M2.7' ajouté

Changements config_example:
- 'hermes' ajouté au provider enum
- documentation case 'hermes' avec explication .claude/, agent PromptManager, MCP config, HERMES_DIR isolation
