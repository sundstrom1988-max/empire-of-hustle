// ═══════════════════════════════════════════
//  STAN — fordon
//  Spelarens bilar (från garaget) + trafik,
//  snutbilar, gängbilar och MC-klubbarnas HD.
// ═══════════════════════════════════════════

import { GANGS } from './constants.js';

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

export function vehicleSpeed(v) { return Math.hypot(v.vx, v.vy); }
export function forwardSpeed(v) { return v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle); }

// Bilskroten betalar efter typ och skick
export function fenceValue(v) {
    const frac = Math.max(0, v.hp / v.maxHp);
    return Math.round(v.spec.value * (0.4 + 0.6 * frac) / 10) * 10;
}
