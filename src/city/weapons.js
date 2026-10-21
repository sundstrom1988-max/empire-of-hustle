// ═══════════════════════════════════════════
//  STAN — vapen (Pang-Pelles sortiment)
// ═══════════════════════════════════════════

export const WEAPONS = {
    fists: { id: 'fists', name: 'Nävar', icon: '👊', melee: true, dmg: [15, 21], range: 30, cd: 0.35, price: 0 },
    bat: { id: 'bat', name: 'Basebollträ', icon: '🏏', melee: true, dmg: [28, 38], range: 38, cd: 0.45, price: 400 },
    pistol: { id: 'pistol', name: 'Pistol', icon: '🔫', dmg: 24, speed: 950, cd: 0.3, spread: 0.03, pellets: 1, ammo: 24, ammoPrice: 250, price: 1500, range: 520 },
    uzi: { id: 'uzi', name: 'Uzi', icon: '🔫', dmg: 12, speed: 1000, cd: 0.085, spread: 0.11, pellets: 1, ammo: 90, ammoPrice: 600, price: 4000, range: 480, auto: true },
    shotgun: { id: 'shotgun', name: 'Hagelgevär', icon: '💥', dmg: 11, speed: 850, cd: 0.75, spread: 0.3, pellets: 6, ammo: 14, ammoPrice: 700, price: 6000, range: 300 }
};

export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'uzi', 'shotgun'];

export function ownsWeapon(profile, id) {
    return id === 'fists' || (profile.weapons || []).includes(id);
}

export function hasGun(profile) {
    return (profile.weapons || []).some(id => WEAPONS[id] && !WEAPONS[id].melee);
}

// Nästa vapen du äger (Q)
export function nextWeapon(profile) {
    const owned = WEAPON_ORDER.filter(id => ownsWeapon(profile, id));
    const i = owned.indexOf(profile.weapon || 'fists');
    return owned[(i + 1) % owned.length];
}

// Köp ett vapen eller fyll på ammo. Returnerar { ok, cost, reason }.
export function weaponPurchase(profile, id, kind = 'weapon') {
    const w = WEAPONS[id];
    if (!w || id === 'fists') return { ok: false, reason: 'Finns inte.' };
    if (kind === 'weapon') {
        if (ownsWeapon(profile, id)) return { ok: false, reason: 'Du har redan en.' };
        return { ok: true, cost: w.price };
    }
    if (w.melee) return { ok: false, reason: 'Ett trä behöver ingen ammo.' };
    if (!ownsWeapon(profile, id)) return { ok: false, reason: 'Köp vapnet först.' };
    return { ok: true, cost: w.ammoPrice };
}

// Hur imponerad en dejt blir av din bil (0–1)
const CHARM = { rolls: 1, lambo: 0.95, mercedes: 0.8, audi: 0.75, hd: 0.75, bmw: 0.7, police: 0.55, volvo: 0.35, taxi: 0.3, van: 0.25, moped: 0.2, cykel: 0.08 };
export function dateChance(vehicle, rep = 0) {
    if (!vehicle) return 0;
    let c = CHARM[vehicle.type] ?? (vehicle.gang ? 0.6 : 0.4);
    if (vehicle.hp < vehicle.maxHp * 0.5) c -= 0.2;   // ingen vill åka i en vrakbil
    c += Math.min(0.2, rep * 0.01);
    return Math.max(0.05, Math.min(1, c));
}
