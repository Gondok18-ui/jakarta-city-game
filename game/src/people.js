// people.js — pedestrians, the player character, and police officers.
//
// One articulated figure builder serves everyone: box legs/arms on shoulder
// and hip pivots, a head with a variant on top (hijab, peci cap, ojol
// helmet, plain hair). Pedestrians walk their sidewalk beat and live a
// little: they flee gunfire, duck into ruko doorways and come back out,
// sit on benches for a while, walk in pairs, and cross at the zebra
// crossings — walking to the kerb, waiting while their road has the green,
// then jogging across on red. Downed pedestrians drop loot. Officers are
// pedestrians with a job: deployed by police.js, they run to shooting
// distance of the player, fire, and walk back to their car when stood down.

import * as THREE from 'three';
import {
  G, player, R, RI, clamp, angleDiff, collideCircle, addWanted, hurtPlayer,
} from './state.js';
import { DOORS, BENCHES, CROSS_Z, ZEBRA_OFF, tlState } from './world.js';
import { sfxShot } from './audio.js';

let sceneRef = null;

const SKIN = [0xf2c79b, 0xd9a066, 0xa9743f, 0x8a5a2e];
const SHIRTS = [0xc23b2e, 0x2b5ea7, 0x2e9e4f, 0xd9a441, 0xe8e8e8, 0x7a3b8f, 0xe2703a, 0x3f6b6e, 0xf2f2f2, 0x40506b];
const PANTS = [0x2c3038, 0x4a3b28, 0x35424e, 0x5c5348, 0x22262b];

const matCache = new Map();
function mat(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(color);
}

// Shared face texture: two eyes and a mouth on skin tone.
let faceTex = null;
function getFaceTex() {
  if (faceTex) return faceTex;
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8b98a'; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#22262b';
  ctx.fillRect(16, 26, 7, 9); ctx.fillRect(41, 26, 7, 9);
  ctx.fillRect(25, 48, 14, 3);
  faceTex = new THREE.CanvasTexture(c);
  return faceTex;
}

// Build a figure. Returns { group, legL, legR, armL, armR, torsoH }.
// opts: { shirt, pants, skin, head: 'hair'|'peci'|'hijab'|'helmet' }
export function buildFigure(opts = {}) {
  const shirt = opts.shirt ?? SHIRTS[RI(0, SHIRTS.length - 1)];
  const pants = opts.pants ?? PANTS[RI(0, PANTS.length - 1)];
  const skin = opts.skin ?? SKIN[RI(0, SKIN.length - 1)];
  const head = opts.head || 'hair';
  const group = new THREE.Group();
  const legGeo = new THREE.BoxGeometry(0.21, 0.78, 0.24);
  legGeo.translate(0, -0.39, 0);
  const legL = new THREE.Mesh(legGeo, mat(pants)); legL.position.set(-0.13, 0.8, 0);
  const legR = new THREE.Mesh(legGeo, mat(pants)); legR.position.set(0.13, 0.8, 0);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.66, 0.3), mat(shirt));
  torso.position.y = 1.13; torso.castShadow = true;
  const armGeo = new THREE.BoxGeometry(0.15, 0.62, 0.18);
  armGeo.translate(0, -0.26, 0);
  const armL = new THREE.Mesh(armGeo, mat(shirt)); armL.position.set(-0.36, 1.42, 0);
  const armR = new THREE.Mesh(armGeo, mat(shirt)); armR.position.set(0.36, 1.42, 0);
  const headM = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.42, 0.4),
    new THREE.MeshLambertMaterial({ map: getFaceTex() }));
  headM.position.y = 1.68;
  group.add(legL, legR, torso, armL, armR, headM);
  if (head === 'hair') {
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.12, 0.44), mat(0x1e1a16));
    hair.position.y = 1.93; group.add(hair);
  } else if (head === 'peci') {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.23, 0.16, 10), mat(0x14161a));
    cap.position.y = 1.95; group.add(cap);
  } else if (head === 'hijab') {
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.56, 0.48), mat(SHIRTS[RI(0, SHIRTS.length - 1)]));
    cloth.position.y = 1.7; group.add(cloth);
    headM.position.z = 0.06;
  } else if (head === 'helmet') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2e9e4f));
    helm.position.y = 1.82; group.add(helm);
    torso.material = mat(0x2e9e4f); // ojol jacket
  }
  return { group, legL, legR, armL, armR };
}

// ---------- spawning ----------

export function spawnPedAt(x, z, opts = {}) {
  const roll = Math.random();
  const head = opts.head || (roll < 0.20 ? 'hijab' : roll < 0.32 ? 'peci' : roll < 0.43 ? 'helmet' : 'hair');
  const fig = buildFigure({ ...opts, head });
  fig.group.position.set(x, 0, z);
  sceneRef.add(fig.group);
  const ped = {
    ...fig, x, z, heading: R(0, Math.PI * 2),
    speed: R(1.1, 1.8), phase: R(0, 6),
    axis: opts.axis || (Math.abs(x) > 15 && Math.abs(x) < 26 ? 'z' : 'x'),
    dir: Math.random() < 0.5 ? 1 : -1,
    min: opts.min ?? -505, max: opts.max ?? 545,
    state: 'walk', stateT: 0,
    homeX: x, homeZ: z, door: null, bench: null, partner: null,
    car: null, hp: 2, fireT: 0, kind: opts.kind || 'civilian',
    crossT: 0,
  };
  G.peds.push(ped);
  return ped;
}
G.hooks.spawnPedAt = spawnPedAt;

export function spawnPeds(scene) {
  sceneRef = scene;
  // Avenue sidewalks.
  for (const s of [-1, 1]) for (let i = 0; i < 11; i++) {
    const x = s * (Math.random() < 0.5 ? 20.2 : 23.4);
    spawnPedAt(x, R(-500, 540), { axis: 'z', min: -505, max: 545 });
  }
  // Cross-street sidewalks.
  for (const cz of [-300, 200]) for (let i = 0; i < 4; i++)
    spawnPedAt(R(-140, 140), cz + (Math.random() < 0.5 ? -14.5 : 14.5), { axis: 'x', min: -150, max: 150 });
  // Monas park wanderers.
  for (let i = 0; i < 4; i++) {
    const alongZ = Math.random() < 0.5;
    spawnPedAt(R(-60, 60), -665 + R(-60, 60), alongZ
      ? { axis: 'z', min: -725, max: -605 }
      : { axis: 'x', min: -60, max: 60 });
  }
  // District sidewalks.
  for (let i = 0; i < 6; i++)
    spawnPedAt(R(-140, 140), R(-460, 460), { axis: 'x', min: -150, max: 150 });
  // Six walking pairs: a follower shadows its partner beside-behind.
  for (let i = 0; i < 6; i++) {
    const x = (Math.random() < 0.5 ? -1 : 1) * 20.2;
    const leader = spawnPedAt(x, R(-420, 420), { axis: 'z', min: -505, max: 545 });
    const follower = spawnPedAt(x + 0.8, leader.z - leader.dir * 1.1, { axis: 'z', min: -505, max: 545 });
    follower.partner = leader; follower.dir = leader.dir; follower.speed = leader.speed;
  }
}

// ---------- the player figure ----------

export function buildPlayerFigure(scene) {
  const fig = buildFigure({ shirt: 0x2b5ea7, pants: 0x2c3038, head: 'hair' });
  player.group = fig.group;
  player.armL = fig.armL; player.armR = fig.armR;
  player.legL = fig.legL; player.legR = fig.legR;
  scene.add(fig.group);
}

// ---------- loot pickups ----------

const pickupGeos = {
  money: new THREE.BoxGeometry(0.34, 0.09, 0.22),
  ammo: new THREE.BoxGeometry(0.3, 0.3, 0.3),
};
const pickupMats = {
  money: new THREE.MeshBasicMaterial({ color: 0x37d67a }),
  ammo: new THREE.MeshBasicMaterial({ color: 0xff9a2e }),
};

export function dropLoot(x, z, officer = false) {
  const roll = Math.random();
  let type = null;
  if (officer) { if (roll < 0.55) type = 'ammo'; else if (roll < 0.8) type = 'money'; }
  else { if (roll < 0.35) type = 'money'; else if (roll < 0.5) type = 'ammo'; }
  if (!type || G.pickups.length > 24) return;
  const mesh = new THREE.Mesh(pickupGeos[type], pickupMats[type]);
  mesh.position.set(x, 0.55, z);
  sceneRef.add(mesh);
  G.pickups.push({
    type, mesh, x, z, ph: R(0, 6), life: 40,
    amt: type === 'money' ? RI(5000, 25000) : RI(6, 18),
  });
}
G.hooks.dropLoot = dropLoot;

export function updatePickups(dt) {
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const p = G.pickups[i];
    p.life -= dt;
    p.mesh.position.y = 0.55 + Math.sin(G.time * 3 + p.ph) * 0.12;
    p.mesh.rotation.y += dt * 2;
    let take = false;
    if (!player.car && !player.dead && Math.hypot(player.x - p.x, player.z - p.z) < 1.3) take = true;
    if (take) {
      if (G.hooks.collectPickup) G.hooks.collectPickup(p);
      sceneRef.remove(p.mesh);
      G.pickups.splice(i, 1);
    } else if (p.life <= 0) {
      sceneRef.remove(p.mesh);
      G.pickups.splice(i, 1);
    }
  }
}

// ---------- downing pedestrians ----------

export function downPed(p, loot = false) {
  if (p.state === 'down' || p.state === 'gone') return;
  if (p.kind === 'officer') {
    p.hp -= 1;
    if (p.hp > 0) { p.stateT = 0.3; return; }
    if (p.car) p.car.officer = null;
  }
  p.state = 'down';
  p.stateT = 8;
  p.group.rotation.x = -Math.PI / 2;
  p.group.position.y = 0.25;
  if (loot) dropLoot(p.x, p.z, p.kind === 'officer');
}
G.hooks.downPed = downPed;

// ---------- officers ----------

export function spawnOfficer(car) {
  const side = car.kind === 'policebike' ? 1.15 : 1.7;
  const ox = car.x + Math.cos(car.heading) * side;
  const oz = car.z - Math.sin(car.heading) * side;
  const p = spawnPedAt(ox, oz, { head: 'peci', shirt: 0x1d2733, pants: 0x14181d, kind: 'officer' });
  p.state = 'officer';
  p.car = car;
  car.officer = p;
  return p;
}

function officerShoot(p, d) {
  sfxShot('pistol');
  const from = new THREE.Vector3(p.x, 1.45, p.z);
  const to = new THREE.Vector3(player.x, 1.1, player.z);
  if (G.hooks.tracer) G.hooks.tracer(from, to);
  const chance = Math.max(0.16, 0.52 - d * 0.014);
  if (Math.random() < chance) hurtPlayer(player.car ? 3.5 : 5);
}

function updateOfficer(p, dt) {
  const d = Math.hypot(player.x - p.x, player.z - p.z);
  if (G.wanted <= 0 || player.dead) {
    // Stand down: walk back to the car and despawn into it.
    if (!p.car) { p.state = 'walk'; return; }
    const dd = Math.hypot(p.car.x - p.x, p.car.z - p.z);
    if (dd < 2.2) {
      p.state = 'gone';
      p.car.officer = null;
      sceneRef.remove(p.group);
      return;
    }
    movePed(p, p.car.x, p.car.z, 3.2, dt);
    return;
  }
  p.heading = Math.atan2(player.x - p.x, player.z - p.z);
  p.group.rotation.y = p.heading;
  if (d > 15) {
    movePed(p, player.x, player.z, 5.3, dt);
    p.armR.rotation.x = -0.4;
  } else {
    p.armR.rotation.x = -1.42;
    animateFigure(p, 0, dt);
    p.fireT -= dt;
    if (p.fireT <= 0) { p.fireT = R(0.75, 1.15); officerShoot(p, d); }
  }
  // Standing close to a slow on-foot player helps the bust along.
  if (!player.car && d < 3.2 && player.speedNow < 3 && G.hooks.bustPush)
    G.hooks.bustPush(dt * 0.9);
}

// ---------- pedestrian movement + animation ----------

function movePed(p, tx, tz, speed, dt) {
  const dx = tx - p.x, dz = tz - p.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return d;
  p.heading = Math.atan2(dx, dz);
  p.x += Math.sin(p.heading) * Math.min(speed * dt, d);
  p.z += Math.cos(p.heading) * Math.min(speed * dt, d);
  const c = collideCircle(p.x, p.z, 0.35);
  p.x = c.x; p.z = c.z;
  p.group.position.set(p.x, 0, p.z);
  p.group.rotation.y = p.heading;
  animateFigure(p, speed, dt);
  return d;
}

function animateFigure(p, speed, dt) {
  p.phase += dt * (speed > 0.2 ? speed * 2.6 : 0);
  const sw = speed > 0.2 ? Math.sin(p.phase) * 0.55 : 0;
  p.legL.rotation.x = sw;
  p.legR.rotation.x = -sw;
  if (p.state !== 'officer') { p.armL.rotation.x = -sw * 0.7; if (p.state !== 'sit') p.armR.rotation.x = sw * 0.7; }
  p.group.position.y = speed > 0.2 ? Math.abs(Math.sin(p.phase)) * 0.05 : 0;
}

function sitOnBench(p, bench) {
  p.state = 'sit';
  p.stateT = R(14, 40);
  p.bench = bench;
  p.x = bench.x; p.z = bench.z;
  p.heading = bench.ry + Math.PI / 2;
  p.group.position.set(p.x, 0, p.z);
  p.group.rotation.y = p.heading;
  p.group.position.y = -0.32;              // seated height
  p.legL.rotation.x = -1.5; p.legR.rotation.x = -1.5;  // legs bent
  p.armL.rotation.x = -0.3; p.armR.rotation.x = -0.3;
}

function standUp(p) {
  p.state = 'walk';
  p.group.position.y = 0;
  p.legL.rotation.x = 0; p.legR.rotation.x = 0;
  p.x += Math.sin(p.heading) * 0.8;
  p.z += Math.cos(p.heading) * 0.8;
}

// ---------- zebra crossing behaviour ----------

// A ped on an avenue sidewalk near a lit intersection sometimes decides to
// cross: walk to the kerb point, wait while the avenue light is green or
// yellow (their road is busy), then cross on red, hurrying if it turns.
function maybeStartCrossing(p, dt) {
  if (p.axis !== 'z' || Math.abs(p.x) > 25) return false;
  for (const cz of CROSS_Z) for (const off of [-ZEBRA_OFF, ZEBRA_OFF]) {
    if (Math.abs(p.z - (cz + off)) < 3.2 && Math.random() < dt * 0.25) {
      p.state = 'toKerb';
      p.crossZ = cz + off;
      p.crossSide = p.x > 0 ? 1 : -1;
      return true;
    }
  }
  return false;
}

function updateCrossing(p, dt) {
  const kerbX = p.crossSide * 19.5;
  if (p.state === 'toKerb') {
    if (movePed(p, kerbX, p.crossZ, p.speed, dt) < 0.4) { p.state = 'waitCross'; p.stateT = 0; }
    return;
  }
  if (p.state === 'waitCross') {
    p.group.rotation.y = p.crossSide > 0 ? -Math.PI / 2 : Math.PI / 2;
    animateFigure(p, 0, dt);
    if (tlState('avenue') === 'red') { p.state = 'crossing'; }
    return;
  }
  if (p.state === 'crossing') {
    const targetX = -p.crossSide * 19.5;
    const hurry = tlState('avenue') !== 'red';
    const d = movePed(p, targetX, p.crossZ, hurry ? 4.4 : 3.1, dt);
    if (d < 0.4) {
      p.state = 'walk';
      p.x = targetX;
      p.axis = 'z';
      p.min = -505; p.max = 545;
    }
  }
}

// ---------- main pedestrian update ----------

export function updatePeds(dt, shotsFired) {
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p.state === 'gone') { sceneRef.remove(p.group); G.peds.splice(i, 1); continue; }
    p.stateT -= dt;
    if (p.state === 'officer') { updateOfficer(p, dt); continue; }
    if (p.state === 'down') {
      if (p.stateT <= 0) {
        if (p.kind === 'officer') { // downed officers are taken away
          if (p.car) p.car.officer = null;
          p.state = 'gone';
          sceneRef.remove(p.group);
          continue;
        }
        // Civilians get back up at home after a while.
        p.group.rotation.x = 0; p.group.position.y = 0;
        p.x = p.homeX; p.z = p.homeZ;
        p.group.position.set(p.x, 0, p.z);
        p.state = 'walk';
      }
      continue;
    }
    if (p.state === 'sit') {
      if (p.stateT <= 0) standUp(p);
      continue;
    }
    if (p.state === 'wait' || p.state === 'riding' || p.state === 'inside') {
      if (p.state === 'inside' && p.stateT <= 0) {
        p.state = 'exitDoor';
        p.group.visible = true;
        p.x = p.door.x; p.z = p.door.z;
        p.group.position.set(p.x, 0, p.z);
      }
      continue;
    }
    if (p.state === 'enter') continue; // missions.js walks the passenger in
    if (p.state === 'toKerb' || p.state === 'waitCross' || p.state === 'crossing') { updateCrossing(p, dt); continue; }
    if (p.state === 'enterDoor') {
      if (movePed(p, p.door.x, p.door.z, 1.7, dt) < 0.45) {
        p.state = 'inside'; p.stateT = R(18, 50); p.group.visible = false;
      }
      continue;
    }
    if (p.state === 'exitDoor') {
      const tx = Math.sign(p.door.x) * 21.5;
      if (movePed(p, tx, p.door.z, 1.7, dt) < 0.45) p.state = 'walk';
      continue;
    }
    // Flee gunfire.
    if (shotsFired && p.state !== 'flee') {
      const d = Math.hypot(player.x - p.x, player.z - p.z);
      if (d < 26) { p.state = 'flee'; p.stateT = 2.6; p.heading = Math.atan2(p.x - player.x, p.z - player.z); }
    }
    if (p.state === 'flee') {
      p.x += Math.sin(p.heading) * 4.6 * dt;
      p.z += Math.cos(p.heading) * 4.6 * dt;
      const c = collideCircle(p.x, p.z, 0.35);
      p.x = c.x; p.z = c.z;
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.y = p.heading;
      animateFigure(p, 4.6, dt);
      if (p.stateT <= 0) p.state = 'walk';
      continue;
    }
    // Pair follower: stay beside-behind the partner.
    if (p.partner && p.partner.state === 'walk') {
      const L = p.partner;
      const tx = L.x - Math.sin(L.heading) * 1.1 + Math.cos(L.heading) * 0.75;
      const tz = L.z - Math.cos(L.heading) * 1.1 - Math.sin(L.heading) * 0.75;
      const d = Math.hypot(tx - p.x, tz - p.z);
      if (d > 0.3) movePed(p, tx, tz, Math.min(3.4, L.speed + d * 1.4), dt);
      else { p.heading = L.heading; p.group.rotation.y = p.heading; animateFigure(p, L.speed, dt); }
      continue;
    }
    if (p.partner && p.partner.state !== 'walk') p.partner = null;
    // Crossing decision.
    if (maybeStartCrossing(p, dt)) continue;
    // Door visits.
    if (p.axis === 'z' && Math.abs(p.x) > 19 && Math.random() < dt * 0.03) {
      const door = DOORS.find(d => Math.sign(d.x) === Math.sign(p.x) && Math.abs(d.z - p.z) < 2.2);
      if (door) { p.state = 'enterDoor'; p.door = door; continue; }
    }
    // Bench sitting.
    if (Math.random() < dt * 0.008) {
      const b = BENCHES.find(bn => Math.hypot(bn.x - p.x, bn.z - p.z) < 1.6);
      if (b) { sitOnBench(p, b); continue; }
    }
    // Plain walking along the beat.
    if (p.axis === 'z') {
      p.z += p.dir * p.speed * dt;
      if (p.z > p.max) { p.z = p.max; p.dir = -1; }
      if (p.z < p.min) { p.z = p.min; p.dir = 1; }
      p.heading = p.dir > 0 ? 0 : Math.PI;
    } else {
      p.x += p.dir * p.speed * dt;
      if (p.x > p.max) { p.x = p.max; p.dir = -1; }
      if (p.x < p.min) { p.x = p.min; p.dir = 1; }
      p.heading = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    const c = collideCircle(p.x, p.z, 0.35);
    p.x = c.x; p.z = c.z;
    p.group.position.set(p.x, 0, p.z);
    p.group.rotation.y = p.heading;
    animateFigure(p, p.speed, dt);
  }
}
