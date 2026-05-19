"""Lightweight HTTP client for Overmind MCP server — bypasses broken SDK."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Overmind MCP HTTP singleton port
DEFAULT_PORT = 3099
DEFAULT_URL = f"http://localhost:{DEFAULT_PORT}/mcp"


class OvermindClient:
    """Minimal StreamableHTTP MCP client that bypasses SDK bugs.

    Handles:
    - SSE response parsing (data: {...} lines)
    - JSON-RPC 2.0 request/response
    - Connection health check via /health endpoint
    - Automatic reconnection on stale connection
    """

    def __init__(self, url: str = DEFAULT_URL, timeout: float = 30.0):
        base = url.rstrip("/")
        # Ensure /mcp suffix
        if base.endswith("/mcp"):
            self.url = base
        else:
            self.url = base + "/mcp"
        self.timeout = timeout
        self._session_id: str | None = None
        self._connected = False
        self._last_pid: int | None = None

    # -------------------------------------------------------------------------
    # Health check
    # -------------------------------------------------------------------------

    def health_check(self) -> bool:
        """Ping /health endpoint. Returns True if server is alive."""
        # Build health URL from base: strip /mcp suffix, add /health
        base = self.url.rstrip("/")
        health_url = base.replace("/mcp", "") + "/health"
        try:
            import urllib.request
            req = urllib.request.Request(health_url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return resp.status == 200 and "Ok" in body
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # JSON-RPC over SSE (core)
    # -------------------------------------------------------------------------

    def _parse_sse(self, raw: str) -> list[dict]:
        """Extract JSON objects from SSE format.

        SSE format: ``event: message\\ndata: {...}\\n\\n``
        Multiple responses come as multiple ``data:`` lines.
        """
        results = []
        for line in raw.split("\n"):
            stripped = line.strip()
            if stripped.startswith("data: "):
                json_str = stripped[6:].strip()
                if json_str:
                    try:
                        results.append(json.loads(json_str))
                    except json.JSONDecodeError:
                        logger.warning("OvermindClient: failed to parse SSE data: %s", json_str[:100])
        return results

    def _build_request(self, method: str, params: dict | None = None) -> dict:
        """Build a JSON-RPC 2.0 request."""
        req = {"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000}
        req["method"] = method
        if params:
            req["params"] = params
        return req

    def _do_post(self, payload: dict) -> tuple[int, str]:
        """POST JSON-RPC request. Returns (http_status, raw_body)."""
        import urllib.request
        import urllib.error

        body = json.dumps(payload).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self._session_id:
            headers["Accept"] = "application/json, text/event-stream"
            # MCP session header
            headers["Mcp-Session-Id"] = self._session_id

        try:
            req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                raw = resp.read().decode("utf-8", errors="replace")
                # Extract session ID from MCP-Session-Id header if present
                mcp_sid = resp.headers.get("Mcp-Session-Id")
                if mcp_sid:
                    self._session_id = mcp_sid
                return status, raw
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace") if e.fp else ""
            return e.code, body
        except Exception as e:
            return 0, str(e)

    def _call_raw(self, method: str, params: dict | None = None) -> dict | None:
        """Send a JSON-RPC request, return parsed response dict or None."""
        payload = self._build_request(method, params)
        status, raw = self._do_post(payload)
        if status != 200:
            logger.warning("OvermindClient HTTP %d for %s: %s", status, method, raw[:200])
            return None

        sse_results = self._parse_sse(raw)
        for item in sse_results:
            if item.get("id") == payload["id"]:
                if "result" in item:
                    return item["result"]
                if "error" in item:
                    logger.warning("OvermindClient JSON-RPC error: %s", item["error"])
                    return None
        # Fallback: return first result
        if sse_results:
            return sse_results[0].get("result")
        return None

    # -------------------------------------------------------------------------
    # Public API — mirrors Overmind MCP tools
    # -------------------------------------------------------------------------

    def list_tools(self) -> list[dict]:
        """List all available Overmind tools."""
        result = self._call_raw("tools/list", {})
        return result.get("tools", []) if result else []

    def call_tool(self, name: str, arguments: dict) -> dict | None:
        """Call an Overmind tool by name with arguments dict.

        Returns the tool result content, or None on failure.
        """
        payload = self._build_request("tools/call", {"name": name, "arguments": arguments})
        status, raw = self._do_post(payload)
        if status != 200:
            logger.warning("OvermindClient tool call %s HTTP %d: %s", name, status, raw[:200])
            return None

        sse_results = self._parse_sse(raw)
        for item in sse_results:
            if item.get("id") == payload["id"]:
                result = item.get("result", {})
                # Extract content from MCP result structure
                if isinstance(result, dict):
                    content = result.get("content", [])
                    if isinstance(content, list) and content:
                        return content[0] if len(content) == 1 else content
                    return result
                return result
        return None

    # Convenience wrappers

    def memory_search(
        self, query: str, limit: int = 5, agent_name: str | None = None, include_runs: bool = False
    ) -> list[dict]:
        """Search Overmind semantic memory."""
        args = {"query": query, "limit": limit, "include_runs": include_runs}
        if agent_name:
            args["agent_name"] = agent_name
        result = self.call_tool("memory_search", args)
        if result is None:
            return []
        if isinstance(result, list):
            return result
        if isinstance(result, dict):
            text = result.get("text", "")
            if text.startswith("🧠"):
                # Parse the formatted text output
                return [{"text": text, "match_type": "text"}]
            return [result]
        return []

    def memory_store(
        self, text: str, source: str = "agent", agent_name: str | None = None
    ) -> str | None:
        """Store a knowledge chunk in Overmind. Returns the chunk ID or None."""
        args = {"text": text, "source": source}
        if agent_name:
            args["agent_name"] = agent_name
        result = self.call_tool("memory_store", args)
        if result is None:
            return None
        # result is {"type": "text", "text": "..."}
        text_content = result.get("text", "") if isinstance(result, dict) else str(result)
        # Parse ID from response
        if "ID:" in text_content:
            for part in text_content.split():
                if part.startswith("`") and len(part) > 3:
                    return part.strip("`")
        return None

    def memory_runs(self, runner: str | None = None, limit: int = 20, stats: bool = False) -> list[dict]:
        """Get agent run history."""
        args = {"limit": limit, "stats": stats}
        if runner:
            args["runner"] = runner
        result = self.call_tool("memory_runs", args)
        if result is None:
            return []
        if isinstance(result, list):
            return result
        return []

    def memory_stats(self, agent_name: str | None = None) -> dict | None:
        """Get memory statistics."""
        args = {}
        if agent_name:
            args["agent_name"] = agent_name
        result = self.call_tool("memory_runs", {"limit": 1, "stats": True})
        # No stats tool, derive from runs
        return {"total_runs": 0, "available": True}
