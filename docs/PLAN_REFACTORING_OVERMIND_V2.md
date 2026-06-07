# 🔥 OVERMIND v2 — Plan de Refactorisation Distribuée

> **Objectif** : Transformer Overmind d'un orchestrateur mono-machine en un **réseau d'agents distribué**, capable de devenir un noeud d'un réseau blockchain agentique RCP.

> **Ambition** : L'AGI émergera de la coopération d'agents sur un réseau décentralisé. Overmind doit devenir un noeud de ce réseau.

---

## 📊 ÉTAT ACTUEL — Audit des Fondations

### Ce qu'on a (positif)

| Composant | Fichier | Status | Note |
|---|---|---|---|
| Transport JSON-RPC 2.0 | `bridge/BridgeProxy.ts` | ✅ Existe | Localhost seulement |
| Circuit Breaker | `bridge/types.ts` | ✅ Existe | Closed→Open→Half-Open |
| Mémoire PostgreSQL | `memory/PostgresMemoryProvider.ts` | ✅ Existe | 1 DB par agent + DB core |
| Embeddings Vectoriels | `embedText()` | ✅ Existe | Qwen 8B, 4096D |
| MCP Server (14 outils) | `server.ts` | ✅ Existe | FastMCP, local |
| Process Registry | `lib/processRegistry.ts` | ✅ Existe | Locaux seulement |
| Orchestration parallèle | `run_agents_parallel` | ✅ Existe | Local seulement |
| Swarm | `lib/orchestration/swarm.ts` | ⚠️ Existe | À vérifier |

### Ce qui manque (blockers)

| Problème | Impact | Priorité |
|---|---|---|
| **Pas de RPC distant** | Impossible de connecter 2 machines | 🔴 CRITIQUE |
| **Pas de discovery/pairing** | Les noeuds ne se trouvent pas | 🔴 CRITIQUE |
| **Mémoire non synchronisée** | Chaque machine a sa propre DB isolée | 🔴 CRITIQUE |
| **Pas d'authentification inter-noeuds** | Sécurité inexistante en distributed | 🟡 HIGH |
| **Pas de consensus** | Pas de résolution de conflits | 🟡 HIGH |
| **Pas de tokenomics** | Pas d'incitation économique | 🟢 MEDIUM |

---

## 🧠 MÉMOIRE — Diagnostic Précis

### Architecture Actuelle (vérifiée dans le code)

```
┌─────────────────────────────────────────────────┐
│              POSTGRESQL LOCAL                    │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────┐     │
│  │ overmind_core │  │ agent_sniperbot      │     │
│  │ (partagé)     │  │ (DB propre/agent)    │     │
│  │               │  ├──────────────────────┤     │
│  │ knowledge_    │  │ agent_minimax_1      │     │
│  │ chunks        │  │ (DB propre/agent)    │     │
│  │ agent_runs    │  ├──────────────────────┤     │
│  │               │  │ agent_minimax_2      │     │
│  └──────────────┘  └──────────────────────┘     │
│                                                  │
│  + Fichiers plats Hermes (MEMORY.md, USER.md)   │
└─────────────────────────────────────────────────┘
```

### La réalité du "partagé"

En lisant `PostgresMemoryProvider.ts` (lignes 458-521) :

1. **`storeKnowledge()`** → Stocke dans la DB de l'agent (`agent_<name>`)
2. **`searchMemory()`** → Cherche dans **DEUX** DBs :
   - `agent_<name>` (DB locale agent)
   - `overmind_core` (DB "partagée")
3. **Mais** → `overmind_core` n'est JAMAIS écrite directement par les agents !

**BUG** : La DB "partagée" (`overmind_core`) existe mais n'est peuplée que si `agentName` est `undefined`. Les agents avec nom écrivent UNIQUEMENT dans leur DB locale.

### Correction nécessaire

```typescript
// storeKnowledge() actuel (ligne 431)
const dbName = this.getDbName(params.agentName); // → toujours agent_<name>

// CORRECTION : écrire dans les DEUX
// 1. DB locale agent (toujours)
// 2. DB core si flagged "shared=true"
```

---

## 🌐 RPC DISTRIBUÉ — Comment ça va marcher en vrai

### Scénario : 2 ordinateurs distants

```
MACHINE A (Paris)                    MACHINE B (Lyon)
┌────────────────────┐               ┌────────────────────┐
│ Overmind Node A    │◄──WebSocket──►│ Overmind Node B    │
│                    │  (encrypted)  │                    │
│ ┌──────────────┐   │               │ ┌──────────────┐   │
│ │ PostgreSQL A │   │               │ │ PostgreSQL B │   │
│ │ (agent_sniper│   │               │ │ (agent_minim │   │
│ │  + core)     │   │               │ │  + core)     │   │
│ └──────────────┘   │               │ └──────────────┘   │
│                    │               │                    │
│ MCP Server :3099   │               │ MCP Server :3099   │
│ RPC Relay :3100    │               │ RPC Relay :3100    │
└────────────────────┘               └────────────────────┘
         │                                    │
         └──────── Internet (TLS) ────────────┘
```

### Phase de connexion (handshake)

```
1. Node A → Node B : POST /rpc/handshake
   { nodeId: "overmind_paris", version: "2.0", capabilities: [...] }

2. Node B → Node A : POST /rpc/handshake-response
   { nodeId: "overmind_lyon", accepted: true, authToken: "xxx" }

3. WebSocket établi → keep-alive bi-directionnel

4. Sync initiale :
   - Node A envoie son catalogue d'agents
   - Node B envoie son catalogue d'agents
   - Échange des schemas de DB
```

### Protocole RPC inter-noeuds

```typescript
interface OvermindRpcMessage {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: {
    sourceNode: string;      // ID du noeud émetteur
    targetAgent?: string;    // Agent cible (optionnel)
    authToken: string;       // Token de session
    payload: unknown;        // Données spécifiques
  };
}

// Méthodes supportées :
// - "agent.run"          → Lancer un agent distant
// - "memory.search"      → Chercher dans la mémoire d'un noeud distant
// - "memory.store"       → Écrire dans la mémoire partagée distante
// - "agent.stream"       → Stream output d'un agent distant
// - "discovery.ping"     → Vérifier la présence d'un noeud
// - "sync.knowledge"     → Synchroniser knowledge_chunks
// - "consensus.propose"  → Proposer une décision collective
```

### Résolution du problème mémoire

```
AVANT (v1 - actuel) :
  Chaque PostgreSQL est ISOLÉ. Aucune synchronisation.

APRÈS (v2 - distribué) :

  COUCHE 1 : Mémoire locale (déjà là)
    → agent_<name> DB → rapide, privé, pas de sync

  COUCHE 2 : Mémoire partagée (correction + sync)
    → overmind_core DB → sync entre noeuds via RPC
    → Flag "shared=true" sur storeKnowledge()
    → Réplication eventuelle ou sync périodique

  COUCHE 3 : Mémoire globale réseau (nouveau)
    → Table "network_knowledge" dans overmind_core
    → Source = nodeId + agentName
    → Vector search cross-noeuds via RPC relay
    → Chaque noeud maintient un index des embeddings distants
```

---

## 🏗️ PHASES DE REFACTORISATION

### Phase 1 — Fondations Distribuées (2-3 semaines)

**Objectif** : 2 machines Overmind qui communiquent

| Tâche | Fichier | Description |
|---|---|---|
| 1.1 | `src/rpc/RpcServer.ts` | Serveur WebSocket + HTTP pour RPC inter-noeuds |
| 1.2 | `src/rpc/RpcClient.ts` | Client pour appeler des méthodes sur un noeud distant |
| 1.3 | `src/rpc/NodeIdentity.ts` | Identité crypto du noeud (keypair, nodeId, signature) |
| 1.4 | `src/rpc/Handshake.ts` | Protocole de handshake sécurisé (challenge-response) |
| 1.5 | `src/rpc/config.ts` | Config distributed : peers, ports, TLS |
| 1.6 | `.env` | Variables `OVERMIND_NODE_ID`, `OVERMIND_PEERS`, `OVERMIND_RPC_PORT` |

**Livrable** : `node A` peut ping `node B` via RPC.

### Phase 2 — Mémoire Distribuée (2 semaines)

**Objectif** : La mémoire partagée sync entre 2 machines

| Tâche | Fichier | Description |
|---|---|---|
| 2.1 | `src/memory/PostgresMemoryProvider.ts` | **PATCH** : storeKnowledge() écrit aussi dans core si `shared=true` |
| 2.2 | `src/memory/DistributedMemoryProvider.ts` | Nouveau provider qui wrap PostgresMemory + RPC relay |
| 2.3 | `src/rpc/methods/memory_search.ts` | RPC method : chercher dans la mémoire d'un noeud distant |
| 2.4 | `src/rpc/methods/memory_store.ts` | RPC method : écrire dans la mémoire partagée distante |
| 2.5 | `src/memory/SyncEngine.ts` | Moteur de sync incrémental (last_sync_timestamp) |
| 2.6 | `src/memory/VectorIndexCache.ts` | Cache local des embeddings distants pour search rapide |

**Livrable** : Agent sur Machine A peut chercher dans la mémoire de Machine B.

### Phase 3 — Exécution Distribuée (2-3 semaines)

**Objectif** : Lancer un agent sur une machine distante

| Tâche | Fichier | Description |
|---|---|---|
| 3.1 | `src/rpc/methods/agent_run.ts` | RPC method : lancer un agent distant |
| 3.2 | `src/rpc/methods/agent_stream.ts` | Stream output d'un agent distant via WebSocket |
| 3.3 | `src/tools/run_agent.ts` | **PATCH** : ajout du paramètre `targetNode?` |
| 3.4 | `src/tools/run_agents_parallel.ts` | **PATCH** : dispatch sur plusieurs noeuds |
| 3.5 | `src/lib/NodeSelector.ts` | Sélection intelligente du noeud (latence, charge, capabilities) |
| 3.6 | `src/lib/TaskQueue.ts` | File d'attente distribuée (priority, retry, failover) |

**Livrable** : `run_agents_parallel` distribue les tâches sur Machine A et Machine B.

### Phase 4 — Résilience & Consensus (2 semaines)

**Objectif** : Le réseau survit à la perte d'un noeud

| Tâche | Fichier | Description |
|---|---|---|
| 4.1 | `src/rpc/HealthMonitor.ts` | Heartbeat entre noeuds, détection de panne |
| 4.2 | `src/rpc/Failover.ts` | Bascule automatique si un noeud meurt |
| 4.3 | `src/memory/ConflictResolver.ts` | Résolution de conflits (last-write-wins ou vector clocks) |
| 4.4 | `src/rpc/methods/consensus.ts` | Consensus simple (majorité) pour décisions collectives |
| 4.5 | `src/lib/ProcessMigration.ts` | Migration d'un agent d'un noeud à l'autre |

**Livrable** : Si Machine B meurt, Machine A prend le relais.

### Phase 5 — Couche Blockchain RCP (3-4 semaines)

**Objectif** : Overmind devient un noeud d'un réseau agentique décentralisé

| Tâche | Description |
|---|---|
| 5.1 | Smart contract de registration d'agent (Solidity → Base/Arbitrum) |
| 5.2 | Agent Commerce Protocol : agents qui paient des agents |
| 5.3 | Token de récompense pour contribution intellectuelle |
| 5.4 | Discovery on-chain : trouver des agents sur le réseau mondial |
| 5.5 | Vérifiable execution : preuve cryptographique qu'un agent a touré (TEE) |
| 5.6 | Agent Wallet : chaque agent a son propre wallet on-chain |

**Livrable** : Overmind est un noeud du réseau blockchain agentique RCP.

---

## 🔐 SÉCURITÉ — Modèle de Confiance

```
NIVEAU 1 : Pair-à-pair privé (Phase 1-4)
  → 2 machines qu'on contrôle
  → Auth par keypair Ed25519
  → TLS obligatoire
  → Pas de tokenomics nécessaire

NIVEAU 2 : Réseau ouvert (Phase 5)
  → N'importe qui peut rejoindre
  → Staking + slashing pour mauvais comportement
  → Réputation on-chain
  → Audit trail immuable
```

---

## 📐 ARCHITECTURE CIBLE

```
                    ┌─────────────────────────┐
                    │   BLOCKCHAIN LAYER       │
                    │   (Base / Arbitrum)      │
                    │                          │
                    │  • Agent Registry        │
                    │  • Commerce Protocol     │
                    │  • Token Rewards         │
                    │  • Discovery             │
                    └──────────┬───────────────┘
                               │
                    ┌──────────┴───────────────┐
                    │   OVERMIND NODE          │
                    │                          │
                    │  ┌─────────────────────┐ │
                    │  │  RPC Relay :3100    │ │
                    │  │  (WebSocket + HTTP) │ │
                    │  └────────┬────────────┘ │
                    │           │              │
                    │  ┌────────┴────────────┐ │
                    │  │  MCP Server :3099   │ │
                    │  │  (14 outils + RPC)  │ │
                    │  └────────┬────────────┘ │
                    │           │              │
                    │  ┌────────┴────────────┐ │
                    │  │  Memory Layer       │ │
                    │  │  • Local (agent_*)  │ │
                    │  │  • Shared (core)    │ │
                    │  │  • Network (RPC)    │ │
                    │  └────────┬────────────┘ │
                    │           │              │
                    │  ┌────────┴────────────┐ │
                    │  │  Agent Runners      │ │
                    │  │  claude/hermes/kilo │ │
                    │  └─────────────────────┘ │
                    └──────────────────────────┘
```

---

## 🚀 QUICK WINS — Ce qu'on peut faire MAINTENANT

### 1. Patch mémoire partagée (30 min)

```typescript
// Dans PostgresMemoryProvider.ts, modifier storeKnowledge()
async storeKnowledge(params: {
  text: string;
  source?: string;
  agentName?: string;
  shared?: boolean;  // ← NOUVEAU
}): Promise<string> {
  // Écrire dans DB agent (local, toujours)
  const agentDbName = this.getDbName(params.agentName);
  const agentPool = await this.getPoolFor(agentDbName);
  await this.initializeDb(agentDbName, agentPool);
  
  const id = `k_${sha256(params.text)}_${randomId()}`;
  const source = params.agentName ? `agent|${params.agentName}` : (params.source || 'user');
  const { embedding, model } = await embedText(params.text);
  const embStr = embedding.length > 0 ? `[${embedding.join(',')}]` : null;
  
  await agentPool.query(
    `INSERT INTO knowledge_chunks (id, source, text, embedding, model) 
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, 
     updated_at = extract(epoch from now()) * 1000`,
    [id, source, params.text, embStr, model]
  );

  // Si partagé → écrire AUSSI dans overmind_core
  if (params.shared && params.agentName) {
    const corePool = await this.getPoolFor(this.coreDbName);
    await this.initializeDb(this.coreDbName, corePool);
    const coreId = `k_shared_${sha256(params.text)}_${randomId()}`;
    await corePool.query(
      `INSERT INTO knowledge_chunks (id, source, text, embedding, model) 
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, embedding = EXCLUDED.embedding,
       updated_at = extract(epoch from now()) * 1000`,
      [coreId, `shared|${params.agentName}`, params.text, embStr, model]
    );
  }

  return id;
}
```

### 2. Config .env pour distributed

```env
# Overmind Distributed Config
OVERMIND_NODE_ID=overmind_paris
OVERMIND_RPC_PORT=3100
OVERMIND_RPC_ENABLED=true

# Peers (format: nodeId:host:port)
OVERMIND_PEERS=overmind_lyon:192.168.1.50:3100

# Security
OVERMIND_NODE_PRIVATE_KEY=<ed25519_key>
OVERMIND_TLS_ENABLED=true
```

### 3. Tunnel entre 2 machines (immédiat, sans code)

```bash
# Machine A (Paris) — tunnel SSH vers Machine B
ssh -R 3100:localhost:3100 user@machine-b-ip

# Ou avec WireGuard (meilleur pour prod)
wg-quick up overmind-vpn
```

---

## 📊 TIMELINE

```
Semaine 1-3   : Phase 1 — RPC Foundations
Semaine 4-5   : Phase 2 — Distributed Memory
Semaine 6-8   : Phase 3 — Distributed Execution
Semaine 9-10  : Phase 4 — Resilience & Consensus
Semaine 11-14 : Phase 5 — Blockchain RCP Layer

Total estimé : ~14 semaines (3.5 mois)
```

---

## 🎯 INDICATEURS DE SUCCÈS

| Phase | KPI | Target |
|---|---|---|
| Phase 1 | Latence RPC inter-noeuds | < 100ms |
| Phase 2 | Search mémoire distante | < 500ms |
| Phase 3 | Dispatch multi-noeuds | Transparent pour l'utilisateur |
| Phase 4 | Uptime avec 1 noeud down | 99.9% |
| Phase 5 | Agents on-chain | 10+ agents enregistrés |

---

*Plan généré par Sniperbot Analyst — 2 Juin 2026*
*Basé sur l'audit du code source Overmind actuel*
