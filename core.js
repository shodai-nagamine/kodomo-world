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

/* ---------------- 共有の起動処理 ---------------- */
// 入力ページ（add.html）と世界ページ（index.html）の両方から呼ぶ。
// DBを開き、作品とこども登録を読み込み、旧データの移行までを行う。
async function kwLoad(){
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
  artworks.sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||''));
}
