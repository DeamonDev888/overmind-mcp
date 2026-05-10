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
- RabbitMQ (Docker)
- Temporal (Docker)
- Prometheus (Docker)
- Grafana (Docker)
- Jaeger (Docker)
- Redis (Docker)
