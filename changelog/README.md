# 📋 Changelogs - OverMind MCP

## 📜 Fichiers

- **CHANGELOG.md** - Changelog principal
- **CHANGELOG.2.0.7.md** - Version 2.0.7
- **CHANGELOG_ENV_FIX.md** - Correction variables d'environnement

## 🔄 Utilisation

```bash
# Ajouter un changeset
pnpm changeset

# Voir le statut
pnpm changeset status

# Générer nouvelle version
pnpm version

# Publier
pnpm release
```

## 📖 Format

Créer un fichier `.changeset/*.md`:
```md
---
"overmind-mcp": minor
---
Description du changement
```