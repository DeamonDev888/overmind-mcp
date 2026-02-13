import { z } from 'zod';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { CONFIG, resolveConfigPath } from '../lib/config.js';

import { getLastSessionId, saveSessionId } from '../lib/sessions.js';

// export const runAgentSchema = z.object({
//     prompt: z.string().describe("Le prompt à envoyer à l'agent"),
//     sessionId: z.string().optional().describe("ID de session pour continuer une conversation (manuel)"),
//     agentName: z.string().optional().describe("Nom de l'agent (pour logging/monitoring et persistance)"),
//     autoResume: z.boolean().optional().default(false).describe("Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent")
// });

export const runAgentSchema = z.object({
  prompt: z.string().describe("Le prompt à envoyer à l'agent"),
  sessionId: z
    .string()
    .optional()
    .describe('ID de session pour continuer une conversation (manuel)'),
  agentName: z
    .string()
    .optional()
    .describe("Nom de l'agent (pour logging/monitoring et persistance)"),
  autoResume: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent',
    ),
});

export async function runClaudeAgent(args: z.infer<typeof runAgentSchema>): Promise<any> {
  const { prompt, agentName, autoResume } = args;
  let { sessionId } = args;
  const { CORE, PERMISSIONS, PATHS } = CONFIG.CLAUDE;

  // --- Gestion Automatique de Session ---
  if (autoResume && agentName && !sessionId) {
    const lastId = await getLastSessionId(agentName);
    if (lastId) {
      sessionId = lastId;
      console.error(`🔄 Auto-Resuming session: ${sessionId} for agent ${agentName}`);
    }
  }

  let settingsPath = resolveConfigPath(PATHS.SETTINGS);

  // Si un nom d'agent est fourni, essayer d'utiliser sa config spécifique
  if (agentName) {
    const settingsDir = path.dirname(PATHS.SETTINGS);
    const specificSettingsPath = resolveConfigPath(
      path.join(settingsDir, `settings_${agentName}.json`),
    );

    if (!fs.existsSync(specificSettingsPath)) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ **Erreur Configuration Agent**\n\nL'agent '${agentName}' est introuvable ou mal configuré.\nFichier attendu: ${specificSettingsPath}\n\n💡 **Solution:**\nUtilisez l'outil \`create_agent\` pour créer cet agent avant de l'exécuter.`,
          },
        ],
        isError: true,
      };
    }
    settingsPath = specificSettingsPath;
  }

  const cwd = process.cwd();

  // --- FIX: PATHS WITH SPACES ---
  // Absolute paths containing spaces (e.g. "Serveur MCP") cause "Settings file not found" errors
  // with the 'claude' CLI command, even when quoted on Windows.
  // SOLUTION: We convert to relative paths (starting with ./) which avoids full path quoting issues.

  // Convert to relative path if possible to avoid quoting issues with spaces
  const relativeSettings = path.relative(cwd, settingsPath);
  if (!relativeSettings.startsWith('..') && !path.isAbsolute(relativeSettings)) {
    settingsPath = relativeSettings.startsWith('./') ? relativeSettings : `./${relativeSettings}`;
  }

  let mcpPath = resolveConfigPath(PATHS.MCP);

  // --- Isolation MCP Mode ---
  if (agentName) {
    try {
      const agentSettingsPath = resolveConfigPath(
        path.join(path.dirname(PATHS.SETTINGS), `settings_${agentName}.json`),
      );
      if (fs.existsSync(agentSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(agentSettingsPath, 'utf8'));
        // Si l'isolation est demandée (false) et qu'une liste est fournie
        if (
          settings.enableAllProjectMcpServers === false &&
          Array.isArray(settings.enabledMcpjsonServers)
        ) {
          if (fs.existsSync(mcpPath)) {
            const fullMcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
            const filteredMcp = { mcpServers: {} as any };

            for (const serverName of settings.enabledMcpjsonServers) {
              if (fullMcp.mcpServers && fullMcp.mcpServers[serverName]) {
                filteredMcp.mcpServers[serverName] = fullMcp.mcpServers[serverName];
              }
            }

            // Créer un fichier de config temporaire par agent
            const tmpMcpPath = path.join(
              path.dirname(agentSettingsPath),
              `mcp_${agentName}_tmp.json`,
            );
            fs.writeFileSync(tmpMcpPath, JSON.stringify(filteredMcp, null, 2));
            mcpPath = tmpMcpPath;
            console.error(`🛡️ MCP Isolated for ${agentName}: Using filtered config.`);
          }
        }
      }
    } catch (e) {
      console.error(`⚠️ Failed to isolate MCP for ${agentName}:`, e);
    }
  }

  const relativeMcp = path.relative(cwd, mcpPath);
  if (!relativeMcp.startsWith('..') && !path.isAbsolute(relativeMcp)) {
    mcpPath = relativeMcp.startsWith('./') ? relativeMcp : `./${relativeMcp}`;
  }

  const safePath = (p: string) => (p.includes(' ') ? `"${p}"` : p);

  let command = `claude ${CORE} ${PERMISSIONS} --settings ${safePath(settingsPath)} --mcp-config ${safePath(mcpPath)}`;

  if (sessionId) {
    command += ` --resume ${sessionId}`;
  }

  console.error(`🚀 Exec Claude (${agentName || 'default'}): ${command.substring(0, 100)}...`);

  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      shell: true,
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    }
    if (child.stderr) {
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    }

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout (${CONFIG.TIMEOUT_MS}ms)`));
    }, CONFIG.TIMEOUT_MS);

    child.on('close', async (code: number | null) => {
      clearTimeout(timeout);

      if (code !== 0) {
        console.error('⚠️ Stderr:', stderr);
        // On accepte certains codes d'erreur si stdout contient du JSON valide (cas limites)
        if (!stdout) return reject(new Error(stderr || `Exit code ${code}`));
      }

      try {
        // Claude returns JSON { type: 'result', content: '...', session_id: '...' }
        const response = JSON.parse(stdout.trim());

        // Sauvegarde de la session si autoResume est actif
        if (agentName && response.session_id) {
          // Sauvegarde inconditionnelle pour permettre la reprise future
          // (Même si autoResume était false sur ce coup, on sauve l'ID pour le futur)
          await saveSessionId(agentName, response.session_id);
        }

        resolve({
          content: [
            { type: 'text', text: response.result || JSON.stringify(response) },
            // On renvoie l'ID pour info, utile pour le debug ou le suivi manuel
            { type: 'text', text: `SESSION_ID: ${response.session_id}` },
          ],
        });
      } catch (error: unknown) {
        const e = error as Error;
        // Guide détaillé pour le LLM en cas d'erreur de format
        const preview = stdout.trim().substring(0, 500);
        resolve({
          content: [
            {
              type: 'text',
              text: `⚠️ **Réponse Agent Non-Conforme (JSON invalide)**\n\nL'agent '${agentName || 'default'}' a répondu, mais le format JSON est cassé.\n\n❌ **Erreur Parsing:** ${e.message}\n\n🔍 **Début de la réponse reçue:**\n\`\`\`text\n${preview}...\n\`\`\`\n\n💡 **Conseil:** Vérifiez que le prompt demande explicitement une sortie JSON pure.`,
            },
          ],
          isError: true,
        });
      }
    });

    child.on('error', (err: Error) => reject(err));

    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}
