// Gameplay tuning values. Everything you might want to tweak while playtesting lives
// here, so feel can be adjusted without hunting through the code.

export const TUNING = {
  shooting: {
    /** Seconds of holding the mouse button to go from zero to full power. */
    chargeTime: 1.1,
    /** Ball speed (m/s) at zero and full power. Real penalties are roughly 20–30 m/s. */
    minSpeed: 11,
    maxSpeed: 31,
    /**
     * Power (0–1) above which the shot starts to lose accuracy. Between this and full
     * power the error ramps up from nothing to the full drift values below.
     */
    overpowerThreshold: 0.78,
    /** Exponent applied to the overpower fraction: >1 keeps a little overpower forgiving. */
    overpowerCurve: 1.6,
    /** Extra height (m) added to the target at full overpower. */
    overpowerHighDrift: 1.5,
    /** Extra sideways drift (m, pushed away from the centre) at full overpower. */
    overpowerWideDrift: 1.3,
    /** Random scatter (m, standard deviation) on every shot, however well struck. */
    baseScatter: 0.08,
    /** Random scatter (m, standard deviation) added at full overpower. */
    overpowerScatter: 0.35,
  },
  aim: {
    /** How far outside the posts (m) and above the bar (m) the reticle may go. */
    marginWide: 1.6,
    marginHigh: 1.2,
    /** Reticle radius (m) when the shot is accurate. It grows with overpower scatter. */
    reticleRadius: 0.22,
  },
  outcome: {
    /** Give up waiting and call it a miss after this many seconds of flight. */
    maxFlightTime: 4.0,
    /** After hitting the woodwork, settle once the ball drops below this speed (m/s)... */
    settleSpeed: 1.0,
    /** ...or once it has rolled back this far from the goal line (m). */
    reboundDistance: 8.0,
    /** Seconds the result stays on screen before the next kick is set up. */
    resultDuration: 2.5,
  },
} as const;
