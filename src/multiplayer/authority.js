// ═══════════════════════════════════════════
//  REGLER FÖR DET DELADE
//  Värden (eller den lokala världen offline) avgör
//  allt som flera spelare kan bråka om: föremål på
//  marken, träffar, ägande och SMS. Rena funktioner
//  så att samma regler gäller överallt och kan testas.
// ═══════════════════════════════════════════

export const PICKUP_RANGE = 70;        // px från föremålet
export const ITEM_RESPAWN = 180;       // sekunder innan ett vapen på marken dyker upp igen

// Hur långt och hur hårt en träff kan vara
export const HIT_RULES = {
    melee: { range: 70, max: 45 },
    bullet: { range: 760, max: 32 },
    car: { range: 110, max: 70 }
};
const HITS_PER_SECOND = 14;

export const PROPERTIES = {
    stripclub: { name: 'Club Diamant', icon: '💎', price: 40000, income: 2500, takeover: 2, refund: 1.5 }
};

export const SMS_MAX = 280;
const SMS_BURST = 5, SMS_WINDOW = 10000, SMS_GAP = 700;

export const PVP_LOSS_SHARE = 0.1;     // den som förlorar tappar 10 % av kontanterna
export const PVP_LOSS_MAX = 5000;
export const SPAWN_PROTECTION = 6;     // sekunder utan skada efter att man kommit tillbaka

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ── Föremål på marken ──
export function validatePickup(items, itemId, pos, now) {
    const it = items.get(itemId);
    if (!it) return { ok: false, reason: 'Finns inte' };
    if (it.takenUntil > now) return { ok: false, reason: 'Någon hann före' };
    if (!pos) return { ok: false, reason: 'Okänd position' };
    if ((pos.in || null) !== null) return { ok: false, reason: 'Du är inomhus' };
    if (dist(pos, it) > PICKUP_RANGE) return { ok: false, reason: 'För långt bort' };
    return { ok: true };
}

export function takeItem(items, itemId, now) {
    const it = items.get(itemId);
    if (it) it.takenUntil = now + ITEM_RESPAWN * 1000;
}

export function takenIds(items, now) {
    const out = [];
    for (const [id, it] of items) if (it.takenUntil > now) out.push(id);
    return out;
}

// ── Träffar mellan spelare ──
// att/tgt: { x, y, in } senast kända positioner. log: Map attacker → [tider]
export function validateHit(att, tgt, kind, dmg, now, log, attackerId) {
    const rule = HIT_RULES[kind];
    if (!rule) return { ok: false, reason: 'Okänd attack' };
    if (!att || !tgt) return { ok: false, reason: 'Okänd position' };
    if ((att.in || null) !== (tgt.in || null)) return { ok: false, reason: 'Olika platser' };
    if (tgt.dead) return { ok: false, reason: 'Redan nere' };
    if (tgt.prot) return { ok: false, reason: 'Skyddad' };
    if (dist(att, tgt) > rule.range) return { ok: false, reason: 'För långt bort' };
    const n = Number(dmg);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: 'Ogiltig skada' };
    const times = (log.get(attackerId) || []).filter(t => now - t < 1000);
    if (times.length >= HITS_PER_SECOND) return { ok: false, reason: 'För många träffar' };
    times.push(now);
    log.set(attackerId, times);
    return { ok: true, dmg: Math.min(rule.max, n) };
}

// Vem fick in sista träffen? Den får vinsten när offret går ner.
export function pvpLoss(money) {
    return Math.min(PVP_LOSS_MAX, Math.max(0, Math.floor((Number(money) || 0) * PVP_LOSS_SHARE)));
}

// ── Ägande ──
// owners: { prop: { owner, price } }. Tar man över betalar man mer och den gamla ägaren får ersättning.
export function validateBuy(owners, prop, buyer, money) {
    const def = PROPERTIES[prop];
    if (!def) return { ok: false, reason: 'Finns inte' };
    const cur = owners?.[prop];
    if (cur && cur.owner === buyer) return { ok: false, reason: 'Du äger den redan' };
    const price = cur ? Math.round(def.price * def.takeover) : def.price;
    if (!(Number(money) >= price)) return { ok: false, reason: `Det kostar ${price.toLocaleString('sv-SE')} kr` };
    return { ok: true, price, prevOwner: cur ? cur.owner : null, refund: cur ? Math.round(def.price * def.refund) : 0 };
}

// ── SMS ──
export function validateSms(text, times, now) {
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) return { ok: false, reason: 'invalid' };
    if (t.length > SMS_MAX) return { ok: false, reason: 'invalid' };
    const recent = times.filter(x => now - x < SMS_WINDOW);
    if (recent.length >= SMS_BURST || (recent.length && now - recent[recent.length - 1] < SMS_GAP)) return { ok: false, reason: 'rate' };
    recent.push(now);
    times.length = 0;
    times.push(...recent);
    return { ok: true, text: t };
}
