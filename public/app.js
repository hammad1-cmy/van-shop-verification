const state = {
  vans: [],
  currentVanId: null,
  shops: [],
  currentShopId: null,
  cameFromDashboard: false,
  dashboardShops: [],
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
  if (state.cameFromDashboard) {
    show('dashboardView');
    renderDashboard();
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
  for (const p of photos) {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    div.innerHTML = `<img src="${p.signed_url}" alt="shop photo" loading="lazy" /><button class="del" title="Delete photo">✕</button>`;
    div.querySelector('.del').onclick = async () => {
      try {
        await api(`/api/photos/${p.id}`, { method: 'DELETE' });
        toast('Photo deleted', 'ok');
        await loadShopDetail();
      } catch (err) {
        toast(err.message, 'err');
      }
    };
    grid.appendChild(div);
  }
}

el('#shopForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveState = el('#saveState');
  saveState.textContent = 'Saving...';
  saveState.className = 'save-state saving';
  const form = e.target;
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
    await api(`/api/shops/${state.currentShopId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    saveState.textContent = 'Saved ✓';
    saveState.className = 'save-state saved';
    toast('Shop data saved', 'ok');
  } catch (err) {
    saveState.textContent = 'Save failed — try again';
    saveState.className = 'save-state err';
    toast(err.message, 'err');
  }
});

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

document.querySelector('[data-action="upload-photos"]').addEventListener('click', async () => {
  const input = el('#photoInput');
  const files = input.files;
  if (!files || files.length === 0) return toast('Choose photo(s) first', 'err');
  if (files.length > 8) return toast('Max 8 photos at once', 'err');

  const fd = new FormData();
  for (const f of files) fd.append('photos', f);

  try {
    setStatus('Uploading...', '');
    await api(`/api/shops/${state.currentShopId}/photos`, { method: 'POST', body: fd });
    input.value = '';
    toast('Photo(s) uploaded', 'ok');
    await loadShopDetail();
  } catch (err) {
    toast(err.message, 'err');
  }
});

el('#backupNowBtn').addEventListener('click', async () => {
  try {
    window.open('/api/backup-download', '_blank');
    await api('/api/backup-now', { method: 'POST' });
    toast('Backup downloaded & synced', 'ok');
  } catch (err) {
    toast('Download started; sync backup failed: ' + err.message, 'err');
  }
});

el('#backupPhotosBtn').addEventListener('click', () => {
  toast('Building backup with photos, this can take a while...', '');
  window.open('/api/backup-download-photos', '_blank');
});

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
el('#dashboardSearch').addEventListener('input', renderDashboard);

// Warn before leaving with unsaved edits (best-effort)
window.addEventListener('beforeunload', (e) => {
  // Data is saved per-field-submit, so this is just a safety net during active typing
});

loadVans();
