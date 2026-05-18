# ⚙️ Configuration MCP OverMind

Ce dossier contient les fichiers de configuration MCP pour OverMind.

## 📜 Fichiers

- **mcp-config.json** - Configuration optimale pour installation globale npm
- **.mcp.json.example** - Exemple de configuration à la racine du projet

## 🚀 Modes d'utilisation

### Mode 1 : HTTP Singleton (Recommandé)

Les serveurs MCP tournent en HTTP sur des ports dédiés. Plus de node.exe par agent = plus de zombies.

```json
{
  "mcpServers": {
    "overmind": {
      "transport": "http-stream",
      "url": "http://localhost:3099"
    },
    "memory": {
      "transport": "http-stream",
      "url": "http://localhost:3099"
    },
    "postgresql": {
      "transport": "http-stream",
      "url": "http://localhost:5433"
    }
  }
}
```

**Ports par défaut :**
| Serveur | Port |
|---------|------|
| Overmind | 3099 |
| PostgreSQL | 5433 |
| Discord | 3141 |
| X | 3142 |
| Debats | 3100 |

### Mode 2 : Développement local (stdio)

Depuis le dossier du projet avec `npm link` ou `pnpm install` :

```json
{
  "mcpServers": {
    "overmind": {
      "command": "node",
      "args": ["./dist/bin/cli.js", "--transport", "http-stream", "--port", "3099"]
    }
  }
}
```

**Note :** Nécessite que le projet soit compilé (`npm run build`)

## 🔌 Serveurs MCP Disponibles

### overmind (port 3099)
- **run_agent** : Exécuter un agent IA
- **create_agent** : Créer un nouvel agent
- **list_agents** : Lister les agents
- **get_agent_configs** : Voir configuration d'un agent
- **update_agent_config** : Modifier un agent
- **delete_agent** : Supprimer un agent
- **memory_search** : Rechercher dans la mémoire
- **memory_store** : Stocker dans la mémoire
- **memory_runs** : Voir l'historique des runs

### memory (port 3099, scope limité)
- **memory_search** : Recherche sémantique
- **memory_store** : Stockage de connaissances
- **memory_runs** : Voir l'historique des runs

### postgresql (port 5433)
- **MCP_PG_VECTOR** : Exécution SQL directe
- **intelligent_search** : Recherche hybride texte + vecteur
- **manage_vectors** : Gestion des vecteurs
- **pgvector_stats** : Statistiques vectorielles

### discord (port 3141)
- Outils Discord (members, roles, channels, embeds, interactions...)

### x (port 3142)
- Outils X/Twitter (scraping, publication...)

### debats (port 3100)
- Outils débats et analyse

## 🛡️ Anti-Zombie Architecture

L'ancien problème : chaque agent spawn son propre node.exe MCP server → zombies.

La solution : 1 seul serveur HTTP par service, partagé par tous les agents.

```
Agent 1 ──┐
Agent 2 ──┼──→ Overmind:3099 (1 process)
Agent 3 ──┘
```

Plus de node.exe par agent = plus de zombies.

## ⚠️ Dépannage

### "Failed to connect to host"
→ Le serveur HTTP n'est pas démarré. Lancez la commande de démarrage correspondante.

### Erreur de permission
```bash
# Sous Linux/macOS, utiliser sudo
sudo npm install -g overmind-mcp
```

## 📚 Documentation complémentaire

- **README principal** : `../README.md`
- **Installation** : `../INSTALL.md`
- **API Reference** : `../docs/api/`
- ** Guides** : `../docs/guides/`