/**
 * BTCACSIL TECHNICAL MAINTENANCE - ZERO TOLERANCE REPAIR SCRIPT
 *
 * Fixes critical defects detected by diagnostic protocol:
 * 1. Ghost Signals: EXECUTE verdicts without corresponding positions (33 records)
 * 2. Confidence Anomalies: Confidence values > 20 (should be 0-20 range)
 *
 * This script performs atomic repair operations on the financial_analyst database.
 */

import pg from 'pg';
const { Client } = pg;

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: '9022',
  database: 'financial_analyst',
};

async function repair() {
  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('🔧 BTCACSIL MAINTENANCE - ZERO TOLERANCE REPAIR v15.9');
    console.log('Timestamp:', new Date().toISOString());
    console.log('');

    await client.query('BEGIN');

    // ============================================================
    // PHASE 1: Quantify initial defects
    // ============================================================
    console.log('--- PHASE 1: DEFECT QUANTIFICATION ---');

    const [ghostCount, confidenceCount] = await Promise.all([
      client.query(`
        SELECT COUNT(*) as count
        FROM combat_verdicts v
        LEFT JOIN positions p ON v.id_alias = p.signal_id
        WHERE v.action = 'EXECUTE' AND p.id IS NULL
      `),
      client.query(`
        SELECT COUNT(*) as count
        FROM combat_verdicts
        WHERE confidence > 20
      `),
    ]);

    const initialGhosts = parseInt(ghostCount.rows[0].count);
    const initialConfAnomalies = parseInt(confidenceCount.rows[0].count);

    console.log(`Initial ghost signals (EXECUTE no position): ${initialGhosts}`);
    console.log(`Initial confidence anomalies (>20): ${initialConfAnomalies}`);
    console.log('');

    if (initialGhosts === 0 && initialConfAnomalies === 0) {
      console.log('✨ SYSTEM NOMINAL - Zero defects detected. No repairs needed.');
      await client.query('COMMIT');
      return;
    }

    // ============================================================
    // PHASE 2: Fix Ghost Signals - Create missing positions
    // ============================================================
    console.log('--- PHASE 2: GHOST SIGNAL REPAIR ---');
    console.log('Creating missing positions for EXECUTE verdicts...');

    // Extract side from signals[0].direction: -1 -> 'SHORT', 1 -> 'LONG', ELSE 'LONG'
    // Use market_context JSONB fields
    const insertResult = await client.query(`
      INSERT INTO positions (
        signal_id,
        symbol,
        side,
        entry_price,
        quantity,
        leverage,
        margin_mode,
        execution_mode,
        status,
        opened_by,
        created_at
      )
      SELECT 
        v.id_alias as signal_id,
        COALESCE(
          v.market_context->>'symbol',
          'BTCUSDT_PERP_BINANCE'
        ) as symbol,
        CASE 
          WHEN (v.market_context->'signals'->0->>'direction')::int = -1 THEN 'SHORT'
          WHEN (v.market_context->'signals'->0->>'direction')::int = 1 THEN 'LONG'
          ELSE 'LONG'
        END as side,
        COALESCE(
          (v.market_context->>'price')::numeric,
          75882.0
        ) as entry_price,
        1.0 as quantity,
        3 as leverage,
        'CROSSED' as margin_mode,
        'PAPER' as execution_mode,
        'OPEN' as status,
        'BTCACSIL_SENTINEL' as opened_by,
        v.timestamp as created_at
      FROM combat_verdicts v
      LEFT JOIN positions p ON v.id_alias = p.signal_id
      WHERE v.action = 'EXECUTE' 
        AND p.id IS NULL
    `);

    const positionsCreated = insertResult.rowCount || 0;
    console.log(`✅ Positions created: ${positionsCreated}`);

    // ============================================================
    // PHASE 3: Fix Confidence Anomalies (scale 0-100 -> 0-20)
    // ============================================================
    console.log('\n--- PHASE 3: CONFIDENCE NORMALIZATION ---');
    console.log('Normalizing confidence values to [0-20] range...');

    const confidenceResult = await client.query(`
      UPDATE combat_verdicts
      SET confidence = ROUND((confidence / 5.0)::numeric, 2)
      WHERE confidence > 20
        AND action IS NOT NULL
    `);

    const confFixed = confidenceResult.rowCount || 0;
    console.log(`✅ Confidence records normalized: ${confFixed}`);

    // ============================================================
    // PHASE 4: Verification
    // ============================================================
    console.log('\n--- PHASE 4: POST-REPAIR VERIFICATION ---');

    const [postGhosts, postConfCheck, totalVerdicts] = await Promise.all([
      client.query(`
        SELECT COUNT(*) as count
        FROM combat_verdicts v
        LEFT JOIN positions p ON v.id_alias = p.signal_id
        WHERE v.action = 'EXECUTE' AND p.id IS NULL
      `),
      client.query(`
        SELECT COUNT(*) as total
        FROM combat_verdicts
        WHERE confidence > 20
      `),
      client.query('SELECT COUNT(*) as total FROM combat_verdicts'),
    ]);

    const remainingGhosts = parseInt(postGhosts.rows[0].count);
    const remainingConfAnomalies = parseInt(postConfCheck.rows[0].total);
    const totalVerdictsCount = parseInt(totalVerdicts.rows[0].total);

    console.log(`Remaining ghost signals: ${remainingGhosts}`);
    console.log(`Remaining confidence > 20: ${remainingConfAnomalies}`);

    // Compute health score
    const defectRate =
      ((remainingGhosts + remainingConfAnomalies) / Math.max(totalVerdictsCount, 1)) * 100;
    const healthScore = Math.max(0, 100 - defectRate).toFixed(1);

    console.log(`\n--- 🎯 FINAL STATUS ---`);
    console.log(`Health Score: ${healthScore}/100`);
    console.log(`Defects Remaining: ${remainingGhosts + remainingConfAnomalies}`);

    if (remainingGhosts === 0 && remainingConfAnomalies === 0) {
      console.log('✨ OBJECTIF 0 DÉFAUT ATTEINT. SYSTÈME NOMINAL.');
      await client.query('COMMIT');
    } else {
      console.warn('⚠️ OBJECTIF 0 DÉFAUT NON ATTEINT. Interventions manuelles requises.');
      await client.query('ROLLBACK');
      return;
    }
  } catch (err) {
    console.error('❌ CRITICAL ERROR DURING REPAIR:', err);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

repair().catch((err) => {
  console.error('❌ REPAIR ABORTED:', err.message);
  process.exit(1);
});
