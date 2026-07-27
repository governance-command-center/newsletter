(function(){
"use strict";

/* ============================================================
   DATA
   ============================================================ */
var SEED = window.__NEWSLETTER_DATA__ || { allowed_platforms: [], allowed_regions: [], warnings: [], slides: [] };

/* ============================================================
   SHARED SYNC + ACCOUNTS  (Supabase)
   ------------------------------------------------------------
   One Supabase project holds everything: the shared data (one JSON row
   in a `store` table), the lightweight user accounts (a `users` table),
   and the images (a public Storage bucket). Every copy of this file
   talks to the same project, so 5-6 people on their own devices see the
   same data.

   Config lives per-device in localStorage (Project URL + publishable
   key), so you never edit this file. Accounts use the same lightweight
   model as before: an admin creates usernames/passwords, shares them,
   and can reset them; every entry is stamped with who added it.

   SECURITY NOTE: as agreed, these passwords are lightweight — they gate
   casual access and let us track who added what. They are not strong
   security. Images are public links (anyone with the URL can view).
   ============================================================ */

var AUTH = (function(){
  var CFG_KEY  = 'platformUpdates.cfg.v1';   // {url, key}
  var SESS_KEY = 'platformUpdates.sess.v1';  // {username, role, ts}
  var BUCKET   = 'entry-images';
  var STORE_ID = 'main';                      // single row in the store table

  var cfg = null;      // {url, key}
  var session = null;  // {username, role}
  var remote = null;   // {users:{}, slides:[], archives:[]}

  /* ---- config (this device only) ---- */
  function loadCfg(){ try { cfg = JSON.parse(localStorage.getItem(CFG_KEY)||'null'); } catch(e){ cfg=null; } return cfg; }
  function saveCfg(c){ cfg=c; try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch(e){} }
  function clearCfg(){ cfg=null; try { localStorage.removeItem(CFG_KEY); } catch(e){} }
  function isConfigured(){ return !!(cfg && cfg.url && cfg.key); }

  /* ---- session (this device only) ---- */
  function loadSession(){ try { session = JSON.parse(localStorage.getItem(SESS_KEY)||'null'); } catch(e){ session=null; } return session; }
  function saveSession(s){ session=s; try { localStorage.setItem(SESS_KEY, JSON.stringify(s)); } catch(e){} }
  function clearSession(){ session=null; try { localStorage.removeItem(SESS_KEY); } catch(e){} }

  /* ---- lightweight hash (obfuscation only) ---- */
  function hashPw(pw){
    var s='pu.v1.'+pw, h=0x811c9dc5;
    for (var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0; }
    return ('0000000'+h.toString(16)).slice(-8);
  }

  /* ---- REST helpers ---- */
  function base(){ return cfg.url.replace(/\/+$/,''); }
  function restHeaders(extra){
    var h = { 'apikey': cfg.key, 'Authorization':'Bearer '+cfg.key, 'Content-Type':'application/json' };
    if (extra) for (var k in extra) h[k]=extra[k];
    return h;
  }

  // Read the single store row. Returns the normalized payload (empty if none).
  function pull(){
    return fetch(base()+'/rest/v1/store?id=eq.'+encodeURIComponent(STORE_ID)+'&select=data', {
      headers: restHeaders()
    }).then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('read failed ('+r.status+') '+t.slice(0,120)); });
      return r.json();
    }).then(function(rows){
      var data = (rows && rows[0] && rows[0].data) ? rows[0].data : {};
      remote = normalizeRemote(data);
      return remote;
    });
  }

  // Write the whole payload back (upsert the single row).
  function push(payload){
    return fetch(base()+'/rest/v1/store', {
      method:'POST',
      headers: restHeaders({ 'Prefer':'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ id: STORE_ID, data: payload }])
    }).then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('write failed ('+r.status+') '+t.slice(0,120)); });
      remote = payload; return true;
    });
  }

  function normalizeRemote(d){
    d = d && typeof d==='object' ? d : {};
    return {
      users:  (d.users && typeof d.users==='object') ? d.users : {},
      slides: Array.isArray(d.slides) ? d.slides : [],
      archives: Array.isArray(d.archives) ? d.archives : [],
      meta: (d.meta && typeof d.meta==='object') ? d.meta : {}
    };
  }
  function blankRemote(){ return { users:{}, slides:[], archives:[], meta:{ createdAt:Date.now() } }; }

  /* ---- image upload to Supabase Storage (public bucket) ---- */
  function getImgbbKey(){ return isConfigured() ? 'supabase' : ''; } // truthy when configured, so the picker uploads
  function uploadImage(dataUrl, name){
    if (!isConfigured()) return Promise.reject(new Error('Not configured.'));
    var comma = dataUrl.indexOf(',');
    var meta = dataUrl.slice(0, comma);
    var b64 = comma>=0 ? dataUrl.slice(comma+1) : dataUrl;
    var mime = (meta.match(/data:([^;]+)/)||[])[1] || 'image/png';
    var ext = (mime.split('/')[1]||'png').replace(/[^a-z0-9]/gi,'') || 'png';
    // decode base64 -> bytes
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i=0;i<len;i++) bytes[i]=bin.charCodeAt(i);
    var safe = (name||'image').replace(/[^a-z0-9._-]/gi,'_').slice(0,40);
    var path = Date.now()+'-'+Math.random().toString(36).slice(2,8)+'-'+safe+'.'+ext;
    return fetch(base()+'/storage/v1/object/'+BUCKET+'/'+encodeURIComponent(path), {
      method:'POST',
      headers: { 'apikey':cfg.key, 'Authorization':'Bearer '+cfg.key, 'Content-Type':mime, 'x-upsert':'true' },
      body: bytes
    }).then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('upload failed ('+r.status+') '+t.slice(0,120)); });
      // public URL
      return base()+'/storage/v1/object/public/'+BUCKET+'/'+path;
    });
  }

  /* ---- bootstrap a fresh project (create admin + seed) ---- */
  function bootstrap(adminPw, seedSlides){
    var payload = blankRemote();
    payload.users['admin'] = { role:'admin', pw:hashPw(adminPw), createdAt:Date.now(), createdBy:'system' };
    payload.slides = Array.isArray(seedSlides) ? seedSlides : [];
    return push(payload);
  }

  /* ---- login ---- */
  function login(username, pw){
    username = String(username||'').trim().toLowerCase();
    return pull().then(function(r){
      var u = r.users[username];
      if (!u) throw new Error('No such user.');
      if (u.pw !== hashPw(pw)) throw new Error('Wrong password.');
      saveSession({ username:username, role:u.role, ts:Date.now() });
      return session;
    });
  }
  function logout(){ clearSession(); }
  function isAdmin(){ return session && session.role==='admin'; }

  /* ---- account management ---- */
  function createUser(username, pw, role, details){
    username = String(username||'').trim().toLowerCase();
    details = details || {};
    if (!username) return Promise.reject(new Error('Username required.'));
    if (!/^[a-z0-9._-]{2,32}$/.test(username)) return Promise.reject(new Error('Username: 2-32 chars, letters/numbers/._- only.'));
    if (!pw || pw.length<4) return Promise.reject(new Error('Password must be at least 4 characters.'));
    var email = String(details.email||'').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(new Error('Enter a valid email address, or leave it blank.'));
    return pull().then(function(r){
      if (r.users[username]) throw new Error('That username already exists.');
      r.users[username] = {
        role: role==='admin'?'admin':'member',
        pw:hashPw(pw),
        displayName: String(details.displayName||'').trim(),
        email: email,
        createdAt:Date.now(),
        createdBy: session?session.username:'unknown'
      };
      return push(r).then(function(){ return username; });
    });
  }
  // Admin-only: edit a member's profile details (display name / email).
  function updateUser(username, details){
    username = String(username||'').trim().toLowerCase();
    details = details || {};
    var email = String(details.email||'').trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Promise.reject(new Error('Enter a valid email address, or leave it blank.'));
    return pull().then(function(r){
      if (!r.users[username]) throw new Error('No such user.');
      if (details.displayName !== undefined) r.users[username].displayName = String(details.displayName||'').trim();
      if (details.email !== undefined) r.users[username].email = email;
      r.users[username].updatedAt = Date.now();
      r.users[username].updatedBy = session?session.username:'unknown';
      return push(r).then(function(){ return username; });
    });
  }
  function resetPassword(username, newPw){
    username = String(username||'').trim().toLowerCase();
    if (!newPw || newPw.length<4) return Promise.reject(new Error('Password must be at least 4 characters.'));
    return pull().then(function(r){
      if (!r.users[username]) throw new Error('No such user.');
      r.users[username].pw = hashPw(newPw);
      r.users[username].pwResetAt = Date.now();
      r.users[username].pwResetBy = session?session.username:'unknown';
      return push(r).then(function(){ return username; });
    });
  }
  function deleteUser(username){
    username = String(username||'').trim().toLowerCase();
    if (username==='admin') return Promise.reject(new Error('The primary admin account cannot be deleted.'));
    if (session && username===session.username) return Promise.reject(new Error("You can't delete the account you're logged in as."));
    return pull().then(function(r){
      if (!r.users[username]) throw new Error('No such user.');
      delete r.users[username];
      return push(r);
    });
  }
  function setRole(username, role){
    username = String(username||'').trim().toLowerCase();
    if (username==='admin' && role!=='admin') return Promise.reject(new Error('The primary admin must stay an admin.'));
    return pull().then(function(r){
      if (!r.users[username]) throw new Error('No such user.');
      r.users[username].role = role==='admin'?'admin':'member';
      return push(r);
    });
  }
  function listUsers(){
    if (!remote) return [];
    return Object.keys(remote.users).sort().map(function(name){
      var u=remote.users[name];
      return { username:name, role:u.role, displayName:u.displayName||'', email:u.email||'', createdAt:u.createdAt||null, createdBy:u.createdBy||null, pwResetAt:u.pwResetAt||null, pwResetBy:u.pwResetBy||null, updatedAt:u.updatedAt||null, updatedBy:u.updatedBy||null };
    });
  }

  /* ---- shared data ---- */
  function pullData(){ return pull().then(function(r){ return { slides:r.slides, archives:r.archives }; }); }
  function pushData(slidesArr, archivesArr){
    return pull().then(function(r){
      r.slides = Array.isArray(slidesArr)?slidesArr:r.slides;
      if (Array.isArray(archivesArr)) r.archives = archivesArr;
      return push(r);
    });
  }

  return {
    loadCfg:loadCfg, saveCfg:saveCfg, clearCfg:clearCfg, isConfigured:isConfigured, getCfg:function(){ return cfg; },
    getImgbbKey:getImgbbKey, uploadImage:uploadImage,
    loadSession:loadSession, getSession:function(){ return session; },
    login:login, logout:logout, isAdmin:isAdmin,
    pull:pull, bootstrap:bootstrap, blankRemote:blankRemote,
    createUser:createUser, updateUser:updateUser, resetPassword:resetPassword, deleteUser:deleteUser, setRole:setRole, listUsers:listUsers,
    pullData:pullData, pushData:pushData, getRemote:function(){ return remote; }
  };
})();
try { window.AUTH = AUTH; } catch(e){}

var ALLOWED_PLATFORMS = SEED.allowed_platforms.slice();
var ALLOWED_REGIONS   = SEED.allowed_regions.slice();

/* ============================================================
   PERSISTENCE  (IndexedDB)
   The working set is saved to IndexedDB so edits, imports and deletions
   survive a reload. IndexedDB is used instead of localStorage because
   entries carry full-resolution base64 images: localStorage caps around
   5MB, whereas IndexedDB typically allows hundreds of MB to GB. Storage is
   still per-browser and per-device — NOT shared and NOT a backup. The source
   deck remains the system of record; "Export as JSON" remains the way to move
   a working set between machines.

   saveSlides() stays synchronous-looking to all its callers: it kicks off an
   async write and returns immediately (true = write started). Load is async
   and happens once at startup, before the first render. If IndexedDB is
   unavailable (private-mode webviews, ancient browsers) we fall back to
   in-memory-only so the page never breaks; a one-time notice tells the user
   their changes won't persist.
   ============================================================ */
var IDB_NAME = 'platformUpdates';
var IDB_STORE = 'kv';
var IDB_KEY = 'slides.v1';
var LS_KEY = 'platformUpdates.slides.v1'; // legacy localStorage key, for one-time migration

var HAS_STORAGE = false;   // becomes true once IndexedDB opens successfully
var _idb = null;           // open database handle
var _idbWriteChain = Promise.resolve(); // serialise writes (last-write-wins, in order)

function openIdb(){
  return new Promise(function(resolve){
    if (!window.indexedDB){ resolve(null); return; }
    var req;
    try { req = window.indexedDB.open(IDB_NAME, 1); }
    catch (e){ resolve(null); return; }
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror   = function(){ resolve(null); };
    req.onblocked = function(){ resolve(null); };
  });
}

function idbGet(key){
  return new Promise(function(resolve){
    if (!_idb){ resolve(null); return; }
    try {
      var tx = _idb.transaction(IDB_STORE, 'readonly');
      var rq = tx.objectStore(IDB_STORE).get(key);
      rq.onsuccess = function(){ resolve(rq.result != null ? rq.result : null); };
      rq.onerror   = function(){ resolve(null); };
    } catch (e){ resolve(null); }
  });
}

function idbSet(key, value){
  return new Promise(function(resolve, reject){
    if (!_idb){ reject(new Error('no-idb')); return; }
    try {
      var tx = _idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = function(){ resolve(true); };
      tx.onerror    = function(){ reject(tx.error || new Error('idb-write')); };
      tx.onabort    = function(){ reject(tx.error || new Error('idb-abort')); };
    } catch (e){ reject(e); }
  });
}

function idbDelete(key){
  return new Promise(function(resolve){
    if (!_idb){ resolve(); return; }
    try {
      var tx = _idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = function(){ resolve(); };
      tx.onerror    = function(){ resolve(); };
    } catch (e){ resolve(); }
  });
}

// Fire-and-forget save. Returns true if a write was queued, false if storage
// is unavailable. Errors surface via setStatus but never throw to the caller.
function saveSlides(){
  // Local cache (best-effort, keeps things snappy / works offline within a tab).
  if (HAS_STORAGE){
    var snapshot = { savedAt: Date.now(), slides: slides };
    _idbWriteChain = _idbWriteChain.then(function(){
      return idbSet(IDB_KEY, snapshot);
    }).catch(function(){ /* cache miss is non-fatal; the bin is the source of truth */ });
  }
  // Shared write to the bin so everyone else sees the change.
  syncPush();
  return true;
}

/* Push the current active slides + archives to the shared bin. Serialised so
   rapid edits don't race. Surfaces success/failure via setStatus. */
var _syncPushChain = Promise.resolve();
var _syncPending = false;
function syncPush(){
  if (!(window.AUTH && AUTH.isConfigured())) return;
  _syncPending = true;
  _syncPushChain = _syncPushChain.then(function(){
    if (!_syncPending) return;
    _syncPending = false;
    setSyncStatus('Saving to shared store…');
    return AUTH.pushData(slides, archives).then(function(){
      setSyncStatus('All changes saved and shared ✓', true);
    });
  }).catch(function(e){
    setSyncStatus('Could not save to the shared store ('+(e && e.message ? e.message : 'network error')+'). Your change is live in this tab only until it saves.', false);
  });
}

// Small status line dedicated to sync state (separate from the admin status).
function setSyncStatus(msg, ok){
  var el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = msg;
  el.className = 'syncstatus' + (ok === true ? ' is-ok' : ok === false ? ' is-error' : '');
}

// Async load used once at startup.
function loadSavedSlides(){
  return idbGet(IDB_KEY).then(function(parsed){
    if (!parsed) return null;
    var arr = Array.isArray(parsed) ? parsed : parsed.slides;
    if (!Array.isArray(arr) || !arr.length) return null;
    return { slides: arr, savedAt: parsed.savedAt || null };
  });
}

function clearSavedSlides(){
  _idbWriteChain = _idbWriteChain.then(function(){ return idbDelete(IDB_KEY); });
}

/* ------------------------------------------------------------------
   ARCHIVES
   Archived entries are moved OUT of the active `slides` set (so they drop out
   of every browse/present/email/PDF view) and stored as named "batches" under
   their own IndexedDB key. Nothing is deleted on archive — entries can be
   restored to active, exported, or permanently removed batch-by-batch. Like
   everything else this lives in THIS browser only; it is not an off-device
   backup (the PDF and JSON exports are).
   Batch shape: { id, label, archivedAt, slides: [ ...entry objects ] }
   ------------------------------------------------------------------ */
var IDB_ARCHIVE_KEY = 'archives.v1';
var archives = [];   // loaded at startup

function saveArchives(){
  if (HAS_STORAGE){
    var snapshot = { savedAt: Date.now(), archives: archives };
    _idbWriteChain = _idbWriteChain.then(function(){
      return idbSet(IDB_ARCHIVE_KEY, snapshot);
    }).catch(function(){ /* local cache miss is non-fatal */ });
  }
  syncPush();  // archives ride along in the same shared payload
  return true;
}

function loadArchives(){
  return idbGet(IDB_ARCHIVE_KEY).then(function(parsed){
    if (!parsed) return [];
    var arr = Array.isArray(parsed) ? parsed : parsed.archives;
    return Array.isArray(arr) ? arr : [];
  });
}

// One-time migration: if IndexedDB is empty but a legacy localStorage payload
// exists, copy it into IndexedDB and clear the old key.
function migrateFromLocalStorage(){
  var raw = null;
  try { raw = window.localStorage.getItem(LS_KEY); } catch (e){ return Promise.resolve(null); }
  if (!raw) return Promise.resolve(null);
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e){ return Promise.resolve(null); }
  var arr = Array.isArray(parsed) ? parsed : (parsed && parsed.slides);
  if (!Array.isArray(arr) || !arr.length) return Promise.resolve(null);
  var payload = { savedAt: (parsed && parsed.savedAt) || Date.now(), slides: arr };
  return idbSet(IDB_KEY, payload).then(function(){
    try { window.localStorage.removeItem(LS_KEY); } catch (e){}
    return { slides: arr, savedAt: payload.savedAt };
  }).catch(function(){ return null; });
}

// live, mutable working set. Seeded from the deck baked into index.html, then
// overridden by anything previously saved to storage (see initSlides()).
var slides = SEED.slides.slice();
var restoredFrom = null;

// Async init: open IDB, migrate legacy data if needed, then load. Resolves when
// `slides` reflects persisted state (or the seed if none). Callers await this
// before the first render.
function initSlides(){
  return openIdb().then(function(db){
    _idb = db;
    HAS_STORAGE = !!db;
    if (!HAS_STORAGE) return null;
    return loadSavedSlides().then(function(saved){
      if (saved) return saved;
      return migrateFromLocalStorage(); // only runs if IDB had nothing
    });
  }).then(function(saved){
    if (saved){
      slides = saved.slides;
      restoredFrom = saved.savedAt;
    }
    // load archives too (independent of whether active slides were restored)
    return loadArchives().then(function(arr){
      archives = arr || [];
      return true;
    });
  }).catch(function(){
    HAS_STORAGE = false;
    return true;
  });
}

/* ============================================================
   STATE
   ============================================================ */
var state = {
  // nav: which left-sidebar item is active.
  //   browse view:  'browse'  (single tab; grouping controlled by state.view)
  //   admin panes:  'import' | 'export' | 'digest' | 'email'
  nav: 'browse',
  view: 'platform',            // grouping mode for the Browse tab: 'platform' | 'region'
  search: '',
  platforms: new Set(),        // empty set = "all"
  regions: new Set(),          // empty set = "all"
  dateFrom: '',
  dateTo: '',
  openCards: new Set(),
  sidebarOpen: false,          // mobile drawer
  importTab: 'pptx',           // 'pptx' | 'json'
  pptxPreview: null,           // array of parsed-but-unconfirmed slides
  emailAudience: '__all__',
  emailBaseUrl: '',
  execHtml: null,             // last generated executive email HTML (for preview/download/copy)
  digestHtml: null,           // last generated regional digest HTML
  selectedForDelete: new Set(),  // slide ids ticked in the Manage/Delete pane
  editDraft: null,            // in-progress add/edit entry (null until the Add pane builds one)
  present: { list: [], index: 0, dateFilter: '__all__' }  // presentation session: ordered slides + cursor + publish-date filter
};

var BROWSE_VIEWS = { browse: true };
function isBrowseNav(nav){ return !!BROWSE_VIEWS[nav]; }

var NAV_META = {
  browse:   { title: 'Browse updates', sub: 'Every update in one place — group by platform or region, filter, and search.' },
  present:  { title: 'Present', sub: 'Full-screen walkthrough, grouped by date, then region, then platform.' },
  add:      { title: 'Add entry', sub: 'Add a new update directly, or edit an existing one.' },
  import:   { title: 'Import slides', sub: 'Bring in a PowerPoint deck or a JSON backup.' },
  export:   { title: 'Export slides', sub: 'Download the current view as PDF or JSON.' },
  archive:  { title: 'Archive', sub: 'Set aside past entries to keep the current set clean. Restore or export any batch later.' },
  email:    { title: 'Generate email', sub: 'A leadership briefing you can preview and paste straight into your inbox.' },
  members:  { title: 'Members', sub: 'Create users and passwords, reset them, and manage who can access this tool.' }
};

/* ============================================================
   HELPERS
   ============================================================ */
function esc(str){
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function normalizePlatform(raw){
  if (!raw) return 'Others';
  var r = String(raw).trim().toLowerCase();
  for (var i=0;i<ALLOWED_PLATFORMS.length;i++){
    if (ALLOWED_PLATFORMS[i].toLowerCase() === r) return ALLOWED_PLATFORMS[i];
  }
  return 'Others';
}

function normalizeRegion(raw){
  if (!raw) return null;
  var r = String(raw).trim().toLowerCase();
  if (r === 'philipines') r = 'philippines'; // tolerate common misspelling
  for (var i=0;i<ALLOWED_REGIONS.length;i++){
    if (ALLOWED_REGIONS[i].toLowerCase() === r) return ALLOWED_REGIONS[i];
  }
  return null;
}

function nextId(){
  var max = 0;
  var scan = function(s){
    var n = parseInt(String(s.id||'').replace(/\D/g,''),10);
    if (!isNaN(n)) max = Math.max(max, n);
  };
  slides.forEach(scan);
  // also scan archived entries so restoring a batch can't collide with a new id
  archives.forEach(function(b){ (b.slides||[]).forEach(scan); });
  return 's' + String(max+1).padStart(3,'0');
}

function nextSlideNum(){
  var max = 0;
  slides.forEach(function(s){ if (typeof s.slide_num === 'number') max = Math.max(max, s.slide_num); });
  return max + 1;
}

/* ---- Archive operations ------------------------------------------ */
function newBatchId(){
  return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
}

// Move the given entry ids out of active `slides` into a new named batch.
function archiveEntries(ids, label){
  var idset = {};
  ids.forEach(function(id){ idset[id] = true; });
  var moved = slides.filter(function(s){ return idset[s.id]; });
  if (!moved.length) return null;
  slides = slides.filter(function(s){ return !idset[s.id]; });
  var batch = {
    id: newBatchId(),
    label: (label && label.trim()) || ('Archive ' + fmtDate(new Date().toISOString().slice(0,10))),
    archivedAt: Date.now(),
    slides: moved
  };
  archives.unshift(batch); // newest first
  // any archived entry that was open in the browse feed should close
  moved.forEach(function(s){ state.openCards.delete(s.id); });
  state.execHtml = null; state.digestHtml = null;
  saveSlides();
  saveArchives();
  return batch;
}

// Restore selected entries (or a whole batch) back into active `slides`.
// If an id would clash with a current active entry, it's given a fresh id.
function restoreFromBatch(batchId, ids){
  var batch = archives.find(function(b){ return b.id === batchId; });
  if (!batch) return 0;
  var idset = ids ? (function(){ var m={}; ids.forEach(function(i){ m[i]=true; }); return m; })() : null;
  var activeIds = {};
  slides.forEach(function(s){ activeIds[s.id] = true; });

  var toRestore = batch.slides.filter(function(s){ return !idset || idset[s.id]; });
  toRestore.forEach(function(s){
    var copy = JSON.parse(JSON.stringify(s));
    if (activeIds[copy.id]) copy.id = nextId(); // avoid collision
    activeIds[copy.id] = true;
    slides.push(copy);
  });
  // remove restored entries from the batch; drop the batch if now empty
  batch.slides = batch.slides.filter(function(s){ return !(!idset || idset[s.id]); });
  if (!batch.slides.length){
    archives = archives.filter(function(b){ return b.id !== batchId; });
  }
  state.execHtml = null; state.digestHtml = null;
  saveSlides();
  saveArchives();
  return toRestore.length;
}

function deleteBatch(batchId){
  archives = archives.filter(function(b){ return b.id !== batchId; });
  saveArchives();
}

function renameBatch(batchId, label){
  var batch = archives.find(function(b){ return b.id === batchId; });
  if (batch){ batch.label = label.trim() || batch.label; saveArchives(); }
}

function fmtDate(iso){
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function fmtStamp(ms){
  if (!ms) return '—';
  var d = new Date(ms);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function downloadBlob(filename, blob){
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function download(filename, content, mime){
  downloadBlob(filename, new Blob([content], { type: mime }));
}

function optionsHtml(options, selected){
  return options.map(function(o){
    return '<option value="'+esc(o)+'"'+(o===selected?' selected':'')+'>'+esc(o)+'</option>';
  }).join('');
}

/* ============================================================
   FILTERING
   ============================================================ */
function matchesFilters(s){
  if (state.platforms.size && !state.platforms.has(s.platform)) return false;
  if (state.regions.size && !state.regions.has(s.region)) return false;
  if (state.dateFrom && s.date && s.date < state.dateFrom) return false;
  if (state.dateTo && s.date && s.date > state.dateTo) return false;
  if (state.search){
    var q = state.search.toLowerCase();
    var hay = (s.title + ' ' + s.platform + ' ' + s.region + ' ' +
      s.body.map(function(b){
        if (b.type === 'rich') return richToText(b.html);
        if (b.type === 'table') return (b.rows||[]).map(function(r){ return r.join(' '); }).join(' ');
        return b.text || '';
      }).join(' ')).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

function filteredSlides(){
  return slides.filter(matchesFilters);
}

function groupAndOrder(list){
  var groups = {};
  var order = [];
  var keyOf = state.view === 'region' ? function(s){ return s.region; } : function(s){ return s.platform; };
  list.forEach(function(s){
    var k = keyOf(s);
    if (!groups[k]){ groups[k] = []; order.push(k); }
    groups[k].push(s);
  });
  var refOrder = state.view === 'region' ? ALLOWED_REGIONS : ALLOWED_PLATFORMS;
  order.sort(function(a,b){
    var ia = refOrder.indexOf(a), ib = refOrder.indexOf(b);
    if (ia === -1) ia = 999; if (ib === -1) ib = 999;
    return ia - ib;
  });
  return { groups: groups, order: order };
}

/* ============================================================
   RENDER: FILTER RAIL
   ============================================================ */
function renderFilterRail(){
  var rail = document.getElementById('filterRail');
  var all = slides;

  function chipsHtml(kind, options, activeSet){
    return options.map(function(opt){
      var n = all.filter(function(s){ return kind === 'platform' ? s.platform === opt : s.region === opt; }).length;
      var active = activeSet.has(opt);
      return '<button type="button" class="chip'+(active?' is-active':'')+'" data-kind="'+kind+'" data-value="'+esc(opt)+'">'
        + esc(opt) + '<span class="chip__count">' + n + '</span></button>';
    }).join('');
  }

  var hasActiveFilters = state.platforms.size || state.regions.size || state.dateFrom || state.dateTo || state.search;

  rail.innerHTML =
    '<div class="filtergroup">'
      + '<span class="filtergroup__label">Group by</span>'
      + '<div class="groupby" role="group" aria-label="Group updates by">'
        + '<button type="button" class="groupby__btn'+(state.view==='platform'?' is-active':'')+'" data-group="platform">Platform</button>'
        + '<button type="button" class="groupby__btn'+(state.view==='region'?' is-active':'')+'" data-group="region">Region</button>'
      + '</div>'
    + '</div>'
    + '<div class="filtergroup">'
      + '<span class="filtergroup__label">Platform</span>'
      + chipsHtml('platform', ALLOWED_PLATFORMS, state.platforms)
    + '</div>'
    + '<div class="filtergroup">'
      + '<span class="filtergroup__label">Region</span>'
      + chipsHtml('region', ALLOWED_REGIONS, state.regions)
    + '</div>'
    + '<div class="filtergroup">'
      + '<span class="filtergroup__label">Date</span>'
      + '<div class="daterange">'
        + '<input type="date" id="dateFrom" value="'+esc(state.dateFrom)+'" aria-label="From date">'
        + '<span>to</span>'
        + '<input type="date" id="dateTo" value="'+esc(state.dateTo)+'" aria-label="To date">'
      + '</div>'
      + (hasActiveFilters ? '<button type="button" class="filters__clear" id="clearFilters">Clear all filters</button>' : '')
    + '</div>';

  rail.querySelectorAll('.groupby__btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var g = btn.getAttribute('data-group');
      if (g === 'platform' || g === 'region'){ state.view = g; renderAll(); }
    });
  });

  rail.querySelectorAll('.chip').forEach(function(chip){
    chip.addEventListener('click', function(){
      var kind = chip.getAttribute('data-kind');
      var value = chip.getAttribute('data-value');
      var set = kind === 'platform' ? state.platforms : state.regions;
      if (set.has(value)) set.delete(value); else set.add(value);
      renderAll();
    });
  });

  document.getElementById('dateFrom').addEventListener('change', function(e){ state.dateFrom = e.target.value; renderAll(); });
  document.getElementById('dateTo').addEventListener('change', function(e){ state.dateTo = e.target.value; renderAll(); });

  var clearBtn = document.getElementById('clearFilters');
  if (clearBtn){
    clearBtn.addEventListener('click', function(){
      state.platforms.clear(); state.regions.clear();
      state.dateFrom = ''; state.dateTo = ''; state.search = '';
      document.getElementById('searchInput').value = '';
      renderAll();
    });
  }
}

/* ============================================================
   RENDER: BODY BLOCKS (shared by screen view and PDF export)
   ============================================================ */
function renderBody(body, forPrint){
  var html = '';
  body.forEach(function(b){
    if (b.type === 'rich'){
      // Rich blocks store already-sanitised HTML (see sanitizeRichHtml on save).
      // Render it directly rather than escaping. Empty rich blocks are skipped.
      var safe = sanitizeRichHtml(b.html || '');
      if (safe.trim()) html += '<div class="rich">'+safe+'</div>';
    } else if (b.type === 'header'){
      html += '<h4>'+esc(b.text)+'</h4>';
    } else if (b.type === 'para'){
      html += '<p>'+esc(b.text)+'</p>';
    } else if (b.type === 'bullet'){
      html += '<ul><li>'+esc(b.text)+'</li></ul>';
    } else if (b.type === 'image'){
      if (b.dataUrl){
        html += '<img class="'+(forPrint?'':'card__img')+'" src="'+b.dataUrl+'" alt="'+esc(b.file||'slide image')+'">';
      } else {
        html += '<div class="card__imgnote">🖼 '+esc(b.file || 'image')+' — no image data available for this slide (re-import it from the source .pptx to include the picture)</div>';
      }
    } else if (b.type === 'table' && Array.isArray(b.rows)){
      html += '<table>';
      b.rows.forEach(function(row, ri){
        var tag = ri === 0 ? 'th' : 'td';
        html += '<tr>' + row.map(function(cell){ return '<'+tag+'>'+esc(cell)+'</'+tag+'>'; }).join('') + '</tr>';
      });
      html += '</table>';
    }
  });
  html = html.replace(/<\/ul><ul>/g, '');
  return html;
}

/* ------------------------------------------------------------------
   RICH-TEXT SANITISER
   The detail editor is a contenteditable surface, so pasted content can carry
   arbitrary markup. On save (and again on render, defensively) we run it through
   a whitelist: only a small set of formatting tags and safe attributes survive.
   Everything else is unwrapped (keeping its text) or dropped. No <script>,
   <style>, event handlers, or javascript: URLs can get through.
   ------------------------------------------------------------------ */
var RICH_ALLOWED_TAGS = { B:1,STRONG:1,I:1,EM:1,U:1,H4:1,H5:1,UL:1,OL:1,LI:1,P:1,BR:1,A:1,SPAN:1,DIV:1,
  TABLE:1,THEAD:1,TBODY:1,TFOOT:1,TR:1,TD:1,TH:1 };
var RICH_ALLOWED_STYLES = { 'color':1, 'font-size':1, 'font-weight':1, 'text-decoration':1 };

function sanitizeRichHtml(html){
  if (!html) return '';
  var doc;
  try {
    doc = new DOMParser().parseFromString('<div id="__root">'+html+'</div>', 'text/html');
  } catch (e){ return ''; }
  var root = doc.getElementById('__root');
  if (!root) return '';

  (function walk(node){
    var children = Array.prototype.slice.call(node.childNodes);
    children.forEach(function(child){
      if (child.nodeType === 3) return;            // text: keep
      if (child.nodeType !== 1){ child.remove(); return; } // comments etc: drop

      var tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE'){ child.remove(); return; }

      if (!RICH_ALLOWED_TAGS[tag]){
        // unwrap: replace the element with its (recursively cleaned) children
        walk(child);
        while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
        child.remove();
        return;
      }

      // strip all attributes except a safe subset
      Array.prototype.slice.call(child.attributes).forEach(function(attr){
        var name = attr.name.toLowerCase();
        if (name === 'href' && tag === 'A'){
          var v = attr.value.trim();
          // only http/https/mailto; block javascript: and data: URLs
          if (!/^(https?:|mailto:)/i.test(v)){ child.removeAttribute(attr.name); }
        } else if (name === 'style'){
          var cleaned = cleanInlineStyle(attr.value);
          if (cleaned) child.setAttribute('style', cleaned); else child.removeAttribute('style');
        } else if ((name === 'colspan' || name === 'rowspan') && (tag === 'TD' || tag === 'TH')){
          if (!/^\d+$/.test(attr.value.trim())) child.removeAttribute(attr.name);
        } else {
          child.removeAttribute(attr.name);
        }
      });
      if (tag === 'A'){
        child.setAttribute('target','_blank');
        child.setAttribute('rel','noopener');
      }
      walk(child);
    });
  })(root);

  return root.innerHTML;
}

// Detect black / near-black colours that pasted content (Word, Google Docs,
// web pages) commonly injects. We drop these so text inherits the theme colour
// — dark ink on browse, light on the dark presentation background. Deliberate
// colours (blue, red, etc.) are kept.
function isDefaultBlack(val){
  var v = String(val).trim().toLowerCase().replace(/\s+/g,'');
  if (v === 'black' || v === '#000' || v === '#000000') return true;
  var m = v.match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/);
  if (m){
    var r = +m[1], g = +m[2], b = +m[3];
    if (r <= 51 && g <= 51 && b <= 51) return true;
  }
  var hx = v.match(/^#([0-9a-f]{6})$/);
  if (hx){
    var n = parseInt(hx[1],16);
    if (((n>>16)&255) <= 51 && ((n>>8)&255) <= 51 && (n&255) <= 51) return true;
  }
  return false;
}

function cleanInlineStyle(style){
  var out = [];
  String(style).split(';').forEach(function(decl){
    var idx = decl.indexOf(':');
    if (idx === -1) return;
    var prop = decl.slice(0, idx).trim().toLowerCase();
    var val = decl.slice(idx+1).trim();
    if (!RICH_ALLOWED_STYLES[prop]) return;
    if (/url\s*\(|expression|javascript:/i.test(val)) return; // no image/script tricks
    if (prop === 'color' && isDefaultBlack(val)) return; // inherit theme colour
    out.push(prop + ':' + val);
  });
  return out.join(';');
}

// Plain-text version of a rich block, used for search haystacks and excerpts.
function richToText(html){
  if (!html) return '';
  try {
    var doc = new DOMParser().parseFromString('<div>'+html+'</div>', 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g,' ').trim();
  } catch (e){ return ''; }
}

function excerptOf(s){
  for (var i=0;i<s.body.length;i++){
    var b = s.body[i];
    if (b.type === 'para' && b.text) return b.text;
    if (b.type === 'rich'){ var t = richToText(b.html); if (t) return t; }
  }
  return '';
}

/* ============================================================
   RENDER: CARD (screen)
   ============================================================ */
function renderCard(s){
  var isOpen = state.openCards.has(s.id);
  var initial = (s.platform || '?').charAt(0);
  return (
    '<article class="card" data-id="'+esc(s.id)+'">'
      + '<div class="card__badge" data-platform="'+esc(s.platform)+'">'+esc(initial)+'</div>'
      + '<div class="card__body">'
        + '<h3 class="card__title">'+esc(s.title)+'</h3>'
        + '<div class="card__meta">'
          + '<span class="pill">'+esc(s.platform)+'</span>'
          + '<span class="pill">'+esc(s.region)+'</span>'
          + (s.date ? '<span class="pill">'+esc(fmtDate(s.date))+'</span>' : '')
        + '</div>'
        + authorLine(s)
        + '<p class="card__excerpt">'+esc(excerptOf(s))+'</p>'
        + '<div class="card__row">'
          + (s.link ? '<a class="card__link" href="'+esc(s.link)+'" target="_blank" rel="noopener">Read more ↗</a>' : '<span></span>')
          + '<button type="button" class="card__toggle" data-id="'+esc(s.id)+'">'+(isOpen ? 'Hide details' : 'View full update')+'</button>'
        + '</div>'
        + '<div class="card__full'+(isOpen ? ' is-open':'')+'">'+renderBody(s.body, false)+'</div>'
      + '</div>'
    + '</article>'
  );
}

/* ============================================================
   RENDER: MAIN
   ============================================================ */
function renderMain(){
  var app = document.getElementById('app');
  var list = filteredSlides();

  if (!list.length){
    app.innerHTML = '<div class="empty">No updates match the current filters.</div>';
    return;
  }

  var g = groupAndOrder(list);
  var html = '';
  g.order.forEach(function(k){
    var items = g.groups[k];
    html += '<section class="group">'
      + '<div class="group__header">'
        + '<h2 class="group__title">'+esc(k)+'</h2>'
        + '<span class="group__meta">'+items.length+' update'+(items.length===1?'':'s')+'</span>'
      + '</div>'
      + items.map(renderCard).join('')
    + '</section>';
  });

  app.innerHTML = html;

  app.querySelectorAll('.card__toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-id');
      if (state.openCards.has(id)) state.openCards.delete(id); else state.openCards.add(id);
      renderMain();
    });
  });
}

/* ============================================================
   ADMIN: JSON IMPORT
   ============================================================ */
function setStatus(msg, ok){
  var el = document.getElementById('adminStatus');
  el.textContent = msg;
  el.className = 'adminpanel__status is-visible ' + (ok ? 'is-ok' : 'is-error');
}

function importSlides(raw, sourceLabel){
  var parsed;
  try{
    parsed = JSON.parse(raw);
  }catch(e){
    setStatus('Import failed — "'+sourceLabel+'" is not valid JSON. ('+e.message+')', false);
    return;
  }
  var items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.slides) ? parsed.slides : null);
  if (!items){
    setStatus('Import failed — expected a JSON array of slides, or an object with a "slides" array.', false);
    return;
  }

  var added = 0, skipped = 0, skippedReasons = [];
  items.forEach(function(item, idx){
    if (!item || !item.title || !Array.isArray(item.body) || !item.body.length){
      skipped++; skippedReasons.push('#'+(idx+1)+': missing title or body'); return;
    }
    var region = normalizeRegion(item.region);
    if (!region){
      skipped++; skippedReasons.push('#'+(idx+1)+' "'+item.title+'": unrecognised region "'+item.region+'"'); return;
    }
    var platform = normalizePlatform(item.platform);
    var date = (item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date)) ? item.date : '';

    slides.push({
      id: nextId(),
      platform: platform,
      region: region,
      date: date,
      date_range: item.date_range || '',
      title: String(item.title),
      link: item.link || '',
      body: item.body,
      slide_num: nextSlideNum()
    });
    added++;
  });

  if (added){ saveSlides(); renderAll(); }
  var msg = added + ' slide'+(added===1?'':'s')+' imported from "'+sourceLabel+'".';
  if (skipped) msg += ' ' + skipped + ' skipped — ' + skippedReasons.slice(0,4).join('; ') + (skippedReasons.length>4 ? '…' : '');
  setStatus(msg, added > 0 && skipped === 0);
}

/* ============================================================
   ADMIN: PPTX IMPORT
   ============================================================ */
function readFileAsArrayBuffer(file){
  return new Promise(function(resolve, reject){
    var r = new FileReader();
    r.onload = function(){ resolve(r.result); };
    r.onerror = function(){ reject(r.error); };
    r.readAsArrayBuffer(file);
  });
}

function xmlText(node){
  // collects all <a:t> text within a node, preserving run order
  var out = [];
  node.querySelectorAll('a\\:t, t').forEach(function(t){ out.push(t.textContent); });
  return out.join('');
}

function isBulletParagraph(pNode){
  var pPr = pNode.querySelector('a\\:pPr, pPr');
  if (!pPr) return false;
  return !!(pPr.querySelector('a\\:buChar, buChar, a\\:buAutoNum, buAutoNum'));
}

function extractTable(tblNode){
  var rows = [];
  tblNode.querySelectorAll('a\\:tr, tr').forEach(function(tr){
    var row = [];
    tr.querySelectorAll('a\\:tc, tc').forEach(function(tc){
      row.push(xmlText(tc).trim());
    });
    rows.push(row);
  });
  return rows;
}

function normalizePlatformStrict(raw){
  if (!raw) return null;
  var r = String(raw).trim().toLowerCase();
  for (var i=0;i<ALLOWED_PLATFORMS.length;i++){
    if (ALLOWED_PLATFORMS[i].toLowerCase() === r) return ALLOWED_PLATFORMS[i];
  }
  return null;
}

/* ------------------------------------------------------------------
   FUZZY, IN-TEXT DETECTION
   The strict "the whole text box equals a tag" rules almost never fire
   on real decks — the signal lives *inside* titles and body copy
   ("Singapore Jun 15-19", "Effective 6 Jul 2026", "(LSP or TikTok Shop)").
   These helpers scan a whole string for a region / platform / date.
   ------------------------------------------------------------------ */

// Extra spellings/aliases mapped to a canonical region.
var REGION_ALIASES = {
  'indonesia':'Indonesia', 'indo':'Indonesia', 'id':'Indonesia',
  'malaysia':'Malaysia', 'my':'Malaysia',
  'philippines':'Philippines', 'philipines':'Philippines', 'phillipines':'Philippines', 'ph':'Philippines', 'pinas':'Philippines',
  'singapore':'Singapore', 'sg':'Singapore',
  'thailand':'Thailand', 'th':'Thailand',
  'vietnam':'Vietnam', 'viet nam':'Vietnam', 'vn':'Vietnam'
};

// Find the first region named anywhere in a string. `allowShort` enables the
// 2-letter country codes (SG, MY…), which are only safe on short strings like a
// divider title — not in prose, where "my"/"id"/"th" appear as English words.
function findRegionInText(text, allowShort){
  if (!text) return null;
  var lower = ' ' + String(text).toLowerCase().replace(/[^a-z ]+/g,' ') + ' ';
  for (var i=0;i<ALLOWED_REGIONS.length;i++){
    var name = ALLOWED_REGIONS[i].toLowerCase();
    if (lower.indexOf(' '+name+' ') !== -1) return ALLOWED_REGIONS[i];
  }
  var longAliases = ['philipines','phillipines','viet nam','indo','pinas'];
  for (var a=0;a<longAliases.length;a++){
    if (lower.indexOf(' '+longAliases[a]+' ') !== -1) return REGION_ALIASES[longAliases[a]];
  }
  if (allowShort){
    var codes = ['id','my','ph','sg','th','vn'];
    for (var c=0;c<codes.length;c++){
      if (lower.indexOf(' '+codes[c]+' ') !== -1) return REGION_ALIASES[codes[c]];
    }
  }
  return null;
}

// Platform aliases → canonical. Includes common shorthand seen in decks.
var PLATFORM_ALIASES = {
  'lazada':'Lazada', 'laz':'Lazada',
  'shopee':'Shopee', 'shoppee':'Shopee', 'spx':'Shopee',
  'tiktok':'Tiktok', 'tik tok':'Tiktok', 'tiktok shop':'Tiktok', 'tts':'Tiktok',
  'zalora':'Zalora'
};
function findPlatformInText(text){
  if (!text) return null;
  var lower = ' ' + String(text).toLowerCase() + ' ';
  var keys = Object.keys(PLATFORM_ALIASES).sort(function(a,b){ return b.length - a.length; });
  for (var i=0;i<keys.length;i++){
    var k = keys[i];
    var re = new RegExp('(^|[^a-z])' + k.replace(/ /g,'\\s*') + '([^a-z]|$)', 'i');
    if (re.test(lower)) return PLATFORM_ALIASES[k];
  }
  return null;
}

// Map a hyperlink domain to a platform, e.g. seller-sg.tiktok.com -> Tiktok.
function platformFromUrl(url){
  if (!url) return null;
  var u = url.toLowerCase();
  if (u.indexOf('tiktok') !== -1) return 'Tiktok';
  if (u.indexOf('lazada') !== -1) return 'Lazada';
  if (u.indexOf('shopee') !== -1) return 'Shopee';
  if (u.indexOf('zalora') !== -1) return 'Zalora';
  return null;
}

// Also pull a region hint from the link's country TLD / subdomain
// (…tiktok.com/…-sg…, sellercenter.lazada.com.ph, seller.shopee.co.th).
var TLD_REGION = { ph:'Philippines', sg:'Singapore', my:'Malaysia', th:'Thailand', vn:'Vietnam', id:'Indonesia' };
function regionFromUrl(url){
  if (!url) return null;
  var u = url.toLowerCase();
  var m = u.match(/\.com\.([a-z]{2})\b/) || u.match(/\.co\.([a-z]{2})\b/) || u.match(/-([a-z]{2})\.tiktok/) || u.match(/seller-([a-z]{2})\./);
  if (m && TLD_REGION[m[1]]) return TLD_REGION[m[1]];
  return null;
}

var MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

function parseDateGuess(text, assumedYear){
  var iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  var m = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/i);
  if (m){
    var mm = MONTHS[m[1].toLowerCase().slice(0,3)];
    var dd = parseInt(m[2],10);
    var yyyy = m[3] ? parseInt(m[3],10) : (assumedYear || new Date().getFullYear());
    return yyyy + '-' + String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0');
  }
  return '';
}

// Finds a date anywhere in a string and returns ISO (start date if a range).
// Handles "Jun 15 - 19", "6 Jul 2026", "Effective 6 Jul 2026", "2026-07-06",
// "July 3, 2026" and "15/06/2026". Returns '' if nothing date-like is found.
function findDateInText(text, assumedYear){
  if (!text) return '';
  var t = String(text);
  var yFallback = assumedYear || new Date().getFullYear();

  // ISO first
  var iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  // "DD Mon [YYYY]" (day-first) e.g. "6 Jul 2026" — tried BEFORE month-first so
  // "Jul 2026" can't be misread as month=Jul, day=20.
  var df = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?/i);
  if (df){
    var mm2 = MONTHS[df[2].toLowerCase().slice(0,3)];
    var dd2 = parseInt(df[1],10);
    var yy2 = df[3] ? parseInt(df[3],10) : yFallback;
    if (dd2 >= 1 && dd2 <= 31)
      return yy2 + '-' + String(mm2).padStart(2,'0') + '-' + String(dd2).padStart(2,'0');
  }

  // "Mon DD[ - DD]" (month-first), optional year. The (?!\d) stops the day from
  // swallowing the first two digits of a following 4-digit year.
  var mf = t.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:\s*[–—-]\s*\d{1,2})?(?:\s*,?\s*(\d{4}))?/i);
  if (mf){
    var mm = MONTHS[mf[1].toLowerCase().slice(0,3)];
    var dd = parseInt(mf[2],10);
    var yy = mf[3] ? parseInt(mf[3],10) : yFallback;
    if (dd >= 1 && dd <= 31)
      return yy + '-' + String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0');
  }

  // numeric DD/MM/YYYY or D/M/YY
  var num = t.match(/\b(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})\b/);
  if (num){
    var d3 = parseInt(num[1],10), m3 = parseInt(num[2],10), y3 = parseInt(num[3],10);
    if (y3 < 100) y3 += 2000;
    if (m3 >= 1 && m3 <= 12 && d3 >= 1 && d3 <= 31)
      return y3 + '-' + String(m3).padStart(2,'0') + '-' + String(d3).padStart(2,'0');
  }
  return '';
}

// Only matches when the ENTIRE shape text is a date/date-range — used for
// dedicated "date tag" text boxes, not for dates mentioned inside prose.
function strictDateTag(raw){
  if (!raw) return '';
  var t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  var full = /^[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?\s*(?:[–—-]\s*[A-Za-z]{0,9}\.?\s*\d{1,2}(?:st|nd|rd|th)?(?:,?\s*\d{4})?)?$/;
  if (full.test(t)) return parseDateGuess(t);
  return '';
}

function parseSectionName(name){
  var out = { region: null, date: '' };
  var m = name.match(/^(.*?)\s*[\(\|]\s*([^)]+?)\s*\)?\s*$/);
  if (m){
    out.region = normalizeRegion(m[1].trim());
    out.date = strictDateTag(m[2].trim()) || parseDateGuess(m[2].trim());
  }
  if (!out.region) out.region = normalizeRegion(name.trim());
  return out;
}

// Reads PowerPoint's native "Sections" feature (presentation.xml + p14:sectionLst)
// and maps each slide path to the section name it belongs to, if any.
async function getSectionMap(zip, parser){
  var sectionOf = {};
  if (!zip.file('ppt/presentation.xml')) return sectionOf;

  var presXml = parser.parseFromString(await zip.file('ppt/presentation.xml').async('text'), 'application/xml');

  var idToRid = {};
  presXml.querySelectorAll('p\\:sldIdLst > p\\:sldId, sldIdLst > sldId').forEach(function(el){
    var id = el.getAttribute('id');
    var rid = el.getAttribute('r:id') || el.getAttribute('rid');
    if (id && rid) idToRid[id] = rid;
  });

  var ridToPath = {};
  if (zip.file('ppt/_rels/presentation.xml.rels')){
    var relsXml = parser.parseFromString(await zip.file('ppt/_rels/presentation.xml.rels').async('text'), 'application/xml');
    relsXml.querySelectorAll('Relationship').forEach(function(r){
      var target = r.getAttribute('Target');
      if (target && /slides\/slide\d+\.xml$/.test(target)){
        ridToPath[r.getAttribute('Id')] = 'ppt/' + target.replace(/^\.?\/?/, '');
      }
    });
  }

  presXml.querySelectorAll('p14\\:section, section').forEach(function(sec){
    var name = sec.getAttribute('name') || '';
    if (!name) return;
    sec.querySelectorAll('p14\\:sldId, sldId').forEach(function(sldIdEl){
      var rid = idToRid[sldIdEl.getAttribute('id')];
      var path = rid ? ridToPath[rid] : null;
      if (path) sectionOf[path] = name;
    });
  });

  return sectionOf;
}

function extExt(name){
  var m = /\.([a-zA-Z0-9]+)$/.exec(name);
  return m ? m[1].toLowerCase() : 'png';
}
function mimeFor(ext){
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/' + ext;
}

async function parsePptx(file){
  var buf = await readFileAsArrayBuffer(file);
  var zip = await JSZip.loadAsync(buf);

  var slidePaths = Object.keys(zip.files)
    .filter(function(p){ return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
    .sort(function(a,b){
      var na = parseInt(a.match(/slide(\d+)\.xml/)[1],10);
      var nb = parseInt(b.match(/slide(\d+)\.xml/)[1],10);
      return na - nb;
    });

  if (!slidePaths.length){
    throw new Error('No slides found — is this a valid .pptx file?');
  }

  var parser = new DOMParser();
  var sectionOf = await getSectionMap(zip, parser);
  var results = [];

  // Region/date carried forward from the most recent "divider" slide, so update
  // slides that don't restate their region still inherit it.
  var runningRegion = null;
  var runningDate = '';

  // Best-guess year for bare "Jun 15" style dates: the most common recent 4-digit
  // year appearing across the deck, else the current year.
  var deckYear = new Date().getFullYear();
  try {
    var yearCounts = {};
    for (var yp=0; yp<slidePaths.length; yp++){
      var yt = await zip.file(slidePaths[yp]).async('text');
      (yt.match(/\b(20\d{2})\b/g) || []).forEach(function(y){
        var n = parseInt(y,10);
        if (n >= 2015 && n <= new Date().getFullYear()+1) yearCounts[n] = (yearCounts[n]||0)+1;
      });
    }
    var best = null, bestN = 0;
    Object.keys(yearCounts).forEach(function(y){ if (yearCounts[y] > bestN){ bestN = yearCounts[y]; best = parseInt(y,10); } });
    if (best) deckYear = best;
  } catch(e){ /* keep default */ }

  for (var i=0; i<slidePaths.length; i++){
    var path = slidePaths[i];
    var slideNum = parseInt(path.match(/slide(\d+)\.xml/)[1],10);
    var xmlStr = await zip.file(path).async('text');
    var xml = parser.parseFromString(xmlStr, 'application/xml');

    // relationships (for resolving image r:embed ids AND external hyperlinks)
    var relsPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    var relMap = {};
    var hyperlinks = [];   // external URLs referenced anywhere on the slide
    if (zip.file(relsPath)){
      var relXmlStr = await zip.file(relsPath).async('text');
      var relXml = parser.parseFromString(relXmlStr, 'application/xml');
      relXml.querySelectorAll('Relationship').forEach(function(r){
        var id = r.getAttribute('Id');
        var target = r.getAttribute('Target');
        relMap[id] = target;
        var type = r.getAttribute('Type') || '';
        var mode = r.getAttribute('TargetMode') || '';
        if ((/hyperlink/i.test(type) || mode === 'External') && /^https?:\/\//i.test(target || '')){
          hyperlinks.push(target);
        }
      });
    }
    var slideLink = hyperlinks.length ? hyperlinks[0] : '';

    // walk top-level shape tree in document order for text + tables + pics
    var body = [];
    var images = [];
    var titleText = '';
    var detectedPlatform = null;
    var detectedRegion = null;
    var detectedDate = '';

    var spTree = xml.querySelector('p\\:cSld p\\:spTree, cSld spTree');
    var nodes = spTree ? Array.prototype.slice.call(spTree.children) : [];

    for (var n=0; n<nodes.length; n++){
      var node = nodes[n];
      var tag = node.tagName.replace(/^p:/,'').replace(/^.*:/,'');

      // Collect any embedded pictures anywhere inside this node — this covers
      // standalone <p:pic> shapes AND pictures nested inside grouped shapes
      // (<p:grpSp>), which a tag==='pic' check alone would miss.
      var blips = node.querySelectorAll('a\\:blip, blip');
      for (var bi=0; bi<blips.length; bi++){
        var blip = blips[bi];
        var rId = blip.getAttribute('r:embed') || blip.getAttribute('embed');
        var target = rId ? relMap[rId] : null;
        if (!target) continue;
        var mediaPath = new URL(target, 'file:///ppt/slides/').pathname.replace(/^\//,''); // resolves ../media/...
        if (!zip.file(mediaPath)) continue;
        var base64 = await zip.file(mediaPath).async('base64');
        var ext = extExt(mediaPath);
        images.push({ file: mediaPath.split('/').pop(), dataUrl: 'data:' + mimeFor(ext) + ';base64,' + base64 });
      }

      if (tag === 'sp'){ // text shape
        var shapeWhole = xmlText(node).trim();

        // a shape whose ENTIRE text is exactly a platform / region / date
        // is treated as a tag, not as slide content.
        var platTag = normalizePlatformStrict(shapeWhole);
        var regTag = shapeWhole ? normalizeRegion(shapeWhole) : null;
        var dateTag = strictDateTag(shapeWhole);

        if (platTag){ detectedPlatform = platTag; continue; }
        if (regTag){ detectedRegion = regTag; continue; }
        if (dateTag){ detectedDate = dateTag; continue; }

        var paras = node.querySelectorAll('a\\:p, p');
        paras.forEach(function(p){
          var text = xmlText(p).trim();
          if (!text) return;
          if (!titleText){ titleText = text; return; }
          body.push({ type: isBulletParagraph(p) ? 'bullet' : 'para', text: text });
        });
      } else if (tag === 'graphicFrame'){ // table
        var tbl = node.querySelector('a\\:tbl, tbl');
        if (tbl){
          var rows = extractTable(tbl);
          if (rows.length) body.push({ type: 'table', rows: rows });
        }
      }
    }

    if (!titleText && !body.length && !images.length) continue; // skip fully empty slides

    images.forEach(function(img){ body.push({ type: 'image', file: img.file, dataUrl: img.dataUrl }); });

    // ---- Pull every scrap of text we can match against ----
    var bodyText = body.map(function(b){ return b.text || ''; }).join('  ');
    var allText  = (titleText + '  ' + bodyText).trim();

    var sectionInfo = sectionOf[path] ? parseSectionName(sectionOf[path]) : null;

    // A "divider" slide is short, names a region, and has little/no body — the
    // classic section-header slide ("Singapore  Jun 15 - 19", or just "Malaysia").
    // It sets the running region/date for the slides that follow, and is skipped
    // itself. It also covers the case where a standalone region text box was
    // already consumed above into detectedRegion, leaving titleText empty.
    var titleRegionShort = findRegionInText(titleText, true) || detectedRegion;
    var hasContent = body.length || images.length;
    var isDivider = !hasContent && !!titleRegionShort && (titleText.length < 60);

    // ---- REGION: own detection first, then carry-forward, then link/section ----
    var ownRegion =
        detectedRegion
        || (sectionInfo && sectionInfo.region)
        || findRegionInText(titleText, true)      // short: allow "SG"/"MY"
        || regionFromUrl(slideLink)
        || findRegionInText(bodyText, false);     // prose: full names only

    if (isDivider){
      runningRegion = titleRegionShort;
      var ddate = detectedDate || (sectionInfo && sectionInfo.date) || findDateInText(titleText, deckYear);
      runningDate = ddate || '';   // reset so a new section doesn't keep the old date
      continue; // don't import the divider slide itself
    }

    var finalRegion = ownRegion || runningRegion || null;
    var regionInherited = !ownRegion && !!finalRegion;

    // ---- DATE: own detection first. Only fall back to the divider's running
    // date when this slide is actually part of that carried-over section
    // (i.e. it didn't state its own region), so a new region can't inherit a
    // previous section's dates.
    var finalDate =
        detectedDate
        || (sectionInfo && sectionInfo.date)
        || findDateInText(titleText, deckYear)
        || findDateInText(bodyText, deckYear)
        || (regionInherited ? runningDate : '')
        || '';

    // ---- PLATFORM: explicit tag, else link domain, else text mention ----
    var finalPlatform =
        detectedPlatform
        || platformFromUrl(slideLink)
        || findPlatformInText(titleText)
        || findPlatformInText(bodyText)
        || 'Others';
    var platformDetected = !!(detectedPlatform || platformFromUrl(slideLink) || findPlatformInText(allText));

    // ---- TITLE cleanup: strip the "(LINK)" marker and a leading region label ----
    var cleanTitle = (titleText || ('Slide ' + slideNum))
      .replace(/\s*\(link\)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    results.push({
      slide_num: slideNum,
      title: cleanTitle,
      body: body,
      link: slideLink,
      thumb: images.length ? images[0].dataUrl : null,
      platform: finalPlatform,
      platformDetected: platformDetected,
      region: finalRegion,
      regionInherited: regionInherited,   // flag carry-forward for the UI
      date: finalDate,
      sectionName: sectionOf[path] || ''
    });
  }

  return results;
}

function renderPptxPreview(){
  var container = document.getElementById('pptxPreviewWrap');
  if (!state.pptxPreview){ container.innerHTML = ''; return; }

  var all = state.pptxPreview;
  var needsRegion = all.filter(function(i){ return !i.region; }).length;
  var readyCount  = all.length - needsRegion;
  all.forEach(function(item){ if (item.include === undefined) item.include = !!item.region; });

  if (state.pptxOnlyIssues === undefined) state.pptxOnlyIssues = false;

  var rows = all.map(function(item, idx){ return { item:item, idx:idx }; });
  if (state.pptxOnlyIssues) rows = rows.filter(function(r){ return !r.item.region; });

  var rowsHtml = rows.map(function(r){
    var item = r.item, idx = r.idx;
    var thumb = item.thumb
      ? '<img class="pptxrow__thumb" src="'+item.thumb+'" alt="">'
      : '<div class="pptxrow__thumb pptxrow__thumb--empty">no image</div>';
    var imgCount = item.body.filter(function(b){ return b.type==='image'; }).length;
    var regionOptions = (item.region ? '' : '<option value="" selected disabled>Select region…</option>') + optionsHtml(ALLOWED_REGIONS, item.region);

    // Region status note: error only when nothing was found; otherwise a quiet
    // "auto-detected" / "inherited from divider" confirmation.
    var regionNote;
    if (!item.region){
      regionNote = '<div class="pptxrow__flag">&#9888; Region not found in this slide &mdash; pick one, or it&#8217;ll be skipped.</div>';
    } else if (item.regionInherited){
      regionNote = '<div class="pptxrow__ok pptxrow__ok--soft">&#8618; Region carried over from the section divider</div>';
    } else {
      regionNote = '<div class="pptxrow__ok">&#10003; Read from the slide</div>';
    }

    var platNote = item.platformDetected ? '' : '<span class="pptxrow__imgcount">(defaulted)</span>';
    var linkNote = item.link ? '<span class="pptxrow__imgcount">&#128279; link</span>' : '';
    var sourceNote = item.sectionName ? '<span class="pptxrow__imgcount">Section: '+esc(item.sectionName)+'</span>' : '';

    return '<div class="pptxrow'+(item.region?'':' pptxrow--warn')+'" data-idx="'+idx+'">'
      + thumb
      + '<input type="checkbox" class="pptxrow__include" data-idx="'+idx+'" '+(item.include===false?'':'checked')+'>'
      + '<div class="pptxrow__main">'
        + '<input type="text" class="pptxrow__title" data-idx="'+idx+'" value="'+esc(item.title)+'">'
        + '<div class="pptxrow__meta">'
          + '<select data-idx="'+idx+'" data-field="platform">'+optionsHtml(ALLOWED_PLATFORMS, item.platform)+'</select>'+platNote
          + '<select data-idx="'+idx+'" data-field="region">'+regionOptions+'</select>'
          + '<input type="date" data-idx="'+idx+'" data-field="date" value="'+esc(item.date)+'">'
          + (imgCount ? '<span class="pptxrow__imgcount">'+imgCount+' image'+(imgCount===1?'':'s')+'</span>' : '')
          + linkNote
          + sourceNote
        + '</div>'
        + regionNote
      + '</div>'
    + '</div>';
  }).join('');

  var summary =
    '<div class="pptxsummary">'
      + '<div class="pptxsummary__main">'
        + '<strong>'+all.length+'</strong> slide'+(all.length===1?'':'s')+' read'
        + ' &nbsp;&middot;&nbsp; <span class="pptxsummary__ok">'+readyCount+' ready to import</span>'
        + (needsRegion ? ' &nbsp;&middot;&nbsp; <span class="pptxsummary__warn">'+needsRegion+' need a region</span>' : ' &nbsp;&middot;&nbsp; region, platform &amp; date detected automatically')
      + '</div>'
      + (needsRegion ? '<label class="pptxsummary__toggle"><input type="checkbox" id="pptxOnlyIssues"'+(state.pptxOnlyIssues?' checked':'')+'> Show only slides needing a region</label>' : '')
    + '</div>';

  container.innerHTML =
    summary
    + '<div class="pptxpreview">'+(rowsHtml || '<div style="padding:16px;color:var(--muted);font-size:13px;">Nothing to show with this filter.</div>')+'</div>'
    + '<div class="adminpanel__row" style="margin-top:12px;align-items:center;">'
      + '<button type="button" class="btn" id="pptxConfirmBtn">Import '+readyCount+' ready slide'+(readyCount===1?'':'s')+'</button>'
      + (needsRegion ? '<span style="font-size:12px;color:var(--muted);">'+needsRegion+' slide'+(needsRegion===1?'':'s')+' without a region will be skipped unless you set one.</span>' : '')
    + '</div>';

  var onlyToggle = document.getElementById('pptxOnlyIssues');
  if (onlyToggle) onlyToggle.addEventListener('change', function(){ state.pptxOnlyIssues = onlyToggle.checked; renderPptxPreview(); });

  container.querySelectorAll('.pptxrow__title').forEach(function(el){
    el.addEventListener('input', function(){ state.pptxPreview[+el.dataset.idx].title = el.value; });
  });
  container.querySelectorAll('select[data-field]').forEach(function(el){
    el.addEventListener('change', function(){
      state.pptxPreview[+el.dataset.idx][el.dataset.field] = el.value;
      if (el.dataset.field === 'region'){
        state.pptxPreview[+el.dataset.idx].regionInherited = false;
        state.pptxPreview[+el.dataset.idx].include = true;
        renderPptxPreview();
      }
    });
  });
  container.querySelectorAll('input[type="date"][data-field]').forEach(function(el){
    el.addEventListener('change', function(){ state.pptxPreview[+el.dataset.idx][el.dataset.field] = el.value; });
  });
  container.querySelectorAll('.pptxrow__include').forEach(function(el){
    el.addEventListener('change', function(){ state.pptxPreview[+el.dataset.idx].include = el.checked; });
  });
  document.getElementById('pptxConfirmBtn').addEventListener('click', confirmPptxImport);
}

function confirmPptxImport(){
  if (!state.pptxPreview) return;

  var added = 0, skippedNoRegion = 0;
  state.pptxPreview.forEach(function(item){
    if (item.include === false) return;
    var region = normalizeRegion(item.region);
    if (!region){ skippedNoRegion++; return; }
    slides.push({
      id: nextId(),
      platform: normalizePlatform(item.platform),
      region: region,
      date: item.date || '',
      date_range: '',
      title: item.title || ('Slide ' + item.slide_num),
      link: item.link || '',
      body: item.body,
      slide_num: nextSlideNum()
    });
    added++;
  });

  state.pptxPreview = null;
  document.getElementById('pptxPreviewWrap').innerHTML = '';
  renderAll();
  var msg = added + ' slide'+(added===1?'':'s')+' imported from PowerPoint.';
  if (skippedNoRegion) msg += ' ' + skippedNoRegion + ' skipped — no region selected.';
  setStatus(msg, added > 0 && !skippedNoRegion);
}

/* ============================================================
   ADMIN: EXPORT
   ============================================================ */
function currentExportScope(){
  var scopeEl = document.querySelector('input[name="exportScope"]:checked');
  return scopeEl ? scopeEl.value : 'filtered';
}

function exportJson(listArg, labelArg){
  var scope = currentExportScope();
  var list = listArg || (scope === 'filtered' ? filteredSlides() : slides);
  if (!list.length){ setStatus('Nothing to export — the current selection has no slides.', false); return; }
  var stamp = new Date().toISOString().slice(0,10);
  var payload = {
    allowed_platforms: ALLOWED_PLATFORMS,
    allowed_regions: ALLOWED_REGIONS,
    exported_at: new Date().toISOString(),
    scope: labelArg || scope,
    slides: list
  };
  var slug = (labelArg ? labelArg.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : scope) || 'export';
  download('newsletter-updates-'+slug+'-'+stamp+'.json', JSON.stringify(payload, null, 2), 'application/json');
  setStatus('Exported '+list.length+' slide'+(list.length===1?'':'s')+' as JSON. Use this file to re-import into this tool.', true);
}

// Export the current scope as a standalone .html file using the SAME styled
// layout as Generate email — reporting period, summary, per-platform counts, and
// every update (ordered by urgency) with its platform badge and source link.
// This is the "include the source" export: each entry's source URL is rendered
// exactly as it is in the email ("Read more →"), so the file is a self-contained,
// forwardable copy of the briefing.
function exportEmailHtml(listArg, labelArg){
  var scope = currentExportScope();
  var list = listArg || (scope === 'filtered' ? filteredSlides() : slides);
  if (!list.length){ setStatus('Nothing to export — the current selection has no slides.', false); return; }

  var baseUrl = state.emailBaseUrl || '';
  var criticalList = pickCriticalUpdates(list);           // all, ranked by urgency
  var periodLabel = reportingPeriodLabel(list);

  var html = buildExecEmailHtml(list, criticalList, { periodLabel: periodLabel, baseUrl: baseUrl, thumbs: {} });

  var stamp = new Date().toISOString().slice(0,10);
  var slug = (labelArg ? labelArg.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : scope) || 'export';
  download('newsletter-email-'+slug+'-'+stamp+'.html', html, 'text/html');
  setStatus('Exported '+list.length+' update'+(list.length===1?'':'s')+' as a styled email (.html), source links included. Open it to read, forward it, or select-all and paste into Gmail/Outlook.', true);
}

function buildPrintDoc(list, titleLabel){
  var g = groupAndOrder(list);
  var scopeLabel = titleLabel || (currentExportScope() === 'all' ? 'All updates' : 'Filtered view');
  var html = '<div class="pdf-doc">'
    + '<h1 class="pdf-doc__title">Platform Updates</h1>'
    + '<p class="pdf-doc__sub">'+esc(scopeLabel)+' · Grouped by '+(state.view === 'region' ? 'Region' : 'Platform')+' · Exported '+esc(new Date().toLocaleString())+' · '+list.length+' update'+(list.length===1?'':'s')+'</p>';

  g.order.forEach(function(k){
    html += '<div class="pdf-group"><h2 class="pdf-group__title">'+esc(k)+'</h2>';
    g.groups[k].forEach(function(s){
      html += '<div class="pdf-card">'
        + '<h3 class="pdf-card__title">'+esc(s.title)+'</h3>'
        + '<div class="pdf-card__meta">'+esc(s.platform)+' · '+esc(s.region)+(s.date ? ' · '+esc(fmtDate(s.date)) : '')+'</div>'
        + renderBody(s.body, true)
        + (s.link ? '<div class="pdf-card__link"><a href="'+esc(s.link)+'">Read more \u2197</a></div>' : '')
      + '</div>';
    });
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function exportPdf(listArg, labelArg){
  var scope = currentExportScope();
  var list = listArg || (scope === 'filtered' ? filteredSlides() : slides);
  if (!list.length){ setStatus('Nothing to export — the current selection has no slides.', false); return; }

  var printArea = document.getElementById('printArea');
  printArea.innerHTML = buildPrintDoc(list, labelArg);

  var imgs = Array.prototype.slice.call(printArea.querySelectorAll('img'));
  if (!imgs.length){
    setStatus('Opening print dialog — choose "Save as PDF" as the destination to download a PDF file.', true);
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ window.print(); }); });
    return;
  }

  setStatus('Preparing PDF — loading '+imgs.length+' image'+(imgs.length===1?'':'s')+'…', true);

  var waits = imgs.map(function(img){
    // decode() resolves once the browser has actually finished decoding pixels,
    // which is what print rasterization needs — .complete alone isn't enough.
    if (img.complete && img.naturalWidth > 0 && img.decode) return img.decode().catch(function(){});
    return new Promise(function(resolve){
      var done = function(){ img.removeEventListener('load', done); img.removeEventListener('error', done); resolve(); };
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  });

  var safetyTimeout = new Promise(function(resolve){ setTimeout(resolve, 6000); });

  Promise.race([Promise.all(waits), safetyTimeout]).then(function(){
    setStatus('Opening print dialog — choose "Save as PDF" as the destination to download a PDF file.', true);
    // two animation frames to make sure the browser has actually painted before print() rasterizes
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ window.print(); }); });
  });
}

/* ============================================================
   ADMIN: EMAIL DIGEST EXPORT
   ============================================================ */

// slides matching current Platform/Date/Search filters, with Region driven
// by `region` (a single region, or null for "all regions") rather than the
// on-screen region chips — the audience picker is the source of truth here.
function slidesForAudience(region){
  return slides.filter(function(s){
    if (state.platforms.size && !state.platforms.has(s.platform)) return false;
    if (state.dateFrom && s.date && s.date < state.dateFrom) return false;
    if (state.dateTo && s.date && s.date > state.dateTo) return false;
    if (state.search){
      var q = state.search.toLowerCase();
      var hay = (s.title + ' ' + s.platform + ' ' + s.region + ' ' +
        s.body.map(function(b){ return b.text || ''; }).join(' ')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    if (region && s.region !== region) return false;
    return true;
  });
}

// Trims to a whole number of SENTENCES, never mid-clause. The old version sliced
// at a character count, which is what produced hanging fragments like
// "…currently implemented in La…" in the email.
//
// Walks sentence-ending punctuation and keeps whole sentences while they fit
// under `max`. Always returns at least one complete sentence, even if that one
// sentence overshoots `max` — an over-long complete thought beats a truncated
// one. Only falls back to an ellipsis if a single sentence is absurdly long
// (>2x max), where showing it whole would defeat the point of a summary.
function shortExcerpt(s, max){
  var t = (excerptOf(s) || '').trim();
  if (!t) return '';

  // Split on ., ! or ? followed by whitespace. The lookbehind-free form keeps the
  // punctuation attached to the sentence it ends.
  var parts = t.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [t];

  // Drop sentences that are bare lead-ins to a list — "Rights owners can use the
  // IPPC to:" ends on valid punctuation but is a stub pointing at bullets the
  // email doesn't show, so it reads as truncated. Keep at least one sentence.
  var usable = parts.filter(function(p){ return !/:\s*$/.test(p.trim()); });
  if (usable.length) parts = usable;

  var out = '';
  for (var i = 0; i < parts.length; i++){
    var next = out + parts[i];
    if (out && next.trim().length > max) break;
    out = next;
  }
  out = out.trim();

  if (!out) {
    // First sentence alone already exceeds max.
    var first = parts[0].trim();
    if (first.length <= max * 2) return first;          // let it run — it's whole
    return first.slice(0, max - 1).replace(/\s+\S*$/, '').trim() + '…';  // last resort, cut on a word
  }
  return out;
}

function toolLink(baseUrl, s){
  if (!baseUrl) return '';
  var url = baseUrl.replace(/\/$/, '') + '?region=' + encodeURIComponent(s.region) + '&platform=' + encodeURIComponent(s.platform);
  return url + '#slide-' + encodeURIComponent(s.id);
}

function buildEmailHtml(list, opts){
  opts = opts || {};
  var audienceLabel = opts.audienceLabel || 'All regions';
  var groupByRegion = !!opts.groupByRegion;
  var baseUrl = (opts.baseUrl || '').trim();

  var platformCounts = {};
  var regionCounts = {};
  list.forEach(function(s){
    platformCounts[s.platform] = (platformCounts[s.platform]||0) + 1;
    regionCounts[s.region] = (regionCounts[s.region]||0) + 1;
  });
  var platformBreakdown = ALLOWED_PLATFORMS.filter(function(p){ return platformCounts[p]; })
    .map(function(p){ return p + ' ' + platformCounts[p]; }).join(' &nbsp;·&nbsp; ');
  var regionBreakdown = groupByRegion
    ? ALLOWED_REGIONS.filter(function(r){ return regionCounts[r]; })
        .map(function(r){ return r + ' ' + regionCounts[r]; }).join(' &nbsp;·&nbsp; ')
    : '';
  var tldr = list.length
    ? list.length + ' update' + (list.length===1?'':'s') + (groupByRegion ? ' across ' + Object.keys(regionCounts).length + ' region'+(Object.keys(regionCounts).length===1?'':'s') : '') + '. ' + platformBreakdown
    : 'No updates for this issue.';

  // group: by region (top level) for the "all regions" digest, matching the
  // tool's own "By Region (Email view)"; by platform for a single-region digest.
  var groups = {}; var order = [];
  var keyOf = groupByRegion ? function(s){ return s.region; } : function(s){ return s.platform; };
  var refOrder = groupByRegion ? ALLOWED_REGIONS : ALLOWED_PLATFORMS;
  list.forEach(function(s){
    var k = keyOf(s);
    if (!groups[k]){ groups[k]=[]; order.push(k); }
    groups[k].push(s);
  });
  order.sort(function(a,b){
    var ia = refOrder.indexOf(a), ib = refOrder.indexOf(b);
    if (ia===-1) ia=999; if (ib===-1) ib=999;
    return ia-ib;
  });

  var stamp = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });

  var itemsHtml = order.map(function(k){
    var items = groups[k];
    var rows = items.map(function(s){
      var accent = PLATFORM_BADGE_COLOR[s.platform] || '#1b2a4a';
      var linkEl = s.link
        ? '<a href="'+esc(s.link)+'" style="font-size:13px;font-weight:bold;color:#111111;text-decoration:none;">'
            + '<font color="#111111" style="color:#111111;">Read more &#8594;</font></a>'
        : '';

      // No inline expander. <details> is ignored by Outlook, which renders the
      // summary label as dead text and dumps the whole body out beneath it —
      // the opposite of a shorter email. The body lives on the vendor's page and
      // in the interactive tool; the email carries a clean summary and a link.
      return ''
        + '<tr><td style="padding:0;border-bottom:1px solid #e4e1da;font-family:Arial,Helvetica,sans-serif;">'
          + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>'
            + '<td bgcolor="'+accent+'" width="4" style="background-color:'+accent+';width:4px;font-size:0;line-height:0;">&nbsp;</td>'
            + '<td valign="top" style="padding:16px 12px 16px 18px;width:40px;">' + platformBadge(s.platform, 40) + '</td>'
            + '<td valign="top" style="padding:16px 28px 16px 0;">'
              + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;margin-bottom:5px;">' + platformRegionMeta(s) + '</div>'
              + '<div style="font-size:16px;font-weight:700;color:#141414;margin-bottom:6px;line-height:1.3;">'+esc(s.title)+'</div>'
              + '<div style="font-size:15px;color:#333333;line-height:1.6;margin-bottom:8px;">'+esc(shortExcerpt(s,180))+'</div>'
              + linkEl
            + '</td>'
          + '</tr></table>'
        + '</td></tr>';
    }).join('');
    return ''
      + '<tr><td style="padding:22px 32px 2px;font-family:Arial,Helvetica,sans-serif;">'
        + '<div style="font-size:16px;font-weight:700;color:#141414;border-bottom:2px solid #141414;padding-bottom:7px;">'+esc(k)+' <span style="font-weight:400;color:#6b6b6b;font-size:12px;">('+items.length+')</span></div>'
      + '</td></tr>'
      + rows;
  }).join('');

  var digestLink = baseUrl ? '<a href="'+esc(baseUrl)+'" style="font-size:12.5px;color:#c1440e;text-decoration:none;font-weight:600;">Open the full interactive digest &#8594;</a>' : '';

  return '<!doctype html>'
+ '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">'
+ '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
+ '<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->'
+ '<title>Platform Updates — '+esc(audienceLabel)+'</title></head>'
+ '<body style="margin:0;padding:0;background:#f2f0eb;">'
+ '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f0eb;"><tr><td align="center" style="padding:24px 12px;">'
+ '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:640px;width:100%;border:1px solid #e4e1da;">'
  + '<tr><td style="padding:30px 32px 6px;font-family:Arial,Helvetica,sans-serif;">'
    + '<div style="font-family:\'Courier New\',monospace;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#c1440e;">Company Newsletter</div>'
    + '<div style="font-size:26px;font-weight:800;color:#141414;margin-top:4px;font-family:Arial,Helvetica,sans-serif;">Platform Updates</div>'
    + '<div style="font-size:12.5px;color:#6b6b6b;margin-top:5px;">'+esc(audienceLabel)+' &nbsp;·&nbsp; '+esc(stamp)+'</div>'
  + '</td></tr>'
  + '<tr><td style="padding:16px 32px 4px;">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;border:1px solid #e4e1da;">'
      + '<tr><td style="padding:15px 18px;font-family:Arial,Helvetica,sans-serif;">'
        + '<div style="font-size:12.5px;font-weight:700;color:#141414;margin-bottom:5px;">This issue at a glance</div>'
        + '<div style="font-size:12.5px;color:#333333;line-height:1.6;">'+tldr+'</div>'
        + (regionBreakdown ? '<div style="font-size:11.5px;color:#6b6b6b;margin-top:6px;">'+regionBreakdown+'</div>' : '')
      + '</td></tr>'
    + '</table>'
  + '</td></tr>'
  + itemsHtml
  + '<tr><td style="padding:22px 32px 28px;border-top:1px solid #e4e1da;font-family:Arial,Helvetica,sans-serif;">'
    + (digestLink ? '<div style="margin-bottom:8px;">'+digestLink+'</div>' : '')
    + '<div style="font-size:11px;color:#9a9791;">Generated automatically. Spot something off? Flag it to the PIC.</div>'
  + '</td></tr>'
+ '</table>'
+ '</td></tr></table>'
+ '</body></html>';
}


/* ============================================================
   ADMIN: EXECUTIVE EMAIL ("Generate Email")
   ------------------------------------------------------------
   A single, leadership-facing digest: reporting period, a short
   auto-generated summary, per-platform counts, the 3-5 updates
   flagged as most critical, and a CTA back into the full tool.

   Note on "AI-generated": this runs entirely in the browser, so
   the summary is produced by a rules/heuristic engine below, not
   a live model call (a static page has nowhere safe to hold an
   API key). If a backend/proxy endpoint is ever added, swap the
   body of generateExecSummary() for that call.
   ============================================================ */

function reportingPeriodLabel(list){
  var dates = list.map(function(s){ return s.date; }).filter(Boolean).sort();
  if (dates.length){
    var min = dates[0], max = dates[dates.length-1];
    return min === max ? fmtDate(min) : (fmtDate(min) + ' – ' + fmtDate(max));
  }
  var dr = list.map(function(s){ return s.date_range; }).filter(Boolean)[0];
  return dr || 'Current period';
}

// The "Period covered — label" (free-form date_range on the entries) is used as
// the headline period in the email intro. Falls back to the computed reporting
// period when no label was set.
function periodCoveredLabel(list){
  var dr = list.map(function(s){ return s.date_range; }).filter(Boolean)[0];
  return dr || reportingPeriodLabel(list);
}

// Default leadership-facing intro line that opens the Executive Summary, e.g.
// "Key highlights for Jun 29 – Jul 3 from Lazada, Shopee, Tiktok and Zalora."
// Lists the platforms that actually have updates in scope, in the canonical order.
function execIntroLine(list){
  return 'Key highlights for ' + periodCoveredLabel(list) + ' from Lazada, Shopee, TikTok and Zalora.';
}

// Heuristic 0+ score — higher means more likely to need seller/leadership attention.
function scoreCriticality(s){
  var score = 0;
  var title = (s.title || '').toLowerCase();
  var bodyText = s.body.map(function(b){ return b.text || ''; }).join(' ').toLowerCase();
  var all = title + ' ' + bodyText;

  if (/\[important/.test(title) || /important update/.test(title)) score += 4;
  if (/effective|deadline|required|mandatory|must\b|penalty|violation|masked|restrict|prohibit|not allowed/.test(all)) score += 2;
  if (/protection|privacy|compliance|policy|infringement/.test(all)) score += 2;
  if (/claims?\b/.test(title)) score += 1;

  if (s.date){
    var diffDays = (new Date(s.date + 'T00:00:00') - new Date()) / 86400000;
    if (diffDays >= 0 && diffDays <= 14) score += 1; // taking effect soon
  }
  return score;
}

// Ranks the list by criticality (most urgent first). Pass `n` to cap the result;
// omit it to get every update back, still in ranked order.
function pickCriticalUpdates(list, n){
  var scored = list.map(function(s){ return { s: s, score: scoreCriticality(s) }; });
  scored.sort(function(a, b){
    if (b.score !== a.score) return b.score - a.score;
    return (b.s.date || '').localeCompare(a.s.date || ''); // ties: most recent first
  });
  var ranked = scored.map(function(x){ return x.s; });
  return (typeof n === 'number' && n > 0) ? ranked.slice(0, n) : ranked;
}

var EXEC_THEMES = [
  { label: 'compliance and content-policy changes', re: /polic|complian|claims?\b|protect|restrict|prohibit|masked|privacy|infringement|intellectual property|\bipr?\b/i },
  { label: 'shipping and fulfilment updates', re: /deliver|shipping|fulfil|fulfill|logistics|warehouse/i },
  { label: 'seller account and tooling changes', re: /account|organi[sz]ation|dashboard|centre|center|export|\btool/i }
];

function generateExecSummary(list, criticalList){
  var platformCounts = {};
  list.forEach(function(s){ platformCounts[s.platform] = (platformCounts[s.platform] || 0) + 1; });
  var platformParts = ALLOWED_PLATFORMS.filter(function(p){ return platformCounts[p]; })
    .map(function(p){ return platformCounts[p] + ' on ' + p; });

  var themeHits = EXEC_THEMES.filter(function(t){
    return list.some(function(s){ return t.re.test(s.title) || s.body.some(function(b){ return b.text && t.re.test(b.text); }); });
  }).map(function(t){ return t.label; });

  var s1 = list.length
    ? 'This period brings ' + list.length + ' platform update' + (list.length === 1 ? '' : 's') + (platformParts.length ? ' (' + platformParts.join(', ') + ')' : '') + '.'
    : 'No platform updates were recorded for this period.';

  var s2 = themeHits.length
    ? 'The main areas of focus are ' + themeHits.join(', ').replace(/, ([^,]*)$/, ' and $1') + '.'
    : '';

  // Every update in scope is listed below, so this sentence describes the
  // ordering rather than re-stating the count from s1.
  var s3 = criticalList.length > 1
    ? 'All ' + criticalList.length + ' are listed below, ordered with the ones needing closest attention from sellers first.'
    : '';

  return [s1, s2, s3].filter(Boolean).join(' ');
}

// Same brand-accent colors used by the on-screen card badges (see .card__badge in
// style.css) — reused here so a slide with no picture still gets a recognisable,
// on-brand placeholder instead of a blank box or a scraped/trademarked logo.
// Platform brand colours. These drive the square badge, the left accent stripe,
// the platform label and the "Read more" link, so one glance tells you the
// marketplace. Lazada's true brand navy (#0f146d) is so dark it reads as black
// next to TikTok's, defeating the point — so we use a brighter blue that stays
// recognisably Lazada while being unmistakably NOT TikTok.
var PLATFORM_BADGE_COLOR = {
  Lazada: '#1a56db',   // blue
  Shopee: '#ee4d2d',   // orange
  Tiktok: '#111111',   // black
  Zalora: '#7b1fa2',   // purple — was black, i.e. identical to TikTok
  Others: '#6b7684'    // grey
};

// Short per-platform codes shown inside the badge square (email + on-screen
// cards). Keeps the marketplace recognisable without a scraped/trademarked logo.
var PLATFORM_BADGE_CODE = {
  Lazada: 'LZD',
  Shopee: 'SHP',
  Tiktok: 'TTS',
  Zalora: 'ZLR',
  Others: 'OTH'
};
function platformCode(platform){
  return PLATFORM_BADGE_CODE[platform] || (platform || '?').slice(0,3).toUpperCase();
}

function firstSlideImage(s){
  return s.body.find(function(b){ return b.type === 'image' && b.dataUrl; }) || null;
}

// Shrinks a slide's embedded image down to a small JPEG data URL entirely in the
// browser (canvas), so the email stays a reasonable size even with several
// pictures — full-resolution base64 images are what makes emails get clipped by
// Gmail or bloated in Outlook. Resolves null if the image can't be decoded.
function makeThumbnailDataUrl(dataUrl, maxSize){
  return new Promise(function(resolve){
    var img = new Image();
    img.onload = function(){
      var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      var w = Math.max(1, Math.round(img.width * scale));
      var h = Math.max(1, Math.round(img.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', 0.62)); }
      catch (e) { resolve(null); }
    };
    img.onerror = function(){ resolve(null); };
    img.src = dataUrl;
  });
}

// Renders the platform square.
//
// Three things Word/Outlook breaks, and how each is worked around:
//
//  1. FILL — `background:` on a <div> is dropped. Fixed with a bgcolor ATTRIBUTE
//     on a <td>, the only fill Word honours.
//  2. CENTERING — line-height centering is ignored; Word drops the glyph to the
//     bottom-left. Fixed with align="center" + valign="middle" ATTRIBUTES on the
//     <td> (not CSS), plus mso-line-height-rule:exactly.
//  3. ROUNDED CORNERS — border-radius does not exist in Word. The ONLY way to get
//     a rounded shape in Outlook is VML. So we emit a VML roundrect wrapped in
//     <!--[if mso]>, and hide the HTML version from Outlook with <![if !mso]>.
//     Every other client sees the clean HTML table with a real border-radius.
function platformBadge(platform, size){
  size = size || 48;
  var bg = PLATFORM_BADGE_COLOR[platform] || '#1b2a4a';
  var code = platformCode(platform);          // 3-letter code, e.g. LZD / SHP / TTS / ZLR
  // 3 characters need a smaller font than a single initial so they fit the square.
  // 0.21 keeps the widest code (SHP) comfortably inside the 48px box with room to
  // spare on the left/right so the rounded corners never clip a glyph.
  var fontPx = Math.round(size * 0.21);
  var radius = Math.round(size * 0.22);          // ~22% — a soft square, not a pill
  var arc = (radius / size).toFixed(2);          // VML wants the radius as a ratio

  return ''
    // ---- Outlook only: VML rounded rectangle ----
    // The text lives inside a <v:textbox> and is vertically centered with
    // v-text-anchor:middle on the shape. This is the documented, reliable way to
    // put centered text in a VML shape in Word/Outlook. The earlier version used
    // <w:anchorlock/> + <center>, which Outlook silently dropped — that is why the
    // three letters (LZD / SHP / TTS / ZLR) were missing from the badges when the
    // email was pasted into Outlook, leaving only the coloured square.
    + '<!--[if mso]>'
      + '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" '
        + 'style="width:' + size + 'px;height:' + size + 'px;v-text-anchor:middle;mso-fit-shape-to-text:f;" '
        + 'arcsize="' + Math.round(arc * 100) + '%" stroke="f" fillcolor="' + bg + '">'
        + '<v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text:f;">'
          + '<center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:' + fontPx + 'px;font-weight:bold;mso-line-height-rule:exactly;line-height:1;text-align:center;">'
            + '<span style="color:#ffffff;">' + esc(code) + '</span>'
          + '</center>'
        + '</v:textbox>'
      + '</v:roundrect>'
    + '<![endif]-->'

    // ---- Everyone else: HTML table with a real border-radius ----
    + '<!--[if !mso]><!-->'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        + 'width="' + size + '" height="' + size + '" '
        + 'style="border-collapse:separate;border-radius:' + radius + 'px;overflow:hidden;">'
        + '<tr>'
          + '<td bgcolor="' + bg + '" align="center" valign="middle" '
            + 'width="' + size + '" height="' + size + '" '
            + 'style="background-color:' + bg + ';width:' + size + 'px;height:' + size + 'px;'
            + 'border-radius:' + radius + 'px;text-align:center;vertical-align:middle;'
            + 'color:#ffffff;font-family:Arial,Helvetica,sans-serif;'
            + 'font-size:' + fontPx + 'px;font-weight:bold;line-height:1;white-space:nowrap;'
            + 'mso-line-height-rule:exactly;">'
            + '<font color="#ffffff" style="color:#ffffff;white-space:nowrap;">' + esc(code) + '</font>'
          + '</td>'
        + '</tr>'
      + '</table>'
    + '<!--<![endif]-->';
}

// Platform name in its brand colour, region in bold. Two hooks for the eye:
// colour for "which marketplace", weight for "which market".
//
// The colour is applied with BOTH a <font color> attribute and a CSS `color` —
// Word/Outlook drops `color` on a bare <span> often enough that the platform
// names were coming through flat black. The <font> attribute is deprecated in
// modern HTML but it is exactly what Word's renderer respects, so in email it is
// the reliable one; the CSS covers every other client.
function platformRegionMeta(s){
  var color = PLATFORM_BADGE_COLOR[s.platform] || '#1b2a4a';
  return '<font color="' + color + '" style="color:' + color + ';">'
      + '<span style="color:' + color + ';font-weight:bold;text-transform:uppercase;letter-spacing:.06em;">' + esc(s.platform) + '</span>'
    + '</font>'
    + '<font color="#c3cad3" style="color:#c3cad3;">&nbsp;|&nbsp;</font>'
    + '<font color="#2d3748" style="color:#2d3748;">'
      + '<span style="color:#2d3748;font-weight:bold;">' + esc(s.region) + '</span>'
    + '</font>'
    + (s.date
        ? '<font color="#8f9aa8" style="color:#8f9aa8;">'
            + '<span style="color:#8f9aa8;font-weight:normal;">&nbsp;&middot;&nbsp;' + esc(fmtDate(s.date)) + '</span>'
          + '</font>'
        : '');
}

function buildExecEmailHtml(list, criticalList, opts){

  opts = opts || {};
  var periodLabel = opts.periodLabel || 'Current period';
  var baseUrl = (opts.baseUrl || '').trim();
  var thumbs = opts.thumbs || {}; // slide.id -> shrunk data URL, built by generateExecEmail()

  var platformCounts = {};
  list.forEach(function(s){ platformCounts[s.platform] = (platformCounts[s.platform] || 0) + 1; });
  var countsHtml = ALLOWED_PLATFORMS.filter(function(p){ return platformCounts[p]; }).map(function(p){
    var c = PLATFORM_BADGE_COLOR[p] || '#1b2a4a';
    return '<td valign="top" style="padding:0 10px 0 0;">'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>'
        + '<td bgcolor="' + c + '" width="3" style="background-color:' + c + ';width:3px;font-size:0;line-height:0;">&nbsp;</td>'
        + '<td style="padding:0 18px 0 8px;">'
          + '<div style="font-size:22px;font-weight:bold;color:' + c + ';font-family:Arial,Helvetica,sans-serif;line-height:1;">'
            + '<font color="' + c + '" style="color:' + c + ';">' + platformCounts[p] + '</font></div>'
          + '<div style="font-size:11px;color:#6b7684;text-transform:uppercase;letter-spacing:.06em;font-family:Arial,Helvetica,sans-serif;margin-top:4px;font-weight:700;">' + esc(p) + '</div>'
        + '</td>'
      + '</tr></table>'
    + '</td>';
  }).join('');

  var introText = execIntroLine(list);
  var summaryText = generateExecSummary(list, criticalList);

  var criticalHtml = criticalList.map(function(s, i){
    var accent = PLATFORM_BADGE_COLOR[s.platform] || '#1b2a4a';
    var linkEl = s.link
      ? '<a href="' + esc(s.link) + '" style="display:inline-block;font-size:13px;color:#111111;text-decoration:none;font-weight:bold;">'
          + '<font color="#111111" style="color:#111111;">Read more &#8594;</font></a>'
      : '';

    // Every row uses the lettered, platform-coloured badge — no image thumbnails.
    // Screenshots read as an unreadable smudge at this size, and inline images
    // bloat the email (Gmail clipping, Outlook weight); the coloured 3-letter
    // code (LZD / SHP / TTS / ZLR) identifies the marketplace at a glance.
    var imgCell = platformBadge(s.platform, 48);

    // The row is a 4-column table: accent stripe | rank | badge | content.
    // The stripe is a 4px bgcolor <td> in the platform's brand colour — it gives
    // the list a scannable left edge, so you can tell Shopee from TikTok from
    // Lazada without reading a word.
    return '<tr><td style="padding:0;border-bottom:1px solid #e3e7ec;font-family:Arial,Helvetica,sans-serif;">'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>'

        + '<td bgcolor="' + accent + '" width="4" style="background-color:' + accent + ';width:4px;font-size:0;line-height:0;">&nbsp;</td>'

        + '<td valign="top" style="padding:18px 0 18px 18px;width:26px;">'
          + '<span style="font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#c3cad3;">' + (i + 1) + '</span>'
        + '</td>'

        + '<td valign="top" style="padding:18px 14px 18px 12px;width:64px;">' + imgCell + '</td>'

        + '<td valign="top" style="padding:18px 28px 18px 0;">'
          + '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;margin-bottom:5px;">' + platformRegionMeta(s) + '</div>'
          + '<div style="font-size:16px;font-weight:700;color:#1b2a4a;margin-bottom:5px;line-height:1.35;">' + esc(s.title) + '</div>'
          + '<div style="font-size:15px;color:#4a5568;line-height:1.6;margin-bottom:8px;">' + esc(shortExcerpt(s, 150)) + '</div>'
          + linkEl
        + '</td>'

      + '</tr></table>'
    + '</td></tr>';
  }).join('');

  var ctaHtml = baseUrl
    ? '<tr><td align="center" style="padding:26px 32px 6px;">'
        + '<a href="' + esc(baseUrl) + '" style="display:inline-block;background:#1b2a4a;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:6px;">Open Interactive Newsletter &#8594;</a>'
      + '</td></tr>'
    : '';

  var stamp = new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return '<!doctype html>'
  + '<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word">'
+ '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
+ '<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->'
  + '<title>Platform Updates — Executive Briefing</title></head>'
  + '<body style="margin:0;padding:0;background:#eef1f4;">'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;"><tr><td align="center" style="padding:28px 12px;">'
  + '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:640px;width:100%;border:1px solid #dfe3e8;">'

    + '<tr><td bgcolor="#1b2a4a" style="background:#1b2a4a;background-color:#1b2a4a;padding:30px 32px;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="font-size:25px;font-weight:800;color:#ffffff;"><font color="#ffffff" style="color:#ffffff;">Platform Updates</font></div>'
      + '<div style="font-size:14px;color:#c3ceda;margin-top:6px;"><font color="#c3ceda" style="color:#c3ceda;">Reporting period: ' + esc(periodLabel) + '</font></div>'
    + '</td></tr>'

    + (countsHtml ? '<tr><td style="padding:20px 32px 18px;border-bottom:1px solid #e3e7ec;">'
        + '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' + countsHtml + '</tr></table>'
      + '</td></tr>' : '')

    + '<tr><td style="padding:22px 32px;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="font-size:13px;font-weight:700;color:#1b2a4a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Executive Summary</div>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>'
        + '<td bgcolor="#1b2a4a" width="3" style="background-color:#1b2a4a;width:3px;font-size:0;line-height:0;">&nbsp;</td>'
        + '<td bgcolor="#f4f6f8" style="background-color:#f4f6f8;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#3d4552;line-height:1.65;">'
          + '<div style="font-weight:bold;color:#1b2a4a;margin-bottom:8px;"><font color="#1b2a4a" style="color:#1b2a4a;">' + esc(introText) + '</font></div>'
          + esc(summaryText)
        + '</td>'
      + '</tr></table>'
    + '</td></tr>'

    + (criticalHtml ? '<tr><td style="padding:6px 32px 2px;font-family:Arial,Helvetica,sans-serif;">'
        + '<div style="font-size:13px;font-weight:700;color:#1b2a4a;text-transform:uppercase;letter-spacing:.07em;">Top Updates Requiring Attention</div>'
      + '</td></tr>' + criticalHtml : '')

    + ctaHtml

    + '<tr><td style="padding:22px 32px 28px;border-top:1px solid #e3e7ec;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="font-size:12.5px;color:#6b7684;">' + list.length + ' total update' + (list.length === 1 ? '' : 's') + ' this period &nbsp;&middot;&nbsp; Generated ' + esc(stamp) + '</div>'
      + '<div style="font-size:11.5px;color:#9aa4b1;margin-top:4px;">Automatically generated. Flag issues to the PIC.</div>'
    + '</td></tr>'

  + '</table>'
  + '</td></tr></table>'
  + '</body></html>';
}

function currentExecScope(){
  var el = document.querySelector('input[name="execScope"]:checked');
  return el ? el.value : 'filtered';
}

// Pull the inner <body> markup out of a full HTML document. When we put the
// email on the clipboard as text/html, email clients paste the fragment inside
// their own <body>, so handing them a whole document (with <html>/<head>) can
// get stripped or double-wrapped. The fragment keeps every inline style, link
// and inline base64 image intact — which is what makes the paste look identical.
function emailBodyFragment(fullHtml){
  var body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(fullHtml);
  var inner = body ? body[1] : fullHtml;

  // The outer wrappers are `width:100%` tables carrying the page background and
  // the centring padding. Nested inside the compose window's OWN table they
  // collapse and squeeze the content, so we hand the client the inner card table
  // directly.
  var card = /<table role="presentation" width="640"[\s\S]*<\/table>/i.exec(inner);
  if (!card) return inner;

  var html = card[0];

  // Drop the trailing </td></tr></table> tails belonging to the wrappers we cut.
  html = html.replace(/(<\/table>)(?:\s*<\/td>\s*<\/tr>\s*<\/table>)+\s*$/i, '$1');

  // A 640px-wide email body is right for a *received* email, but wrong for a
  // paste: it leaves the card as a narrow column in a wide compose window. Two
  // things pin it, and BOTH have to go —
  //   1. width="640" as an HTML attribute. Outlook renders through Word, which
  //      honours the attribute over CSS, so this alone keeps it at 640.
  //   2. max-width:640px in the inline style, which caps it even at width:100%.
  html = html.replace(/(<table role="presentation")\s+width="640"/i, '$1 width="100%"');
  html = html.replace(/max-width:640px;\s*/i, '');
  html = html.replace(/(<table role="presentation" width="100%"[^>]*style=")/i, '$1width:100%;');

  return html;
}

// Writes the styled email to the clipboard as BOTH rich HTML and plain text.
// Pasting into Gmail / Outlook / Apple Mail then keeps the formatting, working
// hyperlinks and inline images exactly as previewed. Falls back to a hidden
// contentEditable + execCommand('copy') for browsers without ClipboardItem.
function copyRichEmail(fullHtml, onOk, onFail){
  var fragment = emailBodyFragment(fullHtml);
  var plain = fragment.replace(/<style[\s\S]*?<\/style>/gi,'')
                      .replace(/<[^>]+>/g,' ')
                      .replace(/&nbsp;/g,' ')
                      .replace(/\s+/g,' ').trim();

  function legacyCopy(){
    var holder = document.createElement('div');
    holder.setAttribute('contenteditable','true');
    holder.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:normal;';
    holder.innerHTML = fragment;
    document.body.appendChild(holder);
    var range = document.createRange();
    range.selectNodeContents(holder);
    var sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges();
    document.body.removeChild(holder);
    if (ok) onOk(); else onFail();
  }

  if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
    try {
      var item = new ClipboardItem({
        'text/html': new Blob([fragment], { type:'text/html' }),
        'text/plain': new Blob([plain], { type:'text/plain' })
      });
      navigator.clipboard.write([item]).then(onOk).catch(legacyCopy);
    } catch (e) {
      legacyCopy();
    }
  } else {
    legacyCopy();
  }
}

function flashToast(btn){
  var toast = btn.querySelector('.copybtn__toast');
  if (!toast) return;
  toast.classList.add('is-show');
  setTimeout(function(){ toast.classList.remove('is-show'); }, 1600);
}

function renderExecPreview(){
  var wrap = document.getElementById('execPreviewWrap');
  if (!wrap) return;
  if (!state.execHtml){ wrap.innerHTML = ''; return; }

  wrap.innerHTML =
    '<div class="emailpreview">'
      + '<div class="emailpreview__bar">'
        + '<span class="emailpreview__label">Email preview</span>'
        + '<button type="button" class="btn copybtn" id="execCopyBtn"><span class="copybtn__toast">Copied — paste into your email</span>Copy for email</button>'
      + '</div>'
      + '<iframe id="execPreviewFrame" title="Executive email preview"></iframe>'
    + '</div>';

  document.getElementById('execPreviewFrame').srcdoc = state.execHtml;

  document.getElementById('execCopyBtn').addEventListener('click', function(){
    var btn = this;
    copyRichEmail(state.execHtml, function(){
      flashToast(btn);
      setStatus('Copied. Paste (Ctrl/Cmd+V) into a new Gmail, Outlook or Apple Mail message — the layout, links and images come across exactly as shown.', true);
    }, function(){
      setStatus('Couldn\'t copy the styled version automatically. Try again, or use a different browser.', false);
    });
  });
}

/* ============================================================
   EXECUTIVE EMAIL — generate & preview
   ============================================================ */
async function generateExecEmail(){
  var scope = currentExecScope();
  var list = scope === 'all' ? slides : filteredSlides();
  if (!list.length){
    setStatus('Nothing to include — no slides in the selected scope.', false);
    return;
  }

  // Feature every update in scope, ordered by criticality (most urgent first).
  var criticalList = pickCriticalUpdates(list);

  // The Base URL field (id emailBaseUrlExec) syncs to state.emailBaseUrl on input.
  var baseUrl = state.emailBaseUrl || '';
  var periodLabel = reportingPeriodLabel(list);

  // Badges are lettered platform codes, so no image processing is needed.
  state.execHtml = buildExecEmailHtml(list, criticalList, { periodLabel: periodLabel, baseUrl: baseUrl, thumbs: {} });
  renderExecPreview();
  setStatus('Generated the executive email — all ' + list.length + ' update' + (list.length === 1 ? '' : 's') + ' included, ordered by urgency, each with its platform badge (' + platformCode('Lazada') + ', ' + platformCode('Shopee') + ', ' + platformCode('Tiktok') + ', ' + platformCode('Zalora') + ').', true);
}

/* ============================================================
   ADMIN PANES (rendered into #workspaceBody, one per nav item)
   ============================================================ */
function renderWorkspace(){
  var wrap = document.getElementById('workspaceBody');
  if (!wrap) return;
  if (state.nav === 'add')         renderAddPane(wrap);
  else if (state.nav === 'import') renderImportPane(wrap);
  else if (state.nav === 'export') renderExportPane(wrap);
  else if (state.nav === 'archive') renderArchivePane(wrap);
  else if (state.nav === 'email')  renderEmailPane(wrap);
  else if (state.nav === 'members') renderMembersPane(wrap);
}

/* ============================================================
   ADD / EDIT ENTRY
   The direct-entry workflow: a form with your six fields. "Details"
   maps onto the existing body[] model (para / header / bullet / image),
   so entries created here render, filter, summarise, export to PDF and
   present exactly like imported ones. Editing loads a slide into the same
   draft and overwrites it on save.
   ============================================================ */

// A fresh draft for the Add form, pre-seeded with one empty text block so the
// editor is visible immediately.
function blankDraft(){
  return {
    id: null,               // null = new; otherwise editing an existing slide
    platform: ALLOWED_PLATFORMS[0] || 'Others',
    region: ALLOWED_REGIONS[0] || '',
    date: '',
    date_range: '',
    title: '',
    link: '',
    body: [{ type:'rich', html:'' }]
  };
}

// Turn an existing slide into an editable draft. All consecutive text blocks
// (rich/para/header/bullet, from the seed deck or PPTX import) are merged into a
// SINGLE unified "rich" block so they load into one Details editor with one
// toolbar. Image/table blocks are kept as their own separate blocks, in order.
function draftFromSlide(s){
  // Convert one legacy/text block to an HTML fragment.
  function blockToHtml(b){
    if (b.type === 'rich') return b.html || '';
    var t = esc(b.text || '');
    if (b.type === 'header') return '<h4>'+t+'</h4>';
    if (b.type === 'bullet') return '<li>'+t+'</li>'; // wrapped into <ul> by the merger
    return '<p>'+t+'</p>';
  }
  var isText = function(b){ return b.type==='rich' || b.type==='header' || b.type==='bullet' || b.type==='para'; };

  var body = [];
  var buffer = [];   // pending text blocks to merge
  var bulletRun = []; // pending consecutive bullets

  function flushBullets(){
    if (!bulletRun.length) return;
    buffer.push('<ul>'+bulletRun.join('')+'</ul>');
    bulletRun = [];
  }
  function flushText(){
    flushBullets();
    if (!buffer.length) return;
    body.push({ type:'rich', html: buffer.join('') });
    buffer = [];
  }

  (s.body || []).forEach(function(b){
    if (b.type === 'image'){
      flushText();
      body.push({ type:'image', file:b.file||'', dataUrl:b.dataUrl||null });
    } else if (b.type === 'table'){
      flushText();
      body.push({ type:'table', rows:(b.rows||[]).map(function(r){ return r.slice(); }) });
    } else if (isText(b)){
      if (b.type === 'bullet'){
        bulletRun.push(blockToHtml(b)); // accumulate into one list
      } else {
        flushBullets();
        buffer.push(blockToHtml(b));
      }
    }
  });
  flushText();

  return {
    id: s.id,
    platform: s.platform,
    region: s.region,
    date: s.date || '',
    date_range: s.date_range || '',
    title: s.title || '',
    link: s.link || '',
    body: body.length ? body : [{ type:'rich', html:'' }]
  };
}

function startNewEntry(){ state.editDraft = blankDraft(); setNav('add'); }
function startEditEntry(id){
  var s = slides.find(function(x){ return x.id === id; });
  if (!s) return;
  state.editDraft = draftFromSlide(s);
  setNav('add');
}

// Build a body-block editor row. Text content lives in a single "rich" block
// type edited via a contenteditable surface with a formatting toolbar; images
// and tables remain dedicated block types.
function detailBlockHtml(b, i){
  var ctrls =
    '<div class="detailblock__ctrls">'
      + '<button type="button" class="detailblock__btn" data-act="up" data-i="'+i+'" title="Move up">&#8593;</button>'
      + '<button type="button" class="detailblock__btn" data-act="down" data-i="'+i+'" title="Move down">&#8595;</button>'
      + '<button type="button" class="detailblock__btn detailblock__btn--del" data-act="del" data-i="'+i+'" title="Remove">&#10005;</button>'
    + '</div>';

  var kindLabel = { rich:'Text', image:'Image', table:'Table' }[b.type] || b.type;
  var inner;

  if (b.type === 'image'){
    inner = '<div class="detailblock__img">'
      + (b.dataUrl ? '<img src="'+b.dataUrl+'" alt="preview">' : '<div class="detailblock__empty">No image chosen</div>')
      + '<div class="detailblock__imgmeta">'
        + '<label class="miniadd" for="detailImg'+i+'">'+(b.dataUrl?'Replace image':'Choose image')+'</label>'
        + '<input type="file" id="detailImg'+i+'" accept="image/*" data-i="'+i+'" class="detailImgInput">'
        + (b.file ? '<div style="margin-top:6px;">'+esc(b.file)+'</div>' : '')
      + '</div>'
    + '</div>';
  } else if (b.type === 'table'){
    var asText = (b.rows||[]).map(function(r){ return r.join('\t'); }).join('\n');
    inner = '<textarea data-i="'+i+'" data-field="table" placeholder="One row per line, cells separated by TAB. First row is the header.">'+esc(asText)+'</textarea>';
  } else {
    // rich text block: toolbar + contenteditable
    inner = richEditorHtml(b, i);
  }

  return '<div class="detailblock detailblock--'+b.type+'">'
    + '<div class="detailblock__top"><span class="detailblock__kind">'+esc(kindLabel)+'</span>'+ctrls+'</div>'
    + inner
  + '</div>';
}

// Formatting toolbar + editable surface for one rich block.
function richEditorHtml(b, i){
  var btn = function(cmd, arg, label, title){
    return '<button type="button" class="rtb__btn" data-rt="'+cmd+'"'
      + (arg!=null?' data-arg="'+esc(arg)+'"':'')
      + ' data-i="'+i+'" title="'+esc(title||label)+'">'+label+'</button>';
  };
  var toolbar =
    '<div class="rtb">'
      + btn('bold', null, '<strong>B</strong>', 'Bold')
      + btn('italic', null, '<em>I</em>', 'Italic')
      + btn('underline', null, '<u>U</u>', 'Underline')
      + '<span class="rtb__sep"></span>'
      + btn('formatBlock', 'H4', 'H', 'Header')
      + btn('insertUnorderedList', null, '&#8226; List', 'Bullet list')
      + '<span class="rtb__sep"></span>'
      + '<select class="rtb__select" data-rt="fontSize" data-i="'+i+'" title="Font size">'
        + '<option value="">Size</option>'
        + '<option value="2">Small</option>'
        + '<option value="3">Normal</option>'
        + '<option value="5">Large</option>'
        + '<option value="6">X-Large</option>'
      + '</select>'
      + '<label class="rtb__color" title="Text colour"><span>A</span>'
        + '<input type="color" class="rtb__colorinput" data-rt="foreColor" data-i="'+i+'" value="#1f5fd8">'
      + '</label>'
      + '<span class="rtb__sep"></span>'
      + btn('createLink', null, '&#128279; Link', 'Add link')
      + btn('unlink', null, 'Unlink', 'Remove link')
    + '</div>';

  var content = sanitizeRichHtml(b.html || '');
  var editor = '<div class="rtb__editor" contenteditable="true" data-i="'+i+'" '
    + 'data-placeholder="Type here. Select text, then use the toolbar to format.">'
    + content + '</div>';

  return toolbar + editor;
}

function renderAddPane(wrap){
  if (!state.editDraft) state.editDraft = blankDraft();
  var d = state.editDraft;
  var editing = !!d.id;

  var blocksHtml = d.body.length
    ? d.body.map(detailBlockHtml).join('')
    : '<div class="detailblock__empty" style="padding:14px;text-align:center;">No details yet — add a text block or image below. You can paste tables directly into a text block.</div>';

  // Existing entries list (edit/delete + select-to-archive)
  var listRows = slides.slice().sort(function(a,b){
    return (b.date||'').localeCompare(a.date||'') || (a.title||'').localeCompare(b.title||'');
  }).map(function(s){
    return '<tr>'
      + '<td class="entrytable__check"><input type="checkbox" class="archiveCheck" data-id="'+esc(s.id)+'" aria-label="Select for archive"></td>'
      + '<td class="entrytable__title">'+esc(s.title)+'</td>'
      + '<td>'+esc(s.platform)+'</td>'
      + '<td>'+esc(s.region)+'</td>'
      + '<td>'+esc(s.date ? fmtDate(s.date) : (s.date_range||'—'))+'</td>'
      + '<td>'+esc(s.createdBy || '—')+'</td>'
      + '<td style="white-space:nowrap;">'+esc(fmtStamp(s.createdAt))+'</td>'
      + '<td style="white-space:nowrap;">'
        + '<button type="button" class="entrytable__act" data-edit="'+esc(s.id)+'">Edit</button>'
        + '<button type="button" class="entrytable__act entrytable__act--del" data-del="'+esc(s.id)+'">Delete</button>'
      + '</td>'
    + '</tr>';
  }).join('');

  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">'+(editing?'Edit entry':'Add a new entry')+'</h2></div>'
      + '<p class="panel__hint">Fill in the update below. <strong>Details</strong> is a rich-text editor — type freely, then select text and use the toolbar for <strong>bold</strong>, italic, headers, bullet lists, font size, colour and links. You can also <strong>paste a table</strong> straight into a text block and it will fit the width automatically. Add image blocks for pictures (up to 2). Everything flows into the browse views, presentation, email summary and PDF export.</p>'

      + '<div class="formgrid">'
        + '<div class="formfield"><label>Platform</label><select id="fPlatform">'+optionsHtml(ALLOWED_PLATFORMS, d.platform)+'</select></div>'
        + '<div class="formfield"><label>Region</label><select id="fRegion">'+optionsHtml(ALLOWED_REGIONS, d.region)+'</select></div>'
        + '<div class="formfield"><label>Publish date</label><input type="date" id="fDate" value="'+esc(d.date)+'"><span class="formfield__hint">Drives sorting, filtering and the presentation grouping.</span></div>'
        + '<div class="formfield"><label>Period covered — label (optional)</label><input type="text" id="fRange" value="'+esc(d.date_range)+'" placeholder="e.g. Jun 29 – Jul 3"><span class="formfield__hint">Display text shown on the entry; free-form.</span></div>'
        + '<div class="formfield formfield--wide"><label>Title</label><input type="text" id="fTitle" value="'+esc(d.title)+'" placeholder="Headline for this update"></div>'
        + '<div class="formfield formfield--wide"><label>Link / URL (optional)</label><input type="url" id="fLink" value="'+esc(d.link)+'" placeholder="https://…"></div>'
      + '</div>'

      + '<div class="detailhead">'
        + '<span class="detailhead__title">Details</span>'
        + '<div class="detailhead__actions">'
          + '<button type="button" class="miniadd" data-add="rich">+ Text block</button>'
          + (function(){
              var imgBlocks = d.body.filter(function(b){ return b.type==='image'; }).length;
              var atMax = imgBlocks >= 2;
              return '<button type="button" class="miniadd" data-add="image"'
                + (atMax ? ' disabled title="Maximum of 2 images reached — remove one to add another"' : '')
                + '>+ Image' + (imgBlocks ? ' (' + imgBlocks + '/2)' : '') + '</button>';
            })()
        + '</div>'
      + '</div>'
      + '<div class="detailblocks" id="detailBlocks">'+blocksHtml+'</div>'

      + '<div class="formactions">'
        + '<button type="button" class="btn" id="saveEntryBtn">'+(editing?'Save changes':'Add entry')+'</button>'
        + (editing ? '<button type="button" class="btn btn--ghost" id="cancelEditBtn">Cancel edit</button>' : '')
        + '<div class="formactions__spacer"></div>'
        + '<button type="button" class="btn btn--ghost" id="clearFormBtn">Clear form</button>'
      + '</div>'
    + '</div>'

    + '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Existing entries ('+slides.length+')</h2></div>'
      + '<p class="panel__hint">Edit or remove any entry. Tick entries and use <strong>Archive selected</strong> to set them aside — archived entries leave the browse, presentation and email/PDF views but can be restored anytime from the Archive tab. Saved to this browser.</p>'
      + (slides.length
        ? '<div class="archivebar">'
            + '<label class="archivebar__all"><input type="checkbox" id="archiveSelectAll"> Select all</label>'
            + '<span class="archivebar__count" id="archiveCount">0 selected</span>'
            + '<div class="formactions__spacer"></div>'
            + '<button type="button" class="btn" id="archiveSelectedBtn" disabled>Archive selected</button>'
          + '</div>'
          + '<table class="entrytable"><thead><tr><th class="entrytable__check"></th><th>Title</th><th>Platform</th><th>Region</th><th>Publish date</th><th>Added by</th><th>Timestamp</th><th></th></tr></thead><tbody>'+listRows+'</tbody></table>'
        : '<div class="detailblock__empty">No entries yet.</div>')
    + '</div>';

  wireAddPane(wrap);
}

// Read current field values from the DOM into the draft (so a re-render — e.g.
// after adding/moving a detail block — doesn't lose typed-but-unsaved input).
function syncDraftFromForm(){
  var d = state.editDraft; if (!d) return;
  var g = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
  d.platform = g('fPlatform') || d.platform;
  d.region = g('fRegion') || d.region;
  d.date = g('fDate');
  d.date_range = g('fRange');
  d.title = g('fTitle');
  d.link = g('fLink');

  // rich contenteditable blocks -> sanitised HTML
  document.querySelectorAll('#detailBlocks .rtb__editor').forEach(function(ed){
    var i = parseInt(ed.getAttribute('data-i'), 10);
    if (isNaN(i) || !d.body[i]) return;
    d.body[i].html = sanitizeRichHtml(ed.innerHTML);
  });

  // table textareas
  document.querySelectorAll('#detailBlocks textarea[data-field="table"]').forEach(function(ta){
    var i = parseInt(ta.getAttribute('data-i'), 10);
    if (isNaN(i) || !d.body[i]) return;
    d.body[i].rows = ta.value.split('\n').map(function(line){ return line.split('\t'); });
  });
}

function wireAddPane(wrap){
  var d = state.editDraft;

  // simple field bindings (kept live so syncDraftFromForm always has fresh values)
  ['fPlatform','fRegion','fDate','fRange','fTitle','fLink'].forEach(function(id){
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener('input', function(){ syncDraftFromForm(); });
  });

  // add a detail block
  wrap.querySelectorAll('[data-add]').forEach(function(btn){
    btn.addEventListener('click', function(){
      syncDraftFromForm();
      var kind = btn.getAttribute('data-add');
      if (kind === 'image'){
        var imgCount = d.body.filter(function(b){ return b.type === 'image'; }).length;
        if (imgCount >= 2){
          setStatus('You can add a maximum of 2 images per entry.', false);
          return;
        }
        d.body.push({ type:'image', file:'', dataUrl:null });
      }
      else if (kind === 'table') d.body.push({ type:'table', rows:[['',''],['','']] });
      else d.body.push({ type:'rich', html:'' });
      renderAddPane(wrap);
      // focus the newly added editor if it's a text block
      if (kind === 'rich'){
        var eds = wrap.querySelectorAll('.rtb__editor');
        if (eds.length) eds[eds.length-1].focus();
      }
    });
  });

  // rich editors: sync to draft on input/blur, WITHOUT re-rendering (so the
  // caret and selection survive). Re-render only happens on structural changes.
  wrap.querySelectorAll('.rtb__editor').forEach(function(ed){
    var sync = function(){
      var i = parseInt(ed.getAttribute('data-i'), 10);
      if (!isNaN(i) && d.body[i]) d.body[i].html = sanitizeRichHtml(ed.innerHTML);
    };
    ed.addEventListener('input', sync);
    ed.addEventListener('blur', sync);
  });

  // toolbar buttons (execCommand scoped to the focused editor)
  wrap.querySelectorAll('.rtb__btn').forEach(function(btn){
    // use mousedown so the editor doesn't lose selection before the command runs
    btn.addEventListener('mousedown', function(e){
      e.preventDefault();
      var cmd = btn.getAttribute('data-rt');
      var arg = btn.getAttribute('data-arg');
      applyRichCommand(cmd, arg, btn, d);
    });
  });
  wrap.querySelectorAll('.rtb__select[data-rt="fontSize"]').forEach(function(sel){
    sel.addEventListener('change', function(){
      if (sel.value) applyRichCommand('fontSize', sel.value, sel, d);
      sel.value = '';
    });
  });
  wrap.querySelectorAll('.rtb__colorinput').forEach(function(inp){
    inp.addEventListener('input', function(){ applyRichCommand('foreColor', inp.value, inp, d); });
  });

  // move / delete detail blocks
  wrap.querySelectorAll('.detailblock__btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      syncDraftFromForm();
      var i = parseInt(btn.getAttribute('data-i'), 10);
      var act = btn.getAttribute('data-act');
      if (isNaN(i)) return;
      if (act === 'del') d.body.splice(i, 1);
      else if (act === 'up' && i > 0){ var t = d.body[i-1]; d.body[i-1] = d.body[i]; d.body[i] = t; }
      else if (act === 'down' && i < d.body.length-1){ var u = d.body[i+1]; d.body[i+1] = d.body[i]; d.body[i] = u; }
      renderAddPane(wrap);
    });
  });

  // image pickers — upload to Supabase Storage and store the returned public
  // URL (keeps the shared row tiny). Falls back to inline base64 if not configured.
  wrap.querySelectorAll('.detailImgInput').forEach(function(input){
    input.addEventListener('change', function(e){
      var i = parseInt(input.getAttribute('data-i'), 10);
      var file = e.target.files[0];
      if (!file || isNaN(i) || !d.body[i]) return;
      syncDraftFromForm();
      var reader = new FileReader();
      reader.onload = function(){
        var dataUrl = reader.result;
        if (AUTH.getImgbbKey()){
          // show an uploading state
          d.body[i].uploading = true;
          d.body[i].file = file.name + ' — uploading…';
          renderAddPane(wrap);
          AUTH.uploadImage(dataUrl, file.name).then(function(url){
            d.body[i].dataUrl = url;      // permanent public URL
            d.body[i].file = file.name;
            d.body[i].uploading = false;
            setStatus('Image uploaded ✓', true);
            renderAddPane(wrap);
          }).catch(function(err){
            // fall back to inline base64 so the user isn't blocked, but warn.
            d.body[i].dataUrl = dataUrl;
            d.body[i].file = file.name;
            d.body[i].uploading = false;
            setStatus('Image host upload failed ('+(err && err.message ? err.message : 'error')+'). Stored inline instead — this counts against the shared-store size limit.', false);
            renderAddPane(wrap);
          });
        } else {
          d.body[i].dataUrl = dataUrl;
          d.body[i].file = file.name;
          renderAddPane(wrap);
        }
      };
      reader.readAsDataURL(file);
    });
  });

  // save
  var saveBtn = document.getElementById('saveEntryBtn');
  if (saveBtn) saveBtn.addEventListener('click', function(){ saveEntry(wrap); });

  var cancelBtn = document.getElementById('cancelEditBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', function(){ state.editDraft = blankDraft(); renderAddPane(wrap); });

  var clearBtn = document.getElementById('clearFormBtn');
  if (clearBtn) clearBtn.addEventListener('click', function(){
    if (window.confirm('Clear the form? Unsaved input will be lost.')){ state.editDraft = blankDraft(); renderAddPane(wrap); }
  });

  // edit / delete existing entries
  wrap.querySelectorAll('[data-edit]').forEach(function(btn){
    btn.addEventListener('click', function(){ startEditEntry(btn.getAttribute('data-edit')); });
  });
  wrap.querySelectorAll('[data-del]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.getAttribute('data-del');
      var s = slides.find(function(x){ return x.id === id; });
      if (!s) return;
      if (!window.confirm('Delete "'+s.title+'"? This is saved to this browser. Use "Reset to source deck" in Export to restore the original set.')) return;
      slides = slides.filter(function(x){ return x.id !== id; });
      state.openCards.delete(id);
      state.execHtml = null; state.digestHtml = null;
      if (state.editDraft && state.editDraft.id === id) state.editDraft = blankDraft();
      saveSlides();
      renderAddPane(wrap);
      setStatus('Deleted "'+s.title+'". '+slides.length+' remaining.', true);
    });
  });

  // --- archive selection ---
  var checks = wrap.querySelectorAll('.archiveCheck');
  var selectAll = document.getElementById('archiveSelectAll');
  var countEl = document.getElementById('archiveCount');
  var archiveBtn = document.getElementById('archiveSelectedBtn');

  function selectedIds(){
    return Array.prototype.slice.call(wrap.querySelectorAll('.archiveCheck'))
      .filter(function(c){ return c.checked; })
      .map(function(c){ return c.getAttribute('data-id'); });
  }
  function refreshArchiveBar(){
    var n = selectedIds().length;
    if (countEl) countEl.textContent = n + ' selected';
    if (archiveBtn) archiveBtn.disabled = (n === 0);
    if (selectAll) selectAll.checked = (n > 0 && n === checks.length);
  }
  checks.forEach(function(c){ c.addEventListener('change', refreshArchiveBar); });
  if (selectAll){
    selectAll.addEventListener('change', function(){
      checks.forEach(function(c){ c.checked = selectAll.checked; });
      refreshArchiveBar();
    });
  }
  if (archiveBtn){
    archiveBtn.addEventListener('click', function(){
      var ids = selectedIds();
      if (!ids.length) return;
      var label = window.prompt('Name this archive batch (e.g. "July newsletter", "Jun–Jul crossover"):', 'Archive ' + fmtDate(new Date().toISOString().slice(0,10)));
      if (label === null) return; // cancelled
      var batch = archiveEntries(ids, label);
      if (batch){
        renderAddPane(wrap);
        setStatus('Archived '+batch.slides.length+' entr'+(batch.slides.length===1?'y':'ies')+' to "'+batch.label+'". '+slides.length+' active remaining. Open the Archive tab to restore or export.', true);
      }
    });
  }
}

// Run a formatting command against the currently-focused rich editor. The
// button lives outside the editor, so we resolve the editor by its data-i and
// make sure a selection inside it is active before issuing the command.
function applyRichCommand(cmd, arg, srcEl, d){
  var i = parseInt(srcEl.getAttribute('data-i'), 10);
  var editor = document.querySelector('.rtb__editor[data-i="'+i+'"]');
  if (!editor) return;

  // ensure focus/selection is inside this editor
  var sel = window.getSelection();
  var inEditor = sel.rangeCount && editor.contains(sel.anchorNode);
  if (!inEditor){
    editor.focus();
    // place caret at end if nothing selected
    var range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  try {
    if (cmd === 'createLink'){
      var url = window.prompt('Link URL (https://…):', 'https://');
      if (!url) return;
      if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url.replace(/^\/+/, '');
      document.execCommand('createLink', false, url);
    } else if (cmd === 'formatBlock'){
      // toggle: if already a header, go back to paragraph
      document.execCommand('formatBlock', false, arg);
    } else if (cmd === 'fontSize'){
      document.execCommand('fontSize', false, arg);
    } else if (cmd === 'foreColor'){
      document.execCommand('foreColor', false, arg);
    } else {
      document.execCommand(cmd, false, null);
    }
  } catch (e){ /* execCommand can throw in odd states; ignore */ }

  // sync sanitised HTML back to the draft
  if (!isNaN(i) && d.body[i]) d.body[i].html = sanitizeRichHtml(editor.innerHTML);
}

function saveEntry(wrap){
  syncDraftFromForm();
  var d = state.editDraft;

  // validation
  if (d.body.some(function(b){ return b.type==='image' && b.uploading; })){
    setStatus('Hold on — an image is still uploading. Try again in a moment.', false); return;
  }
  if (!d.title.trim()){ setStatus('Give the entry a title before saving.', false); return; }
  if (!d.region){ setStatus('Pick a region.', false); return; }
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)){ setStatus('Date must be a valid calendar date.', false); return; }

  // clean up body: drop empty rich blocks, empty table rows, imageless image blocks
  var body = d.body.map(function(b){
    if (b.type === 'table'){
      var rows = (b.rows||[]).map(function(r){ return r.map(function(c){ return String(c).trim(); }); })
        .filter(function(r){ return r.some(function(c){ return c !== ''; }); });
      return { type:'table', rows:rows };
    }
    if (b.type === 'image') return { type:'image', file:b.file||'', dataUrl:b.dataUrl||null };
    // rich
    return { type:'rich', html:sanitizeRichHtml(b.html||'') };
  }).filter(function(b){
    if (b.type === 'table') return b.rows.length;
    if (b.type === 'image') return !!b.dataUrl || !!b.file;
    return richToText(b.html) !== '' || /<(img|br)/i.test(b.html); // keep non-empty text
  });

  if (!body.length){ setStatus('Add at least one detail — a text block, image or table.', false); return; }

  var payload = {
    platform: normalizePlatform(d.platform),
    region: d.region,
    date: d.date || '',
    date_range: d.date_range.trim(),
    title: d.title.trim(),
    link: d.link.trim(),
    body: body
  };

  var who = (AUTH.getSession() && AUTH.getSession().username) || 'unknown';
  var now = Date.now();

  if (d.id){
    // update in place — preserve original author/created stamp, add edit stamp
    var idx = slides.findIndex(function(s){ return s.id === d.id; });
    if (idx !== -1){
      var prev = slides[idx];
      payload.id = d.id;
      payload.slide_num = prev.slide_num;
      payload.createdBy = prev.createdBy || who;
      payload.createdAt = prev.createdAt || now;
      payload.updatedBy = who;
      payload.updatedAt = now;
      slides[idx] = payload;
    }
    setStatus('Saved changes to "'+payload.title+'".', true);
  } else {
    payload.id = nextId();
    payload.slide_num = nextSlideNum();
    payload.createdBy = who;
    payload.createdAt = now;
    payload.updatedBy = who;
    payload.updatedAt = now;
    slides.push(payload);
    setStatus('Added "'+payload.title+'". '+slides.length+' entries total.', true);
  }

  state.execHtml = null; state.digestHtml = null;
  saveSlides();
  state.editDraft = blankDraft();     // reset for the next entry
  renderAddPane(wrap);
}

/* ============================================================
   PRESENTATION MODE
   A full-screen walkthrough. Slides are ordered by date (newest first),
   then region, then platform — matching how the newsletter reads — and
   flattened into a linear sequence you step through with the arrow keys
   or on-screen controls. The breadcrumb shows where you are in the
   date → region → platform hierarchy.
   ============================================================ */
function buildPresentOrder(){
  var list = filteredSlides().slice();
  // Narrow to a single publish date when one is chosen in the present bar.
  var df = state.present.dateFilter;
  if (df && df !== '__all__'){
    list = list.filter(function(s){ return (s.date || '') === df; });
  }
  var regionRank = function(r){ var i = ALLOWED_REGIONS.indexOf(r); return i === -1 ? 999 : i; };
  var platRank = function(p){ var i = ALLOWED_PLATFORMS.indexOf(p); return i === -1 ? 999 : i; };
  list.sort(function(a,b){
    // date: newest first; entries without a date sink to the bottom
    var da = a.date || '', db = b.date || '';
    if (da !== db){ if (!da) return 1; if (!db) return -1; return db.localeCompare(da); }
    var rr = regionRank(a.region) - regionRank(b.region);
    if (rr !== 0) return rr;
    return platRank(a.platform) - platRank(b.platform);
  });
  return list;
}

// Build the "Publish date" dropdown in the present bar from the publish dates
// present in the current filtered set. Keeps the current selection if it still
// exists, otherwise falls back to "All dates".
function populatePresentDates(){
  var sel = document.getElementById('presentDateSelect');
  if (!sel) return;
  var seen = {};
  filteredSlides().forEach(function(s){ if (s.date) seen[s.date] = true; });
  var dates = Object.keys(seen).sort().reverse(); // newest first
  if (state.present.dateFilter !== '__all__' && !seen[state.present.dateFilter]){
    state.present.dateFilter = '__all__';
  }
  var opts = '<option value="__all__">All dates ('+filteredSlides().length+')</option>';
  opts += dates.map(function(d){
    var n = filteredSlides().filter(function(s){ return (s.date||'') === d; }).length;
    return '<option value="'+esc(d)+'"'+(state.present.dateFilter===d?' selected':'')+'>'+esc(fmtDate(d))+' ('+n+')</option>';
  }).join('');
  sel.innerHTML = opts;
  sel.value = state.present.dateFilter;
}

function openPresentation(){
  populatePresentDates();
  var list = buildPresentOrder();
  state.present.list = list;
  state.present.index = 0;
  var ov = document.getElementById('presentOverlay');
  ov.hidden = false;
  document.body.style.overflow = 'hidden';
  renderPresent();
}

function closePresentation(){
  var ov = document.getElementById('presentOverlay');
  ov.hidden = true;
  document.body.style.overflow = '';
  // return to a browse view so the app surface is visible again
  if (!isBrowseNav(state.nav)) setNav('browse', { silent:true });
}

function presentGo(delta){
  var n = state.present.list.length;
  if (!n) return;
  state.present.index = Math.max(0, Math.min(n-1, state.present.index + delta));
  renderPresent();
}

function renderPresent(){
  var stage = document.getElementById('presentStage');
  var crumbs = document.getElementById('presentCrumbs');
  var counter = document.getElementById('presentCounter');
  var progress = document.getElementById('presentProgress');
  var list = state.present.list;

  if (!list.length){
    crumbs.innerHTML = '';
    counter.textContent = '';
    progress.innerHTML = '';
    stage.innerHTML = '<div class="present__empty">No updates match the current filters.<br>Adjust the filters or search, then reopen Present.</div>';
    document.getElementById('presentPrev').disabled = true;
    document.getElementById('presentNext').disabled = true;
    return;
  }

  var i = state.present.index;
  var s = list[i];

  // breadcrumb: date › region › platform
  crumbs.innerHTML =
    '<span class="present__crumb present__crumb--date">'+esc(s.date ? fmtDate(s.date) : (s.date_range || 'Undated'))+'</span>'
    + '<span class="present__crumbsep">&rsaquo;</span>'
    + '<span class="present__crumb">'+esc(s.region)+'</span>'
    + '<span class="present__crumbsep">&rsaquo;</span>'
    + '<span class="present__crumb">'+esc(s.platform)+'</span>';

  counter.textContent = (i+1) + ' / ' + list.length;

  stage.innerHTML =
    '<div class="present__card">'
      + '<div class="present__eyebrow">'
        + '<span class="present__tag present__tag--platform">'+esc(s.platform)+'</span>'
        + '<span class="present__tag">'+esc(s.region)+'</span>'
        + (s.date ? '<span class="present__tag">'+esc(fmtDate(s.date))+'</span>' : (s.date_range ? '<span class="present__tag">'+esc(s.date_range)+'</span>' : ''))
      + '</div>'
      + '<h1 class="present__title">'+esc(s.title)+'</h1>'
      + (s.link ? '<a class="present__link" href="'+esc(s.link)+'" target="_blank" rel="noopener">Open source ↗</a>' : '')
      + '<div class="present__content">'+renderBody(s.body, false)+'</div>'
    + '</div>';
  stage.scrollTop = 0;

  // progress dots — mark where a new date begins
  progress.innerHTML = list.map(function(item, idx){
    var newDate = idx === 0 || (list[idx-1].date || '') !== (item.date || '');
    return '<div class="present__dot'+(idx===i?' is-active':'')+(newDate?' is-newdate':'')+'" data-i="'+idx+'" title="'+esc(item.title)+'"></div>';
  }).join('');
  progress.querySelectorAll('.present__dot').forEach(function(dot){
    dot.addEventListener('click', function(){
      state.present.index = parseInt(dot.getAttribute('data-i'),10) || 0;
      renderPresent();
    });
  });

  document.getElementById('presentPrev').disabled = (i === 0);
  document.getElementById('presentNext').disabled = (i === list.length-1);
}

function initPresentControls(){
  document.getElementById('presentPrev').addEventListener('click', function(){ presentGo(-1); });
  document.getElementById('presentNext').addEventListener('click', function(){ presentGo(1); });
  document.getElementById('presentClose').addEventListener('click', closePresentation);

  var dateSel = document.getElementById('presentDateSelect');
  if (dateSel){
    dateSel.addEventListener('change', function(){
      state.present.dateFilter = dateSel.value || '__all__';
      state.present.list = buildPresentOrder();
      state.present.index = 0;
      renderPresent();
    });
  }
  document.addEventListener('keydown', function(e){
    var ov = document.getElementById('presentOverlay');
    if (!ov || ov.hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' '){ e.preventDefault(); presentGo(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp'){ e.preventDefault(); presentGo(-1); }
    else if (e.key === 'Escape'){ closePresentation(); }
    else if (e.key === 'Home'){ state.present.index = 0; renderPresent(); }
    else if (e.key === 'End'){ state.present.index = Math.max(0, state.present.list.length-1); renderPresent(); }
  });
}

function renderImportPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Import slides</h2></div>'
      + '<div class="importtabs">'
        + '<button type="button" class="importtabs__btn'+(state.importTab==='pptx'?' is-active':'')+'" data-tab="pptx">From PowerPoint (.pptx)</button>'
        + '<button type="button" class="importtabs__btn'+(state.importTab==='json'?' is-active':'')+'" data-tab="json">From JSON (re-import / backup)</button>'
      + '</div>'

      + '<div class="importpane'+(state.importTab==='pptx'?' is-active':'')+'" id="paneImportPptx">'
        + '<p class="panel__hint">Upload a .pptx deck — the tool reads Platform, Region and Date straight from the file, no defaults to set:'
          + '<ul>'
            + '<li><strong>Region</strong> — use PowerPoint\'s <em>Sections</em> feature and name each section after a region ('+ALLOWED_REGIONS.join(', ')+'). Every slide in that section imports as that region.</li>'
            + '<li><strong>Platform</strong> — add a small text box on the slide containing just the platform name ('+ALLOWED_PLATFORMS.join(', ')+'). Falls back to "Others" if none is found.</li>'
            + '<li><strong>Date</strong> — add a small text box with a date (e.g. <code>2026-07-06</code> or <code>Jul 6</code>), or include it in the section name, e.g. <code>Singapore (Jun 29 – Jul 3)</code>.</li>'
          + '</ul></p>'
        + '<p class="panel__hint">Slide text becomes the update: the first line is the title, the rest is the body, and any pictures on the slide are embedded automatically. Review the results below — anything not detected is flagged for you to fix before importing.</p>'
        + '<div class="adminpanel__row">'
          + '<label class="btn btn--ghost" for="importPptxFile">Choose .pptx file</label>'
          + '<input type="file" id="importPptxFile" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation">'
          + '<span id="pptxFileName" style="font-size:12px;color:var(--muted);"></span>'
        + '</div>'
        + '<div id="pptxPreviewWrap"></div>'
      + '</div>'

      + '<div class="importpane'+(state.importTab==='json'?' is-active':'')+'" id="paneImportJson">'
        + '<p class="panel__hint">Paste or upload a JSON export from this tool (array of slides, or <code>{"slides":[...]}</code>). Used for re-importing backups.</p>'
        + '<div class="adminpanel__row">'
          + '<label class="btn btn--ghost" for="importFile">Choose JSON file</label>'
          + '<input type="file" id="importFile" accept="application/json,.json">'
          + '<span id="importFileName" style="font-size:12px;color:var(--muted);"></span>'
        + '</div>'
        + '<textarea id="importText" placeholder=\'[{"platform":"Shopee","region":"Indonesia","date":"2026-07-06","title":"...","link":"...","body":[{"type":"para","text":"..."}]}]\'></textarea>'
        + '<div class="adminpanel__row">'
          + '<button type="button" class="btn" id="importTextBtn">Import pasted JSON</button>'
        + '</div>'
      + '</div>'
    + '</div>';

  wrap.querySelectorAll('.importtabs__btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.importTab = btn.getAttribute('data-tab');
      renderImportPane(wrap);
    });
  });

  document.getElementById('importPptxFile').addEventListener('change', function(e){
    var file = e.target.files[0];
    if (!file) return;
    document.getElementById('pptxFileName').textContent = file.name;
    setStatus('Reading "'+file.name+'"…', true);
    parsePptx(file).then(function(results){
      state.pptxPreview = results;
      renderPptxPreview();
      setStatus('Found '+results.length+' slide'+(results.length===1?'':'s')+' in "'+file.name+'". Review and confirm below.', true);
    }).catch(function(err){
      setStatus('Could not read "'+file.name+'" — '+err.message, false);
    });
  });

  document.getElementById('importFile').addEventListener('change', function(e){
    var file = e.target.files[0];
    if (!file) return;
    document.getElementById('importFileName').textContent = file.name;
    var reader = new FileReader();
    reader.onload = function(){ importSlides(reader.result, file.name); };
    reader.readAsText(file);
  });
  document.getElementById('importTextBtn').addEventListener('click', function(){
    var txt = document.getElementById('importText').value.trim();
    if (!txt){ setStatus('Paste some JSON first.', false); return; }
    importSlides(txt, 'pasted JSON');
  });

  if (state.pptxPreview) renderPptxPreview();
}

function renderArchivePane(wrap){
  if (!archives.length){
    wrap.innerHTML =
      '<div class="panel">'
        + '<div class="panel__head"><h2 class="panel__title">Archive</h2></div>'
        + '<p class="panel__hint">No archived batches yet. To archive: go to <strong>Add entry</strong>, tick the entries you want to set aside, and click <strong>Archive selected</strong>. They\'ll leave the browse, presentation and email/PDF views but stay here — restore or export them anytime.</p>'
        + '<div class="archivenote">Archives live in this browser only — they are not an off-device backup. Your permanent record is the exported PDF (and JSON, for re-import).</div>'
      + '</div>';
    return;
  }

  var batchHtml = archives.map(function(b){
    var rows = b.slides.slice().sort(function(a,c){
      return (c.date||'').localeCompare(a.date||'') || (a.title||'').localeCompare(c.title||'');
    }).map(function(s){
      return '<tr>'
        + '<td class="entrytable__check"><input type="checkbox" class="restoreCheck" data-batch="'+esc(b.id)+'" data-id="'+esc(s.id)+'" aria-label="Select to restore"></td>'
        + '<td class="entrytable__title">'+esc(s.title)+'</td>'
        + '<td>'+esc(s.platform)+'</td>'
        + '<td>'+esc(s.region)+'</td>'
        + '<td>'+esc(s.date ? fmtDate(s.date) : (s.date_range||'—'))+'</td>'
      + '</tr>';
    }).join('');

    return '<div class="panel archivebatch" data-batch="'+esc(b.id)+'">'
      + '<div class="archivebatch__head">'
        + '<div>'
          + '<h2 class="panel__title archivebatch__label" data-batch="'+esc(b.id)+'">'+esc(b.label)+'</h2>'
          + '<div class="archivebatch__meta">'+b.slides.length+' entr'+(b.slides.length===1?'y':'ies')+' · archived '+esc(fmtDate(new Date(b.archivedAt).toISOString().slice(0,10)))+'</div>'
        + '</div>'
        + '<div class="archivebatch__actions">'
          + '<button type="button" class="btn btn--ghost btnsm" data-arch-rename="'+esc(b.id)+'">Rename</button>'
          + '<button type="button" class="btn btn--ghost btnsm" data-arch-pdf="'+esc(b.id)+'">Export PDF</button>'
          + '<button type="button" class="btn btn--ghost btnsm" data-arch-json="'+esc(b.id)+'">Export JSON</button>'
          + '<button type="button" class="btn btn--danger btnsm" data-arch-delete="'+esc(b.id)+'">Delete batch</button>'
        + '</div>'
      + '</div>'
      + '<div class="archivebar">'
        + '<label class="archivebar__all"><input type="checkbox" class="restoreSelectAll" data-batch="'+esc(b.id)+'"> Select all</label>'
        + '<div class="formactions__spacer"></div>'
        + '<button type="button" class="btn btnsm" data-arch-restore="'+esc(b.id)+'" disabled>Restore selected</button>'
        + '<button type="button" class="btn btn--ghost btnsm" data-arch-restoreall="'+esc(b.id)+'">Restore all</button>'
      + '</div>'
      + '<table class="entrytable"><thead><tr><th class="entrytable__check"></th><th>Title</th><th>Platform</th><th>Region</th><th>Publish date</th></tr></thead><tbody>'+rows+'</tbody></table>'
    + '</div>';
  }).join('');

  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Archive ('+archives.length+' batch'+(archives.length===1?'':'es')+')</h2></div>'
      + '<p class="panel__hint">Archived batches. Restore entries back to the active set, or export a batch to PDF/JSON. Deleting a batch is permanent.</p>'
      + '<div class="archivenote">Archives live in this browser only — not an off-device backup. Your permanent record is the exported PDF (and JSON, for re-import).</div>'
    + '</div>'
    + batchHtml;

  wireArchivePane(wrap);
}

function wireArchivePane(wrap){
  function selInBatch(batchId){
    return Array.prototype.slice.call(wrap.querySelectorAll('.restoreCheck[data-batch="'+batchId+'"]'))
      .filter(function(c){ return c.checked; }).map(function(c){ return c.getAttribute('data-id'); });
  }
  function refreshBatchBar(batchId){
    var n = selInBatch(batchId).length;
    var btn = wrap.querySelector('[data-arch-restore="'+batchId+'"]');
    if (btn) btn.disabled = (n === 0);
    var all = wrap.querySelector('.restoreSelectAll[data-batch="'+batchId+'"]');
    var total = wrap.querySelectorAll('.restoreCheck[data-batch="'+batchId+'"]').length;
    if (all) all.checked = (n > 0 && n === total);
  }

  wrap.querySelectorAll('.restoreCheck').forEach(function(c){
    c.addEventListener('change', function(){ refreshBatchBar(c.getAttribute('data-batch')); });
  });
  wrap.querySelectorAll('.restoreSelectAll').forEach(function(all){
    all.addEventListener('change', function(){
      var bid = all.getAttribute('data-batch');
      wrap.querySelectorAll('.restoreCheck[data-batch="'+bid+'"]').forEach(function(c){ c.checked = all.checked; });
      refreshBatchBar(bid);
    });
  });

  wrap.querySelectorAll('[data-arch-restore]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var bid = btn.getAttribute('data-arch-restore');
      var ids = selInBatch(bid);
      if (!ids.length) return;
      var n = restoreFromBatch(bid, ids);
      renderArchivePane(wrap);
      setStatus('Restored '+n+' entr'+(n===1?'y':'ies')+' to the active set ('+slides.length+' active now).', true);
    });
  });
  wrap.querySelectorAll('[data-arch-restoreall]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var bid = btn.getAttribute('data-arch-restoreall');
      var n = restoreFromBatch(bid, null);
      renderArchivePane(wrap);
      setStatus('Restored all '+n+' entr'+(n===1?'y':'ies')+' from the batch ('+slides.length+' active now).', true);
    });
  });
  wrap.querySelectorAll('[data-arch-pdf]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var b = archives.find(function(x){ return x.id === btn.getAttribute('data-arch-pdf'); });
      if (b) exportPdf(b.slides, b.label);
    });
  });
  wrap.querySelectorAll('[data-arch-json]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var b = archives.find(function(x){ return x.id === btn.getAttribute('data-arch-json'); });
      if (b) exportJson(b.slides, b.label);
    });
  });
  wrap.querySelectorAll('[data-arch-rename]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var b = archives.find(function(x){ return x.id === btn.getAttribute('data-arch-rename'); });
      if (!b) return;
      var label = window.prompt('Rename this batch:', b.label);
      if (label === null) return;
      renameBatch(b.id, label);
      renderArchivePane(wrap);
    });
  });
  wrap.querySelectorAll('[data-arch-delete]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var b = archives.find(function(x){ return x.id === btn.getAttribute('data-arch-delete'); });
      if (!b) return;
      if (!window.confirm('Permanently delete the batch "'+b.label+'" and its '+b.slides.length+' entr'+(b.slides.length===1?'y':'ies')+'? This cannot be undone. (Tip: Export it first if you might need it.)')) return;
      deleteBatch(b.id);
      renderArchivePane(wrap);
      setStatus('Deleted batch "'+b.label+'".', true);
    });
  });
}

function renderExportPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Export slides</h2></div>'
      + '<p class="panel__hint">Exports respect the Platform / Region / Date / Search filters set on the browse view. <strong>Export as Email</strong> produces the same styled briefing as the Generate email tab — reporting period, summary, per-platform counts, and every update with its platform badge and source link — as a self-contained <code>.html</code> file you can open, forward, or paste into your inbox.</p>'
      + '<div class="scopepick">'
        + '<label><input type="radio" name="exportScope" value="filtered" checked> Current filtered view ('+filteredSlides().length+')</label>'
        + '<label><input type="radio" name="exportScope" value="all"> All slides ('+slides.length+')</label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="exportEmailBtn">Export as Email (HTML)</button>'
        + '<button type="button" class="btn btn--ghost" id="exportPdfBtn">Export as PDF</button>'
        + '<button type="button" class="btn btn--ghost" id="exportJsonBtn">Export as JSON (for re-import)</button>'
      + '</div>'
    + '</div>'

    + '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Manage slides</h2></div>'
      + '<p class="panel__hint">Fix anything the importer guessed wrong — title, platform, region, date, source link — and it saves to this browser as you go. Tick rows to remove them. '
        + (HAS_STORAGE
            ? 'Changes persist across reloads on this device. They are <strong>not</strong> shared with anyone else and are <strong>not</strong> a backup &mdash; export as JSON to move them between machines.'
            : '<strong>Browser storage is unavailable here, so changes will be lost on reload.</strong> Export as JSON before you close the tab.')
      + '</p>'
      + (restoredFrom ? '<p class="panel__hint">Restored '+slides.length+' saved update'+(slides.length===1?'':'s')+' from this browser ('+esc(new Date(restoredFrom).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}))+').</p>' : '')
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn btn--ghost" id="selAllBtn">Select all</button>'
        + '<button type="button" class="btn btn--ghost" id="selNoneBtn">Clear selection</button>'
        + '<button type="button" class="btn btn--danger" id="deleteSelBtn">Remove selected (<span id="delCount">0</span>)</button>'
        + '<button type="button" class="btn btn--ghost" id="resetSeedBtn" style="margin-left:auto;">Reset to source deck</button>'
      + '</div>'
      + '<div class="slidelist" id="slideList">'
        + (slides.length
            ? slides.map(function(s){
                return '<div class="slideedit" data-id="'+esc(s.id)+'">'
                  + '<div class="slideedit__top">'
                    + '<input type="checkbox" class="slidelist__cb" value="'+esc(s.id)+'"'+(state.selectedForDelete.has(s.id)?' checked':'')+' aria-label="Select for removal">'
                    + '<input type="text" class="slideedit__title" data-f="title" value="'+esc(s.title)+'" placeholder="Title">'
                  + '</div>'
                  + '<div class="slideedit__grid">'
                    + '<label>Platform<select data-f="platform">'
                      + ALLOWED_PLATFORMS.map(function(p){ return '<option value="'+esc(p)+'"'+(s.platform===p?' selected':'')+'>'+esc(p)+'</option>'; }).join('')
                    + '</select></label>'
                    + '<label>Region<select data-f="region">'
                      + ALLOWED_REGIONS.map(function(r){ return '<option value="'+esc(r)+'"'+(s.region===r?' selected':'')+'>'+esc(r)+'</option>'; }).join('')
                    + '</select></label>'
                    + '<label>Date<input type="date" data-f="date" value="'+esc(s.date||'')+'"></label>'
                    + '<label class="slideedit__link">Source link<input type="url" data-f="link" value="'+esc(s.link||'')+'" placeholder="https://…"></label>'
                  + '</div>'
                + '</div>';
              }).join('')
            : '<p class="panel__hint">No slides loaded.</p>')
      + '</div>'
    + '</div>';

  document.getElementById('exportEmailBtn').addEventListener('click', function(){ exportEmailHtml(); });
  document.getElementById('exportPdfBtn').addEventListener('click', function(){ exportPdf(); });
  document.getElementById('exportJsonBtn').addEventListener('click', function(){ exportJson(); });

  function refreshCount(){
    var el = document.getElementById('delCount');
    if (el) el.textContent = state.selectedForDelete.size;
  }

  wrap.querySelectorAll('.slidelist__cb').forEach(function(cb){
    cb.addEventListener('change', function(){
      if (cb.checked) state.selectedForDelete.add(cb.value);
      else state.selectedForDelete.delete(cb.value);
      refreshCount();
    });
  });

  // Inline editing. Committed on 'change' (blur / picker close / select) rather
  // than every keystroke, so we're not serialising the whole deck on each letter.
  wrap.querySelectorAll('.slideedit').forEach(function(row){
    var id = row.getAttribute('data-id');
    row.querySelectorAll('[data-f]').forEach(function(field){
      field.addEventListener('change', function(){
        var s = slides.filter(function(x){ return x.id === id; })[0];
        if (!s) return;
        var key = field.getAttribute('data-f');
        var val = field.value.trim();
        if (key === 'title' && !val){
          field.value = s.title;   // titles are required; snap back rather than blank it
          setStatus('Title cannot be empty.', false);
          return;
        }
        s[key] = val;
        state.execHtml = null;     // any cached email is now stale
        state.digestHtml = null;
        if (saveSlides()) setStatus('Saved — ' + esc(s.title), true);
        renderAll();
      });
    });
  });

  document.getElementById('selAllBtn').addEventListener('click', function(){
    slides.forEach(function(s){ state.selectedForDelete.add(s.id); });
    renderExportPane(wrap);
  });
  document.getElementById('selNoneBtn').addEventListener('click', function(){
    state.selectedForDelete.clear();
    renderExportPane(wrap);
  });

  document.getElementById('resetSeedBtn').addEventListener('click', function(){
    if (!window.confirm('Discard the saved working set and reload the slides baked into this page?\n\nEvery edit, import and deletion made in this browser will be lost. Export as JSON first if you want to keep them.')) return;
    clearSavedSlides();
    slides = SEED.slides.slice();
    restoredFrom = null;
    state.selectedForDelete.clear();
    state.openCards.clear();
    state.execHtml = null;
    state.digestHtml = null;
    renderAll();
    renderExportPane(wrap);
    setStatus('Reset to the source deck — ' + slides.length + ' update' + (slides.length===1?'':'s') + '.', true);
  });

  document.getElementById('deleteSelBtn').addEventListener('click', function(){
    var n = state.selectedForDelete.size;
    if (!n){ setStatus('Tick at least one update to remove.', false); return; }
    if (!window.confirm('Remove ' + n + ' update' + (n===1?'':'s') + ' from the working set?\n\nThis is saved to this browser, so it persists across reloads. The source deck is unchanged. Use "Reset to source deck" to undo.')) return;

    slides = slides.filter(function(s){ return !state.selectedForDelete.has(s.id); });
    // Drop any now-dangling references so the browse view and email don't break.
    state.selectedForDelete.forEach(function(id){ state.openCards.delete(id); });
    state.selectedForDelete.clear();
    state.execHtml = null;
    state.digestHtml = null;

    saveSlides();
    renderAll();
    renderExportPane(wrap);
    setStatus('Removed ' + n + ' update' + (n===1?'':'s') + '. ' + slides.length + ' remaining, saved to this browser. Use "Reset to source deck" to restore the original set.', true);
  });

  refreshCount();
}

function renderEmailPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Generate email</h2></div>'
      + '<p class="panel__hint">A short, leadership-facing briefing: reporting period, an auto-generated summary, per-platform counts and the top updates that need attention — each tagged with its platform-coloured badge (LZD in blue, SHP in orange, TTS in black, ZLR in purple). Set a base URL to make the "Open Interactive Newsletter" button clickable. When you hit <strong>Copy for email</strong>, the styled briefing — links live — is placed on your clipboard so it pastes into Gmail or Outlook exactly as previewed.</p>'
      + '<div class="scopepick">'
        + '<label><input type="radio" name="execScope" value="filtered" checked> Current filtered view ('+filteredSlides().length+')</label>'
        + '<label><input type="radio" name="execScope" value="all"> All slides ('+slides.length+')</label>'
      + '</div>'
      + '<div class="fieldrow">'
        + '<label style="flex:1;min-width:240px;">Base URL (optional — makes thumbnails & button clickable)<input type="text" id="emailBaseUrlExec" placeholder="https://yourteam.github.io/platform-updates/" value="'+esc(state.emailBaseUrl)+'"></label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="execGenerateBtn">Generate preview</button>'
      + '</div>'
      + '<div id="execPreviewWrap"></div>'
    + '</div>';

  document.getElementById('emailBaseUrlExec').addEventListener('input', function(e){ state.emailBaseUrl = e.target.value; });
  document.getElementById('execGenerateBtn').addEventListener('click', generateExecEmail);
  if (state.execHtml) renderExecPreview();
}

/* ============================================================
   DEEP LINKING (so links from the email digest land in the right spot)
   ============================================================ */
function applyUrlParams(){
  var params = new URLSearchParams(window.location.search);
  var region = params.get('region');
  var platform = params.get('platform');
  var from = params.get('from');
  var to = params.get('to');
  var view = params.get('view');
  var q = params.get('q');

  if (region) region.split(',').forEach(function(r){ var n = normalizeRegion(r.trim()); if (n) state.regions.add(n); });
  if (platform) platform.split(',').forEach(function(p){ var n = normalizePlatformStrict(p.trim()); if (n) state.platforms.add(n); });
  if (from) state.dateFrom = from;
  if (to) state.dateTo = to;
  // `view` now controls grouping within the single Browse tab (not the nav item)
  if (view === 'region' || view === 'platform'){ state.view = view; state.nav = 'browse'; }
  if (q) state.search = q;
}

function applyHashDeepLink(){
  var m = /^#slide-(.+)$/.exec(window.location.hash);
  if (!m) return;
  var id = decodeURIComponent(m[1]);
  if (!slides.some(function(s){ return s.id === id; })) return;
  state.openCards.add(id);
  // deep links always land on the browse view
  if (!isBrowseNav(state.nav)) setNav('browse', { silent:true });
  renderMain();
  setTimeout(function(){
    var el = document.querySelector('.card[data-id="'+id.replace(/"/g,'')+'"]');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 80);
}

/* ============================================================
   TOP-LEVEL WIRING
   ============================================================ */
// Toggle which surface is visible: the browse feed (filters + cards) or the
// admin workspace. Keeps the two mutually exclusive so nothing overlaps.
function applyNavVisibility(){
  var browse = isBrowseNav(state.nav);
  document.getElementById('app').classList.toggle('is-hidden', !browse);
  document.getElementById('filterRail').classList.toggle('is-hidden', !browse);
  document.getElementById('searchWrap').classList.toggle('is-hidden', !browse);
  document.getElementById('workspace').hidden = browse;

  var meta = NAV_META[state.nav] || NAV_META.browse;
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSub').textContent = meta.sub;

  document.querySelectorAll('.nav__item').forEach(function(btn){
    btn.classList.toggle('is-active', btn.getAttribute('data-nav') === state.nav);
  });
}

// Only the Members tab is admin-only now. All other admin tabs (add, import,
// export, archive, email) are available to any signed-in member.
var ADMIN_ONLY_NAVS = { members:1 };
function setNav(nav, opts){
  opts = opts || {};

  // Guard admin-only surfaces: non-admins fall back to browse.
  if (ADMIN_ONLY_NAVS[nav] && !(window.AUTH && AUTH.isAdmin())){
    nav = 'browse';
  }

  // "Present" is a modal overlay, not a persistent surface. Launch it over
  // whatever browse view is active, and don't change the underlying nav so
  // closing the overlay returns the user where they were.
  if (nav === 'present'){
    closeSidebar();
    if (!isBrowseNav(state.nav)){ state.nav = 'browse'; applyNavVisibility(); renderFilterRail(); renderMain(); }
    openPresentation();
    return;
  }

  state.nav = nav;
  closeSidebar();
  applyNavVisibility();
  if (isBrowseNav(nav)){
    renderFilterRail();
    renderMain();
  } else {
    renderWorkspace();
  }
  if (!opts.silent) window.scrollTo({ top:0, behavior:'smooth' });
}

// re-render whichever surface is currently showing (used after data changes)
function renderAll(){
  applyNavVisibility();
  if (isBrowseNav(state.nav)){
    renderFilterRail();
    renderMain();
  } else {
    renderWorkspace();
  }
}

function openSidebar(){ state.sidebarOpen = true; document.getElementById('sidebar').classList.add('is-open'); document.getElementById('scrim').hidden = false; }
function closeSidebar(){ state.sidebarOpen = false; document.getElementById('sidebar').classList.remove('is-open'); document.getElementById('scrim').hidden = true; }

function initChrome(){
  document.querySelectorAll('.nav__item').forEach(function(btn){
    btn.addEventListener('click', function(){ setNav(btn.getAttribute('data-nav')); });
  });

  var search = document.getElementById('searchInput');
  search.addEventListener('input', function(){
    state.search = search.value.trim();
    if (isBrowseNav(state.nav)){ renderFilterRail(); renderMain(); }
  });

  document.getElementById('menuToggle').addEventListener('click', function(){
    if (state.sidebarOpen) closeSidebar(); else openSidebar();
  });
  document.getElementById('scrim').addEventListener('click', closeSidebar);
}

document.addEventListener('DOMContentLoaded', function(){
  applyUrlParams();
  AUTH.loadCfg();
  AUTH.loadSession();

  // Gate 1: first-run setup (this device has no Supabase config yet).
  if (!AUTH.isConfigured()){
    renderSetupGate();
    return;
  }
  // Gate 2: not logged in on this device.
  if (!AUTH.getSession()){
    renderLoginGate();
    return;
  }
  // Logged in + configured -> boot the real app.
  bootApp();
});

/* Boot the main application once auth + config are satisfied. Pulls the shared
   data from the bin so this device shows what everyone else sees. */
function bootApp(){
  hideGate();
  document.getElementById('searchInput').value = state.search;
  initChrome();
  initPresentControls();
  applyRoleVisibility();

  // Open the local IDB cache first (fast paint), then override with the bin.
  initSlides().then(function(){
    setNav(state.nav, { silent:true });
    applyHashDeepLink();
    // Pull authoritative shared data.
    setSyncStatus('Loading shared updates…');
    return AUTH.pullData();
  }).then(function(data){
    if (data){
      if (Array.isArray(data.slides)) slides = data.slides;
      if (Array.isArray(data.archives)) archives = data.archives;
      restoredFrom = Date.now();
      // Refresh local cache to match shared truth.
      if (HAS_STORAGE){
        _idbWriteChain = _idbWriteChain
          .then(function(){ return idbSet(IDB_KEY, { savedAt:Date.now(), slides:slides }); })
          .then(function(){ return idbSet(IDB_ARCHIVE_KEY, { savedAt:Date.now(), archives:archives }); })
          .catch(function(){});
      }
      renderAll();
      setSyncStatus('Shared updates loaded ✓', true);
    }
  }).catch(function(e){
    setSyncStatus('Could not load shared updates ('+(e && e.message ? e.message : 'network error')+'). Showing this device\'s last cached copy.', false);
  });
}

/* ============================================================
   AUTHORSHIP DISPLAY
   ============================================================ */
function fmtStamp(ts){
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch(e){ return ''; }
}
function authorLine(s){
  var bits = [];
  if (s.createdBy) bits.push('Added by <strong>'+esc(s.createdBy)+'</strong>' + (s.createdAt ? ' · '+esc(fmtStamp(s.createdAt)) : ''));
  if (s.updatedAt && s.createdAt && s.updatedAt !== s.createdAt){
    bits.push('edited by <strong>'+esc(s.updatedBy||'?')+'</strong> · '+esc(fmtStamp(s.updatedAt)));
  }
  if (!bits.length) return '';
  return '<div class="card__author">'+bits.join(' &nbsp;•&nbsp; ')+'</div>';
}

/* ============================================================
   AUTH GATES  (setup / login) and role-based chrome
   ============================================================ */
function ensureGateEl(){
  var g = document.getElementById('authGate');
  if (!g){
    g = document.createElement('div');
    g.id = 'authGate';
    g.className = 'authgate';
    document.body.appendChild(g);
  }
  return g;
}
function hideGate(){
  var g = document.getElementById('authGate');
  if (g) g.remove();
  var shell = document.querySelector('.shell');
  if (shell) shell.style.display = '';
}
function showGate(html){
  var shell = document.querySelector('.shell');
  if (shell) shell.style.display = 'none';
  var overlay = document.getElementById('presentOverlay');
  if (overlay) overlay.hidden = true;
  var g = ensureGateEl();
  g.innerHTML = html;
  return g;
}

/* ---- First-run setup: capture Supabase config + admin password ---- */
function renderSetupGate(){
  var existing = AUTH.getCfg() || {};
  var g = showGate(
    '<div class="authcard">'
      + '<h1 class="authcard__title">Set up shared sync</h1>'
      + '<p class="authcard__lead">This connects the tool to a shared Supabase project so everyone on the team sees the same entries and images. You only do this once per device.</p>'
      + '<div class="authcard__steps">'
        + '<p><strong>First-time project setup (one person does this once, ~5 min):</strong></p>'
        + '<ol>'
          + '<li>Sign up free at <strong>supabase.com</strong> and create a new project.</li>'
          + '<li>Open the <em>SQL Editor</em>, paste the setup snippet (shared separately), and Run it. This creates the <code>store</code> table and the public <code>entry-images</code> bucket.</li>'
          + '<li>Go to <em>Settings → API</em>. Copy the <em>Project URL</em> and the <em>publishable</em> (anon) key.</li>'
          + '<li>Share the Project URL + publishable key with the other 5-6 people so everyone connects to the same project.</li>'
        + '</ol>'
      + '</div>'
      + '<label class="authfield">Project URL<input type="text" id="setupUrl" value="'+esc(existing.url||'')+'" placeholder="https://xxxx.supabase.co" autocomplete="off"></label>'
      + '<label class="authfield">Publishable (anon) key<input type="password" id="setupKey" value="'+esc(existing.key||'')+'" placeholder="sb_publishable_… or eyJ…" autocomplete="off"></label>'
      + '<p class="authcard__note">Images in entries are uploaded to your Supabase Storage bucket and served as public links (anyone with the URL can view — fine for internal screenshots).</p>'
      + '<div class="authcard__adminwrap" id="adminSetupWrap">'
        + '<p class="authcard__note">If this is a brand-new (empty) project, set the first admin password. If a teammate already set it up, leave this blank and just Connect.</p>'
        + '<label class="authfield">Admin password <span class="authfield__opt">(new project only)</span><input type="password" id="setupAdminPw" placeholder="choose an admin password" autocomplete="new-password"></label>'
      + '</div>'
      + '<div class="authcard__msg" id="setupMsg"></div>'
      + '<button type="button" class="btn authcard__btn" id="setupConnect">Connect</button>'
    + '</div>'
  );

  function msg(t, ok){
    var m = g.querySelector('#setupMsg');
    m.textContent = t; m.className = 'authcard__msg' + (ok===true?' is-ok':ok===false?' is-error':'');
  }

  g.querySelector('#setupConnect').addEventListener('click', function(){
    var url = g.querySelector('#setupUrl').value.trim();
    var key = g.querySelector('#setupKey').value.trim();
    var adminPw = g.querySelector('#setupAdminPw').value;
    if (!url || !key){ msg('Enter both the Project URL and the publishable key.', false); return; }
    if (!/^https?:\/\//.test(url)){ msg('Project URL should start with https://', false); return; }
    var btn = g.querySelector('#setupConnect'); btn.disabled = true; msg('Connecting…');

    AUTH.saveCfg({ url:url, key:key });
    AUTH.pull().then(function(r){
      var hasUsers = r && r.users && Object.keys(r.users).length > 0;
      if (hasUsers){
        msg('Connected to existing shared project ✓', true);
        setTimeout(renderLoginGate, 500);
        return;
      }
      if (!adminPw || adminPw.length < 4){
        AUTH.clearCfg();
        btn.disabled = false;
        msg('This looks like a new project. Set an admin password (4+ chars) to initialise it.', false);
        return;
      }
      var seed = (window.__NEWSLETTER_DATA__ && Array.isArray(window.__NEWSLETTER_DATA__.slides))
                 ? window.__NEWSLETTER_DATA__.slides.slice() : [];
      return AUTH.bootstrap(adminPw, seed).then(function(){
        msg('Shared project initialised. Admin account created ✓', true);
        setTimeout(renderLoginGate, 600);
      });
    }).catch(function(e){
      AUTH.clearCfg();
      btn.disabled = false;
      msg('Could not connect: '+(e && e.message ? e.message : 'check the URL, key, and that you ran the SQL setup')+'.', false);
    });
  });
}

/* ---- Login ---- */
function renderLoginGate(){
  var cfg = AUTH.getCfg();
  var g = showGate(
    '<div class="authcard">'
      + '<h1 class="authcard__title">Platform Updates</h1>'
      + '<p class="authcard__lead">Sign in to view and add updates.</p>'
      + '<label class="authfield">Username<input type="text" id="loginUser" autocomplete="username" placeholder="username"></label>'
      + '<label class="authfield">Password<input type="password" id="loginPw" autocomplete="current-password" placeholder="password"></label>'
      + '<div class="authcard__msg" id="loginMsg"></div>'
      + '<button type="button" class="btn authcard__btn" id="loginBtn">Sign in</button>'
      + '<button type="button" class="authlink" id="reconfigBtn">Change shared-store settings</button>'
    + '</div>'
  );

  function msg(t, ok){
    var m = g.querySelector('#loginMsg');
    m.textContent = t; m.className = 'authcard__msg' + (ok===true?' is-ok':ok===false?' is-error':'');
  }
  function doLogin(){
    var u = g.querySelector('#loginUser').value;
    var p = g.querySelector('#loginPw').value;
    if (!u || !p){ msg('Enter your username and password.', false); return; }
    var btn = g.querySelector('#loginBtn'); btn.disabled = true; msg('Signing in…');
    AUTH.login(u, p).then(function(){
      bootApp();
    }).catch(function(e){
      btn.disabled = false;
      msg(e && e.message ? e.message : 'Sign in failed.', false);
    });
  }
  g.querySelector('#loginBtn').addEventListener('click', doLogin);
  g.querySelector('#loginPw').addEventListener('keydown', function(e){ if (e.key === 'Enter') doLogin(); });
  g.querySelector('#reconfigBtn').addEventListener('click', function(){
    if (confirm('This will forget the shared-project settings ON THIS DEVICE only (the shared data itself is not touched). You will need the Project URL and publishable key to reconnect. Continue?')){
      AUTH.clearCfg(); AUTH.logout(); renderSetupGate();
    }
  });
  setTimeout(function(){ var el = g.querySelector('#loginUser'); if (el) el.focus(); }, 50);
}

/* ---- Role-based chrome: everyone sees the admin tools except Members ---- */
function applyRoleVisibility(){
  var admin = AUTH.isAdmin();

  // The admin nav group (Add entry, Export, Generate email, Archive, …) is now
  // available to all signed-in users, so keep it visible for everyone.
  var adminNav = document.getElementById('adminNav');
  if (adminNav) adminNav.style.display = '';

  // Members tab stays admin-only — hide the button from non-admins so other
  // people's credentials aren't exposed.
  var membersBtn = document.querySelector('.nav__item[data-nav="members"]');
  if (membersBtn) membersBtn.style.display = admin ? '' : 'none';

  // Session bar (who am I + logout) in the sidebar footer.
  var foot = document.querySelector('.sidebar__foot');
  if (foot){
    var sess = AUTH.getSession();
    foot.innerHTML =
      '<div class="sessionbar">'
        + '<div class="sessionbar__who">Signed in as <strong>'+esc(sess ? sess.username : '?')+'</strong>'
          + '<span class="sessionbar__role">'+(admin ? 'admin' : 'member')+'</span></div>'
        + '<button type="button" class="authlink authlink--out" id="logoutBtn">Sign out</button>'
      + '</div>'
      + '<div class="syncstatus" id="syncStatus"></div>';
    var lo = foot.querySelector('#logoutBtn');
    if (lo) lo.addEventListener('click', function(){ AUTH.logout(); renderLoginGate(); });
  }
}

/* ============================================================
   MEMBERS PANE  (admin only): create users, reset passwords,
   change roles, remove users.
   ============================================================ */
function renderMembersPane(wrap){
  if (!AUTH.isAdmin()){
    wrap.innerHTML = '<div class="panel"><p class="panel__hint">This section is for admins only.</p></div>';
    return;
  }

  function draw(users){
    wrap.innerHTML =
      '<div class="panel">'
        + '<div class="panel__head"><h2 class="panel__title">Create a user</h2></div>'
        + '<p class="panel__hint">Create a username and password, then share those credentials with the person. They sign in on their own device and can add entries; everything they add is stamped with their name and the time. Passwords here are lightweight — fine for tracking who did what, not for protecting secrets.</p>'
        + '<div class="memberform">'
          + '<label class="authfield">Username<input type="text" id="newUser" placeholder="e.g. maria"></label>'
          + '<label class="authfield">Display name<input type="text" id="newName" placeholder="e.g. Maria Santos"></label>'
          + '<label class="authfield">Email<input type="email" id="newEmail" placeholder="e.g. maria@company.com"></label>'
          + '<label class="authfield">Password<input type="text" id="newPw" placeholder="give them a starter password"></label>'
          + '<label class="authfield">Role<select id="newRole"><option value="member">Member</option><option value="admin">Admin</option></select></label>'
          + '<button type="button" class="btn" id="createUserBtn">Create user</button>'
        + '</div>'
        + '<div class="authcard__msg" id="memberMsg"></div>'
      + '</div>'
      + '<div class="panel">'
        + '<div class="panel__head"><h2 class="panel__title">People ('+users.length+')</h2></div>'
        + '<p class="panel__hint">Reset a password if someone forgets theirs (share the new one with them), change a role, or remove access.</p>'
        + '<div class="memberlist">'
          + (users.length ? users.map(memberRow).join('') : '<p class="panel__hint">No users yet.</p>')
        + '</div>'
      + '</div>';

    var msgEl = wrap.querySelector('#memberMsg');
    function msg(t, ok){ msgEl.textContent = t; msgEl.className = 'authcard__msg' + (ok===true?' is-ok':ok===false?' is-error':''); }

    wrap.querySelector('#createUserBtn').addEventListener('click', function(){
      var u = wrap.querySelector('#newUser').value;
      var p = wrap.querySelector('#newPw').value;
      var role = wrap.querySelector('#newRole').value;
      var dn = wrap.querySelector('#newName').value;
      var em = wrap.querySelector('#newEmail').value;
      msg('Creating…');
      AUTH.createUser(u, p, role, { displayName:dn, email:em }).then(function(name){
        msg('Created "'+name+'". Share these credentials — username: '+name+', password: '+p, true);
        refresh();
      }).catch(function(e){ msg(e.message || 'Could not create user.', false); });
    });

    wrap.querySelectorAll('.memberrow').forEach(function(row){
      var name = row.getAttribute('data-user');
      var r = row.querySelector('.memberrow__reset');
      var d = row.querySelector('.memberrow__del');
      var roleSel = row.querySelector('.memberrow__role');
      var editBtn = row.querySelector('.memberrow__edit');
      var editForm = row.querySelector('.memberrow__editform');
      var saveBtn = row.querySelector('.memberrow__save');
      var cancelEdit = row.querySelector('.memberrow__canceledit');
      if (editBtn && editForm) editBtn.addEventListener('click', function(){
        editForm.hidden = !editForm.hidden;
      });
      if (cancelEdit && editForm) cancelEdit.addEventListener('click', function(){ editForm.hidden = true; });
      if (saveBtn && editForm) saveBtn.addEventListener('click', function(){
        var dn = row.querySelector('.memberrow__editname').value;
        var em = row.querySelector('.memberrow__editemail').value;
        AUTH.updateUser(name, { displayName:dn, email:em })
          .then(function(){ msg('Updated details for "'+name+'".', true); refresh(); })
          .catch(function(e){ msg(e.message || 'Could not save details.', false); });
      });
      if (r) r.addEventListener('click', function(){
        var np = prompt('New password for "'+name+'":');
        if (np == null) return;
        AUTH.resetPassword(name, np).then(function(){
          msg('Password reset for "'+name+'". New password: '+np+' — share it with them.', true);
        }).catch(function(e){ msg(e.message || 'Reset failed.', false); });
      });
      if (d) d.addEventListener('click', function(){
        if (!confirm('Remove "'+name+'"? They will no longer be able to sign in. Entries they already added stay in place.')) return;
        AUTH.deleteUser(name).then(function(){ msg('Removed "'+name+'".', true); refresh(); })
          .catch(function(e){ msg(e.message || 'Could not remove.', false); });
      });
      if (roleSel) roleSel.addEventListener('change', function(){
        AUTH.setRole(name, roleSel.value).then(function(){ msg('Updated role for "'+name+'".', true); refresh(); })
          .catch(function(e){ msg(e.message || 'Could not update role.', false); refresh(); });
      });
    });
  }

  function memberRow(u){
    var meta = [];
    if (u.createdAt) meta.push('created '+esc(fmtStamp(u.createdAt)) + (u.createdBy ? ' by '+esc(u.createdBy) : ''));
    if (u.pwResetAt) meta.push('pw reset '+esc(fmtStamp(u.pwResetAt)));
    if (u.updatedAt) meta.push('details edited '+esc(fmtStamp(u.updatedAt)) + (u.updatedBy ? ' by '+esc(u.updatedBy) : ''));
    var isPrimary = u.username === 'admin';
    var details = [];
    if (u.displayName) details.push(esc(u.displayName));
    if (u.email) details.push(esc(u.email));
    var detailLine = details.length ? details.join(' · ') : '<span class="memberrow__nodetail">No display name or email set</span>';
    return '<div class="memberrow" data-user="'+esc(u.username)+'">'
      + '<div class="memberrow__main">'
        + '<span class="memberrow__name">'+esc(u.username)+'</span>'
        + '<select class="memberrow__role"'+(isPrimary?' disabled':'')+'>'
          + '<option value="member"'+(u.role==='member'?' selected':'')+'>Member</option>'
          + '<option value="admin"'+(u.role==='admin'?' selected':'')+'>Admin</option>'
        + '</select>'
      + '</div>'
      + '<div class="memberrow__details">'+detailLine+'</div>'
      + '<div class="memberrow__meta">'+meta.join(' · ')+'</div>'
      + '<div class="memberrow__actions">'
        + '<button type="button" class="btn btn--ghost memberrow__edit">Edit details</button>'
        + '<button type="button" class="btn btn--ghost memberrow__reset">Reset password</button>'
        + (isPrimary ? '' : '<button type="button" class="btn btn--danger memberrow__del">Remove</button>')
      + '</div>'
      + '<div class="memberrow__editform" hidden>'
        + '<label class="authfield">Display name<input type="text" class="memberrow__editname" value="'+esc(u.displayName||'')+'" placeholder="e.g. Maria Santos"></label>'
        + '<label class="authfield">Email<input type="email" class="memberrow__editemail" value="'+esc(u.email||'')+'" placeholder="e.g. maria@company.com"></label>'
        + '<div class="memberrow__editactions">'
          + '<button type="button" class="btn memberrow__save">Save details</button>'
          + '<button type="button" class="btn btn--ghost memberrow__canceledit">Cancel</button>'
        + '</div>'
      + '</div>'
    + '</div>';
  }

  function refresh(){
    AUTH.pull().then(function(){ draw(AUTH.listUsers()); })
      .catch(function(){ wrap.innerHTML = '<div class="panel"><p class="panel__hint">Could not load the user list — network error.</p></div>'; });
  }

  wrap.innerHTML = '<div class="panel"><p class="panel__hint">Loading users…</p></div>';
  refresh();
}

})();
