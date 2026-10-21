import { describe, it, expect } from 'vitest';
import { generateCity, tileAt, laneDirs, districtAt, flowField, isSolidAt, isWalkableTile } from '../src/city/map.js';
import { T, MAP_W, MAP_H, DX, DY, TILE } from '../src/city/constants.js';

const city = generateCity(1337);

function roadTiles(c) {
    const out = [];
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (tileAt(c, x, y) === T.ROAD) out.push([x, y]);
    return out;
}

describe('generateCity', () => {
    it('is deterministic for a seed', () => {
        const b = generateCity(1337);
        expect(Array.from(b.tiles)).toEqual(Array.from(city.tiles));
        const c = generateCity(99);
        expect(Array.from(c.tiles)).not.toEqual(Array.from(city.tiles));
    });

    it('has one connected road network', () => {
        const roads = roadTiles(city);
        expect(roads.length).toBeGreaterThan(500);
        const seen = new Set([roads[0].join()]);
        const q = [roads[0]];
        while (q.length) {
            const [x, y] = q.pop();
            for (let d = 0; d < 4; d++) {
                const nx = x + DX[d], ny = y + DY[d];
                const k = nx + ',' + ny;
                if (!seen.has(k) && tileAt(city, nx, ny) === T.ROAD) { seen.add(k); q.push([nx, ny]); }
            }
        }
        expect(seen.size).toBe(roads.length);
    });

    it('gives every road tile a lane with somewhere to go (no traffic dead ends)', () => {
        for (const [x, y] of roadTiles(city)) {
            const mask = laneDirs(city, x, y);
            expect(mask).toBeGreaterThan(0);
            let exits = 0;
            for (let d = 0; d < 4; d++) {
                if ((mask & (1 << d)) && tileAt(city, x + DX[d], y + DY[d]) === T.ROAD) exits++;
            }
            expect(exits, `tile ${x},${y}`).toBeGreaterThan(0);
        }
    });

    it('places all the special locations on walkable ground', () => {
        const m = city.markers;
        const all = [m.home, m.dealer, m.fence, ...m.sprays, ...m.phones, ...m.businesses, ...m.places];
        expect(Math.hypot(m.dealer.x - city.spawn.x, m.dealer.y - city.spawn.y)).toBeGreaterThan(150);
        for (const mk of all) {
            const tx = Math.floor(mk.x / TILE), ty = Math.floor(mk.y / TILE);
            expect(isWalkableTile(city, tx, ty), JSON.stringify(mk)).toBe(true);
        }
        expect(m.phones.map(p => p.gang).sort()).toEqual(['bmc', 'dods', 'hdmc', 'kebab', 'orden', 'taco']);
        expect(m.sprays.length).toBe(2);
        expect(m.businesses.length).toBe(8);
        expect(m.places.length).toBeGreaterThanOrEqual(18);
        for (const d of ['vasterort', 'centrum', 'skogsbacken', 'orten', 'industrin', 'hamnen']) {
            expect(m.places.some(pl => pl.district === d), d).toBe(true);
        }
        expect(districtAt(city, m.fence.x, m.fence.y)).toBe('hamnen');
    });

    it('puts every phone in its own gang district', () => {
        const want = { kebab: 'orten', orden: 'centrum', taco: 'hamnen', dods: 'vasterort', hdmc: 'skogsbacken', bmc: 'industrin' };
        for (const ph of city.markers.phones) expect(districtAt(city, ph.x, ph.y)).toBe(want[ph.gang]);
    });

    it('spawns the player and parked cars on free ground', () => {
        expect(isSolidAt(city, city.spawn.x, city.spawn.y)).toBe(false);
        expect(city.homeParking.length).toBeGreaterThanOrEqual(6);
        for (const s of city.homeParking) expect(isSolidAt(city, s.x, s.y)).toBe(false);
    });

    it('splits the map into six turfs', () => {
        expect(districtAt(city, 5 * TILE, 10 * TILE)).toBe('vasterort');
        expect(districtAt(city, 32 * TILE, 10 * TILE)).toBe('centrum');
        expect(districtAt(city, 50 * TILE, 10 * TILE)).toBe('skogsbacken');
        expect(districtAt(city, 5 * TILE, 50 * TILE)).toBe('orten');
        expect(districtAt(city, 32 * TILE, 50 * TILE)).toBe('industrin');
        expect(districtAt(city, 50 * TILE, 50 * TILE)).toBe('hamnen');
    });

    it('builds buildings with heights and solid tiles', () => {
        expect(city.buildings.length).toBeGreaterThan(40);
        for (const b of city.buildings) {
            expect(b.height).toBeGreaterThan(0);
            expect(tileAt(city, b.x, b.y)).toBe(T.BUILDING);
        }
    });
});

describe('flowField', () => {
    it('measures walking distance from a tile', () => {
        const [sx, sy] = roadTiles(city)[100];
        const f = flowField(city, sx, sy);
        expect(f[sy * MAP_W + sx]).toBe(0);
        const [tx, ty] = roadTiles(city)[400];
        expect(f[ty * MAP_W + tx]).toBeGreaterThan(0);
        const b = city.buildings[0];
        expect(f[b.y * MAP_W + b.x]).toBe(-1);
    });
});
