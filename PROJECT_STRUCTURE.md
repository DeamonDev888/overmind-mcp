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
├── 📚 docs/                  # Documentation complète
│   ├── api/                   # Documentation API
│   ├── guides/                # Guides d'utilisation
│   └── tools.md               # Référence des outils
├── ⚙️ scripts/              # Scripts de maintenance
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
└── 🔧 config/               # Fichiers de configuration
```

## 📂 Nouvelle Organisation

### 📦 bin/
**Scripts d'installation** - Contient les scripts pour installer OverMind MCP sur différents systèmes.
- Installation automatique des dépendances
- Configuration de l'environnement
- Validation de l'installation

### 📋 changelog/
**Historique des versions** - Tous les changelogs organisés par version.
- Format standardisé (Keep a Changelog)
- Recherche facile par version ou fonctionnalité
- Documentation des breaking changes

### 🐳 docker/
**Configuration Docker** - Tous les fichiers liés à Docker.
- Stack principale avec tous les services
- Documentation des ports et services
- Commandes de gestion courantes

### 🗄️ db/
**Scripts base de données** - Initialisation et maintenance de la BD.
- Scripts SQL structurés
- Documentation des tables et index
- Commandes de backup/restore

## 🎯 Avantages

### 1. **Navigation claire**
- Chaque type de fichier a son emplacement dédié
- Séparation logique des responsabilités
- Arborescence plus intuitive

### 2. **Maintenance facilitée**
- Scripts d'installation regroupés
- Changelogs organisés et consultables
- Configuration Docker centralisée

### 3. **Documentation améliorée**
- README dans chaque dossier
- Instructions contextuelles
- Exemples d'utilisation

### 4. **Backward compatibility**
- Références mises à jour dans tous les fichiers
- Scripts adaptés aux nouveaux chemins
- Aucune fonctionnalité cassée

## 📖 Utilisation

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
cat bin/README.md
cat docker/README.md
cat db/README.md
```

### Pour les contributeurs
```bash
# Ajouter un nouveau changelog
# → le placer dans changelog/

# Ajouter un nouveau script Docker  
# → le placer dans docker/

# Ajouter un nouveau script d'installation
# → le placer dans bin/
```

## 🔍 Recherche rapide

### Trouver un fichier par type
```bash
# Scripts d'installation
ls bin/

# Changelogs
ls changelog/

# Docker
ls docker/

# Base de données
ls db/
```

### Chercher dans la documentation
```bash
# Guides de déploiement
cat docs/guides/DEPLOYMENT.md

# Référence des outils
cat docs/tools.md

# Changelog d'une version
cat changelog/CHANGELOG.2.2.6.md
```

## 📝 Conventions

### Nouveaux fichiers
- **Scripts** → `bin/`
- **Changelogs** → `changelog/`
- **Docker** → `docker/`
- **SQL** → `db/`
- **Documentation** → `docs/`

### Nommage
- Utiliser des noms descriptifs
- Préférer les minuscules et tirets
- Ajouter README.md dans chaque dossier

## 🚀 Migration

Cette réorganisation ne casse aucune fonctionnalité existante :

✅ **Scripts** : chemins mis à jour dans `package.json` et `INSTALL.md`  
✅ **Docker** : références mises à jour dans la documentation  
✅ **SQL** : scripts toujours accessibles via `db/`  
✅ **Changelogs** : tous les changelogs préservés dans `changelog/`

Pour une migration transparente, tous les chemins relatifs ont été mis à jour automatiquement.
