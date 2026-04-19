import { memoryStoreTool } from './memory_store.js';

async function store() {
  const result = await memoryStoreTool({
    text: "CONTREMAÎTRE v15.9 : Diagnostic initial complété. - GAP CRITIQUE : 10 signaux 'EXECUTE' sans positions créées. - ANOMALIE CONFIANCE : Scores hors plage [0-20] (max 35). - SILENCE AGENTS : Agents 008, 011, 013, 014, 015 inactifs depuis >72h. - CRASH 008 : Perte de $750.71 (absence de circuit-breaker). Health Score Global: 78/100.",
    source: "pattern",
    agent_name: "contremaitre"
  });
  console.error(JSON.stringify(result, null, 2));
}

store().catch(console.error);
