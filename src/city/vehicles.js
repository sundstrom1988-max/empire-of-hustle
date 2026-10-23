// ═══════════════════════════════════════════
//  STAN — fordon
//  Spelarens bilar (från garaget) + trafik,
//  snutbilar, gängbilar och MC-klubbarnas HD.
// ═══════════════════════════════════════════

import { GANGS, TILE, SOLID } from './constants.js';
import { tileAt } from './map.js';
import { distToVehicle } from './physics.js';

export const VEHICLES = {
    cykel: { name: 'Cykel', kind: 'bike', l: 26, w: 10, maxSpeed: 250, accel: 320, brake: 520, turn: 3.8, grip: 10, hp: 40, mass: 0.35, colors: ['#06b6d4'], value: 120, engine: 0 },
    moped: { name: 'Moped EPA', kind: 'bike', l: 30, w: 13, maxSpeed: 310, accel: 330, brake: 520, turn: 3.4, grip: 9, hp: 60, mass: 0.5, colors: ['#f97316'], value: 400, engine: 90 },
    volvo: { name: 'Volvo 240', kind: 'car', l: 44, w: 22, maxSpeed: 350, accel: 240, brake: 540, turn: 2.6, grip: 7, hp: 100, mass: 1, colors: ['#94a3b8', '#7f1d1d', '#1e3a8a', '#e2e8f0', '#365314', '#78350f'], value: 450, engine: 40 },
    taxi: { name: 'Taxi', kind: 'car', l: 44, w: 22, maxSpeed: 360, accel: 250, brake: 540, turn: 2.7, grip: 7, hp: 100, mass: 1, colors: ['#facc15'], value: 550, engine: 42, taxi: true },
    van: { name: 'Skåpbil', kind: 'car', l: 54, w: 25, maxSpeed: 300, accel: 190, brake: 480, turn: 2.2, grip: 6.5, hp: 160, mass: 1.7, colors: ['#f1f5f9', '#475569', '#0f766e'], value: 650, engine: 35 },
    bmw: { name: 'BMW E46', kind: 'car', l: 44, w: 22, maxSpeed: 430, accel: 340, brake: 600, turn: 2.9, grip: 7.5, hp: 110, mass: 1, colors: ['#3b82f6', '#111827', '#e5e7eb'], value: 1500, engine: 48 },
    audi: { name: 'Audi RS6', kind: 'car', l: 47, w: 23, maxSpeed: 455, accel: 375, brake: 620, turn: 2.8, grip: 7.6, hp: 125, mass: 1.15, colors: ['#111827', '#6b7280', '#f8fafc'], value: 2600, engine: 46 },
    hd: { name: 'HD Chopper', kind: 'bike', chopper: true, l: 42, w: 16, maxSpeed: 410, accel: 380, brake: 560, turn: 3.3, grip: 8.5, hp: 90, mass: 0.75, colors: ['#111111', '#1f2937', '#7f1d1d'], value: 3500, engine: 30 },
    mercedes: { name: 'Mercedes AMG', kind: 'car', l: 48, w: 23, maxSpeed: 470, accel: 370, brake: 620, turn: 2.75, grip: 7.5, hp: 140, mass: 1.25, colors: ['#111827', '#9ca3af', '#ef4444'], value: 3000, engine: 44 },
    lambo: { name: 'Lamborghini', kind: 'car', l: 46, w: 24, maxSpeed: 590, accel: 490, brake: 700, turn: 3.1, grip: 8.5, hp: 100, mass: 1, colors: ['#eab308', '#22c55e', '#f97316'], value: 7000, engine: 55, sport: true },
    rolls: { name: 'Rolls Royce', kind: 'car', l: 56, w: 26, maxSpeed: 450, accel: 290, brake: 560, turn: 2.3, grip: 7, hp: 230, mass: 1.9, colors: ['#a855f7', '#111827', '#f5f5f4'], value: 10000, engine: 36 },
    police: { name: 'Snutbil', kind: 'car', l: 46, w: 22, maxSpeed: 460, accel: 360, brake: 620, turn: 3.0, grip: 8, hp: 170, mass: 1.35, colors: ['#f8fafc'], value: 2500, engine: 46, police: true },
    gang_kebab: { name: 'Maffia-BMW', kind: 'car', l: 44, w: 22, maxSpeed: 420, accel: 330, brake: 600, turn: 2.9, grip: 7.5, hp: 130, mass: 1.1, colors: ['#16a34a'], value: 900, engine: 48, gang: 'kebab' },
    gang_orden: { name: 'Mörk Limousin', kind: 'car', l: 52, w: 23, maxSpeed: 420, accel: 300, brake: 560, turn: 2.6, grip: 7.2, hp: 150, mass: 1.4, colors: ['#4c1d95'], value: 1100, engine: 38, gang: 'orden' },
    gang_taco: { name: 'Lowrider', kind: 'car', l: 48, w: 23, maxSpeed: 410, accel: 300, brake: 560, turn: 2.8, grip: 7, hp: 130, mass: 1.2, colors: ['#ea580c'], value: 950, engine: 40, gang: 'taco' }
};

// Spelarens bilar i garaget heter samma som i gameData.CARS
export const PLAYER_CAR_IDS = ['cykel', 'moped', 'bmw', 'mercedes', 'lambo', 'rolls'];

const TRAFFIC_MIX = {
    vasterort: [['volvo', 30], ['bmw', 20], ['audi', 16], ['mercedes', 10], ['van', 10], ['taxi', 6], ['moped', 8]],
    centrum: [['volvo', 24], ['taxi', 22], ['van', 8], ['bmw', 12], ['audi', 8], ['mercedes', 14], ['lambo', 6], ['rolls', 6]],
    skogsbacken: [['volvo', 30], ['audi', 18], ['mercedes', 18], ['bmw', 10], ['rolls', 8], ['lambo', 6], ['taxi', 6], ['cykel', 4]],
    orten: [['volvo', 45], ['van', 14], ['taxi', 6], ['bmw', 14], ['audi', 4], ['moped', 10], ['mercedes', 5], ['lambo', 1], ['rolls', 1]],
    industrin: [['van', 40], ['volvo', 30], ['bmw', 8], ['audi', 8], ['moped', 6], ['taxi', 6], ['mercedes', 2]],
    hamnen: [['volvo', 32], ['van', 38], ['taxi', 6], ['bmw', 10], ['mercedes', 8], ['lambo', 2], ['rolls', 2], ['moped', 2]]
};

export function pickTrafficType(district, rnd = Math.random) {
    const mix = TRAFFIC_MIX[district] || TRAFFIC_MIX.orten;
    const total = mix.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    for (const [t, w] of mix) { r -= w; if (r <= 0) return t; }
    return mix[0][0];
}

let nextId = 1;

export function createVehicle(type, x, y, angle, opts = {}) {
    const base = VEHICLES[type] || VEHICLES.volvo;
    const pimp = opts.pimp || 0;
    const spec = {
        ...base,
        maxSpeed: base.maxSpeed * (1 + 0.05 * pimp),
        accel: base.accel * (1 + 0.07 * pimp),
        hp: Math.round(base.hp * (1 + 0.15 * pimp))
    };
    const color = opts.color || base.colors[Math.floor((opts.rnd || Math.random)() * base.colors.length)];
    return {
        id: nextId++, ent: 'vehicle', type, spec, x, y, angle,
        vx: 0, vy: 0, spin: 0,
        hp: spec.hp, maxHp: spec.hp,
        color, pimp,
        driver: null,          // null | 'player' | 'traffic' | 'cop' | 'gang'
        ai: null,
        owned: !!opts.owned,
        parked: !!opts.parked,
        wrecked: false, burnT: 0, exploded: false,
        braking: false, siren: false,
        lastHitBy: null,
        gang: base.gang || null,
        tag: opts.tag || null   // uppdragsmarkering
    };
}

// Ett gängs fordon: MC-klubbar kör HD, gatugäng sina bilar i gängets färger
export function createGangVehicle(gangId, x, y, angle, rnd = Math.random, opts = {}) {
    const g = GANGS.find(gg => gg.id === gangId) || GANGS[0];
    const type = g.cars[Math.floor(rnd() * g.cars.length)];
    const color = g.carColors ? g.carColors[Math.floor(rnd() * g.carColors.length)] : undefined;
    const v = createVehicle(type, x, y, angle, { ...opts, rnd, color });
    v.gang = g.id;
    return v;
}

// ── Avstigning: en giltig, fri plats bredvid bilen ──
// Fri = en cirkel med radien r rör ingen solid ruta (hus, vatten, träd, mur) och ingen bil,
// och vägen dit från bilens mitt går inte genom en vägg (man kliver aldrig ut på andra sidan ett hus).
const circleClear = (city, x, y, r) => {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!SOLID.has(tileAt(city, tx, ty))) continue;
        const px = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE)), py = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
        if ((x - px) ** 2 + (y - py) ** 2 < r * r) return false;
    }
    return true;
};
// ...och inte genom en annan bil (står det en bil tätt intill dörren kliver man inte över den)
const pathClear = (city, v, vehicles, x1, y1) => {
    const n = Math.ceil(Math.hypot(x1 - v.x, y1 - v.y) / 4);
    const near = vehicles.filter(o => o !== v && Math.abs(o.x - v.x) < 220 && Math.abs(o.y - v.y) < 220);
    for (let i = 1; i <= n; i++) {
        const x = v.x + (x1 - v.x) * i / n, y = v.y + (y1 - v.y) * i / n;
        if (SOLID.has(tileAt(city, Math.floor(x / TILE), Math.floor(y / TILE)))) return false;
        for (const o of near) if (distToVehicle(o, x, y) < 1) return false;
    }
    return true;
};
export function spotFree(city, vehicles, x, y, r = 7) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !circleClear(city, x, y, r)) return false;
    for (const o of vehicles) if (Math.abs(o.x - x) < 60 && Math.abs(o.y - y) < 60 && distToVehicle(o, x, y) < r + 1) return false;
    return true;
}
// Förarsidan (vänster) först, sedan passagerarsidan, snett fram/bak, bakom, framför — och längre ut
// i en ring om det är trångt. Returnerar { x, y } eller null om det inte finns någon fri plats nära.
export function exitSpot(v, city, vehicles, r = 7) {
    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const lx = fy, ly = -fx;                      // vänster om nosen (y nedåt på skärmen)
    const side = v.spec.w / 2 + r + 3, end = v.spec.l / 2 + r + 3;
    const ok = (x, y) => spotFree(city, vehicles, x, y, r) && pathClear(city, v, vehicles, x, y);
    for (const extra of [0, 10, 22]) {
        const s = side + extra, e = end + extra;
        const cands = [
            [lx * s, ly * s], [-lx * s, -ly * s],                                   // vänster, höger
            [lx * s - fx * 12, ly * s - fy * 12], [lx * s + fx * 12, ly * s + fy * 12],
            [-lx * s - fx * 12, -ly * s - fy * 12], [-lx * s + fx * 12, -ly * s + fy * 12],
            [-fx * e, -fy * e], [fx * e, fy * e]                                    // bakom, framför
        ];
        for (const [dx, dy] of cands) if (ok(v.x + dx, v.y + dy)) return { x: v.x + dx, y: v.y + dy };
    }
    // Trångt: leta i ringar runt bilen, närmast först
    for (let d = Math.max(side, end) + 8; d <= 140; d += 8) {
        for (let k = 0; k < 24; k++) {
            const a = v.angle - Math.PI / 2 + k * Math.PI * 2 / 24;
            const x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d;
            if (ok(x, y)) return { x, y };
        }
    }
    return null;
}

export function vehicleSpeed(v) { return Math.hypot(v.vx, v.vy); }
export function forwardSpeed(v) { return v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle); }

// Bilskroten betalar efter typ och skick
export function fenceValue(v) {
    const frac = Math.max(0, v.hp / v.maxHp);
    return Math.round(v.spec.value * (0.4 + 0.6 * frac) / 10) * 10;
}
