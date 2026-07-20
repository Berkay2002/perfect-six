function xmur3(value: string) {
  let hash = 1779033703 ^ value.length;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return () => {
    hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
    return (hash ^= hash >>> 16) >>> 0;
  };
}

export type SeededRandom = {
  next: () => number;
  integer: (maxExclusive: number) => number;
  pick: <T>(values: readonly T[]) => T;
  shuffle: <T>(values: readonly T[]) => T[];
};

export function createRandom(seedValue: string): SeededRandom {
  const seed = xmur3(seedValue.trim().toUpperCase() || "PERFECT-SIX");
  let a = seed();
  let b = seed();
  let c = seed();
  let d = seed();

  const next = () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    const result = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + result) | 0;
    return (result >>> 0) / 4294967296;
  };

  const integer = (maxExclusive: number) =>
    Math.floor(next() * Math.max(1, maxExclusive));

  const pick = <T>(values: readonly T[]) => {
    if (values.length === 0) {
      throw new Error("Cannot pick from an empty collection.");
    }
    return values[integer(values.length)];
  };

  const shuffle = <T>(values: readonly T[]) => {
    const copy = [...values];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = integer(index + 1);
      [copy[index], copy[target]] = [copy[target], copy[index]];
    }
    return copy;
  };

  return { next, integer, pick, shuffle };
}

export function canonicalSeed(seed: string) {
  return seed.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

export function randomDisplaySeed() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}
