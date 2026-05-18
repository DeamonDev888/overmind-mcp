# Tutoriel : Créer et piloter des agents via HTTP (Overmind MCP)

> **Note** : `runner` est **obligatoire** dans `run_agent` (pas déduit du registry). Doit correspondre au runner utilisé lors du `create_agent`.
>
> `claude` et `kilo` nécessitent une auth (EXIT_CODE_1 = token manquant). `gemini` fonctionne avec le token libre. `hermes` fonctionne avec les tokens ZAI.  
> Auth : `Authorization: Bearer $OVERMIND_AUTH`  
> Tous les appels retournent du SSE (`Accept: application/json, text/event-stream`)

---

## Prérequis

```bash
# Le serveur Overmind doit tourner (via start-all-mcp-servers.bat ou manuellement)
curl http://localhost:3099/health
# → ✓ Ok
```

---

## Méthode 1 — Via l'API HTTP MCP (externe, n'importe quel client)

Toutes les opérations passent par `tools/call` avec le bon `name` d'outil.

### Headers obligatoires

```
Content-Type: application/json
Accept: application/json, text/event-stream
Authorization: Bearer $OVERMIND_AUTH
```

---

### 1.1 Créer 5 agents (Claude, Kilo, Hermes × 2, Gemini)

Chaque `create_agent` enregistre l'agent dans le registry. `run_agent` lancera le bon runner selon le champ `runner`.

```bash
# Agent 1 — ClaudeRunner
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {
      "name": "create_agent",
      "arguments": {
        "name": "dev_assistant",
        "runner": "claude",
        "prompt": "Tu es un assistant développement. Réponds en moins de 3 phrases."
      }
    }
  }' | grep -o '"text":"[^"]*"' | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['text'])" 2>/dev/null || curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"create_agent","arguments":{"name":"dev_assistant","runner":"claude","prompt":"Tu es un assistant développement."}}}'
```

**En JSON (copier-coller dans Postman/Insomnia) :**

```json
{
  "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": {
    "name": "create_agent",
    "arguments": {
      "name": "dev_assistant",
      "runner": "claude",
      "prompt": "Tu es un assistant développement."
    }
  }
}
```

```json
// Agent 2 — KiloRunner
{
  "jsonrpc": "2.0", "id": 2, "method": "tools/call",
  "params": {
    "name": "create_agent",
    "arguments": {
      "name": "archi_bot",
      "runner": "kilo",
      "prompt": "Tu es un expert architecture système."
    }
  }
}
```

```json
// Agent 3 — HermesRunner #1
{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": {
    "name": "create_agent",
    "arguments": {
      "name": "nexus_guard",
      "runner": "hermes",
      "prompt": "Tu es un garde système. Rapporte tout incident."
    }
  }
}
```

```json
// Agent 4 — HermesRunner #2
{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": {
    "name": "create_agent",
    "arguments": {
      "name": "nexus_sentinel",
      "runner": "hermes",
      "prompt": "Tu surveilles les métriques système."
    }
  }
}
```

```json
// Agent 5 — GeminiRunner
{
  "jsonrpc": "2.0", "id": 5, "method": "tools/call",
  "params": {
    "name": "create_agent",
    "arguments": {
      "name": "fast_probe",
      "runner": "gemini",
      "prompt": "Réponds en une phrase concise."
    }
  }
}
```

**Runners disponibles** : `claude` | `gemini` | `kilo` | `qwencli` | `openclaw` | `cline` | `opencode` | `hermes`

---

### 1.2 Lister les agents

```json
{
  "jsonrpc": "2.0", "id": 10, "method": "tools/call",
  "params": { "name": "list_agents", "arguments": {} }
}
```

---

### 1.3 Lancer un agent (run_agent)

```json
{
  "jsonrpc": "2.0", "id": 11, "method": "tools/call",
  "params": {
    "name": "run_agent",
    "arguments": {
      "agentName": "dev_assistant",
      "prompt": "Explique ce qu'est un mutex en 2 phrases.",
      "timeoutMs": 60000
    }
  }
}
```

Le runner correspondant (`claude`) est automatiquement choisi d'après le registry.  
Le PID du child process est inscrit dans `agent_lifecycle` (RAM, pas de disk I/O).

---

### 1.4 Surveiller en temps réel (stream)

```json
// Lire l'output sans bloquer (polling)
{
  "jsonrpc": "2.0", "id": 12, "method": "tools/call",
  "params": {
    "name": "agent_control",
    "arguments": {
      "agentName": "dev_assistant",
      "action": "stream"
    }
  }
}
```

```json
// Statut complet (pid, status, sessionId, buffer)
{
  "jsonrpc": "2.0", "id": 13, "method": "tools/call",
  "params": {
    "name": "agent_control",
    "arguments": {
      "agentName": "dev_assistant",
      "action": "status"
    }
  }
}
```

---

### 1.5 Lancer 5 agents en parallèle

```bash
# Lancer les 5 en arrière-plan avec '&'
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"run_agent","arguments":{"agentName":"dev_assistant","prompt":"Question rapide","timeoutMs":30000}}}' &

curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"run_agent","arguments":{"agentName":"archi_bot","prompt":"Question rapide","timeoutMs":30000}}}' &

curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"run_agent","arguments":{"agentName":"nexus_guard","prompt":"Rapporte létat du système","timeoutMs":30000}}}' &

curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"run_agent","arguments":{"agentName":"nexus_sentinel","prompt":"Liste les processus actifs","timeoutMs":30000}}}' &

curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":24,"method":"tools/call","params":{"name":"run_agent","arguments":{"agentName":"fast_probe","prompt":"Ping","timeoutMs":30000}}}' &

wait
echo "Tous les agents ont répondu (ou expiré)"
```

Chaque agent s'exécute dans son propre child process (PID distinct).  
Les outputs sont collectés dans `agent_lifecycle` (RAM, ring buffer 256KB/agent).

---

### 1.6 Attendre qu'un agent finisse (wait)

```json
{
  "jsonrpc": "2.0", "id": 30, "method": "tools/call",
  "params": {
    "name": "agent_control",
    "arguments": {
      "agentName": "dev_assistant",
      "action": "wait",
      "timeoutMs": 900000
    }
  }
}
```

Blocage jusqu'à terminaison (max 15 min par défaut). Retourne l'output complet.

---

### 1.7 Tuer un agent

```json
{
  "jsonrpc": "2.0", "id": 31, "method": "tools/call",
  "params": {
    "name": "agent_control",
    "arguments": {
      "agentName": "dev_assistant",
      "action": "kill"
    }
  }
}
```

Envoie `taskkill /F /T /PID <pid>` (Windows) ou `kill -9` (Unix).

---

### 1.8 Supprimer un agent du registry

```json
{
  "jsonrpc": "2.0", "id": 32, "method": "tools/call",
  "params": {
    "name": "delete_agent",
    "arguments": { "agentName": "dev_assistant" }
  }
}
```

---

## Méthode 2 — Via le SDK Node.js (import direct des runners)

Importe les classes directement dans ton script Node pour un contrôle programme par programme.

### Installation / Setup

```bash
cd /votre/projet/Workflow
npm run build   # compile le TypeScript
```

### 2.1 Lancer un agent avec ClaudeRunner

```javascript
// run_claude_direct.mjs
import { ClaudeRunner } from './dist/services/ClaudeRunner.js';
import { loadEnvQuietly } from './dist/lib/loadEnv.js';

const runner = new ClaudeRunner();

// Lancer l'agent
const result = await runner.runAgent({
  agentName: 'mon_agent',
  prompt: 'Explique les channels Go en 2 phrases.',
  timeoutMs: 60_000,
  silent: false,       // false = logs dans stderr
  configPath: undefined,
});

console.log('Status:', result.error ?? 'OK');
console.log('Output:', result.result);
console.log('Session:', result.sessionId);
```

```bash
node run_claude_direct.mjs
```

---

### 2.2 Lancer avec KiloRunner

```javascript
// run_kilo_direct.mjs
import { KiloRunner } from './dist/services/KiloRunner.js';

const runner = new KiloRunner();

const result = await runner.runAgent({
  agentName: 'archi_kilo',
  prompt: 'Décris larchitecture microservices en 3 points.',
  timeoutMs: 90_000,
  silent: false,
  configPath: undefined,
});

console.log(result.result ?? result.error);
```

---

### 2.3 Lancer 2 HermesRunner en parallèle

```javascript
// run_hermes_pool.mjs
import { HermesRunner } from './dist/services/HermesRunner.js';

const runners = [
  new HermesRunner({ model: 'glm-5.1' }),
  new HermesRunner({ model: 'glm-4' }),
];

const [res1, res2] = await Promise.all([
  runners[0].runAgent({
    agentName: 'hermes_guard',
    prompt: 'Rapporte les 3 dernières alertes.',
    timeoutMs: 60_000,
    silent: false,
  }),
  runners[1].runAgent({
    agentName: 'hermes_sentinel',
    prompt: 'Affiche les métriques CPU/mémoire.',
    timeoutMs: 60_000,
    silent: false,
  }),
]);

console.log('Guard:', res1.result ?? res1.error);
console.log('Sentinel:', res2.result ?? res2.error);
```

---

### 2.4 Lancer 5 agents mixed pool

```javascript
// run_pool_5.mjs
import { ClaudeRunner } from './dist/services/ClaudeRunner.js';
import { KiloRunner } from './dist/services/KiloRunner.js';
import { HermesRunner } from './dist/services/HermesRunner.js';
import { GeminiRunner } from './dist/services/GeminiRunner.js';

const agents = [
  // 1× ClaudeRunner
  { runner: new ClaudeRunner(), name: 'dev', prompt: 'Réponds en 1 phrase.', model: null },
  // 1× KiloRunner
  { runner: new KiloRunner(),    name: 'archi', prompt: 'Décris un pattern.', model: null },
  // 2× HermesRunner
  { runner: new HermesRunner({ model: 'glm-5.1' }), name: 'nexus_g', prompt: 'Ping système.', model: 'glm-5.1' },
  { runner: new HermesRunner({ model: 'glm-4' }),   name: 'nexus_s', prompt: 'Rapport RAM.', model: 'glm-4' },
  // 1× GeminiRunner
  { runner: new GeminiRunner(), name: 'probe', prompt: 'Combien de cores CPU ?', model: null },
];

const runs = agents.map(({ runner, name, prompt, model }) =>
  runner.runAgent({ agentName: name, prompt, timeoutMs: 45_000, silent: false })
    .then(r => ({ name, result: r.result ?? r.error, model }))
);

const results = await Promise.all(runs);

for (const { name, result, model } of results) {
  console.log(`[${model ?? 'default'}] ${name}: ${String(result).slice(0, 80)}`);
}
```

```bash
node run_pool_5.mjs
```

---

### 2.5 Cycle de vie complet avec abort

```javascript
import { ClaudeRunner } from './dist/services/ClaudeRunner.js';
import { AgentController } from './dist/lib/agent_lifecycle.js'; // wait helpers

const runner = new ClaudeRunner();
const controller = new AbortController();

const agent = runner.runAgent({
  agentName: 'stoppable',
  prompt: 'Décris lUnivers en détail (va prendre longtemps).',
  timeoutMs: 300_000,
  signal: controller.signal,  // AbortController = kill externe
});

// Kill après 5 secondes
setTimeout(() => {
  console.log('→ Abort envoyé');
  controller.abort();
}, 5_000);

const result = await agent;
console.log('Résultat:', result.error ?? result.result);
```

---

## Outil : overmind-serve.bat

```batch
:: Lancer le serveur Overmind MCP
overmind-serve.bat              Start (ou restart si déjà lancé)
overmind-serve.bat stop         Arrêt propre
overmind-serve.bat restart      Restart
overmind-serve.bat status       Voir si ça tourne
overmind-serve.bat tail         20 dernières lignes du log
overmind-serve.bat kill         Kill forcé

:: Fonctionne même si le script est lancé depuis un autre répertoire
cd C:\ && overmind-serve.bat status
```

Log : `Workflow/logs/overmind.log`  
PID file : `Workflow/overmind.pid`  
Health : `curl http://localhost:3099/health`

## Outil : overmind-pool.mjs (client CLI)

```bash
node overmind-pool.mjs --status          # health check
node overmind-pool.mjs --agents           # lister agents
node overmind-pool.mjs --pool             # demo 5 agents
node overmind-pool.mjs --run <n> <r> <p>  # run un agent
node overmind-pool.mjs --create <n> <r> <p>  # créer un agent
node overmind-pool.mjs --kill <name>       # tuer un agent
```

## Comparatif rapide

| | HTTP MCP (Méthode 1) | SDK Node (Méthode 2) |
|---|---|---|
| **Usage** | Scripts, CI, autre machine | Code programme |
| **Auth** | Bearer token HTTP | Aucun (process local) |
| **Paralélisme** | curl × N ou HTTP client async | `Promise.all([...])` |
| **Output streaming** | `agent_control stream` (SSE) | Callback `stdout.on('data')` |
| **Lifecycle management** | Via `agent_control` tool | Via `agent_lifecycle` + AbortController |
| **Déploiement** | HTTP ouvert, remote-ready | Même host que le serveur |

---

## Commandes utilitaires

```bash
# Health check
curl http://localhost:3099/health

# Lister tous les outils disponibles
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":0,"method":"tools/list","params":{}}'

# Lister les agents
curl -s -X POST http://localhost:3099/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $OVERMIND_AUTH" \
  -d '{"jsonrpc":"2.0","id":0,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}'

# Voir le contenu du registry disk
cat .claude/process-registry.json
```
