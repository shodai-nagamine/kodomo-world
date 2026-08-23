/* ---------------- storage (IndexedDB: 画像 Blob / localStorage: 作者) ---------------- */
const DB_NAME='kodomo-world', STORE='artworks', WORLD_ID='w-default', WORLD_NAME='みんなの作品世界';
let db=null;
function openDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>{const d=r.result; if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE,{keyPath:'id'});};
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}
function tx(mode){return db.transaction(STORE,mode).objectStore(STORE);}
function idbAll(){return new Promise((res,rej)=>{const q=tx('readonly').getAll();q.onsuccess=()=>res(q.result||[]);q.onerror=()=>rej(q.error);});}
function idbPut(v){return new Promise((res,rej)=>{const q=tx('readwrite').put(v);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});}
function idbDel(id){return new Promise((res,rej)=>{const q=tx('readwrite').delete(id);q.onsuccess=()=>res();q.onerror=()=>rej(q.error);});}

const CHILDREN_KEY='kw_children', SELECTED_KEY='kw_selected_child';
const loadChildren=()=>{try{return JSON.parse(localStorage.getItem(CHILDREN_KEY))||[];}catch(e){return [];}};
const saveChildren=c=>localStorage.setItem(CHILDREN_KEY,JSON.stringify(c));

/* ---------------- state ---------------- */
let artworks=[], selectedId=null;
let children=[], selectedChildId=null, editingChildId=null;
const childOf=id=>children.find(c=>c.id===id)||null;
/* 作品の作者名は登録済みこどもを優先して解決（改名が全画面に反映される） */
const nameOf=a=>{const c=childOf(a.child_id); return c?c.display_name:(a.child_name||'（未登録）');};
/* 生年月日と制作日から 5歳2ヶ月 まで算出 */
function calcAge(birth,dateStr){
  if(!birth||!dateStr) return null;
  const b=new Date(birth+'T00:00:00'), d=new Date(dateStr+'T00:00:00');
  if(isNaN(b)||isNaN(d)||d<b) return null;
  let y=d.getFullYear()-b.getFullYear(), m=d.getMonth()-b.getMonth();
  if(d.getDate()<b.getDate()) m--;
  if(m<0){y--;m+=12;}
  return {y,m};
}
const urls=new Map(); // id -> {display, original}
function urlOf(a,kind){
  let u=urls.get(a.id);
  if(!u){u={};urls.set(a.id,u);}
  if(!u[kind]) u[kind]=URL.createObjectURL(kind==='original'?a.original:kind==='cutout'?a.cutout:a.display);
  return u[kind];
}
function freeUrls(id){
  const u=urls.get(id); if(!u) return;
  Object.values(u).forEach(URL.revokeObjectURL); urls.delete(id);
}

/* ---------------- helpers ---------------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>'a-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7);
const ageText=a=>a.age_years+'歳'+(a.age_months?a.age_months+'ヶ月':'');
const dateText=s=>{const d=new Date(s+'T00:00:00');return isNaN(d)?s:d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate();};
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('on'),2200);}

async function shrink(file,max,quality){
  const type=file.type==='image/png'?'image/png':'image/jpeg';
  const bmp=await createImageBitmap(file,{imageOrientation:'from-image'});
  const s=Math.min(1,max/Math.max(bmp.width,bmp.height));
  const w=Math.max(1,Math.round(bmp.width*s)), h=Math.max(1,Math.round(bmp.height*s));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  const ctx=c.getContext('2d'); ctx.drawImage(bmp,0,0,w,h);
  if(bmp.close) bmp.close();
  const blob=await new Promise(r=>c.toBlob(r,type,quality));
  return blob||file;
}

/* 既存キャラとなるべく重ならない位置を選ぶ */
function pickPosition(){
  const pts=artworks.map(a=>[a.position_x,a.position_y]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  let best=[50,50], bestD=-1;
  for(let i=0;i<48;i++){
    // 島は円形なので円板の中でサンプリングする（矩形だと端に寄って海へはみ出す）
    const th=Math.random()*Math.PI*2, rr=44*Math.sqrt(Math.random());
    const x=50+Math.cos(th)*rr, y=50+Math.sin(th)*rr;
    let d=1e9;
    for(const p of pts) d=Math.min(d,Math.hypot(x-p[0],(y-p[1])*0.6));
    if(!pts.length) return [x,y];
    if(d>bestD){bestD=d;best=[x,y];}
  }
  return best;
}

/* ---------------- render ---------------- */
function render(){
  artworks.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
  renderWorld(); renderArchive(); renderTimeline(); renderDetail();
  renderKids();
  $('#stat').textContent=artworks.length? artworks.length+'作品 ・ '+children.length+'人のこども' : '';
  $('#worldName').textContent=WORLD_NAME;
}

function renderKids(){
  const box=$('#kids');
  $('#kidsEmpty').style.display=children.length?'none':'block';
  box.innerHTML=children.map(c=>{
    const n=artworks.filter(a=>a.child_id===c.id).length;
    const age=calcAge(c.birth_date,new Date().toISOString().slice(0,10));
    const sub=[age?('いま'+age.y+'歳'):(c.birth_year?c.birth_year+'年生まれ':''),n?n+'作品':''].filter(Boolean).join('・');
    return '<span class="kid'+(c.id===selectedChildId?' on':'')+'" data-kid="'+c.id+'" role="button" tabindex="0">'+
      '<span class="av">'+esc([...c.display_name][0]||'?')+'</span>'+
      '<span><span class="nm">'+esc(c.display_name)+'</span>'+(sub?'<span class="sub">'+esc(sub)+'</span>':'')+'</span>'+
      '<button type="button" class="ed" data-edit="'+c.id+'" title="編集">✎</button></span>';
  }).join('');
}

let world3d=null, lastTier=null;
function worldPayload(){
  return artworks.map(a=>{
    const solid=!!(a.cutout && a.shape && a.shape.length);
    return {id:a.id, url:urlOf(a, solid?'cutout':'display'), title:a.title,
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
    '<div class="d-meta">'+esc(nameOf(a))+'・'+ageText(a)+'のとき</div>'+
    '<div class="d-meta">'+dateText(a.created_at)+' に制作</div>'+
    (a.description?'<p class="d-quote"><span class="cap">本人の説明</span>「'+esc(a.description)+'」</p>':'')+
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
let pendingFile=null;
const drop=$('#drop');
drop.onclick=()=>$('#file').click();
$('#file').onchange=e=>setFile(e.target.files[0]);
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)setFile(f);});
function setFile(f){
  if(!f||!f.type.startsWith('image/')){toast('画像ファイルを選んでください');return;}
  pendingFile=f;
  const u=URL.createObjectURL(f);
  $('#prevImg').src=u; $('#prevName').textContent=f.name;
  $('#preview').style.display='block';
  drop.innerHTML='<span class="big">🔄</span>別の写真に変える';
  startModeling();
}

/* ---------- 3D化のステップ ---------- */
let pendingModel=null, modelSeq=0;
const PREVIEW_SIZE=420, FINAL_SIZE=640;   // プレビュー用と保存用の解析サイズ
const use3d=()=>$('#use3d').checked;
function stepUI(){
  $('#opt3d').classList.toggle('off',!use3d());
  $('#tolV').textContent=$('#tol').value+'%';
  $('#thickV').textContent=($('#thick').value/100).toFixed(2);
}
function startModeling(){
  $('#step3d').hidden=false;
  stepUI();
  if(!window.KWModel){
    pendingModel=null;
    $('#cutNote').textContent='立体化の部品を読み込めなかったので、写真のまま板で置きます。';
    $('#use3d').checked=false; $('#use3d').disabled=true; stepUI();
    drawCut(null);
    return;
  }
  runModeling();
}
let modelTimer=null;
function runModelingSoon(){clearTimeout(modelTimer);modelTimer=setTimeout(runModeling,220);}
async function runModeling(){
  if(!pendingFile) return;
  const seq=++modelSeq;
  if(!use3d()){
    pendingModel=null; drawCut(null);
    $('#cutNote').textContent='写真をそのまま板にして世界に置きます。';
    return;
  }
  $('#cutBusy').classList.add('on');
  try{
    // プレビューは軽い解像度で回す（900pxだと1.8秒かかりスライダーが重い）
    const r=await window.KWModel.analyze(pendingFile,{
      tolerance:parseInt($('#tol').value,10)/100, maxSize:PREVIEW_SIZE, maxPoints:160, removeBackground:true});
    if(seq!==modelSeq) return;            // スライダー連打で古い結果が上書きしないように
    pendingModel=r;
    drawCut(r);
    $('#cutNote').textContent = r.ok
      ? 'この形で立体になります（残す量はスライダーで調整できます）'
      : (r.reason||'背景をうまく抜けませんでした')+'。このままだと板で置かれます。';
  }catch(err){
    console.error(err);
    if(seq!==modelSeq) return;
    pendingModel=null; drawCut(null);
    $('#cutNote').textContent='かたちを読みとれませんでした。写真のまま板で置きます。';
  }finally{
    if(seq===modelSeq) $('#cutBusy').classList.remove('on');
  }
}
// 切り抜き結果と輪郭をプレビューに描く
function drawCut(r){
  const cv=$('#cutCanvas'), ctx=cv.getContext('2d');
  const W=cv.width;
  const src=(r&&r.ok&&r.cutout)?r.cutout:pendingFile;
  if(!src){ctx.clearRect(0,0,cv.width,cv.height);return;}
  const url=URL.createObjectURL(src);
  const img=new Image();
  img.onload=()=>{
    const H=Math.max(80,Math.round(W*img.height/img.width));
    cv.height=H; ctx.clearRect(0,0,W,H);
    ctx.drawImage(img,0,0,W,H);
    if(r&&r.ok&&r.contours){
      ctx.strokeStyle='#ff8a3d'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
      for(const poly of r.contours){
        if(!poly||poly.length<3) continue;
        ctx.beginPath();
        poly.forEach(([x,y],i)=>{const px=x*W,py=y*H;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});
        ctx.closePath(); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    URL.revokeObjectURL(url);
  };
  img.src=url;
}
$('#use3d').onchange=()=>{stepUI();runModeling();};
$('#tol').oninput=()=>{stepUI();runModelingSoon();};
$('#thick').oninput=stepUI;

/* こども選択 → 年齢の自動計算 */
function selectChild(id){
  selectedChildId=id;
  localStorage.setItem(SELECTED_KEY,id||'');
  renderKids(); syncAge();
}
function syncAge(){
  const c=childOf(selectedChildId), dv=$('#date').value, hint=$('#ageHint');
  if(!c||!dv){hint.textContent='';return;}
  const r=calcAge(c.birth_date,dv);
  if(r){
    $('#ageY').value=r.y; $('#ageM').value=r.m||'';
    hint.textContent=c.display_name+'の生年月日から自動計算しました（変更できます）';
    return;
  }
  if(c.birth_year){
    const y=parseInt(dv.slice(0,4),10)-c.birth_year;
    if(y>=0){$('#ageY').value=y; $('#ageM').value='';}
    hint.textContent='生まれた年からのおおよその年齢です（変更できます）';
    return;
  }
  hint.textContent='生年月日を登録すると年齢を自動計算します';
}
$('#date').onchange=syncAge;

/* こどもチップ：選択 / 編集 */
$('#kids').addEventListener('click',e=>{
  const ed=e.target.closest('[data-edit]');
  if(ed){e.stopPropagation();openKidModal(ed.dataset.edit);return;}
  const chip=e.target.closest('[data-kid]');
  if(chip) selectChild(chip.dataset.kid);
});
$('#kids').addEventListener('keydown',e=>{
  const chip=e.target.closest('[data-kid]');
  if(chip&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectChild(chip.dataset.kid);}
});

/* こども登録・編集モーダル */
function openKidModal(id){
  editingChildId=id||null;
  const c=childOf(id);
  $('#kmTitle').textContent=c?'こどもの情報を編集':'こどもを登録';
  $('#kmName').value=c?c.display_name:'';
  $('#kmBirth').value=c&&c.birth_date?c.birth_date:'';
  const del=$('#kmDelete');
  if(c){
    const n=artworks.filter(a=>a.child_id===c.id).length;
    del.style.display='block';
    del.textContent=n?('作品が'+n+'件あるため削除できません'):'このこどもを削除する';
    del.disabled=!!n;
    del.style.opacity=n?'.5':'1';
  }else{del.style.display='none';}
  $('#kidModal').classList.add('on');
  setTimeout(()=>$('#kmName').focus(),30);
}
function closeKidModal(){$('#kidModal').classList.remove('on');editingChildId=null;}
$('#kidAdd').onclick=()=>openKidModal(null);
$('#kmCancel').onclick=closeKidModal;
$('#kidModal').addEventListener('click',e=>{if(e.target.id==='kidModal')closeKidModal();});
$('#kmSave').onclick=()=>{
  const name=$('#kmName').value.trim();
  if(!name){toast('表示名を入れてください');$('#kmName').focus();return;}
  const birth=$('#kmBirth').value||null;
  if(birth && new Date(birth+'T00:00:00')>new Date()){toast('生年月日が未来になっています');return;}
  const dup=children.find(c=>c.display_name===name&&c.id!==editingChildId);
  if(dup){toast('同じ表示名のこどもがすでにいます');return;}
  if(editingChildId){
    const c=childOf(editingChildId);
    c.display_name=name; c.birth_date=birth;
    c.birth_year=birth?parseInt(birth.slice(0,4),10):c.birth_year||null;
  }else{
    const c={id:'c-'+Math.random().toString(36).slice(2,8),display_name:name,birth_date:birth,
             birth_year:birth?parseInt(birth.slice(0,4),10):null,created_at:new Date().toISOString()};
    children.push(c); selectedChildId=c.id; localStorage.setItem(SELECTED_KEY,c.id);
  }
  saveChildren(children); closeKidModal(); render(); syncAge();
  toast(editingChildId?'こどもの情報を更新しました':'「'+name+'」を登録しました');
};
$('#kmDelete').onclick=()=>{
  const c=childOf(editingChildId); if(!c) return;
  if(artworks.some(a=>a.child_id===c.id)){toast('作品が残っているため削除できません');return;}
  if(!confirm('「'+c.display_name+'」の登録を削除します。よろしいですか？')) return;
  children=children.filter(x=>x.id!==c.id);
  if(selectedChildId===c.id) selectedChildId=children.length?children[0].id:null;
  localStorage.setItem(SELECTED_KEY,selectedChildId||'');
  saveChildren(children); closeKidModal(); render(); syncAge(); toast('削除しました');
};

/* 登録 */
$('#form').onsubmit=async e=>{
  e.preventDefault();
  if(!pendingFile){toast('作品の写真を選んでください');return;}
  const child=childOf(selectedChildId);
  if(!child){toast('作者のこどもを選んでください');openKidModal(children.length?null:null);return;}
  const btn=$('#submit'); btn.disabled=true; btn.textContent='世界に送っています…';
  try{
    const display=await shrink(pendingFile,900,.86);
    let model=pendingModel;
    if(use3d() && model && model.ok && window.KWModel){
      // 保存するぶんはプレビューより高い解像度で作り直す（同じ設定で解析）
      btn.textContent='立体にしています…';
      try{
        const hi=await window.KWModel.analyze(pendingFile,{
          tolerance:parseInt($('#tol').value,10)/100, maxSize:FINAL_SIZE, maxPoints:160, removeBackground:true});
        if(hi && hi.ok && hi.contours && hi.contours.length) model=hi;
      }catch(err){ console.error(err); }   // 失敗したらプレビューの結果をそのまま使う
      btn.textContent='世界に送っています…';
    }
    const solid=use3d() && model && model.ok && model.contours && model.contours.length;
    const [x,y]=pickPosition();
    const a={
      id:uid(), world_id:WORLD_ID, child_id:child.id, child_name:child.display_name,
      title:$('#title').value.trim(),
      description:$('#desc').value.trim(),
      age_years:parseInt($('#ageY').value,10)||0,
      age_months:parseInt($('#ageM').value,10)||0,
      created_at:$('#date').value,
      uploaded_at:new Date().toISOString(),
      position_x:x, position_y:y, scale:0.85+Math.random()*0.35,
      appearance_type:solid?'extruded_cutout':'original_image',
      original:pendingFile, display:display,
      // 派生物（背景除去・立体の形）。原作品は必ず original に無加工で残す
      cutout:solid?model.cutout:null,
      shape:solid?model.contours:null,
      depth:parseInt($('#thick').value,10)/100,
      rotation_y:null,
      metadata:{filename:pendingFile.name,size:pendingFile.size,type:pendingFile.type,
                model:solid?{coverage:model.coverage,tolerance:parseInt($('#tol').value,10)/100,
                             points:model.contours.reduce((n,p)=>n+p.length,0)}:null}
    };
    await idbPut(a);
    artworks.push(a);
    selectedId=a.id;
    // フォームをリセット（作者・生年・日付は続けて使えるよう残す）
    pendingFile=null; pendingModel=null; modelSeq++;
    $('#file').value=''; $('#preview').style.display='none'; $('#step3d').hidden=true;
    drop.innerHTML='<span class="big">🖼️</span>作品の写真を選ぶ<br><span style="font-size:11px">クリック / ドラッグ＆ドロップ</span>';
    $('#title').value=''; $('#desc').value='';
    document.querySelector('.tabs button[data-v="world"]').click();
    render();
    if(world3d) setTimeout(()=>world3d.focus(a.id),120);
    toast('「'+a.title+'」が世界に住みはじめました');
  }catch(err){
    console.error(err); toast('保存に失敗しました: '+err.message);
  }finally{
    btn.disabled=false; btn.textContent='世界に追加する';
  }
};

/* ---------------- boot ---------------- */
(async function(){
  $('#date').value=new Date().toISOString().slice(0,10);
  children=loadChildren().map(c=>Object.assign({birth_date:null,birth_year:null},c));
  try{
    db=await openDB();
    artworks=await idbAll();
  }catch(err){
    console.error(err);
    toast('この環境ではブラウザ保存が使えません（http で開いてください）');
  }
  // 旧データ（作者を手入力していた作品）を children に取り込む
  let migrated=false;
  for(const a of artworks){
    if(a.child_id && childOf(a.child_id)) continue;
    let c=children.find(x=>x.display_name===a.child_name);
    if(!c){
      c={id:a.child_id||('c-'+Math.random().toString(36).slice(2,8)),display_name:a.child_name||'（未登録）',
         birth_date:null,birth_year:null,created_at:new Date().toISOString()};
      children.push(c);
    }
    a.child_id=c.id; migrated=true;
  }
  if(migrated){saveChildren(children); for(const a of artworks) await idbPut(a);}
  const last=localStorage.getItem(SELECTED_KEY);
  selectedChildId=(last&&childOf(last))?last:(children[0]?children[0].id:null);
  render(); syncAge();
})();
