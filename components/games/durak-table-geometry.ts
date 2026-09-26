/** Fixed portrait composition. Positions are measured from the felt box
 *  (the PokerTH idea), not spaced evenly around the ellipse.
 *
 *  0 bottom center — local player.
 *  1–3 left: lower, middle, upper.
 *  4–6 right: upper, middle, lower.
 *  No seat on the top center.
 */

export const FELT_ASPECT = 1.42;

/** Room under the oval for the hand that hangs past the lower rail. */
export const TABLE_OVERHANG = 100;

/** Side seats share one vertical rhythm so the gaps match on the left and right. */
const SIDE_TOP = 0.3;
const SIDE_STEP = 0.2;
const SLOT_Y = [
  0.97,
  SIDE_TOP + SIDE_STEP * 2,
  SIDE_TOP + SIDE_STEP,
  SIDE_TOP,
  SIDE_TOP,
  SIDE_TOP + SIDE_STEP,
  SIDE_TOP + SIDE_STEP * 2,
];
const SLOT_SIDE = [0, -1, -1, -1, 1, 1, 1];

export function visualSlot(index: number, yourSeat: number | null, count = 7) {
  const shift = yourSeat ?? 0;
  return (((index - shift) % count) + count) % count;
}

export function seatCenter(slot: number, width: number, height: number) {
  const y = SLOT_Y[slot] * height;
  if (SLOT_SIDE[slot] === 0) {
    return { x: width / 2, y: height * 0.83 };
  }
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const ny = Math.max(-1, Math.min(1, (y - cy) / ry));
  const half = rx * Math.sqrt(Math.max(0, 1 - ny * ny));
  const x = width / 2 + SLOT_SIDE[slot] * (half - 18);
  return { x, y };
}

export function seatPercent(
  index: number,
  yourSeat: number | null,
  width: number,
  height: number,
) {
  const point = seatCenter(visualSlot(index, yourSeat), width, height);
  return {
    left: `${(point.x / width) * 100}%`,
    top: `${(point.y / height) * 100}%`,
  };
}

/** Fit the felt in the zone, then scale the whole composition if it would overflow. */
export function feltComposition(zoneW: number, zoneH: number) {
  const width = Math.max(220, Math.min(zoneW * 0.92, zoneW - 24));
  const height = width * FELT_ASPECT;
  const budget = Math.max(160, zoneH);
  const scale = Math.min(1, (zoneW * 0.96) / width, budget / (height + TABLE_OVERHANG));
  return { width, height, scale };
}
