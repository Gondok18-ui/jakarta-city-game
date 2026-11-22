// main.js — boot and the frame loop for Jakarta City.
//
// Wires every module together: renderer/scene/camera, input (keyboard,
// mouse with pointer lock, touch), the player on foot and in a car, the
// day/night cycle, death and respawn, save/continue, and the per-frame
// update order (weapons -> people -> vehicles -> police -> missions ->
// pickups -> world cosmetics -> HUD). window.__JC exposes debug hooks the
// screenshot rig drives; "?auto" in the URL starts the simulation at once.

import * as THREE from 'three';
import {
  G, player, clamp, lerp, angleLerp, angleDiff, collideCircle, toast,
} from './state.js';
import { buildWorld, updateWorldVisuals, FOOD_SPOTS, WORKSHOP, BUSTED_SPAWN, WASTED_SPAWN, env } from './world.js';
import { spawnTraffic, updateVehicles, perfOf, syncMesh, CAR_NAMES } from './vehicles.js';
import { spawnPeds, buildPlayerFigure, updatePeds, updatePickups } from './people.js';
import {
  WEAPONS, W, switchWeapon, initWeapons, initEffects, updateEffects, updateWeapons,
  startReload, shotsFiredPulse, setWheel, wheelMove, wheelSel, weaponSaveState, weaponLoadState,
} from './weapons.js';
import { updatePolice, addWanted, clearWanted, policeNearForAudio, policeCars } from './police.js';
import { initMissions, updateMissions, cancelMission, missionTarget } from './missions.js';
import { initHUD, updateHUD, setPrompt, showEndScreen, hideEndScreen } from './hud.js';
import { initAudio, toggleMute, updateAudio, sfxHorn, sfxCrash, sfxDoor, sfxSting } from './audio.js';

// ---------- renderer / scene / camera ----------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe4f2);
scene.fog = new THREE.Fog(0xcfe4f2, 260, 2100);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 7000);
camera.position.set(30, 8, -30);

const hemi = new THREE.HemisphereLight(0xbfd9ea, 0x54503e, 0.75);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 1.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.camera.far = 700;
sun.shadow.bias = -0.0006;
scene.add(sun); scene.add(sun.target);

// Real spotlight for the player's car at night.
const headSpot = new THREE.SpotLight(0xffe2b0, 0, 78, 0.46, 0.55, 1.1);
scene.add(headSpot); scene.add(headSpot.target);

buildWorld(scene);
spawnTraffic(scene);
spawnPeds(scene);
buildPlayerFigure(scene);
initEffects(scene);
initMissions(scene);
initHUD();
initWeapons();

player.group.position.set(player.x, 0, player.z);
G.camPitch = -0.1;

// ---------- hooks owned by main ----------

let camShake = 0;
G.hooks.shake = (v) => { camShake = Math.max(camShake, v); };

G.hooks.hurtPlayer = (dmg) => {
  if (player.dead || !G.started) return;
  const absorbed = Math.min(player.armor, dmg * 0.6);
  player.armor -= absorbed;
  player.health -= (dmg - absorbed);
  player.hurtT = G.time;
  if (player.health <= 0) { player.health = 0; die(false); }
};

let endKind = null; // 'busted' | 'wasted'
let endFine = 0;
function die(busted) {
  if (player.dead) return;
  player.dead = true;
  player.deadT = busted ? 2.8 : 3.2;
  endKind = busted ? 'busted' : 'wasted';
  endFine = busted ? Math.ceil(G.wanted) * 75000 : 0;
  if (player.car) exitCar(true);
  cancelMission(busted ? 'Mission cancelled — you were busted' : 'Mission cancelled — you were wasted');
  showEndScreen(busted, endFine);
  sfxSting(busted);
}
G.hooks.onBusted = () => die(true);

function respawn() {
  hideEndScreen();
  player.dead = false;
  player.health = 100; player.armor = 50;
  player.y = 0; player.vy = 0; player.kx = 0; player.kz = 0; player.stunT = 0;
  player.group.rotation.x = 0;
  player.group.position.y = 0;
  if (endKind === 'busted') {
    player.money = Math.max(0, player.money - endFine);
    player.x = BUSTED_SPAWN.x; player.z = BUSTED_SPAWN.z;
  } else {
    player.x = WASTED_SPAWN.x; player.z = WASTED_SPAWN.z;
  }
  player.heading = G.camYaw = player.x < 0 ? Math.PI / 2 : -Math.PI / 2;
  clearWanted();
  player.group.visible = true;
  player.group.position.set(player.x, 0, player.z);
}

G.hooks.forceExitCar = () => { if (player.car) exitCar(true); };

// ---------- entering / exiting cars, food, workshop ----------

function nearestCar() {
  let best = null, bd = 1e9;
  for (const car of G.cars) {
    if (car.mode === 'wreck' || car.burning || car.mode === 'police' || car.mode === 'roadblock') continue;
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    if (d < car.len / 2 + 1.7 && d < bd) { bd = d; best = car; }
  }
  return best;
}

function enterCar(car) {
  player.car = car;
  car.mode = 'player';
  car.speed = 0;
  player.group.visible = false;
  G.camYaw = car.heading;
  sfxDoor();
  if (car._wasMoving) addWanted(1, 'Vehicle theft');
  toast(CAR_NAMES[car.kind] || 'Vehicle');
}

function exitCar(silent = false) {
  const car = player.car;
  if (!car) return;
  player.car = null;
  if (car.mode === 'player') car.mode = 'parked';
  car.speed = 0;
  player.x = car.x + Math.cos(car.heading) * 1.8;
  player.z = car.z - Math.sin(car.heading) * 1.8;
  const p = collideCircle(player.x, player.z, 0.4);
  player.x = p.x; player.z = p.z;
  player.group.visible = true;
  player.group.position.set(player.x, 0, player.z);
  if (!silent) sfxDoor();
  syncMesh(car);
}

function tryInteract() {
  if (player.dead) return;
  if (player.car) { exitCar(); return; }
  const car = nearestCar();
  if (car) {
    car._wasMoving = car.mode === 'traffic' || car.mode === 'line';
    if (car.officer) car.officer = null;
    enterCar(car);
    return;
  }
  for (const s of FOOD_SPOTS) {
    if (Math.hypot(s.x - player.x, s.z - player.z) < 2.6) {
      if (player.health >= 100) { toast('You are already full'); return; }
      if (player.money < 15000) { toast('Not enough money — a meal costs Rp 15,000'); return; }
      player.money -= 15000;
      player.health = Math.min(100, player.health + 50);
      toast('Ate at a food stall — +50 HP');
      return;
    }
  }
}

function useWorkshop() {
  const car = player.car;
  if (!car) return false;
  if (Math.hypot(WORKSHOP.x - car.x, WORKSHOP.z - car.z) > 6.5) return false;
  if (player.money < 50000) { toast('Workshop service costs Rp 50,000'); return true; }
  if (car.health >= 100 && G.wanted <= 0 && !car.burning) { toast('Nothing to fix'); return true; }
  player.money -= 50000;
  car.health = 100; car.burning = false;
  car.mat.color.copy(car.baseColor);
  clearWanted();
  toast('Workshop: repaired, resprayed, heat cleared — Rp 50,000');
  return true;
}

// ---------- input ----------

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

let wheelAcc = 0;
window.addEventListener('keydown', (e) => {
  G.keys[e.code] = true;
  if (!G.started) return;
  if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) setWheel(true); }
  if (e.code === 'KeyF') tryInteract();
  if (e.code === 'KeyR') { if (!useWorkshop()) startReload(); }
  if (e.code === 'KeyH' && player.car) sfxHorn();
  if (e.code === 'KeyM') toast(toggleMute() ? 'Sound off' : 'Sound on');
  if (e.code === 'KeyN') {
    G.minutes = G.dayFactor > 0.5 ? 19 * 60 + 15 : 7 * 60;
    toast(`Time skipped — ${String(Math.floor(G.minutes / 60)).padStart(2, '0')}:00`);
  }
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 6) switchWeapon(n - 1);
  }
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => {
  G.keys[e.code] = false;
  if (e.code === 'Tab') { setWheel(false); switchWeapon(wheelSel); }
});
window.addEventListener('wheel', (e) => {
  if (!G.started || player.car) return;
  const dir = e.deltaY > 0 ? 1 : -1;
  switchWeapon((WEAPONS.indexOf(W()) + dir + WEAPONS.length) % WEAPONS.length);
}, { passive: true });

function lockPointer() {
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* no user gesture (auto-start) — ignore */ });
  } catch (e) { /* pointer lock unavailable */ }
}

const canvas = renderer.domElement;
canvas.addEventListener('mousedown', () => {
  if (!G.started) return;
  if (!isTouch && document.pointerLockElement !== canvas) { lockPointer(); return; }
  G.fireHeld = true;
});
window.addEventListener('mouseup', () => { G.fireHeld = false; });
document.addEventListener('mousemove', (e) => {
  if (!G.started) return;
  if (document.pointerLockElement === canvas) {
    if (wheelOpenNow()) { wheelAcc += e.movementX; if (wheelMove(wheelAcc)) wheelAcc = 0; }
    else {
      G.camYaw += e.movementX * 0.0026;
      G.camPitch = clamp(G.camPitch - e.movementY * 0.0022, -0.55, 0.65);
    }
  }
});
function wheelOpenNow() { const el = document.getElementById('wwheel'); return el && el.style.display === 'flex'; }

// Touch controls: joystick writes the same key flags; drag rotates camera.
const joyVec = { x: 0, y: 0 };
function setupTouch() {
  const joy = document.getElementById('joy'), knob = document.getElementById('joy-knob');
  let joyId = null;
  const setKnob = (dx, dy) => { knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`; };
  joy.addEventListener('touchstart', (e) => { joyId = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) {
        const r = joy.getBoundingClientRect();
        let dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy), max = 40;
        if (d > max) { dx *= max / d; dy *= max / d; }
        joyVec.x = dx / max; joyVec.y = dy / max;
        setKnob(dx, dy);
      } else if (t.identifier === camTouchId) {
        G.camYaw += (t.clientX - camLast.x) * 0.006;
        G.camPitch = clamp(G.camPitch - (t.clientY - camLast.y) * 0.005, -0.55, 0.65);
        camLast = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: true });
  window.addEventListener('touchend', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyId) { joyId = null; joyVec.x = 0; joyVec.y = 0; setKnob(0, 0); }
      if (t.identifier === camTouchId) camTouchId = null;
    }
  });
  let camTouchId = null, camLast = { x: 0, y: 0 };
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    camTouchId = t.identifier; camLast = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  const bind = (id, down, up) => {
    const b = document.getElementById(id);
    b.addEventListener('touchstart', (e) => { e.preventDefault(); b.classList.add('on'); down(); }, { passive: false });
    b.addEventListener('touchend', (e) => { e.preventDefault(); b.classList.remove('on'); if (up) up(); }, { passive: false });
  };
  bind('btn-fire', () => { G.fireHeld = true; }, () => { G.fireHeld = false; });
  bind('btn-act', () => tryInteract());
  bind('btn-weap', () => switchWeapon((WEAPONS.indexOf(W()) + 1) % WEAPONS.length));
  bind('btn-reload', () => { if (!useWorkshop()) startReload(); });
  bind('btn-brake', () => { G.keys['Space'] = true; }, () => { G.keys['Space'] = false; });
  bind('btn-horn', () => { if (player.car) sfxHorn(); });
}
if (isTouch) setupTouch();

function applyTouchKeys() {
  if (!isTouch) return;
  G.keys['KeyW'] = joyVec.y < -0.28;
  G.keys['KeyS'] = joyVec.y > 0.28;
  G.keys['KeyA'] = joyVec.x < -0.28;
  G.keys['KeyD'] = joyVec.x > 0.28;
  G.keys['ShiftLeft'] = Math.hypot(joyVec.x, joyVec.y) > 0.86;
}

// ---------- player on foot ----------

let walkPhase = 0;
function updatePlayer(dt) {
  const k = G.keys;
  const fwd = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
  const strafe = (k['KeyD'] ? 1 : 0) - (k['KeyA'] ? 1 : 0);
  const fx = Math.sin(G.camYaw), fz = Math.cos(G.camYaw);
  const rx = -Math.cos(G.camYaw), rz = Math.sin(G.camYaw);
  let mx = fx * fwd + rx * strafe, mz = fz * fwd + rz * strafe;
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) { mx /= ml; mz /= ml; }
  const sprint = k['ShiftLeft'] || k['ShiftRight'];
  const speed = player.stunT > 0 ? 0 : (sprint ? 7 : 4.2);
  player.speedNow = ml > 0.01 ? speed : 0;
  if (ml > 0.01 && player.stunT <= 0) {
    player.x += mx * speed * dt;
    player.z += mz * speed * dt;
    player.heading = G.camYaw;
  }
  if (player.stunT > 0) player.stunT -= dt;
  // Knockback.
  player.x += player.kx * dt; player.z += player.kz * dt;
  const decay = Math.pow(0.002, dt);
  player.kx *= decay; player.kz *= decay;
  if (Math.abs(player.kx) < 0.05) player.kx = 0;
  if (Math.abs(player.kz) < 0.05) player.kz = 0;
  // Jump / gravity.
  if (k['Space'] && player.y <= 0) player.vy = 8.4;
  if (player.y > 0 || player.vy > 0) {
    player.vy -= 23 * dt;
    player.y += player.vy * dt;
    if (player.y <= 0) { player.y = 0; player.vy = 0; }
  }
  const p = collideCircle(player.x, player.z, 0.4);
  player.x = p.x; player.z = p.z;
  // Vehicle contact: knockback + capped damage, never a one-shot.
  for (const car of G.cars) {
    if (car.mode === 'wreck') continue;
    const rr = car.kind === 'policebike' ? 1.3 : 2.4;
    const dx = player.x - car.x, dz = player.z - car.z;
    const d = Math.hypot(dx, dz);
    if (d < rr && d > 0.01) {
      player.x = car.x + dx / d * rr;
      player.z = car.z + dz / d * rr;
      const cs = Math.abs(car.speed);
      if (cs > 3.5 && G.time - (car.hitT || -9) > 1) {
        car.hitT = G.time;
        G.hooks.hurtPlayer(Math.min(22, Math.round(5 + cs * 0.8)));
        player.kx += dx / d * (4.5 + cs * 0.3);
        player.kz += dz / d * (4.5 + cs * 0.3);
        player.stunT = 0.45;
        car.speed *= 0.55;
        sfxCrash(false);
        if (G.hooks.burst) G.hooks.burst(player.x, 1, player.z, 8, 0xffd28a);
      }
    }
  }
  // Health regen after 7 quiet seconds.
  if (G.time - player.hurtT > 7 && player.health > 0)
    player.health = Math.min(100, player.health + 4 * dt);
  // Sync figure + walk cycle.
  walkPhase += dt * (player.speedNow > 0.2 ? player.speedNow * 2.6 : 0);
  const sw = player.speedNow > 0.2 ? Math.sin(walkPhase) * 0.55 : 0;
  if (player.legL) { player.legL.rotation.x = sw; player.legR.rotation.x = -sw; }
  if (player.armL && player.aimT <= 0 && player.swingT <= 0) player.armL.rotation.x = -sw * 0.7;
  player.group.position.set(player.x, player.y + (player.speedNow > 0.2 ? Math.abs(Math.sin(walkPhase)) * 0.05 : 0), player.z);
  player.group.rotation.y = player.heading;
}

// ---------- driving ----------

function updateDriving(dt) {
  const car = player.car;
  const perf = perfOf(car.kind);
  const k = G.keys;
  const throttle = (k['KeyW'] ? 1 : 0) - (k['KeyS'] ? 1 : 0);
  const steer = (k['KeyA'] ? 1 : 0) - (k['KeyD'] ? 1 : 0);
  if (throttle > 0) car.speed = Math.min(perf.top, car.speed + perf.acc * dt);
  else if (throttle < 0) car.speed = Math.max(-8, car.speed - perf.acc * 1.2 * dt);
  else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 4.5 * dt);
  if (k['Space']) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 26 * dt);
  const steerAuthority = clamp(car.speed / 8, -1, 1);
  car.heading += steer * perf.turn * dt * steerAuthority * (k['Space'] ? 1.5 : 1);
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
  const p = collideCircle(car.x, car.z, 1.6);
  if ((Math.abs(p.x - car.x) > 0.01 || Math.abs(p.z - car.z) > 0.01) && Math.abs(car.speed) > 6) {
    if (G.hooks.damageCar) G.hooks.damageCar(car, Math.abs(car.speed) * 0.8);
    sfxCrash(Math.abs(car.speed) > 14);
    if (G.hooks.shake) G.hooks.shake(0.3);
    car.speed *= -0.25;
  }
  car.x = p.x; car.z = p.z;
  // Running people over.
  if (Math.abs(car.speed) > 3) {
    for (const ped of G.peds) {
      if (ped.state === 'down' || ped.state === 'gone' || ped.state === 'inside' || ped.state === 'riding') continue;
      if (Math.hypot(ped.x - car.x, ped.z - car.z) < 2.0) {
        if (ped.kind === 'officer') { addWanted(2, 'Ran over an officer'); if (G.hooks.downPed) G.hooks.downPed(ped, true); }
        else { addWanted(1, 'Ran over a pedestrian'); if (G.hooks.downPed) G.hooks.downPed(ped, true); }
        car.speed *= 0.82;
        sfxCrash(false);
      }
    }
  }
  player.x = car.x; player.z = car.z;
  player.heading = car.heading;
  player.speedNow = Math.abs(car.speed);
  syncMesh(car);
  // Camera drifts behind the car while moving.
  if (Math.abs(car.speed) > 2) G.camYaw = angleLerp(G.camYaw, car.heading, Math.min(1, dt * 2.2));
}

// ---------- prompts ----------

function updatePrompt() {
  if (player.dead) { setPrompt(''); return; }
  if (player.car) {
    if (Math.hypot(WORKSHOP.x - player.car.x, WORKSHOP.z - player.car.z) < 6.5)
      setPrompt('Press R — Workshop service Rp 50,000');
    else setPrompt('');
    return;
  }
  if (nearestCar()) { setPrompt('Press F — Enter vehicle'); return; }
  for (const s of FOOD_SPOTS)
    if (Math.hypot(s.x - player.x, s.z - player.z) < 2.6) { setPrompt('Press F — Eat (Rp 15,000)'); return; }
  setPrompt('');
}

// ---------- day / night ----------

const COL = {
  dayBg: new THREE.Color(0xcfe4f2), nightBg: new THREE.Color(0x0e1622),
  duskBg: new THREE.Color(0xe88a4a), tmp: new THREE.Color(),
};
function updateDayCycle(dt) {
  G.minutes = (G.minutes + dt * 2) % 1440;
  const th = (G.minutes - 360) / 720 * Math.PI;
  const el = Math.sin(th);
  G.dayFactor = clamp((el + 0.12) / 0.38, 0, 1);
  G.night = G.dayFactor < 0.45;
  const df = G.dayFactor;
  COL.tmp.copy(COL.nightBg).lerp(COL.dayBg, df);
  if (el > -0.15 && el < 0.28) COL.tmp.lerp(COL.duskBg, (1 - Math.abs(el) / 0.28) * 0.35);
  scene.background.copy(COL.tmp);
  scene.fog.color.copy(COL.tmp);
  scene.fog.near = lerp(190, 260, df);
  scene.fog.far = lerp(1350, 2100, df);
  if (env.skyMat) env.skyMat.color.copy(COL.tmp).lerp(new THREE.Color(0xffffff), 0.55);
  sun.intensity = 0.18 + df * 1.05;
  hemi.intensity = 0.22 + df * 0.53;
  const sunA = th + 0.5;
  sun.position.set(player.x + Math.cos(sunA) * 260, 120 + el * 260, player.z + Math.sin(sunA) * 180);
  sun.target.position.set(player.x, 0, player.z);
  // Player-car headlight spotlight.
  if (G.night && player.car) {
    headSpot.intensity = 1500;
    headSpot.position.set(player.car.x, 1.3, player.car.z);
    headSpot.target.position.set(
      player.car.x + Math.sin(player.car.heading) * 30, 0,
      player.car.z + Math.cos(player.car.heading) * 30);
  } else headSpot.intensity = 0;
}

// ---------- camera ----------

function updateCamera(dt) {
  camShake *= Math.pow(0.001, dt);
  const inCar = !!player.car;
  const dist = inCar ? 9.5 : 6.5;
  const tx = player.x, ty = (inCar ? 2.2 : 1.7) + player.y, tz = player.z;
  const cp = Math.cos(G.camPitch);
  const fx = Math.sin(G.camYaw) * cp, fz = Math.cos(G.camYaw) * cp;
  const cx = tx - fx * dist;
  const cz = tz - fz * dist;
  const cy = ty - Math.sin(G.camPitch) * dist + 0.6;
  camera.position.set(
    cx + (Math.random() - 0.5) * camShake,
    Math.max(0.6, cy) + (Math.random() - 0.5) * camShake * 0.5,
    cz + (Math.random() - 0.5) * camShake);
  camera.lookAt(tx + fx * 4, ty + Math.sin(G.camPitch) * 4 + 0.4, tz + fz * 4);
  if (!G.started) {
    // Slow orbit over the roundabout behind the start overlay.
    const a = G.time * 0.05;
    camera.position.set(Math.cos(a) * 55, 26, Math.sin(a) * 55);
    camera.lookAt(0, 4, 0);
  }
}

// ---------- save / continue ----------

const SAVE_KEY = 'jakarta-city-save-v1';
const WEAPON_DEFAULTS = WEAPONS.map(w => ({ magAmmo: w.magAmmo ?? 0, reserve: w.reserve ?? 0 }));

export function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      money: Math.floor(player.money), x: player.x, z: player.z,
      heading: player.heading, minutes: G.minutes, ...weaponSaveState(),
    }));
  } catch (e) { /* storage unavailable */ }
}

function readSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
    return s && typeof s.money === 'number' ? s : null;
  } catch (e) { return null; }
}

function newGame() {
  player.money = 250000;
  player.health = 100; player.armor = 50;
  player.x = 20.5; player.z = -64; player.y = 0;
  player.heading = G.camYaw = Math.PI;
  G.minutes = 600;
  G.wanted = 0;
  weaponLoadState({ slot: 2, weapons: WEAPON_DEFAULTS });
  player.group.position.set(player.x, 0, player.z);
}

function applySave(s) {
  player.money = s.money;
  player.x = s.x; player.z = s.z;
  player.heading = G.camYaw = s.heading ?? Math.PI;
  G.minutes = s.minutes ?? 600;
  weaponLoadState(s);
  player.group.position.set(player.x, 0, player.z);
}

function startGame(fresh) {
  const overlay = document.getElementById('start');
  if (overlay) overlay.style.display = 'none';
  G.started = true;
  initAudio();
  if (fresh) newGame();
  else { const s = readSave(); if (s) applySave(s); else newGame(); }
  if (!isTouch && document.pointerLockElement !== canvas) lockPointer();
  saveGame();
}

{
  const save = readSave();
  const cont = document.getElementById('btn-continue');
  if (save && cont) cont.style.display = '';
  document.getElementById('btn-new').addEventListener('click', (e) => { e.stopPropagation(); startGame(true); });
  if (cont) cont.addEventListener('click', (e) => { e.stopPropagation(); startGame(false); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.started) saveGame(); });
}

// ---------- debug hooks ----------

window.__JC = {
  start: () => startGame(true),
  teleport(x, z) {
    if (player.car) exitCar(true);
    player.x = x; player.z = z; player.y = 0;
    player.group.position.set(x, 0, z);
  },
  setCam(yaw, pitch) { G.camYaw = yaw; G.camPitch = pitch; },
  addWanted(n) { addWanted(n); },
  missionTarget() { return missionTarget(); },
  setMinutes(m) { G.minutes = m; },
  player, cars: G.cars, peds: G.peds,
  weapons: () => WEAPONS.map(w => w.id),
  damageCar: (car, dmg) => G.hooks.damageCar && G.hooks.damageCar(car, dmg),
  save: saveGame,
  get wanted() { return G.wanted; },
  get minutes() { return G.minutes; },
};

if (new URLSearchParams(window.location.search).has('auto')) startGame(true);

// ---------- the loop ----------

const clockT = new THREE.Clock();
let saveT = 0, frameAvg = 16, qualityDropped = false;

function animate() {
  requestAnimationFrame(animate);
  let dt = Math.min(clockT.getDelta(), 0.05);
  // Frame-rate watchdog: shed pixel ratio, then shadows, if struggling.
  frameAvg = frameAvg * 0.96 + dt * 1000 * 0.04;
  if (!qualityDropped && G.time > 5 && frameAvg > 26) {
    qualityDropped = true;
    renderer.setPixelRatio(1);
    if (frameAvg > 34) sun.castShadow = false;
  }
  if (wheelOpenNow()) dt *= 0.3; // weapon-wheel slow motion
  G.time += dt;
  applyTouchKeys();

  if (G.started && !player.dead) {
    if (player.car) updateDriving(dt); else updatePlayer(dt);
    updateWeapons(dt);
  }
  const shots = shotsFiredPulse;
  updatePeds(dt, shots && G.started && !player.dead);
  updateVehicles(dt);
  if (G.started) {
    updatePolice(dt);
    if (!player.dead) updateMissions(dt);
    updatePickups(dt);
    updatePrompt();
  }
  if (player.dead) {
    // Fall: wasted falls backward flat, busted falls forward.
    const target = endKind === 'busted' ? Math.PI / 2 : -Math.PI / 2;
    player.group.rotation.x += (target - player.group.rotation.x) * Math.min(1, dt * 5);
    player.group.position.y = 0.25;
    player.deadT -= dt;
    if (player.deadT <= 0) respawn();
  }
  // Police light bars flash.
  for (const car of policeCars) {
    if (!car.lightBar) continue;
    const ph = Math.sin(G.time * 9 + car.x) > 0;
    car.lightBar.children[0].visible = ph;
    car.lightBar.children[1].visible = !ph;
  }
  updateEffects(dt);
  updateWorldVisuals();
  updateDayCycle(dt);
  updateCamera(dt);
  updateHUD();
  updateAudio(player.car ? player.car.speed : null, policeNearForAudio(), G.time);
  saveT += dt;
  if (saveT > 15) { saveT = 0; if (G.started) saveGame(); }
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
