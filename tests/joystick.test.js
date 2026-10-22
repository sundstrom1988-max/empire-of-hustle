import { describe, it, expect } from 'vitest';
import { stickVector, stickKnob, stickWalk, stickDrive, STICK_RADIUS, STICK_DEAD, STICK_RUN } from '../src/city/input.js';
import { stepVehicle } from '../src/city/physics.js';
import { createVehicle } from '../src/city/vehicles.js';
import { generateCity } from '../src/city/map.js';
import { TILE, MAP_W, MAP_H } from '../src/city/constants.js';

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
    it('byter tangenter mot knapparna', async () => {
        const { touchText } = await import('../src/city/hud.js');
        expect(touchText('SPACE — SLÅ!', '👊')).toBe('👊 — SLÅ!');
        expect(touchText('R — Råna · SPACE — Slå', '👊')).toBe('💰 — Råna · 👊 — Slå');
        expect(touchText('ESC — Åk hem till imperiet', '👊')).toBe('🏠 HEM — Åk hem till imperiet');
        expect(touchText('🦹 En rånare är ute efter dig! Slå tillbaka (SPACE) eller spring!', '🔪')).toContain('(🔪)');
        expect(touchText('🔫 Du köpte Pistol! SPACE skjuter, Q byter vapen.', '🔫')).toBe('🔫 Du köpte Pistol! 🔫 skjuter, 🔫 byter vapen.');
        expect(touchText('E — Kör Volvo', '⤵')).toBe('E — Kör Volvo');
    });
});
