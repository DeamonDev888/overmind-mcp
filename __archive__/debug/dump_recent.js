import pg from 'pg';
const { Client } = pg;

async function dumpRecent() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '9022',
    database: 'financial_analyst',
  });

  try {
    await client.connect();
    console.log('--- 🛡️ DUMP DES DERNIERS VERDICTS DE COMBAT ---');
    
    const verdicts = await client.query(`
      SELECT * FROM combat_verdicts 
      ORDER BY id DESC 
      LIMIT 5
    `);
    console.table(verdicts.rows);

    console.log('\n--- 💬 DUMP DES DERNIERS DÉBATS (ID_ALIAS) ---');
    const debates = await client.query(`
      SELECT * FROM mcp_debates 
      ORDER BY id DESC 
      LIMIT 5
    `);
    console.table(debates.rows);

    console.log('\n--- 🧪 DÉTAILS DES EXECUTE SANS POSITION ---');
    const gaps = await client.query(`
      SELECT v.id, v.action, v.confidence, v.reasoning, v.id_alias
      FROM combat_verdicts v
      LEFT JOIN positions p ON v.id_alias = p.signal_id
      WHERE v.action = 'EXECUTE' AND p.signal_id IS NULL
      LIMIT 5
    `);
    console.table(gaps.rows);

  } catch (err) {
    console.error('❌ ERREUR:', err);
  } finally {
    await client.end();
  }
}

dumpRecent();
