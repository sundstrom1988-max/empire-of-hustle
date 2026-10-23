import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { generateCity, isSolidAt } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle } from '../src/city/vehicles.js';
import * as INT from '../src/city/interiors.js';

// ═══════════════════════════════════════════
//  Rättningar efter granskningen av etapp 0 (utanför polisen):
//  folk inomhus är solida, taxi från telefonen inne i ett rum,
//  zoner med fartvillkor (lackverkstad, skrot, dejt, garage).
// ═══════════════════════════════════════════

const city = generateCity(1337);
const STEP = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, fwd: 0, strafe: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };

function world(seed = 1) {
    const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(seed) });
    w.vehicles = []; w.peds = [];
    w.manageSpawns = () => { };
    return w;
}

describe('Inomhus: man går inte rakt in i folk', () => {
    it('gå rakt mot en stillastående person: spelaren stannar utanför personen (förstaperson)', () => {
        let tested = 0;
        for (const [id, marker] of [['stripclub', city.markers.stripclub], ['gunshop', city.markers.guns]]) {
            const w = world(3);
            w.player.x = marker.door.x; w.player.y = marker.door.y;
            expect(w.enterInterior(id, marker)).toBe(true);
            const I = w.interior, def = I.def, p = w.player;
            // Låt rummet komma igång och hitta en person som står still
            for (let i = 0; i < 120; i++) INT.updateInterior(I.state, STEP, w.rnd);
            const before = I.state.npcs.map(n => ({ x: n.x, y: n.y }));
            for (let i = 0; i < 60; i++) INT.updateInterior(I.state, STEP, w.rnd);
            const still = I.state.npcs.filter((n, k) => !n.gone && !n.dead && Math.hypot(n.x - before[k].x, n.y - before[k].y) < 0.5);
            // En person med fri väg 40 px fram till sig (inga väggar och ingen annan person i vägen)
            let pick = null;
            for (const n of still) {
                for (let a = 0; a < 16 && !pick; a++) {
                    const ang = a * Math.PI / 8, sx = n.x + Math.cos(ang) * 40, sy = n.y + Math.sin(ang) * 40;
                    let ok = true;
                    for (let s = 0; s <= 10 && ok; s++) {
                        const qx = sx + (n.x - sx) * s / 10 * 0.6, qy = sy + (n.y - sy) * s / 10 * 0.6;
                        if (!INT.circleClear(def, qx, qy, p.r + 1)) ok = false;
                        if (I.state.npcs.some(m => m !== n && Math.hypot(m.x - qx, m.y - qy) < 22)) ok = false;
                    }
                    if (ok) pick = { n, sx, sy, ang: ang + Math.PI };
                }
                if (pick) break;
            }
            if (!pick) continue;
            tested++;
            p.x = pick.sx; p.y = pick.sy; p.vx = p.vy = 0; p.angle = pick.ang;
            I.exitArmed = false;
            let minD = Infinity;
            for (let i = 0; i < 120; i++) {
                w.update(STEP, { ...IDLE, fwd: 1 });
                w.events.length = 0;
                if (w.interior !== I) break;
                minD = Math.min(minD, Math.hypot(p.x - pick.n.x, p.y - pick.n.y));
            }
            expect(w.interior).toBe(I);
            expect(minD).toBeGreaterThan((INT.NPC_RADIUS ?? 7) + p.r - 0.5);   // förut 0,3–4,5 px: rakt in i personen
        }
        expect(tested).toBeGreaterThan(0);
    });
});

describe('Taxi från telefonen', () => {
    it('inne i ett rum: taxin tar dig ut och till målet (förut drogs pengarna men man stod kvar)', () => {
        const w = world(4);
        const club = city.markers.stripclub;
        w.player.x = club.door.x; w.player.y = club.door.y;
        expect(w.enterInterior('stripclub', club)).toBe(true);
        w.profile.money = 1000;
        const d = w.taxiDestinations()[0];
        expect(w.taxi(0)).toBe(true);
        expect(w.profile.money).toBe(1000 - d.price);
        expect(w.interior).toBe(null);
        expect(w.player.x).toBe(d.x);
        expect(w.player.y).toBe(d.y);
        w.update(STEP, IDLE);
        expect(Math.hypot(w.player.x - d.x, w.player.y - d.y)).toBeLessThan(20);   // står kvar ute vid målet
        expect(w.interior).toBe(null);
    });
});

describe('Zoner med fartvillkor', () => {
    // Bil rakt mot lackverkstaden med en given fart; brakeTo = farten inne i zonen
    function sprayRun(speedIn, brakeTo) {
        const w = world(5);
        w.profile.money = 5000;
        const sp = city.markers.sprays[0];
        let start = null;
        for (let k = 0; k < 32 && !start; k++) {
            const a = k * Math.PI / 16, px = sp.x + Math.cos(a) * 200, py = sp.y + Math.sin(a) * 200;
            let ok = true;
            for (let i = 0; i <= 30 && ok; i++) {
                const qx = px + (sp.x - px) * i / 30, qy = py + (sp.y - py) * i / 30;
                for (const [dx, dy] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]]) if (isSolidAt(city, qx + dx, qy + dy)) ok = false;
            }
            if (ok) start = { px, py, ang: Math.atan2(sp.y - py, sp.x - px) };
        }
        expect(start).toBeTruthy();
        const v = createVehicle('volvo', start.px, start.py, start.ang);
        v.driver = 'player'; v.hp = v.maxHp * 0.4;
        w.vehicles.push(v); w.player.vehicle = v;
        const msgs = [];
        for (let i = 0; i < 400; i++) {
            const d = Math.hypot(v.x - sp.x, v.y - sp.y);
            const target = d < 36 && brakeTo != null ? brakeTo : speedIn;
            v.vx = Math.cos(start.ang) * target; v.vy = Math.sin(start.ang) * target;
            v.x += v.vx * STEP; v.y += v.vy * STEP; w.player.x = v.x; w.player.y = v.y;
            w.updateInteractions();
            for (const e of w.events) if (e.type === 'msg') msgs.push(e.text);
            w.events.length = 0;
            if (d < 20 && brakeTo != null) { for (let k = 0; k < 60; k++) w.updateInteractions(); break; }
            if (d < 5) break;
        }
        return { paid: 5000 - w.profile.money, repaired: v.hp === v.maxHp, msgs };
    }
    it('för fort in: ingen lackning men ett besked; bromsar man inne i zonen lackas bilen ändå', () => {
        const fast = sprayRun(330, null);
        expect(fast.paid).toBe(0);
        expect(fast.msgs.some(m => m.includes('Sakta ner'))).toBe(true);
        const braked = sprayRun(330, 40);
        expect(braked.paid).toBe(150);
        expect(braked.repaired).toBe(true);
        const slow = sprayRun(150, null);
        expect(slow.paid).toBe(150);
    });
});

// Omkörningen av checklistan: taxipriset inifrån ett rum räknades på rummets koordinater (340–380 kr
// oavsett var i stan rummet låg). Det ska vara samma pris som ute vid dörren.
describe('taxi inifrån ett rum: priset räknas från dörren', () => {
    it('samma pris inne som precis utanför dörren', async () => {
        const { World } = await import('../src/city/world.js');
        const { generateCity } = await import('../src/city/map.js');
        const { mulberry32 } = await import('../src/city/rng.js');
        const { createPlayerState } = await import('../src/game/state.js');
        const city = generateCity(1337);
        const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(4) });
        const m = city.markers;
        w.enterInterior('stripclub', m.stripclub);
        expect(w.interior).toBeTruthy();
        const inside = w.taxiDestinations().map(d => d.price);
        w.exitInterior();
        const outside = w.taxiDestinations().map(d => d.price);
        inside.forEach((pr, i) => expect(Math.abs(pr - outside[i])).toBeLessThanOrEqual(10));
    });
});
