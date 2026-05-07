🚀 **Session Manager v1.0 - Gestion unifiée de sessions IA**

J'ai créé un nouvel outil MCP pour gérer facilement toutes vos sessions (Claude, Kilo, Gemini, etc.) :

```typescript
session_manager({ action: "list|copy|delete|rename|purge|stats" })
```

**🎯 Fonctionnalités :**
• 📋 Lister les sessions avec filtres
• 📋 Copier entre agents/runners  
• 🗑️ Supprimer les anciennes sessions
• ✏️ Renommer rapidement
• 🧹 Purger les sessions expirées
• 📊 Statistiques par runner

**💻 Exemple :**
```typescript
// Voir les sessions Claude
session_manager({ action: "list", runner: "claude" })

// Copier une session
session_manager({ action: "copy", sourceAgentName: "expert", targetAgentName: "expert2" })
```

**✅ En prod :** 56 sessions actives gérées (17 Claude + 4 Kilo)  
**🧪 Tests :** 89 tests unitaires passent

Déjà inclus dans **OverMind MCP v1.5.13** !

Feedback bienvenu 🎉

#MCP #DevTool