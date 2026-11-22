// vehicles.js — every car in Jakarta City: models, traffic, driving, damage.
//
// Each vehicle kind is one merged vertex-coloured geometry (body, cabin,
// wheels, plates, mirrors). A car object carries its mode:
//   'traffic'  — follows a left-hand loop around Bundaran HI
//   'line'     — drives a cross street back and forth
//   'parked'   — stealable, parked at the kerb
//   'player'   — the car the player is driving
//   'police' / 'roadblock' — driven by police.js
// Damage darkens the body; at zero health a car burns for 2.4 s (its driver
// flees) and then explodes, chaining into anything nearby, and stays as a
// blackened wreck. At night each car projects an elongated pool of light on
// the road ahead instead of a round cone.

import * as THREE from 'three';
import {
  G, player, R, RI, clamp, angleLerp, angleDiff, collideCircle,
  spawnPedAt, hurtPlayer, toast,
} from './state.js';
import { tlState, poolTexture } from './world.js';
import { sfxCrash, sfxExplosion, sfxHornLite } from './audio.js';

export const CAR_NAMES = {
  sedan: 'Sentra Sedan', hatch: 'Kecil Hatchback', mpv: 'Keluarga MPV', taxi: 'Taksi Biru',
  angkot: 'Angkot 07', bajaj: 'Bajaj', bus: 'TransJakarta Bus',
  police: 'Police Sedan', policesuv: 'Police SUV', policebike: 'Police Bike',
};

const PERF = {
  sedan: { top: 26, acc: 9, turn: 2.0 }, hatch: { top: 24, acc: 10, turn: 2.2 },
  mpv: { top: 23, acc: 8, turn: 1.8 }, taxi: { top: 26, acc: 9, turn: 2.0 },
  angkot: { top: 17, acc: 7, turn: 1.8 }, bajaj: { top: 14, acc: 8, turn: 2.6 },
  bus: { top: 19, acc: 5.5, turn: 1.2 },
  police: { top: 27, acc: 10, turn: 2.1 }, policesuv: { top: 29, acc: 11, turn: 1.7 },
  policebike: { top: 33, acc: 14, turn: 2.9 },
};
export const perfOf = (kind) => PERF[kind] || PERF.sedan;

const PAINTS = [0xc23b2e, 0x2b5ea7, 0xe8e8e8, 0x22262b, 0xd9a441, 0x2e9e4f, 0x8a8f96, 0x7a3b8f, 0xe2703a, 0xf2f2f2];

// ---------- merged geometry per kind ----------

const kindGeo = {};

function geoBuilder() {
  const chunks = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const push = (geo, x, y, z, color, ry = 0, rx = 0, rz = 0) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    e.set(rx, ry, rz); q.setFromEuler(e); v.set(x, y, z);
    m4.compose(v, q, one); g.applyMatrix4(m4);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3); const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    chunks.push(g);
  };
  return {
    box: (x, y, z, w, h, d, color, ry = 0) => push(new THREE.BoxGeometry(w, h, d), x, y, z, color, ry),
    cyl: (x, y, z, rt, rb, h, seg, color, rx = 0, rz = 0) => push(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, color, 0, rx, rz),
    wheel(x, y, z, r, w) { // cylinder rotated to axle across the car
      push(new THREE.CylinderGeometry(r, r, w, 10), x, y, z, 0x17191c, 0, 0, Math.PI / 2);
      push(new THREE.CylinderGeometry(r * 0.45, r * 0.45, w + 0.03, 8), x, y, z, 0xb9bfc4, 0, 0, Math.PI / 2);
    },
    build() {
      let total = 0; for (const g of chunks) total += g.attributes.position.count;
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let o = 0;
      for (const g of chunks) {
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        col.set(g.attributes.color.array, o * 3);
        o += g.attributes.position.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return geo;
    },
  };
}

function buildKindGeo(kind) {
  const b = geoBuilder();
  const paint = kind === 'taxi' ? 0x3a7bd5 : (kind.startsWith('police') ? 0xe8ecf0 : 0xffffff);
  const glass = 0x1c2836, trim = 0x22262b;
  const wheels4 = (w, l, r) => { b.wheel(-w / 2, r, l / 2 - r - 0.25, r, 0.24); b.wheel(w / 2, r, l / 2 - r - 0.25, r, 0.24); b.wheel(-w / 2, r, -l / 2 + r + 0.25, r, 0.24); b.wheel(w / 2, r, -l / 2 + r + 0.25, r, 0.24); };
  switch (kind) {
    case 'hatch':
      b.box(0, 0.62, 0, 1.7, 0.62, 3.4, paint); b.box(0, 1.2, -0.25, 1.56, 0.6, 1.9, glass);
      b.box(0, 0.35, 1.72, 1.5, 0.22, 0.08, 0xf4f6f8); wheels4(1.66, 3.4, 0.32); break;
    case 'mpv':
      b.box(0, 0.78, 0, 1.86, 0.95, 4.4, paint); b.box(0, 1.42, 0.1, 1.7, 0.5, 3.4, glass);
      b.box(0, 0.4, 2.22, 1.6, 0.24, 0.08, 0xf4f6f8); wheels4(1.8, 4.4, 0.36); break;
    case 'angkot':
      b.box(0, 0.85, 0, 1.8, 1.15, 4.2, 0x3f9e4d); b.box(0, 1.62, 0, 1.86, 0.42, 4.3, 0xe8e8e8);
      b.box(0, 1.15, 2.12, 1.5, 0.5, 0.06, 0xffd75e); b.box(0, 0.4, 2.12, 1.6, 0.24, 0.08, 0xf4f6f8);
      wheels4(1.76, 4.2, 0.34); break;
    case 'bajaj':
      b.box(0, 0.62, 0.2, 1.3, 0.7, 2.0, 0xe2703a); b.box(0, 1.2, -0.3, 1.24, 0.55, 1.3, 0x8a4a21);
      b.box(0, 1.05, 0.95, 1.1, 0.4, 0.5, glass);
      b.wheel(0, 0.3, 1.25, 0.3, 0.2); b.wheel(-0.62, 0.3, -0.8, 0.3, 0.18); b.wheel(0.62, 0.3, -0.8, 0.3, 0.18); break;
    case 'bus':
      b.box(0, 1.5, 0, 2.5, 2.4, 10.6, 0xd8542e); b.box(0, 2.1, 0, 2.54, 0.9, 9.6, glass);
      b.box(0, 2.95, 4.6, 1.9, 0.5, 0.1, 0xffd75e); b.box(0, 0.5, 5.32, 2.0, 0.3, 0.06, 0xf4f6f8);
      wheels4(2.4, 10.6, 0.5); break;
    case 'policesuv':
      b.box(0, 0.82, 0, 1.95, 0.95, 4.7, paint); b.box(0, 1.55, -0.1, 1.8, 0.55, 2.9, glass);
      b.box(0, 0.95, 0, 2.0, 0.4, 4.72, 0x16305e); b.box(0, 0.42, 2.37, 1.7, 0.26, 0.08, 0xf4f6f8);
      wheels4(1.9, 4.7, 0.4); break;
    case 'policebike':
      b.box(0, 0.55, 0, 0.42, 0.4, 2.0, 0x16305e); b.box(0, 0.85, 0.55, 0.36, 0.35, 0.5, glass);
      b.wheel(0, 0.34, 0.95, 0.34, 0.12); b.wheel(0, 0.34, -0.95, 0.34, 0.12); break;
    case 'police':
      b.box(0, 0.6, 0, 1.78, 0.6, 4.3, paint); b.box(0, 1.18, -0.15, 1.62, 0.56, 2.2, glass);
      b.box(0, 0.82, 0, 1.82, 0.34, 4.32, 0x16305e); b.box(0, 0.38, 2.17, 1.55, 0.24, 0.08, 0xf4f6f8);
      b.box(-0.95, 0.95, 1.15, 0.08, 0.3, 0.5, trim); b.box(0.95, 0.95, 1.15, 0.08, 0.3, 0.5, trim);
      wheels4(1.74, 4.3, 0.33); break;
    case 'taxi':
      b.box(0, 0.6, 0, 1.78, 0.6, 4.3, paint); b.box(0, 1.18, -0.15, 1.62, 0.56, 2.2, glass);
      b.box(0, 1.55, -0.15, 0.7, 0.18, 0.4, 0xffd75e); b.box(0, 0.38, 2.17, 1.55, 0.24, 0.08, 0xf4f6f8);
      wheels4(1.74, 4.3, 0.33); break;
    default: // sedan
      b.box(0, 0.6, 0, 1.78, 0.6, 4.3, paint); b.box(0, 1.18, -0.15, 1.62, 0.56, 2.2, glass);
      b.box(0, 0.38, 2.17, 1.55, 0.24, 0.08, 0xf4f6f8); b.box(0, 0.38, -2.17, 1.55, 0.24, 0.08, 0xf4f6f8);
      b.box(-0.95, 0.95, 1.15, 0.08, 0.3, 0.5, trim); b.box(0.95, 0.95, 1.15, 0.08, 0.3, 0.5, trim);
      wheels4(1.74, 4.3, 0.33);
  }
  return b.build();
}

const carBaseMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const poolMatProto = new THREE.MeshBasicMaterial({
  map: null, color: 0xffd9a0, transparent: true, opacity: 0.34,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

let sceneRef = null;

export function spawnCar(kind, x, z, heading, mode) {
  if (!kindGeo[kind]) kindGeo[kind] = buildKindGeo(kind);
  const mat = carBaseMat.clone();
  if (!kind.startsWith('police') && kind !== 'taxi' && kind !== 'angkot' && kind !== 'bus')
    mat.color.setHex(PAINTS[RI(0, PAINTS.length - 1)]);
  const mesh = new THREE.Mesh(kindGeo[kind], mat);
  mesh.castShadow = true;
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  sceneRef.add(mesh);
  const car = {
    kind, mesh, mat, x, z, heading, speed: 0,
    mode, health: 100, burning: false, fireT: 0, flameT: 0,
    loop: null, s: 0, lineRoute: null, officer: null,
    pool: null, lightBar: null, tilt: 0, hitT: -9, ramT: -9, baseColor: mat.color.clone(),
    len: kind === 'bus' ? 10.6 : kind === 'policebike' ? 2.1 : 4.4,
  };
  // Night light pool on the road ahead.
  const pl = kind === 'bus' ? 11 : kind === 'policebike' ? 4.5 : 8;
  const pw = kind === 'bus' ? 4.6 : kind === 'policebike' ? 1.7 : 3.6;
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(pw, pl),
    new THREE.MeshBasicMaterial({ map: poolTexture, color: 0xffd9a0, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.06, car.len / 2 + pl / 2 - 0.6);
  pool.visible = false;
  mesh.add(pool);
  car.pool = pool;
  // Police light bar.
  if (kind.startsWith('police')) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x2255ff }));
    red.position.x = -0.24; blue.position.x = 0.24;
    bar.add(red, blue);
    bar.position.set(0, kind === 'policesuv' ? 2.42 : kind === 'policebike' ? 1.35 : 2.06, kind === 'policebike' ? -0.7 : 0);
    mesh.add(bar);
    car.lightBar = bar;
  }
  G.cars.push(car);
  return car;
}

export function removeCar(car) {
  sceneRef.remove(car.mesh);
  const i = G.cars.indexOf(car);
  if (i >= 0) G.cars.splice(i, 1);
}

// ---------- traffic routes ----------

export function spawnTraffic(scene) {
  sceneRef = scene;
  const circuits = [
    { L: 4.95, R: 27, kinds: ['sedan', 'hatch', 'mpv', 'taxi', 'sedan', 'hatch', 'mpv', 'sedan', 'taxi'] },
    { L: 9.7, R: 29.5, kinds: ['sedan', 'mpv', 'hatch', 'sedan', 'taxi', 'hatch', 'sedan', 'mpv'] },
    { L: 3.4, R: 25, kinds: ['bus', 'bus'] },
  ];
  for (const C of circuits) {
    const path = buildCircuit(C.L, C.R);
    C.kinds.forEach((kind, i) => {
      const car = spawnCar(kind, 0, 0, 0, 'traffic');
      car.loop = { path, s: (i / C.kinds.length) * path.total };
      placeOnLoop(car);
    });
  }
  // Slow vehicles share the inner circuit.
  for (const [kind, sFrac] of [['angkot', 0.22], ['bajaj', 0.55], ['angkot', 0.8]]) {
    const car = spawnCar(kind, 0, 0, 0, 'traffic');
    car.loop = { path: buildCircuit(4.95, 27), s: 0 };
    car.loop.s = sFrac * car.loop.path.total;
    placeOnLoop(car);
  }
  // Cross-street line traffic at z=200 and z=-300.
  for (const cz of [200, -300]) {
    for (const [laneOff, dir] of [[-3.5, 1], [3.5, -1]]) {
      const car = spawnCar(['sedan', 'hatch', 'mpv', 'taxi'][RI(0, 3)], dir > 0 ? -240 : 240, cz + laneOff, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 'line');
      car.lineRoute = { z: cz + laneOff, dir, min: -245, max: 245 };
    }
  }
  // Parked stealable cars, nudged clear of building footprints.
  const spots = [
    [58, -180], [-58, -60], [26, 150], [-26, 330], [58, 420], [-58, -400], [26, -250], [-26, -470],
  ];
  for (const [sx, sz] of spots) {
    let z = sz;
    for (const dz of [0, 16, -16, 32, -32, 48]) {
      const p = collideCircle(sx, sz + dz, 2.6);
      if (Math.abs(p.x - sx) < 0.01 && Math.abs(p.z - (sz + dz)) < 0.01) { z = sz + dz; break; }
      z = sz + dz;
    }
    const car = spawnCar(['sedan', 'hatch', 'mpv', 'taxi'][RI(0, 3)], sx, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 'parked');
    car.speed = 0;
  }
}

// One closed traffic circuit: southbound down the east leg of the avenue,
// clockwise around the Bundaran HI ring, southbound again on the west leg,
// a U-turn at the far south end, then back north and around the ring the
// other way. Waypoints are dense on the arcs so steering stays smooth.
// Returns the points plus cumulative arc lengths for param lookup.
function buildCircuit(L, R) {
  const Rz = Math.sqrt(R * R - L * L);
  const pts = [];
  const P = (x, z) => pts.push({ x, z });
  P(L, -560); P(L, -Rz - 12);
  const a0 = Math.atan2(-Rz, L), a1 = Math.atan2(Rz, L);
  for (let i = 1; i < 8; i++) { const a = a0 + (a1 - a0) * (i / 8); P(Math.cos(a) * R, Math.sin(a) * R); }
  P(L, Rz + 12); P(L, 548);
  for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; P(Math.cos(a) * L, 560 + Math.sin(a) * L); }
  P(-L, Rz + 12);
  const b0 = Math.atan2(Rz, -L), b1 = Math.atan2(-Rz, -L) + Math.PI * 2;
  for (let i = 1; i < 10; i++) { const a = b0 + (b1 - b0) * (i / 10); P(Math.cos(a) * R, Math.sin(a) * R); }
  P(-L, -Rz - 12); P(-L, -548);
  for (let i = 1; i < 6; i++) { const a = (i / 6) * Math.PI; P(-Math.cos(a) * L, -560 - Math.sin(a) * L); }
  const cum = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return { pts, cum, total: cum[cum.length - 1] };
}

function loopPoint(path, s) {
  s = ((s % path.total) + path.total) % path.total;
  let i = 1;
  while (i < path.cum.length && path.cum[i] < s) i++;
  const i0 = (i - 1) % path.pts.length, i1 = i % path.pts.length;
  const segLen = path.cum[i] - path.cum[i - 1] || 1;
  const t = (s - path.cum[i - 1]) / segLen;
  const a = path.pts[i0], b = path.pts[i1];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, hx: b.x - a.x, hz: b.z - a.z };
}

function placeOnLoop(car) {
  const p = loopPoint(car.loop.path, car.loop.s);
  car.x = p.x; car.z = p.z;
  car.heading = Math.atan2(p.hx, p.hz);
  syncMesh(car);
}

export function syncMesh(car) {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  car.mesh.rotation.z = car.tilt || 0;
}

// ---------- generic car movement ----------

// Steer `car` toward a world point at up to `topSpeed`. Returns the speed
// after acceleration/braking. Shared by traffic, police and roadblocks.
export function driveToward(car, tx, tz, topSpeed, dt, stopDist = 0) {
  const perf = perfOf(car.kind);
  const dx = tx - car.x, dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  const want = Math.atan2(dx, dz);
  const dh = angleDiff(car.heading, want);
  car.heading += clamp(dh, -perf.turn * dt, perf.turn * dt);
  let target = topSpeed;
  if (Math.abs(dh) > 1.1) target = Math.min(target, 3.5);
  if (stopDist > 0 && dist < stopDist + 4) target = Math.min(target, Math.max(0, (dist - stopDist) * 0.8));
  if (car.speed < target) car.speed = Math.min(target, car.speed + perf.acc * dt);
  else car.speed = Math.max(target, car.speed - 22 * dt);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const p = collideCircle(car.x, car.z, car.kind === 'policebike' ? 0.8 : 1.6);
  car.x = p.x; car.z = p.z;
  syncMesh(car);
  return dist;
}

// ---------- damage, fire, explosions ----------

export function damageCar(car, dmg, silent = false) {
  if (car.mode === 'wreck' || car.burning) { car.health -= dmg; return; }
  car.health -= dmg;
  if (!silent && dmg >= 10) {
    car.tilt = (Math.random() < 0.5 ? -1 : 1) * 0.05;
    sfxCrash(dmg >= 30);
  }
  const f = clamp(car.health / 100, 0.22, 1);
  if (car.health < 55) car.mat.color.copy(car.baseColor).multiplyScalar(Math.max(0.45, f));
  if (car.health <= 0) startBurn(car);
}

function startBurn(car) {
  if (car.burning || car.mode === 'wreck') return;
  car.burning = true; car.fireT = 2.4; car.flameT = 0;
  car.mat.color.copy(car.baseColor).multiplyScalar(0.5);
  if (car === player.car) toast('Your car is on fire! Get out now!');
  // The driver bails out and runs.
  if ((car.mode === 'traffic' || car.mode === 'line') && Math.random() < 0.95) {
    const p = spawnPedAt(car.x + 1.8, car.z, {});
    if (p) { p.state = 'flee'; p.stateT = 3; p.heading = Math.atan2(1.8, 0) + R(-0.5, 0.5); }
  }
}

function explode(car) {
  car.burning = false;
  car.mode = 'wreck';
  car.speed = 0;
  car.mat.color.setHex(0x1c1c1e);
  if (car.pool) car.pool.visible = false;
  sfxExplosion();
  if (G.hooks.burst) G.hooks.burst(car.x, 1.2, car.z, 42, 0xff8c3a);
  if (G.hooks.burst) G.hooks.burst(car.x, 1.6, car.z, 20, 0x777777);
  if (G.hooks.shake) G.hooks.shake(0.5);
  const dP = Math.hypot(player.x - car.x, player.z - car.z);
  if (player.car === car) {
    if (G.hooks.forceExitCar) G.hooks.forceExitCar();
    hurtPlayer(48);
  } else if (!player.car && dP < 8.5) {
    hurtPlayer(Math.round(30 * (1 - dP / 9)));
    player.kx += (player.x - car.x) / (dP || 1) * 9;
    player.kz += (player.z - car.z) / (dP || 1) * 9;
    player.stunT = Math.max(player.stunT, 0.5);
  } else if (player.car && Math.hypot(player.car.x - car.x, player.car.z - car.z) < 8.5) {
    damageCar(player.car, 30, true);
  }
  for (const p of G.peds) {
    if ((p.state === 'walk' || p.state === 'flee' || p.state === 'officer') &&
        Math.hypot(p.x - car.x, p.z - car.z) < 7 && G.hooks.downPed) G.hooks.downPed(p, true);
  }
  for (const o of G.cars) {
    if (o !== car && o.mode !== 'wreck' && Math.hypot(o.x - car.x, o.z - car.z) < 5)
      damageCar(o, 55, true); // chain reaction
  }
}

G.hooks.damageCar = damageCar;

// ---------- per-frame vehicle updates ----------

function trafficTarget(car) {
  // Look ahead on the loop; slow for the car in front and for red lights.
  const look = 9 + car.speed * 0.55;
  const ahead = loopPoint(car.loop.path, car.loop.s + look);
  let target = perfOf(car.kind).top * 0.62;
  for (const o of G.cars) {
    if (o === car || o.mode === 'wreck') continue;
    const d = Math.hypot(o.x - car.x, o.z - car.z);
    if (d < 8.5 && Math.abs(angleDiff(car.heading, Math.atan2(o.x - car.x, o.z - car.z))) < 0.6) {
      target = Math.min(target, Math.max(0, (d - 5) * 1.2));
    }
  }
  // Stop lines at the two lit intersections (avenue approaches).
  for (const cz of [200, -300]) {
    const dz = cz - car.z;
    if (Math.abs(car.x) < 17 && Math.sign(dz) === Math.sign(Math.cos(car.heading)) && Math.abs(dz) < 15 && Math.abs(dz) > 6) {
      const st = tlState('avenue');
      if (st === 'red' || st === 'yellow') target = Math.min(target, Math.max(0, (Math.abs(dz) - 11.5) * 0.9));
    }
  }
  return { x: ahead.x, z: ahead.z, target };
}

export function updateVehicles(dt) {
  for (const car of G.cars) {
    if (car.tilt) { car.tilt *= Math.pow(0.001, dt); if (Math.abs(car.tilt) < 0.002) car.tilt = 0; }
    // Burning countdown -> explosion (visual flame bursts come from weapons' spark pool via hooks).
    if (car.burning) {
      car.flameT -= dt;
      if (car.flameT <= 0) { car.flameT = 0.09; if (G.hooks.burst) G.hooks.burst(car.x + R(-0.8, 0.8), 1.4, car.z + R(-0.8, 0.8), 3, 0xffa53a); }
      car.fireT -= dt;
      car.speed = Math.max(0, car.speed - 20 * dt);
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;
      syncMesh(car);
      if (car.fireT <= 0) explode(car);
      continue;
    }
    if (car.mode === 'traffic') {
      const t = trafficTarget(car);
      driveToward(car, t.x, t.z, Math.max(0.1, t.target), dt);
      car.loop.s += car.speed * dt;
      // Occasionally honk when stuck behind someone.
      if (car.speed < 0.4 && Math.random() < dt * 0.05) sfxHornLite();
    } else if (car.mode === 'line') {
      const rt = car.lineRoute;
      let target = perfOf(car.kind).top * 0.6;
      // Stop at red/yellow for the cross street.
      for (const cz of [200, -300]) {
        if (Math.abs(rt.z - cz) < 14) {
          const dx = (rt.dir > 0 ? -26.5 : 26.5) - car.x;
          if (Math.sign(dx) === rt.dir && Math.abs(dx) < 13) {
            const st = tlState('cross');
            if (st === 'red' || st === 'yellow') target = Math.min(target, Math.max(0, (Math.abs(dx) - 2) * 0.9));
          }
        }
      }
      for (const o of G.cars) {
        if (o === car || o.mode === 'wreck') continue;
        const d = Math.hypot(o.x - car.x, o.z - car.z);
        if (d < 8 && Math.abs(angleDiff(car.heading, Math.atan2(o.x - car.x, o.z - car.z))) < 0.6)
          target = Math.min(target, Math.max(0, (d - 5) * 1.2));
      }
      driveToward(car, car.x + rt.dir * 60, rt.z, Math.max(0.1, target), dt);
      if (car.x > rt.max) { car.x = rt.min; }
      if (car.x < rt.min) { car.x = rt.max; }
    }
    if (car.pool) car.pool.visible = G.night && car.mode !== 'wreck';
  }
  separateCars();
}

// Push overlapping traffic cars apart so they never interpenetrate.
// recompute their position from the loop each frame, so only their partner
// moves; parked and wrecked cars never move.
function separateCars() {
  const list = G.cars;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (a.mode === 'wreck' || b.mode === 'wreck' || a.mode === 'parked' || b.mode === 'parked') continue;
    if (a.mode === 'player' || b.mode === 'player') continue;
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01 && d < 3.1) {
      const push = (3.1 - d) / 2;
      const aMoves = a.mode !== 'traffic';
      const bMoves = b.mode !== 'traffic';
      if (aMoves) { a.x -= dx / d * push; a.z -= dz / d * push; syncMesh(a); }
      if (bMoves) { b.x += dx / d * push; b.z += dz / d * push; syncMesh(b); }
      if (!aMoves && !bMoves) { /* two loop cars: their spacing is parametric, leave them */ }
    }
  }
}
