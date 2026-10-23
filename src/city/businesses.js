// ═══════════════════════════════════════════
//  STAN — verksamheterna lever
//  Varje företag har ett eget rum med personal och kunder
//  (interiors-biz-a.js / -b.js). Kassan fylls av riktig
//  försäljning; ägaren tömmer den, andra kan råna den.
// ═══════════════════════════════════════════

import './interiors-biz-a.js';
import './interiors-biz-b.js';
import { INTERIORS } from './interiors.js';
import { SHOPS } from '../data/gameData.js';

// Vad en kund betalar vid disken (kr)
export const SALE_PRICE = { kebab: 85, barber: 250, gym: 150, studio: 600, club: 200, tech: 600, tower: 1200, rocket: 2500 }; // som skyltarna i rummen
// Kassan rymmer så här många försäljningar innan den är full
export const TILL_SALES = 8;

export function salePrice(shop) { return SALE_PRICE[shop.id] || Math.max(20, Math.round(shop.income * 0.25 / 10) * 10); }
export function tillCap(shop) { return salePrice(shop) * TILL_SALES; }

// Har verksamheten ett eget rum att gå in i?
export function bizInterior(slot) {
    const shop = SHOPS[slot];
    return shop && INTERIORS[shop.id] ? shop.id : null;
}

// Hur mycket folk det är (1 = normalt) vid en viss tid på dygnet
export function bizFlow(id, hour) {
    const night = hour >= 22 || hour < 5;
    if (id === 'club') return night ? 1.5 : hour >= 20 ? 1 : 0.4;
    if (id === 'kebab') return night ? 1.2 : 1;          // kebab efter krogen
    if (id === 'tower' || id === 'tech' || id === 'rocket') return night ? 0.5 : 1;
    return night ? 0.7 : 1;
}
