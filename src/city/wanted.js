// ═══════════════════════════════════════════
//  STAN — efterlysning (kompatibelt lager)
//  Polisen ligger i police.js: nivå 0–5, faser, incidenter
//  och tryck (heat) hålls isär. Det här är de gamla namnen
//  som resten av spelet läser: stars(world.wanted) = nivån.
//  world.wanted är samma objekt som world.police.
// ═══════════════════════════════════════════

import { createPolice, alarm, clearPolice, carCap, chaseSpeed, MAX_LEVEL } from './police.js';

export function createWanted() { return createPolice(); }

// Nivån 0–5 (det som visas som 👮 och skickas till andra spelare)
export function stars(w) {
    if (!w) return 0;
    const n = Math.floor(Number(w.level) || 0);
    return n <= 0 ? 0 : Math.min(MAX_LEVEL, n);
}

// Direkt efterlysning (larm, uppdrag): nivån sätts och snuten vet var du är just nu
export function setStars(w, n, text = 'Larm') {
    if (!w || !(n > 0)) return null;
    return alarm(w, n, text);
}

// Allt släpps (lackverkstan, registret rensat, gömstället)
export function clearWanted(w, text) { if (w) clearPolice(w, text); }

// Hur många polisbilar som högst jagar dig per nivå (insatstaket)
export function copTarget(s) { return carCap(s); }
// Fartfaktor för jagande polisbilar: fast per nivå, aldrig över 1
export function copSpeedFactor(s) { return chaseSpeed(s); }
