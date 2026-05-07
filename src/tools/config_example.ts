import { z } from 'zod';

export const configExampleSchema = z
  .object({
    provider: z
      .enum(['glm', 'minimax', 'openrouter', 'ilmu', 'minimaxi', 'overmind'])
      .describe('Le fournisseur pour lequel vous voulez un exemple de configuration.'),
  })
  .passthrough();

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
    "ANTHROPIC_MODEL": "$Z_AI_MODEL", // Se réfère à Z_AI_MODEL dans le .env
    "ANTHROPIC_AUTH_TOKEN": "$Z_AI_API_KEY",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6",
    "API_TIMEOUT_MS": "3000000"
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

Overmind supporte deux mécanismes puissant pour vos agents :

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

### 2️⃣ RETRY AUTOMATIQUE SUR ERREUR 401 (ClaudeRunner + KiloRunner)

Si une erreur d'authentification (401) se produit, Overmind peut RETENTER automatiquement avec des tokens de secours.

**Détection :** \`401\`, \`unauthorized\`, \`invalid api key\`, \`authentication failed\`, \`auth error\`

**Flow :** Token primaire → AUTH_FALLBACK_1 → AUTH_FALLBACK_2 → AUTH_FALLBACK_3 → ÉCHEC

---

### 📂 EXEMPLE COMPLET : ClaudeRunner avec fallback

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_FALLBACK_1",
    "AUTH_FALLBACK_1": "$ANTHROPIC_AUTH_TOKEN_1",
    "AUTH_FALLBACK_2": "$ANTHROPIC_AUTH_TOKEN_2",
    "AUTH_FALLBACK_3": "$ANTHROPIC_AUTH_TOKEN_3"
  }
}
\`\`\`

**.env associé :**
\`\`\`
ANTHROPIC_AUTH_TOKEN_1=sk-cp-xxx...   # Token #1
ANTHROPIC_AUTH_TOKEN_2=sk-cp-yyy...   # Token #2 (fallback #1)
ANTHROPIC_AUTH_TOKEN_3=sk-cp-zzz...   # Token #3 (fallback #2)
\`\`\`

**Comment ça marche :**
1. L'agent commence avec \`ANTHROPIC_AUTH_TOKEN\` = \`$ANTHROPIC_AUTH_FALLBACK_1\` → résolu → \`sk-cp-xxx...\`
2. Si erreur 401 → retry avec \`AUTH_FALLBACK_1\` → \`sk-cp-yyy...\`
3. Si erreur 401 → retry avec \`AUTH_FALLBACK_2\` → \`sk-cp-zzz...\`
4. Si erreur 401 → \`AUTH_ERROR_ALL_FALLBACKS_EXHAUSTED\`

---

### 📂 EXEMPLE COMPLET : KiloRunner avec fallback

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "OPENAI_API_KEY": "$ANTHROPIC_AUTH_FALLBACK_1",
    "AUTH_FALLBACK_1": "$ANTHROPIC_AUTH_TOKEN_1",
    "AUTH_FALLBACK_2": "$ANTHROPIC_AUTH_TOKEN_2",
    "AUTH_FALLBACK_3": "$ANTHROPIC_AUTH_TOKEN_3"
  }
}
\`\`\`

> Kilo utilise \`OPENAI_API_KEY\` comme clé primaire (compatible OpenAI-compatible API).

---

### 📂 EXEMPLE : Variable $VAR simple (sans fallback)

\`\`\`json
{
  "model": "claude-sonnet-4-20250514",
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_4",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL",
    "API_TIMEOUT_MS": "$API_TIMEOUT_MS"
  }
}
\`\`\`

Les \`$VAR\` peuvent être sur n'importe quelle valeur de \`env\`.

---

### ⚠️ RÈGLES IMPORTANTES

- Les clés \`AUTH_FALLBACK_1\`, \`AUTH_FALLBACK_2\`, \`AUTH_FALLBACK_3\` sont réservées par Overmind pour le retry 401.
- La substitution est à **un seul niveau** : \`$MINIMAXI_API_KEY\` est remplacé, mais pas récursivement.
- Les tokens sont résolution **avant** le spawn de l'agent.
- Le retry ne fonctionne que sur erreur **401/auth** — pas sur les erreurs de réseau ou rate limit.`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
