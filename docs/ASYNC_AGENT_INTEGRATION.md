# OverMind Async Agent Integration — Process Registry & PID Tracking

> **Problème résolu** : Les agents IA sont invoked en async via MCP, mais le seul lien avec le processus fils est le `sessionId` (généré par le runner, opaque pour OverMind). Si le processus parent meurt, le `sessionId` est perdu et le child process devient orphelin.
>
> **Solution** : Un **Process Registry** qui stocke le mapping `pid ↔ sessionId ↔ agentName`, persistant dans `sessions.json`, permettant de :
> - Se rattacher à un agent en cours via son PID
> - Vérifier si un agent est encore vivant
> - Tuer un agent par son PID
> - Streamer output en temps réel

---

## 1. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  MCP Tool: run_agent() (async, non-blocking)                  │
│                                                              │
│  1. Spawn child process (claude/kilo/gemini/etc.)           │
│  2. Register { pid, sessionId, agentName, runner, ts }     │
│  3. Return immediately with { sessionId, pid }             │
│     → Client can poll / attach to PID                       │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐  │
│  │  Process Registry │◄──│  child.on('data')             │  │
│  │  (sessions.json)  │    │  → buffers output            │  │
│  │                   │    │  → checks liveliness         │  │
│  │  { pid, sessionId,│    └──────────────────────────────┘  │
│  │    agentName,     │                                     │
│  │    runner, status,│    ┌──────────────────────────────┐  │
│  │    startedAt }    │    │  MCP Tool: get_agent_status() │  │
│  └──────────────────┘    │  → returns live output        │  │
│                          │  → pid / alive / output so far │  │
│                          └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. Sessions JSON — Nouveau Format

**Avant** (sessions.json) :
```json
{
  "kilo:sniper_analyst": { "id": "sess_abc123", "ts": 1746892800000 }
}
```

**Après** (sessions.json + process registry) :
```json
{
  "kilo:sniper_analyst": {
    "id": "sess_abc123",
    "ts": 1746892800000,
    "pid": 12345,
    "status": "running",
    "outputBuffer": ""
  },
  "claude:planner": {
    "id": "sess_def456",
    "ts": 1746892900000,
    "pid": 67890,
    "status": "running",
    "outputBuffer": "Thinking...\n"
  }
}
```

Le champ `status` peut être :
- `running` — processus actif, PID valide
- `done` — terminé avec succès (garde le last output pour retrieval)
- `failed` — terminé avec erreur
- `orphaned` — le parent a crash mais le child tourne encore

---

## 3. Runner Changes — Spawn & Register

Chaque runner (Claude, Kilo, Gemini, Hermes, etc.) doit :

1. **Stocker le PID** dès le `spawn()` :
```typescript
const child = spawn(command, args, options);
// Immediately register
await registerProcess(child.pid, {
  sessionId: undefined,      // filled when runner gives us sessionId
  agentName,
  runner,
  startedAt: Date.now(),
  status: 'running',
});
```

2. **Mettre à jour avec le sessionId** dès qu'il est reçu :
```typescript
child.stdout?.on('data', (d) => {
  const chunk = d.toString();
  outputBuffer += chunk;
  // Si le sessionId arrive pour la première fois
  if (sessionId && !currentSessionId) {
    currentSessionId = sessionId;
    await updateProcessSession(sessionId, child.pid);
  }
});
```

3. **Marquer `done/failed`** à `child.on('close')` :
```typescript
child.on('close', async (code) => {
  await updateProcessStatus(child.pid, code === 0 ? 'done' : 'failed');
});
```

4. **Cleanup à la terminaison** :
```typescript
// Supprimer après 1h ( TTL ) ou sur explicit delete
await unregisterProcess(pid);
```

---

## 4. Nouvelles Fonctions Registry

```typescript
// ─── Register a new running process ───────────────────────────
/**
 * Called immediately after spawn(). Records the PID before the sessionId
 * is known (sessionId arrives later from stdout).
 */
export async function registerProcess(
  pid: number,
  meta: {
    agentName: string;
    runner: string;
    startedAt: number;
    configPath?: string;
  },
): Promise<void> { ... }

/**
 * Called when the runner emits a sessionId for the first time.
 * Links sessionId ↔ pid in the registry.
 */
export async function linkSessionToPid(
  sessionId: string,
  pid: number,
  configPath?: string,
): Promise<void> { ... }

/**
 * Update output buffer for live streaming.
 */
export async function appendOutput(
  pid: number,
  chunk: string,
  configPath?: string,
): Promise<void> { ... }

/**
 * Get current status + output buffer for a process.
 */
export async function getProcessStatus(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<ProcessStatus | null> { ... }

/**
 * Kill a running agent by PID (Windows: taskkill /F /T /PID; Unix: SIGKILL).
 */
export async function killAgent(
  agentName: string,
  runner?: string,
  configPath?: string,
): Promise<boolean> { ... }

/**
 * Unregister (cleanup) a process entry.
 */
export async function unregisterProcess(
  pid: number,
  configPath?: string,
): Promise<void> { ... }
```

---

## 5. TTL & Cleanup

```typescript
const PROCESS_TTL_MS = 60 * 60 * 1000; // 1 hour after 'done'/'failed'
const ORPHAN_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// On startup, scan for:
// 1. 'running' entries where the PID no longer exists → mark 'orphaned'
// 2. 'done'/'failed' entries older than PROCESS_TTL_MS → unregister
```

---

## 6. Nouveaux Outils MCP

### `get_agent_status`
```typescript
{
  agentName: string;
  runner?: string; // defaults to 'claude' if omitted
}
// Returns:
// { status, pid, outputBuffer, startedAt, sessionId }
```

### `stream_agent_output`
```typescript
{
  agentName: string;
  runner?: string;
  sinceTimestamp?: number; // only return output after this ts
}
// Returns:
// { output: string, status, isComplete: boolean }
```

### `kill_agent`
```typescript
{
  agentName: string;
  runner?: string;
}
// Returns:
// { killed: boolean, pid: number }
```

### `wait_agent`
```typescript
{
  agentName: string;
  runner?: string;
  timeoutMs?: number; // default: 900000 (15 min)
}
// Polls until status !== 'running', returns final result
// Returns:
// { status, result, exitCode }
```

---

## 7. Flux Complet — Async Agent Lifecycle

```
Client                    OverMind MCP                   Runner
  │                           │                            │
  │  run_agent()              │                            │
  │─────────────────────────►│                            │
  │                           │  spawn(child)               │
  │                           │───────────────────────────►│
  │                           │  registerProcess(pid)      │
  │                           │  Return { sessionId, pid } │
  │  { sessionId, pid }       │                            │
  │◄──────────────────────────│                            │
  │                           │                            │
  │  get_agent_status()        │                            │
  │─────────────────────────►│                            │
  │                           │  getProcessStatus()        │
  │  { status, outputBuffer }│                            │
  │◄──────────────────────────│                            │
  │                           │  stdout.on('data')         │
  │                           │◄──────────────────────────│
  │                           │  appendOutput(pid, chunk) │
  │                           │                            │
  │  stream_agent_output()    │                            │
  │─────────────────────────►│                            │
  │  { output, status }       │                            │
  │◄──────────────────────────│                            │
  │                           │  child.on('close')        │
  │                           │◄──────────────────────────│
  │                           │  updateProcessStatus(done) │
  │                           │                            │
  │  wait_agent()              │                            │
  │─────────────────────────►│                            │
  │  Polls until done          │                            │
  │  { status, result }       │                            │
  │◄──────────────────────────│                            │
```

---

## 8. Backward Compatibility

- Les champs existants (`id`, `ts`) dans `sessions.json` ne changent pas
- `status`, `pid`, `outputBuffer` sont **ajoutés** (optionnels)
- Le `sessionId` reste le même — les outils existants (`autoResume`) continuent de fonctionner
- Si `pid` n'existe pas dans une entrée (sessions anciennes), le status est déduit de `ts` :
  - `ts` < 30 jours + pas de `pid` → `done` (legacy)
  - `ts` récent + pas de `pid` → `running` (legacy, mais incertain)

---

## 9. Implémentation Minimale — Checklist

- [ ] `src/lib/processRegistry.ts` — nouvelles fonctions (register, link, append, status, kill, unregister)
- [ ] `src/lib/sessions.ts` — ajout champs `pid`, `status`, `outputBuffer`
- [ ] Chaque runner (8 fichiers) — ajouter `registerProcess()` après `spawn()`
- [ ] Chaque runner — ajouter `appendOutput()` dans `stdout.on('data')`
- [ ] Chaque runner — ajouter `updateProcessStatus()` dans `child.on('close')`
- [ ] `src/tools/get_agent_status.ts` — nouvel outil MCP
- [ ] `src/tools/stream_agent_output.ts` — nouvel outil MCP
- [ ] `src/tools/kill_agent.ts` — nouvel outil MCP
- [ ] `src/tools/wait_agent.ts` — nouvel outil MCP
- [ ] `server.ts` — register les 4 nouveaux outils
- [ ] Tests dans `src/__tests__/processRegistry.test.ts`
