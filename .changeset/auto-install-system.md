---
"overmind-mcp": minor
---
Automated installation system for maximum features via NPM install:
- Added CLI binaries: overmind-setup, overmind-infra
- Automated dependency detection and installation
- Post-install hook guides users through setup
- Scripts: install-dependencies.mjs (Docker + PostgreSQL+pgvector)
- Scripts: setup.mjs (complete automated setup)
- Scripts: docker-manager.mjs (infrastructure management)
- Updated README with Mode Simple vs Mode Avancé
- Docker compose files included in NPM package
- Example configs provided (.gitignore excludes real configs)
