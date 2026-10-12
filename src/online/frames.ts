import { STRIDE } from '../replay/recorder';

/**
 * Packs a recorder frame (every tracked object's position, rotation and visibility) small
 * enough to send 30 times a second. Positions go as 16-bit integers in 2 mm steps (±65 m),
 * rotations as 16-bit quaternion components. Objects that can't be seen (the kicker who
 * isn't taking the kick, and everything on them) are left out, and the receiver keeps
 * their last known transforms.
 *
 * Layout: a bitmask of which objects are included, a bitmask of their `visible` flags,
 * padded to an even length, then 7 Int16s (position, quaternion) per included object.
 */
const POSITION_SCALE = 500;
const QUATERNION_SCALE = 32767;
const LIMIT = 32767;

const maskBytes = (n: number) => Math.ceil(n / 8);
const headerBytes = (n: number) => {
  const b = maskBytes(n) * 2;
  return b + (b % 2);
};

const quantise = (v: number, scale: number) => Math.max(-LIMIT, Math.min(LIMIT, Math.round(v * scale)));

/** `data`: a recorder snapshot; `shown`: which of its objects can be seen. */
export function encodeFrame(data: Float32Array, shown: boolean[]): ArrayBuffer {
  const n = data.length / STRIDE;
  const included = shown.reduce((sum, s) => sum + (s ? 1 : 0), 0);
  const header = headerBytes(n);
  const buffer = new ArrayBuffer(header + included * 7 * 2);
  const masks = new Uint8Array(buffer, 0, header);
  const values = new Int16Array(buffer, header);
  const m = maskBytes(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const k = i * STRIDE;
    if (data[k + 7] > 0.5) masks[m + (i >> 3)] |= 1 << (i & 7);
    if (!shown[i]) continue;
    masks[i >> 3] |= 1 << (i & 7);
    for (let c = 0; c < 3; c++) values[j++] = quantise(data[k + c], POSITION_SCALE);
    for (let c = 3; c < 7; c++) values[j++] = quantise(data[k + c], QUATERNION_SCALE);
  }
  return buffer;
}

/**
 * Unpack a frame of `n` objects. Objects left out keep their values from `previous` (the
 * last frame decoded), or sit at the origin if there is none yet.
 */
export function decodeFrame(buffer: ArrayBuffer, n: number, previous: Float32Array | null): Float32Array | null {
  const header = headerBytes(n);
  if (buffer.byteLength < header) return null;
  const masks = new Uint8Array(buffer, 0, header);
  const values = new Int16Array(buffer, header, (buffer.byteLength - header) >> 1);
  const m = maskBytes(n);
  const data = previous ? previous.slice() : new Float32Array(n * STRIDE);
  if (!previous) for (let i = 0; i < n; i++) data[i * STRIDE + 6] = 1; // identity rotations
  let j = 0;
  for (let i = 0; i < n; i++) {
    const k = i * STRIDE;
    data[k + 7] = masks[m + (i >> 3)] & (1 << (i & 7)) ? 1 : 0;
    if (!(masks[i >> 3] & (1 << (i & 7)))) continue;
    if (j + 7 > values.length) return null;
    for (let c = 0; c < 3; c++) data[k + c] = values[j++] / POSITION_SCALE;
    for (let c = 3; c < 7; c++) data[k + c] = values[j++] / QUATERNION_SCALE;
    const length = Math.hypot(data[k + 3], data[k + 4], data[k + 5], data[k + 6]) || 1;
    for (let c = 3; c < 7; c++) data[k + c] /= length;
  }
  return data;
}
