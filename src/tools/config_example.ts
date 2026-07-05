import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z
    .enum([
      'glm',
      'openrouter',
      'anthropic',
      'overmind',
      'hermes-minimax-cn',
      'hermes-minimax-global',
      'hermes-zai',
      'hermes-anthropic',
    ])
    .describe('Le fournisseur pour lequel vous voulez un exemple de configuration.'),
});

/**
 * config_example tool — templates de configuration pour v3.3.
 *
 * Architecture v3.3:
 *   ~/.overmind/hermes/profiles/<name>/
 *     ├── config.yaml   (provider, model, mcp_servers)
 *     ├── .env          (credentials)
 *     ├── SOUL.md       (system prompt + bloc Mémoire Overmind injecté)
 *     ├── memories/
 *     ├── sessions/
 *     └── skills/
 *
 * MCP servers:
 *   'overmind' = :3099 (14 tools complet)
 *   'memory'   = :3098 (--memory-only, 3 tools)
 *   'postgres' = :5433 (10 tools DB)
 *
 * OVERMIND_AGENT_NAME est injecté par HermesRunner dans le child env.
 * L'isolation mémoire DB (agent_<name>) est automatique.
 */
export async function configExample(args: z.infer<typeof configExampleSchema>) {
  const { provider } = args;
  let text = '';

  const layout = `
### 🌳 Arborescence v3.3 (générée par create_agent)

\`\`\`
~/.overmind/hermes/profiles/<agent>/
├── config.yaml          ← provider + model + mcp_servers
├── .env                 ← credentials LLM
├── SOUL.md              ← system prompt + bloc Mémoire Overmind
├── memories/            ← Hermes native memory
├── sessions/            ← conversation history
└── skills/              ← procedural memory

~/.overmind/
├── .env                 ← PostgreSQL + global config
├── .mcp.json            ← MCP servers (overmind, postgres, etc.)
└── bridge/
    └── agents.json      ← sessions registry
\`\`\`

### 🔧 MCP servers disponibles

| Nom | Port | Tools | Usage |
|-----|------|-------|-------|
| \`overmind\` | :3099 | 14 | Orchestration complète + mémoire |
| \`memory\` | :3098 | 3 | Mémoire seule (--memory-only) |
| \`postgres\` | :5433 | 10 | PostgreSQL direct (vector, SQL) |
`;

  switch (provider) {
    // ═══════════════════════════════════════════════════════════════════
    // HERMES v3.3 — config.yaml format
    // ═══════════════════════════════════════════════════════════════════
    case 'hermes-minimax-cn':
      text = `🇨🇳 **HERMES + MINIMAX CN** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: minimax-cn
  model: MiniMax-M3

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env (credentials)
\`\`\`bash
MINIMAX_CN_API_KEY=sk-cp-...
MINIMAX_CN_BASE_URL=https://api.minimaxi.com/anthropic
\`\`\`

### 📂 SOUL.md
Le bloc **## Mémoire Overmind** est injecté automatiquement par create_agent.
${layout}`;
      break;

    case 'hermes-minimax-global':
      text = `🌍 **HERMES + MINIMAX GLOBAL** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: minimax
  model: MiniMax-M3

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env
\`\`\`bash
MINIMAX_API_KEY=sk-cp-...
\`\`\`

Différence vs CN: URL \`api.minimax.io\` (sans le \`i\`).
${layout}`;
      break;

    case 'hermes-zai':
      text = `🤖 **HERMES + Z.AI / GLM** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: zai
  model: glm-5.1

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env
\`\`\`bash
GLM_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy
\`\`\`

Token Z.AI = 32hex ou 32hex.32hex.
${layout}`;
      break;

    case 'hermes-anthropic':
      text = `🅰️ **HERMES + ANTHROPIC OFFICIEL** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: anthropic
  model: claude-sonnet-4-6

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env
\`\`\`bash
ANTHROPIC_API_KEY=sk-ant-...
\`\`\`
${layout}`;
      break;

    // ═══════════════════════════════════════════════════════════════════
    // LEGACY: ClaudeRunner / KiloRunner
    // ═══════════════════════════════════════════════════════════════════
    case 'glm':
      text = `🚀 **GLM / Z.AI (CLAUDE RUNNER)** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: zai
  model: glm-5.1

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env
\`\`\`bash
ANTHROPIC_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic
\`\`\`

> Pour le runner Hermes (préféré), utilisez \`hermes-zai\`.
${layout}`;
      break;

    case 'anthropic':
      text = `🅰️ **CLAUDE RUNNER + ANTHROPIC** (v3.3)

### 📂 config.yaml
\`\`\`yaml
model:
  provider: anthropic
  model: claude-sonnet-4-6

mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
\`\`\`

### 📂 .env
\`\`\`bash
ANTHROPIC_API_KEY=sk-ant-...
\`\`\`
${layout}`;
      break;

    case 'openrouter':
      text = `⚠️ **OPENROUTER = EMBEDDINGS UNIQUEMENT** (convention v3.3)

OpenRouter ne doit PAS être utilisé pour l'inférence LLM.
Utilisé uniquement pour \`OVERMIND_EMBEDDING_KEY\` (Qwen3 Embedding 8B).

\`\`\`bash
# Dans ~/.overmind/.env
OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
OVERMIND_EMBEDDING_KEY=sk-or-v1-...
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OVERMIND_EMBEDDING_DIMENSIONS=4096
\`\`\`

Pour le LLM, utilisez \`hermes-minimax-cn\` ou \`hermes-zai\`.`;
      break;

    // ═══════════════════════════════════════════════════════════════════
    // OVERMIND: guide complet
    // ═══════════════════════════════════════════════════════════════════
    case 'overmind':
      text = `🎯 **GUIDE COMPLET OVERMIND v3.3**

### Création d'un agent

\`\`\`
create_agent(
  name: "mon_agent",
  runner: "hermes",
  model: "MiniMax-M3",
  prompt: "Tu es un expert en..."
)
\`\`\`

create_agent fait automatiquement:
1. Crée le profil Hermes \`~/.overmind/hermes/profiles/mon_agent/\`
2. Détecte le provider depuis le model (MiniMax→minimax-cn, glm→zai, etc.)
3. Configure config.yaml avec provider + model + mcp_servers.overmind
4. Écrit .env avec les credentials
5. Écrit SOUL.md avec le prompt + bloc **## Mémoire Overmind**

### Isolation mémoire automatique

- HermesRunner injecte \`OVERMIND_AGENT_NAME=mon_agent\` dans l'env du child
- \`memory_search\` / \`memory_store\` lisent \`process.env.OVERMIND_AGENT_NAME\`
- PostgresMemoryProvider crée une DB isolée: \`agent_mon_agent\`
- Un agent ne peut PAS voir la mémoire d'un autre agent

### Détection automatique du provider

| Model contient | Provider détecté |
|----------------|------------------|
| minimax, m3    | minimax-cn       |
| glm, zai       | zai              |
| claude, sonnet | anthropic        |
| gpt            | openai           |
| gemini         | gemini           |
| deepseek       | deepseek         |
| kimi, moonshot | kimi-coding      |
| qwen           | alibaba          |
| grok, xai      | xai              |
| (autre)        | openrouter       |

### MCP servers

- **overmind** (:3099) = 14 tools (run_agent, memory_*, create_agent, etc.)
- **memory** (:3098) = 3 tools restreints (--memory-only)
- **postgres** (:5433) = 10 tools (SQL direct, vector search)

Pour restreindre un agent à la mémoire seule, remplacer \`overmind\` par \`memory\`
dans le config.yaml du profil et lancer un daemon :3098 avec \`--memory-only\`.`;
      break;
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
