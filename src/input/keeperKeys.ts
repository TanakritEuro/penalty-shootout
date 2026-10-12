import { TUNING } from '../config';

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;
type Arrow = (typeof ARROWS)[number];

/**
 * Arrow-key dives for the player's keeper. The first arrow opens a short window so that
 * two keys pressed together (e.g. ← and ↑) make one diagonal dive.
 */
export class KeeperKeys {
  private readonly pressed = new Set<Arrow>();
  /** Seconds since the first arrow of a pending dive, or null if none is pending. */
  private pendingFor: number | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Not while typing (a room code in the menu).
      if (!isArrow(e.code) || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      if (e.repeat) return;
      this.pressed.add(e.code);
      this.pendingFor ??= 0;
    });
  }

  /** Forget anything pressed so far (e.g. arrows mashed during the player's own kick). */
  clear(): void {
    this.pressed.clear();
    this.pendingFor = null;
  }

  /**
   * Advance by `dt` and return the dive target (x, y on the goal line) once a dive is
   * complete, consuming it; null otherwise.
   */
  consumeDive(dt: number): { x: number; y: number } | null {
    if (this.pendingFor === null) return null;
    this.pendingFor += dt;
    if (this.pendingFor < TUNING.playerKeeper.comboWindow) return null;

    const P = TUNING.playerKeeper;
    const k = this.pressed;
    // ← / → pick a side (neither: stay central), ↑ / ↓ pick high / low; ↑ alone jumps, ↓ alone gets down.
    const x = (k.has('ArrowRight') ? P.arrowX : 0) - (k.has('ArrowLeft') ? P.arrowX : 0);
    const y = k.has('ArrowUp') && !k.has('ArrowDown') ? P.highY : k.has('ArrowDown') && !k.has('ArrowUp') ? P.lowY : P.midY;
    this.clear();
    return { x, y };
  }
}

function isArrow(code: string): code is Arrow {
  return (ARROWS as readonly string[]).includes(code);
}
