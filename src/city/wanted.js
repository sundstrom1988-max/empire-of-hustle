// ═══════════════════════════════════════════
//  STAN — efterlysning (1–5 snutar)
//  Bara brott som en snut SER höjer "heat". Nivån
//  svalnar när ingen snut sett dig på ett tag, och
//  efter några sekunder utom synhåll tappar de spåret.
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
    rob: 0.5,         // rånade någon
    robShop: 1.2,     // rånade en butik
    copAssault: 0.6,  // gav sig på en snut
    copKill: 1.2      // sänkte en snut
};

const MAX_HEAT = 5.99;
const CALM_DELAY = 4;     // sekunder utom synhåll innan nivån sjunker
const LOST_AFTER = 4;     // sekunder utom synhåll innan snuten tappar spåret

export function createWanted() { return { heat: 0, calm: 0, flash: 0, seenT: 99, lastSeen: null }; }

export function stars(w) {
    const s = Math.ceil(w.heat - 1e-9);
    return s <= 0 ? 0 : Math.min(5, s);
}

// Ett brott som ingen snut ser får inga följder
export function addHeat(w, amount, witnessed = true) {
    if (!witnessed) return false;
    w.heat = Math.min(MAX_HEAT, w.heat + amount);
    w.calm = 0;
    w.flash = 1.5;
    w.seenT = 0;
    return true;
}

// Direkt efterlysning (larm, uppdrag): snuten vet var du är just nu
export function setStars(w, n) {
    w.heat = Math.max(w.heat, Math.min(MAX_HEAT, n - 0.5));
    w.calm = 0;
    w.flash = 1.5;
    w.seenT = 0;
}

export function clearWanted(w) { w.heat = 0; w.calm = 0; w.flash = 0; w.seenT = 99; w.lastSeen = null; }

// Har snuten tappat bort dig? Då letar de där de såg dig sist.
export function lostTrack(w) { return w.seenT > LOST_AFTER; }

export function updateWanted(w, dt, copSees, pos = null) {
    w.flash = Math.max(0, w.flash - dt);
    if (copSees) { w.seenT = 0; if (pos) w.lastSeen = { x: pos.x, y: pos.y }; } else w.seenT += dt;
    if (w.heat <= 0) return;
    if (copSees) { w.calm = 0; return; }
    w.calm += dt;
    if (w.calm > CALM_DELAY) {
        const s = stars(w);
        w.heat = Math.max(0, w.heat - dt * 0.3 / (1 + s * 0.1));
    }
}

// Hur många snutbilar som jagar dig per nivå
export function copTarget(s) { return [0, 1, 2, 3, 5, 7][Math.max(0, Math.min(5, s))]; }
export function copSpeedFactor(s) { return 0.82 + 0.05 * s; }
