/** Standard normal sample (Box–Muller). */
export function gaussian(): number {
  const u = 1 - Math.random(); // (0, 1], keeps log() finite
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
