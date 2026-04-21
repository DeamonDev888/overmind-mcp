import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: '9022',
  database: 'financial_analyst',
});

async function verify() {
  await client.connect();

  console.log('=== POST-REPAIR VERIFICATION ===');

  const ghosts = await client.query(`
    SELECT COUNT(*) as count
    FROM combat_verdicts v
    LEFT JOIN positions p ON v.id_alias = p.signal_id
    WHERE v.action = 'EXECUTE' AND p.id IS NULL
  `);
  console.log(`Ghost signals (EXECUTE no position): ${ghosts.rows[0].count}`);

  const conf = await client.query(`
    SELECT COUNT(*) as count
    FROM combat_verdicts
    WHERE confidence > 20
  `);
  console.log(`Confidence anomalies (>20): ${conf.rows[0].count}`);

  const stats = await client.query(`
    SELECT action, COUNT(*) as count, 
           MIN(confidence) as min_conf, 
           MAX(confidence) as max_conf, 
           AVG(confidence) as avg_conf
    FROM combat_verdicts
    GROUP BY action
    ORDER BY action
  `);
  console.log('\n--- Confidence by Action ---');
  stats.rows.forEach((r) => {
    console.log(
      `  ${r.action.padEnd(10)}: count=${r.count}, min=${r.min_conf}, max=${r.max_conf}, avg=${r.avg_conf?.toFixed(2)}`,
    );
  });

  const samplePos = await client.query(`
    SELECT id_alias, symbol, side, entry_price, quantity, leverage, status
    FROM positions
    WHERE signal_id IS NOT NULL
    LIMIT 5
  `);
  console.log('\n--- Sample Positions (linked to verdicts) ---');
  console.table(samplePos.rows);

  await client.end();
}

verify().catch((err) => {
  console.error(err);
  process.exit(1);
});
