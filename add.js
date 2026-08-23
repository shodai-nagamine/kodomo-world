/* 追加ページ（add.html）: 写真 → 3Dにする → 作品の情報 */

/* ---------------- こどものチップ ---------------- */
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

/* ---------------- 追加できたときの表示 ---------------- */
function showDone(a){
  // 立体になったものは切り抜きを見せる（何ができたのかが分かる）
  $('#doneImg').src=urlOf(a, a.cutout?'cutout':'display');
  $('#doneTitle').textContent=a.title;
  $('#doneMeta').textContent=nameOf(a)+'・'+ageText(a)+'・'+dateText(a.created_at)+
    (a.appearance_type==='extruded_cutout'?'・立体になりました':'');
  $('#doneSee').href='index.html?focus='+encodeURIComponent(a.id);
  $('#done').hidden=false;
  $('#form').hidden=true;
  $('#done').scrollIntoView({block:'center',behavior:'smooth'});
}
function closeDone(){
  $('#done').hidden=true; $('#form').hidden=false;
  $('#title').focus();
}

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
  saveChildren(children); closeKidModal(); renderKids(); syncAge();
  toast(editingChildId?'こどもの情報を更新しました':'「'+name+'」を登録しました');
};
$('#kmDelete').onclick=()=>{
  const c=childOf(editingChildId); if(!c) return;
  if(artworks.some(a=>a.child_id===c.id)){toast('作品が残っているため削除できません');return;}
  if(!confirm('「'+c.display_name+'」の登録を削除します。よろしいですか？')) return;
  children=children.filter(x=>x.id!==c.id);
  if(selectedChildId===c.id) selectedChildId=children.length?children[0].id:null;
  localStorage.setItem(SELECTED_KEY,selectedChildId||'');
  saveChildren(children); closeKidModal(); renderKids(); syncAge(); toast('削除しました');
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
    renderKids();
    showDone(a);
  }catch(err){
    console.error(err); toast('保存に失敗しました: '+err.message);
  }finally{
    btn.disabled=false; btn.textContent='世界に追加する';
  }
};

$('#doneMore').onclick=closeDone;

/* ---------------- 起動 ---------------- */
(async function(){
  $('#date').value=new Date().toISOString().slice(0,10);
  await kwLoad();
  renderKids(); syncAge();
  if(!children.length) openKidModal(null);   // 最初の一回はこども登録から
})();
