# 🚀 OverMind-MCP v2.0.7 - Bug Fixes Edition

## 📋 Résumé

Version corrective qui résout deux problèmes critiques découverts pendant l'installation automatique.

## 🐛 Bugs Fixés

### 1. **Image Temporal Web introuvable**
- **Problème** : L'image `temporalio/web:1.24.0` n'existe pas sur Docker Hub
- **Symptôme** : `docker-compose pull` échouait avec `not found`
- **Solution** : Downgrade vers `temporalio/web:1.15.0` (dernière version stable)
- **Impact** : L'infrastructure Docker complète peut maintenant démarrer automatiquement

### 2. **Dépendance tslib manquante**
- **Problème** : `tslib@^2.0.0` était listé comme peer dependency mais pas installé
- **Symptôme** : Warnings `UNMET DEPENDENCY` dans les workspaces dépendants
- **Solution** : Ajout de `tslib` comme dépendance régulière + peer dependency
- **Impact** : Plus de warnings peer dependency

## 📦 Modifications

### docker-compose.yml
```yaml
# Avant
temporal-web:
  image: temporalio/web:1.24.0  # ❌ N'existe pas

# Après
temporal-web:
  image: temporalio/web:1.15.0  # ✅ Dernière version stable
```

### package.json
```json
{
  "dependencies": {
    // ...
    "tslib": "^2.8.1"  // ✅ Ajouté
  },
  "peerDependencies": {
    "tslib": "^2.0.0"  // ✅ Ajouté
  }
}
```

## ✅ Validation

L'installation automatique (`npm install -g overmind-mcp@2.0.7`) fonctionne maintenant correctement :
- ✅ PostgreSQL + pgvector installé
- ✅ **Toute** l'infrastructure Docker démarre automatiquement
- ✅ Tous les services visibles dans Docker Desktop
- ✅ Aucune dépendance manquante

## 🔄 Migration

Depuis v2.0.6 :
```bash
npm install -g overmind-mcp@2.0.7
```

Le script postinstall automatique mettra à jour docker-compose.yml si nécessaire.

## 📞 Support

- GitHub : https://github.com/DeamonDev888/overmind-mcp/issues
- Discord : https://discord.gg/4AR82phtBz
