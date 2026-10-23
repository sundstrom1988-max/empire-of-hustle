// Seedad slump (mulberry32) — samma seed ger samma stad varje gång.
export function mulberry32(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.range = (a, b) => a + next() * (b - a);
    next.chance = (p) => next() < p;
    return next;
}
