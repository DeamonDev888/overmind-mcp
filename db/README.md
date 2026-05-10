# 🗄️ Database Scripts

Ce dossier contient les scripts SQL pour l'initialisation et la maintenance de la base de données OverMind.

## 📜 Fichiers

- **init-db.sql** - Script d'initialisation de base
- **init-overmind-db.sql** - Script complet d'initialisation OverMind

## 🚀 Utilisation

### Initialisation manuelle

```bash
# Avec Docker
docker exec -i overmind-postgres-pgvector psql -U postgres < db/init-overmind-db.sql

# Sans Docker
psql -U postgres -h localhost -p 5432 < db/init-overmind-db.sql
```

### Via Docker Compose

Les scripts sont automatiquement exécutés lors du premier démarrage du conteneur PostgreSQL via `docker-compose up -d`.

## 📋 Contenu

### Tables créées
- **agents_metadata** : Métadonnées des agents
- **conversations** : Historique des conversations
- **embeddings** : Vecteurs pour la recherche sémantique

### Extensions
- **pgvector** : Extension vectorielle (4096 dimensions)
- **pg_trgm** : Trigram matching pour la recherche textuelle

### Index
- Index vectoriels (HNSW) pour les embeddings
- Index textuels pour les recherches full-text
- Index composites pour les requêtes hybrides

## 🔧 Maintenance

### Backup
```bash
# Via Docker Compose
cd docker
docker-compose exec postgres pg_dump -U postgres overmind_memory > backup.sql
```

### Restore
```bash
# Via Docker Compose
cd docker
docker-compose exec -T postgres psql -U postgres overmind_memory < backup.sql
```

### Vider la base
```bash
# ⚠️ Attention : cela supprime toutes les données
cd docker
docker-compose exec postgres psql -U postgres -c "DROP DATABASE IF EXISTS overmind_memory;"
docker-compose exec postgres psql -U postgres -c "CREATE DATABASE overmind_memory;"
docker-compose exec -i overmind-postgres-pgvector psql -U postgres overmind_memory < db/init-overmind-db.sql
```

## 📊 Performance

### Recherche vectorielle
- **Dimensions** : 4096 (Qwen 8B embeddings)
- **Index** : HNSW (Hierarchical Navigable Small World)
- **Distance** : Cosine similarity

### Recherche hybride
- **Textuel** : Full-text search avec trigram
- **Vectoriel** : Semantic search avec embeddings
- **Combiné** : RRF (Reciprocal Rank Fusion)
