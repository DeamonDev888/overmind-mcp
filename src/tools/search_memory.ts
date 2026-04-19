import { memorySearchTool } from './memory_search.js';
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
loadEnvQuietly('../serveur_PostGreSQL/.env');

async function main() {
  const q1 = await memorySearchTool({ query: "RAPPORT D'AUDIT", limit: 20, include_runs: false });
  const q2 = await memorySearchTool({ query: "RAPPORT COMPLET", limit: 20, include_runs: false });
  
  console.log("--- RAPPORT D'AUDIT ---");
  console.log(q1.content[0].text);
  console.log("\n--- RAPPORT COMPLET ---");
  console.log(q2.content[0].text);
}

main().catch(console.error);
