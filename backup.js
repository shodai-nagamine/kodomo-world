/* バックアップ（書き出し・読み込み）
 *
 * 形式は素直なZIP。中身をFinderで開けば作品の写真がそのまま取り出せる。
 * 「アプリが無くなっても写真は残る」ことを優先し、独自形式に閉じ込めない。
 *
 *   kodomo-world.json          … 作品・こどもの情報
 *   artworks/<id>/original.*   … 原作品（無加工）
 *   artworks/<id>/display.jpg  … 表示用（長辺900px）
 *   artworks/<id>/cutout.png   … 背景を抜いた画像（立体のものだけ）
 *   よみかた.txt                … 中身の説明
 */
const BACKUP_VERSION = 1;

const extOf = (blob, fallback) => {
  const t = (blob && blob.type) || '';
  if (t.includes('png')) return 'png';
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg';
  if (t.includes('webp')) return 'webp';
  if (t.includes('gif')) return 'gif';
  return fallback;
};

const READ_ME = [
  'KODOMO WORLD のバックアップ',
  '',
  'このZIPには、登録した作品の画像と情報が入っています。',
  'artworks/ の中の original が、加工していない元の写真です。',
  'アプリが無くても、そのまま画像として開けます。',
  '',
  'アプリに戻すときは、KODOMO WORLD の「データ」ページから',
  'このZIPファイルを読み込んでください。',
  ''
].join('\n');

/* 書き出し: 現在の artworks / children から ZIP を作る */
async function buildBackup(artworks, children, onProgress){
  const entries = [];
  const meta = {
    format: 'kodomo-world-backup',
    version: BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    world: { id: WORLD_ID, name: WORLD_NAME },
    children: children.map(c => ({
      id: c.id, display_name: c.display_name,
      birth_date: c.birth_date || null, birth_year: c.birth_year || null,
      created_at: c.created_at || null
    })),
    artworks: []
  };

  for (let i = 0; i < artworks.length; i++){
    const a = artworks[i];
    const dir = 'artworks/' + a.id + '/';
    const files = {};
    if (a.original){
      files.original = { path: dir + 'original.' + extOf(a.original, 'jpg'), type: a.original.type || 'image/jpeg' };
      entries.push({ name: files.original.path, data: a.original });
    }
    if (a.display){
      files.display = { path: dir + 'display.' + extOf(a.display, 'jpg'), type: a.display.type || 'image/jpeg' };
      entries.push({ name: files.display.path, data: a.display });
    }
    if (a.cutout){
      files.cutout = { path: dir + 'cutout.' + extOf(a.cutout, 'png'), type: a.cutout.type || 'image/png' };
      entries.push({ name: files.cutout.path, data: a.cutout });
    }
    meta.artworks.push({
      id: a.id, world_id: a.world_id, child_id: a.child_id, child_name: a.child_name,
      title: a.title, description: a.description,
      age_years: a.age_years, age_months: a.age_months,
      created_at: a.created_at, uploaded_at: a.uploaded_at,
      position_x: a.position_x, position_y: a.position_y, scale: a.scale,
      rotation_y: a.rotation_y == null ? null : a.rotation_y,
      appearance_type: a.appearance_type, depth: a.depth,
      shape: a.shape || null, metadata: a.metadata || null,
      files
    });
    if (onProgress) onProgress(i + 1, artworks.length);
  }

  entries.unshift({ name: 'kodomo-world.json', data: JSON.stringify(meta, null, 2) });
  entries.push({ name: 'README.txt', data: READ_ME });
  return window.KWZip.create(entries);
}

/* 読み込み: ZIP を解いて中身を取り出す（この時点では保存しない） */
async function readBackup(file){
  const list = await window.KWZip.read(file);
  const byName = new Map(list.map(e => [e.name, e.blob]));
  const metaBlob = byName.get('kodomo-world.json');
  if (!metaBlob) throw new Error('KODOMO WORLD のバックアップではないようです（kodomo-world.json が見つかりません）');
  let meta;
  try { meta = JSON.parse(await metaBlob.text()); }
  catch(e){ throw new Error('バックアップの情報を読めませんでした'); }
  if (meta.format !== 'kodomo-world-backup') throw new Error('KODOMO WORLD のバックアップではないようです');
  if (!(meta.version <= BACKUP_VERSION)) throw new Error('新しい形式のバックアップです。アプリを更新してください');

  const artworks = [];
  for (const m of (meta.artworks || [])){
    const pick = key => {
      const f = m.files && m.files[key];
      if (!f) return null;
      const b = byName.get(f.path);
      return b ? new Blob([b], { type: f.type || 'application/octet-stream' }) : null;
    };
    const original = pick('original'), display = pick('display'), cutout = pick('cutout');
    if (!original && !display) continue;            // 画像が無い作品は復元しない
    const a = Object.assign({}, m);
    delete a.files;
    a.original = original || display;
    a.display = display || original;
    a.cutout = cutout;
    artworks.push(a);
  }
  return { meta, artworks, children: meta.children || [] };
}

/* 取り込み: いまのデータへ反映する。既にあるidは触らない（replace時は先に全消し） */
async function applyBackup(parsed, opts){
  const replace = !!(opts && opts.replace);
  const res = { added: 0, skipped: 0, childrenAdded: 0 };

  if (replace){
    for (const a of artworks.slice()){ await idbDel(a.id); freeUrls(a.id); }
    artworks.length = 0;
    children.length = 0;
  }
  const haveArt = new Set(artworks.map(a => a.id));
  const haveKid = new Set(children.map(c => c.id));

  for (const c of parsed.children){
    if (haveKid.has(c.id)) continue;
    children.push(Object.assign({ birth_date: null, birth_year: null, created_at: new Date().toISOString() }, c));
    haveKid.add(c.id); res.childrenAdded++;
  }
  saveChildren(children);

  for (const a of parsed.artworks){
    if (haveArt.has(a.id)){ res.skipped++; continue; }
    // 作者が登録簿にいない場合は、作品に残っている名前で作り直す
    if (a.child_id && !childOf(a.child_id)){
      children.push({ id: a.child_id, display_name: a.child_name || '（未登録）',
                      birth_date: null, birth_year: null, created_at: new Date().toISOString() });
      saveChildren(children); res.childrenAdded++;
    }
    await idbPut(a);
    artworks.push(a);
    haveArt.add(a.id); res.added++;
  }
  artworks.sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''));
  return res;
}
