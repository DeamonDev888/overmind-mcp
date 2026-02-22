# OverMind-MCP Documentation Site

Site web cyberpunk professionnel pour OverMind-MCP avec animations 2026.

## 🎨 Design

- **Thème**: Cyberpunk professionnel avec palette néon (pink, cyan, purple)
- **Animations**: Matrix rain, grid animé, orbes flottants, effets de glitch
- **Interactivité**: Effets 3D sur les cartes, parallaxe, compteurs animés
- **Responsive**: Adapté mobile, tablette et desktop

## 📁 Structure

```
docs/
├── index.html          # Page principale
├── styles.css          # Styles cyberpunk avec animations
├── script.js           # JavaScript interactif (Matrix, parallax, etc.)
└── README.md          # Ce fichier
```

## 🚀 Fonctionnalités

### Effets Visuels

- ✨ Matrix rain en arrière-plan (canvas)
- 🌐 Grille perspective animée
- 🔮 Orbes lumineux flottants
- 💫 Effet glitch sur le titre
- 🎯 Particules interactives
- 🌊 Gradient animé

### Interactions

- 🖱️ Parallaxe au mouvement de souris
- 🎴 Effet 3D sur les cartes
- ⚡ Compteurs animés au scroll
- 🔘 Boutons avec effets glow
- 📋 Copie de code en un clic
- 📑 Onglets pour installation

### Animations CSS

- `@keyframes float` - Animation flottante
- `@keyframes pulse` - Pulsation lumineuse
- `@keyframes glitch` - Effet glitch
- `@keyframes spin` - Rotation
- `@keyframes rotateRing` - Rotation des anneaux
- `@keyframes brainPulse` - Pulsation cerveau

## 🎯 Personnalisation

### Couleurs (CSS Variables)

```css
:root {
  --neon-pink: #ff006e;
  --neon-cyan: #00fff5;
  --neon-purple: #b537f2;
  --neon-blue: #3b82f6;
}
```

### Polices

- **Orbitron**: Titres et logos (Google Fonts)
- **Rajdhani**: Corps du texte (Google Fonts)
- **Fira Code**: Blocs de code (Google Fonts)

## 📦 Déploiement

### GitHub Pages

Le site est automatiquement déployé via GitHub Actions à chaque push sur la branche `main`.

### Déploiement Local

```bash
# Serveur de développement Python
python -m http.server 8000

# Ou avec Node.js
npx serve docs
```

## 🔧 Configuration

### GitHub Actions

Le workflow `.github/workflows/deploy.yml` gère le déploiement automatique.

### Settings Repository

- Source: GitHub Actions
- Branch: main
- Folder: /docs

## 📱 Responsive Breakpoints

- **Desktop**: > 1024px
- **Tablet**: 768px - 1024px
- **Mobile**: < 768px

## ⚡ Performance

- Optimisé pour charger instantanément
- Animations CSS natives (hardware acceleration)
- Matrix animation pause quand onglet inactif
- Intersection Observer pour les animations au scroll

## 🎮 Easter Eggs

- Cliquer sur le cerveau = explosion de particules
- Console du navigateur = message caché
- Survol des cartes = effet 3D
- Parallaxe au mouvement de souris

## 📝 Ressources

- [Font Awesome](https://fontawesome.com/) - Icônes
- [Google Fonts](https://fonts.google.com/) - Polices
- [MDN Web Docs](https://developer.mozilla.org/) - Référence CSS/JS

---

**Créé avec ❤️ et beaucoup de néon par DeaMoN888 - 2026**

<!-- Last Deploy: 2026-02-22T14:15:00 -->
