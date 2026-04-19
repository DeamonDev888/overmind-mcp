import pg from 'pg';
const { Client } = pg;

async function runAudit() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '9022',
    database: 'financial_analyst',
  });

  try {
    await client.connect();
    console.log('--- 📊 AUDIT STRATÉGIQUE DU CORTEX TACTIQUE (v15.9) ---');
    console.log('Date:', new Date().toLocaleString());

    // 1. Zero-Loss Validation
    console.log('\n--- ✅ 1. ZERO-LOSS VALIDATION ---');
    const zeroLossRes = await client.query(`
      SELECT count(*) FROM combat_verdicts WHERE action IS NULL
    `);
    const nullCount = parseInt(zeroLossRes.rows[0].count);
    if (nullCount === 0) {
      console.log('✅ AUCUN verdict NULL détecté (100% de complétude).');
    } else {
      console.warn(`❌ ALERTE: ${nullCount} verdict(s) NULL détecté(s) !`);
    }

    // 2. Conviction Audit
    console.log('\n--- 📈 2. CONVICTION AUDIT ---');
    const convictionRes = await client.query(`
      SELECT action, count(*), avg(confidence) as avg_conf, min(confidence) as min_conf, max(confidence) as max_conf
      FROM combat_verdicts
      GROUP BY action
    `);
    console.table(convictionRes.rows);
    
    const overflow = convictionRes.rows.filter(r => r.max_conf > 20);
    if (overflow.length > 0) {
      console.warn('⚠️ ANOMALIE: Scores de confiance hors plage [0-20] détectés !');
    }

    // 3. Signal Sanity
    console.log('\n--- 🧪 3. SIGNAL SANITY ---');
    const debateMatch = await client.query(`
      SELECT count(*) FROM mcp_debates d
      LEFT JOIN combat_verdicts v ON d.id = v.id_alias
      WHERE v.id_alias IS NULL
    `);
    console.log(`- Débats sans verdict: ${debateMatch.rows[0].count}`);

    const execRes = await client.query(`
      SELECT count(*) FROM combat_verdicts v
      LEFT JOIN positions p ON v.id_alias = p.signal_id
      WHERE v.action = 'EXECUTE' AND p.signal_id IS NULL
    `);
    const execGap = parseInt(execRes.rows[0].count);
    console.log(`- EXECUTE sans position: ${execGap}`);
    if (execGap > 0) {
      console.warn(`❌ GAP CRITIQUE: ${execGap} signal d'exécution n'a pas créé de position.`);
    }

    // 4. Feedback Loop
    console.log('\n--- 🔄 4. FEEDBACK LOOP ---');
    const messagesRes = await client.query(`
      SELECT count(*) FROM mcp_debate_messages
    `);
    console.log(`- Total messages de débats: ${messagesRes.rows[0].count}`);

    console.log('\n--- 🎯 CONCLUSION ---');
    const healthScore = execGap > 0 ? 78 : 100;
    console.log(`HEALTH SCORE: ${healthScore}/100`);
    
  } catch (err) {
    console.error('❌ ERREUR LORS DE L\'AUDIT:', err);
  } finally {
    await client.end();
  }
}

runAudit();
