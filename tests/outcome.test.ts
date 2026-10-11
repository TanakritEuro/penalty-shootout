import { beforeAll, describe, expect, it } from 'vitest';
import { GOAL_HEIGHT, GOAL_WIDTH, POST_RADIUS } from '../src/constants';
import { describeOutcome } from '../src/shooting/outcome';
import { createPitch, fire, type Pitch } from './helpers';

let pitch: Pitch;
beforeAll(async () => {
  pitch = await createPitch();
});

const postX = GOAL_WIDTH / 2 + POST_RADIUS;
const barY = GOAL_HEIGHT + POST_RADIUS;

describe('Shot outcomes (keeper standing still in the middle)', () => {
  it.each([
    ['in the corner', { x: 2.6, y: 1.6 }, 'GOAL!'],
    ['wide of the post', { x: 5.0, y: 1.0 }, 'Wide!'],
    ['over the bar', { x: 0, y: 3.3 }, 'Over the bar!'],
    ['high and wide', { x: 5.0, y: 3.3 }, 'High and wide!'],
    ['straight at the post', { x: postX, y: 1.2 }, 'Off the post!'],
    ['straight at the bar', { x: 1.8, y: barY + 0.04 }, 'Off the bar!'],
    ['inside of the post', { x: postX - 0.12, y: 1.2 }, 'GOAL! In off the post'],
    // Ball centre 0.14 m below the bar's: it grazes the underside and is deflected down and in.
    ['underside of the bar', { x: 1.0, y: barY - 0.14 }, 'GOAL! In off the bar'],
  ])('%s', (_, aim, expected) => {
    const { outcome } = fire(pitch, aim, { power: 0.7, exact: true });
    expect(describeOutcome(outcome)).toBe(expected);
  });

  it('a weak shot straight at the keeper is saved', () => {
    const { outcome } = fire(pitch, { x: 0, y: 0.9 }, { power: 0.3, exact: true });
    expect(outcome.kind).toBe('saved');
  });
});
