// Fängelset Kåken: karta, kontrakt, folk, larm och barbråk
import { describe, it, expect } from 'vitest';
import '../src/city/interiors-prison.js';
import {
    IN_TILE, INTERIORS, LEGEND, createInteriorState, updateInterior, interiorSolid, interactionAt,
    atInteriorExit, drawInterior, drawInteriorLights
} from '../src/city/interiors.js';
import { mulberry32 } from '../src/city/rng.js';

const T = IN_TILE;
const def = INTERIORS.prison;
const OWN = '`^<>|{}[]\'",:_';
const BASE = '#.e+';
const IDS = ['bail', 'warden', 'weights', 'dealer', 'tunnel', 'phone', 'guard'];
const tileOf = (x, y) => [Math.floor(x / T), Math.floor(y / T)];
const key = (x, y) => x + ',' + y;
const inBox = (n, b) => n.x >= b.x0 && n.x < b.x1 && n.y >= b.y0 && n.y < b.y1;
const inmates = st => st.npcs.filter(n => n.kind === 'inmate');

// Flood fill (4 riktningar) över gångbara rutor från spawn
function reachable() {
    const [sx, sy] = tileOf(def.spawn.x, def.spawn.y);
    const seen = new Set([key(sx, sy)]), q = [[sx, sy]];
    while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (seen.has(key(nx, ny)) || interiorSolid(def, nx * T + T / 2, ny * T + T / 2)) continue;
            seen.add(key(nx, ny)); q.push([nx, ny]);
        }
    }
    return seen;
}
const isReach = (seen, p) => seen.has(key(...tileOf(p.x, p.y)));

function sim(seconds, { seed = 7, dt = 1 / 30, before, check } = {}) {
    const rnd = mulberry32(seed), st = createInteriorState('prison', rnd);
    if (before) before(st);
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
        updateInterior(st, dt, rnd);
        st.events.length = 0;
        if (check && check(st, i * dt) === false) break;
    }
    return { st, rnd };
}

describe('Kåken: kartan', () => {
    it('är registrerad med rätt namn, tema och storlek', () => {
        expect(def).toBeDefined();
        expect(def.name).toBe('Kåken');
        expect(def.theme).toBe('prison');
        expect(def.w).toBeGreaterThanOrEqual(28); expect(def.w).toBeLessThanOrEqual(36);
        expect(def.h).toBeGreaterThanOrEqual(20); expect(def.h).toBeLessThanOrEqual(28);
    });

    it('har rader som alla är w tecken långa och bara tillåtna tecken', () => {
        expect(def.rows.length).toBe(def.h);
        for (const r of def.rows) expect(r.length).toBe(def.w);
        const used = new Set(def.rows.join(''));
        for (const ch of used) expect(BASE + OWN, `tecknet ${ch}`).toContain(ch);
        for (const ch of Object.keys(def.legend)) {
            expect(OWN).toContain(ch);
            expect(LEGEND[ch]).toBe(def.legend[ch]);
            expect(def.legend[ch].solid).toBe(true);
        }
    });

    it('har vägg runt hela kanten utom porten (utgången)', () => {
        for (let y = 0; y < def.h; y++) for (let x = 0; x < def.w; x++) {
            if (x > 0 && y > 0 && x < def.w - 1 && y < def.h - 1) continue;
            const ch = def.rows[y][x];
            if (ch === 'e') { expect(y).toBe(def.h - 1); continue; }
            expect(ch, `kant ${x},${y}`).toBe('#');
        }
        const gate = [...def.rows[def.h - 1]].filter(c => c === 'e').length;
        expect(gate).toBe(2);
        expect(def.rows[def.h - 1][Math.floor(def.exit.x / T)]).toBe('e');
        expect(atInteriorExit(def, def.exit.x, def.exit.y)).toBe(true);
        expect(atInteriorExit(def, def.spawn.x, def.spawn.y)).toBe(false);
    });

    it('har spawn, dörr, grind, tunnel, celler och alla interaktioner gångbara och nåbara från spawn', () => {
        const seen = reachable();
        const pts = { spawn: def.spawn, door: def.door, gate: def.gate, tunnel: def.tunnel, warden: def.warden, visitIn: def.visit.inmate, visitOut: def.visit.visitor };
        for (const [name, p] of Object.entries(pts)) {
            expect(interiorSolid(def, p.x, p.y), name).toBe(false);
            expect(isReach(seen, p), name).toBe(true);
        }
        expect(def.cells.length).toBeGreaterThanOrEqual(6);
        expect(def.cells.length).toBeLessThanOrEqual(8);
        def.cells.forEach((c, i) => {
            expect(interiorSolid(def, c.x, c.y), 'cell ' + i).toBe(false);
            expect(interiorSolid(def, c.door.x, c.door.y), 'gallerdörr ' + i).toBe(false);
            expect(isReach(seen, c), 'cell ' + i).toBe(true);
            expect(isReach(seen, c.door), 'gallerdörr ' + i).toBe(true);
            expect(inBox(c, c.box)).toBe(true);
            // gallerdörren sitter i cellens nederkant, mot korridoren
            expect(c.door.y).toBeGreaterThan(c.box.y1 - 1);
            expect(c.door.y).toBeLessThan(c.box.y1 + T);
        });
        expect(Number.isInteger(def.playerCell)).toBe(true);
        expect(inBox(def.tunnel, def.cells[def.playerCell].box)).toBe(true);
        for (const a of def.interactions) {
            expect(interiorSolid(def, a.x, a.y), a.id).toBe(false);
            expect(isReach(seen, a), a.id).toBe(true);
        }
        // gården ligger innanför murarna
        const y = def.yard;
        expect(y.x0).toBeGreaterThan(0); expect(y.y0).toBeGreaterThan(0);
        expect(y.x1).toBeLessThanOrEqual(def.w * T); expect(y.y1).toBeLessThanOrEqual(def.h * T);
    });

    it('interactionAt hittar alla sju, med räckvidd 40–70 och E-etikett', () => {
        expect(def.interactions.map(a => a.id).sort()).toEqual([...IDS].sort());
        for (const a of def.interactions) {
            expect(a.r).toBeGreaterThanOrEqual(40); expect(a.r).toBeLessThanOrEqual(70);
            expect(a.label.startsWith('E — ')).toBe(true);
            expect(interactionAt(def, a.x, a.y).id).toBe(a.id);
        }
        expect(def.interactions.find(a => a.id === 'bail').label).toBe('E — Vakten: borgen och frisläppning');
        expect(def.interactions.find(a => a.id === 'dealer').label).toBe('E — Snacka med Snus-Sune');
        expect(def.interactions.find(a => a.id === 'tunnel').label).toBe('E — Gräv');
        expect(def.interactions.find(a => a.id === 'weights').label).toBe('E — Träna');
        expect(def.interactions.find(a => a.id === 'phone').label).toBe('E — Ring crewet');
        expect(def.interactions.find(a => a.id === 'guard').label).toBe('E — Snacka med vakten');
        // spawn står inte mitt i en interaktion
        expect(interactionAt(def, def.spawn.x, def.spawn.y)).toBe(null);
    });
});

describe('Kåken: folket', () => {
    it('populate ger minst fyra vakter, minst åtta fångar, Snus-Sune, direktören, kocken och en besökare', () => {
        const st = createInteriorState('prison', mulberry32(1));
        const kinds = k => st.npcs.filter(n => n.kind === k);
        expect(kinds('guard').length).toBeGreaterThanOrEqual(4);
        expect(kinds('inmate').length).toBeGreaterThanOrEqual(8);
        expect(kinds('warden').length).toBe(1);
        expect(kinds('cook').length).toBe(1);
        expect(kinds('visitor').length).toBeGreaterThanOrEqual(1);
        for (const n of kinds('inmate')) expect(n.look.shirt).toBe('#f97316');
        for (const n of kinds('guard')) expect(n.look.cap).toBeTruthy();
        const sune = st.npcs.find(n => n.name === 'Snus-Sune');
        expect(sune && sune.kind).toBe('inmate');
        const d = def.interactions.find(a => a.id === 'dealer');
        expect(Math.hypot(sune.x - d.x, sune.y - d.y)).toBeLessThan(d.r);
        // en vakt i vaktrummet
        expect(kinds('guard').some(n => n.y < 4 * T && n.x > 24 * T)).toBe(true);
        // varje fånge har en cell (inte spelarens)
        for (const n of kinds('inmate')) { expect(n.p.cell).toBeGreaterThanOrEqual(0); expect(n.p.cell).not.toBe(def.playerCell); }
    });

    it('är deterministisk med samma slumpfrö', () => {
        const a = sim(20, { seed: 5 }).st, b = sim(20, { seed: 5 }).st;
        expect(a.npcs.map(n => [n.kind, Math.round(n.x), Math.round(n.y), n.pose])).toEqual(b.npcs.map(n => [n.kind, Math.round(n.x), Math.round(n.y), n.pose]));
    });

    it('120 s: ändliga koordinater, ingen i en solid ruta (utom sittande), antalet växer inte', () => {
        let start = 0, max = 0, sawVisitorIn = false, sawWalk = false, acts = new Set(), say = 0;
        sim(120, {
            seed: 3,
            before: st => { start = st.npcs.length; },
            check: st => {
                max = Math.max(max, st.npcs.length);
                for (const n of st.npcs) {
                    expect(Number.isFinite(n.x) && Number.isFinite(n.y), n.kind).toBe(true);
                    expect(Number.isFinite(n.angle)).toBe(true);
                    if (n.pose !== 'sit') expect(interiorSolid(def, n.x, n.y), `${n.kind} ${n.p.act} ${Math.round(n.x)},${Math.round(n.y)}`).toBe(false);
                    if (n.kind === 'visitor' && n.y > 23 * T) sawVisitorIn = true;
                    if (n.pose === 'walk') sawWalk = true;
                    if (n.kind === 'inmate' && n.p.act) acts.add(n.p.act);
                    if (n.say) say++;
                }
            }
        });
        expect(max).toBeLessThanOrEqual(start + 3);
        expect(sawWalk).toBe(true);
        expect(say).toBeGreaterThan(0);
        // fångarna byter aktivitet (gård, matsal, cell ...)
        expect(acts.size).toBeGreaterThanOrEqual(6);
        expect(sawVisitorIn).toBe(true);
    });

    it('fångar går aldrig ut genom porten, besökare tas bort när de gått ut', () => {
        const seen = new Set();
        let removed = 0;
        sim(150, {
            seed: 11,
            check: st => {
                for (const n of st.npcs) {
                    if (n.kind === 'inmate') expect(n.y).toBeLessThan(23 * T);
                    seen.add(n);
                }
                for (const n of seen) if (!st.npcs.includes(n)) { expect(n.kind).toBe('visitor'); removed++; seen.delete(n); }
            }
        });
        expect(removed).toBeGreaterThan(0);
    });

    it('basket: bollen går mellan spelarna på planen', () => {
        const modes = new Set();
        let holders = new Set();
        sim(60, { seed: 2, check: st => { const B = st.prison.ball; modes.add(B.mode); if (B.holder) holders.add(B.holder); } });
        expect(modes.has('hold')).toBe(true);
        expect(modes.has('pass') || modes.has('shot')).toBe(true);
        expect(holders.size).toBeGreaterThanOrEqual(2);
    });
});

describe('Kåken: larm', () => {
    it('inlåsning 10 s: alla fångar i sin cell inom ~12 s, dörrarna stängs, vakterna till slussen, sen tillbaka', () => {
        const rnd = mulberry32(9), st = createInteriorState('prison', rnd);
        for (let i = 0; i < 30 * 25; i++) updateInterior(st, 1 / 30, rnd); // mitt i livet
        st.lockdown = 10;
        let allIn = -1, closed = false, guardsAtGate = false;
        for (let i = 0; i < 30 * 12; i++) {
            updateInterior(st, 1 / 30, rnd);
            const ins = inmates(st);
            if (allIn < 0 && ins.every(n => inBox(n, def.cells[n.p.cell].box))) allIn = i / 30;
            if (st.prison.doors.filter((d, k) => k !== def.playerCell).every(d => d < 0.05)) closed = true;
            const gs = st.npcs.filter(n => n.kind === 'guard');
            if (gs.filter(n => Math.hypot(n.x - def.gate.x, n.y - def.gate.y) < 90).length >= 4) guardsAtGate = true;
        }
        expect(allIn, 'alla inne').toBeGreaterThan(0);
        expect(allIn).toBeLessThan(12);
        expect(closed).toBe(true);
        expect(guardsAtGate).toBe(true);
        expect(st.lockdown).toBe(0);
        // efter larmet: dörrarna öppnas och fångarna går ut igen
        let out = 0;
        for (let i = 0; i < 30 * 30; i++) {
            updateInterior(st, 1 / 30, rnd);
            out = Math.max(out, inmates(st).filter(n => !inBox(n, def.cells[n.p.cell].box)).length);
        }
        expect(st.prison.doors.every(d => d > 0.95)).toBe(true);
        expect(out).toBeGreaterThanOrEqual(Math.ceil(inmates(st).length / 2));
        expect(st.npcs.filter(n => n.kind === 'guard').every(n => !n.p.ov)).toBe(true);
    });

    it('lockCells håller en cells dörr stängd', () => {
        const rnd = mulberry32(4), st = createInteriorState('prison', rnd);
        st.lockCells = [true, false, false, false, false, false];
        for (let i = 0; i < 30 * 3; i++) updateInterior(st, 1 / 30, rnd);
        expect(st.prison.doors[0]).toBeLessThan(0.05);
        expect(st.prison.doors[1]).toBeGreaterThan(0.95);
    });

    it('bråk på gården: fångarna där samlas i grupper och skriker, utan att röra n.brawl', () => {
        const rnd = mulberry32(12), st = createInteriorState('prison', rnd);
        for (let i = 0; i < 30 * 5; i++) updateInterior(st, 1 / 30, rnd);
        st.riot = 15;
        let cheer = 0, shouts = 0;
        for (let i = 0; i < 30 * 12; i++) {
            updateInterior(st, 1 / 30, rnd);
            for (const n of st.npcs) {
                expect(n.brawl).toBeFalsy();
                if (n.p.ov === 'riot' && n.kind === 'inmate') { if (n.pose === 'cheer') cheer++; if (n.say) shouts++; }
            }
        }
        const rioters = inmates(st).filter(n => n.p.ov === 'riot');
        expect(rioters.length).toBeGreaterThanOrEqual(3);
        for (const n of rioters) expect(n.x).toBeGreaterThanOrEqual(def.yard.x0);
        expect(cheer).toBeGreaterThan(0);
        expect(shouts).toBeGreaterThan(0);
        for (let i = 0; i < 30 * 20; i++) updateInterior(st, 1 / 30, rnd);
        expect(inmates(st).filter(n => n.p.ov === 'riot').length).toBe(0);
    });

    it('slagsmål (panic): fångar i närheten samlas runt och besökarna går', () => {
        const rnd = mulberry32(6), st = createInteriorState('prison', rnd);
        for (let i = 0; i < 30 * 4; i++) updateInterior(st, 1 / 30, rnd);
        const fighter = inmates(st).find(n => n.x > def.yard.x0 && n.y > def.yard.y0);
        expect(fighter).toBeDefined();
        fighter.brawl = 'fight';
        st.panic = 8;
        let crowd = 0;
        for (let i = 0; i < 30 * 6; i++) { updateInterior(st, 1 / 30, rnd); crowd = Math.max(crowd, st.npcs.filter(n => n.p && n.p.ov === 'panic' && n.kind === 'inmate').length); }
        expect(crowd).toBeGreaterThan(0);
        expect(st.npcs.filter(n => n.kind === 'visitor' && !n.leaving && n.p.ov !== 'panic' && n.p.ov !== 'leave').length).toBe(0);
    });
});

describe('Kåken: barbråk-kontraktet', () => {
    for (const kind of ['inmate', 'guard', 'visitor']) {
        it(`${kind}: står still under bråket, sen ${kind === 'inmate' ? 'till cellen och finns kvar' : kind === 'guard' ? 'tillbaka på rundan' : 'ut genom porten och bort'}`, () => {
            const rnd = mulberry32(21), st = createInteriorState('prison', rnd);
            for (let i = 0; i < 30 * 6; i++) updateInterior(st, 1 / 30, rnd);
            const who = kind === 'inmate'
                ? inmates(st).find(n => n.pose === 'walk' && n.p.cell >= 0) || inmates(st).find(n => n.pose !== 'sit')
                : st.npcs.find(n => n.kind === kind);
            expect(who, kind).toBeDefined();
            who.brawl = 'fight';
            updateInterior(st, 1 / 30, rnd);
            const snap = { x: who.x, y: who.y, angle: who.angle, pose: who.pose, phase: who.phase };
            for (let i = 0; i < 30 * 30; i++) {
                updateInterior(st, 1 / 30, rnd);
                expect(st.npcs.includes(who)).toBe(true);
                expect(who.x).toBe(snap.x); expect(who.y).toBe(snap.y);
                expect(who.angle).toBe(snap.angle); expect(who.pose).toBe(snap.pose); expect(who.phase).toBe(snap.phase);
                if (i === 30 * 10) st.lockdown = 4; // även under larm rör vi den inte
            }
            // bråket slut
            who.brawl = null; who.leaving = true;
            let done = -1;
            for (let i = 0; i < 30 * 40; i++) {
                updateInterior(st, 1 / 30, rnd);
                if (kind === 'visitor') { if (!st.npcs.includes(who)) { done = i / 30; break; } continue; }
                expect(st.npcs.includes(who)).toBe(true);
                if (kind === 'inmate' && inBox(who, def.cells[who.p.cell].box) && !who.leaving) { done = i / 30; break; }
                if (kind === 'guard' && !who.leaving && who.p.loop && !who.p.ov) { done = i / 30; break; }
            }
            expect(done, kind).toBeGreaterThanOrEqual(0);
            expect(done).toBeLessThan(30);
            if (kind === 'visitor') expect(Math.abs(who.x - def.door.x)).toBeLessThan(40);
            if (kind === 'inmate') {
                // stannar ett tag i cellen, sen tillbaka ut i livet
                for (let i = 0; i < 30 * 60; i++) updateInterior(st, 1 / 30, rnd);
                expect(st.npcs.includes(who)).toBe(true);
                expect(who.leaving).toBe(false);
            }
        });
    }
});

// ── Ritning mot en låtsas-canvas ──
function mockCtx() {
    const props = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const log = { depth: 0, maxDepth: 0, calls: {} };
    const grad = { addColorStop() {} };
    const methods = {
        save() { stack.push({ ...props }); log.depth++; log.maxDepth = Math.max(log.maxDepth, log.depth); },
        restore() { Object.assign(props, stack.pop()); log.depth--; },
        measureText: s => ({ width: String(s).length * 6 }),
        createLinearGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        createRadialGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage() {}
    };
    const ctx = new Proxy({}, {
        get(_, k) { if (k in methods) return methods[k]; if (k in props) return props[k]; return () => { log.calls[k] = (log.calls[k] || 0) + 1; }; },
        set(_, k, v) { props[k] = v; return true; }
    });
    return { ctx, log, props };
}

describe('Kåken: ritning', () => {
    it('ritar rum, folk och ljus (även under larm) utan att läcka canvas-tillstånd', () => {
        const rnd = mulberry32(4), st = createInteriorState('prison', rnd);
        for (let i = 0; i < 30 * 8; i++) updateInterior(st, 1 / 30, rnd);
        for (const phase of ['normal', 'lock', 'riot']) {
            if (phase === 'lock') { st.lockdown = 5; for (let i = 0; i < 30; i++) updateInterior(st, 1 / 30, rnd); }
            if (phase === 'riot') { st.riot = 5; for (let i = 0; i < 30 * 7; i++) updateInterior(st, 1 / 30, rnd); }
            const { ctx, log, props } = mockCtx();
            const drawn = [];
            expect(() => drawInterior(ctx, st, null, 3.7, (c, n) => drawn.push(n))).not.toThrow();
            expect(drawn.length).toBe(st.npcs.length);
            expect(() => drawInteriorLights(ctx, st, null, 3.7)).not.toThrow();
            drawInterior(ctx, st, { x0: 600, y0: 200, x1: 900, y1: 500 }, 1, () => {});
            expect(log.depth, phase).toBe(0);
            expect(log.maxDepth).toBeLessThan(6);
            expect(props.globalAlpha).toBe(1);
            expect(props.globalCompositeOperation).toBe('source-over');
            expect(log.calls.gradient || 0).toBe(0);
        }
    });
});
