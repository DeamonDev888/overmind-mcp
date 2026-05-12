# Changelog - Correction du système de variables d'environnement

## 📅 Date: 2026-05-10

## 🎯 Objectif
Corriger le système d'interpolation des variables d'environnement pour les agents Claude utilisant des providers tiers (Z.AI, Minimax, etc.).

## 🐛 Problèmes corrigés

### 1. **Interpolation des variables $VAR non fonctionnelle**
- **Cause** : Le fichier `.env` n'était pas chargé avant `interpolateEnvVars()` dans `ClaudeRunner`
- **Solution** : Chargement des variables AVANT interpolation

### 2. **Erreur __dirname indéfini en ES modules**
- **Solution** : Définition manuelle avec `fileURLToPath`

## 🎯 Modèles Z.AI validés

- `glm-5.1` ⭐ (recommandé)
- `glm-5`
- `glm-4.5-air`

## 🚀 Impact

- Variables correctement résolues
- Support complet providers tiers via interpolation $VAR