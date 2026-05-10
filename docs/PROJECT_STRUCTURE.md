# 📁 Structure du Projet OverMind MCP

Organisation des dossiers et fichiers pour une meilleure navigation et maintenance.

## 📂 Arborescence

```
Workflow/
├── 📦 bin/                    # Scripts d'installation
│   ├── install-overmind-unix.sh
│   ├── install-overmind-windows.bat
│   └── README.md
├── 📋 changelog/             # Historique des versions
│   ├── CHANGELOG.md
│   ├── CHANGELOG.2.0.7.md
│   ├── CHANGELOG_ENV_FIX.md
│   └── README.md
├── 🐳 docker/                # Configuration Docker
│   ├── docker-compose.yml
│   └── README.md
├── 🗄️ db/                    # Scripts base de données
│   ├── init-db.sql
│   ├── init-overmind-db.sql
│   └── README.md
├── ⚙️ config/               # Configurations MCP
│   ├── mcp-config.json
│   └── README.md
├── 📚 docs/                  # Documentation complète
│   ├── api/                   # Documentation API
│   ├── guides/                # Guides d'utilisation
│   └── tools.md               # Référence des outils
├── 🔧 scripts/              # Scripts de maintenance
│   ├── setup.mjs
│   ├── postgres-manager.mjs
│   └── uninstall.mjs
├── 💻 src/                   # Code source
│   ├── bin/                  # Points d'entrée CLI
│   ├── lib/                  # Bibliothèques partagées
│   ├── services/             # Services métier
│   ├── tools/                # Outils MCP
│   └── server.ts             # Serveur MCP principal
├── 🧪 tests/                 # Tests unitaires
└── 📦 assets/               # Ressources (images, bannières)
```

## 🎯 Organisation par type de fichier

### 📦 bin/ - Scripts d'installation
Contient les scripts pour installer OverMind MCP sur différents systèmes.

### 📋 changelog/ - Historique des versions
Tous les changelogs organisés par version avec format standardisé.

### 🐳 docker/ - Configuration Docker
Stack Docker Compose avec tous les services nécessaires.

### 🗄️ db/ - Scripts base de données
Scripts SQL pour l'initialisation et la maintenance PostgreSQL.

### ⚙️ config/ - Configurations MCP
Exemples de configurations MCP pour différents scénarios d'utilisation.

## 🔍 Navigation rapide

### Pour les développeurs
```bash
# Installer
bin/install-overmind-unix.sh

# Démarrer Docker
cd docker && docker-compose up -d

# Initialiser la BD
cat db/init-overmind-db.sql | docker exec -i overmind-postgres-pgvector psql -U postgres
```

### Pour les utilisateurs
```bash
# Voir les changelogs
ls changelog/

# Lire la doc d'un dossier
cat config/README.md
cat docker/README.md
```

## 📝 Conventions

### Nouveaux fichiers
- **Scripts** → `bin/`
- **Changelogs** → `changelog/`
- **Docker** → `docker/`
- **SQL** → `db/`
- **Config** → `config/`
- **Documentation** → `docs/`

### Avantages de cette organisation
1. **Navigation claire** - Chaque type de fichier a son emplacement
2. **Maintenance facilitée** - Scripts et config regroupés
3. **Documentation contextuelle** - README dans chaque dossier
4. **Professional** - Structure organisée selon les standards Node.js
