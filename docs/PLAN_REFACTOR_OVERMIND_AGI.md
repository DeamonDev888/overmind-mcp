# 🚀 PLAN DE REFACTORISATION — Overmind → Réseau Agentique Décentralisé (AGI-Ready)

> **Objectif** : Transformer Overmind d'un orchestrateur mono-machine en un **réseau de noeuds RPC agentiques** capable d'émergence collective. Ambitieux mais ancré dans la réalité du code existant.

> **Auteur** : Sniperbot Analyst  
> **Date** : Juin 2026  
> **Status** : PROPOSITION — En attente de validation

---

## 📊 ÉTAT DES LIEUX — Ce qu'on a MAINTENANT

### Architecture Actuelle (Mono-Machine)

```
┌─────────────────────────────────────────────────┐
│              MACHINE LOCALE (Windows)            │
│                                                  │
│  ┌──────────┐  HTTP/JSON-RPC   ┌──────────────┐ │
│  │ Hermes   │ ◄──────────────► │  Overmind    │ │
│  │ Gateway  │  localhost:3099  │  MCP Server  │ │
│  │ (Agent)  │                  │  (port 3099) │ │
│  └──────────┘                  └──────┬───────┘ │
│                                       │          │
│                  ┌────────────────────┤          │
│                  │                    │          │
│           ┌──────▼──────┐    ┌───────▼──────┐   │
│           │ PostgreSQL   │    │ PostgreSQL    │   │
│           │ overmind_core│    │ agent_sniper  │   │
│           │ (partagé)    │    │ (agent-local) │   │
│           └──────────────┘    └──────────────┘   │
│                  │                                │
│           ┌──────▼──────┐                         │
│           │ PostgreSQL   │                         │
│           │ agent_miniX  │  (1 DB par agent)      │
│           └──────────────┘                         │
└─────────────────────────────────────────────────┘
```

### Ce qui existe DÉJA dans le code

| Composant | Fichier | Status |
|---|---|---|
| **JSON-RPC 2.0 Bridge** | `src/bridge/types.ts` | ✅ Opérationnel |
| **Circuit Breaker** | `src/bridge/BridgeProxy.ts` | ✅ Closed→Open→Half-Open |
| **Memory Factory** | `src/memory/MemoryFactory.ts` | ✅ PostgreSQL only |
| **DB par agent** | `PostgresMemoryProvider.ts:91` | ✅ `agent_<name>` isolé |
| **DB partagée** | `PostgresMemoryProvider.ts:77` | ✅ `overmind_core` |
| **Recherche cross-DB** | `PostgresMemoryProvider.ts:465` | ✅ Agent DB + Core DB |
| **pgvector embeddings** | `PostgresMemoryProvider.ts:442` | ✅ Qwen 8B, 4096D |
| **Process Registry** | `src/lib/processRegistry.ts` | ✅ PID tracking |
| **Swarm orchestration** | `src/lib/orchestration/swarm.ts` | ⚠️ Existe, à explorer |
| **14 outils MCP** | `src/server.ts` | ✅ Complets |

### Le VRAI problème mémoire

```typescript
// PostgresMemoryProvider.ts lignes 91-94
private getDbName(agentName?: string): string {
  if (!agentName) return this.coreDbName;     // "overmind_core"
  return `agent_${this.sanitizeIdentifier(agentName)}`; // "agent_sniper"
}
```

**Réalité** :
- ❌ **Pas de vraie mémoire communautaire** — `overmind_core` existe mais n'est alimenté QUE par `memory_store` sans `agentName`
- ❌ **Pas de sync inter-machines** — PostgreSQL est local (127.0.0.1:5432)
- ❌ **Pas de gossip protocol** — les agents ne partagent pas entre eux
- ✅ **La base technique existe** — DB par agent + DB core + vector search

---

## 🎯 VISION — Ce qu'on veut ATTEINDRE

### Architecture Cible (Réseau Multi-Noeuds)

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│      NOEUD A (Machine 1)    │     │      NOEUD B (Machine 2)    │
│       Windows/Desktop       │     │       Linux/Cloud            │
│                             │     │                             │
│  ┌─────────┐  ┌──────────┐ │     │  ┌─────────┐  ┌──────────┐ │
│  │ Hermes  │  │ Overmind │ │     │  │ Hermes  │  │ Overmind │ │
│  │ Agents  │  │ Node A   │ │     │  │ Agents  │  │ Node B   │ │
│  │ (x N)   │  │ (RPC)    │ │     │  │ (x N)   │  │ (RPC)    │ │
│  └────┬────┘  └─────┬────┘ │     │  └────┬────┘  └─────┬────┘ │
│       │             │      │     │       │             │      │
│  ┌────▼────┐  ┌─────▼────┐ │     │  ┌────▼────┐  ┌─────▼────┐ │
│  │ PG Local│  │  Sync    │ │     │  │ PG Local│  │  Sync    │ │
│  │ agents  │  │ Engine   │◄┼─────┼─►│ agents  │  │ Engine   │ │
│  │ + core  │  │ (Gossip) │ │     │  │ + core  │  │ (Gossip) │ │
│  └─────────┘  └──────────┘ │     │  └─────────┘  └──────────┘ │
│                    │        │     │                    │        │
│              ┌─────▼────┐   │     │              ┌─────▼────┐   │
│              │  Mesh    │   │     │              │  Mesh    │   │
│              │  Layer   │   │     │              │  Layer   │   │
│              └──────────┘   │     │              └──────────┘   │
└─────────────────────────────┘     └─────────────────────────────┘
                      │                           │
                      └───────────┬───────────────┘
                                  │
                          ┌───────▼───────┐
                          │  Shared Core  │
                          │  (PostgreSQL  │
                          │   Répliqué)  │
                          └───────────────┘
```

---

## 📋 PHASE 1 — Fondations Réseau (2-3 semaines)

### 1.1 Refactor du Memory Provider → Multi-Source

**Problème actuel** : `PostgresMemoryProvider` hardcode `127.0.0.1:5432`.

**Solution** : Config multi-sources.

```typescript
// NOUVEAU : memory/MemoryConfig.ts
interface MemorySource {
  name: string;
  type: 'local' | 'remote' | 'shared';
  host: string;
  port: number;
  database: string;
  auth: 'env' | 'token';
  priority: number; // 0 = primaire, 1+ = fallback
  syncMode: 'none' | 'push' | 'pull' | 'bidirectional';
}
```

**Fichiers à modifier** :
- `src/memory/PostgresMemoryProvider.ts` → Accepter config dynamique
- `src/memory/MemoryFactory.ts` → Multi-provider pool
- Nouveau : `src/memory/MemorySync.ts` → Sync engine

### 1.2 Noeud RPC — Transport Layer

**Existant** : BridgeProxy utilise déjà JSON-RPC 2.0 sur HTTP.

**Extension** : Ajouter un mode "server" au Bridge.

```typescript
// NOUVEAU : src/bridge/RpcNode.ts
interface RpcNode {
  nodeId: string;           // UUID du noeud
  endpoints: string[];      // ["http://192.168.1.10:3099/mcp"]
  capabilities: string[];   // ["memory", "run_agent", "orchestration"]
  status: 'online' | 'offline' | 'syncing';
  lastHeartbeat: number;
  agentCount: number;
}
```

**Comment ça marche entre 2 PC distants** :

```
Machine A (Windows, IP: 192.168.1.10)
  → Overmind MCP Server écoute sur 0.0.0.0:3099 (pas juste localhost)
  → Déclare ses agents locaux
  → Se connecte à Machine B via HTTP

Machine B (Linux, IP: 192.168.1.20)  
  → Overmind MCP Server écoute sur 0.0.0.0:3099
  → Déclare ses agents locaux
  → Se connecte à Machine A via HTTP

Flux RPC:
  A.run_agent("analyse_crypto") 
    → A check si agent local disponible
    → Si non, forward à B via RPC
    → B exécute, retourne résultat à A
    → A stocke en mémoire locale + notifie B (sync)
```

**Pas besoin de WebSocket** — HTTP + polling/heartbeat suffit pour 2 noeuds.

### 1.3 Gossip Protocol (Light)

```typescript
// NOUVEAU : src/bridge/GossipEngine.ts
class GossipEngine {
  // Chaque noeud partage :
  // 1. Sa liste d'agents disponibles
  // 2. Ses capabilities (memory, compute, models)
  // 3. Son statut (load, queue depth)
  
  async broadcastKnowledge(chunk: KnowledgeChunk): Promise<void> {
    // Pousse un knowledge_chunk vers les autres noeuds
    // Pas de sync complet — seulement les nouveautés
  }
  
  async requestKnowledge(query: string): Promise<SearchResult[]> {
    // Demande aux autres noeuds de chercher dans leur mémoire
    // Agrège les résultats
  }
}
```

**Fréquence** : Heartbeat toutes les 30s, sync knowledge toutes les 5min.

---

## 📋 PHASE 2 — Mémoire Distribuée (2-3 semaines)

### 2.1 Le Problème Mémoire — Diagnostic Précis

**Ce qui existe RÉELLEMENT** :

| Couche | Implémentation | Isolation | Partage |
|---|---|---|---|
| **Fichiers plats Hermes** | MEMORY.md, USER.md | Par agent | ❌ Aucun |
| **DB locale Overmind** | `agent_<name>` PostgreSQL | Par agent | ❌ Aucun |
| **DB Core** | `overmind_core` PostgreSQL | Global | ⚠️ Existe mais vide |
| **Cross-DB search** | `searchMemory()` lignes 458-521 | Lit agent + core | ✅ Code présent |

**Le "overmind_core" EST la mémoire partagée**. Elle fonctionne. Mais :
- Personne n'y écrit systématiquement
- Pas de mécanisme de push automatique
- Pas de sync entre machines

### 2.2 Solution — 3 Zones Mémoire

```
Zone 1: PRIVATE (agent-local, jamais partagé)
  → DB: agent_<name>
  → Contenu: préférences user, corrections, notes perso
  → Flag: source = "private"

Zone 2: SHARED (noeud-local, partagé entre agents du même noeud)
  → DB: overmind_core
  → Contenu: décisions architecturales, patterns, erreurs communes
  → Flag: source = "shared"
  → Auto-sync: tout knowledge avec source="shared" → gossip push

Zone 3: FEDERATED (cross-noeuds, partagé entre toutes les machines)
  → DB: overmind_federation (nouvelle)
  → Contenu: discoveries, breakthroughs, AGI-signals
  → Flag: source = "federation"
  → Sync: gossip protocol → tous les noeuds
```

### 2.3 Modifications Code Mémoire

```typescript
// MODIFIER : PostgresMemoryProvider.ts

// Avant :
private getDbName(agentName?: string): string {
  if (!agentName) return this.coreDbName;
  return `agent_${this.sanitizeIdentifier(agentName)}`;
}

// Après :
private getDbName(agentName?: string, zone?: 'private' | 'shared' | 'federation'): string {
  switch (zone) {
    case 'private': return `agent_${this.sanitizeIdentifier(agentName!)}`;
    case 'shared': return this.coreDbName;
    case 'federation': return 'overmind_federation';
    default:
      if (!agentName) return this.coreDbName;
      return `agent_${this.sanitizeIdentifier(agentName)}`;
  }
}

// searchMemory() étendu :
async searchMemory(params: SearchMemoryParams): Promise<SearchResult[]> {
  const dbsToSearch = [
    this.getDbName(params.agentName, 'private'),  // Zone 1
    this.getDbName(undefined, 'shared'),           // Zone 2
  ];
  
  // Si federation activée, interroger les autres noeuds
  if (params.includeFederation) {
    const remoteResults = await this.gossipEngine.queryRemote(params.query);
    dbsToSearch.push(...remoteResults);
  }
  // ... reste du code existant
}
```

### 2.4 PostgreSQL Replication — Réalité Technique

**Pour 2 machines distantes, 3 options** :

| Option | Complexité | Performance | Recommandation |
|---|---|---|---|
| **A. Logical Replication PG** | 🔴 Haute | 🟢 Excellente | Si les 2 machines ont PG |
| **B. Application-level sync** | 🟡 Moyenne | 🟡 Bonne | ✅ **Recommandé** |
| **C. Shared remote PG** | 🟢 Simple | 🟡 Dépend réseau | Pour débuter |

**Recommandation** : **Option B** (application-level sync via GossipEngine).

Pourquoi :
- Pas besoin de config PG replication
- Marche avec n'importe quel hébergement PG
- Contrôle total sur quoi sync et quand
- Le code Overmind gère le sync, pas PostgreSQL

```typescript
// Flux de sync entre 2 machines :
//
// Machine A → stocke knowledge "Bitcoin pattern détecté"
//   → GossipEngine.broadcastKnowledge(chunk)
//     → HTTP POST vers Machine B /sync/knowledge
//       → Machine B reçoit, insère dans overmind_federation
//       → Machine B ACK
//   → Machine A marque comme "synced"
```

---

## 📋 PHASE 3 — Noeud RPC & Communication Distante (2 semaines)

### 3.1 Architecture RPC Réelle

```
MACHINE A (Chez toi, Windows)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  IP: 192.168.1.10 (ou IP publique avec port-forward)
  
  Process 1: Overmind MCP Server (port 3099)
    → Écoute 0.0.0.0:3099 (pas 127.0.0.1 !)
    → HTTP + JSON-RPC 2.0
    → Auth: Bearer token
    
  Process 2: Hermes Gateway (sniperbot)
    → Se connecte à localhost:3099
    
  Process 3: PostgreSQL (port 5432)
    → Écoute 0.0.0.0:5432
    → Auth: password + pg_hba.conf pour IP distante

MACHINE B (Distant, Linux/VPS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  IP: xx.xx.xx.xx
  
  Process 1: Overmind MCP Server (port 3099)
  Process 2: Hermes Gateway (autres agents)
  Process 3: PostgreSQL (port 5432)
```

### 3.2 Configuration Noeud

```yaml
# NOUVEAU FICHIER : overmind.config.yaml

node:
  id: "node_alpha"
  bind: "0.0.0.0:3099"
  auth:
    type: "bearer"
    token: "${OVERMIND_NODE_TOKEN}"  # env var
  
peers:
  - id: "node_beta"
    endpoint: "http://xx.xx.xx.xx:3099/mcp"
    token: "${OVERMIND_PEER_BETA_TOKEN}"
    sync:
      knowledge: true          # sync connaissances
      runs: false              # ne pas sync les runs (trop lourd)
      interval_ms: 300000      # sync toutes les 5 min
      
memory:
  local:
    host: "127.0.0.1"
    port: 5432
  zones:
    private: true              # agent_<name> DB
    shared: true               # overmind_core DB
    federation: true           # overmind_federation DB
  embedding:
    model: "qwen-8b"
    dimensions: 4096

agents:
  - name: "sniperbot_analyst"
    runner: "hermes"
    memory_zone: ["private", "shared"]
  - name: "federation_scanner"
    runner: "hermes"
    memory_zone: ["shared", "federation"]  # agent dédié au partage
```

### 3.3 Comment le partage fonctionne RÉELLEMENT

**Scénario : 2 ordinateurs, 1 réseau**

```
Étape 1: DÉMARRAGE
  Node A démarre → heartbeat vers Node B
  Node B démarre → heartbeat vers Node A
  Chacun déclare ses agents et capabilities

Étape 2: EXÉCUTION LOCALE
  User sur Discord → "Analyse BTC"
  Node A → sniperbot analyse → résultat stocké dans:
    - agent_sniperbot (private) ✅
    - overmind_core (shared) si info importante ✅

Étape 3: SYNC
  Toutes les 5 min:
  Node A → POST /sync/knowledge → Node B
    "J'ai appris que BTC pattern X..."
  Node B → reçoit → insère dans overmind_federation
  Node B → POST /sync/knowledge → Node A
    "J'ai découvert que ETH pattern Y..."
  Node A → reçoit → insère dans overmind_federation

Étape 4: RECHERCHE CROSS-NODE
  User → "Qu'est-ce qu'on sait sur DeFi ?"
  Node A → searchMemory()
    → DB locale (agent + core) ✅
    → DB federation (sync de B) ✅
    → RPC query vers B en temps réel (optionnel)
  Résultat = merge des 2 sources
```

**Pas besoin de** :
- ❌ Blockchain réelle (trop lent pour du RPC)
- ❌ IPFS (overkill pour 2 noeuds)
- ❌ WebSocket persistant (HTTP suffit)
- ❌ Docker/K8s (2 machines = config simple)

### 3.4 Sécurité

| Couche | Mécanisme |
|---|---|
| **Transport** | HTTPS (Let's Encrypt ou self-signed) |
| **Auth** | Bearer token par paire de noeuds |
| **Données** | Pas de clés API dans les syncs |
| **PG** | pg_hba.conf restrictif + password |
| **Memory** | Zone private JAMAIS sync |

---

## 📋 PHASE 4 — Agents Fédérés (2 semaines)

### 4.1 Federation Agent (Nouveau)

Un agent dédié à la communication inter-noeuds :

```typescript
// NOUVEAU : src/agents/FederationAgent.ts
// Rôle : passerelle entre noeuds

class FederationAgent {
  // Push : découvertes locales → autres noeuds
  async pushDiscoveries(): Promise<void> {
    const recent = await memory.searchRecent({
      zone: 'shared',
      since: this.lastSyncTimestamp,
      minScore: 0.7  // que les découvertes importantes
    });
    for (const peer of this.peers) {
      await peer.syncKnowledge(recent);
    }
  }
  
  // Pull : demander aux autres noeuds
  async pullKnowledge(query: string): Promise<SearchResult[]> {
    const results = await Promise.all(
      this.peers.map(p => p.search(query))
    );
    return this.mergeAndDedup(results);
  }
  
  // Discover : trouver de nouveaux noeuds
  async discoverNodes(): Promise<RpcNode[]> {
    // Pour l'instant: config statique
    // Futur: DNS-based discovery ou DHT
  }
}
```

### 4.2 Agent Mobility (Futur)

```typescript
// Un agent peut-il migrer entre noeuds ?
// Oui, si on sérialise son état :

interface AgentPackage {
  name: string;
  prompt: string;
  config: object;
  memory_snapshot: KnowledgeChunk[];  // top 100 connaissances
  model: string;
  runner: string;
}

// Node A → Node B : "Je te délègue sniperbot pour 1h"
// Node B restaure l'agent localement avec son snapshot mémoire
```

---

## 📋 PHASE 5 — Émergence & AGI Signals (3-4 semaines)

### 5.1 Pattern Detection Engine

```typescript
// NOUVEAU : src/emergence/PatternDetector.ts

class PatternDetector {
  // Surveille les connaissances cross-agents pour détecter
  // des patterns émergents
  
  async scanForEmergence(): Promise<EmergenceSignal[]> {
    // 1. Collecter les connaissances récentes de tous les agents
    const recentKnowledge = await this.gatherRecent();
    
    // 2. Vector clustering — est-ce que des agents 
    //    arrivent à des conclusions similaires indépendamment ?
    const clusters = await this.clusterBySimilarity(recentKnowledge);
    
    // 3. Convergence detection
    //    Si 3+ agents indépendants découvrent la même chose
    //    = signal d'émergence
    return clusters
      .filter(c => c.agentDiversity >= 3)
      .map(c => ({
        type: 'convergence',
        topic: c.centroid,
        agents: c.agentNames,
        confidence: c.score,
        timestamp: Date.now()
      }));
  }
}
```

### 5.2 AGI Signal Scoring

```typescript
interface AGISignal {
  type: 'convergence' | 'novelty' | 'self_modification' | 'cross_domain';
  confidence: number;      // 0-1
  agentCount: number;      // combien d'agents contribuent
  crossNode: boolean;      // span across nodes ?
  novelty: number;         // jamais vu avant ?
}

// Score AGI = f(convergence, cross-domain, self-modification, cross-node)
function calculateAGIScore(signals: AGISignal[]): number {
  const weights = {
    convergence: 0.3,
    cross_domain: 0.3,
    self_modification: 0.2,
    cross_node: 0.2
  };
  // ... scoring logic
}
```

---

## 📅 TIMELINE CONSOLIDÉ

| Phase | Durée | Livrables | Priorité |
|---|---|---|---|
| **Phase 1** | 2-3 sem | Config multi-source, RpcNode, GossipEngine | 🔴 Haute |
| **Phase 2** | 2-3 sem | 3 zones mémoire, sync engine | 🔴 Haute |
| **Phase 3** | 2 sem | Config YAML, auth, PG distant | 🔴 Haute |
| **Phase 4** | 2 sem | FederationAgent, agent mobility | 🟡 Moyenne |
| **Phase 5** | 3-4 sem | PatternDetector, AGIScoring | 🟢 Future |

**Total estimé** : 11-14 semaines pour le full stack.

**MVP (Phases 1-3)** : 6-8 semaines = 2 noeuds qui communiquent avec mémoire sync.

---

## ⚠️ PIÈGES IDENTIFIÉS

### Mémoire
1. **"overmind_core" est vide en pratique** — Personne n'y écrit. Il faut un mécanisme auto-push.
2. **Embedding Qwen 8B = 4096D** — Trop grand pour HNSW (>2000D). Le code fallback sur SeqScan. OK pour 2 noeuds mais pas scalable à 100+.
3. **Pas de garbage collection** — Les knowledge_chunks s'accumulent sans limite.

### RPC
4. **localhost seulement** — BridgeProxy hardcode `localhost:3099`. Faut rendre configurable.
5. **Pas d'auth** — Aucune sécurité sur le MCP server. N'importe qui peut interroger.
6. **Pas de retry distribué** — Si le noeud B est down, A ne sait pas retry.

### Réseau
7. **NAT/Firewall** — Si Machine B est derrière un NAT, faut port-forward ou VPN.
8. **Latence** — HTTP RPC sur Internet = 50-200ms par appel. Acceptable pour sync, trop lent pour inference.
9. **Split brain** — Si les 2 noeuds perdent connexion, ils divergent. Faut merge conflict resolution.

---

## 🎯 PROCHAINES ÉTAPES IMMÉDIATES

1. **Valider ce plan** — Feedback du chef
2. **Créer la branche git** `feature/network-refactor`
3. **Phase 1.1** — Refactor `PostgresMemoryProvider` pour accepter config dynamique
4. **Phase 1.2** — Créer `RpcNode.ts` avec config YAML
5. **Test local** — 2 instances Overmind sur la même machine, ports différents
6. **Test distant** — Déployer sur 2 machines réelles

---

*Ce plan est vivant. Il sera mis à jour au fur et à mesure de l'avancement.*

*— Sniperbot Analyst, Juin 2026*
