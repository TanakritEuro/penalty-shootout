const NUDGES: Record<string, { x: number; y: number }> = {
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
  KeyW: { x: 0, y: 1 },
  KeyS: { x: 0, y: -1 },
};

/**
 * W / A / S / D move the contact point on the ball before a shot. Presses are counted
 * between fixed steps and consumed by the kick while the player is aiming.
 */
export class SpinKeys {
  private dx = 0;
  private dy = 0;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const n = NUDGES[e.code];
      if (!n || e.repeat || e.target instanceof HTMLInputElement) return;
      this.dx += n.x;
      this.dy += n.y;
    });
  }

  /** Presses since the last call, in steps: (+1, 0) is one press of D. */
  consume(): { x: number; y: number } {
    const n = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return n;
  }
}
