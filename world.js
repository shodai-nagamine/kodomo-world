/* 世界ページ（index.html）: 3Dワールド・ギャラリー・タイムライン・作品詳細 */

/* ---------------- render ---------------- */
function render(){
  artworks.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
  renderWorld(); renderArchive(); renderTimeline(); renderDetail();
  $('#stat').textContent=artworks.length? artworks.length+'作品 ・ '+children.length+'人のこども' : '';
  $('#worldName').textContent=WORLD_NAME;
  $('#worldEmpty').style.display=artworks.length?'none':'flex';
}

let world3d=null, lastTier=null;
function worldPayload(){
  return artworks.map(a=>{
    const solid=!!(a.cutout && a.shape && a.shape.length);
    return {id:a.id, url:urlOf(a, solid?'cutout':'display'), title:a.title, role:roleOf(a),
      px:fin(a.position_x,50), py:fin(a.position_y,55), scale:a.scale||1,
      shape:solid?a.shape:null, depth:a.depth||.12, yaw:(typeof a.rotation_y==='number')?a.rotation_y:undefined};
  });
}
function renderWorld(){
  $('#worldEmpty').style.display=artworks.length?'none':'flex';
  $('#worldHint').style.display=artworks.length?'block':'none';
  if(!world3d) return;
  const r=world3d.sync(worldPayload());
  world3d.select(selectedId);
  if(r && lastTier!==null && r.tier>lastTier){
    const el=$('#worldTier');
    el.textContent='🌍 世界が広がった！';
    el.classList.add('on');
    setTimeout(()=>el.classList.remove('on'),3200);
  }
  if(r) lastTier=r.tier;
}
function fin(v,fb){return Number.isFinite(v)?Math.min(96,Math.max(4,v)):fb;}
function hash(s){let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return h;}

function renderArchive(){
  const box=$('#archiveBox');
  if(!window.KWGallery){box.textContent='ギャラリーを読み込めませんでした。';return;}
  window.KWGallery.render(box, artworks, {
    imageUrl:a=>urlOf(a,'display'),
    name:a=>nameOf(a),
    ageText:a=>ageText(a),
    dateText:s=>dateText(s),
    selectedId:selectedId,
    onSelect:id=>select(id),
    children:children.map(c=>({id:c.id,display_name:c.display_name}))
  });
}

function renderTimeline(){
  const tl=$('#tl');
  if(!artworks.length){tl.innerHTML='<div style="color:var(--ink-soft)">まだ作品がありません。</div>';return;}
  const groups=new Map();
  for(const a of artworks){
    const k=a.age_years;
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(a);
  }
  const keys=[...groups.keys()].sort((x,y)=>x-y);
  tl.innerHTML=keys.map(k=>{
    const items=groups.get(k).slice().sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
    return '<div class="age"><span class="badge">'+k+'歳</span><span class="line"></span>'+
      '<span style="font-size:11px;color:var(--ink-soft);font-weight:400">'+items.length+'作品</span></div>'+
      '<div class="items">'+items.map(a=>
        '<button class="item" data-id="'+a.id+'">'+
        '<span class="th" style="background-image:url('+urlOf(a,'display')+')"></span>'+
        '<span><span class="t">'+esc(a.title)+'</span><br>'+
        '<span class="s">'+esc(nameOf(a))+'・'+ageText(a)+'・'+dateText(a.created_at)+'</span></span></button>').join('')+
      '</div>';
  }).join('');
}

function renderDetail(){
  const d=$('#detail');
  const a=artworks.find(x=>x.id===selectedId);
  if(!a){d.innerHTML='<div class="empty"><span class="big">👆</span>世界のキャラクターを<br>クリックしてください</div>';return;}
  d.innerHTML=
    '<img class="d-img" src="'+urlOf(a,'display')+'" alt="'+esc(a.title)+'">'+
    '<div class="d-title">'+esc(a.title)+'</div>'+
    '<div class="d-meta">'+roleDef(roleOf(a)).emoji+esc(roleDef(roleOf(a)).label)+
      '・'+esc(nameOf(a))+'・'+ageText(a)+'のとき</div>'+
    '<div class="d-meta">'+dateText(a.created_at)+' に制作</div>'+
    (a.description?'<p class="d-quote"><span class="cap">本人の説明</span>「'+esc(a.description)+'」</p>':'')+
    '<div class="d-sec">世界での居場所</div>'+
    '<div class="roles small" id="dRoles">'+ROLES.map(r=>
      '<button type="button" class="role'+(r.id===roleOf(a)?' on':'')+'" data-role="'+r.id+'">'+
      '<span class="e">'+r.emoji+'</span>'+esc(r.label)+'</button>').join('')+'</div>'+
    '<div class="hint" id="dRoleHint">'+esc(roleDef(roleOf(a)).hint)+'</div>'+
    '<button class="btn ghost" id="btnOriginal">🖼️ 元の作品を見る</button>'+
    '<div class="d-sec">作品の記録</div>'+
    '<div class="rec">'+
      '<div><span class="k">'+ageText(a)+'</span><br><span class="v">この作品が生まれた（'+dateText(a.created_at)+'）</span></div>'+
      '<div><span class="k">現在</span><br><span class="v">'+WORLD_NAME+'の住人として保存されている</span></div>'+
    '</div>'+
    '<button class="btn sub" id="btnSticker">✨ ステッカーにする</button>'+
    '<button class="del" id="btnDel">この作品を世界から削除する</button>';
  $('#btnOriginal').onclick=()=>{
    $('#lbImg').src=urlOf(a,'original');
    $('#lbCap').textContent=a.title+'（元の作品）／ '+nameOf(a)+'・'+ageText(a)+'・'+dateText(a.created_at);
    $('#lightbox').classList.add('on');
  };
  $('#dRoles').addEventListener('click',async e=>{
    const b=e.target.closest('[data-role]'); if(!b) return;
    const role=b.dataset.role;
    if(role===roleOf(a)) return;
    a.role=role; await idbPut(a);
    render();
    toast(roleDef(role).emoji+roleDef(role).label+'にしました');
  });
  $('#btnSticker').onclick=()=>toast('ステッカー作成機能は準備中です');
  $('#btnDel').onclick=async()=>{
    if(!confirm('「'+a.title+'」を削除します。元の画像も消えて元に戻せません。よろしいですか？')) return;
    await idbDel(a.id); freeUrls(a.id);
    artworks=artworks.filter(x=>x.id!==a.id); selectedId=null; render(); toast('削除しました');
  };
}

function select(id){
  selectedId=id;
  if(world3d) world3d.select(id);
  renderArchive(); renderDetail();
}

/* ---------------- events ---------------- */
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('on',v.id==='view-'+b.dataset.v));
});
$('#tl').addEventListener('click',e=>{const c=e.target.closest('.item');if(c)select(c.dataset.id);});
$('#lightbox').onclick=()=>$('#lightbox').classList.remove('on');
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('#lightbox').classList.remove('on');closeKidModal();}
});

/* ながめる / さんぽ の切り替え */
const HINT={
  orbit:'ドラッグで見まわす ・ ホイールで近づく ・ キャラクターをドラッグで移動',
  walk:'WASD か 矢印キーで歩く（Shiftで走る） ・ ドラッグで見まわす ・ 作品をクリックで見る'
};
function setMode(next){
  if(!world3d) return;
  const m=world3d.setMode(next);
  $('#modeBtn').textContent = m==='walk' ? '👀 ながめる' : '🚶 さんぽする';
  $('#modeBtn').classList.toggle('on', m==='walk');
  $('#worldHint').textContent = HINT[m];
}
$('#modeBtn').onclick=()=>setMode(world3d && world3d.getMode()==='walk' ? 'orbit' : 'walk');
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && world3d && world3d.getMode()==='walk') setMode('orbit');
});

/* 3Dワールドからのクリック・移動 */
window.__kwWorldReady=api=>{
  world3d=api;
  renderWorld();
  if(selectedId) world3d.select(selectedId);
};
window.__kwOnWorldSelect=id=>{
  if(id&&artworks.some(a=>a.id===id)) select(id);
  else if(!id) select(null);
};
window.__kwOnWorldMove=async(id,px,py)=>{
  const a=artworks.find(x=>x.id===id); if(!a) return;
  a.position_x=fin(px,50); a.position_y=fin(py,55);
  await idbPut(a);
};

/* ファイル選択 */

/* ---------------- 起動 ---------------- */
(async function(){
  await kwLoad();
  render();
  // 追加ページから「世界で見る」で戻ってきたときは、その作品を選んで寄る
  const focus=new URLSearchParams(location.search).get('focus');
  if(focus && artworks.some(a=>a.id===focus)){
    select(focus);
    const go=()=>{ if(world3d){ world3d.focus(focus); } else setTimeout(go,200); };
    setTimeout(go,300);
    history.replaceState(null,'',location.pathname);
  }
})();
