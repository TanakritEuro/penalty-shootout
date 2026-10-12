import type * as THREE from 'three';
import { TUNING } from '../config';
import { aimFromPointer } from '../shooting/aim';
import { CENTRE, nudgeContact, type Contact } from '../shooting/spin';
import type { PointerInput } from './pointer';
import type { SpinKeys } from './spinKeys';

/** The shooter let go of the button. `power` is set when they measured it themselves. */
export interface Release {
  power: number | null;
}

/**
 * Whoever is taking a human kick, as the Kick sees them: presses, releases and cancels
 * latched between fixed steps, where they're aiming and where they'll strike the ball.
 * The local mouse and keyboard are one; a player on another device is another.
 */
export interface ShooterControls {
  /** Forget anything latched so far (a new kick is starting). */
  clear(): void;
  consumePress(): boolean;
  consumeRelease(): Release | null;
  consumeCancel(): boolean;
  /** Where the shooter is aiming on the goal line, as seen through `camera`, into `out`. */
  aim(camera: THREE.Camera, out: THREE.Vector2): void;
  /** Where they will strike the ball (W / A / S / D or a tap), after this step's input. */
  contact(): Contact;
}

/** The mouse (or finger) and the W / A / S / D keys on this device. */
export class LocalShooter implements ShooterControls {
  /** Where this player strikes the ball; kept from kick to kick, and set directly by a tap. */
  point: Contact = CENTRE;

  constructor(
    private readonly pointer: PointerInput,
    private readonly spinKeys: SpinKeys,
  ) {}

  clear(): void {
    this.pointer.consumePress();
    this.pointer.consumeRelease();
    this.pointer.consumeCancel();
    this.spinKeys.consume(); // W / A / S / D pressed between kicks don't count
  }

  consumePress(): boolean {
    return this.pointer.consumePress();
  }

  consumeRelease(): Release | null {
    return this.pointer.consumeRelease() ? { power: null } : null;
  }

  consumeCancel(): boolean {
    return this.pointer.consumeCancel();
  }

  aim(camera: THREE.Camera, out: THREE.Vector2): void {
    aimFromPointer(this.pointer.ndc, camera, out);
  }

  contact(): Contact {
    const n = this.spinKeys.consume();
    if (n.x || n.y) this.point = nudgeContact(this.point, n.x * TUNING.spin.nudge, n.y * TUNING.spin.nudge);
    return this.point;
  }
}
