const express = require('express');
const multer = require('multer');
const path = require('path');
const { pool, init } = require('./db');
const { ensureBuckets, uploadPhoto, getSignedUrl, deletePhoto } = require('./storage');
const { runBackup, scheduleBackup, buildWorkbookBuffer, buildWorkbookWithPhotosBuffer } = require('./backup');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_PHOTOS_PER_SHOP = 8;

app.use(express.json({ limit: '2mb' }));
app.post('/api/login', auth.login);
app.use(auth.gate);
app.use(express.static(path.join(__dirname, 'public')));

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: MAX_PHOTOS_PER_SHOP },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- Vans ----------
app.get('/api/vans', asyncHandler(async (req, res) => {
  const { rows: vans } = await pool.query('SELECT * FROM vans ORDER BY id');
  const { rows: counts } = await pool.query(`
    SELECT van_id, COUNT(*)::int AS c FROM shops GROUP BY van_id
  `);
  const countMap = Object.fromEntries(counts.map(c => [c.van_id, c.c]));
  res.json(vans.map(v => ({ ...v, shopCount: countMap[v.id] || 0 })));
}));

// ---------- Shops ----------
app.get('/api/vans/:vanId/shops', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.*, (SELECT COUNT(*)::int FROM photos p WHERE p.shop_id = s.id) AS "photoCount"
    FROM shops s WHERE van_id = $1 ORDER BY shop_code
  `, [req.params.vanId]);
  res.json(rows);
}));

app.get('/api/shops/:shopId', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM shops WHERE id = $1', [req.params.shopId]);
  if (!rows[0]) return res.status(404).json({ error: 'Shop not found' });
  const { rows: photos } = await pool.query('SELECT * FROM photos WHERE shop_id = $1 ORDER BY uploaded_at', [req.params.shopId]);
  const withUrls = await Promise.all(photos.map(async p => ({
    ...p,
    signed_url: await getSignedUrl(p.storage_path).catch(() => null),
  })));
  res.json({ ...rows[0], photos: withUrls });
}));

app.post('/api/vans/:vanId/shops', asyncHandler(async (req, res) => {
  const { shop_code, customer_name } = req.body;
  if (!shop_code || !String(shop_code).trim()) {
    return res.status(400).json({ error: 'shop_code is required' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO shops (van_id, shop_code, customer_name) VALUES ($1, $2, $3) RETURNING *',
      [req.params.vanId, String(shop_code).trim(), customer_name || '']
    );
    scheduleBackup();
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A shop with this code already exists in this van' });
    throw err;
  }
}));

app.post('/api/vans/:vanId/shops/bulk', asyncHandler(async (req, res) => {
  const count = Math.min(parseInt(req.body.count, 10) || 0, 200);
  if (count <= 0) return res.status(400).json({ error: 'count must be a positive number' });
  const vanId = req.params.vanId;

  const { rows: existingRows } = await pool.query('SELECT COUNT(*)::int AS c FROM shops WHERE van_id = $1', [vanId]);
  const existing = existingRows[0].c;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = existing + 1; i <= existing + count; i++) {
      const code = `SHOP-${String(i).padStart(3, '0')}`;
      await client.query(
        'INSERT INTO shops (van_id, shop_code) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [vanId, code]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  scheduleBackup();
  res.json({ ok: true, added: count });
}));

app.put('/api/shops/:shopId', asyncHandler(async (req, res) => {
  const { shop_code, customer_name, notes, stock_status, balance_amount, verified_at, visit_day } = req.body;
  // visit_day is a real column update, not COALESCE: the form always submits it
  // (blank string to clear, or a number to set), unlike partial API callers.
  const visitDayProvided = Object.prototype.hasOwnProperty.call(req.body, 'visit_day');
  const visitDayValue = !visitDayProvided || visit_day === null || visit_day === ''
    ? null
    : Math.min(Math.max(parseInt(visit_day, 10) || 1, 1), 7);
  try {
    const { rows } = await pool.query(`
      UPDATE shops SET
        shop_code = COALESCE($1, shop_code),
        customer_name = COALESCE($2, customer_name),
        notes = COALESCE($3, notes),
        stock_status = COALESCE($4, stock_status),
        balance_amount = COALESCE($5, balance_amount),
        verified_at = COALESCE($6, verified_at),
        visit_day = CASE WHEN $7 THEN $8 ELSE visit_day END,
        updated_at = now()
      WHERE id = $9
      RETURNING *
    `, [shop_code, customer_name, notes, stock_status, balance_amount, verified_at, visitDayProvided, visitDayValue, req.params.shopId]);
    if (!rows[0]) return res.status(404).json({ error: 'Shop not found' });
    scheduleBackup();
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A shop with this code already exists in this van' });
    throw err;
  }
}));

// All shops across every van, for the dashboard view
app.get('/api/dashboard/shops', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.*, v.name AS van_name,
           (SELECT COUNT(*)::int FROM photos p WHERE p.shop_id = s.id) AS "photoCount"
    FROM shops s
    JOIN vans v ON v.id = s.van_id
    ORDER BY v.id, s.visit_day NULLS LAST, s.shop_code
  `);
  res.json(rows);
}));

app.delete('/api/shops/:shopId', asyncHandler(async (req, res) => {
  const { rows: photos } = await pool.query('SELECT * FROM photos WHERE shop_id = $1', [req.params.shopId]);
  await pool.query('DELETE FROM shops WHERE id = $1', [req.params.shopId]);
  for (const p of photos) deletePhoto(p.storage_path).catch(() => {});
  scheduleBackup();
  res.json({ ok: true });
}));

// ---------- Photos ----------
app.post('/api/shops/:shopId/photos', (req, res) => {
  upload.array('photos', MAX_PHOTOS_PER_SHOP)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      const shopId = req.params.shopId;
      const { rows: shopRows } = await pool.query('SELECT id FROM shops WHERE id = $1', [shopId]);
      if (!shopRows[0]) return res.status(404).json({ error: 'Shop not found' });

      const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS c FROM photos WHERE shop_id = $1', [shopId]);
      const files = req.files || [];
      if (countRows[0].c + files.length > MAX_PHOTOS_PER_SHOP) {
        return res.status(400).json({ error: `Max ${MAX_PHOTOS_PER_SHOP} photos per shop` });
      }

      const category = req.body.category || 'general';
      for (const f of files) {
        const { storagePath } = await uploadPhoto(shopId, f);
        await pool.query(
          'INSERT INTO photos (shop_id, category, storage_path) VALUES ($1, $2, $3)',
          [shopId, category, storagePath]
        );
      }
      scheduleBackup();
      const { rows: photos } = await pool.query('SELECT * FROM photos WHERE shop_id = $1 ORDER BY uploaded_at', [shopId]);
      const withUrls = await Promise.all(photos.map(async p => ({
        ...p,
        signed_url: await getSignedUrl(p.storage_path).catch(() => null),
      })));
      res.status(201).json(withUrls);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not save photo(s) - please retry' });
    }
  });
});

app.delete('/api/photos/:photoId', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM photos WHERE id = $1', [req.params.photoId]);
  if (!rows[0]) return res.status(404).json({ error: 'Photo not found' });
  await pool.query('DELETE FROM photos WHERE id = $1', [req.params.photoId]);
  await deletePhoto(rows[0].storage_path).catch(() => {});
  scheduleBackup();
  res.json({ ok: true });
}));

// Download the backup workbook straight from the browser, any time (data only, fast)
app.get('/api/backup-download', asyncHandler(async (req, res) => {
  const buffer = await buildWorkbookBuffer();
  res.setHeader('Content-Disposition', 'attachment; filename="shops_backup.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}));

// Full backup with embedded photo thumbnails - slower (downloads + resizes every
// photo), so it's only built when explicitly requested, never automatically.
app.get('/api/backup-download-photos', asyncHandler(async (req, res) => {
  // Optional ?van=N keeps the export small enough to finish quickly once there
  // are hundreds of shops; omitting it exports every van.
  const vanId = req.query.van ? parseInt(req.query.van, 10) : null;
  const buffer = await buildWorkbookWithPhotosBuffer(Number.isFinite(vanId) ? vanId : null);
  const suffix = vanId ? `_van${vanId}` : '';
  res.setHeader('Content-Disposition', `attachment; filename="shops_backup_with_photos${suffix}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
}));

app.post('/api/backup-now', asyncHandler(async (req, res) => {
  await runBackup();
  res.json({ ok: true });
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error, nothing was lost - please retry.' });
});

async function start() {
  await init();
  await ensureBuckets();
  await runBackup();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => console.error('Uncaught exception (server kept running):', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection (server kept running):', err));
