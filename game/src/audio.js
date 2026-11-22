// audio.js — all sound is synthesized with WebAudio, no audio assets.
//
// A tiny beep/noise kit builds every effect: gunshots per weapon kind, melee
// swishes, reload clicks, horns, crashes, cash register, mission jingle, the
// WASTED/BUSTED sting, plus two looping layers (engine hum while driving and
// the police siren) whose pitch/volume follow the game state each frame.

let ctx = null;
let master = null;
let muted = false;
let engineOsc = null, engineGain = null;
let sirenOsc = null, sirenGain = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch (e) { ctx = null; }
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

// One oscillator blip. `slideTo` bends the pitch over the duration.
function beep(freq, dur, type = 'square', vol = 0.2, when = 0, slideTo = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

// One filtered noise burst (gunshot body, crash, explosion).
function noiseBurst(dur, vol = 0.3, freq = 1200, when = 0) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export function sfxShot(kind) {
  if (kind === 'smg') { noiseBurst(0.07, 0.22, 2600); beep(220, 0.05, 'square', 0.1, 0, 90); }
  else if (kind === 'shotgun') { noiseBurst(0.22, 0.45, 1100); beep(120, 0.16, 'square', 0.18, 0, 50); }
  else if (kind === 'rifle') { noiseBurst(0.16, 0.4, 1800); beep(160, 0.12, 'square', 0.16, 0, 60); }
  else { noiseBurst(0.1, 0.32, 2000); beep(190, 0.08, 'square', 0.13, 0, 70); }
}

export function sfxMelee() { noiseBurst(0.06, 0.12, 3200); beep(500, 0.06, 'sine', 0.06, 0, 200); }
export function sfxReload() { beep(300, 0.05, 'square', 0.12); beep(210, 0.05, 'square', 0.12, 0.09); beep(420, 0.05, 'square', 0.12, 0.2); }
export function sfxHorn() { beep(370, 0.32, 'square', 0.16); beep(466, 0.32, 'square', 0.12, 0.005); }
export function sfxHornLite() { beep(440, 0.14, 'square', 0.06); }
export function sfxCrash(big) { noiseBurst(big ? 0.4 : 0.18, big ? 0.5 : 0.28, 700); beep(90, 0.2, 'triangle', 0.2, 0, 40); }
export function sfxExplosion() { noiseBurst(0.6, 0.6, 320); beep(58, 0.55, 'sine', 0.5, 0, 30); }
export function sfxCash(vol = 1) { beep(880, 0.07, 'square', 0.1 * vol); beep(1318, 0.12, 'square', 0.1 * vol, 0.07); }
export function sfxJingle() { [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.16, 'square', 0.11, i * 0.11)); }
export function sfxSting(busted) {
  if (busted) { beep(392, 0.3, 'triangle', 0.2); beep(330, 0.3, 'triangle', 0.2, 0.28); beep(262, 0.6, 'triangle', 0.22, 0.56); }
  else { beep(220, 0.4, 'sawtooth', 0.16, 0, 110); beep(147, 0.8, 'sawtooth', 0.16, 0.3, 73); }
}
export function sfxDoor() { beep(140, 0.08, 'square', 0.1); beep(90, 0.1, 'square', 0.12, 0.09); }

// Looping layers, created lazily once the audio context exists.
function ensureLoops() {
  if (!ctx || engineOsc) return;
  engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
  engineGain = ctx.createGain(); engineGain.gain.value = 0;
  const ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 300;
  engineOsc.connect(ef); ef.connect(engineGain); engineGain.connect(master);
  engineOsc.start();
  sirenOsc = ctx.createOscillator(); sirenOsc.type = 'triangle'; sirenOsc.frequency.value = 700;
  sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
  sirenOsc.connect(sirenGain); sirenGain.connect(master);
  sirenOsc.start();
}

// Called every frame: engine pitch follows the driven car's speed, the siren
// wails while any police car is near and the player is wanted.
export function updateAudio(drivingSpeed, sirenNear, t) {
  if (!ctx) return;
  ensureLoops();
  if (!engineOsc) return;
  const eg = drivingSpeed === null ? 0 : 0.05 + Math.min(0.06, Math.abs(drivingSpeed) * 0.0016);
  engineGain.gain.setTargetAtTime(muted ? 0 : eg, ctx.currentTime, 0.08);
  if (drivingSpeed !== null) engineOsc.frequency.setTargetAtTime(52 + Math.abs(drivingSpeed) * 2.4, ctx.currentTime, 0.08);
  sirenGain.gain.setTargetAtTime(muted ? 0 : (sirenNear ? 0.028 : 0), ctx.currentTime, 0.2);
  if (sirenNear) sirenOsc.frequency.setTargetAtTime(700 + Math.sin(t * 5.2) * 190, ctx.currentTime, 0.05);
}
