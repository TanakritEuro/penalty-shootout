import type { Director } from '../camera/director';
import { TUNING } from '../config';
import type { Net, Ripple } from '../net';
import type { Recorder } from './recorder';

/**
 * Plays back the last kick from the Recorder: from just before the strike to the result,
 * at reduced speed, from the director's replay camera. While it runs the game is frozen
 * (the caller stops stepping physics) and the live scene is restored when it ends.
 */
export class Replay {
  private time = 0;
  private end = 0;
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

  /** True if there is a kick to replay. */
  get available(): boolean {
    return this.recorder.span(TUNING.director.replayLead) !== null;
  }

  begin(): boolean {
    const span = this.recorder.span(TUNING.director.replayLead);
    if (!span || this.playing) return false;
    this.time = span.start;
    // Hold the last frame for a moment before handing back.
    this.end = span.end + 0.4;
    this.liveRipples = this.net.snapshot();
    this.director.beginReplay();
    this.playing = true;
    this.recorder.apply(this.time);
    return true;
  }

  /** Advance by real seconds; poses the scene. Returns false once it has finished. */
  update(realDt: number): boolean {
    if (!this.playing) return false;
    this.time += realDt * TUNING.director.replaySpeed;
    this.recorder.apply(this.time);
    if (this.time >= this.end) this.finish();
    return this.playing;
  }

  finish(): void {
    if (!this.playing) return;
    this.playing = false;
    this.director.endReplay();
    this.net.restore(this.liveRipples);
  }
}
