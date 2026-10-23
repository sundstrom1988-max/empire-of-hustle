import { describe, it, expect } from 'vitest';
import {
    CAM_MODES, CAM_NAMES, DEFAULT_CAM, nextCam, is3D, loadCam, saveCam, CAM_KEY, VIEW_KEY, loadView, saveView, DEFAULT_VIEW,
    loadIndex, saveIndex, ZOOM_KEY, TOP_ORDER, TOP_ZOOMS, CHASE_ZOOMS, wheelView, chainPos, CHAIN_LEN, viewLabel,
    lookTurn, stepPitch, PITCH_MAX, LOOK_RAD, TOUCH_LOOK, aimPoint, AIM_DEADZONE, stickToWorld, followYaw, chaseRate, controlYaw,
    createFreeLook, stepFreeLook, resetFreeLook, FREE_HOLD, FREE_MAX_YAW, eTarget, frameStats, wrapAngle
} from '../src/city/camera.js';
import { World } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle } from '../src/city/vehicles.js';
import { DX, DY } from '../src/city/constants.js';

// localStorage-attrapp (Map) och en som kastar som i privat läge
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const badStore = { getItem() { throw new Error('privat läge'); }, setItem() { throw new Error('privat läge'); } };

describe('kameralägen: cykeln', () => {
    it('V/C/🔍 går förstaperson → följkamera → överblick → förstaperson', () => {
        expect(CAM_MODES).toEqual(['fps', 'chase', 'top']);
        expect(nextCam('fps')).toBe('chase');
        expect(nextCam('chase')).toBe('top');
        expect(nextCam('top')).toBe('fps');
        let c = 'top';
        for (let i = 0; i < 30; i++) c = nextCam(c);
        expect(c).toBe('top');                            // 30 tryck = 10 varv: tillbaka där vi började
        expect(nextCam('skräp')).toBe('chase');
        expect(CAM_NAMES).toEqual({ fps: 'FÖRSTAPERSON', chase: 'FÖLJKAMERA', top: 'ÖVERBLICK' });
        expect(is3D('fps') && is3D('chase') && !is3D('top')).toBe(true);
    });
});

describe('kameralägen: sparas i webbläsaren', () => {
    it('valet sparas och läses tillbaka; skräp eller privat läge ger standardläget utan att kasta', () => {
        const st = memStore();
        expect(loadCam(st)).toBe(DEFAULT_CAM);
        expect(saveCam(st, 'fps')).toBe(true);
        expect(st.m.get(CAM_KEY)).toBe('fps');
        expect(loadCam(st)).toBe('fps');
        expect(saveCam(st, 'zoomat')).toBe(false);        // ogiltigt läge sparas inte
        expect(loadCam(st)).toBe('fps');
        st.setItem(CAM_KEY, 'helikopter');
        expect(loadCam(st)).toBe(DEFAULT_CAM);
        expect(loadCam(badStore)).toBe(DEFAULT_CAM);
        expect(() => saveCam(badStore, 'fps')).not.toThrow();
        expect(loadCam(null)).toBe(DEFAULT_CAM);
    });

    it('inställningarna { sens, fov, bob, invertY } sparas, rensas och klampas', () => {
        const st = memStore();
        expect(loadView(st)).toEqual(DEFAULT_VIEW);
        saveView(st, { sens: 2.5, fov: 90, bob: false, invertY: true });
        expect(JSON.parse(st.m.get(VIEW_KEY))).toEqual({ sens: 2.5, fov: 90, bob: false, invertY: true });
        expect(loadView(st)).toEqual({ sens: 2.5, fov: 90, bob: false, invertY: true });
        st.setItem(VIEW_KEY, JSON.stringify({ sens: 99, fov: 5, bob: 'ja', invertY: null }));
        expect(loadView(st)).toEqual({ sens: 3, fov: 60, bob: true, invertY: false });
        st.setItem(VIEW_KEY, '{trasig json');
        expect(loadView(st)).toEqual(DEFAULT_VIEW);
        expect(loadView(badStore)).toEqual(DEFAULT_VIEW);
    });

    it('zoomstegen sparas som index och ogiltiga värden ger standard', () => {
        const st = memStore();
        expect(loadIndex(st, ZOOM_KEY, TOP_ZOOMS.length, 0)).toBe(0);
        saveIndex(st, ZOOM_KEY, 2);
        expect(loadIndex(st, ZOOM_KEY, TOP_ZOOMS.length, 0)).toBe(2);
        st.setItem(ZOOM_KEY, '7');
        expect(loadIndex(st, ZOOM_KEY, TOP_ZOOMS.length, 0)).toBe(0);
        st.setItem(ZOOM_KEY, '');
        expect(loadIndex(st, ZOOM_KEY, TOP_ZOOMS.length, 1)).toBe(1);
    });
});

describe('scrollhjulet zoomar över lägesgränserna', () => {
    it('in: överblick LÅNGT → NORMAL → NÄRA → följkamera LÅNGT → NORMAL → NÄRA → förstaperson, och stannar där', () => {
        let v = { cam: 'top', top: TOP_ORDER[0], chase: 1 };
        const seen = [viewLabel(v)];
        for (let i = 0; i < CHAIN_LEN + 3; i++) {
            const n = wheelView(v, -1);
            if (n === v) break;
            v = n; seen.push(viewLabel(v));
        }
        expect(seen).toEqual([
            'ÖVERBLICK · LÅNGT', 'ÖVERBLICK · NORMAL', 'ÖVERBLICK · NÄRA',
            'FÖLJKAMERA · LÅNGT', 'FÖLJKAMERA · NORMAL', 'FÖLJKAMERA · NÄRA', 'FÖRSTAPERSON'
        ]);
        expect(wheelView(v, -1)).toBe(v);                 // längre in än förstaperson går inte
    });

    it('ut går samma väg tillbaka och stannar på överblick LÅNGT', () => {
        let v = { cam: 'fps', top: 0, chase: 1 };
        v = wheelView(v, +1);
        expect(v).toMatchObject({ cam: 'chase', chase: CHASE_ZOOMS.length - 1 });   // närmast först
        v = wheelView(wheelView(v, +1), +1);
        expect(v).toMatchObject({ cam: 'chase', chase: 0 });
        v = wheelView(v, +1);
        expect(v).toMatchObject({ cam: 'top', top: TOP_ORDER[TOP_ORDER.length - 1] }); // NÄRA
        v = wheelView(wheelView(v, +1), +1);
        expect(v).toMatchObject({ cam: 'top', top: TOP_ORDER[0] });
        expect(wheelView(v, +1)).toBe(v);
        expect(chainPos(v)).toBe(0);
    });

    it('utan 3D stannar hjulet i överblicken', () => {
        const v = { cam: 'top', top: TOP_ORDER[2], chase: 1 };
        expect(wheelView(v, -1, false)).toBe(v);
        expect(wheelView(v, +1, false)).toMatchObject({ cam: 'top', top: TOP_ORDER[1] });
        expect(wheelView(v, 0)).toBe(v);
    });

    it('V-cykeln behåller zoomstegen i varje läge', () => {
        const v = { cam: 'chase', top: 2, chase: 0 };
        const w = { ...v, cam: nextCam(v.cam) };
        expect(w).toEqual({ cam: 'top', top: 2, chase: 0 });
    });
});

describe('blick: mus, touch och höjdvinkel', () => {
    it('musen åt höger vrider åt höger (vinkeln ökar), känsligheten skalar, touch lite mer per px', () => {
        expect(lookTurn(100)).toBeCloseTo(100 * LOOK_RAD, 9);
        expect(lookTurn(-100, 2)).toBeCloseTo(-200 * LOOK_RAD, 9);
        expect(lookTurn(100, 1, true)).toBeCloseTo(100 * LOOK_RAD * TOUCH_LOOK, 9);
        expect(lookTurn(0)).toBe(0);
        expect(lookTurn(undefined)).toBe(0);
    });

    it('höjdvinkeln: musen upp = titta upp, inverterad Y vänder, aldrig mer än ±75°', () => {
        expect(stepPitch(0, -100)).toBeGreaterThan(0);
        expect(stepPitch(0, -100, 1, true)).toBeLessThan(0);
        expect(stepPitch(0, -1e6)).toBeCloseTo(PITCH_MAX, 9);
        expect(stepPitch(0, 1e6)).toBeCloseTo(-PITCH_MAX, 9);
        expect(PITCH_MAX).toBeCloseTo(75 * Math.PI / 180, 9);
    });
});

describe('överblick: musen siktar med dödzon i skärmen', () => {
    const player = { x: 1000, y: 1000 };
    it('inom ~20 px från gubben siktar musen inte alls', () => {
        const ps = { x: 640, y: 360 };
        expect(aimPoint({ x: 650, y: 365 }, ps, player, 0.8)).toBe(null);
        expect(aimPoint({ x: 640 + AIM_DEADZONE - 0.5, y: 360 }, ps, player, 0.8)).toBe(null);
        expect(aimPoint({ x: 640 + AIM_DEADZONE + 1, y: 360 }, ps, player, 0.8)).not.toBe(null);
    });

    it('riktningen räknas i skärmen från gubbens ritade position och skalas med zoomen', () => {
        const ps = { x: 600, y: 300 };
        const a = aimPoint({ x: 700, y: 300 }, ps, player, 0.5);
        expect(a.x).toBeCloseTo(1200, 6); expect(a.y).toBeCloseTo(1000, 6);
        const b = aimPoint({ x: 600, y: 200 }, ps, player, 2);
        expect(Math.atan2(b.y - player.y, b.x - player.x)).toBeCloseTo(-Math.PI / 2, 9); // pekaren ovanför = norr
    });

    it('går man förbi pekaren slår vinkeln inte om innan dödzonen, och i dödzonen står den kvar', () => {
        const mouse = { x: 700, y: 360 };
        let last = null, flips = 0;
        for (let px = 600; px <= 800; px += 2) {
            const a = aimPoint(mouse, { x: px, y: 360 }, player, 1);
            if (!a) continue;
            const ang = Math.atan2(a.y - player.y, a.x - player.x);
            if (last !== null && Math.abs(wrapAngle(ang - last)) > 1) flips++;
            last = ang;
        }
        expect(flips).toBe(1); // en enda vändning — efter att man passerat, inte darr fram och tillbaka
        expect(aimPoint(mouse, { x: 700, y: 360 }, player, 1)).toBe(null);
    });

    it('saknas pekare, position eller zoom: inget sikte', () => {
        expect(aimPoint(null, { x: 0, y: 0 }, player, 1)).toBe(null);
        expect(aimPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, player, 0)).toBe(null);
    });
});

describe('joysticken i världens riktning', () => {
    it('överblick: ingen vridning (upp = norr)', () => {
        expect(stickToWorld(0, -1, 'top', 1.3)).toEqual({ mx: 0, my: -1 });
        expect(stickToWorld(0.5, 0.5, 'top', 2)).toEqual({ mx: 0.5, my: 0.5 });
    });

    it('följkamera/förstaperson: upp = rakt fram i bild, höger = höger om blicken', () => {
        const near = (v, x, y) => { expect(v.mx).toBeCloseTo(x, 9); expect(v.my).toBeCloseTo(y, 9); };
        near(stickToWorld(0, -1, 'chase', 0), 1, 0);              // tittar österut: upp = öster
        near(stickToWorld(1, 0, 'chase', 0), 0, 1);               // höger om öster = söder (y nedåt)
        near(stickToWorld(0, -1, 'fps', Math.PI / 2), 0, 1);      // tittar söderut
        near(stickToWorld(1, 0, 'fps', Math.PI / 2), -1, 0);      // höger om söder = väster
        near(stickToWorld(0, 1, 'fps', Math.PI), 1, 0);           // ned = bakåt
        const v = stickToWorld(0.6, -0.8, 'chase', 0.7);
        expect(Math.hypot(v.mx, v.my)).toBeCloseTo(1, 9);         // längden (springa/gå) behålls
        near(stickToWorld(0, 0, 'chase', 1), 0, 0);
    });

    it('efter många hela varv är framåt fortfarande blickens riktning (N/Ö/S/V)', () => {
        let a = 0;
        const step = lookTurn(37);                                // musen åt höger i små ryck
        for (const [want, label] of [[-Math.PI / 2, 'N'], [0, 'Ö'], [Math.PI / 2, 'S'], [Math.PI, 'V']]) {
            for (let i = 0; i < 2000; i++) a = wrapAngle(a + step);   // flera hela varv
            a = wrapAngle(a + wrapAngle(want - a));                    // titta exakt åt hållet
            const fwd = stickToWorld(0, -1, 'fps', controlYaw('fps', { angle: a }, 0));
            expect(Math.atan2(fwd.my, fwd.mx), label).toBeCloseTo(Math.atan2(Math.sin(want), Math.cos(want)), 6);
            expect(a).toBeGreaterThan(-Math.PI - 1e-9); expect(a).toBeLessThanOrEqual(Math.PI);
        }
    });
});

describe('följkamerans riktning', () => {
    it('musens vridning går in direkt, resten glider in bakom', () => {
        expect(followYaw(0, 0, 0.016, 10, 0.3)).toBeCloseTo(0.3 - 0.3 * 0.16, 6);
        let y = 0;
        for (let i = 0; i < 300; i++) y = followYaw(y, 2, 1 / 60, 3.2);
        expect(y).toBeCloseTo(2, 3);
        expect(followYaw(NaN, 1, 0.016, 3)).toBe(1);
    });

    it('tar den korta vägen runt ±π och håller vinkeln inom (−π, π]', () => {
        let y = 3.1;
        for (let i = 0; i < 120; i++) y = followYaw(y, -3.1, 1 / 60, 6);
        expect(Math.abs(wrapAngle(y - -3.1))).toBeLessThan(1e-3);
        expect(y).toBeLessThanOrEqual(Math.PI);
        expect(y).toBeGreaterThan(-Math.PI);
    });

    it('touch: kameran svänger bara in när man går framåt, inte åt sidan', () => {
        expect(chaseRate({ touch: true, stickActive: true, stickUp: 0 })).toBe(0);
        expect(chaseRate({ touch: true, stickActive: true, stickUp: 1 })).toBeCloseTo(2.6, 9);
        expect(chaseRate({ touch: true, stickActive: false })).toBe(0);
        expect(chaseRate({ car: true, touch: true })).toBeGreaterThan(0);
        expect(chaseRate({})).toBeGreaterThan(5);
    });
});

describe('fri blick i bilen', () => {
    it('vrider bara blicken: bilens riktning och kontrollernas riktning ändras aldrig', () => {
        const car = { x: 100, y: 100, angle: 0.4, vx: 50, vy: 0 };
        const player = { angle: 0.4, vehicle: car };
        const fl = createFreeLook();
        const before = JSON.stringify(car);
        stepFreeLook(fl, 400, -50, 1 / 60);
        expect(fl.yaw).toBeGreaterThan(0.5);
        expect(fl.pitch).toBeGreaterThan(0);
        expect(JSON.stringify(car)).toBe(before);
        expect(controlYaw('fps', player, 9)).toBe(0.4);              // förarplatsen: bilens nos
        expect(controlYaw('chase', player, 0.35)).toBe(0.35);        // följkameran utan den fria blicken
        const fwd = stickToWorld(0, -1, 'fps', controlYaw('fps', player, 0));
        expect(Math.atan2(fwd.my, fwd.mx)).toBeCloseTo(0.4, 9);
    });

    it('fjädrar tillbaka efter ~1,2 s utan rörelse, och har ett tak', () => {
        const fl = createFreeLook();
        stepFreeLook(fl, 1e6, 0, 1 / 60);
        expect(fl.yaw).toBe(FREE_MAX_YAW);
        const held = fl.yaw;
        for (let t = 0; t < FREE_HOLD - 0.1; t += 1 / 60) stepFreeLook(fl, 0, 0, 1 / 60);
        expect(fl.yaw).toBe(held);                                   // står kvar en stund
        for (let t = 0; t < 2; t += 1 / 60) stepFreeLook(fl, 0, 0, 1 / 60);
        expect(Math.abs(fl.yaw)).toBeLessThan(0.05);
        resetFreeLook(fl);
        expect(fl).toEqual({ yaw: 0, pitch: 0, idle: 0 });
    });
});

describe('vad E väljer (markeringen i bild)', () => {
    const city = generateCity(1337);
    const makeWorld = () => {
        const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(9) });
        w.vehicles = []; w.peds = []; w.state = 'play';
        return w;
    };

    it('bil bredvid → bilen; dörr närmare än bilen → dörren; i bilen → inget', () => {
        const w = makeWorld();
        const p = w.player;
        const car = createVehicle('sedan', p.x + 30, p.y, 0);
        w.vehicles.push(car);
        expect(eTarget(w)).toMatchObject({ kind: 'car', x: car.x, y: car.y });
        expect(eTarget(w).label).toMatch(/^Kör /);
        const d = w.doors().find(pl => pl.kind === 'business');
        const o = d.door || d;
        p.x = o.x - DX[o.side] * 16; p.y = o.y - DY[o.side] * 16;
        w.vehicles = [];
        const t = eTarget(w);
        expect(t).toMatchObject({ kind: 'door', x: o.x, y: o.y });
        expect(t.label).toMatch(/GÅ IN/);
        p.vehicle = car;
        expect(eTarget(w)).toBe(null);
    });

    it('inne: den person/disk som E pratar med', () => {
        const w = makeWorld();
        expect(w.enterInterior('stripclub', w.city.markers.stripclub)).toBe(true);
        const a = w.interior.def.interactions[0];
        w.player.x = a.x; w.player.y = a.y + 4;
        w.update(1 / 60, { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, horn: false, action: false, punch: false, attack: false, rob: false, weapon: false });
        const t = eTarget(w);
        expect(t).toMatchObject({ kind: 'talk' });
        expect(t.label).not.toMatch(/^E — /);
    });

    it('kamerabyte ändrar inte vad E väljer eller var man står (inget kameraberoende)', () => {
        const w = makeWorld();
        const car = createVehicle('sedan', w.player.x + 30, w.player.y, 0);
        w.vehicles.push(car);
        const snap = JSON.stringify({ x: w.player.x, y: w.player.y, a: w.player.angle });
        const t1 = eTarget(w);
        for (const cam of CAM_MODES) expect(eTarget(w)).toEqual(t1); // samma oavsett läge (eTarget får inget läge)
        expect(JSON.stringify({ x: w.player.x, y: w.player.y, a: w.player.angle })).toBe(snap);
    });
});

describe('mätning', () => {
    it('median, p90 och ryck', () => {
        const ms = Array.from({ length: 100 }, (_, i) => (i < 95 ? 16.7 : 50));
        const s = frameStats(ms);
        expect(s.median).toBeCloseTo(16.7, 6);
        expect(s.p90).toBeCloseTo(16.7, 6);
        expect(s.max).toBe(50);
        expect(s.hitches).toBe(5);
        expect(frameStats([]).n).toBe(0);
    });
});
