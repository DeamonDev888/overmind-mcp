import pg from 'pg';
const { Client } = pg;

async function getSchema() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || '9022',
    database: 'financial_analyst',
  });

  try {
    await client.connect();
    const columns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'mcp_debates'
    `);
    console.table(columns.rows);
  } catch (err) {
    console.error('❌ ERREUR:', err);
  } finally {
    await client.end();
  }
}

getSchema();
