import { updateAgentConfig } from './manage_agents.js';
import fs from 'fs';


function loadEnvQuietly(envPath: string) {
  try {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
          const key = match[1];
          let value = match[2] || '';
          value = value.replace(/\s*#.*$/, '').trim();
          if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
          else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
          if (!process.env[key]) process.env[key] = value;
        }
      });
    }
  } catch (_e) { /* ignore */ }
}

loadEnvQuietly('.env');

async function main() {
  const result = await updateAgentConfig({
    name: "nexus_alert_commander",
    env: {
      "ANTHROPIC_AUTH_TOKEN": process.env.ANTHROPIC_AUTH_TOKEN || "",
      "ANTHROPIC_BASE_URL": process.env.ANTHROPIC_BASE_URL || "https://api.z.ai/api/anthropic"
    }
  });
  
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
