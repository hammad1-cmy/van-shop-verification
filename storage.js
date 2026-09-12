const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');

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

async function uploadPhoto(shopId, file) {
  const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
  const storagePath = `${shopId}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
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

async function uploadBackup(buffer) {
  await supabase.storage.from(BACKUP_BUCKET).upload('shops_backup.xlsx', buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  });
}

module.exports = { supabase, ensureBuckets, uploadPhoto, getSignedUrl, deletePhoto, uploadBackup, BUCKET, BACKUP_BUCKET };
