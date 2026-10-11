import type { Director } from '../camera/director';
import type { Net, Ripple } from '../net';
import type { Clip, Recorder } from './recorder';

/**
 * Plays recorded clips back: one kick's replay, or a highlights reel of several in a row.
 * Each clip runs from just before its strike to its result, from the director's replay
 * camera facing the side the ball went. While it runs the game is frozen (the caller stops
 * stepping physics) and the live scene is restored when it ends.
 */
export class Replay {
  private clips: Clip[] = [];
  private index = 0;
  private time = 0;
  private speed = 1;
  private liveRipples: Ripple[] = [];
  private playing = false;

  constructor(
    private readonly recorder: Recorder,
    private readonly director: Director,
    private readonly net: Net,
  ) {}

  get active(): boolean {
    return this.playing;
  }

  /** What the current clip shows, and where it is in the reel ("2 / 7"), for the HUD. */
  get caption(): string {
    const clip = this.clips[this.index];
    if (!clip) return '';
    return this.clips.length > 1 ? `${this.index + 1} / ${this.clips.length} · ${clip.caption}` : clip.caption;
  }

  /** Play `clips` in order at `speed` (fraction of real time). */
  play(clips: Clip[], speed: number): boolean {
    if (this.playing || clips.length === 0) return false;
    this.clips = clips;
    this.speed = speed;
    this.liveRipples = this.net.snapshot();
    this.playing = true;
    this.startClip(0);
    return true;
  }

  /** Advance by real seconds; poses the scene. Returns false once everything has played. */
  update(realDt: number): boolean {
    if (!this.playing) return false;
    const clip = this.clips[this.index];
    this.time += realDt * this.speed;
    this.recorder.apply(clip, this.time);
    // Hold each clip's last frame for a moment before moving on.
    if (this.time >= clip.end + 0.4) {
      if (this.index + 1 < this.clips.length) this.startClip(this.index + 1);
      else this.finish();
    }
    return this.playing;
  }

  finish(): void {
    if (!this.playing) return;
    this.playing = false;
    this.director.endReplay();
    this.net.restore(this.liveRipples);
  }

  private startClip(i: number): void {
    this.index = i;
    const clip = this.clips[i];
    this.time = clip.start;
    this.director.endReplay();
    this.director.beginReplay(clip.side);
    this.recorder.apply(clip, this.time);
  }
}
