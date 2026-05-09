// Test du parallelisme via dispatchAgents() — 4 agents Minimax sur des taches
// de maintenance lecture-seule du repo. Aucun ecrit, aucun secret expose.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const { dispatchAgents } = await import('../dist/lib/orchestration/dispatcher.js');

const baseAgent = (agentName, prompt, taskId) => ({
  runner: 'claude',
  agentName,
  prompt,
  autoResume: true,
  silent: true,
  taskId,
});

const agents = [
  baseAgent(
    'minimax_1',
    'Tache maintenance: combien de fichiers .ts trouves-tu dans le dossier src/ (recursif) ? Reponds en UNE phrase courte avec le nombre.',
    'count-ts-files',
  ),
  baseAgent(
    'minimax_2',
    'Tache maintenance: ouvre package.json a la racine et donne-moi UNIQUEMENT la valeur du champ version. Reponse en une seule ligne.',
    'read-version',
  ),
  baseAgent(
    'minimax_3',
    'Tache maintenance: regarde la premiere section #### du CHANGELOG.md (la plus recente). Donne-moi son numero de version et la date entre parentheses, en une seule ligne.',
    'changelog-head',
  ),
  baseAgent(
    'minimax_4',
    "Tache maintenance: cherche les TODO ou FIXME dans src/lib/. Reponds en UNE phrase: 'X TODO/FIXME trouves' ou '0 TODO/FIXME'.",
    'scan-todos',
  ),
];

console.log(`Lancement de ${agents.length} agents en parallele (waitAll=true)…\n`);
const t0 = Date.now();
const result = await dispatchAgents(agents, { waitAll: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Termine en ${elapsed}s ===\n`);
console.log(result.content[0].text);
