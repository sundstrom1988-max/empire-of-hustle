import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { setStars, stars } from '../src/city/wanted.js';
import { createVehicle } from '../src/city/vehicles.js';
import { createPed } from '../src/city/ai.js';
import { dateChance } from '../src/city/weapons.js';
import { TILE } from '../src/city/constants.js';
import { districtAt, isWalkableTile } from '../src/city/map.js';

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

    it('refuses to fence a car that a smash mission needs', () => {
        const w = makeWorld(9);
        const fence = city.markers.fence;
        const target = createVehicle('gang_taco', fence.x, fence.y, 0);
        w.vehicles.push(target);
        w.mission = { type: 'smash', cars: [target], count: 1 };
        w.player.vehicle = target; target.driver = 'player';
        w.player.x = fence.x; w.player.y = fence.y;
        const m0 = w.profile.money;
        w.update(DT, IDLE);
        expect(w.profile.money).toBe(m0);
        expect(w.vehicles.includes(target)).toBe(true);
    });

    it('does not hurt the player inside an intact car when something explodes nearby', () => {
        const w = makeWorld(12);
        const rolls = createVehicle('rolls', 2000, 1000, 0);
        w.vehicles.push(rolls);
        w.player.vehicle = rolls; rolls.driver = 'player';
        w.player.x = rolls.x; w.player.y = rolls.y;
        const bomb = createVehicle('volvo', 2060, 1000, 0);
        w.vehicles.push(bomb);
        w.explode(bomb);
        expect(w.player.hp).toBe(100);
        expect(rolls.hp).toBeLessThan(rolls.maxHp);
        expect(w.state).toBe('play');
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

// Ställ spelaren på en trottoar i ett visst turf
function standIn(w, turf) {
    const ph = city.markers.phones.find(p => districtAt(city, p.x, p.y) === turf);
    w.player.x = ph.x; w.player.y = ph.y;
    w.inside.add('phone-' + ph.gang); // svara inte i telefonen
    w.updateDistrict();
    return ph;
}

describe('Gängliv', () => {
    it('langning på någon annans turf drar dit opps', () => {
        const profile = createPlayerState('kimit');
        profile.cityGoods = 10;
        const w = makeWorld(21, profile);
        standIn(w, 'vasterort');
        let sales = 0;
        while (!(w.beef.dods > 0) && sales < 8) { w.sellTo(createPed(w.player.x + 10, w.player.y, w.rnd)); sales++; }
        expect(w.beef.dods).toBeGreaterThan(0);
        expect(w.events.some(e => e.type === 'big' && e.text === 'OPPS!')).toBe(true);
        const opps = w.peds.filter(pd => pd.attack && pd.gang === 'dods');
        expect(opps.length).toBeGreaterThanOrEqual(3);
        expect(profile.respect.dods).toBeLessThan(0);
        expect(profile.money).toBeGreaterThan(1000);
    });

    it('opps slår ner den som står still', () => {
        const profile = createPlayerState('kimit');
        const w = makeWorld(22, profile);
        standIn(w, 'vasterort');
        w.spawnOpps('dods');
        let t = 0;
        while (w.state === 'play' && t < 40) { w.update(DT, IDLE); t += DT; }
        expect(w.player.hp).toBeLessThan(100);
    });

    it('på ditt eget turf är det säkert och ger respekt', () => {
        const profile = createPlayerState('kimit');
        profile.gang = 'dods'; profile.respect.dods = 50; profile.cityGoods = 6;
        const w = makeWorld(23, profile);
        standIn(w, 'vasterort');
        for (let i = 0; i < 6; i++) w.sellTo(createPed(w.player.x + 10, w.player.y, w.rnd));
        expect(w.beef.dods || 0).toBe(0);
        expect(profile.respect.dods).toBeGreaterThan(50);
        expect(profile.cityGoods).toBe(0);
    });

    it('kunder kommer fram när du står still med varor', () => {
        const profile = createPlayerState('kimit');
        profile.cityGoods = 3;
        const w = makeWorld(24, profile);
        standIn(w, 'centrum');
        const m0 = profile.money;
        for (let i = 0; i < 60 * 40 && profile.cityGoods === 3; i++) w.update(DT, IDLE);
        expect(profile.cityGoods).toBeLessThan(3);
        expect(profile.money).toBeGreaterThan(m0);
    });

    it('köper varor hos Langaren inom rundans gräns', () => {
        const profile = createPlayerState('kimit');
        profile.money = 5000;
        const w = makeWorld(25, profile);
        expect(w.buyGoods(10)).toBe(true);
        expect(profile.cityGoods).toBe(10);
        expect(profile.money).toBe(5000 - 1200);
        expect(w.buyGoods(1)).toBe(false);
    });

    it('man kan gå med i ett gäng med tillräcklig respekt', () => {
        const profile = createPlayerState('kimit');
        const w = makeWorld(26, profile);
        expect(w.joinGang('hdmc')).toBe(false);
        profile.respect.hdmc = 35;
        expect(w.joinGang('hdmc')).toBe(true);
        expect(profile.gang).toBe('hdmc');
        expect(profile.respect.bmc).toBeLessThanOrEqual(-40);
        expect(w.vehicles.some(v => v.owned && v.type === 'hd' && v.gang === 'hdmc')).toBe(true);
        // Nästa gång du åker ut står klubbens HD vid HQ
        const w2 = makeWorld(27, profile);
        expect(w2.vehicles.some(v => v.owned && v.type === 'hd')).toBe(true);
    });

    it('den som hoppar av blir jagad', () => {
        const profile = createPlayerState('kimit');
        profile.gang = 'bmc'; profile.respect.bmc = 60;
        const w = makeWorld(28, profile);
        expect(w.leaveGang()).toBe(true);
        expect(profile.gang).toBe(null);
        expect(w.gangHostile('bmc')).toBe(true);
    });

    it('slag till fots slår ner folk', () => {
        const w = makeWorld(29);
        standIn(w, 'orten');
        w.player.angle = 0;
        const ped = createPed(w.player.x + 14, w.player.y, w.rnd);
        w.peds.push(ped);
        for (let i = 0; i < 60 * 3 && !(ped.down > 0); i++) w.update(DT, { ...IDLE, punch: i % 30 === 0 });
        expect(ped.down).toBeGreaterThan(0);
    });

    it('metrosexuella smyger efter dig och kommenterar', () => {
        const w = makeWorld(30);
        standIn(w, 'centrum');
        w.peds.length = 0;
        // En gångbar punkt en bit bort
        let mx = 0, my = 0;
        for (let a = 0; a < 64; a++) {
            mx = w.player.x + Math.cos(a / 10) * 200; my = w.player.y + Math.sin(a / 10) * 200;
            if (isWalkableTile(city, Math.floor(mx / TILE), Math.floor(my / TILE))) break;
        }
        const metro = createPed(mx, my, w.rnd, { type: 'metro' });
        w.peds.push(metro);
        let talked = false;
        for (let i = 0; i < 60 * 12; i++) {
            w.update(DT, IDLE);
            if (metro.say) talked = true;
            w.player.x = city.markers.phones.find(p => districtAt(city, p.x, p.y) === 'centrum').x;
        }
        expect(Math.hypot(metro.x - w.player.x, metro.y - w.player.y)).toBeLessThan(140);
        expect(talked).toBe(true);
    });

    it('gängets telefon erbjuder medlemskap', () => {
        const profile = createPlayerState('kimit');
        profile.respect.taco = 40;
        const w = makeWorld(31, profile);
        const ph = city.markers.phones.find(p => p.gang === 'taco');
        w.player.x = ph.x; w.player.y = ph.y;
        w.update(DT, IDLE);
        const e = w.events.find(ev => ev.type === 'phone');
        expect(e.canJoin).toBe(true);
    });

    it('rivalen till ditt gäng lägger på', () => {
        const profile = createPlayerState('kimit');
        profile.gang = 'hdmc'; profile.respect.hdmc = 50;
        const w = makeWorld(32, profile);
        const ph = city.markers.phones.find(p => p.gang === 'bmc');
        w.player.x = ph.x; w.player.y = ph.y;
        w.update(DT, IDLE);
        expect(w.events.some(ev => ev.type === 'phone')).toBe(false);
        expect(w.events.some(ev => ev.type === 'msg' && ev.text.includes('lägger på'))).toBe(true);
    });

    it('MC-gäng åker i flock på HD', () => {
        const w = makeWorld(33);
        const spot = w.findSpot(w.player.x, w.player.y, 300, 2000);
        const pack = w.spawnGangConvoy('bmc', spot, false);
        expect(pack.length).toBeGreaterThanOrEqual(2);
        expect(pack.every(v => v.type === 'hd' && v.gang === 'bmc')).toBe(true);
        const car = w.spawnGangConvoy('dods', spot, false);
        expect(['bmw', 'audi', 'mercedes']).toContain(car[0].type);
    });
});

// Ställ spelaren i en bil på ringvägen (rak väg österut, rad 3)
function onRingRoad(w, type = 'bmw') {
    const car = createVehicle(type, 8 * TILE + 32, 3 * TILE + 32, 0);
    w.vehicles.push(car);
    car.driver = 'player'; w.player.vehicle = car;
    w.player.x = car.x; w.player.y = car.y;
    return car;
}

describe('Gatuliv', () => {
    it('påkörningar ger combo, KO och tappade plånböcker', () => {
        const w = makeWorld(40);
        const car = onRingRoad(w);
        car.vx = 300;
        for (let i = 0; i < 6; i++) w.knockPed(createPed(car.x + 30, car.y, w.rnd), car);
        expect(w.combo).toBeGreaterThanOrEqual(3);
        expect(w.drops.length).toBeGreaterThan(0);
        expect(w.profile.cityStats.knockouts).toBe(6);
    });

    it('går att köra över folk som står i vägen — alla hinner inte hoppa undan', () => {
        const w = makeWorld(51);
        const car = onRingRoad(w);
        car.vx = 300;
        w.peds = [];
        for (let i = 0; i < 6; i++) w.peds.push(createPed(car.x + 110 + i * 40, car.y + (i % 2 ? 6 : -6), w.rnd));
        for (let i = 0; i < 90; i++) w.update(DT, { ...IDLE, throttle: 1 });
        expect(w.profile.cityStats.knockouts).toBeGreaterThanOrEqual(3);
    });

    it('plånböcker på marken plockas upp', () => {
        const w = makeWorld(41);
        standIn(w, 'orten');
        w.drops.push({ x: w.player.x, y: w.player.y, amount: 120, life: 20 });
        const m0 = w.profile.money;
        w.update(DT, IDLE);
        expect(w.profile.money).toBe(m0 + 120);
        expect(w.drops.length).toBe(0);
    });

    it('rån: vissa lämnar över plånboken, andra slår tillbaka', () => {
        const w = makeWorld(42);
        standIn(w, 'centrum');
        let paid = 0, fought = 0;
        for (let i = 0; i < 16; i++) {
            const ped = createPed(w.player.x + 12, w.player.y, w.rnd, { type: 'civ' });
            w.peds = [ped];
            const m0 = w.profile.money;
            w.robCd = 0;
            w.tryRob();
            if (w.profile.money > m0) paid++;
            if (ped.attack) fought++;
        }
        expect(paid).toBeGreaterThan(0);
        expect(fought).toBeGreaterThan(0);
        expect(w.profile.cityStats.robbed).toBe(paid);
    });

    it('en utslagen person går att länsa', () => {
        const w = makeWorld(43);
        standIn(w, 'orten');
        const ped = createPed(w.player.x + 10, w.player.y, w.rnd);
        ped.down = 5;
        w.peds = [ped];
        const m0 = w.profile.money;
        w.tryRob();
        expect(w.profile.money).toBeGreaterThan(m0);
        expect(ped.robbed).toBe(true);
    });

    it('köper vapen och ammo hos Pang-Pelle, men inte med snuten efter sig', () => {
        const profile = createPlayerState('kimit');
        profile.money = 10000;
        const w = makeWorld(44, profile);
        expect(w.buyWeapon('pistol')).toBe(true);
        expect(profile.weapons).toContain('pistol');
        expect(profile.ammo.pistol).toBe(24);
        expect(profile.money).toBe(8500);
        expect(w.buyAmmo('pistol')).toBe(true);
        expect(profile.ammo.pistol).toBe(48);
        setStars(w.wanted, 2);
        expect(w.buyWeapon('uzi')).toBe(false);
    });

    it('skott träffar den som står framför dig', () => {
        const profile = createPlayerState('kimit');
        profile.weapons = ['pistol']; profile.ammo = { pistol: 5 }; profile.weapon = 'pistol';
        const w = makeWorld(45, profile);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        const ped = createPed(w.player.x + 90, w.player.y, w.rnd, { type: 'gang', gang: 'dods', hp: 20 });
        w.peds = [ped];
        w.update(DT, { ...IDLE, punch: true, attack: true });
        expect(profile.ammo.pistol).toBe(4);
        for (let i = 0; i < 30; i++) w.update(DT, IDLE);
        expect(ped.down > 0 || ped.hp < 20).toBe(true);
    });

    it('opps skjuter tillbaka när du är beväpnad', () => {
        const profile = createPlayerState('kimit');
        profile.weapons = ['pistol']; profile.ammo = { pistol: 10 };
        const w = makeWorld(46, profile);
        standIn(w, 'vasterort');
        w.spawnOpps('dods');
        expect(w.peds.some(pd => pd.gun)).toBe(true);
        let shot = false;
        for (let i = 0; i < 60 * 20 && !shot; i++) { w.update(DT, IDLE); if (w.bullets.some(b => b.from === 'npc')) shot = true; }
        expect(shot).toBe(true);
    });

    it('en rånare tar pengar av den som inte slåss', () => {
        const profile = createPlayerState('kimit');
        profile.money = 10000;
        const w = makeWorld(47, profile);
        standIn(w, 'orten');
        w.spawnMugger();
        for (let i = 0; i < 60 * 40 && profile.money === 10000; i++) w.update(DT, IDLE);
        expect(profile.money).toBeLessThan(10000);
    });

    it('en fin bil imponerar mer än en cykel', () => {
        expect(dateChance(createVehicle('rolls', 0, 0, 0))).toBeGreaterThan(dateChance(createVehicle('cykel', 0, 0, 0)));
        expect(dateChance(null)).toBe(0);
    });

    it('dejt: hämta vid nattklubben, kör hem till henne, några timmar senare...', () => {
        const profile = createPlayerState('kimit');
        const w = makeWorld(48, profile);
        w.time = (22 - 19.5) * 24; // 22:00
        const club = city.markers.club;
        const car = createVehicle('rolls', club.x, club.y, 0);
        w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
        w.player.x = club.x; w.player.y = club.y;
        w.player.hp = 40;
        w.update(DT, IDLE);
        expect(w.date).toBeTruthy();
        const dest = w.date.dest;
        car.x = dest.x; car.y = dest.y; car.vx = 0; car.vy = 0;
        w.update(DT, IDLE);
        expect(w.date).toBe(null);
        expect(w.player.hp).toBe(100);
        expect(profile.rep).toBe(5);
        expect(profile.dateThisRound).toBe(true);
        expect(profile.cityStats.dates).toBe(1);
        expect(w.fade).toBeTruthy();
    });

    it('dejten hoppar av om du krockar för mycket', () => {
        const w = makeWorld(49);
        w.time = (22 - 19.5) * 24;
        const club = city.markers.club;
        const car = createVehicle('rolls', club.x, club.y, 0);
        w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
        w.player.x = club.x; w.player.y = club.y;
        w.update(DT, IDLE);
        expect(w.date).toBeTruthy();
        for (let i = 0; i < 4; i++) { w.damageVehicle(car, 30, null); w.update(DT, IDLE); }
        expect(w.date).toBe(null);
        expect(w.profile.dateThisRound).toBe(false);
    });

    it('nattklubben är stängd på dagen', () => {
        const w = makeWorld(50);
        w.time = (12 - 19.5 + 24) * 24; // 12:00
        const club = city.markers.club;
        const car = createVehicle('rolls', club.x, club.y, 0);
        w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
        w.player.x = club.x; w.player.y = club.y;
        w.update(DT, IDLE);
        expect(w.date).toBe(null);
        expect(w.events.some(e => e.type === 'msg' && e.text.includes('20:00'))).toBe(true);
    });
});

