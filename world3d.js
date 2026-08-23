// KODOMO WORLD — 3Dサンドボックスの世界
// 作品が増えるほど島が広がり、木・池・雲・家が増えていく。
// 作品そのものは「切り抜きの立て看板」として島に立つ（appearance_type = original_image）。
import * as THREE from './lib/three.module.js';

const CHAR_H = 2.6;           // キャラクターの基準の高さ(世界単位)
const PLACE_R = 0.78;         // 島の半径のうち、キャラクターが立てる範囲
const IDLE_SPIN_MS = 7000;    // 操作をやめてから自動回転が始まるまで

/* ---------- 見た目のヘルパ ---------- */
const rngOf = seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

function skyTexture(){
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d').createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#8ec9f5'); g.addColorStop(.55, '#cfeaff'); g.addColorStop(1, '#eaf7ff');
  const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function labelTexture(text){
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.font = 'bold 54px -apple-system,"Hiragino Maru Gothic ProN",sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const w = Math.min(480, x.measureText(text).width + 56);
  x.fillStyle = 'rgba(255,255,255,.94)';
  x.beginPath(); x.roundRect((512 - w) / 2, 26, w, 76, 38); x.fill();
  x.strokeStyle = '#eadfd0'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#3b3128'; x.fillText(text, 256, 66, 460);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------- 島の装飾（増えるが並び替わらない） ---------- */
// 正規化座標で一度だけ作り、島の半径に合わせて配置し直す。
// こうすると作品が増えたとき「世界が広がる」ように見え、風景が作り直されない。
function buildProps(){
  const rnd = rngOf(20260823);
  const props = [];
  for (let i = 0; i < 72; i++){
    const a = rnd() * Math.PI * 2;
    const r = 0.42 + rnd() * 0.56;
    props.push({ a, r, kind: null, obj: null, scale: 0.8 + rnd() * 0.5, spin: rnd() * Math.PI * 2 });
  }
  // 種類は固定順に割り当てる（先頭ほど早く登場する）
  const order = ['tree','rock','tree','tree','flower','rock','tree','flower','tree','tree',
                 'rock','tree','flower','tree','tree','rock','tree','tree','flower','tree'];
  props.forEach((p, i) => { p.kind = order[i % order.length]; });
  return props;
}

function makeTree(){
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.13, .19, 1.1, 7),
    new THREE.MeshLambertMaterial({ color: 0xa9724a }));
  trunk.position.y = .55; g.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x5fb87a, flatShading: true });
  for (let i = 0; i < 3; i++){
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.95 - i * .22, 1.05, 8), leafMat);
    cone.position.y = 1.15 + i * .52; g.add(cone);
  }
  return g;
}
function makeRock(){
  return new THREE.Mesh(new THREE.IcosahedronGeometry(.42, 0),
    new THREE.MeshLambertMaterial({ color: 0xb9b2a8, flatShading: true }));
}
function makeFlower(){
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .5, 5),
    new THREE.MeshLambertMaterial({ color: 0x4aa06a }));
  stem.position.y = .25; g.add(stem);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 8, 6),
    new THREE.MeshLambertMaterial({ color: 0xffb4c8 }));
  head.position.y = .55; g.add(head);
  return g;
}
function makeHouse(){
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1, 1.2),
    new THREE.MeshLambertMaterial({ color: 0xfff6e6 }));
  body.position.y = .5; g.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.15, .8, 4),
    new THREE.MeshLambertMaterial({ color: 0xe58a5a, flatShading: true }));
  roof.position.y = 1.4; roof.rotation.y = Math.PI / 4; g.add(roof);
  return g;
}
function makeCloud(){
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .92 });
  [[0,0,0,1], [.9,-.15,.1,.72], [-.85,-.1,-.1,.66], [.2,.35,-.2,.6]].forEach(([x,y,z,s]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(s, 10, 8), m);
    b.position.set(x, y, z); g.add(b);
  });
  return g;
}

/* ---------- 作品を立体にする ---------- */
// modeler.js が返した輪郭(正規化座標)を押し出して、厚みのある立ち姿にする。
// 前後の面には作品の切り抜き画像、側面は紙の小口のような色を貼る。
function buildExtruded(contours, W, H, depth){
  const shapes = [];
  for (const poly of contours){
    if (!poly || poly.length < 3) continue;
    const sh = new THREE.Shape();
    poly.forEach(([x, y], i) => {
      const px = (x - .5) * W, py = (.5 - y) * H;   // 画像座標(yは下向き)を世界座標(yは上向き)へ
      i ? sh.lineTo(px, py) : sh.moveTo(px, py);
    });
    sh.closePath();
    shapes.push(sh);
  }
  if (!shapes.length) return null;
  // 前後の面のUVは、押し出し前の平面座標から画像座標へ戻すだけでよい
  const uv = {
    generateTopUV(geometry, vertices, a, b, c){
      const p = i => new THREE.Vector2(vertices[i * 3] / W + .5, vertices[i * 3 + 1] / H + .5);
      return [p(a), p(b), p(c)];
    },
    generateSideWallUV(){
      return [new THREE.Vector2(0,0), new THREE.Vector2(1,0), new THREE.Vector2(1,1), new THREE.Vector2(0,1)];
    }
  };
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth, bevelEnabled: false, curveSegments: 1, steps: 1, UVGenerator: uv
  });
  geo.translate(0, 0, -depth / 2);
  geo.computeBoundingBox();
  return geo;
}

/* ---------- 本体 ---------- */
function createWorld(container, hooks){
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdbeeff, 55, 210);

  const camera = new THREE.PerspectiveCamera(48, 1, .1, 400);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:grab';

  // 空
  const sky = new THREE.Mesh(new THREE.SphereGeometry(200, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, depthWrite: false, fog: false }));
  scene.add(sky);

  // 光
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fd08a, 1.05));
  const sun = new THREE.DirectionalLight(0xfff3d8, 1.15);
  sun.position.set(14, 22, 10); scene.add(sun);

  // 海
  const sea = new THREE.Mesh(new THREE.CircleGeometry(190, 48),
    new THREE.MeshLambertMaterial({ color: 0xa3daf5 }));
  sea.rotation.x = -Math.PI / 2; sea.position.y = -1.15; scene.add(sea);

  // 島（半径1で作り、スケールで広げる）
  const island = new THREE.Group();
  const grass = new THREE.Mesh(new THREE.CylinderGeometry(1, .93, .9, 64),
    new THREE.MeshLambertMaterial({ color: 0xa8dd8f }));
  grass.position.y = -.45; island.add(grass);
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(1.07, 1.0, .5, 64),
    new THREE.MeshLambertMaterial({ color: 0xf0e0b8 }));
  beach.position.y = -.72; island.add(beach);
  scene.add(island);

  // 池（3作品以上で出現）
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 28),
    new THREE.MeshLambertMaterial({ color: 0x6fbfe0 }));
  pond.rotation.x = -Math.PI / 2; pond.position.y = .012; pond.visible = false; scene.add(pond);

  // 装飾・雲・家
  const propRoot = new THREE.Group(); scene.add(propRoot);
  const props = buildProps();
  const cloudRoot = new THREE.Group(); scene.add(cloudRoot);
  const clouds = [];
  for (let i = 0; i < 7; i++){
    const c = makeCloud();
    c.scale.setScalar(1.2 + (i % 3) * .3);
    c.userData = { a: i / 7 * Math.PI * 2, r: 2.4 + (i % 3) * .5, ry: .9 + (i % 4) * .22, sp: .012 + i * .002 };
    c.visible = false; cloudRoot.add(c); clouds.push(c);
  }
  const houses = [];
  for (let i = 0; i < 5; i++){
    const h = makeHouse();
    h.userData = { a: (i + .5) / 5 * Math.PI * 2 + .4, r: .9 };
    h.visible = false; propRoot.add(h); houses.push(h);
  }

  // 選択中を示す輪
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, .075, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xff8a3d }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);

  const charRoot = new THREE.Group(); scene.add(charRoot);
  const chars = new Map();          // id -> {group, art, label, shadow, aspect, px, py, phase}
  const loader = new THREE.TextureLoader();

  let radius = 7, targetRadius = 7, tier = 0, firstSync = true;
  let selectedId = null;
  const cam = { theta: Math.PI * .25, phi: 1.16, dist: 18, target: new THREE.Vector3(0, 1.6, 0) };
  let lastInput = performance.now();

  /* ---------- キャラクター ---------- */
  function addChar(item){
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.62, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .16, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .02; g.add(shadow);

    const peg = new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .5, 8),
      new THREE.MeshLambertMaterial({ color: 0xb08356 }));
    peg.position.y = .25; g.add(peg);

    const board = new THREE.Group(); board.position.y = .5; g.add(board);
    // 作品の色は光でくすませない（原作品の色を正しく見せる）
    const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide }));
    art.position.z = .012; board.add(back); board.add(art);
    const model = new THREE.Group(); model.visible = false; g.add(model);

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(item.title || ''), transparent: true, depthWrite: false }));
    label.scale.set(2.2, .55, 1); g.add(label);

    const rec = { g, board, back, art, model, mesh: null, label, shadow, aspect: 1,
                  px: item.px, py: item.py, phase: Math.random() * Math.PI * 2,
                  title: item.title, scale: item.scale || 1,
                  shape: item.shape || null, depth: item.depth || .12, yaw: item.yaw, spin: 0 };
    art.userData.id = item.id; back.userData.id = item.id; rec.id = item.id;
    chars.set(item.id, rec);
    charRoot.add(g);

    loader.load(item.url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      art.material.map = tex; art.material.needsUpdate = true;
      rec.tex = tex;
      rec.aspect = (tex.image && tex.image.width && tex.image.height) ? tex.image.width / tex.image.height : 1;
      layoutChar(rec);
    });
    layoutChar(rec);
    return rec;
  }

  function layoutChar(rec){
    const h = CHAR_H * rec.scale;
    const w = h * rec.aspect;
    if (rec.shape && rec.tex) { buildModelFor(rec, w, h); return; }
    rec.model.visible = false; rec.board.visible = true;
    rec.art.scale.set(w, h, 1);
    rec.back.scale.set(w + .16, h + .16, 1);
    rec.board.position.y = .5 + h / 2;
    rec.label.position.y = .5 + h + .55;
    rec.shadow.scale.setScalar(Math.max(.7, w * .55));
  }

  function buildModelFor(rec, w, h){
    // 画像いっぱいに描かれているとは限らないので、シルエットの高さが板と揃うように拡大する
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (const poly of rec.shape) for (const [x, y] of poly){
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const fh = Math.max(.05, maxY - minY), fw = Math.max(.05, maxX - minX);
    const k = Math.min(1 / fh, 1.5 / (fw * (w / h)), 2.4);   // 横長の作品は幅で頭打ちにする
    const W = w * k, H = h * k;
    const geo = buildExtruded(rec.shape, W, H, Math.max(.04, rec.depth * h));
    if (!geo){ rec.shape = null; layoutChar(rec); return; }
    if (rec.mesh){ rec.model.remove(rec.mesh); rec.mesh.geometry.dispose(); }
    const face = new THREE.MeshBasicMaterial({ map: rec.tex, transparent: true, alphaTest: .35, side: THREE.DoubleSide });
    const edge = new THREE.MeshLambertMaterial({ color: 0xfff3e2 });
    rec.mesh = new THREE.Mesh(geo, [face, edge]);
    rec.mesh.userData.id = rec.id;
    rec.model.add(rec.mesh);
    rec.model.visible = true; rec.board.visible = false;
    // 実際のシルエットの底を地面に接地させる
    const bb = geo.boundingBox;
    rec.modelBottom = bb.min.y;
    rec.modelTop = bb.max.y;
    rec.model.position.y = .18 - bb.min.y;
    rec.label.position.y = .18 + (bb.max.y - bb.min.y) + .5;
    rec.shadow.scale.setScalar(Math.max(.7, (bb.max.x - bb.min.x) * .55));
  }

  function placeChar(rec){
    const nx = (rec.px - 50) / 50, nz = (rec.py - 50) / 50;
    const len = Math.hypot(nx, nz) || 1;
    const k = Math.min(1, PLACE_R / Math.max(len, PLACE_R)) * PLACE_R;
    rec.g.position.set(nx * radius * PLACE_R, 0, nz * radius * PLACE_R);
    void k;
  }

  /* ---------- 世界の広がり ---------- */
  const tierOf = n => n === 0 ? 0 : n < 3 ? 1 : n < 6 ? 2 : n < 10 ? 3 : n < 20 ? 4 : 5;
  const radiusOf = n => 7 + Math.sqrt(n) * 2.5;

  function applyTier(){
    // 木や石は作品数に応じて増える
    const shown = [0, 4, 9, 16, 26, 40][tier];
    props.forEach((p, i) => {
      if (i < shown && !p.obj){
        p.obj = p.kind === 'tree' ? makeTree() : p.kind === 'rock' ? makeRock() : makeFlower();
        p.obj.scale.setScalar(p.scale * (p.kind === 'rock' ? 1 : 1));
        p.obj.rotation.y = p.spin;
        propRoot.add(p.obj);
      }
      if (p.obj) p.obj.visible = i < shown;
    });
    pond.visible = tier >= 2;
    clouds.forEach((c, i) => { c.visible = i < [0, 2, 3, 4, 6, 7][tier]; });
    houses.forEach((h, i) => { h.visible = tier >= 4 && i < (tier === 4 ? 2 : 5); });
  }

  function layoutWorld(){
    island.scale.set(radius, 1, radius);
    sea.position.y = -1.15;
    props.forEach(p => {
      if (!p.obj) return;
      p.obj.position.set(Math.cos(p.a) * p.r * radius, 0, Math.sin(p.a) * p.r * radius);
    });
    houses.forEach(h => {
      const u = h.userData;
      h.position.set(Math.cos(u.a) * u.r * radius, 0, Math.sin(u.a) * u.r * radius);
      h.rotation.y = -u.a + Math.PI / 2;
    });
    pond.position.set(radius * .34, .012, -radius * .42);
    pond.scale.setScalar(Math.max(1.4, radius * .17));
    chars.forEach(placeChar);
  }

  /* ---------- 操作 ---------- */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  let mode = null, downAt = null, dragRec = null, moved = false;

  function toNdc(e){
    const r = renderer.domElement.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height * 2 - 1));
    return true;
  }
  function pick(e){
    if (!toNdc(e)) return null;
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(charRoot.children, true)[0];
    return hit ? (hit.object.userData.id || (hit.object.parent && hit.object.parent.userData.id)) : null;
  }
  function groundPoint(e){
    if (!toNdc(e)) return null;
    ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(groundPlane, p) ? p : null;
  }

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', e => {
    lastInput = performance.now();
    dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    downAt = { x: e.clientX, y: e.clientY, theta: cam.theta, phi: cam.phi };
    moved = false;
    const id = pick(e);
    if (id){ mode = 'char'; dragRec = chars.get(id); dragRec._id = id; dom.style.cursor = 'grabbing'; }
    else { mode = 'orbit'; dom.style.cursor = 'grabbing'; }
  });
  dom.addEventListener('pointermove', e => {
    if (!mode){
      dom.style.cursor = pick(e) ? 'pointer' : 'grab';
      return;
    }
    lastInput = performance.now();
    const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    moved = true;
    if (mode === 'orbit'){
      cam.theta = downAt.theta - dx * .006;
      cam.phi = Math.max(.22, Math.min(1.38, downAt.phi - dy * .005));
    } else if (dragRec){
      const p = groundPoint(e);
      if (p){
        const lim = radius * PLACE_R;
        const len = Math.hypot(p.x, p.z);
        const k = len > lim ? lim / len : 1;
        dragRec.g.position.set(p.x * k, 0, p.z * k);
        dragRec.px = 50 + dragRec.g.position.x / (radius * PLACE_R) * 50;
        dragRec.py = 50 + dragRec.g.position.z / (radius * PLACE_R) * 50;
      }
    }
  });
  function endPointer(e){
    if (!mode) return;
    lastInput = performance.now();
    const m = mode, rec = dragRec;
    mode = null; dragRec = null; dom.style.cursor = 'grab';
    if (m === 'char' && rec){
      if (!moved) hooks.onSelect && hooks.onSelect(rec._id);
      else hooks.onMove && hooks.onMove(rec._id, rec.px, rec.py);
    } else if (m === 'orbit' && !moved){
      hooks.onSelect && hooks.onSelect(null);
    }
    void e;
  }
  dom.addEventListener('pointerup', endPointer);
  dom.addEventListener('pointercancel', endPointer);
  dom.addEventListener('wheel', e => {
    e.preventDefault(); lastInput = performance.now();
    cam.dist = Math.max(radius * .55, Math.min(radius * 4.2, cam.dist * (1 + Math.sign(e.deltaY) * .12)));
  }, { passive: false });

  /* ---------- ループ ---------- */
  let raf = 0, t0 = performance.now();
  function frame(){
    raf = requestAnimationFrame(frame);
    const now = performance.now(), dt = Math.min(.05, (now - t0) / 1000); t0 = now;
    const t = now / 1000;

    if (Math.abs(targetRadius - radius) > .01){
      radius += (targetRadius - radius) * Math.min(1, dt * 1.8);
      layoutWorld();
    }
    if (now - lastInput > IDLE_SPIN_MS) cam.theta += dt * .045;

    cam.dist = Math.max(radius * .55, Math.min(radius * 4.2, cam.dist));
    cam.target.set(0, Math.min(2.4, radius * .18), 0);
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta),
      cam.target.y + cam.dist * Math.cos(cam.phi),
      cam.target.z + cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta));
    camera.lookAt(cam.target);

    chars.forEach((rec, id) => {
      const bob = Math.sin(t * 1.5 + rec.phase) * .09;
      if (rec.model.visible){
        // 立体は向きを持つ（既定は島の外を向く）。選ぶとゆっくり回って厚みが見える
        if (id === selectedId) rec.spin += dt * .55; else rec.spin *= .96;
        const base = (rec.yaw != null) ? rec.yaw
                   : Math.atan2(rec.g.position.x, rec.g.position.z);
        rec.g.rotation.y = base + rec.spin;
        rec.model.position.y = .18 - rec.modelBottom + bob;
        rec.label.position.y = .18 + (rec.modelTop - rec.modelBottom) + .5 + bob;
      } else {
        // 板の法線(+Z)をカメラへ向ける。カメラ方位をそのまま使うと真横を向いてしまう
        rec.g.rotation.y = Math.atan2(camera.position.x - rec.g.position.x,
                                      camera.position.z - rec.g.position.z);
        rec.board.position.y = .5 + (CHAR_H * rec.scale) / 2 + bob;
        rec.label.position.y = .5 + CHAR_H * rec.scale + .55 + bob;
      }
      rec.label.material.opacity = id === selectedId ? 1 : .85;
    });

    clouds.forEach(c => {
      const u = c.userData; u.a += dt * u.sp;
      c.position.set(Math.cos(u.a) * u.r * radius, 13 + u.ry * radius, Math.sin(u.a) * u.r * radius);
    });

    if (selectedId && chars.has(selectedId)){
      const rec = chars.get(selectedId);
      ring.visible = true;
      ring.position.set(rec.g.position.x, .05, rec.g.position.z);
      const s = Math.max(.8, rec.art.scale.x * .55) * (1 + Math.sin(t * 3) * .04);
      ring.scale.setScalar(s);
    } else ring.visible = false;

    renderer.render(scene, camera);
  }

  function resize(){
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  window.addEventListener('resize', resize);
  resize(); applyTier(); layoutWorld(); frame();

  /* ---------- 外向きAPI ---------- */
  return {
    sync(items){
      const ids = new Set(items.map(i => i.id));
      chars.forEach((rec, id) => {
        if (!ids.has(id)){
          charRoot.remove(rec.g);
          rec.art.material.map && rec.art.material.map.dispose();
          chars.delete(id);
        }
      });
      for (const it of items){
        const rec = chars.get(it.id);
        if (!rec){ addChar(it); continue; }
        rec.px = it.px; rec.py = it.py;
        const hadShape = !!rec.shape, hasShape = !!(it.shape && it.shape.length);
        if (hadShape !== hasShape || (hasShape && rec.shape !== it.shape)){
          rec.shape = hasShape ? it.shape : null;
          rec.depth = it.depth || rec.depth; rec.yaw = it.yaw;
          if (rec.tex) layoutChar(rec);
        }
        if (rec.title !== it.title){
          rec.title = it.title;
          rec.label.material.map.dispose();
          rec.label.material.map = labelTexture(it.title || '');
        }
      }
      const prevTier = tier;
      tier = tierOf(items.length);
      targetRadius = radiusOf(items.length);
      if (tier !== prevTier) applyTier();
      layoutWorld();
      // 作品が入った最初の同期で画角を決める。読み込み直後の空の同期で決めてしまうと
      // 島だけの大きさに合わせた寄りすぎのカメラのままになる
      if (firstSync && items.length){
        radius = targetRadius;                 // 起動直後に島が育つアニメは見せない
        cam.dist = targetRadius * 1.8;
        firstSync = false;
      } else if (cam.dist > targetRadius * 4.2 || cam.dist < targetRadius * .8){
        cam.dist = targetRadius * 2.1;
      }
      return { tier, prevTier, radius: targetRadius, count: items.length };
    },
    select(id){ selectedId = id; },
    focus(id){
      const rec = chars.get(id); if (!rec) return;
      cam.theta = Math.atan2(rec.g.position.z, rec.g.position.x) - .35;
      cam.dist = Math.max(12, Math.min(cam.dist, targetRadius * 1.9));
      lastInput = performance.now();
    },
    resize,
    // 開発用: キャラクターの立体化の状態を覗く
    inspect(){
      const out = [];
      chars.forEach((rec, id) => out.push({ id, title: rec.title, solid: rec.model.visible,
        pos: [Math.round(rec.g.position.x*10)/10, Math.round(rec.g.position.z*10)/10],
        size: rec.mesh ? [Math.round((rec.mesh.geometry.boundingBox.max.x-rec.mesh.geometry.boundingBox.min.x)*10)/10,
                          Math.round((rec.mesh.geometry.boundingBox.max.y-rec.mesh.geometry.boundingBox.min.y)*10)/10] : null,
        y: Math.round(rec.model.position.y*10)/10, hasTex: !!rec.tex, shape: rec.shape ? rec.shape.length : 0 }));
      return { radius: Math.round(radius*10)/10, chars: out };
    },
    dispose(){ cancelAnimationFrame(raf); renderer.dispose(); }
  };
}

/* ---------- 起動 ---------- */
const container = document.getElementById('world3d');
if (container){
  const api = createWorld(container, {
    onSelect: id => window.__kwOnWorldSelect && window.__kwOnWorldSelect(id),
    onMove: (id, px, py) => window.__kwOnWorldMove && window.__kwOnWorldMove(id, px, py)
  });
  window.KW3D = api;
  if (window.__kwWorldReady) window.__kwWorldReady(api);
}
