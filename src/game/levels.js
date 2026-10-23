// ═══════════════════════════════════════════
//  NIVÅER — från Springpojke (1) till Gudfadern (100)
//  Ren logik: ingen DOM, ingen lagring, inga sidoeffekter utöver
//  spelarobjektet och karriärobjektet som skickas in.
//  Hela designen: docs/levels.md
//  Ranktabellen (RANKS) kommer från masterprompt v3 avsnitt 6.
//
//  Grundregler:
//   • XP (p.xp) är sanningen. Nivå, titel och färg räknas alltid fram
//     ur XP. p.level är bara en cache som awardXp/normalizeLevelFields
//     skriver; läs nivån med levelOf(p.xp) eller playerLevel(p).
//   • Allt som kan spammas går genom en hink som fylls på i realtid
//     (Date.now, aldrig world.time).
//   • Nivån styr stan och imperiets sidosaker — aldrig Butikens
//     verksamheter. I PvP ger nivån högst ±10 % skada.
// ═══════════════════════════════════════════

import { GANGS, GANG_IDS, RESPECT_MIN, RESPECT_MAX } from '../city/constants.js';
import { SHOPS } from '../data/gameData.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// Bara egna nycklar: 'toString', 'constructor' och '__proto__' får aldrig slå igenom
const own = (o, k) => (typeof k === 'string' || typeof k === 'number') && Object.prototype.hasOwnProperty.call(o, k);
const MIN = 60000;
const HOUR = 3600000;

export const MAX_LEVEL = 100;
export const XP_MAX = 10000000;          // p.xp kapas här
export const LEGEND_STAR_XP = 25000;     // en kosmetisk Legend-stjärna per 25 000 XP över nivå 100
export const MAX_AWARD = 1000;           // största enskilda utdelning (före milstolpe) — skydd mot trasiga anrop
export const AI_TURN_XP = 120;           // AI-spelare: bara för att visa en nivå

// ── Titelband (masterprompt v3 avsnitt 6) ──
// Springpojke 1–5 och Gudfadern 100 ligger fast; banden däremellan är masterpromptens förslag.
// Emblemet är emoji + color: ett eget för varje rang. mask är rankbilden som etapp 1 ritar:
// name och desc beskriver den, base/accent är dess två färger (huvudmaterial och detalj).
// tier/style är den stigande visuella stilen från enkel gatustil till exklusiv boss (RANK_STYLES).
export const RANK_STYLES = Object.freeze({
    gata: Object.freeze({ tier: 1, label: 'Gatustil', desc: 'Rått tyg, matt och slitet. Inga metaller, inget som glänser.' }),
    hardingen: Object.freeze({ tier: 2, label: 'Hårding', desc: 'Skinn, stål, nitar och tejp. Första gången masken är något annat än tyg.' }),
    syndikat: Object.freeze({ tier: 3, label: 'Syndikat', desc: 'Skräddat och dyrt: siden, lack, krom och diskret kant. Inget onödigt.' }),
    exklusiv: Object.freeze({ tier: 4, label: 'Exklusiv', desc: 'Ornament, guld, sammet och ädelstenar. Gjord för en ensam man på toppen.' })
});

const R = (from, to, id, title, emoji, color, style, mask) =>
    ({ from, to, id, title, emoji, color, style, tier: RANK_STYLES[style].tier, mask: Object.freeze(mask) });
export const RANKS = Object.freeze([
    R(1, 5, 'springpojke', 'Springpojke', '🛴', '#9ca3af', 'gata', {
        name: 'Gråluvan', base: '#6b7280', accent: '#9ca3af',
        desc: 'Sliten grå stickad mössa neddragen över ögonbrynen, ansiktet bart. Matt tyg utan detaljer: ett bud som springer ärenden.'
    }),
    R(6, 10, 'smahustlare', 'Småhustlare', '🧢', '#a3e635', 'gata', {
        name: 'Bandanan', base: '#374151', accent: '#a3e635',
        desc: 'Rutig bandana uppdragen över näsa och mun, keps ovanpå. Ett enda färgstick i limegrönt; fortfarande bara tyg.'
    }),
    R(11, 20, 'hustlare', 'Hustlare', '💸', '#2dd4bf', 'gata', {
        name: 'Skimasken', base: '#111827', accent: '#2dd4bf',
        desc: 'Svart balaklava med smal ögonspringa och en tunn turkos list runt ögonen. Funktionell och skarp: jobbar på riktigt.'
    }),
    R(21, 30, 'fixare', 'Fixare', '🔧', '#38bdf8', 'hardingen', {
        name: 'Läderhalvmasken', base: '#1f2937', accent: '#38bdf8',
        desc: 'Svart halvmask i skinn över näsa och kinder, stålspänne vid örat och blå kantsöm. Den första masken som inte är av tyg.'
    }),
    R(31, 40, 'torped', 'Torped', '🥊', '#6366f1', 'hardingen', {
        name: 'Hockeymasken', base: '#e5e7eb', accent: '#6366f1',
        desc: 'Reporad vit målvaktsmask av plast med sprickor, mörka ögonhål och en indigoblå rand över pannan. Rå, slagen och skrämmande.'
    }),
    R(41, 50, 'veteran', 'Veteran', '🎖️', '#a855f7', 'hardingen', {
        name: 'Stålmasken', base: '#9ca3af', accent: '#a855f7',
        desc: 'Buckligt halvansikte i stål med nitar och ett gammalt ärr graverat över ena ögat, lila rem bakom nacken och en liten medalj vid kinden.'
    }),
    R(51, 60, 'kapten', 'Kapten', '🎩', '#ec4899', 'syndikat', {
        name: 'Sidenmasken', base: '#0f172a', accent: '#ec4899',
        desc: 'Svart sidendomino med smal rosa kantsöm och ett litet silvermärke vid tinningen, under en mörk filthatt. Första masken som ser skräddarsydd ut.'
    }),
    R(61, 70, 'underboss', 'Underboss', '🥃', '#f97316', 'syndikat', {
        name: 'Bärnstensdominon', base: '#1c1917', accent: '#f97316',
        desc: 'Matt svart läderdomino med kopparbeslag runt ögonen och en bärnstensorange brodyr längs kanten. Dyr men diskret.'
    }),
    R(71, 80, 'boss', 'Boss', '💼', '#ef4444', 'syndikat', {
        name: 'Lackmasken', base: '#111111', accent: '#ef4444',
        desc: 'Blank svart venetiansk halvmask i lack med kromkant och ett rött sidenband. Kall elegans: man ser att den kostade pengar.'
    }),
    R(81, 90, 'storboss', 'Storboss', '💎', '#e2e8f0', 'exklusiv', {
        name: 'Platinamasken', base: '#94a3b8', accent: '#f8fafc',
        desc: 'Helmask i polerad platina med silverfiligran och en liten diamant i pannan, sidenband och sammetskrage.'
    }),
    R(91, 99, 'don', 'Don', '🍷', '#be123c', 'exklusiv', {
        name: 'Bautan', base: '#f5f5f4', accent: '#be123c',
        desc: 'Klassisk elfenbensvit bauta med guldkant och vinröd sammet, under en svart trekantshatt med guldgalon.'
    }),
    R(100, 100, 'gudfadern', 'Gudfadern', '🌹', '#ffd23f', 'exklusiv', {
        name: 'Guldmasken', base: '#ffd23f', accent: '#b91c1c',
        desc: 'Helmask i blankpolerat guld med ögonspringor och en röd ros i pannan, sammetskappa med guldbroderi. Ingen annan mask i stan är av guld.'
    })
].map((r, index) => Object.freeze({ ...r, index })));

// Nivå från vad som helst (sträng, NaN, 0, 250 ...) → heltal 1..100
export function clampLevel(n) {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) ? clamp(v, 1, MAX_LEVEL) : 1;
}

// XP från vad som helst → heltal 0..XP_MAX
export function cleanXp(xp) {
    const v = Math.floor(Number(xp));
    return Number.isFinite(v) ? clamp(v, 0, XP_MAX) : 0;
}

export function rankOf(level) {
    const L = clampLevel(level);
    return RANKS.find(r => L >= r.from && L <= r.to) || RANKS[0];
}

export function rankIndex(level) { return rankOf(level).index; }

// Rankbilden på nivån: { name, desc, base, accent }
export function maskOf(level) { return rankOf(level).mask; }

// Titelband som börjar efter `from` och senast på `to` (de man befordras till)
export function ranksBetween(from, to) {
    const a = clampLevel(from), b = clampLevel(to);
    return RANKS.filter(r => r.from > a && r.from <= b);
}

// "🔧 23 Fixare"
export function levelBadge(level) {
    const L = clampLevel(level), r = rankOf(L);
    return `${r.emoji} ${L} ${r.title}`;
}

// ── XP-kurva ──
// need(L) = 5 · round((30 + 15·L + 0,0025·L³) / 5): XP från nivå L till L+1.
// 0,0025 (inte 0,004) så att en vanlig spelare (cirka 33 XP/min) når Don (nivå 91)
// på cirka 54 h och Gudfadern (nivå 100) på cirka 70 h. Se docs/levels.md avsnitt 2.
// Kurvan är komplett för alla 100 nivåer och strikt stigande: första steget är 45 XP,
// det sista (nivå 99 → 100) 3 940 XP.
export const XP_CUBIC = 0.0025;
function stepXp(L) { return 5 * Math.round((30 + 15 * L + XP_CUBIC * L ** 3) / 5); }

export function xpToNext(level) {
    const L = clampLevel(level);
    return L >= MAX_LEVEL ? 0 : stepXp(L);
}

// XP_TOTAL[L] = total XP för att nå nivå L (index 1..100, XP_TOTAL[1] = 0)
export const XP_TOTAL = Object.freeze((() => {
    const t = [0, 0];
    for (let L = 1; L < MAX_LEVEL; L++) t[L + 1] = t[L] + stepXp(L);
    return t;
})());

export function xpForLevel(level) { return XP_TOTAL[clampLevel(level)]; }

// Nivån som heltal (binärsökning): största L ≤ 100 där XP_TOTAL[L] ≤ xp
export function levelOf(xp) {
    const x = cleanXp(xp);
    let lo = 1, hi = MAX_LEVEL;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (XP_TOTAL[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return lo;
}

export function legendStars(xp) {
    const over = cleanXp(xp) - XP_TOTAL[MAX_LEVEL];
    return over >= 0 ? Math.floor(over / LEGEND_STAR_XP) : 0;
}

// Allt om en XP-summa: nivå, titel, färg och hur långt till nästa nivå
export function levelFromXp(xp) {
    const x = cleanXp(xp);
    const level = levelOf(x);
    const rank = rankOf(level);
    const maxed = level >= MAX_LEVEL;
    const xpNeeded = xpToNext(level);
    const xpInto = x - XP_TOTAL[level];
    return {
        xp: x, level, rank, rankIndex: rank.index,
        title: rank.title, emoji: rank.emoji, color: rank.color,
        xpInto, xpNeeded, xpLeft: maxed ? 0 : xpNeeded - xpInto,
        progress: maxed ? 1 : xpInto / xpNeeded,
        maxed, legendStars: legendStars(x)
    };
}
export const progress = levelFromXp;

// Nivån för en spelare (eller ett tal). Läser alltid XP, aldrig p.level.
export function playerLevel(who) {
    if (typeof who === 'number' || typeof who === 'string') return clampLevel(who);
    if (who && typeof who === 'object') return levelOf(who.xp);
    return 1;
}

// ── Upplåsningar ──
// status: befintligt (finns, får en spärr) · nytt (måste byggas) · bonus (en siffra ändras) · kosmetiskt
// race: ger pengar i racet till 1 miljon. När minst två människor spelar räknas
// de på raceLevel (min(egen nivå, rummets lägsta + RACE_GAP)), se raceLevel nedan.
const RACE_KINDS = new Set(['mission', 'crime', 'market', 'deal', 'car', 'pimp', 'cap', 'prop']);
const RACE_IDS = new Set(['perk:paytier', 'perk:kapo', 'perk:turfprice', 'perk:lawyer']);
const U = (level, id, kind, label, status = 'befintligt', fas = 1) =>
    Object.freeze({ id, level, kind, label, status, fas, race: RACE_KINDS.has(kind) || RACE_IDS.has(id) });
export const UNLOCKS = Object.freeze([
    U(2, 'weapon:bat', 'weapon', 'Basebollträ hos Pang-Pelle'),
    U(2, 'car:moped', 'car', 'Moped EPA i garaget'),
    U(3, 'mission:steal', 'mission', 'Uppdraget Bilstöld'),
    U(3, 'fence', 'crime', 'Skroten: sälj snodda bilar'),
    U(4, 'svc:look', 'service', 'Ny frisyr (−2 stjärnor) hos Frisören'),
    U(5, 'mission:escape', 'mission', 'Uppdraget Fly från snuten'),
    U(5, 'bm:smuggle', 'market', 'Svarta marknaden: Smuggelgods'),
    U(6, 'weapon:pistol', 'weapon', 'Pistol hos Pang-Pelle'),
    U(6, 'gang:join', 'gang', 'Gå med i ett gäng (kräver +30 respekt)'),
    U(6, 'svc:train', 'service', 'Träna på gymmet'),
    U(6, 'car:bmw', 'car', 'BMW E46'),
    U(7, 'armor', 'gear', 'Skyddsväst hos Pang-Pelle'),
    U(7, 'deal:launder', 'deal', 'Telefondeal: Tvätta pengar'),
    U(8, 'crew:slot1', 'crew', 'Crewplats 1 (Livvakt eller Spanare)'),
    U(8, 'pimp:2', 'pimp', 'Pimp-steg 2'),
    U(9, 'mission:smash', 'mission', 'Uppdraget Krossa rivalerna'),
    U(9, 'bm:counterfeit', 'market', 'Svarta marknaden: Falska sedlar'),
    U(10, 'date', 'activity', 'Dejter vid Nattklubben'),
    U(10, 'svc:track', 'service', 'Spela in en disslåt i studion'),
    U(10, 'perk:crit', 'perk', 'Kritiska träffar mot NPC:er (1–10 %)', 'bonus'),
    U(11, 'rob:shop', 'crime', 'Butiksrån: töm kassan hos andra'),
    U(12, 'house:house-orten', 'house', 'Gömstället Lägenheten i Orten'),
    U(12, 'car:mercedes', 'car', 'Mercedes AMG'),
    U(12, 'deal:bribe', 'deal', 'Telefondeal: Muta inspektören'),
    U(13, 'svc:vip', 'service', 'VIP-bord på Nattklubben'),
    U(13, 'bm:crypto_scam', 'market', 'Svarta marknaden: Shady Crypto-deal'),
    U(14, 'crew:slot2', 'crew', 'Crewplats 2'),
    U(14, 'house:house-hamnen', 'house', 'Gömstället Sjöboden i Hamnen'),
    U(15, 'cap:missions4', 'cap', '4 uppdrag per runda', 'bonus'),
    U(16, 'weapon:uzi', 'weapon', 'Uzi hos Pang-Pelle'),
    U(16, 'house:house-industrin', 'house', 'Gömstället Loftet i Industrin'),
    U(16, 'pimp:3', 'pimp', 'Pimp-steg 3'),
    U(17, 'bm:hack', 'market', 'Svarta marknaden: Hacka konkurrenten'),
    U(18, 'crew:gunner', 'crew', 'Skytt-rollen hos Rekryteraren'),
    U(18, 'house:house-vasterort', 'house', 'Gömstället Radhuset i Västerort'),
    U(20, 'rob:bank', 'crime', 'Bankrån (kräver laddat skjutvapen)'),
    U(20, 'svc:hack', 'service', 'Hacka polisens register'),
    U(20, 'car:lambo', 'car', 'Lamborghini'),
    U(21, 'bm:insider', 'market', 'Svarta marknaden: Insider-tips'),
    U(22, 'crew:slot3', 'crew', 'Crewplats 3'),
    U(22, 'house:house-skogsbacken', 'house', 'Gömstället Villan i Skogsbacken'),
    U(23, 'weapon:shotgun', 'weapon', 'Hagelgevär hos Pang-Pelle'),
    U(25, 'house:house-centrum', 'house', 'Gömstället Takvåningen i Centrum'),
    U(25, 'perk:discount10', 'perk', 'Pang-Pelle −10 % på vapen, ammo och väst', 'bonus'),
    U(26, 'mission:collect', 'mission', 'Uppdraget Indrivning', 'nytt', 2),
    U(28, 'prop:stripclub', 'prop', 'Club Diamant går att köpa'),
    U(28, 'crew:bouncer', 'crew', 'Anställ Stora Sven'),
    U(28, 'car:rolls', 'car', 'Rolls Royce'),
    U(30, 'crew:slot4', 'crew', 'Crewplats 4 (max)'),
    U(31, 'perk:torpedo', 'perk', 'Torpedslaget: slagen knuffar 25 % längre', 'bonus'),
    U(31, 'perk:backup', 'perk', 'Ring backup: två från gänget slåss för dig i 60 s', 'nytt'),
    U(33, 'cap:fence4', 'cap', 'Skrota 4 bilar per runda', 'bonus'),
    U(35, 'cap:goods15', 'cap', 'Langa 15 varor per runda', 'bonus'),
    U(35, 'perk:bribecop', 'perk', 'Muta snuten: −1 stjärna för 1 000 kr', 'nytt'),
    U(38, 'perk:discount20', 'perk', 'Pang-Pelle −20 %', 'bonus'),
    U(40, 'cap:missions5', 'cap', '5 uppdrag per runda', 'bonus'),
    U(41, 'crew:veteran', 'crew', 'Veteraner hos Rekryteraren (+20 % hälsa och skada mot NPC:er)', 'nytt'),
    U(41, 'perk:paytier', 'perk', 'Respekt ≥ 80 ger ×1,45 i uppdragslön', 'bonus'),
    U(44, 'perk:backup2', 'perk', 'Ring backup två gånger per runda', 'bonus'),
    U(45, 'cosm:goldguns', 'cosmetic', 'Guldpistol och kromad uzi', 'kosmetiskt', 2),
    U(48, 'perk:armoredride', 'perk', 'Bepansrad gängbil vid HQ (+50 % hp)', 'bonus'),
    U(51, 'perk:kapo', 'perk', 'Kapo-jobbet: dubbel lön och dubbel XP', 'nytt'),
    U(55, 'perk:fastrecover', 'perk', 'Crewet reser sig efter 12 s', 'bonus'),
    U(58, 'perk:doctor', 'perk', 'Doktorn tar halva priset', 'bonus'),
    U(60, 'cap:goods20', 'cap', 'Langa 20 varor per runda', 'bonus'),
    U(61, 'perk:turfprice', 'perk', '+20 % pris på ditt gängs turf', 'bonus'),
    U(63, 'perk:lawyer', 'perk', 'Advokaten: kortare häkte och halva böter', 'bonus'),
    U(63, 'perk:nofailloss', 'perk', 'Misslyckade jobb kostar ingen respekt', 'bonus'),
    U(65, 'crew:elite', 'crew', 'Elitrekryter (+40 % hälsa och skada mot NPC:er)', 'nytt'),
    U(68, 'perk:heat', 'perk', 'Snuten tappar spåret 25 % snabbare', 'bonus'),
    U(71, 'perk:chauffeur', 'perk', 'Privatchaufför: gratis taxi, även med 1 stjärna', 'bonus'),
    U(73, 'perk:crewheal', 'perk', 'Crewet reser sig efter 8 s', 'bonus'),
    U(75, 'perk:family', 'perk', 'Familjens skydd: gängrespekten går aldrig under +50', 'bonus'),
    U(78, 'cap:missions6', 'cap', '6 uppdrag per runda', 'bonus'),
    U(81, 'perk:legend', 'perk', 'Gatans legend: vanligt folk slåss aldrig emot', 'bonus'),
    U(85, 'perk:bribecop2', 'perk', 'Muta snuten: 500 kr per stjärna, två gånger per runda', 'bonus'),
    U(88, 'perk:discount30', 'perk', 'Pang-Pelle −30 %', 'bonus'),
    U(90, 'cap:goods25', 'cap', 'Langa 25 varor per runda', 'bonus'),
    U(91, 'perk:doctorfree', 'perk', 'Doktorn lappar ihop dig gratis', 'bonus'),
    U(95, 'cap:fence5', 'cap', 'Skrota 5 bilar per runda', 'bonus'),
    U(95, 'cosm:statue', 'cosmetic', 'Staty av dig vid HQ', 'kosmetiskt', 2),
    U(97, 'perk:heat2', 'perk', 'Snuten tappar spåret dubbelt så snabbt', 'bonus'),
    U(100, 'perk:offer', 'perk', 'Ett erbjudande: alla gängbossar svarar, även rivalen', 'nytt'),
    U(100, 'cosm:goldname', 'cosmetic', 'Guldnamn och krona i stan och listorna', 'nytt'),
    U(100, 'perk:godcar', 'perk', 'Gudfaderns svarta Rolls vid HQ', 'nytt'),
    U(100, 'cosm:godstar', 'cosmetic', 'Gudfader-stjärna i namnskylten och Legend-stjärnor', 'kosmetiskt'),
    U(100, 'cosm:rose', 'cosmetic', 'Rosen på kavajen och gyllene basebollträ', 'kosmetiskt', 2),
    U(100, 'prestige', 'prestige', 'Guldaura och valfri Prestige', 'nytt', 2)
]);
const UNLOCK_BY_ID = new Map(UNLOCKS.map(u => [u.id, u]));

// Fasen som är byggd. Poster med högre fas visas som "Kommer snart", aldrig som "Upplåst".
export const ACTIVE_FAS = 1;
export function isActiveUnlock(u) { return !!u && u.fas <= ACTIVE_FAS; }

export function getUnlock(id) { return UNLOCK_BY_ID.get(id) || null; }

// Nivån som krävs; 1 för allt som inte står i listan (nävar, cykel, kebabtallrik ...)
export function requiredLevel(id) { return UNLOCK_BY_ID.get(id)?.level ?? 1; }
export const unlockLevel = requiredLevel;

// ── Racet till 1 miljon ──
// När minst två människor spelar (online eller hotseat) räknas allt som ger pengar
// (race: true, missionCap, goodsCap, fenceCap, respectPayMult, Kapo, turfpris, advokaten)
// på min(egen nivå, rummets lägsta mänskliga nivå + RACE_GAP). Då kan en veteran
// aldrig tjäna mer än en spelare tio nivåer över nybörjaren. Solo: egen nivå.
export const RACE_GAP = 10;
export function raceLevel(level, roomMin = null) {
    const L = clampLevel(level);
    if (roomMin === null || roomMin === undefined || roomMin === '' || !Number.isFinite(Number(roomMin))) return L;
    return Math.min(L, clampLevel(roomMin) + RACE_GAP);
}
// Rummets lägsta mänskliga nivå, eller null när färre än två människor spelar
export function roomMinLevel(players) {
    const humans = (Array.isArray(players) ? players : []).filter(p => p && typeof p === 'object' && !p.isAI);
    if (humans.length < 2) return null;
    return Math.min(...humans.map(p => levelOf(p.xp)));
}

// who: spelare (läser p.xp) eller nivå. AI-spelare spärras aldrig.
// opts.roomMin: rummets lägsta nivå (roomMinLevel) — gäller bara poster med race: true.
export function isUnlocked(who, id, { roomMin = null } = {}) {
    if (who && typeof who === 'object' && who.isAI) return true;
    const L = playerLevel(who);
    return (getUnlock(id)?.race ? raceLevel(L, roomMin) : L) >= requiredLevel(id);
}

// opts.all = true tar med poster från fas som inte är byggd än
const phase = (list, all) => (all ? list : list.filter(isActiveUnlock));

export function unlocksAt(level, { all = false } = {}) {
    const L = clampLevel(level);
    return phase(UNLOCKS.filter(u => u.level === L), all);
}

// Allt som låses upp efter `from` och senast på `to`
export function unlocksBetween(from, to, { all = false } = {}) {
    const a = clampLevel(from), b = clampLevel(to);
    return phase(UNLOCKS.filter(u => u.level > a && u.level <= b), all);
}

export function nextUnlocks(level, n = 3, { all = false } = {}) {
    const L = clampLevel(level);
    return phase(UNLOCKS.filter(u => u.level > L), all).slice(0, Math.max(0, n));
}

// Poster som inte är byggda än ("Kommer snart")
export function comingSoon() { return UNLOCKS.filter(u => !isActiveUnlock(u)); }

// "🔒 Nivå 16 · Hustlare"
export function lockLabel(id) {
    const L = requiredLevel(id);
    return `🔒 Nivå ${L} · ${rankOf(L).title}`;
}

// Allt låst-UI:t behöver: { locked, need, rank, label, left, hint, roomCapped }
// roomCapped: egen nivå räcker, men rummets gräns (raceLevel) gör det inte.
export function lockInfo(who, id, { roomMin = null } = {}) {
    const L = playerLevel(who), need = requiredLevel(id);
    const locked = !isUnlocked(who, id, { roomMin });
    const left = Math.max(0, need - L);
    const roomCapped = locked && left === 0;
    const cap = raceLevel(L, roomMin);
    return {
        locked, need, rank: rankOf(need), label: lockLabel(id), left, roomCapped,
        hint: !locked ? ''
            : roomCapped ? `rummets gräns: Nv ${cap} (lägsta spelaren + ${RACE_GAP})`
                : `du: Nv ${L} · ${left} ${left === 1 ? 'nivå' : 'nivåer'} kvar`
    };
}

// ── Gränser per runda och crew ──
// Gränserna för pengar (missionCap, goodsCap, fenceCap) tar raceLevel(L, roomMin) när fler än en människa spelar.
export function missionCap(level, base = 3) {
    const L = clampLevel(level);
    return base + (L >= 15 ? 1 : 0) + (L >= 40 ? 1 : 0) + (L >= 78 ? 1 : 0);
}
export function goodsCap(level) { const L = clampLevel(level); return L >= 90 ? 25 : L >= 60 ? 20 : L >= 35 ? 15 : 10; }
export function fenceCap(level) { const L = clampLevel(level); return L >= 95 ? 5 : L >= 33 ? 4 : 3; }
export function crewMax(level) {
    const L = clampLevel(level);
    return L >= 30 ? 4 : L >= 22 ? 3 : L >= 14 ? 2 : L >= 8 ? 1 : 0;
}
export function crewRecover(level) { const L = clampLevel(level); return L >= 73 ? 8 : L >= 55 ? 12 : 25; }
export function gunDiscount(level) { const L = clampLevel(level); return L >= 88 ? 0.7 : L >= 38 ? 0.8 : L >= 25 ? 0.9 : 1; }
// Ring backup (nivå 31) och muta snuten (nivå 35): gånger per runda och pris per stjärna
export function backupPerRound(level) { const L = clampLevel(level); return L >= 44 ? 2 : L >= 31 ? 1 : 0; }
export function bribeCops(level) {
    const L = clampLevel(level);
    return L >= 85 ? { perRound: 2, perStar: 500 } : L >= 35 ? { perRound: 1, perStar: 1000 } : { perRound: 0, perStar: 1000 };
}
// Doktorns pris gånger det här (0 = gratis)
export function doctorMult(level) { const L = clampLevel(level); return L >= 91 ? 0 : L >= 58 ? 0.5 : 1; }
// Tiden utom synhåll innan snuten tappar spåret (wanted.js LOST_AFTER) gånger det här
export function lostTrackMult(level) { const L = clampLevel(level); return L >= 97 ? 0.5 : L >= 68 ? 0.75 : 1; }

// ── Skada ──
export const DMG_MULT_MAX = 1.5;
export const CRIT_MULT = 1.5;
export const CRIT_FROM = 10;
export const NEWBIE_SHIELD = 0.5;          // skademultiplikator när nybörjarskyddet gäller
export const PVP_LEVEL_SPREAD = 20;        // nivåskillnaden räknas högst ±20 i PvP

// Mot NPC:er: +0 % på nivå 1, +25 % på 51, +49,5 % på 100
export function dmgMult(level) { return Math.min(DMG_MULT_MAX, 1 + 0.005 * (clampLevel(level) - 1)); }
export const damageMultiplier = dmgMult;

export function critChance(level) { const L = clampLevel(level); return L >= CRIT_FROM ? L / 1000 : 0; }

// Skada mot en NPC: bas (vapen + styrka·3) · dmgMult, ibland kritisk. Aldrig i PvP.
export function npcDamage(base, level, rnd = Math.random) {
    const b = Math.max(0, Number(base) || 0);
    const crit = critChance(level) > 0 && rnd() < critChance(level);
    return { dmg: b * dmgMult(level) * (crit ? CRIT_MULT : 1), crit };
}

// Närstridens bas: slumpskadan + styrka·3 (styrka 0–5)
export function meleeBase(roll, strength = 0) {
    return Math.max(0, Number(roll) || 0) + clamp(Math.floor(Number(strength) || 0), 0, 5) * 3;
}

export function crewDmgMult(level) { return Math.min(1.25, 1 + 0.0025 * (clampLevel(level) - 1)); }
export function knockMult(level) { return clampLevel(level) >= 31 ? 1.25 : 1; }   // Torpedslaget (Torped-bandet): 160 → 200 px/s

// Veteraner (nivå 41) och elit (nivå 65) hos Rekryteraren. Faktorn gäller BARA mot NPC:er:
// crewmedlemmen sparar sin basskada och bashälsa och sin klass (tier). I PvP skickas alltid
// basskadan, och träffar från andra spelare dras av rakt — annars gick klassen förbi ±10 %.
export const CREW_TIERS = Object.freeze({
    veteran: Object.freeze({ id: 'veteran', unlock: 'crew:veteran', mult: 1.2, cost: 1.5, prefix: 'Veteran' }),
    elite: Object.freeze({ id: 'elite', unlock: 'crew:elite', mult: 1.4, cost: 2, prefix: 'Elit' })
});
// Den bästa klassen Rekryteraren erbjuder på nivån, eller null
export function crewTier(level) {
    const L = clampLevel(level);
    if (L >= requiredLevel('crew:elite')) return CREW_TIERS.elite;
    if (L >= requiredLevel('crew:veteran')) return CREW_TIERS.veteran;
    return null;
}
export function crewTierMult(tierId) { return own(CREW_TIERS, tierId) ? CREW_TIERS[tierId].mult : 1; }
// Crewets skada mot en NPC: bas · crewDmgMult(L) · klass
export function crewNpcDamage(base, level, tierId = null) {
    return Math.max(0, Number(base) || 0) * crewDmgMult(level) * crewTierMult(tierId);
}
// Skada som en NPC gör på crewet delas med klassen (motsvarar mer hälsa, men bara mot NPC:er)
export function crewNpcHurt(dmg, tierId = null) { return Math.max(0, Number(dmg) || 0) / crewTierMult(tierId); }

// PvP: 0,90–1,10
export function pvpMult(attackerLevel, targetLevel) {
    const d = clamp(clampLevel(attackerLevel) - clampLevel(targetLevel), -PVP_LEVEL_SPREAD, PVP_LEVEL_SPREAD);
    return 1 + 0.005 * d;
}

// Nybörjarskydd: målet på nivå ≤ 15 (Springpojke, Småhustlare och första halvan av Hustlare, innan uzin på 16) och anfallaren
// minst 10 nivåer över. aggro = nybörjaren slog själv anfallaren de senaste 30 s.
export const NEWBIE_MAX_LEVEL = 15;
export const NEWBIE_GAP = 10;
export function newbieShield(attackerLevel, targetLevel, aggro = false) {
    const a = clampLevel(attackerLevel), t = clampLevel(targetLevel);
    return !aggro && t <= NEWBIE_MAX_LEVEL && a - t >= NEWBIE_GAP;
}

// Värdens PvP-skada: taket läggs FÖRE nivåmultiplikatorn
export function pvpDamage(base, max, attackerLevel, targetLevel, { aggro = false } = {}) {
    const b = Math.max(0, Number(base) || 0);
    const cap = Number.isFinite(Number(max)) ? Math.max(0, Number(max)) : b;
    const shield = newbieShield(attackerLevel, targetLevel, aggro) ? NEWBIE_SHIELD : 1;
    return Math.min(cap, b) * pvpMult(attackerLevel, targetLevel) * shield;
}

// Motvikt så att gatan aldrig blir trivial: fler opps och fler skyttar.
// Opps-hälsan skalas INTE (35), annars åt den upp dmgMult och skadan märktes aldrig.
export function oppsCount(level) { return Math.min(7, 4 + Math.floor(clampLevel(level) / 30)); }
export function oppsArmed(level, hasGun) {
    return Math.min(oppsCount(level), (hasGun ? 2 : 0) + Math.floor(clampLevel(level) / 40));
}
// Snutar till fots: 40 → 47 hp (hälften så brant som skadan)
export function copHpMult(level) { return 1 + clampLevel(level) / 600; }

// Det som växer med varje nivå, för Karriär-kortet och nivå-upp-rutan (procent)
export function levelStats(level) {
    const L = clampLevel(level);
    return {
        level: L,
        dmgPct: Math.round((dmgMult(L) - 1) * 1000) / 10,
        critPct: Math.round(critChance(L) * 1000) / 10,
        respPct: Math.round((respGain(L) - 1) * 100),
        fearPct: Math.round((1 - fearMult(L)) * 100)
    };
}

// ── Respekt ──
export const TITLE_RESPECT = 5;            // vid varje ny titel, hos alla gäng som inte är rival till ditt
export const REP_PER_LEVEL = 1;            // p.rep (⭐) per nivå
export const REP_PER_RANK = 5;             // p.rep extra per ny titel
export const RESP_MILESTONES = Object.freeze([30, 60, 100]);

export function respGain(level) { return 1 + (clampLevel(level) - 1) / 100; }
export const respectMultiplier = respGain;

// Positiva ändringar skalas (minst +1), förluster är oförändrade
export function scaleRespectDelta(delta, level) {
    const d = Number(delta);
    if (!Number.isFinite(d)) return 0;
    if (d <= 0) return d;
    return Math.max(1, Math.round(d * respGain(level)));
}

// Respekten ett misslyckat jobb kostar: inget från nivå 63
export function failRespect(level, base = -5) { return clampLevel(level) >= 63 ? 0 : base; }

// Ett nytt spel startar med floor(L/5) hos alla gäng
export function startRespect(level) { return Math.floor(clampLevel(level) / 5); }

// Familjens skydd (nivå 75): det egna gängets respekt går aldrig under +50
export function respectFloor(level, ownGang = false) {
    return ownGang && clampLevel(level) >= 75 ? 50 : RESPECT_MIN;
}

// Uppdragslönens respektsteg: ×1,15 vid 20, ×1,3 vid 50 och ×1,45 vid 80 från nivå 41
export function respectPayMult(respect, level = 1) {
    const r = Number(respect) || 0;
    if (r >= 80 && clampLevel(level) >= 41) return 1.45;
    return r >= 50 ? 1.3 : r >= 20 ? 1.15 : 1;
}

// Respektstegen (30/60/100) som passerades uppåt mellan två värden
export function respectMilestones(before, after) {
    const a = Number(before) || 0, b = Number(after) || 0;
    return RESP_MILESTONES.filter(s => a < s && b >= s);
}

// Gaturespekt: folk fruktar dig
export function fearMult(level) { return 1 - (clampLevel(level) - 1) / 250; }

// Vanligt folk: civila och metro som inte är snut, tuffing eller rånare.
// Snutar, tuffingar och rånare har också ped.type === 'civ' i ai.js, så typen räcker inte.
export function isOrdinaryPed(ped) {
    if (!ped || typeof ped !== 'object') return false;
    if (ped.cop || ped.tough || ped.mugger || ped.wasMugger || ped.gang) return false;
    return ped.type === 'civ' || ped.type === 'metro';
}

// Chansen att någon slåss emot vid rån: bas · fearMult. Gatans legend (nivå 81):
// vanligt folk (isOrdinaryPed) slåss aldrig. Ta peden, inte bara typen.
export function robFightChance(base, level, ped = null) {
    const b = clamp(Number(base) || 0, 0, 1);
    if (clampLevel(level) >= requiredLevel('perk:legend') && isOrdinaryPed(ped)) return 0;
    return b * fearMult(level);
}

export function shopRobKickChance(level) { return 0.5 * fearMult(level); }

// Sekunder till nästa rånare på natten (r = slumptal 0–1)
export function muggerInterval(level, r = Math.random()) { return 80 + clamp(Number(r) || 0, 0, 1) * 60 + 0.6 * clampLevel(level); }

// ── XP-tabellen ──
export const XP = Object.freeze({
    mission: Object.freeze({ delivery: 50, vip: 55, steal: 65, smash: 70, escape: 75, collect: 70 }),
    sell: 5, sellRival: 8, fence: 15, fenceRich: 5, bank: 120, opps: 25, date: 35, brawlWin: 20,
    escapeJail: 75, join: 100, respMilestone: Object.freeze({ 30: 40, 60: 60, 100: 100 }),
    rob: 6, loot: 3, ko: Object.freeze({ civ: 2, metro: 2, tough: 4, gang: 5, opps: 5, cop: 6, mugger: 15 }),
    wreck: 2, wreckCop: 5, chasePerStar: 8, brawlKo: Object.freeze({ guest: 3, guard: 8 }),
    pitch: 6, market: 8, phoneDeal: 5, pimp: 5, collect: 4, roundBonus: 10,
    service: Object.freeze({ train: 20, track: 15, vip: 10, nightvip: 10 }),
    firstWeapon: 10, recruit: 15, house: 20, stripclub: 60,
    winSolo: 300, winOnline: 600, finish: 100, pvp: 40
});

// Engångs per karriär (aldrig igen, inte ens i ett nytt spel). Ingen hink, ingen mentorbonus.
export const MILESTONES = Object.freeze({
    firstMission: 30, firstSale: 10, firstRob: 10, firstFence: 20, firstBiz: 20,
    firstWeapon: 10, firstCrew: 30, firstDate: 30, firstGang: 50, firstBank: 100, firstPvp: 50
});

// Hinkar mot farmning: fylls på i realtid
export const BUCKETS = Object.freeze({
    street: Object.freeze({ cap: 120, perMin: 4 }),   // Gatukassan: småbrott i stan
    office: Object.freeze({ cap: 200, perMin: 4 })    // Kontoret: klick i imperiet och köp
});

// Spärrar i realtid (fältet ligger i karriären)
export const COOLDOWNS = Object.freeze({
    bank: Object.freeze({ field: 'lastBankXp', ms: 10 * MIN }),
    win: Object.freeze({ field: 'lastWinXp', ms: 2 * HOUR })
});

// Alla XP-källor. xp är standardvärdet; källor med variabel XP tar opts.amount
// (räkna med missionXp, bizXp, carXp ...).
//  bucket: 'street' | 'office' | null   mentor: om mentorbonusen gäller
//  milestone: karriärmilstolpe som ges första gången   once: nyckel per match
//  cooldown: spärr i realtid (COOLDOWNS)
const src = (xp, bucket, label, extra = {}) => Object.freeze({ xp, bucket, label, mentor: true, milestone: null, once: null, cooldown: null, ...extra });
export const XP_SOURCES = Object.freeze({
    // Stan — tar riktig tid, ingen hink
    'mission.delivery': src(50, null, 'Leverans', { milestone: 'firstMission' }),
    'mission.vip': src(55, null, 'VIP-skjuts', { milestone: 'firstMission' }),
    'mission.steal': src(65, null, 'Bilstöld', { milestone: 'firstMission' }),
    'mission.smash': src(70, null, 'Krossa rivalerna', { milestone: 'firstMission' }),
    'mission.escape': src(75, null, 'Fly från snuten', { milestone: 'firstMission' }),
    'mission.collect': src(70, null, 'Indrivning', { milestone: 'firstMission' }),
    sell: src(5, null, 'Langning', { milestone: 'firstSale' }),
    sellRival: src(8, null, 'Langning på rivalens turf', { milestone: 'firstSale' }),
    fence: src(15, null, 'Skrotad bil', { milestone: 'firstFence' }),
    shopRob: src(12, null, 'Butiksrån'),
    bank: src(120, null, 'Bankrån', { milestone: 'firstBank', cooldown: COOLDOWNS.bank }),
    opps: src(25, null, 'Höll stånd mot opps'),
    date: src(35, null, 'Lyckad dejt', { milestone: 'firstDate' }),
    brawlWin: src(20, null, 'Vann barbråket'),
    escapeJail: src(75, null, 'Rymde från Kåken'),
    pvp: src(40, null, 'PvP-seger', { mentor: false, milestone: 'firstPvp' }),
    join: src(100, null, 'Gick med i ett gäng', { milestone: 'firstGang', once: 'join' }),
    respMilestone: src(40, null, 'Respekt-milstolpe'),
    // Gatukassan
    rob: src(6, 'street', 'Rån', { milestone: 'firstRob' }),
    loot: src(3, 'street', 'Länsade'),
    'ko.civ': src(2, 'street', 'Knockout'),
    'ko.metro': src(2, 'street', 'Knockout'),
    'ko.tough': src(4, 'street', 'Knockout'),
    'ko.gang': src(5, 'street', 'Knockout'),
    'ko.opps': src(5, 'street', 'Knockout'),
    'ko.cop': src(6, 'street', 'Snut nere'),
    'ko.mugger': src(15, 'street', 'Rånaren nere'),
    wreck: src(2, 'street', 'Kvaddad bil'),
    wreckCop: src(5, 'street', 'Kvaddad snutbil'),
    chase: src(16, 'street', 'Skakade av snuten'),
    'brawlKo.guest': src(3, 'street', 'Utslängd gäst'),
    'brawlKo.guard': src(8, 'street', 'Vakten nere'),
    // Kontoret
    buyBiz: src(10, 'office', 'Ny verksamhet', { milestone: 'firstBiz' }),
    upgrade: src(5, 'office', 'Uppgradering'),
    pitch: src(6, 'office', 'Lyckad pitch'),
    market: src(8, 'office', 'Svarta marknaden'),
    phoneDeal: src(5, 'office', 'Telefondeal'),
    buyCar: src(10, 'office', 'Ny bil'),
    pimp: src(5, 'office', 'Pimpad bil'),
    collect: src(4, 'office', 'Tömde kassan'),
    'service.train': src(20, 'office', 'Träning'),
    'service.track': src(15, 'office', 'Disslåt'),
    'service.vip': src(10, 'office', 'VIP-bord'),
    'service.nightvip': src(10, 'office', 'VIP-bord'),
    weapon: src(10, 'office', 'Nytt vapen', { milestone: 'firstWeapon' }),
    recruit: src(15, 'office', 'Ny i crewet', { milestone: 'firstCrew' }),
    house: src(20, 'office', 'Nytt gömställe'),
    stripclub: src(60, 'office', 'Club Diamant', { once: 'prop:stripclub' }),
    roundBonus: src(10, 'office', 'Rundbonus'),
    // Matchen
    winSolo: src(300, null, 'Vinst', { mentor: false, cooldown: COOLDOWNS.win }),
    winOnline: src(600, null, 'Vinst online', { mentor: false, cooldown: COOLDOWNS.win }),
    finish: src(100, null, 'Spelade klart', { mentor: false, cooldown: COOLDOWNS.win })
});

// ── Variabel XP ──
const round5 = v => Math.round(v / 5) * 5;

// Uppdrag: bas + 20 % om ≥ 40 % av tiden var kvar, + 20 % för eget gäng, ×2 för Kapo-jobb. Avrundat till 5.
export function missionXp(m, { member = false, kapo = false } = {}) {
    const base = own(XP.mission, m?.type) ? XP.mission[m.type] : XP.mission.delivery;
    const limit = Number(m?.timeLimit) || 0, used = Number(m?.elapsed) || 0;
    const fast = limit > 0 && (limit - used) / limit >= 0.4;
    return round5(base * (fast ? 1.2 : 1) * (member ? 1.2 : 1) * (kapo ? 2 : 1));
}
export function bizXp(price) { return 10 + Math.round(Math.max(0, Number(price) || 0) / 1500); }
export function upgradeXp(cost) { return 5 + Math.round(Math.max(0, Number(cost) || 0) / 2000); }
export function carXp(price) { return 10 + Math.round(Math.max(0, Number(price) || 0) / 2000); }
export function shopRobXp(slot) { return 10 + 2 * (clamp(Math.floor(Number(slot) || 0), 0, 7) + 1); }
export function fenceXp(value) { return XP.fence + ((Number(value) || 0) >= 2500 ? XP.fenceRich : 0); }
export function chaseXp(maxStars) { const s = clamp(Math.floor(Number(maxStars) || 0), 0, 5); return s >= 2 ? XP.chasePerStar * s : 0; }
export function respMilestoneXp(step) { return own(XP.respMilestone, step) ? XP.respMilestone[step] : 0; }

// Vilken knockout-källa en ped ger. world.js nollar ped.mugger i knockout-grenen, så
// spawnMugger sätter också ped.wasMugger = true (stannar kvar) — och anropa koSource
// innan flaggorna nollas.
export function koSource(ped) {
    if (!ped) return 'ko.civ';
    if (ped.mugger || ped.wasMugger) return 'ko.mugger';
    if (ped.cop) return 'ko.cop';
    if (ped.type === 'gang') return 'ko.gang';
    if (ped.tough) return 'ko.tough';
    if (ped.type === 'metro') return 'ko.metro';
    return 'ko.civ';
}

// PvP: 10–80 XP. 0 om offret ligger 30+ nivåer under, eller om nybörjarskyddet gällde.
export function pvpXp(killerLevel, victimLevel, shielded = false) {
    const k = clampLevel(killerLevel), v = clampLevel(victimLevel);
    if (shielded || k - v >= 30) return 0;
    return Math.round(XP.pvp * clamp(1 + (v - k) / 20, 0.25, 2));
}

// Värdens gräns för PvP-XP: samma par högst 1 gång per 10 min, högst 6 per timme och mördare.
// state är värdens egna objekt { pair: {}, hour: {} }. xp är det pvpXp gav: en kill som
// ger 0 XP (skyddad nybörjare, 30+ nivåer under) nekas utan att stämpla, så den äter
// aldrig upp timkvoten. Stämplas bara när det godkänns.
export const PVP_XP_PAIR_MS = 10 * MIN;
export const PVP_XP_PER_HOUR = 6;
export function pvpXpGate(state, killerId, victimId, xp, now = Date.now()) {
    if (!state || typeof state !== 'object') return false;
    if (!(Number(xp) > 0)) return false;
    if (!state.pair || typeof state.pair !== 'object') state.pair = {};
    if (!state.hour || typeof state.hour !== 'object') state.hour = {};
    const key = `${killerId}>${victimId}`;
    const last = Number(state.pair[key]) || 0;
    if (last && now - last < PVP_XP_PAIR_MS && now >= last) return false;
    const hist = (Array.isArray(state.hour[killerId]) ? state.hour[killerId] : []).filter(t => now - t < HOUR && now >= t);
    state.hour[killerId] = hist;
    if (hist.length >= PVP_XP_PER_HOUR) return false;
    state.pair[key] = now;
    hist.push(now);
    return true;
}

// Värdens hela PvP-belöning i ett anrop (citynet 'down'): pvpXp och sedan grinden.
// → XP att skicka i 'pvp'-eventet (0 när grinden nekar).
export function pvpReward(state, { killer, victim, killerLevel, victimLevel, shielded = false } = {}, now = Date.now()) {
    const xp = pvpXp(killerLevel, victimLevel, shielded);
    return pvpXpGate(state, killer, victim, xp, now) ? xp : 0;
}

// Mentorbonus online: +2,5 % per nivå under rummets högsta mänskliga spelare, högst +75 %
export function mentorMult(myLevel, roomMaxLevel) {
    const gap = Math.max(0, clampLevel(roomMaxLevel) - clampLevel(myLevel));
    return 1 + Math.min(0.75, 0.025 * gap);
}

// AI-spelare startar fem nivåer under värden
export function aiStartXp(hostLevel) { return XP_TOTAL[Math.max(1, clampLevel(hostLevel) - 5)]; }

// ── Hinkar och spärrar ──
// Ren funktion: { got, b }. Ny hink = full. Klockan som går bakåt fyller inte på.
export function bucketTake(b, want, now = Date.now(), def = BUCKETS.street) {
    const cap = def.cap, rate = def.perMin / MIN;
    let v, t;
    if (!b || !Number.isFinite(b.v) || !Number.isFinite(b.t) || b.t > now + 24 * HOUR) { v = cap; t = now; }
    else {
        v = clamp(b.v, 0, cap);
        t = b.t;
        if (now > t) { v = Math.min(cap, v + (now - t) * rate); t = now; }
    }
    const w = Math.max(0, Math.floor(Number(want) || 0));
    const got = Math.min(w, Math.floor(v));
    return { got, b: { v: v - got, t } };
}

// Hur mycket som finns i hinken just nu (för Karriär-kortet)
export function bucketPeek(b, now = Date.now(), def = BUCKETS.street) {
    return { v: bucketTake(b, 0, now, def).b.v, cap: def.cap, perMin: def.perMin };
}

// Spärr i realtid. Godkänd → stämplar career[field] = now.
// Nekad stämplar inte — utom när stämpeln ligger i framtiden (klockan har gått bakåt):
// då flyttas den till now och nekas, så spärren blir ms från nu i stället för att
// låsa ända tills klockan hunnit ikapp den gamla stämpeln.
export function cooldownOk(career, field, ms, now = Date.now()) {
    if (!career || typeof career !== 'object') return false;
    const last = Number(career[field]) || 0;
    if (last > 0) {
        if (last > now) { career[field] = now; return false; }   // klockan har gått bakåt
        if (now - last < ms) return false;
    }
    career[field] = now;
    return true;
}

// ── Karriären (allt som följer karaktären mellan matcher) ──
// Lagringen sköts av career.js; här finns bara formen.
export function createCareer(now = Date.now()) {
    return {
        v: 1, xp: 0, milestones: [],
        buckets: { street: { v: BUCKETS.street.cap, t: now }, office: { v: BUCKETS.office.cap, t: now } },
        lastBankXp: 0, lastWinXp: 0, migrated: false
    };
}

export function normalizeCareer(raw, now = Date.now()) {
    const c = createCareer(now);
    if (!raw || typeof raw !== 'object') return c;
    c.xp = cleanXp(raw.xp);
    if (Array.isArray(raw.milestones)) c.milestones = [...new Set(raw.milestones.filter(k => typeof k === 'string' && own(MILESTONES, k)))];
    for (const k of Object.keys(BUCKETS)) {
        const b = raw.buckets?.[k];
        if (b && Number.isFinite(b.v) && Number.isFinite(b.t)) c.buckets[k] = { v: clamp(b.v, 0, BUCKETS[k].cap), t: b.t };
    }
    for (const f of ['lastBankXp', 'lastWinXp']) { const n = Number(raw[f]); c[f] = Number.isFinite(n) && n > 0 ? n : 0; }
    c.migrated = !!raw.migrated;
    return c;
}

// Utan karriär (t.ex. i tester) hålls spärrarna i minnet per spelare
const sessionCareers = new WeakMap();
function careerFor(player, opts, now) {
    if (opts.career && typeof opts.career === 'object') return opts.career;
    let c = sessionCareers.get(player);
    if (!c) { c = createCareer(now); sessionCareers.set(player, c); }
    return c;
}

// ── Nivå-upp ──
// +1 ⭐ per nivå, +5 ⭐ per ny titel och +5 respekt per ny titel hos alla
// gäng som inte är rival till ditt. opts.applyRespect = false → bara deltan.
// milestones: respektstegen (30/60/100) som titelrespekten passerar, [{ gang, step }].
// awardXp betalar dem själv när den lägger på respekten; annars gör world.setRespect det.
export function levelUpRewards(player, from, to, { applyRespect = true } = {}) {
    const a = clampLevel(from), b = clampLevel(to);
    const out = { rep: 0, respect: {}, ranks: [], milestones: [] };
    if (!player || typeof player !== 'object' || b <= a) return out;
    out.ranks = ranksBetween(a, b);
    out.rep = (b - a) * REP_PER_LEVEL + out.ranks.length * REP_PER_RANK;
    player.rep = Math.max(0, Number(player.rep) || 0) + out.rep;
    if (out.ranks.length) {
        const rival = player.gang ? GANGS.find(g => g.id === player.gang)?.rival : null;
        if (applyRespect && (!player.respect || typeof player.respect !== 'object')) player.respect = {};
        for (const id of GANG_IDS) {
            if (id === rival) continue;
            const before = Number(player.respect?.[id]) || 0;
            const after = clamp(before + TITLE_RESPECT * out.ranks.length, RESPECT_MIN, RESPECT_MAX);
            if (after === before) continue;
            out.respect[id] = after - before;
            for (const step of respectMilestones(before, after)) out.milestones.push({ gang: id, step });
            if (applyRespect) player.respect[id] = after;
        }
    }
    return out;
}

const ONCE_MAX = 300;
function pushOnce(player, key) {
    player.xpOnce.push(key);
    if (player.xpOnce.length > ONCE_MAX) player.xpOnce.splice(0, player.xpOnce.length - ONCE_MAX);
}
// Once-nycklar är strängar på högst 40 tecken (normalizeLevelFields slänger längre)
function onceKeyOf(k) {
    if (k === null || k === undefined || k === false || k === '') return null;
    return String(k).slice(0, 40);
}
const finiteOr0 = v => (Number.isFinite(v) ? v : 0);

// ── Dela ut XP ──
// awardXp(player, source, opts, now) → resultat. Muterar player.xp, player.level
// (cache), player.xpOnce, player.rep/respect vid nivå-upp och karriären.
//  source: nyckel i XP_SOURCES (okänd källa kräver opts.amount)
//  opts.amount     XP i stället för källans standard (missionXp, bizXp ...)
//  opts.career     karriärobjektet (createCareer/normalizeCareer) — hinkar, milstolpar, spärrar
//  opts.once       nyckel som bara ger XP en gång per match (lagras i player.xpOnce)
//  opts.milestone  karriärmilstolpe; null stänger av källans standard
//  opts.bucket     'street' | 'office' | null — ersätter källans
//  opts.cooldown   { field, ms } | null — ersätter källans
//  opts.mentor     multiplikator från mentorMult (1..1,75); false = ingen
//  opts.levelRewards false → ingen ⭐/respekt vid nivå-upp
//  opts.applyRespect false → titelrespekten returneras men läggs inte på (och dess
//                   respektsteg betalas inte här — world.setRespect gör det)
// Resultat: { gained, base, bonus, from, to, levelsGained, unlocked, rankUp, rank,
//             ranks, capped, blocked, milestone, rewards, respMilestones, source }
//  blocked: null | 'ai' | 'unknown' | 'once' | 'cooldown' | 'bucket'
//  unlocked: bara poster i byggd fas (ACTIVE_FAS)
export function awardXp(player, source, opts = {}, now) {
    opts = opts || {};
    const t = Number.isFinite(now) ? now : Number.isFinite(opts.now) ? opts.now : Date.now();
    const empty = (blocked) => {
        const L = player && typeof player === 'object' ? levelOf(player.xp) : 1;
        return {
            gained: 0, base: 0, bonus: 0, from: L, to: L, levelsGained: 0, unlocked: [], rankUp: false,
            rank: rankOf(L), ranks: [], capped: false, blocked, milestone: null, rewards: null, respMilestones: [], source
        };
    };
    if (!player || typeof player !== 'object') return empty('unknown');
    if (player.isAI) return empty('ai');
    const def = own(XP_SOURCES, source) ? XP_SOURCES[source] : null;
    const raw = opts.amount !== undefined ? opts.amount : def?.xp;
    if (raw === undefined || raw === null) return empty('unknown');
    const amount = clamp(Math.floor(Number(raw) || 0), 0, MAX_AWARD);

    const career = careerFor(player, opts, t);
    const onceKey = onceKeyOf(opts.once !== undefined ? opts.once : def?.once);
    if (!Array.isArray(player.xpOnce)) player.xpOnce = [];
    if (onceKey && player.xpOnce.includes(onceKey)) return empty('once');
    const cd = opts.cooldown !== undefined ? opts.cooldown : def?.cooldown;
    if (cd && !cooldownOk(career, cd.field, cd.ms, t)) return empty('cooldown');

    // Hinken begränsar basen; mentorbonusen läggs på det man fick
    const bucketId = opts.bucket !== undefined ? opts.bucket : def?.bucket;
    let got = amount;
    if (bucketId && own(BUCKETS, bucketId)) {
        if (!career.buckets || typeof career.buckets !== 'object') career.buckets = {};
        const r = bucketTake(own(career.buckets, bucketId) ? career.buckets[bucketId] : undefined, amount, t, BUCKETS[bucketId]);
        career.buckets[bucketId] = r.b;
        got = finiteOr0(r.got);
    }
    const mentorOn = opts.mentor !== false && def?.mentor !== false;
    const mentor = mentorOn && Number.isFinite(opts.mentor) ? clamp(opts.mentor, 1, 1.75) : 1;
    const base = finiteOr0(Math.round(got * mentor));

    // Karriärmilstolpe: utanför hinken, ingen mentorbonus
    const msKey = opts.milestone !== undefined ? opts.milestone : def?.milestone;
    let bonus = 0, milestone = null;
    if (msKey && own(MILESTONES, msKey)) {
        if (!Array.isArray(career.milestones)) career.milestones = [];
        if (!career.milestones.includes(msKey)) {
            career.milestones.push(msKey);
            bonus = MILESTONES[msKey];
            milestone = msKey;
        }
    }

    // Once-nyckeln förbrukas bara när hela beloppet betalades. En tom eller halvtom hink
    // ska inte kosta engångs-XP:n för resten av matchen (köpet ger resten senare).
    if (onceKey && got >= amount) pushOnce(player, onceKey);

    const before = cleanXp(player.xp);
    const from = levelOf(before);
    // XP kan aldrig minska, hur trasigt anropet än är
    player.xp = Math.max(before, cleanXp(before + base + bonus));

    // Nivå-upp: rykte och titelrespekt. Titelrespekten kan passera respektsteg (30/60/100);
    // när awardXp själv lägger på respekten betalas stegens XP här (once 'resp:<gäng>:<steg>'),
    // och den XP:n kan i sin tur ge en ny nivå — därav slingan.
    const applyRespect = opts.applyRespect !== false;
    const respMentor = opts.mentor !== false && Number.isFinite(opts.mentor) ? clamp(opts.mentor, 1, 1.75) : 1;
    let rewards = null;
    const respMilestones = [];
    let lo = from, to = levelOf(player.xp);
    if (to > from && opts.levelRewards !== false) {
        rewards = { rep: 0, respect: {}, ranks: [], milestones: [] };
        for (let guard = 0; to > lo && guard < MAX_LEVEL; guard++) {
            const r = levelUpRewards(player, lo, to, { applyRespect });
            rewards.rep += r.rep;
            rewards.ranks.push(...r.ranks);
            rewards.milestones.push(...r.milestones);
            for (const [id, d] of Object.entries(r.respect)) rewards.respect[id] = (rewards.respect[id] || 0) + d;
            lo = to;
            if (applyRespect) {
                for (const { gang, step } of r.milestones) {
                    const key = `resp:${gang}:${step}`;
                    if (player.xpOnce.includes(key)) continue;
                    pushOnce(player, key);
                    const xp = Math.round(respMilestoneXp(step) * respMentor);
                    player.xp = cleanXp(player.xp + xp);
                    respMilestones.push({ gang, step, xp });
                }
            }
            to = levelOf(player.xp);
        }
    }
    player.level = to;
    career.xp = Math.max(cleanXp(career.xp), player.xp);

    const gained = player.xp - before;
    const levelsGained = to - from;
    const ranks = ranksBetween(from, to);
    return {
        gained, base, bonus, from, to, levelsGained,
        unlocked: levelsGained > 0 ? unlocksBetween(from, to) : [],
        rankUp: ranks.length > 0, rank: rankOf(to), ranks,
        capped: got < amount, blocked: amount > 0 && got === 0 && bonus === 0 ? 'bucket' : null,
        milestone, rewards, respMilestones, source
    };
}

// ── Gamla sparfiler och trasiga värden ──
// xp → heltal 0..XP_MAX, level = nivån ur xp, lvSeen 1..100 (saknas → nuvarande nivå,
// så gammal progress inte firas), xpOnce → unika strängar ≤ 40 tecken, högst 300.
export function normalizeLevelFields(player) {
    if (!player || typeof player !== 'object') return player;
    player.xp = cleanXp(player.xp);
    const L = levelOf(player.xp);
    player.level = L;
    const seen = Math.floor(Number(player.lvSeen));
    player.lvSeen = Number.isFinite(seen) && player.lvSeen !== null && player.lvSeen !== '' ? clamp(seen, 1, MAX_LEVEL) : L;
    const once = Array.isArray(player.xpOnce) ? player.xpOnce.filter(k => typeof k === 'string' && k.length > 0 && k.length <= 40) : [];
    player.xpOnce = [...new Set(once)].slice(-300);
    return player;
}

// Nivåer som inte har firats än: null eller { from, to, ranks, rankUp, unlocked }
export function unseenLevels(player) {
    if (!player || typeof player !== 'object') return null;
    const L = levelOf(player.xp);
    const seen = clampLevel(player.lvSeen);
    if (L <= seen) return null;
    const ranks = ranksBetween(seen, L);
    return { from: seen, to: L, ranks, rankUp: ranks.length > 0, unlocked: unlocksBetween(seen, L) };
}

export function markLevelSeen(player) {
    if (player && typeof player === 'object') player.lvSeen = Math.max(clampLevel(player.lvSeen), levelOf(player.xp));
    return player;
}

// Retroaktiv XP för gamla sparfiler (en gång per karriär), kapad vid XP_TOTAL[30]
export function retroXp(player) {
    const s = player?.cityStats && typeof player.cityStats === 'object' ? player.cityStats : {};
    const n = k => Math.max(0, Math.floor(Number(s[k]) || 0));
    let xp = 60 * n('missions') + 18 * n('fenced') + 5 * n('sold') + 15 * n('heists')
        + 35 * n('dates') + 40 * n('pvpWins') + 4 * n('robbed');
    for (const id of Array.isArray(player?.owned) ? player.owned : []) {
        const shop = SHOPS.find(x => x.id === id);
        if (shop) xp += bizXp(shop.price);
    }
    return Math.min(XP_TOTAL[30], xp);
}
