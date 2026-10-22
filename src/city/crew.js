// ═══════════════════════════════════════════
//  STAN — crew
//  Folk du anställer för pengar. De följer med, försvarar
//  dig och går på det mål du pekar ut. Inga löner — man
//  betalar en gång. Den som slås ner reser sig efter en stund.
// ═══════════════════════════════════════════

import { TILE } from './constants.js';
import { isWalkableTile } from './map.js';
import { mulberry32 } from './rng.js';
import { seek, lineClear } from './ai.js';
import { stepWalker } from './physics.js';

export const CREW_MAX = 4;          // hur många man kan ha
export const CREW_RECOVER = 25;     // sekunder nere innan man reser sig
export const ROLES = {
    guard: { name: 'Livvakt', icon: '🛡️', hp: 90, dmg: [14, 20], speed: 165, range: 24, cd: 0.8, base: 1800, desc: 'Slåss i närstrid och går på den som ger sig på dig' },
    gunner: { name: 'Skytt', icon: '🎯', hp: 70, dmg: [11, 15], speed: 155, range: 280, cd: 0.7, base: 3200, desc: 'Skjuter med pistol på håll (egen ammo)' },
    scout: { name: 'Spanare', icon: '👀', hp: 60, dmg: [8, 12], speed: 195, range: 24, cd: 0.9, base: 1200, desc: 'Visar snutar på kartan och varnar när de kommer' }
};
const NAMES = ['Yusuf', 'Kevin', 'Dani', 'Rami', 'Jonna', 'Sami', 'Leo', 'Mira', 'Tariq', 'Elin', 'Bilal', 'Nora', 'Viktor', 'Aida', 'Omar', 'Linn'];
const TRAITS = [
    { id: 'tuff', label: 'Tuff (+25 % hälsa)', hp: 1.25, dmg: 1, speed: 1, cost: 1.2 },
    { id: 'snabb', label: 'Snabb (+15 % fart)', hp: 1, dmg: 1, speed: 1.15, cost: 1.1 },
    { id: 'hard', label: 'Hårda nävar (+25 % skada)', hp: 1, dmg: 1.25, speed: 1, cost: 1.2 },
    { id: 'billig', label: 'Billig (svagare)', hp: 0.85, dmg: 0.9, speed: 1, cost: 0.7 },
    { id: 'lojal', label: 'Lojal (+10 % hälsa)', hp: 1.1, dmg: 1, speed: 1, cost: 1 }
];

function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// Fyra personer att välja på — samma hela rundan
export function crewCandidates(charKey, round) {
    const r = mulberry32(hashStr(String(charKey)) + round * 31);
    const roles = ['guard', 'gunner', 'scout', r() < 0.5 ? 'guard' : 'gunner'];
    return roles.map((role, i) => {
        const R = ROLES[role], tr = TRAITS[Math.floor(r() * TRAITS.length)];
        return {
            id: `c${round}-${i}-${Math.floor(r() * 1e6)}`, name: NAMES[Math.floor(r() * NAMES.length)], role,
            trait: tr.label, hp: Math.round(R.hp * tr.hp), dmg: R.dmg.map(v => Math.round(v * tr.dmg)),
            speed: Math.round(R.speed * tr.speed), cost: Math.round(R.base * tr.cost / 50) * 50
        };
    });
}

export function canRecruit(profile, cand) {
    const crew = profile.crew || [];
    if (crew.some(m => m.id === cand.id)) return { ok: false, reason: 'Redan i ditt crew' };
    if (crew.length >= CREW_MAX) return { ok: false, reason: `Crewet är fullt (${CREW_MAX})` };
    if ((profile.money || 0) < cand.cost) return { ok: false, reason: `Kostar ${cand.cost.toLocaleString('sv-SE')} kr` };
    return { ok: true };
}

// Crew-medlem i stan (finns bara så länge stan är öppen)
export function makeMember(m, idx, x, y) {
    const R = ROLES[m.role] || ROLES.guard;
    return {
        ...m, idx, isCrew: true, x, y, vx: 0, vy: 0, r: 8, angle: 0, phase: Math.random() * 6,
        hp: m.hp || R.hp, maxHp: m.hp || R.hp, dmg: m.dmg || R.dmg, speed: m.speed || R.speed,
        down: 0, cd: 0, punchT: 0, flashT: 0, order: 'follow', target: null, hidden: false, interior: null, holdX: x, holdY: y
    };
}

// En gångbar plats nära (x, y)
export function spotNear(city, x, y, i = 0) {
    for (let k = 0; k < 12; k++) {
        const a = (i * 1.7 + k * 0.9), d = 24 + k * 6;
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        if (isWalkableTile(city, Math.floor(px / TILE), Math.floor(py / TILE))) return { x: px, y: py };
    }
    return { x, y };
}

// Mål: { kind: 'ped', ped } | { kind: 'remote', id } | { kind: 'rcrew', id, idx }
function targetPos(world, t) {
    if (!t) return null;
    if (t.kind === 'ped') return t.ped.down > 0 || !world.peds.includes(t.ped) ? null : t.ped;
    const r = world.net?.remotes().get(t.id);
    if (!r || r.dead || (r.in || null) !== null || world.interior) return null;
    if (t.kind === 'remote') return r.v ? null : { x: r.rx, y: r.ry };
    const c = r.crew?.[t.idx];
    return c && !c.d ? c : null;
}

// Försvar: den som ger sig på dig (folk som anfaller, eller en spelare som nyss träffade dig)
function autoTarget(world, c) {
    if (c.role === 'scout') return null;
    const p = world.player;
    let best = null, bd = 280;
    for (const ped of world.peds) {
        if (!ped.attack || ped.targetPed || ped.down > 0) continue;
        const d = Math.hypot(ped.x - p.x, ped.y - p.y);
        if (d < bd) { bd = d; best = { kind: 'ped', ped }; }
    }
    if (best) return best;
    const la = world.lastAttacker;
    if (la && world.time - la.t < 10) {
        const r = world.net?.remotes().get(la.id);
        if (r && !r.dead && !r.v && Math.hypot(r.rx - p.x, r.ry - p.y) < 420) return { kind: 'remote', id: la.id };
    }
    return null;
}

export function updateCrew(world, dt) {
    const p = world.player, n = world.crew.length;
    for (const c of world.crew) {
        c.cd = Math.max(0, c.cd - dt);
        c.punchT = Math.max(0, c.punchT - dt);
        c.flashT = Math.max(0, c.flashT - dt);
        if (c.down > 0) {
            c.down -= dt;
            if (c.down <= 0) { c.down = 0; c.hp = Math.ceil(c.maxHp * 0.5); world.floater(c.x, c.y - 22, `💪 ${c.name} är uppe`, '#86efac'); }
            continue;
        }
        // Åker med i bilen
        if (p.vehicle) { c.hidden = true; c.x = p.vehicle.x; c.y = p.vehicle.y; continue; }
        if (c.hidden) {
            const s = spotNear(world.city, p.x, p.y, c.idx);
            c.x = s.x; c.y = s.y; c.vx = c.vy = 0; c.hidden = false;
        }
        if (world.interior) continue; // inne står crewet vid dörren
        let tpos = c.order === 'attack' ? targetPos(world, c.target) : null;
        if (c.order === 'attack' && !tpos) { c.order = 'follow'; c.target = null; }
        let tgt = c.order === 'attack' ? c.target : null;
        if (!tgt) { tgt = autoTarget(world, c); tpos = targetPos(world, tgt); }
        const R = ROLES[c.role] || ROLES.guard;
        let goal, stop;
        if (tpos) { goal = tpos; stop = c.role === 'gunner' ? R.range * 0.7 : 16; }
        else if (c.order === 'hold') { goal = { x: c.holdX, y: c.holdY }; stop = 8; }
        else {
            // Följ i en båge bakom mig
            const a = p.angle + Math.PI + (c.idx - (n - 1) / 2) * 0.75;
            goal = { x: p.x + Math.cos(a) * (38 + (c.idx % 2) * 14), y: p.y + Math.sin(a) * (38 + (c.idx % 2) * 14) };
            stop = 10;
        }
        const d = Math.hypot(goal.x - c.x, goal.y - c.y);
        if (!tpos && c.order === 'follow' && Math.hypot(p.x - c.x, p.y - c.y) > 650) {
            // Kommer ikapp (tog en taxi)
            const s = spotNear(world.city, p.x, p.y, c.idx);
            c.x = s.x; c.y = s.y;
            continue;
        }
        const clear = tpos && c.role === 'gunner' ? lineClear(world.city, c.x, c.y, tpos.x, tpos.y) : true;
        if (d > stop || !clear) {
            const m = seek(c, world, goal.x, goal.y, true);
            stepWalker(c, m.mx, m.my, c.speed * (d > 140 ? 1.15 : 0.9), dt, world.city);
            c.phase += dt * c.speed * 0.12;
        } else {
            stepWalker(c, 0, 0, 0, dt, world.city);
            if (tpos) c.angle = Math.atan2(tpos.y - c.y, tpos.x - c.x);
        }
        if (tpos && c.cd <= 0) {
            const dd = Math.hypot(tpos.x - c.x, tpos.y - c.y);
            const dmg = c.dmg[0] + world.rnd() * (c.dmg[1] - c.dmg[0]);
            if (c.role === 'gunner' && dd < R.range && clear) {
                c.cd = R.cd;
                world.crewShoot(c, tpos, dmg, tgt);
            } else if (dd < R.range) {
                c.cd = R.cd;
                c.punchT = 0.2;
                world.crewMelee(c, tgt, dmg);
            }
        }
    }
}

// Order till hela crewet. Anfall väljer närmaste fiende: en spelare, deras crew eller folk som anfaller dig.
export function crewOrder(world, order) {
    const p = world.player;
    let target = null;
    if (order === 'attack') {
        let bd = 520;
        for (const r of world.net ? world.net.remotes().values() : []) {
            if (r.dead || r.in || r.v || world.interior) continue;
            const d = Math.hypot(r.rx - p.x, r.ry - p.y);
            if (d < bd) { bd = d; target = { kind: 'remote', id: r.id, name: r.name }; }
            (r.crew || []).forEach((c, idx) => {
                if (c.d) return;
                const dc = Math.hypot(c.x - p.x, c.y - p.y);
                if (dc < bd) { bd = dc; target = { kind: 'rcrew', id: r.id, idx, name: `${r.name}s crew` }; }
            });
        }
        if (!target) {
            for (const ped of world.peds) {
                if (ped.down > 0 || !(ped.attack || ped.type === 'gang')) continue;
                const d = Math.hypot(ped.x - p.x, ped.y - p.y);
                if (d < bd) { bd = d; target = { kind: 'ped', ped, name: ped.cop ? 'snuten' : 'fienden' }; }
            }
        }
        if (!target) return { ok: false, text: '👥 Ingen fiende i närheten att gå på.' };
    }
    for (const c of world.crew) {
        c.order = order;
        c.target = target;
        if (order === 'hold') { c.holdX = c.x; c.holdY = c.y; }
    }
    const text = order === 'follow' ? '👥 Crew: följ mig!' : order === 'hold' ? '👥 Crew: stanna här och försvara!' : `👥 Crew: gå på ${target.name}!`;
    return { ok: true, text };
}
