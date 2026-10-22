import { describe, it, expect } from 'vitest';
import { findPath, bizRooms } from '../src/city/interiors-biz-a.js';
import {
    INTERIORS, LEGEND, IN_TILE, createInteriorState, updateInterior, interiorSolid, interactionAt, atInteriorExit,
    circleClear, drawInterior, drawInteriorLights
} from '../src/city/interiors.js';
import { mulberry32 } from '../src/city/rng.js';

const T = IN_TILE;
const IDS = ['kebab', 'barber', 'gym', 'studio'];
const NAMES = { kebab: 'Mehmets Kebab', barber: 'Frisören på hörnet', gym: 'Hustle Gym', studio: 'Beat Studio' };
const SIGNS = { kebab: 'MEHMETS KEBAB', barber: 'FRISÖREN PÅ HÖRNET', gym: 'HUSTLE GYM', studio: 'BEAT STUDIO' };
const DT = 1 / 30;

const customers = st => st.npcs.filter(n => n.kind === 'customer');
const staffOf = st => st.npcs.filter(n => n.beh === 'staff');
const tileOf = (def, x, y) => def.rows[Math.floor(y / T)][Math.floor(x / T)];

function reachable(def, sx, sy) {
    const seen = new Set([sx + ',' + sy]), q = [[sx, sy]];
    while (q.length) {
        const [x, y] = q.pop();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
            if (seen.has(k) || interiorSolid(def, nx * T + T / 2, ny * T + T / 2)) continue;
            seen.add(k); q.push([nx, ny]);
        }
    }
    return seen;
}
const tileKey = (x, y) => Math.floor(x / T) + ',' + Math.floor(y / T);

// Kör verksamheten och räknar försäljningar (tömmer events varje bildruta, som världen gör)
function run(st, seconds, rnd, each) {
    let sales = 0;
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i++) {
        updateInterior(st, DT, rnd);
        for (const e of st.events) if (e.type === 'sale') sales++;
        st.events.length = 0;
        if (each) each(st, i);
    }
    return sales;
}

describe('verksamheternas rum (A)', () => {
    it('har exakt de fyra id:na från SHOPS, med rätt namn och tema', () => {
        for (const id of IDS) {
            const def = INTERIORS[id];
            expect(def, id).toBeDefined();
            expect(def.id).toBe(id);
            expect(def.name).toBe(NAMES[id]);
            expect(def.theme).toBe('biz-' + id);
            expect(def.music).toBeNull();
            expect(def.w).toBeGreaterThanOrEqual(16); expect(def.w).toBeLessThanOrEqual(22);
            expect(def.h).toBeGreaterThanOrEqual(11); expect(def.h).toBeLessThanOrEqual(15);
        }
    });

    for (const id of IDS) {
        describe(id, () => {
            const def = INTERIORS[id];

            it('har h rader med w kända tecken, och väggar runt om utom ingången', () => {
                expect(def.rows.length).toBe(def.h);
                for (const r of def.rows) { expect(r.length).toBe(def.w); for (const ch of r) expect(LEGEND[ch], 'okänt tecken ' + ch).toBeDefined(); }
                for (let x = 0; x < def.w; x++) expect('#e').toContain(def.rows[def.h - 1][x]);
                for (let x = 0; x < def.w; x++) expect(def.rows[0][x]).toBe('#');
                for (let y = 0; y < def.h; y++) { expect(def.rows[y][0]).toBe('#'); expect(def.rows[y][def.w - 1]).toBe('#'); }
                const doors = [...def.rows[def.h - 1]].map((c, i) => c === 'e' ? i : -1).filter(i => i >= 0);
                expect(doors.length).toBe(2);
                expect(doors[0] + 1).toBe(doors[1]);
                expect(doors[0] + doors[1] + 1).toBe(def.w); // ingången mitt i nedersta raden
                def.rows.forEach((r, y) => { if (y < def.h - 1) expect(r.includes('e'), 'dörr utanför nedersta raden').toBe(false); });
            });

            it('har solida och fria rutor som stämmer med teckenförklaringen', () => {
                def.rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
                    expect(interiorSolid(def, tx * T + T / 2, ty * T + T / 2), `${ch} ${tx},${ty}`).toBe(LEGEND[ch].solid);
                }));
            });

            it('startar spelaren på fritt golv, med dörren, kassan och ingången i rätt ordning', () => {
                expect(interiorSolid(def, def.spawn.x, def.spawn.y)).toBe(false);
                expect(circleClear(def, def.spawn.x, def.spawn.y, 9)).toBe(true);
                expect(atInteriorExit(def, def.spawn.x, def.spawn.y)).toBe(false);
                expect(Math.hypot(def.spawn.x - def.exit.x, def.spawn.y - def.exit.y)).toBeGreaterThan(def.exit.r + 25);
                expect(atInteriorExit(def, def.exit.x, def.exit.y)).toBe(true);
                expect(tileOf(def, def.exit.x, Math.min(def.exit.y, def.h * T - 1))).toBe('e');
                expect(def.exit.y).toBeGreaterThan((def.h - 1) * T);
                expect(interiorSolid(def, def.door.x, def.door.y)).toBe(false);
                expect(def.door.y).toBeGreaterThan((def.h - 1) * T);
                expect(interiorSolid(def, def.counter.x, def.counter.y)).toBe(false);
                expect(circleClear(def, def.counter.x, def.counter.y, 9)).toBe(true);
            });

            it('har en disk man kommer fram till: flood fill från spawn når utgången, dörren och interaktionen', () => {
                const sx = Math.floor(def.spawn.x / T), sy = Math.floor(def.spawn.y / T);
                const reach = reachable(def, sx, sy);
                expect(reach.has(tileKey(def.exit.x, def.exit.y))).toBe(true);
                expect(reach.has(tileKey(def.door.x, def.door.y))).toBe(true);
                expect(reach.has(tileKey(def.counter.x, def.counter.y))).toBe(true);
                const it = def.interactions.find(a => a.id === 'counter');
                expect(it).toBeDefined();
                expect(it.label).toMatch(/^E — /);
                expect(it.r).toBeGreaterThanOrEqual(50); expect(it.r).toBeLessThanOrEqual(70);
                expect(interiorSolid(def, it.x, it.y)).toBe(false);
                expect(reach.has(tileKey(it.x, it.y))).toBe(true);
                expect(interactionAt(def, it.x, it.y).id).toBe('counter');
                expect(interactionAt(def, def.counter.x, def.counter.y)?.id).toBe('counter');
                const ids = new Set();
                for (const a of def.interactions) { expect(ids.has(a.id)).toBe(false); ids.add(a.id); }
            });

            it('har kö-platser, stolar, maskiner och personalplatser som går att nå och står fritt', () => {
                const R = bizRooms.get(id);
                const reach = reachable(def, Math.floor(def.spawn.x / T), Math.floor(def.spawn.y / T));
                const free = (x, y, what) => {
                    expect(circleClear(def, x, y, 9), `${what} ${x},${y}`).toBe(true);
                    expect(reach.has(tileKey(x, y)), `${what} nås ${x},${y}`).toBe(true);
                };
                for (const [q, Q] of Object.entries(R.queues)) Q.slots.forEach((s, i) => free(s.x, s.y, `kö ${q}${i}`));
                for (const [name, pool] of Object.entries(R.pools)) pool.forEach((s, i) => {
                    if (s.ax != null) { free(s.ax, s.ay, `${name}${i} ingång`); expect(interiorSolid(def, s.x, s.y), `${name}${i} sitter på möbel`).toBe(true); }
                    else free(s.x, s.y, `${name}${i}`);
                });
                for (const [k, p] of Object.entries(R.at)) free(p.x, p.y, 'punkt ' + k);
                const npcs = R.staff(def, mulberry32(1));
                for (const n of npcs) {
                    // personalen kan ha ett eget område (bakom disken): platserna ska bara nås från varandra
                    const own = reachable(def, Math.floor(n.staff.spots[0].x / T), Math.floor(n.staff.spots[0].y / T));
                    for (const sp of n.staff.spots) {
                        expect(circleClear(def, sp.x, sp.y, 9), `${n.kind} plats ${sp.x},${sp.y}`).toBe(true);
                        expect(own.has(tileKey(sp.x, sp.y)), `${n.kind} når ${sp.x},${sp.y}`).toBe(true);
                    }
                }
                // och rutterna dit är hela
                for (const [name, pool] of Object.entries(R.pools)) pool.forEach((s, i) => {
                    const tx = s.ax != null ? s.ax : s.x, ty = s.ay != null ? s.ay : s.y;
                    const path = findPath(def, def.door.x, def.door.y, tx, ty);
                    expect(path[path.length - 1]).toEqual({ x: tx, y: ty });
                    let px = def.door.x, py = def.door.y;
                    for (const p of path) {
                        const n = Math.ceil(Math.hypot(p.x - px, p.y - py) / 4);
                        for (let k = 1; k <= n; k++) expect(circleClear(def, px + (p.x - px) * k / n, py + (p.y - py) * k / n, 6), `${name}${i} rutt`).toBe(true);
                        px = p.x; py = p.y;
                    }
                });
            });

            it('är redan igång när man kommer in: personal och kunder mitt i sina ärenden', () => {
                const st = createInteriorState(id, mulberry32(11));
                const staff = staffOf(st), cs = customers(st);
                expect(staff.length).toBeGreaterThanOrEqual(2);
                expect(cs.length).toBeGreaterThanOrEqual(2);
                for (const n of st.npcs) {
                    for (const k of ['x', 'y', 'angle', 'phase']) expect(Number.isFinite(n[k]), `${n.kind}.${k}`).toBe(true);
                    expect(['idle', 'walk', 'sit', 'work', 'dance', 'cheer']).toContain(n.pose);
                    for (const k of ['shirt', 'skin', 'hair']) expect(n.look[k]).toMatch(/^#[0-9a-f]{6}$/i);
                    expect(n.say).toBeNull();
                    if (n.pose !== 'sit') expect(circleClear(def, n.x, n.y, 5), `${n.kind} ${n.x},${n.y}`).toBe(true);
                }
                expect(st.events.length).toBe(0);
                expect(st.owned).toBe(false); expect(st.flow).toBe(1); expect(st.panic).toBe(0);
                // kunderna ser olika ut
                expect(new Set(cs.map(n => n.look.shirt + n.look.skin)).size).toBeGreaterThan(1);
            });

            it('ger försäljning i flera minuter, håller kunderna under taket och alla fria från möbler', () => {
                for (const seed of [1, 2, 3]) {
                    const rnd = mulberry32(seed);
                    const st = createInteriorState(id, rnd);
                    const R = bizRooms.get(id);
                    let maxC = 0;
                    const violations = [];
                    const sales = run(st, 120, rnd, (s) => {
                        const cs = customers(s);
                        maxC = Math.max(maxC, cs.length);
                        for (const n of s.npcs) {
                            const where = `${id} ${n.kind} ${n.x.toFixed(1)},${n.y.toFixed(1)} ${n.pose}`;
                            if (!Number.isFinite(n.x + n.y + n.angle + n.phase)) violations.push('ej ändlig: ' + where);
                            else if (Math.abs(n.angle) > Math.PI + 1e-9) violations.push('vinkel: ' + where);
                            else if (n.pose !== 'sit' && !circleClear(def, n.x, n.y, 5)) violations.push('i möbel: ' + where);
                        }
                    });
                    expect(violations.slice(0, 5)).toEqual([]);
                    expect(sales, `${id} frö ${seed}`).toBeGreaterThanOrEqual(6);
                    expect(maxC).toBeLessThanOrEqual(R.maxCust);
                    expect(st.npcs.length).toBeLessThanOrEqual(R.maxCust + staffOf(st).length);
                }
            });

            it('har inga fastlåsta kunder: alla går hem inom en rimlig tid', () => {
                const rnd = mulberry32(21);
                const st = createInteriorState(id, rnd);
                const born = new Map(st.npcs.filter(n => n.kind === 'customer').map(n => [n, 0]));
                let oldest = 0;
                run(st, 200, rnd, s => {
                    for (const n of customers(s)) if (!born.has(n)) born.set(n, s.t);
                    for (const n of customers(s)) oldest = Math.max(oldest, s.t - born.get(n));
                });
                expect(oldest).toBeLessThan(110);
            });

            it('betalar vid disken: försäljningen sker vid def.counter', () => {
                const rnd = mulberry32(5);
                const st = createInteriorState(id, rnd);
                let seen = 0;
                for (let i = 0; i < 120 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    for (const e of st.events) { expect(e).toEqual({ type: 'sale', x: def.counter.x, y: def.counter.y }); seen++; }
                    st.events.length = 0;
                }
                expect(seen).toBeGreaterThan(0);
            });

            it('har kunder som kommer in genom dörren och lämnar den igen', () => {
                const rnd = mulberry32(8);
                const st = createInteriorState(id, rnd);
                const arrived = new Set(), left = new Set(), all = new Set(st.npcs);
                let gone = 0;
                for (let i = 0; i < 150 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    for (const n of st.npcs) {
                        if (!all.has(n)) { all.add(n); arrived.add(n); expect(Math.hypot(n.x - def.door.x, n.y - def.door.y), 'dyker upp vid dörren').toBeLessThan(10); }
                    }
                    for (const n of all) if (!st.npcs.includes(n) && !left.has(n)) { left.add(n); gone++; }
                    st.events.length = 0;
                }
                expect(arrived.size).toBeGreaterThan(5);
                expect(gone).toBeGreaterThan(3);
                for (const n of left) expect(n.kind).toBe('customer'); // personalen går aldrig
                expect(st.npcs.length).toBeLessThanOrEqual(20); // inget växer obegränsat
            });

            it('skalar kundflödet med state.flow: 0 = inga nya, mer folk ger fler försäljningar', () => {
                const sales = flow => {
                    const rnd = mulberry32(6);
                    const st = createInteriorState(id, rnd);
                    st.flow = flow;
                    return run(st, 90, rnd);
                };
                const none = (() => {
                    const rnd = mulberry32(6);
                    const st = createInteriorState(id, rnd);
                    st.flow = 0;
                    const before = new Set(st.npcs);
                    run(st, 90, rnd);
                    return st.npcs.filter(n => !before.has(n)).length;
                })();
                expect(none).toBe(0);
                expect(sales(2)).toBeGreaterThanOrEqual(sales(0.4));
                expect(sales(1)).toBeGreaterThan(sales(0.2));
            });

            it('vid rån: kunderna springer ut inom 10 s, inga nya kommer, personalen sträcker upp händerna — sedan kommer kunder igen', () => {
                const rnd = mulberry32(13);
                const st = createInteriorState(id, rnd);
                run(st, 25, rnd);
                expect(customers(st).length).toBeGreaterThan(0);
                st.panic = 10;
                const texts = new Set();
                let maxC = customers(st).length;
                const staff = staffOf(st);
                for (let i = 0; i < 10 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    st.events.length = 0;
                    const c = customers(st).length;
                    expect(c, 'inga nya kunder under rånet').toBeLessThanOrEqual(maxC);
                    maxC = Math.min(maxC, c);
                    if (i > 45) for (const n of staff) { expect(n.pose, `${n.kind} händerna upp`).toBe('cheer'); }
                    for (const n of staff) if (n.say) texts.add(n.say.text);
                    for (const n of st.npcs) if (n.pose !== 'sit') expect(circleClear(def, n.x, n.y, 5), `${n.kind} ${n.x},${n.y}`).toBe(true);
                }
                expect(customers(st).length).toBe(0);
                expect(st.panic).toBeCloseTo(0, 5);
                expect(texts.size).toBeGreaterThan(0);
                expect([...texts].some(t => /lugnt|pengarna|kassan|skjut|masterbanden|familj|PT/i.test(t))).toBe(true);
                for (const n of staff) expect(st.npcs).toContain(n); // personalen står kvar
                // därefter kommer kunder igen
                let sales = 0;
                for (let i = 0; i < 40 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    for (const e of st.events) if (e.type === 'sale') sales++;
                    st.events.length = 0;
                }
                expect(customers(st).length).toBeGreaterThan(0);
                expect(sales).toBeGreaterThan(0);
                for (const n of staff) expect(n.pose, 'personalen jobbar igen').not.toBe('cheer');
            });

            it('rån mitt i en stol eller maskin: man glider ut och springer', () => {
                const rnd = mulberry32(2);
                const st = createInteriorState(id, rnd);
                // vänta tills någon sitter eller tränar
                for (let i = 0; i < 90 * 30 && !customers(st).some(n => n.c.hold && n.c.s && n.c.s.k === 'use' && n.c.s.ph === 3); i++) { updateInterior(st, DT, rnd); st.events.length = 0; }
                st.panic = 10;
                run(st, 10, rnd);
                expect(customers(st).length).toBe(0);
            });

            it('hälsar en gång med "Välkommen, chefen!" när spelaren äger stället', () => {
                const rnd = mulberry32(3);
                const st = createInteriorState(id, rnd);
                run(st, 5, rnd);
                st.owned = true;
                const said = new Map();
                for (let i = 0; i < 40 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    st.events.length = 0;
                    for (const n of staffOf(st)) {
                        const hello = n.say && n.say.text === 'Välkommen, chefen!';
                        if (hello && !n._hello) said.set(n, (said.get(n) || 0) + 1);
                        n._hello = hello;
                    }
                }
                const staff = staffOf(st);
                expect(said.size).toBe(staff.length);
                for (const n of staff) expect(said.get(n), n.kind).toBe(1);
            });

            it('personalen har kinds, jobbar och tittar på spelaren när den är nära', () => {
                const rnd = mulberry32(4);
                const st = createInteriorState(id, rnd);
                const kinds = new Set(staffOf(st).map(n => n.kind));
                expect(kinds.size).toBeGreaterThanOrEqual(2);
                const poses = new Set();
                run(st, 60, rnd, s => { for (const n of staffOf(s)) poses.add(n.pose); });
                expect(poses.has('work')).toBe(true);
                const n = staffOf(st).find(m => !m.staff.walking);
                if (n) {
                    n.staff.wait = 1e6; n.staff.walking = false; n.pose = 'idle'; n.mv = null;
                    st.focus = { x: n.x, y: n.y + 60 };
                    // kassörer och frisörer kan ha ett ärende: ta bort kunderna så att de står fria
                    for (const c of customers(st)) c.gone = true;
                    st.flow = 0;
                    for (let i = 0; i < 90; i++) { n.staff.wait = 1e6; n.staff.walking = false; updateInterior(st, DT, rnd); }
                    expect(n.angle).toBeCloseTo(Math.PI / 2, 1);
                }
            });

            it('är deterministisk för samma slump och klarar konstant slump och stora tidssteg', () => {
                const a = createInteriorState(id, mulberry32(77)), b = createInteriorState(id, mulberry32(77));
                const ra = mulberry32(5), rb = mulberry32(5);
                for (let i = 0; i < 60 * 30; i++) { updateInterior(a, DT, ra); updateInterior(b, DT, rb); a.events.length = b.events.length = 0; }
                expect(JSON.stringify(a.npcs)).toBe(JSON.stringify(b.npcs));
                for (const v of [0, 0.5, 0.999999]) {
                    const st = createInteriorState(id, () => v);
                    for (let i = 0; i < 90 * 30; i++) { updateInterior(st, DT, () => v); st.events.length = 0; }
                    for (const n of st.npcs) expect(Number.isFinite(n.x + n.y + n.angle + n.phase)).toBe(true);
                }
                const st = createInteriorState(id, mulberry32(2));
                const r = mulberry32(2);
                for (let i = 0; i < 300; i++) { updateInterior(st, 5, r); st.events.length = 0; } // klampas till 0,1 s
                for (const n of st.npcs) expect(Number.isFinite(n.x + n.y)).toBe(true);
            });

            it('lämnar NPC:er i slagsmål (n.brawl) helt ifred och tar tillbaka dem när bråket är över', () => {
                for (const pickStaff of [false, true]) {
                    const rnd = mulberry32(pickStaff ? 31 : 30);
                    const st = createInteriorState(id, rnd);
                    run(st, 12, rnd);
                    const cand = pickStaff ? staffOf(st)[0] : customers(st).find(n => n.c && n.c.s && n.c.s.k !== 'leave') || customers(st)[0];
                    expect(cand).toBeDefined();
                    cand.brawl = 'fight';
                    const snap = { x: cand.x, y: cand.y, angle: cand.angle, pose: cand.pose, phase: cand.phase };
                    run(st, 30, rnd);
                    expect(st.npcs).toContain(cand);
                    expect({ x: cand.x, y: cand.y, angle: cand.angle, pose: cand.pose, phase: cand.phase }).toEqual(snap);
                    // spelets kod ställer bråket åt sidan: tillbaka till dörren och ut
                    cand.brawl = null; cand.leaving = true;
                    let gone = false;
                    for (let i = 0; i < 40 * 30 && !gone; i++) { updateInterior(st, DT, rnd); st.events.length = 0; gone = !st.npcs.includes(cand); }
                    expect(gone, pickStaff ? 'personal som slagits går ut' : 'kund som slagits går ut').toBe(true);
                }
            });

            it('räknar inte NPC:er i slagsmål som kunder: övriga kommer och går som vanligt', () => {
                const rnd = mulberry32(40);
                const st = createInteriorState(id, rnd);
                run(st, 10, rnd);
                const R = bizRooms.get(id);
                const fighters = customers(st);
                for (const n of fighters) n.brawl = 'fight';
                const frozen = fighters.map(n => [n.x, n.y]);
                let others = 0, sales = 0;
                for (let i = 0; i < 60 * 30; i++) {
                    updateInterior(st, DT, rnd);
                    for (const e of st.events) if (e.type === 'sale') sales++;
                    st.events.length = 0;
                    const active = customers(st).filter(n => !n.brawl);
                    others = Math.max(others, active.length);
                    expect(active.length).toBeLessThanOrEqual(R.maxCust);
                }
                expect(others).toBeGreaterThan(0);
                expect(sales).toBeGreaterThan(0);
                fighters.forEach((n, i) => expect([n.x, n.y]).toEqual(frozen[i]));
            });
        });
    }
});

// ── Ritning mot en låtsas-canvas (inget DOM i Node) ──
function mockCtx() {
    const props = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const log = { texts: [], depth: 0 };
    const grad = { addColorStop() {} };
    const methods = {
        save() { stack.push({ ...props }); log.depth++; },
        restore() { Object.assign(props, stack.pop()); log.depth--; },
        fillText(s) { log.texts.push(String(s)); },
        measureText: s => ({ width: String(s).length * 6 }),
        createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        drawImage() {}
    };
    const ctx = new Proxy({}, {
        get(_, k) { if (k in methods) return methods[k]; if (k in props) return props[k]; return () => {}; },
        set(_, k, v) { props[k] = v; return true; }
    });
    return { ctx, log, props };
}

function withFakeDom(fn) {
    const canvases = [];
    globalThis.document = {
        createElement() { const m = mockCtx(); const cv = { width: 0, height: 0, m, getContext: () => m.ctx }; canvases.push(cv); return cv; }
    };
    try { return fn(canvases); } finally { delete globalThis.document; }
}

describe('verksamheternas ritning', () => {
    for (const id of IDS) {
        it(`${id}: ritar golv, möbler, skylt, folk och ljus utan att läcka canvas-state`, () => {
            const rnd = mulberry32(9);
            const st = createInteriorState(id, rnd);
            for (let i = 0; i < 20 * 30; i++) { updateInterior(st, DT, rnd); st.events.length = 0; }
            withFakeDom(canvases => {
                const { ctx, log, props } = mockCtx();
                const drawn = [];
                const view = { x0: 0, y0: 0, x1: st.def.w * T, y1: st.def.h * T };
                for (const t of [0.4, 2.7, 9.1]) drawInterior(ctx, st, view, t, (c, n) => drawn.push(n));
                expect(drawn.length).toBe(st.npcs.length * 3);
                expect(log.depth).toBe(0);
                expect(props.globalAlpha).toBe(1);
                // statiska lagret målades i en egen canvas med rummets skylt
                const painted = canvases.flatMap(c => c.m.log.texts);
                expect(painted).toContain(SIGNS[id]);
                for (const c of canvases) { expect(c.m.log.depth).toBe(0); }
                const L = mockCtx();
                drawInteriorLights(L.ctx, st, null, 3.3);
                expect(L.log.depth).toBe(0);
                expect(L.props.globalCompositeOperation).toBe('source-over');
                expect(L.props.globalAlpha).toBe(1);
            });
        });
    }

    it('ritar rätt tillbehör för alla beteenden utan att kasta', () => {
        for (const id of IDS) {
            const rnd = mulberry32(14);
            const st = createInteriorState(id, rnd);
            const seen = new Set();
            withFakeDom(() => {
                const { ctx } = mockCtx();
                const view = { x0: 0, y0: 0, x1: st.def.w * T, y1: st.def.h * T };
                for (let i = 0; i < 100 * 30; i++) {
                    updateInterior(st, DT, rnd); st.events.length = 0;
                    if (i % 15 === 0) { drawInterior(ctx, st, view, st.t, () => {}); for (const n of st.npcs) if (n.act) seen.add(n.act); }
                }
            });
            expect(seen.size, id).toBeGreaterThan(0);
        }
    });
});
