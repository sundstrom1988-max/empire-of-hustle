// ═══════════════════════════════════════════
//  STAN — gänguppdrag från telefonkiosker ☎️
//  Leverans, bilstöld, fly från snuten,
//  krossa rivalbilar och VIP-skjuts.
// ═══════════════════════════════════════════

import { GANGS, HOSTILE_RESPECT, RESPECT_MIN, RESPECT_MAX, TILE } from './constants.js';
import { setStars, stars } from './wanted.js';

export const MISSION_TYPES = ['delivery', 'steal', 'escape', 'smash', 'vip'];

const BASE_REWARD = { delivery: 900, steal: 1500, escape: 1800, smash: 1600, vip: 1100 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function rewardFor(type, round, respect) {
    const roundMult = 1 + Math.min(round, 30) * 0.06;
    const respectMult = respect >= 50 ? 1.3 : respect >= 20 ? 1.15 : 1;
    return Math.round(BASE_REWARD[type] * roundMult * respectMult / 10) * 10;
}

export function applyRespect(respect, gang, success) {
    const out = { kebab: 0, orden: 0, taco: 0, ...respect };
    if (success) {
        for (const g of GANGS) out[g.id] += g.id === gang ? 12 : -6;
    } else {
        out[gang] -= 5;
    }
    for (const g of GANGS) out[g.id] = clamp(out[g.id], RESPECT_MIN, RESPECT_MAX);
    return out;
}

export const phoneOpen = (respect, gang) => (respect[gang] ?? 0) > HOSTILE_RESPECT;
export const isHostile = (respect, gang) => (respect[gang] ?? 0) <= HOSTILE_RESPECT;
export const gangById = (id) => GANGS.find(g => g.id === id);

// ── Uppdragstexter (bossens SMS) ──
const BRIEFS = {
    delivery: {
        kebab: m => `Yo bram! Vitsåsen måste fram innan den surnar. Hämta lådan vid ${m.pickup.name} och kör den till ${m.drop.name}. Du har ${m.timeLimit} sek. JALLA!`,
        orden: m => `Hehehe... ett paket med "ingredienser" väntar vid ${m.pickup.name}. Leverera till ${m.drop.name} på ${m.timeLimit} sekunder. Titta inte i lådan.`,
        taco: m => `Hola amigo! Salsan är het. Plocka upp den vid ${m.pickup.name}, leverera till ${m.drop.name}. ${m.timeLimit} sekunder, rápido!`
    },
    steal: {
        kebab: m => `Wallah, jag behöver en ${m.carName}. Det står en parkerad i stan — sno den och kör till garaget vid ${m.garage.name}. Inga repor!`,
        orden: m => `Mina smurfjägare behöver en ny ${m.carName}. Stjäl den och för den till ${m.garage.name}. Hel, förstås. Hehehe.`,
        taco: m => `Min primo vill ha en ${m.carName} till bröllopet. Den står i stan. Kör den till ${m.garage.name}, amigo.`
    },
    escape: {
        kebab: m => `Bram... jag tipsade snuten om dig. Skämt! Men nu jagar ${m.stars} snutar dig. Skaka av dem inom ${m.timeLimit} sek så får du betalt.`,
        orden: m => `Ett litet test av din list. Jag har ringt polisen. ${m.stars} stjärnor. Försvinn inom ${m.timeLimit} sekunder.`,
        taco: m => `La policía! De letar efter en som ser ut som du. Skaka av dem inom ${m.timeLimit} sekunder, amigo!`
    },
    smash: {
        kebab: m => `${m.rivalName} kör runt i VÅRT område. Kvadda ${m.count} av deras bilar på ${m.timeLimit} sek. Visa vem som äger gatan!`,
        orden: m => `${m.rivalName} har förolämpat mig. Krossa ${m.count} av deras bilar innan ${m.timeLimit} sekunder har gått. Hehehe.`,
        taco: m => `${m.rivalName} snackar skit om våra tacos. Kvadda ${m.count} av deras bilar på ${m.timeLimit} sekunder!`
    },
    vip: {
        kebab: m => `Min kusin ${m.vipName} väntar vid ${m.pickup.name}. Kör honom till ${m.drop.name}. Varje buckla dras från lönen, bram!`,
        orden: m => `En viktig gäst, ${m.vipName}, väntar vid ${m.pickup.name}. Eskortera till ${m.drop.name}. Varsamt.`,
        taco: m => `${m.vipName} måste till ${m.drop.name}. Hämta vid ${m.pickup.name}. Kör snällt, han har just ätit tre burritos.`
    }
};

const VIP_NAMES = ['Lill-Ahmed', 'Big Benke', 'Don Pedro', 'Smurfan', 'Knansens kusin', 'Farbror Herrman', 'Señor Nacho', 'MC Vitlök'];
const STEAL_CARS = [['bmw', 'BMW E46'], ['mercedes', 'Mercedes AMG'], ['lambo', 'Lamborghini'], ['rolls', 'Rolls Royce']];

export function createMission(gang, ctx) {
    const { rng, round = 1, respect = 0, city, from } = ctx;
    const type = ctx.type || rng.pick(MISSION_TYPES);
    const g = gangById(gang);
    const places = city.markers.places;
    const home = places.filter(p => p.district === g.district);
    const far = (a, min) => places.filter(p => p !== a && dist(p, a) >= min * TILE);
    const pickFar = (a, min) => { const c = far(a, min); return c.length ? rng.pick(c) : rng.pick(places.filter(p => p !== a)); };

    const m = {
        id: Math.floor(rng() * 1e9), gang, type, stage: 0, elapsed: 0,
        reward: rewardFor(type, round, respect), payout: 0, target: null, timeLimit: 120
    };

    switch (type) {
        case 'delivery': {
            m.pickup = rng.pick(home.length ? home : places);
            m.drop = pickFar(m.pickup, 18);
            m.timeLimit = Math.round((dist(from, m.pickup) + dist(m.pickup, m.drop)) / 230 + 25);
            break;
        }
        case 'vip': {
            m.pickup = pickFar(from, 8);
            m.drop = pickFar(m.pickup, 16);
            m.vipName = rng.pick(VIP_NAMES);
            m.timeLimit = Math.round((dist(from, m.pickup) + dist(m.pickup, m.drop)) / 210 + 30);
            break;
        }
        case 'steal': {
            const [carType, carName] = rng.pick(STEAL_CARS);
            m.carType = carType; m.carName = carName;
            const spots = city.lotSpots.filter(s => dist(s, from) > 14 * TILE);
            const s = spots.length ? rng.pick(spots) : city.lotSpots[0];
            m.spot = { x: s.x, y: s.y, angle: s.angle };
            m.garage = rng.pick(home.length ? home : places);
            m.timeLimit = 170;
            m.reward = Math.round(m.reward * (carType === 'lambo' || carType === 'rolls' ? 1.3 : 1) / 10) * 10;
            break;
        }
        case 'escape': {
            m.stars = round > 6 ? 4 : 3;
            m.timeLimit = 90 + m.stars * 10;
            break;
        }
        case 'smash': {
            const rivals = GANGS.filter(x => x.id !== gang);
            const rival = rng.pick(rivals);
            m.rival = rival.id; m.rivalName = rival.name;
            m.count = round > 5 ? 4 : 3;
            m.timeLimit = 130;
            break;
        }
    }
    m.title = { delivery: 'Leverans', steal: 'Bilstöld', escape: 'Fly från snuten', smash: 'Krossa rivalerna', vip: 'VIP-skjuts' }[type];
    m.brief = BRIEFS[type][gang](m);
    return m;
}

// Uppdaterar ett pågående uppdrag. Returnerar 'success', 'fail' eller null.
export function updateMission(m, world, dt) {
    m.elapsed += dt;
    m.timeLeft = Math.max(0, m.timeLimit - m.elapsed);
    if (m.timeLeft <= 0) { m.failReason = 'Tiden tog slut!'; return 'fail'; }

    const p = world.player;
    const veh = world.playerVehicle();
    const near = (pt, r = 72) => Math.hypot(p.x - pt.x, p.y - pt.y) < r;
    const slow = () => !veh || Math.hypot(veh.vx, veh.vy) < 230;
    const succeed = () => { if (!m.payout) m.payout = m.reward; return 'success'; };

    switch (m.type) {
        case 'delivery':
            if (m.stage === 0) {
                m.target = { x: m.pickup.x, y: m.pickup.y, label: '📦 ' + m.pickup.name };
                if (near(m.pickup) && slow()) { m.stage = 1; world.notify(`📦 Lådan är lastad! Kör till ${m.drop.name}.`); }
            } else {
                m.target = { x: m.drop.x, y: m.drop.y, label: '🎯 ' + m.drop.name };
                if (near(m.drop) && slow()) return succeed();
            }
            return null;

        case 'vip':
            if (m.stage === 0) {
                m.target = { x: m.pickup.x, y: m.pickup.y, label: '🕴️ ' + m.vipName };
                if (near(m.pickup)) {
                    if (veh && slow()) {
                        m.stage = 1; m.vipVehicle = veh; m.hpStart = veh.hp;
                        world.notify(`🕴️ ${m.vipName} hoppade in. Kör till ${m.drop.name} — försiktigt!`);
                    } else if (!veh && !m.warnedNoCar) {
                        m.warnedNoCar = true;
                        world.notify(`🕴️ ${m.vipName}: "Ska jag GÅ? Fixa en bil, bram!"`);
                    }
                }
            } else {
                if (veh !== m.vipVehicle) { m.failReason = `${m.vipName} hoppade av!`; return 'fail'; }
                m.target = { x: m.drop.x, y: m.drop.y, label: '🎯 ' + m.drop.name };
                const damage = Math.max(0, m.hpStart - veh.hp) / (veh.maxHp || 100);
                m.damage = damage;
                if (near(m.drop) && slow()) {
                    m.payout = Math.round(m.reward * clamp(1 - damage * 1.2, 0.3, 1) / 10) * 10;
                    return succeed();
                }
            }
            return null;

        case 'steal':
            if (!m.car) m.car = world.spawnMissionVehicle(m.carType, m.spot, 'steal');
            if (m.car.wrecked || m.car.hp <= 0) { m.failReason = 'Bilen blev kvaddad!'; return 'fail'; }
            if (m.stage === 0) {
                m.target = { x: m.car.x, y: m.car.y, label: '🚗 ' + m.carName };
                if (veh === m.car) { m.stage = 1; world.notify(`🚗 Snyggt! Kör den till ${m.garage.name}.`); }
            } else {
                if (veh !== m.car) { m.stage = 0; return null; }
                m.target = { x: m.garage.x, y: m.garage.y, label: '🔧 ' + m.garage.name };
                if (near(m.garage, 90) && slow()) {
                    world.removeVehicle(m.car);
                    return succeed();
                }
            }
            return null;

        case 'escape':
            if (!m.started) {
                m.started = true;
                setStars(world.wanted, m.stars);
                world.notify(`🚨 ${m.stars} snutar är efter dig. Skaka av dem!`);
            }
            m.target = null;
            if (stars(world.wanted) === 0) return succeed();
            return null;

        case 'smash': {
            if (!m.cars) {
                m.cars = [];
                for (let i = 0; i < m.count; i++) {
                    const spot = world.findSpot(p.x, p.y, 500 + i * 150, 1700);
                    if (spot) m.cars.push(world.spawnMissionVehicle('gang_' + m.rival, spot, 'smash'));
                }
                m.count = m.cars.length;
            }
            const alive = m.cars.filter(c => !c.wrecked && c.hp > 0);
            m.left = alive.length;
            if (alive.length === 0) return succeed();
            const nearest = alive.reduce((b, c) => (!b || Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? c : b), null);
            m.target = { x: nearest.x, y: nearest.y, label: `💥 ${m.left} kvar` };
            return null;
        }
    }
    return null;
}
