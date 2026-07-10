# 🌉 Architecture 6 Bridges Isolés NEXUS — Peer-to-Peer

> **Version**: NEXUS V17 — Architecture corrigée 2026-07-09
> **Pattern**: 6 processes `overmind-bridge` INDÉPENDANTS, communication HTTP A2A inter-bridges
> **PAS de dispatcher central sur :3100** — chaque bridge a son port, son agent, son .env, ses logs

---

## ❌ Ce que ce n'est PAS

- ❌ Un seul `OverBridgeServer` partagé sur :3100 qui dispatche
- ❌ Un `OvermindBridge` qui route les appels vers les 6 agents
- ❌ Un bridge "central" qui connaît tous les agents

## ✅ Ce que c'est

Chaque agent NEXUS = **un process `overmind-bridge server` autonome** avec :
- Son propre port dédié
- Son agent dédié (configuré via flag)
- Son propre .env (clés API, peers)
- Ses propres logs
- Ses propres clients HTTP vers les autres bridges

La communication A2A = **HTTP POST inter-bridges** : agent A veut parler à agent B → POST `http://localhost:<port_b>/rpc` avec `agent.run`.

---

## Allocation des Ports

| Bridge # | Port | Agent | Runner | Script |
|----------|------|-------|--------|--------|
| #1 | **:3101** | `nexus_master` | hermes | `start-bridge-master.ps1` |
| #2 | **:3102** | `nexus_trader` | hermes | `start-bridge-trader.ps1` |
| #3 | **:3103** | `nexus_risk_manager` | hermes | `start-bridge-risk.ps1` |
| #4 | **:3104** | `nexus_healer` | hermes | `start-bridge-healer.ps1` |
| #5 | **:3105** | `nexus_researcher` | hermes | `start-bridge-researcher.ps1` |
| #6 | **:3106** | `nexus_publisher` | hermes | `start-bridge-publisher.ps1` |

## Services PARTAGÉS (single instance, utilisés par les 6 bridges)

| Service | Port | Pourquoi single |
|---------|------|------------------|
| **Overmind MCP Server** | :3099 | Routing centralisé — tous les bridges passent par lui pour `run_agent` |
| **Hermes Gateway API** | :8642 | `X-Hermes-Profile` header route vers le bon profil — 1 process Python = 6 profils |
| **PostgreSQL** | :5432 | `MessageLog` partagé — tous les bridges écrivent leurs A2A messages dans la même table `bridge_messages` |

---

## Topologie Réseau

```
┌────────────────────────────────────────────────────────────────────────┐
│                   6 BRIDGES ISOLÉS — P2P                                │
│                                                                        │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    │
│  │ :3101           │    │ :3102           │    │ :3103           │    │
│  │ nexus_master    │◄──►│ nexus_trader    │◄──►│ nexus_risk_mgr  │    │
│  │ bridge.ts       │    │ bridge.ts       │    │ bridge.ts       │    │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘    │
│           │ HTTP A2A            │ HTTP A2A            │ HTTP A2A      │
│           │                     │                     │               │
│  ┌────────▼────────┐    ┌───────▼─────────┐    ┌──────▼──────────┐    │
│  │ :3104           │    │ :3105           │    │ :3106           │    │
│  │ nexus_healer    │◄──►│ nexus_researcher│◄──►│ nexus_publisher │    │
│  │ bridge.ts       │    │ bridge.ts       │    │ bridge.ts       │    │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘    │
│                                                                        │
│           │                     │                     │               │
│           └─────────────────────┼─────────────────────┘               │
│                                 │                                      │
│                                 ▼                                      │
│           ┌──────────────────────────────────────┐                   │
│           │  SERVICES PARTAGÉS (single)           │                   │
│           │  • :3099  Overmind MCP Server         │                   │
│           │  • :8642  Hermes Gateway API          │                   │
│           │  • :5432  PostgreSQL (MessageLog)     │                   │
│           └──────────────────────────────────────┘                   │
└────────────────────────────────────────────────────────────────────────┘
```

### Pattern de Communication

Quand `nexus_master` veut demander à `nexus_trader` d'exécuter un trade :

```typescript
// Dans bridges/nexus_master/src/clients/MasterToTrader.ts
import { BridgeClient } from '@nexus/bridge-common';

export class MasterToTrader {
  private client = new BridgeClient('http://127.0.0.1:3102');

  async requestTrade(symbol: string, action: 'buy' | 'sell', size: number) {
    return this.client.call('agent.run', {
      agentName: 'nexus_trader',
      runner: 'hermes',
      prompt: `Exécute trade: ${action} ${size} ${symbol}`,
      externalKey: 'master_to_trader',
    });
  }
}
```

**Flow** :
1. `nexus_master` (port 3101) reçoit une requête externe
2. Il appelle `MasterToTrader.requestTrade()` 
3. `BridgeClient` fait `POST http://127.0.0.1:3102/rpc`
4. Le bridge `nexus_trader` (port 3102) reçoit, exécute via MCP
5. Réponse remontée : `nexus_trader` → `nexus_master` → client externe

---

## Arborescence des Bridges

```
C:\Users\Deamon\Nexus\
│
├── bridges/                            ← 6 WRAPPERS ISOLÉS (un par agent)
│   │
│   ├── nexus_master/                   ← Bridge #1 (:3101)
│   │   ├── package.json                ← name: @nexus/bridge-master, dep: overmind-mcp
│   │   ├── tsconfig.json
│   │   ├── .env                        ← AGENT_NAME, BRIDGE_PORT=3101, peers URLs
│   │   ├── README.md
│   │   ├── src/
│   │   │   ├── bridge.ts               ← Entry point — lance OverBridgeServer
│   │   │   ├── config.ts               ← Lit .env + export config typée
│   │   │   ├── logger.ts               ← Pino logger dédié
│   │   │   ├── startup.ts              ← init MessageLog + SessionStore + connect MCP
│   │   │   └── clients/
│   │   │       ├── MasterToTrader.ts   ← POST :3102/rpc
│   │   │       ├── MasterToRisk.ts     ← POST :3103/rpc
│   │   │       ├── MasterToResearcher.ts ← POST :3105/rpc
│   │   │       └── MasterToPublisher.ts  ← POST :3106/rpc
│   │   ├── logs/
│   │   │   └── bridge-master.log
│   │   └── dist/                       ← Compilé
│   │
│   ├── nexus_trader/                   ← Bridge #2 (:3102)
│   │   ├── package.json                ← name: @nexus/bridge-trader
│   │   ├── .env                        ← BRIDGE_PORT=3102
│   │   ├── src/
│   │   │   ├── bridge.ts
│   │   │   └── clients/
│   │   │       ├── TraderToMaster.ts   ← POST :3101/rpc (comm au maître)
│   │   │       ├── TraderToRisk.ts     ← POST :3103/rpc (check risk)
│   │   │       └── TraderToPublisher.ts ← POST :3106/rpc (publier trade)
│   │   └── ...
│   │
│   ├── nexus_risk_manager/             ← Bridge #3 (:3103)
│   │   └── ...
│   ├── nexus_healer/                   ← Bridge #4 (:3104)
│   │   └── ...
│   ├── nexus_researcher/               ← Bridge #5 (:3105)
│   │   └── ...
│   └── nexus_publisher/                ← Bridge #6 (:3106)
│       └── ...
│
├── common/                             ← PARTAGÉ entre les 6 bridges
│   ├── package.json                    ← name: @nexus/bridge-common
│   ├── src/
│   │   ├── BaseBridge.ts               ← Classe abstraite — factorise le boot
│   │   ├── BridgeClient.ts             ← Client HTTP vers un autre bridge
│   │   ├── types.ts                    ← Interfaces partagées
│   │   └── logger.ts                   ← Pino config commune
│   └── dist/
│
├── profiles/                           ← Profils Hermes (existants)
│   ├── nexus_master/{config.yaml,SOUL.md,.env,memories/,sessions/}
│   ├── nexus_trader/
│   ├── nexus_risk_manager/
│   ├── nexus_healer/
│   ├── nexus_researcher/
│   └── nexus_publisher/
│
├── shared-infra/                       ← SERVICES PARTAGÉS (déjà en prod)
│   ├── mcp-server/                     ← Overmind MCP :3099
│   ├── hermes-gateway/                 ← Gateway :8642
│   └── postgres/                       ← :5432
│
├── scripts/                            ← SCRIPTS DE GESTION
│   ├── start-all-bridges.ps1           ← Démarre les 6 en parallèle (Start-Job)
│   ├── stop-all-bridges.ps1
│   ├── status-bridges.ps1
│   ├── seed-bridges.ps1                ← Crée dossiers + .env pour les 6
│   └── test-a2a-network.ps1            ← Test E2E inter-bridges
│
└── logs/
    ├── bridges/
    │   ├── nexus_master.log
    │   ├── nexus_trader.log
    │   ├── nexus_risk_manager.log
    │   ├── nexus_healer.log
    │   ├── nexus_researcher.log
    │   └── nexus_publisher.log
    └── network/
        └── a2a-traffic.log
```

---

## Fichiers Clés

### 1. `bridges/nexus_master/.env`

```bash
# === Bridge :3101 — nexus_master ===
AGENT_NAME=nexus_master
RUNNER=hermes
BRIDGE_PORT=3101
BRIDGE_HOST=127.0.0.1

# Upstream (services partagés)
MCP_URL=http://[::1]:3099/mcp
HERMES_GATEWAY_URL=http://127.0.0.1:8642
HERMES_GATEWAY_KEY=hIhOKpVn3AgfW_sQO8XShjMb8YRhaZngSSv6UsWY0dc
POSTGRES_HOST=localhost
POSTGRES_DB=overmind
POSTGRES_USER=overmind
POSTGRES_PASSWORD=***

# Peers (autres bridges)
PEER_TRADER_URL=http://127.0.0.1:3102
PEER_RISK_URL=http://127.0.0.1:3103
PEER_HEALER_URL=http://127.0.0.1:3104
PEER_RESEARCHER_URL=http://127.0.0.1:3105
PEER_PUBLISHER_URL=http://127.0.0.1:3106

# Session config
SESSION_TTL_MS=14400000
MESSAGE_LOG_ENABLED=true
DIRECTIVES_ENABLED=true
```

### 2. `common/src/BaseBridge.ts` (partagé)

```typescript
import {
  OverBridgeServer,
  OverBridgeService,
  loadMessageLogConfigFromEnv,
  createBridgeLogger,
} from 'overmind-mcp/bridge';
import { BridgeClient } from './BridgeClient.js';

export interface BaseBridgeConfig {
  agentName: string;
  port: number;
  host: string;
  mcpUrl: string;
  logger: any;
}

export abstract class BaseBridge {
  protected service: OverBridgeService;
  protected server: OverBridgeServer;

  constructor(protected config: BaseBridgeConfig) {
    this.service = new OverBridgeService({
      mcpUrl: config.mcpUrl,
      defaultTimeoutMs: 60_000,
      agentTimeoutMs: 2_700_000,
      maxRetries: 2,
    }, config.logger);

    this.server = new OverBridgeServer(this.service, {
      port: config.port,
      host: config.host,
      postgres: loadMessageLogConfigFromEnv(),
      enableMessageLog: true,
      enableSessionStore: true,
      enableDirectives: true,
      sessionTtlMs: 4 * 60 * 60 * 1000,
      rateLimitMax: 200,
      sanitizeJson: true,
    }, config.logger);
  }

  abstract getClients(): BridgeClient[];

  async start(): Promise<void> {
    await this.server.start();
    this.config.logger.info(`🚀 Bridge ${this.config.agentName} ready on :${this.config.port}`);
    for (const client of this.getClients()) {
      await client.healthCheck();
    }
  }

  async stop(): Promise<void> {
    await this.server.stop();
  }
}
```

### 3. `bridges/nexus_master/src/bridge.ts`

```typescript
import { BaseBridge } from '@nexus/bridge-common';
import { config } from './config.js';
import { MasterToTrader } from './clients/MasterToTrader.js';
import { MasterToRisk } from './clients/MasterToRisk.js';
import { MasterToResearcher } from './clients/MasterToResearcher.js';
import { MasterToPublisher } from './clients/MasterToPublisher.js';
import { logger } from './logger.js';

class MasterBridge extends BaseBridge {
  protected getClients() {
    return [
      new MasterToTrader(config.peerTraderUrl, logger),
      new MasterToRisk(config.peerRiskUrl, logger),
      new MasterToResearcher(config.peerResearcherUrl, logger),
      new MasterToPublisher(config.peerPublisherUrl, logger),
    ];
  }
}

const bridge = new MasterBridge();
await bridge.start();
```

### 4. `bridges/nexus_master/src/clients/MasterToTrader.ts`

```typescript
import { BridgeClient } from '@nexus/bridge-common';

export class MasterToTrader {
  private client: BridgeClient;

  constructor(traderUrl: string, logger: any) {
    this.client = new BridgeClient(traderUrl, logger);
  }

  async requestTrade(symbol: string, action: 'buy' | 'sell', size: number): Promise<any> {
    return this.client.call('agent.run', {
      agentName: 'nexus_trader',
      runner: 'hermes',
      prompt: `Exécute trade: ${action} ${size} ${symbol}`,
      externalKey: 'master_to_trader',
    });
  }

  async askAnalysis(marketData: any): Promise<any> {
    return this.client.call('agent.run', {
      agentName: 'nexus_trader',
      runner: 'hermes',
      prompt: `Analyse ces données: ${JSON.stringify(marketData)}`,
    });
  }
}
```

---

## Scripts de Gestion

### `scripts/start-all-bridges.ps1`

```powershell
# Démarre les 6 bridges en parallèle
$bridges = @(
    @{ Name="master"; Port=3101 },
    @{ Name="trader"; Port=3102 },
    @{ Name="risk_manager"; Port=3103 },
    @{ Name="healer"; Port=3104 },
    @{ Name="researcher"; Port=3105 },
    @{ Name="publisher"; Port=3106 }
)

$jobs = @()
foreach ($b in $bridges) {
    $script = "cd '$PSScriptRoot\..\bridges\nexus_$($b.Name)' ; node dist/bridge.js"
    $jobs += Start-Job -ScriptBlock { Invoke-Expression $args[0] } -ArgumentList $script
    Write-Host "✅ Started nexus_$($b.Name) on :$($b.Port)"
}

Write-Host "`n6 bridges running. Press Ctrl+C to stop."
Wait-Job -Job $jobs
```

### `scripts/seed-bridges.ps1`

```powershell
# Crée la structure de dossiers + .env pour les 6 bridges
$template = @'
AGENT_NAME={AGENT}
RUNNER=hermes
BRIDGE_PORT={PORT}
BRIDGE_HOST=127.0.0.1
MCP_URL=http://[::1]:3099/mcp
HERMES_GATEWAY_URL=http://127.0.0.1:8642
HERMES_GATEWAY_KEY=<KEY>
PEER_TRADER_URL=http://127.0.0.1:3102
PEER_RISK_URL=http://127.0.0.1:3103
PEER_HEALER_URL=http://127.0.0.1:3104
PEER_RESEARCHER_URL=http://127.0.0.1:3105
PEER_PUBLISHER_URL=http://127.0.0.1:3106
'@

$config = @(
    @{ Name="master"; Port=3101 },
    @{ Name="trader"; Port=3102 },
    @{ Name="risk_manager"; Port=3103 },
    @{ Name="healer"; Port=3104 },
    @{ Name="researcher"; Port=3105 },
    @{ Name="publisher"; Port=3106 }
)

foreach ($c in $config) {
    $dir = "$PSScriptRoot\..\bridges\nexus_$($c.Name)"
    New-Item -ItemType Directory -Force -Path "$dir/src/clients"
    New-Item -ItemType Directory -Force -Path "$dir/logs"
    $env = $template -replace '{AGENT}', "nexus_$($c.Name)" -replace '{PORT}', $c.Port
    Set-Content -Path "$dir/.env" -Value $env
    Write-Host "✅ Seeded nexus_$($c.Name) on :$($c.Port)"
}
```

---

## Avantages de cette Architecture

| Bénéfice | Explication |
|----------|-------------|
| **Isolation** | Chaque agent = son process, son port, ses logs. Crash d'un agent ≠ crash des autres. |
| **Scaling indépendant** | Tu peux redémarrer `nexus_trader` sans toucher aux autres. |
| **Monitoring clair** | `GET :3101/health`, `GET :3102/health`, etc. — chaque agent a sa métrique. |
| **Déploiement granulaire** | Tu peux déployer un agent sur une autre machine en gardant le même code. |
| **Logs séparés** | `logs/bridges/nexus_master.log` — debugging facile par agent. |
| **Config par agent** | `.env` dédié — clés API différentes si besoin. |
| **Pas de SPOF** | Si le bridge master crash, les 5 autres continuent à fonctionner entre eux. |

## Flow Complet — Exemple Concret

```
Discord !sniper trade BTC
  ↓
discord_llm bridge (:3001)
  ↓ HTTP POST /send
  ↓
nexus_master bridge (:3101)
  ↓ BridgeClient.call('agent.run', agentName='nexus_trader')
  ↓ HTTP POST http://localhost:3102/rpc
  ↓
nexus_trader bridge (:3102)
  ↓ service.runAgent() → BridgeProxy → HTTP POST :3099/mcp
  ↓
Overmind MCP Server (:3099)
  ↓ runHermesAgent() → HermesGatewayRunner
  ↓ HTTP POST :8642/v1/chat/completions + X-Hermes-Profile: nexus_trader
  ↓
Hermes Gateway (:8642)
  ↓ Route vers profil nexus_trader
  ↓ Response: "BUY 0.1 BTC @ 67500"
  ↑ retour en sens inverse ↑
```

---

## Références

- `overmind-mcp/bridge` exports : `OverBridgeServer`, `OverBridgeService`, `BridgeProxy`, `SessionStore`, `MessageLog`
- Doc source : `Workflow/src/bridge/OverBridgeServer.ts` (1928 lignes)
- Profils Hermes existants : `~/.hermes/profiles/nexus_*` (7 profils créés)
- Gateway API : `Workflow/src/services/HermesGatewayRunner.ts` (HTTP+SSE, port 8642)