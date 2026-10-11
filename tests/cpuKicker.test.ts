import { afterEach, describe, expect, it, vi } from 'vitest';
import { TUNING } from '../src/config';
import { chooseCpuShot, counterKeeper } from '../src/shooting/cpuKicker';
import { seededRandom } from './helpers';

afterEach(() => vi.restoreAllMocks());

describe('CPU kicker', () => {
  it('picks targets inside its configured ranges', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(1));
    const C = TUNING.cpuKicker;
    for (let i = 0; i < 500; i++) {
      const s = chooseCpuShot();
      expect(Math.abs(s.aim.x)).toBeLessThanOrEqual(C.maxSideX);
      expect(s.aim.y).toBeGreaterThanOrEqual(C.minY);
      expect(s.aim.y).toBeLessThanOrEqual(C.maxY);
      expect(s.power).toBeGreaterThanOrEqual(C.minPower);
      expect(s.power).toBeLessThanOrEqual(C.maxPower);
    }
  });

  it('puts it the other way when the keeper goes early', () => {
    vi.spyOn(Math, 'random').mockImplementation(seededRandom(2));
    for (let i = 0; i < 100; i++) {
      const shot = chooseCpuShot();
      expect(counterKeeper(shot, 2.5).aim.x).toBeLessThan(0);
      expect(counterKeeper(shot, -2.5).aim.x).toBeGreaterThan(0);
      // Only the side changes: same height, power and strike.
      const c = counterKeeper(shot, 2.5);
      expect(c.aim.y).toBe(shot.aim.y);
      expect(c.power).toBe(shot.power);
      expect(c.contact).toEqual(shot.contact);
    }
  });
});
