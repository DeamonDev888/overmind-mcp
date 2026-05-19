# Overmind Memory MCP — Hermes Plugin

> 🧠 **4096-Dimension RAG Memory** — Semantic search powered by Qwen 8B embeddings through PostgreSQL + pgvector. Each memory chunk is a 4096-dimensional vector — that's more dimensions than a goldfish brain.
>
> 🔒 **Isolated Memory Per Agent** — Every agent gets its own private memory database while still having access to a shared knowledge base. Your AI remembers everything, but agents keep their secrets.
>
> ⚡ **Free & Self-Hosted** — Runs on your existing PostgreSQL + Qwen (via OpenRouter or Ollama). No subscriptions, no cloud dependency, no $700 Mac Mini required. Your current server is already powerful enough.

Cross-session semantic memory layer for Hermes powered by Overmind MCP.

---

## What It Does

The Overmind Memory plugin replaces Hermes' flat `MEMORY.md` / `USER.md` files with a persistent, vector-searchable memory store. It hooks into Hermes' session lifecycle and automatically:

| Event | What Happens |
|-------|-------------|
| Before each turn | Embeds the query → searches Overmind → injects relevant context |
| After each turn | Stores the exchange as a retrievable memory chunk |
| When you use `memory` tool | Mirrors the write to Overmind automatically |
| Session ends | Generates and stores a session summary |
| Subagent completes | Archives the delegation result |

**3 explicit tools** are also available for deliberate use:

- `overmind_memory_store(text, source, agent_name)` — persist any knowledge
- `overmind_memory_search(query, limit, agent_name)` — semantic recall
- `overmind_memory_runs(runner, limit, stats)` — agent run history

---

## Why It Matters

| Traditional Memory | Overmind Memory |
|-------------------|-----------------|
| Flat text files, no search | Vector similarity search in milliseconds |
| Manual, easy to forget | Automatic — every turn is remembered |
| No context ranking | Freshness-weighted reranking (15% time decay) |
| Single shared file | Per-agent isolation + shared knowledge base |
| No embeddings | 4096D Qwen 8B semantic embeddings |

---

## Prerequisites

### 1. Overmind MCP Server on port 3099

```bash
cd /path/to/Workflow
./bin/install-overmind-windows.bat
# ou manuellement:
node dist/bin/cli.js --transport httpStream --port 3099
```

Verify it's running:
```bash
curl http://localhost:3099/health
# Expected: ✓ Ok
```

### 2. PostgreSQL + pgvector

Overmind stores all memory in PostgreSQL with pgvector indexes.

**Database initialization** (runs automatically via Docker, or manually):

```bash
psql -h localhost -U postgres -d overmind_memory -f db/init-overmind-db.sql
```

Creates: `overmind_agents`, `overmind_memories` (4096D vector index), `overmind_sessions`.

### 3. Environment variables (`.env`)

Add these to `Workflow/.env`:

```env
# ── Database ────────────────────────────────────────────────────────────────
OVERMIND_MEMORY_TYPE=postgres
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=overmind_memory   # per-agent: agent_hermes, agent_sniper, etc.
POSTGRES_SSL=false

# ── Embedding / OpenRouter ─────────────────────────────────────────────────
OVERMIND_EMBEDDING_KEY=sk-or-v2-...     # OpenRouter API key
OVERMIND_EMBEDDING_MODEL=qwen/qwen3-embedding-8b
OVERMIND_EMBEDDING_URL=https://openrouter.ai/api/v1
OVERMIND_EMBEDDING_DIMENSIONS=4096

# ── Server ─────────────────────────────────────────────────────────────────
OVERMIND_HTTP_MODE=false
OVERMIND_HTTP_PORT=3099
OVERMIND_WORKSPACE=C:\path\to\Workflow
```

---

## Installation

### Step 1 — Copy plugin to Hermes

```
<HERMES_HOME>/
└── plugins/
    └── memory/
        └── overmind/
            ├── __init__.py      ← MemoryProvider + tool schemas
            ├── client.py         ← HTTP MCP client (SSE/JSON-RPC)
            └── README.md         ← You are here
```

```bash
# From the plugin package
cp -r plugins/memory/overmind <HERMES_HOME>/plugins/memory/
```

### Step 2 — Configure `config.yaml`

Edit `<HERMES_HOME>/config.yaml`:

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  user_char_limit: 1375
  provider: overmind           # ← activates the plugin
  nudge_interval: 10
  flush_min_turns: 6
  overmind:
    url: http://localhost:3099/mcp
    agent_name: hermes         # agent isolation namespace
    search_limit: 5            # max results per prefetch
    auto_store: true           # auto-store each turn
    auto_search: true          # auto-search before each turn
```

### Step 3 — (Optional) Expose MCP tools directly

For full Overmind tool access as native MCP:

```yaml
mcp_servers:
  overmind:
    url: http://localhost:3099/mcp
  postgres:
    url: http://localhost:5433/mcp
  memory:
    type: http
    url: http://localhost:3099/mcp
```

### Step 4 — Restart Hermes

```bash
hermes
```

### Step 5 — Verify

```bash
# Check agent.log for:
hermes logs | grep -i overmind
# Expected: "Overmind memory provider initialized"

# Or health check:
curl http://localhost:3099/health
# Expected: ✓ Ok
```

---

## Configuration Reference

| Key | Default | Description |
|-----|---------|-------------|
| `memory.provider` | `""` | Set to `overmind` to activate |
| `overmind.url` | `http://localhost:3099/mcp` | Overmind MCP HTTP endpoint |
| `overmind.agent_name` | `hermes` | PostgreSQL DB name for this agent |
| `overmind.search_limit` | `5` | Max results returned per search |
| `overmind.auto_store` | `true` | Automatically store each turn |
| `overmind.auto_search` | `true` | Prefetch relevant context before turns |

### Agent Isolation

Overmind creates a separate PostgreSQL database per agent:

| `agent_name` | Database | Scope |
|--------------|----------|-------|
| unset | `overmind_core` | Shared across all agents |
| `hermes` | `agent_hermes` | Private to this Hermes instance |
| `sniper` | `agent_sniper` | Private to the `sniper` agent |

---

## Memory Sources

Use the right source tag when storing deliberately:

| Source | When to use | Example |
|--------|-------------|---------|
| `user` | User preferences, facts about them | `"Prefers short, direct answers"` |
| `agent` | Auto-stored turns & sessions | Set automatically by the plugin |
| `pattern` | Reusable code or workflow patterns | `"MCP HTTP singleton: one port per server"` |
| `error` | Known bugs and their solutions | `"OVERMIND_HTTP_MODE=true causes immediate exit"` |
| `decision` | Architectural or design choices | `"PostgreSQL chosen for vector search scalability"` |

---

## Explicit Tool Usage

### Store a decision

```
overmind_memory_store({
  text: "MCP HTTP singleton pattern: one FastMCP HTTP server per port, all agents connect as StreamableHTTP clients. Eliminates stdio zombie processes.",
  source: "decision",
  agent_name: "hermes"
})
```

### Recall before answering

```
overmind_memory_search({
  query: "How was the MCP HTTP singleton pattern implemented in Overmind",
  limit: 5,
  agent_name: "hermes"
})
```

### Check agent run history

```
overmind_memory_runs({
  runner: "kilo",
  limit: 20,
  stats: true
})
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Hermes AIAgent                                          │
│  ├── MemoryManager                                       │
│  │   ├── Built-in MemoryProvider (MEMORY.md / USER.md)  │
│  │   └── OvermindMemoryProvider ← this plugin           │
│  │       └── OvermindClient (HTTP/SSE)                  │
│  │           └── http://localhost:3099/mcp              │
│  └── Tools                                              │
│      └── overmind_memory_store / _search / _runs         │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  Overmind MCP Server (port 3099)                        │
│  ├── PostgresMemoryProvider                               │
│  │   ├── agent_runs      (id, runner, prompt, result…)  │
│  │   └── knowledge_chunks (text + 4096D embedding)     │
│  │                                                    │
│  └── PostgreSQL + pgvector (port 5432)                 │
│      ├── overmind_core                                  │
│      └── agent_hermes                                   │
└──────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Plugin not loading | `memory.provider` must be `overmind` (not empty) |
| Health check fails | Verify Overmind is running: `curl http://localhost:3099/health` |
| All searches return nothing | Check embedding API key in `Workflow/.env` (`OVERMIND_EMBEDDING_KEY`) |
| Embedding errors | Qwen API key missing or rate-limited |
| Provider conflict | Only one external provider at a time — set `provider: overmind` |

### Restart Overmind

```bash
cd /path/to/Workflow
./bin/install-overmind-windows.bat restart
```

### Check Hermes logs

```bash
hermes logs | grep -i "overmind\|memory\|provider"
```

---

## Disabling the Plugin

Revert to Hermes' built-in file memory:

```yaml
memory:
  provider: ""           # empty = use built-in memory
  memory_enabled: true
```

---

## Files

| File | Purpose |
|------|---------|
| `plugins/memory/overmind/__init__.py` | `MemoryProvider` class + tool schemas |
| `plugins/memory/overmind/client.py` | Lightweight HTTP MCP client (bypasses SDK bugs) |
| `README.md` | This file |
| `<HERMES_HOME>/config.yaml` | Hermes configuration |
| `<HERMES_HOME>/logs/agent.log` | Runtime logs |
