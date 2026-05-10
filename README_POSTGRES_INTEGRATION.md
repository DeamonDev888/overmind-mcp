# 🚀 Intégration OverMind-MCP + PostgreSQL Vectoriel

## 📋 Vue d'ensemble

OverMind-MCP installe automatiquement **PostgreSQL + pgvector** et le serveur **overmind-postgres-mcp** pour une intégration parfaite avec la mémoire vectorielle.

## 🎯 Ce qui est installé automatiquement

### 1. **PostgreSQL + pgvector (Docker)**
- Image: `pgvector/pgvector:pg16`
- Container: `overmind-postgres-pgvector`
- Port: `5432`
- Extension: `vector (4096D)`
- Database: `overmind_memory`

### 2. **overmind-postgres-mcp (Package NPM)**
- Serveur MCP PostgreSQL optimisé pour OverMind
- Compatible avec les embeddings 4096D (Qwen, Claude, etc.)
- Recherche sémantique vectorielle
- Gestion automatique des mémoires

### 3. **Fichiers de configuration**
- `~/.overmind/.env` - Configuration OverMind
- `~/.overmind/.env.postgres` - Configuration PostgreSQL MCP
- `~/.overmind/.mcp.json` - Configuration serveurs MCP

## 🔧 Installation automatique

```bash
# Installation complète
npm install -g overmind-mcp

# Le script installe automatiquement:
# ✅ Docker (vérification)
# ✅ PostgreSQL + pgvector (container Docker)
# ✅ overmind-postgres-mcp (package NPM)
# ✅ Fichiers de configuration
# ✅ Base de données overmind_memory initialisée
```

## 🎮 Gestion PostgreSQL

```bash
# Démarrer PostgreSQL
overmind-postgres up

# Vérifier l'état
overmind-postgres status

# Voir les logs
overmind-postgres logs

# Arrêter PostgreSQL
overmind-postgres down

# Réinitialiser (⚠️ supprime les données)
overmind-postgres reset --confirm
```

## 📊 Connexions PostgreSQL

```
Host: localhost:5432
Database: overmind_memory
User: postgres
Password: overmind_temp_password_change_me (À CHANGER !)
Extension: vector (4096D)
```

## 🔌 Serveurs MCP disponibles

Les serveurs MCP suivants sont automatiquement configurés dans `.mcp.json`:

```json
{
  "mcpServers": {
    "overmind": {
      "command": "node",
      "args": ["./dist/bin/cli.js"]
    },
    "memory": {
      "command": "node", 
      "args": ["./dist/bin/cli.js", "--memory-only"]
    },
    "overmind-postgres": {
      "command": "overmind-postgres-mcp"
    }
  }
}
```

## 🧪 Utilisation

```bash
# Créer un agent OverMind
overmind create-agent --name test --runner claude

# Lister les agents
overmind list-agents

# Utiliser la mémoire vectorielle
overmind memory-store "Ceci est un test" --type user

# Rechercher dans la mémoire
overmind memory-search "test"
```

## 📈 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OverMind-MCP                        │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Agents IA (Claude, Gemini, etc.)      │ │
│  └────────────────────────────────────────────────────┘ │
│                         ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │         overmind-postgres-mcp (Serveur MCP)        │ │
│  │  • Recherche sémantique vectorielle               │ │
│  │  • Gestion mémoires 4096D                         │ │
│  │  • Index IVFFlat optimisé                         │ │
│  └────────────────────────────────────────────────────┘ │
│                         ↓                               │
│  ┌────────────────────────────────────────────────────┐ │
│  │       PostgreSQL + pgvector (Docker)               │ │
│  │  • Base: overmind_memory                           │ │
│  │  • Tables: agents, memories, sessions             │ │
│  │  • Extension: vector (4096D)                       │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## 🔐 Sécurité

**IMPORTANT: Changez le mot de passe par défaut !**

1. Éditez `~/.overmind/.env`
2. Modifiez `POSTGRES_PASSWORD=your_secure_password`
3. Éditez `~/.overmind/.env.postgres`
4. Modifiez `POSTGRES_PASSWORD=your_secure_password`
5. Redémarrez: `overmind-postgres down && overmind-postgres up`

## 📚 Documentation

- **OverMind-MCP**: https://github.com/DeamonDev888/overmind-mcp
- **PostgreSQL MCP**: https://github.com/DeamonDev888/PostgreSQL-MCP-Serveur
- **NPM Package**: https://www.npmjs.com/package/overmind-mcp

## 🆘 Support

Pour toute question ou problème:
- GitHub Issues: https://github.com/DeamonDev888/overmind-mcp/issues
- Discord: https://discord.gg/4AR82phtBz

## ⚡ Performance

L'intégration est optimisée pour:
- **Recherche sémantique** ultra-rapide avec index IVFFlat
- **Embeddings 4096D** pour Qwen, Claude, etc.
- **Pool de connexions** optimisé (2-10)
- **Logging** performant (max 10MB par fichier)
- **Health check** automatique toutes les 10s

## 🎉 Avantages

✅ **Installation automatique** - Uniquement `npm install -g overmind-mcp`
✅ **Configuration parfaite** - Fichiers .env générés automatiquement
✅ **Performance optimale** - Index vectoriel et connexions optimisées
✅ **Gestion simplifiée** - Commandes `overmind-postgres` intuitives
✅ **Intégration native** - overmind-postgres-mcp installé automatiquement
✅ **Mémoire vectorielle** - Support 4096D pour embeddings modernes
