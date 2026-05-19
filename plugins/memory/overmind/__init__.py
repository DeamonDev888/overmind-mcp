"""Overmind memory plugin — MemoryProvider for Overmind cross-session memory.

Overmind MCP server (port 3099) provides semantic memory with PostgreSQL +
pgvector embeddings. This plugin hooks Hermes' MemoryManager lifecycle to
automatically:

  - Prefetch relevant context before each turn (prefetch)
  - Store completed turns (sync_turn)
  - Mirror built-in memory writes (on_memory_write)
  - Summarize on session end (on_session_end)

Config (config.yaml):
  memory:
    provider: overmind
    overmind:
      url: http://localhost:3099/mcp   # MCP HTTP endpoint
      agent_name: hermes                 # agent isolation name (optional)
      timeout: 30                        # request timeout seconds
      search_limit: 5                    # max results per search
      auto_store: true                  # auto-store turns (default: true)
      auto_search: true                 # auto-search before turns (default: true)
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Dict, List, Optional

from agent.memory_manager import build_memory_context_block, sanitize_context
from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)

# Maximum characters per turn stored (avoid huge payloads)
MAX_TURN_CHARS = 4000
# Background thread name
THREAD_NAME = "overmind-memory"


# --------------------------------------------------------------------------
# Tool schemas — Overmind tools exposed to the model
# --------------------------------------------------------------------------


MEMORY_STORE_SCHEMA = {
    "name": "overmind_memory_store",
    "description": (
        "Store a knowledge chunk in Overmind semantic memory. "
        "Use for: facts, patterns, decisions, errors, user preferences. "
        "The chunk is embedded (4096D qwen3) and stored in PostgreSQL/pgvector. "
        "Sources: user, agent, pattern, error, decision. "
        "Without agent_name, stored in overmind_core (shared). "
        "With agent_name, stored in agent_<name> (isolated per-agent)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "Text or knowledge to memorize. Be specific and factual.",
            },
            "source": {
                "type": "string",
                "enum": ["user", "agent", "pattern", "error", "decision"],
                "default": "agent",
                "description": "Type of knowledge being stored.",
            },
            "agent_name": {
                "type": "string",
                "description": "Agent isolation namespace. Without this: shared overmind_core. With this: agent_<name> isolated DB.",
            },
        },
        "required": ["text"],
    },
}


MEMORY_SEARCH_SCHEMA = {
    "name": "overmind_memory_search",
    "description": (
        "Semantic + full-text search in Overmind memory. "
        "Returns ranked results with cosine similarity scores (0-1). "
        "Searches both agent isolation DB and overmind_core (shared). "
        "Use to recall: past sessions, known patterns, user preferences, "
        "error solutions, architectural decisions."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query — semantic meaning, not keyword matching.",
            },
            "limit": {
                "type": "integer",
                "default": 5,
                "minimum": 1,
                "maximum": 50,
                "description": "Maximum number of results.",
            },
            "include_runs": {
                "type": "boolean",
                "default": False,
                "description": "Include agent run history in results.",
            },
            "agent_name": {
                "type": "string",
                "description": "Filter by agent namespace.",
            },
        },
        "required": ["query"],
    },
}


MEMORY_RUNS_SCHEMA = {
    "name": "overmind_memory_runs",
    "description": (
        "List recent agent run history from Overmind. "
        "Use to audit: which agents ran, success/failure rates, duration stats."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "runner": {
                "type": "string",
                "description": "Filter by runner type: kilo, claude, hermes, gemini...",
            },
            "limit": {
                "type": "integer",
                "default": 20,
                "minimum": 1,
                "maximum": 100,
            },
            "stats": {
                "type": "boolean",
                "default": False,
                "description": "Show global orchestration statistics.",
            },
        },
        "required": [],
    },
}


ALL_TOOL_SCHEMAS = [MEMORY_STORE_SCHEMA, MEMORY_SEARCH_SCHEMA, MEMORY_RUNS_SCHEMA]


# --------------------------------------------------------------------------
# MemoryProvider implementation
# --------------------------------------------------------------------------


class OvermindMemoryProvider(MemoryProvider):
    """Overmind semantic memory provider for Hermes.

    Integrates via MemoryManager hooks:
      - prefetch()        → memory_search before each turn
      - sync_turn()       → memory_store after each turn
      - on_memory_write()  → mirror built-in memory writes
      - on_session_end()  → store session summary
    """

    def __init__(self):
        self._client: Optional["OvermindClient"] = None
        self._config: Dict[str, Any] = {}
        self._session_id: str = ""
        self._turn_count: int = 0
        self._prefetch_result: str = ""
        self._prefetch_lock = threading.Lock()
        self._sync_thread: Optional[threading.Thread] = None
        self._prefetch_thread: Optional[threading.Thread] = None
        self._pending_turns: list[tuple[str, str]] = []  # (user, assistant)
        self._pending_lock = threading.Lock()
        self._initialized: bool = False
        self._cron_skipped: bool = False

    @property
    def name(self) -> str:
        return "overmind"

    # -------------------------------------------------------------------------
    # Availability
    # -------------------------------------------------------------------------

    def is_available(self) -> bool:
        """Check if Overmind MCP server is reachable. No network call — just config check."""
        # Check config first without making HTTP calls
        try:
            from plugins.memory.overmind.client import OvermindClient, DEFAULT_URL
            url = self._get_config_url()
            # Light HTTP check to /health
            client = OvermindClient(url)
            return client.health_check()
        except Exception as e:
            logger.debug("Overmind is_available=False: %s", e)
            return False

    def _get_config_url(self) -> str:
        """Get Overmind URL from config or default."""
        try:
            from hermes_cli.config import cfg_get
            from hermes_cli.config import load_config
            config = load_config()
            overmind_cfg = cfg_get(config, "memory", "overmind") or {}
            url = overmind_cfg.get("url", "")
            if url:
                return url
        except Exception:
            pass
        from plugins.memory.overmind.client import DEFAULT_URL
        return DEFAULT_URL

    def _get_config(self) -> Dict[str, Any]:
        """Load plugin config from memory.overmind in config.yaml."""
        defaults = {
            "url": "http://localhost:3099/mcp",
            "agent_name": "hermes",
            "timeout": 30.0,
            "search_limit": 5,
            "auto_store": True,
            "auto_search": True,
        }
        try:
            from hermes_cli.config import cfg_get, load_config
            config = load_config()
            overmind_cfg = cfg_get(config, "memory", "overmind") or {}
            defaults.update(overmind_cfg)
        except Exception:
            pass
        return defaults

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return [
            {
                "key": "url",
                "description": "Overmind MCP HTTP endpoint",
                "default": "http://localhost:3099/mcp",
                "required": True,
            },
            {
                "key": "agent_name",
                "description": "Agent namespace for memory isolation (stored in agent_<name> DB)",
                "default": "hermes",
            },
            {
                "key": "search_limit",
                "description": "Maximum search results per prefetch",
                "default": 5,
            },
            {
                "key": "auto_store",
                "description": "Automatically store turns to Overmind after each turn",
                "default": True,
            },
            {
                "key": "auto_search",
                "description": "Automatically search Overmind before each turn for relevant context",
                "default": True,
            },
        ]

    # -------------------------------------------------------------------------
    # Lifecycle
    # -------------------------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        """Initialize Overmind MCP client and warm up."""
        agent_context = kwargs.get("agent_context", "")
        platform = kwargs.get("platform", "cli")
        if agent_context in ("cron", "flush") or platform == "cron":
            logger.debug("Overmind skipped: cron/flush context")
            self._cron_skipped = True
            return

        self._session_id = session_id
        self._config = self._get_config()

        try:
            from plugins.memory.overmind.client import OvermindClient
            self._client = OvermindClient(
                url=self._config.get("url", "http://localhost:3099/mcp"),
                timeout=float(self._config.get("timeout", 30.0)),
            )

            # Health check
            if not self._client.health_check():
                logger.warning("Overmind health check failed — plugin inactive")
                self._client = None
                return

            self._initialized = True
            logger.info(
                "Overmind memory provider initialized: url=%s, agent=%s",
                self._config.get("url"),
                self._config.get("agent_name"),
            )

        except Exception as e:
            logger.warning("Overmind init failed: %s", e)
            self._client = None

    def shutdown(self) -> None:
        """Clean shutdown — wait for pending threads."""
        for t in (self._sync_thread, self._prefetch_thread):
            if t and t.is_alive():
                t.join(timeout=5.0)

    # -------------------------------------------------------------------------
    # System prompt
    # -------------------------------------------------------------------------

    def system_prompt_block(self) -> str:
        """Static system prompt — Overmind status."""
        if not self._initialized or self._cron_skipped:
            return ""
        return (
            "[Overmind Memory] Cross-session semantic memory is active. "
            "Use overmind_memory_store / overmind_memory_search tools to persist and recall knowledge. "
            "Source tags: user, agent, pattern, error, decision."
        )

    # -------------------------------------------------------------------------
    # Prefetch — search before each turn
    # -------------------------------------------------------------------------

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Return relevant Overmind context for the upcoming turn.

        Called before each API call. Runs memory_search in background
        and returns cached results from the previous turn.
        """
        if not self._initialized or self._cron_skipped:
            return ""
        if not self._client:
            return ""

        # Return pending prefetch result from last queue_prefetch
        with self._prefetch_lock:
            result = self._prefetch_result
            self._prefetch_result = ""

        return result

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        """Fire background memory search for the next turn.

        Non-blocking — spawns a thread that calls memory_search
        and caches the result for the next prefetch() call.
        """
        if not self._initialized or self._cron_skipped:
            return
        if not self._client:
            return
        if not self._config.get("auto_search", True):
            return
        if not query or len(query.strip()) < 3:
            return

        def _search():
            try:
                agent_name = self._config.get("agent_name")
                search_limit = self._config.get("search_limit", 5)
                results = self._client.memory_search(
                    query=query,
                    limit=search_limit,
                    agent_name=agent_name,
                    include_runs=False,
                )
                if not results:
                    return

                # Format results for injection
                lines = ["[Overmind Memory Search Results]"]
                for r in results[:search_limit]:
                    if isinstance(r, dict):
                        text = r.get("text", "")
                        source = r.get("source", "unknown")
                        score = r.get("score", 0.0)
                        if text and len(text) > 10:
                            lines.append(f"- [{source}] (score={score:.2f}): {text[:300]}")
                    elif isinstance(r, str) and len(r) > 10:
                        lines.append(f"- {r[:300]}")

                if len(lines) > 1:
                    formatted = "\n".join(lines[:8])  # cap at 8 lines
                    with self._prefetch_lock:
                        self._prefetch_result = build_memory_context_block(formatted)
            except Exception as e:
                logger.debug("Overmind queue_prefetch failed: %s", e)

        if self._prefetch_thread and self._prefetch_thread.is_alive():
            self._prefetch_thread.join(timeout=2.0)

        self._prefetch_thread = threading.Thread(target=_search, daemon=True, name=THREAD_NAME)
        self._prefetch_thread.start()

    # -------------------------------------------------------------------------
    # Sync — store after each turn
    # -------------------------------------------------------------------------

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        """Store a completed turn in Overmind memory (non-blocking)."""
        if not self._initialized or self._cron_skipped:
            return
        if not self._client:
            return
        if not self._config.get("auto_store", True):
            return

        # Truncate to avoid huge payloads
        user_trunc = sanitize_context(user_content or "").strip()[:MAX_TURN_CHARS]
        asst_trunc = sanitize_context(assistant_content or "").strip()[:MAX_TURN_CHARS]
        if not user_trunc and not asst_trunc:
            return

        self._turn_count += 1

        def _store():
            try:
                agent_name = self._config.get("agent_name")
                # Format as a knowledge chunk
                turn_text = f"[Turn {self._turn_count}] User: {user_trunc}\nAssistant: {asst_trunc}"
                self._client.memory_store(
                    text=turn_text,
                    source="agent",
                    agent_name=agent_name,
                )
            except Exception as e:
                logger.debug("Overmind sync_turn failed: %s", e)

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=5.0)

        self._sync_thread = threading.Thread(target=_store, daemon=True, name=THREAD_NAME)
        self._sync_thread.start()

    # -------------------------------------------------------------------------
    # Hooks
    # -------------------------------------------------------------------------

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        """Track turn count."""
        self._turn_count = turn_number

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Mirror built-in memory tool writes to Overmind.

        When Hermes' built-in memory tool writes (memory add/replace/remove),
        this mirrors the content to Overmind so it persists there too.
        """
        if not self._initialized or self._cron_skipped:
            return
        if not self._client:
            return
        if action not in ("add", "replace"):
            return
        if not content or len(content.strip()) < 3:
            return

        def _mirror():
            try:
                agent_name = self._config.get("agent_name")
                self._client.memory_store(
                    text=f"[Built-in memory::{target}] {content}",
                    source="user" if target == "user" else "agent",
                    agent_name=agent_name,
                )
            except Exception as e:
                logger.debug("Overmind on_memory_write mirror failed: %s", e)

        t = threading.Thread(target=_mirror, daemon=True, name=THREAD_NAME)
        t.start()

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        """Store a session summary on session end."""
        if not self._initialized or self._cron_skipped:
            return
        if not self._client:
            return

        # Wait for pending sync
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=10.0)

        def _summarize():
            try:
                agent_name = self._config.get("agent_name")
                # Build a session summary from messages
                total = len(messages)
                if total == 0:
                    return

                user_msgs = [m for m in messages if m.get("role") == "user"]
                asst_msgs = [m for m in messages if m.get("role") == "assistant"]
                turns = min(len(user_msgs), len(asst_msgs))

                summary_text = (
                    f"[Session End Summary] "
                    f"Session: {self._session_id}, "
                    f"Total messages: {total}, "
                    f"Turns: {turns}, "
                    f"Last user message: {user_msgs[-1].get('content', '')[:200] if user_msgs else '(none)'}..."
                )
                self._client.memory_store(
                    text=summary_text,
                    source="agent",
                    agent_name=agent_name,
                )
            except Exception as e:
                logger.debug("Overmind on_session_end failed: %s", e)

        t = threading.Thread(target=_summarize, daemon=True, name=THREAD_NAME)
        t.start()

    def on_delegation(self, task: str, result: str, *, child_session_id: str = "", **kwargs) -> None:
        """Store subagent delegation results in Overmind."""
        if not self._initialized or self._cron_skipped:
            return
        if not self._client:
            return
        if not task:
            return

        def _store_delegation():
            try:
                agent_name = self._config.get("agent_name")
                delegation_text = (
                    f"[Delegation] Task: {task[:300]}... "
                    f"Result: {result[:300]}..."
                )
                self._client.memory_store(
                    text=delegation_text,
                    source="agent",
                    agent_name=agent_name,
                )
            except Exception as e:
                logger.debug("Overmind on_delegation failed: %s", e)

        t = threading.Thread(target=_store_delegation, daemon=True, name=THREAD_NAME)
        t.start()

    # -------------------------------------------------------------------------
    # Tools
    # -------------------------------------------------------------------------

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Expose Overmind tools to the model."""
        if self._cron_skipped:
            return []
        return list(ALL_TOOL_SCHEMAS)

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        """Route Overmind tool calls to the MCP client."""
        if not self._initialized or self._cron_skipped:
            return tool_error("Overmind is not active (cron context or init failed).")
        if not self._client:
            return tool_error("Overmind MCP client not initialized.")

        try:
            if tool_name == "overmind_memory_store":
                text = args.get("text", "")
                if not text:
                    return tool_error("Missing required parameter: text")
                source = args.get("source", "agent")
                agent_name = args.get("agent_name") or self._config.get("agent_name")
                chunk_id = self._client.memory_store(text=text, source=source, agent_name=agent_name)
                if chunk_id:
                    return json.dumps({"result": f"Stored in Overmind [ID: {chunk_id}]", "id": chunk_id})
                return tool_error("Overmind memory_store failed — check server status.")

            elif tool_name == "overmind_memory_search":
                query = args.get("query", "")
                if not query:
                    return tool_error("Missing required parameter: query")
                limit = int(args.get("limit", 5))
                include_runs = bool(args.get("include_runs", False))
                agent_name = args.get("agent_name") or self._config.get("agent_name")
                results = self._client.memory_search(
                    query=query, limit=limit, agent_name=agent_name, include_runs=include_runs
                )
                if not results:
                    return json.dumps({"result": "No Overmind results found.", "results": []})
                formatted = []
                for r in results:
                    text = r.get("text", "") if isinstance(r, dict) else str(r)
                    source = r.get("source", "?") if isinstance(r, dict) else "?"
                    score = r.get("score", 0.0) if isinstance(r, dict) else 0.0
                    formatted.append(f"[{source}] (score={score:.2f}): {text[:300]}")
                return json.dumps({"result": "\n".join(formatted), "results": results})

            elif tool_name == "overmind_memory_runs":
                runner = args.get("runner") or None
                limit = int(args.get("limit", 20))
                stats = bool(args.get("stats", False))
                runs = self._client.memory_runs(runner=runner, limit=limit, stats=stats)
                if not runs:
                    return json.dumps({"result": "No run history found.", "runs": []})
                return json.dumps({"result": f"Found {len(runs)} runs.", "runs": runs})

            return tool_error(f"Unknown tool: {tool_name}")

        except Exception as e:
            logger.error("Overmind tool %s failed: %s", tool_name, e)
            return tool_error(f"Overmind {tool_name} failed: {e}")


# --------------------------------------------------------------------------]
# Plugin entry point
# --------------------------------------------------------------------------


def register(ctx) -> None:
    """Register Overmind as a memory provider plugin."""
    ctx.register_memory_provider(OvermindMemoryProvider())
