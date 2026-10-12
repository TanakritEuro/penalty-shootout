/** The first-time tips, in the order a new player meets them. */
export type HintId = 'shoot' | 'power' | 'spin' | 'keep' | 'replay';

const KEY = 'penalty-shootout:hints';
/** A tip retires after showing on this many occasions, even if the player never acts on it. */
const MAX_SHOWINGS = 2;
/** Stored for a tip the player has acted on. */
const LEARNED = 99;

/** Each tip for keyboard and mouse, and for touch. `<b>` marks the controls. */
const TEXT: Record<HintId, { keys: string; touch: string }> = {
  shoot: {
    keys: '<b>Move the mouse</b> to aim, <b>hold the button</b> to power up, <b>let go</b> to shoot',
    touch: '<b>Drag</b> to aim, <b>hold</b> to power up, <b>lift</b> to shoot',
  },
  power: {
    keys: 'Let go in the <b>bright band</b>: full pace, still on target. Into the red, it flies high and wide',
    touch: 'Lift in the <b>bright band</b>: full pace, still on target. Into the red, it flies high and wide',
  },
  spin: {
    keys: '<b>W A S D</b> strike the ball off-centre to curl it round the keeper',
    touch: '<b>Tap the little ball</b> to strike it off-centre and curl it round the keeper',
  },
  keep: {
    keys: "You're in goal. Watch the kicker's hips and dive as the ball is struck: <b>arrow keys</b> or <b>click</b> where to go",
    touch: "You're in goal. Watch the kicker's hips and <b>tap where to dive</b> as the ball is struck",
  },
  replay: {
    keys: '<b>Space</b> watches that again in slow motion',
    touch: 'Tap <b>▶ Replay</b> to watch that again in slow motion',
  },
};

/**
 * First-time tips: one at a time, above the power meter. Each is shown until the player
 * does what it teaches (`learned`) or it has come up `MAX_SHOWINGS` times, and then never
 * again in this browser.
 */
export class Hints {
  private readonly el = document.getElementById('hint') as HTMLDivElement;
  private readonly touch = window.matchMedia('(pointer: coarse)').matches;
  private readonly counts: Partial<Record<HintId, number>>;
  private showing: HintId | null = null;

  /** `reset`: forget which tips have been seen (the `?hints` debug flag). */
  constructor(reset = false) {
    this.counts = reset ? {} : read();
  }

  /** Show `id` (null: no tip), unless it has retired. Showing it again later counts again. */
  show(id: HintId | null): void {
    if (id === this.showing) return;
    if (id !== null && (this.counts[id] ?? 0) >= MAX_SHOWINGS) id = null;
    this.showing = id;
    this.el.hidden = id === null;
    if (id === null) return;
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    write(this.counts);
    this.el.innerHTML = this.touch ? TEXT[id].touch : TEXT[id].keys;
  }

  /** The player has done what these tips teach: retire them. */
  learned(...ids: HintId[]): void {
    for (const id of ids) {
      if (this.counts[id] === LEARNED) continue;
      this.counts[id] = LEARNED;
      write(this.counts);
      if (this.showing === id) this.show(null);
    }
  }

  /** True once `id` will never show again. */
  retired(id: HintId): boolean {
    return (this.counts[id] ?? 0) >= MAX_SHOWINGS;
  }
}

// Storage can be unavailable; then the tips just come back next time.
function read(): Partial<Record<HintId, number>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<HintId, number>>) : {};
  } catch {
    return {};
  }
}

function write(counts: Partial<Record<HintId, number>>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    // Not remembered.
  }
}
