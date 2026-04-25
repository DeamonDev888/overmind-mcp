import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CLIInfo {
  name: string;
  command: string;
  versionCmd?: string;
  installCmd: string;
  url: string;
  requiredVersion?: string;
}

export const CLIS_METADATA: Record<string, CLIInfo> = {
  claude: {
    name: 'Claude Code',
    command: 'claude',
    versionCmd: 'claude --version',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    url: 'https://www.npmjs.com/package/@anthropic-ai/claude-code'
  },
  kilo: {
    name: 'Kilo Code',
    command: 'kilo',
    versionCmd: 'kilo --version',
    installCmd: 'npm install -g kilo-auto',
    url: 'https://github.com/Kilo-Org/kilocode',
    requiredVersion: '7.2.14'
  },
  qwencli: {
    name: 'Qwen Code CLI',
    command: 'qwen',
    versionCmd: 'qwen --version',
    installCmd: 'npm install -g @qwen-code/qwen-code',
    url: 'https://www.npmjs.com/package/@qwen-code/qwen-code'
  },
  hermes: {
    name: 'Hermes Agent',
    command: 'hermes',
    versionCmd: 'hermes --version',
    installCmd: 'pip install git+https://github.com/NousResearch/hermes-agent.git',
    url: 'https://github.com/NousResearch/hermes-agent'
  },
  gemini: {
    name: 'Gemini CLI',
    command: 'gemini',
    versionCmd: 'gemini --version',
    installCmd: 'npm install -g @google/gemini-cli',
    url: 'https://github.com/google/gemini-cli'
  },
  openclaw: {
    name: 'OpenClaw',
    command: 'openclaw',
    versionCmd: 'openclaw --version',
    installCmd: 'npm install -g openclaw',
    url: 'https://github.com/OpenClaw/OpenClaw'
  },
  cline: {
    name: 'Cline CLI',
    command: 'cline',
    versionCmd: 'cline --version',
    installCmd: 'npm install -g cline',
    url: 'https://github.com/cline/cline'
  },
  opencode: {
    name: 'OpenCode',
    command: 'opencode',
    versionCmd: 'opencode --version',
    installCmd: 'npm install -g opencode',
    url: 'https://github.com/OpenCode/OpenCode'
  },
  trae: {
    name: 'Trae CLI',
    command: 'trae',
    versionCmd: 'trae --version',
    installCmd: 'https://www.trae.ai/download',
    url: 'https://www.trae.ai/'
  }
};

export async function verifyInstallation(runnerKey: string): Promise<{ ok: boolean; message?: string }> {
  const meta = CLIS_METADATA[runnerKey];
  if (!meta) return { ok: true }; // No meta, assume ok or handled elsewhere

  try {
    // Check if command exists
    const checkCmd = process.platform === 'win32' ? `where ${meta.command}` : `which ${meta.command}`;
    await execAsync(checkCmd);

    // Check version if required
    if (meta.requiredVersion && meta.versionCmd) {
      try {
        const { stdout } = await execAsync(meta.versionCmd);
        const version = stdout.trim();
        if (!version.includes(meta.requiredVersion) && !version.startsWith(meta.requiredVersion.split('.')[0])) {
          return {
            ok: false,
            message: `⚠️ **Version Incorrecte pour ${meta.name}** : détectée ${version} (Attendu: ${meta.requiredVersion})\n\n` +
                     `Veuillez mettre à jour le CLI pour garantir la compatibilité :\n` +
                     `\`${meta.installCmd}\`\n\n` +
                     `Plus d'infos : ${meta.url}`
          };
        }
      } catch (_verErr) {
        // Version check failed but CLI exists, maybe just warn?
        console.error(`[InstallHelper] Warning: Could not check version for ${meta.name}`);
      }
    }

    return { ok: true };
  } catch (_err) {
    return {
      ok: false,
      message: `❌ **${meta.name} n'est pas installé !**\n\n` +
               `Le CLI demandé est introuvable sur votre système.\n\n` +
               `**Comment l'installer :**\n` +
               `1. Exécutez : \`${meta.installCmd}\`\n` +
               `2. Ou téléchargez le kit ici : ${meta.url}\n\n` +
               `Une fois installé, redémarrez votre terminal ou le serveur MCP.`
    };
  }
}
