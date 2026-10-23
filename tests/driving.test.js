import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { generateCity, tileAt, isSolidTile } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle, VEHICLES, exitSpot, spotFree } from '../src/city/vehicles.js';
import { stepVehicle, distToVehicle } from '../src/city/physics.js';
import { TILE, T, MAP_W, MAP_H, SOLID } from '../src/city/constants.js';
import * as POL from '../src/city/police.js';
import { stickVector, stickCar, STICK_RADIUS } from '../src/city/input.js';

// ═══════════════════════════════════════════
//  Körning (masterprompt avsnitt 4): W gasar längs nosen, S bromsar och
//  backar, A/D svänger utan sidsteg, Space handbroms. Vändbar i låg fart,
//  loss efter en lätt krock, inga låsningar mot små hinder, avstigning på
//  en fri plats och samma fysik vid alla bildfrekvenser. Mätt i riktiga stan.
// ═══════════════════════════════════════════

const city = generateCity(1337);
const OPEN = { ...city, tiles: new Uint8Array(city.tiles.length) }; // bara asfalt
const MID = { x: MAP_W * TILE / 2, y: MAP_H * TILE / 2 };
const DT = 1 / 60;
const PI = Math.PI;
const IDLE = { throttle: 0, steer: 0, handbrake: false, fwd: 0, strafe: 0, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
const ctl = (throttle = 0, steer = 0, handbrake = false) => ({ throttle, steer, handbrake, nitro: false });
// Spelarens bil (ratten följer mjukt bara för spelaren; datorförarna styr direkt)
const mine = (...args) => { const v = createVehicle(...args); v.driver = 'player'; return v; };
const fwdOf = v => v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
const latOf = v => -v.vx * Math.sin(v.angle) + v.vy * Math.cos(v.angle);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const tile = (x, y) => tileAt(city, x, y);
const free = (x, y) => !isSolidTile(city, x, y);
const solidAt = (x, y) => SOLID.has(tileAt(city, Math.floor(x / TILE), Math.floor(y / TILE)));
// Ingen del av en cirkel med radien r i en solid ruta
const circleClear = (x, y, r) => {
    for (let k = 0; k < 16; k++) if (solidAt(x + Math.cos(k * PI / 8) * r, y + Math.sin(k * PI / 8) * r)) return false;
    return !solidAt(x, y);
};
// Ingen del av bilen i en vägg (kollisionscirklarna)
const carClear = v => {
    const r = v.spec.w / 2 + 1, off = v.spec.l / 2 - r;
    return [-1, 1].every(s => circleClear(v.x + Math.cos(v.angle) * off * s, v.y + Math.sin(v.angle) * off * s, r - 0.5));
};

// ── Platser i stan ──
// Vanlig gata: två körfält (128 px) med trottoar och sedan hus på båda sidor — den trångaste sorten
const streets = [];
for (let r = 3; r < MAP_H - 6; r++) for (let x = 3; x < MAP_W - 10; x++) {
    let ok = true;
    for (let i = 0; i < 6 && ok; i++) {
        const c = x + i;
        ok = tile(c, r) === T.ROAD && tile(c, r + 1) === T.ROAD && tile(c, r - 1) === T.SIDEWALK && tile(c, r + 2) === T.SIDEWALK
            && isSolidTile(city, c, r - 2) && isSolidTile(city, c, r + 3);
    }
    if (ok) streets.push({ r, x });
}
// Gata utan krav på hus: väg i två rader och trottoar på båda sidor, 6 rutor rakt
const anyStreets = [];
for (let r = 3; r < MAP_H - 6; r++) for (let x = 3; x < MAP_W - 10; x += 3) {
    let ok = true;
    for (let i = 0; i < 6 && ok; i++) ok = tile(x + i, r) === T.ROAD && tile(x + i, r + 1) === T.ROAD && tile(x + i, r - 1) === T.SIDEWALK && tile(x + i, r + 2) === T.SIDEWALK;
    if (ok) anyStreets.push({ r, x });
}
// Husvägg norr om trottoaren, väg söder om den (bilen kör norrut rakt mot väggen)
const walls = [];
for (let y = 3; y < MAP_H - 4; y++) for (let x = 3; x < MAP_W - 4; x++) {
    if ([-1, 0, 1].every(d => tile(x + d, y) === T.BUILDING && tile(x + d, y + 1) === T.SIDEWALK && tile(x + d, y + 2) === T.ROAD)) walls.push({ x, y });
}
// Lång husvägg: hus i 7 rutor bredvid varandra, trottoar under (för att glida längs väggen)
const longWalls = walls.filter(({ x, y }) => [-3, -2, -1, 0, 1, 2, 3].every(d => tile(x + d, y) === T.BUILDING && tile(x + d, y + 1) === T.SIDEWALK));
// Ett husörn med fri yta öster och söder om sig
const corners = [];
for (let y = 3; y < MAP_H - 4; y++) for (let x = 3; x < MAP_W - 4; x++) {
    if (tile(x, y) === T.BUILDING && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1) && free(x + 2, y + 1) && free(x + 1, y + 2) && free(x, y + 2) && free(x + 2, y)) corners.push({ x, y });
}
const pick = (arr, n) => Array.from({ length: Math.min(n, arr.length) }, (_, i) => arr[Math.floor(i * arr.length / Math.min(n, arr.length))]);

describe('platserna finns', () => {
    it('hittar gator, väggar och hörn att testa mot', () => {
        expect(streets.length).toBeGreaterThan(0);
        expect(anyStreets.length).toBeGreaterThan(5);
        expect(walls.length).toBeGreaterThan(10);
        expect(longWalls.length).toBeGreaterThan(3);
        expect(corners.length).toBeGreaterThan(3);
    });
});

describe('W, S, A/D och Space', () => {
    it('W gasar längs nosen åt alla håll — ingen sidofart', () => {
        for (const a of [0, 0.7, PI / 2, 2.5, PI, -2, -PI / 2]) {
            const v = mine('volvo', MID.x, MID.y, a);
            for (let i = 0; i < 90; i++) stepVehicle(v, ctl(1), DT, OPEN);
            expect(fwdOf(v)).toBeGreaterThan(300);
            expect(Math.abs(latOf(v))).toBeLessThan(1e-6);
            expect(Math.abs(wrap(Math.atan2(v.y - MID.y, v.x - MID.x) - a))).toBeLessThan(1e-6);
        }
    });

    it('S bromsar till stillastående och backar sedan, utan att fastna på noll', () => {
        for (const type of ['volvo', 'van', 'lambo', 'police', 'moped']) {
            const v = mine(type, MID.x, MID.y, 0);
            v.vx = 200;
            let prev = fwdOf(v), stopT = null, revT = null, brakeSeen = false, revSeen = false;
            for (let i = 0; i < 90; i++) {
                stepVehicle(v, ctl(-1), DT, OPEN);
                const f = fwdOf(v);
                expect(f).toBeLessThanOrEqual(prev + 1e-9);   // farten sjunker hela tiden
                if (f > 5) brakeSeen ||= v.braking;
                if (stopT === null && f <= 0) stopT = i * DT;
                if (revT === null && f < -30) revT = i * DT;
                revSeen ||= v.reversing;
                prev = f;
            }
            expect(brakeSeen, type).toBe(true);
            expect(stopT, type).toBeLessThan(0.5);                 // bromsen tar
            expect(revT - stopT, type).toBeLessThan(0.35);         // och backen kommer direkt efter
            expect(revSeen, type).toBe(true);
            expect(fwdOf(v)).toBeGreaterThanOrEqual(-v.spec.maxSpeed * 0.35 - 1);
        }
    });

    it('W när bilen backar bromsar först och kör sedan framåt', () => {
        const v = mine('volvo', MID.x, MID.y, 0);
        v.vx = -100;
        stepVehicle(v, ctl(1), DT, OPEN);
        expect(v.braking).toBe(true);
        for (let i = 0; i < 40; i++) stepVehicle(v, ctl(1), DT, OPEN);
        expect(fwdOf(v)).toBeGreaterThan(50);
    });

    it('A/D svänger bilen utan sidsteg: liten glidvinkel i vanliga kurvor, rakt fram = noll', () => {
        for (const type of ['volvo', 'van', 'police', 'lambo']) for (const sp of [60, 150, 250]) {
            const v = mine(type, MID.x, MID.y, 0);
            v.vx = sp;
            let slip = 0;
            for (let i = 0; i < 120; i++) {
                stepVehicle(v, ctl(Math.max(-1, Math.min(1, (sp - fwdOf(v)) / 30)), 1), DT, OPEN);
                slip = Math.max(slip, Math.abs(Math.atan2(latOf(v), Math.abs(fwdOf(v)))));
            }
            expect(slip, `${type} ${sp}`).toBeLessThan(8 * PI / 180);
        }
    });

    it('en stillastående bil vrider sig inte på stället (ingen stridsvagn)', () => {
        const v = mine('volvo', MID.x, MID.y, 0.4);
        for (let i = 0; i < 60; i++) stepVehicle(v, ctl(0, 1), DT, OPEN);
        expect(v.angle).toBeCloseTo(0.4, 6);
    });

    it('ratten följer mjukt: ett kort tryck ger en liten sväng, inget ryck', () => {
        const v = mine('volvo', MID.x, MID.y, 0);
        v.vx = 200;
        for (let i = 0; i < 60; i++) stepVehicle(v, ctl(0.3, i < 6 ? -1 : 0), DT, OPEN);
        const deg = -v.angle * 180 / PI;
        expect(deg).toBeGreaterThan(3);
        expect(deg).toBeLessThan(10);
        expect(v.steerPos).toBeCloseTo(0, 6);
    });

    it('datorförarna (trafik, polis) styr direkt: ingen eftersläpning i deras ratt', () => {
        const v = createVehicle('police', MID.x, MID.y, 0);
        v.vx = 200; v.driver = 'cop';
        stepVehicle(v, ctl(0.5, 0.8), DT, OPEN);
        expect(v.steerPos).toBe(0.8);
    });

    it('svängradien: tight i låg fart, vidare i hög fart (förutsägbart)', () => {
        const R = (type, sp) => {
            const v = mine(type, MID.x, MID.y, 0);
            v.vx = sp;
            let a0 = null, sum = 0, n = 0;
            for (let i = 0; i < 240; i++) {
                stepVehicle(v, ctl(Math.max(-1, Math.min(1, (sp - fwdOf(v)) / 30)), 1), DT, OPEN);
                if (i >= 90) { const d = Math.atan2(v.vy, v.vx); if (a0 !== null) { sum += wrap(d - a0); n++; } a0 = d; }
            }
            return Math.hypot(v.vx, v.vy) / Math.abs(sum / (n * DT));
        };
        for (const type of Object.keys(VEHICLES)) {
            const low = R(type, 50), mid = R(type, 150), high = R(type, Math.min(330, VEHICLES[type].maxSpeed - 10));
            expect(low, type).toBeLessThan(56);         // U-sväng ryms på en tvåfilig gata + trottoar
            expect(mid, type).toBeGreaterThan(low);
            expect(high, type).toBeGreaterThan(mid);
        }
    });

    it('handbromsen: bakdelen släpper och bilen vänder 180° på en gatubredd', () => {
        for (const type of ['volvo', 'police', 'lambo']) {
            const v = mine(type, MID.x, MID.y, 0);
            v.vx = 250;
            let t = 0, skid = false;
            for (; t < 4; t += DT) {
                const r = stepVehicle(v, t < 0.6 ? ctl(0, -1, true) : ctl(1, -1), DT, OPEN);
                skid ||= r.skid;
                if (Math.abs(wrap(v.angle)) > PI * 0.95) break;
            }
            expect(skid, type).toBe(true);
            expect(t, type).toBeLessThan(2.2);
            expect(Math.abs(MID.y - v.y), type).toBeLessThan(130);
        }
    });

    it('varje bil behåller sin karaktär: toppfart enligt specen, snabbare bilar drar snabbare', () => {
        const run = type => {
            const v = mine(type, 4 * TILE, MID.y, 0);   // 6 s rakt österut ryms på kartan
            let t200 = null;
            for (let i = 0; i < 60 * 6; i++) { stepVehicle(v, ctl(1), DT, OPEN); if (t200 === null && fwdOf(v) >= Math.min(200, v.spec.maxSpeed * 0.8)) t200 = i * DT; }
            return { top: fwdOf(v), t200 };
        };
        const r = Object.fromEntries(Object.keys(VEHICLES).map(k => [k, run(k)]));
        for (const k of Object.keys(VEHICLES)) {
            expect(r[k].top, k).toBeGreaterThan(VEHICLES[k].maxSpeed * 0.98);
            expect(r[k].top, k).toBeLessThanOrEqual(VEHICLES[k].maxSpeed + 1);
        }
        expect(r.lambo.t200).toBeLessThan(r.bmw.t200);
        expect(r.bmw.t200).toBeLessThan(r.volvo.t200);
        expect(r.volvo.t200).toBeLessThan(r.van.t200);
    });
});

describe('U-sväng i låg fart på en vanlig gata', () => {
    // Bilen står i högra filen (österut) och ska vända till vänster, mot husen på andra sidan
    const uturn = (type, st, strategy, gas) => {
        const v = mine(type, (st.x + 1) * TILE, (st.r + 1) * TILE + 32, 0);
        let t = 0, hits = 0, phase = 'fwd', phaseT = 0;
        for (; t < 8; t += DT) {
            if (Math.abs(wrap(v.angle)) > PI * 0.92 && fwdOf(v) > 15) break;
            let c = ctl(gas, -1);
            if (strategy === 'player') {
                // Som en spelare: W+A, tar det stopp så S+D en stund och sedan W+A igen
                if (phase === 'fwd' && phaseT > 0.4 && Math.abs(fwdOf(v)) < 12) { phase = 'back'; phaseT = 0; }
                else if (phase === 'back' && phaseT > 0.9) { phase = 'fwd'; phaseT = 0; }
                if (phase === 'back') c = ctl(-1, 1);
            }
            const r = stepVehicle(v, c, DT, city);
            if (r.impact > 0) hits++;
            phaseT += DT;
            expect(carClear(v)).toBe(true);
        }
        return { t, hits };
    };

    it('lätt gas och full ratt: vänder på gatan utan att ta i husen', () => {
        for (const st of pick(streets, 3)) for (const type of ['volvo', 'taxi', 'bmw', 'police', 'moped', 'lambo']) {
            const r = uturn(type, st, 'sweep', 0.5);
            expect(r.t, type).toBeLessThan(2.6);
            expect(r.hits, type).toBe(0);
        }
    });

    it('alla bilar, även skåpbil och Rolls, vänder inom 4 s som en spelare gör (W+A, vid stopp S+D)', () => {
        for (const st of pick(streets, 3)) for (const type of Object.keys(VEHICLES)) {
            expect(uturn(type, st, 'player', 0.6).t, type).toBeLessThan(4);
        }
    });

    it('på bredare gator i hela stan vänder Volvon i ett svep', () => {
        for (const st of pick(anyStreets, 12)) {
            const r = uturn('volvo', st, 'sweep', 0.5);
            expect(r.t, `gata ${st.x},${st.r}`).toBeLessThan(2.6);
        }
    });
});

describe('Lätt krock: kontrollen tillbaka', () => {
    // Rakt mot en husvägg i 100–180 px/s, spelaren håller lite gas en kvarts sekund, sedan styr hen loss
    const crash = (type, ws, speed) => {
        const v = mine(type, ws.x * TILE + 32, (ws.y + 1) * TILE + 60 + VEHICLES[type].l / 2, -PI / 2);
        v.vy = -speed;
        let imp = 0;
        for (let i = 0; i < 60 && !imp; i++) imp = stepVehicle(v, ctl(0.3), DT, city).impact;
        for (let i = 0; i < 15; i++) stepVehicle(v, ctl(0.6), DT, city);
        return { v, imp };
    };
    const freeT = (v, c, secs = 3) => {
        const s = { x: v.x, y: v.y };
        for (let t = 0; t < secs; t += DT) {
            stepVehicle(v, c, DT, city);
            expect(carClear(v)).toBe(true);
            if (Math.hypot(v.x - s.x, v.y - s.y) > 40 && Math.abs(fwdOf(v)) > 25) return t;
        }
        return Infinity;
    };

    it('S backar loss från väggen inom ~1 s', () => {
        for (const ws of pick(walls, 6)) for (const type of ['volvo', 'van', 'police', 'lambo', 'rolls']) for (const sp of [100, 180]) {
            const { v, imp } = crash(type, ws, sp);
            expect(imp).toBeGreaterThan(60);
            expect(Math.abs(v.spin)).toBeLessThan(0.5);   // ingen snurr av en rak smäll
            expect(freeT(v, ctl(-1)), `${type} ${sp}`).toBeLessThan(1.2);
        }
    });

    it('W + A eller W + D vrider nosen längs väggen och kör loss inom 2 s (ingen låsning)', () => {
        for (const ws of pick(walls, 6)) for (const type of ['volvo', 'van', 'police', 'lambo', 'rolls', 'moped']) for (const steer of [-1, 1]) {
            const { v } = crash(type, ws, 120);
            expect(freeT(v, ctl(1, steer)), `${type} ${steer}`).toBeLessThan(2);
        }
    });

    it('S + ratt kommer också loss inom ~1 s', () => {
        for (const ws of pick(walls, 4)) for (const steer of [-1, 1]) {
            const { v } = crash('volvo', ws, 140);
            expect(freeT(v, ctl(-1, steer))).toBeLessThan(1.2);
        }
    });

    it('bara W rakt in i väggen står kvar (bilen gör inget man inte bett om)', () => {
        const { v } = crash('volvo', walls[0], 120);
        const a = v.angle, x = v.x;
        for (let i = 0; i < 120; i++) stepVehicle(v, ctl(1), DT, city);
        expect(Math.abs(wrap(v.angle - a))).toBeLessThan(0.05);
        expect(Math.abs(v.x - x)).toBeLessThan(3);
    });

    it('snett in i väggen (30°) med gasen kvar: rättar in sig längs väggen och kör vidare', () => {
        for (const ws of pick(longWalls, 6)) for (const type of ['volvo', 'police', 'lambo']) {
            const a = -PI / 2 + PI / 6;
            const v = mine(type, ws.x * TILE - 60, (ws.y + 1) * TILE + 50 + VEHICLES[type].l / 2, a);
            v.vx = Math.cos(a) * 180; v.vy = Math.sin(a) * 180;
            for (let i = 0; i < 150; i++) { stepVehicle(v, ctl(1), DT, city); expect(carClear(v)).toBe(true); }
            expect(Math.hypot(v.vx, v.vy), type).toBeGreaterThan(40);
            expect(Math.abs(wrap(v.angle)), type).toBeLessThan(0.45);   // nosen ungefär längs väggen (österut)
        }
    });

    it('nosen 3–8° in i väggen i full fart: glider längs den nästan utan att tappa fart', () => {
        for (const ws of pick(longWalls, 4)) for (const deg of [3, 8]) {
            const a = -deg * PI / 180;
            const v = mine('volvo', ws.x * TILE - 150, (ws.y + 1) * TILE + 14, a);
            v.vx = 250 * Math.cos(a); v.vy = 250 * Math.sin(a);
            let min = Infinity;
            for (let i = 0; i < 60; i++) { stepVehicle(v, ctl(1), DT, city); min = Math.min(min, Math.hypot(v.vx, v.vy)); }
            expect(min, `${deg}°`).toBeGreaterThan(180);
        }
    });

    it('ett hörn som tar i framkanten (10 px) fastnar man inte på', () => {
        for (const cs of pick(corners, 6)) for (const type of ['volvo', 'police', 'lambo']) {
            const cornerX = (cs.x + 1) * TILE, cornerY = (cs.y + 1) * TILE;
            if (!free(cs.x + 1, cs.y - 1) || !free(cs.x + 1, cs.y - 2)) continue;   // fri väg norrut förbi hörnet
            const v = mine(type, cornerX + VEHICLES[type].w / 2 - 10, cornerY + 80, -PI / 2);
            v.vy = -150;
            for (let i = 0; i < 120; i++) stepVehicle(v, ctl(1), DT, city);
            expect(v.y, `${type} hörn ${cs.x},${cs.y}`).toBeLessThan(cornerY - 40);
        }
    });
});

describe('Bilen bryr sig inte om blicken (world.update med turn/aim)', () => {
    it('turn, aim, joystickens mx/my och lookOnly ändrar varken nosen, farten eller vägen', () => {
        const mk = () => {
            const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(5) });
            w.peds = []; w.vehicles = []; w.manageSpawns = () => { };
            const st = anyStreets[0];
            const car = createVehicle('volvo', (st.x + 1) * TILE, (st.r + 1) * TILE + 32, 0);
            car.driver = 'player'; w.vehicles.push(car); w.player.vehicle = car;
            return { w, car };
        };
        const a = mk(), b = mk();
        for (let i = 0; i < 240; i++) {
            const c = { throttle: i < 150 ? 1 : -1, steer: i > 60 && i < 90 ? 1 : 0, handbrake: false };
            a.w.update(DT, { ...IDLE, ...c });
            b.w.update(DT, { ...IDLE, ...c, turn: 0.4 * Math.sin(i), aim: { x: b.car.x - 200, y: b.car.y + 300 }, mx: -1, my: 0, faceMove: true, lookOnly: true });
            expect(b.car.angle).toBe(a.car.angle);
            expect(b.car.x).toBe(a.car.x);
            expect(b.car.vy).toBe(a.car.vy);
        }
        // och utan ratt går bilen rakt, hur mycket man än vrider blicken
        const c = mk();
        for (let i = 0; i < 60; i++) c.w.update(DT, { ...IDLE, throttle: 1, turn: 0.8, aim: { x: c.car.x, y: c.car.y - 500 } });
        expect(c.car.angle).toBe(0);
        expect(Math.abs(latOf(c.car))).toBeLessThan(1e-9);
    });
});

describe('Avstigning (E) hamnar på en fri plats', () => {
    const R = 8;   // spelarens radie + marginal, som world.exitSpotFor
    const worldWith = (car, others = []) => {
        const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(9) });
        w.peds = []; w.manageSpawns = () => { };
        w.vehicles = [car, ...others];
        car.driver = 'player'; w.player.vehicle = car; w.player.x = car.x; w.player.y = car.y;
        return w;
    };
    const parked = (type, x, y, a) => createVehicle(type, x, y, a, { parked: true });
    const checkExit = (w, car, label) => {
        w.update(DT, { ...IDLE, action: true });
        const p = w.player;
        expect(p.vehicle, label).toBe(null);
        expect(circleClear(p.x, p.y, 7), label).toBe(true);                      // inte i ett hus/vatten/träd
        for (const o of w.vehicles) expect(distToVehicle(o, p.x, p.y), label).toBeGreaterThanOrEqual(7);  // inte i en bil
        expect(Math.hypot(p.x - car.x, p.y - car.y), label).toBeLessThan(150);
        expect(Math.abs(wrap(p.angle - car.angle)), label).toBeLessThan(1e-9);    // vänd som bilen
        // och gubben står inte fast: åt något håll kan han gå därifrån
        const x0 = p.x, y0 = p.y;
        let best = 0;
        for (let k = 0; k < 8 && best <= 8; k++) {
            p.x = x0; p.y = y0; p.vx = p.vy = 0;
            for (let i = 0; i < 10 && !w.interior; i++) w.update(DT, { ...IDLE, mx: Math.cos(k * PI / 4), my: Math.sin(k * PI / 4), faceMove: false });
            if (w.interior) return;   // råkade gå in genom en dörr: då står han inte fast
            best = Math.max(best, Math.hypot(p.x - x0, p.y - y0));
            expect(circleClear(p.x, p.y, 6.5), label).toBe(true);
        }
        expect(best, label).toBeGreaterThan(8);
    };

    it('bredvid en husvägg: ut på den fria sidan, aldrig in i huset', () => {
        for (const ws of pick(walls, 8)) for (const side of [1, -1]) {
            // Längs väggen med förarsidan (vänster) eller passagerarsidan mot huset
            const a = side > 0 ? 0 : PI;
            const car = createVehicle('volvo', ws.x * TILE + 32, (ws.y + 1) * TILE + 12, a);
            const w = worldWith(car);
            checkExit(w, car, `vägg ${ws.x},${ws.y} ${side}`);
            expect(w.player.y).toBeGreaterThan((ws.y + 1) * TILE + 7);
        }
    });

    it('mellan två parkerade bilar och en vägg: fram eller bak, inte i grannbilen', () => {
        for (const ws of pick(walls, 6)) {
            const y = (ws.y + 1) * TILE + 12, x = ws.x * TILE + 32;
            const car = createVehicle('volvo', x, y, 0);
            const right = parked('van', x, y + 27, 0);        // tätt intill på passagerarsidan
            const w = worldWith(car, [right]);
            checkExit(w, car, `klämd ${ws.x},${ws.y}`);
        }
    });

    it('i en kö med bilar tätt på båda sidor: kliver ut i luckan framför', () => {
        const st = anyStreets[2];
        const x = (st.x + 3) * TILE, y = (st.r + 1) * TILE;   // mitt mellan filerna
        const car = createVehicle('volvo', x, y, 0);
        const others = [
            parked('volvo', x - 50, y, 0), parked('volvo', x + 68, y, 0),   // tätt bakom, en lucka framför
            parked('van', x, y - 28, 0), parked('taxi', x, y + 27, 0)       // tätt på båda sidor
        ];
        const w = worldWith(car, others);
        checkExit(w, car, 'kö');
        expect(w.player.x).toBeGreaterThan(x + 22);
    });

    it('snett i ett husörn och längs kajen', () => {
        for (const cs of pick(corners, 6)) {
            const car = createVehicle('bmw', (cs.x + 1) * TILE + 20, (cs.y + 1) * TILE + 20, PI / 4);
            checkExit(worldWith(car), car, `hörn ${cs.x},${cs.y}`);
        }
        // Vattnet börjar 3 rutor från östra kanten: bilen längs kajen
        let quay = null;
        for (let y = 5; y < MAP_H - 6 && !quay; y++) if (tile(MAP_W - 4, y) !== T.WATER && free(MAP_W - 4, y) && tile(MAP_W - 3, y) === T.WATER) quay = y;
        expect(quay).not.toBeNull();
        for (const a of [-PI / 2, PI / 2]) {   // förarsidan från vattnet, och mot vattnet
            const car = createVehicle('volvo', (MAP_W - 3) * TILE - 12, quay * TILE + 32, a);
            const w = worldWith(car);
            checkExit(w, car, 'kajen');
            expect(w.player.x).toBeLessThan((MAP_W - 3) * TILE - 7);
        }
    });

    it('helt instängd: man stannar i bilen med ett besked (ingen avstigning in i något)', () => {
        const st = anyStreets[3];
        const x = (st.x + 3) * TILE, y = (st.r + 1) * TILE;
        const car = createVehicle('volvo', x, y, 0);
        const ring = [];
        for (let k = 0; k < 16; k++) {
            const a = k * PI / 8;
            for (const d of [34, 60, 86, 112, 138]) ring.push(parked('van', x + Math.cos(a) * d, y + Math.sin(a) * d, a + PI / 2));
        }
        expect(exitSpot(car, city, [car, ...ring], R)).toBe(null);
        const w = worldWith(car, ring);
        w.update(DT, { ...IDLE, action: true });
        expect(w.player.vehicle).toBe(car);
        expect(w.events.some(e => e.type === 'msg')).toBe(true);
    });

    it('en brinnande bil släpper alltid ut en', () => {
        const ws = walls[1];
        const car = createVehicle('volvo', ws.x * TILE + 32, (ws.y + 1) * TILE + 12, 0);
        const w = worldWith(car);
        w.damageVehicle(car, 9999, null);
        w.update(DT, { ...IDLE, action: true });
        expect(w.player.vehicle).toBe(null);
        expect(circleClear(w.player.x, w.player.y, 7)).toBe(true);
    });

    it('spotFree känner igen hus, vatten och bilar', () => {
        const ws = walls[0];
        expect(spotFree(city, [], ws.x * TILE + 32, ws.y * TILE + 32)).toBe(false);          // i huset
        expect(spotFree(city, [], ws.x * TILE + 32, (ws.y + 1) * TILE + 4)).toBe(false);      // för nära väggen
        expect(spotFree(city, [], ws.x * TILE + 32, (ws.y + 1) * TILE + 20)).toBe(true);
        expect(spotFree(city, [], (MAP_W - 2) * TILE, 10 * TILE)).toBe(false);                // i vattnet
        const o = createVehicle('van', ws.x * TILE + 32, (ws.y + 1) * TILE + 30, 0);
        expect(spotFree(city, [o], ws.x * TILE + 32, (ws.y + 1) * TILE + 30)).toBe(false);
    });
});

describe('Samma fysik vid alla bildfrekvenser (fast steg 1/60)', () => {
    // Som spelloopen i index.js: tiden samlas, styrningen läses en gång per bild, sedan körs
    // hela 1/60-steg (högst 5 per bild). program(t) = styrningen vid tiden t (byter var 0,5 s).
    const STEP = 1 / 60;
    const program = t => {
        const k = Math.floor(t / 0.5 + 1e-9) % 8;
        return [ctl(1, 0), ctl(1, -1), ctl(1, 0.5), ctl(-1, 0), ctl(-1, 1), ctl(1, 1, true), ctl(1, 0), ctl(0, -1)][k];
    };
    const runAt = (fps, secs, stepper) => {
        let acc = 0, sim = 0;
        const frame = 1 / fps;
        for (let f = 0; f < Math.round(secs * fps); f++) {
            acc += frame;
            if (acc >= STEP - 1e-9) {
                const c = program(sim);
                let steps = 0;
                while (acc >= STEP - 1e-9 && steps < 5) { stepper(c); sim += STEP; acc -= STEP; steps++; }
                if (steps === 5) acc = 0;
            }
        }
        return sim;
    };

    it('stepVehicle: 30, 60 och 120 bilder/s ger exakt samma bana (även mot väggar)', () => {
        const st = anyStreets[1];
        const res = [30, 60, 120].map(fps => {
            const v = mine('volvo', (st.x + 1) * TILE, (st.r + 1) * TILE + 32, 0);
            const sim = runAt(fps, 4, c => stepVehicle(v, c, STEP, city));
            return { sim, x: v.x, y: v.y, a: v.angle, vx: v.vx, vy: v.vy };
        });
        expect(res[0].sim).toBeCloseTo(4, 6);
        for (const r of res.slice(1)) {
            expect(r.sim).toBeCloseTo(res[0].sim, 6);
            for (const k of ['x', 'y', 'a', 'vx', 'vy']) expect(r[k]).toBeCloseTo(res[0][k], 6);
        }
    });

    it('hela världen med spelaren i bilen: samma läge vid 30, 60 och 120 bilder/s', () => {
        const res = [30, 60, 120].map(fps => {
            const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(21) });
            const car = w.vehicles[0];
            car.driver = 'player'; w.player.vehicle = car; car.parked = false;
            runAt(fps, 4, c => { w.update(STEP, { ...IDLE, ...c }); w.events.length = 0; });
            return { x: car.x, y: car.y, a: car.angle, hp: car.hp, n: w.vehicles.length };
        });
        for (const r of res.slice(1)) {
            expect(r.x).toBeCloseTo(res[0].x, 6);
            expect(r.y).toBeCloseTo(res[0].y, 6);
            expect(r.a).toBeCloseTo(res[0].a, 6);
            expect(r.hp).toBeCloseTo(res[0].hp, 6);
            expect(r.n).toBe(res[0].n);
        }
    });

    it('ryckiga bilder (7–40 ms) ger samma bana som jämna 60 bilder/s', () => {
        const rnd = mulberry32(4);
        const ref = mine('lambo', MID.x, MID.y, 0), jit = mine('lambo', MID.x, MID.y, 0);
        runAt(60, 3, c => stepVehicle(ref, c, STEP, OPEN));
        // Ryckig bildtakt: olika många steg per bild, men varje steg är exakt 1/60 s och får
        // samma styrning som motsvarande steg vid 60 bilder/s (fysiken ser aldrig bildtiden)
        let acc = 0, n = 0, steps = 0;
        const total = Math.round(3 / STEP);
        while (n < total) {
            acc += 0.007 + rnd() * 0.033;
            for (steps = 0; acc >= STEP && steps < 5 && n < total; steps++, n++, acc -= STEP) stepVehicle(jit, program(n * STEP), STEP, OPEN);
            if (steps === 5) acc = 0;
        }
        expect(jit.x).toBeCloseTo(ref.x, 6);
        expect(jit.y).toBeCloseTo(ref.y, 6);
        expect(jit.angle).toBeCloseTo(ref.angle, 6);
    });
});

// Joysticken (input.js, A1) räknar om draget till gas och ratt; i spelet är bilen spelarens,
// så rattens mjukhet gäller även här. Den ska fortfarande svänga in utan att pendla och komma loss.
describe('Joysticken med den nya fysiken', () => {
    const on = (x, y) => ({ ...stickVector(x, y, STICK_RADIUS), active: true });
    it('svänger in mot draget och kör dit utan att pendla', () => {
        for (const type of ['volvo', 'van', 'lambo']) {
            const v = mine(type, MID.x, MID.y, -PI / 2);
            v.vy = -150;
            const mem = {}, stick = on(STICK_RADIUS, 0);   // nosen norr, drag österut
            let crossings = 0, prev = null;
            for (let i = 0; i < 180; i++) {
                stepVehicle(v, stickCar(mem, stick, v, DT), DT, OPEN);
                const err = wrap(v.angle);
                if (prev !== null && Math.sign(err) !== Math.sign(prev) && Math.abs(err) > 0.02) crossings++;
                prev = err;
            }
            expect(Math.abs(wrap(v.angle)), type).toBeLessThan(0.1);
            expect(crossings, type).toBeLessThanOrEqual(1);
            expect(fwdOf(v), type).toBeGreaterThan(150);
        }
    });

    it('nosen mot en husvägg, drag längs gatan: loss och iväg inom 2 s', () => {
        for (const ws of pick(longWalls, 4)) for (const dir of [1, -1]) {
            const v = mine('volvo', ws.x * TILE + 32, (ws.y + 1) * TILE + 60, -PI / 2);
            v.vy = -120;
            for (let i = 0; i < 60; i++) stepVehicle(v, ctl(0.6), DT, city);   // in i väggen
            const mem = {}, stick = on(STICK_RADIUS * dir, 0), x0 = v.x;
            let t = 0;
            for (; t < 2; t += DT) {
                stepVehicle(v, stickCar(mem, stick, v, DT), DT, city);
                expect(carClear(v)).toBe(true);
                if ((v.x - x0) * dir > 40 && fwdOf(v) > 30) break;
            }
            expect(t, `vägg ${ws.x},${ws.y} drag ${dir}`).toBeLessThan(2);
        }
    });
});

describe('Startbilen mot polisen (samordnat med polisspåret)', () => {
    it('Morsans Volvo är snabbare än polisens jaktfart på låg efterlysning, och polisen är aldrig över sin toppfart', () => {
        const volvo = VEHICLES.volvo, cop = VEHICLES.police;
        for (const level of [1, 2]) {
            expect(POL.chaseSpeed(level)).toBeLessThanOrEqual(1);
            expect(POL.chaseSpeed(level) * cop.maxSpeed).toBeLessThan(volvo.maxSpeed * 0.85);
        }
        for (let level = 0; level <= 5; level++) expect(POL.chaseSpeed(level)).toBeLessThanOrEqual(1);
    });
});
