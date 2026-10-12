import * as THREE from 'three';
import { TUNING } from './config';
import { Net } from './net';
import {
  BALL_RADIUS,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_HALF_WIDTH,
  PENALTY_ARC_RADIUS,
  PENALTY_SPOT_Z,
  POST_RADIUS,
  SIX_YARD_DEPTH,
  SIX_YARD_HALF_WIDTH,
} from './constants';

export interface GameScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh;
  net: Net;
  /** Daylight, or a dark sky under floodlights. */
  setNight(night: boolean): void;
}

const DAY = { fogNear: 60, fogFar: 140, sky: 0x87b5e0, hemiSky: 0xdfefff, hemiGround: 0x2d5a27, hemi: 0.9, sun: 0xffffff, sunIntensity: 2.2 };
const NIGHT = { fogNear: 18, fogFar: 85, sky: 0x0a1428, hemiSky: 0x6f7fa6, hemiGround: 0x16301a, hemi: 0.45, sun: 0xf1f4ff, sunIntensity: 2.6 };

export function createScene(canvas: HTMLCanvasElement): GameScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5e0);
  scene.fog = new THREE.Fog(0x87b5e0, 60, 140);

  // Low camera just behind the kicker: the goal fills the view, the ball stays in shot below it.
  const cam = TUNING.camera;
  const camera = new THREE.PerspectiveCamera(cam.fov, window.innerWidth / window.innerHeight, 0.1, 300);
  camera.position.set(0, cam.height, PENALTY_SPOT_Z + cam.behindSpot);
  camera.lookAt(0, cam.lookAtHeight, 0);

  const lights = addLights(scene);
  scene.add(createPitch());
  scene.add(createMarkings());
  scene.add(createGoal());
  const net = new Net();
  scene.add(net.object);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }),
  );
  ball.castShadow = true;
  scene.add(ball);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const setNight = (night: boolean) => {
    const L = night ? NIGHT : DAY;
    (scene.background as THREE.Color).setHex(L.sky);
    const fog = scene.fog as THREE.Fog;
    fog.color.setHex(L.sky);
    // At night the stands fade into the dark beyond the floodlit pitch.
    fog.near = L.fogNear;
    fog.far = L.fogFar;
    lights.hemi.color.setHex(L.hemiSky);
    lights.hemi.groundColor.setHex(L.hemiGround);
    lights.hemi.intensity = L.hemi;
    // At night the "sun" stands in for the floodlights: same shadows, cooler light.
    lights.sun.color.setHex(L.sun);
    lights.sun.intensity = L.sunIntensity;
  };

  return { renderer, scene, camera, ball, net, setNight };
}

function addLights(scene: THREE.Scene): { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(12, 25, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -20;
  s.right = 20;
  s.top = 20;
  s.bottom = -20;
  s.near = 1;
  s.far = 80;
  scene.add(sun);
  return { hemi, sun };
}

/** Grass with mown stripes, drawn to a canvas texture so no image assets are needed. */
function createPitch(): THREE.Mesh {
  const stripes = 12;
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = stripes * 16;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#3f8f3a' : '#367f32';
    ctx.fillRect(0, i * 16, canvas.width, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;

  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.z = 20;
  pitch.receiveShadow = true;
  return pitch;
}

function createMarkings(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
  const lineWidth = 0.12;
  const y = 0.005;

  const line = (x1: number, z1: number, x2: number, z2: number) => {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lineWidth, length), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.atan2(x2 - x1, z2 - z1);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    group.add(mesh);
  };

  // Goal line
  line(-40, 0, 40, 0);
  // Six-yard box
  line(-SIX_YARD_HALF_WIDTH, 0, -SIX_YARD_HALF_WIDTH, SIX_YARD_DEPTH);
  line(SIX_YARD_HALF_WIDTH, 0, SIX_YARD_HALF_WIDTH, SIX_YARD_DEPTH);
  line(-SIX_YARD_HALF_WIDTH, SIX_YARD_DEPTH, SIX_YARD_HALF_WIDTH, SIX_YARD_DEPTH);
  // Penalty area
  line(-PENALTY_AREA_HALF_WIDTH, 0, -PENALTY_AREA_HALF_WIDTH, PENALTY_AREA_DEPTH);
  line(PENALTY_AREA_HALF_WIDTH, 0, PENALTY_AREA_HALF_WIDTH, PENALTY_AREA_DEPTH);
  line(-PENALTY_AREA_HALF_WIDTH, PENALTY_AREA_DEPTH, PENALTY_AREA_HALF_WIDTH, PENALTY_AREA_DEPTH);

  // Penalty spot
  const spot = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), mat);
  spot.rotation.x = -Math.PI / 2;
  spot.position.set(0, y, PENALTY_SPOT_Z);
  group.add(spot);

  // Penalty arc: the part of the 9.15 m circle outside the penalty area
  const halfAngle = Math.acos((PENALTY_AREA_DEPTH - PENALTY_SPOT_Z) / PENALTY_ARC_RADIUS);
  const arc = new THREE.Mesh(
    new THREE.RingGeometry(
      PENALTY_ARC_RADIUS - lineWidth / 2,
      PENALTY_ARC_RADIUS + lineWidth / 2,
      48,
      1,
      -Math.PI / 2 - halfAngle,
      halfAngle * 2,
    ),
    mat,
  );
  arc.rotation.x = -Math.PI / 2;
  arc.position.set(0, y, PENALTY_SPOT_Z);
  group.add(arc);

  return group;
}

function createGoal(): THREE.Group {
  const group = new THREE.Group();
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
  const topY = GOAL_HEIGHT + POST_RADIUS;

  const postGeo = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, topY, 16);
  for (const x of [-halfW, halfW]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, topY / 2, 0);
    post.castShadow = true;
    group.add(post);
  }

  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, halfW * 2 + POST_RADIUS * 2, 16),
    frameMat,
  );
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, GOAL_HEIGHT + POST_RADIUS, 0);
  bar.castShadow = true;
  group.add(bar);

  return group;
}
