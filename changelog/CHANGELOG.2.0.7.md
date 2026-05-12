# 🚀 OverMind-MCP v2.0.7 - Bug Fixes Edition

## 📋 Résumé

Version corrective qui résout deux problèmes critiques découverts pendant l'installation automatique.

## 🐛 Bugs Fixés

### 1. **Image Temporal Web introuvable**
- **Problème** : L'image `temporalio/web:1.24.0` n'existe pas sur Docker Hub
- **Solution** : Downgrade vers `temporalio/web:1.15.0`

### 2. **Dépendance tslib manquante**
- **Problème** : `tslib@^2.0.0` n'était pas installé
- **Solution** : Ajout de `tslib` comme dépendance

## ✅ Validation

- ✅ PostgreSQL + pgvector installé
- ✅ Infrastructure Docker démarre automatiquement
- ✅ Aucun warning peer dependency

## 📞 Support

- GitHub : https://github.com/DeamonDev888/overmind-mcp/issues
- Discord : https://discord.gg/4AR82phtBz