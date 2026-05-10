# 🔗 PostgreSQL Integration Guide

Guide complet pour intégrer et utiliser PostgreSQL avec l'extension pgvector dans OverMind MCP.

## 📋 Table des matières

- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation](#utilisation)
- [Performance](#performance)
- [Dépannage](#dépannage)

## 🚀 Installation

### Via Docker (Recommandé)

L'installation automatique est gérée par les scripts d'installation :

```bash
# Windows
bin/install-overmind-windows.bat

# Linux/macOS
bin/install-overmind-unix.sh
```

Le script crée automatiquement :
- Container Docker `overmind-postgres-pgvector`
- Extension pgvector (4096 dimensions)
- Base de données `overmind_memory`
- Tables et index nécessaires

### Manuelle

Si vous préférez installer PostgreSQL manuellement :

```bash
# Installer PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Installer l'extension pgvector
# Suivre les instructions sur : https://github.com/pgvector/pgvector
```

## ⚙️ Configuration

### Variables d'environnement

Créer ou modifier `.env` :

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=overmind_memory

# OverMind Memory (optionnel)
OVERMIND_MEMORY_TYPE=postgres
```

### Vérification

Tester la connexion :

```bash
docker exec overmind-postgres-pgvector psql -U postgres -c "SELECT extname FROM pg_extension WHERE extname = 'vector';"
```

Doit retourner : `vector`

## 🎯 Utilisation

### Avec OverMind MCP

Les outils MCP suivants utilisent PostgreSQL :

#### 1. **memory_search** - Recherche sémantique
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory_search",
    "arguments": {
      "query": "agents IA performants",
      "agentName": "my_agent",
      "limit": 5
    }
  }
}
```

#### 2. **memory_store** - Stocker des connaissances
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory_store",
    "arguments": {
      "text": "Les agents GLM-5.1 sont très performants",
      "source": "user"
    }
  }
}
```

#### 3. **MCP_PG_VECTOR** - Requêtes SQL directes
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "MCP_PG_VECTOR",
    "arguments": {
      "sql": "SELECT * FROM agents_metadata LIMIT 10"
    }
  }
}
```

### Via CLI OverMind

```bash
# Rechercher dans la mémoire
overmind memory_search "agents performants" --agent my_agent

# Stocker une information
overmind memory_store "Nouveau conseil de test" --source user

# Voir les statistiques
overmind pgvector_stats --table embeddings
```

## 📊 Performance

### Recherche vectorielle

#### Spécifications
- **Dimensions** : 4096 (Qwen 8B embeddings)
- **Index** : HNSW (Hierarchical Navigable Small World)
- **Distance** : Cosine similarity

#### Benchmark

```bash
# Test de performance
overmind intelligent_search "test query" --table embeddings --topK 10
```

### Optimisations

1. **Index HNSW** - Recherche approximative ultra-rapide
2. **Cache embeddings** - Réduit les calculs répétitifs
3. **Recherche hybride** - Combine texte et vecteur pour meilleurs résultats

## 🔧 Dépannage

### Problèmes courants

#### Erreur "extension vector does not exist"
```bash
# Créer l'extension
docker exec overmind-postgres-pgvector psql -U postgres -c "CREATE EXTENSION vector;"
```

#### Erreur "connection refused"
```bash
# Vérifier que PostgreSQL tourne
docker ps | grep overmind-postgres

# Vérifier les ports
netstat -an | grep 5432
```

#### Performance lente
```bash
# Vérifier les statistiques
overmind pgvector_stats --table embeddings

# Recréer les index si nécessaire
overmind manage_vectors --action optimize --table embeddings
```

## 📚 Documentation avancée

### Schéma de la base

```sql
-- Tables principales
agents_metadata      -- Métadonnées des agents
conversations          -- Historique des conversations
embeddings            -- Vecteurs pour recherche sémantique
agent_knowledge       -- Connaissances des agents
```

### Recherche hybride

Combiner recherche textuelle et vectorielle :

```sql
SELECT
    id,
    content,
    embedding <=> '[...]' AS vector_distance,
    ts_rank(content_fts, query) AS text_rank
FROM embeddings
WHERE content_fts @@ query
ORDER BY vector_distance ASC
LIMIT 10;
```

## 🚀 Bonnes pratiques

1. **Backup régulier** : `docker exec overmind-postgres pg_dump -U postgres overmind_memory > backup.sql`
2. **Monitoring** : Utiliser Grafana dashboard pour surveiller les performances
3. **Maintenance** : `overmind manage_vectors --action optimize --table embeddings` hebdomadairement

---

**Pour plus d'informations** :
- Guide principal : `../README.md`
- Docker : `../docker/README.md`
- Scripts DB : `../db/README.md`
