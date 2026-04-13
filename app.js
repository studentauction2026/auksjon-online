/* ================================================================
   AuksjonOnline — app.js  (Gun.js sanntids-utgave)
   Arrangørkode: endre ORG_CODE nedenfor
================================================================ */

const ORG_CODE = 'subasta2026'; // ← Endre dette til din hemmelige kode

/* ================================================================
   GUN.JS — SANNTIDS P2P DATABASE  (ingen konto nødvendig)
================================================================ */
const gun = Gun([
  'https://gun-manhattan.herokuapp.com/gun',
  'https://peer.wallie.io/gun',
  'https://gundb-relay-mlc.glitch.me/gun',
]);
const APP_NS = 'auksjon-live-2026'; // ← endre for "privat" kanal
const db = gun.get(APP_NS);

/* ================================================================
   LOKAL TILSTAND (oppdateres automatisk av Gun-lyttere)
================================================================ */
let currentUser        = null;
let itemsMap           = new Map();  // itemId → item
let bidsMap            = new Map();  // bidId  → bid
let currentModalItemId = null;
let renderTimer        = null;
let modalRefreshTimer  = null;

/* ================================================================
   SANNTIDS-LYTTERE
================================================================ */
db.get('items').map().on((data, id) => {
  if (!data || data._del) {
    itemsMap.delete(id);
  } else {
    const item = {};
    Object.keys(data).forEach(k => { if (k !== '_') item[k] = data[k]; });
    item.id = id;
    itemsMap.set(id, item);
  }
  scheduleRender();
});

db.get('bids').map().on((data, id) => {
  if (!data || data._del) {
    bidsMap.delete(id);
  } else {
    const bid = {};
    Object.keys(data).forEach(k => { if (k !== '_') bid[k] = data[k]; });
    bid.id = id;
    bidsMap.set(id, bid);
  }
  scheduleRender();
  if (currentModalItemId) scheduleModalRefresh(currentModalItemId);
});

function scheduleRender() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (document.getElementById('screen-main').classList.contains('active')) renderItems();
  }, 80);
}
function scheduleModalRefresh(itemId) {
  if (modalRefreshTimer) clearTimeout(modalRefreshTimer);
  modalRefreshTimer = setTimeout(() => {
    if (currentModalItemId === itemId &&
        !document.getElementById('modal-item').classList.contains('hidden')) {
      openItemModal(itemId);
    }
  }, 80);
}

/* ================================================================
   TILKOBLINGSSTATUS
================================================================ */
function setConnStatus(state) {
  const bar  = document.getElementById('conn-bar');
  const text = document.getElementById('conn-text');
  if (!bar) return;
  bar.className = `conn-bar conn-${state}`;
  text.textContent = state === 'connected'
    ? 'Sanntids — alle er koblet til'
    : state === 'error'
    ? 'Frakoblet — prøver å koble til...'
    : 'Kobler til sanntidsdatabase...';
}
gun.on('hi',  () => setConnStatus('connected'));
gun.on('bye', () => setConnStatus('error'));

/* ================================================================
   SESSION  (localStorage — husker hvem som er logget inn på denne enheten)
   USERS    (Gun.js — delt mellom alle enheter)
================================================================ */
const Session = {
  get:   ()  => JSON.parse(localStorage.getItem('auction_session') || 'null'),
  set:   (v) => localStorage.setItem('auction_session', JSON.stringify(v)),
  clear: ()  => localStorage.removeItem('auction_session'),
};

// Konverterer email til sikker Gun-nøkkel (ingen punktum/kryllalfa)
function emailKey(email) { return email.replace(/[.@]/g, '_'); }

let usersMap = new Map(); // emailKey → user (lokal cache fra Gun)

db.get('users').map().on((data, key) => {
  if (!data || data._del) {
    usersMap.delete(key);
  } else {
    const u = {};
    Object.keys(data).forEach(k => { if (k !== '_') u[k] = data[k]; });
    usersMap.set(key, u);
  }
});

function findUser(email) { return usersMap.get(emailKey(email)) || null; }

/* ================================================================
   INITIALISERING
================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const session = Session.get();
  if (!session) { showAuth(); return; }

  // Gi Gun litt tid til å sende brukerdata før vi sjekker
  const tryRestore = (attempts) => {
    const user = findUser(session.email);
    if (user) { currentUser = user; showMain(); return; }
    if (attempts > 0) setTimeout(() => tryRestore(attempts - 1), 400);
    else showAuth(); // timeout — vis login
  };
  setTimeout(() => tryRestore(8), 300);
});

/* ================================================================
   SKJERMNAVIGASJON
================================================================ */
function showAuth() {
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('screen-main').classList.remove('active');
}

function showMain() {
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-main').classList.add('active');

  document.getElementById('nav-username').textContent =
    `${currentUser.isOrganizer ? '🎯 ' : '👤 '}${currentUser.name} (${currentUser.email})`;

  const toolbar = document.getElementById('organizer-toolbar');
  toolbar.classList.toggle('hidden', !currentUser.isOrganizer);

  renderItems();
}

/* ================================================================
   TABS AUTH
================================================================ */
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b, i) => {
    b.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
  clearErrors();
}

function toggleOrganizerCode() {
  const checked = document.getElementById('reg-is-organizer').checked;
  document.getElementById('organizer-code-group').classList.toggle('hidden', !checked);
  document.getElementById('organizer-label').textContent = checked ? 'Ja' : 'Nei';
}

/* ================================================================
   AUTH
================================================================ */
function login() {
  clearErrors();
  const email = document.getElementById('login-email').value.trim().toLowerCase();
  if (!email || !validEmail(email)) {
    showError('login-error', 'Skriv inn en gyldig e-postadresse.');
    return;
  }

  // Søk i lokal cache først, så Gun direkte
  const tryLogin = (user) => {
    if (!user) {
      showError('login-error', 'Det finnes ingen konto med den e-postadressen. Registrer deg først.');
      return;
    }
    currentUser = user;
    Session.set({ email: user.email });
    showMain();
    showToast(`Velkommen tilbake, ${user.name}!`, 'success');
  };

  const cached = findUser(email);
  if (cached) { tryLogin(cached); return; }

  // Ikke i cache ennå — spør Gun direkte
  showError('login-error', 'Søker...');
  db.get('users').get(emailKey(email)).once(data => {
    document.getElementById('login-error').classList.add('hidden');
    if (data && !data._del && data.email) tryLogin(data);
    else showError('login-error', 'Det finnes ingen konto med den e-postadressen. Registrer deg først.');
  });
}

function register() {
  clearErrors();
  const name    = document.getElementById('reg-name').value.trim();
  const email   = document.getElementById('reg-email').value.trim().toLowerCase();
  const isOrg   = document.getElementById('reg-is-organizer').checked;
  const orgCode = document.getElementById('reg-org-code').value.trim();

  if (!name)              { showError('reg-error', 'Navn er påkrevd.'); return; }
  if (!validEmail(email)) { showError('reg-error', 'Skriv inn en gyldig e-postadresse.'); return; }
  if (isOrg && orgCode !== ORG_CODE) { showError('reg-error', 'Feil arrangørkode.'); return; }

  const doRegister = () => {
    const newUser = { id: uid(), name, email, isOrganizer: isOrg ? true : false, createdAt: now() };
    db.get('users').get(emailKey(email)).put(newUser);
    currentUser = newUser;
    Session.set({ email });
    showMain();
    showToast(`Konto opprettet! Velkommen, ${name}!`, 'success');
  };

  // Sjekk om e-posten allerede er registrert
  if (findUser(email)) {
    showError('reg-error', 'Det finnes allerede en konto med den e-postadressen. Bruk Logg inn-fanen.');
    return;
  }
  showError('reg-error', 'Sjekker...');
  db.get('users').get(emailKey(email)).once(data => {
    document.getElementById('reg-error').classList.add('hidden');
    if (data && !data._del && data.email) {
      showError('reg-error', 'Det finnes allerede en konto med den e-postadressen. Bruk Logg inn-fanen.');
    } else {
      doRegister();
    }
  });
}

function logout() {
  Session.clear();
  currentUser = null;
  currentModalItemId = null;
  closeAllModals();
  document.getElementById('screen-main').classList.remove('active');
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('login-email').value = '';
  showToast('Logget ut', 'info');
}

/* ================================================================
   ITEMS — RENDERING
================================================================ */
function renderItems() {
  const status = document.getElementById('filter-status').value;
  const search = document.getElementById('filter-search').value.trim().toLowerCase();

  let items = [...itemsMap.values()];
  const bids = [...bidsMap.values()];

  let filtered = items.filter(item => {
    if (!item.title) return false;
    const ended = isEnded(item);
    if (status === 'active' && ended) return false;
    if (status === 'ended'  && !ended) return false;
    if (search && !item.title.toLowerCase().includes(search) &&
        !(item.description || '').toLowerCase().includes(search)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const aEnded = isEnded(a), bEnded = isEnded(b);
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    const aBids = bids.filter(bid => bid.itemId === a.id).length;
    const bBids = bids.filter(bid => bid.itemId === b.id).length;
    return bBids - aBids;
  });

  const grid    = document.getElementById('items-grid');
  const noItems = document.getElementById('no-items');
  grid.innerHTML = '';

  if (filtered.length === 0) {
    noItems.classList.remove('hidden');
    return;
  }
  noItems.classList.add('hidden');

  filtered.forEach(item => grid.appendChild(buildItemCard(item, bids)));
}

// Oppdater nedtellinger hvert 5. sekund
setInterval(() => {
  if (document.getElementById('screen-main').classList.contains('active')) renderItems();
}, 5000);

function buildItemCard(item, allBids) {
  const itemBids   = allBids.filter(b => b.itemId === item.id);
  const topBid     = getTopBid(itemBids);
  const price      = topBid ? topBid.amount : item.startPrice;
  const ended      = isEnded(item);

  const card = document.createElement('div');
  card.className = `item-card${ended ? ' ended' : ''}`;
  card.onclick   = () => openItemModal(item.id);

  // image
  const imgDiv = document.createElement('div');
  imgDiv.className = 'item-img';
  if (item.imageUrl) {
    const img = document.createElement('img');
    img.src = item.imageUrl;
    img.alt = item.title;
    img.onerror = () => { imgDiv.innerHTML = '🖼️'; };
    imgDiv.appendChild(img);
  } else {
    imgDiv.textContent = '🏷️';
  }

  // organizer actions
  if (currentUser && currentUser.isOrganizer) {
    const actions = document.createElement('div');
    actions.className = 'org-card-actions';
    actions.innerHTML = `
      <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); confirmDelete('${item.id}')">🗑</button>
    `;
    card.appendChild(actions);
  }

  // body
  const countdown = ended
    ? `<span class="item-countdown ended-badge">Avsluttet</span>`
    : buildCountdown(item.endAt);

  card.innerHTML += `<div class="item-body">
    <div class="item-title">${escHtml(item.title)}</div>
    <div class="item-desc">${escHtml(item.description) || '<em>Ingen beskrivelse</em>'}</div>
    <div class="item-price-row">
      <span class="item-current-price">${formatEur(price)}</span>
      <span class="item-bid-count">${itemBids.length} bud</span>
    </div>
    <div class="item-footer">
      ${countdown}
      <span style="font-size:0.78rem;color:var(--text-muted)">Av: ${escHtml(item.createdBy)}</span>
    </div>
  </div>`;

  card.insertBefore(imgDiv, card.firstChild);
  return card;
}

function buildCountdown(endAt) {
  const ms  = new Date(endAt) - new Date();
  if (ms <= 0) return `<span class="item-countdown ended-badge">Avsluttet</span>`;
  const str   = msToHuman(ms);
  const cls   = ms < 3600000 ? 'soon-badge' : ''; // < 1h
  return `<span class="item-countdown ${cls}">⏱ ${str}</span>`;
}

/* ================================================================
   MODAL — OBJEKT DETALJ
================================================================ */
function openItemModal(itemId) {
  const item = itemsMap.get(itemId);
  if (!item) return;
  currentModalItemId = itemId;

  const allBids  = [...bidsMap.values()];
  const itemBids = allBids.filter(b => b.itemId === itemId)
                          .sort((a, b) => b.amount - a.amount);
  const topBid   = itemBids[0];
  const price    = topBid ? topBid.amount : item.startPrice;
  const ended    = isEnded(item);
  const minNext  = price + (item.minIncrement || 1);

  let html = '';

  // IMAGE
  if (item.imageUrl) {
    html += `<div class="item-detail-img" style="padding:0"><img src="${escHtml(item.imageUrl)}" alt="${escHtml(item.title)}" onerror="this.parentElement.innerHTML='🖼️'"/></div>`;
  } else {
    html += `<div class="item-detail-img">🏷️</div>`;
  }

  html += `<div class="item-detail-title">${escHtml(item.title)}</div>`;
  if (item.description) {
    html += `<div class="item-detail-desc">${escHtml(item.description)}</div>`;
  }

  // STATS
  const ms = new Date(item.endAt) - new Date();
  const countdownStr = ended ? '—' : msToHuman(ms);
  html += `<div class="item-detail-stats">
    <div class="stat-box">
      <span class="stat-value">${formatEur(item.startPrice)}</span>
      <span class="stat-label">Startpris</span>
    </div>
    <div class="stat-box">
      <span class="stat-value">${formatEur(price)}</span>
      <span class="stat-label">Nåværende bud</span>
    </div>
    <div class="stat-box">
      <span class="stat-value warning">${ended ? 'Slutt' : countdownStr}</span>
      <span class="stat-label">${ended ? new Date(item.endAt).toLocaleDateString('nb-NO') : 'Gjenstående tid'}</span>
    </div>
  </div>`;

  // ENDED / WINNER
  if (ended) {
    if (topBid) {
      html += `<div class="winner-notice">🏆 Vinner: ${escHtml(topBid.userName)} (${escHtml(topBid.userEmail)}) med ${formatEur(topBid.amount)}</div>`;
    } else {
      html += `<div class="ended-notice">Auksjon avsluttet uten bud</div>`;
    }
  }

  // BID INPUT
  if (!ended) {
    html += `<div class="bid-section">
      <h4>Legg inn bud</h4>
      <div class="bid-input-row">
        <input type="number" id="bid-amount" min="${minNext}" step="0.01"
               placeholder="${formatEurNum(minNext)}"
               value="${formatEurNum(minNext)}"
               onkeydown="if(event.key==='Enter') placeBid('${itemId}')" />
        <button class="btn btn-success" onclick="placeBid('${itemId}')">By</button>
      </div>
      <div class="bid-hint">Minimumsbud: <strong>${formatEur(minNext)}</strong> (minimumsøkning: ${formatEur(item.minIncrement || 1)})</div>
      <div id="bid-error" class="error-msg hidden"></div>
    </div>`;
  }

  // BID HISTORY
  html += `<div class="bid-history"><h4>Budhistorikk (${itemBids.length})</h4><div class="bid-list">`;
  if (itemBids.length === 0) {
    html += `<div class="no-bids">Ingen bud ennå. Vær den første!</div>`;
  } else {
    itemBids.forEach((bid, idx) => {
      const isTop  = idx === 0;
      const isOwn  = bid.userEmail === currentUser.email;
      html += `<div class="bid-item${isTop ? ' top-bid' : ''}${isOwn ? ' own-bid' : ''}">
        <div>
          <div class="bid-user">${escHtml(bid.userName)}${isTop ? ' <span class="bid-crown">👑</span>' : ''}</div>
          <div class="bid-user-email">${escHtml(bid.userEmail)}</div>
        </div>
        <div style="text-align:right">
          <div class="bid-amount">${formatEur(bid.amount)}</div>
          <div class="bid-time">${formatDate(bid.createdAt)}</div>
        </div>
      </div>`;
    });
  }
  html += `</div></div>`;

  document.getElementById('modal-item-content').innerHTML = html;
  document.getElementById('modal-item').classList.remove('hidden');
}

/* ================================================================
   PUJA
================================================================ */
function placeBid(itemId) {
  const errEl = document.getElementById('bid-error');
  errEl.classList.add('hidden');

  const item = itemsMap.get(itemId);
  if (!item || isEnded(item)) {
    showBidError('Denne auksjonen er avsluttet.'); return;
  }

  const amount = parseFloat(document.getElementById('bid-amount').value);
  if (isNaN(amount) || amount <= 0) {
    showBidError('Skriv inn et gyldig beløp.'); return;
  }

  const itemBids     = [...bidsMap.values()].filter(b => b.itemId === itemId);
  const topBid       = getTopBid(itemBids);
  const currentPrice = topBid ? topBid.amount : item.startPrice;
  const minNext      = currentPrice + (item.minIncrement || 1);

  if (amount < minNext) {
    showBidError(`Minimumsbudet er ${formatEur(minNext)}.`); return;
  }
  if (topBid && topBid.userEmail === currentUser.email) {
    showBidError('Du er allerede høyeste budgiver!'); return;
  }

  const bidId = uid();
  db.get('bids').get(bidId).put({
    itemId,
    userEmail: currentUser.email,
    userName:  currentUser.name,
    amount,
    createdAt: now(),
  });

  showToast(`🎉 Bud på ${formatEur(amount)} registrert!`, 'success');
  // Modal auto-oppdateres via Gun-lytter
}

function showBidError(msg) {
  const el = document.getElementById('bid-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

/* ===== IMAGE UPLOAD HANDLING ===== */
let pendingImageData = null; // base64 data URL or null

function handleImageFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  loadImageFile(file);
}

function handleImageDrop(event) {
  event.preventDefault();
  document.getElementById('img-upload-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) {
    showToast('Kun bildefiler er tillatt', 'error'); return;
  }
  loadImageFile(file);
}

function loadImageFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    showToast('Bildet er for stort (maks 5 MB)', 'error'); return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImageData = e.target.result;
    document.getElementById('add-image-url').value = '';
    showImagePreview(pendingImageData, file.name);
  };
  reader.readAsDataURL(file);
}

function handleImageUrl(url) {
  if (!url) { clearImage(); return; }
  pendingImageData = null;
  showImagePreview(url, url);
  // reset file input
  document.getElementById('add-image-file').value = '';
}

function showImagePreview(src, name) {
  const zone        = document.getElementById('img-upload-zone');
  const placeholder = document.getElementById('img-upload-placeholder');
  const preview     = document.getElementById('img-preview');
  const actions     = document.getElementById('img-upload-actions');
  const fileName    = document.getElementById('img-file-name');

  preview.src = src;
  preview.classList.remove('hidden');
  placeholder.classList.add('hidden');
  zone.classList.add('has-image');
  actions.classList.remove('hidden');
  fileName.textContent = name.length > 40 ? name.slice(0, 37) + '...' : name;
}

function clearImage() {
  pendingImageData = null;
  document.getElementById('add-image-file').value = '';
  document.getElementById('add-image-url').value  = '';
  document.getElementById('img-preview').src = '';
  document.getElementById('img-preview').classList.add('hidden');
  document.getElementById('img-upload-placeholder').classList.remove('hidden');
  document.getElementById('img-upload-zone').classList.remove('has-image');
  document.getElementById('img-upload-actions').classList.add('hidden');
  document.getElementById('img-file-name').textContent = '';
}

/* ===== MODAL — AÑADIR OBJETO (ORGANIZADOR) ===== */
function openAddItemModal() {
  document.getElementById('add-title').value         = '';
  document.getElementById('add-desc').value          = '';
  document.getElementById('add-start-price').value   = '';
  document.getElementById('add-min-increment').value = '1';
  document.getElementById('add-image-url').value     = '';
  document.getElementById('add-error').classList.add('hidden');
  clearImage();

  // Set default end date/time to tomorrow 20:00
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  document.getElementById('add-end-date').value = tomorrow.toISOString().split('T')[0];
  document.getElementById('add-end-time').value = '20:00';

  document.getElementById('modal-add').classList.remove('hidden');
  setTimeout(() => document.getElementById('add-title').focus(), 100);
}

function addItem() {
  const errEl = document.getElementById('add-error');
  errEl.classList.add('hidden');

  const title      = document.getElementById('add-title').value.trim();
  const desc       = document.getElementById('add-desc').value.trim();
  const startPrice = parseFloat(document.getElementById('add-start-price').value);
  const minInc     = parseFloat(document.getElementById('add-min-increment').value) || 1;
  const endDate    = document.getElementById('add-end-date').value;
  const endTime    = document.getElementById('add-end-time').value;
  const imageUrl   = pendingImageData || document.getElementById('add-image-url').value.trim();

  if (!title)              { showError('add-error', 'Tittel er påkrevd.'); return; }
  if (isNaN(startPrice) || startPrice < 0) {
    showError('add-error', 'Skriv inn en gyldig startpris.'); return;
  }
  if (!endDate || !endTime) {
    showError('add-error', 'Angi sluttdato og -tid.'); return;
  }

  const endAt = new Date(`${endDate}T${endTime}:00`);
  if (endAt <= new Date()) {
    showError('add-error', 'Sluttdatoen må være i fremtiden.'); return;
  }

  const itemId = uid();
  db.get('items').get(itemId).put({
    title,
    description:    desc,
    startPrice,
    minIncrement:   minInc,
    endAt:          endAt.toISOString(),
    imageUrl:       imageUrl || '',
    createdBy:      currentUser.name,
    createdByEmail: currentUser.email,
    createdAt:      now(),
  });

  closeModal('modal-add');
  showToast(`✅ "${title}" lagt ut i auksjonen`, 'success');
}

/* ================================================================
   ELIMINAR OBJETO
================================================================ */
function confirmDelete(itemId) {
  document.getElementById('modal-confirm').classList.remove('hidden');
  document.getElementById('confirm-delete-btn').onclick = () => deleteItem(itemId);
}

function deleteItem(itemId) {
  // Gun støtter ikke ekte sletting – sett _del-flagg
  db.get('items').get(itemId).put({ _del: true });
  [...bidsMap.values()]
    .filter(b => b.itemId === itemId)
    .forEach(b => db.get('bids').get(b.id).put({ _del: true }));
  closeModal('modal-confirm');
  showToast('Objekt slettet', 'info');
}

/* ================================================================
   MODALES — HELPERS
================================================================ */
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  if (id === 'modal-item') currentModalItemId = null;
}
function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  currentModalItemId = null;
}
function closeModalOnOverlay(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

/* ================================================================
   TOAST
================================================================ */
let toastTimeout = null;
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type}`;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 3500);
}

/* ================================================================
   UTILS — ERRORES EN FORMULARIOS
================================================================ */
function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}
function clearErrors() {
  ['login-error', 'reg-error', 'add-error', 'bid-error']
    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.add('hidden'); });
}

/* ================================================================
   UTILS — GENERALES
================================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function now() { return new Date().toISOString(); }
function isEnded(item) { return new Date(item.endAt) <= new Date(); }
function getTopBid(bids) {
  if (!bids.length) return null;
  return bids.reduce((top, b) => b.amount > top.amount ? b : top, bids[0]);
}
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function formatEur(n) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'EUR' }).format(n);
}
function formatEurNum(n) { return n.toFixed(2); }
function formatDate(iso) {
  return new Date(iso).toLocaleString('nb-NO', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}
function msToHuman(ms) {
  if (ms <= 0) return 'Avsluttet';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}t`;
  if (h > 0) return `${h}t ${m}m`;
  return `${m}m`;
}
