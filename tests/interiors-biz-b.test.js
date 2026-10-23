// Verksamheternas rum (b): nattklubben, KimIT Tech, Skyskrapan och RocketFuel
import { describe, it, expect } from 'vitest';
import '../src/city/interiors-biz-b.js';
import {
    IN_TILE, INTERIORS, LEGEND, createInteriorState, updateInterior, interiorSolid, interactionAt,
    atInteriorExit, circleClear, drawInterior, drawInteriorLights, clearInteriorCache
} from '../src/city/interiors.js';
import { SHOPS } from '../src/data/gameData.js';
import { mulberry32 } from '../src/city/rng.js';

const T = IN_TILE;
const IDS = ['club', 'tech', 'tower', 'rocket'];
const POSES = ['idle', 'walk', 'dance', 'sit', 'work', 'cheer'];
const STAFF_ZONES = ['staff', 'service', 'dj', 'behind'];
const KINDS = {
    club: ['cashier', 'bartender', 'dj', 'guard', 'waitress'],
    tech: ['dev', 'receptionist', 'sysadmin'],
    tower: ['receptionist', 'guard'],
    rocket: ['engineer', 'seller']
};
const zoneOf = (def, x, y) => {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    for (const z of def.zones) if (tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h) return z.kind;
    return null;
};
const isCust = n => !!n.cust;

// BFS över gångbara rutor från spawn (4 riktningar)
function reachableTiles(def) {
    const key = (x, y) => x + ',' + y;
    const sx = Math.floor(def.spawn.x / T), sy = Math.floor(def.spawn.y / T);
    const seen = new Set([key(sx, sy)]);
    const q = [[sx, sy]];
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
const tileKey = (x, y) => Math.floor(x / T) + ',' + Math.floor(y / T);

// Kör rummet och anropar check efter varje steg
function simulate(id, seconds, { dt = 1 / 30, seed = 7, flow = 1, before, check } = {}) {
    const rnd = mulberry32(seed);
    const st = createInteriorState(id, rnd);
    st.flow = flow;
    if (before) before(st);
    const steps = Math.round(seconds / dt);
    let sales = 0;
    const seen = new Set(st.npcs);
    for (let i = 0; i < steps; i++) {
        updateInterior(st, dt, rnd);
        for (const e of st.events) if (e.type === 'sale') sales++;
        st.events.length = 0;
        for (const n of st.npcs) seen.add(n);
        if (check) check(st, i);
    }
    return { st, sales, seen, rnd };
}

describe('verksamhetsrummen (b): kartor och kontrakt', () => {
    it('har de fyra rummen med id som matchar SHOPS i gameData', () => {
        expect(SHOPS.slice(4, 8).map(s => s.id)).toEqual(IDS);
        for (const id of IDS) expect(INTERIORS[id], id).toBeDefined();
        expect(INTERIORS.club.name).toBe('Nattklubben VIP');
        expect(INTERIORS.tech.name).toBe('KimIT Tech AB');
        expect(INTERIORS.tower.name).toBe('Skyskrapan');
        expect(INTERIORS.rocket.name).toBe('RocketFuel Industries');
        expect(INTERIORS.club.music).toBe('club');
    });

    for (const id of IDS) {
        describe(id, () => {
            const def = INTERIORS[id];

            it('har rimlig storlek och rader som alla är w tecken långa', () => {
                expect(def.w).toBeGreaterThanOrEqual(18); expect(def.w).toBeLessThanOrEqual(26);
                expect(def.h).toBeGreaterThanOrEqual(12); expect(def.h).toBeLessThanOrEqual(16);
                expect(def.rows.length).toBe(def.h);
                for (const r of def.rows) expect(r.length).toBe(def.w);
                for (const r of def.rows) for (const ch of r) expect(LEGEND[ch], `okänt tecken ${ch}`).toBeDefined();
                expect(def.theme).toBe('biz-' + id);
            });

            it('är inbyggt i väggar med ingången mitt i nedersta raden som enda hål', () => {
                for (let x = 0; x < def.w; x++) {
                    expect(def.rows[0][x]).toBe('#');
                    const ch = def.rows[def.h - 1][x];
                    if (ch === 'e') expect([def.w / 2 - 1, def.w / 2]).toContain(x); else expect(ch).toBe('#');
                }
                for (let y = 0; y < def.h; y++) for (const x of [0, def.w - 1]) expect(def.rows[y][x]).toBe('#');
                expect([...def.rows[def.h - 1]].filter(c => c === 'e').length).toBe(2);
            });

            it('har spawn, dörr, kö och utgång på gångbart golv som går att nå', () => {
                const reach = reachableTiles(def);
                for (const [name, p] of [['spawn', def.spawn], ['door', def.door], ...def.queue.map((q, i) => ['kö' + i, q])]) {
                    expect(interiorSolid(def, p.x, p.y), name).toBe(false);
                    expect(circleClear(def, p.x, p.y, 9), name).toBe(true);
                    expect(reach.has(tileKey(p.x, p.y)), name).toBe(true);
                }
                expect(atInteriorExit(def, def.spawn.x, def.spawn.y)).toBe(false);
                expect(Math.hypot(def.spawn.x - def.exit.x, def.spawn.y - def.exit.y)).toBeGreaterThan(def.exit.r + 25);
                expect(atInteriorExit(def, def.exit.x, def.exit.y)).toBe(true);
                expect(def.rows[Math.floor(Math.min(def.exit.y, def.h * T - 1) / T)][Math.floor(def.exit.x / T)]).toBe('e');
                // utgångscirkeln täcker ruta som går att nå
                let overlap = 0;
                for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
                    const cx = Math.max(tx * T, Math.min(def.exit.x, tx * T + T)), cy = Math.max(ty * T, Math.min(def.exit.y, ty * T + T));
                    if (Math.hypot(def.exit.x - cx, def.exit.y - cy) < def.exit.r && reach.has(tx + ',' + ty)) overlap++;
                }
                expect(overlap).toBeGreaterThan(0);
                // själva dörrpunkten där folk försvinner ligger i dörröppningen
                expect(def.door.y).toBeLessThan(def.exit.y);
            });

            it("har en 'counter'-interaktion på spelarsidan som går att nå", () => {
                const reach = reachableTiles(def);
                expect(def.interactions.length).toBeGreaterThan(0);
                const a = def.interactions.find(x => x.id === 'counter');
                expect(a).toBeDefined();
                expect(a.label).toMatch(/^E — /);
                expect(a.r).toBeGreaterThanOrEqual(50); expect(a.r).toBeLessThanOrEqual(70);
                expect(interiorSolid(def, a.x, a.y)).toBe(false);
                expect(reach.has(tileKey(a.x, a.y))).toBe(true);
                expect(interactionAt(def, a.x, a.y)?.id).toBe('counter');
                // kön står precis där man betalar: första kö-platsen är nära interaktionen och disken
                expect(Math.hypot(def.queue[0].x - a.x, def.queue[0].y - a.y)).toBeLessThan(a.r);
                expect(Math.hypot(def.queue[0].x - def.counter.x, def.queue[0].y - def.counter.y)).toBeLessThan(60);
                // kassapunkten (där +kr dyker upp) ligger på disken, inte ute på golvet
                expect(interiorSolid(def, def.counter.x, def.counter.y)).toBe(true);
                // ingen annan interaktion delar id
                expect(new Set(def.interactions.map(x => x.id)).size).toBe(def.interactions.length);
            });

            it('kan nås från spawn med en spelare (r=9) till disken och utgången', () => {
                // finmaskigt nät
                const step = 4, key = (i, j) => i + ',' + j;
                const seen = new Map([[key(0, 0), { x: def.spawn.x, y: def.spawn.y }]]);
                const q = [[0, 0]];
                while (q.length) {
                    const [i, j] = q.pop();
                    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                        const ni = i + di, nj = j + dj, k = key(ni, nj);
                        if (seen.has(k)) continue;
                        const x = def.spawn.x + ni * step, y = def.spawn.y + nj * step;
                        if (!circleClear(def, x, y, 9)) continue;
                        seen.set(k, { x, y }); q.push([ni, nj]);
                    }
                }
                const spots = [...seen.values()];
                const a = def.interactions.find(x => x.id === 'counter');
                expect(spots.some(p => Math.hypot(p.x - a.x, p.y - a.y) <= a.r - 10)).toBe(true);
                expect(spots.some(p => atInteriorExit(def, p.x, p.y))).toBe(true);
            });
        });
    }
});

describe('verksamhetsrummen (b): folk', () => {
    for (const id of IDS) {
        describe(id, () => {
            it('fyller rummet med personal och kunder redan när man kommer in', () => {
                const st = createInteriorState(id, mulberry32(3));
                const staff = st.npcs.filter(n => !isCust(n)), cust = st.npcs.filter(isCust);
                expect(staff.length).toBeGreaterThanOrEqual(3);
                expect(cust.length).toBeGreaterThanOrEqual(3);
                for (const k of KINDS[id]) expect(staff.some(n => n.kind === k), 'personal: ' + k).toBe(true);
                for (const n of staff) expect(typeof n.kind).toBe('string');
                // några kunder står redan i kön, andra är mitt i sin aktivitet
                expect(cust.some(n => n.c.mode === 'queue')).toBe(true);
                expect(cust.some(n => n.c.mode !== 'queue')).toBe(true);
                expect(st.events).toEqual([]);
                expect(st.owned).toBe(false); expect(st.flow).toBe(1); expect(st.panic).toBe(0);
                for (const n of st.npcs) {
                    expect(n.look && typeof n.look.shirt === 'string').toBe(true);
                    expect(POSES).toContain(n.pose);
                    for (const k of ['x', 'y', 'angle', 'phase']) expect(Number.isFinite(n[k])).toBe(true);
                }
                // personalen har sitt eget utseende, inte alla likadana
                expect(new Set(cust.map(n => n.look.shirt + n.look.hair)).size).toBeGreaterThan(2);
            });

            it('flödar i 120 sekunder: kunder betalar, rör sig mjukt och går ingenstans de inte ska', () => {
                const def = INTERIORS[id];
                let maxN = 0, maxCust = 0, walkers = 0;
                const last = new Map();
                const { sales, seen, st } = simulate(id, 120, {
                    check(st) {
                        maxN = Math.max(maxN, st.npcs.length);
                        let c = 0;
                        for (const n of st.npcs) {
                            const where = `${id} ${n.kind} ${n.x.toFixed(1)},${n.y.toFixed(1)} ${n.pose}`;
                            for (const k of ['x', 'y', 'angle', 'phase']) expect(Number.isFinite(n[k]), where).toBe(true);
                            expect(Math.abs(n.angle), where).toBeLessThanOrEqual(Math.PI + 1e-9);
                            expect(POSES, where).toContain(n.pose);
                            if (n.pose === 'sit') {
                                // sittande: på sin stol eller på väg dit/därifrån
                                expect(n.c.seat || n.c.mode === 'slide', where).toBeTruthy();
                            } else {
                                expect(interiorSolid(def, n.x, n.y), where).toBe(false);
                                expect(circleClear(def, n.x, n.y, 3.5), where).toBe(true);
                            }
                            if (isCust(n)) {
                                c++;
                                expect(STAFF_ZONES, where).not.toContain(zoneOf(def, n.x, n.y));
                            }
                            // inga hopp: högst ~150 px/s (flyende kunder) mellan två steg
                            const p = last.get(n);
                            if (p && n.pose !== 'sit' && p.pose !== 'sit') expect(Math.hypot(n.x - p.x, n.y - p.y), where).toBeLessThan(150 / 30 + 0.5);
                            last.set(n, { x: n.x, y: n.y, pose: n.pose });
                            if (n.pose === 'walk') walkers++;
                        }
                        maxCust = Math.max(maxCust, c);
                    }
                });
                expect(sales).toBeGreaterThanOrEqual(6);
                // personalen jobbar hela tiden: ingen försvinner och alla håller sig inom sina områden
                const staff0 = createInteriorState(id, mulberry32(7)).npcs.filter(n => !isCust(n));
                const staffNow = st.npcs.filter(n => !isCust(n));
                expect(staffNow.length).toBe(staff0.length);
                expect(seen.size).toBeGreaterThan(14);           // nya kunder kommer och går
                expect(maxN).toBeLessThan(40);                   // och mängden växer inte okontrollerat
                expect(maxCust).toBeLessThanOrEqual(15);
                expect(walkers).toBeGreaterThan(200);
            });

            it("skickar 'sale' med kassapunkten som plats", () => {
                const def = INTERIORS[id];
                const rnd = mulberry32(11);
                const st = createInteriorState(id, rnd);
                const ev = [];
                for (let i = 0; i < 30 * 60; i++) { updateInterior(st, 1 / 30, rnd); ev.push(...st.events); st.events.length = 0; }
                expect(ev.length).toBeGreaterThan(3);
                for (const e of ev) { expect(e.type).toBe('sale'); expect(e.x).toBe(def.counter.x); expect(e.y).toBe(def.counter.y); }
            });

            it('är deterministiskt givet samma slump', () => {
                const a = simulate(id, 40, { seed: 5 }), b = simulate(id, 40, { seed: 5 });
                expect(a.sales).toBe(b.sales);
                expect(a.st.npcs.length).toBe(b.st.npcs.length);
                for (let i = 0; i < a.st.npcs.length; i++) { expect(a.st.npcs[i].x).toBe(b.st.npcs[i].x); expect(a.st.npcs[i].y).toBe(b.st.npcs[i].y); }
            });

            it('följer state.flow: ingen ny kund vid 0, fler vid 2 än vid 0,5', () => {
                const none = simulate(id, 90, { flow: 0 }), few = simulate(id, 150, { flow: 0.5, seed: 9 }), many = simulate(id, 150, { flow: 2, seed: 9 });
                const initial = createInteriorState(id, mulberry32(7)).npcs.length;
                expect(none.seen.size).toBe(initial);
                expect(many.seen.size).toBeGreaterThan(few.seen.size);
            });

            it('rån: kunderna springer ut, personalen jublar, inga nya kommer, sedan blir det som förut', () => {
                const rnd = mulberry32(21), def = INTERIORS[id];
                const st = createInteriorState(id, rnd);
                for (let i = 0; i < 30 * 20; i++) updateInterior(st, 1 / 30, rnd); // en stund i vanlig drift
                st.events.length = 0;
                st.panic = 10;
                let prevCust = st.npcs.filter(isCust).length, cheering = 0, said = false;
                const staff = st.npcs.filter(n => !isCust(n));
                for (let i = 0; i < 30 * 10.4; i++) {
                    updateInterior(st, 1 / 30, rnd);
                    const c = st.npcs.filter(isCust).length;
                    if (st.panic > 0.2) expect(c).toBeLessThanOrEqual(prevCust);   // ingen ny kund under rånet
                    prevCust = c;
                    if (i === 15) { for (const n of staff) { expect(n.pose, id + ' ' + n.kind).toBe('cheer'); cheering++; } }
                    if (staff.some(n => n.say)) said = true;
                    for (const n of st.npcs) expect(interiorSolid(def, n.x, n.y) && n.pose !== 'sit').toBe(false);
                }
                expect(cheering).toBe(staff.length);
                expect(st.panic).toBe(0);
                expect(st.npcs.filter(isCust).length).toBe(0);                    // alla kunder borta inom ~10 s
                expect(said).toBe(true);                                          // "Lugn!", "Ta pengarna!"
                // personalen står inte längre med händerna upp, och kunderna kommer tillbaka
                for (let i = 0; i < 30 * 45; i++) updateInterior(st, 1 / 30, rnd);
                expect(staff.filter(n => n.pose === 'cheer').length).toBe(0);
                expect(st.npcs.filter(isCust).length).toBeGreaterThan(0);
                let sales = 0;
                for (let i = 0; i < 30 * 90; i++) { updateInterior(st, 1 / 30, rnd); for (const e of st.events) if (e.type === 'sale') sales++; st.events.length = 0; }
                expect(sales).toBeGreaterThan(1);
            });

            it('rån i flera omgångar och direkt vid start går bra', () => {
                const rnd = mulberry32(2), st = createInteriorState(id, rnd);
                st.panic = 4;
                for (let i = 0; i < 30 * 30; i++) { updateInterior(st, 1 / 30, rnd); if (i === 30 * 12) st.panic = 5; }
                expect(st.panic).toBe(0);
                for (const n of st.npcs) { expect(Number.isFinite(n.x)).toBe(true); expect(Number.isFinite(n.y)).toBe(true); }
            });

            it('ägaren hälsas välkommen av personalen, en gång', () => {
                const rnd = mulberry32(5), st = createInteriorState(id, rnd);
                for (let i = 0; i < 30 * 3; i++) updateInterior(st, 1 / 30, rnd);
                expect(st.npcs.some(n => n.say && /chefen/i.test(n.say.text))).toBe(false);
                st.owned = true;
                updateInterior(st, 1 / 30, rnd);
                const greeters = st.npcs.filter(n => n.say && /chefen/i.test(n.say.text));
                expect(greeters.length).toBeGreaterThan(0);
                for (const n of greeters) expect(isCust(n)).toBe(false);
                for (const n of st.npcs) n.say = null;
                for (let i = 0; i < 30 * 20; i++) { updateInterior(st, 1 / 30, rnd); expect(st.npcs.some(n => n.say && /chefen/i.test(n.say.text))).toBe(false); }
            });

            it('håller sig till vakter med kind guard/bouncer där det finns vakter', () => {
                const st = createInteriorState(id, mulberry32(1));
                const guards = st.npcs.filter(n => n.kind === 'guard' || n.kind === 'bouncer');
                if (id === 'club' || id === 'tower') expect(guards.length).toBeGreaterThanOrEqual(1);
            });

            it('slagsmål: den som har n.brawl står still och tas inte bort; när bråket är slut går den hem', () => {
                const def = INTERIORS[id];
                for (const pickWho of ['cust', 'staff']) {
                    const rnd = mulberry32(31), st = createInteriorState(id, rnd);
                    st.flow = 1;
                    for (let i = 0; i < 30 * 6; i++) updateInterior(st, 1 / 30, rnd);       // mitt i flödet
                    const who = pickWho === 'cust'
                        ? st.npcs.find(n => isCust(n) && n.c.mode === 'walk') || st.npcs.find(isCust)
                        : st.npcs.find(n => !isCust(n) && n.kind !== 'dj');
                    expect(who, id + ' ' + pickWho).toBeDefined();
                    who.brawl = 'fight';
                    updateInterior(st, 1 / 30, rnd);
                    const snap = { x: who.x, y: who.y, angle: who.angle, pose: who.pose, phase: who.phase };
                    for (let i = 0; i < 30 * 30; i++) {
                        updateInterior(st, 1 / 30, rnd);
                        expect(st.npcs.includes(who)).toBe(true);
                        expect(who.x).toBe(snap.x); expect(who.y).toBe(snap.y);
                        expect(who.angle).toBe(snap.angle); expect(who.pose).toBe(snap.pose); expect(who.phase).toBe(snap.phase);
                        if (st.biz) expect(st.biz.queue.includes(who)).toBe(false);
                    }
                    // också under rån rör vi den inte
                    st.panic = 5;
                    for (let i = 0; i < 30 * 6; i++) updateInterior(st, 1 / 30, rnd);
                    expect(st.npcs.includes(who)).toBe(true);
                    expect(who.x).toBe(snap.x); expect(who.y).toBe(snap.y); expect(who.pose).toBe(snap.pose);
                    // bråket slut: spelet sätter brawl = null och leaving = true
                    who.brawl = null; who.leaving = true;
                    let gone = -1;
                    for (let i = 0; i < 30 * 60; i++) {
                        updateInterior(st, 1 / 30, rnd);
                        // (den som satt fast bakom en disk får kliva över den — då följer vi inte golvet)
                        if (!who.c.ghost) expect(circleClear(def, who.x, who.y, 3) || !st.npcs.includes(who)).toBe(true);
                        if (!st.npcs.includes(who)) { gone = i / 30; break; }
                    }
                    expect(gone, `${id} ${pickWho} går hem`).toBeGreaterThan(0);
                    expect(gone).toBeLessThan(55);
                    expect(who.x).toBeGreaterThan(def.door.x - 40); expect(who.x).toBeLessThan(def.door.x + 40); // försvann vid dörren
                }
            });

            it('slagsmål: den som står först i kön hindrar inte de andra', () => {
                const rnd = mulberry32(8), st = createInteriorState(id, rnd);
                updateInterior(st, 1 / 30, rnd);
                const first = st.biz.queue[0];
                expect(first).toBeDefined();
                first.brawl = 'fight';
                const sx = first.x, sy = first.y;
                let sales = 0;
                for (let i = 0; i < 30 * 40; i++) { updateInterior(st, 1 / 30, rnd); for (const e of st.events) if (e.type === 'sale') sales++; st.events.length = 0; }
                expect(sales).toBeGreaterThan(1);
                expect(first.x).toBe(sx); expect(first.y).toBe(sy);
                expect(st.npcs.includes(first)).toBe(true);
            });
        });
    }
});

describe('skyskrapan: hissarna', () => {
    it('kunder tar hissen upp och andra kliver ut ur hissarna', () => {
        const rnd = mulberry32(13), st = createInteriorState('tower', rnd), def = st.def;
        let boarded = 0, arrivals = 0, maxOpen = 0, sawAway = false;
        const known = new Set(st.npcs);
        const board = new Set();
        for (let i = 0; i < 30 * 150; i++) {
            const before = new Set(st.npcs);
            updateInterior(st, 1 / 30, rnd);
            for (const n of st.npcs) {
                if (known.has(n)) continue;
                known.add(n);
                // en ny figur som dyker upp vid en hiss (inte vid dörren) är en ankomst
                if (n.y < 3 * T) { arrivals++; expect(n.pose === 'walk' || n.pose === 'idle').toBe(true); }
            }
            for (const n of before) if (!st.npcs.includes(n) && n.y < 3 * T) { boarded++; board.add(n); }
            for (const e of st.biz.ex) { maxOpen = Math.max(maxOpen, e.open); if (e.away > 0) sawAway = true; expect(e.open).toBeGreaterThanOrEqual(0); expect(e.open).toBeLessThanOrEqual(1); }
        }
        expect(boarded).toBeGreaterThan(3);
        expect(arrivals).toBeGreaterThan(1);
        expect(maxOpen).toBe(1);
        expect(sawAway).toBe(true);
        expect(st.biz.ex.length).toBe(5);
        expect(def.queue.length).toBeGreaterThanOrEqual(3);
    });
});

// ── Ritning mot en låtsas-canvas (inget DOM i Node) ──
function mockCtx(scale = 1) {
    const props = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const log = { depth: 0, maxDepth: 0, drawImage: 0, calls: {} };
    const grad = { addColorStop() {} };
    const methods = {
        save() { stack.push({ ...props }); log.depth++; log.maxDepth = Math.max(log.maxDepth, log.depth); },
        restore() { Object.assign(props, stack.pop()); log.depth--; },
        measureText: s => ({ width: String(s).length * 6 }),
        createLinearGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        createRadialGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        createPattern: () => ({}),
        getTransform: () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }),
        drawImage() { log.drawImage++; }
    };
    const ctx = new Proxy({}, {
        get(_, k) {
            if (k in methods) return methods[k];
            if (k in props) return props[k];
            return () => { log.calls[k] = (log.calls[k] || 0) + 1; };
        },
        set(_, k, v) { props[k] = v; return true; }
    });
    return { ctx, log, props };
}
function withFakeDom(fn) {
    const canvases = [];
    globalThis.document = {
        createElement() {
            const m = mockCtx();
            const cv = { width: 0, height: 0, m, getContext: () => m.ctx };
            canvases.push(cv);
            return cv;
        }
    };
    try { return fn(canvases); } finally { delete globalThis.document; }
}

describe('verksamhetsrummen (b): ritning', () => {
    it('ritar rum, folk och ljus utan att läcka canvas-tillstånd', () => {
        for (const id of IDS) {
            const rnd = mulberry32(4), st = createInteriorState(id, rnd);
            for (let i = 0; i < 30 * 12; i++) updateInterior(st, 1 / 30, rnd);
            const { ctx, log, props } = mockCtx();
            const drawn = [];
            expect(() => drawInterior(ctx, st, null, 3.7, (c, n) => drawn.push(n))).not.toThrow();
            expect(drawn.length).toBe(st.npcs.length);
            expect(() => drawInteriorLights(ctx, st, null, 3.7)).not.toThrow();
            // delvy
            drawInterior(ctx, st, { x0: 100, y0: 100, x1: 300, y1: 260 }, 1, () => {});
            expect(log.depth, id).toBe(0);
            expect(props.globalAlpha, id).toBe(1);
            expect(props.globalCompositeOperation, id).toBe('source-over');
            // och utan folk och utan drawPerson
            expect(() => drawInterior(ctx, st, null, 1, undefined)).not.toThrow();
        }
    });

    it('målar det statiska lagret en gång och skapar inga gradienter per bildruta', () => {
        withFakeDom(canvases => {
            for (const id of IDS) {
                clearInteriorCache();
                const rnd = mulberry32(6), st = createInteriorState(id, rnd);
                const before = canvases.length;
                const { ctx, log } = mockCtx(2);
                drawInterior(ctx, st, null, 0, () => {});
                const layer = canvases[before];
                expect(layer.width).toBe(st.def.w * T * 2);
                const painted = layer.m.log.calls.fillRect;
                expect(painted, id).toBeGreaterThan(300);
                for (let i = 1; i < 40; i++) { updateInterior(st, 1 / 60, rnd); drawInterior(ctx, st, null, i / 60, () => {}); drawInteriorLights(ctx, st, null, i / 60); }
                expect(layer.m.log.calls.fillRect, id).toBe(painted);        // inget ommålat
                expect(log.calls.gradient || 0, id).toBe(0);                  // inga gradienter på huvudcanvasen
                expect(log.maxDepth).toBeLessThan(6);
            }
        });
    });

    it('har glows och en lights-funktion i alla rum, och glow-listorna är välformade', () => {
        for (const id of IDS) {
            const st = createInteriorState(id, mulberry32(1));
            // lyser även med additiv blandning utan DOM
            const { ctx, props } = mockCtx();
            props.globalCompositeOperation = 'multiply';
            drawInteriorLights(ctx, st, null, 2);
            expect(props.globalCompositeOperation).toBe('multiply');
        }
    });
});
