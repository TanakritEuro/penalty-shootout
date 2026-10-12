import * as THREE from 'three';
import type { CrowdReaction } from './audio/sound';
import { TUNING } from './config';

/** One block of terracing: where its front edge starts, which way it faces, how wide and deep. */
interface StandSpec {
  /** Centre of the front (lowest) row, on the ground. */
  x: number;
  z: number;
  /** Rotation about y; a stand at yaw 0 faces +z (towards the pitch from behind the goal). */
  yaw: number;
  width: number;
  rows: number;
  /** Which end the fans mostly support: 'home' (the player's team), 'away' or 'mixed'. */
  fans: 'home' | 'away' | 'mixed';
}

const ROW_DEPTH = 0.9;
const ROW_RISE = 0.5;
const SEAT_SPACING = 0.62;
/** Front rows start this high (a wall in front of the first row). */
const FRONT_WALL = 1.2;

// Behind the goal, both touchlines, and the far end the keeper looks out at.
const STANDS: readonly StandSpec[] = [
  { x: 0, z: -14, yaw: 0, width: 64, rows: 18, fans: 'home' },
  { x: -33, z: 20, yaw: Math.PI / 2, width: 60, rows: 14, fans: 'mixed' },
  { x: 33, z: 20, yaw: -Math.PI / 2, width: 60, rows: 14, fans: 'mixed' },
  { x: 0, z: 52, yaw: Math.PI, width: 60, rows: 14, fans: 'away' },
];

// Invented sponsors only.
const SPONSORS = ['KESTREL AIR', 'COPPERLINE', 'GLASSWATER SPRINGS', 'THORNFIELD TYRES', 'LUMEN ENERGY', 'HARBOUR MUTUAL'];

/**
 * Everything around the pitch: terraced stands with an instanced crowd, advertising boards
 * and floodlight pylons. The crowd is one InstancedMesh animated in its vertex shader
 * (an idle sway, and jumping when excited), so thousands of fans cost one draw call.
 */
export class Stadium {
  readonly object = new THREE.Group();
  /** Bodies in team colours, and heads in skin tones: same placement, two draw calls. */
  private readonly crowd: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private readonly fans: ('home' | 'away' | 'mixed')[] = [];
  private readonly uniforms = { uTime: { value: 0 }, uExcite: { value: 0 }, uStand: { value: 0 } };
  private readonly floodlights: THREE.MeshStandardMaterial;
  private excite = 0;
  private stand = 0;

  /** @param density fraction of seats filled (0–1) */
  constructor(density = TUNING.stadium.crowdDensity) {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.95 });
    const seats: { matrix: THREE.Matrix4; fans: StandSpec['fans'] }[] = [];

    for (const spec of STANDS) {
      const stand = new THREE.Group();
      stand.position.set(spec.x, 0, spec.z);
      stand.rotation.y = spec.yaw;
      // Steps rise away from the pitch (towards local −z).
      for (let row = 0; row < spec.rows; row++) {
        const top = FRONT_WALL + row * ROW_RISE;
        const step = new THREE.Mesh(new THREE.BoxGeometry(spec.width, top, ROW_DEPTH), concrete);
        step.position.set(0, top / 2, -row * ROW_DEPTH - ROW_DEPTH / 2);
        stand.add(step);
        for (let x = -spec.width / 2 + SEAT_SPACING / 2; x < spec.width / 2; x += SEAT_SPACING) {
          if (Math.random() > density) continue;
          const local = new THREE.Vector3(x + (Math.random() - 0.5) * 0.12, top, -row * ROW_DEPTH - ROW_DEPTH * 0.45);
          stand.updateMatrix();
          const world = local.applyMatrix4(stand.matrix);
          const m = new THREE.Matrix4().compose(
            world,
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw + (Math.random() - 0.5) * 0.3),
            new THREE.Vector3(1, 0.9 + Math.random() * 0.2, 1),
          );
          seats.push({ matrix: m, fans: spec.fans });
        }
      }
      // A roof-less back wall so the stand doesn't look like a cut-out.
      const back = new THREE.Mesh(new THREE.BoxGeometry(spec.width, FRONT_WALL + spec.rows * ROW_RISE + 2, 0.5), concrete);
      back.position.set(0, (FRONT_WALL + spec.rows * ROW_RISE + 2) / 2, -spec.rows * ROW_DEPTH - 0.25);
      stand.add(back);
      this.object.add(stand);
    }

    // Shuffled, so showing fewer instances (Lite graphics) thins the crowd evenly everywhere.
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    const material = this.crowdMaterial();
    this.crowd = new THREE.InstancedMesh(fanBody(), material, seats.length);
    this.heads = new THREE.InstancedMesh(fanHead(), material, seats.length);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(seats.length), 1);
    const skin = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423].map((c) => new THREE.Color(c));
    seats.forEach((s, i) => {
      this.crowd.setMatrixAt(i, s.matrix);
      this.heads.setMatrixAt(i, s.matrix);
      this.heads.setColorAt(i, skin[Math.floor(Math.random() * skin.length)]);
      this.fans.push(s.fans);
      phase.setX(i, Math.random());
    });
    for (const mesh of [this.crowd, this.heads]) {
      mesh.geometry.setAttribute('aPhase', phase);
      mesh.frustumCulled = false;
      this.object.add(mesh);
    }

    this.object.add(adBoards());
    const lights = floodlights();
    this.floodlights = lights.material;
    this.object.add(lights.object);
  }

  /** Show only this fraction (0–1) of the fans: fewer to draw on weaker devices. */
  setDensity(fraction: number): void {
    const total = this.fans.length;
    this.crowd.count = this.heads.count = Math.round(total * Math.min(1, Math.max(0, fraction)));
  }

  /** Number of fans in the stands. */
  get size(): number {
    return this.crowd.count;
  }

  /** Dress the crowd: mostly the home team's colour behind the goal, the away team's at the far end. */
  setTeams(home: string, away: string): void {
    const homeColour = new THREE.Color(home);
    const awayColour = new THREE.Color(away);
    const neutral = [0xe8e8e8, 0x2b2b2b, 0x3d5a80, 0x8d6e63].map((c) => new THREE.Color(c));
    const c = new THREE.Color();
    this.fans.forEach((fans, i) => {
      const r = Math.random();
      const share = fans === 'home' ? 0.75 : fans === 'away' ? 0.15 : 0.45;
      if (r < share) c.copy(homeColour);
      else if (r < share + (fans === 'away' ? 0.6 : 0.3)) c.copy(awayColour);
      else c.copy(neutral[Math.floor(Math.random() * neutral.length)]);
      c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.12);
      this.crowd.setColorAt(i, c);
    });
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
  }

  /** Light the floodlight heads at night. */
  setNight(night: boolean): void {
    this.floodlights.emissive.setHex(night ? 0xfafcff : 0x000000);
    this.floodlights.color.setHex(night ? 0xffffff : 0xb9bec5);
  }

  /** The crowd follows the same reactions as the crowd noise. */
  react(kind: CrowdReaction): void {
    if (kind === 'cheer' || kind === 'roar') this.excite = kind === 'roar' ? 1.4 : 1;
    if (kind === 'ooh') this.stand = 1;
  }

  /** Advance the crowd's animation by `dt` real seconds. */
  update(dt: number): void {
    this.uniforms.uTime.value += dt;
    this.excite = Math.max(0, this.excite - dt * 0.45);
    this.stand = Math.max(0, this.stand - dt * 0.8);
    this.uniforms.uExcite.value = Math.min(1, this.excite);
    this.uniforms.uStand.value = this.stand;
  }

  /** Standard lit material, with the fans' motion added in the vertex shader. */
  private crowdMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute float aPhase;
          uniform float uTime;
          uniform float uExcite;
          uniform float uStand;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          // Idle: a gentle sway. Excited: jumping, each fan to their own beat. "Ooh": half rise.
          float sway = sin(uTime * 1.3 + aPhase * 40.0) * 0.03;
          float jump = max(0.0, sin(uTime * (8.0 + aPhase * 3.0) + aPhase * 6.28)) * 0.45 * uExcite;
          transformed.y += jump + uStand * 0.25 * (0.6 + 0.4 * aPhase);
          transformed.x += sway * (transformed.y);`,
        );
    };
    return material;
  }
}

/** A seated fan's body (shirt), about 0.75 m from seat to shoulders. */
function fanBody(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(0.2, 0.35, 1, 5).translate(0, 0.38, 0);
}

/** A fan's head, sitting on the body. */
function fanHead(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.13, 5, 3).translate(0, 0.86, 0);
}

/** Boards behind the goal and along the touchlines with invented sponsors' names. */
function adBoards(): THREE.Group {
  const group = new THREE.Group();
  const boards: { x: number; z: number; yaw: number; width: number }[] = [];
  // Behind the goal, beyond the back of the net (2 m deep).
  for (let i = -3; i <= 2; i++) boards.push({ x: i * 6 + 3, z: -7, yaw: 0, width: 5.8 });
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) boards.push({ x: side * 22, z: 2 + i * 6, yaw: -side * (Math.PI / 2), width: 5.8 });

  boards.forEach((b, i) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.width, 0.9, 0.15),
      new THREE.MeshStandardMaterial({ map: boardTexture(SPONSORS[i % SPONSORS.length], i), roughness: 0.6 }),
    );
    mesh.position.set(b.x, 0.45, b.z);
    mesh.rotation.y = b.yaw;
    group.add(mesh);
  });
  return group;
}

const BOARD_COLOURS = [
  ['#0b3d91', '#ffffff'],
  ['#f4d35e', '#1b1b1f'],
  ['#d62828', '#ffffff'],
  ['#2a9d8f', '#ffffff'],
  ['#1b1b1f', '#f4d35e'],
  ['#ffffff', '#0b3d91'],
];

function boardTexture(text: string, i: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 80;
  const ctx = canvas.getContext('2d')!;
  const [bg, fg] = BOARD_COLOURS[i % BOARD_COLOURS.length];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Four pylons at the corners, with a bank of lamps on top. */
function floodlights(): { object: THREE.Group; material: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x6c737a, roughness: 0.6, metalness: 0.4 });
  const lamps = new THREE.MeshStandardMaterial({ color: 0xb9bec5, roughness: 0.4 });
  for (const [x, z] of [
    [-34, -16],
    [34, -16],
    [-34, 56],
    [34, 56],
  ]) {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.6, 32, 8), steel);
    mast.position.set(x, 16, z);
    const head = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), lamps);
    head.position.set(x, 32.5, z);
    // Tilt the lamps down towards the pitch centre.
    head.lookAt(0, 0, 20);
    group.add(mast, head);
  }
  return { object: group, material: lamps };
}
