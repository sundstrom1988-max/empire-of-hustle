import { describe, it, expect } from 'vitest';
import {
    IN_TILE, INTERIORS, LEGEND, createInteriorState, updateInterior, interiorSolid, collideInterior,
    interactionAt, atInteriorExit, circleClear, drawInterior, drawInteriorLights, clearInteriorCache
} from '../src/city/interiors.js';
import { mulberry32 } from '../src/city/rng.js';

const T = IN_TILE;
const defs = Object.values(INTERIORS);
const POSES = ['idle', 'walk', 'dance', 'sit', 'work', 'cheer'];
const tileOf = (def, x, y) => def.rows[Math.floor(y / T)][Math.floor(x / T)];

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

// BFS med en riktig cirkel (radie r) över ett finmaskigt nät: kommer en spelare fram?
function reachableSpots(def, r, step = 4) {
    const key = (i, j) => i + ',' + j;
    const seen = new Map([[key(0, 0), { x: def.spawn.x, y: def.spawn.y }]]);
    const q = [[0, 0]];
    while (q.length) {
        const [i, j] = q.pop();
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ni = i + di, nj = j + dj, k = key(ni, nj);
            if (seen.has(k)) continue;
            const x = def.spawn.x + ni * step, y = def.spawn.y + nj * step;
            if (!circleClear(def, x, y, r)) continue;
            seen.set(k, { x, y }); q.push([ni, nj]);
        }
    }
    return [...seen.values()];
}

describe('rummen', () => {
    for (const def of defs) {
        describe(def.id, () => {
            it('har h rader med w kända tecken vardera', () => {
                expect(def.rows.length).toBe(def.h);
                def.rows.forEach(r => expect(r.length).toBe(def.w));
                for (const r of def.rows) for (const ch of r) expect(LEGEND[ch], `okänt tecken ${ch}`).toBeDefined();
            });

            it('är inbyggt i väggar, med dörröppningen som enda hål', () => {
                for (let x = 0; x < def.w; x++) for (const y of [0, def.h - 1]) expect('#e').toContain(def.rows[y][x]);
                for (let y = 0; y < def.h; y++) for (const x of [0, def.w - 1]) expect(def.rows[y][x]).toBe('#');
                let doors = 0;
                def.rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'e') { doors++; expect(y).toBe(def.h - 1); } }));
                expect(doors).toBeGreaterThanOrEqual(2);
            });

            it('startar spelaren på gångbart golv utanför utgångscirkeln', () => {
                expect(interiorSolid(def, def.spawn.x, def.spawn.y)).toBe(false);
                expect(circleClear(def, def.spawn.x, def.spawn.y, 9)).toBe(true);
                expect(atInteriorExit(def, def.spawn.x, def.spawn.y)).toBe(false);
                expect(Math.hypot(def.spawn.x - def.exit.x, def.spawn.y - def.exit.y)).toBeGreaterThan(def.exit.r + 25);
            });

            it('har en utgångscirkel som ligger över gångbart golv man kan nå', () => {
                const e = def.exit;
                expect(e.r).toBeGreaterThan(10);
                const reach = reachableTiles(def);
                let overlap = 0;
                for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
                    const cx = Math.max(tx * T, Math.min(e.x, tx * T + T)), cy = Math.max(ty * T, Math.min(e.y, ty * T + T));
                    if (Math.hypot(e.x - cx, e.y - cy) < e.r && reach.has(tx + ',' + ty)) overlap++;
                }
                expect(overlap).toBeGreaterThan(0);
                // utgången sitter vid ingångsdörren
                expect(tileOf(def, e.x, Math.min(e.y, def.h * T - 1))).toBe('e');
            });

            it('har interaktioner på gångbart golv som går att nå från spawn', () => {
                expect(def.interactions.length).toBeGreaterThan(0);
                const reach = reachableTiles(def);
                const ids = new Set();
                for (const a of def.interactions) {
                    expect(ids.has(a.id)).toBe(false); ids.add(a.id);
                    expect(a.label).toMatch(/^E — /);
                    expect(interiorSolid(def, a.x, a.y), a.id).toBe(false);
                    expect(reach.has(Math.floor(a.x / T) + ',' + Math.floor(a.y / T)), a.id).toBe(true);
                    expect(interactionAt(def, a.x, a.y)?.id).toBe(a.id);
                }
            });

            it('går att gå fram till varje interaktion och utgången med en spelare (r=9)', () => {
                const spots = reachableSpots(def, 9);
                for (const a of def.interactions) {
                    expect(spots.some(p => Math.hypot(p.x - a.x, p.y - a.y) <= a.r - 10), a.id).toBe(true);
                }
                expect(spots.some(p => atInteriorExit(def, p.x, p.y))).toBe(true);
            });

            it('stänger av personalens områden från gästerna', () => {
                const reach = reachableTiles(def);
                const staff = def.zones.filter(zz => ['dj', 'service', 'staff'].includes(zz.kind));
                expect(staff.length).toBeGreaterThan(0);
                for (const z of staff) {
                    for (let ty = z.y; ty < z.y + z.h; ty++) for (let tx = z.x; tx < z.x + z.w; tx++) expect(reach.has(tx + ',' + ty)).toBe(false);
                }
            });
        });
    }

    it('har exakt de två rummen från specen med rätt mått', () => {
        expect(Object.keys(INTERIORS).sort()).toEqual(['gunshop', 'stripclub']);
        const club = INTERIORS.stripclub, gun = INTERIORS.gunshop;
        expect(club.name).toBe('Club Diamant');
        expect(club.music).toBe('club');
        expect(club.w).toBeGreaterThanOrEqual(28); expect(club.h).toBeGreaterThanOrEqual(20);
        expect(gun.name).toBe('Pang-Pelles Vapen');
        expect(gun.music).toBeNull();
        expect(gun.w).toBe(16); expect(gun.h).toBe(12);
        expect(club.interactions.map(a => a.id).sort()).toEqual(['bartender', 'bouncer', 'manager', 'stage']);
        expect(gun.interactions.map(a => a.id)).toEqual(['seller']);
    });

    it('har två scenstolpar på scenen och scenen är exakt scenrutorna', () => {
        const club = INTERIORS.stripclub, s = club.stage, rw = s.runway;
        let poles = 0;
        club.rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
            const cx = tx * T + T / 2, cy = ty * T + T / 2;
            const onMain = cx > s.x0 && cx < s.x1 && cy > s.y0 && cy < s.y1;
            const onRunway = cx > rw.x0 && cx < rw.x1 && cy > rw.y0 && cy < rw.y1;
            expect(ch === 'T' || ch === 'P', `ruta ${tx},${ty}`).toBe(onMain || onRunway);
            if (ch === 'P') poles++;
        }));
        expect(poles).toBe(2);
    });
});

describe('interiorSolid', () => {
    it('är solid utanför rummet och för icke-tal', () => {
        for (const def of defs) {
            expect(interiorSolid(def, -1, 50)).toBe(true);
            expect(interiorSolid(def, 50, -1)).toBe(true);
            expect(interiorSolid(def, def.w * T, 50)).toBe(true);
            expect(interiorSolid(def, 50, def.h * T)).toBe(true);
            expect(interiorSolid(def, 1e9, 1e9)).toBe(true);
            expect(interiorSolid(def, NaN, 40)).toBe(true);
        }
    });

    it('är solid på väggar, men fri över golv och dörröppning', () => {
        for (const def of defs) {
            def.rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
                const solid = interiorSolid(def, tx * T + T / 2, ty * T + T / 2);
                expect(solid, `${def.id} ${ch} ${tx},${ty}`).toBe(LEGEND[ch].solid);
            }));
        }
    });

    it('blockerar bardisk, bord, soffor, scenkant och ställ', () => {
        const club = INTERIORS.stripclub, gun = INTERIORS.gunshop;
        const at = (def, ch) => {
            for (let ty = 0; ty < def.h; ty++) { const tx = def.rows[ty].indexOf(ch); if (tx >= 0) return [tx * T + 5, ty * T + 5]; }
            throw new Error('saknar ' + ch);
        };
        for (const ch of ['B', 'o', 't', 'h', 'S', 'V', 'D', 'k', 'W', 'T', 'P', 'm', 'f']) expect(interiorSolid(club, ...at(club, ch)), ch).toBe(true);
        for (const ch of ['C', 'G', 'R', 'A', 'Q']) expect(interiorSolid(gun, ...at(gun, ch)), ch).toBe(true);
        // golv och dansgolv är fria
        expect(interiorSolid(club, ...at(club, 'd'))).toBe(false);
        expect(interiorSolid(club, ...at(club, 'c'))).toBe(false);
    });
});

describe('collideInterior', () => {
    const R = 8;

    it('knuffar ut en cirkel som hamnat mitt i en vägg eller möbel', () => {
        for (const def of defs) {
            let tested = 0;
            def.rows.forEach((row, ty) => [...row].forEach((ch, tx) => {
                if (!LEGEND[ch].solid) return;
                for (const [ox, oy] of [[16, 16], [3, 3], [29, 17]]) {
                    const e = { x: tx * T + ox, y: ty * T + oy, vx: 40, vy: -30 };
                    collideInterior(def, e, R);
                    expect(circleClear(def, e.x, e.y, R - 0.01), `${def.id} ${ch} ${tx},${ty} (${ox},${oy}) -> ${e.x},${e.y}`).toBe(true);
                    tested++;
                }
            }));
            expect(tested).toBeGreaterThan(50);
        }
    });

    it('rör inte en cirkel som står fritt', () => {
        for (const def of defs) {
            const e = { x: def.spawn.x, y: def.spawn.y, vx: 10, vy: 20 };
            collideInterior(def, e, R);
            expect(e).toEqual({ x: def.spawn.x, y: def.spawn.y, vx: 10, vy: 20 });
        }
    });

    it('stoppar farten in i väggen men släpper igenom glidning längs den', () => {
        const def = INTERIORS.gunshop;
        // västra väggen: x < 32. Tränger 3 px in och springer snett in i den
        const e = { x: T + R - 3, y: 6 * T + 16, vx: -120, vy: 60 };
        collideInterior(def, e, R);
        expect(e.x).toBeCloseTo(T + R, 5);
        expect(e.vx).toBeGreaterThanOrEqual(-1e-9);
        expect(e.vy).toBe(60);
    });

    it('kan inte gå genom väggen vid full fart, bildruta för bildruta', () => {
        for (const def of defs) {
            const e = { x: def.spawn.x, y: def.spawn.y, vx: 0, vy: 0 };
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
                for (let i = 0; i < 300; i++) {
                    e.vx = dx * 220; e.vy = dy * 220;
                    e.x += e.vx / 60; e.y += e.vy / 60;
                    collideInterior(def, e, R);
                    expect(interiorSolid(def, e.x, e.y)).toBe(false);
                }
            }
        }
    });

    it('återställer en trasig position till startpunkten', () => {
        const def = INTERIORS.stripclub;
        const e = { x: NaN, y: 100, vx: 5, vy: 5 };
        collideInterior(def, e, R);
        expect(e).toEqual({ x: def.spawn.x, y: def.spawn.y, vx: 0, vy: 0 });
    });

    it('tål entiteter utan fart (bara x och y)', () => {
        const def = INTERIORS.gunshop;
        const e = { x: 40, y: 60 };
        collideInterior(def, e, R);
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        expect(circleClear(def, e.x, e.y, R - 0.01)).toBe(true);
    });
});

describe('interactionAt', () => {
    it('ger null mitt i tomma rum', () => {
        expect(interactionAt(INTERIORS.stripclub, 1 * T + 16, 20 * T + 16)).toBeNull();
        expect(interactionAt(INTERIORS.gunshop, 2 * T, 9 * T)).toBeNull();
        expect(interactionAt(INTERIORS.gunshop, NaN, NaN)).toBeNull();
    });

    it('hittar rätt interaktion vid varje NPC-plats', () => {
        const club = INTERIORS.stripclub;
        expect(interactionAt(club, 5 * T + 10, 10 * T + 16).id).toBe('bartender');
        expect(interactionAt(club, 17 * T + 16, 19 * T + 16).id).toBe('bouncer');
        expect(interactionAt(club, 26 * T + 16, 17 * T + 16).id).toBe('manager');
        expect(interactionAt(club, 15 * T, 8 * T + 16).id).toBe('stage');
        expect(interactionAt(INTERIORS.gunshop, 8 * T, 6 * T + 16).id).toBe('seller');
    });

    it('väljer den närmaste när cirklar överlappar', () => {
        const def = { interactions: [{ id: 'a', x: 0, y: 0, r: 50 }, { id: 'b', x: 30, y: 0, r: 50 }] };
        expect(interactionAt(def, -10, 0).id).toBe('a');
        expect(interactionAt(def, 25, 0).id).toBe('b');
        expect(interactionAt(def, 20, 0).id).toBe('b');
        expect(interactionAt(def, 200, 0)).toBeNull();
    });
});

describe('createInteriorState', () => {
    it('fyller klubben med dansare, bartender, vakt och manager', () => {
        const st = createInteriorState('stripclub', mulberry32(1));
        const kinds = st.npcs.map(n => n.kind);
        for (const k of ['dancer', 'bartender', 'bouncer', 'manager', 'dj', 'guest', 'vip', 'patron']) expect(kinds).toContain(k);
        expect(kinds.filter(k => k === 'dancer').length).toBeGreaterThanOrEqual(2);
        expect(kinds.filter(k => k === 'dancer').length).toBeLessThanOrEqual(3);
        expect(st.id).toBe('stripclub'); expect(st.def).toBe(INTERIORS.stripclub); expect(st.t).toBe(0);
    });

    it('fyller vapenbutiken med Pang-Pelle', () => {
        const st = createInteriorState('gunshop', mulberry32(1));
        expect(st.npcs.map(n => n.kind)).toContain('seller');
        const seller = st.npcs.find(n => n.kind === 'seller');
        expect(seller.pose).toBe('work');
    });

    it('ger varje NPC alla fält som renderaren behöver', () => {
        for (const id of Object.keys(INTERIORS)) {
            const st = createInteriorState(id, mulberry32(7));
            for (const n of st.npcs) {
                for (const k of ['x', 'y', 'angle', 'phase']) expect(Number.isFinite(n[k]), `${n.kind}.${k}`).toBe(true);
                expect(POSES).toContain(n.pose);
                expect(n.say).toBeNull();
                for (const k of ['shirt', 'skin', 'hair']) expect(n.look[k], `${n.kind}.look.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
                if (!['seat', 'dancer'].includes(n.beh)) expect(interiorSolid(st.def, n.x, n.y), n.kind).toBe(false);
            }
        }
    });

    it('klär dansarna i paljettklänningar och vakten i mörkt', () => {
        const st = createInteriorState('stripclub', mulberry32(3));
        for (const d of st.npcs.filter(n => n.kind === 'dancer')) {
            expect(d.pose).toBe('dance');
            expect(d.look.dress).toMatch(/^#[0-9a-f]{6}$/i);
            expect(d.look.sparkle).toBe(true);
        }
        const bouncer = st.npcs.find(n => n.kind === 'bouncer');
        const [r, g, b] = [1, 3, 5].map(i => parseInt(bouncer.look.shirt.slice(i, i + 2), 16));
        expect(r + g + b).toBeLessThan(120);
        for (const n of st.npcs.filter(m => m.kind === 'bartender' || m.kind === 'manager')) expect(n.pose === 'work' || n.pose === 'idle').toBe(true);
    });

    it('placerar gäster på stolar och dansare på stolparna', () => {
        const st = createInteriorState('stripclub', mulberry32(5));
        for (const n of st.npcs.filter(m => m.beh === 'seat')) {
            expect(['h', 'o', 'S']).toContain(tileOf(st.def, n.x, n.y));
            expect(n.pose).toBe('sit');
        }
        const poles = [];
        st.def.rows.forEach((row, ty) => [...row].forEach((ch, tx) => { if (ch === 'P') poles.push([tx, ty]); }));
        expect(poles.length).toBe(2);
    });

    it('är deterministisk för samma slump och kastar för okända rum', () => {
        const a = createInteriorState('stripclub', mulberry32(99));
        const b = createInteriorState('stripclub', mulberry32(99));
        const strip = s => JSON.stringify(s.npcs);
        expect(strip(a)).toBe(strip(b));
        const c = createInteriorState('stripclub', mulberry32(100));
        expect(strip(c)).not.toBe(strip(a));
        expect(() => createInteriorState('finns-inte')).toThrow();
    });

    it('klarar en konstant slumpfunktion', () => {
        for (const v of [0, 0.5, 0.999999]) {
            const st = createInteriorState('stripclub', () => v);
            for (let i = 0; i < 300; i++) updateInterior(st, 1 / 30, () => v);
            for (const n of st.npcs) expect(Number.isFinite(n.x + n.y + n.angle + n.phase)).toBe(true);
        }
    });
});

describe('updateInterior', () => {
    const onStage = (def, x, y) => 'TP'.includes(tileOf(def, x, y));

    function simulate(id, seconds, dt, seed, check) {
        const rnd = mulberry32(seed);
        const st = createInteriorState(id, rnd);
        const steps = Math.round(seconds / dt);
        for (let i = 0; i < steps; i++) {
            updateInterior(st, dt, rnd);
            for (const n of st.npcs) check(n, st, i);
        }
        return st;
    }

    it('håller alla koordinater ändliga och NPC:erna på rätt plats i 10 sekunder', () => {
        for (const id of Object.keys(INTERIORS)) {
            simulate(id, 10, 1 / 60, 42, (n, st) => {
                const where = `${id} ${n.kind} ${n.x.toFixed(1)},${n.y.toFixed(1)}`;
                for (const k of ['x', 'y', 'angle', 'phase']) expect(Number.isFinite(n[k]), where).toBe(true);
                expect(Math.abs(n.angle)).toBeLessThanOrEqual(Math.PI + 1e-9);
                expect(POSES).toContain(n.pose);
                if (n.kind === 'dancer') expect(onStage(st.def, n.x, n.y), where).toBe(true);
                else if (n.beh === 'seat') expect(Math.hypot(n.x - n.sx, n.y - n.sy), where).toBeLessThan(1.5);
                else expect(circleClear(st.def, n.x, n.y, 5), where).toBe(true);
            });
        }
    });

    it('håller dansarna på scenen även under en lång föreställning', () => {
        const dancers = new Set();
        const st = simulate('stripclub', 120, 1 / 30, 7, (n, s) => {
            if (n.kind !== 'dancer') return;
            dancers.add(n);
            expect(onStage(s.def, n.x, n.y), `${n.x},${n.y}`).toBe(true);
            expect(n.pose).toBe('dance');
        });
        expect(dancers.size).toBeGreaterThanOrEqual(2);
        // dansarna rör sig faktiskt och använder olika moment
        const moves = new Set(st.npcs.filter(n => n.kind === 'dancer').map(n => n.move));
        expect(moves.size).toBeGreaterThan(0);
    });

    it('dansarna gör olika moment och rör sig över scenen', () => {
        const rnd = mulberry32(11);
        const st = createInteriorState('stripclub', rnd);
        const seen = new Set();
        const minmax = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
        const runway = st.npcs.filter(n => n.kind === 'dancer').at(-1);
        for (let i = 0; i < 60 * 40; i++) {
            updateInterior(st, 1 / 60, rnd);
            for (const d of st.npcs.filter(n => n.kind === 'dancer')) seen.add(d.move);
            minmax.y0 = Math.min(minmax.y0, runway.y); minmax.y1 = Math.max(minmax.y1, runway.y);
        }
        for (const m of ['orbit', 'sway', 'spin', 'strut']) expect(seen.has(m), m).toBe(true);
        expect(minmax.y1 - minmax.y0).toBeGreaterThan(80); // catwalken används
    });

    it('håller personalen på sina platser', () => {
        const club = simulate('stripclub', 60, 1 / 30, 5, (n, st) => {
            const where = `${n.kind} ${n.x.toFixed(1)},${n.y.toFixed(1)}`;
            if (n.kind === 'bartender') { expect(n.x, where).toBeLessThan(3 * T); expect(n.y, where).toBeGreaterThan(6 * T); expect(n.y, where).toBeLessThan(15 * T); }
            if (n.kind === 'dj') { expect(n.x, where).toBeLessThan(8 * T); expect(n.y, where).toBeLessThan(3 * T); }
            if (n.kind === 'manager') { expect(n.x, where).toBeGreaterThan(23 * T); expect(n.y, where).toBeGreaterThan(16 * T); }
            if (n.kind === 'bouncer') { expect(Math.hypot(n.x - 15 * T, n.y - 21 * T), where).toBeLessThan(5 * T); }
        });
        expect(club.npcs.length).toBeGreaterThan(20);
        simulate('gunshop', 60, 1 / 30, 5, (n) => {
            if (n.kind === 'seller') { expect(n.y).toBeLessThan(5 * T); expect(n.y).toBeGreaterThan(3 * T); }
            if (n.kind === 'customer') expect(n.y).toBeGreaterThan(5 * T);
        });
    });

    it('får gäster att jubla med pratbubblor och släcker dem igen', () => {
        const rnd = mulberry32(21);
        const st = createInteriorState('stripclub', rnd);
        const texts = new Set();
        let cheering = 0, maxTalking = 0;
        for (let i = 0; i < 60 * 90; i++) {
            updateInterior(st, 1 / 60, rnd);
            let talking = 0;
            for (const n of st.npcs) {
                if (n.pose === 'cheer') cheering++;
                if (n.say) { talking++; texts.add(n.say.text); expect(n.say.life).toBeGreaterThan(0); expect(typeof n.say.text).toBe('string'); }
            }
            maxTalking = Math.max(maxTalking, talking);
        }
        expect(cheering).toBeGreaterThan(0);
        expect(texts.size).toBeGreaterThan(2);
        expect(maxTalking).toBeLessThanOrEqual(4);
        // bubblorna försvinner
        for (let i = 0; i < 60 * 4; i++) { for (const n of st.npcs) n.chatT = 1e9; for (const n of st.npcs) if (n.beh === 'seat') n.cd = 1e9; updateInterior(st, 1 / 60, rnd); }
        expect(st.npcs.every(n => n.say === null)).toBe(true);
    });

    it('låter gäster sitta kvar när de jublar', () => {
        simulate('stripclub', 40, 1 / 30, 8, (n) => {
            if (n.beh !== 'seat') return;
            expect(['sit', 'cheer']).toContain(n.pose);
        });
    });

    it('klarar stora tidssteg och ignorerar ogiltiga', () => {
        const rnd = mulberry32(2);
        const st = createInteriorState('stripclub', rnd);
        const t0 = st.t;
        updateInterior(st, 0, rnd); updateInterior(st, -3, rnd); updateInterior(st, NaN, rnd);
        expect(st.t).toBe(t0);
        for (let i = 0; i < 100; i++) updateInterior(st, 5, rnd); // klampas till 0,1 s
        expect(st.t).toBeCloseTo(10, 5);
        for (const n of st.npcs) {
            expect(Number.isFinite(n.x + n.y)).toBe(true);
            if (n.beh !== 'seat' && n.kind !== 'dancer') expect(circleClear(st.def, n.x, n.y, 5)).toBe(true);
        }
    });

    it('personalen tittar på spelaren när den står nära', () => {
        const rnd = mulberry32(4);
        const st = createInteriorState('stripclub', rnd);
        const b = st.npcs.find(n => n.kind === 'bouncer');
        b.walking = false; b.wait = 1e6;
        st.focus = { x: b.x, y: b.y + 60 };
        for (let i = 0; i < 120; i++) updateInterior(st, 1 / 60, rnd);
        expect(b.angle).toBeCloseTo(Math.PI / 2, 1);
        st.focus = { x: b.x + 900, y: b.y };
        for (let i = 0; i < 180; i++) updateInterior(st, 1 / 60, rnd);
        expect(Math.abs(b.angle - Math.PI / 2)).toBeGreaterThan(0.5); // för långt bort: tittar inte längre
    });
});

// ── Ritning mot en låtsas-canvas (inget DOM i Node) ──
function mockCtx(scale = 1) {
    const props = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const stack = [];
    const log = { texts: [], depth: 0, maxDepth: 0, drawImage: 0, images: [], comp: new Set(), calls: {} };
    const grad = { addColorStop() {} };
    const methods = {
        save() { stack.push({ ...props }); log.depth++; log.maxDepth = Math.max(log.maxDepth, log.depth); },
        restore() { Object.assign(props, stack.pop()); log.depth--; },
        fillText(s) { log.texts.push(String(s)); },
        measureText: s => ({ width: String(s).length * 6 }),
        createLinearGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        createRadialGradient() { log.calls.gradient = (log.calls.gradient || 0) + 1; return grad; },
        createPattern: () => ({}),
        getTransform: () => ({ a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }),
        drawImage(...a) { log.drawImage++; log.images.push(a); }
    };
    const ctx = new Proxy({}, {
        get(_, k) {
            if (k in methods) return methods[k];
            if (k in props) return props[k];
            return () => { log.calls[k] = (log.calls[k] || 0) + 1; };
        },
        set(_, k, v) { props[k] = v; if (k === 'globalCompositeOperation') log.comp.add(v); return true; }
    });
    return { ctx, log, props };
}

// Låtsas-DOM som håller reda på vilka canvaser som skapats och hur mycket som ritats i dem
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

describe('ritning', () => {
    const rnd = mulberry32(1);

    it('ritar alla NPC:er med drawPerson och lämnar canvasen i fråga om state som den var', () => {
        for (const id of Object.keys(INTERIORS)) {
            const st = createInteriorState(id, rnd);
            for (let i = 0; i < 120; i++) updateInterior(st, 1 / 60, rnd);
            const { ctx, log, props } = mockCtx();
            const drawn = [];
            const view = { x0: 0, y0: 0, x1: st.def.w * T, y1: st.def.h * T };
            drawInterior(ctx, st, view, 2.5, (c, n) => { expect(c).toBe(ctx); drawn.push(n); });
            expect(drawn.length).toBe(st.npcs.length);
            expect(new Set(drawn).size).toBe(st.npcs.length);
            expect(log.depth).toBe(0);
            expect(props.globalAlpha).toBe(1);
            expect(props.globalCompositeOperation).toBe('source-over');
        }
    });

    it('ritar med en reservfigur om drawPerson saknas, och hoppar över folk utanför bild', () => {
        const st = createInteriorState('stripclub', rnd);
        const { ctx, log } = mockCtx();
        expect(() => drawInterior(ctx, st, null, 1, undefined)).not.toThrow();
        expect(log.depth).toBe(0);
        const far = { x0: 5000, y0: 5000, x1: 5200, y1: 5200 };
        let n = 0;
        drawInterior(ctx, st, far, 1, () => { n++; });
        expect(n).toBe(0);
        const near = { x0: 0, y0: 0, x1: 4 * T, y1: 4 * T };
        let few = 0;
        drawInterior(ctx, st, near, 1, () => { few++; });
        expect(few).toBeGreaterThan(0); expect(few).toBeLessThan(st.npcs.length);
    });

    it('lysrundan sätter additiv blandning och återställer den', () => {
        for (const id of Object.keys(INTERIORS)) {
            const st = createInteriorState(id, rnd);
            const { ctx, log, props } = mockCtx();
            props.globalCompositeOperation = 'source-over';
            drawInteriorLights(ctx, st, null, 3.3);
            expect(props.globalCompositeOperation).toBe('source-over');
            expect(props.globalAlpha).toBe(1);
            expect(log.depth).toBe(0);
            // och med en annan blandning från början ska den också bevaras
            props.globalCompositeOperation = 'multiply';
            drawInteriorLights(ctx, st, { x0: 0, y0: 0, x1: 100, y1: 100 }, 1);
            expect(props.globalCompositeOperation).toBe('multiply');
        }
    });

    it('ritar statiska lagret en gång i en offscreen-canvas och återanvänder det', () => {
        withFakeDom(canvases => {
            clearInteriorCache();
            for (const id of Object.keys(INTERIORS)) {
                const before = canvases.length;
                const st = createInteriorState(id, rnd);
                const { ctx, log } = mockCtx(1);
                drawInterior(ctx, st, null, 0, () => {});
                const layer = canvases[before];
                expect(canvases.length).toBe(before + 1);
                const painted = layer.m.log.calls.fillRect;
                expect(painted).toBeGreaterThan(200);
                expect(layer.width).toBe(st.def.w * T); expect(layer.height).toBe(st.def.h * T);
                for (let i = 1; i < 20; i++) { updateInterior(st, 1 / 60, rnd); drawInterior(ctx, st, null, i / 60, () => {}); }
                expect(canvases.length).toBe(before + 1);              // inget nytt lager
                expect(layer.m.log.calls.fillRect).toBe(painted);      // och inget ommålat
                expect(log.images.filter(a => a[0] === layer).length).toBe(20);
            }
        });
    });

    it('bygger lagret i högre upplösning bara när zoomen kräver det', () => {
        withFakeDom(canvases => {
            clearInteriorCache();
            const st = createInteriorState('gunshop', rnd);
            const w = st.def.w * T;
            drawInterior(mockCtx(1).ctx, st, null, 0, () => {});
            expect(canvases[0].width).toBe(w);
            drawInterior(mockCtx(1).ctx, st, null, 0, () => {});
            expect(canvases.length).toBe(1);
            drawInterior(mockCtx(2).ctx, st, null, 0, () => {});          // zoomat in: bygg om i 2x
            expect(canvases.length).toBe(2); expect(canvases[1].width).toBe(w * 2);
            drawInterior(mockCtx(1.3).ctx, st, null, 0, () => {});        // zoomat ut igen: behåll 2x
            expect(canvases.length).toBe(2);
            drawInterior(mockCtx(2.5).ctx, st, null, 0, () => {});        // retina + inzoomad: 3x
            expect(canvases.length).toBe(3); expect(canvases[2].width).toBe(w * 3);
            drawInterior(mockCtx(4).ctx, st, null, 0, () => {});          // mer än så ger inte mer
            expect(canvases.length).toBe(3);
        });
    });

    it('ritar bara den synliga delen av det statiska lagret', () => {
        withFakeDom(canvases => {
            clearInteriorCache();
            const st = createInteriorState('stripclub', rnd);
            const { ctx, log } = mockCtx(2);
            drawInterior(ctx, st, { x0: 100.4, y0: 50, x1: 300, y1: 200.2 }, 0, () => {});
            const [img, sx, sy, sw, sh, dx, dy, dw, dh] = log.images[0];
            expect(img).toBe(canvases[0]);
            expect([dx, dy, dw, dh]).toEqual([100, 50, 200, 151]);
            expect([sx, sy, sw, sh]).toEqual([200, 100, 400, 302]);
            // helt utanför rummet: ingenting ritas
            const n = log.images.length;
            drawInterior(ctx, st, { x0: -500, y0: -500, x1: -10, y1: -10 }, 0, () => {});
            expect(log.images.length).toBe(n);
        });
    });

    it('skapar inga gradienter per bildruta på huvudcanvasen', () => {
        withFakeDom(() => {
            clearInteriorCache();
            const st = createInteriorState('stripclub', rnd);
            const { ctx, log } = mockCtx(2);
            for (let i = 0; i < 40; i++) { updateInterior(st, 1 / 60, rnd); drawInterior(ctx, st, null, i / 60, () => {}); drawInteriorLights(ctx, st, null, i / 60); }
            expect(log.calls.gradient || 0).toBe(0);
            expect(log.drawImage).toBeGreaterThan(40 * 8); // lager + många ljuskällor, alla som färdiga bilder
        });
    });

    it('tål att ritas många bildrutor i rad utan att läcka tillstånd', () => {
        const st = createInteriorState('stripclub', rnd);
        const { ctx, log, props } = mockCtx();
        for (let i = 0; i < 50; i++) {
            updateInterior(st, 1 / 60, rnd);
            drawInterior(ctx, st, null, i / 60, () => {});
            drawInteriorLights(ctx, st, null, i / 60);
        }
        expect(log.depth).toBe(0);
        expect(log.maxDepth).toBeLessThan(6);
        expect(props.globalAlpha).toBe(1);
    });
});
