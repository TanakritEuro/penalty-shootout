/** Debug aids, read from the page URL. All off by default. */
export interface DebugOptions {
  /** `?debug`: R restarts the shootout, 1 / 2 / 3 set the CPU keeper level. */
  keys: boolean;
  /** `?timescale=0.1`: run the whole game at that fraction of real speed, for checking animation. */
  timeScale: number;
  /** `?stats`: an overlay with frame rate, frame time, draw calls and triangles. */
  stats: boolean;
}

export function readDebugOptions(search: string): DebugOptions {
  const params = new URLSearchParams(search);
  const timeScale = Number(params.get('timescale') ?? 1);
  return { keys: params.has('debug'), timeScale: timeScale > 0 ? timeScale : 1, stats: params.has('stats') };
}

/** Rolling frame statistics, shown in a corner overlay when `?stats` is on. */
export class StatsOverlay {
  private readonly el = document.createElement('div');
  private frames = 0;
  private work = 0;
  private since = performance.now();

  constructor() {
    this.el.style.cssText =
      'position:fixed;left:8px;bottom:8px;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#9f9;font:12px monospace;z-index:20;pointer-events:none;white-space:pre';
    document.body.append(this.el);
  }

  /** Record one frame: `workMs` is the time spent in game code and rendering. */
  frame(workMs: number, info: { calls: number; triangles: number }): void {
    this.frames++;
    this.work += workMs;
    const now = performance.now();
    if (now - this.since < 500) return;
    const fps = (this.frames * 1000) / (now - this.since);
    this.el.textContent = `${fps.toFixed(0)} fps  ${(this.work / this.frames).toFixed(1)} ms/frame
${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris`;
    this.frames = 0;
    this.work = 0;
    this.since = now;
  }
}
