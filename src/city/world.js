// ═══════════════════════════════════════════
//  STAN — världen
//  Allt som händer i stan simuleras här. Ingen
//  DOM: ljud, meddelanden och storskärmstext
//  skickas som events som index.js tar hand om.
// ═══════════════════════════════════════════

import { TILE, T, DX, DY, DIR_ANGLE, GANGS, DISTRICTS } from './constants.js';
import { tileAt, laneDirs, districtAt, flowField, isSolidAt, isWalkableTile } from './map.js';
import { createVehicle, pickTrafficType, fenceValue, VEHICLES } from './vehicles.js';
import { stepVehicle, collideVehicles, stepWalker, distToVehicle, impactDamage, collideCircleWithMap } from './physics.js';
import { initLaneAI, laneControl, chaseControl, pedControl, createPed, lineClear } from './ai.js';
import { createWanted, addHeat, stars, updateWanted, copTarget, copSpeedFactor, clearWanted, CRIME } from './wanted.js';
import { createMission, updateMission, applyRespect, phoneOpen, isHostile, gangById } from './missions.js';
import { mulberry32 } from './rng.js';
import { SHOPS } from '../data/gameData.js';

export const CLOCK_START = 19.5; // 19:30 — kvällen är ung
const NO_INPUT = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false };
const PICKUP_TYPES = [['cash', 45], ['repair', 15], ['nitro', 15], ['bribe', 12], ['health', 13]];
const GANG_RADIO = { kebab: 1, orden: 2, taco: 0 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const center = t => t * TILE + TILE / 2;

function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

export class World {
    constructor(city, profile, opts = {}) {
        this.city = city;
        this.profile = profile;
        this.round = opts.round || 1;
        this.maxMissions = opts.maxMissions ?? 3;
        this.maxFence = opts.maxFence ?? 3;
        this.rnd = opts.rnd || Math.random;
        this.time = 0;
        this.events = [];
        this.vehicles = [];
        this.peds = [];
        this.particles = [];
        this.skids = [];
        this.floaters = [];
        this.flashes = [];
        this.scorches = [];
        this.wanted = createWanted();
        this.mission = null;
        this.state = 'play';
        this.stateT = 0;
        this.finished = null;
        this.shake = 0;
        this.flow = null; this.flowT = 0; this.flowKey = -1;
        this.spawnT = 0; this.parkT = 0;
        this.inside = new Set();
        this.parkedSpots = new Map();
        this.district = null;
        this.hint = '';
        this.radioIdx = Math.floor(this.rnd() * 3);
        this.moneyStart = profile.money;
        this.copHitT = 0;
        this.hornT = 0;
        this.lastSkidSfx = 0;
        this.player = {
            x: city.spawn.x, y: city.spawn.y, vx: 0, vy: 0, r: 7, angle: -Math.PI / 2,
            hp: 100, maxHp: 100, vehicle: null, dead: false, nitro: 0, walkPhase: 0, bustT: 0, hitT: 0,
            charIcon: profile.char?.icon || '😎', color: profile.char?.color || '#ff4fd8'
        };
        this.setupOwnedCars();
        this.setupPickups();
        this.updateDistrict();
    }

    // ── Events till UI/ljud ──
    emit(e) { this.events.push(e); if (this.events.length > 200) this.events.shift(); }
    sfxAt(name, x, y, vol = 1) {
        const d = Math.hypot(x - this.player.x, y - this.player.y);
        const v = vol * clamp(1 - d / 900, 0, 1);
        if (v > 0.05) this.emit({ type: 'sfx', name, vol: v });
    }
    sfx(name, vol = 1) { this.emit({ type: 'sfx', name, vol }); }
    message(text) { this.emit({ type: 'msg', text }); }
    notify(text) { this.message(text); }
    big(text, color = '#ffd23f', sub = '') { this.emit({ type: 'big', text, color, sub }); }
    floater(x, y, text, color = '#ffd23f') { this.floaters.push({ x, y, text, color, life: 1.6 }); }

    addMoney(n, x = this.player.x, y = this.player.y) {
        n = Math.round(n);
        this.profile.money = Math.max(0, (this.profile.money || 0) + n);
        if (n > 0) this.profile.totalEarned = (this.profile.totalEarned || 0) + n;
        this.floater(x, y - 20, (n >= 0 ? '+' : '') + n.toLocaleString('sv-SE') + ' kr', n >= 0 ? '#ffd23f' : '#ef4444');
    }
    spend(n) {
        if ((this.profile.money || 0) < n) return false;
        this.profile.money -= n;
        this.profile.totalSpent = (this.profile.totalSpent || 0) + n;
        return true;
    }

    // ── Klocka och ljus ──
    hour() { return (CLOCK_START + this.time / 24) % 24; }
    darkness() {
        const h = this.hour();
        const NIGHT = 0.6;
        if (h >= 21 || h < 5) return NIGHT;
        if (h >= 18) return (h - 18) / 3 * NIGHT;
        if (h < 7) return (7 - h) / 2 * NIGHT;
        return 0;
    }

    // ── Uppstart ──
    setupOwnedCars() {
        const p = this.profile;
        const ids = (p.cars || []).filter(id => VEHICLES[id]);
        const spots = this.city.homeParking;
        const list = ids.length ? ids : ['volvo'];
        list.forEach((id, i) => {
            const s = spots[i % spots.length];
            const v = createVehicle(id, s.x, s.y, s.angle, { owned: true, parked: true, pimp: p.carPimps?.[id] || 0, rnd: this.rnd });
            v.persistent = true;
            if (!ids.length) { v.spec.name = 'Morsans Volvo'; v.color = '#8b5e3c'; }
            v.radio = this.radioIdx;
            this.vehicles.push(v);
        });
    }

    setupPickups() {
        const taken = new Set(this.profile.cityPickupsTaken || []);
        const r = mulberry32(hashStr(String(this.profile.charKey)) + this.round * 7919);
        const spots = [...this.city.pickupSpots];
        for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
        const total = PICKUP_TYPES.reduce((s, [, w]) => s + w, 0);
        this.pickups = spots.slice(0, 24).map(s => {
            let x = r() * total, type = 'cash';
            for (const [t, w] of PICKUP_TYPES) { x -= w; if (x <= 0) { type = t; break; } }
            return { id: s.id, x: s.x, y: s.y, type, phase: r() * 6, taken: taken.has(s.id) };
        });
    }

    // ── Huvudsteget ──
    update(dt, input = NO_INPUT) {
        this.time += dt;
        this.shake = Math.max(0, this.shake - dt * 2.5);
        this.copHitT = Math.max(0, this.copHitT - dt);
        this.hornT = Math.max(0, this.hornT - dt);
        const playing = this.state === 'play';
        if (!playing) {
            this.stateT += dt;
            if (this.stateT > 3.8 && !this.finished) this.finished = this.state;
        }
        this.updatePlayer(dt, playing ? input : NO_INPUT);
        this.updateFlow(dt);
        this.manageSpawns(dt);
        this.updateVehicles(dt);
        this.updatePeds(dt);
        this.resolveCollisions();
        this.updateFires(dt);
        if (playing) {
            this.updateInteractions();
            this.updateMissionState(dt);
            this.updateWantedState(dt);
        }
        this.updateParticles(dt);
        this.updateDistrict();
        this.updateHint();
    }

    // ── Spelaren ──
    updatePlayer(dt, input) {
        const p = this.player;
        p.nitro = Math.max(0, p.nitro - dt);
        p.hitT = Math.max(0, p.hitT - dt);
        if (p.vehicle) {
            const v = p.vehicle;
            const ctl = { throttle: input.throttle, steer: input.steer, handbrake: input.handbrake, nitro: p.nitro > 0 && input.throttle > 0 };
            const res = stepVehicle(v, ctl, dt, this.city);
            this.afterStep(v, res, true);
            if (ctl.nitro && this.rnd() < 0.6) this.spawnParticle('nitro', v.x - Math.cos(v.angle) * v.spec.l / 2, v.y - Math.sin(v.angle) * v.spec.l / 2);
            p.x = v.x; p.y = v.y; p.angle = v.angle;
            if (input.horn && this.hornT <= 0) { this.sfx('horn', 0.8); this.hornT = 0.45; this.scarePeds(v.x, v.y, 160); }
            if (input.action) this.exitVehicle();
        } else if (!p.dead) {
            const speed = input.run ? 175 : 115;
            stepWalker(p, input.mx, input.my, speed, dt, this.city);
            if (Math.hypot(input.mx, input.my) > 0.1) p.walkPhase += dt * speed * 0.12;
            if (input.action) this.tryEnterVehicle();
        }
    }

    afterStep(v, res, isPlayer) {
        if (res.impact > 60 && isPlayer) this.shake = Math.max(this.shake, Math.min(1, res.impact / 600));
        if (res.impact > 140) {
            this.damageVehicle(v, impactDamage(res.impact), null);
            this.sfxAt('crash', v.x, v.y, Math.min(1, res.impact / 500));
            for (let i = 0; i < 6; i++) this.spawnParticle('spark', v.x + Math.cos(v.angle) * v.spec.l / 2, v.y + Math.sin(v.angle) * v.spec.l / 2);
        }
        const speed = Math.hypot(v.vx, v.vy);
        if (res.skid && speed > 100) {
            const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
            const back = v.spec.l / 2 - 7, side = v.spec.w / 2 - 3;
            const wheels = [
                [v.x - fx * back - fy * side, v.y - fy * back + fx * side],
                [v.x - fx * back + fy * side, v.y - fy * back - fx * side]
            ];
            if (v._skidPrev) {
                wheels.forEach((w, i) => this.skids.push({ x1: v._skidPrev[i][0], y1: v._skidPrev[i][1], x2: w[0], y2: w[1], life: 14 }));
                if (this.skids.length > 600) this.skids.splice(0, this.skids.length - 600);
            }
            v._skidPrev = wheels;
            if (isPlayer && this.time - this.lastSkidSfx > 0.22) { this.sfx('skid', 0.7); this.lastSkidSfx = this.time; }
            if (this.rnd() < 0.3) this.spawnParticle('smoke', wheels[0][0], wheels[0][1], 0.5);
        } else {
            v._skidPrev = null;
        }
    }

    nearestVehicle(x, y, maxD) {
        let best = null, bd = maxD;
        for (const v of this.vehicles) {
            if (v.exploded) continue;
            const d = distToVehicle(v, x, y);
            if (d < bd) { bd = d; best = v; }
        }
        return best;
    }

    tryEnterVehicle() {
        const p = this.player;
        const v = this.nearestVehicle(p.x, p.y, 38);
        if (!v) return;
        if (v.wrecked) { this.message(v.burnT > 0 ? '🔥 Den brinner, bram! Spring!' : '💀 Den där är kvaddad.'); return; }
        const copWitness = this.copNear(520, true);
        if (v.driver && v.driver !== 'player') {
            const wasCop = v.driver === 'cop';
            this.ejectDriver(v);
            addHeat(this.wanted, wasCop ? CRIME.copCar : CRIME.carjack, copWitness || wasCop);
            this.message(wasCop ? '🚔 Du snodde en SNUTBIL! Galen.' : `🚗 Carjack! Föraren springer för livet.`);
        } else if (v.spec.police) {
            addHeat(this.wanted, CRIME.copCar, true);
            this.message('🚔 Du snodde en SNUTBIL!');
        }
        v.driver = 'player';
        v.ai = null;
        v.parked = false;
        v.siren = false;
        if (v.spotKey !== undefined) { this.parkedSpots.delete(v.spotKey); v.spotKey = undefined; }
        if (v.radio === undefined) v.radio = v.spec.gang ? GANG_RADIO[v.spec.gang] : Math.floor(this.rnd() * 3);
        p.vehicle = v;
        this.sfx('door');
        this.emit({ type: 'enterCar', vehicle: v });
    }

    ejectDriver(v) {
        const side = this.sideSpot(v, 1) || { x: v.x, y: v.y };
        const ped = createPed(side.x, side.y, this.rnd, { shirt: v.driver === 'cop' ? '#1e3a8a' : v.spec.gang ? gangById(v.spec.gang).color : undefined, cop: v.driver === 'cop' });
        ped.mode = 'flee'; ped.t = 3; ped.angle = v.angle + Math.PI / 2;
        this.peds.push(ped);
        v.driver = null;
        v.ai = null;
    }

    // Punkt bredvid bilen (vänster = förarsidan), som inte är inne i en vägg
    sideSpot(v, prefer = -1) {
        const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
        const off = v.spec.w / 2 + 10;
        const cands = [
            [v.x + fy * off * prefer, v.y - fx * off * prefer],
            [v.x - fy * off * prefer, v.y + fx * off * prefer],
            [v.x + fx * (v.spec.l / 2 + 10), v.y + fy * (v.spec.l / 2 + 10)],
            [v.x - fx * (v.spec.l / 2 + 10), v.y - fy * (v.spec.l / 2 + 10)]
        ];
        for (const [x, y] of cands) if (!isSolidAt(this.city, x, y)) return { x, y };
        return null;
    }

    exitVehicle() {
        const p = this.player, v = p.vehicle;
        if (!v) return;
        const speed = Math.hypot(v.vx, v.vy);
        if (speed > 160 && !v.wrecked) { this.message('🚗 Sakta ner först!'); return; }
        const spot = this.sideSpot(v, 1) || { x: v.x, y: v.y };
        p.vehicle = null;
        p.x = spot.x; p.y = spot.y; p.vx = v.vx * 0.3; p.vy = v.vy * 0.3;
        v.driver = null;
        this.sfx('door');
        this.emit({ type: 'exitCar' });
    }

    scarePeds(x, y, r) {
        for (const ped of this.peds) {
            if (ped.down > 0) continue;
            const dx = ped.x - x, dy = ped.y - y;
            if (dx * dx + dy * dy < r * r) { ped.mode = 'flee'; ped.t = 2; ped.angle = Math.atan2(dy, dx); }
        }
    }

    // ── Hjälpfunktioner för uppdrag ──
    playerVehicle() { return this.player.vehicle; }

    findSpot(x, y, minD, maxD) {
        const tiles = this.city.laneTiles;
        for (let tries = 0; tries < 80; tries++) {
            const [tx, ty] = tiles[Math.floor(this.rnd() * tiles.length)];
            const cx = center(tx), cy = center(ty);
            const d = Math.hypot(cx - x, cy - y);
            if (d < minD || d > maxD) continue;
            if (this.vehicles.some(v => Math.abs(v.x - cx) < 80 && Math.abs(v.y - cy) < 80)) continue;
            const mask = laneDirs(this.city, tx, ty);
            const dirs = [0, 1, 2, 3].filter(dd => (mask & (1 << dd)) && tileAt(this.city, tx + DX[dd], ty + DY[dd]) === T.ROAD);
            if (!dirs.length) continue;
            const dir = dirs[Math.floor(this.rnd() * dirs.length)];
            return { x: cx, y: cy, angle: DIR_ANGLE[dir], tx, ty, dir };
        }
        return null;
    }

    spawnMissionVehicle(type, spot, tag) {
        const v = createVehicle(type, spot.x, spot.y, spot.angle ?? 0, { parked: tag === 'steal', rnd: this.rnd });
        v.tag = tag;
        v.persistent = true;
        if (tag === 'smash' && spot.tx !== undefined) {
            v.driver = 'gang';
            initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
        }
        this.vehicles.push(v);
        return v;
    }

    removeVehicle(v) {
        if (this.player.vehicle === v) {
            const spot = this.sideSpot(v, 1) || { x: v.x, y: v.y };
            this.player.vehicle = null;
            this.player.x = spot.x; this.player.y = spot.y;
            this.emit({ type: 'exitCar' });
        }
        const i = this.vehicles.indexOf(v);
        if (i >= 0) this.vehicles.splice(i, 1);
        if (v.spotKey !== undefined) this.parkedSpots.delete(v.spotKey);
    }

    startMission(m) {
        this.mission = m;
        this.profile.missionsThisRound = (this.profile.missionsThisRound || 0) + 1;
        this.big(m.title.toUpperCase(), gangById(m.gang).color, `${gangById(m.gang).icon} ${gangById(m.gang).name}`);
    }

    // ── Flödesfält för jakt ──
    updateFlow(dt) {
        this.flowT -= dt;
        const chasing = this.vehicles.some(v => v.ai && v.ai.mode === 'chase');
        if (!chasing && stars(this.wanted) === 0) return;
        const p = this.player;
        const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
        const key = ty * this.city.w + tx;
        if ((key !== this.flowKey && this.flowT <= 0) || !this.flow) {
            if (isWalkableTile(this.city, tx, ty)) {
                this.flow = flowField(this.city, tx, ty, 70);
                this.flowKey = key;
                this.flowT = 0.3;
            }
        }
    }

    // ── Spawna/despawna trafik, snut, folk ──
    manageSpawns(dt) {
        this.spawnT -= dt;
        this.parkT -= dt;
        if (this.spawnT > 0) return;
        this.spawnT = 0.25;
        const p = this.player;
        const dist = e => Math.hypot(e.x - p.x, e.y - p.y);

        // Städa bort det som är långt borta
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            if (v === p.vehicle || v.persistent) continue;
            const d = dist(v);
            if (d > 1900 || (v.exploded && v.hulkT > 30 && d > 700) || (v.ai && v.ai.lost && d > 900)) this.removeVehicle(v);
        }
        for (let i = this.peds.length - 1; i >= 0; i--) if (dist(this.peds[i]) > 1250) this.peds.splice(i, 1);

        const district = this.district || 'orten';
        const s = stars(this.wanted);

        // Trafik
        const traffic = this.vehicles.filter(v => (v.driver === 'traffic' || v.driver === 'gang') && dist(v) < 1500).length;
        const want = district === 'centrum' ? 20 : 16;
        if (traffic < want) {
            const spot = this.findSpot(p.x, p.y, 760, 1350);
            if (spot) {
                const gang = DISTRICTS[districtAt(this.city, spot.x, spot.y)].gang;
                const isGang = this.rnd() < 0.18;
                const type = isGang ? 'gang_' + gang : pickTrafficType(districtAt(this.city, spot.x, spot.y), this.rnd);
                const v = createVehicle(type, spot.x, spot.y, spot.angle, { rnd: this.rnd });
                v.driver = isGang ? 'gang' : 'traffic';
                initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
                v.vx = Math.cos(v.angle) * v.ai.cruise * 0.7; v.vy = Math.sin(v.angle) * v.ai.cruise * 0.7;
                this.vehicles.push(v);
            }
        }

        // Snut: två patrullerar alltid, fler kommer med stjärnorna
        const cops = this.vehicles.filter(v => v.driver === 'cop' && !v.wrecked && dist(v) < 1800).length;
        if (cops < Math.max(2, copTarget(s))) {
            const spot = this.findSpot(p.x, p.y, s > 0 ? 650 : 800, s > 0 ? 1150 : 1400);
            if (spot) {
                const v = createVehicle('police', spot.x, spot.y, spot.angle, { rnd: this.rnd });
                v.driver = 'cop';
                initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
                v.vx = Math.cos(v.angle) * 120; v.vy = Math.sin(v.angle) * 120;
                this.vehicles.push(v);
            }
        }

        // Parkerade bilar på parkeringar i närheten
        if (this.parkT <= 0) {
            this.parkT = 1;
            this.city.lotSpots.forEach((spot, i) => {
                if (this.parkedSpots.has(i) || (i * 37 + this.round) % 3 === 0) return;
                const d = Math.hypot(spot.x - p.x, spot.y - p.y);
                if (d < 700 || d > 1300) return;
                const v = createVehicle(pickTrafficType(districtAt(this.city, spot.x, spot.y), this.rnd), spot.x, spot.y, spot.angle, { parked: true, rnd: this.rnd });
                v.spotKey = i;
                this.parkedSpots.set(i, v);
                this.vehicles.push(v);
            });
        }

        // Fotgängare
        const peds = this.peds.filter(e => dist(e) < 1000).length;
        const wantPeds = district === 'centrum' ? 34 : 26;
        for (let k = 0; k < 2 && peds + k < wantPeds; k++) {
            const sw = this.city.sidewalkTiles;
            for (let tries = 0; tries < 12; tries++) {
                const [tx, ty] = sw[Math.floor(this.rnd() * sw.length)];
                const x = center(tx) + (this.rnd() - 0.5) * 30, y = center(ty) + (this.rnd() - 0.5) * 30;
                const d = Math.hypot(x - p.x, y - p.y);
                if (d < 520 || d > 980) continue;
                const dId = districtAt(this.city, x, y);
                const gang = this.rnd() < 0.15 ? DISTRICTS[dId].gang : null;
                this.peds.push(createPed(x, y, this.rnd, gang ? { shirt: gangById(gang).color, gang } : {}));
                break;
            }
        }
    }

    // ── Fordon ──
    updateVehicles(dt) {
        const p = this.player;
        const s = stars(this.wanted);
        const sf = copSpeedFactor(s);
        for (const v of this.vehicles) {
            if (v === p.vehicle) continue;
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            if (d > 2000) continue;
            let ctl = null;
            if (!v.wrecked && v.driver && v.ai) {
                if (v.driver === 'cop') {
                    if (s > 0 && !p.dead) {
                        v.ai.mode = 'chase'; v.siren = true;
                        ctl = chaseControl(v, this, dt, sf);
                    } else {
                        if (v.ai.mode === 'chase') { v.ai.mode = 'lane'; v.siren = false; }
                        ctl = laneControl(v, this, dt);
                    }
                } else if (v.driver === 'gang') {
                    const hostile = isHostile(this.profile.respect || {}, v.spec.gang) && !p.dead;
                    if (hostile && (d < 520 || (v.ai.mode === 'chase' && d < 1000))) {
                        if (v.ai.mode !== 'chase') this.sfxAt('horn', v.x, v.y, 0.8);
                        v.ai.mode = 'chase';
                        ctl = chaseControl(v, this, dt, 0.85);
                    } else {
                        v.ai.mode = 'lane';
                        ctl = laneControl(v, this, dt);
                    }
                } else {
                    ctl = laneControl(v, this, dt);
                }
            }
            const res = stepVehicle(v, ctl, dt, this.city);
            if (res.impact > 140) this.afterStep(v, res, false);
            else if (res.skid) this.afterStep(v, res, false);
            if (v.exploded) v.hulkT = (v.hulkT || 0) + dt;
        }
    }

    damageVehicle(v, amount, by) {
        if (v.wrecked || amount <= 0) return;
        v.hp -= amount;
        if (by) v.lastHitBy = by;
        if (v.hp <= 0) {
            v.hp = 0;
            v.wrecked = true;
            v.burnT = 4;
            v.siren = false;
            if (v.driver && v.driver !== 'player') this.ejectDriver(v);
            if (v.lastHitBy === 'player') {
                addHeat(this.wanted, v.spec.police ? CRIME.copWreck : CRIME.wreck, this.copNear(600, false));
                const st = this.profile.cityStats;
                if (st) st.wrecks = (st.wrecks || 0) + 1;
            }
            if (v === this.player.vehicle) this.message('🔥 Bilen brinner! Hoppa ut — tryck E!');
            this.sfxAt('crash', v.x, v.y, 1);
        }
    }

    // ── Fotgängare ──
    updatePeds(dt) {
        for (const ped of this.peds) {
            if (ped.down > 0) {
                ped.down -= dt;
                ped.vx *= Math.max(0, 1 - 4 * dt); ped.vy *= Math.max(0, 1 - 4 * dt);
                ped.x += ped.vx * dt; ped.y += ped.vy * dt;
                collideCircleWithMap(ped, ped.r, this.city);
                if (ped.down <= 0) { ped.mode = 'flee'; ped.t = 2; }
                continue;
            }
            const c = pedControl(ped, this, dt);
            stepWalker(ped, c.mx, c.my, c.speed, dt, this.city);
            ped.phase += dt * c.speed * 0.12;
        }
    }

    knockPed(ped, v) {
        ped.down = 3 + this.rnd() * 2;
        ped.vx = v.vx * 0.7; ped.vy = v.vy * 0.7;
        ped.mode = 'down';
        this.sfxAt('punch', ped.x, ped.y, 0.9);
        this.spawnParticle('stars', ped.x, ped.y);
    }

    // ── Krockar ──
    resolveCollisions() {
        const p = this.player;
        const vs = this.vehicles.filter(v => Math.abs(v.x - p.x) < 1600 && Math.abs(v.y - p.y) < 1600);
        for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
                const a = vs[i], b = vs[j];
                const impact = collideVehicles(a, b);
                if (impact <= 0) continue;
                const playerCar = a.driver === 'player' ? a : b.driver === 'player' ? b : null;
                const other = playerCar === a ? b : a;
                if (playerCar) {
                    other.lastHitBy = 'player';
                    if (impact > 60) this.shake = Math.max(this.shake, Math.min(0.9, impact / 700));
                    if (other.driver === 'cop' && impact > 90 && this.copHitT <= 0) {
                        addHeat(this.wanted, CRIME.copHit, true);
                        this.copHitT = 1;
                    }
                    if (other.driver === 'traffic' && other.ai) other.ai.hornT = 0;
                }
                if (impact > 120) {
                    const dmg = impactDamage(impact);
                    this.damageVehicle(a, dmg * Math.sqrt(b.spec.mass / a.spec.mass), playerCar && a !== playerCar ? 'player' : null);
                    this.damageVehicle(b, dmg * Math.sqrt(a.spec.mass / b.spec.mass), playerCar && b !== playerCar ? 'player' : null);
                }
                if (impact > 60) {
                    this.sfxAt('crash', (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, impact / 450));
                    for (let k = 0; k < 4; k++) this.spawnParticle('spark', (a.x + b.x) / 2, (a.y + b.y) / 2);
                }
            }
        }
        // Bilar mot fotgängare
        for (const ped of this.peds) {
            if (ped.down > 0) continue;
            for (const v of vs) {
                if (Math.abs(v.x - ped.x) > 50 || Math.abs(v.y - ped.y) > 50) continue;
                const d = distToVehicle(v, ped.x, ped.y);
                if (d >= ped.r) continue;
                const sp = Math.hypot(v.vx, v.vy);
                if (sp > 55) {
                    this.knockPed(ped, v);
                    if (v.driver === 'player') addHeat(this.wanted, CRIME.ped, this.copNear(600, false));
                    v.vx *= 0.94; v.vy *= 0.94;
                } else {
                    const dx = ped.x - v.x, dy = ped.y - v.y, l = Math.hypot(dx, dy) || 1;
                    ped.x += dx / l * 2; ped.y += dy / l * 2;
                }
                break;
            }
        }
        // Bilar mot spelaren till fots
        if (!p.vehicle && !p.dead) {
            for (const v of vs) {
                if (Math.abs(v.x - p.x) > 50 || Math.abs(v.y - p.y) > 50) continue;
                const d = distToVehicle(v, p.x, p.y);
                if (d >= p.r) continue;
                const sp = Math.hypot(v.vx, v.vy);
                if (sp > 70 && p.hitT <= 0) {
                    p.hp -= (sp - 50) * 0.16;
                    p.vx = v.vx * 0.8; p.vy = v.vy * 0.8;
                    p.hitT = 0.6;
                    this.shake = Math.max(this.shake, 0.6);
                    this.sfx('punch');
                    this.spawnParticle('stars', p.x, p.y);
                    if (p.hp <= 0) { p.hp = 0; this.wasted('Överkörd!'); }
                } else {
                    const dx = p.x - v.x, dy = p.y - v.y, l = Math.hypot(dx, dy) || 1;
                    p.x += dx / l * 2.5; p.y += dy / l * 2.5;
                }
            }
        }
    }

    // ── Bränder och explosioner ──
    updateFires(dt) {
        for (const v of this.vehicles) {
            if (v.wrecked && !v.exploded) {
                v.burnT -= dt;
                if (this.rnd() < 0.7) this.spawnParticle('fire', v.x + (this.rnd() - 0.5) * v.spec.w, v.y + (this.rnd() - 0.5) * v.spec.w);
                if (this.rnd() < 0.4) this.spawnParticle('smoke', v.x, v.y, 1.2);
                if (v.burnT <= 0) this.explode(v);
            } else if (!v.wrecked && v.hp < v.maxHp * 0.35 && this.rnd() < 0.15) {
                this.spawnParticle('smoke', v.x + Math.cos(v.angle) * v.spec.l / 3, v.y + Math.sin(v.angle) * v.spec.l / 3, 0.8);
            }
        }
    }

    explode(v) {
        v.exploded = true; v.hulkT = 0;
        v.vx *= 0.2; v.vy *= 0.2;
        const p = this.player;
        const byPlayer = v.lastHitBy === 'player';
        this.sfxAt('explosion', v.x, v.y, 1);
        const d0 = Math.hypot(v.x - p.x, v.y - p.y);
        this.shake = Math.max(this.shake, clamp(1.2 - d0 / 700, 0, 1));
        this.flashes.push({ x: v.x, y: v.y, life: 0.6 });
        this.scorches.push({ x: v.x, y: v.y, r: 46 + this.rnd() * 14 });
        if (this.scorches.length > 30) this.scorches.shift();
        this.particles.push({ type: 'blast', x: v.x, y: v.y, vx: 0, vy: 0, life: 0.7, max: 0.7, size: 130, rot: 0 });
        for (let i = 0; i < 30; i++) this.spawnParticle(i % 3 ? 'fire' : 'debris', v.x, v.y, 1.6);
        for (let i = 0; i < 10; i++) this.spawnParticle('smoke', v.x, v.y, 2);
        const R = 115;
        for (const u of this.vehicles) {
            if (u === v || u.exploded) continue;
            const d = Math.hypot(u.x - v.x, u.y - v.y);
            if (d > R) continue;
            const k = 1 - d / R;
            this.damageVehicle(u, 80 * k, byPlayer ? 'player' : null);
            const l = d || 1;
            u.vx += (u.x - v.x) / l * 260 * k; u.vy += (u.y - v.y) / l * 260 * k;
            u.spin += (this.rnd() - 0.5) * 6 * k;
        }
        for (const ped of this.peds) {
            const d = Math.hypot(ped.x - v.x, ped.y - v.y);
            if (d < R) { ped.down = 4; ped.vx = (ped.x - v.x) / (d || 1) * 200; ped.vy = (ped.y - v.y) / (d || 1) * 200; }
        }
        if (byPlayer) addHeat(this.wanted, CRIME.explosion, this.copNear(700, false));
        if (p.vehicle === v) { p.hp = 0; this.wasted('Du sprängdes i luften!'); }
        else if (!p.vehicle && !p.dead && d0 < R) {
            // Till fots tar du smällen själv; i en hel bil tar bilen den
            p.hp -= 90 * (1 - d0 / R);
            if (p.hp <= 0) { p.hp = 0; this.wasted('Fångad i explosionen!'); }
        }
    }

    // ── Platser, pickups, telefoner ──
    enterZone(key, x, y, r) {
        const p = this.player;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < r) {
            if (this.inside.has(key)) return false;
            this.inside.add(key);
            return true;
        }
        if (d > r + 40) this.inside.delete(key);
        return false;
    }

    updateInteractions() {
        const p = this.player, v = p.vehicle;
        const speed = v ? Math.hypot(v.vx, v.vy) : 0;
        for (const pk of this.pickups) {
            if (!pk.taken && Math.hypot(p.x - pk.x, p.y - pk.y) < (v ? 36 : 26)) this.collectPickup(pk);
        }
        const m = this.city.markers;
        for (const ph of m.phones) {
            if (this.enterZone('phone-' + ph.gang, ph.x, ph.y, 54) && speed < 170) this.answerPhone(ph.gang);
        }
        m.sprays.forEach((sp, i) => { if (v && this.enterZone('spray-' + i, sp.x, sp.y, 66) && speed < 280) this.respray(); });
        if (v && this.enterZone('fence', m.fence.x, m.fence.y, 72) && speed < 280) this.fenceVehicle();
        for (const b of m.businesses) {
            const shop = SHOPS[b.slot];
            if (shop && (this.profile.owned || []).includes(shop.id) && this.enterZone('biz-' + b.slot, b.x, b.y, 62)) this.collectBusiness(shop, b);
        }
    }

    collectPickup(pk) {
        const p = this.player, v = p.vehicle;
        pk.taken = true;
        if (!this.profile.cityPickupsTaken) this.profile.cityPickupsTaken = [];
        this.profile.cityPickupsTaken.push(pk.id);
        switch (pk.type) {
            case 'cash': {
                const amt = Math.round((150 + this.rnd() * 550) * (1 + this.round * 0.05) / 10) * 10;
                this.addMoney(amt, pk.x, pk.y);
                break;
            }
            case 'repair':
                if (v) { v.hp = v.maxHp; this.message('🔧 Bilen är som ny!'); }
                else { p.hp = Math.min(p.maxHp, p.hp + 50); this.message('🔧 Plåster och tejp. +50 hälsa'); }
                break;
            case 'nitro': p.nitro = 7; this.message('⚡ NITRO! Gasa i 7 sekunder!'); this.sfx('nitro'); break;
            case 'bribe':
                this.wanted.heat = Math.max(0, this.wanted.heat - 1);
                this.message('👮 Snuten mutad! En stjärna mindre.');
                break;
            case 'health': p.hp = p.maxHp; this.message('❤️ Full hälsa!'); break;
        }
        this.sfx('pickup');
        for (let i = 0; i < 8; i++) this.spawnParticle('spark', pk.x, pk.y);
    }

    answerPhone(gang) {
        const g = gangById(gang);
        this.sfx('phone');
        if (this.mission) { this.message('📞 Du har redan ett uppdrag på gång!'); return; }
        if (!phoneOpen(this.profile.respect || {}, gang)) { this.message(`📞 *klick* ${g.name} lägger på. De respekterar dig inte.`); return; }
        if ((this.profile.missionsThisRound || 0) >= this.maxMissions) {
            this.message(`📞 ${g.boss}: "Lugna dig, kom tillbaka nästa runda."`);
            return;
        }
        const m = createMission(gang, {
            rng: mulberry32(Math.floor(this.rnd() * 1e9)), round: this.round,
            respect: (this.profile.respect || {})[gang] || 0, city: this.city, from: this.player
        });
        this.emit({ type: 'phone', mission: m });
    }

    respray() {
        const v = this.player.vehicle;
        const s = stars(this.wanted);
        if (s === 0 && v.hp >= v.maxHp) { this.message('🎨 "Bilen ser ju fin ut redan?"'); return; }
        const cost = 150 + 200 * s;
        if (!this.spend(cost)) { this.message(`🎨 Lackningen kostar ${cost} kr — du har inte råd!`); return; }
        clearWanted(this.wanted);
        v.hp = v.maxHp;
        const palette = v.spec.colors.length > 1 ? v.spec.colors : ['#dc2626', '#2563eb', '#16a34a', '#111827', '#f8fafc'];
        v.color = palette[Math.floor(this.rnd() * palette.length)];
        this.sfx('spray');
        this.big('NY LACK!', '#38bdf8', `-${cost} kr · snuten känner inte igen dig`);
    }

    fenceVehicle() {
        const v = this.player.vehicle;
        if (v.owned) { this.message('🔧 "Det där är ju din egen bil, bram!"'); return; }
        if (this.mission && this.mission.car === v) { this.message('🔧 "Den bilen ska till gänget, inte hit!"'); return; }
        if (this.mission && (this.mission.cars || []).includes(v)) { this.message('🔧 "Den där ska krossas, inte säljas!"'); return; }
        if (v.wrecked) { this.message('🔧 "Vi tar inte emot brinnande skrot!"'); return; }
        if ((this.profile.fencedThisRound || 0) >= this.maxFence) { this.message('🔧 "Vi är fulla för idag. Kom tillbaka nästa runda."'); return; }
        const val = fenceValue(v);
        if (v.spec.police) addHeat(this.wanted, 1.2, true);
        this.profile.fencedThisRound = (this.profile.fencedThisRound || 0) + 1;
        const st = this.profile.cityStats; if (st) st.fenced = (st.fenced || 0) + 1;
        this.removeVehicle(v);
        this.addMoney(val);
        this.sfx('coin');
        this.big('SKROTAD!', '#ffd23f', `${v.spec.name} · +${val.toLocaleString('sv-SE')} kr`);
    }

    collectBusiness(shop, mk) {
        if (!this.profile.cityCollected) this.profile.cityCollected = [];
        if (this.profile.cityCollected.includes(shop.id)) { this.message(`${shop.icon} Kassan är redan tömd den här rundan.`); return; }
        const lv = (this.profile.levels || {})[shop.id] || 1;
        const amt = Math.floor(shop.income * lv * 0.3);
        this.profile.cityCollected.push(shop.id);
        this.addMoney(amt, mk.x, mk.y);
        this.sfx('coin');
        this.message(`${shop.icon} ${shop.name}: kassan hämtad! +${amt.toLocaleString('sv-SE')} kr`);
    }

    // ── Uppdrag ──
    updateMissionState(dt) {
        if (!this.mission) return;
        const m = this.mission;
        const r = updateMission(m, this, dt);
        if (r === 'success') {
            this.mission = null;
            this.addMoney(m.payout);
            this.profile.respect = applyRespect(this.profile.respect || {}, m.gang, true);
            this.profile.rep = (this.profile.rep || 0) + 2;
            const st = this.profile.cityStats; if (st) st.missions = (st.missions || 0) + 1;
            this.big('UPPDRAG KLART!', '#22c55e', `+${m.payout.toLocaleString('sv-SE')} kr · +respekt hos ${gangById(m.gang).name}`);
            this.sfx('mission');
            this.emit({ type: 'missionEnd', success: true });
        } else if (r === 'fail') {
            this.mission = null;
            this.profile.respect = applyRespect(this.profile.respect || {}, m.gang, false);
            this.big('MISSLYCKAT', '#ef4444', m.failReason || '');
            this.sfx('fail');
            this.emit({ type: 'missionEnd', success: false });
        }
    }

    // ── Efterlysning, BUSTED ──
    copNear(r, needSight) {
        const p = this.player;
        return this.vehicles.some(v => v.driver === 'cop' && !v.wrecked &&
            Math.abs(v.x - p.x) < r && Math.abs(v.y - p.y) < r &&
            Math.hypot(v.x - p.x, v.y - p.y) < r &&
            (!needSight || lineClear(this.city, v.x, v.y, p.x, p.y)));
    }

    updateWantedState(dt) {
        const p = this.player;
        const before = stars(this.wanted);
        updateWanted(this.wanted, dt, before > 0 && this.copNear(520, true));
        const after = stars(this.wanted);
        if (after !== before) this.emit({ type: 'wanted', stars: after, up: after > before });

        let near = false;
        const pv = p.vehicle;
        for (const v of this.vehicles) {
            if (v.driver !== 'cop' || v.wrecked || !v.ai || v.ai.mode !== 'chase') continue;
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            if (pv ? (d < 88 && Math.hypot(pv.vx, pv.vy) < 35) : d < 64) { near = true; break; }
        }
        if (after > 0 && near) p.bustT += dt;
        else p.bustT = Math.max(0, p.bustT - dt * 2);
        if (p.bustT > (pv ? 1.6 : 0.9)) this.busted();
    }

    busted() {
        if (this.state !== 'play') return;
        this.state = 'busted'; this.stateT = 0;
        this.bustedStars = stars(this.wanted);
        if (this.mission) { this.profile.respect = applyRespect(this.profile.respect || {}, this.mission.gang, false); this.mission = null; }
        if (this.player.vehicle) { this.player.vehicle.vx *= 0.1; this.player.vehicle.vy *= 0.1; }
        this.big('BUSTED', '#60a5fa', 'Snuten satte dig i bojor');
        this.sfx('busted');
    }

    wasted(reason) {
        if (this.state !== 'play') return;
        this.state = 'wasted'; this.stateT = 0;
        this.player.dead = true;
        if (this.mission) { this.profile.respect = applyRespect(this.profile.respect || {}, this.mission.gang, false); this.mission = null; }
        this.big('WASTED', '#ef4444', reason);
        this.sfx('wasted');
    }

    canGoHome() { return this.state === 'play' && stars(this.wanted) === 0; }

    // Att åka hem mitt i ett jobb räknas som ett misslyckat uppdrag
    abandonMission() {
        if (!this.mission) return null;
        const m = this.mission;
        this.mission = null;
        this.profile.respect = applyRespect(this.profile.respect || {}, m.gang, false);
        return m;
    }

    sirenIntensity() {
        let best = 0;
        const p = this.player;
        for (const v of this.vehicles) {
            if (!v.siren || v.wrecked) continue;
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            best = Math.max(best, 1 - d / 1100);
        }
        return best;
    }

    // ── Partiklar ──
    spawnParticle(type, x, y, scale = 1) {
        if (this.particles.length > 500) return;
        const r = this.rnd;
        const a = r() * Math.PI * 2;
        const sp = { spark: 160, fire: 40, smoke: 18, debris: 220, nitro: 30, stars: 0 }[type] * (0.4 + r() * 0.8);
        const life = { spark: 0.35, fire: 0.6, smoke: 1.8, debris: 0.9, nitro: 0.35, stars: 1.2 }[type] * (0.7 + r() * 0.6) * (type === 'smoke' ? scale : 1);
        this.particles.push({ type, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: (type === 'smoke' ? 10 : type === 'fire' ? 8 : 3) * scale * (0.6 + r() * 0.8), rot: r() * 6 });
    }

    updateParticles(dt) {
        for (const pt of this.particles) {
            pt.life -= dt;
            pt.x += pt.vx * dt; pt.y += pt.vy * dt;
            const drag = pt.type === 'spark' || pt.type === 'debris' ? 3 : 1;
            pt.vx *= Math.max(0, 1 - drag * dt); pt.vy *= Math.max(0, 1 - drag * dt);
            if (pt.type === 'smoke') pt.size += dt * 14;
            pt.rot += dt * 3;
        }
        this.particles = this.particles.filter(pt => pt.life > 0);
        for (const s of this.skids) s.life -= dt;
        if (this.skids.length && this.skids[0].life <= 0) this.skids = this.skids.filter(s => s.life > 0);
        for (const f of this.floaters) { f.life -= dt; f.y -= dt * 30; }
        this.floaters = this.floaters.filter(f => f.life > 0);
        for (const f of this.flashes) f.life -= dt;
        this.flashes = this.flashes.filter(f => f.life > 0);
    }

    updateDistrict() {
        const d = districtAt(this.city, this.player.x, this.player.y);
        if (d !== this.district) {
            const first = this.district === null;
            this.district = d;
            this.emit({ type: 'district', id: d, first });
        }
    }

    updateHint() {
        const p = this.player;
        this.hint = '';
        if (this.state !== 'play') return;
        if (p.vehicle) {
            if (p.vehicle.wrecked) this.hint = 'E — HOPPA UT!';
            return;
        }
        const v = this.nearestVehicle(p.x, p.y, 38);
        if (v && !v.wrecked) this.hint = v.driver && v.driver !== 'player' ? `E — Sno ${v.spec.name}` : `E — Kör ${v.spec.name}`;
        else if (Math.hypot(p.x - this.city.markers.home.x, p.y - this.city.markers.home.y) < 90 && this.canGoHome()) this.hint = 'ESC — Åk hem till imperiet';
    }
}
