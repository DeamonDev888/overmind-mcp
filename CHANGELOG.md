# overmind-mcp v2.1.1 - 2026-05-09

## 🐛 Fixes
- Fixed OTEL collector configuration (missing file causes restart loop)
- Disabled Temporal service (requires complex DB initialization)
- Fixed PostgreSQL initialization script with all tables (memory, agents, runs)
- Updated installation scripts to create all required config files
- Fixed init-db.sql mount issue in installation scripts

## ✨ Improvements
- Installation scripts now create: OTEL config, Prometheus config, Grafana datasources
- All 7 services start successfully: PostgreSQL, RabbitMQ, Redis, Prometheus, Grafana, Jaeger, OTEL Collector
- Better error handling and validation in installation scripts

## 📝 Installation
- Just run: npm install -g overmind-mcp@latest
- All Docker infrastructure starts automatically
- Open Docker Desktop to see all 7 services running
