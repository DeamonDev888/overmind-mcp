// Dispatche 3 corrections OOM/ASYNC en parallele aux agents minimax via dispatchAgents().
// Chaque agent a UN seul fichier a modifier — aucun conflit possible.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const { dispatchAgents } = await import('../dist/lib/orchestration/dispatcher.js');

const REFERENCE_PATTERN = `
REFERENCE — pattern deja present dans src/services/OpenClawRunner.ts (lignes 88-107) :

  let stdout = '';
  let stderr = '';
  const MAX_BUF = 10 * 1024 * 1024;

  if (child.stdout)
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length + d.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
      else stdout += d.toString();
    });
  if (child.stderr)
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length + d.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
      else stderr += d.toString();
    });
`.trim();

const agents = [
  {
    runner: 'claude',
    agentName: 'minimax_1',
    taskId: 'OOM-Claude',
    autoResume: true,
    silent: true,
    prompt: `
TACHE PRECISE — modifier UN seul fichier:
  src/services/ClaudeRunner.ts

OBJECTIF: borner stdout/stderr a 10 Mo (MAX_BUF) pour eviter OOM.

ACTION DEMANDEE:
1) Lire ClaudeRunner.ts (chercher la zone ou 'currentStdout' et 'currentStderr' sont declarees, autour des lignes 270-280).
2) Juste apres leur declaration, ajouter:
   const MAX_BUF = 10 * 1024 * 1024;
3) Trouver les deux handlers (autour des lignes 354-372):
   currentChildRef.stdout.on('data', (d: Buffer) => { ... currentStdout += chunk; ... })
   currentChildRef.stderr.on('data', (d: Buffer) => { ... currentStderr += chunk; ... })
4) Remplacer "currentStdout += chunk;" par:
   if (currentStdout.length + chunk.length > MAX_BUF) currentStdout = currentStdout.slice(-MAX_BUF);
   else currentStdout += chunk;
5) Idem pour currentStderr.

NE RIEN CHANGER D'AUTRE. Conserver le 'process.stderr.write' de log si options.silent est faux. Lancer "pnpm run check-types" pour valider; si erreur, corriger.

${REFERENCE_PATTERN}

Reponds en UNE phrase: "OK ClaudeRunner cap 10MB applique" ou "ECHEC: <raison>".
`.trim(),
  },
  {
    runner: 'claude',
    agentName: 'minimax_2',
    taskId: 'OOM-Kilo',
    autoResume: true,
    silent: true,
    prompt: `
TACHE PRECISE — modifier UN seul fichier:
  src/services/KiloRunner.ts

OBJECTIF: borner currentStdout/currentStderr a 10 Mo (MAX_BUF) pour eviter OOM.

ACTION DEMANDEE:
1) Lire KiloRunner.ts (chercher 'let currentStdout' et 'let currentStderr', autour des lignes 275-276).
2) Juste apres ces declarations, ajouter:
   const MAX_BUF = 10 * 1024 * 1024;
3) Trouver le handler stdout (autour ligne 349-380) ou il y a:
     currentChild.stdout.on('data', (d: Buffer) => {
       const chunk = d.toString();
       currentStdout += chunk;
       ...parse JSON event...
     });
4) Remplacer "currentStdout += chunk;" par:
   if (currentStdout.length + chunk.length > MAX_BUF) currentStdout = currentStdout.slice(-MAX_BUF);
   else currentStdout += chunk;
5) Idem pour le handler stderr (autour ligne 384-388) avec "currentStderr += chunk;".

ATTENTION: ne pas toucher a la logique de parsing JSON ('lines.split', try/catch). Uniquement la ligne d'accumulation. Lancer "pnpm run check-types" pour valider.

${REFERENCE_PATTERN}

Reponds en UNE phrase: "OK KiloRunner cap 10MB applique" ou "ECHEC: <raison>".
`.trim(),
  },
  {
    runner: 'claude',
    agentName: 'minimax_3',
    taskId: 'OOM+ASYNC-Gemini',
    autoResume: true,
    silent: true,
    prompt: `
TACHE PRECISE — modifier UN seul fichier:
  src/services/GeminiRunner.ts

DEUX OBJECTIFS:
A) borner stdout/stderr a 10 Mo (OOM-1).
B) ajouter un helper cleanup() qui retire les listeners apres timeout/close (ASYNC-3).

ACTION DEMANDEE:
1) Lire GeminiRunner.ts. Trouver la zone autour des lignes 220-250 ou il y a:
     let stdout = '';
     let stderr = '';
     child.stdout?.on('data', (data) => { stdout += data.toString(); });
     child.stderr?.on('data', (data) => { stderr += data.toString(); });
     const timeout = setTimeout(() => { child.kill(); ... }, this.timeoutMs);
     child.on('error', ...);
     child.on('close', ...);

2) Juste apres "let stderr = '';", ajouter:
   const MAX_BUF = 10 * 1024 * 1024;
   const cleanup = () => {
     child.stdout?.removeAllListeners();
     child.stderr?.removeAllListeners();
     child.removeAllListeners();
   };

3) Modifier les 2 handlers data:
     child.stdout?.on('data', (data) => {
       const d = data.toString();
       if (stdout.length + d.length > MAX_BUF) stdout = stdout.slice(-MAX_BUF);
       else stdout += d;
     });
     child.stderr?.on('data', (data) => {
       const d = data.toString();
       if (stderr.length + d.length > MAX_BUF) stderr = stderr.slice(-MAX_BUF);
       else stderr += d;
     });

4) Dans le callback timeout (apres "if (!child.killed) child.kill('SIGKILL')"), AVANT le safeResolve, ajouter "cleanup();".
5) Dans le callback close, juste apres "clearTimeout(timeout);", ajouter "cleanup();".

NE PAS toucher au reste (parsing JSON, OAuth, etc.). Lancer "pnpm run check-types" pour valider.

${REFERENCE_PATTERN}

Reponds en UNE phrase: "OK GeminiRunner cap+cleanup applique" ou "ECHEC: <raison>".
`.trim(),
  },
];

console.log(`Lancement de ${agents.length} agents en parallele (waitAll=true)...\n`);
const t0 = Date.now();
const result = await dispatchAgents(agents, { waitAll: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Termine en ${elapsed}s ===\n`);
console.log(result.content[0].text);
