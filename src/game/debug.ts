/** Debug aids, read from the page URL. All off by default. */
export interface DebugOptions {
  /** `?debug`: R restarts the shootout, 1 / 2 / 3 set the CPU keeper level. */
  keys: boolean;
  /** `?timescale=0.1`: run the whole game at that fraction of real speed, for checking animation. */
  timeScale: number;
}

export function readDebugOptions(search: string): DebugOptions {
  const params = new URLSearchParams(search);
  const timeScale = Number(params.get('timescale') ?? 1);
  return { keys: params.has('debug'), timeScale: timeScale > 0 ? timeScale : 1 };
}
