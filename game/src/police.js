// police.js — the wanted system and everything the police do with it.
//
// Crimes raise the wanted level (0–5 stars) and stamp the crime banner.
// Stars decay once the player has been quiet for 16 s with no police car
// within 48 m. The force on the street matches the star composition; cars
// pursue by interception (aiming at the player's position plus a velocity
// lead), park to deploy officers on foot (see people.js), and at five
// stars park a two-car roadblock in the player's path. If the player is
// slow with police close, the bust meter fills — full meter means BUSTED.

import { G, player, R, clamp } from './state.js';
import { spawnCar, removeCar, driveToward, perfOf, syncMesh } from './vehicles.js';
import { spawnOfficer } from './people.js';
import { sfxCrash } from './audio.js';

export const policeCars = [];
export let bustMeter = 0;
let roadblock = [];
let lastBustedCheck = 0;

const COMPOSITION = {
  1: ['police'],
  2: ['police', 'police'],
  3: ['police', 'police', 'policesuv'],
  4: ['police', 'policesuv', 'policebike', 'police'],
  5: ['policesuv', 'police', 'policebike', 'policesuv'],
};

export function addWanted(n, crimeText) {
  const before = G.wanted;
  G.wanted = clamp(G.wanted + n, 0, 5);
  G.lastCrimeAt = G.time;
  G.crimeQuiet = 0;
  if (crimeText && G.hooks.crime) G.hooks.crime(crimeText);
  if (G.wanted > before && G.hooks.flashStars) G.hooks.flashStars();
}
G.hooks.addWanted = addWanted;

export function clearWanted() {
  G.wanted = 0;
  bustMeter = 0;
}

G.hooks.bustPush = (amt) => { bustMeter = Math.min(3, bustMeter + amt); };

function spawnPoliceCar(kind) {
  // Spawn on an avenue lane behind the player, out of immediate sight.
  const behind = player.heading + Math.PI + R(-0.5, 0.5);
  const d = R(75, 105);
  const x = clamp(player.x + Math.sin(behind) * d * 0.2 + (Math.random() < 0.5 ? -4.95 : 4.95), -14, 14);
  const z = player.z + Math.cos(behind) * d;
  const car = spawnCar(kind, x, clamp(z, -540, 550), player.heading, 'police');
  policeCars.push(car);
  return car;
}

function despawnCar(car) {
  if (car.officer) {
    if (car.officer.state === 'officer') car.officer.car = null; // he is on foot; he will stand down
    else { car.officer.state = 'gone'; car.officer.car = null; }
    car.officer = null;
  }
  removeCar(car);
  const i = policeCars.indexOf(car);
  if (i >= 0) policeCars.splice(i, 1);
  const j = roadblock.indexOf(car);
  if (j >= 0) roadblock.splice(j, 1);
}

function placeRoadblock() {
  clearRoadblock();
  const hx = Math.sin(player.heading), hz = Math.cos(player.heading);
  const cx = player.x + hx * 118, cz = player.z + hz * 118;
  const px = hz, pz = -hx; // perpendicular
  for (const off of [-4.6, 4.6]) {
    const car = spawnCar(off < 0 ? 'policesuv' : 'police', cx + px * off, cz + pz * off, player.heading + Math.PI / 2, 'roadblock');
    car.speed = 0;
    roadblock.push(car);
    policeCars.push(car);
  }
}

function clearRoadblock() {
  for (const car of [...roadblock]) despawnCar(car);
  roadblock = [];
}

export function updatePolice(dt) {
  // Decay: quiet for 16 s and no police within 48 m.
  G.crimeQuiet += dt;
  if (G.wanted > 0 && G.crimeQuiet > 16 && G.time - G.lastCrimeAt > 16) {
    const near = policeCars.some(c => Math.hypot(c.x - player.x, c.z - player.z) < 48);
    if (!near) {
      G.wanted = Math.max(0, G.wanted - dt / 6);
      if (G.wanted < 0.02) G.wanted = 0;
    }
  }
  const stars = Math.ceil(G.wanted);
  const want = COMPOSITION[stars] || [];

  // Spawn missing kinds, trim extras (farthest first) when stars drop.
  const active = policeCars.filter(c => c.mode === 'police');
  const kindsHere = active.map(c => c.kind);
  for (const kind of want) {
    const idx = kindsHere.indexOf(kind);
    if (idx >= 0) kindsHere.splice(idx, 1);
    else spawnPoliceCar(kind);
  }
  if (active.length > want.length) {
    const extras = [...active].sort((a, b) =>
      Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z));
    for (let i = 0; i < active.length - want.length; i++) despawnCar(extras[i]);
  }
  // Despawn everything when the heat is fully off and far away.
  if (stars === 0) {
    for (const car of [...policeCars]) {
      if (Math.hypot(car.x - player.x, car.z - player.z) > 120) despawnCar(car);
    }
    if (roadblock.length) clearRoadblock();
  }

  // Roadblock at five stars while the player is driving.
  if (stars >= 5 && player.car) {
    if (!roadblock.length) placeRoadblock();
    else {
      const c = roadblock[0];
      if (Math.hypot(c.x - player.x, c.z - player.z) > 190) placeRoadblock();
    }
  } else if (roadblock.length) clearRoadblock();

  // Officer deployment: park and get out when the situation calls for it.
  let officersOut = G.peds.filter(p => p.state === 'officer').length;
  for (const car of policeCars) {
    if (car.mode !== 'police' || car.officer || car.mode === 'wreck') continue;
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    const deploy = (stars >= 2 && !player.car && d < 30) ||
      (stars >= 3 && player.car && Math.abs(player.car.speed) < 2.5 && d < 22);
    if (deploy && officersOut < 4) { spawnOfficer(car); officersOut++; }
  }

  // Pursuit driving.
  const pvx = player.car ? Math.sin(player.car.heading) * player.car.speed : 0;
  const pvz = player.car ? Math.cos(player.car.heading) * player.car.speed : 0;
  for (const car of policeCars) {
    if (car.mode === 'roadblock') { syncMesh(car); continue; }
    if (car.burning || car.mode === 'wreck') continue;
    if (car.officer && car.officer.state === 'officer') {
      // Parked while its officer is out.
      car.speed = Math.max(0, car.speed - 20 * dt);
      syncMesh(car);
      continue;
    }
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    const perf = perfOf(car.kind);
    const lead = Math.min(0.9, d / Math.max(10, perf.top));
    let tx = player.x + pvx * lead, tz = player.z + pvz * lead;
    let top = perf.top + (car.kind === 'police' ? G.wanted * 1.2 : 0);
    // Do not run the player over: match pace alongside an on-foot player.
    if (!player.car) {
      if (d < 6) top = 0;
      else if (d < 11) top = Math.min(top, car.kind === 'policebike' ? 5.5 : 6);
      if (car.kind === 'policebike' && d < 9) top = 0;
      else if (car.kind === 'policebike' && d < 15) top = Math.min(top, 5.5);
    } else if (d < 5) {
      top = Math.min(top, Math.abs(player.car.speed) + 3);
    }
    driveToward(car, tx, tz, top, dt);
    // Ram damage to the player's car, with a per-car cooldown.
    if (player.car && d < 3.4 && G.time - car.ramT > 2.5) {
      car.ramT = G.time;
      if (G.hooks.damageCar) G.hooks.damageCar(player.car, 5);
      sfxCrash(false);
    }
  }

  // Bust meter.
  const playerSlow = player.car ? Math.abs(player.car.speed) < 2.2 : player.speedNow < 3;
  let bustNear = false;
  if (G.wanted > 0 && playerSlow && !player.dead) {
    for (const car of policeCars) {
      const d = Math.hypot(car.x - player.x, car.z - player.z);
      if (d < (player.car ? 7 : 8.5)) { bustNear = true; break; }
    }
  }
  if (bustNear) bustMeter = Math.min(3, bustMeter + dt * 1.15);
  else bustMeter = Math.max(0, bustMeter - dt * 1.6);
  if (bustMeter >= 3 && G.time - lastBustedCheck > 1) {
    lastBustedCheck = G.time;
    if (G.hooks.onBusted) G.hooks.onBusted();
  }
}

export function policeNearForAudio() {
  return G.wanted > 0 && policeCars.some(c => Math.hypot(c.x - player.x, c.z - player.z) < 55);
}
