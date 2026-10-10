import * as THREE from 'three';

/**
 * Mouse state for shooting. DOM events arrive between frames, so presses and releases
 * are latched here and consumed by the fixed-step game logic.
 */
export class PointerInput {
  /** Pointer position in normalised device coordinates (−1…1, +Y up). */
  readonly ndc = new THREE.Vector2(0, 0);
  private pressed = false;
  private released = false;
  private cancelled = false;

  constructor(element: HTMLElement) {
    element.addEventListener('pointermove', (e) => this.track(e));
    element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.track(e);
      this.pressed = true;
      // Keep receiving the release even if the pointer leaves the canvas while charging.
      element.setPointerCapture(e.pointerId);
    });
    element.addEventListener('pointerup', (e) => {
      if (e.button !== 0) return;
      this.track(e);
      this.released = true;
    });
    element.addEventListener('pointercancel', () => (this.cancelled = true));
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => (this.cancelled = true));
  }

  /** True once per press of the left button. */
  consumePress(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  /** True once per release of the left button. */
  consumeRelease(): boolean {
    const r = this.released;
    this.released = false;
    return r;
  }

  /** True once if the press was interrupted (window lost focus, pointer cancelled). */
  consumeCancel(): boolean {
    const c = this.cancelled;
    this.cancelled = false;
    return c;
  }

  private track(e: PointerEvent): void {
    this.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  }
}
