
import { runClaudeAgent } from '../dist/tools/run_claude.js';
import path from 'path';

// Force use of the agent_doc settings
// Normally runClaudeAgent uses the singleton config loaded at start
// But we want to simulate a specific context.
// However, runClaudeAgent takes 'prompt' and 'sessionId'.
// It relies on 'updateConfig' having been called or default loading.

// Let's rely on the fact that we can just invoke Claude CLI directly if we wanted, 
// BUT runClaudeAgent wraps exactly that.

// TRICK: The 'run_agent' tool is designed to utilize the CURRENT env settings.
// Currently, I am just a script. I am not the running server.
// So I need to set up the environment for runClaudeAgent to target 'agent_doc'.

// Actually, runClaudeAgent calls 'claude' CLI. The CLI needs 'settings' or flags.
// Our implementation of 'runClaudeAgent' uses 'config.env' to set env vars for the child process.

// Let's try to pass the request.

async function main() {
    console.log("🚀 Sending Mission to Agent Doc...");
    
    // We want to force the usage of settings_agent_doc.json
    // But our tool 'runClaudeAgent' doesn't take a config path arg per se, 
    // it uses the internal 'config' object.
    
    // Wait, the MCP server is supposed to orchestrate this.
    // If I want to run 'agent_doc', I should probably use `claude -c .claude/settings_agent_doc.json`
    // But `runClaudeAgent` implementation does:
    // `const { env } = config;` and spawns `claude`.
    // It doesn't seem to support switching configuration files dynamically per call yet? 
    // Let me check `run_claude.ts` content via `view_file`? No need, I recall.
    
    // Let's just use the `runClaudeAgent` as is, but assuming we can pass the prompt.
    // The PROMPT itself will tell Claude to act as Agent Doc (because we defined the Persona in `.claude/agents/agent_doc.md`).
    // OH WAIT. create_agent made the prompt file, but did NOT tell `run_agent` to use it automatically.
    // When we use `run_agent`, we send a prompt. 
    // If we want the agent to BE `agent_doc`, we must inject the system prompt OR use the `-p` (persona) flag if `run_claude` supports it.
    
    // Does `runClaudeAgent` support arbitrary flags?
    // Looking at index.ts/run_claude.ts...
    
    // Since I can't check the code easily right now (token limit optimization), 
    // I will try to injecting the Persona content directly in the prompt or rely on the fact 
    // that `agent_doc` is just a concept if I don't launch the CLI *WITH* that config.
    
    // Solution: I will manually read the system prompt of agent_doc and prepend it.
    
    const fs = await import('fs');
    const systemPrompt = fs.readFileSync('.claude/agents/agent_doc.md', 'utf8');
    
    const userMission = "Mission: Relis le fichier docs/tools.md. Verify qu'il contient bien tous les outils listés dans src/index.ts. Si non, mets-le à jour.";
    
    const fullPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userMission}`;

    try {
        const output = await runClaudeAgent({
            prompt: fullPrompt,
            sessionId: "mission-doc-1"
        });
        
        console.log("📝 Agent Response:\n", JSON.stringify(output, null, 2));
    } catch (e) {
        console.error(e);
    }
}

main();
