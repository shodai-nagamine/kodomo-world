/* ============================================================
 * KODOMO WORLD - gallery.js
 * ギャラリー表示コンポーネント（classic script / no build / no CDN）
 * window.KWGallery.render(el, items, api) の形で公開する。
 * 表示モード・並び順・絞り込みはモジュール内に保持し、再描画のたびに
 * リセットしない（要件どおり）。
 * ============================================================ */
(function(){
  'use strict';

  /* ---------------- モジュール内state（再描画をまたいで保持） ---------------- */
  var state = {
    mode: 'gallery',        // 'gallery' | 'list'
    sort: 'date_desc',      // 'date_desc' | 'date_asc' | 'age' | 'author'
    filterChild: 'all'      // 'all' | child_id
  };

  /* ---------------- 小さなDOMヘルパー ---------------- */
  function h(tag, cls, text){
    var n = document.createElement(tag);
    if(cls) n.className = cls;
    if(text != null) n.textContent = text;
    return n;
  }
  function clear(node){ while(node.firstChild) node.removeChild(node.firstChild); }

  /* ---------------- 並び替え ---------------- */
  function ageScore(item){
    var y = Number(item.age_years) || 0, m = Number(item.age_months) || 0;
    return y * 12 + m;
  }
  function dateKey(item){
    return item.created_at || item.uploaded_at || '';
  }
  function makeComparator(sortKey, api){
    switch(sortKey){
      case 'date_asc':
        return function(a, b){ return dateKey(a).localeCompare(dateKey(b)) || String(a.id).localeCompare(String(b.id)); };
      case 'age':
        return function(a, b){ return ageScore(a) - ageScore(b) || dateKey(a).localeCompare(dateKey(b)); };
      case 'author':
        return function(a, b){
          return String(api.name(a)).localeCompare(String(api.name(b)), 'ja') || dateKey(a).localeCompare(dateKey(b));
        };
      case 'date_desc':
      default:
        return function(a, b){ return dateKey(b).localeCompare(dateKey(a)) || String(b.id).localeCompare(String(a.id)); };
    }
  }

  /* ---------------- カード / 行の共通メタ組み立て ---------------- */
  function buildMetaLine(item, api){
    var wrap = h('div', 'kwg-meta-line');
    wrap.appendChild(h('span', 'kwg-author', api.name(item)));
    wrap.appendChild(h('span', 'kwg-dot', '・'));
    wrap.appendChild(h('span', 'kwg-age', api.ageText(item)));
    return wrap;
  }

  /* ---------------- ギャラリーモード（カードグリッド） ---------------- */
  function buildGalleryGrid(items, api){
    var grid = h('div', 'kwg-grid');
    items.forEach(function(item){
      var card = h('button', 'kwg-card' + (item.id === api.selectedId ? ' kwg-sel' : ''));
      card.type = 'button';
      card.dataset.id = item.id;

      var thumb = h('div', 'kwg-thumb');
      var src = '';
      try{ src = api.imageUrl(item) || ''; }catch(e){ src = ''; }
      if(src){
        var img = document.createElement('img');
        img.src = src;
        img.alt = item.title || '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }else{
        thumb.appendChild(h('span', 'kwg-noimg', '🖼'));
      }
      card.appendChild(thumb);

      var body = h('div', 'kwg-card-body');
      body.appendChild(h('div', 'kwg-title', item.title || '（無題）'));
      body.appendChild(buildMetaLine(item, api));
      body.appendChild(h('div', 'kwg-date', api.dateText(item.created_at)));
      card.appendChild(body);

      grid.appendChild(card);
    });
    return grid;
  }

  /* ---------------- リストモード（行表示） ---------------- */
  function buildList(items, api){
    var list = h('div', 'kwg-list');
    items.forEach(function(item){
      var row = h('button', 'kwg-row' + (item.id === api.selectedId ? ' kwg-sel' : ''));
      row.type = 'button';
      row.dataset.id = item.id;

      var thumb = h('div', 'kwg-row-thumb');
      var src = '';
      try{ src = api.imageUrl(item) || ''; }catch(e){ src = ''; }
      if(src){
        var img = document.createElement('img');
        img.src = src;
        img.alt = item.title || '';
        img.loading = 'lazy';
        thumb.appendChild(img);
      }else{
        thumb.appendChild(h('span', 'kwg-noimg', '🖼'));
      }
      row.appendChild(thumb);

      row.appendChild(h('span', 'kwg-row-title', item.title || '（無題）'));
      row.appendChild(h('span', 'kwg-row-author', api.name(item)));
      row.appendChild(h('span', 'kwg-row-age', api.ageText(item)));
      row.appendChild(h('span', 'kwg-row-date', api.dateText(item.created_at)));

      list.appendChild(row);
    });
    return list;
  }

  /* ---------------- 空状態 ---------------- */
  function buildEmpty(message){
    var empty = h('div', 'kwg-empty');
    empty.appendChild(h('span', 'kwg-empty-big', '🖼'));
    empty.appendChild(h('div', 'kwg-empty-msg', message));
    return empty;
  }

  /* ---------------- ツールバー ---------------- */
  function buildToolbar(items, allItems, api, onChange){
    var bar = h('div', 'kwg-toolbar');

    // 表示切替
    var modeGroup = h('div', 'kwg-seg');
    var galleryBtn = h('button', 'kwg-seg-btn' + (state.mode === 'gallery' ? ' kwg-on' : ''), '🖼 ギャラリー');
    galleryBtn.type = 'button';
    galleryBtn.onclick = function(){ if(state.mode !== 'gallery'){ state.mode = 'gallery'; onChange(); } };
    var listBtn = h('button', 'kwg-seg-btn' + (state.mode === 'list' ? ' kwg-on' : ''), '☰ リスト');
    listBtn.type = 'button';
    listBtn.onclick = function(){ if(state.mode !== 'list'){ state.mode = 'list'; onChange(); } };
    modeGroup.appendChild(galleryBtn);
    modeGroup.appendChild(listBtn);
    bar.appendChild(modeGroup);

    // 並び替え
    var sortWrap = h('label', 'kwg-field');
    sortWrap.appendChild(h('span', 'kwg-field-label', '並び替え'));
    var sortSel = document.createElement('select');
    sortSel.className = 'kwg-select';
    [
      ['date_desc', '制作日が新しい順'],
      ['date_asc', '制作日が古い順'],
      ['age', '年齢順'],
      ['author', '作者順']
    ].forEach(function(opt){
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if(opt[0] === state.sort) o.selected = true;
      sortSel.appendChild(o);
    });
    sortSel.onchange = function(){ state.sort = sortSel.value; onChange(); };
    sortWrap.appendChild(sortSel);
    bar.appendChild(sortWrap);

    // 作者で絞り込み
    var filterWrap = h('label', 'kwg-field');
    filterWrap.appendChild(h('span', 'kwg-field-label', '作者'));
    var filterSel = document.createElement('select');
    filterSel.className = 'kwg-select';
    var allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = '全員';
    if(state.filterChild === 'all') allOpt.selected = true;
    filterSel.appendChild(allOpt);
    (api.children || []).forEach(function(c){
      var o = document.createElement('option');
      o.value = c.id; o.textContent = c.display_name;
      if(state.filterChild === c.id) o.selected = true;
      filterSel.appendChild(o);
    });
    // 選択中の絞り込み対象がchildren一覧から消えていたら全員に戻す
    if(state.filterChild !== 'all' && !(api.children || []).some(function(c){ return c.id === state.filterChild; })){
      state.filterChild = 'all';
      allOpt.selected = true;
    }
    filterSel.onchange = function(){ state.filterChild = filterSel.value; onChange(); };
    filterWrap.appendChild(filterSel);
    bar.appendChild(filterWrap);

    // 件数
    bar.appendChild(h('div', 'kwg-count', items.length + '作品'));

    return bar;
  }

  /* ---------------- メインrender ---------------- */
  function render(el, items, api){
    items = Array.isArray(items) ? items : [];

    function rerender(){ render(el, items, api); }

    clear(el);
    var root = h('div', 'kwg-root');

    var filtered = state.filterChild === 'all'
      ? items.slice()
      : items.filter(function(it){ return it.child_id === state.filterChild; });

    filtered.sort(makeComparator(state.sort, api));

    root.appendChild(buildToolbar(filtered, items, api, rerender));

    var content = h('div', 'kwg-content');
    if(items.length === 0){
      content.appendChild(buildEmpty('まだ作品がありません。'));
    }else if(filtered.length === 0){
      content.appendChild(buildEmpty('この条件にあう作品がありません。'));
    }else if(state.mode === 'list'){
      content.appendChild(buildList(filtered, api));
    }else{
      content.appendChild(buildGalleryGrid(filtered, api));
    }
    root.appendChild(content);

    content.addEventListener('click', function(e){
      var target = e.target.closest('[data-id]');
      if(target) api.onSelect(target.dataset.id);
    });

    el.appendChild(root);
  }

  window.KWGallery = { render: render };
})();
