# 🚀 Installation Rapide OverMind-MCP

Guide d'installation complète en 2 minutes avec **toutes les features activées** (Swarm, Workflows, Observabilité).

## 🎯 Installation en 1 Clic

### Windows (Docker Desktop)
```batch
# Télécharger et exécuter
curl -o install-overmind-windows.bat https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/install-overmind-windows.bat
install-overmind-windows.bat
```

### Linux/macOS
```bash
# Télécharger et exécuter
curl -O https://raw.githubusercontent.com/DeamonDev888/overmind-mcp/main/install-overmind-unix.sh
chmod +x install-overmind-unix.sh
./install-overmind-unix.sh
```

## ✅ Ce que le script installe

### 1. **OverMind-MCP** (Package NPM)
- Installation globale : `npm install -g overmind-mcp@latest`
- Disponible partout dans le système

### 2. **PostgreSQL + pgvector** (Vector DB)
- Container Docker `overmind-postgres-pgvector`
- Port 5432
- Extension vector 4096D activée
- **Détection automatique** : Ne réinstalle pas si déjà présent

### 3. **Infrastructure Complète** (Docker Compose)
Le script télécharge et lance :

| Service | Port | URL | Login |
|---------|------|-----|-------|
| **RabbitMQ** | 5672, 15672 | http://localhost:15672 | guest/guest |
| **Temporal** | 7233, 8233 | http://localhost:8233 | - |
| **Prometheus** | 9090 | http://localhost:9090 | - |
| **Grafana** | 3000 | http://localhost:3000 | admin/admin |
| **Jaeger** | 16686 | http://localhost:16686 | - |
| **Redis** | 6379 | - | - |
| **Node Exporter** | 9100 | - | - |

## 🔍 Validation Automatique

Le script vérifie **chaque service** et affiche :

```
🧪 Tests de connexion...
   • PostgreSQL:      ✅ Actif
   • RabbitMQ:        ✅ Actif
   • Temporal:         ✅ Actif
   • Prometheus:       ✅ Actif
   • Grafana:          ✅ Actif
   • Jaeger:           ✅ Actif
```

## 📱 Voir dans Docker Desktop

Après installation, ouvrez **Docker Desktop** :

1. Onglet **Containers**
2. Vous verrez tous les services OverMind :
   ```
   overmind-postgres-pgvector     (Running)
   overmind-rabbitmq               (Running)
   overmind-temporal               (Running)
   overmind-prometheus            (Running)
   overmind-grafana               (Running)
   overmind-jaeger                (Running)
   overmind-redis                 (Running)
   overmind-node-exporter          (Running)
   ```

3. Cliquez sur chaque container pour voir :
   - Logs en temps réel
   - Métriques (CPU, RAM, Réseau)
   - Variables d'environnement

## 🧪 Tester l'Installation

### Vérifier PostgreSQL
```bash
docker exec overmind-postgres-pgvector psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
```
Doit retourner : `vector`

### Vérifier RabbitMQ
Ouvrez : http://localhost:15672 (guest/guest)

### Vérifier Prometheus
Ouvrez : http://localhost:9090 → Cliquez "Status" → "Targets"

### Vérifier Grafana
Ouvrez : http://localhost:3000
- Login : `admin`
- Password : `admin`
- Dashboards → Import → Importer depuis `config/grafana/`

## 🔧 Configuration

Le script crée `~/.overmind/.env` (ou `%USERPROFILE%\.overmind\.env` sur Windows) :

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=overmind_temp_password_change_me
POSTGRES_DB=overmind

# OpenTelemetry (optionnel)
OTEL_ENABLED=false

# Workspace
OVERMIND_WORKSPACE=~/.overmind
```

## 📚 Documentation Complète

Après installation, consultez :

- **GitHub** : https://github.com/DeamonDev888/overmind-mcp
- **NPM** : https://www.npmjs.com/package/overmind-mcp
- **Docs** : `~/.overmind/docs/` (inclus dans le package)

## 🆘 Support

En cas de problème :

1. **Vérifier Docker Desktop** : Doit être lancé
2. **Vérifier les ports** : Aucun autre service ne doit utiliser 5432, 9090, 3000, etc.
3. **Logs Docker** : Ouvrir Docker Desktop → Container → Logs
4. **Issue GitHub** : https://github.com/DeamonDev888/overmind-mcp/issues

---

**Installation testée sur :**
- ✅ Windows 11 + Docker Desktop
- ✅ macOS (Intel + Apple Silicon)
- ✅ Linux (Ubuntu, Debian)
