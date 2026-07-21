/**
 * OverMind-MCP Server
 * ====================
 *
 * Ce fichier enregistre les 14 outils MCP du serveur Overmind.
 *
 * ─── ARCHITECTURE ───────────────────────────────────────────────────────────
 *
 * CHAQUE OUTIL MCP VIT DANS SON PROPRE FICHIER sous src/tools/.
 * Cela garantit :
 *   - Maintenabilité : un outil = un fichier, pas de fichier fourre-tout
 *   - Testabilité  : chaque outil peut être importé et testé isolément
 *   - Lisibilité  : server.ts reste un index lisible, pas 500 lignes de code
 *   - DX          : retrouver un tool = grep src/tools/, pas explorer 2000 lignes
 *
 * Convention de nommage :
 *   src/tools/<nom_du_tool>.ts     → contient le schéma Zod ET la fonction execute
 *   src/tools/run_<runner>.ts     → implémentation par runner (pas des outils MCP)
 *
 * Ajout d'un nouvel outil :
 *   1. Créer src/tools/<nom>.ts   → exporter <nom>Schema + <nom>Function
 *   2. L'importer dans server.ts → import { <nom> } from './tools/<nom>.js'
 *   3. Ajouter server.addTool()    → name, description, parameters, execute
 *
 * ─── LISTE DES 23 OUTILS ────────────────────────────────────────────────
 *
 *  1. run_agent              → src/tools/run_agent.ts
 *  2. run_agents_parallel    → src/tools/run_agents_parallel.ts
 *  3. create_agent           → src/tools/create_agent.ts
 *  4. list_agents            → src/tools/manage_agents.ts
 *  5. delete_agent           → src/tools/manage_agents.ts
 *  6. update_agent_config    → src/tools/manage_agents.ts
 *  7. get_agent_configs      → src/tools/get_agent_configs.ts
 *  8. memory_search          → src/tools/memory_search.ts
 *  9. memory_store           → src/tools/memory_store.ts
 * 10. memory_runs            → src/tools/memory_runs.ts
 * 11. create_prompt          → src/tools/manage_prompts.ts
 * 12. edit_prompt            → src/tools/manage_prompts.ts
 * 13. config_example         → src/tools/config_example.ts
 * 14. agent_control          → src/tools/agent_control.ts
 * 15. a2a_hub                → src/tools/a2a_hub.ts
 * 16. get_metrics            → src/tools/get_metrics.ts
 *
 * ── Loi 25 (art. 3-35 Loi 25 QC) ──
 * 17. loi25_access_request   → src/tools/loi25_access_request.ts   (art. 26)
 * 18. loi25_erasure          → src/tools/loi25_erasure.ts          (art. 27/35.3)
 * 19. loi25_consent          → src/tools/loi25_consent.ts          (art. 8.1-8.2)
 * 20. loi25_rectification    → src/tools/loi25_rectification.ts    (art. 27)
 * 21. loi25_processing_registry → src/tools/loi25_processing_registry.ts (art. 3/35.18)
 * 22. loi25_report_incident  → src/tools/loi25_report_incident.ts  (art. 3.5-3.8)
 * 23. loi25_efvp             → src/tools/loi25_efvp.ts             (art. 18.1)
 */

import { FastMCP } from 'fastmcp';
import { withSpan } from './lib/telemetry.js';
import { PKG_VERSION } from './lib/config.js';
import { runAgent, runAgentSchema } from './tools/run_agent.js';
import { runAgentsParallel, runAgentsParallelSchema } from './tools/run_agents_parallel.js';
import { memorySearchTool, memorySearchSchema } from './tools/memory_search.js';
import { memoryStoreTool, memoryStoreSchema } from './tools/memory_store.js';
import { memoryRunsTool, memoryRunsSchema } from './tools/memory_runs.js';
import { createAgent, createAgentSchema } from './tools/create_agent.js';
import {
  createPrompt,
  createPromptSchema,
  editPrompt,
  editPromptSchema,
} from './tools/manage_prompts.js';
import {
  listAgents,
  listAgentsSchema,
  deleteAgent,
  deleteAgentSchema,
  updateAgentConfig,
  updateAgentConfigSchema,
} from './tools/manage_agents.js';
import { getAgentConfigs, getAgentConfigsSchema } from './tools/get_agent_configs.js';
import { configExample, configExampleSchema } from './tools/config_example.js';
import { agentControl, agentControlSchema } from './tools/agent_control.js';
import { a2aHub, a2aHubSchema } from './tools/a2a_hub.js';
import { getMetricsTool, getMetricsSchema } from './tools/get_metrics.js';
// ── Loi 25 tools (art. 3-35 Loi 25 QC) ──
import { loi25AccessRequest, loi25AccessRequestSchema } from './tools/loi25_access_request.js';
import { loi25Erasure, loi25ErasureSchema } from './tools/loi25_erasure.js';
import { loi25Consent, loi25ConsentSchema } from './tools/loi25_consent.js';
import { loi25Rectification, loi25RectificationSchema } from './tools/loi25_rectification.js';
import {
  loi25ProcessingRegistry,
  loi25ProcessingRegistrySchema,
} from './tools/loi25_processing_registry.js';
import { loi25ReportIncident, loi25ReportIncidentSchema } from './tools/loi25_report_incident.js';
import { loi25Efvp, loi25EfvpSchema } from './tools/loi25_efvp.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolExecute = (...args: any[]) => Promise<any>;
function wrapExecute(toolName: string, fn: ToolExecute) {
  return (...args: Parameters<ToolExecute>) => withSpan(`tool.${toolName}`, () => fn(...args));
}

export function createServer(
  name: string = 'OverMind-MCP',
  memoryOnly = false,
  memoryToolsOnly = false,
) {
  const server = new FastMCP({
    name: memoryOnly ? `${name}-Memory` : memoryToolsOnly ? `${name}-MemoryTools` : name,
    version: PKG_VERSION as `${number}.${number}.${number}`,
  });

  if (!memoryOnly && !memoryToolsOnly) {
    // ─── 1. run_agent ─────────────────────────────────────────────────────────────
    server.addTool({
      name: 'run_agent',
      description: `Exécute une commande sur un agent IA via le runner spécifié.

**Runners disponibles:**
 - claude: Claude Code (Nécessite 'create_agent' au préalable)
 - gemini: Gemini CLI
 - kilo: Kilocode (modes: code, architect, ask, debug, orchestrator)
 - qwencli: Qwen Code CLI (qwen -p)
 - openclaw: OpenClaw (openclaw message send)
 - cline: Cline (modes: plan, act)
 - opencode: OpenCode (opencode run)
 - hermes: Nous Hermes Agent (Nécessite 'create_agent' au préalable)

**Modèles recommandés :**
| Fournisseur | Modèle recommandé | Usage |
| :--- | :--- | :--- |
| **Mistral** | **Devstral 2** (\`codestral-latest\`) | Expert Coding & Développement |
| **Mistral** | **Mistral Large 3** (\`mistral-large-latest\`) | Raisonnement & Architecture |
| **Kilo** | **step 3.5 flash** | Polyvalent (262K context) |
| **Kilo** | **free** | Modèle par défaut gratuit |

**Parameters:**
- runner: Type de runner (claude, gemini, etc.)
- prompt: Instruction à envoyer à l'agent
- agentName: Nom de l'agent (optionnel)
- path: Répertoire de travail (CWD). Par défaut: dossier Overmind.
- config: Répertoire racine de l'Overmind. Par défaut: dossier Overmind.

**Exemples:**
run_agent(runner: "claude", agentName: "expert_python", prompt: "Analyse ce code")
run_agent(runner: "kilo", agentName: "architect", mode: "architect", prompt: "Conçois une API REST", path: "./my-project")
run_agent(runner: "cline", agentName: "planner", mode: "plan", prompt: "Planifie l'implémentation")`,
      parameters: runAgentSchema,
      execute: wrapExecute('run_agent', runAgent),
    });

    // ─── 2. run_agents_parallel ─────────────────────────────────────────────────
    server.addTool({
      name: 'run_agents_parallel',
      description: `🚀 Lance plusieurs agents IA EN PARALLÈLE depuis un seul appel MCP. Polyglotte (mixe runners/modèles). Retourne les résultats consolidés une fois tous terminés.

**Cas d'usage :** Orchestration de flotte, rotation de tokens, tâches indépendantes simultanées.

**Exemple :**
run_agents_parallel(agents: [
  { taskId: "build",  runner: "kilo", agentName: "mistral_1", prompt: "npm run build", path: "./project" },
  { taskId: "lint",   runner: "kilo", agentName: "mistral_2", prompt: "npm run lint",  path: "./project" },
  { taskId: "test",   runner: "kilo", agentName: "mistral_3", prompt: "npm test",      path: "./project" },
  { taskId: "audit",  runner: "kilo", agentName: "mistral_4", prompt: "Analyse le fichier audit.md", path: "./project" },
])

**Options :**
- waitAll (défaut: true) : attend tous les agents avant de retourner.
- waitAll: false : retourne dès que le premier agent réussit (race mode).`,
      parameters: runAgentsParallelSchema,
      execute: wrapExecute('run_agents_parallel', runAgentsParallel),
    });

    // ─── 3. create_agent ────────────────────────────────────────────────────────
    server.addTool({
      name: 'create_agent',
      description: `Crée un nouvel agent (Prompt + Config) compatible avec tous les runners.

**Runners supportés:** claude, gemini, kilo, qwencli, openclaw, cline, opencode, hermes

**Exemples:**
create_agent(name: "expert_python", runner: "claude", prompt: "Tu es un expert Python...")
create_agent(name: "architecte", runner: "kilo", mode: "architect", prompt: "Tu es un architecte logiciel...")
create_agent(name: "planner", runner: "cline", mode: "plan", prompt: "Tu es un planificateur de tâches...")`,
      parameters: createAgentSchema,
      execute: createAgent,
    });

    // ─── 4. list_agents ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'list_agents',
      description:
        "Liste tous les agents disponibles. Option 'details=true' pour voir la config complète.",
      parameters: listAgentsSchema,
      execute: wrapExecute('list_agents', listAgents),
    });

    // ─── 5. delete_agent ───────────────────────────────────────────────────────
    server.addTool({
      name: 'delete_agent',
      description: 'Supprime définitivement un agent (Prompt et Config)',
      parameters: deleteAgentSchema,
      execute: wrapExecute('delete_agent', deleteAgent),
    });

    // ─── 6. update_agent_config ────────────────────────────────────────────────
    server.addTool({
      name: 'update_agent_config',
      description:
        "Modifie la configuration technique d'un agent (Runner, Modèle, Serveurs MCP, Variables d'environnement) OU réécrit entièrement l'un des 4 fichiers (prompt, settings, mcp, skill)",
      parameters: updateAgentConfigSchema,
      execute: wrapExecute('update_agent_config', updateAgentConfig),
    });

    // ─── 7. create_prompt ───────────────────────────────────────────────────────
    server.addTool({
      name: 'create_prompt',
      description: 'Crée ou écrase un fichier prompt Markdown (Persona)',
      parameters: createPromptSchema,
      execute: wrapExecute('create_prompt', createPrompt),
    });

    // ─── 8. edit_prompt ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'edit_prompt',
      description: 'Modifie un prompt existant en remplaçant un bloc de texte spécifique',
      parameters: editPromptSchema,
      execute: wrapExecute('edit_prompt', editPrompt),
    });
  }

  // ─── 9. memory_search ──────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_search',
    description:
      'Recherche sémantique + full-text dans la mémoire OverMind (connaissances + historique)',
    parameters: memorySearchSchema,
    execute: memorySearchTool,
  });

  // ─── 10. memory_store ───────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_store',
    description: "Mémorise durablement une connaissance, décision ou pattern d'orchestration",
    parameters: memoryStoreSchema,
    execute: memoryStoreTool,
  });

  // ─── 11. memory_runs ───────────────────────────────────────────────────────
  server.addTool({
    name: 'memory_runs',
    description:
      "Liste l'historique des runs d'agents enregistrés par OverMind (avec stats optionnelles)",
    parameters: memoryRunsSchema,
    execute: memoryRunsTool,
  });

  if (!memoryOnly && !memoryToolsOnly) {
    // ─── 12. get_agent_configs ─────────────────────────────────────────────────
    server.addTool({
      name: 'get_agent_configs',
      description:
        "Affiche les 4 fichiers de configuration d'un agent (prompt.md, .mcp.json, settings.json, skill.md)",
      parameters: getAgentConfigsSchema,
      execute: getAgentConfigs,
    });

    // ─── 13. config_example ─────────────────────────────────────────────────────
    server.addTool({
      name: 'config_example',
      description:
        'Fournit des exemples de configuration settings.json pour différents LLM (GLM, MiniMax, OpenRouter).',
      parameters: configExampleSchema,
      execute: configExample,
    });

    // ─── 14. agent_control ─────────────────────────────────────────────────────────
    server.addTool({
      name: 'agent_control',
      description: `Outil MCP unifié pour contrôler le cycle de vie des agents OverMind.

REMPLACE les 4 outils précédents : get_agent_status, stream_agent_output, kill_agent, wait_agent.
L'unification simplifie la toolbox client et assure un comportement déterministe.

**Actions disponibles :**

status ─── Lecture pure, zero side-effect
  → Retourne l'état du process (pid, status, sessionId, outputBuffer)
  → Use-case : dashboard, diagnostic, polling léger

stream ─── Lecture + indicateur de complétude
  → Retourne outputBuffer + isComplete flag
  → Use-case : récupérer la sortie en temps réel sans savoir si c'est fini
  → Option sinceTimestamp pour output après un timestamp

kill ─── Action destructive, irréversible
  → Tue le process tree via taskkill /F /T (Windows) ou kill -9 (Unix)
  → Use-case : abort d'urgence, kill-switch

wait ─── Blocage async avec polling
  → Poll toutes les 1s jusqu'à status !== 'running' ou timeout
  → Use-case : synchronisation dans un workflow d'orchestration

**États du process :**
  running  — Process actif, PID valide
  done     — Terminé avec code 0
  failed   — Terminé avec erreur (exit code != 0)
  orphaned — Parent mort mais child tourne encore

**Erreurs structurées :**
  AGENT_NOT_FOUND    — Agent absent du registry (jamais lancé ou nettoyé)
  AGENT_NOT_RUNNING  — Action "kill" sur un agent déjà terminé
  KILL_FAILED        — taskkill/kill a échoué
  WAIT_TIMEOUT       — Timeout atteint sans terminaison
  ORPHANED_PROCESS   — Process zombie détecté

**Exemples :**
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "status" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "stream" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "kill" })
agent_control({ agentName: "sniper_analyst", runner: "kilo", action: "wait", timeoutMs: 300000 })`,
      parameters: agentControlSchema,
      execute: wrapExecute('agent_control', agentControl),
    });

    // ─── 15. a2a_hub ──────────────────────────────────────────────────────────
    server.addTool({
      name: 'a2a_hub',
      description: `🌐 **A2A Hub — Communication Agent-to-Agent unifiée**

Découvre automatiquement tous les agents persistants du système et permet de communiquer avec eux.

**Actions disponibles:**

discover — Liste TOUS les agents avec leur status temps réel, modèle, skills, description
  → a2a_hub(action: "discover")

status — État détaillé d'un agent (runs, erreurs, A2A count, session)
  → a2a_hub(action: "status", target: "sniperbot_analyst")

send — Message synchrone A→B (attend la réponse)
  → a2a_hub(action: "send", target: "tradingview_analyst", message: "Analyse BTCUSDT")

delegate — Tâche async (retourne immédiatement avec taskId + callback optionnel)
  → a2a_hub(action: "delegate", target: "sniperbot_analyst", message: "Prépare un plan", callbackUrl: "http://...")

pipeline — Chaîne séquentielle A→B→C (output de l'un = input du suivant)
  → a2a_hub(action: "pipeline", message: "Analyse le marché", steps: [{agentName: "tradingview_analyst"}, {agentName: "sniperbot_analyst"}])

fanout — 1→N parallèle + merge (concat|best|vote|first_success)
  → a2a_hub(action: "fanout", targets: ["agent_a", "agent_b"], message: "Quelle stratégie?", mergeStrategy: "best")

query — Question rapide multi-agents (tous répondent en parallèle)
  → a2a_hub(action: "query", targets: ["agent_a", "agent_b"], message: "Prix actuel BTC?")

broadcast — Message global à tous les agents online
  → a2a_hub(action: "broadcast", message: "Alerte marché!")
  → a2a_hub(action: "broadcast", message: "Premier qui répond!", race: true)

**Auto-discovery:** L'outil scanne ~/.overmind/hermes/profiles/ automatiquement.
Aucune configuration manuelle nécessaire — il connaît tous les agents du système.`,
      parameters: a2aHubSchema,
      execute: wrapExecute('a2a_hub', a2aHub),
    });

    // ─── 16. get_metrics ──────────────────────────────────────────────────────
    server.addTool({
      name: 'get_metrics',
      description:
        '📊 Affiche les métriques agrégées du serveur Overmind MCP: agents live, mémoire, gateway health, stats process.',
      parameters: getMetricsSchema,
      execute: wrapExecute('get_metrics', getMetricsTool),
    });

    // ══════════════════════════════════════════════════════════════════════════
    // ─── LOI 25 — Conformité protection des RP (7 outils) ─────────────────────
    // Articles Loi 25 QC: 3-3.1, 8, 14-17.3, 18.1, 21-22, 26, 27, 35.18
    // Active via OVERMIND_LOI25_ENABLED=true dans .env
    // ══════════════════════════════════════════════════════════════════════════

    // ─── 17. loi25_access_request ─────────────────────────────────────────────
    server.addTool({
      name: 'loi25_access_request',
      description: `📋 **Loi 25 art. 26** — Droit d'accès aux renseignements personnels.

Extrait tous les RP liés à un sujet de données (agent_runs, knowledge_chunks, archives).

**Exemples :**
loi25_access_request(data_subject_id: "hash_abc123")
loi25_access_request(data_subject_id: "hash_abc123", include_archives: true)`,
      parameters: loi25AccessRequestSchema,
      execute: wrapExecute('loi25_access_request', loi25AccessRequest),
    });

    // ─── 18. loi25_erasure ────────────────────────────────────────────────────
    server.addTool({
      name: 'loi25_erasure',
      description: `🗑️ **Loi 25 art. 27/35.3** — Droit d'effacement (droit à l'oubli).

Anonymise ou supprime définitivement les RP d'un sujet.

**Modes :**
- \`anonymize\` (défaut) : hash les textes + null le data_subject_id
- \`hard_delete\` : suppression définitive des enregistrements

**Exemple :**
loi25_erasure(data_subject_id: "hash_abc123", mode: "anonymize")`,
      parameters: loi25ErasureSchema,
      execute: wrapExecute('loi25_erasure', loi25Erasure),
    });

    // ─── 19. loi25_consent ───────────────────────────────────────────────────
    server.addTool({
      name: 'loi25_consent',
      description: `✅ **Loi 25 art. 8.1-8.2** — Gestion du consentement.

Accorde, révoque ou vérifie un consentement pour un sujet de données.

**Actions :**
- \`grant\` : enregistre un nouveau consentement
- \`revoke\` : révoque un consentement existant
- \`check\` : vérifie si un consentement est valide

**Exemples :**
loi25_consent(action: "grant", data_subject_id: "hash123", purpose: "agent_execution")
loi25_consent(action: "check", data_subject_id: "hash123")
loi25_consent(action: "revoke", data_subject_id: "hash123")`,
      parameters: loi25ConsentSchema,
      execute: wrapExecute('loi25_consent', loi25Consent),
    });

    // ─── 20. loi25_rectification ─────────────────────────────────────────────
    server.addTool({
      name: 'loi25_rectification',
      description: `✏️ **Loi 25 art. 27** — Droit de rectification.

Modifie un renseignement personnel inexact ou incomplet.

**Exemple :**
loi25_rectification(data_subject_id: "hash123", table_name: "agent_runs", record_id: "run_abc", field: "prompt", new_value: "Version corrigée")`,
      parameters: loi25RectificationSchema,
      execute: wrapExecute('loi25_rectification', loi25Rectification),
    });

    // ─── 21. loi25_processing_registry ───────────────────────────────────────
    server.addTool({
      name: 'loi25_processing_registry',
      description: `📚 **Loi 25 art. 3-3.1/35.18** — Registre des traitements.

Consulte, crée ou modifie le registre des traitements de RP + cartographie des transferts hors QC.

**Actions :** list, get, create, update

**Exemples :**
loi25_processing_registry(action: "list")
loi25_processing_registry(action: "get", name: "llm_inference")`,
      parameters: loi25ProcessingRegistrySchema,
      execute: wrapExecute('loi25_processing_registry', loi25ProcessingRegistry),
    });

    // ─── 22. loi25_report_incident ────────────────────────────────────────────
    server.addTool({
      name: 'loi25_report_incident',
      description: `🚨 **Loi 25 art. 3.5-3.8** — Notification d'incident.

Signale un incident de confidentialité, liste les incidents ouverts, ou résout un incident.

⚠️ Les incidents de sévérité "high" nécessitent une notification à la CAI dans les 30 jours.

**Actions :** report, list, resolve

**Exemples :**
loi25_report_incident(action: "report", severity: "moderate", category: "data_leak", description: "Fuite de 3 enregistrements")
loi25_report_incident(action: "list")`,
      parameters: loi25ReportIncidentSchema,
      execute: wrapExecute('loi25_report_incident', loi25ReportIncident),
    });

    // ─── 23. loi25_efvp ──────────────────────────────────────────────────────
    server.addTool({
      name: 'loi25_efvp',
      description: `🔍 **Loi 25 art. 18.1** — Évaluation des facteurs relatifs à la vie privée (EFVP).

Crée ou consulte une EFVP pour un nouveau projet ou traitement.

**Actions :** create, list, get

**Exemple :**
loi25_efvp(action: "create", project_name: "agent_memory_v2", description: "Vectorisation des prompts", data_categories: "prompts,embeddings", risks: "Ré-identification par corrélation", mitigations: "Bruit gaussien sur embeddings")`,
      parameters: loi25EfvpSchema,
      execute: wrapExecute('loi25_efvp', loi25Efvp),
    });
  }

  return server;
}
