# 🐳 Docker Configuration

Ce dossier contient les fichiers de configuration Docker pour OverMind MCP.

## 📜 Fichiers

- **docker-compose.yml** - Stack principale avec tous les services

## 🚀 Services inclus

### Base de données
- **PostgreSQL + pgvector** : Base de données vectorielle pour la mémoire sémantique

### Message Queue
- **RabbitMQ** : Gestionnaire de files de messages pour les workflows

### Orchestration
- **Temporal** : Orchestrateur de workflows durables

### Observabilité
- **Prometheus** : Collection de métriques
- **Grafana** : Dashboard de visualisation
- **Jaeger** : Tracing distribué

### Cache
- **Redis** : Cache et sessions

### Exporters
- **Node Exporter** : Métriques système

## 🚀 Utilisation

### Démarrer tous les services
```bash
cd docker
docker-compose up -d
```

### Voir l'état des services
```bash
cd docker
docker-compose ps
```

### Voir les logs
```bash
# Tous les services
cd docker
docker-compose logs -f

# Service spécifique
cd docker
docker-compose logs -f postgres
```

### Arrêter tous les services
```bash
cd docker
docker-compose down
```

### Arrêter et supprimer les volumes
```bash
cd docker
docker-compose down -v
```

## 🔧 Ports utilisés

| Service | Port | Usage |
|---------|------|-------|
| PostgreSQL | 5432 | Base de données |
| RabbitMQ | 5672, 15672 | Message Queue |
| Temporal | 7233, 8233 | Workflows |
| Prometheus | 9090 | Métriques |
| Grafana | 3000 | Dashboards |
| Jaeger | 16686 | Tracing |
| Redis | 6379 | Cache |

## 📊 Accès Web

- **RabbitMQ Management** : http://localhost:15672 (guest/guest)
- **Grafana** : http://localhost:3000 (admin/admin)
- **Prometheus** : http://localhost:9090
- **Jaeger** : http://localhost:16686
- **Temporal Web UI** : http://localhost:8233
