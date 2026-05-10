# ⚙️ Configuration MCP OverMind

Ce dossier contient les fichiers de configuration MCP pour OverMind.

## 📜 Fichiers

- **mcp-config.json** - Configuration optimale pour installation globale npm
- **.mcp.json.example** - Exemple de configuration à la racine du projet

## 🚀 Modes d'utilisation

### Mode 1 : Installation globale npm (Recommandé)

Après `npm install -g overmind-mcp`, utilisez cette configuration :

```json
{
  "mcpServers": {
    "overmind": {
      "command": "overmind"
    }
  }
}
```

**Avantages :**
- ✅ Aucun chemin à spécifier
- ✅ Binaires disponibles partout dans le système
- ✅ Mises à jour automatiques avec `npm update -g overmind-mcp`

### Mode 2 : Développement local

Depuis le dossier du projet avec `npm link` ou `pnpm install` :

```json
{
  "mcpServers": {
    "overmind": {
      "command": "node",
      "args": ["./Workflow/dist/bin/cli.js"]
    }
  }
}
```

**Note :** Nécessite que le projet soit compilé (`npm run build`)

### Mode 3 : Avec le serveur PostgreSQL intégré

```json
{
  "mcpServers": {
    "overmind-postgres": {
      "command": "overmind-postgres-mcp"
    }
  }
}
```

## 🔧 Configuration complète

```json
{
  "mcpServers": {
    "overmind": {
      "command": "overmind",
      "description": "OverMind-MCP principal - Orchestration d'agents IA"
    },
    "memory": {
      "command": "overmind",
      "args": ["--memory-only"],
      "description": "OverMind-MCP mémoire - Gestion mémoire vectorielle"
    },
    "overmind-postgres": {
      "command": "overmind-postgres-mcp",
      "description": "OverMind-PostgreSQL-MCP - Serveur PostgreSQL vectoriel"
    }
  }
}
```

## 📖 Outils disponibles

### overmind (Principal)
- **run_agent** : Exécuter un agent IA
- **create_agent** : Créer un nouvel agent
- **list_agents** : Lister les agents
- **get_agent_configs** : Voir configuration d'un agent
- **update_agent_config** : Modifier un agent
- **delete_agent** : Supprimer un agent
- **memory_search** : Rechercher dans la mémoire
- **memory_store** : Stocker dans la mémoire
- **memory_runs** : Voir l'historique des runs

### memory (Mode mémoire uniquement)
- **memory_search** : Recherche sémantique
- **memory_store** : Stockage de connaissances
- **vectorize_row** : Vectoriser une ligne

### overmind-postgres (Base de données)
- **MCP_PG_VECTOR** : Exécution SQL directe
- **intelligent_search** : Recherche hybride texte + vecteur
- **manage_vectors** : Gestion des vecteurs
- **pgvector_stats** : Statistiques vectorielles

## 🔍 Validation

Pour vérifier que la configuration fonctionne :

```bash
# Tester la commande overmind
overmind --version

# Lister les outils MCP disponibles
# Via votre client MCP ou : 
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | overmind
```

## ⚠️ Dépannage

### Commande 'overmind' non trouvée
```bash
# Vérifier l'installation
npm list -g overmind-mcp

# Réinstaller
npm install -g overmind-mcp@latest
```

### Erreur de permission
```bash
# Sous Linux/macOS, utiliser sudo
sudo npm install -g overmind-mcp
```

### Binaires non dans le PATH
```bash
# Ajouter le npm global bin au PATH
export PATH=$(npm prefix -g)/bin:$PATH

# Ou ajouter au ~/.bashrc ou ~/.zshrc
echo 'export PATH=$(npm prefix -g)/bin:$PATH' >> ~/.bashrc
```

## 📚 Documentation complémentaire

- **README principal** : `../README.md`
- **Installation** : `../INSTALL.md`
- **API Reference** : `../docs/api/`
- ** Guides** : `../docs/guides/`
