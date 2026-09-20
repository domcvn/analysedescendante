(function(){
  "use strict";

  var STORAGE_KEY = 'adesc_state_v5';
  var VIEW_KEY = 'adesc_view_v2';
  var THEME_KEY = 'adesc_theme';

  var PALETTE = [
    { bg:'#D5F0EA', border:'#0E7C6B' },
    { bg:'#FBE7C6', border:'#A66A06' },
    { bg:'#E1E4FA', border:'#4650B0' },
    { bg:'#FAD9E2', border:'#B93B62' },
    { bg:'#DCEED0', border:'#3F7A34' },
    { bg:'#EAE0F7', border:'#7548AE' },
    { bg:'#D6EBFB', border:'#1A72A6' },
    { bg:'#F3E4D0', border:'#93602F' }
  ];

  var MIN_UNIT_W = 220, MIN_UNIT_H = 60;
  var DEFAULT_UNIT_W = 340, DEFAULT_UNIT_H = 190;

  function defaultState(){
    return { nextId:1, main:{ name:'PPrinc', x:60, y:40, calls:[], functions:[] }, units:[] };
  }

  var state = loadState() || defaultState();
  var funcForm = null;
  var pendingLayout = false;
  var downloadsCapPromise = null;
  var view = loadView() || { x:80, y:60, scale:1 };

  function uid(prefix){ return prefix + (state.nextId++); }
  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function cssEscape(str){
    if(window.CSS && CSS.escape) return CSS.escape(str);
    return String(str).replace(/([^a-zA-Z0-9_-])/g, '\\$1');
  }
  function debounce(fn, ms){
    var t;
    return function(){
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function(){ fn.apply(ctx, args); }, ms);
    };
  }

  // ---- Persistence ----
  function migrateFunc(f, fi){
    if(typeof f.x !== 'number') f.x = 24;
    if(typeof f.y !== 'number') f.y = 24 + fi * 100;
    if(Array.isArray(f.inputs)) f.inputs = f.inputs.map(function(p){ return p.name ? (p.name+' : '+p.type) : p.type; }).join('\n');
    if(Array.isArray(f.outputs)) f.outputs = f.outputs.map(function(p){ return p.name ? (p.name+' : '+p.type) : p.type; }).join('\n');
    if(f.inputs == null) f.inputs = '';
    if(f.outputs == null) f.outputs = '';
    if(!Array.isArray(f.calls)) f.calls = [];
  }
  function migrate(s){
    if(!s || !Array.isArray(s.units)) return null;
    if(typeof s.nextId !== 'number') s.nextId = 1;
    if(!s.main){
      s.main = {
        name: (typeof s.mainName === 'string') ? s.mainName : 'PPrinc',
        x: (typeof s.mainX === 'number') ? s.mainX : 60,
        y: (typeof s.mainY === 'number') ? s.mainY : 40,
        calls: Array.isArray(s.mainCalls) ? s.mainCalls : [],
        functions: []
      };
    }
    delete s.mainName; delete s.mainCalls; delete s.mainX; delete s.mainY;
    if(!Array.isArray(s.main.functions)) s.main.functions = [];
    if(!Array.isArray(s.main.calls)) s.main.calls = [];
    s.main.functions.forEach(migrateFunc);
    s.units.forEach(function(u, ui){
      if(typeof u.x !== 'number') u.x = 40 + (ui % 3) * 440;
      if(typeof u.y !== 'number') u.y = 140 + Math.floor(ui / 3) * 380;
      if(!u.color) u.color = PALETTE[ui % PALETTE.length];
      if(!Array.isArray(u.functions)) u.functions = [];
      u.functions.forEach(migrateFunc);
    });
    return s;
  }
  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return null;
      return migrate(JSON.parse(raw));
    }catch(e){ return null; }
  }
  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
  }
  function loadView(){
    try{
      var raw = localStorage.getItem(VIEW_KEY);
      if(!raw) return null;
      var v = JSON.parse(raw);
      if(typeof v.x==='number' && typeof v.y==='number' && typeof v.scale==='number') return v;
      return null;
    }catch(e){ return null; }
  }
  var saveViewDebounced = debounce(function(){
    try{ localStorage.setItem(VIEW_KEY, JSON.stringify(view)); }catch(e){}
  }, 200);

  // ---- Model helpers ----
  function getUnit(id){
    for(var i=0;i<state.units.length;i++){ if(state.units[i].id===id) return state.units[i]; }
    return null;
  }
  function getContainer(containerId){ return containerId === '__main__' ? state.main : getUnit(containerId); }
  function allContainers(){ return [state.main].concat(state.units); }
  function findFunc(id){
    for(var j=0;j<state.main.functions.length;j++){
      if(state.main.functions[j].id===id) return { func:state.main.functions[j], containerId:'__main__' };
    }
    for(var i=0;i<state.units.length;i++){
      var u = state.units[i];
      for(var k=0;k<u.functions.length;k++){
        if(u.functions[k].id===id) return { func:u.functions[k], containerId:u.id };
      }
    }
    return null;
  }
  function cleanupCalls(idSet){
    state.main.calls = state.main.calls.filter(function(id){ return !idSet.has(id); });
    allContainers().forEach(function(c){
      c.functions.forEach(function(f){ f.calls = f.calls.filter(function(id){ return !idSet.has(id); }); });
    });
  }
  function defaultPositionForNew(containerId, fi){
    if(containerId === '__main__') return { x: state.main.x + 220, y: state.main.y + fi * 90 };
    return { x:16, y:16 + fi*70 };
  }

  // ---- Mutations ----
  function addUnit(){
    var idx = state.units.length;
    state.units.push({
      id: uid('u'), name:'Nouvelle unité', role:'',
      color: PALETTE[idx % PALETTE.length],
      x: 40 + (idx % 3) * 440, y: 140 + Math.floor(idx / 3) * 380,
      tads:'', functions:[]
    });
    saveState(); render();
  }
  function deleteUnit(unitId){
    var u = getUnit(unitId);
    if(!u) return;
    var ids = new Set(u.functions.map(function(f){ return f.id; }));
    state.units = state.units.filter(function(x){ return x.id!==unitId; });
    cleanupCalls(ids);
    if(funcForm && funcForm.containerId===unitId) funcForm = null;
    saveState(); render();
  }
  function setUnitColor(unitId, color){
    var u = getUnit(unitId);
    if(!u) return;
    u.color = color;
    saveState(); render();
  }
  function deleteFunction(funcId){
    var res = findFunc(funcId);
    if(!res) return;
    var container = getContainer(res.containerId);
    container.functions = container.functions.filter(function(f){ return f.id!==funcId; });
    cleanupCalls(new Set([funcId]));
    if(funcForm && funcForm.editingId===funcId) funcForm = null;
    saveState(); render();
  }
  function openAddFuncForm(containerId){
    funcForm = { containerId:containerId, editingId:null, name:'', inputs:'', outputs:'', calls:new Set() };
    renderSidebar();
  }
  function openEditFuncForm(funcId){
    var res = findFunc(funcId);
    if(!res) return;
    funcForm = {
      containerId: res.containerId, editingId: funcId, name: res.func.name,
      inputs: res.func.inputs || '', outputs: res.func.outputs || '', calls: new Set(res.func.calls)
    };
    renderSidebar();
  }
  function closeFuncForm(){ funcForm = null; renderSidebar(); }
  function saveFuncForm(){
    if(!funcForm) return;
    var name = (funcForm.name || '').trim();
    if(!name){ alert('Le nom de la fonction/procédure est requis.'); return; }
    var inputs = (funcForm.inputs || '').trim();
    var outputs = (funcForm.outputs || '').trim();
    var calls = Array.from(funcForm.calls);

    if(funcForm.editingId){
      var res = findFunc(funcForm.editingId);
      if(res){ res.func.name = name; res.func.inputs = inputs; res.func.outputs = outputs; res.func.calls = calls; }
    } else {
      var container = getContainer(funcForm.containerId);
      if(container){
        var fi = container.functions.length;
        var pos = defaultPositionForNew(funcForm.containerId, fi);
        container.functions.push({ id: uid('f'), name:name, inputs:inputs, outputs:outputs, calls:calls, x:pos.x, y:pos.y });
      }
    }
    funcForm = null;
    saveState(); render();
  }
  function resetAll(){
    state = defaultState();
    funcForm = null;
    saveState(); render();
  }

  // ---- Sidebar rendering ----
  function render(){ renderSidebar(); renderCanvas(); }

  function renderGroupedCalls(selectedIds, checkAction, excludeId){
    var groups = [];
    if(state.main.functions.length>0) groups.push({ id:'__main__', label: state.main.name || 'Programme principal', functions: state.main.functions });
    state.units.forEach(function(u){ if(u.functions.length>0) groups.push({ id:u.id, label:u.name || 'Unité', functions:u.functions }); });

    var rendered = groups.map(function(g){
      var items = g.functions.filter(function(f){ return f.id !== excludeId; });
      if(items.length===0) return '';
      var checkedCount = items.filter(function(f){ return selectedIds.indexOf(f.id)!==-1; }).length;
      var inner = items.map(function(f){
        var checked = selectedIds.indexOf(f.id)!==-1 ? 'checked' : '';
        return '<label class="call-item"><input type="checkbox" data-action="'+checkAction+'" data-fid="'+f.id+'" '+checked+'/><span>'+esc(f.name)+'</span></label>';
      }).join('');
      return '<details class="calls-group"><summary>'+esc(g.label)+' <span class="calls-count">'+checkedCount+'/'+items.length+'</span></summary><div class="calls-list">'+inner+'</div></details>';
    }).join('');

    return rendered || '<p class="hint small">Aucune fonction définie pour le moment.</p>';
  }

  function renderFuncSection(containerId, containerFunctions){
    var listHtml = containerFunctions.length===0
      ? '<p class="hint small">Aucune fonction.</p>'
      : '<div class="func-list">' + containerFunctions.map(function(f){ return renderFuncRow(f); }).join('') + '</div>';
    var formHtml = (funcForm && funcForm.containerId===containerId) ? renderFuncForm() : '';
    return listHtml +
      '<button class="btn btn-ghost add-func-btn" data-action="add-func" data-cid="'+containerId+'">+ Fonction / procédure</button>' +
      formHtml;
  }

  function renderSidebar(){
    var sb = document.getElementById('sidebar');

    var mainCallsHtml = renderGroupedCalls(state.main.calls, 'main-call', null);
    var unitsHtml = state.units.length===0
      ? '<p class="hint">Ajoutez une unité pour commencer votre analyse.</p>'
      : state.units.map(function(u){ return renderUnitCard(u); }).join('');

    sb.innerHTML =
      '<div class="side-section main-card">'+
        '<h2>Programme principal</h2>'+
        '<label class="field"><span>Nom</span><input type="text" value="'+esc(state.main.name)+'" data-action="main-name"/></label>'+
        '<div class="calls-block"><span class="calls-label">Appelle</span>'+mainCallsHtml+'</div>'+
        '<div class="calls-block"><span class="calls-label">Procédures/fonctions propres au programme principal</span>'+
          renderFuncSection('__main__', state.main.functions)+
        '</div>'+
      '</div>'+
      '<div class="side-section">'+
        '<div class="section-head"><h2>Unités</h2><button class="btn btn-primary" data-action="add-unit">+ Unité</button></div>'+
        unitsHtml+
      '</div>';
  }

  function renderUnitCard(u){
    var swatches = PALETTE.map(function(c){
      var active = (c.border===u.color.border) ? ' active' : '';
      var idx = PALETTE.indexOf(c);
      return '<button class="swatch'+active+'" style="background:'+c.bg+';border-color:'+c.border+'" data-action="unit-color" data-uid="'+u.id+'" data-cidx="'+idx+'" title="Couleur de l’unité"></button>';
    }).join('');

    return (
      '<div class="unit-card" style="--u-bg:'+u.color.bg+';--u-border:'+u.color.border+'">'+
        '<div class="unit-card-head">'+
          '<input class="unit-name-input" type="text" value="'+esc(u.name)+'" placeholder="Nom de l’unité" data-action="unit-name" data-uid="'+u.id+'"/>'+
          '<button class="icon-btn danger" data-action="delete-unit" data-uid="'+u.id+'" title="Supprimer l’unité">✕</button>'+
        '</div>'+
        '<textarea class="unit-role-input" rows="2" placeholder="Rôle de l’unité (note interne, non affichée sur le schéma)" data-action="unit-role" data-uid="'+u.id+'">'+esc(u.role)+'</textarea>'+
        '<div class="palette-row">'+swatches+'</div>'+
        '<details class="tad-details"><summary>TAD (types abstraits de données)</summary>'+
          '<textarea class="tad-input" rows="6" placeholder="ex. TTree = structure ... finstructure" data-action="unit-tads" data-uid="'+u.id+'">'+esc(u.tads)+'</textarea>'+
        '</details>'+
        '<p class="hint canvas-note">Le rôle et les TAD sont des notes de travail : ils n’apparaissent pas sur le schéma, seules les fonctions/procédures y figurent.</p>'+
        renderFuncSection(u.id, u.functions)+
      '</div>'
    );
  }

  function sigText(f){
    var ins = (f.inputs && f.inputs.trim()) ? f.inputs.trim().replace(/\n+/g, ', ') : '/';
    var outs = (f.outputs && f.outputs.trim()) ? f.outputs.trim().replace(/\n+/g, ', ') : '/';
    return ins + ' → ' + outs;
  }
  function renderFuncRow(f){
    return (
      '<div class="func-list-row">'+
        '<div class="func-list-info">'+
          '<span class="func-name">'+esc(f.name)+'</span>'+
          '<span class="func-sig">'+esc(sigText(f))+'</span>'+
        '</div>'+
        '<div class="func-list-actions">'+
          '<button class="icon-btn" data-action="edit-func" data-fid="'+f.id+'" title="Modifier">✎</button>'+
          '<button class="icon-btn danger" data-action="delete-func" data-fid="'+f.id+'" title="Supprimer">✕</button>'+
        '</div>'+
      '</div>'
    );
  }
  function renderFuncForm(){
    var isEdit = !!funcForm.editingId;
    var callsHtml = renderGroupedCalls(Array.from(funcForm.calls), 'func-call', funcForm.editingId);

    return (
      '<div class="func-form">'+
        '<label class="field"><span>Nom</span><input type="text" value="'+esc(funcForm.name)+'" placeholder="ex. essai" data-form="name"/></label>'+
        '<label class="field"><span>Entrées</span><textarea rows="2" placeholder="mot : Chaîne" data-form="inputs">'+esc(funcForm.inputs)+'</textarea></label>'+
        '<p class="hint small">Avec noms : <code>a, b : Naturel</code> (une ligne par groupe). Sans noms : <code>Naturel*2, Chaîne</code>. Laissez vide s’il n’y en a pas.</p>'+
        '<label class="field"><span>Sorties</span><textarea rows="2" placeholder="gagné : Booléen" data-form="outputs">'+esc(funcForm.outputs)+'</textarea></label>'+
        '<p class="hint small">Même notation que les entrées.</p>'+
        '<div class="calls-block"><span class="calls-label">Appelle</span>'+callsHtml+'</div>'+
        '<div class="form-actions">'+
          '<button class="btn btn-primary" data-action="save-func">'+(isEdit?'Enregistrer':'Ajouter')+'</button>'+
          '<button class="btn btn-ghost" data-action="cancel-func">Annuler</button>'+
        '</div>'+
      '</div>'
    );
  }

  // ---- Canvas rendering ----
  function renderFuncNode(f){
    var hasIn = f.inputs && f.inputs.trim();
    var hasOut = f.outputs && f.outputs.trim();
    var inHtml = hasIn ? ('<div class="io io-in">'+esc(f.inputs.trim()).replace(/\n/g,'<br>')+'</div><div class="arrow">→</div>') : '';
    var outHtml = hasOut ? ('<div class="arrow">→</div><div class="io io-out">'+esc(f.outputs.trim()).replace(/\n/g,'<br>')+'</div>') : '';
    return '<div class="func-node" data-fnode="'+f.id+'" style="left:'+f.x+'px;top:'+f.y+'px">'+
      inHtml+'<div class="func-box" data-fid="'+f.id+'">'+esc(f.name)+'</div>'+outHtml+
    '</div>';
  }

  function renderCanvas(){
    var world = document.getElementById('canvas-world');
    var html = '';

    html += '<div class="main-box" data-fid="__main__" style="left:'+state.main.x+'px;top:'+state.main.y+'px">'+esc(state.main.name || 'Programme')+'</div>';
    state.main.functions.forEach(function(f){ html += renderFuncNode(f); });

    state.units.forEach(function(u){
      html += '<section class="unit-diagram" data-uid="'+u.id+'" style="left:'+u.x+'px;top:'+u.y+'px;--u-bg:'+u.color.bg+';--u-border:'+u.color.border+'">';
      html += '<div class="unit-diagram-head"><h3>'+esc(u.name || 'Unité')+'</h3></div>';
      html += '<div class="unit-body" data-uid="'+u.id+'">';
      if(u.functions.length===0){
        html += '<p class="hint small unit-empty-hint">Aucune fonction.</p>';
      } else {
        u.functions.forEach(function(f){ html += renderFuncNode(f); });
      }
      html += '</div>';
      html += '<div class="resize-handle" data-uid="'+u.id+'" title="Redimensionner"></div>';
      html += '</section>';
    });

    world.innerHTML = html;
    applyTransform();
    attachDragHandlers();

    var isEmpty = state.units.length===0 && state.main.calls.length===0 && state.main.functions.length===0;
    var emptyEl = document.getElementById('empty-state');
    if(emptyEl) emptyEl.hidden = !isEmpty;

    requestAnimationFrame(layoutAndDraw);
  }

  // ---- Layout: fixed-size unit boxes; functions are clamped so they can never leave them ----
  function layoutUnitBox(u, world){
    var sectionEl = world.querySelector('.unit-diagram[data-uid="'+u.id+'"]');
    var bodyEl = world.querySelector('.unit-body[data-uid="'+u.id+'"]');
    if(!sectionEl || !bodyEl) return false;
    var w = Math.max(MIN_UNIT_W, u.w || DEFAULT_UNIT_W);
    var h = Math.max(MIN_UNIT_H, u.h || DEFAULT_UNIT_H);
    bodyEl.style.width = w + 'px';
    bodyEl.style.height = h + 'px';
    sectionEl.style.width = w + 'px';

    var changed = false;
    bodyEl.querySelectorAll('.func-node').forEach(function(node){
      var nw = node.offsetWidth, nh = node.offsetHeight;
      var maxX = Math.max(0, w - nw), maxY = Math.max(0, h - nh);
      var x = parseFloat(node.style.left) || 0, y = parseFloat(node.style.top) || 0;
      var nx = Math.min(Math.max(0, x), maxX), ny = Math.min(Math.max(0, y), maxY);
      if(nx !== x || ny !== y){
        node.style.left = nx + 'px'; node.style.top = ny + 'px';
        var res = findFunc(node.dataset.fnode);
        if(res){ res.func.x = nx; res.func.y = ny; changed = true; }
      }
    });
    return changed;
  }

  function layoutAndDraw(){
    var world = document.getElementById('canvas-world');
    if(!world) return;
    var anyChanged = false;
    state.units.forEach(function(u){ if(layoutUnitBox(u, world)) anyChanged = true; });
    if(anyChanged) saveState();
    drawConnectors();
  }
  function scheduleLayout(){
    if(pendingLayout) return;
    pendingLayout = true;
    requestAnimationFrame(function(){ pendingLayout = false; layoutAndDraw(); });
  }

  // ---- Connector routing ----
  function pathBlocked(points, obstacles){
    for(var i=0;i<points.length-1;i++){
      var a=points[i], b=points[i+1];
      if(Math.abs(a[0]-b[0]) < 0.5){
        var x=a[0], y1=Math.min(a[1],b[1]), y2=Math.max(a[1],b[1]);
        for(var j=0;j<obstacles.length;j++){
          var o=obstacles[j];
          if(x>o.left && x<o.left+o.width && y2>o.top && y1<o.top+o.height) return true;
        }
      } else {
        var y=a[1], x1=Math.min(a[0],b[0]), x2=Math.max(a[0],b[0]);
        for(var k=0;k<obstacles.length;k++){
          var o2=obstacles[k];
          if(y>o2.top && y<o2.top+o2.height && x2>o2.left && x1<o2.left+o2.width) return true;
        }
      }
    }
    return false;
  }

  function pointsToPath(points){
    var d = 'M '+points[0][0]+' '+points[0][1];
    for(var i=1;i<points.length;i++) d += ' L '+points[i][0]+' '+points[i][1];
    return d;
  }

  function routeConnector(s, t, sRect, tRect, obstacles){
    var leg = 30;
    var clearance = Math.max(14, leg*0.7);
    var candidates = [];

    if(t.y >= s.y){
      var mids = [ s.y + (t.y-s.y)/2, s.y + clearance, t.y - clearance ];
      mids.forEach(function(midY){
        if(midY < s.y || midY > t.y) return;
        candidates.push([ [s.x,s.y],[s.x,midY],[t.x,midY],[t.x,t.y] ]);
      });
    }

    var belowY = s.y + leg;
    var aboveY = t.y - leg;
    var leftClear = Math.min(sRect.left, tRect.left) - clearance;
    var rightClear = Math.max(sRect.left+sRect.width, tRect.left+tRect.width) + clearance;
    [leftClear, rightClear].sort(function(a,b){ return Math.abs(s.x-a)-Math.abs(s.x-b); }).forEach(function(clearX){
      candidates.push([ [s.x,s.y],[s.x,belowY],[clearX,belowY],[clearX,aboveY],[t.x,aboveY],[t.x,t.y] ]);
    });

    for(var i=0;i<candidates.length;i++){
      if(!pathBlocked(candidates[i], obstacles)) return candidates[i];
    }
    return candidates[candidates.length-1];
  }

  function buildConnectorMarkup(rootEl, refEl){
    var refRect = refEl.getBoundingClientRect();
    function relRect(el){
      var r = el.getBoundingClientRect();
      return { left:r.left-refRect.left, top:r.top-refRect.top, width:r.width, height:r.height };
    }
    function bottomPoint(rect, offset){ return { x: rect.left+rect.width/2+offset, y: rect.top+rect.height }; }
    function topPoint(rect, offset){ return { x: rect.left+rect.width/2+offset, y: rect.top }; }

    var allRects = {};
    rootEl.querySelectorAll('[data-fid]').forEach(function(el){ allRects[el.dataset.fid] = relRect(el); });

    var edges = [];
    state.main.calls.forEach(function(fid){ edges.push({ src:'__main__', tgt:fid }); });
    allContainers().forEach(function(c){
      c.functions.forEach(function(f){
        f.calls.forEach(function(cid){ edges.push({ src:f.id, tgt:cid }); });
      });
    });

    var prepared = edges.filter(function(e){ return allRects[e.src] && allRects[e.tgt]; })
      .map(function(e){ return { src:e.src, tgt:e.tgt, sRect:allRects[e.src], tRect:allRects[e.tgt] }; });

    var anchorCount = {}, anchorIndex = {};
    prepared.forEach(function(p){
      var kSrc = p.src+'|b', kTgt = p.tgt+'|t';
      anchorCount[kSrc] = (anchorCount[kSrc]||0) + 1;
      anchorCount[kTgt] = (anchorCount[kTgt]||0) + 1;
    });
    function nextOffset(key, rectWidth){
      var count = anchorCount[key] || 1;
      var idx = anchorIndex[key] || 0;
      anchorIndex[key] = idx + 1;
      var spacing = Math.min(16, Math.max(8, (rectWidth - 20) / Math.max(count,1)));
      var offset = (idx - (count - 1)/2) * spacing;
      var maxOff = Math.max(0, rectWidth/2 - 10);
      return Math.max(-maxOff, Math.min(maxOff, offset));
    }

    var paths = '';
    prepared.forEach(function(p){
      var sOff = nextOffset(p.src+'|b', p.sRect.width);
      var tOff = nextOffset(p.tgt+'|t', p.tRect.width);
      var s = bottomPoint(p.sRect, sOff);
      var t = topPoint(p.tRect, tOff);
      var obstacles = [];
      Object.keys(allRects).forEach(function(id){
        if(id===p.src || id===p.tgt) return;
        obstacles.push(allRects[id]);
      });
      var points = routeConnector(s, t, p.sRect, p.tRect, obstacles);
      paths += '<path d="'+pointsToPath(points)+'" class="connector" marker-end="url(#arrow)"></path>';
    });

    var defs = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="8.7" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">'+
      '<path d="M0,0 L10,5 L0,10 Z" style="fill:var(--line)"></path></marker></defs>';
    return defs + paths;
  }

  function drawConnectors(){
    var svg = document.getElementById('connector-svg');
    var wrap = document.getElementById('canvas-wrap');
    var world = document.getElementById('canvas-world');
    if(!svg || !wrap || !world) return;
    var cw = wrap.clientWidth, ch = wrap.clientHeight;
    svg.setAttribute('width', cw);
    svg.setAttribute('height', ch);
    svg.setAttribute('viewBox', '0 0 '+cw+' '+ch);
    svg.innerHTML = buildConnectorMarkup(world, wrap);
  }

  // ---- View: pan & zoom ----
  function applyTransform(){
    var world = document.getElementById('canvas-world');
    if(world) world.style.transform = 'translate('+view.x+'px,'+view.y+'px) scale('+view.scale+')';
    scheduleLayout();
  }
  function zoomAt(px, py, factor){
    var newScale = Math.min(2.5, Math.max(0.25, view.scale * factor));
    var worldX = (px - view.x) / view.scale, worldY = (py - view.y) / view.scale;
    view.x = px - worldX * newScale;
    view.y = py - worldY * newScale;
    view.scale = newScale;
    applyTransform(); saveViewDebounced();
  }
  function resetView(){
    view.x = 80; view.y = 60; view.scale = 1;
    applyTransform(); saveViewDebounced();
  }

  // ---- Collision helpers (units, and functions within the same area, must not overlap) ----
  function rectsOverlap(a,b){
    return a.left < b.left+b.width && a.left+a.width > b.left && a.top < b.top+b.height && a.top+a.height > b.top;
  }
  function rectFromStyle(el){
    return { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0, width: el.offsetWidth, height: el.offsetHeight };
  }
  function otherUnitRects(excludeId){
    var world = document.getElementById('canvas-world');
    return state.units.filter(function(u){ return u.id!==excludeId; }).map(function(u){
      var el = world ? world.querySelector('.unit-diagram[data-uid="'+cssEscape(u.id)+'"]') : null;
      return el
        ? { left: parseFloat(el.style.left)||0, top: parseFloat(el.style.top)||0, width: el.offsetWidth, height: el.offsetHeight }
        : { left:u.x, top:u.y, width:u.w||DEFAULT_UNIT_W, height:u.h||DEFAULT_UNIT_H };
    });
  }
  // Main-level elements = PPrinc box + the main program's own free-floating functions
  // (i.e. everything at the top level of the canvas, not nested inside a unit).
  function mainLevelElementRects(world, excludeEl){
    var arr = [];
    var mb = world.querySelector('.main-box');
    if(mb && mb!==excludeEl) arr.push(rectFromStyle(mb));
    world.querySelectorAll('.func-node').forEach(function(n){
      if(n===excludeEl) return;
      if(!n.closest('.unit-body')) arr.push(rectFromStyle(n));
    });
    return arr;
  }
  // Functions within the same unit must not overlap each other.
  function siblingFuncRects(bodyEl, excludeNode){
    var arr = [];
    bodyEl.querySelectorAll('.func-node').forEach(function(n){
      if(n!==excludeNode) arr.push(rectFromStyle(n));
    });
    return arr;
  }
  function axisSlide(nx, ny, lastX, lastY, w, h, obstacles){
    var testX = { left:nx, top:lastY, width:w, height:h };
    var xOk = !obstacles.some(function(o){ return rectsOverlap(testX,o); });
    var fx = xOk ? nx : lastX;
    var testY = { left:fx, top:ny, width:w, height:h };
    var yOk = !obstacles.some(function(o){ return rectsOverlap(testY,o); });
    var fy = yOk ? ny : lastY;
    return { x:fx, y:fy };
  }

  // ---- Snap-to-align helpers (straighten arrows while dragging) ----
  function computeSnapTargetsForFunc(funcId, containerId, containerRefEl){
    var containerFns = (containerId==='__main__') ? state.main.functions : (getUnit(containerId)||{functions:[]}).functions;
    var f = containerFns.find(function(x){ return x.id===funcId; });
    if(!f) return [];
    var connected = new Set(f.calls || []);
    containerFns.forEach(function(other){
      if(other.id===funcId) return;
      if((other.calls||[]).indexOf(funcId)!==-1) connected.add(other.id);
    });
    var targets = [];
    connected.forEach(function(cid){
      var belongs = containerFns.some(function(x){ return x.id===cid; });
      if(!belongs) return;
      var el = containerRefEl.querySelector('[data-fnode="'+cssEscape(cid)+'"]');
      if(el) targets.push((parseFloat(el.style.left)||0) + el.offsetWidth/2);
    });
    if(containerId==='__main__' && state.main.calls.indexOf(funcId)!==-1){
      var mb = document.querySelector('.main-box');
      if(mb) targets.push((parseFloat(mb.style.left)||0) + mb.offsetWidth/2);
    }
    return targets;
  }
  function computeMainBoxSnapTargets(){
    var targets = [];
    state.main.calls.forEach(function(fid){
      var el = document.querySelector('.func-node[data-fnode="'+cssEscape(fid)+'"]');
      if(el && !el.closest('.unit-body')){
        targets.push((parseFloat(el.style.left)||0) + el.offsetWidth/2);
      }
    });
    return targets;
  }

  // ---- Dragging (units, functions, main) ----
  function makeDraggable(handleEl, movedEl, onMove, onEnd, getBounds, getSnapTargets, resolveCollision){
    handleEl.addEventListener('pointerdown', function(e){
      if(e.button !== undefined && e.button !== 0) return;
      var startX = e.clientX, startY = e.clientY;
      var startLeft = parseFloat(movedEl.style.left) || 0;
      var startTop = parseFloat(movedEl.style.top) || 0;
      var bounds = getBounds ? getBounds() : null;
      var snapTargets = getSnapTargets ? getSnapTargets() : null;
      var lastX = startLeft, lastY = startTop;
      var moved = false;
      try{ handleEl.setPointerCapture(e.pointerId); }catch(err){}
      movedEl.classList.add('dragging');
      e.stopPropagation();

      function onPointerMove(ev){
        var dx = (ev.clientX - startX) / view.scale;
        var dy = (ev.clientY - startY) / view.scale;
        if(!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true;
        if(!moved) return;
        var nx = startLeft + dx, ny = startTop + dy;

        if(snapTargets && snapTargets.length){
          var w = movedEl.offsetWidth;
          var centerX = nx + w/2;
          var thresh = 6 / view.scale;
          var best = null, bestDist = thresh;
          snapTargets.forEach(function(tx){ var d = Math.abs(centerX-tx); if(d<bestDist){ bestDist=d; best=tx; } });
          if(best !== null) nx = best - w/2;
        }
        if(bounds){
          nx = Math.min(Math.max(bounds.minX, nx), bounds.maxX);
          ny = Math.min(Math.max(bounds.minY, ny), bounds.maxY);
        }
        if(resolveCollision){
          var r = resolveCollision(nx, ny, lastX, lastY, movedEl.offsetWidth, movedEl.offsetHeight);
          nx = r.x; ny = r.y;
        }
        lastX = nx; lastY = ny;

        movedEl.style.left = nx + 'px';
        movedEl.style.top = ny + 'px';
        onMove(nx, ny);
        scheduleLayout();
      }
      function onPointerUp(){
        try{ handleEl.releasePointerCapture(e.pointerId); }catch(err){}
        movedEl.classList.remove('dragging');
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        if(moved){ onEnd(); layoutAndDraw(); }
      }
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      e.preventDefault();
    });
  }

  function makeResizable(handleEl, unit){
    handleEl.addEventListener('pointerdown', function(e){
      if(e.button !== undefined && e.button !== 0) return;
      e.stopPropagation();
      var world = document.getElementById('canvas-world');
      var sectionEl = world.querySelector('.unit-diagram[data-uid="'+unit.id+'"]');
      var bodyEl = world.querySelector('.unit-body[data-uid="'+unit.id+'"]');
      var startX = e.clientX, startY = e.clientY;
      var startW = sectionEl.offsetWidth;
      var startBodyH = bodyEl.offsetHeight;
      var headerH = sectionEl.offsetHeight - startBodyH;
      var lastW = startW, lastBodyH = startBodyH;
      try{ handleEl.setPointerCapture(e.pointerId); }catch(err){}

      function onPointerMove(ev){
        var dx = (ev.clientX - startX) / view.scale;
        var dy = (ev.clientY - startY) / view.scale;
        var candW = Math.max(MIN_UNIT_W, startW + dx);
        var candBodyH = Math.max(MIN_UNIT_H, startBodyH + dy);

        var others = otherUnitRects(unit.id).concat(mainLevelElementRects(world));
        var testW = { left:unit.x, top:unit.y, width:candW, height: lastBodyH+headerH };
        var wOk = !others.some(function(o){ return rectsOverlap(testW,o); });
        var fw = wOk ? candW : lastW;

        var testH = { left:unit.x, top:unit.y, width:fw, height: candBodyH+headerH };
        var hOk = !others.some(function(o){ return rectsOverlap(testH,o); });
        var fBodyH = hOk ? candBodyH : lastBodyH;

        lastW = fw; lastBodyH = fBodyH;
        unit.w = fw; unit.h = fBodyH;
        scheduleLayout();
      }
      function onPointerUp(){
        try{ handleEl.releasePointerCapture(e.pointerId); }catch(err){}
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        saveState();
        layoutAndDraw();
      }
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
      e.preventDefault();
    });
  }

  function attachDragHandlers(){
    var world = document.getElementById('canvas-world');

    var mainBox = world.querySelector('.main-box');
    if(mainBox){
      makeDraggable(mainBox, mainBox, function(nx, ny){ state.main.x = nx; state.main.y = ny; }, saveState, null, computeMainBoxSnapTargets,
        function(nx, ny, lastX, lastY, w, h){
          var obstacles = otherUnitRects(null).concat(mainLevelElementRects(world, mainBox));
          return axisSlide(nx, ny, lastX, lastY, w, h, obstacles);
        });
    }

    world.querySelectorAll('.unit-diagram').forEach(function(sec){
      var unitId = sec.dataset.uid;
      var head = sec.querySelector('.unit-diagram-head');
      makeDraggable(head, sec, function(nx, ny){
        var u = getUnit(unitId);
        if(u){ u.x = nx; u.y = ny; }
      }, saveState, null, null, function(nx, ny, lastX, lastY, w, h){
        var obstacles = otherUnitRects(unitId).concat(mainLevelElementRects(world));
        return axisSlide(nx, ny, lastX, lastY, w, h, obstacles);
      });
      var handle = sec.querySelector('.resize-handle');
      var unit = getUnit(unitId);
      if(handle && unit) makeResizable(handle, unit);
    });

    world.querySelectorAll('.func-node').forEach(function(node){
      var funcId = node.dataset.fnode;
      var bodyEl = node.closest('.unit-body');
      var containerId = bodyEl ? bodyEl.dataset.uid : '__main__';
      var containerRefEl = bodyEl || world;
      var getBounds = bodyEl ? function(){
        var bw = bodyEl.clientWidth, bh = bodyEl.clientHeight;
        var nw = node.offsetWidth, nh = node.offsetHeight;
        return { minX:0, minY:0, maxX: Math.max(0, bw-nw), maxY: Math.max(0, bh-nh) };
      } : null;
      var getSnap = function(){ return computeSnapTargetsForFunc(funcId, containerId, containerRefEl); };
      var resolveFuncCollision = function(nx, ny, lastX, lastY, w, h){
        var obstacles = bodyEl ? siblingFuncRects(bodyEl, node) : otherUnitRects(null).concat(mainLevelElementRects(world, node));
        return axisSlide(nx, ny, lastX, lastY, w, h, obstacles);
      };
      makeDraggable(node, node, function(nx, ny){
        var res = findFunc(funcId);
        if(res){ res.func.x = nx; res.func.y = ny; }
      }, saveState, getBounds, getSnap, resolveFuncCollision);
    });
  }

  // ---- Canvas panning (background drag) ----
  function initPanZoom(){
    var wrap = document.getElementById('canvas-wrap');

    wrap.addEventListener('pointerdown', function(e){
      if(e.target.closest('.unit-diagram, .func-node, .main-box, .zoom-controls')) return;
      if(e.button !== undefined && e.button !== 0) return;
      var startX = e.clientX, startY = e.clientY;
      var startViewX = view.x, startViewY = view.y;
      var moved = false;
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}
      wrap.classList.add('panning');

      function onMove(ev){
        var dx = ev.clientX - startX, dy = ev.clientY - startY;
        if(!moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) moved = true;
        if(!moved) return;
        view.x = startViewX + dx; view.y = startViewY + dy;
        applyTransform();
      }
      function onUp(){
        try{ wrap.releasePointerCapture(e.pointerId); }catch(err){}
        wrap.classList.remove('panning');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if(moved) saveViewDebounced();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });

    wrap.addEventListener('wheel', function(e){
      e.preventDefault();
      var rect = wrap.getBoundingClientRect();
      var factor = e.deltaY < 0 ? 1.1 : (1/1.1);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive:false });

    applyTransform();
  }

  // ---- Downloads capability ----
  function getDownloadsCapability(){
    if(!downloadsCapPromise){
      if(window.claude && typeof window.claude.use === 'function'){
        downloadsCapPromise = window.claude.use('downloads').catch(function(){ return null; });
      } else {
        downloadsCapPromise = Promise.resolve(null);
      }
    }
    return downloadsCapPromise;
  }
  function legacyDownload(filename, blob){
    try{
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(function(){ URL.revokeObjectURL(url); }, 4000);
      return true;
    }catch(e){
      alert("Le téléchargement n'est pas disponible dans cet environnement.");
      return false;
    }
  }
  function saveFile(filename, blob){
    return getDownloadsCapability().then(function(cap){
      if(cap && typeof cap.save === 'function'){
        return cap.save({ filename:filename, data:blob }).then(function(){ return true; }).catch(function(err){
          if(err && err.code === 'declined') return false;
          return legacyDownload(filename, blob);
        });
      }
      return legacyDownload(filename, blob);
    });
  }

  // ---- Whole-project download / import (portable backup, restores everything) ----
  function exportStateFile(){
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type:'application/json' });
    saveFile('analyse-descendante.json', blob).then(function(ok){
      if(!ok) alert('Le téléchargement a été annulé ou n’est pas disponible ici.');
    });
  }
  function importStateFile(file){
    var reader = new FileReader();
    reader.onload = function(){
      var parsed;
      try{ parsed = JSON.parse(String(reader.result)); }
      catch(e){ alert('Impossible de lire ce fichier : ce n’est pas un JSON valide.'); return; }
      var migrated = migrate(parsed);
      if(!migrated){ alert('Ce fichier ne correspond pas au format attendu.'); return; }
      if(!confirm('Remplacer l’analyse actuelle par le contenu de ce fichier ?')) return;
      state = migrated;
      funcForm = null;
      saveState();
      render();
    };
    reader.onerror = function(){ alert('Erreur de lecture du fichier.'); };
    reader.readAsText(file);
  }

  // ---- Export: clean off-screen snapshot with margins, independent of current pan/zoom ----
  var EXPORT_MARGIN = 56;

  function buildExportSnapshot(){
    var world = document.getElementById('canvas-world');
    var worldRect = world.getBoundingClientRect();
    var minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;

    var boxEls = world.querySelectorAll('.unit-diagram, .main-box, .func-node');
    boxEls.forEach(function(el){
      var r = el.getBoundingClientRect();
      var l = (r.left - worldRect.left) / view.scale;
      var t = (r.top - worldRect.top) / view.scale;
      var w_ = r.width / view.scale, h_ = r.height / view.scale;
      minX = Math.min(minX, l); minY = Math.min(minY, t);
      maxX = Math.max(maxX, l + w_); maxY = Math.max(maxY, t + h_);
    });
    if(!isFinite(minX)){ minX=0; minY=0; maxX=400; maxY=300; }

    var w = (maxX - minX) + EXPORT_MARGIN*2;
    var h = (maxY - minY) + EXPORT_MARGIN*2;
    var shiftX = EXPORT_MARGIN - minX, shiftY = EXPORT_MARGIN - minY;

    var worldClone = world.cloneNode(true);
    worldClone.removeAttribute('id');
    worldClone.style.transform = 'translate('+shiftX+'px,'+shiftY+'px) scale(1)';
    worldClone.style.width = w + 'px';
    worldClone.style.height = h + 'px';

    var tempWrap = document.createElement('div');
    tempWrap.style.position = 'fixed';
    tempWrap.style.left = '-100000px';
    tempWrap.style.top = '0';
    tempWrap.style.width = w + 'px';
    tempWrap.style.height = h + 'px';
    tempWrap.style.overflow = 'hidden';
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim() || '#ffffff';
    tempWrap.style.background = bg;
    tempWrap.appendChild(worldClone);

    var svgNS = 'http://www.w3.org/2000/svg';
    var svgEl = document.createElementNS(svgNS, 'svg');
    svgEl.setAttribute('width', w);
    svgEl.setAttribute('height', h);
    svgEl.setAttribute('viewBox', '0 0 '+w+' '+h);
    svgEl.style.position = 'absolute';
    svgEl.style.left = '0';
    svgEl.style.top = '0';
    svgEl.style.overflow = 'visible';
    tempWrap.appendChild(svgEl);

    document.body.appendChild(tempWrap);
    svgEl.innerHTML = buildConnectorMarkup(worldClone, tempWrap);

    return { tempWrap:tempWrap, width:w, height:h };
  }

  function captureSnapshot(){
    if(typeof html2canvas !== 'function'){
      alert("L'export nécessite une connexion internet pour charger la librairie de capture.");
      return Promise.reject(new Error('html2canvas unavailable'));
    }
    var snap = buildExportSnapshot();
    return new Promise(function(resolve, reject){
      requestAnimationFrame(function(){
        html2canvas(snap.tempWrap, { backgroundColor:null, scale:2, width:snap.width, height:snap.height })
          .then(function(c){ document.body.removeChild(snap.tempWrap); resolve(c); })
          .catch(function(err){ document.body.removeChild(snap.tempWrap); reject(err); });
      });
    });
  }

  function exportImage(){
    captureSnapshot().then(function(c){
      c.toBlob(function(blob){ if(blob) saveFile('analyse-descendante.png', blob); }, 'image/png');
    }).catch(function(err){ if(err && err.message !== 'html2canvas unavailable') alert('Export impossible : ' + err.message); });
  }
  function exportPDF(){
    captureSnapshot().then(function(c){
      var jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
      if(!jsPDFCtor){ alert('Export PDF indisponible.'); return; }
      var pageWpt = (c.width/2) * 72 / 96;
      var pageHpt = (c.height/2) * 72 / 96;
      var orientation = pageWpt >= pageHpt ? 'landscape' : 'portrait';
      var pdf = new jsPDFCtor({ orientation: orientation, unit:'pt', format:[pageWpt, pageHpt] });
      pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, pageWpt, pageHpt);
      saveFile('analyse-descendante.pdf', pdf.output('blob'));
    }).catch(function(err){ if(err && err.message !== 'html2canvas unavailable') alert('Export impossible : ' + err.message); });
  }

  // ---- Theme ----
  function initTheme(){
    var saved = null;
    try{ saved = localStorage.getItem(THEME_KEY); }catch(e){}
    if(saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  }
  function toggleTheme(){
    var cur = document.documentElement.getAttribute('data-theme');
    var isDark = cur ? cur==='dark' : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try{ localStorage.setItem(THEME_KEY, next); }catch(e){}
  }

  // ---- Event delegation ----
  document.addEventListener('click', function(e){
    var t = e.target.closest('[data-action]');
    if(!t) return;
    var a = t.dataset.action;
    switch(a){
      case 'toggle-sidebar': document.getElementById('app').classList.toggle('sidebar-collapsed'); scheduleLayout(); return;
      case 'toggle-theme': toggleTheme(); return;
      case 'reset-all':
        if(confirm('Tout effacer ? Cette action est irréversible.')) resetAll();
        return;
      case 'export-image': exportImage(); return;
      case 'export-pdf': exportPDF(); return;
      case 'export-state': exportStateFile(); return;
      case 'zoom-in': { var r=document.getElementById('canvas-wrap').getBoundingClientRect(); zoomAt(r.width/2, r.height/2, 1.2); return; }
      case 'zoom-out': { var r2=document.getElementById('canvas-wrap').getBoundingClientRect(); zoomAt(r2.width/2, r2.height/2, 1/1.2); return; }
      case 'reset-view': resetView(); return;
      case 'add-unit': addUnit(); return;
      case 'delete-unit':
        if(confirm('Supprimer cette unité et toutes ses fonctions ?')) deleteUnit(t.dataset.uid);
        return;
      case 'unit-color': setUnitColor(t.dataset.uid, PALETTE[+t.dataset.cidx]); return;
      case 'add-func': openAddFuncForm(t.dataset.cid); return;
      case 'edit-func': openEditFuncForm(t.dataset.fid); return;
      case 'delete-func':
        if(confirm('Supprimer cette fonction/procédure ?')) deleteFunction(t.dataset.fid);
        return;
      case 'save-func': saveFuncForm(); return;
      case 'cancel-func': closeFuncForm(); return;
    }
  });

  document.addEventListener('input', function(e){
    var t = e.target;
    if(!t.dataset) return;
    if(t.dataset.action === 'main-name'){ state.main.name = t.value; saveState(); renderCanvas(); return; }
    if(t.dataset.action === 'unit-name'){ var u1=getUnit(t.dataset.uid); if(u1){ u1.name=t.value; saveState(); renderCanvas(); } return; }
    if(t.dataset.action === 'unit-role'){ var u2=getUnit(t.dataset.uid); if(u2){ u2.role=t.value; saveState(); } return; }
    if(t.dataset.action === 'unit-tads'){ var u3=getUnit(t.dataset.uid); if(u3){ u3.tads=t.value; saveState(); } return; }
    if(!funcForm) return;
    if(t.dataset.form === 'name'){ funcForm.name = t.value; return; }
    if(t.dataset.form === 'inputs'){ funcForm.inputs = t.value; return; }
    if(t.dataset.form === 'outputs'){ funcForm.outputs = t.value; return; }
  });

  document.addEventListener('change', function(e){
    var t = e.target;
    if(!t.dataset) return;
    if(t.dataset.action === 'main-call'){
      var id = t.dataset.fid;
      if(t.checked){ if(state.main.calls.indexOf(id)===-1) state.main.calls.push(id); }
      else{ state.main.calls = state.main.calls.filter(function(x){ return x!==id; }); }
      saveState(); renderCanvas();
      return;
    }
    if(t.dataset.action === 'func-call' && funcForm){
      var fid = t.dataset.fid;
      if(t.checked) funcForm.calls.add(fid); else funcForm.calls.delete(fid);
      return;
    }
  });

  var importInput = document.getElementById('import-file-input');
  if(importInput){
    importInput.addEventListener('change', function(e){
      var file = e.target.files && e.target.files[0];
      if(file) importStateFile(file);
      e.target.value = '';
    });
  }

  window.addEventListener('resize', debounce(layoutAndDraw, 150));

  if(window.innerWidth <= 900){
    document.getElementById('app').classList.add('sidebar-collapsed');
  }
  initTheme();
  initPanZoom();
  render();
})();
