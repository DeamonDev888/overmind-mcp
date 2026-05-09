# 🐋 OverMind-MCP Swarm Orchestration - Guide d'Utilisation

## 📚 Table des Matières

1. [Introduction](#introduction)
2. [Configuration du Swarm](#configuration-du-swarm)
3. [Allocation de Tâches](#allocation-de-tâches)
4. [Workflows Long-Running](#workflows-long-running)
5. [Exemples Pratiques](#exemples-pratiques)
6. [Monitoring & Debug](#monitoring--debug)

---

## 🎯 Introduction

Le **Swarm Orchestration** d'OverMind-MCP permet :
- **Allocation dynamique** de tâches aux agents spécialisés
- **Équilibrage de charge** automatique (load balancing)
- **Workflows stateful** long-running (OSINT, analyses complètes)
- **Parallélisme intelligent** avec gestion des ressources

---

## 🏗️ Configuration du Swarm

### 1. Définir les Capacités des Agents

```typescript
import { createSwarmOrchestrator } from 'overmind-mcp';

const swarm = createSwarmOrchestrator({
  // Liste des agents disponibles avec leurs capacités
  agents: [
    {
      agentName: 'crypto-analyst',
      runner: 'claude',
      capabilities: ['analysis', 'crypto', 'osint', 'data-processing'],
      maxConcurrentTasks: 3,
      currentLoad: 0,
      estimatedCompletionTime: 120000 // 2 minutes par tâche
    },
    {
      agentName: 'web-scraper',
      runner: 'kilo',
      capabilities: ['scraping', 'web', 'data-extraction'],
      maxConcurrentTasks: 5,
      currentLoad: 0,
      estimatedCompletionTime: 60000 // 1 minute par tâche
    },
    {
      agentName: 'code-reviewer',
      runner: 'gemini',
      capabilities: ['code', 'analysis', 'review', 'security'],
      maxConcurrentTasks: 2,
      currentLoad: 0,
      estimatedCompletionTime: 180000 // 3 minutes par tâche
    }
  ],

  // Liste des tâches à exécuter
  tasks: [
    {
      id: 'task-1',
      type: 'analysis',
      prompt: 'Analyser le sentiment du marché crypto',
      priority: 10, // 1-10, 10 = priorité maximale
      requiresCapabilities: ['analysis', 'crypto'],
      estimatedDuration: 120000
    },
    {
      id: 'task-2',
      type: 'scraping',
      prompt: 'Scraper les derniers articles de CoinDesk',
      priority: 8,
      requiresCapabilities: ['scraping', 'web'],
      estimatedDuration: 60000
    }
  ],

  maxParallelTasks: 8,        // Nombre max de tâches en parallèle
  enableLoadBalancing: true,  // Activer l'équilibrage de charge
  enableTaskPriority: true    // Respecter les priorités des tâches
});
```

### 2. Stratégies d'Allocation

**Load Balancing** (recommandé) :
- Alloue les tâches en fonction de la charge actuelle des agents
- Prend en compte le temps d'achèvement estimé
- Optimise l'utilisation des ressources

**Round Robin** (simple) :
- Alloue les tâches au premier agent disponible
- Plus rapide mais moins optimal

---

## 🎮 Allocation de Tâches

### Allocation Automatique

```typescript
// Allouer les tâches aux agents disponibles
const allocations = await swarm.allocateTasks();

console.log('Allocations:', allocations);
// [
//   {
//     taskId: 'task-1',
//     agentName: 'crypto-analyst',
//     runner: 'claude',
//     estimatedStart: 1699000000000,
//     estimatedCompletion: 1699000120000
//   }
// ]
```

### Exécution des Tâches Allouées

```typescript
// Exécuter une tâche spécifique
const task = swarm.getTaskStatus('task-1');
const allocation = swarm.allocations.get('task-1');

if (task && allocation) {
  const result = await swarm.executeTask(task, allocation);

  console.log('Result:', result);
  // {
  //   taskId: 'task-1',
  //   status: 'completed',
  //   agentName: 'crypto-analyst',
  //   result: [...],
  //   startedAt: 1699000000000,
  //   completedAt: 1699000120000
  // }
}
```

---

## ⏱️ Workflows Long-Running

### 1. Définir un Workflow Long-Running

```typescript
import { startLongRunningWorkflow } from 'overmind-mcp';

const workflow = await startLongRunningWorkflow({
  batches: [
    {
      id: 'osint-batch-1',
      status: 'pending',
      tasks: [
        {
          runner: 'claude',
          prompt: 'OSINT: Analyser les mentions de BTC sur Twitter/X',
          agentName: 'crypto-analyst'
        },
        {
          runner: 'kilo',
          prompt: 'Scraper CoinDesk pour les dernières news crypto',
          agentName: 'web-scraper'
        }
      ]
    },
    {
      id: 'osint-batch-2',
      status: 'pending',
      tasks: [
        {
          runner: 'gemini',
          prompt: 'Analyser les on-chain metrics de Ethereum',
          agentName: 'crypto-analyst'
        }
      ]
    }
  ],
  maxParallelBatches: 3,
  batchTimeout: '24 hours'
});

console.log('Workflow ID:', workflow.workflowId);
```

### 2. Contrôler le Workflow

```typescript
// Obtenir l'état actuel
const state = await workflow.query(LongRunningWorkflowState);
console.log('State:', state);
// {
//   totalBatches: 2,
//   completedBatches: 1,
//   failedBatches: 0,
//   currentBatch: 'osint-batch-2',
//   errors: []
// }

// Signaux de contrôle
await workflow.signal(cancelSignal);  // Annuler le workflow
await workflow.signal(pauseSignal);   // Mettre en pause
await workflow.signal(resumeSignal);  // Reprendre
```

---

## 💼 Exemples Pratiques

### Exemple 1: Veille Crypto 24/7

```typescript
import { createSwarmOrchestrator } from 'overmind-mcp';

// Créer un swarm pour surveillance crypto 24/7
const cryptoSwarm = createSwarmOrchestrator({
  agents: [
    {
      agentName: 'btc-sentiment-analyst',
      runner: 'claude',
      capabilities: ['sentiment', 'btc', 'social-media'],
      maxConcurrentTasks: 5,
      currentLoad: 0
    },
    {
      agentName: 'eth-onchain-analyst',
      runner: 'gemini',
      capabilities: ['onchain', 'eth', 'defi'],
      maxConcurrentTasks: 3,
      currentLoad: 0
    }
  ],
  tasks: [
    {
      id: 'btc-twitter-sentiment',
      type: 'sentiment-analysis',
      prompt: 'Analyser le sentiment BTC sur Twitter (dernières 100 mentions)',
      priority: 10,
      requiresCapabilities: ['sentiment', 'btc', 'social-media'],
      estimatedDuration: 300000
    },
    {
      id: 'eth-whale-tracking',
      type: 'onchain-analysis',
      prompt: 'Tracker les mouvements de baleines Ethereum (>1000 ETH)',
      priority: 9,
      requiresCapabilities: ['onchain', 'eth'],
      estimatedDuration: 180000
    }
  ],
  maxParallelTasks: 8,
  enableLoadBalancing: true,
  enableTaskPriority: true
});

// Lancer l'allocation
const allocations = await cryptoSwarm.allocateTasks();
console.log('Crypto surveillance lancée:', allocations);
```

### Exemple 2: Analyse de Repos Entiers

```typescript
import { startLongRunningWorkflow } from 'overmind-mcp';

// Workflow longue durée pour analyser un repo complet
const repoAnalysisWorkflow = await startLongRunningWorkflow({
  batches: [
    {
      id: 'code-scanning',
      status: 'pending',
      tasks: [
        {
          runner: 'kilo',
          prompt: 'Scanner tous les fichiers TypeScript du repo pour vulnérabilités',
          agentName: 'security-scanner'
        },
        {
          runner: 'claude',
          prompt: 'Analyser l\'architecture globale du codebase',
          agentName: 'architect-analyst'
        }
      ]
    },
    {
      id: 'code-quality',
      status: 'pending',
      tasks: [
        {
          runner: 'gemini',
          prompt: 'Évaluer la qualité du code (duplication, complexité, documentation)',
          agentName: 'quality-analyst'
        }
      ]
    }
  ],
  maxParallelBatches: 2,
  batchTimeout: '4 hours'
});

// Surveiller la progression
setInterval(async () => {
  const state = await repoAnalysisWorkflow.query();
  console.log('Analyse en cours:', state);
}, 60000); // Toutes les minutes
```

### Exemple 3: Pipeline de Scraping Distribué

```typescript
// Pipeline de scraping avec allocation dynamique
const scrapingPipeline = createSwarmOrchestrator({
  agents: [
    {
      agentName: 'news-scraper',
      runner: 'kilo',
      capabilities: ['scraping', 'news', 'html-parsing'],
      maxConcurrentTasks: 10,
      currentLoad: 0
    },
    {
      agentName: 'social-scraper',
      runner: 'claude',
      capabilities: ['scraping', 'social', 'api'],
      maxConcurrentTasks: 5,
      currentLoad: 0
    }
  ],
  tasks: [
    {
      id: 'scrape-coindesk',
      type: 'scraping',
      prompt: 'Scraper les 50 derniers articles de CoinDesk',
      priority: 10,
      requiresCapabilities: ['scraping', 'news'],
      estimatedDuration: 120000
    },
    {
      id: 'scrape-reddit-crypto',
      type: 'scraping',
      prompt: 'Scraper r/CryptoCurrency pour les posts trending',
      priority: 9,
      requiresCapabilities: ['scraping', 'social'],
      estimatedDuration: 180000
    }
  ],
  maxParallelTasks: 15,
  enableLoadBalancing: true,
  enableTaskPriority: true
});

// Exécuter en continu
setInterval(async () => {
  const stats = scrapingPipeline.getStatistics();
  console.log('Pipeline stats:', stats);
  // {
  //   totalTasks: 100,
  //   completed: 45,
  //   failed: 2,
  //   running: 10,
  //   pending: 43,
  //   totalAgents: 2,
  //   averageLoad: 3.5
  // }
}, 30000); // Toutes les 30 secondes
```

---

## 🔍 Monitoring & Debug

### Statistiques du Swarm

```typescript
// Statistiques globales
const stats = swarm.getStatistics();
console.log('Swarm Statistics:', stats);
// {
//   totalTasks: 50,
//   completed: 20,
//   failed: 2,
//   running: 5,
//   pending: 23,
//   totalAgents: 3,
//   averageLoad: 2.5
// }

// État d'un agent spécifique
const agentStatus = swarm.getAgentStatus('crypto-analyst');
console.log('Agent Status:', agentStatus);
// {
//   agentName: 'crypto-analyst',
//   runner: 'claude',
//   capabilities: ['analysis', 'crypto', 'osint'],
//   maxConcurrentTasks: 3,
//   currentLoad: 2,
//   estimatedCompletionTime: 120000
// }

// Résultats de toutes les tâches
const allResults = swarm.getAllResults();
console.log('All Results:', allResults);

// Tâches en attente
const pendingTasks = swarm.getPendingTasks();
console.log('Pending Tasks:', pendingTasks);
```

### Debug Workflow Long-Running

```typescript
// Obtenir un handle sur un workflow existant
import { getLongRunningWorkflowHandle } from 'overmind-mcp';

const workflow = await getLongRunningWorkflowHandle('long-running-1699000000');

// État actuel
const state = await workflow.query();
console.log('Workflow State:', state);

// Historique d'exécution
const history = await workflow.history();
console.log('Workflow History:', history.events);
```

---

## 🚀 Bonnes Pratiques

1. **Capacités des Agents** : Définissez des capacités précises pour une allocation optimale
2. **Priorités des Tâches** : Utilisez la priorité (1-10) pour les tâches critiques
3. **Parallelisme** : Ajustez `maxParallelTasks` selon vos ressources (RAM, CPU)
4. **Timeouts** : Définissez des `estimatedDuration` réalistes pour éviter les blocages
5. **Monitoring** : Surveillez régulièrement les statistiques du swarm
6. **Fallback** : Prévoyez des agents de secours pour les tâches critiques

---

## 📚 Ressources Additionnelles

- **API Temporal**: https://docs.temporal.io
- **Guide Swarm**: https://github.com/DeamonDev888/overmind-mcp
- **Support Discord**: https://discord.gg/4AR82phtBz
