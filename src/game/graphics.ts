import * as THREE from 'three';
import type { Stadium } from '../stadium';

const KEY = 'penalty-shootout:lite';

/**
 * The saved graphics choice, or Lite by default on touch devices (phones and tablets are
 * the likeliest to struggle). Storage may be unavailable; then it's just the default.
 */
export function savedLite(): boolean {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) return stored === '1';
  } catch {
    // Fall through to the default.
  }
  return window.matchMedia('(pointer: coarse)').matches;
}

export function saveLite(lite: boolean): void {
  try {
    localStorage.setItem(KEY, lite ? '1' : '0');
  } catch {
    // The choice just won't be remembered.
  }
}

/**
 * Full graphics: native resolution (up to 2×), shadows, a full crowd. Lite: 1× resolution,
 * no shadows and about half the crowd.
 */
export function applyGraphics(renderer: THREE.WebGLRenderer, scene: THREE.Scene, stadium: Stadium, lite: boolean): void {
  renderer.setPixelRatio(lite ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (renderer.shadowMap.enabled === lite) {
    renderer.shadowMap.enabled = !lite;
    // Materials compile their shadow code in or out, so they need rebuilding.
    scene.traverse((o) => {
      const material = (o as THREE.Mesh).material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true;
    });
  }
  stadium.setDensity(lite ? 0.5 : 1);
}
