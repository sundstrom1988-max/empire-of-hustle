import { describe, it, expect } from 'vitest';
import { World, startSpot } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { setStars, stars } from '../src/city/wanted.js';
import { createVehicle } from '../src/city/vehicles.js';
import { createPed, initLaneAI } from '../src/city/ai.js';
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

describe('Startplatser online', () => {
    it('ger varje spelare en egen gångbar plats vid HQ', () => {
        const spots = [0, 1, 2, 3, 4, 5].map(s => startSpot(city, s));
        for (const p of spots) {
            expect(isWalkableTile(city, Math.floor(p.x / TILE), Math.floor(p.y / TILE))).toBe(true);
            expect(Math.hypot(p.x - city.spawn.x, p.y - city.spawn.y)).toBeLessThan(160);
        }
        for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
            expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)).toBeGreaterThan(30);
        }
        const w = new World(city, createPlayerState('mehmet'), { round: 2, rnd: mulberry32(3), slot: 1 });
        expect(w.player.x).toBe(spots[1].x);
        expect(w.player.y).toBe(spots[1].y);
    });
});

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

    it('collects cash inside your own business once per round', () => {
        const profile = createPlayerState('mehmet');
        profile.owned = ['kebab']; profile.levels = { kebab: 2 };
        const w = makeWorld(2, profile);
        const mk = city.markers.businesses.find(b => b.slot === 0);
        enterDoor(w, mk);
        const m0 = profile.money;
        expect(w.place?.pl).toBe(mk);
        expect(w.placeAction('collect').close).toBe(false);
        expect(profile.money).toBe(m0 + Math.floor(80 * 2 * 0.3));
        w.leavePlace();
        w.player.x += 500; w.update(DT, IDLE);
        enterDoor(w, mk);
        expect(w.placeInfo().actions.some(a => a.id === 'collect')).toBe(false);
    });
});

// Gå fram till ett ställes dörr (mot husväggen) så att man går in
function enterDoor(w, d) {
    w.player.x = d.door.x; w.player.y = d.door.y;
    w.update(DT, IDLE);
}

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


describe('Snuten', () => {
    // En snutbil på en fil nära spelaren
    function copCar(w, minD = 60, maxD = 200) {
        const spot = w.findSpot(w.player.x, w.player.y, minD, maxD);
        const v = createVehicle('police', spot.x, spot.y, spot.angle);
        v.driver = 'cop';
        initLaneAI(v, spot.tx, spot.ty, spot.dir, w.rnd);
        w.vehicles.push(v);
        return v;
    }
    const noCops = w => { w.vehicles = w.vehicles.filter(v => v.driver !== 'cop'); w.peds = w.peds.filter(p => !p.cop); };

    it('ett brott som ingen snut ser ger inga stjärnor', () => {
        const w = makeWorld(60);
        standIn(w, 'orten');
        noCops(w);
        const ped = createPed(w.player.x + 12, w.player.y, w.rnd, { type: 'civ' });
        w.peds = [ped];
        w.update(DT, { ...IDLE, punch: true });
        expect(ped.hp).toBeLessThan(ped.maxHp);
        expect(stars(w.wanted)).toBe(0);
    });

    it('samma brott framför en snut ger efterlysning', () => {
        const w = makeWorld(61);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32;
        noCops(w);
        const cop = createVehicle('police', w.player.x + 120, w.player.y, Math.PI);
        cop.driver = 'cop';
        w.vehicles.push(cop);
        const ped = createPed(w.player.x + 12, w.player.y, w.rnd, { type: 'civ' });
        w.peds = [ped];
        w.player.angle = 0;
        w.update(DT, { ...IDLE, punch: true });
        expect(stars(w.wanted)).toBeGreaterThan(0);
    });

    it('går att skaka av sig: utom synhåll tappar de spåret och stjärnorna försvinner', () => {
        const w = makeWorld(62);
        standIn(w, 'skogsbacken');
        noCops(w);
        w.manageSpawns = () => { };   // inga nya snutar i det här testet
        setStars(w.wanted, 2);
        w.wanted.seenT = 0;
        let t = 0;
        while (stars(w.wanted) > 0 && t < 30) { w.update(DT, IDLE); t += DT; }
        expect(stars(w.wanted)).toBe(0);
        expect(t).toBeLessThan(20);
    });

    it('snutbilar som tappat bort dig patrullerar i stället för att jaga', () => {
        const w = makeWorld(63);
        standIn(w, 'hamnen');
        noCops(w);
        const v = copCar(w, 700, 1100);
        setStars(w.wanted, 2);
        w.wanted.seenT = 10;
        w.update(DT, IDLE);
        expect(v.ai.mode).toBe('lane');
        expect(v.siren).toBe(true);
    });

    it('till fots kliver snuten ur bilen och springer efter dig', () => {
        const w = makeWorld(64);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32;
        noCops(w);
        // Snutbil på ringvägen, på väg mot spelaren
        const v = createVehicle('police', w.player.x + 160, w.player.y, Math.PI);
        v.driver = 'cop';
        initLaneAI(v, 10, 3, 3, w.rnd);
        v.angle = Math.PI;
        w.vehicles.push(v);
        setStars(w.wanted, 1);
        let out = false;
        for (let i = 0; i < 60 * 8 && !out; i++) {
            w.update(DT, IDLE);
            setStars(w.wanted, 1);
            out = w.peds.some(p => p.cop && p.attack);
        }
        expect(out).toBe(true);
    });

    it('en snut som slås ner reser sig inte, och det ger efterlysning', () => {
        const w = makeWorld(65);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        noCops(w);
        w.manageSpawns = () => { };
        const cop = createPed(w.player.x + 14, w.player.y, w.rnd, { cop: true, shirt: '#1e3a8a', hp: 40, attack: true, attackT: 90 });
        w.peds = [cop];
        setStars(w.wanted, 1);
        for (let i = 0; i < 60 * 6 && !cop.dead; i++) w.update(DT, { ...IDLE, punch: i % 22 === 0 });
        expect(cop.dead).toBe(true);
        expect(w.profile.cityStats.copsDown).toBe(1);
        expect(stars(w.wanted)).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < 60 * 15; i++) w.update(DT, IDLE);
        expect(cop.down).toBeGreaterThan(0);
    });

    it('att köra över en snut sänker honom för gott', () => {
        const w = makeWorld(66);
        const car = onRingRoad(w);
        car.vx = 300;
        const cop = createPed(car.x + 30, car.y, w.rnd, { cop: true });
        w.knockPed(cop, car);
        expect(cop.dead).toBe(true);
        expect(stars(w.wanted)).toBeGreaterThan(0);
    });
});

describe('Slagsmål', () => {
    it('en mot en: du vinner mot en gängmedlem utan att bli sönderslagen', () => {
        const w = makeWorld(70);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        w.manageSpawns = () => { };
        const g = createPed(w.player.x + 16, w.player.y, w.rnd, { type: 'gang', gang: 'dods', attack: true, attackT: 60 });
        w.peds = [g];
        for (let i = 0; i < 60 * 5 && !(g.down > 0); i++) w.update(DT, { ...IDLE, punch: i % 22 === 0 });
        expect(g.down).toBeGreaterThan(0);
        expect(w.player.hp).toBeGreaterThan(75);
    });

    it('fyra opps dödar dig inte på några sekunder', () => {
        const w = makeWorld(71);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32;
        w.manageSpawns = () => { };
        w.peds = [0, 1, 2, 3].map(i => createPed(w.player.x + 14 + i * 4, w.player.y + (i - 1.5) * 9, w.rnd, { type: 'gang', gang: 'dods', attack: true, attackT: 60, hp: 35 }));
        for (let i = 0; i < 60 * 5; i++) w.update(DT, IDLE);
        expect(w.state).toBe('play');
        expect(w.player.hp).toBeGreaterThan(0);
    });

    it('ett slag avbryter motståndarens slag och knuffar bak honom', () => {
        const w = makeWorld(72);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        const g = createPed(w.player.x + 15, w.player.y, w.rnd, { type: 'gang', gang: 'dods', attack: true, attackT: 60 });
        g.windup = 0.2;
        w.peds = [g];
        const x0 = g.x;
        w.update(DT, { ...IDLE, punch: true });
        expect(g.windup).toBe(0);
        expect(g.stunT).toBeGreaterThan(0);
        for (let i = 0; i < 10; i++) w.update(DT, IDLE);
        expect(g.x).toBeGreaterThan(x0);
    });

    it('slut på skott: SPACE slår med nävarna i stället för att bara klicka', () => {
        const profile = createPlayerState('kimit');
        profile.weapons = ['pistol']; profile.ammo = { pistol: 0 }; profile.weapon = 'pistol';
        const w = makeWorld(73, profile);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        w.manageSpawns = () => { };
        const g = createPed(w.player.x + 16, w.player.y, w.rnd, { type: 'gang', gang: 'dods', attack: true, attackT: 60 });
        w.peds = [g];
        const hp0 = g.hp;
        w.update(DT, { ...IDLE, punch: true });
        expect(g.hp).toBeLessThan(hp0);
        expect(profile.weapon).toBe('fists');
        // Med ett basebollträ tar man trät
        profile.weapons = ['pistol', 'bat']; profile.weapon = 'pistol'; w.punchCd = 0;
        w.update(DT, { ...IDLE, punch: true });
        expect(profile.weapon).toBe('bat');
    });
});

describe('Slagsmål mot andra spelare', () => {
    // Ett låtsasnät: en annan spelare står bredvid, värdens beslut kommer inte (vi tittar bara på förfrågan)
    const withRemote = (prot, dist = 30) => {
        const w = makeWorld(74);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32; w.player.angle = 0;
        w.manageSpawns = () => { }; w.peds = [];
        const sent = [];
        const r = { id: 'mehmet', name: 'Mehmet', rx: w.player.x + dist, ry: w.player.y, x: w.player.x + dist, y: w.player.y, prot, crew: [] };
        w.net = { online: true, remotes: () => new Map([[r.id, r]]), taken: () => new Set(), request: (type, data) => { sent.push({ type, ...data }); return true; } };
        return { w, sent };
    };

    it('slaget når en spelare som står en bit bort (marginal för nätet)', () => {
        const { w, sent } = withRemote(false, 40);
        w.update(DT, { ...IDLE, punch: true });
        expect(sent.filter(m => m.type === 'hit')).toHaveLength(1);
    });

    it('en skyddad spelare: inget slag skickas och man ser varför', () => {
        const { w, sent } = withRemote(true);
        w.update(DT, { ...IDLE, punch: true });
        expect(sent.filter(m => m.type === 'hit')).toHaveLength(0);
        expect(w.floaters.some(f => f.text.includes('SKYDDAD'))).toBe(true);
    });

    it('den som slåss tappar sitt eget skydd', () => {
        const { w } = withRemote(false);
        w.player.protT = 6;
        expect(w.netSnapshot().prot).toBe(true);
        w.update(DT, { ...IDLE, punch: true });
        expect(w.player.protT).toBe(0);
        expect(w.netSnapshot().prot).toBe(false);
    });
});

describe('Gå in med E', () => {
    const DXS = [0, 1, 0, -1], DYS = [-1, 0, 1, 0];
    const infront = (w, o, dist) => { w.player.x = o.x - DXS[o.side] * dist; w.player.y = o.y - DYS[o.side] * dist; w.peds = []; w.manageSpawns = () => { }; w.vehicles = []; };

    it('E vid en butiksdörr öppnar butiken, och tipset säger det', () => {
        const w = makeWorld(90);
        const shop = city.markers.businesses[0];
        infront(w, shop.door, 36);
        w.update(DT, IDLE);
        expect(w.place).toBe(null); // inte ända fram — ingen automatisk dörr
        expect(w.hint).toContain('E — Gå in');
        w.update(DT, { ...IDLE, action: true });
        expect(w.place?.pl).toBe(shop);
    });

    it('E vid Club Diamant går in i klubben, i bil säger tipset kliv ur', () => {
        const w = makeWorld(91);
        const o = city.markers.stripclub.door;
        infront(w, o, 36);
        w.update(DT, { ...IDLE, action: true });
        expect(w.interior?.id).toBe('stripclub');
        w.exitInterior();
        const car = createVehicle('sedan', o.x - DXS[o.side] * 70, o.y - DYS[o.side] * 70, 0);
        w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
        w.player.x = car.x; w.player.y = car.y;
        w.update(DT, IDLE);
        expect(w.hint).toContain('kliv ur');
    });

    it('nattklubben går att gå in på till fots — dansa och VIP, dejten kräver bil', () => {
        const w = makeWorld(92);
        const c = city.markers.club;
        w.peds = []; w.manageSpawns = () => { };
        w.time = (21 - 19.5) * 24; // 21:00, öppet
        w.player.x = c.x; w.player.y = c.y;
        w.update(DT, IDLE);
        expect(w.place?.pl.kind).toBe('nightclub');
        const info = w.placeInfo();
        expect(info.actions.map(a => a.id)).toEqual(['dance', 'nightvip', 'date', 'leave']);
        expect(info.actions.find(a => a.id === 'date').disabled).toBe(true);
        w.profile.money = 2000; w.player.hp = 50;
        w.placeAction('dance');
        expect(w.profile.money).toBe(1900);
        expect(w.player.hp).toBe(65);
        w.placeAction('nightvip');
        expect(w.profile.money).toBe(900);
        expect(w.placeInfo().actions.find(a => a.id === 'nightvip').disabled).toBe(true);
    });

    it('nattklubben är stängd före 20:00', () => {
        const w = makeWorld(93);
        const c = city.markers.club;
        w.peds = []; w.manageSpawns = () => { };
        w.time = 0; // 19:30
        w.enterPlace(w.nightclubPlace());
        const info = w.placeInfo();
        expect(info.desc).toContain('20:00');
        expect(info.actions.map(a => a.id)).toEqual(['leave']);
        expect(c).toBeTruthy();
    });
});

describe('Ställen att gå in i', () => {
    const armedProfile = (money = 50000) => {
        const p = createPlayerState('kimit');
        p.money = money; p.weapons = ['pistol']; p.ammo = { pistol: 10 }; p.weapon = 'pistol';
        return p;
    };
    const quiet = w => { w.vehicles = w.vehicles.filter(v => v.driver !== 'cop'); };

    it('köp en fastighet vid dörren', () => {
        const profile = createPlayerState('kimit');
        profile.money = 5000;
        const w = makeWorld(80, profile);
        enterDoor(w, city.markers.businesses.find(b => b.slot === 0));
        expect(w.placeInfo().actions.find(a => a.id === 'buy').disabled).toBe(false);
        w.placeAction('buy');
        expect(profile.owned).toContain('kebab');
        expect(profile.money).toBe(4500);
        expect(w.placeInfo().actions.some(a => a.id === 'rob')).toBe(false);
    });

    it('råna en butik med vapen i handen — en gång per runda', () => {
        const profile = armedProfile(0);
        const w = makeWorld(81, profile);
        quiet(w);
        enterDoor(w, city.markers.businesses.find(b => b.slot === 1));
        expect(w.placeAction('rob').close).toBe(true);
        expect(profile.money).toBeGreaterThan(0);
        expect(profile.cityStats.heists).toBe(1);
        w.leavePlace();
        w.player.x += 400; w.update(DT, IDLE);
        enterDoor(w, city.markers.businesses.find(b => b.slot === 1));
        expect(w.placeInfo().actions.find(a => a.id === 'rob').disabled).toBe(true);
    });

    it('gömställe: köp, och vänta ut snuten om ingen såg dig gå in', () => {
        const profile = armedProfile();
        const w = makeWorld(82, profile);
        quiet(w);
        const house = city.markers.houses.find(h => h.district === 'orten');
        enterDoor(w, house);
        w.placeAction('buyhouse');
        expect(profile.cityHouses).toContain(house.id);
        w.leavePlace();
        setStars(w.wanted, 2);
        w.place = null;
        w.enterPlace(house);
        w.place.seen = false;
        expect(w.placeAction('hide').close).toBe(true);
        expect(stars(w.wanted)).toBe(0);
        // Såg de dig gå in går det inte
        setStars(w.wanted, 2);
        w.enterPlace(house);
        w.place.seen = true;
        expect(w.placeInfo().actions.find(a => a.id === 'hide').disabled).toBe(true);
    });

    it('bankrån ger mycket pengar och tre stjärnor direkt', () => {
        const profile = armedProfile(0);
        const w = makeWorld(83, profile);
        enterDoor(w, city.markers.bank);
        w.placeAction('robbank');
        expect(profile.money).toBeGreaterThan(3000);
        expect(stars(w.wanted)).toBe(3);
    });

    it('gymmet gör dig starkare och frisören får snuten att tappa dig', () => {
        const profile = armedProfile();
        const w = makeWorld(84, profile);
        quiet(w);
        enterDoor(w, city.markers.businesses.find(b => b.slot === 2)); // Hustle Gym
        w.placeAction('train');
        expect(profile.strength).toBe(1);
        expect(w.player.maxHp).toBe(110);
        expect(w.placeInfo().actions.find(a => a.id === 'train').disabled).toBe(true);
        w.leavePlace();
        setStars(w.wanted, 3);
        w.enterPlace(city.markers.businesses.find(b => b.slot === 1)); // Frisören
        w.place.seen = false;
        w.placeAction('look');
        expect(stars(w.wanted)).toBe(1);
    });
});
