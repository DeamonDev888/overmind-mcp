import { z } from 'zod';

export const configExampleSchema = z.object({
  provider: z
    .enum(['glm', 'minimax', 'openrouter', 'ilmu', 'minimaxi'])
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
  }

  return {
    content: [{ type: 'text' as const, text }],
  };
}
