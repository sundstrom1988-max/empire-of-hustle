import { describe, it, expect } from 'vitest';
import {
    MAX_LEVEL, XP_MAX, MAX_AWARD, XP_CUBIC, RANKS, XP_TOTAL, xpToNext, xpForLevel, levelOf, levelFromXp, legendStars,
    rankOf, rankIndex, ranksBetween, levelBadge, clampLevel, playerLevel,
    UNLOCKS, getUnlock, requiredLevel, unlockLevel, isUnlocked, unlocksAt, unlocksBetween, nextUnlocks, lockLabel, lockInfo,
    missionCap, goodsCap, fenceCap, crewMax, crewRecover, gunDiscount,
    dmgMult, damageMultiplier, critChance, npcDamage, meleeBase, crewDmgMult, knockMult,
    pvpMult, newbieShield, pvpDamage, oppsCount, oppsArmed, copHpMult, levelStats,
    NEWBIE_MAX_LEVEL, CREW_TIERS, crewTier, crewTierMult, crewNpcDamage, crewNpcHurt,
    backupPerRound, bribeCops, doctorMult, lostTrackMult,
    ACTIVE_FAS, isActiveUnlock, comingSoon, RACE_GAP, raceLevel, roomMinLevel,
    respGain, respectMultiplier, scaleRespectDelta, failRespect, startRespect, respectFloor, respectPayMult,
    respectMilestones, fearMult, robFightChance, isOrdinaryPed, shopRobKickChance, muggerInterval,
    XP, XP_SOURCES, MILESTONES, BUCKETS, COOLDOWNS,
    missionXp, bizXp, upgradeXp, carXp, shopRobXp, fenceXp, chaseXp, respMilestoneXp, koSource,
    pvpXp, pvpXpGate, pvpReward, mentorMult, aiStartXp,
    bucketTake, bucketPeek, cooldownOk, createCareer, normalizeCareer,
    awardXp, levelUpRewards, normalizeLevelFields, unseenLevels, markLevelSeen, retroXp
} from '../src/game/levels.js';
import { SHOPS, CARS } from '../src/data/gameData.js';
import { GANG_IDS } from '../src/city/constants.js';
import { WEAPONS } from '../src/city/weapons.js';
import { createPlayerState } from '../src/game/state.js';

const MIN = 60000;
const T0 = 1700000000000;   // en fast "nu" så att hinkarna går att räkna på
const allLevels = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);

function fresh(extra = {}) {
    return { xp: 0, rep: 0, gang: null, respect: Object.fromEntries(GANG_IDS.map(id => [id, 0])), ...extra };
}

describe('titelband', () => {
    it('täcker 1–100 utan luckor eller överlapp', () => {
        expect(RANKS).toHaveLength(11);
        expect(RANKS[0].from).toBe(1);
        expect(RANKS[RANKS.length - 1].to).toBe(100);
        RANKS.forEach((r, i) => {
            expect(r.index).toBe(i);
            expect(r.to).toBeGreaterThanOrEqual(r.from);
            if (i > 0) expect(r.from).toBe(RANKS[i - 1].to + 1);
        });
        for (const L of allLevels) expect(RANKS.filter(r => L >= r.from && L <= r.to)).toHaveLength(1);
    });
    it('har rätt titlar i ändarna och vid gränserna', () => {
        expect(rankOf(1).title).toBe('Springpojke');
        expect(rankOf(5).title).toBe('Springpojke');
        expect(rankOf(6).title).toBe('Hangaround');
        expect(rankOf(23).title).toBe('Torped');
        expect(rankOf(84).title).toBe('Underboss');
        expect(rankOf(85).title).toBe('Gudfadern');
        expect(rankOf(100).title).toBe('Gudfadern');
        expect(rankOf(100).color).toBe('#ffd23f');
        expect(rankOf(1).emoji).toBe('🛴');
        expect(rankOf(85).emoji).toBe('🌹');
        expect(levelBadge(23)).toBe('🔨 23 Torped');
    });
    it('klarar trasiga nivåer', () => {
        expect(rankOf(0).id).toBe('springpojke');
        expect(rankOf(-7).id).toBe('springpojke');
        expect(rankOf(500).id).toBe('gudfadern');
        expect(rankOf('hej').id).toBe('springpojke');
        expect(rankIndex(undefined)).toBe(0);
        expect(clampLevel(NaN)).toBe(1);
        expect(clampLevel('42')).toBe(42);
    });
    it('räknar befordringar mellan två nivåer', () => {
        expect(ranksBetween(5, 6).map(r => r.id)).toEqual(['hangaround']);
        expect(ranksBetween(6, 10)).toEqual([]);
        expect(ranksBetween(1, 100)).toHaveLength(10);
        expect(ranksBetween(22, 31).map(r => r.id)).toEqual(['torped', 'gangsoldat']);
    });
});

describe('XP-kurva', () => {
    it('har designens slutsumma och start', () => {
        expect(XP_TOTAL).toHaveLength(101);
        expect(XP_TOTAL[1]).toBe(0);
        expect(XP_TOTAL[2]).toBe(45);
        expect(XP_CUBIC).toBe(0.0025);
        expect(XP_TOTAL[85]).toBe(87935);
        expect(XP_TOTAL[100]).toBe(138475);
    });
    it('är strikt växande och går i femsteg', () => {
        for (let L = 1; L < 99; L++) expect(xpToNext(L + 1)).toBeGreaterThan(xpToNext(L));
        for (let L = 1; L < 100; L++) {
            expect(xpToNext(L) % 5).toBe(0);
            expect(XP_TOTAL[L + 1]).toBe(XP_TOTAL[L] + xpToNext(L));
        }
        expect(xpToNext(100)).toBe(0);
    });
    it('stämmer med designens nyckelnivåer', () => {
        const table = [[2, 45, 60], [5, 270, 105], [6, 375, 120], [10, 945, 185], [11, 1130, 200], [16, 2285, 280], [20, 3505, 350],
            [23, 4610, 405], [30, 7865, 550], [31, 8415, 570], [41, 15175, 815], [51, 24690, 1125], [60, 36155, 1470],
            [63, 40690, 1600], [75, 63100, 2210], [85, 87935, 2840]];
        for (const [L, total, next] of table) {
            expect(xpForLevel(L)).toBe(total);
            expect(xpToNext(L)).toBe(next);
        }
    });
    it('hittar nivån vid gränserna', () => {
        expect(levelOf(0)).toBe(1);
        expect(levelOf(44)).toBe(1);
        expect(levelOf(45)).toBe(2);
        expect(levelOf(138474)).toBe(99);
        expect(levelOf(138475)).toBe(100);
    });
    it('har nivå 100 som tak', () => {
        expect(levelOf(XP_MAX)).toBe(100);
        expect(levelOf(1e15)).toBe(100);
        expect(xpForLevel(101)).toBe(XP_TOTAL[100]);
        expect(xpForLevel(0)).toBe(0);
        const top = levelFromXp(XP_TOTAL[100] + 50000);
        expect(top.level).toBe(100);
        expect(top.maxed).toBe(true);
        expect(top.progress).toBe(1);
        expect(top.xpNeeded).toBe(0);
        expect(top.xpLeft).toBe(0);
        expect(top.legendStars).toBe(2);
        expect(legendStars(XP_TOTAL[99])).toBe(0);
    });
    it('går runt: levelFromXp(xpForLevel(L)) = L', () => {
        for (const L of allLevels) {
            expect(levelOf(xpForLevel(L))).toBe(L);
            expect(levelFromXp(xpForLevel(L)).level).toBe(L);
            expect(levelFromXp(xpForLevel(L)).xpInto).toBe(0);
            if (L > 1) expect(levelOf(xpForLevel(L) - 1)).toBe(L - 1);
        }
    });
    it('ger allt UI:t behöver', () => {
        const r = levelFromXp(100);
        expect(r).toMatchObject({ xp: 100, level: 2, title: 'Springpojke', emoji: '🛴', color: '#9ca3af', xpInto: 55, xpNeeded: 60, xpLeft: 5, maxed: false });
        expect(r.progress).toBeCloseTo(55 / 60);
        expect(levelFromXp(XP_TOTAL[23]).title).toBe('Torped');
    });
    it('tål trasig XP', () => {
        for (const bad of [undefined, null, NaN, 'abc', -500, {}, [], Infinity]) {
            const r = levelFromXp(bad);
            expect(r.level).toBe(1);
            expect(r.xp).toBe(0);
        }
        expect(levelFromXp('500').level).toBe(7);
    });
});

describe('upplåsningar', () => {
    it('är sorterade, unika och har giltiga nivåer', () => {
        const ids = new Set();
        UNLOCKS.forEach((u, i) => {
            expect(Number.isInteger(u.level)).toBe(true);
            expect(u.level).toBeGreaterThanOrEqual(2);
            expect(u.level).toBeLessThanOrEqual(100);
            if (i > 0) expect(u.level).toBeGreaterThanOrEqual(UNLOCKS[i - 1].level);
            expect(ids.has(u.id)).toBe(false);
            ids.add(u.id);
            expect(['befintligt', 'nytt', 'bonus', 'kosmetiskt']).toContain(u.status);
            expect([1, 2]).toContain(u.fas);
            expect(u.label.length).toBeGreaterThan(3);
        });
    });
    it('följer designens id-lista', () => {
        const design = {
            'weapon:bat': 2, 'weapon:pistol': 6, 'weapon:uzi': 16, 'weapon:shotgun': 23, armor: 7,
            'mission:steal': 3, 'mission:escape': 5, 'mission:smash': 9, 'mission:collect': 26,
            fence: 3, 'gang:join': 6, date: 10, 'rob:shop': 11, 'rob:bank': 20,
            'svc:look': 4, 'svc:train': 6, 'svc:track': 10, 'svc:vip': 13, 'svc:hack': 20,
            'house:house-orten': 12, 'house:house-hamnen': 14, 'house:house-industrin': 16,
            'house:house-vasterort': 18, 'house:house-skogsbacken': 22, 'house:house-centrum': 25,
            'crew:slot1': 8, 'crew:slot2': 14, 'crew:slot3': 22, 'crew:slot4': 30, 'crew:gunner': 18,
            'crew:bouncer': 28, 'crew:veteran': 41, 'crew:elite': 65, 'prop:stripclub': 28,
            'car:moped': 2, 'car:bmw': 6, 'car:mercedes': 12, 'car:lambo': 20, 'car:rolls': 28,
            'pimp:2': 8, 'pimp:3': 16,
            'bm:smuggle': 5, 'bm:counterfeit': 9, 'bm:crypto_scam': 13, 'bm:hack': 17, 'bm:insider': 21,
            'deal:launder': 7, 'deal:bribe': 12,
            'perk:torpedo': 23, 'perk:backup': 31, 'perk:bribecop': 35, 'perk:kapo': 51, 'perk:lawyer': 63,
            'perk:chauffeur': 70, 'perk:family': 75, 'perk:legend': 80, 'perk:offer': 85, 'perk:godcar': 85,
            // fas 1-poster som fyller luckorna efter nivå 40
            'perk:backup2': 44, 'perk:doctor': 58, 'perk:heat': 68, 'perk:crewheal': 73, 'cap:missions6': 78,
            'perk:bribecop2': 82, 'perk:discount30': 88, 'cap:goods25': 90, 'perk:doctorfree': 93, 'cap:fence5': 95,
            'perk:heat2': 97, 'cosm:donstar': 100
        };
        for (const [id, L] of Object.entries(design)) expect(requiredLevel(id), id).toBe(L);
        // start: allt som inte står i listan
        for (const id of ['svc:eat', 'car:cykel', 'weapon:fists', 'mission:delivery', 'mission:vip', 'bm:bootleg', 'deal:tip']) {
            expect(requiredLevel(id)).toBe(1);
        }
        expect(unlockLevel).toBe(requiredLevel);
        expect(getUnlock('weapon:uzi').label).toContain('Uzi');
        expect(getUnlock('finns-inte')).toBeNull();
    });
    it('vet vad en spelare har låst upp — alltid ur XP', () => {
        expect(isUnlocked(5, 'weapon:pistol')).toBe(false);
        expect(isUnlocked(6, 'weapon:pistol')).toBe(true);
        expect(isUnlocked({ xp: XP_TOTAL[16] }, 'weapon:uzi')).toBe(true);
        expect(isUnlocked({ xp: XP_TOTAL[16] - 1 }, 'weapon:uzi')).toBe(false);
        expect(isUnlocked({ xp: 0, level: 100 }, 'rob:bank')).toBe(false);   // p.level är bara en cache
        expect(isUnlocked({ xp: 0, isAI: true }, 'rob:bank')).toBe(true);    // AI spärras aldrig
        expect(isUnlocked(undefined, 'svc:eat')).toBe(true);
        expect(isUnlocked(null, 'weapon:bat')).toBe(false);
        expect(playerLevel({ xp: XP_TOTAL[40] })).toBe(40);
    });
    it('listar upplåsningar per nivå och framåt', () => {
        expect(unlocksAt(6).map(u => u.id).sort()).toEqual(['car:bmw', 'gang:join', 'svc:train', 'weapon:pistol']);
        expect(unlocksAt(19)).toEqual([]);
        expect(unlocksBetween(1, 3).map(u => u.id)).toEqual(['weapon:bat', 'car:moped', 'mission:steal', 'fence']);
        expect(unlocksBetween(5, 5)).toEqual([]);
        expect(nextUnlocks(14, 3).map(u => u.id)).toEqual(['cap:missions4', 'weapon:uzi', 'house:house-industrin']);
        expect(nextUnlocks(100)).toEqual([]);
    });
    it('fas 2 firas aldrig som upplåst', () => {
        expect(ACTIVE_FAS).toBe(1);
        expect(unlocksAt(26)).toEqual([]);
        expect(unlocksAt(26, { all: true }).map(u => u.id)).toEqual(['mission:collect']);
        expect(unlocksBetween(25, 26)).toEqual([]);
        expect(unlocksBetween(89, 90).map(u => u.id)).toEqual(['cap:goods25']);
        expect(nextUnlocks(24).map(u => u.id)).toEqual(['house:house-centrum', 'perk:discount10', 'prop:stripclub']);
        expect(nextUnlocks(97).map(u => u.id)).toEqual(['cosm:donstar']);
        for (const u of nextUnlocks(1, 999)) expect(isActiveUnlock(u)).toBe(true);
        expect(comingSoon().map(u => u.id)).toEqual(['mission:collect', 'cosm:goldguns', 'cosm:rose', 'cosm:statue', 'prestige']);
        expect(comingSoon().every(u => u.fas > ACTIVE_FAS)).toBe(true);
        const p = { xp: XP_TOTAL[26] - 1 };
        const r = awardXp(p, 'opps', { career: createCareer(T0) }, T0);
        expect(r.to).toBe(26);
        expect(r.unlocked).toEqual([]);
        expect(unseenLevels({ xp: XP_TOTAL[100], lvSeen: 25 }).unlocked.every(isActiveUnlock)).toBe(true);
    });
    it('något nytt i byggd fas minst var fjärde nivå, ända till 100', () => {
        const levels = [...new Set(UNLOCKS.filter(isActiveUnlock).map(u => u.level))];
        for (let L = 1; L < 100; L++) {
            const next = levels.find(x => x > L);
            expect(next, `efter nivå ${L}`).toBeDefined();
            expect(next - L, `efter nivå ${L}`).toBeLessThanOrEqual(4);
        }
        // varje titel kommer med något
        for (const r of RANKS.slice(1)) expect(unlocksAt(r.from).length, r.title).toBeGreaterThan(0);
    });
    it('racet: det som ger pengar räknas på rummets lägsta nivå + 10', () => {
        expect(RACE_GAP).toBe(10);
        expect(raceLevel(60, 1)).toBe(11);
        expect(raceLevel(60, 55)).toBe(60);
        expect(raceLevel(60, null)).toBe(60);
        expect(raceLevel(60, undefined)).toBe(60);
        expect(raceLevel(60, 'x')).toBe(60);
        const vet = { xp: XP_TOTAL[60] }, newbie = { xp: 0 }, ai = { xp: XP_TOTAL[90], isAI: true };
        expect(roomMinLevel([vet, newbie, ai])).toBe(1);
        expect(roomMinLevel([vet, ai])).toBeNull();     // en människa: solo
        expect(roomMinLevel([vet])).toBeNull();
        expect(roomMinLevel(null)).toBeNull();
        const roomMin = roomMinLevel([vet, newbie]);
        // pengar: kapas
        for (const id of ['rob:bank', 'prop:stripclub', 'perk:kapo', 'perk:paytier', 'bm:insider', 'deal:bribe', 'car:lambo', 'cap:goods20', 'perk:turfprice']) {
            expect(getUnlock(id).race, id).toBe(true);
            expect(isUnlocked(vet, id), id).toBe(true);
            expect(isUnlocked(vet, id, { roomMin }), id).toBe(false);
        }
        for (const id of ['mission:smash', 'bm:counterfeit', 'rob:shop']) expect(isUnlocked(vet, id, { roomMin }), id).toBe(true);
        expect(getUnlock('perk:lawyer').race).toBe(true);
        // inte pengar: egen nivå gäller
        for (const id of ['weapon:shotgun', 'crew:slot4', 'house:house-centrum', 'perk:fastrecover']) {
            expect(getUnlock(id).race, id).toBe(false);
            expect(isUnlocked(vet, id, { roomMin }), id).toBe(true);
        }
        expect(isUnlocked(ai, 'rob:bank', { roomMin })).toBe(true);   // AI spärras aldrig
        const info = lockInfo(vet, 'rob:bank', { roomMin });
        expect(info).toMatchObject({ locked: true, left: 0, roomCapped: true, hint: 'rummets gräns: Nv 11 (lägsta spelaren + 10)' });
        expect(lockInfo(newbie, 'rob:bank', { roomMin })).toMatchObject({ locked: true, roomCapped: false, left: 19 });
        // gränserna tar raceLevel
        expect(missionCap(raceLevel(60, roomMin))).toBe(3);
        expect(goodsCap(raceLevel(60, roomMin))).toBe(10);
        expect(respectPayMult(80, raceLevel(60, roomMin))).toBe(1.3);
    });
    it('skriver låstexten', () => {
        expect(lockLabel('weapon:uzi')).toBe('🔒 Nivå 16 · Hustlare');
        expect(lockLabel('prop:stripclub')).toBe('🔒 Nivå 28 · Torped');
        const info = lockInfo(9, 'weapon:uzi');
        expect(info).toMatchObject({ locked: true, need: 16, left: 7, hint: 'du: Nv 9 · 7 nivåer kvar' });
        expect(lockInfo(15, 'weapon:uzi').hint).toBe('du: Nv 15 · 1 nivå kvar');
        expect(lockInfo(16, 'weapon:uzi')).toMatchObject({ locked: false, left: 0, hint: '' });
    });
});

describe('gränser per runda och crew', () => {
    it('följer formlerna', () => {
        expect([1, 14, 15, 39, 40, 77, 78, 100].map(L => missionCap(L))).toEqual([3, 3, 4, 4, 5, 5, 6, 6]);
        expect(missionCap(15, 2)).toBe(3);
        expect([1, 34, 35, 59, 60, 89, 90].map(goodsCap)).toEqual([10, 10, 15, 15, 20, 20, 25]);
        expect([32, 33, 94, 95].map(fenceCap)).toEqual([3, 4, 4, 5]);
        expect([7, 8, 13, 14, 21, 22, 29, 30, 100].map(crewMax)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
        expect([54, 55, 72, 73].map(crewRecover)).toEqual([25, 12, 12, 8]);
        expect([24, 25, 37, 38, 87, 88].map(gunDiscount)).toEqual([1, 0.9, 0.9, 0.8, 0.8, 0.7]);
        expect([30, 31, 43, 44].map(backupPerRound)).toEqual([0, 1, 1, 2]);
        expect([34, 35, 81, 82].map(L => bribeCops(L))).toEqual([
            { perRound: 0, perStar: 1000 }, { perRound: 1, perStar: 1000 }, { perRound: 1, perStar: 1000 }, { perRound: 2, perStar: 500 }]);
        expect([57, 58, 92, 93].map(doctorMult)).toEqual([1, 0.5, 0.5, 0]);
        expect([67, 68, 96, 97].map(lostTrackMult)).toEqual([1, 0.75, 0.75, 0.5]);
    });
    it('stämmer med upplåsningslistan', () => {
        for (let n = 1; n <= 4; n++) {
            const L = requiredLevel(`crew:slot${n}`);
            expect(crewMax(L)).toBe(n);
            expect(crewMax(L - 1)).toBe(n - 1);
        }
        expect(missionCap(requiredLevel('cap:missions4'))).toBe(4);
        expect(missionCap(requiredLevel('cap:missions5'))).toBe(5);
        expect(missionCap(requiredLevel('cap:missions6'))).toBe(6);
        expect(goodsCap(requiredLevel('cap:goods15'))).toBe(15);
        expect(goodsCap(requiredLevel('cap:goods20'))).toBe(20);
        expect(goodsCap(requiredLevel('cap:goods25'))).toBe(25);
        expect(fenceCap(requiredLevel('cap:fence4'))).toBe(4);
        expect(fenceCap(requiredLevel('cap:fence5'))).toBe(5);
        expect(gunDiscount(requiredLevel('perk:discount10'))).toBe(0.9);
        expect(gunDiscount(requiredLevel('perk:discount20'))).toBe(0.8);
        expect(gunDiscount(requiredLevel('perk:discount30'))).toBe(0.7);
        expect(crewRecover(requiredLevel('perk:fastrecover'))).toBe(12);
        expect(crewRecover(requiredLevel('perk:crewheal'))).toBe(8);
        expect(backupPerRound(requiredLevel('perk:backup'))).toBe(1);
        expect(backupPerRound(requiredLevel('perk:backup2'))).toBe(2);
        expect(bribeCops(requiredLevel('perk:bribecop')).perRound).toBe(1);
        expect(bribeCops(requiredLevel('perk:bribecop2'))).toEqual({ perRound: 2, perStar: 500 });
        expect(doctorMult(requiredLevel('perk:doctor'))).toBe(0.5);
        expect(doctorMult(requiredLevel('perk:doctorfree'))).toBe(0);
        expect(lostTrackMult(requiredLevel('perk:heat'))).toBe(0.75);
        expect(lostTrackMult(requiredLevel('perk:heat2'))).toBe(0.5);
    });
});

describe('skada', () => {
    it('dmgMult följer formeln och taket', () => {
        expect(dmgMult(1)).toBe(1);
        expect(dmgMult(23)).toBeCloseTo(1.11);
        expect(dmgMult(51)).toBeCloseTo(1.25);
        expect(dmgMult(85)).toBeCloseTo(1.42);
        expect(dmgMult(100)).toBeCloseTo(1.495);
        for (const L of allLevels) {
            expect(dmgMult(L)).toBeLessThanOrEqual(1.5);
            if (L > 1) expect(dmgMult(L)).toBeGreaterThan(dmgMult(L - 1));
        }
        expect(dmgMult(9999)).toBeLessThanOrEqual(1.5);
        expect(dmgMult('skräp')).toBe(1);
        expect(damageMultiplier).toBe(dmgMult);
    });
    it('ger designens skadetabell', () => {
        const bat5 = [meleeBase(28, 5), meleeBase(38, 5)];
        expect(bat5).toEqual([43, 53]);
        expect(meleeBase(28, 99)).toBe(43);   // styrkan kapas vid 5
        expect(Math.floor(bat5[0] * dmgMult(100))).toBe(64);
        expect(Math.floor(bat5[1] * dmgMult(100))).toBe(79);
        expect(WEAPONS.pistol.dmg * dmgMult(51)).toBeCloseTo(30);
        // opps har alltid 35 hp: pistolen sänker dem på ett skott först från nivå 93 (utan kritisk träff)
        expect(WEAPONS.pistol.dmg * dmgMult(92)).toBeLessThan(35);
        expect(WEAPONS.pistol.dmg * dmgMult(93)).toBeGreaterThanOrEqual(35);
        // ... och med en kritisk träff redan från nivå 10 (1 % chans), men aldrig på nivå 9
        expect(WEAPONS.pistol.dmg * dmgMult(10) * 1.5).toBeGreaterThanOrEqual(35);
        expect(critChance(9)).toBe(0);
    });
    it('kritiska träffar från nivå 10', () => {
        expect(critChance(9)).toBe(0);
        expect(critChance(10)).toBeCloseTo(0.01);
        expect(critChance(100)).toBeCloseTo(0.1);
        const crit = npcDamage(20, 50, () => 0);
        expect(crit.crit).toBe(true);
        expect(crit.dmg).toBeCloseTo(20 * dmgMult(50) * 1.5);
        const plain = npcDamage(20, 50, () => 0.99);
        expect(plain.crit).toBe(false);
        expect(plain.dmg).toBeCloseTo(20 * dmgMult(50));
        expect(npcDamage(20, 5, () => 0).crit).toBe(false);
        expect(npcDamage(-5, 50, () => 0.99).dmg).toBe(0);
    });
    it('crew, knuff och motvikt', () => {
        expect(crewDmgMult(1)).toBe(1);
        for (const L of allLevels) expect(crewDmgMult(L)).toBeLessThanOrEqual(1.25);
        expect([22, 23].map(knockMult)).toEqual([1, 1.25]);
        expect([1, 30, 60, 100].map(oppsCount)).toEqual([4, 5, 6, 7]);
        expect(oppsArmed(1, true)).toBe(2);
        expect(oppsArmed(1, false)).toBe(0);
        expect(oppsArmed(40, false)).toBe(1);
        expect(oppsArmed(80, true)).toBe(4);
        for (const L of allLevels) expect(oppsArmed(L, true)).toBeLessThanOrEqual(oppsCount(L));
        expect(copHpMult(1)).toBeCloseTo(1 + 1 / 600);
        expect(Math.round(40 * copHpMult(100))).toBe(47);
        // snutarna blir aldrig tuffare än skadan växer
        for (const L of allLevels) expect(copHpMult(L)).toBeLessThan(dmgMult(L) + 0.01);
    });
    it('den högre skadan märks: färre slag mot opps och snutar', () => {
        const hits = (dmg, hp) => Math.ceil(hp / dmg - 1e-9);
        const bat = WEAPONS.bat.dmg[0] + (WEAPONS.bat.dmg[1] - WEAPONS.bat.dmg[0]) / 2;   // snitt 33
        expect(hits(bat * dmgMult(1), 35)).toBe(2);
        expect(hits(bat * dmgMult(30), 35)).toBe(1);
        const uzi = WEAPONS.uzi.dmg;
        expect(hits(uzi * dmgMult(1), 40 * copHpMult(1))).toBe(4);
        expect(hits(uzi * dmgMult(40), 40 * copHpMult(40))).toBe(3);
        const fists = (WEAPONS.fists.dmg[0] + WEAPONS.fists.dmg[1]) / 2;   // snitt 18
        expect(hits(fists * dmgMult(1), 40 * copHpMult(1))).toBe(3);
        expect(hits(fists * dmgMult(40), 40 * copHpMult(40))).toBe(2);
    });
    it('levelStats visar det som växer varje nivå', () => {
        expect(levelStats(1)).toEqual({ level: 1, dmgPct: 0, critPct: 0, respPct: 0, fearPct: 0 });
        expect(levelStats(23)).toMatchObject({ dmgPct: 11, critPct: 2.3, respPct: 22 });
        expect(levelStats(100)).toEqual({ level: 100, dmgPct: 49.5, critPct: 10, respPct: 99, fearPct: 40 });
        for (let L = 2; L <= 100; L++) expect(levelStats(L).dmgPct).toBeGreaterThan(levelStats(L - 1).dmgPct);
    });
    it('crewets klass gäller bara mot NPC:er', () => {
        expect(crewTier(40)).toBeNull();
        expect(crewTier(41)).toBe(CREW_TIERS.veteran);
        expect(crewTier(65)).toBe(CREW_TIERS.elite);
        expect(crewTier(41).unlock).toBe('crew:veteran');
        expect(crewTierMult('elite')).toBe(1.4);
        expect(crewTierMult(null)).toBe(1);
        expect(crewTierMult('constructor')).toBe(1);
        expect(crewNpcDamage(20, 1, 'elite')).toBeCloseTo(28);
        expect(crewNpcDamage(20, 100, 'veteran')).toBeCloseTo(20 * crewDmgMult(100) * 1.2);
        expect(crewNpcHurt(28, 'elite')).toBeCloseTo(20);
        expect(crewNpcHurt(10)).toBe(10);
    });
    it('PvP håller sig inom ±10 %', () => {
        for (let a = 1; a <= 100; a += 3) for (let t = 1; t <= 100; t += 3) {
            expect(pvpMult(a, t)).toBeGreaterThanOrEqual(0.9 - 1e-9);
            expect(pvpMult(a, t)).toBeLessThanOrEqual(1.1 + 1e-9);
        }
        expect(pvpMult(40, 40)).toBe(1);
        expect(pvpMult(100, 1)).toBeCloseTo(1.1);
        expect(pvpMult(1, 100)).toBeCloseTo(0.9);
        expect(pvpMult(30, 20)).toBeCloseTo(1.05);
    });
    it('PvP-skada: taket före nivån, nybörjarskydd', () => {
        expect(pvpDamage(53, 45, 50, 50)).toBe(45);
        expect(pvpDamage(53, 45, 70, 50)).toBeCloseTo(49.5);
        expect(NEWBIE_MAX_LEVEL).toBe(15);
        expect(newbieShield(15, 5)).toBe(true);
        expect(newbieShield(14, 5)).toBe(false);
        expect(newbieShield(40, 6)).toBe(true);     // skyddet räcker till och med Langare
        expect(newbieShield(25, 15)).toBe(true);
        expect(newbieShield(40, 16)).toBe(false);   // Hustlare har uzi: inget skydd
        expect(newbieShield(15, 5, true)).toBe(false);
        expect(pvpDamage(20, 45, 30, 3)).toBeCloseTo(20 * 1.1 * 0.5);
        expect(pvpDamage(20, 45, 30, 3, { aggro: true })).toBeCloseTo(22);
        expect(pvpDamage('x', 45, 1, 1)).toBe(0);
    });
});

describe('respekt', () => {
    it('vinsten skalas, förlusterna är oförändrade', () => {
        expect(respGain(1)).toBe(1);
        expect(respGain(100)).toBeCloseTo(1.99);
        expect(respectMultiplier).toBe(respGain);
        expect([1, 26, 51, 100].map(L => scaleRespectDelta(12, L))).toEqual([12, 15, 18, 24]);
        expect(scaleRespectDelta(1, 50)).toBe(1);
        expect(scaleRespectDelta(1, 51)).toBe(2);
        expect(scaleRespectDelta(0.2, 1)).toBe(1);
        for (const d of [-10, -5, -3, 0]) expect(scaleRespectDelta(d, 100)).toBe(d);
        expect(scaleRespectDelta('x', 50)).toBe(0);
    });
    it('perks och startrespekt', () => {
        expect(failRespect(62)).toBe(-5);
        expect(failRespect(63)).toBe(0);
        expect([4, 30, 100].map(startRespect)).toEqual([0, 6, 20]);
        expect(respectFloor(75, true)).toBe(50);
        expect(respectFloor(74, true)).toBe(-100);
        expect(respectFloor(100, false)).toBe(-100);
        expect(respectPayMult(80, 40)).toBe(1.3);
        expect(respectPayMult(80, 41)).toBe(1.45);
        expect(respectPayMult(50, 1)).toBe(1.3);
        expect(respectPayMult(20, 1)).toBe(1.15);
        expect(respectPayMult(19, 1)).toBe(1);
        expect(respectMilestones(25, 65)).toEqual([30, 60]);
        expect(respectMilestones(30, 40)).toEqual([]);
        expect(respectMilestones(99, 100)).toEqual([100]);
        expect(respectMilestones(70, 20)).toEqual([]);
    });
    it('gaturespekt: folk fruktar dig', () => {
        expect(fearMult(1)).toBe(1);
        expect(fearMult(100)).toBeCloseTo(0.604);
        const civ = { type: 'civ' }, metro = { type: 'metro' };
        expect(robFightChance(0.3, 1, civ)).toBeCloseTo(0.3);
        expect(robFightChance(0.3, 79, civ)).toBeCloseTo(0.3 * fearMult(79));
        expect(robFightChance(0.3, 80, civ)).toBe(0);
        expect(robFightChance(0.1, 80, metro)).toBe(0);
        expect(robFightChance(1, 80, { type: 'gang', gang: 'kebab' })).toBeCloseTo(fearMult(80));
        // snutar, tuffingar och rånare har också type 'civ' (ai.js) men är inte vanligt folk
        expect(robFightChance(1, 80, { type: 'civ', cop: true })).toBeCloseTo(fearMult(80));
        expect(robFightChance(0.8, 80, { type: 'civ', tough: true })).toBeCloseTo(0.8 * fearMult(80));
        expect(robFightChance(0.8, 100, { type: 'civ', tough: true, mugger: false, wasMugger: true })).toBeCloseTo(0.8 * fearMult(100));
        // utan ped gäller bara fearMult, aldrig nollan
        expect(robFightChance(1, 80)).toBeCloseTo(fearMult(80));
        expect(robFightChance(1, 80, 'civ')).toBeCloseTo(fearMult(80));
        expect(isOrdinaryPed(civ)).toBe(true);
        expect(isOrdinaryPed({ type: 'civ', cop: true })).toBe(false);
        expect(isOrdinaryPed(null)).toBe(false);
        expect(shopRobKickChance(1)).toBe(0.5);
        expect(muggerInterval(100, 0)).toBe(140);
        expect(muggerInterval(1, 1)).toBeCloseTo(140.6);
    });
});

describe('XP-källor', () => {
    it('tabellen hänger ihop', () => {
        for (const [type, xp] of Object.entries(XP.mission)) expect(XP_SOURCES[`mission.${type}`].xp).toBe(xp);
        for (const [kind, xp] of Object.entries(XP.ko)) expect(XP_SOURCES[`ko.${kind}`].xp).toBe(xp);
        for (const [k, s] of Object.entries(XP_SOURCES)) {
            expect([null, 'street', 'office'], k).toContain(s.bucket);
            if (s.milestone) expect(MILESTONES[s.milestone], k).toBeGreaterThan(0);
            expect(s.xp).toBeGreaterThan(0);
            expect(s.xp).toBeLessThanOrEqual(MAX_AWARD);
        }
        expect(Object.values(MILESTONES).reduce((a, b) => a + b, 0)).toBe(360);
        // uppdrag, langning, skrotning, bankrån och dejter ligger utanför hinkarna
        for (const k of ['mission.delivery', 'sell', 'fence', 'bank', 'date']) expect(XP_SOURCES[k].bucket).toBeNull();
        for (const k of ['rob', 'ko.cop', 'wreck', 'chase']) expect(XP_SOURCES[k].bucket).toBe('street');
        for (const k of ['buyBiz', 'pitch', 'roundBonus']) expect(XP_SOURCES[k].bucket).toBe('office');
        for (const k of ['pvp', 'winSolo', 'winOnline', 'finish']) expect(XP_SOURCES[k].mentor).toBe(false);
    });
    it('variabel XP följer designen', () => {
        const biz = Object.fromEntries(SHOPS.map(s => [s.id, bizXp(s.price)]));
        expect(biz).toEqual({ kebab: 10, barber: 11, gym: 12, studio: 13, club: 18, tech: 27, tower: 50, rocket: 110 });
        const cars = Object.fromEntries(CARS.map(c => [c.id, carXp(c.price)]));
        expect(cars).toMatchObject({ cykel: 10, moped: 11, bmw: 13, mercedes: 18, lambo: 35, rolls: 60 });
        expect(upgradeXp(300)).toBe(5);
        expect(upgradeXp(90000)).toBe(50);
        expect([shopRobXp(0), shopRobXp(7), shopRobXp(99)]).toEqual([12, 26, 26]);
        expect([fenceXp(2499), fenceXp(2500)]).toEqual([15, 20]);
        expect([chaseXp(1), chaseXp(2), chaseXp(5), chaseXp(9)]).toEqual([0, 16, 40, 40]);
        expect([respMilestoneXp(30), respMilestoneXp(60), respMilestoneXp(100), respMilestoneXp(50)]).toEqual([40, 60, 100, 0]);
    });
    it('uppdrags-XP: snabbhet, eget gäng och Kapo, avrundat till 5', () => {
        const slow = { type: 'delivery', timeLimit: 100, elapsed: 90 };
        const fast = { type: 'delivery', timeLimit: 100, elapsed: 10 };
        expect(missionXp(slow)).toBe(50);
        expect(missionXp(fast)).toBe(60);
        expect(missionXp(fast, { member: true })).toBe(70);
        expect(missionXp({ type: 'escape', timeLimit: 100, elapsed: 10 }, { member: true, kapo: true })).toBe(215);
        expect(missionXp({ type: 'steal', timeLimit: 100, elapsed: 60 })).toBe(80);
        expect(missionXp({ type: 'okänd' })).toBe(50);
        expect(missionXp(null)).toBe(50);
    });
    it('PvP-XP: 10–80, noll vid stor nivåskillnad eller skydd', () => {
        expect(pvpXp(20, 20)).toBe(40);
        expect(pvpXp(20, 40)).toBe(80);
        expect(pvpXp(20, 100)).toBe(80);
        expect(pvpXp(30, 20)).toBe(20);
        expect(pvpXp(40, 20)).toBe(10);
        expect(pvpXp(50, 21)).toBe(10);
        expect(pvpXp(50, 20)).toBe(0);
        expect(pvpXp(10, 10, true)).toBe(0);
    });
    it('knockout-källan beror på vem som låg', () => {
        expect(koSource({ type: 'civ' })).toBe('ko.civ');
        expect(koSource({ type: 'civ', tough: true })).toBe('ko.tough');
        expect(koSource({ type: 'civ', tough: true, mugger: true })).toBe('ko.mugger');
        // world.js nollar ped.mugger i knockout-grenen; wasMugger stannar kvar
        expect(koSource({ type: 'civ', tough: true, mugger: false, wasMugger: true })).toBe('ko.mugger');
        expect(koSource({ type: 'civ', tough: true, mugger: false })).toBe('ko.tough');
        expect(koSource({ type: 'metro' })).toBe('ko.metro');
        expect(koSource({ type: 'gang' })).toBe('ko.gang');
        expect(koSource({ type: 'civ', cop: true })).toBe('ko.cop');
        expect(koSource(null)).toBe('ko.civ');
    });
    it('mentorbonus och AI-start', () => {
        expect(mentorMult(10, 10)).toBe(1);
        expect(mentorMult(20, 10)).toBe(1);
        expect(mentorMult(10, 20)).toBeCloseTo(1.25);
        expect(mentorMult(1, 100)).toBe(1.75);
        expect(aiStartXp(30)).toBe(XP_TOTAL[25]);
        expect(aiStartXp(3)).toBe(0);
    });
});

describe('awardXp', () => {
    it('ger XP, milstolpe och nivå-upp med upplåsningar', () => {
        const p = fresh(), career = createCareer(T0);
        const r = awardXp(p, 'mission.delivery', { career }, T0);
        expect(r).toMatchObject({ gained: 80, base: 50, bonus: 30, from: 1, to: 2, levelsGained: 1, milestone: 'firstMission', blocked: null });
        expect(r.unlocked.map(u => u.id)).toEqual(['weapon:bat', 'car:moped']);
        expect(r.rankUp).toBe(false);
        expect(p.xp).toBe(80);
        expect(p.level).toBe(2);
        expect(p.rep).toBe(1);
        expect(career.xp).toBe(80);
        expect(career.milestones).toEqual(['firstMission']);
        const again = awardXp(p, 'mission.delivery', { career }, T0 + MIN);
        expect(again).toMatchObject({ gained: 50, bonus: 0, from: 2, to: 3, levelsGained: 1, milestone: null });
        expect(again.unlocked.map(u => u.id)).toEqual(['mission:steal', 'fence']);
        expect(awardXp(p, 'opps', { career }, T0 + 2 * MIN)).toMatchObject({ gained: 25, from: 3, to: 3, levelsGained: 0, unlocked: [], rewards: null });
    });
    it('befordran ger titel, rykte och respekt hos alla utom rivalen', () => {
        const p = fresh({ xp: XP_TOTAL[5] + 10, gang: 'kebab' }), career = createCareer(T0);
        const r = awardXp(p, 'join', { career }, T0);
        expect(r.gained).toBe(150);   // 100 + första gänget 50
        expect(r).toMatchObject({ from: 5, to: 6, rankUp: true });
        expect(r.rank.title).toBe('Hangaround');
        expect(r.ranks.map(x => x.id)).toEqual(['hangaround']);
        expect(r.unlocked.map(u => u.id)).toContain('weapon:pistol');
        expect(r.rewards.rep).toBe(6);
        expect(p.rep).toBe(6);
        expect(p.respect.dods).toBe(0);   // Kebabmaffians rival
        for (const id of GANG_IDS.filter(g => g !== 'dods')) expect(p.respect[id]).toBe(5);
        expect(r.rewards.respect.dods).toBeUndefined();
    });
    it('hoppar flera nivåer på en gång', () => {
        const p = fresh();
        const r = awardXp(p, 'winOnline', { career: createCareer(T0) }, T0);
        expect(r.gained).toBe(600);
        expect(r).toMatchObject({ from: 1, to: 7, levelsGained: 6, rankUp: true });
        expect(new Set(r.unlocked.map(u => u.level))).toEqual(new Set([2, 3, 4, 5, 6, 7]));
        expect(p.rep).toBe(6 + 5);
        for (const id of GANG_IDS) expect(p.respect[id]).toBe(5);
    });
    it('titelrespekten kapas vid 100 och kan stängas av', () => {
        const p = fresh({ xp: XP_TOTAL[6] - 1 });
        p.respect.kebab = 98;
        const r = awardXp(p, 'rob', { career: createCareer(T0), milestone: null }, T0);
        expect(r.to).toBe(6);
        expect(p.respect.kebab).toBe(100);
        expect(r.rewards.respect.kebab).toBe(2);
        const q = fresh({ xp: XP_TOTAL[6] - 1 });
        const r2 = awardXp(q, 'rob', { career: createCareer(T0), milestone: null, applyRespect: false }, T0);
        expect(q.respect.taco).toBe(0);
        expect(r2.rewards.respect.taco).toBe(5);
        const s = fresh({ xp: XP_TOTAL[6] - 1 });
        expect(awardXp(s, 'rob', { career: createCareer(T0), levelRewards: false }, T0).rewards).toBeNull();
        expect(s.rep).toBe(0);
    });
    it('AI och okända källor får ingenting', () => {
        const ai = fresh({ isAI: true });
        expect(awardXp(ai, 'mission.steal', {}, T0)).toMatchObject({ gained: 0, blocked: 'ai' });
        expect(ai.xp).toBe(0);
        const p = fresh();
        expect(awardXp(p, 'finns-inte', {}, T0)).toMatchObject({ gained: 0, blocked: 'unknown' });
        expect(awardXp(p, 'finns-inte', { amount: 7, career: createCareer(T0) }, T0).gained).toBe(7);
        expect(awardXp(null, 'sell')).toMatchObject({ gained: 0, blocked: 'unknown' });
    });
    it('kapar trasiga belopp och XP-taket', () => {
        const career = createCareer(T0);
        const p = fresh();
        expect(awardXp(p, 'pitch', { career, amount: 1e9, bucket: null }, T0).gained).toBe(MAX_AWARD);
        expect(awardXp(p, 'pitch', { career, amount: -50 }, T0).gained).toBe(0);
        expect(awardXp(p, 'pitch', { career, amount: 'skräp' }, T0).gained).toBe(0);
        const rich = fresh({ xp: XP_MAX - 5 });
        const r = awardXp(rich, 'opps', { career }, T0);
        expect(rich.xp).toBe(XP_MAX);
        expect(r.gained).toBe(5);
        expect(rich.level).toBe(100);
    });
    it('once-nycklar ger XP en gång per match', () => {
        const p = fresh(), career = createCareer(T0);
        expect(awardXp(p, 'buyBiz', { career, amount: bizXp(500), once: 'buy:kebab' }, T0).gained).toBe(30);   // 10 + första verksamheten 20
        expect(awardXp(p, 'buyBiz', { career, amount: bizXp(500), once: 'buy:kebab' }, T0)).toMatchObject({ gained: 0, blocked: 'once' });
        expect(p.xpOnce).toEqual(['buy:kebab']);
        expect(awardXp(p, 'join', { career }, T0).gained).toBe(150);
        expect(awardXp(p, 'join', { career }, T0).blocked).toBe('once');
        // ny match (ny spelare), samma karriär: once-nyckeln är borta men milstolpen är kvar
        const next = fresh();
        expect(awardXp(next, 'join', { career }, T0).gained).toBe(100);
    });
    it('milstolpar ges en gång per karriär och går att stänga av', () => {
        const career = createCareer(T0);
        const p = fresh();
        expect(awardXp(p, 'rob', { career }, T0).gained).toBe(16);
        expect(awardXp(p, 'rob', { career }, T0).gained).toBe(6);
        expect(awardXp(fresh(), 'sell', { career, milestone: null }, T0).gained).toBe(5);
        expect(career.milestones).toEqual(['firstRob']);
    });
    it('Gatukassan tar slut och fylls på i realtid', () => {
        const career = createCareer(T0);
        const p = fresh();
        let total = 0;
        for (let i = 0; i < 20; i++) total += awardXp(p, 'rob', { career, milestone: null }, T0).gained;
        expect(total).toBe(120);
        const empty = awardXp(p, 'rob', { career }, T0);
        expect(empty).toMatchObject({ base: 0, blocked: null, capped: true });   // milstolpen ges ändå
        expect(empty.gained).toBe(MILESTONES.firstRob);
        expect(awardXp(p, 'rob', { career }, T0)).toMatchObject({ gained: 0, blocked: 'bucket', capped: true });
        // en minut senare: +4
        expect(awardXp(p, 'rob', { career }, T0 + MIN)).toMatchObject({ gained: 4, capped: true });
        // Kontoret är en egen hink
        expect(awardXp(p, 'pitch', { career }, T0 + MIN).gained).toBe(6);
        // en ny spelare (omladdning) med samma karriär får ingen ny hink
        expect(awardXp(fresh(), 'loot', { career }, T0 + MIN).blocked).toBe('bucket');
        // efter två timmar: full igen, men aldrig mer än taket
        expect(bucketPeek(career.buckets.street, T0 + 2 * 60 * MIN, BUCKETS.street).v).toBe(120);
        let later = 0;
        for (let i = 0; i < 30; i++) later += awardXp(p, 'rob', { career }, T0 + 2 * 60 * MIN).gained;
        expect(later).toBe(120);
    });
    it('utan karriär hålls hinken per spelare i minnet', () => {
        const p = fresh();
        let total = 0;
        for (let i = 0; i < 50; i++) total += awardXp(p, 'loot', {}, T0).gained;
        expect(total).toBe(120);
    });
    it('bankrån och vinst har spärrar i realtid', () => {
        const career = createCareer(T0);
        const p = fresh();
        expect(awardXp(p, 'bank', { career }, T0).gained).toBe(220);   // 120 + första bankrånet 100
        expect(awardXp(p, 'bank', { career }, T0 + 5 * MIN)).toMatchObject({ gained: 0, blocked: 'cooldown' });
        expect(awardXp(p, 'bank', { career }, T0 + 10 * MIN).gained).toBe(120);
        expect(awardXp(p, 'winSolo', { career }, T0).gained).toBe(300);
        expect(awardXp(p, 'winOnline', { career }, T0 + 60 * MIN).blocked).toBe('cooldown');
        expect(awardXp(p, 'finish', { career }, T0 + 119 * MIN).blocked).toBe('cooldown');
        expect(awardXp(p, 'winOnline', { career }, T0 + 120 * MIN).gained).toBe(600);
    });
    it('mentorbonusen gäller rätt källor', () => {
        const career = createCareer(T0);
        const p = fresh();
        expect(awardXp(p, 'sell', { career, milestone: null, mentor: 1.5 }, T0).gained).toBe(8);
        expect(awardXp(p, 'sell', { career, mentor: 9 }, T0).gained).toBe(Math.round(5 * 1.75) + MILESTONES.firstSale);
        expect(awardXp(p, 'pvp', { career, amount: 40, mentor: 1.75, milestone: null }, T0).gained).toBe(40);
        expect(awardXp(p, 'sell', { career, mentor: false }, T0).gained).toBe(5);
        // hinken tar basen, mentorbonusen läggs på det man fick
        const c2 = createCareer(T0);
        c2.buckets.street = { v: 4, t: T0 };
        expect(awardXp(fresh(), 'rob', { career: c2, milestone: null, mentor: 1.5 }, T0)).toMatchObject({ base: 6, capped: true });
    });
    it('tom hink förbrukar inte once-nyckeln', () => {
        const career = createCareer(T0);
        career.buckets.office = { v: 0, t: T0 };
        const p = fresh();
        expect(awardXp(p, 'buyBiz', { career, amount: 10, once: 'buy:kebab', milestone: null }, T0)).toMatchObject({ gained: 0, blocked: 'bucket' });
        expect(p.xpOnce).toEqual([]);
        // en timme senare (full hink): samma köp ger XP, och först nu förbrukas nyckeln
        expect(awardXp(p, 'buyBiz', { career, amount: 10, once: 'buy:kebab', milestone: null }, T0 + 60 * MIN).gained).toBe(10);
        expect(p.xpOnce).toEqual(['buy:kebab']);
        expect(awardXp(p, 'buyBiz', { career, amount: 10, once: 'buy:kebab' }, T0 + 120 * MIN).blocked).toBe('once');
    });
    it('halvtom hink: delbelopp nu, hela beloppet senare', () => {
        const career = createCareer(T0);
        career.buckets.office = { v: 5, t: T0 };
        const p = fresh();
        expect(awardXp(p, 'stripclub', { career }, T0)).toMatchObject({ gained: 5, capped: true });
        expect(p.xpOnce).toEqual([]);
        expect(awardXp(p, 'stripclub', { career }, T0 + 60 * MIN).gained).toBe(60);
        expect(awardXp(p, 'stripclub', { career }, T0 + 120 * MIN).blocked).toBe('once');
    });
    it('once-nycklar kapas vid 40 tecken så att de överlever normalizeLevelFields', () => {
        const p = fresh();
        awardXp(p, 'opps', { career: createCareer(T0), once: 'x'.repeat(60) }, T0);
        expect(p.xpOnce).toEqual(['x'.repeat(40)]);
        expect(normalizeLevelFields(p).xpOnce).toEqual(['x'.repeat(40)]);
        expect(awardXp(p, 'opps', { career: createCareer(T0), once: 'x'.repeat(60) }, T0).blocked).toBe('once');
    });
    it('ärvda nyckelnamn ignoreras och XP minskar aldrig', () => {
        for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
            const career = createCareer(T0);
            const a = fresh({ xp: 5000 });
            expect(awardXp(a, 'opps', { career, milestone: bad }, T0)).toMatchObject({ gained: 25, bonus: 0, milestone: null });
            expect(a.xp).toBe(5025);
            const b = fresh({ xp: 5000 });
            expect(awardXp(b, 'opps', { career, bucket: bad }, T0).gained).toBe(25);
            expect(b.xp).toBe(5025);
            const c = fresh({ xp: 5000 });
            expect(awardXp(c, bad, { career }, T0)).toMatchObject({ gained: 0, blocked: 'unknown' });
            expect(c.xp).toBe(5000);
            expect(missionXp({ type: bad })).toBe(50);
            expect(respMilestoneXp(bad)).toBe(0);
        }
        for (const amount of [NaN, -1e9, 'x', {}, Infinity]) {
            const p = fresh({ xp: 5000 });
            expect(awardXp(p, 'opps', { career: createCareer(T0), amount }, T0).gained).toBeGreaterThanOrEqual(0);
            expect(p.xp).toBeGreaterThanOrEqual(5000);
        }
    });
    it('titelrespekten betalar respektstegen (imperiets väg)', () => {
        const p = fresh({ xp: XP_TOTAL[6] - 1 });
        p.respect.kebab = 27;
        const r = awardXp(p, 'pitch', { career: createCareer(T0), milestone: null }, T0);
        expect(p.respect.kebab).toBe(32);
        expect(r.respMilestones).toEqual([{ gang: 'kebab', step: 30, xp: 40 }]);
        expect(r.gained).toBe(6 + 40);
        expect(p.xpOnce).toContain('resp:kebab:30');
        expect(r.rewards.milestones).toEqual([{ gang: 'kebab', step: 30 }]);
        // steget betalas en gång per match: ett nytt titelband till 30+ ger inget nytt
        p.respect.kebab = 25;
        const again = awardXp(p, 'opps', { career: createCareer(T0), amount: XP_TOTAL[11] - p.xp }, T0);
        expect(again.to).toBe(11);
        expect(again.respMilestones).toEqual([]);
    });
    it('stadens väg (applyRespect: false) betalar inte stegen — det gör setRespect', () => {
        const p = fresh({ xp: XP_TOTAL[6] - 1 });
        p.respect.kebab = 27;
        const r = awardXp(p, 'rob', { career: createCareer(T0), milestone: null, applyRespect: false }, T0);
        expect(p.respect.kebab).toBe(27);
        expect(r.respMilestones).toEqual([]);
        expect(r.rewards.milestones).toEqual([{ gang: 'kebab', step: 30 }]);
        expect(p.xpOnce).toEqual([]);
    });
    it('steg-XP som ger en ny titel betalar även den titelns respekt', () => {
        // nivå 10 → 11 (Langare): +5 tar kebab 55 → 60 (steg 60, 60 XP) ...
        const p = fresh({ xp: XP_TOTAL[11] - 1 });
        p.respect.kebab = 55;
        const r = awardXp(p, 'opps', { career: createCareer(T0), amount: 1 }, T0);
        expect(r.respMilestones.map(m => m.step)).toEqual([60]);
        expect(r.to).toBe(levelOf(p.xp));
        expect(p.respect.kebab).toBe(60);
        // ... och när XP:n från stegen räcker till nästa titel läggs dess respekt också på
        const q = fresh({ xp: XP_TOTAL[6] - 1 });
        for (const id of GANG_IDS) q.respect[id] = 95;
        q.respect.kebab = 22;
        const r2 = awardXp(q, 'opps', { career: createCareer(T0), amount: 1, mentor: 1.75 }, T0);
        // Hangaround: fem gäng 95 → 100 (5 × 100 × 1,75 = 875 XP) räcker till Langare (nivå 11) ...
        expect(r2.ranks.map(x => x.id)).toEqual(['hangaround', 'langare']);
        expect(r2.to).toBe(11);
        // ... vars +5 tar kebab 27 → 32 och betalar steget 30 i andra varvet
        expect(q.respect.kebab).toBe(32);
        expect(r2.respMilestones.filter(m => m.step === 100)).toHaveLength(5);
        expect(r2.respMilestones.filter(m => m.gang === 'kebab')).toEqual([{ gang: 'kebab', step: 30, xp: 70 }]);
        expect(r2.gained).toBe(2 + 5 * 175 + 70);
        expect(r2.rewards.rep).toBe((11 - 5) + 2 * 5);
        expect(q.rep).toBe(r2.rewards.rep);
    });
    it('p.level räknas alltid om ur XP', () => {
        const p = fresh({ xp: XP_TOTAL[10], level: 99 });
        awardXp(p, 'opps', { career: createCareer(T0) }, T0);
        expect(p.level).toBe(10);
    });
    it('fungerar på en riktig spelare från state.js', () => {
        const p = createPlayerState('kimit');
        const r = awardXp(p, 'mission.steal', { career: createCareer(T0) }, T0);
        expect(r.gained).toBe(95);
        expect(p.xp).toBe(95);
        expect(p.level).toBe(2);
        expect(p.rep).toBe(1);
    });
});

describe('hinkar och spärrar', () => {
    it('bucketTake är ren och kapar vid taket', () => {
        const b = { v: 10, t: T0 };
        const r = bucketTake(b, 25, T0, BUCKETS.street);
        expect(r.got).toBe(10);
        expect(b).toEqual({ v: 10, t: T0 });
        expect(bucketTake(undefined, 500, T0, BUCKETS.office).got).toBe(200);
        expect(bucketTake({ v: 0, t: T0 }, 50, T0 + 10 * MIN, BUCKETS.street).got).toBe(40);
        expect(bucketTake({ v: 0, t: T0 }, 500, T0 + 999 * MIN, BUCKETS.street).got).toBe(120);
        expect(bucketTake({ v: 'x', t: T0 }, 5, T0, BUCKETS.street).got).toBe(5);
    });
    it('klockan bakåt fyller inte på', () => {
        const r = bucketTake({ v: 0, t: T0 }, 50, T0 - 60 * MIN, BUCKETS.street);
        expect(r.got).toBe(0);
        expect(r.b.t).toBe(T0);
    });
    it('cooldownOk stämplar när den godkänner, och flyttar en stämpel från framtiden', () => {
        const c = createCareer(T0);
        expect(cooldownOk(c, 'lastBankXp', COOLDOWNS.bank.ms, T0)).toBe(true);
        expect(c.lastBankXp).toBe(T0);
        expect(cooldownOk(c, 'lastBankXp', COOLDOWNS.bank.ms, T0 + MIN)).toBe(false);
        expect(c.lastBankXp).toBe(T0);   // vanlig nekning stämplar inte
        // klockan har gått bakåt en timme: nekas, och stämpeln flyttas till nu
        expect(cooldownOk(c, 'lastBankXp', COOLDOWNS.bank.ms, T0 - 60 * MIN)).toBe(false);
        expect(c.lastBankXp).toBe(T0 - 60 * MIN);
        // ... så spärren blir 10 min från den nya tiden, inte 70 min
        expect(cooldownOk(c, 'lastBankXp', COOLDOWNS.bank.ms, T0 - 51 * MIN)).toBe(false);
        expect(cooldownOk(c, 'lastBankXp', COOLDOWNS.bank.ms, T0 - 50 * MIN)).toBe(true);
        expect(cooldownOk(null, 'lastBankXp', 1, T0)).toBe(false);
    });
    it('pvpXpGate: samma par var 10:e minut, högst 6 i timmen', () => {
        const host = {};
        expect(pvpXpGate(host, 'a', 'b', 40, T0)).toBe(true);
        expect(pvpXpGate(host, 'a', 'b', 40, T0 + 5 * MIN)).toBe(false);
        expect(pvpXpGate(host, 'a', 'b', 40, T0 + 10 * MIN)).toBe(true);
        for (let i = 0; i < 4; i++) expect(pvpXpGate(host, 'a', `v${i}`, 40, T0 + 11 * MIN)).toBe(true);
        expect(pvpXpGate(host, 'a', 'v9', 40, T0 + 12 * MIN)).toBe(false);   // sjätte i timmen redan tagen
        expect(pvpXpGate(host, 'z', 'b', 40, T0 + 12 * MIN)).toBe(true);
        expect(pvpXpGate(host, 'a', 'v9', 40, T0 + 71 * MIN)).toBe(true);
    });
    it('pvpXpGate: kills som ger 0 XP stämplar ingenting', () => {
        const host = {};
        for (let i = 0; i < 6; i++) expect(pvpXpGate(host, 'a', `n${i}`, pvpXp(50, 1, true), T0 + i)).toBe(false);
        for (const bad of [0, -5, undefined, NaN, 'x']) expect(pvpXpGate(host, 'a', 'b', bad, T0)).toBe(false);
        expect(host.hour?.a).toBeUndefined();
        expect(Object.keys(host.pair || {})).toEqual([]);
        // timkvoten är orörd: en riktig kill direkt efter ger XP
        expect(pvpXpGate(host, 'a', 'real', pvpXp(50, 50), T0 + 100)).toBe(true);
    });
    it('pvpReward räknar pvpXp och grinden i ett anrop', () => {
        const host = {};
        for (let i = 0; i < 6; i++) expect(pvpReward(host, { killer: 'a', victim: `n${i}`, killerLevel: 50, victimLevel: 3, shielded: true }, T0 + i)).toBe(0);
        expect(pvpReward(host, { killer: 'a', victim: 'b', killerLevel: 20, victimLevel: 40 }, T0)).toBe(80);
        expect(pvpReward(host, { killer: 'a', victim: 'b', killerLevel: 20, victimLevel: 40 }, T0 + MIN)).toBe(0);   // samma par
        expect(pvpReward(host, { killer: 'a', victim: 'c', killerLevel: 60, victimLevel: 20 }, T0 + MIN)).toBe(0);   // 40 nivåer under
        expect(pvpReward(host, {}, T0)).toBe(40);
        expect(pvpReward(null, { killer: 'a', victim: 'b', killerLevel: 1, victimLevel: 1 }, T0)).toBe(0);
    });
    it('karriären normaliseras', () => {
        const c = normalizeCareer({ xp: '5000', milestones: ['firstRob', 'firstRob', 'hack', 7], buckets: { street: { v: 999, t: T0 }, office: 'x' }, lastBankXp: -4, migrated: 1 }, T0);
        expect(c.xp).toBe(5000);
        expect(c.milestones).toEqual(['firstRob']);
        expect(c.buckets.street.v).toBe(120);
        expect(c.buckets.office).toEqual({ v: 200, t: T0 });
        expect(c.lastBankXp).toBe(0);
        expect(c.migrated).toBe(true);
        expect(normalizeCareer(null, T0)).toEqual(createCareer(T0));
        expect(normalizeCareer({ milestones: ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'firstBank'] }, T0).milestones).toEqual(['firstBank']);
    });
});

describe('levelUpRewards', () => {
    it('gör ingenting utan nivå-upp', () => {
        const p = fresh();
        expect(levelUpRewards(p, 5, 5)).toEqual({ rep: 0, respect: {}, ranks: [], milestones: [] });
        expect(levelUpRewards(p, 9, 3).rep).toBe(0);
        expect(p.rep).toBe(0);
        expect(levelUpRewards(null, 1, 50).rep).toBe(0);
    });
    it('skapar respekt om den saknas', () => {
        const p = { xp: 0, rep: 0 };
        const r = levelUpRewards(p, 1, 11);
        expect(r.rep).toBe(10 + 10);
        for (const id of GANG_IDS) expect(p.respect[id]).toBe(10);
    });
    it('rapporterar respektstegen som titelrespekten passerar', () => {
        const p = fresh({ gang: 'kebab' });
        p.respect.kebab = 27; p.respect.taco = 58; p.respect.dods = 29;
        const r = levelUpRewards(p, 5, 6);
        expect(r.milestones).toEqual([{ gang: 'kebab', step: 30 }, { gang: 'taco', step: 60 }]);   // dods är rival
        const q = fresh(); q.respect.kebab = 27;
        expect(levelUpRewards(q, 5, 6, { applyRespect: false }).milestones).toEqual([{ gang: 'kebab', step: 30 }]);
        expect(q.respect.kebab).toBe(27);
    });
});

describe('normalizeLevelFields', () => {
    it('ger gamla sparfiler nivå 1', () => {
        const p = normalizeLevelFields(createPlayerState('kimit'));
        expect(p).toMatchObject({ xp: 0, level: 1, lvSeen: 1, xpOnce: [] });
    });
    it('klarar trasiga värden', () => {
        const cases = [['abc', 0], [-50, 0], [12.7, 12], ['500', 500], [Infinity, 0], [null, 0], [{}, 0], [1e12, XP_MAX]];
        for (const [xp, want] of cases) expect(normalizeLevelFields({ xp }).xp).toBe(want);
        expect(normalizeLevelFields({ xp: 1e12 }).level).toBe(100);
        expect(normalizeLevelFields({ xp: '500' }).level).toBe(7);
        expect(normalizeLevelFields({ xp: 0, level: 'hej' }).level).toBe(1);
    });
    it('lvSeen: saknas → nuvarande nivå, annars 1..100', () => {
        expect(normalizeLevelFields({ xp: XP_TOTAL[10] }).lvSeen).toBe(10);
        expect(normalizeLevelFields({ xp: XP_TOTAL[10], lvSeen: 'x' }).lvSeen).toBe(10);
        expect(normalizeLevelFields({ xp: 0, lvSeen: 500 }).lvSeen).toBe(100);
        expect(normalizeLevelFields({ xp: 0, lvSeen: 0 }).lvSeen).toBe(1);
        expect(normalizeLevelFields({ xp: 0, lvSeen: -3 }).lvSeen).toBe(1);
        expect(normalizeLevelFields({ xp: XP_TOTAL[20], lvSeen: 7 }).lvSeen).toBe(7);
    });
    it('städar xpOnce', () => {
        const p = normalizeLevelFields({ xp: 0, xpOnce: [1, null, 'ok', 'ok', 'x'.repeat(41), ''] });
        expect(p.xpOnce).toEqual(['ok']);
        const many = normalizeLevelFields({ xpOnce: Array.from({ length: 400 }, (_, i) => `k${i}`) });
        expect(many.xpOnce).toHaveLength(300);
        expect(many.xpOnce[299]).toBe('k399');
        expect(normalizeLevelFields({ xpOnce: 'buy:kebab' }).xpOnce).toEqual([]);
    });
    it('tål att få något annat än en spelare', () => {
        expect(normalizeLevelFields(null)).toBeNull();
        expect(normalizeLevelFields(undefined)).toBeUndefined();
        expect(normalizeLevelFields(5)).toBe(5);
    });
});

describe('nivåer som inte firats', () => {
    it('listar dem och markerar dem som sedda', () => {
        const p = { xp: XP_TOTAL[7], lvSeen: 5 };
        const u = unseenLevels(p);
        expect(u).toMatchObject({ from: 5, to: 7, rankUp: true });
        expect(u.ranks.map(r => r.id)).toEqual(['hangaround']);
        expect(u.unlocked.every(x => x.level === 6 || x.level === 7)).toBe(true);
        markLevelSeen(p);
        expect(p.lvSeen).toBe(7);
        expect(unseenLevels(p)).toBeNull();
        expect(unseenLevels(null)).toBeNull();
    });
});

describe('retroXp (gamla sparfiler)', () => {
    it('räknar på statistiken och ägda verksamheter', () => {
        const p = createPlayerState('kimit');
        Object.assign(p.cityStats, { missions: 2, fenced: 1, sold: 4, heists: 1, dates: 1, pvpWins: 1, robbed: 5 });
        p.owned = ['kebab', 'gym', 'finns-inte'];
        expect(retroXp(p)).toBe(120 + 18 + 20 + 15 + 35 + 40 + 20 + 10 + 12);
    });
    it('kapas vid nivå 30 så att ingen blir Gudfader direkt', () => {
        const p = createPlayerState('kimit');
        p.cityStats.missions = 100000;
        expect(retroXp(p)).toBe(XP_TOTAL[30]);
        expect(levelOf(retroXp(p))).toBe(30);
        expect(retroXp(null)).toBe(0);
        expect(retroXp({ cityStats: { missions: 'x' } })).toBe(0);
    });
});
