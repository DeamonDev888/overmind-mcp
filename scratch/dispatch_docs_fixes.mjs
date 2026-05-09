// Delegue 2 corrections docs/ en parallele a 2 agents.
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
    agentName: 'minimax_1',
    taskId: 'fix-docs-css',
    autoResume: true,
    silent: true,
    prompt: `
TACHE PRECISE — corriger UN seul fichier:
  docs/styles.css

DIAGNOSTIC:
- Ligne 1616: '@media (max-width: 768px) {'
- Ligne 1672: '}'   <-- FERME LA @media TROP TOT (orphelin)
- Lignes 1674-1717: regles (.hero-title, .section-title, .features-grid, .install-tabs, .footer-content) qui DEVRAIENT etre INSIDE la @media
- Ligne 1718: '}'   <-- C est CE '}' qui devrait fermer la @media

FIX: SUPPRIMER UNIQUEMENT la ligne 1672 ('}' orphelin qui ferme la media query trop tot).
Apres suppression, le fichier sera correctement structure: @media a 1615 ferme par '}' a 1717.

VALIDATION:
1) pnpm exec prettier --check docs/styles.css doit passer SANS erreur de syntaxe
2) NE PAS retoucher d autres lignes ni reformatter le reste du fichier

Reponds en UNE phrase: "OK styles.css ligne 1672 supprimee, prettier OK" ou "ECHEC: <raison>".
`.trim(),
  },
  {
    runner: 'claude',
    agentName: 'minimax_2',
    taskId: 'fix-docs-html',
    autoResume: true,
    silent: true,
    prompt: `
TACHE PRECISE — corriger UN seul fichier:
  docs/index.html

DIAGNOSTIC PRETTIER:
  docs/index.html: SyntaxError: Unexpected closing tag "div" (507:5)
  Contexte autour ligne 505-510:
    505:         </div>
    506:       </footer>
    507:     </div>     <-- '</div>' EN TROP selon prettier
    508:
    509:     <!-- SVG Visual Effects Definitions -->

ACTION DEMANDEE:
1) Lire le fichier autour des lignes 480-520 ET autour des lignes 1-30 pour comprendre la structure d ouverture (combien de <div> englobants).
2) Compter mentalement les <div> ouverts vs fermes entre la fin du <body> et la ligne 507.
3) Si le '</div>' a 507 est effectivement orphelin (pas de <div> englobant ouvert): supprimer cette ligne 507.
4) Si en revanche le HTML attend ce </div> mais avec une autre structure: trouver le bon fix minimaliste.

VALIDATION:
- Apres correction, executer: pnpm exec prettier --check docs/index.html
- Doit passer SANS erreur (ou simplement signaler 'would format' qui est OK).
- NE PAS reformatter manuellement tout le fichier, juste la correction structurelle.

Reponds en UNE phrase: "OK index.html corrige ligne X, prettier OK" ou "ECHEC: <raison>".
`.trim(),
  },
];

console.log(`Delegation 2 fixes docs/ en parallele...\n`);
const t0 = Date.now();
const result = await dispatchAgents(agents, { waitAll: true });
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

console.log(`\n=== Termine en ${elapsed}s ===\n`);
console.log(result.content[0].text);
