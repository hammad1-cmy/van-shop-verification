const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');
const sharp = require('sharp');

const BUCKET = process.env.SUPABASE_BUCKET || 'shop-photos';
const BACKUP_BUCKET = process.env.SUPABASE_BACKUP_BUCKET || 'shop-backups';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY env vars.');
}

// We never use Supabase Realtime, but the client always constructs a RealtimeClient,
// which on Node < 22 throws if there's no native WebSocket. Supplying the 'ws' package
// here avoids that crash regardless of which Node version ends up running this.
const WebSocket = require('ws');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket },
});

async function ensureBuckets() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const names = (buckets || []).map(b => b.name);
  // Both buckets are private: photos are confidential (shop/customer data) and
  // must only be reachable via short-lived signed URLs handed out by our own API.
  if (!names.includes(BUCKET)) {
    await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: '10MB' });
  }
  if (!names.includes(BACKUP_BUCKET)) {
    await supabase.storage.createBucket(BACKUP_BUCKET, { public: false });
  }
}

// Phone camera photos routinely arrive at 3-8MB. At dozens of shops x 8 photos
// x 5 vans, storing originals unmodified would burn through storage quota fast
// and make full exports painfully slow. Re-encoding to a capped, high-quality
// JPEG cuts typical size by 10-20x with no visible loss for a verification photo.
// If anything about the source file trips up sharp (an exotic format, a
// corrupt upload), we fall back to storing the original untouched rather than
// ever failing the upload outright.
async function normalizePhoto(file) {
  try {
    const buffer = await sharp(file.buffer)
      .rotate() // respects the phone's EXIF orientation instead of storing it sideways
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { buffer, contentType: 'image/jpeg', ext: '.jpg' };
  } catch (err) {
    console.error('Photo normalization failed, storing original as-is:', err.message);
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    return { buffer: file.buffer, contentType: file.mimetype, ext };
  }
}

async function uploadPhoto(shopId, file) {
  const { buffer, contentType, ext } = await normalizePhoto(file);
  const storagePath = `${shopId}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  });
  if (error) throw error;

  return { storagePath };
}

async function getSignedUrl(storagePath, expiresInSeconds = 3600) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

async function deletePhoto(storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]);
}

async function downloadPhotoBuffer(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

async function uploadBackup(buffer) {
  await supabase.storage.from(BACKUP_BUCKET).upload('shops_backup.xlsx', buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
}

module.exports = { supabase, ensureBuckets, uploadPhoto, getSignedUrl, deletePhoto, downloadPhotoBuffer, uploadBackup, BUCKET, BACKUP_BUCKET };
