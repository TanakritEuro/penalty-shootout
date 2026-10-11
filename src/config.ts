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
  spin: {
    /**
     * Spin (rad/s) from striking the ball at the very edge of the contact circle, at full
     * power. Real curled shots reach roughly 8–10 revolutions a second (50–60 rad/s).
     */
    maxSpin: 55,
    /** How far one W / A / S / D press moves the contact point (fraction of the ball's radius). */
    nudge: 0.2,
    /** Furthest the contact point can go from the centre (fraction of the radius). */
    maxOffset: 0.8,
    /** Fraction of the ball speed lost at maximum offset (it scales with offset squared). */
    powerLoss: 0.1,
    /** Extra random scatter (m, standard deviation) at maximum offset. */
    extraScatter: 0.25,
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
  kicker: {
    /** How far along the run-up (0–1) holding the power button takes the player's kicker. */
    chargeApproach: 0.75,
    /**
     * After release, the last stride to the ball takes this long (s) from a full charge,
     * up to maxStrikeTime from a standing start. The ball leaves the boot at the end of it.
     */
    strikeTime: 0.16,
    maxStrikeTime: 0.4,
    /** Where the kicker waits (m, ground), and where they stand as the boot meets the ball. */
    runUpStart: { x: -1.5, z: 13.4 },
    strikePoint: { x: -0.14, z: 11.42 },
    /** Distance (m) covered by one running stride (two steps). */
    stride: 1.3,
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
    /** Chance the computer curls its shot, and how far off-centre (0–1) it strikes it then. */
    spinChance: 0.35,
    maxContact: 0.6,
    /**
     * In the last part of the run-up the kicker opens their hips towards a side: the tell
     * a keeper can read. This is the chance it points the way the ball really goes.
     */
    tellHonesty: 0.75,
    /** How far the hips turn (rad) and the body leans (rad) towards the tell side... */
    tellYaw: 0.45,
    tellLean: 0.15,
    /** ...growing from this fraction of the run-up to full strength at the second. */
    tellFrom: 0.55,
    tellFull: 0.85,
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
    /**
     * How much of a curling shot's bend a reading keeper anticipates: 0 reads only the line
     * it sets off on, 1 knows exactly where it will end up.
     */
    curveRead: 0.25,
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
  net: {
    /** Ripple strength is ball speed / referenceSpeed (m/s), capped at maxStrength. */
    referenceSpeed: 22,
    maxStrength: 1.3,
    /** Peak displacement (m) at strength 1, and how much of it is a steady outward bulge. */
    amplitude: 0.16,
    bulge: 0.9,
    /** Size of the disturbed patch (m) and how fast it settles (s). */
    spread: 0.8,
    decay: 0.45,
    /** Wobble: angular frequency (rad/s) and wavenumber (rad/m) of the ripple. */
    frequency: 16,
    wavenumber: 5,
  },
  director: {
    /** Slow motion and a camera cut fire when the ball gets this close to the goal line (m)... */
    triggerDistance: 2.2,
    /** ...and is heading within this much (m) of a post or the bar... */
    woodworkMargin: 0.35,
    /** ...or is this close (m) to the keeper's body or gloves. */
    keeperMargin: 0.7,
    /** Game speed in slow motion, and how long it lasts (real seconds) before easing back. */
    slowScale: 0.25,
    slowHold: 0.8,
    easeIn: 0.08,
    easeOut: 0.35,
    /**
     * Close-call camera: low, outside the post on the side the ball is going, looking back
     * across the goal mouth. x is mirrored to that side.
     */
    cutCamera: { x: 6.5, y: 1.1, z: 3.2, lookX: 1.6, lookY: 1.0, lookZ: 0, fov: 42 },
    /**
     * On the CPU's kicks the player is in goal: a camera well behind the net, below the bar
     * and off to one side so it sees past the keeper to the kicker (the run-up has to be
     * readable) while the whole goal mouth stays in view for mouse dives.
     */
    keeperCamera: { x: 1.5, y: 1.7, z: -5.5, lookX: -0.4, lookY: 0.4, lookZ: 11, fov: 40 },
    useKeeperCamera: true,
  },
  camera: {
    /** Vertical field of view (degrees). Narrower makes the goal bigger but crops the ball. */
    fov: 36,
    /**
     * Height (m) and distance behind the penalty spot (m). High enough to look over the
     * kicker's head at the goal during the run-up.
     */
    height: 2.6,
    behindSpot: 5.5,
    /** Height (m) of the point on the goal line the camera looks at (below ground: it looks down). */
    lookAtHeight: -1.2,
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
