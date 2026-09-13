const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL env var. Set it to your Supabase Postgres connection string.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

pool.on('error', (err) => {
  // A dropped idle connection should never crash the whole server
  console.error('Unexpected DB pool error (server kept running):', err);
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vans (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shops (
      id SERIAL PRIMARY KEY,
      van_id INTEGER NOT NULL REFERENCES vans(id) ON DELETE CASCADE,
      shop_code TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      stock_status TEXT DEFAULT '',
      balance_amount TEXT DEFAULT '',
      verified_at TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(van_id, shop_code)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id SERIAL PRIMARY KEY,
      shop_id INTEGER NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      category TEXT DEFAULT 'general',
      storage_path TEXT NOT NULL,
      uploaded_at TIMESTAMPTZ DEFAULT now()
    );

    ALTER TABLE shops ADD COLUMN IF NOT EXISTS visit_day INTEGER;
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS balance_company TEXT DEFAULT '';
    ALTER TABLE shops ADD COLUMN IF NOT EXISTS balance_customer TEXT DEFAULT '';
  `);

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM vans');
  if (rows[0].c === 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 1; i <= 5; i++) {
        await client.query('INSERT INTO vans (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [i, `Van ${i}`]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { pool, init };
