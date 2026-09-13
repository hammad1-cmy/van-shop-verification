const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const sharp = require('sharp');
const { pool } = require('./db');
const { uploadBackup, downloadPhotoBuffer } = require('./storage');

const COMPANY_NAME = 'SHAH G OIL TRADERS';
const COMPANY_TAGLINE = 'Distributor of Euro Oil';
const BRAND_COLOR = 'FF1F3864'; // deep navy, ARGB
const BRAND_ACCENT = 'FFE8A33D'; // amber accent

// The "as per Shah Oil Traders Ledger" column header shows a fixed reporting
// date, updated by request each cycle - not auto-generated to today's date.
// Override via env var when the reporting cycle changes.
function defaultLedgerDate() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}
const LEDGER_AS_OF_DATE = process.env.LEDGER_AS_OF_DATE || defaultLedgerDate();

function formatDate(d) {
  return d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '';
}

function parseMoney(v) {
  const n = parseFloat(String(v || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function computeDifference(shop) {
  const company = parseMoney(shop.balance_company);
  const customer = parseMoney(shop.balance_customer);
  return (company === null || customer === null) ? '' : company - customer;
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function fetchShopsWithPhotos(vanId = null) {
  const { rows: shops } = await pool.query(`
    SELECT s.id, v.name AS van, s.shop_code, s.customer_name, s.notes,
           s.stock_status, s.balance_company, s.balance_customer, s.verified_at, s.visit_day, s.created_at, s.updated_at
    FROM shops s
    JOIN vans v ON v.id = s.van_id
    WHERE $1::int IS NULL OR s.van_id = $1::int
    ORDER BY v.id, s.visit_day NULLS LAST, s.shop_code
  `, [vanId]);
  const { rows: photos } = await pool.query(`
    SELECT id, shop_id, storage_path, uploaded_at FROM photos ORDER BY shop_id, uploaded_at
  `);
  const photosByShop = {};
  for (const p of photos) {
    (photosByShop[p.shop_id] ||= []).push(p);
  }
  return shops.map(s => ({ ...s, photos: photosByShop[s.id] || [] }));
}

// Fast, text-only backup. Runs automatically after every save so a current
// copy always exists, without the cost of downloading/resizing every photo.
async function buildWorkbookBuffer() {
  const shops = await fetchShopsWithPhotos();
  const rows = shops.map(s => ({
    ID: s.id,
    Van: s.van,
    Day: s.visit_day || '',
    'Customer Code': s.shop_code,
    'Customer Name': s.customer_name,
    'Stock Status': s.stock_status,
    'Balance as per Shah Oil Traders Ledger': s.balance_company,
    'Balance as per Customer Ledger': s.balance_customer,
    Difference: computeDifference(s),
    Remarks: s.notes,
    'Actual Field Visit Date': s.verified_at,
    'Created At': formatDate(s.created_at),
    'Last Updated': formatDate(s.updated_at),
    'Photo Count': s.photos.length,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  if (rows.length > 0) {
    const lastCol = XLSX.utils.encode_col(Object.keys(rows[0]).length - 1);
    ws['!autofilter'] = { ref: `A1:${lastCol}1` };
  }
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

// Full backup with embedded photo thumbnails. Downloads + resizes every
// photo, so it's slower - only built on demand when someone clicks
// "Download with Photos", never automatically after every save.
const THUMB_SIZE = 220;
// Van is included for convenience when browsing an "all vans" export; the
// remaining 7 columns match the customer verification sheet format exactly
// (Day and Stock Status are intentionally left out of this specific report).
const COLS = [
  'Van',
  'Customer Code',
  'Customer Name',
  'Actual Field Visit Date',
  `Balance as per Shah Oil Traders Ledger (${LEDGER_AS_OF_DATE})`,
  'Balance as per Customer Ledger',
  'Difference',
  'Remarks',
];
const PHOTO_COL_START = COLS.length; // 0-indexed column where photo thumbnails begin
const MAX_PHOTOS = 8;

async function buildWorkbookWithPhotosBuffer(vanId = null) {
  const shops = await fetchShopsWithPhotos(vanId);
  const totalCols = COLS.length + MAX_PHOTOS;
  const lastColLetter = colLetter(totalCols);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = COMPANY_NAME;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Verification Report', {
    pageSetup: { orientation: 'landscape', fitToPage: true },
  });

  const scopeLabel = vanId ? (shops[0]?.van || `Van ${vanId}`) : 'All Vans';

  // ---- Branded title block (rows 1-3) ----
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const titleCell = sheet.getCell('A1');
  titleCell.value = COMPANY_NAME;
  titleCell.font = { size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLOR } };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(`A2:${lastColLetter}2`);
  const taglineCell = sheet.getCell('A2');
  taglineCell.value = `${COMPANY_TAGLINE}  —  Shop Verification Report`;
  taglineCell.font = { size: 12, italic: true, bold: true, color: { argb: 'FFFFFFFF' } };
  taglineCell.alignment = { vertical: 'middle', horizontal: 'center' };
  taglineCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_COLOR } };
  sheet.getRow(2).height = 22;

  sheet.mergeCells(`A3:${lastColLetter}3`);
  const metaCell = sheet.getCell('A3');
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  metaCell.value = `Scope: ${scopeLabel}   |   Shops: ${shops.length}   |   Generated: ${generatedAt}`;
  metaCell.font = { size: 10, italic: true, color: { argb: 'FF555555' } };
  metaCell.alignment = { vertical: 'middle', horizontal: 'center' };
  metaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
  sheet.getRow(3).height = 18;

  // ---- Header row (row 4) ----
  const HEADER_ROW = 4;
  const header = [...COLS];
  for (let i = 1; i <= MAX_PHOTOS; i++) header.push(`Photo ${i}`);
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.values = header;
  headerRow.height = 40; // tall enough to wrap the longer ledger-balance header text
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_ACCENT } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
      right: { style: 'thin', color: { argb: 'FFCCCCCC' } },
    };
  });

  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW }]; // keep title + header visible while scrolling

  for (let col = 1; col <= COLS.length; col++) sheet.getColumn(col).width = 20;
  // The two balance columns and Remarks carry longer values, so give them more room
  sheet.getColumn(5).width = 26; // Balance as per Shah Oil Traders Ledger
  sheet.getColumn(6).width = 22; // Balance as per Customer Ledger
  sheet.getColumn(8).width = 26; // Remarks
  // Excel column width is ~7px per unit, so match the thumbnail size
  const photoColWidth = Math.ceil(THUMB_SIZE / 7);
  for (let i = 0; i < MAX_PHOTOS; i++) sheet.getColumn(PHOTO_COL_START + 1 + i).width = photoColWidth;

  // Pass 1: lay out every row first (cheap, no I/O) so we know each shop's
  // row index before touching any photos.
  let dataRowNum = 0;
  const photoTasks = []; // { storagePath, rowIndex, col }
  for (const shop of shops) {
    const rowValues = [
      shop.van,
      shop.shop_code,
      shop.customer_name,
      shop.verified_at,
      shop.balance_company,
      shop.balance_customer,
      computeDifference(shop),
      shop.notes,
    ];
    const row = sheet.addRow(rowValues);
    row.height = THUMB_SIZE * 0.75; // points, roughly matches thumbnail pixel height
    row.alignment = { vertical: 'middle', wrapText: true, horizontal: 'left' };

    // Light zebra striping for readability across long lists
    if (dataRowNum % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      });
    }
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
        right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      };
    });
    dataRowNum++;

    const rowIndex = row.number - 1; // 0-indexed for image anchoring
    for (let i = 0; i < Math.min(shop.photos.length, MAX_PHOTOS); i++) {
      photoTasks.push({ shopId: shop.id, photoId: shop.photos[i].id, storagePath: shop.photos[i].storage_path, rowIndex, col: PHOTO_COL_START + i });
    }
  }

  // Pass 2: fetch + resize every photo with bounded concurrency (instead of
  // one-at-a-time), then embed each result. At hundreds of shops this is the
  // difference between an export finishing in seconds vs. minutes.
  const CONCURRENCY = 6;
  let cursor = 0;
  async function worker() {
    while (cursor < photoTasks.length) {
      const task = photoTasks[cursor++];
      try {
        const original = await downloadPhotoBuffer(task.storagePath);
        const thumb = await sharp(original)
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' })
          .jpeg({ quality: 70 })
          .toBuffer();
        const imageId = workbook.addImage({ buffer: thumb, extension: 'jpeg' });
        sheet.addImage(imageId, {
          tl: { col: task.col, row: task.rowIndex },
          ext: { width: THUMB_SIZE, height: THUMB_SIZE },
        });
      } catch (err) {
        console.error(`Could not embed photo ${task.photoId} for shop ${task.shopId}:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, photoTasks.length) }, worker));

  // Set once data rows exist, so the filter range covers header + all data
  const lastDataRow = HEADER_ROW + shops.length;
  sheet.autoFilter = { from: `A${HEADER_ROW}`, to: `${lastColLetter}${lastDataRow}` };

  return workbook.xlsx.writeBuffer();
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

module.exports = { runBackup, scheduleBackup, buildWorkbookBuffer, buildWorkbookWithPhotosBuffer };
