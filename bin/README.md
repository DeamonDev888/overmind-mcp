# 📦 Installation Scripts

Ce dossier contient les scripts d'installation d'OverMind MCP.

## 📜 Fichiers

- **install-overmind-unix.sh** - Script d'installation pour Linux/macOS
- **install-overmind-windows.bat** - Script d'installation pour Windows

## 🚀 Utilisation

### Windows
```batch
cd bin
install-overmind-windows.bat
```

### Linux/macOS
```bash
cd bin
chmod +x install-overmind-unix.sh
./install-overmind-unix.sh
```

## 📋 Ce qui est installé

- OverMind MCP (NPM package)
- PostgreSQL + pgvector (Docker)
- Prometheus (Docker)
- Grafana (Docker)
- Jaeger (Docker)

## 🅾️ Démarrage des Serveurs HTTP

Après installation, lancez les serveurs MCP sur les ports suivants :

| Serveur | Port | Commande |
|---------|------|----------|
| Overmind (complet) | 3099 | `node dist/bin/cli.js --transport http-stream --port 3099` |
| Overmind (memory) | 3099 | `node dist/bin/cli.js --memory-tools-only --transport http-stream --port 3099` |
| PostgreSQL | 5433 | `FORCE_COLOR=0 FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=5433 node dist/index.js` |
| Discord | 3141 | `FORCE_COLOR=0 FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=3141 node dist/index.js` |
| X | 3142 | `FORCE_COLOR=0 FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=3142 node dist/src/server.js` |
| Debats | 3100 | `FORCE_COLOR=0 FASTMCP_TRANSPORT=httpStream FASTMCP_PORT=3100 node dist/index.js` |