# Changelog

## 1.7.0 (2026-05-07)

### Minor Changes

- Add `cwd` parameter to `run_agent` tool for ClaudeRunner and KiloRunner
- Add `$VAR` environment variable substitution in agent settings (e.g. `$ANTHROPIC_AUTH_TOKEN_2` resolves to actual token value)
- Fix workspace directory resolution for agent settings (`settingsPath` now uses correct directory)
- Add `ANTHROPIC_AUTH_FALLBACK_1/2/3` fields as resolvable references for automatic token retry
- Update documentation with new `cwd` parameter, `$VAR` substitution, and fallback tokens sections

## 1.6.0 (2026-05-07)

- Initial granular token support for npm publish
