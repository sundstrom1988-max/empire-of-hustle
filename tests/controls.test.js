// Styrning till fots (etapp 0, spår A1): W följer blicken, A/D är sidsteg relativt den,
// även efter många hela varv, inomhus och efter bilen. Musen flyttar aldrig gubben,
// och bilen bryr sig inte om blicken.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    Input, normAngle, lookAngle, footMove, staminaStep, stickVector, stickWalk,
    STAMINA_MAX, STAMINA_DRAIN, STAMINA_WALK, STAMINA_REST, STAMINA_RECOVER, STICK_RADIUS
} from '../src/city/input.js';
import { World } from '../src/city/world.js';
import { Hud } from '../src/city/hud.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle } from '../src/city/vehicles.js';
import { INTERIORS, circleClear, atInteriorExit } from '../src/city/interiors.js';
import { TILE, MAP_W, MAP_H } from '../src/city/constants.js';

const DT = 1 / 60;
const WALK = 115, RUN = 175;              // ute
const IN_WALK = 110;                      // inne
const PI = Math.PI;
const IDLE = { throttle: 0, steer: 0, handbrake: false, fwd: 0, strafe: 0, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
// En stad som bara är asfalt: testa styrningen, inte husen
const CITY = generateCity(1337);
const OPEN = { ...CITY, tiles: new Uint8Array(CITY.tiles.length) };
const MID = { x: MAP_W * TILE / 2 + 7, y: MAP_H * TILE / 2 + 3 };
// Väderstreck (skärmen: y nedåt) — blickvinklar
const DIRS = { N: -PI / 2, E: 0, S: PI / 2, W: PI };
const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const inRange = a => a > -PI && a <= PI;

function openWorld(seed = 3) {
    const w = new World(OPEN, createPlayerState('kimit'), { round: 2, rnd: mulberry32(seed) });
    w.manageSpawns = () => { };
    w.peds = []; w.vehicles = []; w.pickups = [];
    Object.assign(w.player, { x: MID.x, y: MID.y, vx: 0, vy: 0 });
    return w;
}
// Pekaren i överblick: kameran följer gubben, så en stilla pekare ligger en fast bit från honom
const aimAt = (w, a, d = 220) => ({ x: w.player.x + Math.cos(a) * d, y: w.player.y + Math.sin(a) * d });
// Kör n steg med samma input (aim räknas om från gubbens position, som när kameran följer)
function walk(w, n, input, look) {
    const x0 = w.player.x, y0 = w.player.y;
    for (let i = 0; i < n; i++) w.update(DT, { ...IDLE, ...input, ...(look !== undefined ? { aim: aimAt(w, look) } : {}) });
    const dx = w.player.x - x0, dy = w.player.y - y0;
    return { dx, dy, d: Math.hypot(dx, dy), dir: Math.atan2(dy, dx) };
}

describe('normAngle och blicken (ren matematik)', () => {
    it('håller vinkeln i (−π, π] — även −π, stora tal och många varv', () => {
        expect(normAngle(-PI)).toBe(PI);
        expect(normAngle(PI)).toBe(PI);
        expect(normAngle(0)).toBe(0);
        expect(normAngle(3 * PI)).toBeCloseTo(PI, 12);
        expect(normAngle(-3 * PI)).toBeCloseTo(PI, 12);
        for (let k = -40; k <= 40; k++) {
            const a = normAngle(0.3 + k * 2 * PI);
            expect(inRange(a)).toBe(true);
            expect(a).toBeCloseTo(0.3, 9);
        }
        expect(normAngle(NaN)).toBe(0);
        expect(normAngle(Infinity)).toBe(0);
    });

    it('turn vrider, aim pekar, inget av dem = blicken står kvar', () => {
        expect(lookAngle(0, { turn: 0.5 }, 0, 0)).toBeCloseTo(0.5);
        expect(lookAngle(3, { turn: 0.5 }, 0, 0)).toBeCloseTo(3.5 - 2 * PI);
        expect(lookAngle(0, { aim: { x: 10, y: 10 } }, 10, 0)).toBeCloseTo(PI / 2);   // pekaren rakt söderut
        expect(lookAngle(0, { aim: { x: -5, y: 0 } }, 0, 0)).toBe(PI);              // väster: π, inte −π
        expect(lookAngle(1.2, {}, 0, 0)).toBe(1.2);
        expect(lookAngle(1.2, { aim: { x: 4, y: 4 } }, 4, 4)).toBe(1.2);            // pekaren mitt på gubben
        // turn går före aim (3D-blicken vinner)
        expect(lookAngle(0, { turn: 0.1, aim: { x: 0, y: 100 } }, 0, 0)).toBeCloseTo(0.1);
    });

    it('W/S/A/D följer blicken i alla riktningar, diagonalen är normerad', () => {
        for (const a of [0, 0.7, PI / 2, 2.5, PI, -2.2, -PI / 2]) {
            const f = footMove(a, { fwd: 1 });
            expect(f.x).toBeCloseTo(Math.cos(a), 12); expect(f.y).toBeCloseTo(Math.sin(a), 12);
            const b = footMove(a, { fwd: -1 });
            expect(angDist(Math.atan2(b.y, b.x), a + PI)).toBeLessThan(1e-12);
            const r = footMove(a, { strafe: 1 });   // D = höger om blicken
            expect(angDist(Math.atan2(r.y, r.x), a + PI / 2)).toBeLessThan(1e-12);
            const l = footMove(a, { strafe: -1 });  // A = vänster
            expect(angDist(Math.atan2(l.y, l.x), a - PI / 2)).toBeLessThan(1e-12);
            const d = footMove(a, { fwd: 1, strafe: 1 });
            expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
            expect(angDist(Math.atan2(d.y, d.x), a + PI / 4)).toBeLessThan(1e-12);
            expect(footMove(a, {})).toEqual({ x: 0, y: 0, stick: false });
        }
    });

    it('joysticken används rakt av (världsriktning) och går före tangenterna', () => {
        const j = footMove(1.0, { mx: 0, my: -1, fwd: 1 });
        expect(j.stick).toBe(true);
        expect(j.x).toBeCloseTo(0); expect(j.y).toBeCloseTo(-1);
        const k = footMove(0, { mx: 0.3, my: 0.4 });
        expect(Math.hypot(k.x, k.y)).toBeCloseTo(1);
    });
});

describe('Till fots ute: W följer blicken', () => {
    it('titta N/Ö/S/V med pekaren och tryck W: går exakt dit gubben tittar', () => {
        for (const [name, a] of Object.entries(DIRS)) {
            const w = openWorld();
            const r = walk(w, 30, { fwd: 1 }, a);
            expect(angDist(r.dir, a), name).toBeLessThan(1e-9);
            expect(r.d, name).toBeCloseTo(WALK * 30 * DT, 6);
            expect(angDist(w.player.angle, a), name).toBeLessThan(1e-9);
            expect(w.interior, name).toBe(null);
        }
    });

    it('S backar, A/D är sidsteg åt gubbens vänster/höger — inte väster/öster', () => {
        for (const a of [...Object.values(DIRS), 0.9, -2.4]) {
            const w = openWorld();
            expect(angDist(walk(w, 20, { fwd: -1 }, a).dir, a + PI)).toBeLessThan(1e-9);
            expect(angDist(walk(w, 20, { strafe: 1 }, a).dir, a + PI / 2)).toBeLessThan(1e-9);
            expect(angDist(walk(w, 20, { strafe: -1 }, a).dir, a - PI / 2)).toBeLessThan(1e-9);
            expect(angDist(w.player.angle, a)).toBeLessThan(1e-9); // sidstegen vrider inte blicken
        }
        // Konkret: tittar söderut → D går västerut (gubbens höger), A österut
        const w = openWorld();
        const d = walk(w, 30, { strafe: 1 }, DIRS.S);
        expect(d.dx).toBeLessThan(-50);
        expect(Math.abs(d.dy)).toBeLessThan(1e-6);
    });

    it('diagonalen går inte fortare', () => {
        const w = openWorld();
        const r = walk(w, 60, { fwd: 1, strafe: -1 }, 0.4);
        expect(r.d).toBeCloseTo(WALK, 6);
        expect(angDist(r.dir, 0.4 - PI / 4)).toBeLessThan(1e-9);
    });

    it('efter 10+ hela varv åt båda hållen: vinkeln i (−π, π] och W går exakt längs blicken', () => {
        const w = openWorld();
        const p = w.player;
        const start = { x: p.x, y: p.y };
        let total = p.angle;
        // 11,5 varv medurs, 20,7 moturs, och några nästan-halvvarv per steg
        for (const [turn, steps] of [[0.29, 250], [-0.31, 420], [2.9, 40], [-3.1, 33]]) {
            for (let i = 0; i < steps; i++) {
                w.update(DT, { ...IDLE, turn });
                total += turn;
                expect(inRange(p.angle)).toBe(true);
            }
            // musen flyttade honom inte en millimeter
            expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeLessThan(1e-9);
            expect(angDist(p.angle, total)).toBeLessThan(1e-9);
            if (steps > 100) expect(Math.abs(turn * steps)).toBeGreaterThan(10 * 2 * PI);
        }
        const r = walk(w, 30, { fwd: 1 });
        expect(angDist(r.dir, total)).toBeLessThan(1e-9);
        expect(r.d).toBeCloseTo(WALK * 30 * DT, 6);
        expect(angDist(walk(w, 30, { strafe: 1 }).dir, total + PI / 2)).toBeLessThan(1e-9);
    });

    it('musen (aim/turn) ensam flyttar aldrig gubben', () => {
        const w = openWorld();
        const x0 = w.player.x, y0 = w.player.y;
        for (let i = 0; i < 240; i++) {
            const a = i * 0.37;
            w.update(DT, { ...IDLE, aim: { x: x0 + Math.cos(a) * (5 + i), y: y0 + Math.sin(a) * (5 + i) } });
            w.update(DT, { ...IDLE, turn: Math.sin(i) * 0.4 });
        }
        expect(w.player.x).toBe(x0);
        expect(w.player.y).toBe(y0);
    });

    it('vrider man under gången följer W den nya blicken direkt (ingen seghet)', () => {
        const w = openWorld();
        walk(w, 10, { fwd: 1 }, DIRS.E);
        const x = w.player.x, y = w.player.y;
        w.update(DT, { ...IDLE, fwd: 1, turn: PI / 2 });   // en kvarts sväng höger = söderut
        expect(w.player.x - x).toBeCloseTo(0, 9);
        expect(w.player.y - y).toBeCloseTo(WALK * DT, 9);
    });
});

describe('Till fots inne i en interiör: samma logik', () => {
    // En plats på golvet med fritt runt omkring, långt från utgången
    function inside(id = 'stripclub') {
        const w = new World(CITY, createPlayerState('kimit'), { round: 2, rnd: mulberry32(9) });
        const mk = id === 'stripclub' ? CITY.markers.stripclub : CITY.markers.guns;
        expect(w.enterInterior(id, mk)).toBe(true);
        const def = w.interior.def;
        w.interior.state.npcs = [];
        w.interior.state.flow = 0;
        const R = 40;
        for (let y = 20; y < def.h * 32; y += 4) for (let x = 20; x < def.w * 32; x += 4) {
            let ok = !atInteriorExit(def, x, y);
            for (let k = 0; k < 16 && ok; k++) for (const d of [0, R / 2, R]) {
                const px = x + Math.cos(k * PI / 8) * d, py = y + Math.sin(k * PI / 8) * d;
                if (!circleClear(def, px, py, w.player.r) || atInteriorExit(def, px, py)) { ok = false; break; }
            }
            if (ok) { Object.assign(w.player, { x, y, vx: 0, vy: 0 }); w.interior.exitArmed = true; return w; }
        }
        throw new Error('ingen fri plats i ' + id);
    }
    const n = 12; // 22 px: håller sig inom den fria cirkeln

    it('N/Ö/S/V: W går dit blicken pekar, A/D sidsteg', () => {
        for (const [name, a] of Object.entries(DIRS)) {
            const w = inside();
            const r = walk(w, n, { fwd: 1 }, a);
            expect(w.interior, name).not.toBe(null);
            expect(angDist(r.dir, a), name).toBeLessThan(1e-9);
            expect(r.d, name).toBeCloseTo(IN_WALK * n * DT, 6);
            const w2 = inside();
            expect(angDist(walk(w2, n, { strafe: 1 }, a).dir, a + PI / 2), name).toBeLessThan(1e-9);
            const w3 = inside();
            expect(angDist(walk(w3, n, { strafe: -1, fwd: -1 }, a).dir, a - PI * 3 / 4), name).toBeLessThan(1e-9);
            expect(walk(inside(), n, { fwd: 1, strafe: 1 }, a).d).toBeCloseTo(IN_WALK * n * DT, 6);
        }
    });

    it('efter 12 varv åt båda hållen fungerar W fortfarande exakt', () => {
        const w = inside('gunshop');
        let total = w.player.angle;
        for (const turn of [0.4, -0.45]) for (let i = 0; i < 200; i++) {
            w.update(DT, { ...IDLE, turn });
            total += turn;
            expect(inRange(w.player.angle)).toBe(true);
        }
        expect(Math.abs(0.4 * 200) / (2 * PI)).toBeGreaterThan(12);
        const r = walk(w, n, { fwd: 1 });
        expect(angDist(r.dir, total)).toBeLessThan(1e-9);
        expect(r.d).toBeCloseTo(IN_WALK * n * DT, 6);
    });

    it('musen ensam flyttar inte gubben inomhus heller', () => {
        const w = inside();
        const x0 = w.player.x, y0 = w.player.y;
        for (let i = 0; i < 120; i++) w.update(DT, { ...IDLE, aim: { x: x0 + Math.cos(i) * 80, y: y0 + Math.sin(i) * 80 }, turn: i % 3 ? 0 : 0.2 });
        expect(w.player.x).toBe(x0);
        expect(w.player.y).toBe(y0);
    });
});

describe('Bilen bryr sig inte om blicken', () => {
    function inCar(seed = 4) {
        const w = openWorld(seed);
        const car = createVehicle('volvo', MID.x, MID.y, -PI / 2);
        w.vehicles.push(car);
        car.driver = 'player';
        w.player.vehicle = car;
        return { w, car };
    }

    it('turn och aim ändrar varken bilens riktning, fart eller väg', () => {
        const a = inCar(), b = inCar();
        for (let i = 0; i < 180; i++) {
            const ctl = { throttle: i < 120 ? 1 : -1, steer: Math.sin(i / 20), handbrake: i > 150 };
            a.w.update(DT, { ...IDLE, ...ctl });
            b.w.update(DT, { ...IDLE, ...ctl, turn: 0.7, aim: { x: b.car.x + 300, y: b.car.y - 40 }, fwd: 1, strafe: -1, mx: 0.6, my: 0.8, faceMove: true });
            expect(b.car.x).toBe(a.car.x);
            expect(b.car.y).toBe(a.car.y);
            expect(b.car.angle).toBe(a.car.angle);
            expect(b.car.vx).toBe(a.car.vx);
            expect(b.w.player.angle).toBe(b.car.angle);
        }
    });

    it('ur bilen igen: W följer blicken som vanligt', () => {
        const { w, car } = inCar();
        for (let i = 0; i < 60; i++) w.update(DT, { ...IDLE, throttle: 1, turn: 0.5 });
        car.vx = car.vy = 0;
        w.update(DT, { ...IDLE, action: true });
        expect(w.player.vehicle).toBe(null);
        w.player.vx = w.player.vy = 0;
        car.x += 600; // bilen ur vägen, så att gubben inte går in i den
        for (const a of Object.values(DIRS)) {
            w.update(DT, { ...IDLE, aim: aimAt(w, a) });
            expect(angDist(walk(w, 20, { fwd: 1 }, a).dir, a)).toBeLessThan(1e-9);
        }
    });
});

describe('Joysticken till fots (touch)', () => {
    it('upp = norr i överblick: gubben går norrut och vänder sig dit (faceMove)', () => {
        const st = stickWalk({ ...stickVector(0, -40, STICK_RADIUS), active: true });
        for (const faceMove of [true, undefined]) {
            const w = openWorld();
            w.player.angle = 0.3;
            const r = walk(w, 30, { mx: st.mx, my: st.my, faceMove });
            expect(r.dy).toBeCloseTo(-WALK * 30 * DT, 6);
            expect(Math.abs(r.dx)).toBeLessThan(1e-9);
            expect(w.player.angle).toBeCloseTo(-PI / 2, 9);
        }
    });

    it('förstaperson (faceMove false): blicken står kvar och man går i sidled', () => {
        const w = openWorld();
        w.player.angle = 0;
        const r = walk(w, 30, { mx: 0, my: 1, faceMove: false });
        expect(r.dy).toBeGreaterThan(50);
        expect(w.player.angle).toBe(0);
    });

    it('springer vid fullt utslag (med uthållighet)', () => {
        const st = stickWalk({ ...stickVector(STICK_RADIUS, 0, STICK_RADIUS), active: true });
        expect(st.run).toBe(true);
        const w = openWorld();
        expect(walk(w, 30, { mx: st.mx, my: st.my, run: st.run, faceMove: true }).d).toBeCloseTo(RUN * 30 * DT, 6);
    });
});

describe('Uthållighet och spring', () => {
    it('Shift springer tills uthålligheten tar slut, sedan går man tills den nått ~30', () => {
        const w = openWorld();
        const p = w.player;
        expect(p.stamina).toBe(STAMINA_MAX);
        const runIn = { fwd: 1, run: true };
        expect(walk(w, 60, runIn, 0).d).toBeCloseTo(RUN, 6);
        expect(p.stamina).toBeCloseTo(STAMINA_MAX - STAMINA_DRAIN, 6);
        // spring tills den är tom
        let steps = 60;
        while (!p.winded && steps < 60 * 20) { w.update(DT, { ...IDLE, ...runIn, aim: aimAt(w, 0) }); steps++; }
        expect(p.winded).toBe(true);
        expect(steps / 60).toBeCloseTo(STAMINA_MAX / STAMINA_DRAIN, 1);
        // andfådd: Shift hjälper inte, han går och hämtar sig
        expect(walk(w, 60, runIn, 0).d).toBeCloseTo(WALK, 6);
        const toRecover = Math.ceil((STAMINA_RECOVER - p.stamina) / STAMINA_WALK * 60) + 2;
        walk(w, toRecover, runIn, 0);
        expect(p.winded).toBe(false);
        expect(walk(w, 30, runIn, 0).d).toBeGreaterThan(WALK * 30 * DT + 1); // springer igen
    });

    it('vila fyller på snabbare än gång, i bilen också; full = 100 och inte mer', () => {
        const s = { stamina: 40 };
        staminaStep(s, 1, false, false);
        expect(s.stamina).toBeCloseTo(40 + STAMINA_REST);
        staminaStep(s, 1, false, true);
        expect(s.stamina).toBeCloseTo(40 + STAMINA_REST + STAMINA_WALK);
        for (let i = 0; i < 20; i++) staminaStep(s, 1, false, false);
        expect(s.stamina).toBe(STAMINA_MAX);
        // står man still med Shift nere springer man inte (och tappar inget)
        expect(staminaStep(s, 1, true, false)).toBe(false);
        expect(s.stamina).toBe(STAMINA_MAX);
        // i bilen
        const w = openWorld();
        w.player.stamina = 10;
        const car = createVehicle('volvo', MID.x, MID.y, 0);
        w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
        for (let i = 0; i < 60; i++) w.update(DT, IDLE);
        expect(w.player.stamina).toBeCloseTo(10 + STAMINA_REST, 6);
    });

    it('HUD: 🏃-stapeln syns bara när uthålligheten inte är full (även inomhus)', () => {
        const drawn = (w, touch = false) => {
            const texts = [];
            const ctx = new Proxy({}, {
                get(t, k) {
                    if (k in t) return t[k];
                    if (k === 'fillText') return (s) => texts.push(String(s));
                    if (k === 'measureText') return s => ({ width: String(s).length * 8 });
                    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() { } });
                    return () => { };
                },
                set(t, k, v) { t[k] = v; return true; }
            });
            const W = touch ? 390 : 1280, H = touch ? 844 : 800;
            new Hud().draw(ctx, w, { w: W, h: H, dpr: 1, worldToScreen: (x, y) => ({ x, y }) }, { touch });
            return texts.includes('🏃');
        };
        const w = openWorld();
        expect(drawn(w)).toBe(false);
        w.player.stamina = 60;
        expect(drawn(w)).toBe(true);
        expect(drawn(w, true)).toBe(true);
        w.player.winded = true; w.player.stamina = 3;
        expect(drawn(w)).toBe(true);
        const wi = new World(CITY, createPlayerState('kimit'), { round: 2, rnd: mulberry32(2) });
        wi.enterInterior('gunshop', CITY.markers.guns);
        expect(drawn(wi)).toBe(false);
        wi.player.stamina = 50;
        expect(drawn(wi)).toBe(true);
    });
});

describe('Bildfrekvens', () => {
    // Som spelloopen i index.js: fasta steg på 1/60, högst 5 per frame, samma state i alla steg
    function frames(hz, secs, input) {
        const w = openWorld();
        const x0 = w.player.x, y0 = w.player.y;
        let acc = 0, steps = 0;
        for (let f = 0; f < Math.round(secs * hz); f++) {
            acc += 1 / hz;
            let k = 0;
            while (acc >= DT && k < 5) { w.update(DT, { ...IDLE, ...input }); acc -= DT; k++; steps++; }
        }
        return { d: Math.hypot(w.player.x - x0, w.player.y - y0), steps, w };
    }

    it('samma sträcka per steg vid 30, 60 och 144 Hz (steg i 1/60 oavsett antal frames)', () => {
        for (const run of [false, true]) {
            const res = [30, 60, 144].map(hz => frames(hz, 2, { fwd: 1, strafe: 1, run, turn: 0 }));
            for (const r of res) {
                expect(Math.abs(r.steps - 120)).toBeLessThanOrEqual(1);
                expect(r.d).toBeCloseTo((run ? RUN : WALK) * r.steps * DT, 6);
            }
        }
    });

    it('variabelt tidssteg ger samma sträcka och samma uthållighet efter 1 s', () => {
        const out = [1 / 30, 1 / 60, 1 / 120, 1 / 144].map(dt => {
            const w = openWorld();
            const x0 = w.player.x;
            const n = Math.round(1 / dt);
            for (let i = 0; i < n; i++) w.update(dt, { ...IDLE, fwd: 1, run: true, aim: { x: w.player.x + 100, y: w.player.y } });
            return { d: w.player.x - x0, st: w.player.stamina };
        });
        for (const o of out) {
            expect(o.d).toBeCloseTo(RUN, 6);
            expect(o.st).toBeCloseTo(STAMINA_MAX - STAMINA_DRAIN, 6);
        }
    });
});

// ── Input-klassen med en låtsas-DOM: tangenter, fokus, pekarlås, blick ──
describe('Input: tangenter, fokus, pekarlås och blick', () => {
    const made = [];
    afterEach(() => {
        made.forEach(i => i.destroy());
        made.length = 0;
        delete globalThis.window;
        delete globalThis.document;
    });

    function target() {
        const ls = {};
        return {
            ls,
            addEventListener(t, f) { (ls[t] ||= []).push(f); },
            removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(g => g !== f); },
            fire(t, e = {}) { const ev = { preventDefault() { }, ...e }; (ls[t] || []).forEach(f => f(ev)); return ev; }
        };
    }
    // stick: med joystickzonen (.ct-stick) nere till vänster, som på touch
    function setup({ stick = false } = {}) {
        const win = target();
        const doc = Object.assign(target(), {
            hidden: false, activeElement: { tagName: 'BODY' }, pointerLockElement: null,
            exitPointerLock() { this.pointerLockElement = null; this.fire('pointerlockchange'); }
        });
        const canvas = Object.assign(target(), {
            tagName: 'CANVAS',
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
            setPointerCapture() { },
            requestPointerLock: vi.fn(() => { doc.pointerLockElement = canvas; doc.fire('pointerlockchange'); })
        });
        const el = () => ({ style: {}, offsetWidth: 120, classList: { add() { }, remove() { }, toggle() { } } });
        const base = el(), knob = el();
        const zone = stick ? Object.assign(target(), {
            getBoundingClientRect: () => ({ left: 0, top: 240, width: 360, height: 360 }),
            setPointerCapture() { },
            querySelector: s => (s === '.ct-stick-base' ? base : s === '.ct-stick-knob' ? knob : null)
        }) : null;
        const root = { querySelector: s => (s === 'canvas' ? canvas : s === '.ct-stick' ? zone : null), querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
        globalThis.window = win;
        globalThis.document = doc;
        const inp = new Input(root);
        made.push(inp);
        const key = (code, type = 'keydown', extra = {}) => win.fire(type, { code, target: doc.activeElement, ...extra });
        // pointerup lyssnas på window (släpps knappen utanför canvasen)
        const mouse = (type, x = 400, y = 300, extra = {}) => (type === 'pointerup' ? win : canvas).fire(type, { pointerType: 'mouse', button: 0, pointerId: 1, clientX: x, clientY: y, ...extra });
        // Ett finger: på canvasen (pointerup går till window, som i webbläsaren efter fångsten)
        const touch = (type, id, x, y) => (type === 'pointerup' ? win : canvas).fire(type, { pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y });
        const thumb = (type, x, y, id = 3) => zone.fire(type, { pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y });
        return { inp, win, doc, canvas, key, mouse, touch, thumb };
    }

    it('W/S = fwd och gas, A/D = strafe och ratt, mx/my bara från joysticken', () => {
        const { inp, key } = setup();
        expect(inp.state()).toMatchObject({ fwd: 0, strafe: 0, mx: 0, my: 0, throttle: 0, steer: 0 });
        key('KeyW');
        expect(inp.state()).toMatchObject({ fwd: 1, throttle: 1, strafe: 0, mx: 0, my: 0 });
        key('KeyD');
        expect(inp.state()).toMatchObject({ fwd: 1, strafe: 1, steer: 1, mx: 0, my: 0 });
        key('KeyW', 'keyup'); key('KeyD', 'keyup'); key('ArrowDown'); key('ArrowLeft');
        expect(inp.state()).toMatchObject({ fwd: -1, strafe: -1, throttle: -1, steer: -1 });
        key('ArrowDown', 'keyup'); key('ArrowLeft', 'keyup');
        // joysticken: skärmriktning, upp = −y; tangenterna rör inte mx/my
        Object.assign(inp.stick, stickVector(0, -40, STICK_RADIUS), { active: true });
        expect(inp.state()).toMatchObject({ fwd: 0, strafe: 0, mx: 0 });
        expect(inp.state().my).toBeCloseTo(-1);
    });

    it("V och C ger 'cam' (inget 'zoom' längre)", () => {
        const { inp, key } = setup();
        key('KeyV');
        expect(inp.pressed('cam')).toBe(true);
        expect(inp.pressed('cam')).toBe(false);
        key('KeyV', 'keyup');
        key('KeyC');
        expect(inp.pressed('zoom')).toBe(false);
        expect(inp.pressed('cam')).toBe(true);
    });

    it('inga spelkontroller när man skriver i input, textarea, select eller contenteditable', () => {
        const { inp, doc, win } = setup();
        for (const el of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }]) {
            win.fire('keydown', { code: 'KeyW', target: el });
            win.fire('keydown', { code: 'Space', target: el });
            expect(inp.state()).toMatchObject({ fwd: 0, punch: false });
            // fokus i fältet men händelsen från något annat (t.ex. window): också tyst
            doc.activeElement = el;
            win.fire('keydown', { code: 'KeyD', target: { tagName: 'BODY' } });
            expect(inp.state().strafe).toBe(0);
            doc.activeElement = { tagName: 'BODY' };
        }
    });

    it('W fastnar inte: släpps i ett textfält, vid fokus i textfält, blur och dold flik', () => {
        const { inp, key, doc, win } = setup();
        key('KeyW');
        win.fire('keyup', { code: 'KeyW', target: { tagName: 'TEXTAREA' } });
        expect(inp.state().fwd).toBe(0);
        key('KeyW'); key('ShiftLeft');
        doc.fire('focusin', { target: { tagName: 'INPUT' } });
        expect(inp.state()).toMatchObject({ fwd: 0, run: false });
        key('KeyW');
        win.fire('blur');
        expect(inp.state().fwd).toBe(0);
        key('KeyA');
        doc.hidden = true; doc.fire('visibilitychange');
        expect(inp.state().strafe).toBe(0);
    });

    it('vänsterklick slår/skjuter — men inte på kartan eller bakom en meny', () => {
        const { inp, mouse } = setup();
        mouse('pointerdown');
        expect(inp.state()).toMatchObject({ punch: true, attack: true });
        mouse('pointerup');
        inp.endFrame();
        inp.ignoreMouse = (x, y) => x < 200;           // "minikartan" till vänster
        mouse('pointerdown', 100, 300);
        expect(inp.state()).toMatchObject({ punch: false, attack: false });
    });

    it('klicket som tar pekarlåset blir inget skott; låst klick skjuter', () => {
        const { inp, mouse, canvas } = setup();
        const seen = [];
        inp.onLockChange = l => seen.push(l);
        inp.lockWanted = true;
        mouse('pointerdown');
        expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
        expect(inp.locked).toBe(true);
        expect(inp.state()).toMatchObject({ punch: false, attack: false });
        mouse('pointerup');
        mouse('pointerdown');
        expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
        expect(inp.state().punch).toBe(true);
        expect(seen).toEqual([true]);
        inp.releaseLock();
        expect(inp.locked).toBe(false);
        expect(seen).toEqual([true, false]);
        // meny uppe: inget lås och inget skott
        inp.ignoreMouse = () => true;
        mouse('pointerdown');
        expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
        expect(inp.state().punch).toBe(false);
    });

    it('takeLook: musens rörelse i låst läge summeras och nollas vid läsning', () => {
        const { inp, mouse } = setup();
        mouse('pointermove', 410, 300, { movementX: 10, movementY: 0 });
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });   // olåst: pekaren siktar i stället
        expect(inp.aimActive()).toBe(true);
        inp.requestLock();
        mouse('pointermove', 0, 0, { movementX: 10, movementY: 5 });
        mouse('pointermove', 0, 0, { movementX: 3, movementY: -2 });
        expect(inp.takeLook()).toEqual({ dx: 13, dy: 3 });
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        expect(inp.aimActive()).toBe(false);                 // låst: ingen pekare att sikta med
    });

    it('touch-look: ett finger som drar på canvasen tittar, slår inte', () => {
        const { inp, canvas, win } = setup();
        const t = (type, x, y, id = 7) => canvas.fire(type, { pointerType: 'touch', pointerId: id, button: 0, clientX: x, clientY: y });
        t('pointerdown', 500, 300);
        t('pointermove', 530, 290);
        t('pointermove', 540, 310);
        expect(inp.takeLook()).toEqual({ dx: 40, dy: 10 });
        t('pointermove', 600, 300, 8);                       // ett annat finger: inte blicken
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        win.fire('pointerup', { pointerType: 'touch', pointerId: 7, button: 0 });
        t('pointermove', 700, 300);
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        expect(inp.state()).toMatchObject({ punch: false, attack: false });
        inp.ignoreMouse = () => true;                         // minikartan
        t('pointerdown', 10, 10);
        t('pointermove', 60, 10);
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
    });

    it('nyp: två fingrar isär = zooma in (>1), ihop = ut (<1); läsningen nollställer', () => {
        const { inp, touch } = setup();
        expect(inp.takePinch()).toBe(1);
        touch('pointerdown', 7, 400, 300);
        touch('pointerdown', 8, 500, 300);                   // 100 px isär
        expect(inp.pinching).toBe(true);
        expect(inp.takePinch()).toBe(1);                     // ingen rörelse än
        touch('pointermove', 8, 550, 300);                   // 150
        touch('pointermove', 7, 350, 300);                   // 200
        expect(inp.takePinch()).toBeCloseTo(2, 12);
        expect(inp.takePinch()).toBe(1);
        touch('pointermove', 8, 450, 300);                   // 100
        expect(inp.takePinch()).toBeCloseTo(0.5, 12);
        // vridning med samma avstånd ändrar inget
        touch('pointermove', 8, 350, 400);                   // (350,300)→(350,400): 100
        expect(inp.takePinch()).toBeCloseTo(1, 12);
        // fingrar ovanpå varandra ger ingen jättefaktor
        touch('pointermove', 8, 351, 301);
        touch('pointermove', 8, 350, 400);
        expect(inp.takePinch()).toBeCloseTo(1, 12);
    });

    it('under nypet: ingen blick och inga slag; kvarvarande finger tittar inte förrän det lyfts', () => {
        const { inp, touch } = setup();
        touch('pointerdown', 7, 400, 300);
        touch('pointermove', 7, 405, 300);                   // första fingret hann dra lite
        touch('pointerdown', 8, 500, 300);
        touch('pointermove', 7, 300, 250);
        touch('pointermove', 8, 600, 350);
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        expect(inp.state()).toMatchObject({ punch: false, attack: false, action: false });
        expect(inp.takePinch()).toBeGreaterThan(1);
        touch('pointerup', 8, 600, 350);                     // ena fingret lyfts
        expect(inp.pinching).toBe(false);
        touch('pointermove', 7, 200, 200);                   // det andra drar vidare: ingen blick, inget nyp
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        expect(inp.takePinch()).toBe(1);
        touch('pointerdown', 9, 400, 200);                   // nytt finger bredvid = nytt nyp
        expect(inp.pinching).toBe(true);
        touch('pointermove', 9, 600, 200);
        expect(inp.takePinch()).toBeCloseTo(2, 12);
        touch('pointerup', 7, 200, 200); touch('pointerup', 9, 600, 200);
        // alla lyfta: ett finger tittar igen
        touch('pointerdown', 10, 300, 300);
        touch('pointermove', 10, 320, 295);
        expect(inp.takeLook()).toEqual({ dx: 20, dy: -5 });
        expect(inp.pinching).toBe(false);
    });

    it('tummen på joysticken + ett finger på canvasen = blick, inte nyp', () => {
        const { inp, touch, thumb } = setup({ stick: true });
        thumb('pointerdown', 80, 500);
        thumb('pointermove', 80, 440);
        expect(inp.stick.active).toBe(true);
        expect(inp.state().my).toBeLessThan(-0.5);           // går (upp på skärmen)
        touch('pointerdown', 7, 600, 300);
        touch('pointermove', 7, 640, 310);
        expect(inp.pinching).toBe(false);
        expect(inp.takePinch()).toBe(1);
        expect(inp.takeLook()).toEqual({ dx: 40, dy: 10 });
        expect(inp.stick.active).toBe(true);
        // ett andra finger på canvasen blir nyp (tummen räknas fortfarande inte)
        touch('pointerdown', 8, 700, 300);
        expect(inp.pinching).toBe(true);
        expect(inp.stick.active).toBe(true);                 // man kan gå och zooma samtidigt
    });

    it('första fingret på minikartan räknas inte; det andra fingret i ett nyp gör det; ett tredje ignoreras', () => {
        const { inp, touch } = setup();
        inp.ignoreMouse = (x) => x > 700;                    // "minikartan" till höger
        touch('pointerdown', 7, 750, 100);
        touch('pointermove', 7, 760, 120);
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
        touch('pointerup', 7, 760, 120);
        touch('pointerdown', 8, 500, 300);
        touch('pointerdown', 9, 720, 300);                   // landar på kartan men är nypets andra finger
        expect(inp.pinching).toBe(true);
        touch('pointerdown', 10, 100, 100);                  // tredje fingret
        touch('pointermove', 10, 0, 0);
        expect(inp.takePinch()).toBe(1);
        touch('pointermove', 9, 610, 300);                   // 220 → 110
        expect(inp.takePinch()).toBeCloseTo(0.5, 12);
    });

    it('fokusbyte mitt i ett nyp släpper allt', () => {
        const { inp, touch, win } = setup();
        touch('pointerdown', 7, 400, 300);
        touch('pointerdown', 8, 500, 300);
        touch('pointermove', 8, 600, 300);
        win.fire('blur');
        expect(inp.pinching).toBe(false);
        expect(inp.takePinch()).toBe(1);
        touch('pointermove', 8, 700, 300);
        expect(inp.takePinch()).toBe(1);
        expect(inp.takeLook()).toEqual({ dx: 0, dy: 0 });
    });

    it('Esc som släpper pekarlåset blir inte "åk hem"', () => {
        const { inp, key } = setup();
        inp.requestLock();
        key('Escape');
        expect(inp.pressed('exit')).toBe(false);
        inp.releaseLock();
        key('Escape', 'keyup');
        key('Escape');                                       // samma tryck som släppte låset
        expect(inp.pressed('exit')).toBe(false);
        inp.lockLostT = -1e9;
        key('Escape', 'keyup');
        key('Escape');
        expect(inp.pressed('exit')).toBe(true);
    });
});
