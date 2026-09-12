const XLSX = require('xlsx');
const { pool } = require('./db');
const { uploadBackup } = require('./storage');

async function buildWorkbookBuffer() {
  const { rows } = await pool.query(`
    SELECT s.id, v.name AS van, s.shop_code, s.customer_name, s.notes,
           s.stock_status, s.balance_amount, s.verified_at,
           s.created_at, s.updated_at,
           (SELECT COUNT(*)::int FROM photos p WHERE p.shop_id = s.id) AS photo_count
    FROM shops s
    JOIN vans v ON v.id = s.van_id
    ORDER BY v.id, s.shop_code
  `);

  const formatted = rows.map(r => ({
    ...r,
    created_at: r.created_at ? new Date(r.created_at).toISOString().replace('T', ' ').slice(0, 19) : '',
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString().replace('T', ' ').slice(0, 19) : '',
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(formatted);
  XLSX.utils.book_append_sheet(wb, ws, 'Shops');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function runBackup() {
  try {
    const buffer = await buildWorkbookBuffer();
    await uploadBackup(buffer);
  } catch (err) {
    console.error('Backup failed (data itself is safe in the database):', err);
  }
}

let pending = false;
function scheduleBackup() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    runBackup();
  }, 4000);
}

module.exports = { runBackup, scheduleBackup, buildWorkbookBuffer };
