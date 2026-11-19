// A small seedable random generator of my own design notes: I use a 32-bit
// integer hash cascade (multiply, xor-shift, multiply) because it is short,
// fast, and gives every corner of Solmar City the same layout for the same
// seed on every machine. Nothing here depends on Math.random, so a seed
// fully determines the city, the traffic and the loot placement.

/** Turn any integer seed into a generator function returning floats in [0, 1). */
export function createRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    // A final multiply scrambles the low bits, which xor-shift leaves weak.
    const mixed = Math.imul(state ^ (state >>> 15), 0x85ebca6b);
    return ((mixed ^ (mixed >>> 13)) >>> 0) / 4294967296;
  };
}

/** Integer in [min, max], both ends included. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Float in [min, max). */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Pick one element of a non-empty array. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

/** True with the given probability (0..1). */
export function chance(rng, probability) {
  return rng() < probability;
}
