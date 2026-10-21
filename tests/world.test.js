import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { setStars, stars } from '../src/city/wanted.js';
import { createVehicle } from '../src/city/vehicles.js';

const city = generateCity(1337);
const DT = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false };

function makeWorld(seed = 7, profile = createPlayerState('kimit')) {
    return new World(city, profile, { round: 2, rnd: mulberry32(seed) });
}

function finite(e) { return ['x', 'y', 'vx', 'vy'].every(k => Number.isFinite(e[k])); }

describe('World simulation', () => {
    it('runs two minutes of chaos without breaking', () => {
        const w = makeWorld();
        // Hoppa in i närmaste bil (Morsans Volvo vid HQ)
        const car = w.vehicles[0];
        w.player.x = car.x + 20; w.player.y = car.y;
        w.update(DT, { ...IDLE, action: true });
        expect(w.player.vehicle).toBe(car);
        for (let i = 0; i < 60 * 120; i++) {
            const t = i / 60;
            w.update(DT, { ...IDLE, throttle: 1, steer: Math.sin(t * 0.7), handbrake: i % 240 < 20, horn: i % 500 === 0 });
            w.events.length = 0;
        }
        expect(w.vehicles.length).toBeGreaterThan(8);
        expect(w.peds.length).toBeGreaterThan(8);
        for (const v of w.vehicles) expect(finite(v), v.type).toBe(true);
        for (const p of w.peds) expect(finite(p)).toBe(true);
        expect(finite(w.player)).toBe(true);
    });

    it('lets the police catch a player who stands still', () => {
        const w = makeWorld(11);
        const car = w.vehicles[0];
        w.player.x = car.x + 20; w.player.y = car.y;
        w.update(DT, { ...IDLE, action: true });
        setStars(w.wanted, 3);
        let t = 0;
        while (w.state === 'play' && t < 90) {
            setStars(w.wanted, 3);
            w.update(DT, IDLE);
            t += DT;
        }
        expect(w.state).toBe('busted');
        for (let i = 0; i < 60 * 5; i++) w.update(DT, IDLE);
        expect(w.finished).toBe('busted');
    });

    it('wastes the player when their burning car explodes', () => {
        const w = makeWorld(3);
        const car = w.vehicles[0];
        w.player.x = car.x + 20; w.player.y = car.y;
        w.update(DT, { ...IDLE, action: true });
        w.damageVehicle(car, 9999, null);
        expect(car.wrecked).toBe(true);
        for (let i = 0; i < 60 * 5; i++) w.update(DT, IDLE);
        expect(w.state).toBe('wasted');
    });

    it('can bail out of a burning car in time', () => {
        const w = makeWorld(3);
        const car = w.vehicles[0];
        w.player.x = car.x + 20; w.player.y = car.y;
        w.update(DT, { ...IDLE, action: true });
        w.damageVehicle(car, 9999, null);
        w.update(DT, { ...IDLE, action: true });
        expect(w.player.vehicle).toBe(null);
        // Spring därifrån
        for (let i = 0; i < 60 * 5; i++) w.update(DT, { ...IDLE, mx: 0, my: 1, run: true });
        expect(w.state).toBe('play');
    });

    it('rings the gang phone when you walk up to it', () => {
        const w = makeWorld(5);
        const ph = city.markers.phones[0];
        w.player.x = ph.x; w.player.y = ph.y;
        w.update(DT, IDLE);
        const e = w.events.find(ev => ev.type === 'phone');
        expect(e).toBeTruthy();
        w.startMission(e.mission);
        expect(w.mission).toBe(e.mission);
        expect(w.profile.missionsThisRound).toBe(1);
    });

    it('hangs up when the mission limit is reached', () => {
        const profile = createPlayerState('juan');
        profile.missionsThisRound = 3;
        const w = makeWorld(5, profile);
        const ph = city.markers.phones[1];
        w.player.x = ph.x; w.player.y = ph.y;
        w.update(DT, IDLE);
        expect(w.events.some(ev => ev.type === 'phone')).toBe(false);
        expect(w.events.some(ev => ev.type === 'msg')).toBe(true);
    });

    it('pays out at the car fence for a stolen car but not for your own', () => {
        const w = makeWorld(9);
        const fence = city.markers.fence;
        const own = w.vehicles[0];
        own.x = fence.x; own.y = fence.y;
        w.player.vehicle = own; own.driver = 'player';
        const before = w.profile.money;
        w.update(DT, IDLE);
        expect(w.profile.money).toBe(before);

        const w2 = makeWorld(9);
        const lambo = createVehicle('lambo', fence.x, fence.y, 0);
        w2.vehicles.push(lambo);
        w2.player.vehicle = lambo; lambo.driver = 'player';
        w2.player.x = fence.x; w2.player.y = fence.y;
        const m0 = w2.profile.money;
        w2.update(DT, IDLE);
        expect(w2.profile.money).toBeGreaterThan(m0 + 2000);
        expect(w2.vehicles.includes(lambo)).toBe(false);
        expect(w2.player.vehicle).toBe(null);
    });

    it('clears the wanted level at the paint shop for a fee', () => {
        const w = makeWorld(4);
        const sp = city.markers.sprays[0];
        const car = createVehicle('bmw', sp.x, sp.y, 0);
        w.vehicles.push(car);
        w.player.vehicle = car; car.driver = 'player';
        w.player.x = sp.x; w.player.y = sp.y;
        w.profile.money = 5000;
        setStars(w.wanted, 2);
        w.update(DT, IDLE);
        expect(stars(w.wanted)).toBe(0);
        expect(w.profile.money).toBe(5000 - (150 + 400));
    });

    it('collects cash from your own business once per round', () => {
        const profile = createPlayerState('mehmet');
        profile.owned = ['kebab']; profile.levels = { kebab: 2 };
        const w = makeWorld(2, profile);
        const mk = city.markers.businesses.find(b => b.slot === 0);
        w.player.x = mk.x; w.player.y = mk.y;
        const m0 = profile.money;
        w.update(DT, IDLE);
        expect(profile.money).toBe(m0 + Math.floor(80 * 2 * 0.3));
        w.player.x += 500; w.update(DT, IDLE);
        w.player.x = mk.x; w.update(DT, IDLE);
        expect(profile.money).toBe(m0 + Math.floor(80 * 2 * 0.3));
    });
});
