// state.js — shared mutable game state for Jakarta City.
//
// Every other module imports from here: the small math helpers, the static
// collider registry used by people and cars, the entity lists (cars, peds,
// pickups), the wanted level and the game clock. Cross-module functions that
// would create import cycles (spawnPed, damageCar, addWanted, ...) are
// registered on the `hooks` object by the module that owns them, so any
// module can call them through `G.hooks` without importing its owner.

// ---------- small math helpers ----------

export const R = (a, b) => a + Math.random() * (b - a);
export const RI = (a, b) => Math.floor(R(a, b + 1));
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Shortest-path interpolation between two headings (radians).
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Signed smallest difference from heading a to heading b.
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// ---------- static colliders ----------
// Axis-aligned boxes { x, z, hw, hd } (centre + half extents). Buildings,
// monuments and stalls register here; collideCircle pushes a circle out.

export const colliders = [];

export function addCollider(x, z, w, d) {
  colliders.push({ x, z, hw: w / 2, hd: d / 2 });
}

// Push the circle (x, z, r) out of every collider it overlaps. Single pass,
// resolved against the nearest edge, which is enough for boxes in a grid city.
export function collideCircle(x, z, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const dx = x - c.x, dz = z - c.z;
    const px = c.hw + r - Math.abs(dx);
    if (px <= 0) continue;
    const pz = c.hd + r - Math.abs(dz);
    if (pz <= 0) continue;
    if (px < pz) x = c.x + (dx >= 0 ? c.hw + r : -(c.hw + r));
    else z = c.z + (dz >= 0 ? c.hd + r : -(c.hd + r));
  }
  return { x, z };
}

// Is the circle at (x, z, r) overlapping any collider right now?
export function circleBlocked(x, z, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (Math.abs(x - c.x) < c.hw + r && Math.abs(z - c.z) < c.hd + r) return true;
  }
  return false;
}

// ---------- the player ----------

export const player = {
  x: 20.5, z: -64, y: 0, vy: 0,
  heading: Math.PI,           // faces the monument (north, -z)
  health: 100, armor: 50,
  money: 250000,
  car: null,                  // vehicle object while driving, else null
  group: null, armL: null, armR: null, handWeapon: null,
  swingT: 0, aimT: 0,
  kx: 0, kz: 0, stunT: 0,     // knockback velocity + stagger timer
  hurtT: -99,                 // last time the player took damage
  dead: false, deadT: 0,
  speedNow: 0,                // planar speed, read by police / bust logic
};

// ---------- global game state ----------

export const G = {
  time: 0,                    // seconds since boot (game time, pauses on end screens only via dead flags)
  started: false,
  minutes: 600,               // game clock: 10:00
  dayFactor: 1,               // 1 = full day, 0 = full night
  night: false,
  wanted: 0,
  lastCrimeAt: -99,
  crimeQuiet: 0,              // seconds since the last crime
  cars: [],
  peds: [],
  pickups: [],
  keys: {},
  fireHeld: false,
  brakeHeld: false,
  camYaw: Math.PI, camPitch: 0.24,
  hooks: {},                  // filled in by module owners (see header)
};

// Convenience wrappers around the hook registry, so callers read naturally.
export const spawnPedAt = (x, z, opts) => G.hooks.spawnPedAt && G.hooks.spawnPedAt(x, z, opts);
export const damageCar = (car, dmg, silent) => G.hooks.damageCar && G.hooks.damageCar(car, dmg, silent);
export const addWanted = (n, crime) => G.hooks.addWanted && G.hooks.addWanted(n, crime);
export const toast = (msg) => G.hooks.toast && G.hooks.toast(msg);
export const dropLoot = (x, z, officer) => G.hooks.dropLoot && G.hooks.dropLoot(x, z, officer);
export const hurtPlayer = (dmg) => G.hooks.hurtPlayer && G.hooks.hurtPlayer(dmg);
