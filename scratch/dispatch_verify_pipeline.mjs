// Delegue a UN agent la pipeline complete de verification (sans bump, sans publish).
// Build + lint + format + check-types + tests unitaires. Rapport PASS/FAIL par etape.
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const { dispatchAgents } = await import('../dist/lib/orchestration/dispatcher.js');

const agents = [
  {
    runner: 'claude',
    agentName: 'minimax_4',
    taskId: 'verify-pipeline',
    autoResume: false,
    silent: true,
    prompt: `
TACHE: executer la pipeline de verification du repo overmind-mcp et rapporter PASS/FAIL pour chaque etape.

Tu travailles dans le repo a la racine. Execute exactement ces 5 commandes, dans cet ORDRE, en lisant la sortie pour decider PASS/FAIL:

  1) pnpm run format          (Prettier --write doit reussir; tolerer 0 erreur)
  2) pnpm run lint            (ESLint . - aucune erreur attendue)
  3) pnpm run check-types     (tsc --noEmit - aucune erreur attendue)
  4) pnpm test                (Vitest run - 0 tests qui echouent)
  5) pnpm run build           (tsc - dist/ regenere sans erreur)

REGLES STRICTES:
- NE PAS modifier le code source. Si format change des fichiers, c est attendu (prettier).
- NE PAS toucher a package.json (pas de bump).
- NE PAS faire git commit, git push, ni npm publish.
- Si une commande echoue, reporter FAIL avec la 1ere erreur (extrait court) et arreter la pipeline.

FORMAT DE REPONSE (obligatoire, une ligne par etape):
[1] format       : PASS | FAIL <raison courte>
[2] lint         : PASS | FAIL <raison courte>
[3] check-types  : PASS | FAIL <raison courte>
[4] tests        : PASS (X passing) | FAIL <raison>
[5] build        : PASS | FAIL <raison>

VERDICT: <ALL GREEN | BLOCKED at step N>
`.trim(),
  },
];

console.log('Delegation pipeline verification a 1 agent (claude/minimax_4)...\n');
const t0 = Date.now();
const result = await dispatchAgents(agents, { waitAll: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Termine en ${elapsed}s ===\n`);
console.log(result.content[0].text);
