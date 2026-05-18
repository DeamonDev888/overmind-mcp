import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z
    .enum(['glm', 'minimax', 'openrouter', 'ilmu', 'minimaxi', 'overmind'])
    .describe('Le fournisseur pour lequel vous voulez un exemple de configuration.'),
});

export async function configExample(args: z.infer<typeof configExampleSchema>) {
  const { provider } = args;
  let text = '';

  const interpolationNotice = `
💡 **NOUVEAUTÉ : INTERPOLATION DE VARIABLES**
Vous pouvez désormais utiliser des variables du fichier \`.env\` dans vos fichiers \`settings_[agent].json\`. 
Les variables commençant par \`$\` seront automatiquement remplacées par leur valeur réelle au moment de l'exécution.
  `;

  switch (provider) {
    case 'glm':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR GLM / Z.AI (ANTHROPIC PROXY)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "$ANTHROPIC_MODEL_Z",
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_Y",
    "ANTHROPIC_AUTH_TOKEN_FALLBACK": "$ANTHROPIC_AUTH_TOKEN_E",
    "ANTHROPIC_BASE_URL": "$ANTHROPIC_BASE_URL_Z"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [
    "postgresql-server",
    "memory"
  ],
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`

### 📂 .env correspondant
\`\`\`
# Z.AI Configuration
ANTHROPIC_BASE_URL_Z=https://api.z.ai/api/anthropic
ANTHROPIC_MODEL_Z=glm-5.1
ANTHROPIC_AUTH_TOKEN_Y=your_primary_token_here
ANTHROPIC_AUTH_TOKEN_E=your_fallback_token_here
\`\`\`

**Modèles GLM disponibles :**
- \`glm-5.1\` - Flagship modèle (recommandé)
- \`glm-5\` - Performances solides
- \`glm-4.5-air\` - Modèle léger et coût-efficace

**Fallback automatique :**
- Utilise \`ANTHROPIC_AUTH_TOKEN_Y\` par défaut
- En cas d'erreur 401/429/5xx, bascule automatiquement sur \`ANTHROPIC_AUTH_TOKEN_E\`

${interpolationNotice}`;
      break;
    case 'ilmu':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR ILMU AI**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "$Z_AI_MODEL", // Interpolé depuis le .env
    "ANTHROPIC_AUTH_TOKEN": "$Z_AI_API_KEY",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL",
    "API_TIMEOUT_MS": "900000"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [
    "postgresql-server",
    "memory",
    "discord-server"
  ],
  "agent": "ilmu_agent",
  "runner": "kilo"
}
\`\`\`
${interpolationNotice}`;
      break;
    case 'minimax':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR MINIMAX (VIA PROXY ANTHROPIC)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "$MINIMAX_API_KEY", // Utilisez une variable .env
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "The_Chaos_Prophet",
    "ANTHROPIC_SMALL_FAST_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "MiniMax-M2"
  },
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`
${interpolationNotice}`;
      break;
    case 'openrouter':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR OPENROUTER (VIA PROXY ANTHROPIC)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
    "ANTHROPIC_AUTH_TOKEN": "$OPENROUTER_API_KEY", // Utilisez une variable .env
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "anthropic/claude-3-5-sonnet",
    "ANTHROPIC_SMALL_FAST_MODEL": "anthropic/claude-3-haiku",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "anthropic/claude-3-5-sonnet",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic/claude-3-opus",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic/claude-3-haiku"
  },
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`
${interpolationNotice}`;
      break;
    case 'minimaxi':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR MINIMAXI (VERSION ALTERNATIVE)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "MiniMax-Text-01",
    "ANTHROPIC_AUTH_TOKEN": "$MINIMAXI_API_KEY", // Configuré dans le .env
    "ANTHROPIC_BASE_URL": "$MINIMAXI_BASE_URL",
    "ANTHROPIC_SMALL_FAST_MODEL": "MiniMax-Text-01",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "MiniMax-Text-01",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "MiniMax-Text-01",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "MiniMax-Text-01",
    "API_TIMEOUT_MS": "900000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "agent": "minimax_agent"
  },
  "agent": "minimax_agent",
  "runner": "claude"
}
\`\`\`
${interpolationNotice}`;
      break;

    // ─── OVERMIND: Guide complet $VAR + FALLBACK TOKENS ───
    case 'overmind':
      text = `🎯 **GUIDE COMPLET : SUBSTITUTION $VAR ET FALLBACK TOKENS**

Overmind supporte deux mécanismes puissants pour vos agents :

---

### 1️⃣ SUBSTITUTION $VAR (tous les runners)

Les settings de vos agents peuvent référencer des variables d'environnement du \`.env\` avec la syntaxe \`$NOM_VARIABLE\`.

\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_1",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL"
  }
}
\`\`\`

Au runtime, Overmind remplace automatiquement \`$ANTHROPIC_AUTH_TOKEN_1\` par sa valeur réelle depuis le \`.env\`.

---

### 2️⃣ RETRY AUTOMATIQUE SUR ERREUR (ClaudeRunner + KiloRunner)

Quand une erreur se produit, Overmind peut RETENTER automatiquement avec des tokens de secours.

**Erreurs retryables :**
- **401** : Auth failure (token invalide/expiré)
- **429** : Rate limit / quota exhausted (limite atteinte)
- **500, 502, 503** : Server error (erreur serveur)

**Détection texte stderr :** \`401\`, \`unauthorized\`, \`invalid api key\`, \`authentication failed\`, \`auth error\`, \`429\`, \`rate limit\`, \`quota exhausted\`, \`limit exhausted\`, \`503\`, \`service unavailable\`, \`500\`, \`internal server error\`

**Flow :** Token primaire → AUTH_FALLBACK_1 → AUTH_FALLBACK_2 → AUTH_FALLBACK_3 → ÉCHEC

---

### 📂 EXEMPLE COMPLET : ClaudeRunner avec 3 fallback tokens

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN",      // Token principal
    "AUTH_FALLBACK_1": "$ANTHROPIC_AUTH_TOKEN_2",         // Si 401/429/5xx
    "AUTH_FALLBACK_2": "$ANTHROPIC_AUTH_TOKEN_3",         // Si encore échoué
    "AUTH_FALLBACK_3": "$ANTHROPIC_AUTH_TOKEN_4"         // Dernier recours
  }
}
\`\`\`

**.env associé :**
\`\`\`
ANTHROPIC_AUTH_TOKEN=sk-cp-primary...     # Token principal ( utilisation normale )
ANTHROPIC_AUTH_TOKEN_2=sk-cp-xxx...       # Fallback #1
ANTHROPIC_AUTH_TOKEN_3=sk-cp-yyy...       # Fallback #2
ANTHROPIC_AUTH_TOKEN_4=sk-cp-zzz...       # Fallback #3
\`\`\`

**Comment ça marche :**
1. L'agent commence avec \`ANTHROPIC_AUTH_TOKEN\` = \`$ANTHROPIC_AUTH_TOKEN\` → résolu → \`sk-cp-primary...\`
2. Si erreur 401/429/5xx → retry avec \`AUTH_FALLBACK_1\` → \`sk-cp-xxx...\`
3. Si encore échec → retry avec \`AUTH_FALLBACK_2\` → \`sk-cp-yyy...\`
4. Si encore échec → retry avec \`AUTH_FALLBACK_3\` → \`sk-cp-zzz...\`
5. Si encore échec → \`RETRYABLE_ERROR_ALL_FALLBACKS_EXHAUSTED\`

---

### 📂 EXEMPLE COMPLET : KiloRunner avec fallback

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "OPENAI_API_KEY": "$ANTHROPIC_AUTH_TOKEN",          // Clé primaire Kilo
    "AUTH_FALLBACK_1": "$ANTHROPIC_AUTH_TOKEN_2",       // Fallback #1
    "AUTH_FALLBACK_2": "$ANTHROPIC_AUTH_TOKEN_3",        // Fallback #2
    "AUTH_FALLBACK_3": "$ANTHROPIC_AUTH_TOKEN_4"         // Fallback #3
  }
}
\`\`\`

> Kilo utilise \`OPENAI_API_KEY\` comme clé primaire (compatible OpenAI / OpenRouter / etc.).

---

### 📂 EXEMPLE : Variable $VAR simple (sans fallback)

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL",
    "API_TIMEOUT_MS": "$API_TIMEOUT_MS"
  }
}
\`\`\`

Les \`$VAR\` peuvent être sur n'importe quelle valeur de \`env\`.

---

### ⚠️ RÈGLES IMPORTANTES

- Les clés \`AUTH_FALLBACK_1\`, \`AUTH_FALLBACK_2\`, \`AUTH_FALLBACK_3\` sont réservées par Overmind pour le retry automatique.
- La substitution est à **un seul niveau** : \`$MINIMAXI_API_KEY\` est remplacé, mais pas récursivement.
- Les tokens sont résolus **avant** le spawn de l'agent.
- Le retry fonctionne sur erreur **401 (auth), 429 (rate limit), 500/502/503 (server error)** — pas sur les erreurs de réseau simples (timeout, DNS...).
- Chaque token fallback ne sera testé qu'une seule fois par session d'agent.
- Si tous les fallbacks sont épuisés, l'erreur finale est \`RETRYABLE_ERROR_ALL_FALLBACKS_EXHAUSTED\`.`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
