(function(){
"use strict";

/* ============================================================
   DATA
   ============================================================ */
var SEED = window.__NEWSLETTER_DATA__ || { allowed_platforms: [], allowed_regions: [], warnings: [], slides: [] };

var ALLOWED_PLATFORMS = SEED.allowed_platforms.slice();
var ALLOWED_REGIONS   = SEED.allowed_regions.slice();

// live, mutable in-memory store (import/export is the persistence mechanism —
// nothing is written to browser storage)
var slides = SEED.slides.slice();

/* ============================================================
   STATE
   ============================================================ */
var state = {
  view: 'platform',            // 'platform' | 'region'
  search: '',
  platforms: new Set(),        // empty set = "all"
  regions: new Set(),          // empty set = "all"
  dateFrom: '',
  dateTo: '',
  openCards: new Set(),
  adminOpen: false,
  importTab: 'pptx',           // 'pptx' | 'json'
  pptxPreview: null,           // array of parsed-but-unconfirmed slides
  emailAudience: '__all__',
  emailBaseUrl: ''
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

  if (added) renderAll();
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

  for (var i=0; i<slidePaths.length; i++){
    var path = slidePaths[i];
    var slideNum = parseInt(path.match(/slide(\d+)\.xml/)[1],10);
    var xmlStr = await zip.file(path).async('text');
    var xml = parser.parseFromString(xmlStr, 'application/xml');

    // relationships (for resolving image r:embed ids)
    var relsPath = path.replace('slides/', 'slides/_rels/') + '.rels';
    var relMap = {};
    if (zip.file(relsPath)){
      var relXmlStr = await zip.file(relsPath).async('text');
      var relXml = parser.parseFromString(relXmlStr, 'application/xml');
      relXml.querySelectorAll('Relationship').forEach(function(r){
        relMap[r.getAttribute('Id')] = r.getAttribute('Target');
      });
    }

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

    var sectionInfo = sectionOf[path] ? parseSectionName(sectionOf[path]) : null;
    var finalRegion = detectedRegion || (sectionInfo && sectionInfo.region) || null;
    var finalDate = detectedDate || (sectionInfo && sectionInfo.date) || '';
    var finalPlatform = detectedPlatform || 'Others';

    results.push({
      slide_num: slideNum,
      title: titleText || ('Slide ' + slideNum),
      body: body,
      thumb: images.length ? images[0].dataUrl : null,
      platform: finalPlatform,
      platformDetected: !!detectedPlatform,
      region: finalRegion,
      date: finalDate,
      sectionName: sectionOf[path] || ''
    });
  }

  return results;
}

function renderPptxPreview(){
  var container = document.getElementById('pptxPreviewWrap');
  if (!state.pptxPreview){ container.innerHTML = ''; return; }

  var undetectedRegions = state.pptxPreview.filter(function(i){ return !i.region; }).length;
  state.pptxPreview.forEach(function(item){ if (item.include === undefined) item.include = !!item.region; });

  var rowsHtml = state.pptxPreview.map(function(item, idx){
    var thumb = item.thumb
      ? '<img class="pptxrow__thumb" src="'+item.thumb+'" alt="">'
      : '<div class="pptxrow__thumb pptxrow__thumb--empty">no image</div>';
    var imgCount = item.body.filter(function(b){ return b.type==='image'; }).length;
    var regionOptions = (item.region ? '' : '<option value="" selected disabled>Select region…</option>') + optionsHtml(ALLOWED_REGIONS, item.region);
    var regionWarn = item.region ? '' : '<div style="color:#a3301a;font-size:11px;margin-top:3px;">⚠ Region not detected (no matching Section or tag) — select one before importing.</div>';
    var platNote = item.platformDetected ? '' : '<span style="font-family:var(--mono);font-size:10px;color:var(--muted);">(defaulted)</span>';
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
          + sourceNote
        + '</div>'
        + regionWarn
      + '</div>'
    + '</div>';
  }).join('');

  container.innerHTML =
    '<div class="pptxpreview">'+rowsHtml+'</div>'
    + '<div class="adminpanel__row" style="margin-top:10px;">'
      + '<button type="button" class="btn" id="pptxConfirmBtn">Import selected slides</button>'
      + '<span style="font-size:12px;color:var(--muted);">'+state.pptxPreview.length+' slide'+(state.pptxPreview.length===1?'':'s')+' found'
        + (undetectedRegions ? ' · '+undetectedRegions+' need'+(undetectedRegions===1?'s':'')+' a region' : '')+'</span>'
    + '</div>';

  container.querySelectorAll('.pptxrow__title').forEach(function(el){
    el.addEventListener('input', function(){ state.pptxPreview[+el.dataset.idx].title = el.value; });
  });
  container.querySelectorAll('select[data-field]').forEach(function(el){
    el.addEventListener('change', function(){
      state.pptxPreview[+el.dataset.idx][el.dataset.field] = el.value;
      if (el.dataset.field === 'region') renderPptxPreview();
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
      link: '',
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

function shortExcerpt(s, max){
  var t = excerptOf(s);
  if (t.length <= max) return t;
  return t.slice(0, max-1).trim() + '…';
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
      var meta = groupByRegion ? (s.platform + (s.date ? ' · ' + fmtDate(s.date) : '')) : (s.region + (s.date ? ' · ' + fmtDate(s.date) : ''));
      var linkEl = s.link ? '<a href="'+esc(s.link)+'" style="font-size:13px;font-weight:600;color:#c1440e;text-decoration:none;">Read more &#8594;</a>' : '';
      var tLink = toolLink(baseUrl, s);
      var toolEl = tLink ? '<a href="'+esc(tLink)+'" style="font-size:13px;color:#6b6b6b;text-decoration:none;">View full update</a>' : '';
      var sep = (linkEl && toolEl) ? ' &nbsp;·&nbsp; ' : '';
      return ''
        + '<tr><td style="padding:14px 32px;border-bottom:1px solid #e4e1da;font-family:Arial,Helvetica,sans-serif;">'
          + '<div style="font-family:\'Courier New\',monospace;font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;">'+esc(meta)+'</div>'
          + '<div style="font-size:15px;font-weight:700;color:#141414;margin-bottom:5px;line-height:1.3;">'+esc(s.title)+'</div>'
          + '<div style="font-size:13.5px;color:#333333;line-height:1.55;margin-bottom:9px;">'+esc(shortExcerpt(s,180))+'</div>'
          + linkEl + sep + toolEl
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


function renderAdminPanel(){
  var panel = document.getElementById('adminPanel');
  panel.className = 'adminpanel' + (state.adminOpen ? ' is-open' : '');
  if (!state.adminOpen) return;

  panel.innerHTML =
    '<div class="adminpanel__section" style="flex-basis:100%;">'
      + '<h3>Import slides</h3>'
      + '<div class="importtabs">'
        + '<button type="button" class="importtabs__btn'+(state.importTab==='pptx'?' is-active':'')+'" data-tab="pptx">From PowerPoint (.pptx)</button>'
        + '<button type="button" class="importtabs__btn'+(state.importTab==='json'?' is-active':'')+'" data-tab="json">From JSON (re-import / backup)</button>'
      + '</div>'

      + '<div class="importpane'+(state.importTab==='pptx'?' is-active':'')+'" id="paneImportPptx">'
        + '<p class="adminpanel__hint">Upload a .pptx deck — the tool reads Platform, Region and Date straight from the file, no defaults to set:</p>'
        + '<ul style="font-size:12px;color:var(--muted);margin:0 0 12px;padding-left:18px;line-height:1.6;">'
          + '<li><strong>Region</strong> — use PowerPoint\'s <em>Sections</em> feature and name each section after a region ('+ALLOWED_REGIONS.join(', ')+'). Every slide in that section imports as that region.</li>'
          + '<li><strong>Platform</strong> — add a small text box on the slide containing just the platform name ('+ALLOWED_PLATFORMS.join(', ')+'). Falls back to "Others" if none is found.</li>'
          + '<li><strong>Date</strong> — add a small text box with a date (e.g. <code>2026-07-06</code> or <code>Jul 6</code>), or include it in the section name, e.g. <code>Singapore (Jun 29 – Jul 3)</code>.</li>'
        + '</ul>'
        + '<p class="adminpanel__hint">Slide text becomes the update: the first line is the title, the rest is the body, and any pictures on the slide are embedded automatically. Review the results below — anything not detected is flagged for you to fix before importing.</p>'
        + '<div class="adminpanel__row">'
          + '<label class="btn btn--ghost" for="importPptxFile">Choose .pptx file</label>'
          + '<input type="file" id="importPptxFile" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation">'
          + '<span id="pptxFileName" style="font-size:12px;color:var(--muted);"></span>'
        + '</div>'
        + '<div id="pptxPreviewWrap"></div>'
      + '</div>'

      + '<div class="importpane'+(state.importTab==='json'?' is-active':'')+'" id="paneImportJson">'
        + '<p class="adminpanel__hint">Paste or upload a JSON export from this tool (array of slides, or <code>{"slides":[...]}</code>). Used for re-importing backups.</p>'
        + '<div class="adminpanel__row">'
          + '<label class="btn btn--ghost" for="importFile">Choose JSON file</label>'
          + '<input type="file" id="importFile" accept="application/json,.json">'
          + '<span id="importFileName" style="font-size:12px;color:var(--muted);"></span>'
        + '</div>'
        + '<textarea id="importText" placeholder=\'[{"platform":"Shopee","region":"Indonesia","date":"2026-07-06","title":"...","link":"...","body":[{"type":"para","text":"..."}]}]\'></textarea>'
        + '<div class="adminpanel__row" style="margin-top:8px;">'
          + '<button type="button" class="btn" id="importTextBtn">Import pasted JSON</button>'
        + '</div>'
      + '</div>'
    + '</div>'

    + '<div class="adminpanel__section" style="flex-basis:100%;border-top:1px solid var(--line);padding-top:16px;">'
      + '<h3>Export slides</h3>'
      + '<p class="adminpanel__hint">Exports respect the filters currently applied above (Platform, Region, Date, Search).</p>'
      + '<div class="adminpanel__row" style="margin-bottom:10px;">'
        + '<label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="exportScope" value="filtered" checked> Current filtered view ('+filteredSlides().length+')</label>'
        + '<label style="font-size:12.5px;display:flex;align-items:center;gap:5px;"><input type="radio" name="exportScope" value="all"> All slides ('+slides.length+')</label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="exportPdfBtn">Export as PDF</button>'
        + '<button type="button" class="btn btn--ghost" id="exportJsonBtn">Export as JSON (for re-import)</button>'
      + '</div>'
    + '</div>'

    + '<div class="adminpanel__section" style="flex-basis:100%;border-top:1px solid var(--line);padding-top:16px;">'
      + '<h3>Email digest</h3>'
      + '<p class="adminpanel__hint">Generates an inline-styled HTML email (works in Outlook/Gmail — no filtering or JS needed on the reader\'s end) with a "this issue at a glance" summary. Uses the Platform / Date / Search filters above; Region is set per-audience below instead of the Region chips. Pictures aren\'t embedded in emails (most inboxes block inline images) — each update links out to its source and, optionally, back to this tool.</p>'
      + '<div class="fieldrow">'
        + '<label>Audience<select id="emailAudience">'
          + '<option value="__all__"'+(state.emailAudience==='__all__'?' selected':'')+'>All regions (grouped by region)</option>'
          + ALLOWED_REGIONS.map(function(r){ return '<option value="'+esc(r)+'"'+(state.emailAudience===r?' selected':'')+'>'+esc(r)+' only</option>'; }).join('')
        + '</select></label>'
        + '<label style="flex:1;min-width:220px;">Digest base URL (optional — for "View full update" links)<input type="text" id="emailBaseUrl" placeholder="https://yourteam.github.io/platform-updates/" value="'+esc(state.emailBaseUrl)+'"></label>'
      + '</div>'
      + '<div class="adminpanel__row">'
        + '<button type="button" class="btn" id="exportEmailBtn">Download email HTML</button>'
        + '<button type="button" class="btn btn--ghost" id="exportEmailAllBtn">Download all regional digests (.zip)</button>'
      + '</div>'
    + '</div>'
    + '<div class="adminpanel__status" id="adminStatus"></div>';

  // tabs
  panel.querySelectorAll('.importtabs__btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.importTab = btn.getAttribute('data-tab');
      renderAdminPanel();
    });
  });

  // pptx import
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

  // json import
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

  // export
  document.getElementById('exportPdfBtn').addEventListener('click', exportPdf);
  document.getElementById('exportJsonBtn').addEventListener('click', exportJson);

  // email digest
  document.getElementById('emailAudience').addEventListener('change', function(e){ state.emailAudience = e.target.value; });
  document.getElementById('emailBaseUrl').addEventListener('input', function(e){ state.emailBaseUrl = e.target.value; });
  document.getElementById('exportEmailBtn').addEventListener('click', exportEmailDigest);
  document.getElementById('exportEmailAllBtn').addEventListener('click', exportAllRegionalDigests);

  if (state.pptxPreview) renderPptxPreview();
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
  if (view === 'region' || view === 'platform') state.view = view;
  if (q) state.search = q;
}

function syncTopbarFromState(){
  document.getElementById('searchInput').value = state.search;
  document.querySelectorAll('.viewtoggle__btn').forEach(function(b){
    var active = b.getAttribute('data-view') === state.view;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function applyHashDeepLink(){
  var m = /^#slide-(.+)$/.exec(window.location.hash);
  if (!m) return;
  var id = decodeURIComponent(m[1]);
  if (!slides.some(function(s){ return s.id === id; })) return;
  state.openCards.add(id);
  renderMain();
  setTimeout(function(){
    var el = document.querySelector('.card[data-id="'+id.replace(/"/g,'')+'"]');
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  }, 80);
}

/* ============================================================
   TOP-LEVEL WIRING
   ============================================================ */
function renderAll(){
  renderFilterRail();
  renderMain();
  renderAdminPanel();
}

function initTopbar(){
  document.querySelectorAll('.viewtoggle__btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.view = btn.getAttribute('data-view');
      document.querySelectorAll('.viewtoggle__btn').forEach(function(b){
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      renderMain();
    });
  });

  var search = document.getElementById('searchInput');
  search.addEventListener('input', function(){
    state.search = search.value.trim();
    renderFilterRail();
    renderMain();
  });

  document.getElementById('adminToggle').addEventListener('click', function(){
    state.adminOpen = !state.adminOpen;
    document.getElementById('adminToggle').classList.toggle('is-active', state.adminOpen);
    renderAdminPanel();
  });
}

document.addEventListener('DOMContentLoaded', function(){
  applyUrlParams();
  initTopbar();
  syncTopbarFromState();
  renderAll();
  applyHashDeepLink();
});

})();
