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
  var view = loadView() || { x:80, y:60, scale:1, arrowWidth:2, textScale:1, mode:'edit', sidebarWidth:380 };
  if(typeof view.arrowWidth !== 'number') view.arrowWidth = 2;
  if(typeof view.textScale !== 'number') view.textScale = 1;
  if(view.mode !== 'edit' && view.mode !== 'view') view.mode = 'edit';
  if(typeof view.sidebarWidth !== 'number') view.sidebarWidth = 380;
  var focusId = null;   // id of the function/main currently isolated in view mode, or null
  var focusSet = null;  // Set of ids visible while focused (the function itself + callers + callees)
  var armedElId = null; // touch only: an element must be tapped once to "arm" it before it can be dragged

  function setArmed(key, el){
    armedElId = key;
    document.querySelectorAll('.touch-armed').forEach(function(n){ n.classList.remove('touch-armed'); });
    if(el) el.classList.add('touch-armed');
  }
  function deselectTouchArmed(){
    if(armedElId === null) return;
    armedElId = null;
    document.querySelectorAll('.touch-armed').forEach(function(n){ n.classList.remove('touch-armed'); });
  }
  function reapplyArmedHighlight(){
    if(armedElId === null) return;
    var world = document.getElementById('canvas-world');
    if(!world) return;
    var el = (armedElId === '__main__')
      ? world.querySelector('.main-box')
      : (world.querySelector('.unit-diagram[data-uid="'+cssEscape(armedElId)+'"]') || world.querySelector('.func-node[data-fnode="'+cssEscape(armedElId)+'"]'));
    if(el) el.classList.add('touch-armed');
  }

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
    if(typeof f.hidden !== 'boolean') f.hidden = false;
    if(typeof f.notes !== 'string') f.notes = '';
  }
  function migrate(s){
    if(!s || !Array.isArray(s.units)) return null;
    if(typeof s.nextId !== 'number') s.nextId = 1;
    if(!s.main || typeof s.main !== 'object'){
      s.main = {
        name: (typeof s.mainName === 'string') ? s.mainName : 'PPrinc',
        x: (typeof s.mainX === 'number') ? s.mainX : 60,
        y: (typeof s.mainY === 'number') ? s.mainY : 40,
        calls: Array.isArray(s.mainCalls) ? s.mainCalls : [],
        functions: []
      };
    }
    if(typeof s.main.name !== 'string') s.main.name = 'PPrinc';
    if(typeof s.main.x !== 'number') s.main.x = 60;
    if(typeof s.main.y !== 'number') s.main.y = 40;
    delete s.mainName; delete s.mainCalls; delete s.mainX; delete s.mainY;
    if(!Array.isArray(s.main.functions)) s.main.functions = [];
    if(!Array.isArray(s.main.calls)) s.main.calls = [];
    s.main.functions = s.main.functions.filter(function(f){ return f && typeof f==='object' && typeof f.id==='string' && f.id; });
    s.main.functions.forEach(migrateFunc);
    s.units.forEach(function(u, ui){
      if(!u || typeof u !== 'object') u = {};
      if(typeof u.x !== 'number') u.x = 40 + (ui % 3) * 440;
      if(typeof u.y !== 'number') u.y = 140 + Math.floor(ui / 3) * 380;
      if(!u.color || typeof u.color.bg !== 'string' || typeof u.color.border !== 'string') u.color = PALETTE[ui % PALETTE.length];
      if(!Array.isArray(u.functions)) u.functions = [];
      if(typeof u.name !== 'string') u.name = 'Unité';
      if(typeof u.role !== 'string') u.role = '';
      if(typeof u.tads !== 'string') u.tads = '';
      u.functions = u.functions.filter(function(f){ return f && typeof f==='object' && typeof f.id==='string' && f.id; });
      u.functions.forEach(migrateFunc);
      s.units[ui] = u;
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
  function reorderFunc(containerId, fromIndex, toIndex){
    var container = getContainer(containerId);
    if(!container) return;
    var arr = container.functions;
    if(fromIndex<0 || fromIndex>=arr.length || toIndex<0 || toIndex>=arr.length || fromIndex===toIndex) return;
    var item = arr.splice(fromIndex, 1)[0];
    arr.splice(toIndex, 0, item);
    saveState(); renderSidebar();
  }
  function openAddFuncForm(containerId){
    funcForm = { containerId:containerId, editingId:null, name:'', inputs:'', outputs:'', notes:'', calls:new Set() };
    renderSidebar();
  }
  function openEditFuncForm(funcId){
    var res = findFunc(funcId);
    if(!res) return;
    funcForm = {
      containerId: res.containerId, editingId: funcId, name: res.func.name,
      inputs: res.func.inputs || '', outputs: res.func.outputs || '', notes: res.func.notes || '',
      calls: new Set(res.func.calls)
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
    var notes = (funcForm.notes || '').trim();
    var calls = Array.from(funcForm.calls);

    if(funcForm.editingId){
      var res = findFunc(funcForm.editingId);
      if(res){ res.func.name = name; res.func.inputs = inputs; res.func.outputs = outputs; res.func.notes = notes; res.func.calls = calls; }
    } else {
      var container = getContainer(funcForm.containerId);
      if(container){
        var fi = container.functions.length;
        var pos = defaultPositionForNew(funcForm.containerId, fi);
        container.functions.push({ id: uid('f'), name:name, inputs:inputs, outputs:outputs, notes:notes, calls:calls, x:pos.x, y:pos.y });
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
    var listHtml;
    if(containerFunctions.length===0){
      listHtml = '<p class="hint small">Aucune fonction.</p>';
    } else {
      var items = containerFunctions.map(function(f){
        var row = renderFuncRow(f);
        var details = renderFuncDetails(f);
        var editHtml = (funcForm && funcForm.editingId === f.id) ? renderFuncForm() : '';
        return '<div class="func-item" data-fid="'+f.id+'">'+row+details+editHtml+'</div>';
      }).join('');
      listHtml = '<div class="func-list" data-cid="'+containerId+'">' + items + '</div>';
    }
    var addHtml = (funcForm && funcForm.containerId===containerId && !funcForm.editingId) ? renderFuncForm() : '';
    return listHtml +
      '<button class="btn btn-ghost add-func-btn" data-action="add-func" data-cid="'+containerId+'">+ Fonction / procédure</button>' +
      addHtml;
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

    attachFuncReorderHandlers();
  }

  // ---- Drag-to-reorder functions/procedures within the sidebar (each unit's own list,
  // or the main program's own list — never across containers) ----
  function attachFuncReorderHandlers(){
    document.querySelectorAll('.func-list').forEach(function(listEl){
      var containerId = listEl.dataset.cid;
      listEl.querySelectorAll(':scope > .func-item > .func-list-row > .func-drag-handle').forEach(function(handle){
        handle.addEventListener('pointerdown', function(e){
          if(e.button !== undefined && e.button !== 0) return;
          e.preventDefault();
          var item = handle.closest('.func-item');
          if(!item) return;
          var items = Array.prototype.slice.call(listEl.querySelectorAll(':scope > .func-item'));
          var startIndex = items.indexOf(item);
          if(startIndex < 0 || items.length < 2) return;

          var rects = items.map(function(it){ return it.getBoundingClientRect(); });
          var startY = e.clientY;
          var currentIndex = startIndex;
          var moved = false;

          try{ handle.setPointerCapture(e.pointerId); }catch(err){}

          function onMove(ev){
            var dy = ev.clientY - startY;
            if(!moved && Math.abs(dy) > 3) moved = true;
            if(!moved) return;
            item.classList.add('func-item-dragging');
            item.style.transform = 'translateY(' + dy + 'px)';

            var draggedCenter = rects[startIndex].top + rects[startIndex].height/2 + dy;
            var idx = 0;
            items.forEach(function(it, i){
              if(i === startIndex) return;
              var center = rects[i].top + rects[i].height/2;
              if(center < draggedCenter) idx++;
            });
            currentIndex = Math.max(0, Math.min(items.length - 1, idx));

            items.forEach(function(it, i){
              if(i === startIndex) return;
              var shift = 0;
              if(currentIndex < startIndex && i >= currentIndex && i < startIndex) shift = rects[startIndex].height;
              else if(currentIndex > startIndex && i > startIndex && i <= currentIndex) shift = -rects[startIndex].height;
              it.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
            });
          }
          function onUp(){
            try{ handle.releasePointerCapture(e.pointerId); }catch(err){}
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            items.forEach(function(it){ it.style.transform = ''; });
            item.classList.remove('func-item-dragging');
            if(moved && currentIndex !== startIndex){
              reorderFunc(containerId, startIndex, currentIndex);
            }
          }
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
      });
    });
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
  function renderFuncDetails(f){
    var insText = (f.inputs && f.inputs.trim()) ? esc(f.inputs.trim()).replace(/\n/g,'<br>') : '/';
    var outsText = (f.outputs && f.outputs.trim()) ? esc(f.outputs.trim()).replace(/\n/g,'<br>') : '/';
    var notesText = (f.notes && f.notes.trim())
      ? esc(f.notes.trim()).replace(/\n/g,'<br>')
      : '<span class="func-details-empty">Aucun commentaire.</span>';
    return (
      '<details class="func-details">'+
        '<summary>Détails (entrées, sorties, commentaire)</summary>'+
        '<div class="func-details-body">'+
          '<div class="func-details-row"><span class="func-details-label">Entrées</span><div class="func-details-value">'+insText+'</div></div>'+
          '<div class="func-details-row"><span class="func-details-label">Sorties</span><div class="func-details-value">'+outsText+'</div></div>'+
          '<div class="func-details-row"><span class="func-details-label">Commentaire</span><div class="func-details-value prose">'+notesText+'</div></div>'+
        '</div>'+
      '</details>'
    );
  }
  function renderFuncRow(f){
    var hiddenCls = f.hidden ? ' func-hidden' : '';
    var eyeIcon = f.hidden ? '⦸' : '👁';
    var eyeTitle = f.hidden ? 'Afficher dans le schéma' : 'Masquer du schéma';
    return (
      '<div class="func-list-row'+hiddenCls+'">'+
        '<span class="func-drag-handle" title="Glisser pour réordonner">⠿</span>'+
        '<div class="func-list-info">'+
          '<span class="func-name">'+esc(f.name)+'</span>'+
          '<span class="func-sig">'+esc(sigText(f))+'</span>'+
        '</div>'+
        '<div class="func-list-actions">'+
          '<button class="icon-btn" data-action="toggle-func-visible" data-fid="'+f.id+'" title="'+eyeTitle+'">'+eyeIcon+'</button>'+
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
        '<p class="hint small">Avec noms : <code>a, b : Naturel</code> (une ligne par groupe). Sans noms : un type par ligne, ex. <code>Naturel*3</code> puis, à la ligne suivante, <code>TUser</code>. Laissez vide s’il n’y en a pas.</p>'+
        '<label class="field"><span>Sorties</span><textarea rows="2" placeholder="gagné : Booléen" data-form="outputs">'+esc(funcForm.outputs)+'</textarea></label>'+
        '<p class="hint small">Même notation que les entrées.</p>'+
        '<label class="field"><span>Commentaire <span class="hint small" style="display:inline">(panneau seulement, jamais affiché sur le schéma)</span></span>'+
          '<textarea class="func-notes-input" rows="4" placeholder="Expliquez en détail ce que fait cette fonction/procédure : algorithme, cas particuliers, hypothèses…" data-form="notes">'+esc(funcForm.notes)+'</textarea>'+
        '</label>'+
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
      if(view.mode === 'edit'){
        html += '<div class="resize-handle" data-uid="'+u.id+'" title="Redimensionner"></div>';
      }
      html += '</section>';
    });

    world.innerHTML = html;
    applyTransform();
    attachDragHandlers();
    applyFocusVisibility();
    reapplyArmedHighlight();

    var isEmpty = state.units.length===0 && state.main.calls.length===0 && state.main.functions.length===0;
    var emptyEl = document.getElementById('empty-state');
    if(emptyEl) emptyEl.hidden = !isEmpty;

    requestAnimationFrame(layoutAndDraw);
  }

  // ---- Layout: unit boxes auto-grow (horizontally and/or vertically) to fit their
  // functions/procedures; a manual resize sets a floor, not a hard ceiling — the box
  // never shrinks below what its current content needs. ----
  function layoutUnitBox(u, world){
    var sectionEl = world.querySelector('.unit-diagram[data-uid="'+u.id+'"]');
    var bodyEl = world.querySelector('.unit-body[data-uid="'+u.id+'"]');
    if(!sectionEl || !bodyEl) return false;

    var baseW = Math.max(MIN_UNIT_W, u.w || DEFAULT_UNIT_W);
    var baseH = Math.max(MIN_UNIT_H, u.h || DEFAULT_UNIT_H);

    var nodes = bodyEl.querySelectorAll('.func-node');
    var naturalW = 0, naturalH = 0;
    nodes.forEach(function(node){
      if(node.style.display === 'none') return;
      var nw = node.offsetWidth, nh = node.offsetHeight;
      var x = parseFloat(node.style.left) || 0, y = parseFloat(node.style.top) || 0;
      naturalW = Math.max(naturalW, x + nw + 22);
      naturalH = Math.max(naturalH, y + nh + 22);
    });

    var w = Math.max(baseW, naturalW);
    var h = Math.max(baseH, naturalH);
    var grew = (w > baseW) || (h > baseH);
    if(w > baseW) u.w = w;
    if(h > baseH) u.h = h;

    bodyEl.style.width = w + 'px';
    bodyEl.style.height = h + 'px';
    sectionEl.style.width = w + 'px';

    // Safety net only: with the box sized to fit above, this should rarely need to move
    // anything — it only matters right after a manual resize shrinks below old content.
    var changed = false;
    nodes.forEach(function(node){
      if(node.style.display === 'none') return;
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
    return changed || grew;
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

  function pathLength(points){
    var len = 0;
    for(var i=0;i<points.length-1;i++){
      len += Math.abs(points[i][0]-points[i+1][0]) + Math.abs(points[i][1]-points[i+1][1]);
    }
    return len;
  }

  // Performance: for large diagrams, most obstacles are nowhere near a given edge. Narrowing
  // the obstacle list to a generous region around the edge before the (fairly expensive)
  // candidate search keeps big diagrams smooth without changing the outcome — validated with
  // thousands of synthetic cases; the margin is scaled with renderScale like the rest of the
  // routing geometry so it represents the same real distance regardless of zoom.
  function relevantObstacles(s, t, sRect, tRect, obstacles, renderScale){
    var margin = 300 * renderScale;
    var left = Math.min(s.x, t.x, sRect.left, tRect.left) - margin;
    var right = Math.max(s.x, t.x, sRect.left+sRect.width, tRect.left+tRect.width) + margin;
    var top = Math.min(s.y, t.y) - margin;
    var bottom = Math.max(s.y, t.y) + margin;
    return obstacles.filter(function(o){
      return o.left < right && o.left+o.width > left && o.top < bottom && o.top+o.height > top;
    });
  }

  // boxObstacles (functions, their labels, units) must never be crossed. pathObstacles
  // (other arrows already drawn) are avoided when possible, but not at the cost of a much
  // longer detour — a brief crossing between two arrows reads far better than a convoluted
  // path, so among everything that keeps clear of boxes we always pick the shortest route,
  // preferring ones that also dodge other arrows only when that doesn't require the more
  // complex candidates to win instead.
  function collisionScore(points, obstacles){
    var score = 0;
    for(var i=0;i<points.length-1;i++){
      var a=points[i], b=points[i+1];
      if(Math.abs(a[0]-b[0]) < 0.5){
        var x=a[0], y1=Math.min(a[1],b[1]), y2=Math.max(a[1],b[1]);
        for(var j=0;j<obstacles.length;j++){
          var o=obstacles[j];
          if(x>o.left && x<o.left+o.width){
            var ov=Math.min(y2,o.top+o.height)-Math.max(y1,o.top);
            if(ov>0) score+=ov;
          }
        }
      } else {
        var y=a[1], x1=Math.min(a[0],b[0]), x2=Math.max(a[0],b[0]);
        for(var k=0;k<obstacles.length;k++){
          var o2=obstacles[k];
          if(y>o2.top && y<o2.top+o2.height){
            var ov2=Math.min(x2,o2.left+o2.width)-Math.max(x1,o2.left);
            if(ov2>0) score+=ov2;
          }
        }
      }
    }
    return score;
  }

  function routeConnector(s, t, sRect, tRect, boxObstacles, pathObstacles, renderScale){
    var leg = 30 * renderScale;
    var clearance = Math.max(14*renderScale, leg*0.7);
    var candidates = [];

    if(t.y >= s.y){
      var span = t.y - s.y;
      // Scan the whole span, not just a handful of fixed fractions, so there is a real
      // chance of landing a corridor that clears every other arrow, not only the boxes.
      var STEPS = 14;
      for(var k=1; k<STEPS; k++){
        candidates.push([ [s.x,s.y],[s.x, s.y+span*(k/STEPS)],[t.x, s.y+span*(k/STEPS)],[t.x,t.y] ]);
      }
      candidates.push([ [s.x,s.y],[s.x, s.y+clearance],[t.x, s.y+clearance],[t.x,t.y] ]);
      candidates.push([ [s.x,s.y],[s.x, t.y-clearance],[t.x, t.y-clearance],[t.x,t.y] ]);
    }

    // Try several detour heights: if the row just below the source (or just above the
    // target) happens to run straight through some other function (or another arrow),
    // a taller/shorter detour may clear it instead of forcing a wider sideways swing.
    [1, 1.6, 2.2, 2.8, 3.4].forEach(function(legMult){
      var belowY = s.y + leg*legMult;
      var aboveY = t.y - leg*legMult;

      // The column used to rise from below the source to above the target must clear every
      // obstacle that sits in that vertical band — not just the source and target boxes —
      // otherwise the rise can still cut across some other function/label in between.
      var bandTop = Math.min(belowY, aboveY), bandBottom = Math.max(belowY, aboveY);
      var relevant = boxObstacles.filter(function(o){ return o.top < bandBottom && o.top+o.height > bandTop; });
      var minLeft = Math.min(sRect.left, tRect.left);
      var maxRight = Math.max(sRect.left+sRect.width, tRect.left+tRect.width);
      relevant.forEach(function(o){
        minLeft = Math.min(minLeft, o.left);
        maxRight = Math.max(maxRight, o.left+o.width);
      });

      [1, 1.8, 2.6, 3.6].forEach(function(mult){
        var cl = minLeft - clearance*mult, cr = maxRight + clearance*mult;
        [cl, cr].sort(function(a,b){ return Math.abs(s.x-a)-Math.abs(s.x-b); }).forEach(function(clearX){
          candidates.push([ [s.x,s.y],[s.x,belowY],[clearX,belowY],[clearX,aboveY],[t.x,aboveY],[t.x,t.y] ]);
        });
      });
    });

    var boxClear = candidates.filter(function(c){ return !pathBlocked(c, boxObstacles); });
    var pool = boxClear.length ? boxClear : candidates;

    // Only test the shortest handful for full arrow-avoidance — bounds the expensive checks
    // to a fixed cost regardless of how many candidates exist, keeping big diagrams smooth.
    pool = pool.slice().sort(function(a,b){ return pathLength(a) - pathLength(b); });
    var shortlist = pool.slice(0, 18);

    var fullyClear = shortlist.filter(function(c){ return !pathBlocked(c, pathObstacles); });
    if(fullyClear.length) return fullyClear[0]; // already length-sorted

    // Nothing in the shortlist fully avoids other arrows: pick whichever overlaps the LEAST
    // with them (not just whichever is shortest), so any visible collision stays small.
    // (Score each candidate once — recomputing inside the sort comparator is much costlier.)
    var scored = shortlist.map(function(c){ return { c:c, score:collisionScore(c, pathObstacles) }; });
    scored.sort(function(a,b){ return a.score - b.score; }); // shortlist is already length-sorted
    return scored[0].c;
  }

  function buildConnectorMarkup(rootEl, refEl, renderScale){
    renderScale = renderScale || 1;
    var refRect = refEl.getBoundingClientRect();
    function relRect(el){
      var r = el.getBoundingClientRect();
      return { left:r.left-refRect.left, top:r.top-refRect.top, width:r.width, height:r.height };
    }
    function bottomPoint(rect, offset){ return { x: rect.left+rect.width/2+offset, y: rect.top+rect.height }; }
    function topPoint(rect, offset){ return { x: rect.left+rect.width/2+offset, y: rect.top }; }

    var allRects = {}; // anchor + obstacle rects: the box itself only (labels may be crossed)
    rootEl.querySelectorAll('[data-fid]').forEach(function(el){
      if(el.style.display === 'none') return;
      var wrapper = el.closest('.func-node');
      if(wrapper && wrapper.style.display === 'none') return;
      allRects[el.dataset.fid] = relRect(el);
    });
    var obstacleRects = allRects;

    var edges = [];
    state.main.calls.forEach(function(fid){ edges.push({ src:'__main__', tgt:fid }); });
    allContainers().forEach(function(c){
      c.functions.forEach(function(f){
        f.calls.forEach(function(cid){ edges.push({ src:f.id, tgt:cid }); });
      });
    });

    if(focusId){
      edges = edges.filter(function(e){ return e.src===focusId || e.tgt===focusId; });
    }

    var prepared = edges.filter(function(e){ return allRects[e.src] && allRects[e.tgt]; })
      .map(function(e){ return { src:e.src, tgt:e.tgt, sRect:allRects[e.src], tRect:allRects[e.tgt] }; });

    var anchorCount = {}, anchorIndex = {};
    prepared.forEach(function(p){
      var kSrc = p.src+'|b', kTgt = p.tgt+'|t';
      anchorCount[kSrc] = (anchorCount[kSrc]||0) + 1;
      anchorCount[kTgt] = (anchorCount[kTgt]||0) + 1;
    });
    function nextOffset(key){
      var count = anchorCount[key] || 1;
      var idx = anchorIndex[key] || 0;
      anchorIndex[key] = idx + 1;
      var spacing = Math.max(18, view.arrowWidth * 5) * renderScale;
      var raw = (idx - (count - 1)/2) * spacing;
      var cap = 340 * renderScale;
      return Math.max(-cap, Math.min(cap, raw));
    }

    // Segments of already-placed arrows become thin obstacles too, so later arrows steer
    // around earlier ones instead of running alongside or through them.
    var pathPad = Math.max(14, view.arrowWidth * 3) * renderScale;
    function segmentsToRects(points){
      var rects = [];
      for(var i=0;i<points.length-1;i++){
        var a=points[i], b=points[i+1];
        if(Math.abs(a[0]-b[0]) < 0.5){
          var y1=Math.min(a[1],b[1]), y2=Math.max(a[1],b[1]);
          rects.push({ left:a[0]-pathPad, top:y1, width:pathPad*2, height:Math.max(1,y2-y1) });
        } else {
          var x1=Math.min(a[0],b[0]), x2=Math.max(a[0],b[0]);
          rects.push({ left:x1, top:a[1]-pathPad, width:Math.max(1,x2-x1), height:pathPad*2 });
        }
      }
      return rects;
    }

    var pathObstacles = [];
    var paths = '';
    prepared.forEach(function(p){
      var sOff = nextOffset(p.src+'|b');
      var tOff = nextOffset(p.tgt+'|t');
      var s = bottomPoint(p.sRect, sOff);
      var t = topPoint(p.tRect, tOff);
      var boxObstacles = [];
      Object.keys(obstacleRects).forEach(function(id){
        if(id===p.src || id===p.tgt) return;
        boxObstacles.push(obstacleRects[id]);
      });
      boxObstacles = relevantObstacles(s, t, p.sRect, p.tRect, boxObstacles, renderScale);
      var nearPathObstacles = relevantObstacles(s, t, p.sRect, p.tRect, pathObstacles, renderScale);
      var points = routeConnector(s, t, p.sRect, p.tRect, boxObstacles, nearPathObstacles, renderScale);
      paths += '<path d="'+pointsToPath(points)+'" class="connector" marker-end="url(#arrow)"></path>';
      pathObstacles = pathObstacles.concat(segmentsToRects(points));
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
    svg.innerHTML = buildConnectorMarkup(world, wrap, view.scale);
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

  // ---- Display settings: arrow thickness & text size (wide, freely adjustable ranges) ----
  function clampNum(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function syncArrowWidthInputs(){
    var r = document.querySelector('[data-action="arrow-width-range"]');
    if(r) r.value = view.arrowWidth;
    var n = document.querySelector('[data-action="arrow-width-number"]');
    if(n) n.value = view.arrowWidth;
  }
  function syncTextScaleInputs(){
    var r = document.querySelector('[data-action="text-scale-range"]');
    if(r) r.value = view.textScale;
    var n = document.querySelector('[data-action="text-scale-number"]');
    if(n) n.value = view.textScale;
  }
  function applyDisplaySettings(){
    document.documentElement.style.setProperty('--arrow-width', view.arrowWidth + 'px');
    document.documentElement.style.setProperty('--text-scale', view.textScale);
    scheduleLayout();
  }

  // ---- Mode: Édition (full editing) vs Consultation (read-only, canvas-focused) ----
  function setMode(mode){
    if(mode !== 'edit' && mode !== 'view') return;
    view.mode = mode;
    saveViewDebounced();
    deselectTouchArmed();
    if(mode === 'edit'){
      exitFocus();
      document.getElementById('app').classList.remove('sidebar-collapsed');
    } else {
      funcForm = null;
      document.getElementById('app').classList.add('sidebar-collapsed');
    }
    document.getElementById('app').classList.toggle('mode-view', mode === 'view');
    document.querySelectorAll('.mode-btn').forEach(function(b){
      b.dataset.active = (b.dataset.action === 'mode-'+mode) ? 'true' : 'false';
    });
    render();
  }

  function displayNameFor(id){
    if(id === '__main__') return state.main.name || 'PPrinc';
    var res = findFunc(id);
    return res ? res.func.name : id;
  }

  function computeFocusSet(id){
    var set = new Set([id]);
    var ownCalls = (id === '__main__') ? state.main.calls : ((findFunc(id)||{}).func||{}).calls;
    (ownCalls || []).forEach(function(c){ set.add(c); });
    if(state.main.calls.indexOf(id) !== -1) set.add('__main__');
    allContainers().forEach(function(c){
      c.functions.forEach(function(f){
        if((f.calls||[]).indexOf(id) !== -1) set.add(f.id);
      });
    });
    return set;
  }

  function enterFocus(id){
    focusId = id;
    focusSet = computeFocusSet(id);
    var bar = document.getElementById('focus-bar');
    var text = document.getElementById('focus-bar-text');
    if(text){
      var name = displayNameFor(id);
      var extra = focusSet.size - 1;
      text.textContent = extra > 0
        ? ('Affichage limité à « ' + name + ' » et ' + extra + ' fonction' + (extra>1?'s':'') + ' liée' + (extra>1?'s':'') + '.')
        : ('Affichage limité à « ' + name + ' », qui n’appelle et n’est appelée par aucune autre fonction.');
    }
    if(bar) bar.hidden = false;
    applyFocusVisibility();
    scheduleLayout();
  }

  function exitFocus(){
    focusId = null;
    focusSet = null;
    var bar = document.getElementById('focus-bar');
    if(bar) bar.hidden = true;
    applyFocusVisibility();
    scheduleLayout();
  }

  // Shows/hides DOM nodes to match focusSet — layoutUnitBox and buildConnectorMarkup both
  // skip hidden nodes, so a focused view never measures or routes around something unseen.
  function applyFocusVisibility(){
    var world = document.getElementById('canvas-world');
    if(!world) return;
    var mainBox = world.querySelector('.main-box');
    if(mainBox) mainBox.style.display = (!focusSet || focusSet.has('__main__')) ? '' : 'none';

    world.querySelectorAll('.func-node').forEach(function(node){
      var id = node.dataset.fnode;
      var inFocus = !focusSet || focusSet.has(id);
      var res = findFunc(id);
      var manuallyHidden = !!(res && res.func.hidden);
      node.style.display = (inFocus && !manuallyHidden) ? '' : 'none';
    });

    world.querySelectorAll('.unit-diagram').forEach(function(sec){
      var nodes = sec.querySelectorAll('.func-node');
      if(nodes.length === 0){ sec.style.display = ''; return; }
      var anyVisible = Array.prototype.some.call(nodes, function(n){ return n.style.display !== 'none'; });
      sec.style.display = anyVisible ? '' : 'none';
    });
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

  // ---- Dragging (units, functions, main) ----
  function makeDraggable(handleEl, movedEl, onMove, onEnd, getBounds, resolveCollision){
    handleEl.addEventListener('pointerdown', function(e){
      if(view.mode !== 'edit') return;
      if(e.pointerType !== 'touch' && e.button !== undefined && e.button !== 0) return;

      if(e.pointerType === 'touch'){
        var armKey = movedEl.classList.contains('main-box') ? '__main__' : (movedEl.dataset.uid || movedEl.dataset.fnode);
        if(armedElId !== armKey){
          e.preventDefault();
          e.stopPropagation();
          setArmed(armKey, movedEl);
          return;
        }
      }

      var startX = e.clientX, startY = e.clientY;
      var startLeft = parseFloat(movedEl.style.left) || 0;
      var startTop = parseFloat(movedEl.style.top) || 0;
      var bounds = getBounds ? getBounds() : null;
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
      if(view.mode !== 'edit') return;
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
      makeDraggable(mainBox, mainBox, function(nx, ny){ state.main.x = nx; state.main.y = ny; }, saveState, null,
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
      }, saveState, null, function(nx, ny, lastX, lastY, w, h){
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
      var getBounds = bodyEl ? function(){
        var bw = bodyEl.clientWidth, bh = bodyEl.clientHeight;
        var nw = node.offsetWidth, nh = node.offsetHeight;
        return { minX:0, minY:0, maxX: Math.max(0, bw-nw), maxY: Math.max(0, bh-nh) };
      } : null;
      var resolveFuncCollision = function(nx, ny, lastX, lastY, w, h){
        var obstacles = bodyEl ? siblingFuncRects(bodyEl, node) : otherUnitRects(null).concat(mainLevelElementRects(world, node));
        return axisSlide(nx, ny, lastX, lastY, w, h, obstacles);
      };
      makeDraggable(node, node, function(nx, ny){
        var res = findFunc(funcId);
        if(res){ res.func.x = nx; res.func.y = ny; }
      }, saveState, getBounds, resolveFuncCollision);
    });
  }

  // ---- Sidebar resize (drag the handle between the panel and the canvas) ----
  function clampSidebarWidth(w){
    var isMobile = window.innerWidth <= 900;
    var minW = isMobile ? 200 : 260;
    var maxW = isMobile ? Math.min(window.innerWidth * 0.92, 420) : Math.min(720, window.innerWidth * 0.7);
    return Math.max(minW, Math.min(maxW, w));
  }
  function initSidebarResize(){
    var handle = document.getElementById('sidebar-resize-handle');
    var sidebar = document.getElementById('sidebar');
    if(!handle || !sidebar) return;
    handle.addEventListener('pointerdown', function(e){
      if(e.pointerType !== 'touch' && e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      var startX = e.clientX;
      var startW = sidebar.getBoundingClientRect().width;
      try{ handle.setPointerCapture(e.pointerId); }catch(err){}
      handle.classList.add('resizing');

      function onMove(ev){
        var w = clampSidebarWidth(startW + (ev.clientX - startX));
        sidebar.style.width = w + 'px';
        view.sidebarWidth = w;
        if(window.innerWidth <= 900) handle.style.left = w + 'px';
        scheduleLayout();
      }
      function onUp(){
        try{ handle.releasePointerCapture(e.pointerId); }catch(err){}
        handle.classList.remove('resizing');
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        saveViewDebounced();
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // ---- Canvas panning (background drag) ----
  function initPanZoom(){
    var wrap = document.getElementById('canvas-wrap');
    var activePointers = {}; // pointerId -> {x,y} — only pointers that started on empty canvas
    var panState = null;     // single-finger pan in progress
    var pinchState = null;   // two-finger pinch-zoom in progress

    function dist(p1, p2){ return Math.hypot(p1.x-p2.x, p1.y-p2.y); }
    function mid(p1, p2){ return { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 }; }

    function startPan(pointerId, x, y){
      panState = { pointerId:pointerId, startX:x, startY:y, startViewX:view.x, startViewY:view.y, moved:false };
    }
    function startPinch(){
      var ids = Object.keys(activePointers);
      var p1 = activePointers[ids[0]], p2 = activePointers[ids[1]];
      pinchState = {
        id1:ids[0], id2:ids[1],
        startDist: dist(p1,p2) || 1,
        startScale: view.scale,
        startMid: mid(p1,p2),
        startViewX: view.x, startViewY: view.y
      };
    }

    wrap.addEventListener('pointerdown', function(e){
      if(e.target.closest('.zoom-controls, .focus-bar')) return;
      if(view.mode === 'edit' && e.target.closest('.unit-diagram, .func-node, .main-box')) return;
      if(e.pointerType !== 'touch' && e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      deselectTouchArmed();
      activePointers[e.pointerId] = { x:e.clientX, y:e.clientY };
      try{ wrap.setPointerCapture(e.pointerId); }catch(err){}

      var ids = Object.keys(activePointers);
      if(ids.length === 1){
        panState = null; pinchState = null;
        startPan(e.pointerId, e.clientX, e.clientY);
        wrap.classList.add('panning');
      } else if(ids.length === 2){
        panState = null;
        wrap.classList.remove('panning');
        startPinch();
      }
    });

    document.addEventListener('pointermove', function(ev){
      if(!(ev.pointerId in activePointers)) return;
      activePointers[ev.pointerId] = { x:ev.clientX, y:ev.clientY };

      if(pinchState){
        var p1 = activePointers[pinchState.id1], p2 = activePointers[pinchState.id2];
        if(!p1 || !p2) return;
        var newDist = dist(p1, p2);
        var factor = newDist / pinchState.startDist;
        var newScale = Math.min(2.5, Math.max(0.25, pinchState.startScale * factor));
        var rect = wrap.getBoundingClientRect();
        var startMx = pinchState.startMid.x - rect.left, startMy = pinchState.startMid.y - rect.top;
        var mp = mid(p1, p2);
        var mx = mp.x - rect.left, my = mp.y - rect.top;
        var worldX = (startMx - pinchState.startViewX) / pinchState.startScale;
        var worldY = (startMy - pinchState.startViewY) / pinchState.startScale;
        view.x = mx - worldX * newScale;
        view.y = my - worldY * newScale;
        view.scale = newScale;
        applyTransform();
        return;
      }
      if(panState && ev.pointerId === panState.pointerId){
        var dx = ev.clientX - panState.startX, dy = ev.clientY - panState.startY;
        if(!panState.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) panState.moved = true;
        if(!panState.moved) return;
        view.x = panState.startViewX + dx; view.y = panState.startViewY + dy;
        applyTransform();
      }
    });

    document.addEventListener('pointerup', onBackgroundPointerEnd);
    document.addEventListener('pointercancel', onBackgroundPointerEnd);
    function onBackgroundPointerEnd(ev){
      if(!(ev.pointerId in activePointers)) return;
      delete activePointers[ev.pointerId];
      try{ wrap.releasePointerCapture(ev.pointerId); }catch(err){}
      var ids = Object.keys(activePointers);

      if(panState && ev.pointerId === panState.pointerId){
        wrap.classList.remove('panning');
        if(panState.moved) saveViewDebounced();
        panState = null;
      }
      if(pinchState && (ev.pointerId === pinchState.id1 || ev.pointerId === pinchState.id2)){
        saveViewDebounced();
        pinchState = null;
        if(ids.length === 1){
          // one finger remains on screen: resume panning from here instead of jumping
          var p = activePointers[ids[0]];
          startPan(+ids[0], p.x, p.y);
          panState.moved = true;
          wrap.classList.add('panning');
        }
      }
    }

    wrap.addEventListener('wheel', function(e){
      e.preventDefault();
      var rect = wrap.getBoundingClientRect();
      var factor = e.deltaY < 0 ? 1.1 : (1/1.1);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    }, { passive:false });

    // Double-click (mouse) and double-tap (touch) both isolate a function via the same
    // pointerup-based detector — touch doesn't reliably synthesize a native dblclick.
    var lastTap = { time:0, id:null };
    document.addEventListener('pointerup', function(e){
      if(view.mode !== 'view') return;
      var target = e.target.closest('[data-fid]');
      if(!target){ lastTap = { time:0, id:null }; return; }
      var now = Date.now();
      var fid = target.dataset.fid;
      if(lastTap.id === fid && (now - lastTap.time) < 400){
        enterFocus(fid);
        lastTap = { time:0, id:null };
      } else {
        lastTap = { time:now, id:fid };
      }
    });

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
    svgEl.innerHTML = buildConnectorMarkup(worldClone, tempWrap, 1);

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
      case 'toggle-topbar':
        document.getElementById('app').classList.toggle('topbar-collapsed');
        scheduleLayout();
        setTimeout(layoutAndDraw, 260);
        return;
      case 'toggle-theme': toggleTheme(); return;
      case 'mode-edit': setMode('edit'); return;
      case 'mode-view': setMode('view'); return;
      case 'exit-focus': exitFocus(); return;
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
      case 'toggle-func-visible': {
        var vres = findFunc(t.dataset.fid);
        if(vres){ vres.func.hidden = !vres.func.hidden; saveState(); render(); }
        return;
      }
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
    if(t.dataset.action === 'arrow-width-range'){ view.arrowWidth = +t.value; syncArrowWidthInputs(); applyDisplaySettings(); saveViewDebounced(); return; }
    if(t.dataset.action === 'arrow-width-number'){ var awv=parseFloat(t.value); if(!isNaN(awv)){ view.arrowWidth = clampNum(awv,0,10); syncArrowWidthInputs(); applyDisplaySettings(); saveViewDebounced(); } return; }
    if(t.dataset.action === 'text-scale-range'){ view.textScale = +t.value; syncTextScaleInputs(); applyDisplaySettings(); saveViewDebounced(); return; }
    if(t.dataset.action === 'text-scale-number'){ var tsv=parseFloat(t.value); if(!isNaN(tsv)){ view.textScale = clampNum(tsv,0,20); syncTextScaleInputs(); applyDisplaySettings(); saveViewDebounced(); } return; }
    if(t.dataset.action === 'main-name'){ state.main.name = t.value; saveState(); renderCanvas(); return; }
    if(t.dataset.action === 'unit-name'){ var u1=getUnit(t.dataset.uid); if(u1){ u1.name=t.value; saveState(); renderCanvas(); } return; }
    if(t.dataset.action === 'unit-role'){ var u2=getUnit(t.dataset.uid); if(u2){ u2.role=t.value; saveState(); } return; }
    if(t.dataset.action === 'unit-tads'){ var u3=getUnit(t.dataset.uid); if(u3){ u3.tads=t.value; saveState(); } return; }
    if(!funcForm) return;
    if(t.dataset.form === 'name'){ funcForm.name = t.value; return; }
    if(t.dataset.form === 'inputs'){ funcForm.inputs = t.value; return; }
    if(t.dataset.form === 'outputs'){ funcForm.outputs = t.value; return; }
    if(t.dataset.form === 'notes'){ funcForm.notes = t.value; return; }
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
  syncArrowWidthInputs();
  syncTextScaleInputs();
  applyDisplaySettings();

  document.getElementById('app').classList.toggle('mode-view', view.mode === 'view');
  document.querySelectorAll('.mode-btn').forEach(function(b){
    b.dataset.active = (b.dataset.action === 'mode-'+view.mode) ? 'true' : 'false';
  });
  if(view.mode === 'view'){ document.getElementById('app').classList.add('sidebar-collapsed'); }

  initTheme();
  initPanZoom();
  var sidebarEl = document.getElementById('sidebar');
  var sidebarHandleEl = document.getElementById('sidebar-resize-handle');
  if(sidebarEl){
    var appliedW = clampSidebarWidth(view.sidebarWidth);
    sidebarEl.style.width = appliedW + 'px';
    if(sidebarHandleEl && window.innerWidth <= 900) sidebarHandleEl.style.left = appliedW + 'px';
  }
  initSidebarResize();
  render();
})();
