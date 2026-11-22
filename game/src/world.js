// world.js — the city of Jakarta City: geometry, textures, landmarks.
//
// Static scenery is baked into one merged vertex-coloured mesh (buildings'
// solid parts, monuments, stalls, lamps, benches) to keep draw calls low.
// Towers wear one of ten canvas facade materials whose emissive mask lights
// the windows at night. Roads are textured planes: the avenue tile carries
// the red TransJakarta busway median. This module also owns the traffic
// light cycle and the zebra crossings, and exports the named places the
// rest of the game reasons about (police station, hospital, workshop...).

import * as THREE from 'three';
import { G, R, RI, addCollider } from './state.js';

export const MONAS = { x: 0, z: -665 };
export const POLICE_STATION = { x: -42, z: -120 };   // west avenue frontage
export const HOSPITAL = { x: 44, z: 300 };           // east avenue frontage
export const BUSTED_SPAWN = { x: -27, z: -120 };     // sidewalk in front of the station
export const WASTED_SPAWN = { x: 28, z: 300 };       // sidewalk in front of the hospital
export const WORKSHOP = { x: 70, z: 120 };
export const FOOD_SPOTS = [
  { x: 23.8, z: -330 }, { x: -23.8, z: -95 }, { x: 23.8, z: 285 }, { x: -23.8, z: 480 },
];
export const DOORS = [];      // ruko doorways on the avenue: { x, z }
export const BENCHES = [];    // sidewalk benches peds can sit on: { x, z, ry }
export const CROSS_Z = [200, -300];            // intersections with lights + zebras
export const ZEBRA_OFF = 10.5;                 // avenue zebra offset from intersection centre
export const ZEBRA_X = 26.5;                   // cross-street zebra offset

// ---------- canvas textures ----------

function makeTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

function speckle(ctx, w, h, n, colors, aMax) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[RI(0, colors.length - 1)];
    ctx.globalAlpha = R(0.04, aMax);
    ctx.fillRect(R(0, w), R(0, h), R(1, 3), R(1, 3));
  }
  ctx.globalAlpha = 1;
}

const asphaltTex = () => makeTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#33373d'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 260, ['#2b2f34', '#3d4249', '#454b52'], 0.25);
}, [10, 10]);

// One avenue tile: 36 m wide, 24 m long. Red busway median in the middle,
// white edge lines, dashed lane lines.
const avenueTex = () => makeTex(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#33373d'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 420, ['#2b2f34', '#3d4249', '#454b52'], 0.22);
  ctx.fillStyle = '#8e2f26'; ctx.fillRect(w / 2 - 17, 0, 34, h);          // busway
  ctx.fillStyle = '#a83a2e'; ctx.fillRect(w / 2 - 14, 0, 28, h);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(4, 0, 3, h); ctx.fillRect(w - 7, 0, 3, h);                 // edges
  ctx.fillRect(w / 2 - 20, 0, 2, h); ctx.fillRect(w / 2 + 18, 0, 2, h);   // busway borders
  for (const fx of [0.22, 0.36, 0.64, 0.78])                              // lane dashes
    for (let y = 0; y < h; y += 42) ctx.fillRect(w * fx - 1, y, 2, 22);
});

const sidewalkTex = () => makeTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#9aa0a3'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 160, ['#878d90', '#aeb4b7'], 0.3);
  ctx.strokeStyle = '#7c8285'; ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, w, h);
  ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
}, [2, 40]);

const grassTex = () => makeTex(128, 128, (ctx, w, h) => {
  ctx.fillStyle = '#5d8a48'; ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, 500, ['#527c3e', '#6a9a54', '#4a7038'], 0.35);
}, [24, 24]);

// Ten facade styles. Each returns a diffuse map plus an emissive mask in
// which a random subset of windows glows warm — the mask is black by day
// (emissiveIntensity 0) and fades up at night.
const FACADE_STYLES = [
  { base: '#7d94b8', win: '#223349', cols: 6, rows: 12 },   // glass blue grid
  { base: '#d8c49a', win: '#4a3b28', cols: 5, rows: 10 },   // beige fins
  { base: '#e3e6e8', win: '#3c4650', cols: 7, rows: 11 },   // white bands
  { base: '#3f4a56', win: '#141c24', cols: 6, rows: 13 },   // dark glass
  { base: '#9a7a5c', win: '#3a2c1e', cols: 5, rows: 9 },    // brown stone
  { base: '#8f959a', win: '#2e3438', cols: 8, rows: 14 },   // grey dense
  { base: '#a8584a', win: '#38221e', cols: 5, rows: 10 },   // brick red
  { base: '#e8dcc2', win: '#57493a', cols: 6, rows: 9 },    // colonial cream
  { base: '#5f9ea6', win: '#1e383c', cols: 6, rows: 12 },   // teal glass
  { base: '#d9a7a0', win: '#4c3230', cols: 5, rows: 11 },   // pastel rose
];

function facadeTextures(def) {
  const map = makeTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = def.base; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = def.win;
    const cw = w / def.cols, ch = h / def.rows;
    for (let x = 0; x < def.cols; x++) for (let y = 0; y < def.rows; y++)
      ctx.fillRect(x * cw + cw * 0.22, y * ch + ch * 0.22, cw * 0.56, ch * 0.52);
  });
  const mask = makeTex(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    const cw = w / def.cols, ch = h / def.rows;
    for (let x = 0; x < def.cols; x++) for (let y = 0; y < def.rows; y++) {
      if (Math.random() < 0.42) {
        ctx.fillStyle = Math.random() < 0.8 ? '#ffb45e' : '#cfe4ff';
        ctx.fillRect(x * cw + cw * 0.22, y * ch + ch * 0.22, cw * 0.56, ch * 0.52);
      }
    }
  });
  return { map, mask };
}

function signTexture(text, bg, fg = '#ffffff') {
  return makeTex(256, 64, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
}

// Radial gradient used for lamp pools and headlight pools on the road.
export const poolTexture = makeTex(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.38)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
});

// ---------- merged static geometry (vertex colours) ----------

const chunks = [];
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s1 = new THREE.Vector3(1, 1, 1);

function pushGeo(geo, x, y, z, color, ry = 0, rx = 0, rz = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z);
  _m4.compose(_v, _q, _s1);
  g.applyMatrix4(_m4);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  chunks.push(g);
}
const pushBox = (x, y, z, w, h, d, color, ry = 0) => pushGeo(new THREE.BoxGeometry(w, h, d), x, y, z, color, ry);
const pushCyl = (x, y, z, rt, rb, h, seg, color) => pushGeo(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, color);

function mergeChunks() {
  let total = 0;
  for (const g of chunks) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  let o = 0, ou = 0;
  for (const g of chunks) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, ou);
    o += n; ou += n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------- shared world objects ----------

export const env = {
  facadeMats: [], lampGlow: null, lampPools: null,
  foodMarkers: [], tlHeads: [], skyMat: null,
};
export const lampGlowPts = [];

const TOWER_TINTS = [
  null, null, null, null, null, null,
  [0.92, 0.85, 0.72], [0.78, 0.85, 0.95], [0.95, 0.8, 0.78], [0.8, 0.9, 0.85],
];

function tower(x, z, w, h, d) {
  const style = RI(0, FACADE_STYLES.length - 1);
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const su = Math.max(1, Math.round(w / 9)), sv = Math.max(1, Math.round(h / 9));
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  const mesh = new THREE.Mesh(geo, env.facadeMats[style]);
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  const tint = TOWER_TINTS[RI(0, TOWER_TINTS.length - 1)];
  if (tint) {
    mesh.material = mesh.material.clone();
    mesh.material.color.setRGB(tint[0], tint[1], tint[2]);
    env.facadeMats.push(mesh.material); // clones must join the night-glow update too
  }
  addCollider(x, z, w, d);
  // Rooftop clutter.
  if (Math.random() < 0.55) pushCyl(x + R(-w / 4, w / 4), h + 1, z + R(-d / 4, d / 4), 1.4, 1.4, 2, 10, [0xd8dde2, 0x7aa2cc, 0xcc8a4a][RI(0, 2)]);
  if (Math.random() < 0.5) pushBox(x + R(-w / 4, w / 4), h + 0.7, z, 2.6, 1.4, 2.2, 0xb9bfc4);
  if (Math.random() < 0.35) pushCyl(x, h + 2.4, z, 0.09, 0.14, 4.8, 5, 0x555c62);
  return mesh;
}

function betawiHouse(x, z, ry, wall) {
  pushBox(x, 1.6, z, 7, 3.2, 6, wall, ry);
  pushGeo(new THREE.ConeGeometry(5.4, 2.6, 4), x, 4.5, z, 0xa0522d, ry + Math.PI / 4);
  pushBox(x, 1.1, z, 2.6, 2.2, 1.2, 0x6b4a2f, ry); // porch block
  addCollider(x, z, 7.4, 6.4);
}

function kampung(sideSign, zList) {
  const walls = [0xf2d5c4, 0xcfe8d8, 0xf7e6a2, 0xd6e4f0, 0xf5c6d6, 0xe8e0d0];
  for (const z of zList) for (const sx of [100, 117]) {
    const x = sideSign * sx + R(-1.5, 1.5);
    betawiHouse(x, z + R(-1, 1), R(-0.06, 0.06), walls[RI(0, walls.length - 1)]);
  }
}

function bench(x, z, ry) {
  pushBox(x, 0.55, z, 2.2, 0.12, 0.55, 0x8a6a44, ry);
  const bx = Math.sin(ry) * 0.26, bz = Math.cos(ry) * 0.26;
  pushBox(x - bx, 1.0, z - bz, 2.2, 0.5, 0.1, 0x8a6a44, ry);
  pushBox(x - 0.9, 0.27, z, 0.1, 0.55, 0.5, 0x3c4147, ry);
  pushBox(x + 0.9, 0.27, z, 0.1, 0.55, 0.5, 0x3c4147, ry);
  BENCHES.push({ x, z, ry });
}

function signPlane(text, w, h, bg, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: signTexture(text, bg), side: THREE.DoubleSide }));
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

// ---------- traffic lights ----------

// 32 s cycle. Avenue: green 0–11, yellow 11–13, red 13–32.
// Cross: red 0–14, green 14–27, yellow 27–29, red 29–32.
export function tlState(axis) {
  const p = G.time % 32;
  if (axis === 'avenue') return p < 11 ? 'green' : p < 13 ? 'yellow' : 'red';
  return p < 14 ? 'red' : p < 27 ? 'green' : p < 29 ? 'yellow' : 'red';
}

function trafficPole(scene, x, z, axis, faceRy) {
  pushCyl(x, 2.2, z, 0.09, 0.11, 4.4, 6, 0x2c3034);
  pushBox(x, 4.6, z, 0.5, 1.3, 0.34, 0x1e2124);
  const mats = [];
  const cols = [0xff3b30, 0xffcc00, 0x2eff7a];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), mat);
    lamp.position.set(x + Math.sin(faceRy) * 0.2, 5.05 - i * 0.42, z + Math.cos(faceRy) * 0.2);
    scene.add(lamp);
    mats.push({ mat, on: cols[i] });
  }
  env.tlHeads.push({ axis, mats });
}

// ---------- the build ----------

export function buildWorld(scene) {
  // Facade materials first (towers reference them).
  for (const def of FACADE_STYLES) {
    const { map, mask } = facadeTextures(def);
    env.facadeMats.push(new THREE.MeshLambertMaterial({
      map, emissive: 0xffc37a, emissiveMap: mask, emissiveIntensity: 0,
    }));
  }

  // Sky dome with a vertical gradient (shader-free: vertex colours).
  {
    const geo = new THREE.SphereGeometry(3200, 16, 10);
    const posA = geo.attributes.position, n = posA.count;
    const col = new Float32Array(n * 3);
    const top = new THREE.Color(0x3d6f9e), mid = new THREE.Color(0xcfe4f2), tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, posA.getY(i) / 3200);
      tmp.copy(mid).lerp(top, Math.pow(t, 0.6));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    env.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const sky = new THREE.Mesh(geo, env.skyMat);
    scene.add(sky);
  }

  // Ground base.
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(4400, 4400),
      new THREE.MeshLambertMaterial({ color: 0x77806c }));
    g.rotation.x = -Math.PI / 2; g.position.set(0, -0.08, 20);
    g.receiveShadow = true;
    scene.add(g);
  }

  const roadMat = new THREE.MeshLambertMaterial({ map: asphaltTex() });
  const aveMat = new THREE.MeshLambertMaterial({ map: avenueTex() });
  const walkMat = new THREE.MeshLambertMaterial({ map: sidewalkTex() });
  const grassMat = new THREE.MeshLambertMaterial({ map: grassTex() });
  const plane = (mat, w, d, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = ry;
    m.position.set(x, y, z); m.receiveShadow = true;
    scene.add(m); return m;
  };

  // Avenue (Thamrin + Sudirman) and its sidewalks.
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(36, 1096), aveMat);
    m.rotation.x = -Math.PI / 2; m.position.set(0, 0, 18);
    m.material.map.repeat.set(1, 46); m.receiveShadow = true;
    scene.add(m);
    for (const s of [-1, 1]) {
      const wgeo = new THREE.BoxGeometry(7, 0.12, 1096);
      const wm = new THREE.Mesh(wgeo, walkMat);
      wm.position.set(s * 21.5, 0.06, 18); wm.receiveShadow = true;
      scene.add(wm);
    }
  }
  // Cross streets + side streets.
  for (const cz of [-522, -300, 200, 430, 566]) plane(roadMat, 520, 24, 0, 0.005, cz);
  for (const sx of [-232, -150, -64, 64, 150, 232]) plane(roadMat, 12, 1096, sx, 0.004, 18);

  // Bundaran HI roundabout: ring, island, fountain, Selamat Datang monument.
  {
    const ring = new THREE.Mesh(new THREE.CircleGeometry(38, 40), roadMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.015, 0); ring.receiveShadow = true;
    scene.add(ring);
    pushCyl(0, 0.25, 0, 19.5, 19.5, 0.5, 32, 0x9aa0a3);
    pushCyl(0, 0.55, 0, 13, 13.6, 0.35, 24, 0x8b9296);
    pushCyl(0, 1.0, 0, 10.5, 10.5, 0.6, 24, 0x4a90c2);           // fountain water
    pushCyl(0, 1.6, 0, 1.1, 1.6, 1.6, 10, 0xb9bfc4);
    pushBox(0, 4.6, 0, 2.6, 4.4, 2.6, 0xcacfd4);                  // monument figures base
    pushBox(0, 8.2, 0, 1.1, 3.4, 1.1, 0xd8dde2);
    pushBox(-0.9, 9.6, 0, 0.5, 2.4, 0.5, 0xd8dde2);
    pushBox(0.9, 9.4, 0, 0.5, 2.1, 0.5, 0xd8dde2);
    addCollider(0, 0, 20, 20);
  }

  // Monas park + monument.
  {
    plane(grassMat, 300, 300, 0, 0.01, MONAS.z);
    pushBox(0, 0.1, MONAS.z, 10, 0.2, 300, 0xb9b0a0);
    pushBox(0, 0.1, MONAS.z, 300, 0.2, 10, 0xb9b0a0);
    pushBox(0, 1.5, MONAS.z, 44, 3, 44, 0xb5b9bd);
    pushBox(0, 4, MONAS.z, 30, 2, 30, 0xc2c7cb);
    pushGeo(new THREE.CylinderGeometry(2.2, 5.2, 96, 4), 0, 53, MONAS.z, 0xd4d8dc, Math.PI / 4);
    pushGeo(new THREE.ConeGeometry(3.4, 7, 10), 0, 104, MONAS.z, 0xd9a441);
    pushCyl(0, 99, MONAS.z, 4.6, 4.6, 1.6, 12, 0xb9bfc4);
    addCollider(0, MONAS.z, 46, 46);
  }

  // Towers along the avenue + filler districts + skyline ring.
  const towers = [];
  for (let z = -510; z < 560; z += R(38, 54)) {
    if (Math.abs(z) < 52) continue;
    for (const s of [-1, 1]) {
      if (Math.random() < 0.14) continue;
      if (s < 0 && z > -140 && z < -100) continue; // police station plot
      if (s > 0 && z > 278 && z < 322) continue;   // hospital plot
      const w = R(20, 30), d = R(18, 28);
      const h = z < 0 ? R(42, 92) : R(58, 128);
      towers.push(tower(s * (33 + w / 2 + R(0, 5)), z + R(-4, 4), w, h, d));
    }
  }
  for (let i = 0; i < 46; i++) {
    const s = Math.random() < 0.5 ? -1 : 1;
    const x = s * R(168, 292), z = R(-560, 620);
    if (s === 1 && x < 215 && Math.abs(z + 170) < 40) continue; // keep the mosque plot clear
    towers.push(tower(x, z, R(22, 38), R(28, 66), R(20, 34)));
  }
  for (const t of towers) scene.add(t);
  for (let i = 0; i < 78; i++) {
    const a = (i / 78) * Math.PI * 2 + R(-0.03, 0.03);
    const r = R(880, 1550), h = R(60, 240), w = R(40, 90);
    pushBox(Math.cos(a) * r, h / 2, 20 + Math.sin(a) * r, w, h, w, 0x39434f);
  }

  // Ruko (shophouse) rows along the avenue, with signs and doors.
  {
    const signs = [
      ['WARTEG BAHARI', '#c23b2e'], ['SATE PADANG', '#8a5a1e'], ['BAKSO MANG UDIN', '#2e7d4f'],
      ['FOTOKOPI JAYA', '#2b5ea7'], ['WARUNG KOPI', '#6d4c2f'], ['TOKO KELONTONG', '#7a3b8f'],
      ['MIE GORENG SPESIAL', '#c2691e'], ['BARBERSHOP', '#333f4d'],
    ];
    let si = 0;
    for (const s of [-1, 1]) for (let z = -498; z < 452; z += 13.5) {
      if (Math.abs(z) < 58) continue;
      if (s < 0 && Math.abs(z + 120) < 17) continue; // police station forecourt
      if (s > 0 && Math.abs(z - 300) < 19) continue; // hospital forecourt
      if ([-522, -300, 200, 430].some(cz => Math.abs(z - cz) < 19)) continue;
      if (Math.random() < 0.16) continue;
      const x = s * 29.5;
      const wall = [0xe8dcc2, 0xdfe8ee, 0xf2ddc8, 0xd8e6d0, 0xeee3ee][RI(0, 4)];
      pushBox(x, 3.5, z, 10.8, 7, 11.5, wall);
      pushBox(x, 7.35, z, 11.4, 0.7, 12.1, 0x9a4a38);
      pushBox(x - s * 5.2, 1.5, z, 0.3, 3, 3.4, 0x2c2620); // doorway
      const [txt, bg] = signs[si++ % signs.length];
      scene.add(signPlane(txt, 8.4, 1.9, bg, x - s * 5.45, 5.6, z, s > 0 ? -Math.PI / 2 : Math.PI / 2));
      DOORS.push({ x: s * 24.6, z });
      addCollider(x, z, 10.8, 11.5);
    }
  }

  // Kampung clusters (rows of small pastel houses).
  kampung(1, [-468, -456, -444, -432, -420]);
  kampung(-1, [248, 260, 272, 284, 296]);
  kampung(1, [148, 160, 172, 184]);
  kampung(-1, [-160, -148, -136, -124]);
  kampung(1, [392, 404, 416, 428]);
  // Scattered Betawi houses.
  for (const [x, z] of [[104, -408], [-104, 66], [196, -60], [-196, -320], [88, 520], [-88, -520]])
    betawiHouse(x, z, R(-0.2, 0.2), [0xf2d5c4, 0xcfe8d8, 0xf7e6a2][RI(0, 2)]);

  // Grand Mosque.
  {
    const x = 185, z = -170;
    pushBox(x, 4.5, z, 26, 9, 20, 0xf0e8d8);
    pushBox(x, 0.5, z, 27, 1, 21, 0xd9a441);
    pushBox(x, 9.4, z, 27, 0.8, 21, 0x2e7d4f);
    pushGeo(new THREE.SphereGeometry(7.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), x, 9.8, z, 0x2e7d4f);
    pushCyl(x, 18.6, z, 0.18, 0.3, 3.4, 6, 0xd9a441);
    for (const [cx, cz] of [[-11, -8], [11, -8], [-11, 8], [11, 8]])
      pushGeo(new THREE.SphereGeometry(2.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x + cx, 9.8, z + cz, 0x2e7d4f);
    pushCyl(164, 15, -150, 1.1, 1.9, 30, 8, 0xe8e0d0);           // minaret
    pushCyl(164, 24, -150, 2.2, 2.2, 1.2, 8, 0x2e7d4f);
    pushGeo(new THREE.ConeGeometry(2.4, 4.4, 8), 164, 32.4, -150, 0x2e7d4f);
    scene.add(signPlane('GRAND MOSQUE', 11, 2.2, '#1d5c38', x - 13.2, 6.4, z, -Math.PI / 2));
    addCollider(x, z, 27, 21); addCollider(164, -150, 3.4, 3.4);
  }

  // Market.
  {
    pushBox(128, 2.6, -28, 48, 5.2, 56, 0xcfc4ae);
    pushBox(128, 5.6, -28, 50, 0.8, 58, 0x8a4a3a);
    const roofCols = [0xc23b2e, 0x2e7d4f, 0x2b5ea7, 0xc2691e];
    for (let i = 0; i < 12; i++) {
      const sx = 112 + (i % 4) * 11, sz = -48 + Math.floor(i / 4) * 18;
      pushBox(sx, 1.3, sz, 4.4, 2.6, 4, 0xd8cfbc);
      pushBox(sx, 2.9, sz, 5, 0.3, 4.6, roofCols[i % 4]);
    }
    addCollider(128, -28, 49, 57);
  }

  // Elementary school + flag pole.
  {
    pushBox(-128, 3.4, 96, 30, 6.8, 14, 0xf2e3c2);
    pushBox(-128, 7.1, 96, 31, 0.6, 15, 0xa03a30);
    pushCyl(-112, 6, 108, 0.07, 0.09, 12, 5, 0xb9bfc4);
    pushBox(-110.8, 11, 108, 2.4, 1.4, 0.06, 0xc23b2e);
    scene.add(signPlane('ELEMENTARY SCHOOL', 13, 2, '#7a4a1e', -128, 5.4, 88.8, Math.PI));
    addCollider(-128, 96, 31, 15);
  }

  // City Hall.
  {
    pushBox(122, 6, -548, 34, 12, 18, 0xe3e6e8);
    pushBox(122, 12.6, -548, 35, 1.2, 19, 0x8b9296);
    for (let i = 0; i < 5; i++) pushCyl(108, 5, -556 + i * 4, 0.5, 0.5, 10, 8, 0xf4f6f8);
    scene.add(signPlane('CITY HALL', 12, 2.4, '#3c4650', 104.8, 8, -548, -Math.PI / 2));
    addCollider(122, -548, 35, 19);
  }

  // Police Station — busted players respawn in front of it.
  {
    const { x, z } = POLICE_STATION;
    pushBox(x, 3.75, z, 18, 7.5, 12, 0xdde3ea);
    pushBox(x, 7.8, z, 18.6, 0.7, 12.6, 0x16305e);
    pushBox(x + 9.2, 1.6, z, 0.3, 3.2, 2.6, 0x22262b);   // door on the east (avenue) face
    pushBox(x + 12, 0.06, z, 9, 0.12, 10, 0xb9bfc4);     // yard apron east of the building
    scene.add(signPlane('POLICE STATION', 10, 2, '#16305e', x + 9.25, 5.6, z, Math.PI / 2));
    addCollider(x, z, 18.4, 12.4);
  }

  // Hospital — wasted players wake up in front of it.
  {
    const { x, z } = HOSPITAL;
    pushBox(x, 4.5, z, 20, 9, 14, 0xf4f6f8);
    pushBox(x - 10.2, 5.6, z, 0.3, 3.4, 1.1, 0xc22424);
    pushBox(x - 10.2, 5.6, z, 0.3, 1.1, 3.4, 0xc22424);
    pushBox(x - 10.2, 1.6, z, 0.3, 3.2, 2.6, 0x22262b);  // door on the west (avenue) face
    pushBox(x - 12, 0.06, z, 9, 0.12, 10, 0xb9bfc4);     // yard apron west of the building
    scene.add(signPlane('HOSPITAL', 9, 2, '#b01e1e', x - 10.25, 7.6, z, -Math.PI / 2));
    addCollider(x, z, 20.4, 14.4);
  }

  // City Park: lawn, paths, pond, trees, benches.
  {
    const TX = -110, TZ = -10;
    plane(grassMat, 48, 48, TX, 0.03, TZ);
    pushBox(TX, 0.05, TZ, 48, 0.06, 3, 0xcfc4a8);
    pushBox(TX, 0.05, TZ, 3, 0.06, 48, 0xcfc4a8);
    pushCyl(TX + 13, 0.12, TZ - 12, 5.5, 5.5, 0.12, 18, 0x4a90c2);
    for (const [ox, oz] of [[-16, -16], [16, 14], [-18, 12], [6, -19], [-4, 18], [19, -4]]) {
      pushCyl(TX + ox, 1.1, TZ + oz, 0.22, 0.3, 2.2, 6, 0x6b4a2f);
      pushGeo(new THREE.ConeGeometry(2.3, 5, 8), TX + ox, 4.6, TZ + oz, 0x3e6b34);
      addCollider(TX + ox, TZ + oz, 0.8, 0.8);
    }
    bench(TX - 8, TZ + 3.4, 0); bench(TX + 10, TZ - 3.4, Math.PI);
    bench(TX + 3.4, TZ + 12, Math.PI / 2); bench(TX - 3.4, TZ - 14, -Math.PI / 2);
  }

  // Sidewalk benches along the avenue.
  for (let z = -470; z < 520; z += 62) {
    bench(20.6, z, -Math.PI / 2);
    bench(-20.6, z + 31, Math.PI / 2);
  }

  // Minimarkets.
  for (const [x, z] of [[72, -238], [-72, 262], [72, 352]]) {
    pushBox(x, 2.6, z, 14, 5.2, 10, 0xf0f2f4);
    pushBox(x, 5.5, z, 14.6, 0.6, 10.6, 0x2e9e4f);
    scene.add(signPlane('MINIMARKET', 9, 1.8, '#1d7a38', x - Math.sign(x) * 7.3, 4, z, x > 0 ? -Math.PI / 2 : Math.PI / 2));
    addCollider(x, z, 14.4, 10.4);
  }

  // Food stalls with floating green + markers.
  for (const s of FOOD_SPOTS) {
    pushBox(s.x, 1.1, s.z, 3.4, 2.2, 2.2, 0xd8cfbc);
    pushBox(s.x, 2.5, s.z, 3.9, 0.25, 2.7, 0x2e9e4f);
    const plus = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x2eff7a });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.2), mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.7), mat);
    plus.add(a, b); plus.position.set(s.x, 3.6, s.z);
    scene.add(plus); env.foodMarkers.push(plus);
  }

  // Workshop (Pay'n'Spray style) with orange pad.
  {
    pushBox(79, 3.4, WORKSHOP.z, 15, 6.8, 17, 0xd8dde2);
    pushBox(79, 7.1, WORKSHOP.z, 15.6, 0.6, 17.6, 0xc2691e);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(9, 11),
      new THREE.MeshBasicMaterial({ color: 0xff8c1a, transparent: true, opacity: 0.5 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(WORKSHOP.x, 0.04, WORKSHOP.z);
    scene.add(pad);
    scene.add(signPlane('WORKSHOP', 9, 1.9, '#8a4a12', 71.3, 5.2, WORKSHOP.z, -Math.PI / 2));
    addCollider(79, WORKSHOP.z, 15.4, 17.4);
  }

  // Semanggi flyover (deck across the avenue at z=430) + stadium silhouette.
  {
    pushBox(0, 9.6, 430, 240, 1.2, 14, 0x9aa0a3);
    pushBox(0, 10.5, 430 - 7.2, 240, 0.7, 0.4, 0xb9bfc4);
    pushBox(0, 10.5, 430 + 7.2, 240, 0.7, 0.4, 0xb9bfc4);
    for (let x = -105; x <= 105; x += 30) {
      if (Math.abs(x) < 22) continue;
      pushCyl(x, 4.5, 430, 1.1, 1.3, 9, 8, 0x8b9296);
      addCollider(x, 430, 2.4, 2.4);
    }
    pushCyl(105, 11, 660, 46, 50, 22, 20, 0xb9bfc4);
    pushCyl(105, 23.5, 660, 50, 46, 3, 20, 0x8b9296);
    addCollider(105, 660, 92, 92);
  }

  // Palms + street lamps along the avenue.
  for (let z = -520; z < 560; z += 27) {
    for (const s of [-1, 1]) {
      if (Math.random() < 0.25) continue;
      const x = s * 19.6;
      pushCyl(x, 2.6, z, 0.14, 0.22, 5.2, 6, 0x7a6248);
      pushGeo(new THREE.IcosahedronGeometry(1.9, 0), x, 5.6, z, 0x4a7d3a);
    }
  }
  for (let z = -515; z < 555; z += 35) {
    for (const s of [-1, 1]) {
      const x = s * 18.05;
      pushCyl(x, 3.4, z, 0.07, 0.1, 6.8, 5, 0x2c3034);
      pushBox(x - s * 0.7, 6.9, z, 1.6, 0.14, 0.3, 0x2c3034);
      lampGlowPts.push(x - s * 1.3, 7.1, z);
    }
  }
  // Lamp glow bulbs (one merged mesh, visible at night) + pools on the road.
  {
    const bulbGeo = [];
    for (let i = 0; i < lampGlowPts.length; i += 3)
      bulbGeo.push(new THREE.SphereGeometry(0.32, 6, 5).translate(lampGlowPts[i], lampGlowPts[i + 1], lampGlowPts[i + 2]));
    // merge spheres manually with the same concat trick
    let total = 0; for (const g of bulbGeo) total += (g.index ? g.toNonIndexed() : g).attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    let o = 0;
    for (const g0 of bulbGeo) {
      const g = g0.index ? g0.toNonIndexed() : g0;
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    env.lampGlow = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd9a0 }));
    env.lampGlow.visible = false;
    scene.add(env.lampGlow);

    const poolGeo = new THREE.PlaneGeometry(8.8, 8.8);
    const pools = [];
    for (let i = 0; i < lampGlowPts.length; i += 3) {
      const p = poolGeo.clone();
      p.rotateX(-Math.PI / 2);
      p.translate(lampGlowPts[i], 0.05, lampGlowPts[i + 2]);
      pools.push(p.index ? p.toNonIndexed() : p);
    }
    let tot2 = 0; for (const g of pools) tot2 += g.attributes.position.count;
    const pos2 = new Float32Array(tot2 * 3), nor2 = new Float32Array(tot2 * 3), uv2 = new Float32Array(tot2 * 2);
    let o2 = 0;
    for (const g of pools) {
      pos2.set(g.attributes.position.array, o2 * 3); nor2.set(g.attributes.normal.array, o2 * 3);
      if (g.attributes.uv) uv2.set(g.attributes.uv.array, o2 * 2);
      o2 += g.attributes.position.count;
    }
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    geo2.setAttribute('normal', new THREE.BufferAttribute(nor2, 3));
    geo2.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
    env.lampPools = new THREE.Mesh(geo2, new THREE.MeshBasicMaterial({
      map: poolTexture, color: 0xffc98a, transparent: true, opacity: 0.17,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    env.lampPools.visible = false;
    scene.add(env.lampPools);
  }

  // Zebra crossings: white stripe bands at both lit intersections.
  for (const cz of CROSS_Z) {
    for (const off of [-ZEBRA_OFF, ZEBRA_OFF])
      for (let x = -16; x <= 16; x += 2.1) pushBox(x, 0.03, cz + off, 1.2, 0.04, 4.4, 0xe8e8e8);
    for (const sx of [-ZEBRA_X, ZEBRA_X])
      for (let dz = -10; dz <= 10; dz += 2.1) pushBox(sx, 0.03, cz + dz, 4.4, 0.04, 1.2, 0xe8e8e8);
    // Traffic light poles: two serve the avenue, two the cross street.
    trafficPole(scene, -19.8, cz - 13.5, 'avenue', 0);
    trafficPole(scene, 19.8, cz + 13.5, 'avenue', Math.PI);
    trafficPole(scene, -26, cz + 13.5, 'cross', Math.PI / 2);
    trafficPole(scene, 26, cz - 13.5, 'cross', -Math.PI / 2);
  }

  // Bake all merged statics into one mesh.
  const merged = new THREE.Mesh(mergeChunks(),
    new THREE.MeshLambertMaterial({ vertexColors: true }));
  merged.castShadow = true; merged.receiveShadow = true;
  scene.add(merged);
  chunks.length = 0;
}

// Per-frame world cosmetics: traffic light heads, food markers bobbing,
// night glow switching. Called from the main loop.
export function updateWorldVisuals() {
  for (const head of env.tlHeads) {
    const st = tlState(head.axis);
    const active = st === 'red' ? 0 : st === 'yellow' ? 1 : 2;
    head.mats.forEach((m, i) => m.mat.color.setHex(i === active ? m.on : 0x232323));
  }
  const bob = Math.sin(G.time * 2.4) * 0.18;
  for (const m of env.foodMarkers) m.position.y = 3.6 + bob;
  if (env.lampGlow) env.lampGlow.visible = G.night;
  if (env.lampPools) env.lampPools.visible = G.night;
  const glow = (1 - G.dayFactor) * 0.95;
  for (const m of env.facadeMats) m.emissiveIntensity = glow;
}

// Zone names for the HUD, most specific first.
export function zoneName(x, z) {
  const d = (ax, az) => Math.hypot(x - ax, z - az);
  if (d(POLICE_STATION.x, POLICE_STATION.z) < 26) return 'Police Station';
  if (d(HOSPITAL.x, HOSPITAL.z) < 28) return 'Hospital';
  if (d(-110, -10) < 34) return 'City Park';
  if (d(185, -170) < 40) return 'Grand Mosque';
  if (d(128, -28) < 38) return 'Market District';
  if (d(-128, 96) < 36) return 'School District';
  if (d(MONAS.x, MONAS.z) < 170 || z < -560) return 'Monas District';
  if (d(0, 0) < 55) return 'Bundaran HI';
  if (Math.abs(x) > 60) return 'Central Jakarta';
  if (z > 380 && z < 480) return 'Semanggi';
  if (z >= 480) return 'Senayan';
  if (z < 0) return 'Jl. M.H. Thamrin';
  return 'Jl. Jenderal Sudirman';
}
