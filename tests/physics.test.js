import { describe, it, expect } from 'vitest';
import { generateCity, isSolidAt } from '../src/city/map.js';
import { createVehicle, fenceValue } from '../src/city/vehicles.js';
import { stepVehicle, collideVehicles, stepWalker, distToVehicle } from '../src/city/physics.js';
import { TILE } from '../src/city/constants.js';

const city = generateCity(1337);
const DT = 1 / 60;
const GAS = { throttle: 1, steer: 0, handbrake: false, nitro: false };

function roadStart() {
    // Ringvägen längst upp: rad 3 kör österut (högertrafik)
    return { x: 6 * TILE + 32, y: 3 * TILE + 32, angle: 0 };
}

describe('stepVehicle', () => {
    it('accelerates but never exceeds max speed', () => {
        const s = roadStart();
        const v = createVehicle('lambo', s.x, s.y, s.angle);
        let peak = 0;
        for (let i = 0; i < 60 * 3; i++) {
            stepVehicle(v, GAS, DT, city);
            peak = Math.max(peak, Math.hypot(v.vx, v.vy));
        }
        expect(peak).toBeGreaterThan(300);
        expect(peak).toBeLessThanOrEqual(v.spec.maxSpeed + 1);
    });

    it('never produces NaN even with extreme input', () => {
        const s = roadStart();
        const v = createVehicle('volvo', s.x, s.y, s.angle);
        for (let i = 0; i < 600; i++) {
            stepVehicle(v, { throttle: i % 50 < 25 ? 1 : -1, steer: Math.sin(i), handbrake: i % 7 === 0, nitro: i % 3 === 0 }, DT, city);
        }
        for (const k of ['x', 'y', 'vx', 'vy', 'angle']) expect(Number.isFinite(v[k])).toBe(true);
    });

    it('cannot drive through buildings', () => {
        const b = city.buildings.find(bb => bb.w >= 2 && bb.h >= 2);
        // Ställ bilen till vänster om huset och kör rakt in
        const v = createVehicle('rolls', b.x * TILE - 40, (b.y + 1) * TILE, 0);
        v.vx = 500;
        let hit = 0;
        for (let i = 0; i < 120; i++) {
            const r = stepVehicle(v, GAS, DT, city);
            hit = Math.max(hit, r.impact);
            expect(isSolidAt(city, v.x, v.y)).toBe(false);
        }
        expect(hit).toBeGreaterThan(100);
    });

    it('slides sideways with the handbrake', () => {
        const s = roadStart();
        const v = createVehicle('bmw', s.x, s.y, s.angle);
        v.vx = 380;
        let skid = false;
        for (let i = 0; i < 30; i++) {
            const r = stepVehicle(v, { throttle: 0.5, steer: 1, handbrake: true, nitro: false }, DT, city);
            skid = skid || r.skid;
        }
        expect(skid).toBe(true);
    });

    it('a wrecked car ignores the throttle', () => {
        const s = roadStart();
        const v = createVehicle('volvo', s.x, s.y, s.angle);
        v.wrecked = true;
        for (let i = 0; i < 60; i++) stepVehicle(v, GAS, DT, city);
        expect(Math.hypot(v.vx, v.vy)).toBeLessThan(1);
    });
});

describe('collideVehicles', () => {
    it('pushes overlapping cars apart and reports the impact', () => {
        const a = createVehicle('volvo', 1000, 1000, 0);
        const b = createVehicle('volvo', 1030, 1000, Math.PI);
        a.vx = 200; b.vx = -200;
        const impact = collideVehicles(a, b);
        expect(impact).toBeGreaterThan(300);
        expect(b.x - a.x).toBeGreaterThan(30);
        expect(a.vx).toBeLessThan(200);
    });
    it('ignores cars far apart', () => {
        const a = createVehicle('volvo', 0, 0, 0);
        const b = createVehicle('volvo', 500, 0, 0);
        expect(collideVehicles(a, b)).toBe(0);
    });
});

describe('walking', () => {
    it('moves a pedestrian and keeps them out of walls', () => {
        const s = roadStart();
        const p = { x: s.x, y: s.y, vx: 0, vy: 0, r: 7, angle: 0 };
        stepWalker(p, 1, 0, 120, 0.5, city);
        expect(p.x).toBeGreaterThan(s.x + 50);
        const w = { x: 40, y: 3 * TILE + 32, vx: 0, vy: 0, r: 7, angle: 0 };
        for (let i = 0; i < 60; i++) stepWalker(w, -1, 0, 200, DT, city);
        expect(isSolidAt(city, w.x, w.y)).toBe(false);
    });
    it('measures distance from a point to a car body', () => {
        const v = createVehicle('volvo', 100, 100, 0);
        expect(distToVehicle(v, 100, 100)).toBeLessThan(1);
        expect(distToVehicle(v, 100, 140)).toBeGreaterThan(20);
    });
});

describe('fenceValue', () => {
    it('pays more for a fancy car in good shape', () => {
        const lambo = createVehicle('lambo', 0, 0, 0);
        const volvo = createVehicle('volvo', 0, 0, 0);
        expect(fenceValue(lambo)).toBeGreaterThan(fenceValue(volvo));
        const wreck = createVehicle('lambo', 0, 0, 0);
        wreck.hp = 0;
        expect(fenceValue(wreck)).toBeLessThan(fenceValue(lambo));
    });
});
