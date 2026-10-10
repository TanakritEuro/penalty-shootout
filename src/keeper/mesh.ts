import * as THREE from 'three';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_LINE_OFFSET,
  KEEPER_RADIUS,
} from '../constants';
import { armLocal, type Keeper } from './keeper';

// Placeholder kit: the shirt colour is set per team (see match/teams.ts).
const SHORTS = 0x1b1b1f;
const SKIN = 0xc98e62;
const GLOVES = 0xf2f2f2;

/** Placeholder keeper made of capsules. It copies its transform from the physics body. */
export class KeeperMesh {
  readonly object = new THREE.Group();
  private readonly arms: THREE.Group[] = [];
  private readonly shirt = material(0xffffff);

  constructor(private readonly keeper: Keeper) {
    const part = (geometry: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.y = y;
      mesh.castShadow = true;
      this.object.add(mesh);
      return mesh;
    };

    const legLength = 0.9;
    part(new THREE.CapsuleGeometry(KEEPER_RADIUS * 0.9, legLength - KEEPER_RADIUS * 1.8, 6, 12), material(SHORTS), legLength / 2);
    const torsoLength = 0.72;
    const torsoBase = legLength - 0.05;
    part(new THREE.CapsuleGeometry(KEEPER_RADIUS, torsoLength - KEEPER_RADIUS * 2, 6, 12), this.shirt, torsoBase + torsoLength / 2);
    const headRadius = 0.12;
    part(new THREE.SphereGeometry(headRadius, 16, 12), material(SKIN), KEEPER_HEIGHT - headRadius);

    // Each arm is a group pivoting at the arm's centre; a glove sits at the far end.
    const sleeve = new THREE.CapsuleGeometry(0.06, KEEPER_ARM_LENGTH - 0.12 - KEEPER_HAND_RADIUS * 2, 4, 8);
    const glove = new THREE.SphereGeometry(KEEPER_HAND_RADIUS, 12, 10);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Group();
      const s = new THREE.Mesh(sleeve, this.shirt);
      s.position.y = -KEEPER_HAND_RADIUS;
      const g = new THREE.Mesh(glove, material(GLOVES));
      g.position.y = KEEPER_ARM_LENGTH / 2 - KEEPER_HAND_RADIUS;
      s.castShadow = g.castShadow = true;
      arm.add(s, g);
      this.arms.push(arm);
      this.object.add(arm);
    }
    this.object.position.z = KEEPER_LINE_OFFSET;
  }

  setShirt(colour: number): void {
    this.shirt.color.setHex(colour);
  }

  update(): void {
    const t = this.keeper.body.translation();
    const r = this.keeper.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);

    const angle = this.keeper.pose.arms;
    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const a = armLocal(side, angle);
      arm.position.set(a.x, a.y, 0);
      arm.rotation.z = -side * angle;
    });
  }
}

function material(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
}
