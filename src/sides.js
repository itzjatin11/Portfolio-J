// Which side of the screen each station's text sits on (desktop): -1 left, +1 right.
// The camera frames its subject on the opposite side and swings across during each seam,
// so text and scene trade places as you travel instead of the text always arriving from the left.
// Index = station: 0 hero, 1 About, 2 Skills, 3 Work, 4 Experience, 5 Contact.
export const SIDES = [-1, 1, -1, 1, -1, 1];

const smooth = (t) => t * t * (3 - 2 * t);

export function sideAt(T) {
  const i = Math.max(0, Math.min(SIDES.length - 1, Math.floor(T)));
  const a = SIDES[i];
  const b = SIDES[Math.min(SIDES.length - 1, i + 1)];
  return a + (b - a) * smooth(Math.max(0, Math.min(1, T - i)));
}
