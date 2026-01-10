import { z } from 'zod';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { CONFIG, resolveConfigPath } from '../lib/config.js';

import { getLastSessionId, saveSessionId } from '../lib/sessions.js';

export const runAgentSchema = z.object({
    prompt: z.string().describe("Le prompt à envoyer à l'agent"),
    sessionId: z.string().optional().describe("ID de session pour continuer une conversation (manuel)"),
    agentName: z.string().optional().describe("Nom de l'agent (pour logging/monitoring et persistance)"),
    autoResume: z.boolean().optional().default(false).describe("Si true (et agentName fourni), reprend automatiquement la dernière conversation de cet agent")
});

export async function runClaudeAgent(args: z.infer<typeof runAgentSchema>): Promise<any> {
    let { prompt, sessionId, agentName, autoResume } = args;
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
        const specificSettingsPath = resolveConfigPath(path.join(settingsDir, `settings_${agentName}.json`));
        settingsPath = specificSettingsPath;
    }

    const mcpPath = resolveConfigPath(PATHS.MCP);
    const safePath = (p: string) => p.includes(' ') ? `"${p}"` : p;

    let command = `claude ${CORE} ${PERMISSIONS} --settings ${safePath(settingsPath)} --mcp-config ${safePath(mcpPath)}`;
    
    if (sessionId) {
        command += ` --resume ${sessionId}`;
    }

    console.error(`🚀 Exec Claude (${agentName || 'default'}): ${command.substring(0, 100)}...`); 

    return new Promise((resolve, reject) => {
        const child: ChildProcess = spawn(command, [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
            shell: true
        });

        let stdout = '';
        let stderr = '';

        if (child.stdout) {
            child.stdout.on('data', (d: Buffer) => stdout += d.toString());
        }
        if (child.stderr) {
            child.stderr.on('data', (d: Buffer) => stderr += d.toString());
        }

        const timeout = setTimeout(() => {
            child.kill();
            reject(new Error(`Timeout (${CONFIG.TIMEOUT_MS}ms)`));
        }, CONFIG.TIMEOUT_MS);

        child.on('close', async (code: number | null) => {
            clearTimeout(timeout);

            if (code !== 0) {
                console.error("⚠️ Stderr:", stderr);
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
                        { type: 'text', text: `SESSION_ID: ${response.session_id}` } 
                    ]
                });
            } catch (e) {
                resolve({
                    content: [{ type: 'text', text: stdout.trim() }],
                    isError: false
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
