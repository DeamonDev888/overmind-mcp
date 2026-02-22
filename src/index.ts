#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  {
    name: "overmind-mcp",
    version: "1.1.1",
  },
  {
    capabilities: {},
  }
);

const transport = new StdioServerTransport();
server.connect(transport);

console.error("Overmind MCP Server running");
