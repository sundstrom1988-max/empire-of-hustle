// ═══════════════════════════════════════════
//  STAN — världen
//  Allt som händer i stan simuleras här. Ingen
//  DOM: ljud, meddelanden och storskärmstext
//  skickas som events som index.js tar hand om.
// ═══════════════════════════════════════════

import { TILE, T, DX, DY, DIR_ANGLE, GANGS, DISTRICTS } from './constants.js';
import { tileAt, laneDirs, districtAt, flowField, isSolidAt, isWalkableTile } from './map.js';
import { createVehicle, createGangVehicle, pickTrafficType, fenceValue, VEHICLES, exitSpot } from './vehicles.js';
import { stepVehicle, collideVehicles, stepWalker, distToVehicle, impactDamage, collideCircleWithMap } from './physics.js';
import { initLaneAI, laneControl, chaseControl, pedControl, createPed, lineClear, angleDiff, seek } from './ai.js';
import { stars } from './wanted.js';
import * as POL from './police.js';
import { createMission, updateMission, applyRespect, adjustRespect, emptyRespect, isHostile, gangById, phoneAccess, canJoin } from './missions.js';
import { mulberry32 } from './rng.js';
import { WEAPONS, ownsWeapon, hasGun, nextWeapon, weaponPurchase, dateChance } from './weapons.js';
import { crewCandidates, canRecruit, makeMember, spotNear, updateCrew, crewOrder, CREW_RECOVER, ROLES } from './crew.js';
import { cityItemDefs, itemGain, ITEM_TYPES, ARMOR_CAP } from './items.js';
import { PROPERTIES, pvpLoss, SPAWN_PROTECTION } from '../multiplayer/authority.js';
import * as INT from './interiors.js';
import { bizInterior, bizFlow, salePrice, tillCap } from './businesses.js';
import * as BRAWL from './brawl.js';
import { lookAngle, footMove, normAngle, staminaStep, STAMINA_MAX } from './input.js';
import { SHOPS } from '../data/gameData.js';

export const CLOCK_START = 19.5; // 19:30 — kvällen är ung
const NO_INPUT = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
const PICKUP_TYPES = [['cash', 45], ['repair', 15], ['nitro', 15], ['bribe', 12], ['health', 13]];
const GANG_RADIO = { kebab: 1, orden: 2, taco: 0, dods: 0, hdmc: 2, bmc: 1 };
export const GOODS_PRICE = 120;
// Kunder betalar olika mycket i olika delar av stan
const TURF_PRICE = { vasterort: 1, centrum: 1.3, skogsbacken: 1.45, orten: 0.95, industrin: 0.9, hamnen: 1.05 };
const METRO_LINES = [
    'Psst... snygg fade 😏', 'Vilket serum kör du? ✨', 'Är det där äkta Gucci?', 'Jag följer dig inte, jag går bara åt samma håll 👀',
    'Har du testat skäggolja med vanilj?', 'Mmm... Dior Sauvage? 👃', 'Selfie ihop? 🤳', 'Dina skor matchar din bil 💅',
    'Vart köpte du jackan? 👀', 'Har du ett gymkort? 💪', 'Du ser ut som en som gillar avokado 🥑', 'Snyggt ögonbrynsspel, bror'
];
const METRO_SCARED = ['Aj, mitt hår!! 😭', 'Okej okej! 😳', 'Inte ansiktet!!', 'Min latte! ☕💦'];
const OPP_SHOUTS = ['Vad gör du på vår gata?!', 'Det där är VÅR turf!', 'Du är död, bror!', 'Fel område, clown!'];
const FIGHT_BACK = ['Råna MIG? Kom igen då!', 'Vad fan gör du?!', 'Du valde fel kille, bror!', 'Nu jävlar!'];
const HAND_OVER = ['Okej okej, ta den!', 'Ta allt, skada mig inte!', 'Snälla, jag har barn!', 'Här, här!'];
const MUGGER_LINES = ['Plånboken. NU.', 'Ge hit stålarna, bror!', 'Fel gata, fel tid.'];
const COMBO_NAMES = ['KNOCKOUT!', 'DUBBEL!', 'TRIPPEL!', 'BOWLING!', 'STRIKE!!'];
const ROUGH_TURFS = new Set(['orten', 'industrin', 'hamnen', 'vasterort']);
const DATE_NAMES = ['Jasmine', 'Bella', 'Nadia', 'Sanna', 'Leila', 'Moa', 'Yasmin', 'Felicia', 'Amira', 'Ronja'];
// Tjänster inne i företagen (gratis i de du äger)
const SERVICES = {
    kebab: { id: 'eat', icon: '🥙', label: 'Ät en kebabtallrik', note: '+40 ❤️', price: 60 },
    barber: { id: 'look', icon: '💈', label: 'Ny frisyr', note: 'Snuten känner inte igen dig: −2 stjärnor', price: 300, needsStars: true },
    gym: { id: 'train', icon: '🏋️', label: 'Träna', note: '+1 styrka: hårdare slag och mer hälsa', price: 250, perRound: true },
    studio: { id: 'track', icon: '🎤', label: 'Spela in en disslåt', note: '+3 rykte', price: 400, perRound: true },
    club: { id: 'vip', icon: '🍾', label: 'VIP-bord', note: '+40 ❤️ och +2 rykte', price: 1000, perRound: true },
    tech: { id: 'hack', icon: '💻', label: 'Hacka polisens register', note: 'Rensar efterlysningen', price: 2000, needsStars: true }
};
const DATE_NOPE = ['"I DEN där? Haha, nej."', '"Min pappa har en finare bil."', '"Ring mig när du har en riktig bil."', '"Jag väntar på min Uber, tack."'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const center = t => t * TILE + TILE / 2;

function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

// Plats nummer `slot` runt HQ (0 = mitt på), alltid på gångbar mark
export function startSpot(city, slot) {
    const s = city.spawn;
    if (!slot) return { x: s.x, y: s.y };
    for (let k = 0; k < 8; k++) {
        const a = slot * 2.4 + k * 0.7, d = 64 + 8 * k;
        const x = s.x + Math.cos(a) * d, y = s.y + Math.sin(a) * d;
        if (isWalkableTile(city, Math.floor(x / TILE), Math.floor(y / TILE))) return { x, y };
    }
    return spotNear(city, s.x, s.y, slot);
}

export class World {
    constructor(city, profile, opts = {}) {
        this.city = city;
        this.profile = profile;
        this.round = opts.round || 1;
        this.maxMissions = opts.maxMissions ?? 3;
        this.maxFence = opts.maxFence ?? 3;
        this.maxGoods = opts.maxGoods ?? 10;
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
        // Polisen (police.js): nivå, fas, incidenter och tryck. Sparas i profilen och fortsätter
        // efter HEM, omladdning och en ny session. world.wanted är samma objekt (stars() läser nivån).
        this.police = POL.restorePolice(profile.cityPolice);
        this.wanted = this.police;
        this.contacts = POL.createContacts();   // pågående kontakter per fordonspar (krockar)
        this.disp = { lastT: -1e9, searchFlow: null, saveT: 0 };   // dispatchern: enheter och förstärkningar
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
        this.hornT = 0;
        this.lastSkidSfx = 0;
        this.gangHitT = 0;
        // Gängliv: bråk per gäng (sekunder kvar), hur mycket du langat på deras turf, langning
        this.beef = {};
        this.turfHeat = {};
        this.sellIdle = 0;
        this.buyer = null;
        this.buyerCooldown = 1.5;
        this.punchCd = 0;
        this.warnedTurf = new Set();
        // Gatuliv: påkörningscombo, tappade plånböcker, rån, skott, rånare, dejter
        this.combo = 0; this.comboT = 0;
        this.drops = [];
        this.robCd = 0;
        this.bullets = [];
        this.shotHeatT = 0;
        this.noAmmoT = 0;
        this.muggerT = 60;
        this.date = null;
        this.fade = null;
        this.place = null;          // stället du är inne i just nu
        this.meleeHitT = 0;         // man kan bara ta ett slag i taget
        // Delad stad online: andra riktiga spelare kommer via nätet (null = offline)
        this.net = opts.net || null;
        this.crew = [];
        this.interior = null;
        this.banned = {};           // utslängd efter ett bråk: rummets id → world.time då man får komma in igen
        this.feed = [];             // korta händelser: vem som kom, gick, sänkte vem
        this.showMap = false;
        this.lastAttacker = null;   // senaste spelare som träffade mig
        this.pvpT = 0;              // nere efter en PvP-strid: räknar ner till comeback
        this.pending = {};          // väntande svar från värden (köp, upptagning)
        this.localTaken = new Set();
        // Verksamheterna går hela tiden: kassan har redan en del i sig när man kommer
        this.tills = SHOPS.map(s => Math.round(tillCap(s) * (0.35 + this.rnd() * 0.35) / 10) * 10);
        this.bizT = 0;
        this.shopperT = 1;
        this.lastHurtT = -99;
        this.carHitT = {};
        profile.respect = { ...emptyRespect(), ...(profile.respect || {}) };
        if (!Array.isArray(profile.weapons)) profile.weapons = [];
        if (!profile.ammo || typeof profile.ammo !== 'object') profile.ammo = {};
        if (!ownsWeapon(profile, profile.weapon)) profile.weapon = 'fists';
        // Online har varje spelare en egen startplats vid HQ så att ingen börjar ovanpå någon annan
        const start = startSpot(city, opts.slot || 0);
        this.player = {
            x: start.x, y: start.y, vx: 0, vy: 0, r: 8.5, angle: -Math.PI / 2,
            hp: 100 + 10 * (profile.strength || 0), maxHp: 100 + 10 * (profile.strength || 0), vehicle: null, dead: false, nitro: 0, walkPhase: 0, bustT: 0, hitT: 0, hurtT: 0, punchT: 0, muzzle: 0,
            charIcon: profile.char?.icon || '😎', color: profile.char?.color || '#ff4fd8'
        };
        this.player.armor = Math.max(0, Math.min(ARMOR_CAP, profile.armor || 0));
        this.player.protT = 0;
        this.player.stamina = STAMINA_MAX; // uthållighet för spring (footStep)
        this.player.winded = false;
        if (!Array.isArray(profile.crew)) profile.crew = [];
        this.crew = profile.crew.map((m, i) => { const s = spotNear(city, start.x, start.y, i); return makeMember(m, i, s.x, s.y); });
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
        if (p.gang) this.spawnGangRide(spots[list.length % spots.length]);
    }

    // Medlemmar får en hoj eller bil i gängets stil vid HQ
    spawnGangRide(spot) {
        const g = gangById(this.profile.gang);
        if (!g || !spot) return null;
        const v = createGangVehicle(g.id, spot.x, spot.y, spot.angle ?? -Math.PI / 2, this.rnd, { owned: true, parked: true });
        v.persistent = true;
        v.spec.name = g.kind === 'mc' ? 'Klubbens HD' : `${g.short}s ${v.spec.name}`;
        v.radio = GANG_RADIO[g.id];
        this.vehicles.push(v);
        return v;
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
        this.hornT = Math.max(0, this.hornT - dt);
        this.gangHitT = Math.max(0, this.gangHitT - dt);
        this.punchCd = Math.max(0, this.punchCd - dt);
        this.meleeHitT = Math.max(0, this.meleeHitT - dt);
        this.robCd = Math.max(0, this.robCd - dt);
        this.shotHeatT = Math.max(0, this.shotHeatT - dt);
        this.noAmmoT = Math.max(0, this.noAmmoT - dt);
        this.comboT = Math.max(0, this.comboT - dt);
        if (this.comboT <= 0) this.combo = 0;
        for (const g in this.beef) this.beef[g] = Math.max(0, this.beef[g] - dt);
        if (this.fade && (this.fade.t += dt) >= this.fade.dur) this.fade = null;
        this.updateBusinesses(dt);
        if (this.interior) { this.updateInteriorMode(dt, this.state === 'play' && !this.fade ? input : NO_INPUT); return; }
        const playing = this.state === 'play';
        if (!playing) {
            this.stateT += dt;
            if (this.stateT > 3.8 && !this.finished) this.finished = this.state;
        }
        this.ctlIn = playing && !this.fade ? input : NO_INPUT;   // polisen läser gasen vid krockar (avsikt)
        this.updatePlayer(dt, this.ctlIn);
        this.updateFlow(dt);
        this.manageSpawns(dt);
        this.updateVehicles(dt);
        this.updatePeds(dt);
        if (playing) this.updateShoppers(dt);
        if (playing) updateCrew(this, dt);
        this.updatePvp(dt);
        this.resolveCollisions();
        this.updateBullets(dt);
        this.updateFires(dt);
        if (playing) {
            this.updateInteractions();
            this.updateDrops(dt);
            this.updateSelling(dt);
            this.updateMuggers(dt);
            this.updateDate(dt);
            this.updateMissionState(dt);
            this.updateWantedState(dt);
        }
        this.updateParticles(dt);
        this.updateRemotes(dt);
        this.updateDistrict();
        this.updateHint();
    }

    // ── Delad stad: andra riktiga spelare ──
    remotes() { return this.net ? [...this.net.remotes().values()] : []; }

    // Mjuka rörelser mellan nätuppdateringarna (~10 per sekund)
    updateRemotes(dt) {
        const k = Math.min(1, dt * 12);
        for (const r of this.remotes()) {
            r.rx = (r.rx ?? r.x) + (r.x - (r.rx ?? r.x)) * k;
            r.ry = (r.ry ?? r.y) + (r.y - (r.ry ?? r.y)) * k;
            let da = (r.a || 0) - (r.ra ?? r.a ?? 0);
            while (da > Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            r.ra = (r.ra ?? r.a ?? 0) + da * k;
            r.phase = (r.phase || 0) + Math.hypot(r.x - r.rx, r.y - r.ry) * 0.25;
        }
        for (const f of this.feed) f.life -= dt;
        if (this.feed.length && this.feed[0].life <= 0) this.feed = this.feed.filter(f => f.life > 0);
    }

    pushFeed(text, color = '#fff') {
        this.feed.push({ text, color, life: 6 });
        if (this.feed.length > 5) this.feed.shift();
    }

    // Det jag berättar för de andra om mig själv
    netSnapshot(paused = false) {
        const p = this.player, v = p.vehicle;
        const door = this.interior ? this.interior.door : this.place ? (this.place.pl.door || this.place.pl) : null;
        const inside = this.interior ? this.interior.id : this.place ? (this.place.pl.id || 'biz' + this.place.pl.slot) : null;
        const pos = p;
        return {
            x: Math.round(pos.x), y: Math.round(pos.y), a: +(v ? v.angle : p.angle).toFixed(2),
            v: v ? v.type : null, vc: v ? v.color : null, in: inside,
            ox: Math.round(door ? door.x : p.x), oy: Math.round(door ? door.y : p.y),
            hp: Math.round(p.hp), mhp: p.maxHp, dead: !!p.dead || this.state !== 'play', prot: (p.protT || 0) > 0 || paused,
            w: this.profile.weapon || 'fists', stars: stars(this.wanted), ar: Math.round(p.armor || 0),
            crew: this.crew.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), r: c.role, hp: Math.round(c.hp), mhp: c.maxHp, d: c.down > 0 || !!c.hidden, a: +c.angle.toFixed(2) }))
        };
    }

    // Händelser från nätet (värden eller den lokala värden offline)
    onNet(e) {
        switch (e.type) {
            case 'joined': this.pushFeed(`🟢 ${e.name} kom ut i stan`, '#86efac'); this.sfx('phone', 0.4); break;
            case 'left': this.pushFeed(`⚪ ${e.name} lämnade stan`, '#cbd5e1'); break;
            case 'hurt':
                if (e.crew >= 0) { const c = this.crew[e.crew]; if (c) this.hurtCrew(c, e.dmg, e.name); break; }
                if (this.state !== 'play' || this.player.dead || (this.player.protT || 0) > 0 || this.pvpT > 0) break;
                if (e.veh && this.player.vehicle) { this.damageVehicle(this.player.vehicle, e.dmg * 0.6, null); break; }
                this.hurtByPlayer(e.dmg, e.from, e.name);
                break;
            case 'pvp': {
                const me = this.profile.charKey;
                this.pushFeed(e.killer ? `💀 ${e.killerName} sänkte ${e.victimName}${e.amount ? ` (+${e.amount.toLocaleString('sv-SE')} kr)` : ''}` : `💀 ${e.victimName} gick ner`, e.killer === me ? '#86efac' : e.victim === me ? '#fca5a5' : '#fff');
                if (e.killer === me) {
                    if (e.amount) this.addMoney(e.amount);
                    const st = this.profile.cityStats; if (st) st.pvpWins = (st.pvpWins || 0) + 1;
                    this.big('SEGER!', '#22c55e', `Du sänkte ${e.victimName}${e.amount ? ` · +${e.amount.toLocaleString('sv-SE')} kr` : ''}`);
                    this.sfx('mission');
                }
                break;
            }
            case 'reward':
                this.addMoney(e.amount);
                this.message(`💰 ${e.reason}: +${Number(e.amount).toLocaleString('sv-SE')} kr`);
                break;
            case 'pickupRes':
                if (e.req !== this.pending.pickup) break;
                this.pending.pickup = null;
                if (e.ok) { const it = cityItemDefs(this.city).find(d => d.id === e.item); if (it) this.applyGain(it.type); }
                else this.message(`📦 ${e.reason || 'Någon hann före'}.`);
                break;
            case 'buyRes':
                if (e.req !== this.pending.buy) break;
                this.pending.buy = null;
                if (e.ok) {
                    // Värden har godkänt: dra beloppet exakt en gång
                    this.spend(e.price);
                    const def = PROPERTIES[e.prop];
                    this.sfx('mission');
                    this.big(`${def.name.toUpperCase()} ÄR DIN!`, '#f472b6', `${def.icon} −${e.price.toLocaleString('sv-SE')} kr · +${def.income.toLocaleString('sv-SE')} kr per runda`);
                } else this.message(`💎 Köpet nekades: ${e.reason || 'okänt fel'}.`);
                break;
            default: if (this.onNetMore) this.onNetMore(e);
        }
    }

    // ── Spelaren ──
    updatePlayer(dt, input) {
        const p = this.player;
        p.nitro = Math.max(0, p.nitro - dt);
        p.hitT = Math.max(0, p.hitT - dt);
        p.hurtT = Math.max(0, p.hurtT - dt);
        if (p.vehicle || p.dead) staminaStep(p, dt, false, false); // i bilen vilar benen
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
            // Blick, gång längs blicken och spring (footStep), sedan kollision mot kartan
            this.footStep(dt, input, 115, 175);
            p.x += p.vx * dt; p.y += p.vy * dt;
            collideCircleWithMap(p, p.r || 7, this.city);
            p.punchT = Math.max(0, p.punchT - dt);
            p.muzzle = Math.max(0, (p.muzzle || 0) - dt);
            if (input.weapon) this.cycleWeapon();
            const w = WEAPONS[this.profile.weapon] || WEAPONS.fists;
            if (input.punch || (w.auto && input.attack)) this.playerAttack();
            if (input.rob) this.tryRob();
            if (input.action) {
                // E: plocka upp, gå in genom dörren man står vid, eller ta bilen (det som är närmast)
                const car = this.nearestVehicle(p.x, p.y, 38), door = this.doorInReach(46);
                if (this.nearItem) this.tryPickup(this.nearItem);
                else if (door && (!car || door.d - door.extra < distToVehicle(car, p.x, p.y))) door.enter();
                else this.tryEnterVehicle();
            }
        }
    }

    // ── Till fots, ute och inne: blick, gång och uthållighet ──
    // Blicken: turn (mus i 3D, touch-look) vrider, annars tittar gubben mot aim (pekaren
    // i överblick). Musen flyttar honom aldrig. Tangenterna går relativt blicken (fwd längs
    // den, strafe åt höger om den); joysticken (mx, my) är redan i världsriktning och med
    // faceMove vänder han sig dit han går. Sätter vx/vy — anroparen flyttar och krockar.
    footStep(dt, input, walk, run) {
        const p = this.player;
        p.angle = lookAngle(p.angle, input, p.x, p.y);
        // Spelaren siktar själv (pekaren i överblick, eller blicken i 3D de senaste 4 s):
        // smalare autosikte. Blicken i 3D ger turn bara de steg musen rör sig, därav tiden.
        if (input.turn) this.lookT = this.time;
        this.mouseAim = !!input.aim || this.time - (this.lookT ?? -1e9) < 4;
        const mv = footMove(p.angle, input);
        const moving = mv.x !== 0 || mv.y !== 0;
        // faceMove saknas (äldre anropare): som förr — titta dit du går om inget annat styr blicken
        const face = input.faceMove ?? !(input.turn || input.aim);
        if (mv.stick && face) p.angle = normAngle(Math.atan2(mv.y, mv.x));
        const speed = staminaStep(p, dt, input.run, moving) ? run : walk;
        if (moving) {
            p.vx = mv.x * speed; p.vy = mv.y * speed;
            p.walkPhase += dt * speed * 0.12;
        } else {
            const k = Math.exp(-12 * dt); // stannar på ett par px, lika vid alla tidssteg
            p.vx *= k; p.vy *= k;
        }
        return moving;
    }

    afterStep(v, res, isPlayer) {
        if (res.impact > 60 && isPlayer) this.shake = Math.max(this.shake, Math.min(1, res.impact / 600));
        if (res.impact > 140) {
            this.damageVehicle(v, impactDamage(res.impact), null);
            this.sfxAt('crash', v.x, v.y, Math.min(1, res.impact / 500));
            // Gnistorna där bilen tog i (fronten, bakdelen eller sidan), inte alltid vid nosen
            const hx = v.hitX ?? v.x + Math.cos(v.angle) * v.spec.l / 2, hy = v.hitY ?? v.y + Math.sin(v.angle) * v.spec.l / 2;
            for (let i = 0; i < 6; i++) this.spawnParticle('spark', hx, hy);
        }
        // Skrapar längs en vägg i fart: skrapljud (bilen glider vidare, se physics.js). Inga
        // partiklar här: de drar slumptal ur världens följd och skulle ändra allt annat som händer.
        if (isPlayer && res.scrape > 120 && this.time - this.lastSkidSfx > 0.3) { this.sfx('skid', 0.45); this.lastSkidSfx = this.time; }
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
            const gang = v.driver === 'gang' ? v.gang : null;
            const ped = this.ejectDriver(v);
            this.crime(wasCop ? 'stealCop' : 'carjack', { witnessed: copWitness || wasCop });
            v.pol = null;
            if (gang && gang !== this.profile.gang) {
                // Man snor inte en gängmedlems hoj ostraffat
                this.profile.respect = adjustRespect(this.profile.respect, gang, -5);
                ped.attack = true; ped.attackT = 25; ped.mode = 'walk';
                this.pedSay(ped, 'DIN JÄVEL! Det är MIN hoj!');
                this.message(`${gangById(gang).icon} Du snodde från ${gangById(gang).name} — de glömmer inte.`);
            } else {
                this.message(wasCop ? '🚔 Du snodde en SNUTBIL! Galen.' : `🚗 Carjack! Föraren springer för livet.`);
            }
        } else if (v.spec.police) {
            const seen = !!this.crime('stealCop', { witnessed: copWitness });
            v.pol = null;
            this.message(seen ? '🚔 Du snodde en SNUTBIL — och de såg dig!' : '🚔 Du snodde en SNUTBIL! Ingen såg något...');
        }
        v.driver = 'player';
        v.ai = null;
        v.parked = false;
        v.siren = false;
        if (v.spotKey !== undefined) { this.parkedSpots.delete(v.spotKey); v.spotKey = undefined; }
        if (v.radio === undefined) v.radio = v.gang ? GANG_RADIO[v.gang] : Math.floor(this.rnd() * 3);
        p.vehicle = v;
        this.sfx('door');
        this.emit({ type: 'enterCar', vehicle: v });
    }

    ejectDriver(v) {
        const side = this.sideSpot(v, 1) || { x: v.x, y: v.y };
        const cop = v.driver === 'cop';
        const g = v.driver === 'gang' && v.gang ? gangById(v.gang) : null;
        const ped = createPed(side.x, side.y, this.rnd, g ? this.gangPedOpts(g) : { shirt: cop ? '#1e3a8a' : undefined, cop });
        ped.mode = 'flee'; ped.t = 3; ped.angle = v.angle + Math.PI / 2;
        if (cop && this.police.level > 0 && !this.player.dead) { ped.attack = true; ped.attackT = 60; ped.mode = 'walk'; ped.gun = POL.copsArmed(this.police.level, this.armed()); }
        this.peds.push(ped);
        v.driver = null;
        v.ai = null;
        return ped;
    }

    gangPedOpts(g, extra = {}) {
        return { type: 'gang', gang: g.id, vest: g.kind === 'mc', shirt: g.kind === 'mc' ? '#3f3f46' : g.color, ...extra };
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
        const spot = this.exitSpotFor(v);
        if (!spot) { this.message('🚪 Ingen plats att kliva ut här — kör loss en bit först.'); return; }
        p.vehicle = null;
        p.x = spot.x; p.y = spot.y; p.vx = v.vx * 0.3; p.vy = v.vy * 0.3;
        p.angle = normAngle(v.angle);   // gubben tittar åt samma håll som bilen (W fortsätter framåt)
        v.driver = null;
        this.sfx('door');
        this.emit({ type: 'exitCar' });
    }

    // Var spelaren hamnar när hen kliver ur: en fri plats bredvid bilen (vehicles.js exitSpot —
    // inte i ett hus, i vattnet eller i en annan bil, och inte genom en vägg). Finns ingen och bilen
    // brinner tar man sig ut ändå (närmaste punkt som inte är en vägg); annars null = stanna kvar.
    exitSpotFor(v) {
        const spot = exitSpot(v, this.city, this.vehicles, (this.player.r || 7) + 1);
        if (spot || !v.wrecked) return spot;
        return this.sideSpot(v, 1) || { x: v.x, y: v.y };
    }

    scarePeds(x, y, r) {
        for (const ped of this.peds) {
            if (ped.down > 0) continue;
            const dx = ped.x - x, dy = ped.y - y;
            if (dx * dx + dy * dy < r * r && !ped.attack) {
                ped.mode = 'flee'; ped.t = 2; ped.angle = Math.atan2(dy, dx);
                if (ped.type === 'metro') { this.pedSay(ped, METRO_SCARED[Math.floor(this.rnd() * METRO_SCARED.length)]); ped.boredT = 20; ped.creepT = 0; }
                if (ped.buyer) this.releaseBuyer();
            }
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
        const v = type.startsWith('gang:')
            ? createGangVehicle(type.slice(5), spot.x, spot.y, spot.angle ?? 0, this.rnd)
            : createVehicle(type, spot.x, spot.y, spot.angle ?? 0, { parked: tag === 'steal', rnd: this.rnd });
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
            const spot = exitSpot(v, this.city, this.vehicles.filter(o => o !== v), (this.player.r || 7) + 1) || this.sideSpot(v, 1) || { x: v.x, y: v.y };
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
        // Billigt (64×64 BFS) och används av snut, gäng, opps och creepers
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
        // Zoomar man ut (🔍) ser man längre: då ska folk och bilar dyka upp utanför bild, inte mitt i den
        const ex = this.viewExtra || 0;
        const far = base => base + ex;
        const dense = this.viewDense || 1;

        // Städa bort det som är långt borta
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            if (v === p.vehicle || v.persistent) continue;
            const d = dist(v);
            if (d > far(1900) || (v.exploded && v.hulkT > 30 && d > far(700)) || (v.ai && v.ai.lost && d > far(900))) this.removeVehicle(v);
        }
        for (let i = this.peds.length - 1; i >= 0; i--) if (dist(this.peds[i]) > far(1250)) this.peds.splice(i, 1);

        const district = this.district || 'orten';

        // Trafik
        const traffic = this.vehicles.filter(v => (v.driver === 'traffic' || v.driver === 'gang') && dist(v) < far(1500)).length;
        const want = Math.round((district === 'centrum' ? 20 : 16) * dense);
        if (traffic < want) {
            const spot = this.findSpot(p.x, p.y, far(760), far(1350));
            if (spot) {
                const turf = districtAt(this.city, spot.x, spot.y);
                const gang = DISTRICTS[turf].gang;
                const isGang = this.rnd() < 0.2;
                if (isGang) this.spawnGangConvoy(gang, spot, false);
                else {
                    const v = createVehicle(pickTrafficType(turf, this.rnd), spot.x, spot.y, spot.angle, { rnd: this.rnd });
                    v.driver = 'traffic';
                    initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
                    v.vx = Math.cos(v.angle) * v.ai.cruise * 0.7; v.vy = Math.sin(v.angle) * v.ai.cruise * 0.7;
                    this.vehicles.push(v);
                }
            }
        }

        // Snut: patruller och insatsens enheter (dispatchern, längre ner under Polisen)
        this.dispatchPolice(far);

        // Parkerade bilar på parkeringar i närheten
        if (this.parkT <= 0) {
            this.parkT = 1;
            this.city.lotSpots.forEach((spot, i) => {
                if (this.parkedSpots.has(i) || (i * 37 + this.round) % 3 === 0) return;
                const d = Math.hypot(spot.x - p.x, spot.y - p.y);
                if (d < far(700) || d > far(1300)) return;
                const v = createVehicle(pickTrafficType(districtAt(this.city, spot.x, spot.y), this.rnd), spot.x, spot.y, spot.angle, { parked: true, rnd: this.rnd });
                v.spotKey = i;
                this.parkedSpots.set(i, v);
                this.vehicles.push(v);
            });
        }

        // Fotgängare
        const peds = this.peds.filter(e => dist(e) < far(1000)).length;
        const wantPeds = Math.round((district === 'centrum' ? 34 : 26) * dense);
        const pedIn = far(520), pedOut = far(980);
        for (let k = 0; k < 2 && peds + k < wantPeds; k++) {
            const sw = this.city.sidewalkTiles;
            for (let tries = 0; tries < 12; tries++) {
                const [tx, ty] = sw[Math.floor(this.rnd() * sw.length)];
                const x = center(tx) + (this.rnd() - 0.5) * 30, y = center(ty) + (this.rnd() - 0.5) * 30;
                const d = Math.hypot(x - p.x, y - p.y);
                if (d < pedIn || d > pedOut) continue;
                const dId = districtAt(this.city, x, y);
                const r = this.rnd();
                const metroShare = { centrum: 0.3, skogsbacken: 0.25 }[dId] ?? 0.12;
                let opts = {};
                if (r < 0.2) opts = this.gangPedOpts(gangById(DISTRICTS[dId].gang));
                else if (r < 0.2 + metroShare) opts = { type: 'metro', scooter: this.rnd() < 0.4 };
                this.peds.push(createPed(x, y, this.rnd, opts));
                break;
            }
        }
    }

    // ── Fordon ──
    updateVehicles(dt) {
        const p = this.player;
        for (const v of this.vehicles) {
            if (v === p.vehicle) continue;
            const d = Math.hypot(v.x - p.x, v.y - p.y);
            if (d > 2000) continue;
            let ctl = null;
            if (!v.wrecked && v.driver && v.ai) {
                if (v.driver === 'cop') {
                    // Polisbilen gör det dispatchern gett den: patrull, stopp, jakt, sökning eller åka därifrån
                    ctl = this.copControl(v, dt, d);
                } else if (v.driver === 'gang') {
                    const beef = (this.beef[v.gang] || 0) > 0;
                    const hostile = this.gangHostile(v.gang) && !p.dead;
                    if (hostile && (d < (beef ? 900 : 520) || (v.ai.mode === 'chase' && d < 1100))) {
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
        // by = 'player' bara när spelaren faktiskt orsakade smällen (skyldig i krocken, skott, sprängning)
        if (by) { v.lastHitBy = by; v.lastHitAt = this.time; }
        if (v.hp <= 0) {
            v.hp = 0;
            v.wrecked = true;
            v.burnT = 4;
            v.siren = false;
            const copInside = v.driver === 'cop';
            if (v.driver && v.driver !== 'player') this.ejectDriver(v);
            v.pol = null;
            if (v.lastHitBy === 'player' && this.time - (v.lastHitAt ?? -1e9) < 6) {
                this.crime(v.spec.police ? 'copWreck' : 'wreck', { witnessed: copInside || this.copNear(600, true) });
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
            ped.muzzle = Math.max(0, (ped.muzzle || 0) - dt);
            ped.flashT = Math.max(0, (ped.flashT || 0) - dt);
            if (ped.down > 0) {
                ped.down -= dt;
                if (ped.spin) { ped.angle += ped.spin * dt; ped.spin *= Math.max(0, 1 - 3 * dt); }
                ped.vx *= Math.max(0, 1 - 4 * dt); ped.vy *= Math.max(0, 1 - 4 * dt);
                ped.x += ped.vx * dt; ped.y += ped.vy * dt;
                collideCircleWithMap(ped, ped.r, this.city);
                if (ped.down <= 0) { ped.mode = 'flee'; ped.t = 2; }
                continue;
            }
            if (ped.stunT > 0) {
                // Vacklar bakåt av smällen och kan inte slå under tiden
                ped.stunT -= dt;
                stepWalker(ped, 0, 0, 0, dt, this.city);
                if (ped.say && (ped.say.life -= dt) <= 0) ped.say = null;
                continue;
            }
            if (ped.goIn && !ped.attack && ped.mode !== 'flee') {
                // På väg in i en butik: går fram till dörren och försvinner in (och handlar)
                const g = ped.goIn;
                if (Math.hypot(g.x - ped.x, g.y - ped.y) < 12) {
                    ped.gone = true;
                    const s = SHOPS[g.slot];
                    this.tills[g.slot] = Math.min(tillCap(s), this.tills[g.slot] + salePrice(s));
                    continue;
                }
                const m = seek(ped, this, g.x, g.y, true);
                stepWalker(ped, m.mx, m.my, 62, dt, this.city);
                ped.phase += dt * 62 * 0.12;
                continue;
            }
            const c = pedControl(ped, this, dt);
            stepWalker(ped, c.mx, c.my, c.speed, dt, this.city);
            ped.phase += dt * c.speed * 0.12;
            this.updatePedSocial(ped, dt);
        }
        if (this.peds.some(e => e.gone)) this.peds = this.peds.filter(e => !e.gone);
    }

    // Prat, gängbråk och kunder — det som händer mellan folk och dig
    updatePedSocial(ped, dt) {
        const p = this.player;
        if (ped.say && (ped.say.life -= dt) <= 0) ped.say = null;
        ped.hitCd = Math.max(0, ped.hitCd - dt);
        const d = Math.hypot(p.x - ped.x, p.y - ped.y);

        // Gängmedlemmar går till attack i fientligt läge
        if (ped.type === 'gang' && !ped.attack && !p.dead && this.state === 'play' && ped.gang !== this.profile.gang) {
            const beef = (this.beef[ped.gang] || 0) > 0;
            if (this.gangHostile(ped.gang) && d < (beef ? 450 : 200)) {
                ped.attack = true; ped.attackT = 30;
                if (this.rnd() < 0.5) this.pedSay(ped, OPP_SHOUTS[Math.floor(this.rnd() * OPP_SHOUTS.length)]);
            }
        }

        if (ped.attack) {
            ped.attackT -= dt;
            const t = ped.targetPed;
            const P = this.police;
            // Snuten drar vapen först vid en hotbild (police.js copsArmed): aldrig på nivå 1–2.
            // Under stopp och sökning springer de inte efter dig (de vet inte var du är / vill bara prata).
            if (ped.cop) ped.gun = POL.copsArmed(P.level, this.armed());
            if (ped.attackT <= 0 || (!t && (p.dead || d > 950)) || this.state !== 'play' && !t || (ped.cop && (P.level === 0 || P.phase !== 'chase'))) {
                ped.attack = false; ped.targetPed = null; ped.mode = 'flee'; ped.t = 2;
                return;
            }
            if (t) {
                if (t.down > 0 || !this.peds.includes(t)) { ped.targetPed = null; return; }
                if (Math.hypot(t.x - ped.x, t.y - ped.y) < 20 && ped.hitCd <= 0) { ped.hitCd = 0.7; this.hitPed(t, 9, ped); }
                return;
            }
            if (ped.mugger && p.vehicle) {
                // Rånare ger sig inte på en bil
                ped.attack = false; ped.mugger = false; ped.mode = 'flee'; ped.t = 3;
                return;
            }
            const reach = p.vehicle ? distToVehicle(p.vehicle, ped.x, ped.y) < 8 : d < 22;
            // Snuten slår inte på bilar, och på nivå 1–2 griper de bara (ingen misshandel för en trafikgrej)
            const canHit = !(ped.cop && (p.vehicle || this.police.level <= 2));
            if (ped.windup > 0) {
                // Slaget är på väg (de drar upp näven) — en smäll från dig hinner avbryta det
                ped.windup -= dt;
                if (ped.windup <= 0) {
                    ped.hitCd = 1 + this.rnd() * 0.5;
                    const cm = this.crew.find(c => !c.hidden && !(c.down > 0) && Math.hypot(c.x - ped.x, c.y - ped.y) < Math.min(d, 22));
                    if (cm) this.hurtCrew(cm, 4 + this.rnd() * 4, null);
                    else if (reach && canHit && this.meleeHitT <= 0) { this.meleeHitT = 0.3; this.hitPlayer(ped); }
                }
            } else if (ped.gun && !p.dead && d > 36 && d < 340 && ped.hitCd <= 0 && lineClear(this.city, ped.x, ped.y, p.x, p.y)) {
                ped.hitCd = 1.3 + this.rnd() * 1.1;
                this.npcShoot(ped);
            } else if (reach && canHit && ped.hitCd <= 0) {
                ped.windup = 0.3;
            }
            return;
        }

        // Kund som når fram
        if (ped.buyer) {
            if (d < 20) this.sellTo(ped);
            return;
        }

        // Metrosexuella pratar när de smyger nära
        if (ped.type === 'metro' && d < 140 && ped.creepT > 0.5) {
            ped.talkT -= dt;
            if (ped.talkT <= 0) {
                ped.talkT = 4 + this.rnd() * 4;
                this.pedSay(ped, METRO_LINES[Math.floor(this.rnd() * METRO_LINES.length)]);
            }
        }
    }

    pedSay(ped, text, life = 3) { ped.say = { text, life }; }

    gangHostile(gang) {
        if (!gang || gang === this.profile.gang) return false;
        return isHostile(this.profile.respect || {}, gang) || (this.beef[gang] || 0) > 0;
    }

    // ── Slagsmål och vapen ──
    cycleWeapon() {
        const prof = this.profile;
        prof.weapon = nextWeapon(prof);
        const w = WEAPONS[prof.weapon];
        this.sfx('click', 0.5);
        const ammo = w.melee ? '' : ` · ${prof.ammo[w.id] || 0} skott`;
        this.floater(this.player.x, this.player.y - 30, `${w.icon} ${w.name}${ammo}`, '#e5e7eb');
    }

    // SPACE till fots: slag, slag med trä eller skott beroende på vapen
    playerAttack() {
        const p = this.player, prof = this.profile;
        if (this.punchCd > 0 || p.dead) return;
        if (!ownsWeapon(prof, prof.weapon)) prof.weapon = 'fists';
        const id = prof.weapon || 'fists', w = WEAPONS[id] || WEAPONS.fists;
        if (!w.melee && !((prof.ammo[id] || 0) > 0)) {
            // Slut på skott: man slåss med det man har i stället för att stå och klicka
            const fallback = ownsWeapon(prof, 'bat') ? 'bat' : 'fists';
            prof.weapon = fallback;
            this.sfx('click', 0.7);
            if (this.noAmmoT <= 0) { this.noAmmoT = 3; this.message(`${w.icon} Slut på ammo — du slåss med ${WEAPONS[fallback].name.toLowerCase()}. Mer ammo hos Pang-Pelle 🔫`); }
            this.playerAttack();
            return;
        }
        p.protT = 0; // den som slåss är inte skyddad längre
        this.punchCd = w.cd;
        p.punchT = 0.18;
        if (w.melee) this.melee(w);
        else this.shoot(id, w);
    }

    melee(w) {
        const p = this.player;
        const range = w.range + 4;
        let best = null, bd = Infinity;
        for (const ped of this.peds) {
            if (ped.down > 0) continue;
            const dx = ped.x - p.x, dy = ped.y - p.y;
            const dd = Math.hypot(dx, dy);
            if (dd > range) continue;
            const facing = Math.abs(angleDiff(p.angle, Math.atan2(dy, dx)));
            const score = dd + (facing > 1.3 ? 14 : 0) - (ped.attack ? 10 : 0);
            if (score < bd) { bd = score; best = ped; }
        }
        // En annan spelare (eller deras crew) inom räckhåll? Lite extra marginal: de syns en bit efter på nätet.
        const rem = this.remoteInReach(p.x, p.y, range + 10);
        if (rem && (!best || rem.d < bd)) {
            if (rem.prot) {
                // Nyss tillbaka vid HQ (eller sitter i en meny): slaget biter inte — säg det
                this.sfx('swing', 0.5);
                if (this.time - (this.protMsgT ?? -9) > 1.2) { this.protMsgT = this.time; this.floater(rem.x, rem.y - 26, '🛡️ SKYDDAD', '#93c5fd'); }
                return;
            }
            this.sfx(w.id === 'bat' ? 'bat' : 'punch');
            p.angle = Math.atan2(rem.y - p.y, rem.x - p.x);
            this.net.request('hit', { target: rem.id, crew: rem.crew, kind: 'melee', dmg: w.dmg[0] + this.rnd() * (w.dmg[1] - w.dmg[0]) + (this.profile.strength || 0) * 3, src: -1 });
            this.spawnParticle('spark', rem.x, rem.y);
            return;
        }
        this.sfx(best ? (w.id === 'bat' ? 'bat' : 'punch') : 'swing', best ? 1 : 0.4);
        if (!best) return;
        p.angle = Math.atan2(best.y - p.y, best.x - p.x);
        const civilian = !best.attack && best.type !== 'gang' && !best.cop;
        this.hitPed(best, w.dmg[0] + this.rnd() * (w.dmg[1] - w.dmg[0]) + (this.profile.strength || 0) * 3, 'player');
        if (civilian) this.crime('assault', { witnessed: this.copNear(450, true) });
        this.provoke(best);
    }

    shoot(id, w) {
        const p = this.player, prof = this.profile;
        prof.ammo[id] = (prof.ammo[id] || 0) - 1;
        const aim = this.autoAim(p.x, p.y, p.angle, w.range, this.mouseAim ? 0.22 : 0.5);
        if (aim !== null) p.angle = aim;
        const sx = p.x + Math.cos(p.angle) * 12, sy = p.y + Math.sin(p.angle) * 12;
        for (let i = 0; i < w.pellets; i++) {
            const a = p.angle + (this.rnd() - 0.5) * 2 * w.spread;
            this.bullets.push({ x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed, life: w.range / w.speed, dmg: w.dmg, from: 'player' });
        }
        p.muzzle = 0.07;
        this.shake = Math.max(this.shake, id === 'shotgun' ? 0.3 : 0.08);
        this.sfx(id === 'pistol' ? 'shot' : id, id === 'uzi' ? 0.6 : 1);
        // Skott hörs: folk springer och snuten kommer
        this.scarePeds(p.x, p.y, 260);
        if (this.shotHeatT <= 0 && this.crime('shot', { witnessed: this.copNear(700, true) })) this.shotHeatT = 2;
        if (prof.ammo[id] <= 0) this.message(`${w.icon} Sista skottet! Q byter vapen.`);
    }

    // Sikta åt rätt håll: närmaste mål i en kon framför dig (opps först)
    // cone: hur mycket hjälp man får (smalare när man siktar med musen)
    autoAim(x, y, angle, range, cone = 0.5) {
        let best = null, bs = Infinity;
        for (const ped of this.peds) {
            if (ped.down > 0 || (ped.gang && ped.gang === this.profile.gang && !ped.attack)) continue;
            const dx = ped.x - x, dy = ped.y - y, d = Math.hypot(dx, dy);
            if (d > range || d < 4) continue;
            const a = Math.atan2(dy, dx);
            const diff = Math.abs(angleDiff(angle, a));
            if (diff > cone) continue;
            const score = d * (1 + diff * 3) * (ped.attack ? 0.4 : 1);
            if (score < bs && lineClear(this.city, x, y, ped.x, ped.y)) { bs = score; best = a; }
        }
        return best;
    }

    npcShoot(ped) {
        const p = this.player;
        const a = Math.atan2(p.y - ped.y, p.x - ped.x) + (this.rnd() - 0.5) * 0.36;
        ped.angle = a;
        ped.muzzle = 0.08;
        const g = gangById(ped.gang);
        const sx = ped.x + Math.cos(a) * 10, sy = ped.y + Math.sin(a) * 10;
        this.bullets.push({ x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * 720, vy: Math.sin(a) * 720, life: 0.6, dmg: 5 + this.rnd() * 3, from: 'npc', reason: g ? `Skjuten av ${g.name}` : 'Skjuten' });
        this.sfxAt('shot', ped.x, ped.y, 0.8);
    }

    updateBullets(dt) {
        if (!this.bullets.length) return;
        const p = this.player;
        const N = 3; // delsteg så att kulor inte flyger rakt igenom folk
        for (const b of this.bullets) {
            b.px = b.x; b.py = b.y;
            for (let k = 0; k < N && b.life > 0; k++) {
                b.x += b.vx * dt / N; b.y += b.vy * dt / N;
                if (isSolidAt(this.city, b.x, b.y)) { b.life = 0; this.spawnParticle('spark', b.x, b.y); break; }
                if (b.from === 'player' || b.from === 'crew') {
                    if (this.bulletHitPed(b) || this.bulletHitRemote(b) || this.bulletHitVehicle(b)) b.life = 0;
                } else if (this.bulletHitCrew(b)) {
                    b.life = 0;
                } else if (!p.dead) {
                    const hit = p.vehicle ? distToVehicle(p.vehicle, b.x, b.y) < 1 : Math.hypot(b.x - p.x, b.y - p.y) < p.r + 3;
                    if (!hit) continue;
                    b.life = 0;
                    if (p.vehicle) {
                        this.damageVehicle(p.vehicle, b.dmg * 0.5, null);
                        this.spawnParticle('spark', b.x, b.y);
                        this.sfx('crash', 0.25);
                    } else {
                        p.vx += b.vx * 0.05; p.vy += b.vy * 0.05;
                        this.sfx('hurt', 0.8);
                        this.hurtPlayer(b.dmg, b.reason || 'Skjuten');
                    }
                }
            }
            b.life -= dt;
        }
        this.bullets = this.bullets.filter(b => b.life > 0);
    }

    bulletHitPed(b) {
        for (const ped of this.peds) {
            if (ped.down > 0 || Math.abs(ped.x - b.x) > 10 || Math.abs(ped.y - b.y) > 10) continue;
            if (Math.hypot(ped.x - b.x, ped.y - b.y) > ped.r + 2) continue;
            const civilian = !ped.attack && ped.type !== 'gang' && !ped.cop;
            if (ped.cop) this.crime('shotCop');   // han såg vem som sköt
            this.hitPed(ped, b.dmg, 'player');
            if (civilian) this.crime('assault', { witnessed: this.copNear(500, true) });
            this.provoke(ped);
            return true;
        }
        return false;
    }

    bulletHitVehicle(b) {
        for (const v of this.vehicles) {
            if (v === this.player.vehicle || v.exploded || Math.abs(v.x - b.x) > 40 || Math.abs(v.y - b.y) > 40) continue;
            if (distToVehicle(v, b.x, b.y) > 0) continue;
            this.damageVehicle(v, b.dmg * 0.5, 'player');
            this.spawnParticle('spark', b.x, b.y);
            this.sfxAt('crash', b.x, b.y, 0.2);
            if (v.driver === 'cop') this.crime('shotCop');
            return true;
        }
        return false;
    }

    // Vad som händer när du ger dig på någon (slag, skott, rån)
    provoke(ped) {
        if (ped.type === 'metro') { this.pedSay(ped, METRO_SCARED[Math.floor(this.rnd() * METRO_SCARED.length)]); ped.boredT = 40; ped.creepT = 0; }
        if (ped.type === 'gang' && !ped.attack && ped.gang !== this.profile.gang) {
            // Ger du dig på en av dem ger sig alla på dig
            this.profile.respect = adjustRespect(this.profile.respect, ped.gang, -4);
            for (const o of this.peds) {
                if (o.gang === ped.gang && o.down <= 0 && Math.hypot(o.x - ped.x, o.y - ped.y) < 260) { o.attack = true; o.attackT = 30; }
            }
        }
    }

    hitPed(ped, dmg, by) {
        ped.hp -= dmg;
        const ox = by === 'player' ? this.player : by;
        if (ox) {
            const dx = ped.x - ox.x, dy = ped.y - ox.y, l = Math.hypot(dx, dy) || 1;
            ped.vx = dx / l * 160; ped.vy = dy / l * 160;
        }
        // Träffad: blinkar, vacklar bakåt och tappar slaget den höll på med
        ped.flashT = 0.12;
        ped.stunT = Math.max(ped.stunT || 0, by === 'player' ? 0.45 : 0.25);
        ped.windup = 0;
        ped.goIn = null;
        this.sfxAt('punch', ped.x, ped.y, 0.8);
        const mine = by === 'player' || !!by?.isCrew;
        if (by?.isCrew) ped.lastCrew = by;
        if (ped.cop && mine && !ped.assaulted) { ped.assaulted = true; this.crime('copAssault'); } // han såg dig
        if (ped.hp <= 0) {
            ped.down = 4 + this.rnd() * 2;
            ped.hp = Math.ceil(ped.maxHp * 0.6);
            ped.stunT = 0;
            this.spawnParticle('stars', ped.x, ped.y);
            if (ped.buyer) this.releaseBuyer();
            if (mine) {
                if (ped.cop) this.copDown(ped);
                else {
                    if (ped.mugger) { ped.mugger = false; ped.attack = false; this.message('🦹 Rånaren ligger! Ta tillbaka det han tog.'); }
                    this.dropWallet(ped, 0.35);
                }
            }
        } else if (!ped.attack && ped.type !== 'gang') {
            if (mine && (ped.tough || ped.cop)) {
                // Fel person att bråka med
                ped.attack = true; ped.attackT = 14; ped.mode = 'walk';
                this.pedSay(ped, FIGHT_BACK[Math.floor(this.rnd() * FIGHT_BACK.length)]);
            } else {
                ped.mode = 'flee'; ped.t = 2.5; ped.angle = Math.atan2(ped.vy, ped.vx);
            }
        }
    }

    hitPlayer(ped) {
        const p = this.player;
        const g = gangById(ped.gang);
        if (p.vehicle) {
            this.damageVehicle(p.vehicle, 4, null);
            this.sfx('crash', 0.35);
            return;
        }
        p.vx += Math.cos(ped.angle) * 90; p.vy += Math.sin(ped.angle) * 90;
        this.sfx('punch');
        this.hurtPlayer(4 + this.rnd() * 4 + (ped.vest ? 2 : 0), g ? `Nerslagen av ${g.name}` : ped.cop ? 'Nerslagen av snuten' : ped.mugger ? 'Rånad och nerslagen' : 'Nerslagen');
        if (ped.mugger && !p.dead) this.mugHit(ped);
    }

    hurtPlayer(dmg, reason) {
        const p = this.player;
        if (p.dead) return;
        p.hp -= dmg;
        p.hurtT = 0.3;
        this.shake = Math.max(this.shake, 0.35);
        if (p.hp <= 0) { p.hp = 0; this.wasted(reason); }
    }

    // Tappade plånböcker att plocka upp
    dropWallet(ped, chance) {
        if (ped.loot > 0) {
            this.drops.push({ x: ped.x, y: ped.y, amount: ped.loot, life: 25 });
            ped.loot = 0;
            return;
        }
        if (ped.robbed || ped.cop || this.rnd() >= chance) return;
        ped.robbed = true;
        const base = ped.type === 'metro' ? 120 : ped.type === 'gang' ? 150 : 60;
        const amount = Math.round((base + this.rnd() * 160) / 10) * 10;
        this.drops.push({ x: ped.x + (this.rnd() - 0.5) * 14, y: ped.y + (this.rnd() - 0.5) * 14, amount, life: 25 });
    }

    updateDrops(dt) {
        if (!this.drops.length) return;
        const p = this.player;
        for (const d of this.drops) {
            d.life -= dt;
            if (!p.dead && Math.hypot(d.x - p.x, d.y - p.y) < (p.vehicle ? 34 : 22)) {
                this.addMoney(d.amount, d.x, d.y);
                this.sfx('coin', 0.7);
                d.life = 0;
            }
        }
        this.drops = this.drops.filter(d => d.life > 0);
    }

    // ── Rån (R till fots) ──
    tryRob() {
        const p = this.player, prof = this.profile;
        if (p.vehicle || p.dead || this.robCd > 0) return false;
        let ped = null, bd = 28;
        for (const o of this.peds) {
            const d = Math.hypot(o.x - p.x, o.y - p.y);
            if (d < bd) { bd = d; ped = o; }
        }
        this.robCd = 0.6;
        if (!ped) { this.message('💰 Gå fram till någon för att råna dem (R).'); return false; }
        this.robCd = 1.2;
        p.angle = Math.atan2(ped.y - p.y, ped.x - p.x);
        if (ped.robbed) { this.pedSay(ped, 'Du har redan tagit allt!', 2); return false; }
        const witnessed = this.copNear(450, true);
        const st = prof.cityStats;
        if (ped.down > 0) {
            // Länsa fickorna på någon som ligger
            ped.robbed = true;
            const amount = ped.loot > 0 ? ped.loot : Math.round(((ped.type === 'gang' ? 150 : 70) + this.rnd() * 200) / 10) * 10;
            ped.loot = 0;
            this.addMoney(amount, ped.x, ped.y);
            this.sfx('coin');
            if (st) st.robbed = (st.robbed || 0) + 1;
            this.crime('loot', { witnessed });
            return true;
        }
        // Med ett skjutvapen i handen ger nästan alla upp
        const armed = !(WEAPONS[prof.weapon] || WEAPONS.fists).melee;
        let fight = ped.cop || ped.type === 'gang' ? 1 : ped.type === 'metro' ? 0.1 : ped.tough ? 0.8 : 0.3;
        if (armed) fight *= ped.type === 'gang' || ped.cop ? 0.5 : 0.15;
        if (ped.attack || this.rnd() < fight) {
            const wasCalm = !ped.attack;
            ped.attack = true; ped.attackT = 15; ped.mode = 'walk';
            this.pedSay(ped, FIGHT_BACK[Math.floor(this.rnd() * FIGHT_BACK.length)]);
            if (wasCalm) this.provoke(ped);
            if (ped.cop) this.crime('copAssault');
            else this.crime('assault', { witnessed });   // rånförsök
            return false;
        }
        const rich = ped.type === 'metro' ? 2 : 1;
        const amount = Math.round((80 + this.rnd() * 300) * rich * (1 + this.round * 0.05) / 10) * 10;
        ped.robbed = true;
        ped.mode = 'flee'; ped.t = 4; ped.angle = Math.atan2(ped.y - p.y, ped.x - p.x);
        if (ped.buyer) this.releaseBuyer();
        this.pedSay(ped, ped.type === 'metro' ? 'Ta den, ta den! Inte ansiktet! 😭' : HAND_OVER[Math.floor(this.rnd() * HAND_OVER.length)], 2.5);
        this.addMoney(amount, p.x, p.y + 44); // under dig, så den inte går genom pratbubblan
        this.sfx('coin');
        if (st) st.robbed = (st.robbed || 0) + 1;
        this.crime('rob', { witnessed });
        return true;
    }

    // ── Rånare på natten i de tuffa delarna av stan ──
    updateMuggers(dt) {
        const p = this.player;
        if (p.vehicle || p.dead) return;
        const h = this.hour();
        if (!(h >= 21 || h < 5) || !ROUGH_TURFS.has(this.district)) return;
        if ((this.muggerT -= dt) > 0) return;
        this.muggerT = 80 + this.rnd() * 60;
        if (!this.peds.some(o => o.mugger)) this.spawnMugger();
    }

    spawnMugger() {
        const p = this.player;
        for (let tries = 0; tries < 40; tries++) {
            const a = this.rnd() * Math.PI * 2, r = 240 + this.rnd() * 160;
            const tx = Math.floor((p.x + Math.cos(a) * r) / TILE), ty = Math.floor((p.y + Math.sin(a) * r) / TILE);
            if (!isWalkableTile(this.city, tx, ty)) continue;
            const ped = createPed(center(tx), center(ty), this.rnd, { type: 'civ', shirt: '#1f2937', hp: 30, attack: true, attackT: 40 });
            ped.mugger = true; ped.tough = true; ped.hood = true;
            this.pedSay(ped, MUGGER_LINES[Math.floor(this.rnd() * MUGGER_LINES.length)], 4);
            this.peds.push(ped);
            this.message('🦹 En rånare är ute efter dig! Slå tillbaka (SPACE) eller spring!');
            return ped;
        }
        return null;
    }

    mugHit(ped) {
        const p = this.player;
        ped.mugHits = (ped.mugHits || 0) + 1;
        if (ped.mugHits < 3) return;
        const take = Math.min(2000, Math.floor((this.profile.money || 0) * 0.1));
        ped.mugger = false; ped.attack = false;
        ped.mode = 'flee'; ped.t = 8; ped.angle = Math.atan2(ped.y - p.y, ped.x - p.x);
        ped.loot = take; // spöar du honom får du tillbaka det
        ped.robbed = false;
        if (take > 0) {
            this.profile.money -= take;
            this.floater(p.x, p.y - 20, `-${take.toLocaleString('sv-SE')} kr`, '#ef4444');
        }
        this.pedSay(ped, 'Tack för stålarna! 😈', 3);
        this.message(`🦹 Rånaren tog ${take.toLocaleString('sv-SE')} kr och sprang! Spöa honom för att få tillbaka dem.`);
        this.sfx('fail', 0.6);
    }

    // ── Pang-Pelle: vapen och ammo ──
    buyWeapon(id) { return this.buyFromGunShop(id, 'weapon'); }
    buyAmmo(id) { return this.buyFromGunShop(id, 'ammo'); }

    buyFromGunShop(id, kind) {
        const prof = this.profile, w = WEAPONS[id];
        if (stars(this.wanted) > 0) { this.message('🔫 Pang-Pelle: "Inte med snuten efter dig, är du dum?!"'); return false; }
        const r = weaponPurchase(prof, id, kind);
        if (!r.ok) { this.message(`🔫 ${r.reason}`); return false; }
        if (!this.spend(r.cost)) { this.message(`🔫 Det kostar ${r.cost.toLocaleString('sv-SE')} kr — du har inte råd.`); return false; }
        if (kind === 'weapon') {
            prof.weapons.push(id);
            prof.weapon = id;
        }
        if (!w.melee) prof.ammo[id] = (prof.ammo[id] || 0) + w.ammo;
        this.sfx('reload');
        this.message(kind === 'weapon'
            ? `${w.icon} Du köpte ${w.name}! SPACE ${w.melee ? 'slår' : 'skjuter'}, Q byter vapen.`
            : `${w.icon} +${w.ammo} skott till ${w.name}.`);
        return true;
    }

    // ── Nattklubben och dejter ──
    isClubOpen() { const h = this.hour(); return h >= 20 || h < 5; }

    visitClub() {
        const v = this.player.vehicle, prof = this.profile;
        if (this.date) return;
        if (!this.isClubOpen()) { this.message('🍾 Nattklubben är stängd. Den öppnar 20:00.'); return; }
        if (prof.dateThisRound) { this.message('🍾 Du har redan haft en dejt den här rundan, playboy. Kom tillbaka nästa runda.'); return; }
        if (stars(this.wanted) > 0) { this.message('🍾 Ingen hoppar in i en bil med snuten efter sig!'); return; }
        const name = DATE_NAMES[Math.floor(this.rnd() * DATE_NAMES.length)];
        if (this.rnd() >= dateChance(v, prof.rep || 0)) {
            this.message(`💅 ${name}: ${DATE_NOPE[Math.floor(this.rnd() * DATE_NOPE.length)]} (En finare bil hjälper.)`);
            return;
        }
        const club = this.city.markers.club;
        const spot = this.findSpot(club.x, club.y, 1000, 2400) || this.city.markers.home;
        const dist = Math.hypot(spot.x - club.x, spot.y - club.y);
        this.date = { name, mood: 100, dest: { x: spot.x, y: spot.y }, vehicle: v, hpLast: v.hp, t: 0, limit: Math.round(60 + dist / 12) };
        this.big('DEJT!', '#f472b6', `💃 ${name} hoppar in. Kör henne hem — inga krockar!`);
        this.sfx('love');
    }

    updateDate(dt) {
        const d = this.date;
        if (!d) return;
        const p = this.player, v = p.vehicle;
        d.t += dt;
        if (!v || v !== d.vehicle) return this.endDate(false, `💔 ${d.name}: "Lämnar du mig HÄR?!" Hon tar en taxi.`);
        if (v.wrecked) return this.endDate(false, `💔 ${d.name} skriker och springer från den brinnande bilen.`);
        const dmg = d.hpLast - v.hp;
        if (dmg > 0) {
            d.mood -= dmg * 1.2;
            d.hpLast = v.hp;
            if (dmg > 4) this.floater(p.x, p.y - 30, '😠', '#f472b6');
        }
        if (stars(this.wanted) >= 2) d.mood -= dt * 6; // jagad av snuten — inte romantiskt
        if (d.mood <= 0) return this.endDate(false, `💔 ${d.name}: "Släpp av mig. NU." Dejten är över.`);
        if (d.t > d.limit) return this.endDate(false, `💔 ${d.name}: "Vi har kört i evigheter..." Hon ringer en kompis.`);
        if (Math.hypot(p.x - d.dest.x, p.y - d.dest.y) < 70 && Math.hypot(v.vx, v.vy) < 200) this.endDate(true);
    }

    endDate(success, text) {
        const d = this.date;
        this.date = null;
        if (!success) { this.message(text); this.sfx('fail', 0.7); return; }
        const p = this.player, prof = this.profile;
        p.hp = p.maxHp;
        prof.rep = (prof.rep || 0) + 5;
        prof.dateThisRound = true;
        const st = prof.cityStats; if (st) st.dates = (st.dates || 0) + 1;
        this.time += 72; // tre timmar senare
        this.fade = { t: 0, dur: 3.2, text: '🌙 Några timmar senare...', sub: `${d.name}: "Ring mig 😘"` };
        this.big('❤️ SCORE!', '#f472b6', '+5 rykte · full hälsa');
        this.sfx('love');
    }

    // ── Langning ──
    buyGoods(n) {
        const p = this.profile;
        const max = this.maxGoods ?? 10;
        const left = Math.max(0, max - (p.goodsBoughtThisRound || 0));
        const amount = Math.min(n, left);
        if (amount <= 0) { this.message('🎒 Langaren: "Slut för den här rundan, bror."'); return false; }
        const cost = amount * GOODS_PRICE;
        if (!this.spend(cost)) { this.message(`🎒 ${amount} varor kostar ${cost} kr — du har inte råd.`); return false; }
        p.cityGoods = (p.cityGoods || 0) + amount;
        p.goodsBoughtThisRound = (p.goodsBoughtThisRound || 0) + amount;
        this.sfx('coin');
        this.message(`🎒 Du köpte ${amount} varor. Stå still på en trottoar så kommer kunderna.`);
        return true;
    }

    releaseBuyer() {
        if (this.buyer) this.buyer.buyer = false;
        this.buyer = null;
        this.buyerCooldown = 2;
    }

    updateSelling(dt) {
        const p = this.player;
        this.buyerCooldown -= dt;
        if (this.buyer) {
            this.buyer.buyerT = (this.buyer.buyerT || 0) + dt;
            const gone = !this.peds.includes(this.buyer) || this.buyer.down > 0 || Math.hypot(this.buyer.x - p.x, this.buyer.y - p.y) > 700;
            if (gone || this.buyer.buyerT > 15) this.releaseBuyer(); // fastnat? ta nästa kund
        }
        if (!(this.profile.cityGoods > 0) || p.vehicle || p.dead) { this.sellIdle = 0; if (this.buyer) this.releaseBuyer(); return; }
        const moving = Math.hypot(p.vx, p.vy) > 40;
        this.sellIdle = moving ? Math.max(0, this.sellIdle - dt * 2) : this.sellIdle + dt;
        if (this.buyer || this.sellIdle < 1.2 || this.buyerCooldown > 0) return;
        let best = null, bd = 600;
        for (const ped of this.peds) {
            if (ped.down > 0 || ped.attack || ped.cop || ped.mode === 'flee' || ped.type === 'gang') continue;
            const d = Math.hypot(ped.x - p.x, ped.y - p.y);
            if (d < bd) { bd = d; best = ped; }
        }
        if (!best) {
            // Ingen i närheten: en kund kommer gående från utanför skärmen
            for (let tries = 0; tries < 30 && !best; tries++) {
                const a = this.rnd() * Math.PI * 2, r = 380 + this.rnd() * 180;
                const tx = Math.floor((p.x + Math.cos(a) * r) / TILE), ty = Math.floor((p.y + Math.sin(a) * r) / TILE);
                if (!isWalkableTile(this.city, tx, ty)) continue;
                best = createPed(center(tx), center(ty), this.rnd, this.rnd() < 0.3 ? { type: 'metro', scooter: this.rnd() < 0.5 } : {});
                this.peds.push(best);
            }
        }
        if (!best) return;
        best.buyer = true;
        best.buyerT = 0;
        this.buyer = best;
        this.pedSay(best, best.type === 'metro' ? 'Psst... har du nåt? 💅' : 'Har du nåt, bror? 💸', 4);
    }

    sellTo(ped) {
        const p = this.profile;
        this.releaseBuyer();
        this.buyerCooldown = 2.5 + this.rnd() * 2.5;
        if (!(p.cityGoods > 0)) return;
        p.cityGoods--;
        const turf = this.district || districtAt(this.city, this.player.x, this.player.y);
        const gang = DISTRICTS[turf].gang;
        const own = p.gang === gang;
        const price = Math.round(190 * (TURF_PRICE[turf] || 1) * (own ? 1 : 1.3) * (0.85 + this.rnd() * 0.3) / 10) * 10;
        this.addMoney(price, ped.x, ped.y);
        const st = p.cityStats; if (st) st.sold = (st.sold || 0) + 1;
        this.sfx('coin');
        this.pedSay(ped, 'Tack bror! 🤝', 2);
        ped.mode = 'flee'; ped.t = 2; ped.angle = Math.atan2(ped.y - this.player.y, ped.x - this.player.x);
        if (this.copNear(450, true)) {
            this.crime('deal');
            this.message('👮 Snuten såg affären!');
        }
        const g = gangById(gang);
        if (own) {
            p.respect = adjustRespect(p.respect, gang, 1);
            return;
        }
        // Langning på någon annans turf: de märker det
        p.respect = adjustRespect(p.respect, gang, -3);
        this.turfHeat[gang] = (this.turfHeat[gang] || 0) + 1;
        if (!this.warnedTurf.has(gang)) {
            this.warnedTurf.add(gang);
            this.message(`⚠️ Du langar på ${g.name}s turf. De kommer märka det...`);
        }
        const chance = isHostile(p.respect, gang) ? 1 : 0.25 + 0.2 * this.turfHeat[gang];
        if (!((this.beef[gang] || 0) > 0) && this.rnd() < chance) this.spawnOpps(gang);
    }

    // OPPS: rivaler kommer till fots och i bil när du langar på deras turf
    spawnOpps(gang) {
        const g = gangById(gang);
        const p = this.player;
        this.beef[gang] = 60;
        this.turfHeat[gang] = 0;
        const st = this.profile.cityStats; if (st) st.opps = (st.opps || 0) + 1;
        this.big('OPPS!', g.color, `${g.icon} ${g.name} vet att du langar på deras turf`);
        this.sfx('opps');
        // Bär du skjutvapen kommer de också beväpnade
        const guns = hasGun(this.profile) ? 2 : 0;
        let n = 0;
        for (let tries = 0; tries < 80 && n < 4; tries++) {
            // Slumpa en punkt runt spelaren och kolla att man kan gå där
            const a = this.rnd() * Math.PI * 2, r = 260 + this.rnd() * 320;
            const tx = Math.floor((p.x + Math.cos(a) * r) / TILE), ty = Math.floor((p.y + Math.sin(a) * r) / TILE);
            if (!isWalkableTile(this.city, tx, ty)) continue;
            const x = center(tx), y = center(ty);
            const ped = createPed(x, y, this.rnd, this.gangPedOpts(g, { attack: true, attackT: 60, hp: 35 }));
            ped.gun = n < guns;
            if (ped.gun) ped.hitCd = 1.2; // ett ögonblick innan de drar
            if (n === 0) this.pedSay(ped, OPP_SHOUTS[Math.floor(this.rnd() * OPP_SHOUTS.length)], 4);
            this.peds.push(ped);
            n++;
        }
        const spot = this.findSpot(p.x, p.y, 500, 1000);
        if (spot) this.spawnGangConvoy(gang, spot, true);
        // Ditt eget gäng ställer upp om de är i närheten
        if (this.profile.gang) {
            const opps = this.peds.filter(o => o.attack && o.gang === gang);
            for (const f of this.peds) {
                if (f.gang !== this.profile.gang || f.down > 0 || Math.hypot(f.x - p.x, f.y - p.y) > 420 || !opps.length) continue;
                f.attack = true; f.attackT = 40;
                f.targetPed = opps[Math.floor(this.rnd() * opps.length)];
                this.pedSay(f, 'Vi har din rygg, bror!');
            }
        }
    }

    // Gängfordon: MC-klubbar åker i flock
    spawnGangConvoy(gang, spot, persistent) {
        const g = gangById(gang);
        const count = g.kind === 'mc' ? 2 + Math.floor(this.rnd() * 2) : 1;
        const out = [];
        for (let i = 0; i < count; i++) {
            const back = i * 46;
            const x = spot.x - Math.cos(spot.angle) * back, y = spot.y - Math.sin(spot.angle) * back;
            if (i > 0 && isSolidAt(this.city, x, y)) break;
            const v = createGangVehicle(gang, x, y, spot.angle, this.rnd);
            v.driver = 'gang';
            v.persistent = !!persistent;
            initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
            v.vx = Math.cos(v.angle) * v.ai.cruise * 0.7; v.vy = Math.sin(v.angle) * v.ai.cruise * 0.7;
            this.vehicles.push(v);
            out.push(v);
        }
        return out;
    }

    // ── Gå med i / lämna gäng ──
    joinGang(gang) {
        const g = gangById(gang);
        if (!g || !canJoin(this.profile, gang)) return false;
        this.profile.gang = gang;
        let r = adjustRespect(this.profile.respect, gang, 0);
        r[gang] = Math.max(r[gang], 50);
        r[g.rival] = Math.min(r[g.rival], -40);
        this.profile.respect = r;
        this.beef[gang] = 0;
        this.big('VÄLKOMMEN', g.color, `${g.icon} Du är nu medlem i ${g.name}`);
        this.sfx('mission');
        this.message(`${g.icon} ${g.boss}: "${g.kind === 'mc' ? 'Här är din väst och din hoj. Bär den med heder.' : 'Du är en av oss nu. Hämta din bil vid HQ.'}" ${gangById(g.rival).name} hatar dig nu.`);
        const spot = this.sideSpot({ x: this.player.x, y: this.player.y, angle: 0, spec: { w: 30, l: 60 } }, 1);
        if (spot) this.spawnGangRide({ x: spot.x, y: spot.y, angle: 0 });
        return true;
    }

    leaveGang() {
        const g = gangById(this.profile.gang);
        if (!g) return false;
        this.profile.gang = null;
        this.profile.respect = adjustRespect(this.profile.respect, g.id, -100);
        this.beef[g.id] = 45;
        this.big('AVHOPPARE', '#ef4444', `${g.icon} ${g.name} glömmer inte...`);
        this.sfx('fail');
        return true;
    }

    // Påkörd: flyger, snurrar och ligger kvar en stund. Du får combo och ibland en plånbok.
    knockPed(ped, v) {
        const sp = Math.hypot(v.vx, v.vy);
        ped.down = 4 + this.rnd() * 2 + Math.min(3, sp / 200);
        ped.vx = v.vx * 0.8; ped.vy = v.vy * 0.8;
        ped.spin = (this.rnd() < 0.5 ? -1 : 1) * (5 + sp / 50);
        ped.mode = 'down';
        if (ped.buyer) this.releaseBuyer();
        this.sfxAt('thud', ped.x, ped.y, 0.9);
        this.spawnParticle('stars', ped.x, ped.y);
        if (v.driver !== 'player') return;
        if (ped.cop) this.copDown(ped);
        const st = this.profile.cityStats; if (st) st.knockouts = (st.knockouts || 0) + 1;
        this.combo = this.comboT > 0 ? this.combo + 1 : 1;
        this.comboT = 2.5;
        const label = COMBO_NAMES[Math.min(this.combo, COMBO_NAMES.length) - 1];
        const cf = this.comboFloater;
        if (this.combo <= 2) {
            // En comboruta som räknar upp, inte en hög texter ovanpå varandra
            const text = this.combo > 1 ? `${label} x${this.combo}` : label;
            if (cf && cf.life > 0 && this.floaters.includes(cf)) Object.assign(cf, { x: ped.x, y: ped.y - 18, text, life: 1.6 });
            else { this.floater(ped.x, ped.y - 18, text, '#f472b6'); this.comboFloater = this.floaters[this.floaters.length - 1]; }
        } else {
            if (cf) cf.life = 0;
            this.big(label, '#f472b6', `${this.combo} i rad! 🎳`);
            if (this.combo === 3 || this.combo === 5 || this.combo % 10 === 0) this.sfx('combo');
        }
        if (ped.mugger) { ped.mugger = false; ped.attack = false; }
        this.dropWallet(ped, 0.3 + 0.12 * this.combo);
        if (this.date) { this.date.mood -= 25; this.message(`😱 ${this.date.name}: "Körde du just på någon?!"`); }
    }

    // ── Krockar ──
    resolveCollisions() {
        const p = this.player;
        const vs = this.vehicles.filter(v => Math.abs(v.x - p.x) < 1600 && Math.abs(v.y - p.y) < 1600);
        // Polisen (police.js): en sammanhängande kontakt per fordonspar. Skada bara från smällen när
        // kontakten börjar (eller en tydligt hårdare ny smäll), skuld efter vem som rörde sig mot vem.
        const hit = this.hitOut || (this.hitOut = { touch: false, nx: 0, ny: 0, pen: 0 });
        const now = this.time, playing = this.state === 'play' && !p.dead;
        for (let i = 0; i < vs.length; i++) {
            for (let j = i + 1; j < vs.length; j++) {
                const a = vs[i], b = vs[j];
                const avx = a.vx, avy = a.vy, bvx = b.vx, bvy = b.vy;   // farten före studsen
                const impact = collideVehicles(a, b, hit);
                if (!hit.touch) continue;
                const c = POL.touchContact(this.contacts, a, b, impact, now);
                const playerCar = a.driver === 'player' ? a : b.driver === 'player' ? b : null;
                const other = playerCar === a ? b : a;
                const copCar = !!playerCar && other.driver === 'cop' && !other.wrecked;
                if (playerCar && c.fresh) {
                    // Skuld: spelarens fart mot den andra, gas och nosen mot målet (normalen pekar från a mot b)
                    const sg = playerCar === a ? 1 : -1;
                    const pv = playerCar === a ? { vx: avx, vy: avy, angle: a.angle } : { vx: bvx, vy: bvy, angle: b.angle };
                    const ov = playerCar === a ? { vx: bvx, vy: bvy } : { vx: avx, vy: avy };
                    const jd = POL.judgeContact(pv, ov, { x: hit.nx * sg, y: hit.ny * sg }, { throttle: this.ctlIn?.throttle || 0, pushedT: now - (playerCar.pushedAt ?? -1e9) });
                    c.c.fault = jd.fault; c.c.deliberate = jd.deliberate;
                    // Knuffad av någon annan: nästa krock är en kedjekrock, inte spelarens fel
                    if (!jd.fault && jd.oApp >= POL.POLICE.faultSpeed) playerCar.pushedAt = now;
                    if (other.driver === 'traffic' && other.ai) other.ai.hornT = 0;
                }
                const fault = !!playerCar && !!c.c.fault;
                let otherDmg = 0;
                if (c.smash > 120) {
                    const dmg = impactDamage(c.smash) - impactDamage(c.prev);
                    if (dmg > 0) {
                        const da = dmg * Math.sqrt(b.spec.mass / a.spec.mass), db = dmg * Math.sqrt(a.spec.mass / b.spec.mass);
                        otherDmg = other === a ? da : db;
                        this.damageVehicle(a, da, fault && a !== playerCar ? 'player' : null);
                        this.damageVehicle(b, db, fault && b !== playerCar ? 'player' : null);
                    }
                }
                if (c.smash > 60) {
                    if (playerCar) this.shake = Math.max(this.shake, Math.min(0.9, c.smash / 700));
                    this.sfxAt('crash', (a.x + b.x) / 2, (a.y + b.y) / 2, Math.min(1, c.smash / 450));
                    for (let k = 0; k < 4; k++) this.spawnParticle('spark', (a.x + b.x) / 2, (a.y + b.y) / 2);
                }
                // En ny kontakt där spelaren är skyldig mot en polisbil: buckla, hård krock eller ramning
                if (copCar && c.fresh && fault && playing) this.copContact(other, { deliberate: !!c.c.deliberate, impact, damage: otherDmg });
            }
        }
        if ((this.contactPruneT = (this.contactPruneT || 0) + 1) > 120) { this.contactPruneT = 0; POL.pruneContacts(this.contacts, now); }
        // Bilar mot fotgängare
        for (const ped of this.peds) {
            if (ped.down > 0) continue;
            for (const v of vs) {
                if (Math.abs(v.x - ped.x) > 50 || Math.abs(v.y - ped.y) > 50) continue;
                const d = distToVehicle(v, ped.x, ped.y);
                if (d >= ped.r) continue;
                const sp = Math.hypot(v.vx, v.vy);
                if (sp > 55) {
                    const wasCop = ped.cop;
                    this.knockPed(ped, v);
                    if (v.driver === 'player' && !wasCop) {
                        this.crime('hitPed', { witnessed: this.copNear(600, true) });
                        if (ped.type === 'gang' && ped.gang !== this.profile.gang && this.gangHitT <= 0) {
                            this.profile.respect = adjustRespect(this.profile.respect, ped.gang, -3);
                            this.gangHitT = 0.5;
                        }
                    }
                    v.vx *= 0.94; v.vy *= 0.94;
                } else {
                    const dx = ped.x - v.x, dy = ped.y - v.y, l = Math.hypot(dx, dy) || 1;
                    ped.x += dx / l * 2; ped.y += dy / l * 2;
                }
                break;
            }
        }
        // Min bil mot andra spelare till fots
        if (p.vehicle && this.net) {
            const v = p.vehicle, sp = Math.hypot(v.vx, v.vy);
            if (sp > 110) {
                for (const r of this.net.remotes().values()) {
                    if (r.in || r.v || r.dead || r.prot || this.interior) continue;
                    if (distToVehicle(v, r.rx, r.ry) > 10) continue;
                    if (this.time - (this.carHitT[r.id] || -9) < 1) continue;
                    this.carHitT[r.id] = this.time;
                    this.net.request('hit', { target: r.id, crew: -1, kind: 'car', dmg: Math.min(70, (sp - 80) * 0.25), src: -1 });
                    this.sfx('thud');
                }
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
        if (byPlayer && this.time - (v.lastHitAt ?? -1e9) < 10) this.crime('explosion', { witnessed: this.copNear(700, true) });
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
        this.nearItem = null;
        if (!v && !p.dead) {
            let bd = 40;
            for (const it of this.groundItems()) {
                const d = Math.hypot(it.x - p.x, it.y - p.y);
                if (d < bd) { bd = d; this.nearItem = it; }
            }
        }
        const rc = this.city.markers.recruit;
        if (!v && rc && this.enterZone('recruit', rc.x, rc.y, 34)) this.emit({ type: 'recruit' });
        for (const pk of this.pickups) {
            if (!pk.taken && Math.hypot(p.x - pk.x, p.y - pk.y) < (v ? 36 : 26)) this.collectPickup(pk);
        }
        const m = this.city.markers;
        for (const ph of m.phones) {
            if (this.enterZone('phone-' + ph.gang, ph.x, ph.y, 54) && speed < 170) this.answerPhone(ph.gang);
        }
        m.sprays.forEach((sp, i) => { if (v && this.enterZone('spray-' + i, sp.x, sp.y, 66) && speed < 280) this.respray(); });
        if (v && this.enterZone('fence', m.fence.x, m.fence.y, 72) && speed < 280) this.fenceVehicle();
        if (!v && this.enterZone('dealer', m.dealer.x, m.dealer.y, 36)) {
            const left = (this.maxGoods ?? 10) - (this.profile.goodsBoughtThisRound || 0);
            if (left > 0) this.emit({ type: 'shop', left, price: GOODS_PRICE, goods: this.profile.cityGoods || 0 });
            else this.message('🎒 Langaren: "Slut för den här rundan, bror."');
        }
        if (!v && m.guns?.door && this.enterZone('door-guns', m.guns.door.x, m.guns.door.y, 20)) this.enterInterior('gunshop', m.guns);
        if (!v && m.stripclub?.door && this.enterZone('door-stripclub', m.stripclub.door.x, m.stripclub.door.y, 20)) this.enterInterior('stripclub', m.stripclub);
        if (v && m.club && this.enterZone('club', m.club.x, m.club.y, 70) && speed < 220) this.visitClub();
        if (!v && m.club && this.enterZone('club-foot', m.club.x, m.club.y, 26)) this.enterNightclub();
        // Gå in genom dörren (mot husväggen). Ditt eget gömställe har garage du kan köra in i.
        for (const d of this.doors()) {
            const door = d.door || d;
            if (!v) {
                if (this.enterZone('door-' + (d.id || 'biz' + d.slot), door.x, door.y, 20)) { if (d.kind === 'business') this.enterBusiness(d); else this.enterPlace(d, false); }
            } else if (d.kind === 'house' && this.ownsHouse(d) && this.enterZone('garage-' + d.id, door.x, door.y, 52) && speed < 220) {
                this.enterPlace(d, true);
            }
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
                if (POL.reduceLevel(this.police, 1, 'Mutad – en nivå mindre')) { this.releaseUnits(); this.message('👮 Snuten mutad! En nivå mindre.'); }
                else { this.police.heat = Math.max(0, this.police.heat - 1); this.message('👮 Snuten mutad! Trycket på dig minskar.'); }
                this.savePolice(true);
                break;
            case 'health': p.hp = p.maxHp; this.message('❤️ Full hälsa!'); break;
        }
        this.sfx('pickup');
        for (let i = 0; i < 8; i++) this.spawnParticle('spark', pk.x, pk.y);
    }

    answerPhone(gang) {
        const g = gangById(gang);
        this.sfx('phone');
        if (!phoneAccess(this.profile, gang)) {
            const why = this.profile.gang && gangById(this.profile.gang).rival === gang ? `du är ${gangById(this.profile.gang).name}` : 'de respekterar dig inte';
            this.message(`📞 *klick* ${g.name} lägger på — ${why}.`);
            return;
        }
        const member = this.profile.gang === gang;
        let mission = null, note = null;
        if (this.mission) note = 'Du har redan ett uppdrag på gång.';
        else if ((this.profile.missionsThisRound || 0) >= this.maxMissions) note = `${g.boss}: "Lugna dig, kom tillbaka nästa runda."`;
        else {
            mission = createMission(gang, {
                rng: mulberry32(Math.floor(this.rnd() * 1e9)), round: this.round,
                respect: this.profile.respect[gang] || 0, city: this.city, from: this.player, member
            });
        }
        const join = canJoin(this.profile, gang);
        if (!mission && !join && !member) { this.message('📞 ' + note); return; }
        this.emit({ type: 'phone', gang, mission, note, canJoin: join, isMember: member, respect: this.profile.respect[gang] || 0, hasGang: !!this.profile.gang });
    }

    respray() {
        const v = this.player.vehicle;
        const s = stars(this.wanted);
        if (s === 0 && v.hp >= v.maxHp) { this.message('🎨 "Bilen ser ju fin ut redan?"'); return; }
        const cost = 150 + 200 * s;
        if (!this.spend(cost)) { this.message(`🎨 Lackningen kostar ${cost} kr — du har inte råd!`); return; }
        if (POL.clearPolice(this.police, 'Ny lack – polisen känner inte igen bilen')) this.releaseUnits();
        this.savePolice(true);
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
        if (v.spec.police) this.crime('fenceCop', { witnessed: this.copNear(600, true) });
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
        // Det kunderna betalat (kassan fylls igen, men töms en gång per runda)
        const amt = this.tillOf(mk.slot);
        this.tills[mk.slot] = 0;
        this.profile.cityCollected.push(shop.id);
        this.addMoney(amt, mk.x, mk.y);
        this.sfx('coin');
        this.message(`${shop.icon} ${shop.name}: kassan hämtad! +${amt.toLocaleString('sv-SE')} kr`);
    }

    // ── Crew ──
    recruitOffers() { return crewCandidates(this.profile.charKey, this.round).map(c => ({ ...c, ...canRecruit(this.profile, c) })); }

    recruit(id) {
        const cand = crewCandidates(this.profile.charKey, this.round).find(c => c.id === id);
        if (!cand) return false;
        const chk = canRecruit(this.profile, cand);
        if (!chk.ok) { this.message(`👥 ${chk.reason}`); return false; }
        if (!this.spend(cand.cost)) return false;
        const m = { id: cand.id, name: cand.name, role: cand.role, trait: cand.trait, hp: cand.hp, dmg: cand.dmg, speed: cand.speed, cost: cand.cost };
        this.profile.crew.push(m);
        const s = spotNear(this.city, this.player.x, this.player.y, this.crew.length);
        this.crew.push(makeMember(m, this.crew.length, s.x, s.y));
        this.sfx('mission');
        this.big('NY I CREWET!', '#22c55e', `${ROLES[m.role].icon} ${m.name} — ${ROLES[m.role].name}`);
        return true;
    }

    dismiss(id) {
        const i = this.profile.crew.findIndex(m => m.id === id);
        if (i < 0) return false;
        const [m] = this.profile.crew.splice(i, 1);
        this.crew = this.crew.filter(c => c.id !== id);
        this.crew.forEach((c, j) => { c.idx = j; });
        this.message(`👋 ${m.name} lämnade crewet.`);
        return true;
    }

    orderCrew(order) {
        if (!this.crew.length) { this.message('👥 Du har inget crew. Rekrytera vid 👥 nära HQ.'); return false; }
        const r = crewOrder(this, order);
        this.message(r.text);
        if (r.ok) this.sfx('click', 0.6);
        return r.ok;
    }

    crewMelee(c, tgt, dmg) {
        if (tgt.kind === 'ped') { this.hitPed(tgt.ped, dmg, c); return; }
        this.net?.request('hit', { target: tgt.id, crew: tgt.kind === 'rcrew' ? tgt.idx : -1, kind: 'melee', dmg, src: c.idx });
    }

    crewShoot(c, tpos, dmg) {
        const a = Math.atan2(tpos.y - c.y, tpos.x - c.x) + (this.rnd() - 0.5) * 0.08;
        c.angle = a;
        const sx = c.x + Math.cos(a) * 10, sy = c.y + Math.sin(a) * 10;
        this.bullets.push({ x: sx, y: sy, px: sx, py: sy, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 0.4, dmg, from: 'crew', src: c.idx });
        c.muzzle = 0.07;
        this.sfxAt('shot', c.x, c.y, 0.7);
    }

    hurtCrew(c, dmg, byName) {
        if (c.down > 0 || c.hidden) return;
        c.hp -= dmg;
        c.flashT = 0.12;
        if (c.hp <= 0) {
            c.hp = 0;
            c.down = CREW_RECOVER;
            this.floater(c.x, c.y - 22, `💤 ${c.name} nere`, '#f87171');
            this.message(`👥 ${c.name} slogs ner${byName ? ` av ${byName}` : ''}. Reser sig om ${CREW_RECOVER} s (eller ring doktorn 📱).`);
        }
    }

    bulletHitCrew(b) {
        for (const c of this.crew) {
            if (c.hidden || c.down > 0 || this.interior) continue;
            if (Math.abs(c.x - b.x) > 12 || Math.abs(c.y - b.y) > 12) continue;
            if (Math.hypot(c.x - b.x, c.y - b.y) > c.r + 2) continue;
            this.hurtCrew(c, b.dmg, null);
            return true;
        }
        return false;
    }

    // ── Vapen och grejer på marken (värden avgör vem som får dem) ──
    groundItems() {
        if (this.interior) return [];
        const taken = this.net ? this.net.taken() : this.localTaken;
        return cityItemDefs(this.city).filter(it => !taken.has(it.id));
    }

    tryPickup(it) {
        const gain = itemGain(this.profile, it.type, this.player.armor);
        if (!gain) { this.message(`${ITEM_TYPES[it.type].icon} Du har redan fullt av det där.`); return false; }
        if (this.pending.pickup) return false;
        if (!this.net) { this.localTaken.add(it.id); this.applyGain(it.type); return true; }
        return this.netAsk('pickup', 'pickup', { item: it.id });
    }

    applyGain(type) {
        const gain = itemGain(this.profile, type, this.player.armor);
        const def = ITEM_TYPES[type];
        if (!gain) { this.message(`${def.icon} Du har redan fullt.`); return; }
        const prof = this.profile;
        if (gain.weapon) {
            prof.weapons.push(gain.weapon);
            if (gain.ammo) prof.ammo[gain.weapon] = (prof.ammo[gain.weapon] || 0) + gain.ammo;
            if (prof.weapon === 'fists') prof.weapon = gain.weapon;
        } else if (gain.ammoFor) prof.ammo[gain.ammoFor] = (prof.ammo[gain.ammoFor] || 0) + gain.ammo;
        else if (gain.armor) { this.player.armor += gain.armor; prof.armor = this.player.armor; }
        this.sfx('reload');
        const what = gain.weapon ? `${def.label}${gain.ammo ? ` + ${gain.ammo} skott` : ''}` : gain.ammoFor ? `+${gain.ammo} skott till ${WEAPONS[gain.ammoFor].name}` : `+${gain.armor} skyddsväst`;
        this.floater(this.player.x, this.player.y - 30, `${def.icon} ${what}`, '#86efac');
    }

    // Fråga värden. Id:t sparas innan frågan skickas — offline kommer svaret direkt.
    netAsk(slot, type, data) {
        const req = `${this.profile.charKey}-${slot}-${++this.reqSeq || (this.reqSeq = 1)}-${Math.round(this.time * 1000)}`;
        this.pending[slot] = req;
        const ok = this.net.request(type, { ...data, req });
        if (!ok && this.pending[slot] === req) { this.pending[slot] = null; this.message('📡 Ingen kontakt med värden just nu.'); }
        return !!ok;
    }

    // ── PvP ──
    // Närmaste andra spelare (eller deras crew) inom räckhåll till fots
    remoteInReach(x, y, range) {
        if (!this.net || this.interior) return null;
        let best = null;
        for (const r of this.net.remotes().values()) {
            if (r.in || r.dead || r.v) continue;
            const prot = !!r.prot; // värden nekar träffar på skyddade spelare och deras crew
            const d = Math.hypot(r.rx - x, r.ry - y);
            if (d <= range && (!best || d < best.d)) best = { id: r.id, crew: -1, x: r.rx, y: r.ry, d, prot };
            (r.crew || []).forEach((c, idx) => {
                if (c.d) return;
                const dc = Math.hypot(c.x - x, c.y - y);
                if (dc <= range && (!best || dc < best.d)) best = { id: r.id, crew: idx, x: c.x, y: c.y, d: dc, prot };
            });
        }
        return best;
    }

    bulletHitRemote(b) {
        if (!this.net || this.interior) return false;
        for (const r of this.net.remotes().values()) {
            if (r.in || r.dead) continue;
            const rad = r.v ? 22 : 11;
            if (Math.abs(r.rx - b.x) < rad && Math.abs(r.ry - b.y) < rad && Math.hypot(r.rx - b.x, r.ry - b.y) < rad) {
                if (r.prot) {
                    if (b.from === 'player' && this.time - (this.protMsgT ?? -9) > 1.2) { this.protMsgT = this.time; this.floater(r.rx, r.ry - 26, '🛡️ SKYDDAD', '#93c5fd'); }
                    this.spawnParticle('spark', b.x, b.y);
                    return true;
                }
                this.net.request('hit', { target: r.id, crew: -1, kind: 'bullet', dmg: b.dmg, src: b.src ?? -1, veh: !!r.v });
                this.spawnParticle('spark', b.x, b.y);
                return true;
            }
            const ci = (r.crew || []).findIndex(c => !c.d && Math.hypot(c.x - b.x, c.y - b.y) < 10);
            if (ci >= 0) {
                this.net.request('hit', { target: r.id, crew: ci, kind: 'bullet', dmg: b.dmg, src: b.src ?? -1 });
                this.spawnParticle('spark', b.x, b.y);
                return true;
            }
        }
        return false;
    }

    // En annan spelare träffade mig (värden har godkänt träffen)
    hurtByPlayer(dmg, from, name) {
        const p = this.player;
        this.lastAttacker = { id: from, name, t: this.time };
        this.lastHurtT = this.time;
        const absorbed = Math.min(p.armor || 0, dmg * 0.6);
        p.armor = Math.max(0, (p.armor || 0) - absorbed);
        this.profile.armor = Math.round(p.armor);
        p.hp -= dmg - absorbed;
        p.hurtT = 0.3;
        this.shake = Math.max(this.shake, 0.4);
        this.sfx('hurt', 0.9);
        if (p.hp <= 0) this.pvpDefeat(from, name);
    }

    // Sänkt av en annan spelare: man tappar en del kontanter och kommer tillbaka vid HQ med skydd
    pvpDefeat(from, name) {
        const p = this.player;
        if (this.pvpT > 0) return;
        if (p.vehicle) { const v = p.vehicle; v.vx *= 0.2; v.vy *= 0.2; p.vehicle = null; v.driver = null; this.emit({ type: 'exitCar' }); }
        p.hp = 0; p.dead = true;
        this.pvpT = 4;
        const lost = pvpLoss(this.profile.money);
        this.profile.money -= lost;
        const st = this.profile.cityStats; if (st) st.pvpLosses = (st.pvpLosses || 0) + 1;
        this.big('SÄNKT', '#ef4444', `${name || 'En rival'} tog dig${lost ? ` · −${lost.toLocaleString('sv-SE')} kr` : ''}`);
        this.sfx('wasted');
        this.net?.request('down', { lost });
    }

    updatePvp(dt) {
        const p = this.player;
        p.protT = Math.max(0, (p.protT || 0) - dt);
        if (this.pvpT <= 0) return;
        this.pvpT -= dt;
        if (this.pvpT > 0) return;
        // Tillbaka vid HQ, med några sekunders skydd så att man inte blir nedskjuten direkt igen
        const h = this.city.markers.home;
        p.dead = false; p.hp = p.maxHp; p.x = h.x; p.y = h.y; p.vx = p.vy = 0;
        p.protT = SPAWN_PROTECTION;
        this.crew.forEach((c, i) => { const s = spotNear(this.city, h.x, h.y, i); c.x = s.x; c.y = s.y; c.hidden = false; });
        this.message(`🏠 Tillbaka vid HQ. ${SPAWN_PROTECTION} sekunders skydd.`);
    }

    // ── Tjänster (telefonen) ──
    taxiDestinations() {
        const m = this.city.markers;
        const list = [['🏠 HQ', m.home], ['💎 Club Diamant', m.stripclub], ['🔫 Pang-Pelle', m.guns], ['🏦 Banken', m.bank], ['🍾 Nattklubben', m.club]];
        for (const h of m.houses || []) if (this.ownsHouse(h)) list.push([`🏡 ${h.name}`, h]);
        const p = this.player;
        return list.filter(([, o]) => o).map(([label, o], i) => {
            const t = o.door ? { x: o.door.x - DX[o.door.side] * 30, y: o.door.y - DY[o.door.side] * 30 } : { x: o.x, y: o.y };
            const price = Math.round((120 + Math.hypot(t.x - p.x, t.y - p.y) / 12) / 10) * 10;
            return { i, label, x: t.x, y: t.y, price };
        });
    }

    taxi(i) {
        const p = this.player;
        if (stars(this.wanted) > 0) { this.message('🚕 "Inte med snuten efter dig, bror." Skaka av dem först.'); return false; }
        if (p.vehicle) { this.message('🚕 Kliv ur bilen först.'); return false; }
        if (this.pvpT > 0 || p.dead) return false;
        const d = this.taxiDestinations()[i];
        if (!d || !this.spend(d.price)) { this.message('🚕 Du har inte råd med taxin.'); return false; }
        p.x = d.x; p.y = d.y; p.vx = p.vy = 0;
        this.crew.forEach((c, j) => { const s = spotNear(this.city, d.x, d.y, j); c.x = s.x; c.y = s.y; c.hidden = false; });
        this.time += 12;
        this.fade = { t: 0, dur: 1.6, text: '🚕 Taxi...', sub: `${d.label} · ${d.price} kr` };
        this.sfx('door');
        return true;
    }

    doctorPrice() { return 400 + 200 * this.crew.filter(c => c.down > 0).length; }

    callDoctor() {
        const p = this.player;
        if (this.time - this.lastHurtT < 5) { this.message('🚑 Doktorn kommer inte mitt i en strid. Ta dig undan först.'); return false; }
        if (p.hp >= p.maxHp && !this.crew.some(c => c.down > 0 || c.hp < c.maxHp)) { this.message('🚑 Ni är ju helt friska.'); return false; }
        const price = this.doctorPrice();
        if (!this.spend(price)) { this.message(`🚑 Doktorn kostar ${price} kr.`); return false; }
        p.hp = p.maxHp;
        this.crew.forEach(c => { c.down = 0; c.hp = c.maxHp; });
        this.sfx('pickup');
        this.big('LAPPAD!', '#22c55e', `🚑 Full hälsa för dig och crewet · −${price} kr`);
        return true;
    }

    buyArmor() {
        if (stars(this.wanted) > 0) { this.message('🔫 Pang-Pelle: "Inte med snuten efter dig!"'); return false; }
        if ((this.player.armor || 0) >= ARMOR_CAP) { this.message('🦺 Du har redan full skyddsväst.'); return false; }
        if (!this.spend(800)) { this.message('🦺 Skyddsvästen kostar 800 kr.'); return false; }
        this.player.armor = Math.min(ARMOR_CAP, (this.player.armor || 0) + 50);
        this.profile.armor = this.player.armor;
        this.sfx('reload');
        this.message('🦺 +50 skyddsväst. Den tar över hälften av skadan från skott och slag.');
        return true;
    }

    // ── Fastigheter som delas mellan spelare (stripklubben): värden avgör ──
    propertyInfo(prop) {
        const def = PROPERTIES[prop];
        const cur = (this.ownersRef ? this.ownersRef() : null)?.[prop] || null;
        const mine = cur && cur.owner === this.profile.charKey;
        return { ...def, prop, owner: cur ? cur.owner : null, mine, price: cur && !mine ? Math.round(def.price * def.takeover) : def.price };
    }

    buyProperty(prop) {
        if (this.pending.buy) return false;
        const info = this.propertyInfo(prop);
        if (info.mine) { this.message('💎 Den är redan din.'); return false; }
        if ((this.profile.money || 0) < info.price) { this.message(`💎 Det kostar ${info.price.toLocaleString('sv-SE')} kr.`); return false; }
        if (!this.net) return false;
        return this.netAsk('buy', 'buyProp', { prop, money: this.profile.money });
    }

    // ── Inomhus: stripklubben och vapenaffären är riktiga rum att gå omkring i ──
    enterInterior(id, marker) {
        const def = INT.INTERIORS?.[id];
        const p = this.player;
        if (!def || p.vehicle || this.interior) return false;
        const ban = BRAWL.bannedFor(this, id);
        if (ban > 0) {
            if (this.time - (this.banMsgT ?? -9) > 2) { this.banMsgT = this.time; this.message(`🕴️ Vakten: "Du igen? Du kommer inte in. Försök om ${Math.ceil(ban)} s."`); }
            return false;
        }
        const door = marker.door || marker;
        this.interior = {
            id, def, door: { x: door.x, y: door.y, side: door.side ?? 0 },
            state: INT.createInteriorState(id, this.rnd),
            seen: this.police.level > 0 && this.copSees(), // såg snuten dig gå in väntar de utanför
            exitArmed: false,
            biz: marker.kind === 'business' ? marker : marker.biz || null, // ett av företagen: kassa och meny vid disken
            zoneKey: marker.kind === 'business' ? 'door-biz' + marker.slot : marker.kind === 'nightclub' ? 'club-foot' : 'door-' + (id === 'gunshop' ? 'guns' : id)
        };
        // Polisen: sågs du gå in är platsen känd (de väntar utanför), annars letar de där du sågs sist
        POL.enteredPlace(this.police, this.interior.door, this.interior.seen);
        p.x = def.spawn.x; p.y = def.spawn.y; p.vx = p.vy = 0; p.angle = -Math.PI / 2;
        this.bullets = [];
        this.nearItem = null;
        this.crew.forEach((c, i) => { if (c.down > 0) return; c.interior = id; c.hidden = false; c.x = def.spawn.x + (i - 1.5) * 22; c.y = def.spawn.y + 18; c.angle = -Math.PI / 2; });
        this.sfx('door');
        this.emit({ type: 'interior', id, music: def.music || null });
        if (id === 'stripclub') {
            const own = this.propertyInfo('stripclub');
            this.message(`💎 Välkommen till Club Diamant. Inga vapen, inga bråk. ${own.mine ? 'Klubben är din.' : own.owner ? `Ägare: ${this.nameOf ? this.nameOf(own.owner) : own.owner}.` : 'Till salu — prata med managern.'}`);
        } else if (id === 'gunshop') this.message('🔫 Pang-Pelle: "Kom in, kom in. Prata med mig vid disken."');
        else if (marker && (marker.kind === 'business' || marker.biz)) {
            const shop = SHOPS[(marker.biz || marker).slot], owned = (this.profile.owned || []).includes(shop.id);
            this.message(`${shop.icon} ${shop.name} — ${owned ? 'ditt ställe. Personalen jobbar, kassan fylls.' : 'öppet och fullt av folk. Till salu: prata med disken.'}`);
        }
        return true;
    }

    exitInterior() {
        const I = this.interior;
        if (!I) return;
        const p = this.player;
        const ox = I.door.x - DX[I.door.side] * 26, oy = I.door.y - DY[I.door.side] * 26;
        p.x = ox; p.y = oy; p.vx = p.vy = 0; p.angle = Math.atan2(-DY[I.door.side], -DX[I.door.side]);
        this.crew.forEach((c, i) => { c.interior = null; const s = spotNear(this.city, ox, oy, i); c.x = s.x; c.y = s.y; });
        // Gick du in utan att synas tappar snuten spåret under tiden; såg de dig står de kvar
        POL.leftPlace(this.police);
        this.interior = null;
        this.inside.add(I.zoneKey);
        this.sfx('door');
        this.emit({ type: 'interior', id: null, music: null });
    }

    updateInteriorMode(dt, input) {
        const I = this.interior, p = this.player, def = I.def;
        // Gå omkring: samma blick, gång längs blicken och spring som ute (footStep)
        this.footStep(dt, input, 110, 165);
        p.x += p.vx * dt; p.y += p.vy * dt;
        INT.collideInterior(def, p, p.r);
        p.hurtT = Math.max(0, (p.hurtT || 0) - dt);
        p.protT = Math.max(0, (p.protT || 0) - dt);
        p.punchT = Math.max(0, (p.punchT || 0) - dt);
        if (I.biz) {
            const shop = SHOPS[I.biz.slot];
            I.state.owned = (this.profile.owned || []).includes(shop.id);
            // mitt i ett slagsmål (brawl.js) kommer inga nya kunder in
            I.state.flow = I.state.brawlT > 0 ? 0 : bizFlow(shop.id, this.hour());
        }
        INT.updateInterior(I.state, dt, this.rnd);
        // Kunderna som betalade vid disken: pengarna hamnar i kassan
        const ev = I.state.events;
        if (ev && ev.length) {
            for (const e of ev) if (e.type === 'sale' && I.biz) this.bizSale(I.biz.slot, e.x, e.y);
            ev.length = 0;
        }
        // Prata med folk (E). Bråk går att starta överallt utom hos Pang-Pelle (brawl.js).
        this.nearInteraction = INT.interactionAt(def, p.x, p.y);
        if (input.action && this.nearInteraction) this.emit({ type: 'interact', id: this.nearInteraction.id });
        if (BRAWL.canBrawl(I)) {
            if (input.punch) BRAWL.playerPunch(this);
            if (input.rob && !BRAWL.playerRob(this) && this.robCd <= 0) { this.robCd = 2; this.message('👛 Här inne rånar man ingen — men den som ligger ner kan du länsa.'); }
            BRAWL.updateBrawl(this, dt);
            if (this.interior !== I) return; // utslängd
        } else if ((input.punch || input.rob) && this.punchCd <= 0) { this.punchCd = 0.75; this.message('🔫 Pang-Pelle: "Lugn! Inte i min butik."'); }
        // Ut genom dörren (först när man gått en bit in, så att man inte studsar ut direkt)
        const atExit = INT.atInteriorExit ? INT.atInteriorExit(def, p.x, p.y) : Math.hypot(p.x - def.exit.x, p.y - def.exit.y) < def.exit.r;
        if (!atExit) I.exitArmed = true;
        else if (I.exitArmed) { this.exitInterior(); return; }
        // Snuten: såg de dig gå in väntar de utanför, annars kan sökningen ta slut medan du är inne
        if (this.state === 'play') this.updatePoliceInside(dt);
        this.updateParticles(dt);
        this.updateRemotes(dt);
        const fight = BRAWL.brawlHint(this);
        const urgent = fight && (I.fight?.on || fight.startsWith('R')); // mitt i bråket, eller någon att länsa
        this.hint = urgent ? fight : this.nearInteraction ? this.nearInteraction.label : atExit ? '🚪 Ut' : fight;
    }

    // ── Club Diamant: baren, scenen, vakten och managern ──
    clubMine() { return this.propertyInfo('stripclub').mine; }

    clubDrink() {
        const p = this.player, price = this.clubMine() ? 0 : 150;
        if (p.hp >= p.maxHp) { this.message('🍸 Bartendern: "Du ser ut att må fint redan."'); return false; }
        if (price && !this.spend(price)) { this.message('🍸 En drink kostar 150 kr.'); return false; }
        p.hp = Math.min(p.maxHp, p.hp + 25);
        this.sfx('coin', 0.6);
        this.message(`🍸 Skål! +25 hälsa${price ? ` · −${price} kr` : ' · på huset, chefen'}`);
        return true;
    }

    clubTip() {
        if (this.time - (this.tipT ?? -99) < 15) { this.message('💸 Vänta lite — scenen har precis fått.'); return false; }
        if (!this.spend(300)) { this.message('💸 Dricks kostar 300 kr.'); return false; }
        this.tipT = this.time;
        this.profile.rep = (this.profile.rep || 0) + 1;
        for (let i = 0; i < 10; i++) this.floater(this.player.x + (this.rnd() - 0.5) * 60, this.player.y - 10 - this.rnd() * 30, '💸', '#22c55e');
        this.sfx('coin');
        this.message('💸 Sedlar regnar över scenen. Publiken jublar — +1 rykte.');
        return true;
    }

    // Vakten går att anställa som livvakt, en gång per runda
    bouncerOffer() {
        return { id: `bouncer-${this.round}`, name: 'Stora Sven', role: 'guard', trait: 'Ex-vakt (tuff)', hp: 120, dmg: [18, 24], speed: 160, cost: 3500 };
    }

    hireBouncer() {
        const b = this.bouncerOffer();
        if (this.doneThisRound('bouncer')) { this.message('🕴️ Sven har redan gått med någon den här rundan.'); return false; }
        const chk = canRecruit(this.profile, b);
        if (!chk.ok) { this.message(`🕴️ ${chk.reason}`); return false; }
        if (!this.spend(b.cost)) return false;
        this.markDone('bouncer');
        this.profile.crew.push(b);
        const s = this.interior ? { x: this.player.x + 20, y: this.player.y } : spotNear(this.city, this.player.x, this.player.y, this.crew.length);
        const m = makeMember(b, this.crew.length, s.x, s.y);
        m.interior = this.interior ? this.interior.id : null;
        this.crew.push(m);
        this.sfx('mission');
        this.big('NY I CREWET!', '#22c55e', '🛡️ Stora Sven — Livvakt');
        return true;
    }

    // Ägaren kan låta crewet vila upp sig i klubben (crew-bas)
    clubCrewRest() {
        if (!this.clubMine()) return false;
        this.crew.forEach(c => { c.down = 0; c.hp = c.maxHp; });
        this.player.hp = this.player.maxHp;
        this.sfx('pickup');
        this.message('🛋️ Crewet vilar i VIP-rummet. Alla är i toppform.');
        return true;
    }

    // ── Verksamheterna lever: kassor, kunder, försäljning ──
    // Kassorna fylls lite i taget även när man inte är där (inne i rummet sköter kunderna det)
    updateBusinesses(dt) {
        if ((this.bizT -= dt) > 0) return;
        this.bizT = 1;
        const h = this.hour(), inside = this.interior?.biz?.slot;
        SHOPS.forEach((s, slot) => {
            if (slot === inside) return;
            this.tills[slot] = Math.min(tillCap(s), this.tills[slot] + salePrice(s) * bizFlow(s.id, h) / 8);
        });
    }

    // En kund betalade vid disken
    bizSale(slot, x, y) {
        const s = SHOPS[slot];
        if (!s) return;
        const price = salePrice(s), cap = tillCap(s);
        this.tills[slot] = Math.min(cap, this.tills[slot] + price);
        this.floater(x, y - 18, `+${price.toLocaleString('sv-SE')} kr`, this.tills[slot] >= cap ? '#9ca3af' : '#86efac');
        this.sfx('coin', 0.25);
    }

    tillOf(slot) { return Math.floor(this.tills[slot] || 0); }

    // Ute på gatan: folk går in i butikerna och kommer ut igen
    updateShoppers(dt) {
        if ((this.shopperT -= dt) > 0) return;
        this.shopperT = 0.9 + this.rnd() * 0.8;
        const p = this.player, h = this.hour();
        const near = this.city.markers.businesses.filter(b => Math.hypot(b.door.x - p.x, b.door.y - p.y) < 650);
        if (!near.length) return;
        const b = near[Math.floor(this.rnd() * near.length)], s = SHOPS[b.slot], o = b.door;
        if (this.rnd() > bizFlow(s.id, h) * 0.7) return;
        const fx = o.x - DX[o.side] * 16, fy = o.y - DY[o.side] * 16;
        if (this.rnd() < 0.5) {
            // Någon kommer ut
            if (this.peds.length >= 60) return;
            const ped = createPed(fx, fy, this.rnd, {});
            ped.angle = Math.atan2(-DY[o.side], -DX[o.side]);
            ped.shopper = true;
            this.peds.push(ped);
        } else {
            // Någon i närheten går in
            const cand = this.peds.find(e => !e.goIn && !e.attack && !e.cop && !e.buyer && !e.mugger && e.type !== 'gang' && !(e.down > 0)
                && Math.hypot(e.x - fx, e.y - fy) < 240 && Math.hypot(e.x - p.x, e.y - p.y) > 40);
            if (cand) cand.goIn = { x: fx, y: fy, ox: o.x, oy: o.y, slot: b.slot };
        }
    }

    // Rummen man går omkring i (inte menyer): Club Diamant och Pang-Pelle
    specialDoors() {
        const m = this.city.markers, out = [];
        if (m.stripclub?.door) {
            const info = this.propertyInfo('stripclub');
            const sub = info.mine ? 'DIN KLUBB' : info.owner ? `ÄGS AV ${this.nameOf ? this.nameOf(info.owner) : info.owner}`.toUpperCase() : `TILL SALU · ${info.price.toLocaleString('sv-SE')} KR`;
            out.push({ id: 'stripclub', door: m.stripclub.door, icon: '💎', name: 'Club Diamant', title: 'CLUB DIAMANT', sub, color: '#f472b6', neon: '#fbcfe8' });
        }
        if (m.guns?.door) out.push({ id: 'gunshop', door: m.guns.door, icon: '🔫', name: 'Pang-Pelle', title: 'PANG-PELLE', sub: 'VAPEN · AMMO · VÄST', color: '#f97316', neon: '#fed7aa' });
        return out;
    }

    // 🍾-entrén i Centrum leder in i nattklubbens rum (samma verksamhet som Nattklubben VIP)
    enterNightclub() {
        const m = this.city.markers, slot = SHOPS.findIndex(s => s.id === 'club');
        const biz = m.businesses.find(b => b.slot === slot) || null;
        if (INT.INTERIORS.club && m.club && !this.player.vehicle) this.enterInterior('club', { ...m.club, kind: 'nightclub', biz });
        else this.enterPlace(this.nightclubPlace());
    }

    nightclubPlace() {
        const c = this.city.markers.club;
        return c ? { kind: 'nightclub', id: 'nightclub', name: 'Nattklubben', x: c.x, y: c.y } : null;
    }

    // Närmaste ställe man kan gå in på härifrån: { d, icon, name, enter() }
    doorInReach(maxD = 46) {
        const p = this.player, m = this.city.markers;
        let best = null;
        // extra: nattklubbens entré är en hel trappa, inte en smal dörr. room: rummet innanför (för utelåsningen)
        const consider = (x, y, icon, name, enter, extra = 0, room = null) => {
            const d = Math.hypot(x - p.x, y - p.y);
            if (d <= maxD + extra && (!best || d - extra < best.d - best.extra)) best = { d, extra, icon, name, enter, room };
        };
        for (const pl of this.doors()) {
            const o = pl.door || pl;
            const icon = pl.kind === 'business' ? SHOPS[pl.slot].icon : pl.kind === 'house' ? (this.ownsHouse(pl) ? '🏡' : '🔑') : '🏦';
            consider(o.x, o.y, icon, this.placeName(pl), () => (pl.kind === 'business' ? this.enterBusiness(pl) : this.enterPlace(pl, false)), 0, pl.kind === 'business' ? bizInterior(pl.slot) : null);
        }
        for (const sd of this.specialDoors()) consider(sd.door.x, sd.door.y, sd.icon, sd.name, () => this.enterInterior(sd.id, sd.id === 'stripclub' ? m.stripclub : m.guns), 0, sd.id);
        const nc = this.nightclubPlace();
        if (nc) consider(nc.x, nc.y, '🍾', nc.name, () => this.enterNightclub(), 14, INT.INTERIORS.club ? 'club' : null);
        return best;
    }

    // ── Ställen att gå in i: fastigheter (företagen), gömställen och banken ──
    doors() {
        const m = this.city.markers;
        return [...m.businesses, ...(m.houses || []), ...(m.bank ? [m.bank] : [])];
    }
    placeName(d) { return d.kind === 'business' ? SHOPS[d.slot].name : d.name; }
    ownsHouse(h) { return (this.profile.cityHouses || []).includes(h.id); }
    doneThisRound(key) { return (this.profile.cityDone || []).includes(key); }
    markDone(key) { (this.profile.cityDone || (this.profile.cityDone = [])).push(key); }
    armed() { const id = this.profile.weapon; return !(WEAPONS[id] || WEAPONS.fists).melee && (this.profile.ammo[id] || 0) > 0; }

    // Företagen har riktiga rum med personal och kunder (annars menyn vid dörren)
    enterBusiness(pl) {
        const id = bizInterior(pl.slot);
        if (id && !this.player.vehicle && !this.interior) { this.enterInterior(id, pl); return; }
        this.enterPlace(pl, false);
    }

    enterPlace(pl, byCar = false) {
        if (this.place) return;
        // Såg snuten dig gå in? Då väntar de utanför (platsen är känd).
        this.place = { pl, byCar, seen: this.police.level > 0 && this.copSees() };
        if (!this.interior) POL.enteredPlace(this.police, pl.door || pl, this.place.seen);
        if (byCar && this.player.vehicle) { this.player.vehicle.vx = 0; this.player.vehicle.vy = 0; }
        this.sfx('door');
        this.emit({ type: 'place' });
    }
    leavePlace() {
        if (this.place && !this.interior) POL.leftPlace(this.police);
        this.place = null;
    }

    // Vad man kan göra där inne (index.js ritar menyn)
    placeInfo() {
        const P = this.place;
        if (!P) return null;
        const { pl, byCar, seen } = P;
        const prof = this.profile, p = this.player, s = stars(this.wanted);
        const money = prof.money || 0;
        const kr = n => n.toLocaleString('sv-SE') + ' kr';
        const actions = [];
        const add = (id, label, opts = {}) => actions.push({ id, label, ...opts });
        if (pl.kind === 'business') {
            const shop = SHOPS[pl.slot];
            const owned = (prof.owned || []).includes(shop.id);
            const sv = SERVICES[shop.id];
            const till = this.tillOf(pl.slot), inRoom = this.interior?.biz === pl;
            const guests = inRoom ? this.interior.state.npcs.filter(n => (n.customer || n.cust || n.kind === 'customer') && !n.brawl).length : 0;
            if (!owned) add('buy', `🏢 Köp verksamheten · ${kr(shop.price)}`, { disabled: money < shop.price, note: `Personalen fortsätter jobba åt dig · ${kr(shop.income)} per runda i imperiet + kassan här` });
            else {
                const done = (prof.cityCollected || []).includes(shop.id);
                add('collect', `💰 Töm kassan · ${kr(till)}`, { disabled: done || till < 1, note: done ? 'Redan tömd den här rundan — den fylls till nästa' : 'Allt kunderna betalat' });
            }
            if (sv) {
                const price = owned ? 0 : sv.price;
                const why = sv.id === 'train' && (prof.strength || 0) >= 5 ? 'Du är redan i toppform'
                    : sv.needsStars && s === 0 ? 'Du är inte efterlyst'
                        : sv.perRound && this.doneThisRound(sv.id) ? 'Redan gjort den här rundan' : '';
                add(sv.id, `${sv.icon} ${sv.label} · ${price ? kr(price) : 'gratis'}`, { disabled: !!why || money < price, note: why || sv.note });
            }
            if (!owned) {
                const robbed = this.doneThisRound('rob:' + pl.slot);
                add('rob', `🔫 Råna kassan · ${kr(till)}`, { disabled: robbed, note: robbed ? 'Redan rånad den här rundan' : this.armed() ? 'Med vapen i handen lämnar de över' : 'Utan vapen slänger de ut dig varannan gång' });
            }
            add('leave', inRoom ? '👋 Klar' : '🚪 Gå ut');
            const live = `Kassan: ${kr(till)}${inRoom ? ` · ${guests} kunder inne` : ''}`;
            return { icon: shop.icon, title: shop.name, color: owned ? '#22c55e' : '#ffd23f', desc: owned ? `Din verksamhet · nivå ${(prof.levels || {})[shop.id] || 1} · ${live}` : `${shop.desc}. Öppet och till salu. ${live}`, actions };
        }
        if (pl.kind === 'house') {
            const owned = this.ownsHouse(pl);
            if (!owned) add('buyhouse', `🏡 Köp · ${kr(pl.price)}`, { disabled: money < pl.price, note: 'Gömställe: vila, laga bilen i garaget och vänta ut snuten' });
            else {
                add('rest', '🛏️ Vila', { disabled: p.hp >= p.maxHp, note: 'Full hälsa' });
                if (byCar && p.vehicle) add('repair', '🔧 Laga bilen i garaget', { disabled: p.vehicle.hp >= p.vehicle.maxHp });
                if (s > 0) add('hide', '🤫 Vänta ut snuten', { disabled: seen, note: seen ? 'Snuten såg dig gå in — de väntar utanför!' : 'Ingen såg dig — efterlysningen försvinner' });
            }
            add('leave', byCar ? '🚗 Kör ut' : '🚪 Gå ut');
            return { icon: owned ? '🏡' : '🔑', title: pl.name, color: owned ? '#22c55e' : '#38bdf8', desc: owned ? 'Ditt gömställe' : `TILL SALU · ${kr(pl.price)}`, actions };
        }
        if (pl.kind === 'nightclub') {
            if (!this.isClubOpen()) {
                add('leave', '🚪 Gå ut');
                return { icon: '🍾', title: 'Nattklubben', color: '#9ca3af', desc: 'Stängt. Dörrarna öppnar 20:00 — kom tillbaka då.', actions };
            }
            add('dance', '💃 Dansa · 100 kr', { disabled: money < 100, note: '+15 ❤️' });
            const vipDone = this.doneThisRound('nightvip');
            add('nightvip', `🍾 VIP-bord · ${kr(1000)}`, { disabled: vipDone || money < 1000, note: vipDone ? 'Redan gjort den här rundan' : '+40 ❤️ och +2 rykte' });
            add('date', '💘 Hitta en dejt', { disabled: true, note: prof.dateThisRound ? 'Du har redan haft en dejt den här rundan' : 'Kör fram till entrén i en fet bil — hon vill bli skjutsad hem' });
            add('leave', '🚪 Gå ut');
            return { icon: '🍾', title: 'Nattklubben', color: '#f472b6', desc: 'Basen pumpar och ljusen blinkar.', actions };
        }
        const done = this.doneThisRound('bank');
        add('robbank', '💰 Råna banken', { disabled: done || !this.armed(), note: done ? 'Redan rånad den här rundan' : this.armed() ? 'Kameror överallt — snuten kommer direkt (3 stjärnor)' : 'Du behöver ett laddat skjutvapen i handen (Pang-Pelle 🔫)' });
        add('leave', '🚪 Gå ut');
        return { icon: '🏦', title: pl.name, color: '#a78bfa', desc: 'Valvet är fullt och vakterna ser nervösa ut.', actions };
    }

    // Gör något där inne. { close: true } = man går ut igen.
    placeAction(id) {
        const P = this.place;
        if (!P) return { close: true };
        const act = this.placeInfo().actions.find(a => a.id === id);
        if (!act || act.disabled) return { close: id === 'leave' };
        const { pl } = P;
        const prof = this.profile, p = this.player, st = prof.cityStats;
        switch (id) {
            case 'leave': return { close: true };
            case 'buy': {
                const shop = SHOPS[pl.slot];
                if (!this.spend(shop.price)) break;
                prof.owned.push(shop.id);
                prof.levels = prof.levels || {};
                prof.levels[shop.id] = 1;
                this.sfx('mission');
                this.big('FASTIGHET KÖPT!', '#22c55e', `${shop.icon} ${shop.name} · ${shop.income.toLocaleString('sv-SE')} kr per runda`);
                break;
            }
            case 'collect': this.collectBusiness(SHOPS[pl.slot], pl); break;
            case 'rob': {
                const shop = SHOPS[pl.slot];
                this.markDone('rob:' + pl.slot);
                if (!this.armed() && this.rnd() < 0.5) {
                    this.sfx('bat');
                    this.hurtPlayer(12, 'Utslängd med ett basebollträ');
                    this.message(`${shop.icon} Kassören drog fram ett basebollträ och slängde ut dig!`);
                    if (this.interior?.biz === pl) this.exitInterior();
                    return { close: true };
                }
                // Man får det som ligger i kassan just nu; kunderna flyr
                const amount = Math.max(20, this.tillOf(pl.slot));
                this.tills[pl.slot] = 0;
                if (this.interior?.biz === pl) this.interior.state.panic = 10;
                this.addMoney(amount);
                this.sfx('coin');
                if (st) st.heists = (st.heists || 0) + 1;
                const seen = !!this.crime('robShop', { witnessed: this.copNear(450, true, pl.door || pl), at: pl.door || pl });
                this.message(`${shop.icon} Kassan tömd: +${amount.toLocaleString('sv-SE')} kr. ${seen ? '🚨 En snut såg dig!' : 'Ingen snut såg något.'}`);
                return { close: true };
            }
            case 'eat': case 'look': case 'train': case 'track': case 'vip': case 'hack': {
                const shop = SHOPS[pl.slot], sv = SERVICES[shop.id];
                if (!prof.owned.includes(shop.id) && !this.spend(sv.price)) break;
                if (sv.perRound) this.markDone(sv.id);
                this.sfx('coin');
                if (id === 'eat') { p.hp = Math.min(p.maxHp, p.hp + 40); this.message('🥙 Mums. +40 hälsa.'); }
                else if (id === 'look') {
                    if (P.seen) this.message('💈 Snyggt — men snuten såg dig gå in. De vet hur du ser ut.');
                    else {
                        if (POL.reduceLevel(this.police, 2, 'Ny frisyr – polisen letar efter någon annan') && this.police.level === 0) this.releaseUnits();
                        this.savePolice(true);
                        this.message('💈 Ny frisyr! Snuten letar efter någon annan.');
                    }
                } else if (id === 'train') {
                    prof.strength = Math.min(5, (prof.strength || 0) + 1);
                    p.maxHp += 10; p.hp += 10;
                    this.message(`🏋️ Styrka ${prof.strength}/5 — dina slag tar hårdare.`);
                } else if (id === 'track') { prof.rep = (prof.rep || 0) + 3; this.message('🎤 Disslåten går viralt i orten. +3 rykte.'); }
                else if (id === 'vip') { p.hp = Math.min(p.maxHp, p.hp + 40); prof.rep = (prof.rep || 0) + 2; this.message('🍾 Champagne och vibes. +40 hälsa, +2 rykte.'); }
                else {
                    if (POL.clearPolice(this.police, 'Registret rensat')) this.releaseUnits();
                    this.police.heat = 0;
                    this.savePolice(true);
                    this.message('💻 Registret rensat. Snuten vet inte vem du är längre.');
                }
                break;
            }
            case 'buyhouse': {
                if (!this.spend(pl.price)) break;
                prof.cityHouses.push(pl.id);
                this.sfx('mission');
                this.big('NYTT GÖMSTÄLLE!', '#22c55e', `🏡 ${pl.name}`);
                break;
            }
            case 'dance':
                if (!this.spend(100)) break;
                p.hp = Math.min(p.maxHp, p.hp + 15);
                this.sfx('coin', 0.6);
                this.message('💃 Du dansade loss på golvet. +15 hälsa.');
                break;
            case 'nightvip':
                if (!this.spend(1000)) break;
                this.markDone('nightvip');
                p.hp = Math.min(p.maxHp, p.hp + 40);
                prof.rep = (prof.rep || 0) + 2;
                this.sfx('coin');
                this.message('🍾 Champagne och vibes. +40 hälsa, +2 rykte.');
                break;
            case 'rest': p.hp = p.maxHp; this.time += 24; this.policePassTime(24); this.message('🛏️ Du sov en timme. Full hälsa.'); break;
            case 'repair': p.vehicle.hp = p.vehicle.maxHp; this.sfx('spray'); this.message('🔧 Bilen är lagad.'); break;
            case 'hide':
                // Ingen såg dig gå in (annars är valet avstängt): sökningen hinner ta slut
                if (POL.clearPolice(this.police, 'Du höll dig undan – polisen gav upp')) this.releaseUnits();
                this.time += 48;
                this.policePassTime(48);
                this.message('🤫 Du höll dig undan i två timmar. Snuten har gett upp.');
                return { close: true };
            case 'robbank': {
                this.markDone('bank');
                const amount = Math.round((3000 + this.rnd() * 5000) * (1 + this.round * 0.05) / 10) * 10;
                this.addMoney(amount);
                if (st) st.heists = (st.heists || 0) + 1;
                // Kamerorna såg allt: larmet går och snuten vet var du är
                const res = POL.alarm(this.police, 3, 'Bankrån – larmet gick', pl.door || pl);
                if (res) this.policeNotice(res);
                this.savePolice(true);
                this.big('BANKRÅN!', '#ef4444', `+${amount.toLocaleString('sv-SE')} kr · 🚨 larmet går!`);
                this.sfx('opps');
                return { close: true };
            }
        }
        return { close: false };
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
    // Finns det en snut (i bil eller till fots) nära en plats, och ser den dit?
    copNear(r, needSight, at = this.player) {
        const near = e => Math.abs(e.x - at.x) < r && Math.abs(e.y - at.y) < r && Math.hypot(e.x - at.x, e.y - at.y) < r &&
            (!needSight || lineClear(this.city, e.x, e.y, at.x, at.y));
        return this.vehicles.some(v => v.driver === 'cop' && !v.wrecked && near(v)) ||
            this.peds.some(o => o.cop && !(o.down > 0) && near(o));
    }

    // Ser någon snut dig just nu? (räckvidden beror på insatsens nivå, police.js sightRange)
    copSees() {
        if (this.player.dead) return false;
        return this.copNear(POL.sightRange(this.police.level), true);
    }

    // Snuten kliver ur bilen och springer efter dig (eget tak för snutar till fots, police.js footCap)
    copGetsOut(v) {
        const spot = this.sideSpot(v, 1) || this.sideSpot(v, -1);
        if (!spot) return;
        const ped = createPed(spot.x, spot.y, this.rnd, { cop: true, shirt: '#1e3a8a', hp: 40, attack: true, attackT: 90 });
        ped.gun = POL.copsArmed(this.police.level, this.armed());
        if (ped.gun) ped.hitCd = 1;
        this.pedSay(ped, ped.gun ? 'POLIS! Ner på marken!' : 'Stanna! Polis!', 3);
        this.peds.push(ped);
        v.driver = null; v.ai = null; v.siren = true; v.copOut = true; v.pol = null;
    }

    // En snut som går ner reser sig inte — och resten av kåren blir galen
    copDown(ped) {
        if (ped.dead) return;
        ped.dead = true; ped.down = 1e6; ped.attack = false; ped.gun = false; ped.say = null;
        const st = this.profile.cityStats; if (st) st.copsDown = (st.copsDown || 0) + 1;
        this.crime('copKill');
        this.floater(ped.x, ped.y - 18, '🚔 SNUT NERE!', '#60a5fa');
    }

    // ── Polisen (police.js): händelser, stopp, jakt, sökning och enheterna ──
    // En händelse polisen kanske ser. witnessed: såg en snut det (standard ja: snuten var
    // inblandad själv)? at: platsen (standard: där du är, eller dörren när du är inne).
    // known: platsen är känd (personalen ringde). En gripen eller död spelare får inga nya brott.
    crime(kind, opts = {}) {
        const p = this.player;
        if (this.state !== 'play' || p.dead) return null;
        const door = this.interior ? this.interior.door : this.place ? (this.place.pl.door || this.place.pl) : null;
        const at = opts.at || door || { x: p.x, y: p.y };
        const speed = p.vehicle ? Math.hypot(p.vehicle.vx, p.vehicle.vy) : 0;
        const res = POL.report(this.police, kind, { witnessed: opts.witnessed !== false, at, speed });
        if (!res) return null;
        if (opts.known || door) this.police.known = { x: at.x, y: at.y };
        this.policeNotice(res);
        return res;
    }

    // Berätta vad som hände och varför (HUD-panelen visar nivån, orsaken och vad polisen gör)
    policeNotice(res) {
        const P = this.police;
        this.emit({ type: 'wanted', stars: P.level, up: res.raised, reason: res.text });
        if (res.raised) {
            if (P.phase === 'stop') this.message(`🚔 ${res.text}. Polisen vill prata – stanna på en säker plats.`);
            else this.message(`🚨 ${res.text} → nivå ${P.level}: ${POL.levelName(P.level)}.`);
        }
        this.savePolice(true);
    }

    // Spelaren körde in i en polisbil och var skyldig (resolveCollisions avgör det)
    copContact(cop, info) {
        const P = this.police, p = this.player;
        const speed = p.vehicle ? Math.hypot(p.vehicle.vx, p.vehicle.vy) : 0;
        const res = POL.copContact(P, info, { at: { x: p.x, y: p.y }, speed });
        // Den som blev påkörd är den som vill prata (trafikstoppets enhet)
        if (P.phase === 'stop' && cop.driver === 'cop') cop.pol = { task: 'stop', role: 'tail', side: 1 };
        if (res) this.policeNotice(res);
        else this.savePolice(true);
        return res;
    }

    updateWantedState(dt) {
        const p = this.player, P = this.police, pv = p.vehicle;
        const speed = pv ? Math.hypot(pv.vx, pv.vy) : Math.hypot(p.vx, p.vy);
        const out = POL.tickPolice(P, dt, {
            playing: this.state === 'play' && !p.dead, sees: this.copSees(), pos: p, speed,
            nearCop: P.phase === 'stop' && this.copNear(POL.POLICE.talkRange, true)
        });
        for (const e of out) this.onPoliceEvent(e);

        // Gripande: en jagande polisbil tätt intill en spelare som står still, eller en snut till fots som får tag i dig.
        // Nivå 3+ = BUSTED (fängelsekedjan). Nivå 1–2 = bot, inte fängelse.
        let near = false;
        if (P.phase === 'chase' && this.state === 'play') {
            for (const v of this.vehicles) {
                if (v.driver !== 'cop' || v.wrecked || v.pol?.task !== 'chase') continue;
                const d = Math.hypot(v.x - p.x, v.y - p.y);
                if (pv ? (d < 88 && Math.hypot(pv.vx, pv.vy) < 35) : d < 64) { near = true; break; }
            }
            if (!near && !pv) near = this.peds.some(o => o.cop && o.attack && !o.gun && !(o.down > 0) && !(o.stunT > 0) && Math.hypot(o.x - p.x, o.y - p.y) < 20);
        }
        if (P.level > 0 && near) p.bustT += dt;
        else p.bustT = Math.max(0, p.bustT - dt * 2);
        if (p.bustT > (pv ? 1.6 : 0.9)) {
            p.bustT = 0;
            if (POL.arrestMeans(P.level) === 'busted') this.busted();
            else this.settleStop('caught');
        }
        this.savePolice(false);
    }

    // Inne i ett rum: ingen snut ser dig. Sågs du gå in står sökningen still (de väntar utanför).
    updatePoliceInside(dt) {
        const P = this.police;
        const out = POL.tickPolice(P, dt, { playing: !this.player.dead, sees: false, pos: null, speed: 999, inside: true, known: !!P.known });
        for (const e of out) this.onPoliceEvent(e);
        this.savePolice(false);
    }

    // Tid som går i ett svep (sova, gömma sig): sökningen och trycket avtar som om tiden gått inne
    policePassTime(sec) {
        const P = this.police;
        for (let t = 0; t < sec; t += 1) for (const e of POL.tickPolice(P, 1, { playing: true, sees: false, speed: 999, inside: true, known: !!P.known })) this.onPoliceEvent(e);
        this.savePolice(true);
    }

    onPoliceEvent(e) {
        const P = this.police;
        switch (e.type) {
            case 'stopDone': this.settleStop('stop'); break;
            case 'stopIgnored':
                this.emit({ type: 'wanted', stars: P.level, up: true, reason: e.res?.text });
                this.message(`🚨 Du stannade inte → nivå ${P.level}: ${POL.levelName(P.level)}. ${P.phase === 'chase' ? 'Polisen jagar dig.' : 'De letar där de såg dig sist.'}`);
                break;
            case 'lost': this.message('🔍 Polisen tappade dig – de söker där de såg dig sist.'); break;
            case 'spotted': this.message('👀 Polisen fick syn på dig igen!'); this.emit({ type: 'wanted', stars: P.level, up: false }); break;
            case 'ended':
                this.releaseUnits();
                this.message(e.why === 'lost' ? '✔ Polisen gav upp sökningen. Enheterna åker tillbaka.' : `✔ ${P.ended?.text || 'Polisen släppte det'}.`);
                this.emit({ type: 'wanted', stars: 0, up: false });
                break;
        }
        this.savePolice(true);
    }

    // Trafikstoppets besked (du stannade, eller de hann ikapp dig på nivå 1–2):
    // varning eller bot + reparation. Har du inte råd: resten blir samhällstjänst. Sedan fri.
    settleStop(how) {
        const P = this.police, prof = this.profile;
        const o = POL.stopOutcome(P, prof.money);
        if (o.paid > 0) {
            prof.money -= o.paid;
            prof.totalSpent = (prof.totalSpent || 0) + o.paid;
            this.floater(this.player.x, this.player.y - 20, `-${o.paid.toLocaleString('sv-SE')} kr`, '#ef4444');
        }
        if (o.short > 0) {
            this.time += 24 * POL.POLICE.serviceHours;
            this.fade = { t: 0, dur: 2.6, text: '🧹 Samhällstjänst', sub: `${POL.POLICE.serviceHours} timmar senare – skulden är avbetald` };
        }
        const st = prof.cityStats; if (st) st.fines = (st.fines || 0) + (o.warning ? 0 : 1);
        POL.endIncident(P, o.warning ? 'warning' : 'fine', o.warning ? 'Varning – du är fri' : o.short > 0 ? 'Bot + samhällstjänst – du är fri' : 'Bot betald – du är fri');
        this.releaseUnits();
        this.message(`👮 ${how === 'caught' ? 'De hann ikapp dig. ' : ''}${POL.outcomeText(o)}`);
        this.sfx(o.warning ? 'click' : 'coin', 0.6);
        this.emit({ type: 'wanted', stars: 0, up: false });
        this.savePolice(true);
        return o;
    }

    // Spara polisens läge i profilen (sparas med spelet): HEM, omladdning och nästa session fortsätter härifrån
    savePolice(now = false) {
        const D = this.disp;
        if (!now && this.time - D.saveT < 1) return;
        D.saveT = this.time;
        this.profile.cityPolice = POL.policeSnapshot(this.police);
    }

    // ── Dispatchern: en ansvarig för alla polisbilar ──
    // Håller reda på insatsens enheter (v.pol.task), ger dem roller och skickar förstärkning
    // högst en i taget (POLICE.reinforceGap), utom synhåll och inte framför bilen. Tak per
    // insats (nivån), per distrikt och totalt. Städar när insatsen är slut.
    dispatchPolice(far = b => b) {
        const p = this.player, P = this.police, C = POL.POLICE;
        const dist = e => Math.hypot(e.x - p.x, e.y - p.y);
        let cops = this.vehicles.filter(v => v.driver === 'cop' && !v.wrecked);
        for (const v of cops) if (!v.pol) v.pol = { task: 'patrol', role: null, side: 1 };
        // Enheter som lämnat insatsen försvinner när de är långt borta och utom synhåll
        for (const v of cops) {
            if (v.pol.task === 'leave' && dist(v) > far(900) && !lineClear(this.city, v.x, v.y, p.x, p.y)) this.removeVehicle(v);
        }
        cops = cops.filter(v => this.vehicles.includes(v));
        const UNIT = new Set(['stop', 'chase', 'search']);
        const units = cops.filter(v => UNIT.has(v.pol.task));
        const want = this.state === 'play' && !p.dead ? POL.wantedUnits(P) : 0;
        // Fler än insatsen ska ha: de längst bort åker tillbaka
        if (units.length > want) {
            units.sort((a, b) => dist(b) - dist(a));
            for (const v of units.splice(0, units.length - want)) this.releaseUnit(v, cops);
        }
        const task = P.phase === 'stop' ? 'stop' : P.phase === 'search' ? 'search' : 'chase';
        for (const v of units) v.pol.task = task;
        // Förstärkning: en i taget, först en patrull i närheten, annars en ny utom synhåll
        if (units.length < want && P.time - this.disp.lastT >= C.reinforceGap[P.level]) {
            const v = this.recruitCop(cops, task) || this.spawnCop(task, far);
            if (v) { v.pol = { task, role: 'tail', side: 1 }; units.push(v); this.disp.lastT = P.time; if (!cops.includes(v)) cops.push(v); }
        }
        // Roller: närmast = bakom dig, sedan vid sidan av din väg och genskjutning — inte alla mot samma punkt
        units.sort((a, b) => dist(a) - dist(b));
        const ROLES = ['tail', 'flank', 'cut', 'flank', 'cut', 'tail'];
        units.forEach((v, i) => { if (v.pol.task !== 'stop') v.pol.role = ROLES[i % ROLES.length]; v.pol.side = i % 4 < 2 ? 1 : -1; });
        // Patruller: två runt dig när inget pågår (en till vid högt tryck)
        const patrols = cops.filter(v => v.pol.task === 'patrol' && dist(v) < 1800).length;
        if (patrols < POL.patrolTarget(P) && cops.length < C.totalCars) {
            const v = this.spawnCop('patrol', far);
            if (v) v.pol = { task: 'patrol', role: null, side: 1 };
        }
    }

    // En enhet lämnar insatsen: blir patrull om det behövs, annars åker den därifrån
    releaseUnit(v, cops = this.vehicles.filter(u => u.driver === 'cop' && !u.wrecked)) {
        const p = this.player;
        const patrols = cops.filter(u => u.pol?.task === 'patrol' && Math.hypot(u.x - p.x, u.y - p.y) < 1800).length;
        v.pol = { task: patrols < POL.patrolTarget(this.police) ? 'patrol' : 'leave', role: null, side: 1 };
        v.siren = false;
        if (v.ai) v.ai.mode = 'lane';
    }

    // Insatsen är slut (avslutad, gripen, död, bot): alla enheter tillbaka, snutarna till fots slutar jaga
    releaseUnits() {
        const cops = this.vehicles.filter(v => v.driver === 'cop' && !v.wrecked);
        for (const v of cops) if (v.pol && v.pol.task !== 'patrol' && v.pol.task !== 'leave') this.releaseUnit(v, cops);
        for (const o of this.peds) if (o.cop && o.attack) { o.attack = false; o.gun = false; o.mode = 'walk'; o.t = 2; }
        this.player.bustT = 0;
    }

    // Närmaste patrullbil som kan ta uppdraget (redan på plats: ingen ny bil behövs)
    recruitCop(cops, task) {
        const P = this.police, p = this.player;
        const at = task === 'search' && P.lastSeen ? P.lastSeen : p;
        let best = null, bd = 1400;
        for (const v of cops) {
            if (v.pol?.task !== 'patrol' && v.pol?.task !== 'leave') continue;
            const d = Math.hypot(v.x - at.x, v.y - at.y);
            if (d < bd) { bd = d; best = v; }
        }
        return best;
    }

    // En ny polisbil: utom synhåll, inte framför bilen, inom distriktets och det totala taket.
    // Patrull långt bort; insats runt dig; sökning runt platsen där de såg dig sist.
    spawnCop(task, far = b => b) {
        const P = this.police, C = POL.POLICE, p = this.player, pv = p.vehicle;
        const all = this.vehicles.filter(v => v.driver === 'cop' && !v.wrecked);
        if (all.length >= C.totalCars) return null;
        const search = task === 'search' && P.lastSeen;
        const at = search ? P.lastSeen : p;
        const [minD, maxD] = search ? [250, 800] : task === 'patrol' ? [far(800), far(1400)] : [far(650), far(1150)];
        const sp = pv ? Math.hypot(pv.vx, pv.vy) : 0;
        for (let k = 0; k < 10; k++) {
            const spot = this.findSpot(at.x, at.y, minD, maxD);
            if (!spot) continue;
            const dx = spot.x - p.x, dy = spot.y - p.y, d = Math.hypot(dx, dy);
            if (d < 500 || (d < 1000 && lineClear(this.city, spot.x, spot.y, p.x, p.y))) continue;   // syns inte dyka upp
            if (sp > 60 && (dx * pv.vx + dy * pv.vy) / (d * sp) > 0.3 && d < 1400) continue;          // inte framför bilen
            const dId = districtAt(this.city, spot.x, spot.y);
            if (all.filter(v => districtAt(this.city, v.x, v.y) === dId).length >= C.districtCars) continue;
            const v = createVehicle('police', spot.x, spot.y, spot.angle, { rnd: this.rnd });
            v.driver = 'cop';
            initLaneAI(v, spot.tx, spot.ty, spot.dir, this.rnd);
            v.vx = Math.cos(v.angle) * 120; v.vy = Math.sin(v.angle) * 120;
            this.vehicles.push(v);
            return v;
        }
        return null;
    }

    // En rad om polisen (telefonen): nivå, vad de gör och varför — eller att det är lugnt
    policeLine() {
        const P = this.police, st = POL.policeStatus(P);
        const heat = P.heat > 0.05 ? ` · tryck ${P.heat.toFixed(1)}` : '';
        if (!st.level) return `${st.ended ? st.action : 'Lugnt – ingen efterlyser dig'}${heat}`;
        const cd = st.countdown !== null ? ` (${Math.ceil(st.countdown)} s)` : '';
        return `Nivå ${st.level} ${st.name} · ${st.action}${cd}${st.reason ? ` · Varför: ${st.reason}` : ''}${heat}`;
    }

    // Antal snutar till fots som jagar dig just nu
    footCops() { return this.peds.filter(o => o.cop && o.attack && !(o.down > 0)).length; }

    // Flödesfält mot platsen där de såg dig sist (sökningen vet inte var du är nu)
    searchFlow(ls) {
        const tx = Math.floor(ls.x / TILE), ty = Math.floor(ls.y / TILE), key = ty * this.city.w + tx;
        const D = this.disp;
        if (!D.searchFlow || D.searchFlow.key !== key) D.searchFlow = { key, flow: flowField(this.city, tx, ty, 70) };
        return D.searchFlow.flow;
    }

    // Vad en polisbil gör, efter uppdraget dispatchern gett den
    copControl(v, dt, d) {
        const P = this.police, p = this.player;
        const pol = v.pol || (v.pol = { task: 'patrol', role: null, side: 1 });
        const level = Math.max(1, P.level);
        const live = this.state === 'play' && !p.dead;
        if (live && (pol.task === 'stop' || pol.task === 'chase')) {
            v.ai.mode = 'chase'; v.siren = true;
            // Nivå 1–2 och trafikstopp: följ efter och håll avstånd (ingen ramning). Nivå 3+: försök stoppa bilen.
            const keep = pol.task === 'stop' || P.level <= 2 ? 70 : 0;
            const ctl = chaseControl(v, this, dt, POL.chaseSpeed(level), { role: pol.task === 'stop' ? 'tail' : pol.role, side: pol.side, keep, gas: POL.chaseGas(level), corner: POL.cornerSpeed(level) });
            // Till fots: på nivå 2+ kliver de ur och springer efter dig (eget tak för snutar till fots)
            if (pol.task === 'chase' && !p.vehicle && d < 170 && Math.hypot(v.vx, v.vy) < 70 && this.footCops() < POL.footCap(P.level)) {
                this.copGetsOut(v);
                return { throttle: 0, steer: 0, handbrake: true };
            }
            return ctl;
        }
        if (live && pol.task === 'search') {
            v.siren = true;
            const ls = P.lastSeen;
            if (ls && Math.hypot(ls.x - v.x, ls.y - v.y) > 160) {
                v.ai.mode = 'chase';
                return chaseControl(v, this, dt, POL.chaseSpeed(level) * 0.85, { goal: ls, flow: this.searchFlow(ls), gas: POL.chaseGas(level), corner: POL.cornerSpeed(level) });
            }
            if (v.ai.mode === 'chase') v.ai.mode = 'lane';
            return laneControl(v, this, dt);   // framme: letar i kvarteren runt omkring
        }
        if (v.ai.mode === 'chase') v.ai.mode = 'lane';
        v.siren = false;
        return laneControl(v, this, dt);
    }

    busted() {
        if (this.state !== 'play') return;
        this.place = null;
        this.state = 'busted'; this.stateT = 0;
        this.bustedStars = stars(this.wanted);
        // Gripen: insatsen är över (fängelsekedjan tar vid när du kommer hem). Trycket finns kvar.
        // cityBusted ligger kvar i profilen tills hemkomsten verkställt gripandet (även efter omladdning).
        this.profile.cityBusted = { stars: this.bustedStars };
        POL.endIncident(this.police, 'busted', 'Gripen');
        this.releaseUnits();
        this.savePolice(true);
        if (this.mission) { this.profile.respect = applyRespect(this.profile.respect || {}, this.mission.gang, false); this.mission = null; }
        if (this.player.vehicle) { this.player.vehicle.vx *= 0.1; this.player.vehicle.vy *= 0.1; }
        this.big('BUSTED', '#60a5fa', 'Snuten satte dig i bojor');
        this.sfx('busted');
    }

    wasted(reason) {
        if (this.state !== 'play') return;
        this.state = 'wasted'; this.stateT = 0;
        this.player.dead = true;
        // Död: insatsen avslutas och enheterna åker tillbaka (trycket finns kvar)
        if (POL.active(this.police)) POL.endIncident(this.police, 'wasted', 'Insatsen avslutad');
        this.releaseUnits();
        this.savePolice(true);
        if (this.mission) { this.profile.respect = applyRespect(this.profile.respect || {}, this.mission.gang, false); this.mission = null; }
        this.big('WASTED', '#ef4444', reason);
        this.sfx('wasted');
    }

    // HEM går bara när polisen inte är efter dig (stopp, jakt eller sökning). HEM nollställer aldrig något.
    canGoHome() { return this.state === 'play' && stars(this.wanted) === 0 && !POL.active(this.police); }

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
            const gang = DISTRICTS[d].gang;
            this.emit({ type: 'district', id: d, first, own: this.profile.gang === gang, hostile: this.gangHostile(gang) });
        }
    }

    updateHint() {
        const p = this.player;
        this.hint = '';
        if (this.state !== 'play') return;
        const door = this.doorInReach(p.vehicle ? 110 : 80);
        if (p.vehicle) {
            if (p.vehicle.wrecked) this.hint = 'E — HOPPA UT!';
            else if (this.date) this.hint = `💃 Kör ${this.date.name} hem — följ den rosa pilen`;
            else if (door) this.hint = door.name === 'Nattklubben' ? '🍾 Kör fram = dejt · E = gå in' : `${door.icon} ${door.name} — E kliv ur och gå in`;
            return;
        }
        const v = this.nearestVehicle(p.x, p.y, 38);
        const near = r => this.peds.find(pd => Math.hypot(pd.x - p.x, pd.y - p.y) < r && !pd.robbed && !pd.attack);
        const gun = !(WEAPONS[this.profile.weapon] || WEAPONS.fists).melee;
        // Samma ordning som E-knappen: föremål, dörr, bil
        const atDoor = door && door.d <= 46 + door.extra && (!v || door.d - door.extra < distToVehicle(v, p.x, p.y));
        if (this.nearItem) this.hint = `E — Plocka upp ${ITEM_TYPES[this.nearItem.type].icon} ${ITEM_TYPES[this.nearItem.type].label}`;
        else if (atDoor) {
            // utslängd efter ett bråk (brawl.js): dörren är stängd en stund
            const ban = door.room ? BRAWL.bannedFor(this, door.room) : 0;
            this.hint = ban > 0 ? `🚫 ${door.icon} ${door.name} — stängt för dig (${Math.ceil(ban)} s)` : `E — Gå in: ${door.icon} ${door.name}`;
        }
        else if (v && !v.wrecked) this.hint = v.driver && v.driver !== 'player' ? `E — Sno ${v.spec.name}` : `E — Kör ${v.spec.name}`;
        else if (this.peds.some(pd => pd.attack && !pd.targetPed && Math.hypot(pd.x - p.x, pd.y - p.y) < (gun ? 300 : 120))) this.hint = gun ? 'SPACE — SKJUT!' : 'SPACE — SLÅ!';
        else if (near(28)) this.hint = near(28).down > 0 ? 'R — Länsa fickorna' : 'R — Råna · SPACE — Slå';
        else if (this.buyer) this.hint = '💸 En kund är på väg...';
        else if ((this.profile.cityGoods || 0) > 0 && this.sellIdle < 1.2) this.hint = '🎒 Stå still så kommer kunderna';
        else if (Math.hypot(p.x - this.city.markers.home.x, p.y - this.city.markers.home.y) < 90 && this.canGoHome()) this.hint = 'ESC — Åk hem till imperiet';
        else if (door) this.hint = `${door.icon} ${door.name} — gå fram till dörren`;
    }
}
