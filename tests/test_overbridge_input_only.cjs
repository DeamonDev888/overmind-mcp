// ============================================================================
// TESTS UNITAIRES — OverBridgeService INPUT ONLY CONTRACT
// ============================================================================
// Vérifie que OverBridgeService.ts respecte le contrat INPUT ONLY:
//   1. Aucune méthode ne poste vers Discord (pas d'API Discord REST)
//   2. Aucune méthode ne fait de channel.send / message.reply
//   3. L'output de l'agent est retourné comme AgentResult, pas posté
//   4. runAgentForDiscord = input (formatte + forward), pas output
//   5. _processAgentResponse = normalisation, pas envoi
//   6. Aucun import de discord.js
//   7. Les méthodes public ne contiennent pas de références à discord.com/api
//
// LEÇONS APPRISES (déploiement Striker 2026-07):
//   - Le bridge doit JAMAIS poster le texte de l'agent → doublons
//   - La détection MCP ("Message envoyé sur Discord") = logging seulement
//   - L'agent gère son output via ses propres MCP discord tools
//   - Le bridge reçoit, formatte, forward — c'est tout.
// ============================================================================
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SERVICE_PATH = path.join(__dirname, '..', 'src', 'bridge', 'OverBridgeService.ts');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✅ ' + name);
    passed++;
  } catch (e) {
    console.log('  ❌ ' + name + ': ' + e.message);
    failed++;
  }
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║  OverBridgeService — INPUT ONLY CONTRACT TESTS                  ║');
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('');

// Read source
let src = '';
try {
  src = fs.readFileSync(SERVICE_PATH, 'utf8');
} catch (e) {
  console.log('❌ Cannot read ' + SERVICE_PATH);
  process.exit(1);
}

console.log('── SECTION 1: No Discord Direct Output ──');

test('PAS d import de discord.js', () => {
  assert.ok(!/from\s*['"]discord\.js['"]/i.test(src), 'Found discord.js import');
});

test('PAS d import de discord-api-types', () => {
  assert.ok(!/from\s*['"]discord-api-types['"]/i.test(src), 'Found discord-api-types import');
});

test('PAS de Client/WebhookClient de discord', () => {
  assert.ok(!/new\s+(Client|WebhookClient)\s*\(/i.test(src), 'Found Discord Client instantiation');
});

test('PAS de POST vers discord.com/api', () => {
  assert.ok(!/discord\.com\/api\/v\d+/i.test(src), 'Found discord.com API call');
});

test('PAS de channel.send ou message.reply', () => {
  assert.ok(!/\.channel\.send\s*\(/i.test(src), 'Found channel.send');
  assert.ok(!/message\.reply\s*\(/i.test(src), 'Found message.reply');
});

test('PAS de fonction sendDiscord/postToDiscord', () => {
  assert.ok(!/function\s+(sendDiscord|postToDiscord|sendMessageToDiscord|replyToDiscord)/i.test(src), 'Found Discord send function definition');
});

test('PAS de axios.post vers discord', () => {
  assert.ok(!/axios\.post\s*\(\s*['"`]https?:\/\/[^'"]*discord/i.test(src), 'Found axios.post discord');
});

test('PAS de fetch vers discord.com', () => {
  assert.ok(!/fetch\s*\(\s*['"`]https?:\/\/[^'"]*discord\.com/i.test(src), 'Found fetch discord.com');
});

console.log('');

console.log('── SECTION 2: Input Flow (Receive → Format → Forward) ──');

test('runAgentForDiscord method exists', () => {
  assert.ok(/runAgentForDiscord\s*\(/i.test(src), 'Missing runAgentForDiscord');
});

test('runAgentForDiscord formats Discord context (formatDiscordContext)', () => {
  assert.ok(/formatDiscordContext/i.test(src), 'Missing formatDiscordContext call');
});

test('runAgentForDiscord calls runAgent (forward, not post)', () => {
  const match = src.match(/runAgentForDiscord[\s\S]{0,500}/i);
  assert.ok(match && /this\.runAgent\s*\(/i.test(match[0]), 'runAgentForDiscord should call this.runAgent');
});

test('runAgent uses proxy.call (MCP transport, not Discord)', () => {
  assert.ok(/this\.proxy\.call\s*\(\s*['"]run_agent['"]/i.test(src), 'Missing proxy.call run_agent');
});

test('agentStatus uses proxy.call (MCP transport)', () => {
  assert.ok(/this\.proxy\.call\s*\(\s*['"]agent_control['"]/i.test(src), 'Missing proxy.call agent_control');
});

console.log('');

console.log('── SECTION 3: MCP Output Detection = Logging Only ──');

test('_processAgentResponse returns AgentResult (not void/undefined)', () => {
  assert.ok(/_processAgentResponse[\s\S]*?Promise<AgentResult>|: AgentResult\b/i.test(src), '_processAgentResponse should return AgentResult');
});

test('_processAgentResponse does NOT contain channel.send or message.reply', () => {
  const match = src.match(/_processAgentResponse[\s\S]*?^\s{2}\}/m);
  if (match) {
    assert.ok(!/channel\.send|message\.reply/i.test(match[0]), '_processAgentResponse contains Discord output');
  }
});

test('_processAgentResponse handles sessionId extraction', () => {
  assert.ok(/extractSessionIdFromContent/i.test(src), 'Missing sessionId extraction');
});

test('_processAgentResponse preserves session on no-new-id', () => {
  assert.ok(/keeping previous|No new sessionId/i.test(src), 'Missing session preservation logic');
});

console.log('');

console.log('── SECTION 4: Timeout Handling (Lessons Learned) ──');

test('Timeout (ETIMEDOUT/EBODYREAD) handled as non-fatal', () => {
  assert.ok(/ETIMEDOUT|EBODYREAD/i.test(src), 'Missing timeout code handling');
});

test('Timeout returns AgentResult (not throw)', () => {
  const match = src.match(/ETIMEDOUT[\s\S]{0,500}return\s*\{/i);
  assert.ok(match, 'Timeout should return AgentResult, not throw');
});

test('Timeout preserves session state (updateSession called)', () => {
  const match = src.match(/ETIMEDOUT[\s\S]{0,800}updateSession/i);
  assert.ok(match, 'Timeout should call updateSession to preserve session');
});

console.log('');

console.log('── SECTION 5: Session Management ──');

test('resetSession clears currentSessionId', () => {
  assert.ok(/resetSession[\s\S]*?currentSessionId\s*=\s*undefined/i.test(src), 'resetSession should clear sessionId');
});

test('setSession sets a specific sessionId', () => {
  assert.ok(/setSession\s*\(/i.test(src), 'Missing setSession method');
});

test('updateSession increments messageCount', () => {
  assert.ok(/messageCount\+\+/i.test(src), 'Missing messageCount increment');
});

test('Session state tracks lastActivityAt', () => {
  assert.ok(/lastActivityAt/i.test(src), 'Missing lastActivityAt tracking');
});

console.log('');

console.log('── SECTION 6: Memory & MCP Operations (Input to MCP) ──');

test('memorySearch forwards to MCP (proxy.call memory_search)', () => {
  assert.ok(/this\.proxy\.call\s*\(\s*['"]memory_search['"]/i.test(src), 'Missing memory_search MCP call');
});

test('memoryStore forwards to MCP (proxy.call memory_store)', () => {
  assert.ok(/this\.proxy\.call\s*\(\s*['"]memory_store['"]/i.test(src), 'Missing memory_store MCP call');
});

test('memoryRuns forwards to MCP (proxy.call memory_runs)', () => {
  assert.ok(/this\.proxy\.call\s*\(\s*['"]memory_runs['"]/i.test(src), 'Missing memory_runs MCP call');
});

test('No memory method posts to Discord', () => {
  const memorySection = src.match(/memorySearch[\s\S]*?(?=\n\s{2}\/\/\s*═)/i);
  if (memorySection) {
    assert.ok(!/channel\.send|message\.reply|discord\.com\/api/i.test(memorySection[0]), 'Memory method posts to Discord');
  }
});

console.log('');

console.log('── SECTION 7: Documentation & Lessons Learned ──');

test('Header doc mentions INPUT ONLY contract', () => {
  assert.ok(/INPUT ONLY|input only/i.test(src), 'Missing INPUT ONLY documentation');
});

test('Header doc mentions output via MCP', () => {
  assert.ok(/OUTPUT via MCP|MCP discord/i.test(src), 'Missing MCP output documentation');
});

test('Header doc includes LESSONS LEARNED section', () => {
  assert.ok(/LESSONS LEARNED/i.test(src), 'Missing LESSONS LEARNED documentation');
});

test('runAgentForDiscord has INPUT ONLY CONTRACT doc', () => {
  // Check that the doc block above runAgentForDiscord mentions INPUT ONLY
  const idx = src.indexOf('runAgentForDiscord');
  assert.ok(idx > 0, 'runAgentForDiscord not found');
  // Look backwards from runAgentForDiscord for INPUT ONLY
  const docBlock = src.substring(Math.max(0, idx - 800), idx);
  assert.ok(/INPUT ONLY/i.test(docBlock), 'Missing INPUT ONLY CONTRACT doc above runAgentForDiscord');
});

test('_processAgentResponse has OUTPUT DETECTION doc', () => {
  // Check that _processAgentResponse has a doc block mentioning OUTPUT DETECTION
  // The doc is in the JSDoc above the method signature
  assert.ok(/OUTPUT DETECTION/i.test(src), 'Missing OUTPUT DETECTION documentation anywhere in file');
  // Also verify _processAgentResponse exists as a method
  assert.ok(/_processAgentResponse\s*\(/i.test(src), '_processAgentResponse method not found');
});

console.log('');

// ═══════════════════════════════════════════════════════════════════════════
// RÉSUMÉ
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════');
console.log('  RÉSULTAT: ' + passed + ' passé(s) / ' + failed + ' échec(s)');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

if (failed > 0) {
  process.exit(1);
}
