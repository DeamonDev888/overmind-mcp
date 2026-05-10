# 📋 Changelogs

Ce dossier contient tous les fichiers de changelog d'OverMind MCP.

## 📜 Fichiers

- **CHANGELOG.md** - Changelog principal (versions récentes)
- **CHANGELOG.2.0.7.md** - Version spécifique 2.0.7
- **CHANGELOG_ENV_FIX.md** - Correction interpolation variables d'environnement

## 📖 Format

Les changelogs suivent le format standard Keep a Changelog :

### Ajouté (Added)
- Nouvelles fonctionnalités
- Nouveaux paramètres
- Nouveaux modèles supportés

### Corrigé (Fixed)
- Bugs résolus
- Problèmes de compatibilité
- Corrections de performance

### Changé (Changed)
- Modifications existantes
- Mises à jour de dépendances
- Changements de configuration

## 🔍 Recherche

Pour rechercher une version ou un changement spécifique :

```bash
# Chercher une version
grep "2.2.6" changelog/*.md

# Chercher un mot-clé
grep "GLM-5.1" changelog/*.md

# Voir toutes les versions
grep "^## " changelog/*.md
```
