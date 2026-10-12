import { TUNING } from '../config';
import type { Kick, KickState } from '../match/kick';
import type { Match } from '../match/match';
import type { Shootout } from '../match/shootout';
import { TEAMS } from '../match/teams';
import type { Recorder, Clip } from '../replay/recorder';
import type { Replay } from '../replay/replay';
import { describeOutcome } from '../shooting/outcome';

/**
 * Replay bookkeeping: records each kick as it moves through its states, keeps one clip
 * per kick of the current shootout, and decides what the replay button offers: the last
 * kick in slow motion while its result is up, every kick as highlights after the final
 * whistle.
 */
export class Replays {
  private lastKickState: KickState['kind'];
  /** One clip per kick of the current shootout, for the highlights. */
  private highlights: Clip[] = [];
  private highlightsOf: Shootout | null = null;
  /** Caption for the kick being recorded, set when its result comes in. */
  private caption = '';

  constructor(
    private readonly match: Match,
    private readonly kick: Kick,
    private readonly recorder: Recorder,
    readonly replay: Replay,
  ) {
    this.lastKickState = kick.state.kind;
  }

  /** What the replay button can do right now. */
  get offer(): 'replay' | 'highlights' | null {
    if (this.match.state.kind === 'finished' && this.highlights.length > 0) return 'highlights';
    if (this.kick.state.kind === 'result') return 'replay';
    return null;
  }

  /** Start (or stop) whatever the button offers. */
  toggle(): void {
    if (this.replay.active) {
      this.replay.finish();
      return;
    }
    const D = TUNING.director;
    const offer = this.offer;
    if (offer === 'highlights') {
      this.replay.play(this.highlights, D.highlightSpeed);
    } else if (offer === 'replay') {
      const clip = this.recorder.clip(D.replayLead, this.caption);
      if (clip) this.replay.play([clip], D.replaySpeed);
    }
  }

  /**
   * Call each live frame after the scene is updated: starts, marks and closes recordings
   * as the kick changes state, then captures the frame.
   */
  record(gameDt: number): void {
    this.track();
    this.recorder.capture(gameDt);
  }

  private track(): void {
    if (this.match.shootout !== this.highlightsOf) {
      this.highlights = [];
      this.highlightsOf = this.match.shootout;
    }
    const k = this.kick.state;
    if (k.kind === this.lastKickState) return;
    if (k.kind === 'result') this.caption = `${TEAMS[this.kick.shooter].name}: ${describeOutcome(k.outcome)}`;
    // Leaving a result (to the next kick, or the end) closes that kick's clip. The next kick
    // can start within the same physics step, so this can't wait for 'nextKick'.
    if (this.lastKickState === 'result') {
      const clip = this.recorder.clip(TUNING.director.replayLead, this.caption);
      if (clip) this.highlights.push(clip);
      this.recorder.stop();
    }
    if (k.kind === 'aiming' || k.kind === 'cpuRunUp') this.recorder.start();
    if (k.kind === 'ballInFlight') this.recorder.markStrike();
    this.lastKickState = k.kind;
  }
}
