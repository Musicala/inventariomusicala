'use strict';

/* ============================================================================
  Inventario Musicala — app.js sobre Firebase
  - Auth: Google (admins) + usuario/contraseña (equipo)
  - Datos: Firestore, colecciones con prefijo inventario_
  - Gestión de usuarios desde el panel admin
============================================================================ */

import {
  auth,
  db,
  secondaryAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  query,
  where,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
} from './firebase.js';

/* =========================
   CONFIG
========================= */
const ADMIN_EMAILS = [
  'alekcaballeromusic@gmail.com',
  'catalina.medina.leal@gmail.com',
  'adminmusicala@gmail.com',
];

// Dominio sintético para usuarios internos (usuario+contraseña)
const USER_EMAIL_DOMAIN = 'inventario-musicala.com';

const COL = {
  items: 'inventario_items',
  stock: 'inventario_stock',
  movimientos: 'inventario_movimientos',
  usuarios: 'inventario_usuarios',
};

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
  googleLoginBtn: $('#googleLoginBtn'),
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

  // dynamic refs
  btnReloadData: null,
  btnNewItem: null,
  inventoryToolbarSub: null,
  sumItems: null,
  sumWithStock: null,
  sumUnits: null,
  sumLocations: null,
  btnEditItem: null,
  itemEditorModal: null,
  itemEditorTitle: null,
  itemFormNombre: null,
  itemFormCategoria: null,
  itemFormUnidad: null,
  itemFormEstado: null,
  itemFormValor: null,
  itemFormVida: null,
  itemFormDescripcion: null,
  itemFormFotos: null,
  itemFormInitLocation: null,
  itemFormInitQty: null,
  saveItemBtn: null,
};

/* =========================
   STATE
========================= */
const state = {
  ready: false,
  loading: false,
  booted: false,
  who: null, // {user, name, role, active, email, uid, isGoogleAdmin}
  categories: [],
  locations: [],
  itemsById: {},
  stock: [],
  viewRows: [],
  users: [],
  current: { item_id: null, item: null, stockRows: [] },
  filters: { q: '', location_id: '', category: '', status: '' },
  ui: { adminUnlocked: false },
  bindings: { staticWired: false, adminSecretWired: false },
};

const LS = {
  lastLocation: 'musicala_inv_last_location',
  lastCategory: 'musicala_inv_last_category',
  lastStatus: 'musicala_inv_last_status',
};

/* =========================
   AUTH
========================= */
function usernameToEmail_(username) {
  return `${String(username).trim().toLowerCase()}@${USER_EMAIL_DOMAIN}`;
}

function isValidUsername_(u) {
  return /^[a-z0-9._-]{3,30}$/.test(String(u || '').trim().toLowerCase());
}

async function resolveWho_(fbUser) {
  const email = String(fbUser.email || '').toLowerCase();

  if (ADMIN_EMAILS.includes(email)) {
    return {
      uid: fbUser.uid,
      user: email,
      name: fbUser.displayName || email.split('@')[0],
      role: 'ADMIN',
      active: true,
      email,
      isGoogleAdmin: true,
    };
  }

  const snap = await getDoc(doc(db, COL.usuarios, fbUser.uid));
  if (!snap.exists()) throw new Error('USER_NOT_FOUND');

  const data = snap.data();
  if (data.active === false) throw new Error('USER_INACTIVE');

  return {
    uid: fbUser.uid,
    user: data.usuario || email.split('@')[0],
    name: data.nombre || data.usuario,
    role: String(data.role || 'USER').toUpperCase(),
    active: true,
    email,
    isGoogleAdmin: false,
  };
}

async function loginGoogle_() {
  setLoginError_('');
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    // onAuthStateChanged se encarga del resto
  } catch (err) {
    console.error(err);
    if (String(err.code || '').includes('popup-closed')) return;
    setLoginError_('No se pudo iniciar sesión con Google.');
  }
}

async function submitLogin_(ev) {
  ev?.preventDefault?.();
  setLoginError_('');

  const user = safeTrim_(el.loginUser?.value).toLowerCase();
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
    const email = user.includes('@') ? user : usernameToEmail_(user);
    await signInWithEmailAndPassword(auth, email, password);
    if (el.loginPassword) el.loginPassword.value = '';
    // onAuthStateChanged se encarga del resto
  } catch (err) {
    console.error(err);
    setLoginError_(mapLoginError_(String(err.code || err.message || err)));
    setLoginLoading_(false);
  }
}

function mapLoginError_(code) {
  if (code.includes('user-not-found')) return 'Ese usuario no existe.';
  if (code.includes('wrong-password') || code.includes('invalid-credential'))
    return 'Usuario o contraseña incorrectos.';
  if (code.includes('too-many-requests'))
    return 'Demasiados intentos. Espera unos minutos.';
  if (code.includes('network-request-failed')) return 'Sin conexión a internet.';
  if (code === 'USER_NOT_FOUND') return 'Tu cuenta no está registrada en el inventario.';
  if (code === 'USER_INACTIVE') return 'Este usuario está inactivo.';
  return 'No se pudo iniciar sesión.';
}

async function logout_() {
  try {
    await signOut(auth);
  } catch (_) {}
  resetStateAndShowLogin_();
}

function resetStateAndShowLogin_() {
  state.ready = false;
  state.booted = false;
  state.who = null;
  state.categories = [];
  state.locations = [];
  state.itemsById = {};
  state.stock = [];
  state.viewRows = [];
  state.users = [];
  state.current = { item_id: null, item: null, stockRows: [] };
  state.ui.adminUnlocked = false;

  if (el.adminPanel) el.adminPanel.style.display = 'none';
  if (el.inventoryList) el.inventoryList.innerHTML = '';
  if (el.searchInput) el.searchInput.value = '';
  if (el.loginPassword) el.loginPassword.value = '';

  ['itemModal', 'movementModal', 'historyModal', 'itemEditorModal', 'userAdminModal'].forEach(
    closeModal
  );

  showLoginScreen_(true);
  setLoginError_('');
  setLoginLoading_(false);
  el.loginUser?.focus();
}

/* =========================
   UI UTILITIES
========================= */
function showLoginScreen_(show) {
  if (el.loginScreen) el.loginScreen.hidden = !show;
  if (el.appShell) el.appShell.hidden = !!show;
}

function setLoginError_(msg = '') {
  if (!el.loginError) return;
  el.loginError.hidden = !msg;
  el.loginError.textContent = msg || '';
}

function setLoginLoading_(loading, text) {
  if (!el.loginBtn) return;
  el.loginBtn.disabled = !!loading;
  el.loginBtn.textContent = loading ? (text || 'Ingresando...') : 'Ingresar';
  if (el.googleLoginBtn) el.googleLoginBtn.disabled = !!loading;
}

function updateSessionUI_() {
  if (!state.who) return;
  if (el.sessionUserName)
    el.sessionUserName.textContent = state.who.name || state.who.user || 'Usuario';
  if (el.sessionUserRole)
    el.sessionUserRole.textContent = String(state.who.role || 'USER').toUpperCase();
}

function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
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

function stockDocId_(item_id, location_id) {
  return `${item_id}__${encodeURIComponent(String(location_id).trim())}`;
}

function newItemId_() {
  return `IT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}

/* =========================
   FIRESTORE — DATA
========================= */
async function loadItems_() {
  const snap = await getDocs(collection(db, COL.items));
  state.itemsById = {};
  snap.forEach((d) => {
    const item = d.data();
    state.itemsById[d.id] = {
      item_id: d.id,
      nombre: item.nombre || '',
      categoria: item.categoria || 'General',
      descripcion: item.descripcion || '',
      unidad: item.unidad || '',
      valor: item.valor ?? '',
      vida_util_anios: item.vida_util_anios ?? '',
      estado: String(item.estado || 'ACTIVO').toUpperCase(),
      fotos_links: item.fotos_links || '',
    };
  });
}

async function loadStock_() {
  const snap = await getDocs(collection(db, COL.stock));
  state.stock = [];
  snap.forEach((d) => {
    const r = d.data();
    const qty = Number(r.cantidad_actual || 0);
    if (qty === 0) return;
    state.stock.push({
      item_id: safeTrim_(r.item_id),
      location_id: safeTrim_(r.location_id),
      cantidad_actual: qty,
    });
  });
}

async function loadItem_(item_id) {
  const snap = await getDoc(doc(db, COL.items, item_id));
  if (!snap.exists()) return null;
  return { item_id: snap.id, ...snap.data() };
}

async function upsertItem_(payload) {
  const item_id = payload.item_id || newItemId_();
  const data = {
    nombre: payload.nombre,
    categoria: payload.categoria || 'General',
    unidad: payload.unidad || '',
    estado: String(payload.estado || 'ACTIVO').toUpperCase(),
    valor: payload.valor ?? '',
    vida_util_anios: payload.vida_util_anios ?? '',
    descripcion: payload.descripcion || '',
    fotos_links: payload.fotos_links || '',
    actualizado_por: state.who?.user || '',
    actualizado_ts: serverTimestamp(),
  };
  if (!payload.item_id) {
    data.creado_por = state.who?.user || '';
    data.creado_ts = serverTimestamp();
  }
  await setDoc(doc(db, COL.items, item_id), data, { merge: true });
  return { item_id, ...data };
}

async function addMovement_({ accion, item_id, ubicacion_origen, ubicacion_destino, cantidad, motivo }) {
  const qty = Number(cantidad);
  const updates = [];

  await runTransaction(db, async (tx) => {
    const touch = async (loc, delta) => {
      if (!loc) return;
      const ref = doc(db, COL.stock, stockDocId_(item_id, loc));
      const snap = await tx.get(ref);
      const before = snap.exists() ? Number(snap.data().cantidad_actual || 0) : 0;
      const after = before + delta;
      if (after < 0) throw new Error(`STOCK_INSUFICIENTE:${loc}`);
      tx.set(ref, {
        item_id,
        location_id: loc,
        cantidad_actual: after,
        actualizado_ts: serverTimestamp(),
      });
      updates.push({ item_id, location_id: loc, after });
    };

    if (accion === 'ADD') {
      await touch(ubicacion_destino || ubicacion_origen, qty);
    } else if (accion === 'REMOVE') {
      await touch(ubicacion_origen, -qty);
    } else if (accion === 'MOVE') {
      await touch(ubicacion_origen, -qty);
      await touch(ubicacion_destino, qty);
    } else {
      throw new Error('ACCION_INVALIDA');
    }
  });

  await addDoc(collection(db, COL.movimientos), {
    item_id,
    accion,
    cantidad: qty,
    ubicacion_origen: ubicacion_origen || '',
    ubicacion_destino: ubicacion_destino || '',
    motivo: motivo || '',
    usuario: state.who?.user || '',
    timestamp: new Date().toISOString(),
    ts: serverTimestamp(),
  });

  return updates;
}

async function listMovements_(item_id, max = 200) {
  const q = query(
    collection(db, COL.movimientos),
    where('item_id', '==', item_id),
    limit(max)
  );
  const snap = await getDocs(q);
  const movs = [];
  snap.forEach((d) => movs.push(d.data()));
  movs.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return movs;
}

function stockRowsForItem_(item_id) {
  return state.stock.filter((r) => r.item_id === item_id);
}

function rebuildCatalogsFromData_() {
  const catSet = new Set();
  const locSet = new Set();
  Object.values(state.itemsById).forEach((item) => {
    if (safeTrim_(item.categoria)) catSet.add(item.categoria);
  });
  state.stock.forEach((r) => {
    if (safeTrim_(r.location_id)) locSet.add(r.location_id);
  });
  state.categories = Array.from(catSet).sort(byText_);
  state.locations = Array.from(locSet).sort(byText_);
}

/* =========================
   USUARIOS (ADMIN)
========================= */
async function loadUsers_() {
  const snap = await getDocs(collection(db, COL.usuarios));
  state.users = [];
  snap.forEach((d) => state.users.push({ uid: d.id, ...d.data() }));
  state.users.sort((a, b) => byText_(a.usuario, b.usuario));
}

async function createUser_({ usuario, nombre, password, role }) {
  const clean = String(usuario).trim().toLowerCase();
  if (!isValidUsername_(clean)) {
    throw new Error('Usuario inválido: usa 3-30 letras minúsculas, números, punto, guion.');
  }
  if (String(password).length < 6) {
    throw new Error('La contraseña debe tener mínimo 6 caracteres.');
  }
  if (state.users.some((u) => u.usuario === clean)) {
    throw new Error('Ese usuario ya existe.');
  }

  const email = usernameToEmail_(clean);
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
  } catch (err) {
    if (String(err.code || '').includes('email-already-in-use')) {
      throw new Error('Ese usuario ya existe en el sistema de autenticación.');
    }
    throw err;
  }

  try {
    await setDoc(doc(db, COL.usuarios, cred.user.uid), {
      usuario: clean,
      nombre: safeTrim_(nombre) || clean,
      email,
      role: String(role || 'USER').toUpperCase(),
      active: true,
      creado_por: state.who?.user || '',
      creado_ts: serverTimestamp(),
    });
  } finally {
    await signOut(secondaryAuth).catch(() => {});
  }
}

async function setUserFields_(uid, fields) {
  await updateDoc(doc(db, COL.usuarios, uid), {
    ...fields,
    actualizado_por: state.who?.user || '',
    actualizado_ts: serverTimestamp(),
  });
}

/* =========================
   DYNAMIC UI INJECTION
========================= */
function injectEnhancedUI_() {
  injectToolbar_();
  injectSummaryBar_();
  injectEditButtonInItemModal_();
  injectItemEditorModal_();
  injectUserAdminModal_();
  decorateMovementForm_();
  decorateAdminPanel_();
  refreshDynamicRefs_();
}

function refreshDynamicRefs_() {
  el.btnReloadData = $('#btnReloadData');
  el.btnNewItem = $('#btnNewItem');
  el.inventoryToolbarSub = $('#inventoryToolbarSub');
  el.sumItems = $('#sumItems');
  el.sumWithStock = $('#sumWithStock');
  el.sumUnits = $('#sumUnits');
  el.sumLocations = $('#sumLocations');
  el.btnEditItem = $('#btnEditItem');
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
    <div class="card"><small style="color:#6b7280;">Ítems</small><h3 id="sumItems" style="margin-top:6px;">0</h3></div>
    <div class="card"><small style="color:#6b7280;">Con stock</small><h3 id="sumWithStock" style="margin-top:6px;">0</h3></div>
    <div class="card"><small style="color:#6b7280;">Unidades totales</small><h3 id="sumUnits" style="margin-top:6px;">0</h3></div>
    <div class="card"><small style="color:#6b7280;">Ubicaciones</small><h3 id="sumLocations" style="margin-top:6px;">0</h3></div>
  `;
  const toolbar = $('#inventoryToolbar');
  if (toolbar?.parentNode) {
    toolbar.parentNode.insertBefore(summary, toolbar.nextSibling);
  } else {
    el.container?.insertBefore(summary, el.inventoryList);
  }
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
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeModal('itemEditorModal');
  });
}

function injectUserAdminModal_() {
  if ($('#userAdminModal')) return;
  const modal = document.createElement('div');
  modal.id = 'userAdminModal';
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content modal-lg">
      <div class="modal-header">
        <div>
          <h2>Usuarios del inventario</h2>
          <small>Crea y administra los accesos con usuario y contraseña</small>
        </div>
        <button class="icon-close secondary" type="button" onclick="app.closeModal('userAdminModal')" aria-label="Cerrar usuarios">✕</button>
      </div>

      <div style="padding:12px; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:14px;">
        <strong style="display:block; margin-bottom:8px;">Nuevo usuario</strong>
        <label>Usuario (para iniciar sesión)</label>
        <input id="newUserUsername" type="text" placeholder="ej: juan.perez" autocomplete="off">
        <label>Nombre completo</label>
        <input id="newUserName" type="text" placeholder="Ej: Juan Pérez" autocomplete="off">
        <label>Contraseña (mínimo 6 caracteres)</label>
        <input id="newUserPassword" type="text" placeholder="Contraseña asignada" autocomplete="off">
        <label>Rol</label>
        <select id="newUserRole">
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <div class="modal-actions">
          <button id="createUserBtn" type="button">Crear usuario</button>
        </div>
        <small style="display:block; color:#6b7280; margin-top:6px;">
          Comparte el usuario y la contraseña con la persona. Para cambiar una contraseña olvidada,
          desactiva el usuario y crea uno nuevo, o cámbiala desde la consola de Firebase.
        </small>
      </div>

      <div id="userAdminList"></div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeModal('userAdminModal');
  });

  $('#createUserBtn')?.addEventListener('click', async () => {
    const btn = $('#createUserBtn');
    const usuario = safeTrim_($('#newUserUsername')?.value);
    const nombre = safeTrim_($('#newUserName')?.value);
    const password = String($('#newUserPassword')?.value || '');
    const role = $('#newUserRole')?.value || 'USER';

    if (!usuario) return alert('Escribe el usuario.');
    if (!password) return alert('Escribe la contraseña.');

    btn.disabled = true;
    btn.textContent = 'Creando...';
    try {
      await createUser_({ usuario, nombre, password, role });
      $('#newUserUsername').value = '';
      $('#newUserName').value = '';
      $('#newUserPassword').value = '';
      await loadUsers_();
      renderUserAdminList_();
      toast_('Usuario creado ✅');
    } catch (err) {
      console.error(err);
      alert(String(err.message || err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Crear usuario';
    }
  });
}

function renderUserAdminList_() {
  const wrap = $('#userAdminList');
  if (!wrap) return;

  if (!state.users.length) {
    wrap.innerHTML = `<div style="color:#6b7280;">Todavía no hay usuarios creados.</div>`;
    return;
  }

  wrap.innerHTML = `
    <strong style="display:block; margin-bottom:8px;">Usuarios existentes</strong>
    <div style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
      ${state.users
        .map(
          (u, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 12px; flex-wrap:wrap; ${
          idx < state.users.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''
        }">
          <div style="min-width:0;">
            <strong>${esc_(u.usuario)}</strong>
            <small style="display:block; color:#6b7280;">${esc_(u.nombre || '')} · ${esc_(u.role || 'USER')} · ${
            u.active === false ? '⛔ Inactivo' : '✅ Activo'
          }</small>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="secondary" data-user-action="role" data-uid="${esc_(u.uid)}">
              ${u.role === 'ADMIN' ? 'Hacer USER' : 'Hacer ADMIN'}
            </button>
            <button type="button" class="secondary" data-user-action="toggle" data-uid="${esc_(u.uid)}">
              ${u.active === false ? 'Activar' : 'Desactivar'}
            </button>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;

  $$('#userAdminList [data-user-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const uid = btn.getAttribute('data-uid');
      const action = btn.getAttribute('data-user-action');
      const u = state.users.find((x) => x.uid === uid);
      if (!u) return;

      btn.disabled = true;
      try {
        if (action === 'role') {
          await setUserFields_(uid, { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' });
        } else {
          await setUserFields_(uid, { active: u.active === false });
        }
        await loadUsers_();
        renderUserAdminList_();
        toast_('Usuario actualizado ✅');
      } catch (err) {
        console.error(err);
        alert(String(err.message || err));
        btn.disabled = false;
      }
    });
  });
}

function decorateMovementForm_() {
  if (!el.movementOrigin || $('#movementLocationsHint')) return;
  const hint = document.createElement('small');
  hint.id = 'movementLocationsHint';
  hint.style.display = 'block';
  hint.style.color = '#6b7280';
  hint.style.marginTop = '6px';
  hint.textContent =
    'Puedes escribir cualquier ubicación. Si ya existe, intenta usar el mismo nombre exacto.';
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
      <button id="btnAdminUsers" type="button">Gestionar usuarios</button>
      <button id="btnAdminNewItem" type="button">Nuevo ítem</button>
      <button id="btnAdminRefresh" type="button" class="secondary">Recargar datos</button>
    `;
    el.adminPanel.appendChild(wrap);

    $('#btnAdminUsers')?.addEventListener('click', async () => {
      try {
        await loadUsers_();
        renderUserAdminList_();
        openModal('userAdminModal');
      } catch (err) {
        console.error(err);
        alert(`No se pudieron cargar los usuarios: ${String(err.message || err)}`);
      }
    });
    $('#btnAdminNewItem')?.addEventListener('click', () => openItemEditor_(null));
    $('#btnAdminRefresh')?.addEventListener('click', () => refreshAllData_());
  }
}


/* =========================
   RENDER
========================= */
function setToolbarSubtitle_() {
  if (!el.inventoryToolbarSub) return;
  const role = String(state.who?.role || 'USER').toUpperCase();
  const user = state.who?.name || state.who?.user || 'Usuario';
  el.inventoryToolbarSub.textContent = `Usuario: ${user} · Rol: ${role}`;
}

function updateSummary_() {
  const itemRows = Object.values(state.itemsById);
  const withStock = itemRows.filter((item) => getTotalQtyForItem_(item.item_id) > 0).length;
  const totalUnits = state.stock.reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);

  if (el.sumItems) el.sumItems.textContent = fmtQty_(itemRows.length);
  if (el.sumWithStock) el.sumWithStock.textContent = fmtQty_(withStock);
  if (el.sumUnits) el.sumUnits.textContent = fmtQty_(totalUnits);
  if (el.sumLocations) el.sumLocations.textContent = fmtQty_(state.locations.length);
}

function getTotalQtyForItem_(item_id) {
  return state.stock
    .filter((r) => r.item_id === item_id)
    .reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);
}

function buildViewRows_() {
  const items = Object.values(state.itemsById);
  state.viewRows = items.map((item) => {
    const itemStockRows = stockRowsForItem_(item.item_id);
    const totalQty = itemStockRows.reduce((acc, r) => acc + Number(r.cantidad_actual || 0), 0);
    const locations = itemStockRows
      .map((r) => safeTrim_(r.location_id))
      .filter(Boolean)
      .sort(byText_);
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
      locationCount: locations.length,
      mainLocation: locations[0] || '',
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
    state.locations.map((l) => `<option value="${esc_(l)}">${esc_(l)}</option>`).join('');
  el.filterCategory.innerHTML =
    `<option value="">Todas las categorías</option>` +
    state.categories.map((c) => `<option value="${esc_(c)}">${esc_(c)}</option>`).join('');

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
    rows = rows.filter((r) =>
      r.stockRows.some((sr) => safeTrim_(sr.location_id).toLowerCase() === loc)
    );
  }
  if (cat) rows = rows.filter((r) => safeTrim_(r.categoria).toLowerCase() === cat);
  if (st) rows = rows.filter((r) => safeTrim_(r.estado).toLowerCase() === st);
  if (q) {
    rows = rows.filter((r) => {
      const blob = [r.item_id, r.nombre, r.categoria, r.estado, r.descripcion, r.unidad, ...r.locations]
        .join(' ')
        .toLowerCase();
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
  if (!el.inventoryList) return;
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

  el.inventoryList.innerHTML = rows
    .map((r) => {
      const name = esc_(r.nombre || '(sin nombre)');
      const status = String(r.estado || 'ACTIVO').toUpperCase();
      const qty = fmtQty_(r.totalQty);
      const locText = r.locationCount
        ? r.locationCount === 1
          ? r.mainLocation
          : `${r.locationCount} ubicaciones`
        : 'Sin ubicación';
      const isZero = Number(r.totalQty || 0) <= 0;

      return `
      <div class="card inventory-card" data-item-id="${esc_(r.item_id)}" style="cursor:pointer;">
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:flex-start;">
          <div style="min-width:0;">
            <h3 style="margin:0 0 6px 0;">${name}</h3>
            <small style="display:block; color:#6b7280;">${esc_(r.categoria || '')}</small>
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
        <small style="display:block; margin-top:10px; color:#6b7280;">ID: ${esc_(r.item_id)}</small>
      </div>
    `;
    })
    .join('');
}

function renderItemModal_(item, stockRows) {
  if (!item || !el.itemTitle || !el.itemInfo) return;

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
      ${
        item.valor !== '' && item.valor !== null && item.valor !== undefined
          ? `<div><strong>Valor:</strong> ${esc_(item.valor)}</div>`
          : ''
      }
      ${
        item.vida_util_anios !== '' && item.vida_util_anios !== null && item.vida_util_anios !== undefined
          ? `<div><strong>Vida útil:</strong> ${esc_(item.vida_util_anios)} años</div>`
          : ''
      }
      ${
        item.descripcion
          ? `<div style="margin-top:4px;"><strong>Descripción:</strong><br>${esc_(item.descripcion)}</div>`
          : ''
      }
      ${
        item.fotos_links
          ? `<div style="margin-top:4px;"><strong>Fotos:</strong><br><a href="${esc_(item.fotos_links)}" target="_blank" rel="noopener">Abrir enlace</a></div>`
          : ''
      }
    </div>
  `;

  const rows = (stockRows || []).slice().sort((a, b) => byText_(a.location_id, b.location_id));
  const stockHtml = rows.length
    ? `
      <div style="margin-top:14px;">
        <strong>Stock por ubicación</strong>
        <div style="margin-top:8px; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden;">
          ${rows
            .map(
              (sr, idx) => `
            <div style="display:flex; justify-content:space-between; padding:10px 12px; ${
              idx < rows.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''
            }">
              <span>${esc_(sr.location_id || 'Sin ubicación')}</span>
              <strong>${esc_(fmtQty_(sr.cantidad_actual))}</strong>
            </div>
          `
            )
            .join('')}
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
    el.btnEditItem.style.display = isAdmin_() ? '' : 'none';
  }
}

/* =========================
   REFRESH
========================= */
async function refreshAllData_(silent = false) {
  setLoading_(true);
  try {
    await Promise.all([loadItems_(), loadStock_()]);
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
function wireStaticEvents_() {
  if (state.bindings.staticWired) return;

  const rerenderDebounced = debounce_(() => renderStockList_(), 100);

  el.loginForm?.addEventListener('submit', submitLogin_);
  el.googleLoginBtn?.addEventListener('click', loginGoogle_);
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
    if (item_id) await openItem_(item_id);
  });

  el.btnMovement?.addEventListener('click', () => {
    if (!state.current.item_id) return alert('No hay ítem seleccionado.');
    prepareMovementModal_();
    openModal('movementModal');
  });

  el.btnHistory?.addEventListener('click', async () => {
    if (!state.current.item_id) return alert('No hay ítem seleccionado.');
    await openHistory_(state.current.item_id);
  });

  el.saveMovement?.addEventListener('click', () => saveMovement_());
  el.movementAction?.addEventListener('change', updateMovementFieldsVisibility_);
  el.btnArchiveItem?.addEventListener('click', () => adminArchiveCurrent_());

  [el.itemModal, el.movementModal, el.historyModal].filter(Boolean).forEach((modal) => {
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) modal.classList.remove('active');
    });
  });

  setupAdminSecret_();
  state.bindings.staticWired = true;
}

function wireDynamicEvents_() {
  refreshDynamicRefs_();

  if (el.btnReloadData && !el.btnReloadData.dataset.bound) {
    el.btnReloadData.addEventListener('click', () => refreshAllData_());
    el.btnReloadData.dataset.bound = '1';
  }
  if (el.btnNewItem && !el.btnNewItem.dataset.bound) {
    el.btnNewItem.addEventListener('click', () => openItemEditor_(null));
    el.btnNewItem.dataset.bound = '1';
  }
  if (el.btnEditItem && !el.btnEditItem.dataset.bound) {
    el.btnEditItem.addEventListener('click', () => {
      if (state.current.item) openItemEditor_(state.current.item);
    });
    el.btnEditItem.dataset.bound = '1';
  }
  if (el.saveItemBtn && !el.saveItemBtn.dataset.bound) {
    el.saveItemBtn.addEventListener('click', () => saveItem_());
    el.saveItemBtn.dataset.bound = '1';
  }
}

/* =========================
   ITEM FLOW
========================= */
async function openItem_(item_id) {
  try {
    state.current.item_id = item_id;

    let item = state.itemsById[item_id] || null;
    try {
      const fresh = await loadItem_(item_id);
      if (fresh?.item_id) {
        state.itemsById[fresh.item_id] = {
          ...state.itemsById[fresh.item_id],
          ...fresh,
          estado: String(fresh.estado || 'ACTIVO').toUpperCase(),
        };
        item = state.itemsById[fresh.item_id];
      }
    } catch (err) {
      if (!item) throw err;
    }

    state.current.item = item;
    state.current.stockRows = stockRowsForItem_(item_id);
    renderItemModal_(state.current.item, state.current.stockRows);
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
  setTimeout(() => el.itemFormNombre?.focus(), 30);
}

async function saveItem_() {
  if (!el.itemEditorModal || !el.saveItemBtn) return;

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
    el.itemFormNombre?.focus();
    return;
  }

  const initLocation = safeTrim_(el.itemFormInitLocation?.value);
  const initQty = Number(el.itemFormInitQty?.value || 0);

  el.saveItemBtn.disabled = true;
  el.saveItemBtn.textContent = 'Guardando...';

  try {
    const saved = await upsertItem_(payload);

    if (saved?.item_id && initLocation && isFinite(initQty) && initQty > 0) {
      await addMovement_({
        accion: 'ADD',
        item_id: saved.item_id,
        ubicacion_origen: '',
        ubicacion_destino: initLocation,
        cantidad: initQty,
        motivo: editingItemId ? 'Carga manual de stock' : 'Stock inicial',
      });
    }

    closeModal('itemEditorModal');
    await refreshAllData_(true);
    toast_(editingItemId ? 'Ítem actualizado ✅' : 'Ítem creado ✅');
    if (saved?.item_id) await openItem_(saved.item_id);
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
  if (el.movementAction) el.movementAction.value = 'ADD';
  if (el.movementQty) el.movementQty.value = '';
  if (el.movementReason) el.movementReason.value = '';
  if (el.movementOrigin) {
    el.movementOrigin.value =
      state.filters.location_id || localStorage.getItem(LS.lastLocation) || '';
  }
  if (el.movementDest) el.movementDest.value = '';
  updateMovementFieldsVisibility_();
}

function updateMovementFieldsVisibility_() {
  const action = safeTrim_(el.movementAction?.value).toUpperCase();
  const originLabel = el.movementOrigin?.previousElementSibling;
  const destLabel = el.movementDest?.previousElementSibling;
  const showOrigin = action === 'REMOVE' || action === 'MOVE' || action === 'ADD';
  const showDest = action === 'ADD' || action === 'MOVE';

  if (originLabel) originLabel.style.display = showOrigin ? '' : 'none';
  if (destLabel) destLabel.style.display = showDest ? '' : 'none';
  if (el.movementOrigin) el.movementOrigin.style.display = showOrigin ? '' : 'none';
  if (el.movementDest) el.movementDest.style.display = showDest ? '' : 'none';

  if (action === 'ADD') {
    if (el.movementOrigin) el.movementOrigin.placeholder = 'Opcional';
    if (el.movementDest) el.movementDest.placeholder = 'Ej: Salón 2';
  } else if (action === 'REMOVE') {
    if (el.movementOrigin) el.movementOrigin.placeholder = 'Ej: Bodega';
  } else if (action === 'MOVE') {
    if (el.movementOrigin) el.movementOrigin.placeholder = 'Desde dónde sale';
    if (el.movementDest) el.movementDest.placeholder = 'Hacia dónde va';
  }
}

async function saveMovement_() {
  const item_id = state.current.item_id;
  if (!item_id) return alert('No hay ítem seleccionado.');

  const accion = safeTrim_(el.movementAction?.value).toUpperCase();
  const cantidad = Number(el.movementQty?.value || 0);
  const ubicacion_origen = safeTrim_(el.movementOrigin?.value);
  const ubicacion_destino = safeTrim_(el.movementDest?.value);
  const motivo = safeTrim_(el.movementReason?.value);

  if (!accion) return alert('Selecciona una acción.');
  if (!isFinite(cantidad) || cantidad <= 0) return alert('Cantidad inválida.');
  if (!motivo) return alert('Escribe el motivo.');
  if (accion === 'REMOVE' && !ubicacion_origen) return alert('Falta ubicación origen.');
  if (accion === 'MOVE' && (!ubicacion_origen || !ubicacion_destino))
    return alert('Faltan origen y/o destino.');
  if (accion === 'ADD' && !ubicacion_origen && !ubicacion_destino)
    return alert('Escribe al menos una ubicación.');

  if (!el.saveMovement) return;
  el.saveMovement.disabled = true;
  el.saveMovement.textContent = 'Guardando...';

  try {
    const updates = await addMovement_({
      accion,
      item_id,
      ubicacion_origen,
      ubicacion_destino,
      cantidad,
      motivo,
    });

    for (const up of updates) applyStockUpdate_(up);

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
    const msg = String(err.message || err);
    if (msg.startsWith('STOCK_INSUFICIENTE')) {
      alert(`No hay stock suficiente en "${msg.split(':')[1] || 'la ubicación origen'}".`);
    } else {
      alert(`No se pudo guardar: ${msg}`);
    }
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

  const idx = state.stock.findIndex(
    (r) => r.item_id === item_id && r.location_id === location_id
  );

  if (idx >= 0) {
    state.stock[idx].cantidad_actual = after;
  } else {
    state.stock.push({ item_id, location_id, cantidad_actual: after });
  }

  if (after <= 0) {
    state.stock = state.stock.filter(
      (r) => !(r.item_id === item_id && r.location_id === location_id && Number(r.cantidad_actual || 0) <= 0)
    );
  }

  if (location_id && !state.locations.includes(location_id)) {
    state.locations.push(location_id);
    state.locations.sort(byText_);
  }
}

/* =========================
   HISTORY
========================= */
async function openHistory_(item_id) {
  try {
    const movs = await listMovements_(item_id, 200);
    if (!el.historyList) return;

    if (!movs.length) {
      el.historyList.innerHTML = `
        <div class="history-item">No hay movimientos registrados para este ítem.</div>
      `;
    } else {
      el.historyList.innerHTML = movs
        .map((m) => {
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
            <div style="margin-top:6px; color:#6b7280;">${esc_(locText)}</div>
            <div style="margin-top:6px;">${mot}</div>
          </div>
        `;
        })
        .join('');
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
  if (!el.logoTrigger || state.bindings.adminSecretWired) return;

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

  state.bindings.adminSecretWired = true;
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
    await updateDoc(doc(db, COL.items, item_id), {
      estado: 'ARCHIVADO',
      archivado_por: state.who?.user || '',
      archivado_motivo: safeTrim_(reason),
      archivado_ts: serverTimestamp(),
    });

    await addDoc(collection(db, COL.movimientos), {
      item_id,
      accion: 'ARCHIVE',
      cantidad: 0,
      ubicacion_origen: '',
      ubicacion_destino: '',
      motivo: safeTrim_(reason),
      usuario: state.who?.user || '',
      timestamp: new Date().toISOString(),
      ts: serverTimestamp(),
    });

    if (state.itemsById[item_id]) {
      state.itemsById[item_id].estado = 'ARCHIVADO';
      state.current.item = state.itemsById[item_id];
      buildViewRows_();
      renderStockList_();
      renderItemModal_(state.current.item, stockRowsForItem_(item_id));
      updateSummary_();
    }

    toast_('Ítem archivado ✅');
  } catch (err) {
    console.error(err);
    alert(`No se pudo archivar: ${String(err.message || err)}`);
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
        <small style="display:block; color:#6b7280; margin-bottom:10px;">${esc_(msg)}</small>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" id="retryInitBtn">Reintentar</button>
          <button type="button" id="goLoginBtn" class="secondary">Volver al login</button>
        </div>
      </div>
    `;
    $('#retryInitBtn')?.addEventListener('click', () => refreshAllData_());
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
    Object.assign(node.style, {
      position: 'fixed',
      left: '50%',
      bottom: '18px',
      transform: 'translateX(-50%)',
      background: 'rgba(17,24,39,.92)',
      color: '#fff',
      padding: '10px 14px',
      borderRadius: '10px',
      fontSize: '14px',
      zIndex: '9999',
      maxWidth: '90%',
      textAlign: 'center',
      transition: 'opacity .2s ease',
      opacity: '0',
    });
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
   BOOT
========================= */
async function bootApp_() {
  try {
    setLoading_(true);
    showLoginScreen_(false);
    updateSessionUI_();

    if (!$('#inventoryToolbar')) {
      injectEnhancedUI_();
    } else {
      refreshDynamicRefs_();
    }
    wireDynamicEvents_();

    setToolbarSubtitle_();

    // Los admins ven el panel admin directamente
    if (isAdmin_() && el.adminPanel) {
      state.ui.adminUnlocked = true;
      el.adminPanel.style.display = 'block';
    }

    await refreshAllData_(true);
    updateMovementFieldsVisibility_();

    state.ready = true;
    state.booted = true;
    toast_(`Hola, ${state.who?.name || state.who?.user} 👋`);
  } catch (err) {
    console.error(err);
    showFatalOrInlineError_(err, 'No se pudo iniciar el inventario');
  } finally {
    setLoading_(false);
  }
}

function init_() {
  wireStaticEvents_();

  onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      resetStateAndShowLogin_();
      return;
    }

    try {
      setLoginLoading_(true, 'Verificando...');
      state.who = await resolveWho_(fbUser);
      setLoginLoading_(false);
      setLoginError_('');
      await bootApp_();
    } catch (err) {
      console.error(err);
      const code = String(err.message || err);
      await signOut(auth).catch(() => {});
      resetStateAndShowLogin_();
      setLoginError_(mapLoginError_(code));
    }
  });
}

document.addEventListener('DOMContentLoaded', init_);
