# `agent_control` — Contrôle Unifié du Cycle de Vie des Agents

> **Outil unifié** qui remplace les 4 outils précédents : `get_agent_status`, `stream_agent_output`, `kill_agent`, `wait_agent`.
> Document technique complet : usage, patterns async, lookup par PID/timestamp, dashboard.

---

## Table des Matières

1. [Vue d'Ensemble](#1-vue-densemble)
2. [Actions Disponibles](#2-actions-disponibles)
3. [Codes d'Erreur](#3-codes-derreur)
4. [Patterns Async avec OverMind](#4-patterns-async-avec-overmind)
5. [Tracker PID ↔ Session ↔ Agent](#5-tracker-pid--session--agent)
6. [Dashboard en Temps Réel](#6-dashboard-en-temps-réel)
7. [Flux Complet de Debug](#7-flux-complet-de-debug)
8. [Référence Rapide](#8-référence-rapide)

---

## 1. Vue d'Ensemble

### Problème Résolu

Quand un agent est lancé via `run_agent`, le processus fils (`claude`, `kilo`, etc.) tourne en arrière-plan. Le seul lien entre le processus parent (OverMind MCP) et le processus enfant est le `sessionId` — généré par le runner, opaque pour OverMind.

**Problème** : Si OverMind restart ou crash, le `sessionId` est perdu et le child process devient **orphelin**.

**Solution** : Le **Process Registry** (`sessions.json`) stocke le mapping complet :

```
pid ↔ sessionId ↔ agentName ↔ runner ↔ status ↔ outputBuffer
```

`agent_control` est l'unique interface pour interagir avec ce registry.

### Architecture

```
Client                          OverMind MCP                      Process
  │                                  │                               │
  │  run_agent()                     │  spawn(claude)               │
  │──────────────────────────────────►│  registerProcess(pid)        │
  │                                  │─────────────────────────────►│
  │                                  │                              │
  │  agent_control(action: "status") │                              │
  │──────────────────────────────────►│  getProcessStatus(pid)        │
  │  { status, pid, outputBuffer }   │                              │
  │◄─────────────────────────────────│                              │
  │                                  │                              │
  │  agent_control(action: "stream") │                              │
  │──────────────────────────────────►│  read outputBuffer           │
  │  { output, isComplete }          │                              │
  │◄─────────────────────────────────│                              │
  │                                  │                              │
  │  agent_control(action: "wait")   │  poll every 1s...             │
  │──────────────────────────────────►│                              │
  │                                  │  child.on('close')            │
  │  { result }                      │◄─────────────────────────────│
  │◄─────────────────────────────────│                              │
```

---

## 2. Actions Disponibles

### `status` — Lecture Pure, Zero Side-Effect

Retourne l'état courant du process **sans modifier le registry**.

```javascript
agent_control({
  agentName: 'sniper_analyst',
  runner: 'kilo',
  action: 'status',
})
```

**Réponse :**

```markdown
**Agent:** sniper_analyst
**Runner:** kilo
**Status:** running
**Started:** 2026-05-10T14:32:00.000Z
**PID:** 12345
**Session ID:** sess_abc123

**Output Buffer (2048 chars):**

```
Thinking...
Fetching BTC data...
Analysis complete.
```
```

**États possibles :**

| Status | Signification |
|--------|---------------|
| `running` | Process actif, PID valide |
| `done` | Terminé avec code 0 |
| `failed` | Terminé avec erreur (exit code != 0) |
| `orphaned` | Parent mort mais child tourne encore |

---

### `stream` — Lecture + Indicateur de Complétude

Retourne l'output accumulé + un flag `isComplete` pour savoir si le process est fini.

```javascript
agent_control({
  agentName: 'sniper_analyst',
  runner: 'kilo',
  action: 'stream',
  sinceTimestamp: 1746892800000, // optionnel
})
```

**Réponse :**

```markdown
**Agent:** sniper_analyst
**Status:** running
**isComplete:** false
**PID:** 12345
**Last Output At:** 2026-05-10T14:32:45.000Z

**Output (2048 chars):**

```
Thinking...
Fetching BTC data...
```
```

Quand `isComplete: true` :
```markdown
**Agent:** sniper_analyst
**Status:** done
**isComplete:** true
**PID:** 12345

**Output (4096 chars):**

```
Final analysis: BUY signal detected.
```
```

---

### `kill` — Destruction Irréversible

Tue le process tree via `taskkill /F /T /PID` (Windows) ou `kill -9` (Unix).

```javascript
agent_control({
  agentName: 'sniper_analyst',
  runner: 'kilo',
  action: 'kill',
})
```

**Réponse (succès) :**

```markdown
Agent "sniper_analyst" tué avec succès (PID: 12345). Status mis à jour → 'failed' dans le registry.
```

**Réponse (échec) :**

```markdown
Agent "sniper_analyst" n'est pas en cours d'exécution (status: done). Impossible de tuer un agent déjà terminé.
```

> **⚠️ IRRÉVERSIBLE** : Une fois tué, le process ne peut pas être récupéré. Utiliser `kill` uniquement pour un abort d'urgence ou kill-switch.

---

### `wait` — Blocage Async avec Polling

Poll toutes les 1s jusqu'à ce que le status ne soit plus `running`, ou que le timeout soit atteint.

```javascript
agent_control({
  agentName: 'sniper_analyst',
  runner: 'kilo',
  action: 'wait',
  timeoutMs: 300000, // 5 minutes (défaut: 900000 = 15 min)
})
```

**Réponse (terminé) :**

```markdown
Final analysis: BUY signal detected. Portfolio balanced.
```

**Réponse (timeout) :**

```markdown
Timeout de 300000ms atteint. L'agent "sniper_analyst" est toujours en cours d'exécution (status: running). Utilisez action="kill" pour forcer l'arrêt ou augmentez timeoutMs.
```

**Réponse (erreur) :**

```markdown
Agent terminé avec erreur (failed):

TypeError: Cannot read property 'price' of undefined
    at analyzeBTC (/app/bot.js:42)
    at processTicksAndCallbacks (internal/process/task_queues.js:95)
```

---

## 3. Codes d'Erreur

Chaque erreur est structurée avec un **code** pour faciliter le debugging programatique.

| Code | Signification | Action recommandée |
|------|---------------|---------------------|
| `AGENT_NOT_FOUND` | Agent absent du registry | Vérifier le nom ou le runner |
| `AGENT_NOT_RUNNING` | Action `kill` sur un agent déjà terminé | Ne pas tuer un agent already done |
| `KILL_FAILED` | `taskkill`/`kill` a échoué | Vérifier permissions Windows/Unix |
| `WAIT_TIMEOUT` | Timeout atteint sans terminaison | Augmenter `timeoutMs` ou utiliser `kill` |
| `ORPHANED_PROCESS` | Process zombie détecté | `kill` puis relancer l'agent |

---

## 4. Patterns Async avec OverMind

### Pattern 1 : Lancer et Ne Pas Bloquer (Fire & Forget)

```javascript
// 1. Lancer l'agent en arrière-plan
const runResult = await run_agent({
  runner: 'kilo',
  agentName: 'crypto_scanner',
  prompt: 'Scan BTC/USDT for trading opportunities',
});

// 2. Récupérer le PID depuis le output (format: "PID: 12345")
// OU depuis le sessionId pour retrouver le process plus tard
const sessionId = runResult.sessionId; // "sess_abc123"

// 3. Polling non-bloquant pour vérifier l'état
const status = await agent_control({
  agentName: 'crypto_scanner',
  runner: 'kilo',
  action: 'status',
});
```

### Pattern 2 : Lancer et Attendre (Blocking Wait)

```javascript
// Une seule ligne pour lancer et attendre
const result = await agent_control({
  agentName: 'long_task',
  runner: 'claude',
  action: 'wait',
  timeoutMs: 600000, // 10 minutes
});

if (result.isError) {
  console.error('Task failed:', result.content[0].text);
} else {
  console.log('Result:', result.content[0].text);
}
```

### Pattern 3 : Orchestration Séquentielle

```javascript
async function runWorkflow(steps) {
  const results = [];

  for (const step of steps) {
    console.log(`Starting step: ${step.name}`);

    const result = await agent_control({
      agentName: step.agentName,
      runner: step.runner,
      action: 'wait',
      timeoutMs: step.timeoutMs || 300000,
    });

    if (result.isError) {
      return {
        success: false,
        failedStep: step.name,
        error: result.content[0].text,
        partialResults: results,
      };
    }

    results.push({ step: step.name, output: result.content[0].text });
  }

  return { success: true, results };
}

// Usage
const workflow = await runWorkflow([
  { name: 'fetch_data', agentName: 'data_fetcher', runner: 'kilo', timeoutMs: 60000 },
  { name: 'analyze',   agentName: 'analyzer',     runner: 'claude', timeoutMs: 300000 },
  { name: 'report',    agentName: 'reporter',     runner: 'kilo', timeoutMs: 120000 },
]);
```

### Pattern 4 : Exécution Parallèle (Fan-Out)

```javascript
// Lancer plusieurs agents en parallèle
const agents = [
  { agentName: 'btc_analyst',  runner: 'kilo',   prompt: 'Analyze BTC' },
  { agentName: 'eth_analyst',  runner: 'kilo',   prompt: 'Analyze ETH' },
  { agentName: 'sol_analyst',  runner: 'claude', prompt: 'Analyze SOL' },
];

// Lancer les 3 en parallèle
const runPromises = agents.map(a =>
  run_agent({ runner: a.runner, agentName: a.agentName, prompt: a.prompt })
);

await Promise.all(runPromises);

// Attendre que tous soient prêts
const waitPromises = agents.map(a =>
  agent_control({ agentName: a.agentName, runner: a.runner, action: 'wait', timeoutMs: 300000 })
);

const results = await Promise.all(waitPromises);

for (const [i, r] of results.entries()) {
  console.log(`${agents[i].agentName}:`, r.isError ? 'FAILED' : 'OK');
}
```

### Pattern 5 : Resume après Crash OverMind

Quand OverMind restart, on peut se rattacher aux agents en cours via le registry :

```javascript
// 1. Scanner tous les agents "running" dans le registry
const runningAgents = await getRunningProcesses();

// 2. Pour chaque agent encore vivant mais "orphaned"
for (const agent of runningAgents) {
  const status = await agent_control({
    agentName: agent.agentName,
    runner: agent.runner,
    action: 'status',
  });

  if (status.content[0].text.includes('orphaned')) {
    console.log(`Orphaned agent detected: ${agent.agentName} (PID: ${agent.pid})`);
    // Option: kill et relancer, ou laisser tel quel
  }
}
```

---

## 5. Tracker PID ↔ Session ↔ Agent

Le registry dans `sessions.json` stocke la cartographie complète :

```json
{
  "kilo:sniper_analyst": {
    "id": "sess_abc123",
    "ts": 1746892800000,
    "pid": 12345,
    "runner": "kilo",
    "agentName": "sniper_analyst",
    "status": "running",
    "outputBuffer": "Thinking...\nFetching data...",
    "exitCode": null,
    "lastOutputAt": 1746892900000
  },
  "claude:reporter": {
    "id": "sess_def456",
    "ts": 1746892850000,
    "pid": 67890,
    "runner": "claude",
    "agentName": "reporter",
    "status": "done",
    "outputBuffer": "Report generated successfully.",
    "exitCode": 0,
    "lastOutputAt": 1746893500000
  }
}
```

### Trouver un Agent par Timestamp

```javascript
// Trouver tous les agents活跃 après une date donnée
async function findAgentsAfter(timestampMs) {
  const allAgents = await getProcessStatus('*'); // sans runner = tous

  return allAgents
    .filter(a => a.ts >= timestampMs)
    .sort((a, b) => a.ts - b.ts); // plus récents d'abord
}

// Usage
const recent = await findAgentsAfter(Date.now() - 3600000); // dernière heure
console.log(recent.map(a => `${a.agentName} @ ${new Date(a.ts).toISOString()}`));
```

### Trouver un Agent par PID

```javascript
// Via le registry scan
async function findAgentByPid(pid) {
  const { store } = await readStore();

  for (const [key, entry] of Object.entries(store)) {
    if (typeof entry === 'object' && entry !== null && entry.pid === pid) {
      return { key, ...entry };
    }
  }
  return null;
}

// Usage
const agent = await findAgentByPid(12345);
console.log(`Found: ${agent.agentName} (${agent.runner})`);
```

### Trouver un Agent par Session ID

```javascript
// Via le registry scan
async function findAgentBySession(sessionId) {
  const { store } = await readStore();

  for (const [key, entry] of Object.entries(store)) {
    if (typeof entry === 'object' && entry !== null && entry.id === sessionId) {
      return { key, ...entry };
    }
  }
  return null;
}

// Usage
const agent = await findAgentBySession('sess_abc123');
if (agent) {
  console.log(`PID: ${agent.pid}, Status: ${agent.status}`);
}
```

---

## 6. Dashboard en Temps Réel

### Exemple Complet : Dashboard CLI

```javascript
import { getRunningProcesses } from './lib/processRegistry.js';

async function dashboard() {
  console.clear();
  console.log('═══════════════════════════════════════════════════════');
  console.log('              OVERMIND AGENT DASHBOARD');
  console.log('═══════════════════════════════════════════════════════\n');

  const running = await getRunningProcesses();

  if (running.length === 0) {
    console.log('Aucun agent en cours d\'exécution.\n');
    return;
  }

  console.log(`📊 ${running.length} agent(s) actifs\n`);
  console.log('┌──────────────────┬────────┬─────────┬───────────────┬────────────────────────┐');
  console.log('│ Agent            │ Runner │ PID     │ Status        │ Started                │');
  console.log('├──────────────────┼────────┼─────────┼───────────────┼────────────────────────┤');

  for (const agent of running) {
    const elapsed = Date.now() - agent.ts;
    const elapsedStr = elapsed < 60000
      ? `${Math.floor(elapsed / 1000)}s`
      : `${Math.floor(elapsed / 60000)}m`;

    const statusColor = agent.status === 'running' ? '🟢' : '⚠️';
    console.log(
      `│ ${agent.agentName.padEnd(16)} │ ${(agent.runner || '?').padEnd(6)} │ ${String(agent.pid || 'N/A').padStart(7)} │ ${statusColor} ${agent.status.padEnd(11)} │ ${new Date(agent.ts).toLocaleTimeString().padEnd(22)} │`
    );
  }

  console.log('└──────────────────┴────────┴─────────┴───────────────┴────────────────────────┘\n');

  // Detail du premier agent
  if (running[0]) {
    const detail = await agent_control({
      agentName: running[0].agentName,
      runner: running[0].runner,
      action: 'stream',
    });
    console.log('═══ OUTPUT RECENT ═══');
    console.log(detail.content[0].text.slice(-500));
  }
}

// Rafraîchir toutes les 3 secondes
setInterval(dashboard, 3000);
```

### Exemple : Tableau de Bord HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>OverMind Dashboard</title>
  <meta http-equiv="refresh" content="5">
  <style>
    body { font-family: monospace; background: #0d1117; color: #e6edf3; padding: 20px; }
    .agent { border: 1px solid #30363d; padding: 10px; margin: 10px 0; border-radius: 6px; }
    .running { border-left: 4px solid #3fb950; }
    .done { border-left: 4px solid #58a6ff; }
    .failed { border-left: 4px solid #f85149; }
    .orphaned { border-left: 4px solid #d29922; }
    .pid { color: #8b949e; }
    .output { background: #161b22; padding: 8px; margin-top: 8px; max-height: 100px; overflow: auto; }
  </style>
</head>
<body>
  <h1>🤖 OverMind Agent Dashboard</h1>
  <div id="agents"></div>

  <script>
    async function refresh() {
      // Appeler agent_control pour chaque agent running
      const response = await fetch('/api/agents/running');
      const agents = await response.json();

      document.getElementById('agents').innerHTML = agents.map(agent => `
        <div class="agent ${agent.status}">
          <strong>${agent.agentName}</strong>
          <span class="pid">(${agent.runner} | PID: ${agent.pid})</span>
          <br>
          Status: ${agent.status} | Started: ${new Date(agent.ts).toLocaleString()}
          <br>
          Elapsed: ${Math.floor((Date.now() - agent.ts) / 1000)}s
          <div class="output">${escapeHtml(agent.outputBuffer || '(no output)').slice(-200)}</div>
        </div>
      `).join('');
    }

    function escapeHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>
```

---

## 7. Flux Complet de Debug

Quand un agent ne répond plus ou pose problème :

```
STEP 1: Identifier le problème
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
agent_control({ agentName: "sniper_analyst", action: "status" })

→ Si status: "running" + lastOutputAt ancien → agent peut-être bloqué
→ Si status: "orphaned" → parent mort, child tourne encore
→ Si status: "done" → agent déjà terminé, problem elsewhere

STEP 2: Voir l'output
━━━━━━━━━━━━━━━━━━━━━━
agent_control({ agentName: "sniper_analyst", action: "stream" })

→ Identifier la dernière ligne avant le blocage
→ Vérifier s'il y a des erreurs dans le buffer

STEP 3: Décider de l'action
━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┌─ still running, output OK → Attendre (action: "wait", timeoutMs: X)
  │
  ├─ still running, BLOCKED  → kill (action: "kill") → restart
  │
  ├─ orphaned               → kill (action: "kill") → restart
  │
  └─ done with error        → Analyser output → fix prompt → restart

STEP 4: Nettoyer si nécessaire
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Le registry fait le cleanup automatique après 1h (TTL).
Pour forcer le cleanup immédiat :

unregisterProcess(pid) → supprime l'entrée du registry
```

---

## 8. Référence Rapide

```javascript
// Status simple
agent_control({ agentName: "...", action: "status" })

// Stream avec filtre timestamp
agent_control({ agentName: "...", action: "stream", sinceTimestamp: 1746892800000 })

// Kill
agent_control({ agentName: "...", action: "kill" })

// Wait avec timeout custom
agent_control({ agentName: "...", action: "wait", timeoutMs: 300000 })

// Avec runner explicite (recommendé)
agent_control({ agentName: "...", runner: "kilo", action: "..." })

// Avec config path (si plusieurs OverMind)
agent_control({ agentName: "...", config: "/path/to/overmind", action: "..." })
```

### Paramètres Communs

| Param | Type | Description |
|-------|------|-------------|
| `agentName` | string | Nom unique de l'agent |
| `runner` | enum | Type de runner (optionnel, déduit si omis) |
| `config` | string | Chemin racine Overmind (optionnel) |

### Actions

| Action | Description | Retourne |
|--------|-------------|----------|
| `status` | État courant | pid, status, sessionId, outputBuffer |
| `stream` | Output + complétude | output, isComplete |
| `kill` | Arrêt forcé | confirmation ou erreur |
| `wait` | Attente terminaison | output final ou timeout |

---

**Fichier source** : `src/tools/agent_control.ts`
**Registry** : `src/lib/processRegistry.ts`
**Store** : `.claude/sessions.json`
**TTL** : 1h après terminaison (cleanup automatique)