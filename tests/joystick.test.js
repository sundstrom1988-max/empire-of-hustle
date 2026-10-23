import { describe, it, expect } from 'vitest';
import { stickVector, stickKnob, stickWalk, stickDrive, stickOrigin, stickCar, STICK_RADIUS, STICK_DEAD, STICK_RUN } from '../src/city/input.js';
import { stepVehicle } from '../src/city/physics.js';
import { createVehicle } from '../src/city/vehicles.js';
import { generateCity, isSolidTile } from '../src/city/map.js';
import { TILE, MAP_W, MAP_H } from '../src/city/constants.js';
import { touchText, pagerX, pagerY, PAGER_TOP } from '../src/city/hud.js';

const R = STICK_RADIUS;
const on = (x, y) => ({ ...stickVector(x, y, R), active: true });
const N = -Math.PI / 2; // bilen pekar uppåt (norr) på skärmen
// En stad som bara är asfalt: testa styrningen, inte husen
const OPEN = { ...generateCity(1337) };
OPEN.tiles = new Uint8Array(OPEN.tiles.length);
const MID = { x: MAP_W * TILE / 2, y: MAP_H * TILE / 2 };

describe('stickVector', () => {
    it('ger noll inne i dödzonen', () => {
        expect(stickVector(0, 0, R)).toEqual({ x: 0, y: 0, mag: 0 });
        expect(stickVector(R * STICK_DEAD * 0.9, 0, R).mag).toBe(0);
        expect(stickVector(0, -R * STICK_DEAD, R).mag).toBe(0);
    });

    it('börjar mjukt precis utanför dödzonen (inget hopp)', () => {
        const v = stickVector(R * STICK_DEAD + 0.5, 0, R);
        expect(v.mag).toBeGreaterThan(0);
        expect(v.mag).toBeLessThan(0.02);
    });

    it('är 1 vid kanten och stannar på 1 utanför', () => {
        expect(stickVector(R, 0, R).mag).toBeCloseTo(1);
        expect(stickVector(0, R * 3, R)).toEqual({ x: 0, y: 1, mag: 1 });
    });

    it('växer linjärt mellan dödzonen och kanten', () => {
        const mid = (STICK_DEAD + 1) / 2;
        expect(stickVector(R * mid, 0, R).mag).toBeCloseTo(0.5);
    });

    it('behåller riktningen och längden = styrkan', () => {
        const v = stickVector(30, -40, 100);
        expect(Math.hypot(v.x, v.y)).toBeCloseTo(v.mag);
        expect(Math.atan2(v.y, v.x)).toBeCloseTo(Math.atan2(-40, 30));
    });

    it('tål trasiga värden', () => {
        expect(stickVector(10, 10, 0).mag).toBe(0);
        expect(stickVector(NaN, 5, R).mag).toBe(0);
    });
});

describe('stickKnob', () => {
    it('följer fingret inne i ringen', () => {
        expect(stickKnob(10, -20, R)).toEqual({ x: 10, y: -20 });
    });
    it('stannar på ringen när fingret drar längre', () => {
        const k = stickKnob(R * 2, 0, R);
        expect(k.x).toBeCloseTo(R);
        expect(k.y).toBeCloseTo(0);
        const d = stickKnob(-300, 400, R);
        expect(Math.hypot(d.x, d.y)).toBeCloseTo(R);
    });
});

describe('stickOrigin (basen nära skärmkanten)', () => {
    // Zonen nere till vänster på en 390×844-telefon: 45 % × 60 %, skärmen i zonens koordinater
    const W = 390, H = 844, ZW = W * 0.45, ZH = H * 0.6;
    const screen = { x: 0, y: -(H - ZH), w: W, h: H };
    const ring = 66; // ringens radie + marginal

    it('lägger basen där tummen landar mitt i zonen', () => {
        expect(stickOrigin({ x: 90, y: ZH - 100 }, screen, ring)).toEqual({ x: 90, y: ZH - 100 });
    });

    it('flyttar in basen från vänster- och nederkanten så hela ringen syns', () => {
        const o = stickOrigin({ x: 10, y: ZH - 12 }, screen, ring);
        expect(o).toEqual({ x: ring, y: ZH - ring });
    });

    it('flyttar inte basen mot zonens inre kanter (fingret kan dras förbi dem)', () => {
        expect(stickOrigin({ x: ZW - 5, y: 8 }, screen, ring)).toEqual({ x: ZW - 5, y: 8 });
    });

    it('fingret når fullt utslag (spring) mot kanten även om tummen landar ytterst', () => {
        const R = 56; // stickR i 390-bred layout
        // tumme 10 px från vänsterkanten, dra ut till kanten
        const o1 = stickOrigin({ x: 10, y: ZH - 200 }, screen, ring);
        expect(stickVector(0 - o1.x, 0, R).mag).toBeGreaterThan(STICK_RUN);
        // tumme 12 px från nederkanten, dra ner till kanten
        const o2 = stickOrigin({ x: 100, y: ZH - 12 }, screen, ring);
        expect(stickVector(0, ZH - o2.y, R).mag).toBeGreaterThan(STICK_RUN);
        // utan klamp (som förut) blev det nästan inget utslag
        expect(stickVector(0, 12, R).mag).toBeLessThan(0.1);
    });

    it('knoppen visar direkt ett utslag mot fingret när basen flyttats', () => {
        const p = { x: 6, y: ZH - 6 };
        const o = stickOrigin(p, screen, ring);
        const k = stickKnob(p.x - o.x, p.y - o.y, 56);
        expect(k.x).toBeLessThan(0);
        expect(k.y).toBeGreaterThan(0);
    });

    it('centrerar om skärmen är mindre än ringen', () => {
        expect(stickOrigin({ x: 3, y: 3 }, { x: 0, y: 0, w: 100, h: 400 }, 66).x).toBe(50);
    });
});

describe('stickWalk (till fots)', () => {
    it('står still utan joystick', () => {
        expect(stickWalk({ x: 0, y: 0, mag: 0, active: false })).toEqual({ mx: 0, my: 0, run: false });
        expect(stickWalk(on(2, 2))).toEqual({ mx: 0, my: 0, run: false }); // dödzonen
    });
    it('går åt det håll man drar (upp = norr = -y)', () => {
        const w = stickWalk(on(0, -30));
        expect(w.mx).toBeCloseTo(0);
        expect(w.my).toBeCloseTo(-1);
        expect(w.run).toBe(false);
    });
    it('riktningen är normerad även vid litet utslag', () => {
        const w = stickWalk(on(12, 0));
        expect(Math.hypot(w.mx, w.my)).toBeCloseTo(1);
    });
    it('springer vid nästan fullt utslag', () => {
        expect(stickWalk(on(R, 0)).run).toBe(true);
        expect(stickWalk(on(R * 0.7, 0)).run).toBe(false);
        const edge = R * (STICK_DEAD + STICK_RUN * (1 - STICK_DEAD));
        expect(stickWalk(on(edge + 1, 0)).run).toBe(true);
        expect(stickWalk(on(edge - 1, 0)).run).toBe(false);
    });
});

describe('stickDrive (i bilen)', () => {
    it('gör inget utan joystick', () => {
        expect(stickDrive({ x: 0, y: 0, mag: 0, active: false }, 0, 0)).toEqual({ throttle: 0, steer: 0 });
        expect(stickDrive(on(0, -R), N, 0)).not.toEqual({ throttle: 0, steer: 0 });
    });

    it('drar man åt bilens håll gasar den rakt fram', () => {
        const c = stickDrive(on(0, -R), N, 0);
        expect(c.throttle).toBeCloseTo(1);
        expect(Math.abs(c.steer)).toBeLessThan(0.01);
        // åt öster med bilen mot öster
        const e = stickDrive(on(R, 0), 0, 200);
        expect(e.throttle).toBeGreaterThan(0.95);
        expect(Math.abs(e.steer)).toBeLessThan(0.01);
    });

    it('gasar efter hur långt man drar', () => {
        const half = stickDrive(on(0, -R * 0.6), N, 0);
        const full = stickDrive(on(0, -R), N, 0);
        expect(half.throttle).toBeGreaterThan(0);
        expect(half.throttle).toBeLessThan(full.throttle);
    });

    it('drar man 90° åt höger svänger den höger (och vänster åt vänster)', () => {
        const r = stickDrive(on(R, 0), N, 150);   // bilen mot norr, drag mot öster
        expect(r.steer).toBeGreaterThan(0.9);
        expect(r.throttle).toBeGreaterThan(0);
        const l = stickDrive(on(-R, 0), N, 150);
        expect(l.steer).toBeLessThan(-0.9);
    });

    it('små fel ger liten ratt (ingen pendling)', () => {
        const a = 0.1;
        const c = stickDrive(on(Math.cos(N + a) * R, Math.sin(N + a) * R), N, 200);
        expect(c.steer).toBeGreaterThan(0);
        expect(c.steer).toBeLessThan(0.4);
    });

    it('drar man rakt bakåt i låg fart backar den', () => {
        const c = stickDrive(on(0, R), N, 0);     // bilen mot norr, drag söderut
        expect(c.throttle).toBeLessThan(-0.9);
        expect(Math.abs(c.steer)).toBeLessThan(0.01);
        const slow = stickDrive(on(0, R), N, 30);
        expect(slow.throttle).toBeLessThan(0);
    });

    it('drar man bakåt i full fart bromsar den och vänder', () => {
        const c = stickDrive(on(0.3 * R, R), N, 300);
        expect(c.throttle).toBeLessThan(0);
        expect(Math.abs(c.steer)).toBeGreaterThan(0.5);
    });

    it('gasen ändras mjukt kring 90° i fart (inget hopp)', () => {
        const at = a => stickDrive(on(Math.cos(N + a) * R, Math.sin(N + a) * R), N, 300).throttle;
        expect(Math.abs(at(Math.PI / 2 - 0.01) - at(Math.PI / 2 + 0.01))).toBeLessThan(0.05);
        expect(at(Math.PI * 0.68)).toBeLessThan(0); // långt fel i full fart = bromsa
    });

    it('halvt utslag håller nere farten, fullt släpper på (nitro funkar)', () => {
        const half = on(0, -R * 0.55);
        expect(stickDrive(half, N, 80, 350).throttle).toBeGreaterThan(0);
        expect(stickDrive(half, N, 250, 350).throttle).toBeLessThanOrEqual(0);
        expect(stickDrive(on(0, -R), N, 400, 350).throttle).toBeGreaterThan(0.9);
    });

    it('fortsätter backa och styr bakänden mot draget', () => {
        // Backar redan (fart < 0), drar snett bakåt höger (sydost) med nosen mot norr:
        // bakänden ska vridas mot öster → nosen mot väster → vinkeln minskar
        const c = stickDrive(on(R * 0.7, R * 0.7), N, -80);
        expect(c.throttle).toBeLessThan(0);
        const v = createVehicle('volvo', MID.x, MID.y, N);
        v.vx = 0; v.vy = 80; // rullar bakåt (söderut)
        const before = v.angle;
        stepVehicle(v, c, 1 / 60, OPEN);
        expect(v.angle).toBeLessThan(before);
    });

    // Mot en vägg studsar en bil som gasar fram till ~−0,4 px/s. Det är inte att backa:
    // ratten ska inte vändas förrän bilen verkligen rullar bakåt (C:s förslag i NOTES).
    it('studs mot väggen (fart −0,4) vänder inte ratten; riktig backning (−40) gör det', () => {
        expect(stickDrive(on(R, 0), N, -0.4).steer).toBeGreaterThan(0.9);     // höger = höger
        expect(stickDrive(on(-R, 0), N, -0.4).steer).toBeLessThan(-0.9);
        expect(stickDrive(on(R * 0.7, R * 0.7), N, -40).steer).toBeGreaterThan(0.9); // backar på riktigt: vänd ratt, bakänden mot draget
    });

    it('blocked: backar och vrider nosen mot draget (trepunktsvändning)', () => {
        const c = stickDrive(on(R, 0), N, 0, 350, true);   // nosen norr, drag österut
        expect(c.throttle).toBeLessThan(-0.5);
        // Även litet utslag backar ordentligt
        expect(stickDrive(on(R * 0.3, 0), N, 0, 350, true).throttle).toBeLessThanOrEqual(-0.6);
        // I fysiken: backar (fart < 0) och nosen vrids mot öster (vinkeln ökar från -π/2)
        const v = createVehicle('volvo', MID.x, MID.y, N);
        for (let i = 0; i < 40; i++) {
            const fwd = v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
            stepVehicle(v, stickDrive(on(R, 0), v.angle, fwd, 350, true), 1 / 60, OPEN);
        }
        expect(v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle)).toBeLessThan(0);
        expect(v.angle).toBeGreaterThan(N + 0.1);
    });
});

// Riktiga stan: bilen står med nosen mot ett hus och man drar längs gatan
describe('stickCar (bilen fastnar mot en vägg)', () => {
    const CITY = generateCity(1337);
    // En ruta där nosen söderut går rakt in i ett hus, med körbart åt öster och väster
    const spot = (() => {
        for (let ty = 2; ty < MAP_H - 2; ty++) for (let tx = 2; tx < MAP_W - 3; tx++) {
            if (!isSolidTile(CITY, tx, ty + 1) || !isSolidTile(CITY, tx + 1, ty + 1)) continue;
            if ([-1, 0, 1, 2].some(d => isSolidTile(CITY, tx + d, ty) || isSolidTile(CITY, tx + d, ty - 1))) continue;
            return { x: (tx + 0.5) * TILE, y: (ty + 1) * TILE };
        }
        return null;
    })();
    const S = Math.PI / 2;
    const fwdOf = v => v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
    // Kör in nosen i väggen och dra sedan åt sidan; mem = null kör utan stickCar (som förut)
    const pinned = () => {
        const v = createVehicle('volvo', spot.x, spot.y - 40, S);
        const into = on(0, R);
        for (let i = 0; i < 60; i++) stepVehicle(v, stickDrive(into, v.angle, fwdOf(v), v.spec.maxSpeed), 1 / 60, CITY);
        v.vx = v.vy = 0;
        return v;
    };
    const run = (v, stick, secs, mem) => {
        const start = { x: v.x, y: v.y };
        let maxBack = 0;
        for (let i = 0; i < secs * 60; i++) {
            const ctl = mem ? stickCar(mem, stick, v, 1 / 60) : stickDrive(stick, v.angle, fwdOf(v), v.spec.maxSpeed);
            stepVehicle(v, ctl, 1 / 60, CITY);
            maxBack = Math.min(maxBack, fwdOf(v));
        }
        return { moved: Math.hypot(v.x - start.x, v.y - start.y), dx: v.x - start.x, maxBack };
    };

    it('hittar en vägg att testa mot', () => { expect(spot).not.toBeNull(); });

    // Förut stod bilen still här (rattutslaget vändes när väggen studsade den till −0,4 px/s,
    // så den vred sig åt fel håll). Med tröskeln vrider den sig loss längs väggen direkt.
    it('även utan stickCar vrider sig bilen loss åt det håll man drar (ingen låsning mot väggen)', () => {
        const v = pinned();
        const r = run(v, on(R, 0), 2, null);
        expect(r.dx).toBeGreaterThan(40);
        expect(Math.cos(v.angle)).toBeGreaterThan(0.5);
        const w = pinned();
        expect(run(w, on(-R, 0), 2, null).dx).toBeLessThan(-40);
    });

    it('drag 90° österut: kommer loss och kör österut inom 2 s', () => {
        const v = pinned();
        const r = run(v, on(R, 0), 2, {});
        expect(r.dx).toBeGreaterThan(40);
        expect(Math.cos(v.angle)).toBeGreaterThan(0.5);   // nosen ungefär österut
        expect(fwdOf(v)).toBeGreaterThan(30);              // och kör framåt igen
    });

    it('drag 90° västerut och snett bakåt (120°) kommer också loss', () => {
        expect(run(pinned(), on(-R, 0), 2, {}).dx).toBeLessThan(-40);
        const a = S - Math.PI * 2 / 3; // 120° från nosen, åt öster/norr
        const v = pinned();
        expect(run(v, on(Math.cos(a) * R, Math.sin(a) * R), 2.5, {}).moved).toBeGreaterThan(60);
        expect(fwdOf(v)).toBeGreaterThan(50);
    });

    it('snett in i väggen (30°): backar en gång och glider sedan åt det hållet', () => {
        const v = pinned(), mem = {}, a = S - Math.PI / 6;
        const stick = on(Math.cos(a) * R, Math.sin(a) * R);
        const x0 = v.x;
        let starts = 0, was = false;
        for (let i = 0; i < 150; i++) {
            stepVehicle(v, stickCar(mem, stick, v, 1 / 60), 1 / 60, CITY);
            if (mem.backT > 0 && !was) starts++;
            was = mem.backT > 0;
        }
        expect(v.x - x0).toBeGreaterThan(15);
        expect(starts).toBeLessThanOrEqual(2);
    });

    it('halvt utslag åt sidan räcker', () => {
        expect(run(pinned(), on(R * 0.45, 0), 3, {}).dx).toBeGreaterThan(40);
    });

    it('drar man rakt in i väggen står den kvar (ingen pendling fram och tillbaka)', () => {
        const r = run(pinned(), on(0, R), 2, {});
        expect(r.maxBack).toBeGreaterThan(-5);
    });

    it('backar aldrig av sig själv på öppen gata', () => {
        // [drag x, drag y, utslag, fart från början (negativ = rullar bakåt)]
        const cases = [[R, 0, 1, 0], [R, 0, 0.3, 0], [-R * 0.7, -R * 0.7, 1, 0], [0, -R, 0.25, 0], [R, 0, 0.3, -40], [R, 0, 0.5, -15]];
        for (const kind of ['van', 'volvo', 'lambo']) for (const [sx, sy, m, v0] of cases) {
            const v = createVehicle(kind, MID.x, MID.y, N);
            v.vx = Math.cos(N) * v0; v.vy = Math.sin(N) * v0;
            const mem = {};
            const stick = on(sx * m, sy * m);
            let backed = false;
            for (let i = 0; i < 180; i++) {
                stepVehicle(v, stickCar(mem, stick, v, 1 / 60), 1 / 60, OPEN);
                backed ||= mem.backT > 0;
            }
            expect(backed, `${kind} ${sx},${sy} ×${m} från ${v0}`).toBe(false);
        }
    });

    it('glömmer läget när man byter bil', () => {
        const mem = { car: {}, backT: 0.5, x: 0, y: 0 };
        const v = createVehicle('volvo', MID.x, MID.y, N);
        expect(stickCar(mem, on(0, -R), v, 1 / 60).throttle).toBeGreaterThan(0);
        expect(mem.car).toBe(v);
    });
});

// Kör bilen på riktigt i fysiken och se att den hamnar dit man drar
describe('stickDrive + stepVehicle', () => {
    const drive = (stickAt, angle, secs, start = 0, cap = 0) => {
        const v = createVehicle('volvo', MID.x, MID.y, angle);
        v.vx = Math.cos(angle) * start; v.vy = Math.sin(angle) * start;
        const stick = on(stickAt.x, stickAt.y);
        let maxBack = 0;
        for (let i = 0; i < secs * 60; i++) {
            const fwd = v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);
            stepVehicle(v, stickDrive(stick, v.angle, fwd, cap ? v.spec.maxSpeed : 0), 1 / 60, OPEN);
            maxBack = Math.min(maxBack, fwd);
        }
        return { v, maxBack, fwd: v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle) };
    };
    const angDist = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

    it('svänger in mot draget och kör dit', () => {
        const { v, fwd } = drive({ x: R, y: 0 }, N, 2.5, 150); // nosen norr, drag österut
        expect(angDist(v.angle, 0)).toBeLessThan(0.25);
        expect(fwd).toBeGreaterThan(50);
    });

    it('vänder helt om man drar bakåt i fart', () => {
        // nosen norr i full fart, drag söderut (lite åt öster): bromsar in i en U-sväng
        const { v, fwd } = drive({ x: 0.2 * R, y: R }, N, 4, 300);
        expect(angDist(v.angle, Math.atan2(R, 0.2 * R))).toBeLessThan(0.15);
        expect(fwd).toBeGreaterThan(200);
    });

    it('halvt utslag kör ungefär halva toppfarten', () => {
        const { v, fwd } = drive({ x: 0, y: -R * 0.6 }, N, 6, 0, true);
        const mag = stickVector(0, -R * 0.6, R).mag;
        expect(fwd).toBeGreaterThan(v.spec.maxSpeed * mag * 0.7);
        expect(fwd).toBeLessThan(v.spec.maxSpeed * mag + 45);
    });

    it('backar från stillastående när man drar rakt bakåt', () => {
        const { maxBack } = drive({ x: 0, y: R }, N, 1, 0);
        expect(maxBack).toBeLessThan(-30);
    });
});

describe('touchText (tips på mobilen)', () => {
    it('byter tangenter mot knapparna', () => {
        expect(touchText('SPACE — SLÅ!', '👊')).toBe('👊 — SLÅ!');
        expect(touchText('R — Råna · SPACE — Slå', '👊')).toBe('💰 — Råna · 👊 — Slå');
        expect(touchText('ESC — Åk hem till imperiet', '👊')).toBe('🏠 HEM — Åk hem till imperiet');
        expect(touchText('🦹 En rånare är ute efter dig! Slå tillbaka (SPACE) eller spring!', '🔪')).toContain('(🔪)');
        expect(touchText('🔫 Du köpte Pistol! SPACE skjuter, Q byter vapen.', '🔫')).toBe('🔫 Du köpte Pistol! 🔫 skjuter, 🔫 byter vapen.');
        expect(touchText('E — Kör Volvo', '⤵')).toBe('E — Kör Volvo');
        expect(touchText('💰 Gå fram till någon för att råna dem (R).', '👊')).toBe('💰 Gå fram till någon för att råna dem (💰).');
    });

    it('inga tangentbokstäver kvar i meddelandena på mobilen', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(new URL('../src/city/world.js', import.meta.url), 'utf8');
        const msgs = [...src.matchAll(/this\.message\((['`])(.*?)\1/g)].map(m => m[2]);
        expect(msgs.length).toBeGreaterThan(10);
        for (const t of msgs) expect(touchText(t, '👊')).not.toMatch(/\((SPACE|[A-DF-Z])\)/);
    });
});

describe('personsökarens plats på touch', () => {
    const lh = 20;
    const box = (W, H, lines, indoor = false) => {
        const narrow = W < 560;
        const size = Math.round(Math.min(124, W * 0.32));
        const mapX = W - size - 12;
        const ph = lines * (narrow ? 18 : lh) + 18;
        const { x, w } = pagerX(W, { touch: true, narrow, mapX });
        return { x, w, y: pagerY(H, ph, { touch: true, narrow, indoor }), ph, mapX };
    };

    it('liggande: aldrig under knappraden uppe, timern får plats ovanför', () => {
        for (const [W, H] of [[844, 390], [667, 375], [740, 360]]) {
            for (const lines of [1, 4, 6]) {
                const b = box(W, H, lines);
                expect(b.y).toBeGreaterThanOrEqual(PAGER_TOP);
                expect(b.y - 14 - 10).toBeGreaterThan(42); // timerns överkant under knapparna (8–42)
            }
        }
    });

    it('liggande: mellan HUD-kolumnerna (inte över hälsan eller minikartan)', () => {
        for (const [W, H] of [[844, 390], [667, 375]]) {
            const b = box(W, H, 4);
            expect(b.x).toBeGreaterThanOrEqual(176);
            expect(b.x + b.w).toBeLessThanOrEqual(b.mapX - 14);
        }
        expect(box(844, 390, 2).w).toBe(440);
    });

    it('stående: som förut ovanför knapparna', () => {
        const b = box(390, 844, 3);
        expect(b.y + b.ph).toBe(844 - 236);
        expect(b.x).toBe((390 - b.w) / 2);
    });

    it('stående inomhus: under rummet men ovanför knapparna', () => {
        const b = box(390, 844, 3, true);
        expect(b.y).toBeGreaterThanOrEqual(844 - 260); // rummet slutar 260 px ovanför botten
        expect(b.y + b.ph).toBeLessThanOrEqual(844 - 150);
    });

    it('datorn påverkas inte', () => {
        expect(pagerY(800, 60)).toBe(800 - 60 - 22);
        expect(pagerX(1280, { mmR: 220 })).toEqual({ x: 420, w: 440 });
    });
});
