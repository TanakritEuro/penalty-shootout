import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { KeeperLevelName } from '../src/config';
import { createPitch, fire, seededRandom, type Pitch } from './helpers';

let pitch: Pitch;
beforeAll(async () => {
  pitch = await createPitch();
});
afterEach(() => vi.restoreAllMocks());

/** Save rate of the AI keeper against firm shots at varied targets. */
function saveRate(level: KeeperLevelName, shots: number, seed: number): number {
  const random = seededRandom(seed);
  vi.spyOn(Math, 'random').mockImplementation(random);
  let saves = 0;
  for (let i = 0; i < shots; i++) {
    const side = random() < 0.5 ? -1 : 1;
    const aim = { x: side * (0.8 + random() * 2.5), y: 0.3 + random() * 1.8 };
    if (fire(pitch, aim, { power: 0.7, level }).outcome.kind === 'saved') saves++;
  }
  vi.restoreAllMocks();
  return saves / shots;
}

describe('AI keeper', () => {
  it('saves more on harder levels, around a quarter on normal', () => {
    const easy = saveRate('easy', 120, 11);
    const normal = saveRate('normal', 120, 12);
    const hard = saveRate('hard', 120, 13);
    expect(easy).toBeLessThan(normal);
    expect(normal).toBeLessThan(hard);
    expect(normal).toBeGreaterThan(0.12);
    expect(normal).toBeLessThan(0.42);
  });
});

describe("Player's keeper", () => {
  it.each([
    [1.5, 1.2],
    [2.5, 2.0],
    [3.2, 0.3],
    [-3.2, 1.2],
  ])('a dive exactly to the ball at the strike saves it (%s, %s)', (x, y) => {
    // Regression: with the arms parallel overhead the gloves were further apart than the
    // ball, and shots straight at the hands went through.
    const { outcome } = fire(pitch, { x, y }, { power: 0.75, exact: true, playerDive: { x, y, at: 0 } });
    expect(outcome.kind).toBe('saved');
  });

  it('diving the wrong way concedes', () => {
    const { outcome } = fire(pitch, { x: 2.5, y: 1.0 }, { power: 0.75, exact: true, playerDive: { x: -3, y: 1.0, at: 0 } });
    expect(outcome.kind).toBe('goal');
  });

  it('reacting late saves less than getting the side right on time', () => {
    const random = seededRandom(21);
    vi.spyOn(Math, 'random').mockImplementation(random);
    let onTime = 0;
    let late = 0;
    const shots = 60;
    for (let i = 0; i < shots; i++) {
      const side = random() < 0.5 ? -1 : 1;
      const aim = { x: side * (1.6 + random() * 1.6), y: 0.3 + random() * 1.8 };
      const zone = { x: side * 3, y: aim.y > 1.45 ? 1.9 : aim.y < 0.65 ? 0.3 : 1.0 };
      if (fire(pitch, aim, { power: 0.8, playerDive: { ...zone, at: 0 } }).outcome.kind === 'saved') onTime++;
      if (fire(pitch, aim, { power: 0.8, playerDive: { ...zone, at: 0.3 } }).outcome.kind === 'saved') late++;
    }
    expect(onTime).toBeGreaterThan(late);
  });
});
