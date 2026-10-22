import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
    toScene, fromScene, yawOf, angleDiff, floorsOf, buildingHeight, facadeStyle, hasGable,
    chaseCamera, fpsCamera, cameraSubject, dayPalette, figurePose, rootMatrix, jointMatrix, applyMatrix,
    Pool, parseColor, furnitureHeight, EYE_H, FLOOR_H, GROUND_FLOOR_H, MAX_FLOORS, ROOM_H, CHASE, FPS
} from '../src/city/render3d/math.js';
import { generateCity } from '../src/city/map.js';

const SRC = join(__dirname, '..', 'src', 'city');

// En liten värld som räcker för kamerorna
function fakeWorld(over = {}) {
    return {
        player: { x: 1000, y: 800, vx: 0, vy: 0, angle: 0, walkPhase: 0, vehicle: null, dead: false, ...over }
    };
}

describe('render3d module loading', () => {
    it('imports without three and without WebGL (node)', async () => {
        const m = await import('../src/city/render3d.js');
        expect(typeof m.createRenderer3D).toBe('function');
        const r = await m.createRenderer3D(null);
        expect(r.available).toBe(false);
        expect(() => r.render({}, 0.016, 'chase')).not.toThrow();
        expect(r.worldToScreen(1, 2, 3).visible).toBe(false);
        expect(() => { r.resize(); r.setVisible(false); r.dispose(); }).not.toThrow();
        expect(m.webglSupported()).toBe(false);
    });

    it('never imports three statically — only the dynamic import in render3d.js', () => {
        const files = [join(SRC, 'render3d.js'), ...readdirSync(join(SRC, 'render3d')).map(f => join(SRC, 'render3d', f))];
        expect(files.length).toBeGreaterThan(5);
        for (const f of files) {
            const src = readFileSync(f, 'utf8');
            expect(src, f).not.toMatch(/^\s*import\s[^;]*['"]three['"]/m);
            expect(src, f).not.toMatch(/^\s*import\s+['"]three['"]/m);
            expect(src, f).not.toMatch(/require\(['"]three['"]\)/);
        }
        expect(readFileSync(join(SRC, 'render3d.js'), 'utf8')).toMatch(/import\('three'\)/);
    });
});

describe('coordinates', () => {
    it('maps 2D world (x, y, height) to three (x, up, z) and back', () => {
        const s = toScene(120, 340, 25);
        expect(s).toEqual({ x: 120, y: 25, z: 340 });
        expect(fromScene(s.x, s.y, s.z)).toEqual({ x: 120, y: 340, z: 25 });
    });

    it('yaw turns a +x-facing model to the 2D angle (0 = +x, π/2 = +y down)', () => {
        for (const a of [0, Math.PI / 2, -Math.PI / 2, 2.3, Math.PI]) {
            const t = yawOf(a);
            // rotation runt three:s y: (1, 0, 0) → (cos t, 0, −sin t)
            const x = Math.cos(t), z = -Math.sin(t);
            expect(x).toBeCloseTo(Math.cos(a), 6);
            expect(z).toBeCloseTo(Math.sin(a), 6);
        }
    });

    it('angleDiff takes the short way round', () => {
        expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6, 6);
        expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    });
});

describe('buildings', () => {
    it('uses the same floor count as the 2D renderer, capped at the facade rows', () => {
        for (const h of [0, 0.06, 0.1, 0.16, 0.2, 0.3, 0.42, 0.6]) {
            const want = Math.min(MAX_FLOORS, Math.max(2, Math.round(h * 16)));
            expect(floorsOf({ height: h })).toBe(want);
        }
    });

    it('gives a taller ground floor and ~40 px floors above', () => {
        expect(buildingHeight({ height: 0.1 })).toBe(GROUND_FLOOR_H + FLOOR_H);
        expect(FLOOR_H).toBeGreaterThanOrEqual(38);
        expect(FLOOR_H).toBeLessThanOrEqual(46);
        expect(GROUND_FLOOR_H).toBeGreaterThan(FLOOR_H);
        let prev = 0;
        for (let h = 0.06; h < 0.5; h += 0.03) { const H = buildingHeight({ height: h }); expect(H).toBeGreaterThanOrEqual(prev); prev = H; }
    });

    it('picks facade styles and gable roofs by district for every building in the real city', () => {
        const city = generateCity(1337);
        const styles = new Set(city.buildings.map(facadeStyle));
        expect(styles).toEqual(new Set(['res', 'office', 'ind']));
        expect(facadeStyle(city.buildings.find(b => b.hq))).toBe('office');
        expect(hasGable(city.buildings.find(b => b.hq))).toBe(false);
        expect(city.buildings.some(hasGable)).toBe(true);
    });
});

describe('chase camera', () => {
    it('sits behind and above the player on foot, looking ahead', () => {
        const w = fakeWorld({ angle: 0 });
        const st = {}, out = chaseCamera(st, cameraSubject(w), 0.016, {}, false, null, {});
        expect(out.x).toBeLessThan(1000);                      // bakom (mot −x)
        expect(out.y).toBeCloseTo(800, 3);
        expect(out.z).toBeGreaterThan(EYE_H);
        expect(1000 - out.x).toBeCloseTo(CHASE.foot.back, 0);
        expect(out.lx).toBeGreaterThan(1000);                  // tittar framför
    });

    it('uses ~320 back / ~220 up behind a car and follows its heading smoothly', () => {
        const car = { x: 500, y: 500, vx: 0, vy: 0, angle: Math.PI / 2, spec: { l: 44, w: 22, maxSpeed: 400, kind: 'car' } };
        const w = fakeWorld({ vehicle: car });
        const st = {};
        let out = chaseCamera(st, cameraSubject(w), 0.016, {}, false, null, {});
        expect(out.y).toBeCloseTo(500 - 320, 0);               // bilen pekar nedåt (+y): kameran ovanför i 2D
        expect(out.z).toBeCloseTo(220, 0);
        car.angle = 0;                                          // tvär sväng
        out = chaseCamera(st, cameraSubject(w), 0.05, {}, false, null, {});
        expect(st.yaw).toBeGreaterThan(0.1);                    // har inte hunnit vända helt
        expect(st.yaw).toBeLessThan(Math.PI / 2);
        for (let i = 0; i < 200; i++) out = chaseCamera(st, cameraSubject(w), 0.05, {}, false, null, {});
        expect(st.yaw).toBeCloseTo(0, 3);
        expect(out.x).toBeCloseTo(500 - 320, 0);
    });

    it('obeys opts.yaw directly and zooms with opts.dist', () => {
        const w = fakeWorld({ angle: 0 });
        const out = chaseCamera({}, cameraSubject(w), 0.016, { yaw: Math.PI, dist: 0.5 }, false, null, {});
        expect(out.x).toBeCloseTo(1000 + CHASE.foot.back * 0.5, 0);
    });

    it('pulls in closer when a building is in the way', () => {
        const w = fakeWorld({ angle: 0 });
        const blocked = (x) => x < 900;                         // en vägg 100 px bakom
        const st = {};
        const out = chaseCamera(st, cameraSubject(w), 0, {}, false, blocked, {});
        expect(out.x).toBeGreaterThanOrEqual(900 - 20);
        const free = chaseCamera({}, cameraSubject(w), 0, {}, false, null, {});
        expect(Math.hypot(out.x - 1000, out.z)).toBeLessThan(Math.hypot(free.x - 1000, free.z));
    });

    it('swings round a wall, and in a tight spot stops just in front of it', () => {
        const w = fakeWorld({ angle: 0 });
        const wallBehind = (x) => x < 900;
        const out = chaseCamera({}, cameraSubject(w), 0, {}, false, wallBehind, {});
        expect(out.x).toBeGreaterThanOrEqual(900);              // inte inne i huset
        const tight = (x, y) => Math.hypot(x - 1000, y - 800) > 60;
        const t = chaseCamera({}, cameraSubject(w), 0, {}, false, tight, {});
        expect(Math.hypot(t.x - 1000, t.y - 800)).toBeLessThan(60);
    });

    it('rises over a low building instead of diving into the player', () => {
        const w = fakeWorld({ angle: 0 });
        const low = (x, y, h) => x < 900 && x > 840 && h < 110;  // tvåvåningshus bakom
        const out = chaseCamera({}, cameraSubject(w), 0, {}, false, low, {});
        const free = chaseCamera({}, cameraSubject(w), 0, {}, false, null, {});
        expect(out.z).toBeGreaterThan(free.z);
        expect(out.x).toBeCloseTo(free.x, 0);
    });

    it('stays under the ceiling indoors', () => {
        const w = fakeWorld({ angle: 1 });
        const out = chaseCamera({}, cameraSubject(w), 0.016, {}, true, null, {});
        expect(out.z).toBeLessThan(ROOM_H);
    });
});

describe('first-person camera', () => {
    it('puts the eye at eye height and looks along player.angle', () => {
        const out = fpsCamera(fakeWorld({ angle: Math.PI / 2 }), {}, {});
        expect(out.z).toBeCloseTo(EYE_H, 6);
        expect(out.x).toBe(1000); expect(out.y).toBe(800);
        expect(out.ly).toBeGreaterThan(out.y);                 // π/2 = nedåt i 2D
        expect(out.lx).toBeCloseTo(1000, 3);
        expect(out.fov).toBe(FPS.fov);
    });

    it('takes yaw/pitch from opts', () => {
        const out = fpsCamera(fakeWorld({ angle: 0 }), { yaw: Math.PI, pitch: 0.3 }, {});
        expect(out.lx).toBeLessThan(out.x);
        expect(out.lz).toBeGreaterThan(out.z);
    });

    it('sits in the driver seat (left of centre, right-hand traffic) in a car', () => {
        const car = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spec: { l: 44, w: 22, kind: 'car' } };
        const out = fpsCamera(fakeWorld({ vehicle: car }), {}, {});
        expect(out.y).toBeLessThan(0);                         // vänster om färdriktningen +x är −y
        expect(out.z).toBe(FPS.carEye);
        expect(out.yaw).toBe(0);
    });
});

describe('day and night', () => {
    it('is dark with lit windows and lamps at night, bright at noon', () => {
        const n = dayPalette(23, 0.6), d = dayPalette(12, 0);
        expect(n.windows).toBe(1); expect(n.lamps).toBe(1); expect(n.night).toBe(1);
        expect(d.windows).toBe(0); expect(d.lamps).toBe(0);
        expect(d.sunI).toBeGreaterThan(n.sunI * 3);
        expect(d.sunDir[1]).toBeGreaterThan(0.8);
        // kvällen när spelet börjar: skymning, några fönster tända
        const e = dayPalette(19.5, 0.3);
        expect(e.windows).toBeGreaterThan(0.3); expect(e.windows).toBeLessThan(0.8);
    });

    it('changes smoothly over the whole day (no jumps)', () => {
        let prev = dayPalette(0, 0.6);
        for (let h = 0.02; h < 24; h += 0.02) {
            const p = dayPalette(h, 0.3);
            expect(Math.abs(p.sunI - prev.sunI)).toBeLessThan(0.1);
            expect(Math.abs(p.windows - prev.windows)).toBeLessThan(0.05);
            expect(Math.hypot(p.sunDir[0] - prev.sunDir[0], p.sunDir[1] - prev.sunDir[1], p.sunDir[2] - prev.sunDir[2])).toBeLessThan(0.15);
            prev = p;
        }
    });
});

describe('figures', () => {
    it('swings legs in opposite directions when walking, sits with legs forward', () => {
        const w = figurePose('walk', Math.PI / 2, true, {});
        expect(w.legL).toBeCloseTo(-w.legR, 6);
        expect(Math.abs(w.legL)).toBeGreaterThan(0.3);
        expect(Math.sign(w.armL)).toBe(-Math.sign(w.legL));
        const still = figurePose('walk', Math.PI / 2, false, {});
        expect(still.legL).toBe(0);
        const sit = figurePose('sit', 0, true, {});
        expect(sit.legL).toBeGreaterThan(1.2); expect(sit.sit).toBe(1);
        const cheer = figurePose('cheer', 0.4, true, {});
        expect(cheer.sideL).toBeGreaterThan(2);
    });

    it('writes instance matrices that place and swing body parts correctly', () => {
        const m = new Float32Array(16), out = new Float32Array(16), p = {};
        const a = Math.PI / 2;                                  // tittar nedåt i 2D = +z i three
        rootMatrix(m, 0, 100, 0, 200, yawOf(a), 0, 1);
        applyMatrix(m, 0, 10, 0, 0, p);                         // 10 px framåt
        expect(p.x).toBeCloseTo(100, 4); expect(p.z).toBeCloseTo(210, 4);
        // benet hänger ner från höften (y=15); positiv svängning för foten framåt
        jointMatrix(out, 0, m, 0, 0, 15, 0, 0.5, 0);
        applyMatrix(out, 0, 0, -15, 0, p);
        expect(p.y).toBeLessThan(15); expect(p.y).toBeGreaterThan(0);
        expect(p.z).toBeGreaterThan(200);                       // framåt = +z här
        // liggande: huvudet (uppåt i modellen) hamnar framåt, nära marken
        rootMatrix(m, 0, 0, 3, 0, yawOf(0), Math.PI / 2, 1);
        applyMatrix(m, 0, 0, 30, 0, p);
        expect(p.x).toBeCloseTo(30, 4); expect(p.y).toBeCloseTo(3, 4);
    });
});

describe('pool', () => {
    it('reuses one object per key and drops keys not seen for a while', () => {
        let made = 0;
        const pool = new Pool(() => ({ n: ++made }), 2);
        const a = pool.get('a');
        expect(pool.get('a')).toBe(a);
        pool.get('b');
        expect(made).toBe(2);
        const dropped = [];
        for (let i = 0; i < 4; i++) { pool.get('a'); pool.sweep((o, k) => dropped.push(k)); }
        expect(dropped).toEqual(['b']);
        expect(pool.size).toBe(1);
        expect(pool.get('a')).toBe(a);
        expect(pool.created).toBe(2);
    });
});

describe('helpers', () => {
    it('parses colours from the 2D palette', () => {
        expect(parseColor('#fff')).toEqual([1, 1, 1]);
        expect(parseColor('#ff0000')).toEqual([1, 0, 0]);
        expect(parseColor('rgb(0,255,0)')).toEqual([0, 1, 0]);
        expect(parseColor('nonsense', 0x0000ff)).toEqual([0, 0, 1]);
        expect(parseColor('#ff0000')).toBe(parseColor('#ff0000')); // cachad, ingen ny array
    });

    it('gives interior furniture sensible heights', () => {
        expect(furnitureHeight('#', { solid: true })).toBe(ROOM_H);
        expect(furnitureHeight('T', { solid: true })).toBeLessThan(15);
        expect(furnitureHeight('K', { name: 'kylskåp', solid: true })).toBeGreaterThan(30);
        expect(furnitureHeight('?', { name: 'okänd sak', solid: true })).toBe(18);
        expect(furnitureHeight('.', { name: 'golv', solid: false })).toBe(0);
    });
});
