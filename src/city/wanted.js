// ═══════════════════════════════════════════
//  STAN — efterlysning (1–5 snutar)
//  Brott höjer "heat". Nivån svalnar när ingen
//  snut ser dig på ett tag.
// ═══════════════════════════════════════════

export const CRIME = {
    ped: 0.35,        // körde på någon
    carjack: 0.45,    // drog ut en förare
    copHit: 0.6,      // prejade en snutbil
    wreck: 0.6,       // kvaddade en bil
    explosion: 1.0,
    copWreck: 1.5,    // kvaddade en snutbil
    copCar: 1.2,      // snodde en snutbil
    gangHit: 0.2,
    shot: 0.4,        // sköt på öppen gata
    rob: 0.5          // rånade någon
};

const MAX_HEAT = 5.99;
const CALM_DELAY = 5;     // sekunder utan snut innan nivån sjunker

export function createWanted() { return { heat: 0, calm: 0, flash: 0 }; }

export function stars(w) {
    const s = Math.ceil(w.heat - 1e-9);
    return s <= 0 ? 0 : Math.min(5, s);
}

export function addHeat(w, amount, witnessed = true) {
    w.heat = Math.min(MAX_HEAT, w.heat + amount * (witnessed ? 1 : 0.6));
    w.calm = 0;
    w.flash = 1.5;
}

export function setStars(w, n) {
    w.heat = Math.max(w.heat, Math.min(MAX_HEAT, n - 0.5));
    w.calm = 0;
    w.flash = 1.5;
}

export function clearWanted(w) { w.heat = 0; w.calm = 0; w.flash = 0; }

export function updateWanted(w, dt, copSees) {
    w.flash = Math.max(0, w.flash - dt);
    if (w.heat <= 0) return;
    if (copSees) { w.calm = 0; return; }
    w.calm += dt;
    if (w.calm > CALM_DELAY) {
        const s = stars(w);
        w.heat = Math.max(0, w.heat - dt * 0.2 / (1 + s * 0.15));
    }
}

// Hur många snutbilar som jagar dig per nivå
export function copTarget(s) { return [0, 1, 2, 3, 5, 7][Math.max(0, Math.min(5, s))]; }
export function copSpeedFactor(s) { return 0.82 + 0.05 * s; }
