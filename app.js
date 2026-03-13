'use strict';

/* ============================================================================
  Inventario Musicala — Frontend app.js (v3 con login)
  - Login con Apps Script + hoja Usuarios
  - Sesión local simple
  - Muestra ítems aunque no tengan stock registrado
  - Permite crear / editar ítems usando upsertItem
  - Mejor feedback, filtros y render
============================================================================ */

/* =========================
   CONFIG
========================= */
const WEBAPP_URL = 'https://script.google.com/macros/s/AKfycby4HIeBwDlnQ5ia9VBFBBhnB9pabR8Dv36i3nc-FzhHKH_imEXSi0hogN-N28_L2TYw/exec';
const TOKEN = 'MUSICALA-SECRET-2026';

/* =========================
   DOM HELPERS
========================= */
const $ = (q, root = document) => root.querySelector(q);
const $$ = (q, root = document) => Array.from(root.querySelectorAll(q));

const el = {
  // login
  loginScreen: $('#loginScreen'),
  loginForm: $('#loginForm'),
  loginUser: $('#loginUser'),
  loginPassword: $('#loginPassword'),
  loginError: $('#loginError'),
  loginBtn: $('#loginBtn'),
  loginStatusText: $('#loginStatusText'),

  // app shell
  appShell: $('#appShell'),
  sessionUserName: $('#sessionUserName'),
  sessionUserRole: $('#sessionUserRole'),
  logoutBtn: $('#logoutBtn'),

  // top
  logoTrigger: $('#logoTrigger'),
  searchInput: $('#searchInput'),
  topbar: $('.topbar'),
  container: $('.container'),

  // filters
  filterLocation: $('#filterLocation'),
  filterCategory: $('#filterCategory'),
  filterStatus: $('#filterStatus'),

  // list
  inventoryList: $('#inventoryList'),

  // item modal
  itemModal: $('#itemModal'),
  itemTitle: $('#itemTitle'),
  itemInfo: $('#itemInfo'),
  btnMovement: $('#btnMovement'),
  btnHistory: $('#btnHistory'),

  // movement modal
  movementModal: $('#movementModal'),
  movementAction: $('#movementAction'),
  movementQty: $('#movementQty'),
  movementOrigin: $('#movementOrigin'),
  movementDest: $('#movementDest'),
  movementReason: $('#movementReason'),
  saveMovement: $('#saveMovement'),

  // history modal
  historyModal: $('#historyModal'),
  historyList: $('#historyList'),

  // admin
  adminPanel: $('#adminPanel'),
  btnArchiveItem: $('#btnArchiveItem'),
  btnChangeRole: $('#btnChangeRole'),
};

/* =========================
   STATE
========================= */
const state = {
  ready: false,
  loading: false,
  booted: false,
  who: null, // {user,name,role,active}
  categories: [],
  locations: [],
  itemsById: {},
  stock: [],
  viewRows: [],
  current: {
    item_id: null,
    item: null,
    stockRows: [],
  },
  filters: {
    q: '',
    location_id: '',
    category: '',
    status: '',
  },
  ui: {
    adminUnlocked: false,
  }
};

/* =========================
   STORAGE
========================= */
const LS = {
  session: 'musicala_inv_session',
  lastLocation: 'musicala_inv_last_location',
  lastCategory: 'musicala_inv_last_category',
  lastStatus: 'musicala_inv_last_status',
};

/* =========================
   API
========================= */
function apiUrl_(params) {
  const u = new URL(WEBAPP_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function parseApiResponse_(res) {
  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error('RESPUESTA_INVALIDA_DEL_BACKEND');
  }

  if (!data || !data.ok) {
    throw new Error(data?.error || 'API_ERROR');
  }

  return data;
}

async function apiGet_(action, params = {}) {
  const url = apiUrl_({
    action,
    token: TOKEN,
    user: state.who?.user || getSession_()?.user || '',
    ...params,
  });

  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store'
  });

  return parseApiResponse_(res);
}

async function apiPost_(action, payloadObj = {}, params = {}) {
  const body = new URLSearchParams();
  body.set('action', action);
  body.set('token', TOKEN);

  const sessionUser = state.who?.user || getSession_()?.user || '';
  if (sessionUser) body.set('user', sessionUser);

  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    body.set(k, String(v));
  });

  body.set('payload', JSON.stringify(payloadObj || {}));

  const res = await fetch(WEBAPP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
    },
    body,
  });

  return parseApiResponse_(res);
}

async function apiLogin_(user, password) {
  const url = apiUrl_({
    action: 'login',
    token: TOKEN,
    user: user,
    password: password,
  });

  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store'
  });

  return parseApiResponse_(res);
}

/* =========================
   SESSION / AUTH
========================= */
function getSession_() {
  try {
    const raw = localStorage.getItem(LS.session);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.user) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveSession_(who) {
  if (!who || !who.user) return;
  localStorage.setItem(LS.session, JSON.stringify({
    user: who.user,
    name: who.name || who.user,
    role: String(who.role || 'USER').toUpperCase(),
    active: who.active !== false,
  }));
}

function clearSession_() {
  localStorage.removeItem(LS.session);
}

function isLoggedIn_() {
  return !!getSession_();
}

function applySessionToState_() {
  const session = getSession_();
  if (!session) {
    state.who = null;
    return;
  }
  state.who = {
    user: session.user,
    name: session.name || session.user,
    role: String(session.role || 'USER').toUpperCase(),
    active: session.active !== false,
  };
}

function showLoginScreen_(show) {
  if (el.loginScreen) el.loginScreen.hidden = !show;
  if (el.appShell) el.appShell.hidden = !!show;
}

function setLoginError_(msg = '') {
  if (!el.loginError) return;
  if (!msg) {
    el.loginError.hidden = true;
    el.loginError.textContent = '';
    return;
  }
  el.loginError.hidden = false;
  el.loginError.textContent = msg;
}

function setLoginLoading_(loading, text) {
  if (!el.loginBtn) return;
  el.loginBtn.disabled = !!loading;
  el.loginBtn.textContent = loading ? (text || 'Ingresando...') : 'Ingresar';
}

function updateSessionUI_() {
  if (!state.who) return;
  if (el.sessionUserName) {
    el.sessionUserName.textContent = state.who.name || state.who.user || 'Usuario';
  }
  if (el.sessionUserRole) {
    el.sessionUserRole.textContent = String(state.who.role || 'USER').toUpperCase();
  }
}

async function validateStoredSession_() {
  const session = getSession_();
  if (!session?.user) return false;

  try {
    const data = await apiGet_('me', { user: session.user });
    if (!data?.who?.user) throw new Error('INVALID_SESSION');

    saveSession_(data.who);
    state.who = data.who;
    return true;
  } catch (err) {
    clearSession_();
    state.who = null;
    return false;
  }
}

async function submitLogin_(ev) {
  ev?.preventDefault?.();
  setLoginError_('');

  const user = safeTrim_(el.loginUser?.value);
  const password = String(el.loginPassword?.value || '');

  if (!user) {
    setLoginError_('Escribe tu usuario.');
    el.loginUser?.focus();
    return;
  }

  if (!password) {
    setLoginError_('Escribe tu contraseña.');
    el.loginPassword?.focus();
    return;
  }

  setLoginLoading_(true, 'Ingresando...');

  try {
    const data = await apiLogin_(user, password);
    const who = data.who;

    if (!who?.user) {
      throw new Error('LOGIN_INVALID_RESPONSE');
    }

    saveSession_(who);
    state.who = who;

    if (el.loginPassword) el.loginPassword.value = '';
    setLoginError_('');
    showLoginScreen_(false);
    updateSessionUI_();

    await bootApp_();

    toast_(`Hola, ${who.name || who.user} 👋`);
  } catch (err) {
    console.error(err);
    const msg = mapLoginError_(String(err.message || err));
    setLoginError_(msg);
  } finally {
    setLoginLoading_(false);
  }
}

function logout_() {
  clearSession_();
  state.ready = false;
  state.booted = false;
  state.who = null;
  state.itemsById = {};
  state.stock = [];
  state.viewRows = [];
  state.current = { item_id: null, item: null, stockRows: [] };
  state.ui.adminUnlocked = false;

  if (el.adminPanel) el.adminPanel.style.display = 'none';
  if (el.inventoryList) el.inventoryList.innerHTML = '';

  if (el.searchInput) el.searchInput.value = '';
  if (el.loginPassword) el.loginPassword.value = '';
  if (el.loginUser) el.loginUser.focus();

  showLoginScreen_(true);
  setLoginError_('');
}

function mapLoginError_(code) {
  switch (code) {
    case 'LOGIN_USER_NOT_FOUND':
      return 'Ese usuario no existe.';
    case 'LOGIN_INVALID_PASSWORD':
      return 'La contraseña no es correcta.';
    case 'LOGIN_USER_INACTIVE':
    case 'USER_INACTIVE':
      return 'Este usuario está inactivo.';
    case 'MISSING_user':
      return 'Falta el usuario.';
    case 'MISSING_password':
      return 'Falta la contraseña.';
    case 'UNAUTHORIZED':
      return 'Token inválido o backend no autorizado.';
    default:
      return 'No se pudo iniciar sesión.';
  }
}

/* =========================
   UI UTILITIES
========================= */
function openModal(id) {
  const node = document.getElementById(id);
  if (node) node.classList.add('active');
}

function closeModal(id) {
  const node = document.getElementById(id);
  if (node) node.classList.remove('active');
}

window.app = { closeModal };

function esc_(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeTrim_(v) {
  return String(v ?? '').trim();
}

function fmtQty_(n) {
  const x = Number(n || 0);
  if (!isFinite(x)) return '0';
  if (Number.isInteger(x)) return String(x);
  return x.toFixed(2).replace(/\.00$/, '');
}

function badgeClass_(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'ACTIVO') return 'badge ACTIVO';
  if (s === 'MANTENIMIENTO') return 'badge MANTENIMIENTO';
  if (s === 'DAÑADO') return 'badge DAÑADO';
  if (s === 'ARCHIVADO') return 'badge';
  return 'badge';
}

function humanAction_(acc) {
  const a = String(acc || '').toUpperCase();
  if (a === 'ADD') return 'Agregar';
  if (a === 'REMOVE') return 'Retirar';
  if (a === 'MOVE') return 'Mover';
  if (a === 'AJUSTE') return 'Ajuste';
  if (a === 'MANTENIMIENTO') return 'Mantenimiento';
  if (a === 'BAJA') return 'Baja';
  if (a === 'ARCHIVE') return 'Archivo';
  return a || 'Movimiento';
}

function formatDateTime_(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(d);
  } catch (_) {
    return String(iso);
  }
}

function byText_(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'es', { sensitivity: 'base' });
}

function debounce_(fn, ms = 180) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/* =========================
   DYNAMIC UI INJECTION
========================= */
function injectEnhancedUI_() {
  injectToolbar_();
  injectSummaryBar_();
  injectEditButtonInItemModal_();
  injectItemEditorModal_();
  decorateMovementForm_();
  decorateAdminPanel_();
}

function injectToolbar_() {
  if ($('#inventoryToolbar')) return;

  const toolbar = document.createElement('section');
  toolbar.id = 'inventoryToolbar';
  toolbar.className = 'card';
  toolbar.style.marginBottom = '14px';
  toolbar.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
      <div>
        <h3 style="margin:0; font-size:18px;">Panel de inventario</h3>
        <small id="inventoryToolbarSub" style="color:#6b7280;">Cargando datos...</small>
      </div>

      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button id="btnReloadData" type="button">Recargar</button>
        <button id="btnNewItem" type="button">Nuevo ítem</button>
      </div>
    </div>
  `;

  el.container?.insertBefore(toolbar, el.container.firstElementChild || null);

  el.btnReloadData = $('#btnReloadData');
  el.btnNewItem = $('#btnNewItem');
  el.inventoryToolbarSub = $('#inventoryToolbarSub');
}

function injectSummaryBar_() {
  if ($('#inventorySummaryBar')) return;

  const summary = document.createElement('section');
  summary.id = 'inventorySummaryBar';
  summary.style.display = 'grid';
  summary.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
  summary.style.gap = '10px';
  summary.style.marginBottom = '14px';

  summary.innerHTML = `
    <div class="card">
      <small style="color:#6b7280;">Ítems</small>
      <h3 id="sumItems" style="margin-top:6px;">0</h3>
    </div>
    <div class="card">
      <small style="color:#6b7280;">Con stock</small>
      <h3 id="sumWithStock" style="margin-top:6px;">0</h3>
    </div>
    <div class="card">
      <small style="color:#6b7280;">Unidades totales</small>
      <h3 id="sumUnits" style="margin-top:6px;">0</h3>
    </div>
    <div class="card">
      <small style="color:#6b7280;">Ubicaciones</small>
      <h3 id="sumLocations" style="margin-top:6px;">0</h3>
    </div>
  `;

  const toolbar = $('#inventoryToolbar');
  if (toolbar && toolbar.parentNode) {
    toolbar.parentNode.insertBefore(summary, toolbar.nextSibling);
  } else {
    el.container?.insertBefore(summary, el.inventoryList);
  }

  el.sumItems = $('#sumItems');
  el.sumWithStock = $('#sumWithStock');
  el.sumUnits = $('#sumUnits');
  el.sumLocations = $('#sumLocations');
}

function injectEditButtonInItemModal_() {
  if ($('#btnEditItem')) return;
  if (!el.btnHistory || !el.btnMovement) return;

  const btn = document.createElement('button');
  btn.id = 'btnEditItem';
  btn.type = 'button';
  btn.className = 'secondary';
  btn.textContent = 'Editar ítem';

  el.btnHistory.parentElement?.appendChild(btn);
  el.btnEditItem = btn;
}

function injectItemEditorModal_() {
  if ($('#itemEditorModal')) return;

  const modal = document.createElement('div');
  modal.id = 'itemEditorModal';
  modal.className = 'modal';

  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <h2 id="itemEditorTitle">Nuevo ítem</h2>
          <small>Completa la ficha del elemento</small>
        </div>
        <button class="icon-close secondary" type="button" onclick="app.closeModal('itemEditorModal')" aria-label="Cerrar editor">✕</button>
      </div>

      <label>Nombre</label>
      <input id="itemFormNombre" type="text" placeholder="Ej: Guitarra acústica Yamaha">

      <label>Categoría</label>
      <input id="itemFormCategoria" type="text" placeholder="Ej: Cuerdas">

      <label>Unidad</label>
      <input id="itemFormUnidad" type="text" placeholder="Ej: unidad">

      <label>Estado</label>
      <select id="itemFormEstado">
        <option value="ACTIVO">ACTIVO</option>
        <option value="MANTENIMIENTO">MANTENIMIENTO</option>
        <option value="DAÑADO">DAÑADO</option>
        <option value="ARCHIVADO">ARCHIVADO</option>
      </select>

      <label>Valor</label>
      <input id="itemFormValor" type="number" min="0" step="any" placeholder="0">

      <label>Vida útil (años)</label>
      <input id="itemFormVida" type="number" min="0" step="1" placeholder="">

      <label>Descripción</label>
      <textarea id="itemFormDescripcion" placeholder="Detalles del instrumento, estado físico, referencias, observaciones..."></textarea>

      <label>Links de fotos</label>
      <textarea id="itemFormFotos" placeholder="https://..."></textarea>

      <div id="itemFormQuickStockWrap" style="margin-top:12px; padding:10px; border:1px solid #e5e7eb; border-radius:10px;">
        <strong style="display:block; margin-bottom:8px;">Stock inicial opcional</strong>

        <label>Ubicación inicial</label>
        <input id="itemFormInitLocation" type="text" placeholder="Ej: Salón 1">

        <label>Cantidad inicial</label>
        <input id="itemFormInitQty" type="number" min="0" step="1" placeholder="0">

        <small style="display:block; color:#6b7280; margin-top:6px;">
          Solo se usará al crear un nuevo ítem o si deseas cargar existencia inicial manualmente.
        </small>
      </div>

      <div class="modal-actions">
        <button id="saveItemBtn" type="button">Guardar ítem</button>
        <button class="secondary" type="button" onclick="app.closeModal('itemEditorModal')">Cancelar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  el.itemEditorModal = $('#itemEditorModal');
  el.itemEditorTitle = $('#itemEditorTitle');
  el.itemFormNombre = $('#itemFormNombre');
  el.itemFormCategoria = $('#itemFormCategoria');
  el.itemFormUnidad = $('#itemFormUnidad');
  el.itemFormEstado = $('#itemFormEstado');
  el.itemFormValor = $('#itemFormValor');
  el.itemFormVida = $('#itemFormVida');
  el.itemFormDescripcion = $('#itemFormDescripcion');
  el.itemFormFotos = $('#itemFormFotos');
  el.itemFormInitLocation = $('#itemFormInitLocation');
  el.itemFormInitQty = $('#itemFormInitQty');
  el.saveItemBtn = $('#saveItemBtn');

  el.itemEditorModal.addEventListener('click', (ev) => {
    if (ev.target === el.itemEditorModal) closeModal('itemEditorModal');
  });
}

function decorateMovementForm_() {
  if (!el.movementOrigin || $('#movementLocationsHint')) return;

  const hint = document.createElement('small');
  hint.id = 'movementLocationsHint';
  hint.style.display = 'block';
  hint.style.color = '#6b7280';
  hint.style.marginTop = '6px';
  hint.textContent = 'Puedes escribir cualquier ubicación. Si ya existe, intenta usar el mismo nombre exacto.';
  el.movementReason?.insertAdjacentElement('afterend', hint);
}

function decorateAdminPanel_() {
  if (!el.adminPanel) return;

  el.adminPanel.style.display = 'none';

  if (!$('#adminPanelExtraActions')) {
    const wrap = document.createElement('div');
    wrap.id = 'adminPanelExtraActions';
    wrap.style.display = 'flex';
    wrap.style.gap = '8px';
    wrap.style.flexWrap = 'wrap';
    wrap.style.marginTop = '10px';

    wrap.innerHTML = `
      <button id="btnAdminNewItem" type="button">Nuevo ítem</button>
      <button id="btnAdminRefresh" type="button" class="secondary">Recargar datos</button>
    `;

    el.adminPanel.appendChild(wrap);
    el.btnAdminNewItem = $('#btnAdminNewItem');
    el.btnAdminRefresh = $('#btnAdminRefresh');
  }
}

/* =========================
   RENDER HELPERS
========================= */
function setToolbarSubtitle_() {
  if (!el.inventoryToolbarSub) return;
  const role = String(state.who?.role || 'USER').toUpperCase();
  const user = state.who?.name || state.who?.user || 'Usuario';
  el.inventoryToolbarSub.textContent = `Usuario: ${user} · Rol: ${role}`;
}

function updateSummary_() {
  const itemRows = Object.values(state.itemsById);
  const totalItems = itemRows.length;
  const withStock = itemRows.filter(item => getTotalQtyForItem_(item.item_id) > 0).length;
  const totalUnits = state.stock.reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);
  const totalLocations = state.locations.length;

  if (el.sumItems) el.sumItems.textContent = fmtQty_(totalItems);
  if (el.sumWithStock) el.sumWithStock.textContent = fmtQty_(withStock);
  if (el.sumUnits) el.sumUnits.textContent = fmtQty_(totalUnits);
  if (el.sumLocations) el.sumLocations.textContent = fmtQty_(totalLocations);
}

function getTotalQtyForItem_(item_id) {
  return state.stock
    .filter(r => r.item_id === item_id)
    .reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);
}

function buildViewRows_() {
  const items = Object.values(state.itemsById);
  state.viewRows = items.map(item => {
    const itemStockRows = stockRowsForItem_(item.item_id);
    const totalQty = itemStockRows.reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);
    const locations = itemStockRows.map(r => safeTrim_(r.location_id)).filter(Boolean).sort(byText_);
    const mainLocation = locations[0] || '';
    const locationCount = locations.length;

    return {
      item_id: item.item_id,
      nombre: item.nombre || '(sin nombre)',
      categoria: item.categoria || 'General',
      estado: String(item.estado || 'ACTIVO').toUpperCase(),
      descripcion: item.descripcion || '',
      unidad: item.unidad || '',
      valor: item.valor ?? '',
      fotos_links: item.fotos_links || '',
      totalQty,
      locationCount,
      mainLocation,
      locations,
      stockRows: itemStockRows.slice().sort((a, b) => byText_(a.location_id, b.location_id)),
    };
  });
}

function renderFilters_() {
  if (!el.filterLocation || !el.filterCategory || !el.filterStatus) return;

  const keepLoc = state.filters.location_id || localStorage.getItem(LS.lastLocation) || '';
  const keepCat = state.filters.category || localStorage.getItem(LS.lastCategory) || '';
  const keepStatus = state.filters.status || localStorage.getItem(LS.lastStatus) || '';

  el.filterLocation.innerHTML =
    `<option value="">Todas las ubicaciones</option>` +
    state.locations.map(l => `<option value="${esc_(l)}">${esc_(l)}</option>`).join('');

  el.filterCategory.innerHTML =
    `<option value="">Todas las categorías</option>` +
    state.categories.map(c => `<option value="${esc_(c)}">${esc_(c)}</option>`).join('');

  el.filterLocation.value = keepLoc;
  el.filterCategory.value = keepCat;
  el.filterStatus.value = keepStatus;

  state.filters.location_id = keepLoc;
  state.filters.category = keepCat;
  state.filters.status = keepStatus;
}

function applyFilters_() {
  const q = safeTrim_(state.filters.q).toLowerCase();
  const loc = safeTrim_(state.filters.location_id).toLowerCase();
  const cat = safeTrim_(state.filters.category).toLowerCase();
  const st = safeTrim_(state.filters.status).toLowerCase();

  let rows = state.viewRows.slice();

  if (loc) {
    rows = rows.filter(r =>
      r.stockRows.some(sr => safeTrim_(sr.location_id).toLowerCase() === loc)
    );
  }

  if (cat) {
    rows = rows.filter(r => safeTrim_(r.categoria).toLowerCase() === cat);
  }

  if (st) {
    rows = rows.filter(r => safeTrim_(r.estado).toLowerCase() === st);
  }

  if (q) {
    rows = rows.filter(r => {
      const blob = [
        r.item_id,
        r.nombre,
        r.categoria,
        r.estado,
        r.descripcion,
        r.unidad,
        ...r.locations,
      ].join(' ').toLowerCase();

      return blob.includes(q);
    });
  }

  rows.sort((a, b) => {
    const aq = Number(a.totalQty || 0);
    const bq = Number(b.totalQty || 0);
    if (bq !== aq) return bq - aq;
    return byText_(a.nombre, b.nombre);
  });

  return rows;
}

function renderStockList_() {
  const rows = applyFilters_();

  if (!rows.length) {
    const hasItems = Object.keys(state.itemsById).length > 0;
    el.inventoryList.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        <h3 style="margin:0 0 8px 0;">${hasItems ? 'No hay resultados con esos filtros' : 'No hay ítems para mostrar'}</h3>
        <small style="display:block; color:#6b7280; margin-bottom:10px;">
          ${
            hasItems
              ? 'Prueba cambiando la búsqueda, la ubicación, la categoría o el estado.'
              : 'Todavía no hay registros cargados en el inventario. Puedes crear el primer ítem.'
          }
        </small>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" id="emptyNewItemBtn">Nuevo ítem</button>
          <button type="button" id="emptyReloadBtn" class="secondary">Recargar</button>
        </div>
      </div>
    `;

    $('#emptyNewItemBtn')?.addEventListener('click', () => openItemEditor_(null));
    $('#emptyReloadBtn')?.addEventListener('click', () => refreshAllData_());
    return;
  }

  el.inventoryList.innerHTML = rows.map(r => {
    const name = esc_(r.nombre || '(sin nombre)');
    const cat = esc_(r.categoria || '');
    const status = String(r.estado || 'ACTIVO').toUpperCase();
    const qty = fmtQty_(r.totalQty);
    const locText = r.locationCount
      ? (r.locationCount === 1 ? r.mainLocation : `${r.locationCount} ubicaciones`)
      : 'Sin ubicación';
    const isZero = Number(r.totalQty || 0) <= 0;

    return `
      <div class="card inventory-card" data-item-id="${esc_(r.item_id)}" style="cursor:pointer;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="min-width:0;">
            <h3 style="margin:0 0 6px 0;">${name}</h3>
            <small style="display:block; color:#6b7280;">${esc_(cat)}</small>
          </div>
          <span class="${badgeClass_(status)}">${esc_(status)}</span>
        </div>

        <div style="margin-top:14px; display:flex; justify-content:space-between; align-items:flex-end; gap:10px;">
          <div>
            <small style="display:block; color:#6b7280;">Cantidad total</small>
            <strong style="font-size:20px;">${esc_(qty)}</strong>
          </div>
          <div style="text-align:right;">
            <small style="display:block; color:#6b7280;">Ubicación</small>
            <strong style="font-size:13px; color:${isZero ? '#9ca3af' : '#111827'};">${esc_(locText)}</strong>
          </div>
        </div>

        <small style="display:block; margin-top:10px; color:#6b7280;">
          ID: ${esc_(r.item_id)}
        </small>
      </div>
    `;
  }).join('');
}

function renderItemModal_(item, stockRows) {
  if (!item) return;

  el.itemTitle.textContent = item.nombre || 'Ítem';

  const estado = String(item.estado || 'ACTIVO').toUpperCase();
  const totalQty = stockRows.reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);

  const topInfo = `
    <div style="display:grid; gap:8px;">
      <div><strong>ID:</strong> ${esc_(item.item_id)}</div>
      <div><strong>Categoría:</strong> ${esc_(item.categoria || 'General')}</div>
      <div><strong>Estado:</strong> <span class="${badgeClass_(estado)}">${esc_(estado)}</span></div>
      <div><strong>Cantidad total:</strong> ${esc_(fmtQty_(totalQty))}</div>
      ${item.unidad ? `<div><strong>Unidad:</strong> ${esc_(item.unidad)}</div>` : ''}
      ${item.valor !== '' && item.valor !== null && item.valor !== undefined ? `<div><strong>Valor:</strong> ${esc_(item.valor)}</div>` : ''}
      ${item.vida_util_anios !== '' && item.vida_util_anios !== null && item.vida_util_anios !== undefined ? `<div><strong>Vida útil:</strong> ${esc_(item.vida_util_anios)} años</div>` : ''}
      ${item.descripcion ? `<div style="margin-top:4px;"><strong>Descripción:</strong><br>${esc_(item.descripcion)}</div>` : ''}
      ${item.fotos_links ? `<div style="margin-top:4px;"><strong>Fotos:</strong><br><a href="${esc_(item.fotos_links)}" target="_blank" rel="noopener">Abrir enlace</a></div>` : ''}
    </div>
  `;

  const rows = (stockRows || []).slice().sort((a, b) => byText_(a.location_id, b.location_id));

  const stockHtml = rows.length
    ? `
      <div style="margin-top:14px;">
        <strong>Stock por ubicación</strong>
        <div style="margin-top:8px; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
          ${rows.map((sr, idx) => `
            <div style="display:flex; justify-content:space-between; padding:10px 12px; ${idx < rows.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}">
              <span>${esc_(sr.location_id || 'Sin ubicación')}</span>
              <strong>${esc_(fmtQty_(sr.cantidad_actual))}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    `
    : `
      <div style="margin-top:14px; color:#6b7280;">
        Este ítem existe, pero todavía no tiene stock registrado por ubicación.
      </div>
    `;

  el.itemInfo.innerHTML = topInfo + stockHtml;

  if (el.btnEditItem) {
    const isAdmin = isAdmin_();
    el.btnEditItem.style.display = isAdmin ? '' : 'none';
  }
}

/* =========================
   DATA LOADERS
========================= */
async function loadBootstrap_() {
  const data = await apiGet_('bootstrap');
  state.who = data.who || state.who;
  state.categories = Array.isArray(data.categories) ? data.categories.slice().sort(byText_) : [];
  state.locations = Array.isArray(data.locations) ? data.locations.slice().sort(byText_) : [];
  updateSessionUI_();
}

async function loadItems_() {
  const data = await apiGet_('listItems', { limit: 1500 });
  const items = Array.isArray(data.items) ? data.items : [];

  state.itemsById = {};
  for (const item of items) {
    if (!item?.item_id) continue;
    state.itemsById[item.item_id] = {
      item_id: item.item_id,
      nombre: item.nombre || '',
      categoria: item.categoria || 'General',
      descripcion: item.descripcion || '',
      unidad: item.unidad || '',
      valor: item.valor ?? '',
      vida_util_anios: item.vida_util_anios ?? '',
      estado: String(item.estado || 'ACTIVO').toUpperCase(),
      fotos_links: item.fotos_links || '',
    };
  }
}

async function loadStock_() {
  const data = await apiGet_('listStock', { limit: 2500 });
  const rows = Array.isArray(data.stock) ? data.stock : [];

  state.stock = rows.map(r => ({
    item_id: safeTrim_(r.item_id),
    location_id: safeTrim_(r.location_id),
    cantidad_actual: Number(r.cantidad_actual || 0),
    nombre: safeTrim_(r.nombre),
    categoria: safeTrim_(r.categoria),
    estado: String(r.estado || 'ACTIVO').toUpperCase(),
  }));

  for (const r of state.stock) {
    if (!r.item_id) continue;

    if (!state.itemsById[r.item_id]) {
      state.itemsById[r.item_id] = {
        item_id: r.item_id,
        nombre: r.nombre || '(sin nombre)',
        categoria: r.categoria || 'General',
        descripcion: '',
        unidad: '',
        valor: '',
        vida_util_anios: '',
        estado: r.estado || 'ACTIVO',
        fotos_links: '',
      };
    }
  }
}

async function loadItem_(item_id) {
  const data = await apiGet_('getItem', { item_id });
  return data.item;
}

function stockRowsForItem_(item_id) {
  return state.stock.filter(r => r.item_id === item_id);
}

function rebuildCatalogsFromData_() {
  const catSet = new Set(state.categories || []);
  const locSet = new Set(state.locations || []);

  Object.values(state.itemsById).forEach(item => {
    if (safeTrim_(item.categoria)) catSet.add(item.categoria);
  });

  state.stock.forEach(r => {
    if (safeTrim_(r.location_id)) locSet.add(r.location_id);
  });

  state.categories = Array.from(catSet).sort(byText_);
  state.locations = Array.from(locSet).sort(byText_);
}

/* =========================
   REFRESH
========================= */
async function refreshAllData_(silent = false) {
  setLoading_(true);

  try {
    await Promise.all([
      loadItems_(),
      loadStock_(),
    ]);

    rebuildCatalogsFromData_();
    buildViewRows_();
    renderFilters_();
    renderStockList_();
    updateSummary_();
    setToolbarSubtitle_();
    updateSessionUI_();

    if (!silent) toast_('Datos actualizados ✅');
  } catch (err) {
    console.error(err);
    showFatalOrInlineError_(err, 'No se pudieron recargar los datos');
  } finally {
    setLoading_(false);
  }
}

function setLoading_(isLoading) {
  state.loading = !!isLoading;

  if (el.btnReloadData) {
    el.btnReloadData.disabled = !!isLoading;
    el.btnReloadData.textContent = isLoading ? 'Cargando...' : 'Recargar';
  }

  if (el.btnNewItem) el.btnNewItem.disabled = !!isLoading;
  if (el.saveMovement) el.saveMovement.disabled = !!isLoading;
  if (el.saveItemBtn) el.saveItemBtn.disabled = !!isLoading;
  if (el.logoutBtn) el.logoutBtn.disabled = !!isLoading;
}

/* =========================
   EVENTS
========================= */
function wireEvents_() {
  if (state.booted) return;

  const rerenderDebounced = debounce_(() => renderStockList_(), 100);

  el.loginForm?.addEventListener('submit', submitLogin_);
  el.logoutBtn?.addEventListener('click', logout_);

  el.searchInput?.addEventListener('input', (ev) => {
    state.filters.q = safeTrim_(ev.target.value || '');
    rerenderDebounced();
  });

  el.filterLocation?.addEventListener('change', (ev) => {
    state.filters.location_id = safeTrim_(ev.target.value || '');
    localStorage.setItem(LS.lastLocation, state.filters.location_id);
    renderStockList_();
  });

  el.filterCategory?.addEventListener('change', (ev) => {
    state.filters.category = safeTrim_(ev.target.value || '');
    localStorage.setItem(LS.lastCategory, state.filters.category);
    renderStockList_();
  });

  el.filterStatus?.addEventListener('change', (ev) => {
    state.filters.status = safeTrim_(ev.target.value || '');
    localStorage.setItem(LS.lastStatus, state.filters.status);
    renderStockList_();
  });

  el.inventoryList?.addEventListener('click', async (ev) => {
    const card = ev.target.closest('[data-item-id]');
    if (!card) return;

    const item_id = card.getAttribute('data-item-id');
    if (!item_id) return;

    await openItem_(item_id);
  });

  el.btnMovement?.addEventListener('click', () => {
    if (!state.current.item_id) {
      alert('No hay ítem seleccionado.');
      return;
    }
    prepareMovementModal_();
    openModal('movementModal');
  });

  el.btnHistory?.addEventListener('click', async () => {
    if (!state.current.item_id) {
      alert('No hay ítem seleccionado.');
      return;
    }
    await openHistory_(state.current.item_id);
  });

  el.btnEditItem?.addEventListener('click', () => {
    if (!state.current.item) return;
    openItemEditor_(state.current.item);
  });

  el.saveMovement?.addEventListener('click', async () => {
    await saveMovement_();
  });

  el.movementAction?.addEventListener('change', updateMovementFieldsVisibility_);

  el.btnReloadData?.addEventListener('click', () => refreshAllData_());
  el.btnNewItem?.addEventListener('click', () => openItemEditor_(null));

  el.saveItemBtn?.addEventListener('click', async () => {
    await saveItem_();
  });

  setupAdminSecret_();

  el.btnArchiveItem?.addEventListener('click', async () => {
    await adminArchiveCurrent_();
  });

  el.btnChangeRole?.addEventListener('click', async () => {
    await adminChangeRole_();
  });

  el.btnAdminNewItem?.addEventListener('click', () => openItemEditor_(null));
  el.btnAdminRefresh?.addEventListener('click', () => refreshAllData_());

  [el.itemModal, el.movementModal, el.historyModal, el.itemEditorModal]
    .filter(Boolean)
    .forEach(modal => {
      modal.addEventListener('click', (ev) => {
        if (ev.target === modal) modal.classList.remove('active');
      });
    });

  state.booted = true;
}

/* =========================
   ITEM FLOW
========================= */
async function openItem_(item_id) {
  try {
    state.current.item_id = item_id;

    let item = state.itemsById[item_id] || null;

    try {
      item = await loadItem_(item_id);
      if (item?.item_id) {
        state.itemsById[item.item_id] = { ...state.itemsById[item.item_id], ...item };
      }
    } catch (err) {
      if (!item) throw err;
    }

    state.current.item = item;
    state.current.stockRows = stockRowsForItem_(item_id);

    renderItemModal_(item, state.current.stockRows);
    openModal('itemModal');
  } catch (err) {
    console.error(err);
    alert(`No se pudo abrir el ítem: ${String(err.message || err)}`);
  }
}

function openItemEditor_(item) {
  if (!el.itemEditorModal) return;

  const isEdit = !!item?.item_id;

  el.itemEditorTitle.textContent = isEdit ? 'Editar ítem' : 'Nuevo ítem';
  el.itemFormNombre.value = item?.nombre || '';
  el.itemFormCategoria.value = item?.categoria || '';
  el.itemFormUnidad.value = item?.unidad || '';
  el.itemFormEstado.value = String(item?.estado || 'ACTIVO').toUpperCase();
  el.itemFormValor.value = item?.valor ?? '';
  el.itemFormVida.value = item?.vida_util_anios ?? '';
  el.itemFormDescripcion.value = item?.descripcion || '';
  el.itemFormFotos.value = item?.fotos_links || '';
  el.itemFormInitLocation.value = '';
  el.itemFormInitQty.value = '';

  el.itemEditorModal.dataset.editingItemId = item?.item_id || '';
  openModal('itemEditorModal');
}

async function saveItem_() {
  const editingItemId = safeTrim_(el.itemEditorModal?.dataset?.editingItemId || '');

  const payload = {
    item_id: editingItemId || undefined,
    nombre: safeTrim_(el.itemFormNombre?.value),
    categoria: safeTrim_(el.itemFormCategoria?.value) || 'General',
    unidad: safeTrim_(el.itemFormUnidad?.value),
    estado: safeTrim_(el.itemFormEstado?.value || 'ACTIVO').toUpperCase(),
    valor: safeTrim_(el.itemFormValor?.value),
    vida_util_anios: safeTrim_(el.itemFormVida?.value),
    descripcion: safeTrim_(el.itemFormDescripcion?.value),
    fotos_links: safeTrim_(el.itemFormFotos?.value),
  };

  if (!payload.nombre) {
    alert('El nombre es obligatorio.');
    return;
  }

  const initLocation = safeTrim_(el.itemFormInitLocation?.value);
  const initQty = Number(el.itemFormInitQty?.value || 0);

  el.saveItemBtn.disabled = true;
  el.saveItemBtn.textContent = 'Guardando...';

  try {
    const res = await apiPost_('upsertItem', payload);
    const saved = res.item;

    if (saved?.item_id) {
      state.itemsById[saved.item_id] = {
        ...state.itemsById[saved.item_id],
        ...saved,
        estado: String(saved.estado || 'ACTIVO').toUpperCase(),
      };
    }

    if (saved?.item_id && initLocation && isFinite(initQty) && initQty > 0) {
      await apiPost_('addMovement', {
        accion: 'ADD',
        item_id: saved.item_id,
        ubicacion_origen: '',
        ubicacion_destino: initLocation,
        cantidad: initQty,
        motivo: editingItemId ? 'Carga manual de stock' : 'Stock inicial',
        evidencia_link: '',
      });
    }

    closeModal('itemEditorModal');
    await refreshAllData_(true);
    toast_(editingItemId ? 'Ítem actualizado ✅' : 'Ítem creado ✅');

    if (saved?.item_id) {
      await openItem_(saved.item_id);
    }
  } catch (err) {
    console.error(err);
    alert(`No se pudo guardar el ítem: ${String(err.message || err)}`);
  } finally {
    el.saveItemBtn.disabled = false;
    el.saveItemBtn.textContent = 'Guardar ítem';
  }
}

/* =========================
   MOVEMENTS
========================= */
function prepareMovementModal_() {
  if (!state.current.item) return;

  el.movementAction.value = 'ADD';
  el.movementQty.value = '';
  el.movementReason.value = '';
  el.movementOrigin.value = state.filters.location_id || localStorage.getItem(LS.lastLocation) || '';
  el.movementDest.value = '';
  updateMovementFieldsVisibility_();
}

function updateMovementFieldsVisibility_() {
  const action = safeTrim_(el.movementAction?.value).toUpperCase();

  const originLabel = el.movementOrigin?.previousElementSibling;
  const destLabel = el.movementDest?.previousElementSibling;

  const showOrigin = (action === 'REMOVE' || action === 'MOVE' || action === 'ADD');
  const showDest = (action === 'ADD' || action === 'MOVE');

  if (originLabel) originLabel.style.display = showOrigin ? '' : 'none';
  if (destLabel) destLabel.style.display = showDest ? '' : 'none';
  if (el.movementOrigin) el.movementOrigin.style.display = showOrigin ? '' : 'none';
  if (el.movementDest) el.movementDest.style.display = showDest ? '' : 'none';

  if (action === 'ADD') {
    el.movementOrigin.placeholder = 'Opcional';
    el.movementDest.placeholder = 'Ej: Salón 2';
  } else if (action === 'REMOVE') {
    el.movementOrigin.placeholder = 'Ej: Bodega';
  } else if (action === 'MOVE') {
    el.movementOrigin.placeholder = 'Desde dónde sale';
    el.movementDest.placeholder = 'Hacia dónde va';
  }
}

async function saveMovement_() {
  const item_id = state.current.item_id;
  if (!item_id) {
    alert('No hay ítem seleccionado.');
    return;
  }

  const accion = safeTrim_(el.movementAction?.value).toUpperCase();
  const cantidad = Number(el.movementQty?.value || 0);
  const ubicacion_origen = safeTrim_(el.movementOrigin?.value);
  const ubicacion_destino = safeTrim_(el.movementDest?.value);
  const motivo = safeTrim_(el.movementReason?.value);

  if (!accion) return alert('Selecciona una acción.');
  if (!isFinite(cantidad) || cantidad <= 0) return alert('Cantidad inválida.');
  if (!motivo) return alert('Escribe el motivo.');

  if (accion === 'REMOVE' && !ubicacion_origen) {
    return alert('Falta ubicación origen.');
  }

  if (accion === 'MOVE' && (!ubicacion_origen || !ubicacion_destino)) {
    return alert('Faltan origen y/o destino.');
  }

  if (accion === 'ADD' && !ubicacion_origen && !ubicacion_destino) {
    return alert('Escribe al menos una ubicación.');
  }

  el.saveMovement.disabled = true;
  el.saveMovement.textContent = 'Guardando...';

  try {
    const res = await apiPost_('addMovement', {
      accion,
      item_id,
      ubicacion_origen,
      ubicacion_destino,
      cantidad,
      motivo,
      evidencia_link: '',
    });

    if (Array.isArray(res.stockUpdates) && res.stockUpdates.length) {
      for (const up of res.stockUpdates) {
        applyStockUpdate_(up);
      }
    } else {
      await loadStock_();
    }

    rebuildCatalogsFromData_();
    buildViewRows_();
    renderFilters_();
    renderStockList_();
    updateSummary_();

    state.current.stockRows = stockRowsForItem_(item_id);
    state.current.item = state.itemsById[item_id] || state.current.item;
    renderItemModal_(state.current.item, state.current.stockRows);

    closeModal('movementModal');
    toast_('Movimiento guardado ✅');
  } catch (err) {
    console.error(err);
    alert(`No se pudo guardar: ${String(err.message || err)}`);
  } finally {
    el.saveMovement.disabled = false;
    el.saveMovement.textContent = 'Guardar';
  }
}

function applyStockUpdate_(up) {
  const item_id = safeTrim_(up?.item_id);
  const location_id = safeTrim_(up?.location_id);
  const after = Number(up?.after || 0);

  if (!item_id || !location_id) return;

  const idx = state.stock.findIndex(r => r.item_id === item_id && r.location_id === location_id);

  if (idx >= 0) {
    state.stock[idx].cantidad_actual = after;
  } else {
    const info = state.itemsById[item_id] || {
      item_id,
      nombre: '',
      categoria: 'General',
      estado: 'ACTIVO',
    };

    state.stock.push({
      item_id,
      location_id,
      cantidad_actual: after,
      nombre: info.nombre || '',
      categoria: info.categoria || 'General',
      estado: String(info.estado || 'ACTIVO').toUpperCase(),
    });
  }

  if (!state.locations.includes(location_id)) {
    state.locations.push(location_id);
    state.locations.sort(byText_);
  }
}

/* =========================
   HISTORY
========================= */
async function openHistory_(item_id) {
  try {
    const data = await apiGet_('listMovements', { item_id, limit: 200 });
    const movs = Array.isArray(data.movements) ? data.movements : [];

    if (!movs.length) {
      el.historyList.innerHTML = `
        <div class="history-item">
          No hay movimientos registrados para este ítem.
        </div>
      `;
    } else {
      el.historyList.innerHTML = movs.map(m => {
        const ts = esc_(formatDateTime_(m.timestamp || ''));
        const user = esc_(m.usuario || '');
        const acc = esc_(humanAction_(m.accion || ''));
        const qty = esc_(fmtQty_(m.cantidad));
        const ori = esc_(m.ubicacion_origen || '');
        const des = esc_(m.ubicacion_destino || '');
        const mot = esc_(m.motivo || '');

        let locText = '';
        if (String(m.accion || '').toUpperCase() === 'MOVE') {
          locText = `${ori || '—'} → ${des || '—'}`;
        } else {
          locText = ori || des || '—';
        }

        return `
          <div class="history-item">
            <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
              <div>
                <strong>${acc}</strong>
                <div style="color:#6b7280; font-size:12px; margin-top:2px;">${ts} · ${user}</div>
              </div>
              <strong>${qty}</strong>
            </div>

            <div style="margin-top:6px; color:#6b7280;">
              ${esc_(locText)}
            </div>

            <div style="margin-top:6px;">
              ${mot}
            </div>
          </div>
        `;
      }).join('');
    }

    openModal('historyModal');
  } catch (err) {
    console.error(err);
    alert(`No se pudo cargar el historial: ${String(err.message || err)}`);
  }
}

/* =========================
   ADMIN
========================= */
function isAdmin_() {
  return String(state.who?.role || '').toUpperCase() === 'ADMIN';
}

function setupAdminSecret_() {
  if (!el.logoTrigger) return;

  let timer = null;

  const start = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      tryOpenAdmin_();
    }, 3000);
  };

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  el.logoTrigger.addEventListener('mousedown', start);
  el.logoTrigger.addEventListener('touchstart', start, { passive: true });

  el.logoTrigger.addEventListener('mouseup', cancel);
  el.logoTrigger.addEventListener('mouseleave', cancel);
  el.logoTrigger.addEventListener('touchend', cancel);
  el.logoTrigger.addEventListener('touchcancel', cancel);
}

function tryOpenAdmin_() {
  if (!isAdmin_()) {
    toast_('Admin: no autorizado 🙂');
    return;
  }

  state.ui.adminUnlocked = true;
  if (el.adminPanel) {
    el.adminPanel.style.display = 'block';
    el.adminPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  toast_('Panel Admin habilitado 🛡️');
}

async function adminArchiveCurrent_() {
  if (!isAdmin_()) return alert('Solo ADMIN.');

  const item_id = state.current.item_id;
  if (!item_id) return alert('Abre un ítem primero.');

  const reason = prompt('Razón para archivar este ítem:') || '';
  if (!safeTrim_(reason)) return;

  try {
    const data = await apiGet_('archiveItem', {
      item_id,
      reason: safeTrim_(reason),
    });

    const archived = data.item;
    if (archived?.item_id) {
      state.itemsById[archived.item_id] = {
        ...state.itemsById[archived.item_id],
        ...archived,
        estado: String(archived.estado || 'ARCHIVADO').toUpperCase(),
      };

      state.current.item = state.itemsById[archived.item_id];
      buildViewRows_();
      renderStockList_();
      renderItemModal_(state.current.item, stockRowsForItem_(archived.item_id));
      updateSummary_();
    }

    toast_('Ítem archivado ✅');
  } catch (err) {
    console.error(err);
    alert(`No se pudo archivar: ${String(err.message || err)}`);
  }
}

async function adminChangeRole_() {
  if (!isAdmin_()) return alert('Solo ADMIN.');

  const target = prompt('Usuario a modificar:') || '';
  const cleanTarget = safeTrim_(target);
  if (!cleanTarget) return;

  const newRole = prompt('Nuevo rol (USER o ADMIN):', 'USER') || '';
  const cleanRole = safeTrim_(newRole).toUpperCase();

  if (!['USER', 'ADMIN'].includes(cleanRole)) {
    alert('Rol inválido.');
    return;
  }

  try {
    const data = await apiGet_('setUserRole', {
      target: cleanTarget,
      role: cleanRole,
    });

    toast_(`Rol actualizado ✅ (${data.user?.user || cleanTarget})`);
  } catch (err) {
    console.error(err);
    alert(`No se pudo cambiar rol: ${String(err.message || err)}`);
  }
}

/* =========================
   ERROR / TOAST
========================= */
function showFatalOrInlineError_(err, title = 'Ocurrió un error') {
  const msg = String(err?.message || err || 'ERROR_DESCONOCIDO');

  if (el.inventoryList) {
    el.inventoryList.innerHTML = `
      <div class="card" style="grid-column:1/-1">
        <h3 style="margin:0 0 8px 0;">${esc_(title)}</h3>
        <small style="display:block; color:#6b7280; margin-bottom:10px;">
          ${esc_(msg)}
        </small>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" id="retryInitBtn">Reintentar</button>
          <button type="button" id="goLoginBtn" class="secondary">Volver al login</button>
        </div>
      </div>
    `;

    $('#retryInitBtn')?.addEventListener('click', () => bootApp_());
    $('#goLoginBtn')?.addEventListener('click', () => logout_());
  } else {
    alert(`${title}: ${msg}`);
  }
}

let toastTimer = null;

function toast_(msg) {
  let node = document.getElementById('toast');

  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    node.style.position = 'fixed';
    node.style.left = '50%';
    node.style.bottom = '18px';
    node.style.transform = 'translateX(-50%)';
    node.style.background = 'rgba(17,24,39,.92)';
    node.style.color = '#fff';
    node.style.padding = '10px 14px';
    node.style.borderRadius = '10px';
    node.style.fontSize = '14px';
    node.style.zIndex = '9999';
    node.style.maxWidth = '90%';
    node.style.textAlign = 'center';
    node.style.transition = 'opacity .2s ease';
    node.style.opacity = '0';
    document.body.appendChild(node);
  }

  node.textContent = msg;
  node.style.opacity = '1';

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.style.opacity = '0';
  }, 2200);
}

/* =========================
   BOOT APP
========================= */
async function bootApp_() {
  try {
    setLoading_(true);

    applySessionToState_();
    if (!state.who?.user) throw new Error('NO_SESSION');

    showLoginScreen_(false);
    updateSessionUI_();

    if (!$('#inventoryToolbar')) injectEnhancedUI_();

    await loadBootstrap_();
    setToolbarSubtitle_();
    await refreshAllData_(true);
    updateMovementFieldsVisibility_();

    state.ready = true;
  } catch (err) {
    console.error(err);

    const code = String(err.message || err);
    if (['USER_NOT_FOUND', 'USER_INACTIVE', 'NO_SESSION', 'UNAUTHORIZED'].includes(code)) {
      logout_();
      setLoginError_('Tu sesión ya no es válida. Vuelve a iniciar sesión.');
      return;
    }

    showFatalOrInlineError_(err, 'No se pudo iniciar el inventario');
  } finally {
    setLoading_(false);
  }
}

/* =========================
   INIT
========================= */
async function init_() {
  wireEvents_();

  const hasValidSession = await validateStoredSession_();

  if (hasValidSession) {
    showLoginScreen_(false);
    updateSessionUI_();
    await bootApp_();
    if (state.who?.name) {
      toast_(`Hola, ${state.who.name} 👋`);
    }
    return;
  }

  showLoginScreen_(true);
  setLoginError_('');
  if (el.loginUser) el.loginUser.focus();
}

document.addEventListener('DOMContentLoaded', init_);