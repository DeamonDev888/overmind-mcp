import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z
    .enum(['glm', 'minimax', 'openrouter'])
    .describe('Le fournisseur pour lequel vous voulez un exemple de configuration.'),
});

export async function configExample(args: z.infer<typeof configExampleSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
}> {
  const { provider } = args;
  let text = '';

  switch (provider) {
    case 'glm':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR GLM / Z.AI (ANTHROPIC PROXY)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "Nom_Ou_Surnom_Agent", // L'identifiant / Surnom original de l'agent
    "ANTHROPIC_AUTH_TOKEN": "VOTRE_TOKEN_Z_AI",
    "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.6",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-4.7",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-4.7",
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

### 📂 .mcp.[nom_agent].json
\`\`\`json
{
  "mcpServers": {
    "postgresql-server": {
      "command": "node",
      "args": ["chemin/serveur_PostGreSQL/dist/index.js"]
    },
    "memory": {
      "command": "node",
      "args": ["chemin/Workflow/dist/bin/cli.js", "--memory-only"]
    },
    "x-mcp-server": {
      "command": "node",
      "args": ["chemin/X/dist/src/server.js"]
    }
  }
}
\`\`\`

💡 *Note: Le fichier .mcp.[nom].json doit être placé directement dans le dossier .claude/.*`;
      break;
    case 'minimax':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR MINIMAX (VIA PROXY ANTHROPIC)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "VOTRE_TOKEN_MINIMAX",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "The_Chaos_Prophet", // Exemple de surnom original
    "ANTHROPIC_SMALL_FAST_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "MiniMax-M2",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "MiniMax-M2"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [
    "postgresql-server",
    "news-server"
  ],
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`

### 📂 .mcp.[nom_agent].json
\`\`\`json
{
  "mcpServers": {
    "postgresql-server": {
      "command": "node",
      "args": ["chemin/serveur_PostGreSQL/dist/index.js"]
    },
    "news-server": {
      "command": "node",
      "args": ["chemin/NEWS/dist/src/server.js"]
    },
    "memory": {
      "command": "node",
      "args": ["chemin/Workflow/dist/bin/cli.js", "--memory-only"]
    },
    "x-mcp-server": {
      "command": "node",
      "args": ["chemin/X/dist/src/server.js"]
    }
  }
}
\`\`\`

💡 *Note: Ce fichier permet d'isoler les serveurs MCP accessibles précisément par cet agent.*`;
      break;
    case 'openrouter':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR OPENROUTER (VIA PROXY ANTHROPIC)**

### 📂 settings_[nom_agent].json
\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-VOTRE_KEY",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "Satoshi's_Ear", // Exemple de surnom original
    "ANTHROPIC_SMALL_FAST_MODEL": "anthropic/claude-3-haiku",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "anthropic/claude-3-5-sonnet",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic/claude-3-opus",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic/claude-3-haiku"
  },
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [
    "postgresql-server",
    "news-server"
  ],
  "agent": "nom_agent",
  "runner": "claude"
}
\`\`\`

### 📂 .mcp.[nom_agent].json
\`\`\`json
{
  "mcpServers": {
    "postgresql-server": {
      "command": "node",
      "args": ["chemin/serveur_PostGreSQL/dist/index.js"]
    },
    "news-server": {
      "command": "node",
      "args": ["chemin/NEWS/dist/src/server.js"]
    },
    "memory": {
      "command": "node",
      "args": ["chemin/Workflow/dist/bin/cli.js", "--memory-only"]
    },
    "x-mcp-server": {
      "command": "node",
      "args": ["chemin/X/dist/src/server.js"]
    }
  }
}
\`\`\`

*Note: OpenRouter nécessite le préfixe du fournisseur (ex: anthropic/...).*`;
      break;
  }

  return {
    content: [{ type: 'text', text }],
  };
}
