(function(){
"use strict";

/* ============================================================
   DATA
   ============================================================ */
var SEED = window.__NEWSLETTER_DATA__ || { allowed_platforms: [], allowed_regions: [], warnings: [], slides: [] };

var ALLOWED_PLATFORMS = SEED.allowed_platforms.slice();
var ALLOWED_REGIONS   = SEED.allowed_regions.slice();

/* ============================================================
   PERSISTENCE
   The working set is saved to browser storage so edits, imports and deletions
   survive a reload. Storage is per-browser and per-device — it is NOT a shared
   database and NOT a backup. The source deck remains the system of record;
   "Export as JSON" remains the way to move a working set between machines.
   Wrapped in try/catch throughout: private-browsing modes and some embedded
   webviews throw on localStorage access, in which case we fall back silently to
   the old session-only behaviour rather than breaking the page.
   ============================================================ */
var LS_KEY = 'platformUpdates.slides.v1';

function storageAvailable(){
  try {
    var t = '__pu_probe__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return true;
  } catch (e) { return false; }
}
var HAS_STORAGE = storageAvailable();

function saveSlides(){
  if (!HAS_STORAGE) return false;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: Date.now(), slides: slides }));
    return true;
  } catch (e) {
    // Most likely the quota: slides carry base64 images and localStorage caps
    // around 5MB. Tell the truth rather than pretending the save worked.
    setStatus('Could not save to browser storage — you are probably over the ~5MB limit (slide images are the usual cause). Your changes are still live in this tab, but will be lost on reload. Export as JSON to keep them.', false);
    return false;
  }
}

function loadSavedSlides(){
  if (!HAS_STORAGE) return null;
  try {
    var raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    var arr = Array.isArray(parsed) ? parsed : parsed.slides;
    if (!Array.isArray(arr) || !arr.length) return null;
    return { slides: arr, savedAt: parsed.savedAt || null };
  } catch (e) { return null; }
}

function clearSavedSlides(){
  if (!HAS_STORAGE) return;
  try { window.localStorage.removeItem(LS_KEY); } catch (e) {}
}

// live, mutable working set. Seeded from the deck baked into index.html, then
// overridden by anything previously saved to browser storage (see initSlides()).
var slides = SEED.slides.slice();
var restoredFrom = null;

function initSlides(){
  var saved = loadSavedSlides();
  if (saved){
    slides = saved.slides;
    restoredFrom = saved.savedAt;
  }
}
initSlides();

/* ============================================================
   STATE
   ============================================================ */
var state = {
  // nav: which left-sidebar item is active.
  //   browse views: 'platform' | 'region'
  //   admin panes:  'import' | 'export' | 'digest' | 'email'
  nav: 'platform',
  view: 'platform',            // mirrors nav for the two browse views (kept for grouping logic)
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
  execCriticalCount: 5,
  selectedForDelete: new Set()  // slide ids ticked in the Manage/Delete pane
};

var BROWSE_VIEWS = { platform: true, region: true };
function isBrowseNav(nav){ return !!BROWSE_VIEWS[nav]; }

var NAV_META = {
  platform: { title: 'By Platform', sub: 'Every update, grouped by marketplace.' },
  region:   { title: 'By Region',   sub: 'Every update, grouped by market — the same grouping used in the email view.' },
  import:   { title: 'Import slides', sub: 'Bring in a PowerPoint deck or a JSON backup.' },
  export:   { title: 'Export slides', sub: 'Download the current view as PDF or JSON.' },
  digest:   { title: 'Regional digests', sub: 'Inline-styled HTML emails, one per region.' },
  email:    { title: 'Generate email', sub: 'A leadership briefing you can preview and paste straight into your inbox.' }
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
  slides.forEach(function(s){
    var n = parseInt(String(s.id||'').replace(/\D/g,''),10);
    if (!isNaN(n)) max = Math.max(max, n);
  });
  return 's' + String(max+1).padStart(3,'0');
}

function nextSlideNum(){
  var max = 0;
  slides.forEach(function(s){ if (typeof s.slide_num === 'number') max = Math.max(max, s.slide_num); });
  return max + 1;
}

function fmtDate(iso){
  if (!iso) return '';
  var d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
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
      s.body.map(function(b){ return b.text || ''; }).join(' ')).toLowerCase();
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
    if (b.type === 'header'){
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

function excerptOf(s){
  var firstPara = s.body.find(function(b){ return b.type === 'para'; });
  return firstPara ? firstPara.text : '';
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

function exportJson(){
  var scope = currentExportScope();
  var list = scope === 'filtered' ? filteredSlides() : slides;
  if (!list.length){ setStatus('Nothing to export — the current selection has no slides.', false); return; }
  var stamp = new Date().toISOString().slice(0,10);
  var payload = {
    allowed_platforms: ALLOWED_PLATFORMS,
    allowed_regions: ALLOWED_REGIONS,
    exported_at: new Date().toISOString(),
    scope: scope,
    slides: list
  };
  download('newsletter-updates-'+scope+'-'+stamp+'.json', JSON.stringify(payload, null, 2), 'application/json');
  setStatus('Exported '+list.length+' slide'+(list.length===1?'':'s')+' as JSON ('+scope+'). Use this file to re-import into this tool.', true);
}

function buildPrintDoc(list){
  var g = groupAndOrder(list);
  var scopeLabel = currentExportScope() === 'all' ? 'All updates' : 'Filtered view';
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
        + (s.link ? '<div class="pdf-card__link">'+esc(s.link)+'</div>' : '')
      + '</div>';
    });
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function exportPdf(){
  var scope = currentExportScope();
  var list = scope === 'filtered' ? filteredSlides() : slides;
  if (!list.length){ setStatus('Nothing to export — the current selection has no slides.', false); return; }

  var printArea = document.getElementById('printArea');
  printArea.innerHTML = buildPrintDoc(list);

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
        ? '<a href="'+esc(s.link)+'" style="font-size:13px;font-weight:700;color:'+accent+';text-decoration:none;">Read more &#8594;</a>'
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
+ '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
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

function exportEmailDigest(){
  var audience = document.getElementById('emailAudience').value;
  var baseUrl = document.getElementById('emailBaseUrl').value.trim();
  var region = audience === '__all__' ? null : audience;
  var list = slidesForAudience(region);

  if (!list.length){
    setStatus('Nothing to include — no slides match the current filters'+(region ? ' for '+region : '')+'.', false);
    return;
  }

  var html = buildEmailHtml(list, {
    audienceLabel: region || 'All regions',
    groupByRegion: !region,
    baseUrl: baseUrl
  });

  var stamp = new Date().toISOString().slice(0,10);
  var slug = region ? region.toLowerCase() : 'all-regions';
  download('email-digest-'+slug+'-'+stamp+'.html', html, 'text/html');
  setStatus('Downloaded the email digest for '+(region || 'all regions')+' ('+list.length+' update'+(list.length===1?'':'s')+'). Open the .html file and copy its contents into your email client, or forward it as an HTML attachment.', true);
}

async function exportAllRegionalDigests(){
  var baseUrl = document.getElementById('emailBaseUrl').value.trim();
  var zip = new JSZip();
  var stamp = new Date().toISOString().slice(0,10);
  var included = 0;

  ALLOWED_REGIONS.forEach(function(region){
    var list = slidesForAudience(region);
    if (!list.length) return;
    var html = buildEmailHtml(list, { audienceLabel: region, groupByRegion: false, baseUrl: baseUrl });
    zip.file('email-digest-'+region.toLowerCase()+'-'+stamp+'.html', html);
    included++;
  });

  var allList = slidesForAudience(null);
  if (allList.length){
    zip.file('email-digest-all-regions-'+stamp+'.html', buildEmailHtml(allList, { audienceLabel: 'All regions', groupByRegion: true, baseUrl: baseUrl }));
    included++;
  }

  if (!included){
    setStatus('Nothing to export — no slides match the current Platform/Date/Search filters.', false);
    return;
  }

  setStatus('Zipping '+included+' digest'+(included===1?'':'s')+'…', true);
  var blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob('email-digests-'+stamp+'.zip', blob);
  setStatus('Downloaded '+included+' regional email digest'+(included===1?'':'s')+' as a zip.', true);
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

function pickCriticalUpdates(list, n){
  var scored = list.map(function(s){ return { s: s, score: scoreCriticality(s) }; });
  scored.sort(function(a, b){
    if (b.score !== a.score) return b.score - a.score;
    return (b.s.date || '').localeCompare(a.s.date || ''); // ties: most recent first
  });
  return scored.slice(0, Math.min(n, scored.length)).map(function(x){ return x.s; });
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

  var s3 = criticalList.length
    ? criticalList.length + ' update' + (criticalList.length === 1 ? ' is' : 's are') + ' flagged below as needing closer attention from sellers.'
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

// Renders the platform square. This MUST be a <table> with a bgcolor attribute
// on the <td> — not a <div> with a CSS background. Outlook renders through Word,
// which silently drops `background` on a div inside a table cell, which is why
// the badges were showing as bare letters (L, T, S) on a white card. The
// bgcolor ATTRIBUTE is the only fill Word reliably honours.
function platformBadge(platform, size){
  size = size || 48;
  var bg = PLATFORM_BADGE_COLOR[platform] || '#1b2a4a';
  var initial = (platform || '?').charAt(0).toUpperCase();
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
      + 'width="' + size + '" height="' + size + '" style="border-collapse:collapse;">'
    + '<tr>'
      + '<td bgcolor="' + bg + '" align="center" valign="middle" '
        + 'width="' + size + '" height="' + size + '" '
        + 'style="background-color:' + bg + ';width:' + size + 'px;height:' + size + 'px;'
        + 'border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;'
        + 'font-size:' + Math.round(size * 0.42) + 'px;font-weight:700;text-align:center;'
        + 'line-height:' + size + 'px;mso-line-height-rule:exactly;">'
        + esc(initial)
      + '</td>'
    + '</tr>'
  + '</table>';
}

// Platform name in its brand colour, region in bold. Gives the eye two separate
// hooks — colour for "which marketplace", weight for "which market" — instead of
// one flat grey meta line where everything reads the same.
function platformRegionMeta(s){
  var color = PLATFORM_BADGE_COLOR[s.platform] || '#1b2a4a';
  return '<span style="color:' + color + ';font-weight:700;text-transform:uppercase;letter-spacing:.06em;">' + esc(s.platform) + '</span>'
    + '<span style="color:#c3cad3;">&nbsp;|&nbsp;</span>'
    + '<span style="color:#2d3748;font-weight:700;">' + esc(s.region) + '</span>'
    + (s.date ? '<span style="color:#8f9aa8;font-weight:400;">&nbsp;&middot;&nbsp;' + esc(fmtDate(s.date)) + '</span>' : '');
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
          + '<div style="font-size:22px;font-weight:800;color:' + c + ';font-family:Arial,Helvetica,sans-serif;line-height:1;">' + platformCounts[p] + '</div>'
          + '<div style="font-size:11px;color:#6b7684;text-transform:uppercase;letter-spacing:.06em;font-family:Arial,Helvetica,sans-serif;margin-top:4px;font-weight:700;">' + esc(p) + '</div>'
        + '</td>'
      + '</tr></table>'
    + '</td>';
  }).join('');

  var summaryText = generateExecSummary(list, criticalList);

  var criticalHtml = criticalList.map(function(s, i){
    var accent = PLATFORM_BADGE_COLOR[s.platform] || '#1b2a4a';
    var linkEl = s.link
      ? '<a href="' + esc(s.link) + '" style="display:inline-block;font-size:13px;color:' + accent + ';text-decoration:none;font-weight:700;">Read more &#8594;</a>'
      : '';

    // Thumbnail if the slide has a picture, else the platform square. Both are
    // table-based with bgcolor so Word/Outlook can't drop the fill.
    var thumb = thumbs[s.id];
    var tLink = toolLink(baseUrl, s);
    var imgCell;
    if (thumb) {
      var imgTag = '<img src="' + thumb + '" width="48" height="48" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid #dfe3e8;display:block;" alt="' + esc(s.title) + '">';
      imgCell = tLink ? '<a href="' + esc(tLink) + '" style="text-decoration:none;">' + imgTag + '</a>' : imgTag;
    } else {
      imgCell = platformBadge(s.platform, 48);
    }

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

        + '<td valign="top" style="padding:18px 14px 18px 12px;width:48px;">' + imgCell + '</td>'

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
  + '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">'
  + '<title>Platform Updates — Executive Briefing</title></head>'
  + '<body style="margin:0;padding:0;background:#eef1f4;">'
  + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;"><tr><td align="center" style="padding:28px 12px;">'
  + '<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;max-width:640px;width:100%;border:1px solid #dfe3e8;">'

    + '<tr><td style="background:#1b2a4a;padding:30px 32px;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8fa3c7;">Executive Briefing</div>'
      + '<div style="font-size:25px;font-weight:800;color:#ffffff;margin-top:6px;">Platform Updates</div>'
      + '<div style="font-size:14px;color:#c3ceda;margin-top:6px;">Reporting period: ' + esc(periodLabel) + '</div>'
    + '</td></tr>'

    + (countsHtml ? '<tr><td style="padding:20px 32px 18px;border-bottom:1px solid #e3e7ec;">'
        + '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' + countsHtml + '</tr></table>'
      + '</td></tr>' : '')

    + '<tr><td style="padding:22px 32px;font-family:Arial,Helvetica,sans-serif;">'
      + '<div style="font-size:13px;font-weight:700;color:#1b2a4a;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Executive Summary</div>'
      + '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;"><tr>'
        + '<td bgcolor="#1b2a4a" width="3" style="background-color:#1b2a4a;width:3px;font-size:0;line-height:0;">&nbsp;</td>'
        + '<td bgcolor="#f4f6f8" style="background-color:#f4f6f8;padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#3d4552;line-height:1.65;">' + esc(summaryText) + '</td>'
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
        + '<button type="button" class="btn btn--ghost" id="execCopyHtmlBtn">Copy HTML source</button>'
        + '<button type="button" class="btn btn--ghost" id="execDownloadBtn">Download .html</button>'
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
      setStatus('Couldn\'t copy the styled version automatically. Use "Download .html", open the file, then select-all and copy into your email.', false);
    });
  });
  document.getElementById('execCopyHtmlBtn').addEventListener('click', function(){
    navigator.clipboard.writeText(state.execHtml).then(function(){
      setStatus('Copied the raw HTML source — useful for pasting into an email template or a CMS "source" view.', true);
    }).catch(function(){
      setStatus('Could not copy the source automatically — use the Download button instead.', false);
    });
  });
  document.getElementById('execDownloadBtn').addEventListener('click', function(){
    var stamp = new Date().toISOString().slice(0,10);
    download('executive-email-' + stamp + '.html', state.execHtml, 'text/html');
    setStatus('Downloaded the email as HTML. Open it and copy its contents into your email client, or forward it as an HTML attachment.', true);
  });
}

/* ============================================================
   REGIONAL DIGEST — inline preview (mirrors the exec preview)
   ============================================================ */
function previewRegionalDigest(){
  var audience = state.emailAudience;
  var region = audience === '__all__' ? null : audience;
  var list = slidesForAudience(region);
  var wrap = document.getElementById('digestPreviewWrap');
  if (!list.length){
    if (wrap) wrap.innerHTML = '';
    setStatus('Nothing to preview — no slides match the current filters'+(region ? ' for '+region : '')+'.', false);
    return;
  }
  var html = buildEmailHtml(list, {
    audienceLabel: region || 'All regions',
    groupByRegion: !region,
    baseUrl: state.emailBaseUrl.trim()
  });
  state.digestHtml = html;

  wrap.innerHTML =
    '<div class="emailpreview">'
      + '<div class="emailpreview__bar">'
        + '<span class="emailpreview__label">Digest preview — '+esc(region || 'All regions')+'</span>'
        + '<button type="button" class="btn copybtn" id="digestCopyBtn"><span class="copybtn__toast">Copied — paste into your email</span>Copy for email</button>'
        + '<button type="button" class="btn btn--ghost" id="digestDownloadBtn">Download .html</button>'
      + '</div>'
      + '<iframe id="digestPreviewFrame" title="Regional digest preview"></iframe>'
    + '</div>';
  document.getElementById('digestPreviewFrame').srcdoc = html;

  document.getElementById('digestCopyBtn').addEventListener('click', function(){
    var btn = this;
    copyRichEmail(html, function(){
      flashToast(btn);
      setStatus('Copied. Paste into a new email — layout and links come across as previewed.', true);
    }, function(){
      setStatus('Couldn\'t copy automatically. Use "Download .html", open the file, then select-all and copy.', false);
    });
  });
  document.getElementById('digestDownloadBtn').addEventListener('click', exportEmailDigest);
  setStatus('Preview ready for '+(region || 'all regions')+' ('+list.length+' update'+(list.length===1?'':'s')+'). Copy it for email, or download the HTML.', true);
}

async function generateExecEmail(){
  var scope = currentExecScope();
  var list = scope === 'all' ? slides : filteredSlides();
  if (!list.length){
    setStatus('Nothing to include — no slides in the selected scope.', false);
    return;
  }

  var n = parseInt(document.getElementById('execCriticalCount').value, 10) || 5;
  state.execCriticalCount = n;
  var criticalList = pickCriticalUpdates(list, n);

  var baseUrlEl = document.getElementById('emailBaseUrl');
  var baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';
  var periodLabel = reportingPeriodLabel(list);

  var withImages = criticalList.filter(firstSlideImage);
  var thumbs = {};
  if (withImages.length){
    setStatus('Shrinking ' + withImages.length + ' image' + (withImages.length === 1 ? '' : 's') + ' for the email…', true);
    for (var i = 0; i < withImages.length; i++){
      var s = withImages[i];
      var img = firstSlideImage(s);
      var thumbUrl = await makeThumbnailDataUrl(img.dataUrl, 130);
      if (thumbUrl) thumbs[s.id] = thumbUrl;
    }
  }

  state.execHtml = buildExecEmailHtml(list, criticalList, { periodLabel: periodLabel, baseUrl: baseUrl, thumbs: thumbs });
  renderExecPreview();
  var withImageCount = Object.keys(thumbs).length;
  setStatus('Generated the executive email — ' + list.length + ' update' + (list.length === 1 ? '' : 's') + ', ' + criticalList.length + ' flagged as critical' + (withImageCount ? ' (' + withImageCount + ' with a thumbnail, the rest with a platform badge)' : '') + '.', true);
}

/* ============================================================
   ADMIN PANES (rendered into #workspaceBody, one per nav item)
   ============================================================ */
function renderWorkspace(){
  var wrap = document.getElementById('workspaceBody');
  if (!wrap) return;
  if (state.nav === 'import')      renderImportPane(wrap);
  else if (state.nav === 'export') renderExportPane(wrap);
  else if (state.nav === 'digest') renderDigestPane(wrap);
  else if (state.nav === 'email')  renderEmailPane(wrap);
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

function renderExportPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Export slides</h2></div>'
      + '<p class="panel__hint">Exports respect the Platform / Region / Date / Search filters set on the browse views.</p>'
      + '<div class="scopepick">'
        + '<label><input type="radio" name="exportScope" value="filtered" checked> Current filtered view ('+filteredSlides().length+')</label>'
        + '<label><input type="radio" name="exportScope" value="all"> All slides ('+slides.length+')</label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="exportPdfBtn">Export as PDF</button>'
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

  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);

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

function renderDigestPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Regional digests</h2></div>'
      + '<p class="panel__hint">Inline-styled HTML emails that render in Outlook and Gmail with no JavaScript on the reader\'s end, each opening with a "this issue at a glance" summary. Uses the Platform / Date / Search filters; Region is set by the Audience picker below rather than the region chips. Each update links out to its source and, optionally, back to this tool.</p>'
      + '<div class="fieldrow">'
        + '<label>Audience<select id="emailAudience">'
          + '<option value="__all__"'+(state.emailAudience==='__all__'?' selected':'')+'>All regions (grouped by region)</option>'
          + ALLOWED_REGIONS.map(function(r){ return '<option value="'+esc(r)+'"'+(state.emailAudience===r?' selected':'')+'>'+esc(r)+' only</option>'; }).join('')
        + '</select></label>'
        + '<label style="flex:1;min-width:240px;">Digest base URL (optional — adds an "Open the full interactive digest" link)<input type="text" id="emailBaseUrl" placeholder="https://yourteam.github.io/platform-updates/" value="'+esc(state.emailBaseUrl)+'"></label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="digestPreviewBtn">Preview digest</button>'
        + '<button type="button" class="btn btn--ghost" id="exportEmailBtn">Download email HTML</button>'
        + '<button type="button" class="btn btn--ghost" id="exportEmailAllBtn">Download all regional digests (.zip)</button>'
      + '</div>'
      + '<div id="digestPreviewWrap"></div>'
    + '</div>';

  document.getElementById('emailAudience').addEventListener('change', function(e){ state.emailAudience = e.target.value; });
  document.getElementById('emailBaseUrl').addEventListener('input', function(e){ state.emailBaseUrl = e.target.value; });
  document.getElementById('digestPreviewBtn').addEventListener('click', previewRegionalDigest);
  document.getElementById('exportEmailBtn').addEventListener('click', exportEmailDigest);
  document.getElementById('exportEmailAllBtn').addEventListener('click', exportAllRegionalDigests);
}

function renderEmailPane(wrap){
  wrap.innerHTML =
    '<div class="panel">'
      + '<div class="panel__head"><h2 class="panel__title">Generate email</h2></div>'
      + '<p class="panel__hint">A short, leadership-facing briefing: reporting period, an auto-generated summary, per-platform counts and the top updates that need attention — each with a small inline thumbnail (shrunk in-browser so the email stays light) or a platform-coloured badge when a slide has no picture. Set a base URL to make the thumbnails and the "Open Interactive Newsletter" button clickable. When you hit <strong>Copy for email</strong>, the styled briefing — links live, images inline — is placed on your clipboard so it pastes into Gmail or Outlook exactly as previewed.</p>'
      + '<div class="scopepick">'
        + '<label><input type="radio" name="execScope" value="filtered" checked> Current filtered view ('+filteredSlides().length+')</label>'
        + '<label><input type="radio" name="execScope" value="all"> All slides ('+slides.length+')</label>'
      + '</div>'
      + '<div class="fieldrow">'
        + '<label>Top updates to feature<select id="execCriticalCount">'
          + [3,4,5].map(function(v){ return '<option value="'+v+'"'+(state.execCriticalCount===v?' selected':'')+'>'+v+'</option>'; }).join('')
        + '</select></label>'
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
  if (view === 'region' || view === 'platform'){ state.view = view; state.nav = view; }
  if (q) state.search = q;
}

function applyHashDeepLink(){
  var m = /^#slide-(.+)$/.exec(window.location.hash);
  if (!m) return;
  var id = decodeURIComponent(m[1]);
  if (!slides.some(function(s){ return s.id === id; })) return;
  state.openCards.add(id);
  // deep links always land on a browse view
  if (!isBrowseNav(state.nav)) setNav('platform', { silent:true });
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

  var meta = NAV_META[state.nav] || NAV_META.platform;
  document.getElementById('pageTitle').textContent = meta.title;
  document.getElementById('pageSub').textContent = meta.sub;

  document.querySelectorAll('.nav__item').forEach(function(btn){
    btn.classList.toggle('is-active', btn.getAttribute('data-nav') === state.nav);
  });
}

function setNav(nav, opts){
  opts = opts || {};
  state.nav = nav;
  if (isBrowseNav(nav)) state.view = nav;
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
  document.getElementById('searchInput').value = state.search;
  initChrome();
  setNav(state.nav, { silent:true });
  applyHashDeepLink();
});

})();
