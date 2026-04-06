import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z.enum(['glm', 'minimax', 'openrouter']).describe("Le fournisseur pour lequel vous voulez un exemple de configuration."),
});

export async function configExample(args: z.infer<typeof configExampleSchema>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
}> {
  const { provider } = args;
  let text = '';

  switch (provider) {
    case 'glm':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR GLM / Z.AI (ANTHROPIC PROXY)**

\`\`\`json
{
  "env": {
    "ANTHROPIC_MODEL": "claude-3-5-sonnet-20241022",
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

💡 *Note: Cette configuration permet d'utiliser les modèles GLM via l'interface de Claude Code.*`;
      break;
    case 'minimax':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR MINIMAX (VIA PROXY ANTHROPIC)**

\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.minimax.io/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "VOTRE_TOKEN_MINIMAX",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "Agent_Name",
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

💡 *Note: Cette configuration utilise MiniMax-M2 comme modèle par défaut pour toutes les catégories (Sonnet, Opus, Haiku).*`;
      break;
    case 'openrouter':
      text = `🚀 **EXEMPLE DE CONFIGURATION POUR OPENROUTER (VIA PROXY ANTHROPIC)**

\`\`\`json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://openrouter.ai/api/v1",
    "ANTHROPIC_AUTH_TOKEN": "sk-or-v1-VOTRE_KEY",
    "API_TIMEOUT_MS": "3000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": 1,
    "ANTHROPIC_MODEL": "anthropic/claude-3.5-sonnet",
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

💡 *Note: OpenRouter nécessite le préfixe du fournisseur (ex: anthropic/...) et supporte CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC.*`;
      break;
  }

  return {
    content: [{ type: 'text', text }],
  };
}
