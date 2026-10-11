// Gameplay tuning values. Everything you might want to tweak while playtesting lives
// here, so feel can be adjusted without hunting through the code.

export type KeeperLevelName = 'easy' | 'normal' | 'hard';

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
  ball: {
    /** Scales the Magnus force: 1 is physical, higher bends shots more. */
    curveStrength: 1.0,
    /** Lift coefficient cap; it otherwise rises with spin (r·ω / v). */
    maxLiftCoefficient: 0.35,
  },
  aim: {
    /** How far outside the posts (m) and above the bar (m) the reticle may go. */
    marginWide: 1.6,
    marginHigh: 1.2,
    /** Reticle radius (m) when the shot is accurate. It grows with overpower scatter. */
    reticleRadius: 0.22,
  },
  match: {
    /** Seconds the "Penalty shootout" banner shows before the first kick (click to skip). */
    introDuration: 2.5,
  },
  cpuKicker: {
    /** Seconds between the kick being set up and the computer striking it. */
    runUpTime: 1.1,
    /** Power range (0–1). Past the overpower threshold the computer can skew it too. */
    minPower: 0.55,
    maxPower: 0.95,
    /** Chance of going down the middle instead of picking a side. */
    centreChance: 0.12,
    /** Range of distances from the centre (m) when picking a side. Posts are at 3.66. */
    minSideX: 1.2,
    maxSideX: 3.3,
    /** Height range (m) of the target. */
    minY: 0.2,
    maxY: 2.2,
  },
  keeper: {
    /** Starting difficulty; keys 1 / 2 / 3 switch level during play. */
    level: 'normal' as KeeperLevelName,
    levels: {
      easy: {
        /** Seconds after the kick before the keeper moves. */
        reactionTime: 0.2,
        /** Chance (0–1) the keeper reads the shot instead of guessing. */
        readChance: 0.3,
        /** How far off (m, standard deviation) a read keeper's target is. */
        readError: 0.6,
        /** Seconds for a full dive, launch to full stretch. */
        diveTime: 0.62,
        /** How far the keeper's centre of mass can travel in a dive (m): their reach. */
        maxDive: 1.8,
      },
      normal: { reactionTime: 0.1, readChance: 0.45, readError: 0.4, diveTime: 0.5, maxDive: 2.05 },
      hard: { reactionTime: 0.06, readChance: 0.6, readError: 0.25, diveTime: 0.45, maxDive: 2.2 },
    },
    /**
     * Extra read chance for slow shots: added in full once the ball takes this many
     * seconds longer than a typical penalty (~0.45 s) to arrive.
     */
    slowShotReadBonus: 0.5,
    slowShotExtraTime: 0.3,
    /** When guessing, chance the keeper stays in the middle instead of picking a side. */
    guessCentreChance: 0.2,
    /** Targets within this distance of the centre (m) are covered standing or jumping. */
    centreBand: 0.55,
    /** Highest the keeper can jump off the ground (m). */
    maxJump: 0.45,
    /** Seconds to drop to the ground after a dive. */
    landTime: 0.35,
    /** Side-to-side shuffle on the line while waiting (m, cycles per second). */
    swayAmplitude: 0.12,
    swayFrequency: 0.6,
  },
  playerKeeper: {
    /** Seconds for a full dive, and how far the centre of mass can travel (m): the player's reach. */
    diveTime: 0.45,
    maxDive: 2.4,
    /** Arrow keys pressed within this many seconds of each other count as one diagonal dive. */
    comboWindow: 0.07,
    /** Where arrow-key dives aim on the goal line (m): sideways, and high / middle / low. */
    arrowX: 3.0,
    highY: 1.9,
    midY: 1.0,
    lowY: 0.3,
    /**
     * Diving more than this many seconds before the kick gives it away: the kicker sees
     * you go and puts it the other way.
     */
    earlyCommitWindow: 0.2,
    /**
     * Keepers adjust their hands mid-dive: if the ball comes within this distance (m)
     * of where the player dived, the keeper steers onto it.
     */
    assistRadius: 1.2,
  },
  camera: {
    /** Vertical field of view (degrees). Narrower makes the goal bigger but crops the ball. */
    fov: 34,
    /** Height (m) and distance behind the penalty spot (m). */
    height: 1.1,
    behindSpot: 4.0,
    /** Height (m) of the point on the goal line the camera looks at. */
    lookAtHeight: 0.3,
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
