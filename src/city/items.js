// ═══════════════════════════════════════════
//  STAN — vapen och grejer på marken
//  Samma platser hos alla (stan är seedad), så värden
//  kan kontrollera avstånd utan att skicka positioner.
// ═══════════════════════════════════════════

import { TILE, T } from './constants.js';
import { tileAt } from './map.js';
import { mulberry32 } from './rng.js';
import { WEAPONS } from './weapons.js';

export const ITEM_TYPES = {
    bat: { weapon: 'bat', label: 'Basebollträ', icon: '🏏' },
    pistol: { weapon: 'pistol', ammo: 12, label: 'Pistol', icon: '🔫' },
    uzi: { weapon: 'uzi', ammo: 45, label: 'Uzi', icon: '🔫' },
    shotgun: { weapon: 'shotgun', ammo: 8, label: 'Hagelgevär', icon: '💥' },
    ammo: { ammoBox: true, label: 'Ammolåda', icon: '📦' },
    armor: { armor: 50, label: 'Skyddsväst', icon: '🦺' }
};
// Hur mycket man kan bära
export const AMMO_CAP = { pistol: 120, uzi: 360, shotgun: 56 };
export const ARMOR_CAP = 100;

const MIX = ['pistol', 'bat', 'ammo', 'uzi', 'armor', 'pistol', 'ammo', 'shotgun', 'bat', 'armor', 'ammo', 'pistol', 'uzi', 'ammo'];

// Utplacering: trottoarer en bit från varandra och från pickup-platserna
export function cityItemDefs(city) {
    if (city._itemDefs) return city._itemDefs;
    const r = mulberry32(4242);
    const pool = city.sidewalkTiles.slice();
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const out = [];
    for (const [tx, ty] of pool) {
        if (out.length >= MIX.length) break;
        if (tileAt(city, tx, ty) !== T.SIDEWALK) continue;
        if (out.some(o => Math.abs(o.tx - tx) + Math.abs(o.ty - ty) < 9)) continue;
        if (city.pickupSpots.some(p => Math.abs(p.tx - tx) + Math.abs(p.ty - ty) < 2)) continue;
        const type = MIX[out.length];
        out.push({ id: 'item' + out.length, type, tx, ty, x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
    }
    city._itemDefs = out;
    return out;
}

// Vad ett föremål skulle ge just den här spelaren — null om det inte får plats
export function itemGain(profile, type, armor = 0) {
    const def = ITEM_TYPES[type];
    if (!def) return null;
    const owned = id => id === 'fists' || (profile.weapons || []).includes(id);
    const ammo = profile.ammo || {};
    if (def.weapon) {
        const w = WEAPONS[def.weapon];
        if (!owned(def.weapon)) return { weapon: def.weapon, ammo: w.melee ? 0 : def.ammo };
        if (w.melee) return null;
        const room = AMMO_CAP[def.weapon] - (ammo[def.weapon] || 0);
        return room > 0 ? { ammoFor: def.weapon, ammo: Math.min(room, def.ammo) } : null;
    }
    if (def.ammoBox) {
        // Fyller på det skjutvapen du har i handen, annars det första du äger
        const guns = (profile.weapons || []).filter(id => !WEAPONS[id].melee);
        const gun = guns.includes(profile.weapon) ? profile.weapon : guns[0];
        if (!gun) return null;
        const room = AMMO_CAP[gun] - (ammo[gun] || 0);
        return room > 0 ? { ammoFor: gun, ammo: Math.min(room, WEAPONS[gun].ammo) } : null;
    }
    if (def.armor) return armor < ARMOR_CAP ? { armor: Math.min(ARMOR_CAP - armor, def.armor) } : null;
    return null;
}
