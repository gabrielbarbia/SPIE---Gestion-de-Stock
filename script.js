/* ══════════════════════════════════════════════
   SPIE — Gestion de Stock
   script.js — Connecté à Supabase
   ══════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   CONFIGURATION SUPABASE
   ────────────────────────────────────────────── */
const SUPABASE_URL = 'https://gpgurjhqagsvozyhuhey.supabase.co';
const SUPABASE_KEY = 'sb_publishable_oSf25K48hOknge6sVx2Fdw_3jX3N-FV';

async function sbFetch(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': options.prefer || 'return=representation',
    ...options.headers
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

/* Helpers CRUD */
const db = {
  select: (table, query = '')          => sbFetch(`${table}?${query}`),
  insert: (table, data)                => sbFetch(table, { method: 'POST', body: JSON.stringify(data) }),
  update: (table, id, data)            => sbFetch(`${table}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (table, id)                  => sbFetch(`${table}?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' }),
  deleteWhere: (table, col, val)       => sbFetch(`${table}?${col}=eq.${val}`, { method: 'DELETE', prefer: 'return=minimal' }),
};

/* ──────────────────────────────────────────────
   ONGLETS AUTORISÉS PAR RÔLE
   ────────────────────────────────────────────── */
const TABS_BY_ROLE = {
  admin:     ['dashboard', 'stock', 'produits', 'comptes', 'historique', 'config'],
  operateur: ['dashboard', 'stock', 'historique']
};

const TAB_LABELS = {
  dashboard:  'Tableau de bord',
  stock:      'Stock',
  produits:   'Produits',
  comptes:    'Comptes',
  historique: 'Historique',
  config:     'Configuration'
};

/* ──────────────────────────────────────────────
   ÉTAT GLOBAL
   ────────────────────────────────────────────── */
let currentUser = null;
let products    = [];
let ejsCfg      = JSON.parse(localStorage.getItem('spie_emailjs') || '{"serviceId":"","templateId":"","publicKey":"","recipientEmail":""}');

/* ──────────────────────────────────────────────
   UTILITAIRES
   ────────────────────────────────────────────── */
function saveEjs() { localStorage.setItem('spie_emailjs', JSON.stringify(ejsCfg)); }
function isAdmin() { return currentUser && currentUser.role === 'admin'; }

function getStatus(p) {
  if (p.qty <= p.seuil_critique) return 'critique';
  if (p.qty <= p.seuil_alerte)   return 'alerte';
  return 'ok';
}
function statusBadge(s) {
  if (s === 'critique') return '<span class="badge badge-critique">Critique</span>';
  if (s === 'alerte')   return '<span class="badge badge-alerte">Alerte</span>';
  return '<span class="badge badge-ok">OK</span>';
}

function showLoader(msg = 'Chargement...') {
  const c = document.getElementById('page-' + currentTab);
  if (c) c.innerHTML = `<div style="text-align:center;padding:48px;color:#888;font-size:14px">${msg}</div>`;
}

let currentTab = 'dashboard';

/* ──────────────────────────────────────────────
   HISTORIQUE — enregistrement
   ────────────────────────────────────────────── */
async function logAction(produit, action) {
  const now   = new Date();
  const date  = now.toLocaleDateString('fr-FR');
  const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  try {
    await db.insert('historique', {
      date, heure,
      produit,
      auteur: currentUser ? currentUser.name : '—',
      action
    });
  } catch(e) { console.warn('Log error:', e); }
}

/* ──────────────────────────────────────────────
   AUTHENTIFICATION
   ────────────────────────────────────────────── */
async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const btn = document.querySelector('#loginWrap .btn-primary');
  btn.textContent = 'Connexion...';
  btn.disabled = true;
  try {
    const rows = await db.select('utilisateurs', `username=eq.${encodeURIComponent(u)}&password=eq.${encodeURIComponent(p)}`);
    if (rows && rows.length > 0) {
      currentUser = { ...rows[0], username: rows[0].username };
      document.getElementById('loginWrap').style.display  = 'none';
      document.getElementById('mainApp').style.display    = 'flex';
      document.getElementById('headerUser').textContent   = currentUser.name;
      document.getElementById('headerRole').textContent   = isAdmin() ? 'Admin' : 'Opérateur';
      buildNav();
      showTab('dashboard');
    } else {
      document.getElementById('loginErr').style.display = 'block';
    }
  } catch(e) {
    document.getElementById('loginErr').textContent = 'Erreur de connexion au serveur.';
    document.getElementById('loginErr').style.display = 'block';
  }
  btn.textContent = 'Se connecter';
  btn.disabled = false;
}

function doLogout() {
  currentUser = null;
  products    = [];
  document.getElementById('mainApp').style.display   = 'none';
  document.getElementById('loginWrap').style.display = 'flex';
  document.getElementById('loginErr').style.display  = 'none';
  document.getElementById('loginErr').textContent    = 'Identifiants incorrects, veuillez réessayer.';
  document.getElementById('loginPass').value         = '';
  document.getElementById('mainNav').innerHTML       = '';
}

/* ──────────────────────────────────────────────
   NAVIGATION
   ────────────────────────────────────────────── */
function buildNav() {
  const tabs = TABS_BY_ROLE[currentUser.role] || ['dashboard'];
  document.getElementById('mainNav').innerHTML = tabs
    .map(t => `<button class="nav-btn" onclick="showTab('${t}')" id="tab-${t}">${TAB_LABELS[t]}</button>`)
    .join('');
}

function showTab(t) {
  const allowed = TABS_BY_ROLE[currentUser.role] || [];
  if (!allowed.includes(t)) return;
  currentTab = t;
  ['dashboard', 'stock', 'produits', 'comptes', 'historique', 'config'].forEach(x => {
    const page = document.getElementById('page-' + x);
    if (page) page.style.display = (x === t) ? '' : 'none';
    const b = document.getElementById('tab-' + x);
    if (b) b.classList.toggle('active', x === t);
  });
  if (t === 'dashboard')              renderDashboard();
  if (t === 'stock')                  renderStock();
  if (t === 'produits'  && isAdmin()) renderProduits();
  if (t === 'comptes'   && isAdmin()) renderComptes();
  if (t === 'historique')             renderHistorique();
  if (t === 'config'    && isAdmin()) renderConfig();
}

/* ──────────────────────────────────────────────
   PAGE : TABLEAU DE BORD
   ────────────────────────────────────────────── */
async function renderDashboard() {
  showLoader('Chargement du tableau de bord...');
  try {
    products = await db.select('produits', 'order=name.asc');
  } catch(e) { products = []; }

  const critiques = products.filter(p => getStatus(p) === 'critique');
  const alertes   = products.filter(p => getStatus(p) === 'alerte');
  const ok        = products.filter(p => getStatus(p) === 'ok');

  let html = `
    <div class="stats">
      <div class="stat"><div class="stat-val">${products.length}</div><div class="stat-lbl">Produits total</div></div>
      <div class="stat"><div class="stat-val" style="color:#27500a">${ok.length}</div><div class="stat-lbl">OK</div></div>
      <div class="stat"><div class="stat-val" style="color:#633806">${alertes.length}</div><div class="stat-lbl">Alerte</div></div>
      <div class="stat"><div class="stat-val" style="color:#e2001a">${critiques.length}</div><div class="stat-lbl">Critique</div></div>
    </div>`;

  if (critiques.length)
    html += `<div class="alert-banner banner-critique"><div class="alert-dot dot-critique"></div><strong>${critiques.length} produit(s) CRITIQUE :</strong> ${critiques.map(p => `${p.name} (${p.qty} ${p.unit})`).join(', ')}</div>`;
  if (alertes.length)
    html += `<div class="alert-banner banner-alerte"><div class="alert-dot dot-alerte"></div><strong>${alertes.length} produit(s) en alerte :</strong> ${alertes.map(p => `${p.name} (${p.qty} ${p.unit})`).join(', ')}</div>`;

  html += `
    <div class="card">
      <div class="card-title">Aperçu du stock</div>
      <div class="seuil-legend">
        <div class="seuil-item"><div class="seuil-dot" style="background:#639922"></div>OK</div>
        <div class="seuil-item"><div class="seuil-dot" style="background:#ef9f27"></div>Alerte</div>
        <div class="seuil-item"><div class="seuil-dot" style="background:#e2001a"></div>Critique</div>
      </div>
      <table><thead><tr>
        <th>Produit</th><th>Catégorie</th><th>Quantité</th>
        <th>Seuil alerte</th><th>Seuil critique</th><th>Statut</th>
      </tr></thead><tbody>`;

  products.forEach(p => {
    html += `<tr>
      <td><strong>${p.name}</strong></td>
      <td style="color:#888">${p.category}</td>
      <td><strong>${p.qty}</strong> ${p.unit}</td>
      <td>${p.seuil_alerte} ${p.unit}</td>
      <td>${p.seuil_critique} ${p.unit}</td>
      <td>${statusBadge(getStatus(p))}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  document.getElementById('page-dashboard').innerHTML = html;
}

/* ──────────────────────────────────────────────
   PAGE : STOCK
   ────────────────────────────────────────────── */
async function renderStock() {
  showLoader('Chargement du stock...');
  try {
    products = await db.select('produits', 'order=name.asc');
  } catch(e) { products = []; }

  let html = `
    <div class="card">
      <div class="table-top">
        <div class="card-title" style="margin:0">Gestion des quantités</div>
        <input class="search-bar" type="text" placeholder="Rechercher un produit..." oninput="filterStock(this.value)">
      </div>
      <table id="stockTable"><thead><tr>
        <th>Produit</th><th>Catégorie</th><th class="col-qty">Quantité (éditable)</th>
        <th>Seuil alerte</th><th>Seuil critique</th><th>Statut</th>
        ${isAdmin() ? '<th>Action</th>' : ''}
      </tr></thead><tbody>`;

  products.forEach(p => {
    html += `<tr data-name="${p.name.toLowerCase()}" data-cat="${p.category.toLowerCase()}">
      <td><strong>${p.name}</strong><div style="font-size:12px;color:#888">${p.unit}</div></td>
      <td style="color:#888">${p.category}</td>
      <td class="col-qty"><div class="qty-wrap">
        <button class="qty-btn" onclick="changeQty(${p.id}, -1)">−</button>
        <input class="input-qty" type="number" min="0" value="${p.qty}" id="qinp-${p.id}"
          onchange="setQty(${p.id}, this.value)" onblur="setQty(${p.id}, this.value)">
        <button class="qty-btn" onclick="changeQty(${p.id}, 1)">+</button>
      </div></td>
      <td>${p.seuil_alerte} ${p.unit}</td>
      <td>${p.seuil_critique} ${p.unit}</td>
      <td id="st-${p.id}">${statusBadge(getStatus(p))}</td>
      ${isAdmin() ? `<td><button class="btn-sm btn-danger" onclick="delProductFromStock(${p.id})">Supprimer</button></td>` : ''}
    </tr>`;
  });
  html += `</tbody></table></div>`;
  document.getElementById('page-stock').innerHTML = html;
}

function filterStock(val) {
  document.querySelectorAll('#stockTable tbody tr').forEach(r => {
    r.style.display = (r.dataset.name.includes(val.toLowerCase()) || r.dataset.cat.includes(val.toLowerCase())) ? '' : 'none';
  });
}

async function changeQty(id, delta) {
  const p = products.find(x => x.id === id); if (!p) return;
  const oldQty = p.qty;
  const newQty = Math.max(0, p.qty + delta);
  if (newQty === oldQty) return;
  p.qty = newQty;
  const inp = document.getElementById('qinp-' + id);
  if (inp) inp.value = p.qty;
  refreshStatusUI(p);
  try {
    await db.update('produits', id, { qty: newQty });
    await logAction(p.name, `Quantité modifiée : ${oldQty} → ${newQty} ${p.unit}`);
  } catch(e) { p.qty = oldQty; if (inp) inp.value = oldQty; }
}

async function setQty(id, val) {
  const p = products.find(x => x.id === id); if (!p) return;
  const oldQty = p.qty;
  const newQty = Math.max(0, parseInt(val) || 0);
  if (newQty === oldQty) return;
  p.qty = newQty;
  const inp = document.getElementById('qinp-' + id);
  if (inp) inp.value = p.qty;
  refreshStatusUI(p);
  try {
    await db.update('produits', id, { qty: newQty });
    await logAction(p.name, `Quantité modifiée : ${oldQty} → ${newQty} ${p.unit}`);
  } catch(e) { p.qty = oldQty; if (inp) inp.value = oldQty; }
}

function refreshStatusUI(p) {
  const el = document.getElementById('st-' + p.id);
  if (el) el.innerHTML = statusBadge(getStatus(p));
  if (getStatus(p) !== 'ok' && ejsCfg.serviceId) sendAlertEmail(p);
}

async function delProductFromStock(id) {
  if (!isAdmin()) return;
  const p = products.find(x => x.id === id); if (!p) return;
  confirmModal(`Supprimer <strong>${p.name}</strong> du stock ?`, 'Cette action est irréversible.', async () => {
    try {
      await logAction(p.name, `Produit supprimé (depuis l'onglet Stock)`);
      await db.delete('produits', id);
      products = products.filter(x => x.id !== id);
      renderStock();
    } catch(e) { infoModal('Erreur lors de la suppression.'); }
  });
}

/* ──────────────────────────────────────────────
   PAGE : PRODUITS (admin uniquement)
   ────────────────────────────────────────────── */
async function renderProduits() {
  if (!isAdmin()) return;
  showLoader('Chargement des produits...');
  try { products = await db.select('produits', 'order=name.asc'); } catch(e) { products = []; }

  let html = `
    <div class="card">
      <div class="card-title">Ajouter un produit</div>
      <div class="form-inline" style="margin-bottom:12px">
        <div class="form-group"><label>Nom du produit</label><input type="text" id="np-name" placeholder="Ex: Câble HTA"></div>
        <div class="form-group"><label>Catégorie</label><input type="text" id="np-cat" placeholder="Ex: Câblage"></div>
        <div class="form-group"><label>Unité</label><input type="text" id="np-unit" value="pcs" style="max-width:80px"></div>
      </div>
      <div class="form-inline">
        <div class="form-group"><label>Qté initiale</label><input type="number" id="np-qty" value="0" min="0" style="max-width:90px"></div>
        <div class="form-group"><label>Seuil alerte <span style="color:#ef9f27">●</span></label><input type="number" id="np-alerte" value="10" min="0" style="max-width:90px"></div>
        <div class="form-group"><label>Seuil critique <span style="color:#e2001a">●</span></label><input type="number" id="np-critique" value="5" min="0" style="max-width:90px"></div>
        <div><button class="btn-add" onclick="addProduct()">+ Ajouter</button></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Liste des produits</div>
      <table><thead><tr>
        <th>Produit</th><th>Catégorie</th><th>Unité</th>
        <th>Seuil alerte</th><th>Seuil critique</th><th>Actions</th>
      </tr></thead><tbody>`;

  products.forEach(p => {
    html += `<tr>
      <td><strong>${p.name}</strong></td>
      <td style="color:#888">${p.category}</td>
      <td>${p.unit}</td>
      <td style="color:#633806">${p.seuil_alerte} ${p.unit}</td>
      <td style="color:#a32d2d">${p.seuil_critique} ${p.unit}</td>
      <td><div style="display:flex;gap:6px">
        <button class="btn-sm" onclick="openEditProd(${p.id})">Modifier</button>
        <button class="btn-sm btn-danger" onclick="delProduct(${p.id})">Supprimer</button>
      </div></td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  document.getElementById('page-produits').innerHTML = html;
}

async function addProduct() {
  if (!isAdmin()) return;
  const name = document.getElementById('np-name').value.trim();
  if (!name) { infoModal('Le nom du produit est obligatoire.'); return; }
  const a    = parseInt(document.getElementById('np-alerte').value)   || 10;
  const c    = parseInt(document.getElementById('np-critique').value) || 5;
  const data = {
    name,
    category:       document.getElementById('np-cat').value.trim()   || 'Divers',
    qty:            parseInt(document.getElementById('np-qty').value) || 0,
    seuil_alerte:   Math.max(a, c),
    seuil_critique: Math.min(a, c),
    unit:           document.getElementById('np-unit').value.trim()  || 'pcs'
  };
  try {
    await db.insert('produits', data);
    await logAction(name, `Produit créé — Catégorie : ${data.category}, Qté : ${data.qty} ${data.unit}, Seuil alerte : ${data.seuil_alerte}, Seuil critique : ${data.seuil_critique}`);
    renderProduits();
  } catch(e) { infoModal('Erreur lors de la création du produit.'); }
}

async function delProduct(id) {
  if (!isAdmin()) return;
  const p = products.find(x => x.id === id); if (!p) return;
  confirmModal(`Supprimer <strong>${p.name}</strong> ?`, 'Cette action est irréversible.', async () => {
    try {
      await logAction(p.name, `Produit supprimé`);
      await db.delete('produits', id);
      renderProduits();
    } catch(e) { infoModal('Erreur lors de la suppression.'); }
  });
}

function openEditProd(id) {
  if (!isAdmin()) return;
  const p = products.find(x => x.id === id); if (!p) return;
  document.getElementById('modalBox').innerHTML = `
    <div class="modal-title">Modifier le produit</div>
    <div class="form-group"><label>Nom</label><input type="text" id="ep-name" value="${p.name}"></div>
    <div class="form-row">
      <div class="form-group"><label>Catégorie</label><input type="text" id="ep-cat" value="${p.category}"></div>
      <div class="form-group"><label>Unité</label><input type="text" id="ep-unit" value="${p.unit}"></div>
    </div>
    <div class="form-row3">
      <div class="form-group"><label>Qté actuelle</label><input type="number" id="ep-qty" value="${p.qty}" min="0"></div>
      <div class="form-group"><label>Seuil alerte <span style="color:#ef9f27">●</span></label><input type="number" id="ep-alerte" value="${p.seuil_alerte}" min="0"></div>
      <div class="form-group"><label>Seuil critique <span style="color:#e2001a">●</span></label><input type="number" id="ep-critique" value="${p.seuil_critique}" min="0"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-sm" onclick="closeModal()">Annuler</button>
      <button class="btn-add" onclick="saveEditProd(${id})">Enregistrer</button>
    </div>`;
  document.getElementById('modalWrap').style.display = 'flex';
}

async function saveEditProd(id) {
  if (!isAdmin()) return;
  const p = products.find(x => x.id === id); if (!p) return;
  const before = { name: p.name, category: p.category, unit: p.unit, qty: p.qty, seuil_alerte: p.seuil_alerte, seuil_critique: p.seuil_critique };

  const name  = document.getElementById('ep-name').value.trim() || p.name;
  const cat   = document.getElementById('ep-cat').value.trim()  || p.category;
  const unit  = document.getElementById('ep-unit').value.trim() || p.unit;
  const qty   = Math.max(0, parseInt(document.getElementById('ep-qty').value) || 0);
  const a     = parseInt(document.getElementById('ep-alerte').value)   || p.seuil_alerte;
  const c     = parseInt(document.getElementById('ep-critique').value) || p.seuil_critique;
  const sa    = Math.max(a, c);
  const sc    = Math.min(a, c);

  const changes = [];
  if (before.name !== name)         changes.push(`Nom : "${before.name}" → "${name}"`);
  if (before.category !== cat)      changes.push(`Catégorie : ${before.category} → ${cat}`);
  if (before.unit !== unit)         changes.push(`Unité : ${before.unit} → ${unit}`);
  if (before.qty !== qty)           changes.push(`Quantité : ${before.qty} → ${qty} ${unit}`);
  if (before.seuil_alerte !== sa)   changes.push(`Seuil alerte : ${before.seuil_alerte} → ${sa}`);
  if (before.seuil_critique !== sc) changes.push(`Seuil critique : ${before.seuil_critique} → ${sc}`);

  try {
    await db.update('produits', id, { name, category: cat, unit, qty, seuil_alerte: sa, seuil_critique: sc });
    if (changes.length) await logAction(name, `Produit modifié — ${changes.join(' | ')}`);
    closeModal();
    renderProduits();
  } catch(e) { infoModal('Erreur lors de la modification.'); }
}

/* ──────────────────────────────────────────────
   PAGE : COMPTES (admin uniquement)
   ────────────────────────────────────────────── */
async function renderComptes() {
  if (!isAdmin()) return;
  showLoader('Chargement des comptes...');
  let usersList = [];
  try { usersList = await db.select('utilisateurs', 'order=username.asc'); } catch(e) {}

  let html = `
    <div class="card">
      <div class="card-title">Créer un compte</div>
      <div class="form-inline">
        <div class="form-group"><label>Identifiant (login)</label><input type="text" id="nc-user" placeholder="ex: jean.dupont"></div>
        <div class="form-group"><label>Nom affiché</label><input type="text" id="nc-name" placeholder="ex: Jean Dupont"></div>
        <div class="form-group"><label>Mot de passe</label><input type="password" id="nc-pass" placeholder="••••••••"></div>
        <div class="form-group"><label>Rôle</label>
          <select id="nc-role">
            <option value="operateur">Opérateur — Stock uniquement</option>
            <option value="admin">Administrateur — Accès complet</option>
          </select>
        </div>
        <div><button class="btn-add" onclick="createAccount()">+ Créer</button></div>
      </div>
      <div id="nc-msg-ok" class="msg-ok">Compte créé avec succès.</div>
      <div id="nc-msg-err" class="msg-err">Identifiant déjà existant ou champs incomplets.</div>
    </div>
    <div class="card">
      <div class="card-title">Comptes existants (${usersList.length})</div>
      <table><thead><tr>
        <th>Identifiant</th><th>Nom affiché</th><th>Rôle</th><th>Onglets accessibles</th><th>Actions</th>
      </tr></thead><tbody>`;

  usersList.forEach(u => {
    const isSelf    = u.username === currentUser.username;
    const roleBadge = u.role === 'admin'
      ? '<span class="badge badge-admin">Admin</span>'
      : '<span class="badge badge-op">Opérateur</span>';
    const tabs  = (TABS_BY_ROLE[u.role] || []).map(t => TAB_LABELS[t]).join(', ');
    const delBtn = isSelf
      ? `<span style="font-size:12px;color:#888">Compte actif</span>`
      : `<button class="btn-sm btn-danger" onclick="deleteAccount(${u.id}, '${u.username}')">Supprimer</button>`;
    html += `<tr>
      <td><strong>${u.username}</strong></td>
      <td>${u.name}</td>
      <td>${roleBadge}</td>
      <td style="font-size:13px;color:#888">${tabs}</td>
      <td><div style="display:flex;gap:6px;align-items:center">
        <button class="btn-sm" onclick="openEditAccount(${u.id}, '${u.username}')">Modifier</button>
        ${delBtn}
      </div></td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  document.getElementById('page-comptes').innerHTML = html;
}

async function createAccount() {
  if (!isAdmin()) return;
  const u = document.getElementById('nc-user').value.trim().toLowerCase();
  const n = document.getElementById('nc-name').value.trim();
  const p = document.getElementById('nc-pass').value;
  const r = document.getElementById('nc-role').value;
  const ok  = document.getElementById('nc-msg-ok');
  const err = document.getElementById('nc-msg-err');
  ok.style.display = 'none'; err.style.display = 'none';
  if (!u || !n || !p) { err.style.display = 'block'; return; }
  try {
    await db.insert('utilisateurs', { username: u, password: p, name: n, role: r });
    await logAction('—', `Compte créé : "${u}" (${n}) — Rôle : ${r}`);
    ok.style.display = 'block';
    setTimeout(() => ok.style.display = 'none', 3000);
    document.getElementById('nc-user').value = '';
    document.getElementById('nc-name').value = '';
    document.getElementById('nc-pass').value = '';
    renderComptes();
  } catch(e) { err.textContent = 'Identifiant déjà existant ou erreur serveur.'; err.style.display = 'block'; }
}

async function deleteAccount(id, username) {
  if (!isAdmin()) return;
  if (username === currentUser.username) { infoModal('Vous ne pouvez pas supprimer votre propre compte.'); return; }
  confirmModal(`Supprimer le compte <strong>${username}</strong> ?`, 'Cette action est irréversible.', async () => {
    try {
      await logAction('—', `Compte supprimé : "${username}"`);
      await db.delete('utilisateurs', id);
      renderComptes();
    } catch(e) { infoModal('Erreur lors de la suppression.'); }
  });
}

async function openEditAccount(id, username) {
  if (!isAdmin()) return;
  let usersList = [];
  try { usersList = await db.select('utilisateurs', `id=eq.${id}`); } catch(e) {}
  const u = usersList[0]; if (!u) return;
  const isSelf = username === currentUser.username;
  document.getElementById('modalBox').innerHTML = `
    <div class="modal-title">Modifier le compte "${username}"</div>
    <div class="form-group"><label>Nom affiché</label><input type="text" id="ea-name" value="${u.name}"></div>
    <div class="form-group">
      <label>Nouveau mot de passe <span style="font-size:12px;color:#999">(vide = inchangé)</span></label>
      <input type="password" id="ea-pass" placeholder="••••••••">
    </div>
    <div class="form-group"><label>Rôle</label>
      <select id="ea-role" ${isSelf ? 'disabled' : ''}>
        <option value="operateur" ${u.role === 'operateur' ? 'selected' : ''}>Opérateur — Stock uniquement</option>
        <option value="admin"     ${u.role === 'admin'     ? 'selected' : ''}>Administrateur — Accès complet</option>
      </select>
      ${isSelf ? '<p style="font-size:12px;color:#999;margin-top:4px">Impossible de modifier son propre rôle.</p>' : ''}
    </div>
    <div class="modal-actions">
      <button class="btn-sm" onclick="closeModal()">Annuler</button>
      <button class="btn-add" onclick="saveEditAccount(${id}, '${username}')">Enregistrer</button>
    </div>`;
  document.getElementById('modalWrap').style.display = 'flex';
}

async function saveEditAccount(id, username) {
  if (!isAdmin()) return;
  let usersList = [];
  try { usersList = await db.select('utilisateurs', `id=eq.${id}`); } catch(e) {}
  const u = usersList[0]; if (!u) return;
  const isSelf = username === currentUser.username;
  const name = document.getElementById('ea-name').value.trim();
  const pass = document.getElementById('ea-pass').value;
  const role = isSelf ? u.role : document.getElementById('ea-role').value;

  const changes = [];
  if (name && name !== u.name) changes.push(`Nom : "${u.name}" → "${name}"`);
  if (pass)                    changes.push(`Mot de passe modifié`);
  if (!isSelf && role !== u.role) changes.push(`Rôle : ${u.role} → ${role}`);

  const data = {};
  if (name) data.name = name;
  if (pass) data.password = pass;
  data.role = role;

  try {
    await db.update('utilisateurs', id, data);
    if (changes.length) await logAction('—', `Compte modifié : "${username}" — ${changes.join(' | ')}`);
    if (isSelf && name) {
      currentUser.name = name;
      document.getElementById('headerUser').textContent = name;
    }
    closeModal();
    renderComptes();
  } catch(e) { infoModal('Erreur lors de la modification.'); }
}

/* ──────────────────────────────────────────────
   PAGE : HISTORIQUE
   ────────────────────────────────────────────── */
async function renderHistorique() {
  showLoader('Chargement de l\'historique...');
  let hist = [];
  try { hist = await db.select('historique', 'order=created_at.desc&limit=500'); } catch(e) {}

  function actionBadge(action) {
    const a = action.toLowerCase();
    if (a.includes('supprim'))  return '<span class="badge badge-critique">Suppression</span>';
    if (a.includes('créé') || a.includes('cree')) return '<span class="badge badge-ok">Création</span>';
    if (a.includes('quantité')) return '<span class="badge badge-alerte">Quantité</span>';
    if (a.includes('modifié') || a.includes('modifie')) return '<span class="badge" style="background:#e6f1fb;color:#185fa5">Modification</span>';
    return '<span class="badge" style="background:#f1efe8;color:#5f5e5a">Autre</span>';
  }

  let html = `
    <div class="card">
      <div class="table-top">
        <div class="card-title" style="margin:0">Historique des actions (${hist.length})</div>
        <div style="display:flex;gap:8px;align-items:center">
          <input class="search-bar" type="text" placeholder="Rechercher..." oninput="filterHistorique(this.value)" style="width:200px">
          ${isAdmin() ? `<button class="btn-sm btn-danger" onclick="clearHistorique()">Vider l'historique</button>` : ''}
        </div>
      </div>`;

  if (!hist.length) {
    html += `<div style="text-align:center;padding:32px;color:#888;font-size:14px">Aucune action enregistrée.</div>`;
  } else {
    html += `<table id="histTable"><thead><tr>
      <th style="width:90px">Date</th>
      <th style="width:80px">Heure</th>
      <th>Produit</th>
      <th style="width:140px">Auteur</th>
      <th style="width:110px">Type</th>
      <th>Modification</th>
    </tr></thead><tbody>`;
    hist.forEach(h => {
      html += `<tr data-search="${(h.produit + ' ' + h.auteur + ' ' + h.action).toLowerCase()}">
        <td style="font-size:13px;white-space:nowrap">${h.date}</td>
        <td style="font-size:13px;white-space:nowrap;color:#888">${h.heure}</td>
        <td><strong>${h.produit}</strong></td>
        <td style="font-size:13px">${h.auteur}</td>
        <td>${actionBadge(h.action)}</td>
        <td style="font-size:13px;color:#444">${h.action}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;
  document.getElementById('page-historique').innerHTML = html;
}

function filterHistorique(val) {
  document.querySelectorAll('#histTable tbody tr').forEach(r => {
    r.style.display = r.dataset.search.includes(val.toLowerCase()) ? '' : 'none';
  });
}

async function clearHistorique() {
  confirmModal('Vider tout l\'historique ?', 'Cette action est irréversible.', async () => {
    try {
      await sbFetch('historique', { method: 'DELETE', prefer: 'return=minimal', headers: { 'id': 'gte.0' } });
      renderHistorique();
    } catch(e) {
      /* fallback : supprimer ligne par ligne */
      try {
        const all = await db.select('historique', 'select=id');
        for (const row of all) await db.delete('historique', row.id);
        renderHistorique();
      } catch(e2) { infoModal('Erreur lors de la suppression de l\'historique.'); }
    }
  });
}

/* ──────────────────────────────────────────────
   PAGE : CONFIGURATION EmailJS (admin uniquement)
   ────────────────────────────────────────────── */
function renderConfig() {
  if (!isAdmin()) return;
  document.getElementById('page-config').innerHTML = `
    <div class="card">
      <div class="emailjs-note">
        Créez un compte sur <strong>emailjs.com</strong>, configurez un service + template, puis renseignez ci-dessous.<br><br>
        Variables : <code>product_name</code> <code>quantity</code> <code>status</code>
        <code>seuil_alerte</code> <code>seuil_critique</code> <code>unit</code> <code>to_email</code>
      </div>
      <div class="card-title">Configuration EmailJS</div>
      <div class="form-row">
        <div class="form-group"><label>Service ID</label><input type="text" id="ejs-svc" value="${ejsCfg.serviceId}" placeholder="service_xxxxxxx"></div>
        <div class="form-group"><label>Template ID</label><input type="text" id="ejs-tpl" value="${ejsCfg.templateId}" placeholder="template_xxxxxxx"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Clé publique</label><input type="text" id="ejs-key" value="${ejsCfg.publicKey}" placeholder="xxxxxxxxxxxxxxxx"></div>
        <div class="form-group"><label>Email destinataire</label><input type="email" id="ejs-mail" value="${ejsCfg.recipientEmail}" placeholder="stock@spie.com"></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-add" onclick="saveCfg()">Enregistrer</button>
        <button class="btn-sm" onclick="testMail()">Tester l'envoi</button>
      </div>
      <div id="cfg-msg" style="margin-top:10px;font-size:13px;display:none"></div>
    </div>`;
}

function saveCfg() {
  ejsCfg.serviceId      = document.getElementById('ejs-svc').value.trim();
  ejsCfg.templateId     = document.getElementById('ejs-tpl').value.trim();
  ejsCfg.publicKey      = document.getElementById('ejs-key').value.trim();
  ejsCfg.recipientEmail = document.getElementById('ejs-mail').value.trim();
  saveEjs();
  const m = document.getElementById('cfg-msg');
  m.style.display = 'block'; m.style.color = '#27500a';
  m.textContent = 'Configuration sauvegardée.';
  setTimeout(() => m.style.display = 'none', 3000);
}

function testMail() {
  if (!ejsCfg.serviceId) {
    const m = document.getElementById('cfg-msg');
    m.style.display = 'block'; m.style.color = '#a32d2d';
    m.textContent = 'Configurez d\'abord EmailJS.';
    return;
  }
  sendAlertEmail({ name: 'Produit Test', qty: 2, seuil_alerte: 10, seuil_critique: 5, unit: 'pcs' });
  const m = document.getElementById('cfg-msg');
  m.style.display = 'block'; m.style.color = '#27500a';
  m.textContent = 'Email de test envoyé à ' + ejsCfg.recipientEmail;
  setTimeout(() => m.style.display = 'none', 4000);
}

function sendAlertEmail(p) {
  if (!ejsCfg.serviceId || !ejsCfg.templateId || !ejsCfg.publicKey) return;
  fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: ejsCfg.serviceId, template_id: ejsCfg.templateId, user_id: ejsCfg.publicKey,
      template_params: { product_name: p.name, quantity: p.qty, status: getStatus(p), seuil_alerte: p.seuil_alerte, seuil_critique: p.seuil_critique, unit: p.unit, to_email: ejsCfg.recipientEmail }
    })
  }).catch(() => {});
}

/* ──────────────────────────────────────────────
   MODALS
   ────────────────────────────────────────────── */
function closeModal() { document.getElementById('modalWrap').style.display = 'none'; }

document.getElementById('modalWrap').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

function confirmModal(title, subtitle, onConfirm) {
  document.getElementById('modalBox').innerHTML = `
    <div class="modal-title">${title}</div>
    ${subtitle ? `<p style="font-size:13px;color:#888;margin-bottom:4px">${subtitle}</p>` : ''}
    <div class="modal-actions">
      <button class="btn-sm" onclick="closeModal()">Annuler</button>
      <button class="btn-sm btn-danger" id="confirmOkBtn">Supprimer</button>
    </div>`;
  document.getElementById('modalWrap').style.display = 'flex';
  document.getElementById('confirmOkBtn').addEventListener('click', () => { closeModal(); onConfirm(); });
}

function infoModal(msg) {
  document.getElementById('modalBox').innerHTML = `
    <div class="modal-title">${msg}</div>
    <div class="modal-actions"><button class="btn-add" onclick="closeModal()">OK</button></div>`;
  document.getElementById('modalWrap').style.display = 'flex';
}