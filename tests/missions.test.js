import { describe, it, expect } from 'vitest';
import { createWanted, addHeat, stars, updateWanted, copTarget, setStars, clearWanted } from '../src/city/wanted.js';
import { createMission, updateMission, rewardFor, applyRespect, phoneOpen, isHostile, MISSION_TYPES, canJoin, phoneAccess } from '../src/city/missions.js';
import { GANGS } from '../src/city/constants.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';

describe('wanted level', () => {
    it('starts clean and rises with crimes', () => {
        const w = createWanted();
        expect(stars(w)).toBe(0);
        addHeat(w, 0.3);
        expect(stars(w)).toBe(1);
        addHeat(w, 2);
        expect(stars(w)).toBe(3);
    });
    it('caps at five stars', () => {
        const w = createWanted();
        addHeat(w, 50);
        expect(stars(w)).toBe(5);
    });
    it('cools down only when no cop sees you', () => {
        const w = createWanted();
        setStars(w, 2);
        for (let i = 0; i < 600; i++) updateWanted(w, 1 / 60, true);
        expect(stars(w)).toBe(2);
        for (let i = 0; i < 60 * 60; i++) updateWanted(w, 1 / 60, false);
        expect(stars(w)).toBe(0);
    });
    it('sends more cops for more stars', () => {
        expect(copTarget(0)).toBe(0);
        expect(copTarget(5)).toBeGreaterThan(copTarget(2));
    });
    it('can be cleared by a respray', () => {
        const w = createWanted();
        setStars(w, 4);
        clearWanted(w);
        expect(stars(w)).toBe(0);
    });
});

describe('respect', () => {
    it('raises the giver and lowers only its rival on success', () => {
        const r = applyRespect({}, 'kebab', true);
        expect(r.kebab).toBeGreaterThan(0);
        expect(r.dods).toBeLessThan(0);
        expect(r.orden).toBe(0);
        const mc = applyRespect({}, 'hdmc', true);
        expect(mc.bmc).toBeLessThan(0);
        expect(mc.taco).toBe(0);
    });
    it('knows all six gangs', () => {
        const r = applyRespect({}, 'bmc', false);
        expect(Object.keys(r).sort()).toEqual(['bmc', 'dods', 'hdmc', 'kebab', 'orden', 'taco']);
    });
    it('lowers the giver on failure and stays within bounds', () => {
        let r = { kebab: -98, orden: 99, taco: 0 };
        r = applyRespect(r, 'kebab', false);
        expect(r.kebab).toBe(-100);
        r = applyRespect(r, 'orden', true);
        expect(r.orden).toBe(100);
    });
    it('closes the phone and turns the gang hostile at low respect', () => {
        expect(phoneOpen({ kebab: 0 }, 'kebab')).toBe(true);
        expect(phoneOpen({ kebab: -40 }, 'kebab')).toBe(false);
        expect(isHostile({ taco: -40 }, 'taco')).toBe(true);
        expect(isHostile({ taco: 10 }, 'taco')).toBe(false);
    });
});

describe('gang membership', () => {
    it('needs enough respect to join and no current gang', () => {
        expect(canJoin({ respect: { hdmc: 10 }, gang: null }, 'hdmc')).toBe(false);
        expect(canJoin({ respect: { hdmc: 30 }, gang: null }, 'hdmc')).toBe(true);
        expect(canJoin({ respect: { hdmc: 60 }, gang: 'bmc' }, 'hdmc')).toBe(false);
    });
    it('the rival of your gang hangs up on you', () => {
        expect(phoneAccess({ respect: {}, gang: 'hdmc' }, 'bmc')).toBe(false);
        expect(phoneAccess({ respect: {}, gang: 'hdmc' }, 'taco')).toBe(true);
        expect(phoneAccess({ respect: { taco: -50 }, gang: null }, 'taco')).toBe(false);
    });
    it('pays members a bonus from their own gang', () => {
        const base = createMission('dods', { rng: mulberry32(1), round: 1, respect: 40, city, from: city.spawn, type: 'delivery' });
        const member = createMission('dods', { rng: mulberry32(1), round: 1, respect: 40, city, from: city.spawn, type: 'delivery', member: true });
        expect(member.reward).toBeGreaterThan(base.reward);
    });
});

describe('rewards', () => {
    it('grow with the round and with respect', () => {
        expect(rewardFor('delivery', 10, 0)).toBeGreaterThan(rewardFor('delivery', 1, 0));
        expect(rewardFor('steal', 1, 60)).toBeGreaterThan(rewardFor('steal', 1, 0));
    });
});

const city = generateCity(1337);

function fakeWorld(at) {
    const spawned = [];
    return {
        player: { x: at.x, y: at.y },
        vehicle: null,
        wanted: createWanted(),
        notes: [],
        playerVehicle() { return this.vehicle; },
        notify(t) { this.notes.push(t); },
        spawnMissionVehicle(type, spot, tag) { const v = { type, x: spot.x, y: spot.y, hp: 100, maxHp: 100, tag, vx: 0, vy: 0 }; spawned.push(v); return v; },
        removeVehicle() { },
        findSpot() { return { x: at.x + 800, y: at.y, angle: 0 }; },
        spawned
    };
}

describe('createMission', () => {
    it('can create every mission type for every gang', () => {
        for (const g of GANGS) for (const type of MISSION_TYPES) {
            const m = createMission(g.id, { rng: mulberry32(5), round: 3, respect: 0, city, from: city.spawn, type });
            expect(m.type).toBe(type);
            expect(m.reward).toBeGreaterThan(0);
            expect(m.timeLimit).toBeGreaterThan(20);
            expect(m.brief.length, `${g.id}/${type}`).toBeGreaterThan(10);
            expect(m.brief).not.toContain('undefined');
        }
    });
    it('smash missions target the gang rival', () => {
        const m = createMission('hdmc', { rng: mulberry32(5), round: 1, respect: 0, city, from: city.spawn, type: 'smash' });
        expect(m.rival).toBe('bmc');
    });
});

describe('updateMission: delivery', () => {
    it('picks up, delivers and succeeds', () => {
        const m = createMission('kebab', { rng: mulberry32(1), round: 1, respect: 0, city, from: city.spawn, type: 'delivery' });
        const world = fakeWorld(city.spawn);
        expect(updateMission(m, world, 0.1)).toBe(null);
        world.player.x = m.pickup.x; world.player.y = m.pickup.y;
        expect(updateMission(m, world, 0.1)).toBe(null);
        expect(m.stage).toBe(1);
        world.player.x = m.drop.x; world.player.y = m.drop.y;
        expect(updateMission(m, world, 0.1)).toBe('success');
    });
    it('fails when time runs out', () => {
        const m = createMission('kebab', { rng: mulberry32(1), round: 1, respect: 0, city, from: city.spawn, type: 'delivery' });
        const world = fakeWorld(city.spawn);
        expect(updateMission(m, world, m.timeLimit + 1)).toBe('fail');
    });
});

describe('updateMission: escape', () => {
    it('gives stars on start and succeeds when they are gone', () => {
        const m = createMission('orden', { rng: mulberry32(2), round: 1, respect: 0, city, from: city.spawn, type: 'escape' });
        const world = fakeWorld(city.spawn);
        updateMission(m, world, 0.1);
        expect(stars(world.wanted)).toBeGreaterThanOrEqual(3);
        clearWanted(world.wanted);
        expect(updateMission(m, world, 0.1)).toBe('success');
    });
});

describe('updateMission: smash', () => {
    it('succeeds when every marked car is wrecked', () => {
        const m = createMission('taco', { rng: mulberry32(3), round: 1, respect: 0, city, from: city.spawn, type: 'smash' });
        const world = fakeWorld(city.spawn);
        updateMission(m, world, 0.1);
        expect(world.spawned.length).toBe(m.count);
        expect(world.spawned[0].type).toBe('gang:' + m.rival);
        world.spawned.forEach(v => { v.hp = 0; v.wrecked = true; });
        expect(updateMission(m, world, 0.1)).toBe('success');
    });
});

describe('updateMission: steal', () => {
    it('needs the player in the marked car at the garage', () => {
        const m = createMission('orden', { rng: mulberry32(4), round: 1, respect: 0, city, from: city.spawn, type: 'steal' });
        const world = fakeWorld(city.spawn);
        updateMission(m, world, 0.1);
        const car = world.spawned[0];
        world.player.x = m.garage.x; world.player.y = m.garage.y;
        expect(updateMission(m, world, 0.1)).toBe(null);
        world.vehicle = car; car.x = m.garage.x; car.y = m.garage.y;
        expect(updateMission(m, world, 0.1)).toBe(null); // stage 0 -> 1
        expect(updateMission(m, world, 0.1)).toBe('success');
    });
    it('fails if the car is wrecked', () => {
        const m = createMission('orden', { rng: mulberry32(4), round: 1, respect: 0, city, from: city.spawn, type: 'steal' });
        const world = fakeWorld(city.spawn);
        updateMission(m, world, 0.1);
        world.spawned[0].wrecked = true;
        expect(updateMission(m, world, 0.1)).toBe('fail');
    });
});

describe('updateMission: vip', () => {
    it('fails if the player leaves the car with the VIP', () => {
        const m = createMission('kebab', { rng: mulberry32(6), round: 1, respect: 0, city, from: city.spawn, type: 'vip' });
        const world = fakeWorld(city.spawn);
        const car = { x: m.pickup.x, y: m.pickup.y, vx: 0, vy: 0, hp: 100, maxHp: 100 };
        world.vehicle = car;
        world.player.x = car.x; world.player.y = car.y;
        updateMission(m, world, 0.1);
        expect(m.stage).toBe(1);
        world.vehicle = null;
        expect(updateMission(m, world, 0.1)).toBe('fail');
    });
    it('pays less when the VIP gets bruised', () => {
        const m = createMission('kebab', { rng: mulberry32(6), round: 1, respect: 0, city, from: city.spawn, type: 'vip' });
        const world = fakeWorld(city.spawn);
        const car = { x: m.pickup.x, y: m.pickup.y, vx: 0, vy: 0, hp: 100, maxHp: 100 };
        world.vehicle = car;
        world.player.x = car.x; world.player.y = car.y;
        updateMission(m, world, 0.1);
        expect(m.stage).toBe(1);
        car.hp = 40; car.x = m.drop.x; car.y = m.drop.y;
        world.player.x = car.x; world.player.y = car.y;
        expect(updateMission(m, world, 0.1)).toBe('success');
        expect(m.payout).toBeLessThan(m.reward);
    });
});
