// weapons.js — the six weapon slots and all combat resolution.
//
// Slots: 1 Fists, 2 Machete, 3 Pistol, 4 SMG (Uzi), 5 Pump Shotgun,
// 6 Rifle. Guns resolve hits with an analytic raycast (segment vs ped/car
// cylinders, building AABBs and the ground plane) — no physics engine.
// Tracers are a pooled set of lines; impact sparks and explosion bursts
// share one pooled point cloud. Melee swings check a front arc. The Tab
// weapon wheel (DOM built here) slows time while it is open.

import * as THREE from 'three';
import { G, player, R, RI, clamp, angleDiff, colliders, addWanted, toast } from './state.js';
import { sfxShot, sfxMelee, sfxReload, sfxCash } from './audio.js';

export const WEAPONS = [
  { id: 'fist', name: 'Fists', dmg: 11, cd: 0.34, melee: true, reach: 1.7, mag: 0, reserve: 0, icon: '✊' },
  { id: 'machete', name: 'Machete', dmg: 17, cd: 0.42, melee: true, reach: 2.3, mag: 0, reserve: 0, icon: '🗡' },
  { id: 'pistol', name: 'Pistol', dmg: 14, cd: 0.17, range: 130, magSize: 12, magAmmo: 12, reserve: 240, spread: 0.004, auto: false, icon: '🔫' },
  { id: 'smg', name: 'SMG — Uzi', dmg: 6, cd: 0.07, range: 110, magSize: 30, magAmmo: 30, reserve: 300, spread: 0.016, auto: true, icon: '💥' },
  { id: 'shotgun', name: 'Pump Shotgun', dmg: 9, cd: 0.85, range: 55, magSize: 6, magAmmo: 6, reserve: 48, spread: 0.045, auto: false, pellets: 6, icon: '🎯' },
  { id: 'rifle', name: 'Rifle', dmg: 46, cd: 0.6, range: 280, magSize: 20, magAmmo: 20, reserve: 120, spread: 0.001, auto: false, icon: '🎯' },
];
export let wSlot = 2; // start on the pistol
export const W = () => WEAPONS[wSlot];

let cdT = 0, reloadT = 0, lastCrimeT = -9;
export let shotsFiredPulse = false; // read (and cleared) by main each frame for ped fleeing

// ---------- effects pools (tracers + sparks) ----------

let tracerPool = [], sparkPts = null, sparkData = null;

export function initEffects(scene) {
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < 24; i++) {
    const line = new THREE.Line(tGeo.clone(), new THREE.LineBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0.9 }));
    line.visible = false; line.frustumCulled = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  const N = 320;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -999;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  sparkPts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95 }));
  sparkPts.frustumCulled = false;
  scene.add(sparkPts);
  sparkData = { vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0, N };
}

export function tracer(from, to) {
  const t = tracerPool.find(t => t.life <= 0) || tracerPool[0];
  if (!t) return;
  const a = t.line.geometry.attributes.position.array;
  a[0] = from.x; a[1] = from.y; a[2] = from.z;
  a[3] = to.x; a[4] = to.y; a[5] = to.z;
  t.line.geometry.attributes.position.needsUpdate = true;
  t.line.visible = true;
  t.life = 0.06;
}
G.hooks.tracer = tracer;

export function burst(x, y, z, n, color = 0xffd28a) {
  if (!sparkData) return;
  const c = new THREE.Color(color);
  const pos = sparkPts.geometry.attributes.position.array;
  const col = sparkPts.geometry.attributes.color.array;
  for (let k = 0; k < n; k++) {
    const i = sparkData.next; sparkData.next = (sparkData.next + 1) % sparkData.N;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    sparkData.vel[i * 3] = R(-3.4, 3.4);
    sparkData.vel[i * 3 + 1] = R(0.5, 5);
    sparkData.vel[i * 3 + 2] = R(-3.4, 3.4);
    sparkData.life[i] = R(0.25, 0.6);
  }
  sparkPts.geometry.attributes.position.needsUpdate = true;
  sparkPts.geometry.attributes.color.needsUpdate = true;
}
G.hooks.burst = burst;

export function updateEffects(dt) {
  for (const t of tracerPool) {
    if (t.life > 0) { t.life -= dt; if (t.life <= 0) t.line.visible = false; }
  }
  if (!sparkData) return;
  const pos = sparkPts.geometry.attributes.position.array;
  let any = false;
  for (let i = 0; i < sparkData.N; i++) {
    if (sparkData.life[i] <= 0) continue;
    any = true;
    sparkData.life[i] -= dt;
    sparkData.vel[i * 3 + 1] -= 12 * dt;
    pos[i * 3] += sparkData.vel[i * 3] * dt;
    pos[i * 3 + 1] += sparkData.vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += sparkData.vel[i * 3 + 2] * dt;
    if (pos[i * 3 + 1] < 0.03) { pos[i * 3 + 1] = 0.03; sparkData.vel[i * 3 + 1] *= -0.4; }
    if (sparkData.life[i] <= 0) pos[i * 3 + 1] = -999;
  }
  if (any) sparkPts.geometry.attributes.position.needsUpdate = true;
}

// ---------- analytic raycast ----------

const _dir = new THREE.Vector3(), _org = new THREE.Vector3();

function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const lx = cx - ox, lz = cz - oz;
  const tca = lx * dx + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

export function rayHit(origin, dir, maxDist) {
  let best = { kind: 'none', dist: maxDist, point: origin.clone().addScaledVector(dir, maxDist) };
  const consider = (kind, obj, t, y0, y1) => {
    if (t < 0 || t > best.dist) return;
    const y = origin.y + dir.y * t;
    if (y < y0 || y > y1) return;
    best = { kind, obj, dist: t, point: origin.clone().addScaledVector(dir, t) };
  };
  // Ground plane.
  if (dir.y < -0.001) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < best.dist) best = { kind: 'ground', dist: t, point: origin.clone().addScaledVector(dir, t) };
  }
  // Buildings (colliders as tall boxes).
  for (const c of colliders) {
    let tmin = 0, tmax = best.dist;
    let ok = true;
    for (const [o, d, mn, mx] of [[origin.x, dir.x, c.x - c.hw, c.x + c.hw], [origin.z, dir.z, c.z - c.hd, c.z + c.hd]]) {
      if (Math.abs(d) < 1e-6) { if (o < mn || o > mx) { ok = false; break; } }
      else {
        let t1 = (mn - o) / d, t2 = (mx - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { ok = false; break; }
      }
    }
    if (ok && tmin > 0 && tmin < best.dist) {
      const y = origin.y + dir.y * tmin;
      if (y < 60) best = { kind: 'wall', dist: tmin, point: origin.clone().addScaledVector(dir, tmin) };
    }
  }
  // Cars as vertical cylinders.
  for (const car of G.cars) {
    if (car === player.car) continue;
    const r = car.kind === 'policebike' ? 0.9 : car.len / 2;
    const t = rayCircle(origin.x, origin.z, dir.x, dir.z, car.x, car.z, r);
    consider('car', car, t, 0, 2.4);
  }
  // People as thin cylinders.
  for (const p of G.peds) {
    if (p.state === 'down' || p.state === 'gone' || p.state === 'inside' || p.state === 'riding') continue;
    const t = rayCircle(origin.x, origin.z, dir.x, dir.z, p.x, p.z, 0.42);
    consider('ped', p, t, 0, 1.9);
  }
  return best;
}

// ---------- crimes (throttled so a shotgun blast is one crime) ----------

function crime(n, text) {
  if (G.time - lastCrimeT < 1.1) return;
  lastCrimeT = G.time;
  addWanted(n, text);
}

// ---------- firing & melee ----------

function aimDirection() {
  const cp = Math.cos(G.camPitch);
  _dir.set(Math.sin(G.camYaw) * cp, Math.sin(G.camPitch), Math.cos(G.camYaw) * cp);
  return _dir;
}

function fireGun() {
  const w = W();
  if (w.magAmmo <= 0) { startReload(); return; }
  w.magAmmo--;
  cdT = w.cd;
  player.aimT = 0.28;
  shotsFiredPulse = true;
  sfxShot(w.id);
  const origin = _org.set(player.x + Math.sin(G.camYaw) * 0.4, player.car ? 1.25 : 1.5, player.z + Math.cos(G.camYaw) * 0.4);
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const dir = aimDirection().clone();
    dir.x += R(-w.spread, w.spread); dir.y += R(-w.spread, w.spread); dir.z += R(-w.spread, w.spread);
    dir.normalize();
    const hit = rayHit(origin, dir, w.range);
    tracer(origin.clone(), hit.point);
    if (hit.kind === 'ped') {
      const p = hit.obj;
      if (p.kind === 'officer') { crime(2, 'Shot an officer'); if (G.hooks.downPed) G.hooks.downPed(p, true); }
      else { crime(1, 'Shot a pedestrian'); if (G.hooks.downPed) G.hooks.downPed(p, true); }
    } else if (hit.kind === 'car') {
      crime(1, hit.obj.kind.startsWith('police') ? 'Shot a police car' : 'Shot a vehicle');
      if (G.hooks.damageCar) G.hooks.damageCar(hit.obj, w.dmg);
      burst(hit.point.x, hit.point.y, hit.point.z, 4, 0xffc37a);
    } else if (hit.kind === 'wall' || hit.kind === 'ground') {
      burst(hit.point.x, hit.point.y, hit.point.z, 3, 0xcfd4d8);
    }
  }
  if (G.hooks.shake) G.hooks.shake(w.id === 'shotgun' ? 0.16 : 0.05);
}

function swingMelee() {
  const w = W();
  cdT = w.cd;
  player.swingT = 0.22;
  sfxMelee();
  const reach = w.reach || 2.3;
  let hitAny = false;
  for (const p of G.peds) {
    if (p.state === 'down' || p.state === 'gone' || p.state === 'inside' || p.state === 'riding') continue;
    const d = Math.hypot(p.x - player.x, p.z - player.z);
    if (d > reach) continue;
    const ang = Math.atan2(p.x - player.x, p.z - player.z);
    if (Math.abs(angleDiff(player.heading, ang)) > 0.85) continue;
    hitAny = true;
    if (p.kind === 'officer') { crime(2, 'Assaulted an officer'); if (G.hooks.downPed) G.hooks.downPed(p, true); }
    else { crime(1, w.id === 'fist' ? 'Punched a pedestrian' : 'Machete attack'); if (G.hooks.downPed) G.hooks.downPed(p, true); }
  }
  for (const car of G.cars) {
    if (car === player.car || car.mode === 'wreck') continue;
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    if (d < reach + car.len / 2) {
      hitAny = true;
      crime(1, 'Vandalism');
      if (G.hooks.damageCar) G.hooks.damageCar(car, 8);
      burst(car.x, 1, car.z, 3, 0xffc37a);
    }
  }
  return hitAny;
}

export function startReload() {
  const w = W();
  if (w.melee || reloadT > 0 || w.magAmmo >= w.magSize || w.reserve <= 0) return;
  reloadT = 1.1;
  sfxReload();
}

function finishReload() {
  const w = W();
  const take = Math.min(w.magSize - w.magAmmo, w.reserve);
  w.magAmmo += take; w.reserve -= take;
}

// ---------- hand weapon models + switching ----------

export function buildHandWeapon(id) {
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x22262b });
  const wood = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
  const steel = new THREE.MeshLambertMaterial({ color: 0x9aa2ab });
  const add = (geo, m, x, y, z, rx = 0) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.rotation.x = rx; g.add(mesh); return mesh; };
  if (id === 'machete') {
    add(new THREE.BoxGeometry(0.05, 0.5, 0.1), steel, 0, -0.35, 0.1, 0.5);
    add(new THREE.BoxGeometry(0.07, 0.16, 0.13), wood, 0, -0.08, 0.0);
  } else if (id === 'pistol') {
    add(new THREE.BoxGeometry(0.07, 0.16, 0.3), dark, 0, -0.12, 0.12);
    add(new THREE.BoxGeometry(0.06, 0.2, 0.08), dark, 0, -0.24, 0.02, 0.3);
  } else if (id === 'smg') {
    add(new THREE.BoxGeometry(0.08, 0.18, 0.5), dark, 0, -0.12, 0.2);
    add(new THREE.BoxGeometry(0.05, 0.3, 0.07), dark, 0, -0.3, 0.18);
    add(new THREE.BoxGeometry(0.05, 0.1, 0.22), steel, 0, -0.1, 0.52);
  } else if (id === 'shotgun') {
    add(new THREE.BoxGeometry(0.09, 0.14, 0.85), wood, 0, -0.12, 0.3);
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), steel, 0, -0.04, 0.32, Math.PI / 2);
  } else if (id === 'rifle') {
    add(new THREE.BoxGeometry(0.08, 0.16, 1.0), dark, 0, -0.12, 0.38);
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.5, 8), steel, 0, -0.05, 0.95, Math.PI / 2);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.05), dark, 0, 0.02, 0.3);
  }
  return g; // 'fist' returns an empty group: bare hands
}

export function switchWeapon(i) {
  if (i === wSlot || i < 0 || i >= WEAPONS.length) return;
  wSlot = i;
  reloadT = 0;
  if (player.handWeapon) { player.armR.remove(player.handWeapon); }
  player.handWeapon = buildHandWeapon(W().id);
  player.handWeapon.position.set(0, -0.55, 0.06);
  player.handWeapon.rotation.x = W().melee ? -0.5 : 0.25;
  player.armR.add(player.handWeapon);
  if (G.hooks.flashWeapon) G.hooks.flashWeapon(W().name);
}

export function initWeapons() {
  // Attach the starting weapon to the player's right arm.
  player.handWeapon = buildHandWeapon(W().id);
  player.handWeapon.position.set(0, -0.55, 0.06);
  player.handWeapon.rotation.x = 0.25;
  player.armR.add(player.handWeapon);
}

// ---------- weapon wheel ----------

export let wheelOpen = false;
export let wheelSel = 2;

export function buildWheel() {
  const el = document.getElementById('wwheel');
  if (!el) return;
  el.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const d = document.createElement('div');
    d.className = 'wslot' + (i === wheelSel ? ' sel' : '');
    d.innerHTML = `<div class="wic">${w.icon}</div><div>${w.name}</div><div class="wam">${w.melee ? '—' : w.magAmmo + ' / ' + w.reserve}</div>`;
    el.appendChild(d);
  });
}

export function setWheel(open) {
  wheelOpen = open;
  if (open) { wheelSel = wSlot; buildWheel(); }
  const el = document.getElementById('wwheel');
  if (el) el.style.display = open ? 'flex' : 'none';
}

export function wheelMove(dx) {
  if (Math.abs(dx) < 55) return false;
  wheelSel = (wheelSel + (dx > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length;
  buildWheel();
  return true;
}

// ---------- pickups ----------

G.hooks.collectPickup = (p) => {
  if (p.type === 'money') {
    player.money += p.amt;
    toast(`Picked up Rp ${p.amt.toLocaleString('en-US')}`);
  } else {
    const guns = WEAPONS.filter(w => !w.melee);
    const g = guns[RI(0, guns.length - 1)];
    g.reserve += p.amt;
    toast(`Ammo — ${g.name} +${p.amt}`);
  }
  sfxCash(0.4);
};

// ---------- save/restore ----------

export function weaponSaveState() {
  return {
    slot: wSlot,
    weapons: WEAPONS.map(w => ({ magAmmo: w.magAmmo ?? 0, reserve: w.reserve ?? 0 })),
  };
}

export function weaponLoadState(s) {
  if (!s) return;
  (s.weapons || []).forEach((sv, i) => {
    if (WEAPONS[i] && !WEAPONS[i].melee) {
      WEAPONS[i].magAmmo = sv.magAmmo;
      WEAPONS[i].reserve = sv.reserve;
    }
  });
  const target = clamp(s.slot ?? 2, 0, WEAPONS.length - 1);
  wSlot = 2;
  switchWeapon(target);
}

// ---------- per-frame ----------

export function updateWeapons(dt) {
  shotsFiredPulse = false;
  if (cdT > 0) cdT -= dt;
  if (reloadT > 0) { reloadT -= dt; if (reloadT <= 0) finishReload(); }
  if (player.aimT > 0) player.aimT -= dt;
  if (player.swingT > 0) player.swingT -= dt;
  // Arm pose: aim while shooting, swing while melee-ing, else relaxed.
  if (player.armR) {
    if (player.swingT > 0) {
      const t = 1 - player.swingT / 0.22;
      player.armR.rotation.x = -0.4 - Math.sin(t * Math.PI) * 1.7;
    } else if (player.aimT > 0 && !W().melee) player.armR.rotation.x = -1.42;
    else if (!player.car) player.armR.rotation.x = 0;
  }
  if (player.dead || player.car) return;
  const w = W();
  if (G.fireHeld && cdT <= 0 && reloadT <= 0) {
    if (w.melee) swingMelee();
    else if (w.auto || !G.fireLatched) fireGun();
    if (!w.melee && !w.auto) G.fireLatched = true;
  }
  if (!G.fireHeld) G.fireLatched = false;
}
