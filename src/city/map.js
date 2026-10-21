// ═══════════════════════════════════════════
//  STAN — kartgenerator
//  Rutnät av tvåfiliga gator (högertrafik),
//  trottoarer, kvarter, parker, parkeringar,
//  vatten i söder/öster och sex gängturfs.
// ═══════════════════════════════════════════

import { TILE, MAP_W, MAP_H, T, SOLID, WALKABLE, N, E, S, W, DX, DY, PLACE_NAMES, GANGS } from './constants.js';
import { mulberry32 } from './rng.js';

const W_ = MAP_W, H_ = MAP_H;
const idx = (x, y) => y * W_ + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < W_ && y < H_;
const center = (t) => t * TILE + TILE / 2;

// Sex turfs: tre kolumner (väst, mitt, öst) × två rader (norr, söder)
const TURF_GRID = [['vasterort', 'centrum', 'skogsbacken'], ['orten', 'industrin', 'hamnen']];
export function districtOfTile(tx, ty) {
    const col = tx < 22 ? 0 : tx < 43 ? 1 : 2;
    return TURF_GRID[ty < 32 ? 0 : 1][col];
}
// Ungefärlig mittpunkt (i rutor) för varje turf
export const TURF_CENTER = {
    vasterort: [11, 16], centrum: [32, 16], skogsbacken: [53, 16],
    orten: [11, 47], industrin: [32, 47], hamnen: [53, 47]
};
export function districtAt(city, x, y) { return districtOfTile(Math.floor(x / TILE), Math.floor(y / TILE)); }

export function tileAt(city, tx, ty) { return inBounds(tx, ty) ? city.tiles[idx(tx, ty)] : T.WALL; }
export function isSolidTile(city, tx, ty) { return SOLID.has(tileAt(city, tx, ty)); }
export function isSolidAt(city, x, y) { return isSolidTile(city, Math.floor(x / TILE), Math.floor(y / TILE)); }
export function isWalkableTile(city, tx, ty) { return WALKABLE.has(tileAt(city, tx, ty)); }
export function laneDirs(city, tx, ty) { return inBounds(tx, ty) ? city.lanes[idx(tx, ty)] : 0; }
export function buildingAt(city, tx, ty) {
    if (!inBounds(tx, ty)) return null;
    const id = city.bld[idx(tx, ty)];
    return id >= 0 ? city.buildings[id] : null;
}

// BFS-avstånd (i rutor) från en ruta över gångbar mark. -1 = onåbar.
export function flowField(city, sx, sy, maxDist = 80) {
    const dist = new Int16Array(W_ * H_).fill(-1);
    if (!isWalkableTile(city, sx, sy)) return dist;
    const qx = new Int16Array(W_ * H_), qy = new Int16Array(W_ * H_);
    let head = 0, tail = 0;
    dist[idx(sx, sy)] = 0; qx[tail] = sx; qy[tail++] = sy;
    while (head < tail) {
        const x = qx[head], y = qy[head++];
        const d = dist[idx(x, y)];
        if (d >= maxDist) continue;
        for (let k = 0; k < 4; k++) {
            const nx = x + DX[k], ny = y + DY[k];
            if (!inBounds(nx, ny)) continue;
            const ni = idx(nx, ny);
            if (dist[ni] !== -1 || !WALKABLE.has(city.tiles[ni])) continue;
            dist[ni] = d + 1; qx[tail] = nx; qy[tail++] = ny;
        }
    }
    return dist;
}

function gridLines(rng, size) {
    const out = [2];
    let p = 2;
    for (;;) {
        p += rng.int(8, 11);
        if (p > size - 12) break;
        out.push(p);
    }
    out.push(size - 6);
    return out;
}

// Där shoppar hamnar (index = SHOPS-ordningen i gameData)
const BUSINESS_DISTRICTS = ['orten', 'orten', 'vasterort', 'industrin', 'centrum', 'centrum', 'centrum', 'hamnen'];

// Takfärger, hushöjd och hur ofta ett kvarter blir park eller parkering
const PALETTES = {
    vasterort: { roofs: ['#9e9e9e', '#8d8d8d', '#b0866a', '#7b8a8b', '#a1887f'], h: [0.16, 0.3], park: 0.12, lot: 0.1 },
    centrum: { roofs: ['#607d8b', '#78909c', '#5c6bc0', '#455a64', '#90a4ae', '#4e5d6c', '#8e7cc3'], h: [0.22, 0.42], park: 0.1, lot: 0.06 },
    skogsbacken: { roofs: ['#b91c1c', '#7f1d1d', '#a16207', '#4d7c0f', '#57534e', '#9a3412'], h: [0.06, 0.13], park: 0.32, lot: 0.04 },
    orten: { roofs: ['#8d6e63', '#a1887f', '#9e9e9e', '#b0866a', '#7b8a8b', '#c9a27e'], h: [0.14, 0.28], park: 0.15, lot: 0.08 },
    industrin: { roofs: ['#6b7280', '#52525b', '#78716c', '#57534e', '#4b5563', '#a16207'], h: [0.07, 0.15], park: 0.05, lot: 0.25 },
    hamnen: { roofs: ['#8b5a2b', '#6d7f5c', '#a0522d', '#5f6b73', '#7e6f5a', '#b5651d'], h: [0.08, 0.17], park: 0.08, lot: 0.22 }
};

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * f)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

export function generateCity(seed = 1337) {
    const rng = mulberry32(seed);
    const tiles = new Uint8Array(W_ * H_).fill(T.GRASS);
    const lanes = new Uint8Array(W_ * H_);
    const bld = new Int16Array(W_ * H_).fill(-1);
    const xs = gridLines(rng, W_), ys = gridLines(rng, H_);

    // ── 1. Gatusegment mellan korsningar, några tas bort för större kvarter ──
    const segs = [];
    xs.forEach((x, i) => { for (let j = 0; j < ys.length - 1; j++) segs.push({ o: 'v', line: x, a: ys[j], b: ys[j + 1], ring: i === 0 || i === xs.length - 1, keep: true }); });
    ys.forEach((y, i) => { for (let j = 0; j < xs.length - 1; j++) segs.push({ o: 'h', line: y, a: xs[j], b: xs[j + 1], ring: i === 0 || i === ys.length - 1, keep: true }); });
    const deg = new Map();
    const key = (x, y) => x + ',' + y;
    const ends = s => s.o === 'v' ? [key(s.line, s.a), key(s.line, s.b)] : [key(s.a, s.line), key(s.b, s.line)];
    segs.forEach(s => ends(s).forEach(k => deg.set(k, (deg.get(k) || 0) + 1)));
    const order = segs.map((s, i) => i).sort(() => rng() - 0.5);
    for (const i of order) {
        const s = segs[i];
        if (s.ring || !rng.chance(0.16)) continue;
        const [ka, kb] = ends(s);
        if (deg.get(ka) >= 3 && deg.get(kb) >= 3) {
            s.keep = false;
            deg.set(ka, deg.get(ka) - 1); deg.set(kb, deg.get(kb) - 1);
        }
    }

    // ── 2. Måla gator + körfält (högertrafik) ──
    for (const s of segs) {
        if (!s.keep) continue;
        if (s.o === 'v') {
            for (let y = s.a; y <= s.b + 1; y++) for (const c of [s.line, s.line + 1]) {
                tiles[idx(c, y)] = T.ROAD;
                lanes[idx(c, y)] |= 1 << (c === s.line ? S : N);
            }
        } else {
            for (let x = s.a; x <= s.b + 1; x++) for (const r of [s.line, s.line + 1]) {
                tiles[idx(x, r)] = T.ROAD;
                lanes[idx(x, r)] |= 1 << (r === s.line ? W : E);
            }
        }
    }

    // ── 3. Vatten och yttre mur ──
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) {
        if (x >= W_ - 3 || y >= H_ - 3) tiles[idx(x, y)] = T.WATER;
        else if (x === 0 || y === 0) tiles[idx(x, y)] = T.WALL;
    }

    // ── 4. Trottoarer längs gator och kajer ──
    const toSidewalk = [];
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) {
        const t = tiles[idx(x, y)];
        if (t !== T.GRASS) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nt = inBounds(x + dx, y + dy) ? tiles[idx(x + dx, y + dy)] : T.WALL;
            if (nt === T.ROAD || (nt === T.WATER && (dx === 0 || dy === 0))) { near = true; break; }
        }
        if (near) toSidewalk.push(idx(x, y));
    }
    toSidewalk.forEach(i => { tiles[i] = T.SIDEWALK; });

    // ── 5. Kvarter = rektanglar av kvarvarande gräs ──
    const visited = new Uint8Array(W_ * H_);
    const blocks = [];
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) {
        if (tiles[idx(x, y)] !== T.GRASS || visited[idx(x, y)]) continue;
        let w = 0;
        while (x + w < W_ && tiles[idx(x + w, y)] === T.GRASS && !visited[idx(x + w, y)]) w++;
        let h = 1;
        for (;;) {
            if (y + h >= H_) break;
            let ok = true;
            for (let i = 0; i < w; i++) if (tiles[idx(x + i, y + h)] !== T.GRASS || visited[idx(x + i, y + h)]) { ok = false; break; }
            if (!ok) break;
            h++;
        }
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) visited[idx(x + i, y + j)] = 1;
        blocks.push({ x, y, w, h, district: districtOfTile(x + (w >> 1), y + (h >> 1)) });
    }

    const buildings = [];
    const addBuilding = (x, y, w, h, district, extra = {}) => {
        const pal = PALETTES[district];
        const roof = rng.pick(pal.roofs);
        const b = {
            id: buildings.length, x, y, w, h, district,
            height: rng.range(pal.h[0], pal.h[1]) * (1 + Math.min(w, h) * 0.03),
            roof, roofDark: shade(roof, 0.82), wall: shade(roof, 0.55), wallLight: shade(roof, 0.7),
            details: Array.from({ length: Math.min(4, Math.floor(w * h / 3)) }, () => ({ u: rng.range(0.15, 0.75), v: rng.range(0.15, 0.75), s: rng.range(0.1, 0.22) })),
            ...extra
        };
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { tiles[idx(x + i, y + j)] = T.BUILDING; bld[idx(x + i, y + j)] = b.id; }
        buildings.push(b);
        return b;
    };

    // Dela kvarter i flera hus med olika höjd, ibland med en gränd emellan
    const splitInto = (r, depth) => {
        const vertical = r.w >= r.h;
        const len = vertical ? r.w : r.h;
        if (depth < 3 && len >= 4 && rng.chance(depth === 0 ? 0.85 : 0.6)) {
            const alley = len >= 6 && rng.chance(0.45) ? 1 : 0;
            const cut = rng.int(2, len - 2 - alley);
            if (alley) {
                for (let k = 0; k < (vertical ? r.h : r.w); k++) {
                    const tx = vertical ? r.x + cut : r.x + k, ty = vertical ? r.y + k : r.y + cut;
                    tiles[idx(tx, ty)] = T.SIDEWALK; // gränd
                }
            }
            if (vertical) {
                splitInto({ ...r, w: cut }, depth + 1);
                splitInto({ ...r, x: r.x + cut + alley, w: r.w - cut - alley }, depth + 1);
            } else {
                splitInto({ ...r, h: cut }, depth + 1);
                splitInto({ ...r, y: r.y + cut + alley, h: r.h - cut - alley }, depth + 1);
            }
            return;
        }
        addBuilding(r.x, r.y, r.w, r.h, r.district);
    };

    // Högkvarteret: kvarteret närmast mitten blir parkering med HQ-hus
    const valid = blocks.filter(b => b.w >= 3 && b.h >= 4);
    const homeBlock = valid.reduce((best, b) => {
        const d = Math.hypot(b.x + b.w / 2 - 31, b.y + b.h / 2 - 31);
        return !best || d < best.d ? { b, d } : best;
    }, null).b;

    const lotSpots = [];
    const homeParking = [];
    for (const b of blocks) {
        const fill = (t) => { for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) tiles[idx(b.x + i, b.y + j)] = t; };
        if (b === homeBlock) {
            fill(T.LOT);
            const bh = Math.max(1, Math.floor(b.h * 0.35));
            addBuilding(b.x, b.y, b.w, bh, b.district, { label: 'HQ', icon: '🏠', hq: true, height: 0.16 });
            for (let j = bh + 1; j < b.h; j += 2) for (let i = 0; i < b.w; i++) {
                homeParking.push({ x: center(b.x + i), y: center(b.y + j), angle: -Math.PI / 2 });
            }
            continue;
        }
        const r = rng();
        const parkChance = PALETTES[b.district].park;
        const lotChance = PALETTES[b.district].lot;
        if (b.w < 2 || b.h < 2 || r < parkChance) {
            // Park med träd
            for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
                const tx = b.x + i, ty = b.y + j;
                const nearTree = tiles[idx(tx - 1, ty)] === T.TREE || tiles[idx(tx, ty - 1)] === T.TREE;
                if (!nearTree && rng.chance(0.22)) tiles[idx(tx, ty)] = T.TREE;
            }
        } else if (r < parkChance + lotChance) {
            fill(T.LOT);
            for (let j = 0; j < b.h; j += 2) for (let i = 0; i < b.w; i++) {
                if (rng.chance(0.45)) lotSpots.push({ x: center(b.x + i), y: center(b.y + j), angle: rng.chance(0.5) ? -Math.PI / 2 : Math.PI / 2 });
            }
        } else if (r < parkChance + lotChance + 0.05) {
            fill(T.PLAZA);
        } else {
            splitInto(b, 0);
        }
    }

    // ── 6. Specialplatser ──
    const used = [];
    const farFromUsed = (tx, ty, min) => used.every(u => Math.abs(u[0] - tx) + Math.abs(u[1] - ty) >= min);
    const isCurb = (tx, ty) => {
        if (tileAt({ tiles }, tx, ty) !== T.SIDEWALK) return false;
        for (let d = 0; d < 4; d++) if (tileAt({ tiles }, tx + DX[d], ty + DY[d]) === T.ROAD) return true;
        return false;
    };
    const nextToBuilding = (tx, ty) => {
        for (let d = 0; d < 4; d++) if (tileAt({ tiles }, tx + DX[d], ty + DY[d]) === T.BUILDING) return true;
        return false;
    };
    const curbs = [];
    for (let y = 1; y < H_ - 1; y++) for (let x = 1; x < W_ - 1; x++) if (isCurb(x, y)) curbs.push([x, y]);

    const nearestCurb = (px, py, pred = () => true, min = 5) => {
        let best = null, bd = Infinity;
        for (const [x, y] of curbs) {
            if (!pred(x, y) || !farFromUsed(x, y, min)) continue;
            const d = Math.hypot(x - px, y - py);
            if (d < bd) { bd = d; best = [x, y]; }
        }
        if (best) used.push(best);
        return best;
    };
    const mk = (t, extra) => t ? { tx: t[0], ty: t[1], x: center(t[0]), y: center(t[1]), ...extra } : null;

    // Spawn på HQ-parkeringen
    const spawnTile = [homeBlock.x + (homeBlock.w >> 1), homeBlock.y + homeBlock.h - 1];
    used.push(spawnTile);
    const home = mk(spawnTile, { kind: 'home', label: 'HQ', icon: '🏠' });
    const spawn = { x: home.x, y: home.y };
    // Langaren står en bit bort på HQ-parkeringen, inte där du kliver ut
    let dealerTile = null;
    for (let r = 3; r <= 6 && !dealerTile; r++) {
        for (const [dx, dy] of [[-r, 0], [r, 0], [0, -r], [-r, -1], [r, -1]]) {
            const tx = spawnTile[0] + dx, ty = spawnTile[1] + dy;
            if (WALKABLE.has(tileAt({ tiles }, tx, ty))) { dealerTile = [tx, ty]; break; }
        }
    }
    const dealer = mk(dealerTile || [spawnTile[0], spawnTile[1] - 2], { kind: 'dealer', label: 'LANGAREN', icon: '🎒' });
    used.push([dealer.tx, dealer.ty]);
    homeParking.sort((a, b) => Math.hypot(a.x - spawn.x, a.y - spawn.y) - Math.hypot(b.x - spawn.x, b.y - spawn.y));
    const nearSpots = homeParking.filter(p => Math.hypot(p.x - spawn.x, p.y - spawn.y) > TILE * 0.5).slice(0, 10);
    homeParking.length = 0;
    homeParking.push(...nearSpots);

    // En telefonkiosk per gäng, mitt i deras turf
    const phones = GANGS.map(g => {
        const [cx, cy] = TURF_CENTER[g.district];
        return mk(nearestCurb(cx, cy, (x, y) => districtOfTile(x, y) === g.district), { kind: 'phone', gang: g.id });
    });
    const sprays = [
        mk(nearestCurb(12, 52, (x, y) => districtOfTile(x, y) === 'orten' && nextToBuilding(x, y)), { kind: 'spray', label: 'LACK', icon: '🎨' }),
        mk(nearestCurb(50, 24, (x, y) => districtOfTile(x, y) === 'skogsbacken' && nextToBuilding(x, y)), { kind: 'spray', label: 'LACK', icon: '🎨' })
    ];
    const fence = mk(nearestCurb(54, 57, (x, y) => districtOfTile(x, y) === 'hamnen'), { kind: 'fence', label: 'SKROT', icon: '🔧' });
    // Nattklubben (dejter) i Centrum och vapenlangaren i Industrin
    const club = mk(nearestCurb(36, 10, (x, y) => districtOfTile(x, y) === 'centrum' && nextToBuilding(x, y)), { kind: 'club', label: 'NATTKLUBBEN', icon: '🍾' });
    const guns = mk(nearestCurb(26, 54, (x, y) => districtOfTile(x, y) === 'industrin' && nextToBuilding(x, y)), { kind: 'guns', label: 'PANG-PELLE', icon: '🔫' });

    // Företagsplatser: byggnader med trottoar mot gatan
    const businesses = [];
    const taken = new Set();
    BUSINESS_DISTRICTS.forEach((district, slot) => {
        const cands = buildings.filter(b => b.district === district && !b.hq && !taken.has(b.id));
        cands.sort(() => rng() - 0.5);
        for (const b of cands) {
            let spot = null;
            for (let j = -1; j <= b.h && !spot; j++) for (let i = -1; i <= b.w; i++) {
                const tx = b.x + i, ty = b.y + j;
                if (isCurb(tx, ty) && nextToBuilding(tx, ty) && farFromUsed(tx, ty, 4)) { spot = [tx, ty]; break; }
            }
            if (spot) {
                taken.add(b.id);
                used.push(spot);
                b.shopSlot = slot;
                businesses.push(mk(spot, { kind: 'business', slot, buildingId: b.id }));
                break;
            }
        }
    });

    const places = [];
    for (const district of Object.keys(PLACE_NAMES)) {
        const names = PLACE_NAMES[district].slice();
        const pool = curbs.filter(([x, y]) => districtOfTile(x, y) === district).sort(() => rng() - 0.5);
        for (const [x, y] of pool) {
            if (!names.length) break;
            if (!farFromUsed(x, y, 6)) continue;
            used.push([x, y]);
            places.push(mk([x, y], { kind: 'place', name: names.shift(), district }));
        }
    }

    // Pickup-platser och gatlampor
    const pickupSpots = [];
    const pickupPool = [];
    for (let y = 1; y < H_ - 1; y++) for (let x = 1; x < W_ - 1; x++) {
        const t = tiles[idx(x, y)];
        if (t === T.SIDEWALK || t === T.PLAZA || t === T.GRASS) pickupPool.push([x, y]);
    }
    pickupPool.sort(() => rng() - 0.5);
    for (const [x, y] of pickupPool) {
        if (pickupSpots.length >= 60) break;
        if (pickupSpots.some(p => Math.abs(p.tx - x) + Math.abs(p.ty - y) < 5)) continue;
        pickupSpots.push({ id: pickupSpots.length, tx: x, ty: y, x: center(x), y: center(y) });
    }

    const lights = [];
    for (const x of xs) for (const y of ys) {
        if (tiles[idx(x, y)] !== T.ROAD) continue;
        for (const [cx, cy, ox, oy] of [[x - 1, y - 1, 1, 1], [x + 2, y - 1, 0, 1], [x - 1, y + 2, 1, 0], [x + 2, y + 2, 0, 0]]) {
            if (tileAt({ tiles }, cx, cy) === T.SIDEWALK) lights.push({ x: cx * TILE + ox * TILE, y: cy * TILE + oy * TILE });
        }
    }

    const laneTiles = [];
    const sidewalkTiles = [];
    for (let y = 0; y < H_; y++) for (let x = 0; x < W_; x++) {
        if (lanes[idx(x, y)]) laneTiles.push([x, y]);
        if (tiles[idx(x, y)] === T.SIDEWALK) sidewalkTiles.push([x, y]);
    }

    return {
        seed, w: W_, h: H_, tiles, lanes, bld, buildings, xs, ys,
        spawn, homeParking, lotSpots, pickupSpots, lights, laneTiles, sidewalkTiles,
        markers: { home, dealer, phones, sprays, fence, club, guns, businesses, places }
    };
}
