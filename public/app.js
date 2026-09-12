const state = {
  vans: [],
  currentVanId: null,
  shops: [],
  currentShopId: null,
  cameFromDashboard: false,
  dashboardShops: [],
  lightboxPhotos: [],
  lightboxIndex: 0,
};

const el = (sel) => document.querySelector(sel);
const toastEl = el('#toast');
const statusPill = el('#statusPill');

function toast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.className = 'toast'), 2600);
}

function setStatus(text, type = '') {
  statusPill.textContent = text;
  statusPill.className = `status-pill ${type}`;
}

async function api(url, opts = {}) {
  setStatus('Working...', '');
  try {
    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = '/login.html';
      return new Promise(() => {}); // stop further handling; navigation is happening
    }
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await res.json() : null;
    if (!res.ok) {
      const msg = (data && data.error) || `Request failed (${res.status})`;
      setStatus('Error', 'err');
      throw new Error(msg);
    }
    setStatus('Ready', 'ok');
    return data;
  } catch (err) {
    setStatus('Connection issue', 'err');
    throw err;
  }
}

function show(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  el(`#${viewId}`).classList.remove('hidden');
}

// ---------------- Vans ----------------
async function loadVans() {
  try {
    state.vans = await api('/api/vans');
    renderVans();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderVans() {
  const grid = el('#vanGrid');
  grid.innerHTML = '';
  for (const van of state.vans) {
    const card = document.createElement('div');
    card.className = 'van-card';
    card.innerHTML = `<h3>${van.name}</h3><div class="count">${van.shopCount} shops</div>`;
    card.onclick = () => openVan(van.id, van.name);
    grid.appendChild(card);
  }
}

async function openVan(vanId, vanName) {
  state.currentVanId = vanId;
  el('#shopListTitle').textContent = vanName;
  show('shopListView');
  await loadShops();
}

// ---------------- Shops ----------------
async function loadShops() {
  try {
    state.shops = await api(`/api/vans/${state.currentVanId}/shops`);
    renderShops();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderShops(filter = '') {
  const grid = el('#shopGrid');
  grid.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const shops = state.shops.filter(s =>
    !q || s.shop_code.toLowerCase().includes(q) || (s.customer_name || '').toLowerCase().includes(q)
  );
  for (const shop of shops) {
    const card = document.createElement('div');
    card.className = 'shop-card' + (shop.verified_at ? ' verified' : '');
    card.innerHTML = `
      <div class="code">${shop.shop_code}${shop.visit_day ? ` <span class="day-badge">Day ${shop.visit_day}</span>` : ''}</div>
      <div class="cust">${shop.customer_name || '—'}</div>
      <div class="meta">
        <span class="photos-badge">${shop.photoCount || 0}/8 photos</span>
        <span>${shop.verified_at || 'unverified'}</span>
      </div>
    `;
    card.onclick = () => openShop(shop.id);
    grid.appendChild(card);
  }
}

el('#shopSearch').addEventListener('input', (e) => renderShops(e.target.value));

document.querySelector('[data-action="add-shop"]').addEventListener('click', async () => {
  const code = el('#newShopCode').value.trim();
  const customer = el('#newShopCustomer').value.trim();
  if (!code) return toast('Enter a shop code first', 'err');
  try {
    await api(`/api/vans/${state.currentVanId}/shops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_code: code, customer_name: customer }),
    });
    el('#newShopCode').value = '';
    el('#newShopCustomer').value = '';
    toast('Shop added', 'ok');
    await loadShops();
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.querySelector('[data-action="bulk-add"]').addEventListener('click', async () => {
  const count = parseInt(el('#bulkCount').value, 10);
  if (!count || count <= 0) return toast('Enter how many empty shop slots to create', 'err');
  try {
    await api(`/api/vans/${state.currentVanId}/shops/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    });
    el('#bulkCount').value = '';
    toast(`${count} shop slots created`, 'ok');
    await loadShops();
  } catch (err) {
    toast(err.message, 'err');
  }
});

document.querySelector('[data-action="back-to-vans"]').addEventListener('click', () => {
  show('vanView');
  loadVans();
});
document.querySelector('[data-action="back-to-shops"]').addEventListener('click', () => {
  flushPendingSave();
  if (state.cameFromDashboard) {
    show('dashboardView');
    loadDashboard();
  } else {
    show('shopListView');
    loadShops();
  }
});

// ---------------- Shop detail ----------------
async function openShop(shopId, fromDashboard = false) {
  state.currentShopId = shopId;
  state.cameFromDashboard = fromDashboard;
  show('shopDetailView');
  await loadShopDetail();
}

async function loadShopDetail() {
  try {
    const shop = await api(`/api/shops/${state.currentShopId}`);
    el('#shopDetailTitle').textContent = shop.shop_code;
    const form = el('#shopForm');
    form.shop_code.value = shop.shop_code || '';
    form.customer_name.value = shop.customer_name || '';
    form.visit_day.value = shop.visit_day || '';
    form.notes.value = shop.notes || '';
    form.stock_status.value = shop.stock_status || '';
    form.balance_amount.value = shop.balance_amount || '';
    form.verified_at.value = shop.verified_at || '';
    renderPhotos(shop.photos || []);
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderPhotos(photos) {
  el('#photoCount').textContent = `(${photos.length}/8)`;
  const grid = el('#photoGrid');
  grid.innerHTML = '';
  photos.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.innerHTML = `<img src="${p.signed_url}" alt="shop photo" loading="lazy" /><button class="del" title="Delete photo">✕</button>`;
    div.querySelector('img').onclick = () => openLightbox(photos, i);
    div.querySelector('.del').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm('Delete this photo?')) return;
      try {
        await api(`/api/photos/${p.id}`, { method: 'DELETE' });
        toast('Photo deleted', 'ok');
        await loadShopDetail();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    grid.appendChild(div);
  });
}

// ---------------- Auto-save shop form ----------------
// Every field saves itself - typing pauses briefly then saves, dropdowns/dates
// save the instant they change. The button below still works too, for anyone
// who wants an explicit "yes it's saved" confirmation.
let autoSaveTimer = null;
const shopForm = el('#shopForm');

// Saves for a shop run strictly one-at-a-time, in the order they were requested.
// Without this, two quick saves in flight together could resolve out of order
// and let an older snapshot silently overwrite a newer one.
let saveChain = Promise.resolve();

function saveShopForm(shopIdAtSaveTime) {
  saveChain = saveChain.then(() => doSaveShopForm(shopIdAtSaveTime));
  return saveChain;
}

async function doSaveShopForm(shopIdAtSaveTime) {
  const saveState = el('#saveState');
  saveState.textContent = 'Saving...';
  saveState.className = 'save-state saving';
  const form = shopForm;
  const payload = {
    shop_code: form.shop_code.value.trim(),
    customer_name: form.customer_name.value.trim(),
    visit_day: form.visit_day.value,
    notes: form.notes.value,
    stock_status: form.stock_status.value,
    balance_amount: form.balance_amount.value,
    verified_at: form.verified_at.value,
  };
  try {
    await api(`/api/shops/${shopIdAtSaveTime}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // The shop may have been navigated away from while this request was in flight
    if (state.currentShopId === shopIdAtSaveTime) {
      saveState.textContent = 'Saved ✓';
      saveState.className = 'save-state saved';
    }
  } catch (err) {
    if (state.currentShopId === shopIdAtSaveTime) {
      saveState.textContent = 'Save failed — will retry';
      saveState.className = 'save-state err';
    }
    toast(err.message, 'err');
  }
}

function scheduleAutoSave(immediate = false) {
  const shopIdAtSaveTime = state.currentShopId;
  clearTimeout(autoSaveTimer);
  const saveState = el('#saveState');
  saveState.textContent = 'Editing...';
  saveState.className = 'save-state saving';
  autoSaveTimer = setTimeout(() => saveShopForm(shopIdAtSaveTime), immediate ? 0 : 700);
}

shopForm.addEventListener('submit', (e) => {
  e.preventDefault();
  scheduleAutoSave(true);
});

// Text fields: debounced auto-save while typing. Dropdowns/dates: save immediately on change.
['shop_code', 'customer_name', 'notes', 'stock_status', 'balance_amount'].forEach((name) => {
  shopForm[name].addEventListener('input', () => scheduleAutoSave(false));
});
['visit_day', 'verified_at'].forEach((name) => {
  shopForm[name].addEventListener('change', () => scheduleAutoSave(true));
});

// Save whatever's pending before leaving the shop, so a fast click-away never drops an edit
function flushPendingSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    saveShopForm(state.currentShopId);
  }
}

document.querySelector('[data-action="delete-shop"]').addEventListener('click', async () => {
  if (!confirm('Delete this shop and all its photos? This cannot be undone.')) return;
  try {
    await api(`/api/shops/${state.currentShopId}`, { method: 'DELETE' });
    toast('Shop deleted', 'ok');
    if (state.cameFromDashboard) {
      show('dashboardView');
      await loadDashboard();
    } else {
      show('shopListView');
      await loadShops();
    }
  } catch (err) {
    toast(err.message, 'err');
  }
});

async function uploadSelectedPhotos() {
  const input = el('#photoInput');
  const files = input.files;
  if (!files || files.length === 0) return toast('Choose photo(s) first', 'err');
  if (files.length > 8) return toast('Max 8 photos at once', 'err');
  const shopIdAtUploadTime = state.currentShopId;

  const fd = new FormData();
  for (const f of files) fd.append('photos', f);

  try {
    setStatus('Uploading...', '');
    toast(`Uploading ${files.length} photo(s)...`, '');
    await api(`/api/shops/${shopIdAtUploadTime}/photos`, { method: 'POST', body: fd });
    input.value = '';
    toast('Photo(s) uploaded', 'ok');
    if (state.currentShopId === shopIdAtUploadTime) await loadShopDetail();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// Uploads start the instant photos are picked - no extra click needed.
// The button stays as a manual fallback (e.g. re-triggering after an error).
el('#photoInput').addEventListener('change', uploadSelectedPhotos);
document.querySelector('[data-action="upload-photos"]').addEventListener('click', uploadSelectedPhotos);

el('#backupNowBtn').addEventListener('click', async () => {
  try {
    window.open('/api/backup-download', '_blank');
    await api('/api/backup-now', { method: 'POST' });
    toast('Backup downloaded & synced', 'ok');
  } catch (err) {
    toast('Download started; sync backup failed: ' + err.message, 'err');
  }
});

// Which van (if any) "Download with Photos" should scope to, based on what's
// on screen right now: browsing a specific van's shops always means "just this
// van"; the dashboard uses whatever it's filtered to; anywhere else exports everything.
function currentBackupVanScope() {
  if (!el('#dashboardView').classList.contains('hidden')) {
    return el('#dashboardVanFilter').value || null;
  }
  if (!el('#shopListView').classList.contains('hidden') || (!el('#shopDetailView').classList.contains('hidden') && !state.cameFromDashboard)) {
    return state.currentVanId ? String(state.currentVanId) : null;
  }
  return null; // van-select screen, or a shop opened from the dashboard: export everything
}

el('#backupPhotosBtn').addEventListener('click', () => {
  const van = currentBackupVanScope();
  const url = van ? `/api/backup-download-photos?van=${van}` : '/api/backup-download-photos';
  toast(van ? `Building Van ${van} backup with photos...` : 'Building backup with photos for ALL vans, this can take a while...', '');
  window.open(url, '_blank');
});

// Balance is stored as free text, so parse leniently; anything unparseable
// (blank, "n/a", etc.) sorts to the bottom regardless of direction.
function balanceValue(shop) {
  const n = parseFloat(String(shop.balance_amount || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function sortShops(rows, mode) {
  const byBalance = (dir) => (a, b) => {
    const av = balanceValue(a);
    const bv = balanceValue(b);
    if (av === null && bv === null) return a.shop_code.localeCompare(b.shop_code);
    if (av === null) return 1;
    if (bv === null) return -1;
    return dir === 'desc' ? bv - av : av - bv;
  };

  switch (mode) {
    case 'balance_desc': rows.sort(byBalance('desc')); break;
    case 'balance_asc': rows.sort(byBalance('asc')); break;
    case 'code': rows.sort((a, b) => a.shop_code.localeCompare(b.shop_code)); break;
    case 'photos_desc': rows.sort((a, b) => (b.photoCount || 0) - (a.photoCount || 0)); break;
    default: break; // server already returns van -> day -> code order
  }
  return rows;
}

// ---------------- Dashboard (all shops, all vans) ----------------
async function loadDashboard() {
  try {
    state.dashboardShops = await api('/api/dashboard/shops');
    renderDashboard();
  } catch (err) {
    toast(err.message, 'err');
  }
}

function renderDashboard() {
  const van = el('#dashboardVanFilter').value;
  const day = el('#dashboardDayFilter').value;
  const q = el('#dashboardSearch').value.trim().toLowerCase();

  const rows = state.dashboardShops.filter(s => {
    if (van && String(s.van_id) !== van) return false;
    if (day && String(s.visit_day || '') !== day) return false;
    if (q && !s.shop_code.toLowerCase().includes(q) && !(s.customer_name || '').toLowerCase().includes(q)) return false;
    return true;
  });

  sortShops(rows, el('#dashboardSort').value);

  renderDashboardStats(rows, van, day);
  renderDashboardChart(rows);

  const body = el('#dashboardTableBody');
  body.innerHTML = '';
  for (const s of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.van_name}</td>
      <td>${s.visit_day ? `Day ${s.visit_day}` : '—'}</td>
      <td>${s.shop_code}</td>
      <td>${s.customer_name || '—'}</td>
      <td>${s.balance_amount || '—'}</td>
      <td>${s.photoCount || 0}/8</td>
      <td>${s.verified_at || '—'}</td>
    `;
    tr.onclick = () => openShop(s.id, true);
    body.appendChild(tr);
  }
}

function renderDashboardStats(rows, vanFilter, dayFilter) {
  const container = el('#dashboardStats');
  const totalBalance = rows.reduce((sum, s) => sum + (balanceValue(s) || 0), 0);
  const withBalance = rows.filter(s => balanceValue(s) !== null).length;
  const verifiedCount = rows.filter(s => s.verified_at).length;
  const totalPhotos = rows.reduce((sum, s) => sum + (s.photoCount || 0), 0);

  const scopeText = [
    vanFilter ? `Van ${vanFilter}` : null,
    dayFilter ? `Day ${dayFilter}` : null,
  ].filter(Boolean).join(', ') || 'All Vans / All Days';

  container.innerHTML = `
    <div class="stat-tile">
      <div class="stat-value">${rows.length}</div>
      <div class="stat-label">Shops (${scopeText})</div>
    </div>
    <div class="stat-tile">
      <div class="stat-value">${totalBalance.toLocaleString()}</div>
      <div class="stat-label">Total Balance (${withBalance} shops with a value)</div>
    </div>
    <div class="stat-tile">
      <div class="stat-value">${verifiedCount}/${rows.length}</div>
      <div class="stat-label">Verified</div>
    </div>
    <div class="stat-tile">
      <div class="stat-value">${totalPhotos}</div>
      <div class="stat-label">Photos Uploaded</div>
    </div>
  `;
}

function renderDashboardChart(rows) {
  const withBalance = rows
    .map(s => ({ label: s.shop_code, value: balanceValue(s) }))
    .filter(s => s.value !== null && s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 12); // keep the chart readable even with hundreds of shops

  el('#chartScopeLabel').textContent = withBalance.length
    ? `(top ${withBalance.length} by balance)`
    : '';

  const chart = el('#dashboardChart');
  if (withBalance.length === 0) {
    chart.innerHTML = '<div class="chart-empty">No shops with a balance value in this view yet.</div>';
    return;
  }

  const max = Math.max(...withBalance.map(s => s.value));
  chart.innerHTML = withBalance.map(s => `
    <div class="bar-row">
      <div class="bar-label" title="${s.label}">${s.label}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${Math.max(2, (s.value / max) * 100)}%"></div>
      </div>
      <div class="bar-value">${s.value.toLocaleString()}</div>
    </div>
  `).join('');
}

el('#dashboardBtn').addEventListener('click', () => {
  show('dashboardView');
  loadDashboard();
});
document.querySelector('[data-action="back-to-vans-from-dashboard"]').addEventListener('click', () => {
  show('vanView');
  loadVans();
});
el('#dashboardVanFilter').addEventListener('change', renderDashboard);
el('#dashboardDayFilter').addEventListener('change', renderDashboard);
el('#dashboardSort').addEventListener('change', renderDashboard);
el('#dashboardSearch').addEventListener('input', renderDashboard);

// ---------------- Fullscreen photo viewer ----------------
const lightbox = el('#lightbox');

function openLightbox(photos, index) {
  state.lightboxPhotos = photos.filter(p => p.signed_url);
  state.lightboxIndex = Math.max(0, Math.min(index, state.lightboxPhotos.length - 1));
  lightbox.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  showLightboxPhoto();
}

function showLightboxPhoto() {
  const photo = state.lightboxPhotos[state.lightboxIndex];
  if (!photo) return closeLightbox();
  el('#lbImage').src = photo.signed_url;
  el('#lbCounter').textContent = `${state.lightboxIndex + 1} / ${state.lightboxPhotos.length}`;
  const multiple = state.lightboxPhotos.length > 1;
  el('#lbPrev').style.display = multiple ? '' : 'none';
  el('#lbNext').style.display = multiple ? '' : 'none';
}

function stepLightbox(delta) {
  const count = state.lightboxPhotos.length;
  if (count === 0) return;
  state.lightboxIndex = (state.lightboxIndex + delta + count) % count; // wraps around
  showLightboxPhoto();
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  el('#lbImage').src = '';
  document.body.style.overflow = '';
}

el('#lbClose').addEventListener('click', closeLightbox);
el('#lbPrev').addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(-1); });
el('#lbNext').addEventListener('click', (e) => { e.stopPropagation(); stepLightbox(1); });
el('#lbImage').addEventListener('click', (e) => e.stopPropagation()); // clicking the photo itself shouldn't close
lightbox.addEventListener('click', closeLightbox); // clicking the backdrop does

document.addEventListener('keydown', (e) => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  else if (e.key === 'ArrowLeft') stepLightbox(-1);
  else if (e.key === 'ArrowRight') stepLightbox(1);
});

// Warn before leaving with unsaved edits (best-effort)
window.addEventListener('beforeunload', (e) => {
  // Data is saved per-field-submit, so this is just a safety net during active typing
});

loadVans();
