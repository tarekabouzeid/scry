/** Canonical pair order, so (a, b) and (b, a) are the same row. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}
