const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost', port: 5432, user: 'postgres', password: '9022', database: 'agent_sniperbot_analyst', max: 2
});
pool.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'").then(r => {
  console.log(r.rows.length ? '✅ pgvector: ' + JSON.stringify(r.rows[0]) : '✅ pgvector: NOT INSTALLED');
  pool.end();
}).catch(e => {
  console.error('❌ Error:', e.message);
  pool.end();
});