// missions.js — DELIVERY and RIDE-HAIL jobs, offered one at a time.
//
// A column of light marks the target (green, or blue while a ride-hail
// passenger is waiting to be picked up). DELIVERY pays for driving a
// package across town against the clock. RIDE-HAIL spawns a passenger on a
// far sidewalk: stop beside them, they walk over and climb in, then drive
// them to their destination for the fare plus a star rating. The mission
// timer only runs while the player is in a car. Finishing (or timing out)
// schedules the next job a few seconds later.

import * as THREE from 'three';
import { G, player, R, RI, toast } from './state.js';
import { spawnPedAt } from './people.js';
import { sfxCash, sfxJingle } from './audio.js';

export const mission = {
  active: false, kind: null, phase: null,
  tLeft: 0, destX: 0, destZ: 0, passenger: null, nextIn: 3,
};

let beacon = null;
const beaconMat = new THREE.MeshBasicMaterial({
  color: 0x2eff7a, transparent: true, opacity: 0.42,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

export function initMissions(scene) {
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 42, 14, 1, true), beaconMat);
  beacon.visible = false;
  scene.add(beacon);
}

function avenuePoint(minDist) {
  for (let tries = 0; tries < 24; tries++) {
    const z = R(-480, 520);
    if (Math.abs(z - player.z) >= minDist) return { x: R(-8, 8), z };
  }
  return { x: 0, z: player.z > 0 ? -420 : 460 };
}

function startMission() {
  mission.active = true;
  if (Math.random() < 0.5) {
    // RIDE-HAIL: a passenger waits on a far sidewalk.
    let pz = player.z + (Math.random() < 0.5 ? -1 : 1) * R(180, 320);
    pz = Math.max(-500, Math.min(540, pz));
    const px = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 20.2 : 23.4);
    const ped = spawnPedAt(px, pz, { axis: 'z', min: -505, max: 545 });
    ped.state = 'wait';
    mission.kind = 'ride'; mission.phase = 'pickup';
    mission.passenger = ped;
    mission.destX = px; mission.destZ = pz;
    mission.tLeft = Math.hypot(px - player.x, pz - player.z) / 12 + 45;
    toast('New RIDE-HAIL request — pick up the passenger');
  } else {
    const d = avenuePoint(150);
    mission.kind = 'delivery'; mission.phase = 'go';
    mission.passenger = null;
    mission.destX = d.x; mission.destZ = d.z;
    mission.tLeft = Math.hypot(d.x - player.x, d.z - player.z) / 14 + 30;
    toast('New DELIVERY — get the package across town');
  }
}

function endMission() {
  mission.active = false;
  mission.kind = null; mission.phase = null;
  mission.nextIn = R(5, 9);
  if (beacon) beacon.visible = false;
  if (G.hooks.setObjective) G.hooks.setObjective('');
}

function dropPassenger(pay) {
  const ped = mission.passenger;
  if (!ped) return;
  if (ped.state === 'riding' || ped.state === 'enter') {
    ped.group.visible = true;
    ped.x = player.x + 1.6; ped.z = player.z;
    ped.homeX = ped.x; ped.homeZ = ped.z;
    ped.group.position.set(ped.x, 0, ped.z);
    ped.state = 'walk';
  }
  mission.passenger = null;
}

function completeMission() {
  if (mission.kind === 'delivery') {
    const pay = 50000 + Math.ceil(mission.tLeft) * 1000;
    player.money += pay;
    toast(`Delivery complete — Rp ${pay.toLocaleString('en-US')}`);
  } else {
    const pay = 35000 + Math.ceil(mission.tLeft) * 500;
    player.money += pay;
    const stars = Math.min(5, 3 + RI(0, 2));
    toast(`Ride complete — Rp ${pay.toLocaleString('en-US')} · Passenger rating: ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`);
    dropPassenger(true);
  }
  sfxJingle();
  endMission();
}

export function cancelMission(reason) {
  if (!mission.active) return;
  if (mission.passenger) dropPassenger(false);
  toast(reason || 'Mission failed');
  endMission();
}

export function missionTarget() {
  if (!mission.active) return null;
  if (mission.phase === 'pickup' && mission.passenger)
    return { x: mission.passenger.x, z: mission.passenger.z };
  return { x: mission.destX, z: mission.destZ };
}

export function updateMissions(dt) {
  if (!mission.active) {
    mission.nextIn -= dt;
    if (mission.nextIn <= 0 && !player.dead) startMission();
    return;
  }
  const target = missionTarget();
  // Beacon follows the target.
  if (beacon && target) {
    beacon.visible = true;
    beacon.position.set(target.x, 21, target.z);
    beaconMat.color.setHex(mission.phase === 'pickup' ? 0x35c4ff : 0x2eff7a);
    beacon.rotation.y += dt * 0.8;
  }
  // The clock only runs while the player is in a car.
  if (player.car) mission.tLeft -= dt;
  if (mission.tLeft <= 0) { cancelMission('Mission failed — time up'); return; }

  const distT = target ? Math.hypot(target.x - player.x, target.z - player.z) : 0;
  if (G.hooks.setObjective) {
    const label = mission.kind === 'delivery' ? 'DELIVERY' : mission.phase === 'pickup' ? 'RIDE-HAIL · Pick up the passenger' : 'RIDE-HAIL · Drop off the passenger';
    G.hooks.setObjective(`${label} — ${Math.round(distT)} m — ${Math.max(0, Math.ceil(mission.tLeft))}s`);
  }

  if (mission.kind === 'delivery') {
    if (player.car && distT < 4.2) completeMission();
    return;
  }
  // Ride-hail phases.
  const ped = mission.passenger;
  if (!ped) { endMission(); return; }
  if (mission.phase === 'pickup') {
    if (ped.state === 'wait' && player.car && distT < 6.5 && Math.abs(player.car.speed) < 1.6) {
      ped.state = 'enter';
      sfxCash(0.35);
    } else if (ped.state === 'enter') {
      // The passenger walks to the car door.
      const dx = player.x - ped.x, dz = player.z - ped.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.8) {
        ped.state = 'riding';
        ped.group.visible = false;
        const dest = avenuePoint(200);
        mission.destX = dest.x; mission.destZ = dest.z;
        mission.phase = 'deliver';
        mission.tLeft = Math.hypot(dest.x - player.x, dest.z - player.z) / 12.5 + 25;
        toast('Passenger on board — drive to the destination');
      } else {
        ped.heading = Math.atan2(dx, dz);
        ped.x += Math.sin(ped.heading) * 3 * dt;
        ped.z += Math.cos(ped.heading) * 3 * dt;
        ped.group.position.set(ped.x, 0, ped.z);
        ped.group.rotation.y = ped.heading;
      }
    }
  } else if (mission.phase === 'deliver') {
    if (player.car && distT < 4.2) completeMission();
  }
}
