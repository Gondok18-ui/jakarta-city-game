// hud.js — everything drawn over the 3D view: money, clock, stars, weapon,
// health/armour bars, prompts, toasts, the crime banner, the end screen and
// the minimap. Other modules talk to the HUD through the G.hooks registry
// (toast, crime, setObjective, flashWeapon, flashStars) registered here.

import { G, player } from './state.js';
import { WEAPONS, W } from './weapons.js';
import { bustMeter } from './police.js';
import { zoneName } from './world.js';
import { missionTarget } from './missions.js';
import { CAR_NAMES } from './vehicles.js';

const el = {};
let toastUntil = 0, crimeUntil = 0, flashUntil = 0;
let mmCtx = null;

export function initHUD() {
  for (const id of ['money', 'clock', 'stars', 'ammo-big', 'ammo-small', 'wname-text', 'wicon',
    'health-fill', 'armor-fill', 'zone', 'prompt', 'objective', 'toast', 'crime',
    'endscreen', 'end-title', 'end-sub', 'bust-fill', 'vehname', 'wflash', 'minimap'])
    el[id] = document.getElementById(id);
  if (el.minimap) mmCtx = el.minimap.getContext('2d');

  G.hooks.toast = (msg) => {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.style.opacity = '1';
    toastUntil = G.time + 2.6;
  };
  G.hooks.crime = (msg) => {
    if (!el.crime) return;
    el.crime.textContent = msg;
    el.crime.style.opacity = '1';
    crimeUntil = G.time + 2.2;
  };
  G.hooks.setObjective = (msg) => { if (el.objective) el.objective.textContent = msg; };
  G.hooks.flashWeapon = (name) => {
    if (!el.wflash) return;
    el.wflash.textContent = name;
    el.wflash.style.opacity = '1';
    flashUntil = G.time + 1.1;
  };
  G.hooks.flashStars = () => { /* stars pop via CSS class in updateHUD */ };
}

export function setPrompt(msg) { if (el.prompt) el.prompt.textContent = msg || ''; }

export function showEndScreen(busted, fine) {
  if (!el.endscreen) return;
  el['end-title'].textContent = busted ? 'BUSTED' : 'WASTED';
  el['end-title'].style.color = busted ? '#5aa2ff' : '#ff4a3d';
  el['end-sub'].textContent = busted
    ? `You were arrested — fine Rp ${fine.toLocaleString('en-US')}. Released outside the Police Station.`
    : 'You were wasted — you wake up outside the Hospital.';
  el.endscreen.style.display = 'flex';
}
export function hideEndScreen() { if (el.endscreen) el.endscreen.style.display = 'none'; }

function fmtClock(minutes) {
  const h = Math.floor(minutes / 60) % 24, m = Math.floor(minutes % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function updateHUD() {
  if (!el.money) return;
  el.money.textContent = `Rp ${Math.max(0, Math.floor(player.money)).toLocaleString('en-US')}`;
  el.clock.textContent = fmtClock(G.minutes);
  const stars = Math.ceil(G.wanted);
  el.stars.textContent = '★★★★★'.slice(0, stars) + '☆☆☆☆☆'.slice(0, 5 - stars);
  el.stars.style.color = stars > 0 ? '#ffd75e' : 'rgba(255,255,255,0.35)';
  const w = W();
  el['wname-text'].textContent = w.name;
  el.wicon.textContent = w.icon;
  if (w.melee) { el['ammo-big'].textContent = '—'; el['ammo-small'].textContent = ''; }
  else {
    el['ammo-big'].textContent = String(w.magAmmo);
    el['ammo-small'].textContent = `/ ${w.reserve}`;
  }
  el['health-fill'].style.width = `${Math.max(0, player.health)}%`;
  el['armor-fill'].style.width = `${Math.max(0, player.armor)}%`;
  el['bust-fill'].style.width = `${(bustMeter / 3) * 100}%`;
  el.zone.textContent = zoneName(player.x, player.z);
  if (player.car) {
    el.vehname.textContent = CAR_NAMES[player.car.kind] || '';
    el.vehname.style.opacity = '1';
  } else el.vehname.style.opacity = '0';
  if (el.toast && G.time > toastUntil) el.toast.style.opacity = '0';
  if (el.crime && G.time > crimeUntil) el.crime.style.opacity = '0';
  if (el.wflash && G.time > flashUntil) el.wflash.style.opacity = '0';
  drawMinimap();
}

// ---------- minimap ----------

function drawMinimap() {
  if (!mmCtx) return;
  const ctx = mmCtx, S = 216, C = S / 2, K = C / 135;
  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, S, S);
  const px = player.x, pz = player.z;
  const X = (wx) => C + (wx - px) * K;
  const Y = (wz) => C + (wz - pz) * K;
  // Monas park.
  ctx.fillStyle = '#2c4a26';
  ctx.fillRect(X(-150), Y(-815), 300 * K, 300 * K);
  // Roads.
  ctx.fillStyle = '#3a4149';
  ctx.fillRect(X(-18), 0, 36 * K, S);                                   // avenue
  for (const cz of [-522, -300, 200, 430, 566]) ctx.fillRect(0, Y(cz - 12), S, 24 * K);
  for (const sx of [-64, 64, -150, 150, -232, 232]) ctx.fillRect(X(sx - 6), 0, 12 * K, S);
  ctx.beginPath(); ctx.arc(X(0), Y(0), 38 * K, 0, Math.PI * 2); ctx.fill();  // roundabout
  ctx.fillStyle = '#10151c';
  ctx.beginPath(); ctx.arc(X(0), Y(0), 19.5 * K, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d9a441';
  ctx.fillRect(X(0) - 2, Y(-665) - 2, 4, 4);                            // Monas marker
  // Mission blip (edge-clamped).
  const t = missionTarget();
  if (t) {
    let bx = X(t.x), by = Y(t.z);
    bx = Math.max(8, Math.min(S - 8, bx)); by = Math.max(8, Math.min(S - 8, by));
    ctx.fillStyle = '#2eff7a';
    ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
  }
  // People and cars.
  ctx.fillStyle = '#e8e8e8';
  for (const p of G.peds) {
    if (Math.abs(p.x - px) > 135 || Math.abs(p.z - pz) > 135) continue;
    ctx.fillRect(X(p.x) - 1, Y(p.z) - 1, 2, 2);
  }
  for (const c of G.cars) {
    if (Math.abs(c.x - px) > 135 || Math.abs(c.z - pz) > 135) continue;
    if (c.mode === 'police' || c.mode === 'roadblock') {
      ctx.fillStyle = Math.sin(G.time * 10) > 0 ? '#ff3b30' : '#3a7bd5';
      ctx.fillRect(X(c.x) - 2.5, Y(c.z) - 2.5, 5, 5);
    } else {
      ctx.fillStyle = '#9aa2ab';
      ctx.fillRect(X(c.x) - 2, Y(c.z) - 2, 4, 4);
    }
  }
  // Player arrow, rotated by heading (heading 0 faces +z = down on the map).
  ctx.save();
  ctx.translate(C, C);
  ctx.rotate(-player.heading);
  ctx.fillStyle = '#ffd75e';
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(-5, -6); ctx.lineTo(0, -2.5); ctx.lineTo(5, -6);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
