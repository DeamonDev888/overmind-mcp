import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z
    .enum([
      // Standard providers (legacy ClaudeRunner/KiloRunner)
      'glm',
      'openrouter',
      'ilmu',
      'anthropic',
      'overmind',
      // Hermes providers (NousHermesRunner — 2.8.34+)
      'hermes-minimax-cn',
      'hermes-minimax-global',
      'hermes-zai',
      'hermes-anthropic',
    ])
    .describe('Le fournisseur pour lequel vous voulez un exemple de configuration.'),
});

/**
 * config_example tool — provides copy-pasteable config templates for each
 * supported provider. Updated for Overmind 2.8.34+:
 *   - Hermes runner uses the CANONICAL Hermes layout (HERMES_HOME/agents/<name>/)
 *     instead of the legacy polylgot `agent_<name>/.hermes/` dir.
 *   - The runner auto-injects provider-specific env vars (MINIMAX_CN_API_KEY,
 *     MINIMAX_CN_BASE_URL, etc.) into the canonical settings.json based on
 *     the token prefix + ANTHROPIC_BASE_URL. Users only need to set
 *     ANTHROPIC_AUTH_TOKEN (+ ANTHROPIC_BASE_URL) and the runner does the rest.
 *   - `--provider` is now passed to the CLI (forces Hermes upstream to skip
 *     the auto-router that was picking openrouter for MiniMax-M3).
 *
 * Use case: when a user asks "how do I configure agent X for provider Y",
 * call this tool and copy/paste the relevant section.
 */
export async function configExample(args: z.infer<typeof configExampleSchema>) {
  const { provider } = args;
  let text = '';

  const interpolationNotice = `
💡 **NOUVEAUTÉ : INTERPOLATION DE VARIABLES**
Les fichiers \`settings_<agent>.json\` et la config canonique Hermes
supportent les références \`$VAR\` qui sont résolues depuis \`Workflow/.env\`
ou \`process.env\` au moment du spawn.
`;

  switch (provider) {
    // ═══════════════════════════════════════════════════════════════════
    // HERMES — NOUVEAU FORMAT CANONIQUE (2.8.30+)
    // ═══════════════════════════════════════════════════════════════════
    case 'hermes-minimax-cn':
      text = `🇨🇳 **HERMES + MINIMAX CN** (Overmind 2.8.34+, NousHermesRunner)

### 📂 Workflow/.claude/settings_<agent>.json
\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_1",
    "ANTHROPIC_BASE_URL":   "https://api.minimaxi.com/anthropic",
    "ANTHROPIC_MODEL":      "MiniMax-M3",
    "ANTHROPIC_PROVIDER":   "minimax-cn"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["memory-server", "discord-server"],
  "agent": "nom_agent",
  "runner": "hermes"
}
\`\`\`

### 📂 Workflow/.claude/agents/<agent>.md (system prompt, optionnel)
\`\`\`markdown
# Persona de l'agent

Tu es un assistant ... (description libre)
\`\`\`

### 📂 Workflow/.env (tokens)
\`\`\`
ANTHROPIC_AUTH_TOKEN_1=sk-cp-xxxxxxxx   # token MiniMax CN valide
ANTHROPIC_AUTH_TOKEN_2=sk-cp-yyyyyyyy
ANTHROPIC_AUTH_TOKEN_3=sk-cp-zzzzzzzz
\`\`\`

### 🔧 Ce que le runner fait automatiquement au spawn

1. Lit \`settings_<agent>.json\` + interpole les \`$VAR\` depuis le \`.env\`
2. Détecte le provider depuis le token prefix + URL :
   - \`sk-cp-*\` + URL contient \`minimaxi\` → **MiniMax CN**
3. Écrit le **settings.json canonique** dans
   \`<HERMES_HOME>/agents/<agent>/settings.json\` avec :
   - L'env block (héritée de settings_<agent>.json)
   - \`MINIMAX_CN_API_KEY\` (le plugin \`minimax-cn\` upstream lit CECI, pas \`ANTHROPIC_AUTH_TOKEN\`)
   - \`MINIMAX_CN_BASE_URL\` (le résolveur provider upstream lit CECI, pas \`ANTHROPIC_BASE_URL\`)
4. Spawn \`hermes chat -q "..." --model MiniMax-M3 --provider minimax-cn --yolo\`
   avec \`HERMES_HOME=<workspace>/.overmind/hermes/\`

### 🌳 Arborescence canonique (Overmind-managed + Hermes-managed)
\`\`\`
Workflow/.overmind/hermes/                       ← HERMES_HOME (shared root)
├── agents/
│   └── nom_agent/                              ← per-agent home
│       ├── settings.json                       ← écrit par le runner
│       ├── SOUL.md                             ← (optionnel) persona par-agent
│       ├── sessions/  logs/  memories/  ...    ← Hermes upstream écrit
├── config.yaml                                 ← global, Hermes upstream
├── auth.json                                   ← global, Hermes upstream (credential pool)
├── sessions/  logs/  ...                       ← partagés entre agents
\`\`\`

### ⚠️ Pièges courants
- Ne PAS écrire manuellement \`<HERMES_HOME>/agents/<name>/.hermes/\` — c'est l'ancien
  format polyglot (pré-2.8.30). Le runner crée directement \`agents/<name>/\`.
- Ne PAS toucher \`config.yaml\` ou \`auth.json\` au root — Hermes upstream les gère.
- Le token \`$VAR\` est résolu **une seule fois** (pas récursif).
- Si tu changes l'URL de \`api.minimax.io\` (GLOBAL) → \`api.minimaxi.com\` (CN avec le \`i\`),
  le runner switch automatiquement entre \`MINIMAX_API_KEY\` et \`MINIMAX_CN_API_KEY\`.
- Les tokens sk-cp sont partagés entre CN et GLOBAL — c'est **l'URL dans settings** qui
  décide quel bucket/provider est utilisé.
${interpolationNotice}`;
      break;

    case 'hermes-minimax-global':
      text = `🌍 **HERMES + MINIMAX GLOBAL** (Overmind 2.8.34+, NousHermesRunner)

### 📂 Workflow/.claude/settings_<agent>.json
\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_GLOBAL",
    "ANTHROPIC_BASE_URL":   "https://api.minimax.io/anthropic",
    "ANTHROPIC_MODEL":      "MiniMax-M3",
    "ANTHROPIC_PROVIDER":   "minimax"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["memory-server"],
  "agent": "nom_agent",
  "runner": "hermes"
}
\`\`\`

### Différence vs CN
- **URL :** \`api.minimax.io\` (SANS le \`i\`) — endpoint international
- **Env var seedé :** \`MINIMAX_API_KEY\` (pas \`MINIMAX_CN_API_KEY\`)
- **Plugin upstream :** profile \`minimax\` (pas \`minimax-cn\`)
- Le runner détecte \`api.minimax.io\` dans l'URL et switch auto.

Voir \`hermes-minimax-cn\` pour le détail complet du flow + arborescence.
${interpolationNotice}`;
      break;

    case 'hermes-zai':
      text = `🤖 **HERMES + Z.AI / GLM** (Overmind 2.8.34+, NousHermesRunner)

### 📂 Workflow/.claude/settings_<agent>.json
\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_Y",
    "ANTHROPIC_BASE_URL":   "https://api.z.ai/api/coding/paas/v4",
    "ANTHROPIC_MODEL":      "glm-5.1",
    "ANTHROPIC_PROVIDER":   "zai"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["memory-server"],
  "agent": "nom_agent",
  "runner": "hermes"
}
\`\`\`

### Ce que le runner fait au spawn (auto-détection token)
- Token Z.AI = 32hex (\`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy\`) ou
  32hex simple (\`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\`)
- Runner seed automatiquement :
  - \`ZAI_ANTHROPIC_FALLBACK_KEY\` (= valeur du token)
  - \`GLM_API_KEY\` (= valeur du token)
- Plugin upstream \`zai\` lit ces vars.

Voir \`hermes-minimax-cn\` pour le détail complet du flow + arborescence.
${interpolationNotice}`;
      break;

    case 'hermes-anthropic':
      text = `🅰️ **HERMES + ANTHROPIC (OFFICIEL)** (Overmind 2.8.34+, NousHermesRunner)

### 📂 Workflow/.claude/settings_<agent>.json
\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL":   "https://api.anthropic.com",
    "ANTHROPIC_MODEL":      "claude-sonnet-4-6",
    "ANTHROPIC_PROVIDER":   "anthropic"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["memory-server"],
  "agent": "nom_agent",
  "runner": "hermes"
}
\`\`\`

### Note
Pour Anthropic, le runner ne seed PAS de variables provider-specific — il laisse
\`ANTHROPIC_AUTH_TOKEN\` tel quel. Le plugin upstream \`anthropic\` lit cette var
directement, donc pas de transformation nécessaire.

Voir \`hermes-minimax-cn\` pour le détail complet du flow + arborescence.
${interpolationNotice}`;
      break;

    // ═══════════════════════════════════════════════════════════════════
    // LEGACY: ClaudeRunner / KiloRunner (autres providers)
    // ═══════════════════════════════════════════════════════════════════
    case 'glm':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR GLM / Z.AI (CLAUDE RUNNER)**

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
  "enabledMcpjsonServers": ["postgresql-server", "memory"],
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`

### 📂 .env correspondant
\`\`\`
ANTHROPIC_BASE_URL_Z=https://api.z.ai/api/anthropic
ANTHROPIC_MODEL_Z=glm-5.1
ANTHROPIC_AUTH_TOKEN_Y=your_primary_token_here
ANTHROPIC_AUTH_TOKEN_E=your_fallback_token_here
\`\`\`

**Modèles GLM disponibles :** \`glm-5.1\` (flagship), \`glm-5\`, \`glm-4.5-air\`.

**Fallback automatique :** \`ANTHROPIC_AUTH_TOKEN_Y\` → \`ANTHROPIC_AUTH_TOKEN_E\` sur 401/429/5xx.

> **Note :** Si tu utilises le **runner Hermes** (préféré pour les agents
> Discord/CLI), utilise plutôt \`hermes-zai\`. Le ClaudeRunner ci-dessus est
> pour les agents qui spawnent directement le binaire Claude Code.
${interpolationNotice}`;
      break;

    case 'ilmu':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR ILMU AI (KILO RUNNER)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "$Z_AI_MODEL",
    "ANTHROPIC_AUTH_TOKEN": "$Z_AI_API_KEY",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL",
    "API_TIMEOUT_MS": "900000"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["postgresql-server", "memory", "discord-server"],
  "agent": "ilmu_agent",
  "runner": "kilo"
}
\`\`\`
${interpolationNotice}`;
      break;

    case 'openrouter':
      text = `⚠️ **OPENROUTER = EMBEDDINGS UNIQUEMENT** (Overmind convention 2026-06-07)

OpenRouter ne doit PAS être utilisé pour l'inférence LLM dans Overmind. Le
runner Hermes purge activement \`OPENROUTER_API_KEY\` du spawn env, et
configurer un agent Hermes avec OpenRouter LLM résultera en **HTTP 401
"Missing Authentication header"** parce que la clé est bloquée.

**Pour les embeddings Overmind uniquement :** voir \`OVERMIND_EMBEDDING_KEY\`
dans \`Workflow/.env\` (consommé par les providers d'embedding Overmind internes).

**Si tu veux router via OpenRouter pour LLM :** utilise le runner
\`openclaw\` ou \`kilo\` avec un settings qui ne déclenche pas le purge
Hermes. Mais ce n'est PAS recommandé.

Voir \`hermes-minimax-cn\` ou \`hermes-anthropic\` pour les providers LLM
supportés par le runner Hermes.
${interpolationNotice}`;
      break;

    case 'anthropic':
      text = `🅰️ **CLAUDE RUNNER + ANTHROPIC OFFICIEL**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "claude-sonnet-4-6",
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN",
    "API_TIMEOUT_MS": "900000"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["memory-server"],
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`
${interpolationNotice}`;
      break;

    // ═══════════════════════════════════════════════════════════════════
    // OVERMIND: guide complet (subtilisation, fallbacks, etc.)
    // ═══════════════════════════════════════════════════════════════════
    case 'overmind':
      text = `🎯 **GUIDE COMPLET : SUBSTITUTION $VAR ET FALLBACK TOKENS**

Overmind supporte deux mécanismes puissants pour vos agents.

---

### 1️⃣ SUBSTITUTION $VAR (tous les runners)

Les settings de vos agents peuvent référencer des variables d'environnement
du \`.env\` avec la syntaxe \`$NOM_VARIABLE\`.

\`\`\`json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "$ANTHROPIC_AUTH_TOKEN_1",
    "ANTHROPIC_BASE_URL": "$Z_AI_BASE_URL"
  }
}
\`\`\`

Au runtime, Overmind remplace automatiquement \`$ANTHROPIC_AUTH_TOKEN_1\` par
sa valeur réelle depuis le \`.env\`.

---

### 2️⃣ SUBTILISATION AUTO (Hermes runner, 2.8.34+)

Pour le **runner Hermes**, le runner détecte le token prefix et seed
automatiquement les env vars provider-specific dans le settings.json
canonique :

| Token prefix | URL contient \`minimaxi\` | URL contient \`minimax.io\` | 32hex | seed |
|---|---|---|---|---|
| \`sk-cp-*\` | ✅ CN | — | — | \`MINIMAX_CN_API_KEY\` + \`MINIMAX_CN_BASE_URL\` |
| \`sk-cp-*\` | — | ✅ GLOBAL | — | \`MINIMAX_API_KEY\` + \`MINIMAX_BASE_URL\` |
| 32hex / 32hex.32hex | — | — | ✅ | \`ZAI_ANTHROPIC_FALLBACK_KEY\` + \`GLM_API_KEY\` |
| autre \`sk-*\` | n/a | n/a | n/a | rien (laisser \`ANTHROPIC_AUTH_TOKEN\` comme fallback) |

L'utilisateur n'a qu'à mettre \`ANTHROPIC_AUTH_TOKEN\` + \`ANTHROPIC_BASE_URL\`
dans son settings.json — le runner fait le reste.

---

### 3️⃣ RETRY AUTOMATIQUE SUR ERREUR (ClaudeRunner + KiloRunner)

Quand une erreur se produit, Overmind peut RETENTER automatiquement avec
des tokens de secours.

**Erreurs retryables :** 401, 429, 500, 502, 503.

**Flow :** Token primaire → \`AUTH_FALLBACK_1\` → \`AUTH_FALLBACK_2\` → \`AUTH_FALLBACK_3\` → ÉCHEC

---

### ⚠️ RÈGLES IMPORTANTES

- Les clés \`AUTH_FALLBACK_1\`, \`AUTH_FALLBACK_2\`, \`AUTH_FALLBACK_3\` sont réservées
  par Overmind pour le retry automatique.
- La substitution est à **un seul niveau** : \`$MINIMAXI_API_KEY\` est remplacé,
  mais pas récursivement.
- Les tokens sont résolus **avant** le spawn de l'agent.
- Pour Hermes, le token \`ANTHROPIC_AUTH_TOKEN_5\` (sk-cp-*) a été testé OK sur
  \`api.minimaxi.com\` mais le compte a un **HTTP 402 "insufficient balance"**
  au moment de ce guide — utiliser plutôt \`_1\`, \`_2\`, ou \`_7\`.
- \`_3\` et \`_6\` sont morts (HTTP 401). \`_4\` est rate-limited. \`_E\`, \`_F\`,
  \`_Y\` sont au format Z.AI (32hex).`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
