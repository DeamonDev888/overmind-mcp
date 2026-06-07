# 🔧 Plan d'Intégration — Daemon RPC dans OverBridgeService.ts

> **Date** : 30 Mai 2026  
> **Contexte** : Suite au plan de refactorisation OverBridgeService (session 27 mai), intégration du Daemon RPC  
> **Décision clé** : OverBridgeService se connecte à `http://localhost:3099/mcp` (HTTP/JSON-RPC), PAS à la lib directement  
> **Objectif** : Éviter les node zombies = processus orphelins quand le client crash sans cleanup  

---

## 📊 Architecture Actuelle (état des lieux)

```
┌─────────────────────────────────────────────────────┐
│  Hermes Agent (ex: sniperbot_analyst)               │
│  → appelle les tools MCP natifs (run_agent, etc.)   │
│  → passe par le gateway Hermes                      │
└──────────────┬──────────────────────────────────────┘
               │ HTTP/JSON-RPC
               ▼
┌─────────────────────────────────────────────────────┐
│  Overmind MCP Server (FastMCP)                      │
│  → cli.ts : transport stdio OU httpStream           │
│  → server.ts : 14 tools enregistrés                 │
│  → port 3099, endpoint /mcp                         │
│  → Auth: Bearer token (OVERMIND_AUTH)               │
└──────────────┬──────────────────────────────────────┘
               │
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
┌────────┐ ┌────────┐  ┌──────────────┐
│ Runners│ │Memory  │  │ProcessRegistry│
│(spawn) │ │(pg)    │  │(disk)        │
└────────┘ └────────┘  └──────────────┘
```

### Fichiers existants pertinents :
- `src/bin/cli.ts` → Point d'entrée, gère stdio/httpStream, port 3099
- `src/bin/overmind-client.ts` → Client HTTP brut (OvermindClient class)
- `src/server.ts` → 14 tools MCP via FastMCP
- `src/lib/agent_lifecycle.ts` → LiveAgent state en RAM
- `src/lib/processRegistry.ts` → Persistence disque + OS kill
- `src/services/` → Runners (Claude, Gemini, Kilo, Hermes, etc.)

### Le client actuel (`overmind-client.ts`) :
- ✅ HTTP/JSON-RPC 2.0 vers `localhost:3099/mcp`
- ✅ Bearer auth
- ✅ CRUD agents + run + lifecycle (status/stream/wait/kill)
- ❌ Pas de reconnexion auto
- ❌ Pas de daemon/service (process management)
- ❌ Pas de health monitoring continu
- ❌ Pas de circuit breaker
- ❌ Pas d'event system (EventEmitter)

---

## ❓ Question Centrale : BridgeProxy.ts séparé ou dans OverBridgeService.ts ?

### Analyse comparative

| Critère | BridgeProxy.ts séparé | Dans OverBridgeService.ts |
|---|---|---|
| **Responsabilité unique** | ✅ Proxy = transport only | ❌ Mélange transport + métier |
| **Testabilité** | ✅ Test isolé du proxy | ❌ Mock plus complexe |
| **Réutilisabilité** | ✅ Autres clients peuvent utiliser le proxy | ❌ Couplé au service |
| **Complexité** | ⚠️ 1 fichier de plus | ✅ Moins de fichiers |
| **Maintenabilité** | ✅ Proxy évolue indépendamment | ❌ Service grossit |
| **Zombie prevention** | ✅ Daemon dédié + cleanup isolation | ⚠️ Même process = risque partagé |

### 🎯 RECOMMANDATION : **BridgeProxy.ts séparé**

**Pourquoi :**
1. Le Daemon RPC est un **concern de transport** — il gère la connexion persistante, reconnexion, health checks
2. OverBridgeService.ts est un **concern métier** — il expose l'API haut niveau (runAgent, listAgents, etc.)
3. Séparer permet de **tester le daemon indépendamment** du métier
4. Si le daemon crash, **il peut redémarrer sans impacter** les abonnés (pattern supervisor)
5. Le proxy peut servir à **d'autres clients** (dashboard, CLI custom, etc.)

### Pattern architectural :

```
OverBridgeService.ts (métier)
    │
    │ utilise
    ▼
BridgeProxy.ts (transport/daemon)
    │
    │ HTTP/JSON-RPC
    ▼
localhost:3099/mcp (Overmind Server)
```

---

## 🏗️ Plan d'Intégration — 6 Phases

### PHASE 1 — BridgeProxy.ts (Transport Daemon)

**Fichier** : `src/bridge/BridgeProxy.ts`

```typescript
class BridgeProxy extends EventEmitter {
  // Config
  private url: string;
  private auth: string;
  private reconnectMaxRetries: number;
  private reconnectBaseDelay: number;

  // State
  private connected: boolean;
  private lastHealthCheck: number;
  private requestId: number;

  // Core
  constructor(config: BridgeProxyConfig)
  async start(): Promise<void>        // Démarrer le daemon
  async stop(): Promise<void>         // Arrêt propre (cleanup)

  // Connexion
  async healthCheck(): Promise<HealthStatus>
  private async reconnect(): Promise<void>  // Backoff exponentiel

  // RPC générique
  async call(method: string, params: Record<string, unknown>): Promise<RpcResponse>

  // Events
  // 'connected'    → connexion établie
  // 'disconnected'  → connexion perdue
  // 'reconnecting'  → tentative de reconnexion
  // 'health'        → health check périodique
  // 'error'         → erreur RPC
}
```

**Features critiques anti-zombie :**
- Heartbeat toutes les 30s vers `/health`
- Si health fails 3x → tentative reconnexion auto (backoff: 1s, 2s, 4s, 8s, max 30s)
- `stop()` propre = annule tous les AbortController en cours
- Timeout configurable par requête (default 60s, run_agent = 120s)
- Circuit breaker : si 5 erreurs consécutives → mode dégradé (queue les requêtes)

---

### PHASE 2 — Types & Interfaces

**Fichier** : `src/bridge/types.ts`

```typescript
// Config
interface BridgeProxyConfig {
  url?: string;              // default: http://localhost:3099/mcp
  auth?: string;             // default: process.env.OVERMIND_AUTH
  healthCheckInterval?: number;  // default: 30000ms
  reconnectMaxRetries?: number;  // default: Infinity
  reconnectBaseDelay?: number;   // default: 1000ms
  requestTimeout?: number;       // default: 60000ms
}

// RPC
interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface RpcResponse {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Health
interface HealthStatus {
  ok: boolean;
  latencyMs: number;
  serverVersion?: string;
  lastCheck: number;
}

// Events
type BridgeProxyEvents = {
  connected: [];
  disconnected: [reason: string];
  reconnecting: [attempt: number];
  health: [status: HealthStatus];
  error: [error: Error];
};
```

---

### PHASE 3 — OverBridgeService.ts (Refactor du Client)

**Fichier** : `src/bridge/OverBridgeService.ts`

```typescript
import { BridgeProxy } from './BridgeProxy.js';

class OverBridgeService extends EventEmitter {
  private proxy: BridgeProxy;

  constructor(config?: BridgeProxyConfig) {
    this.proxy = new BridgeProxy(config);
    // Forward les events du proxy
    this.proxy.on('connected', () => this.emit('connected'));
    this.proxy.on('disconnected', (r) => this.emit('disconnected', r));
    this.proxy.on('health', (h) => this.emit('health', h));
  }

  // ─── Lifecycle ─────────────────────────────────────
  async connect(): Promise<void>     // proxy.start() + health check
  async disconnect(): Promise<void>  // proxy.stop() + cleanup
  isConnected(): boolean

  // ─── Agents CRUD ───────────────────────────────────
  async listAgents(details?: boolean): Promise<Agent[]>
  async createAgent(def: CreateAgentDef): Promise<Agent>
  async deleteAgent(name: string): Promise<void>
  async getAgentConfigs(name: string): Promise<AgentConfigs>
  async updateAgentConfig(name: string, updates: ConfigUpdates): Promise<void>

  // ─── Agent Execution ───────────────────────────────
  async runAgent(opts: RunAgentOpts): Promise<AgentRunResult>
  async runParallel(agents: RunAgentOpts[], waitAll?: boolean): Promise<AgentRunResult[]>
  async agentControl(name: string, action: 'status'|'stream'|'kill'|'wait', opts?: ControlOpts): Promise<ControlResult>

  // ─── Memory ────────────────────────────────────────
  async memorySearch(query: string, opts?: SearchOpts): Promise<SearchResult[]>
  async memoryStore(text: string, opts?: StoreOpts): Promise<void>
  async memoryRuns(opts?: RunsOpts): Promise<RunEntry[]>

  // ─── Prompts ───────────────────────────────────────
  async createPrompt(name: string, content: string): Promise<void>
  async editPrompt(name: string, search: string, replace: string): Promise<void>

  // ─── Convenience ───────────────────────────────────
  async health(): Promise<HealthStatus>
  async waitForReady(timeoutMs?: number): Promise<void>
}
```

**Méthode `call` interne :**
```typescript
private async toolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await this.proxy.call('tools/call', { name, arguments: args });
  if (res.error) throw new OvermindRpcError(res.error.code, res.error.message);
  return res.result;
}
```

---

### PHASE 4 — Daemon Process Manager

**Fichier** : `src/bridge/DaemonProcess.ts`

Gère le **cycle de vie du process Overmind lui-même** (démarrage/arrêt du serveur depuis le client).

```typescript
class DaemonProcess {
  private child: ChildProcess | null;
  private proxy: BridgeProxy;

  // Start le serveur Overmind en background si pas déjà running
  async ensureRunning(): Promise<void>

  // Stop le serveur
  async shutdown(): Promise<void>

  // Status
  isServerRunning(): Promise<boolean>
  getServerPid(): number | null
}
```

**Anti-zombie pattern :**
```typescript
// Avant de spawn le serveur, vérifier qu'aucun zombie n'existe
async ensureRunning(): Promise<void> {
  // 1. Health check → déjà running ?
  if (await this.proxy.healthCheck()) return;

  // 2. Vérifier PID file → zombie ?
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    // Process vivant mais ne répond pas → kill
    killProcessTree(pid);
  }

  // 3. Démarrer le serveur
  this.child = spawn('node', ['dist/cli.js', '--transport', 'http-stream', '--port', '3099'], {
    detached: false,  // ← CRUCIAL: process attaché au parent
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // 4. Cleanup on parent exit
  process.on('exit', () => this.shutdown());
  process.on('SIGTERM', () => this.shutdown());
  process.on('SIGINT', () => this.shutdown());

  // 5. Attendre que le health check passe
  await this.waitForReady(30_000);
}
```

**Pourquoi `detached: false` est crucial :**
- Si le parent crash → le child meurt aussi → PAS de zombie
- `detached: true` = le child survit au parent = zombie potentiel

---

### PHASE 5 — Intégration dans le Projet

#### 5a. Structure finale

```
src/
├── bridge/                          ← NOUVEAU MODULE
│   ├── BridgeProxy.ts               ← Transport daemon (RPC)
│   ├── OverBridgeService.ts         ← API haut niveau (métier)
│   ├── DaemonProcess.ts             ← Process manager (anti-zombie)
│   └── types.ts                     ← Interfaces & types
├── bin/
│   ├── cli.ts                       ← Existant (serveur)
│   └── overmind-client.ts           ← À déprécier → remplacé par bridge/
├── services/                        ← Existant (runners)
├── tools/                           ← Existant (14 tools MCP)
├── lib/                             ← Existant (config, logger, etc.)
├── memory/                          ← Existant
├── server.ts                        ← Existant
└── index.ts                         ← Ajouter exports bridge/
```

#### 5b. Mise à jour de `index.ts`

```typescript
// Existant
export { createServer } from './server.js';
// ... autres exports existants ...

// NOUVEAU — Bridge Client
export { OverBridgeService } from './bridge/OverBridgeService.js';
export { BridgeProxy } from './bridge/BridgeProxy.js';
export { DaemonProcess } from './bridge/DaemonProcess.js';
export type {
  BridgeProxyConfig,
  HealthStatus,
  RpcResponse,
} from './bridge/types.js';
```

#### 5c. Dépréciation de `overmind-client.ts`

- `overmind-client.ts` reste en place pour la compatibilité
- Nouveau code utilise `OverBridgeService` depuis `bridge/`
- `overmind-client.ts` peut devenir un thin wrapper :

```typescript
// src/bin/overmind-client.ts (refactor)
import { OverBridgeService } from '../bridge/OverBridgeService.js';
// ... demo function using OverBridgeService au lieu de l'ancien code raw ...
```

---

### PHASE 6 — Tests & Validation

#### 6a. Tests unitaires

| Test | Fichier | Description |
|---|---|---|
| BridgeProxy RPC | `tests/bridge/BridgeProxy.test.ts` | call(), reconnect, circuit breaker |
| BridgeProxy Health | `tests/bridge/BridgeProxy.health.test.ts` | heartbeat, backoff, failures |
| OverBridgeService | `tests/bridge/OverBridgeService.test.ts` | CRUD agents, run, memory |
| DaemonProcess | `tests/bridge/DaemonProcess.test.ts` | spawn, cleanup, zombie kill |
| Types | `tests/bridge/types.test.ts` | Validation interfaces |

#### 6b. Scénarios de validation anti-zombie

```
SCÉNARIO 1 : Client crash → pas de zombie
  1. OverBridgeService.connect()
  2. kill -9 le process client
  3. Vérifier: aucun process node orphelin
  ✓ detached: false garanti

SCÉNARIO 2 : Serveur crash → reconnexion auto
  1. OverBridgeService.connect()
  2. kill le serveur Overmind
  3. Vérifier: BridgeProxy tente reconnexion (backoff)
  4. Relancer le serveur
  5. Vérifier: BridgeProxy se reconnecte automatiquement

SCÉNARIO 3 : Serveur zombie détecté → kill + restart
  1. DaemonProcess.ensureRunning()
  2. Simuler: PID file existe, process alive mais ne répond pas
  3. Vérifier: DaemonProcess kill le zombie, puis respawn

SCÉNARIO 4 : Circuit breaker → mode dégradé
  1. BridgeProxy: 5 erreurs consécutives
  2. Vérifier: circuit ouvert, requêtes en queue
  3. Health check réussi → circuit fermé, queue vidée
```

#### 6c. Tests d'intégration E2E

```typescript
// tests/bridge/e2e.test.ts
import { OverBridgeService } from '../../src/bridge/OverBridgeService.js';

test('E2E: full lifecycle', async () => {
  const service = new OverBridgeService();
  await service.connect();

  // Create → Run → Stream → Kill → Delete
  await service.createAgent({ name: 'e2e_test', runner: 'kilo', prompt: 'Reply: PONG' });
  const run = service.runAgent({ agentName: 'e2e_test', prompt: 'PING' });
  const status = await service.agentControl('e2e_test', 'status');
  const result = await run;
  await service.deleteAgent('e2e_test');
  await service.disconnect();
});
```

---

## 🔐 Considérations Sécurité

1. **Auth** : Bearer token via `OVERMIND_AUTH` dans `.env` — jamais hardcodé
2. **Transport** : HTTP en local (localhost only) — HTTPS optionnel via SSL flags
3. **Pas de credentials dans le proxy** : le token est injecté via config, pas stocké
4. **Cleanup garanti** : `SIGTERM/SIGINT/exit` hooks tuent le child process
5. **Pas de stdio** : le daemon communique UNIQUEMENT via HTTP → pas de pipe leaks

---

## 📋 Ordre d'Implémentation (priorité)

| Priorité | Phase | Fichier | Temps estimé |
|---|---|---|---|
| 🔴 P0 | Phase 2 | `bridge/types.ts` | 30 min |
| 🔴 P0 | Phase 1 | `bridge/BridgeProxy.ts` | 2h |
| 🟡 P1 | Phase 3 | `bridge/OverBridgeService.ts` | 3h |
| 🟡 P1 | Phase 5b-c | `index.ts` + dépréciation | 30 min |
| 🟢 P2 | Phase 4 | `bridge/DaemonProcess.ts` | 2h |
| 🟢 P2 | Phase 6 | Tests | 3h |
| **Total** | | | **~11h** |

---

## ⚡ Quick Start (après implémentation)

```typescript
import { OverBridgeService } from './bridge/OverBridgeService.js';

const service = new OverBridgeService({
  url: 'http://localhost:3099/mcp',
  auth: process.env.OVERMIND_AUTH,
});

await service.connect();

// Event-driven
service.on('health', (h) => console.log(`Health: ${h.ok} (${h.latencyMs}ms)`));
service.on('disconnected', (reason) => console.warn(`Disconnected: ${reason}`));

// Usage
const agents = await service.listAgents();
const result = await service.runAgent({
  agentName: 'minimax_1',
  prompt: 'Analyse le code',
});

await service.disconnect();
```

---

## 🎯 Reste à Faire / À Arbitrer

- [ ] **Arbitrage** : DaemonProcess dans le client (Phase 4) — est-ce nécessaire si le serveur est géré par systemd/pm2 ?
- [ ] **Arbitrage** : SSL entre client et serveur local — nécessaire ou overkill ?
- [ ] **Arbitrage** : Rate limiting côté proxy — le serveur a-t-il déjà un rate limiter ?
- [ ] **Migration** : Comment migrer les agents Hermes existants vers le nouveau OverBridgeService
- [ ] **Dashboard** : Brancher le health monitoring du proxy sur un dashboard temps réel
- [ ] **Metrics** : Exposer les métriques Prometheus du proxy (latence, erreurs, reconnections)

---

*Plan généré par SniperBot Analyst — 30 Mai 2026*
