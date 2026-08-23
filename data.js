/* データページ（data.html）: バックアップの書き出しと読み込み */

const fmtSize = n => n < 1024*1024 ? Math.max(1,Math.round(n/1024))+' KB' : (n/1024/1024).toFixed(1)+' MB';

function totalBytes(){
  return artworks.reduce((n,a)=>n
    +(a.original?a.original.size:0)+(a.display?a.display.size:0)+(a.cutout?a.cutout.size:0),0);
}

function renderSum(){
  const kids=children.length, n=artworks.length;
  $('#sum').innerHTML = n
    ? '<b>'+n+'作品</b> ・ こども'+kids+'人 ・ 画像あわせて '+fmtSize(totalBytes())
    : 'まだ作品がありません。';
  $('#btnExport').disabled = !n;
}

/* ---------- 書き出し ---------- */
$('#btnExport').onclick=async()=>{
  const btn=$('#btnExport'); btn.disabled=true;
  try{
    if(!window.KWZip) throw new Error('ZIPの部品を読み込めませんでした');
    const blob=await buildBackup(artworks,children,(i,n)=>{btn.textContent='まとめています… '+i+'/'+n;});
    const d=new Date();
    const name='kodomo-world-'+d.getFullYear()+
      String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')+'.zip';
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('#exportNote').textContent=name+'（'+fmtSize(blob.size)+'）を書き出しました。';
    toast('書き出しました');
  }catch(err){
    console.error(err);
    $('#exportNote').textContent='書き出せませんでした: '+err.message;
    toast('書き出しに失敗しました');
  }finally{
    btn.disabled=!artworks.length; btn.textContent='💾 バックアップを書き出す';
  }
};

/* ---------- 読み込み ---------- */
let parsed=null;
const drop=$('#drop');
drop.onclick=()=>$('#file').click();
$('#file').onchange=e=>pick(e.target.files[0]);
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)pick(f);});

async function pick(f){
  if(!f) return;
  $('#importNote').textContent='中身を確認しています…';
  try{
    parsed=await readBackup(f);
    const known=new Set(artworks.map(a=>a.id));
    const fresh=parsed.artworks.filter(a=>!known.has(a.id)).length;
    $('#pickedSum').innerHTML='<b>'+f.name+'</b><br>'+
      parsed.artworks.length+'作品 ・ こども'+parsed.children.length+'人'+
      (parsed.meta.exported_at?'<br>書き出し: '+dateText(parsed.meta.exported_at.slice(0,10)):'')+
      '<br>このブラウザに増えるのは <b>'+fresh+'作品</b>（残りはすでにあります）';
    $('#picked').hidden=false;
    $('#importNote').textContent='';
  }catch(err){
    console.error(err);
    parsed=null; $('#picked').hidden=true;
    $('#importNote').textContent='読めませんでした: '+err.message;
  }
}

$('#btnCancel').onclick=()=>{parsed=null;$('#picked').hidden=true;$('#file').value='';};

$('#btnImport').onclick=async()=>{
  if(!parsed) return;
  const replace=$('#replace').checked;
  if(replace && !confirm('いま入っている'+artworks.length+'作品をすべて消してから読み込みます。元に戻せません。よろしいですか？')) return;
  const btn=$('#btnImport'); btn.disabled=true; btn.textContent='読み込んでいます…';
  try{
    const r=await applyBackup(parsed,{replace});
    renderSum();
    $('#picked').hidden=true; $('#file').value='';
    $('#importNote').innerHTML='読み込みました。作品を'+r.added+'件追加'+
      (r.skipped?'（'+r.skipped+'件はすでにありました）':'')+
      (r.childrenAdded?'、こどもを'+r.childrenAdded+'人追加':'')+
      '。<a href="index.html">世界を見る →</a>';
    parsed=null;
    toast('読み込みました');
  }catch(err){
    console.error(err);
    $('#importNote').textContent='読み込みに失敗しました: '+err.message;
  }finally{
    btn.disabled=false; btn.textContent='この内容を読み込む';
  }
};

/* ---------- 起動 ---------- */
(async function(){
  await kwLoad();
  renderSum();
})();
