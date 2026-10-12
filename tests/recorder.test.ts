import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Net } from '../src/net';
import { Recorder } from '../src/replay/recorder';

/** A "ball" and a two-joint "figure" with a mesh hanging off one joint. */
function scene() {
  const ball = new THREE.Object3D();
  const figure = new THREE.Group();
  const arm = new THREE.Group();
  arm.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1)));
  figure.add(arm);
  const net = new Net();
  const recorder = new Recorder([ball, figure], net);
  return { ball, figure, arm, net, recorder };
}

describe('Recorder', () => {
  it('plays back recorded transforms, interpolating between frames', () => {
    const { ball, arm, recorder } = scene();
    recorder.start();
    for (let i = 0; i <= 10; i++) {
      ball.position.set(i, 0, -i);
      arm.rotation.z = i * 0.1;
      recorder.capture(0.1);
    }
    const clip = recorder.clip(10)!;
    // Scramble the live scene, then pose it from the recording.
    ball.position.set(99, 99, 99);
    arm.rotation.z = 3;
    recorder.apply(clip, clip.start + 0.45);
    expect(ball.position.x).toBeCloseTo(4.5, 5);
    expect(ball.position.z).toBeCloseTo(-4.5, 5);
    expect(arm.rotation.z).toBeCloseTo(0.45, 3);
  });

  it('a clip starts `lead` seconds before the strike and knows which side the ball went', () => {
    const { ball, recorder } = scene();
    recorder.start();
    for (let i = 0; i < 30; i++) {
      if (i === 20) recorder.markStrike();
      ball.position.set(-0.1 * i, 0, 0);
      recorder.capture(0.1);
    }
    const clip = recorder.clip(1.0, 'caption')!;
    expect(clip.start).toBeCloseTo(1.0, 5); // strike at 2.0 s on the recording clock
    expect(clip.end).toBeCloseTo(3.0, 5);
    expect(clip.side).toBe(-1);
    expect(clip.caption).toBe('caption');
  });

  it('records nothing until started, and nothing new while paused', () => {
    const { recorder } = scene();
    recorder.capture(0.1);
    expect(recorder.clip(1)).toBeNull();
    recorder.start();
    recorder.capture(0.1);
    recorder.capture(0); // paused frame
    recorder.capture(0);
    recorder.capture(0.1);
    expect(recorder.clip(10)!.frames).toHaveLength(2);
  });

  it('brings the net ripple back too', () => {
    const { net, recorder } = scene();
    recorder.start();
    recorder.capture(0.1);
    net.hit({ x: 0, y: 1, z: -2 }, 25);
    recorder.capture(0.1);
    const clip = recorder.clip(10)!;
    net.restore([]);
    recorder.apply(clip, clip.end);
    expect(net.snapshot()).toHaveLength(1);
  });
});
