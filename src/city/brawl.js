// ═══════════════════════════════════════════
//  STAN — barbråk inomhus
//  Slå någon på stället så drar det igång: några ger igen,
//  andra börjar slåss sinsemellan, resten flyr. Vakterna
//  kommer alltid springande. Inomhus dör man inte — man
//  blir utslängd och får vänta en stund innan man kommer in.
//  Pang-Pelle tillåter inga bråk i sin butik.
//
//  Fält på NPC:n (sätts när de behövs):
//   hp, maxHp          gäst 28–40, personal 45, vakt 80
//   brawl              'fight' | 'down' | 'back' | null — rummets tema rör inte NPC:n då
//                      ('back' = vakt/personal i Club Diamant på väg tillbaka till sin post)
//   foe                'player' | en annan NPC | en i mitt crew
//   flashT, stunT      vit blixt / vacklar efter en träff (stunImm: vacklar inte igen direkt)
//   windup, punchT     uppdragning före slaget / själva slaget (ritas)
//   fcd                väntetid till nästa slag
//   kx, ky             knuff bakåt (px/s)
//   down, looted       ligger nere (s) / plånboken redan länsad
//   upT                har just rest sig: går inte att slå på en stund
//   grabs              vakt: träffar på spelaren i det här bråket (GRABS → utslängd)
//   stirred            vilket bråk NPC:n redan reagerat på
//  När bråket är över går gästerna hem (brawl = null, leaving = true). Vakter och
//  personal går tillbaka till jobbet (leaving = false): i verksamheternas rum tar
//  temat vid, i Club Diamant går vi dem själva till posten ('back').
//
//  Rummets tillstånd:
//   state.brawlT       sekunder kvar av oron efter senaste slaget (världen släpper inte in nya kunder)
//   state.panic        sätts bara där det betyder slagsmål (Club Diamant, Kåken). I
//                      verksamheternas rum (teman 'biz-…') betyder panic rån — där rör vi den inte.
// ═══════════════════════════════════════════

import { WEAPONS } from './weapons.js';
import { collideInterior, roomStep } from './interiors.js';

export const NO_BRAWL = new Set(['gunshop']);   // Pang-Pelle säger ifrån
export const BAN_TIME = 20;                       // s utelåst efter att ha blivit utslängd
export const CALM_TIME = 6;                       // s utan att någon ger sig på spelaren → bråket lugnar sig
export const DOWN_TIME = 8;                       // s nere efter en knockout
export const UP_TIME = 1.5;                       // s efter att man rest sig då man inte går att slå
export const GRABS = 3;                           // träffar från en och samma vakt → utslängd
export const KO_COPS = 3;                         // knockouts per besök innan personalen ringer snuten
export const LOOT_MAX = 4;                        // plånböcker per besök
const REACH = 38;                                 // spelarens slag (px)
const CLOSE = 24;                                 // så nära träffar man även snett bakom sig
const NPC_REACH = 22;                             // NPC:ernas slag (px)
const SPREAD = 140;                               // gäster inom så här långt reagerar
const LOOT = 40;                                  // så nära den som ligger för att länsa (px)
const WINDUP = 0.3;
const STUN = 0.4;
const GUN_BUTT = [16, 20];                        // pistolkolv: inga skott inomhus
const R = 7;                                      // NPC:ernas kropp mot väggar och möbler
const UNREST = 8;                                 // s oro (brawlT/panic) efter varje slag
const GUARD_ARMOR = 0.75;                         // vakterna tål mer
const HEAL = 1 / 25;                              // andel av maxHp per sekund tillbaka för den som inte slåss
const BACK_GIVEUP = 25;                           // s: kommer man inte fram släpper vi taget ändå

const STAFF_KINDS = new Set(['bartender', 'manager', 'dj', 'waitress', 'seller']);
const MAD = ['Vad fan gör du?!', 'Kom igen då!', 'Nu jävlar!', 'Fel kille, bror!', 'Du spillde min drink!', 'Kom hit!'];
const CHAOS = ['Vem knuffade?!', 'Det var du!', 'Akta drinken!', 'Kom hit då!', 'Vad glor du på?!'];
const SCARED = ['Aaah!', 'Jag drar!', 'Ring snuten!', 'Inte här!', 'Spring!'];
const STAFF_LINES = ['Lugna ner er!', 'Inte här inne!', 'Sluta nu!', 'Vakten!!'];
const GUARD_LINES = ['Hörru! Ut med dig!', 'Nu åker du ut!', 'Lugna dig!', 'Inga bråk här!'];
const GUARD_UP = ['Nu jävlar!', 'Där är du ju!', 'Andra ronden!'];

// Verksamheternas rum: där betyder state.panic rån (personalen räcker upp händerna)
const robberyRoom = I => /^biz-/.test(I.def.theme || '');
// Club Diamant sköts av interiors.js utan tema: ingen annan räknar ner panic där
const SELF_PANIC = new Set(['club']);

const pick = (rnd, arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const turnTo = (n, a, k) => { n.angle = wrap(n.angle + wrap(a - n.angle) * Math.min(1, k)); };
const say = (n, text, life = 2.2) => { if (!n.say) n.say = { text, life }; };

export const isGuard = n => n.kind === 'bouncer' || n.kind === 'guard';
export const isStaff = n => !isGuard(n) && (STAFF_KINDS.has(n.kind) || n.beh === 'staff' || !!n.staff || !!(n.c && n.c.staff));

// Får man slåss här inne?
export function canBrawl(I) { return !!I && !NO_BRAWL.has(I.id); }

// Bråkets läge för det här besöket i rummet
export function fightOf(I) {
    return I.fight || (I.fight = { on: false, n: 0, quietT: 0, guardHits: 0, kos: 0, loots: 0, cops: false });
}

// På benen: inte dansarna på scenen, inte någon som ligger eller redan gått
function standing(n) {
    return n.beh !== 'dancer' && !n.gone && !n.dead && !(n.down > 0) && n.brawl !== 'down' && Number.isFinite(n.x) && Number.isFinite(n.y);
}
// Går att slå: på benen och inte precis uppe igen
function hittable(n) { return standing(n) && !(n.upT > 0); }

function ensureHp(n, rnd) {
    if (n.maxHp > 0) return;
    n.maxHp = isGuard(n) ? 80 : isStaff(n) ? 45 : Math.round(28 + rnd() * 12);
    n.hp = n.maxHp;
}

// Glaset åker i golvet. Gästerna tappar allt de har i händerna; personalens grejer
// (bricka, verktyg) döljer renderaren medan de slåss och finns kvar efteråt.
function dropProps(n) {
    n.drink = null;
    if (!isGuard(n) && !isStaff(n)) { n.item = null; n.prop = null; n.act = null; }
    if (n.pose === 'sit' || n.pose === 'dance' || n.pose === 'cheer' || n.pose === 'work') n.pose = 'idle';
}

// In i bråket (eller byt mål)
function joinFight(n, foe, rnd) {
    ensureHp(n, rnd);
    if (n.brawl !== 'fight') {
        n.brawl = 'fight';
        n.leaving = false;
        n.windup = 0;
        n.grabs = 0;
        n.fcd = 0.3 + rnd() * 0.5;
        dropProps(n);
    }
    n.foe = foe;
}

// Ur bråket: gästerna går hem, vakter och personal tillbaka till jobbet
function endFight(n) {
    n.foe = null;
    n.windup = 0; n.stunT = 0; n.stunImm = 0; n.grabs = 0;
    if (isGuard(n) || isStaff(n)) {
        // Rummets tema för tillbaka dem i sitt manus. Club Diamants patrullerande personal går
        // vi själva till posten ('back') — stepPatrol går rakt fram utan att väja för möblerna.
        n.leaving = false;
        n.brawl = n.beh === 'patrol' && n.spots && n.spots.length ? 'back' : null;
        n.backT = 0;
        n.pose = n.brawl ? 'walk' : 'idle';
        return;
    }
    n.brawl = null;
    n.leaving = true;
    n.pose = 'walk';
}

// ── Spelaren slår ──
// SPACE / vänsterklick / 👊. Skjutvapen blir pistolkolv — inga skott inomhus.
export function playerPunch(world) {
    const I = world.interior, p = world.player, prof = world.profile;
    if (!canBrawl(I) || world.punchCd > 0 || p.dead) return false;
    const w = WEAPONS[prof.weapon] || WEAPONS.fists;
    const dmg = w.melee ? w.dmg : GUN_BUTT;
    world.punchCd = w.melee ? w.cd : 0.45;
    p.punchT = 0.18;
    p.protT = 0;
    const n = pickTarget(world, I);
    if (!n) { world.sfx('swing', 0.4); return false; }
    world.sfx(w.id === 'bat' ? 'bat' : 'punch');
    hitNpc(world, n, dmg[0] + world.rnd() * (dmg[1] - dmg[0]) + (prof.strength || 0) * 3, 'player');
    return true;
}

// Närmaste NPC framför spelaren (tätt intill räknas även snett bakom)
function pickTarget(world, I) {
    const p = world.player;
    let best = null, bs = Infinity;
    for (const n of I.state.npcs) {
        if (!hittable(n)) continue;
        const dx = n.x - p.x, dy = n.y - p.y, d = Math.hypot(dx, dy);
        if (d > REACH) continue;
        const off = Math.abs(wrap(Math.atan2(dy, dx) - p.angle));
        if (off > 1.6 && d > CLOSE) continue;
        const s = d + off * 10 - (n.brawl === 'fight' && n.foe === 'player' ? 12 : 0);
        if (s < bs) { bs = s; best = n; }
    }
    return best;
}

// En träff på en NPC. by = 'player', en NPC eller en i mitt crew.
export function hitNpc(world, n, dmg, by) {
    const I = world.interior, rnd = world.rnd;
    if (!I || !hittable(n)) return;
    ensureHp(n, rnd);
    const guard = isGuard(n);
    n.hp -= dmg * (guard ? GUARD_ARMOR : 1);
    n.flashT = 0.12;
    // Vacklar och tappar slaget — men inte av varje slag i en serie (då kunde man hålla vem som helst nere),
    // och vakterna står stadigare
    const stagger = !(n.stunImm > 0);
    if (stagger) {
        n.stunT = guard ? STUN * 0.5 : STUN;
        n.stunImm = n.stunT + 0.5;
        n.windup = 0;
    }
    const from = by === 'player' ? world.player : by;
    if (from && Number.isFinite(from.x)) {
        const dx = n.x - from.x, dy = n.y - from.y, l = Math.hypot(dx, dy) || 1;
        const k = (guard ? 0.6 : 1) * (stagger ? 170 : 90);
        n.kx = dx / l * k; n.ky = dy / l * k;
    }
    const mine = by === 'player' || !!(by && by.isCrew);
    if (n.hp <= 0) knockOut(world, n, by);
    else {
        // Vakterna håller sig till spelaren; andra slår tillbaka mot den som slog
        const foe = by === 'player' ? 'player'
            : by && by.isCrew ? (guard || rnd() < 0.5 ? (n.foe || 'player') : by)
                : guard ? (n.foe || 'player') : by;
        joinFight(n, foe, rnd);
        if (by === 'player' && n.say == null && rnd() < 0.5) say(n, pick(rnd, guard ? GUARD_LINES : MAD));
    }
    if (mine) stir(world, n);
}

function knockOut(world, n, by) {
    n.hp = 0;
    n.brawl = 'down';
    n.down = DOWN_TIME;
    n.foe = null;
    n.windup = 0; n.punchT = 0; n.stunT = 0; n.stunImm = 0; n.upT = 0; n.grabs = 0;
    n.leaving = false;
    n.say = null;
    dropProps(n);                 // ligger ner: inget sittande glas som sticker ut
    if (by === 'player') world.floater(n.x, n.y - 26, 'KNOCKOUT!', '#facc15');
    if (by === 'player' || (by && by.isCrew)) {
        const F = fightOf(world.interior);
        F.kos = (F.kos || 0) + 1;
        if (F.kos >= KO_COPS && !F.cops) callCops(world);
    }
}

// För mycket stryk: personalen ringer snuten, som väntar utanför när man går ut
function callCops(world) {
    const I = world.interior;
    fightOf(I).cops = true;
    I.seen = true;
    // Polisen (police.js): en trafikincident-nivå, och de vet vilket ställe det gäller
    if (world.crime) world.crime('brawlCall', { at: I.door, known: true });
    world.message('📞 Personalen har ringt snuten — de väntar utanför.');
}

// Bråket drar igång / sprider sig runt den som blev slagen
function stir(world, n0) {
    const I = world.interior, st = I.state, F = fightOf(I), rnd = world.rnd;
    F.quietT = 0;
    st.brawlT = Math.max(st.brawlT || 0, UNREST);                               // inga nya kunder på en stund
    if (!robberyRoom(I)) st.panic = Math.max(st.panic || 0, UNREST);           // de som går ut springer, Kåken hejar
    const guards = st.npcs.filter(n => isGuard(n) && standing(n));
    if (!F.on) {
        F.on = true;
        F.n++;
        F.guardHits = 0;
        const cs = world.profile.cityStats;
        if (cs) cs.barfights = (cs.barfights || 0) + 1;
        const what = I.id === 'stripclub' || I.id === 'club' ? 'Barbråk!' : 'Slagsmål!';
        world.message(`🥊 ${what}${guards.length ? ' Vakterna är på väg.' : ''}`);
    }
    let talk = 0;
    // Vakterna kommer alltid springande (även de som är på väg tillbaka till posten)
    for (const g of guards) {
        if (g.brawl === 'fight') continue;
        joinFight(g, 'player', rnd);
        g.stirred = F.n;
        if (talk++ < 2) say(g, pick(rnd, GUARD_LINES), 2.4);
    }
    for (const n of st.npcs) {
        if (n === n0 || n.brawl || n.stirred === F.n || !hittable(n) || isGuard(n)) continue;
        if (isStaff(n)) {
            // personalen säger ifrån men slåss inte (om de inte själva blir slagna)
            n.stirred = F.n;
            if (talk++ < 4) say(n, pick(rnd, STAFF_LINES), 2.4);
            continue;
        }
        if (n.leaving || Math.hypot(n.x - n0.x, n.y - n0.y) > SPREAD) continue;
        n.stirred = F.n;
        const r = rnd();
        if (r < 0.35) {
            joinFight(n, 'player', rnd);
            if (talk++ < 4) say(n, pick(rnd, MAD));
        } else if (r < 0.6) {
            const m = otherGuest(st, n, n0, F.n);
            if (m) {
                joinFight(n, m, rnd); joinFight(m, n, rnd);
                m.stirred = F.n;
                if (talk++ < 4) say(n, pick(rnd, CHAOS));
            } else flee(I.def, n, rnd, talk++ < 4);
        } else flee(I.def, n, rnd, talk++ < 4);
    }
}

// Upp ur stolen och mot dörren
function flee(def, n, rnd, talk) {
    n.leaving = true;
    n.drink = null;
    if (n.pose !== 'walk') n.pose = 'walk';
    collideInterior(def, n, R);
    if (talk && rnd() < 0.6) say(n, pick(rnd, SCARED), 1.8);
}

// Någon annan gäst i närheten att börja slåss med
function otherGuest(st, n, n0, id) {
    let best = null, bd = 160;
    for (const m of st.npcs) {
        if (m === n || m === n0 || m.brawl || m.leaving || m.stirred === id || !hittable(m) || isGuard(m) || isStaff(m)) continue;
        const d = Math.hypot(m.x - n.x, m.y - n.y);
        if (d < bd) { bd = d; best = m; }
    }
    return best;
}

// ── Spelaren tar stryk inomhus: man dör inte, man blir utslängd ──
export function hurtInside(world, dmg, by) {
    const I = world.interior, p = world.player;
    if (!I || p.dead || (p.protT || 0) > 0) return;
    const F = fightOf(I);
    const absorbed = Math.min(p.armor || 0, dmg * 0.6);   // skyddsvästen tar en del
    if (absorbed > 0) { p.armor -= absorbed; world.profile.armor = Math.round(p.armor); }
    p.hp = Math.max(1, p.hp - (dmg - absorbed));
    p.hurtT = 0.3;
    world.shake = Math.max(world.shake || 0, 0.3);
    world.lastHurtT = world.time;
    world.sfx('punch');
    if (by && Number.isFinite(by.angle)) { p.vx = (p.vx || 0) + Math.cos(by.angle) * 110; p.vy = (p.vy || 0) + Math.sin(by.angle) * 110; }
    F.quietT = 0;
    // Varje vakt räknar sina egna träffar: två vakter slänger inte ut en dubbelt så fort
    let grabbed = false;
    if (by && isGuard(by)) {
        F.guardHits++;
        by.grabs = (by.grabs || 0) + 1;
        grabbed = by.grabs >= GRABS;
    }
    if (p.hp <= p.maxHp * 0.2 || grabbed) throwOut(world);
}

// Ut på gatan, och stället är stängt för en en stund
export function throwOut(world) {
    const I = world.interior;
    if (!I) return;
    const guard = I.state.npcs.some(n => isGuard(n) && standing(n));   // en vakt som ligger slänger ingen
    (world.banned || (world.banned = {}))[I.id] = world.time + BAN_TIME;
    world.exitInterior();
    world.sfx('hurt');
    world.message(`${guard ? '🕴️ Vakten slängde ut dig!' : '😵 Personalen slängde ut dig!'} Du kommer inte in igen på en stund.`);
}

// Utelåst? Sekunder kvar (0 = välkommen in)
export function bannedFor(world, id) {
    const t = world.banned && world.banned[id];
    return t ? Math.max(0, t - world.time) : 0;
}

// R intill någon som ligger: länsa plånboken (en gång per person, några per besök)
export function playerRob(world) {
    const I = world.interior, p = world.player;
    if (!canBrawl(I) || p.dead) return false;
    let best = null, bd = LOOT;
    for (const n of I.state.npcs) {
        if (n.brawl !== 'down' || !(n.down > 0) || n.looted) continue;
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (d < bd) { bd = d; best = n; }
    }
    if (!best) return false;
    const F = fightOf(I);
    if ((F.loots || 0) >= LOOT_MAX) {
        if (!(world.robCd > 0)) { world.robCd = 2; world.message('👛 Personalen har ögonen på dig — inga fler plånböcker här inne.'); }
        return true;
    }
    F.loots = (F.loots || 0) + 1;
    best.looted = true;
    const amount = Math.round((40 + world.rnd() * 210) / 10) * 10;
    world.addMoney(amount, best.x, best.y);
    world.sfx('coin', 0.7);
    return true;
}

// ── Varje bildruta ──
export function updateBrawl(world, dt) {
    const I = world.interior;
    if (!canBrawl(I) || !(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    const F = fightOf(I), st = I.state, npcs = st.npcs, def = I.def;
    if (st.brawlT > 0) st.brawlT = Math.max(0, st.brawlT - dt);
    if (st.panic > 0 && SELF_PANIC.has(def.theme)) st.panic = Math.max(0, st.panic - dt);
    let fighters = 0;
    for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (n.flashT > 0) n.flashT = Math.max(0, n.flashT - dt);
        if (n.punchT > 0) n.punchT = Math.max(0, n.punchT - dt);
        if (n.upT > 0) n.upT = Math.max(0, n.upT - dt);
        if (n.brawl === 'down') {
            slide(n, def, dt);
            if ((n.down -= dt) <= 0) getUp(world, I, n);
            continue;
        }
        // den som inte slåss hämtar sig sakta
        if (n.maxHp > 0 && n.hp < n.maxHp && n.brawl !== 'fight') n.hp = Math.min(n.maxHp, n.hp + n.maxHp * HEAL * dt);
        if (n.brawl === 'back') { stepBack(def, n, dt); continue; }
        if (n.brawl !== 'fight') continue;
        fighters++;
        stepFighter(world, I, n, dt);
        if (world.interior !== I) return; // utslängd
    }
    if (fighters) spread(I, world.player);
    stepCrew(world, I, dt);
    if (!F.on) return;
    F.quietT += dt;
    if (fighters === 0 && F.quietT > 2) F.on = false;
    else if (F.quietT >= CALM_TIME) calmDown(world, I);
}

// Upp igen, omtöcknad: går inte att slå på en stund. Pågår bråket ger sig vakten in i det igen.
function getUp(world, I, n) {
    n.down = 0;
    n.upT = UP_TIME;
    n.hp = Math.ceil(n.maxHp * (isGuard(n) ? 0.6 : 0.5));
    if (isGuard(n) && fightOf(I).on && !world.player.dead) {
        joinFight(n, 'player', world.rnd);
        say(n, pick(world.rnd, GUARD_UP), 2);
    } else endFight(n);
}

// Ingen har gett sig på spelaren på en stund: gästerna går hem, personalen tillbaka till jobbet
function calmDown(world, I) {
    const F = fightOf(I);
    let any = false;
    for (const n of I.state.npcs) if (n.brawl === 'fight') { endFight(n); any = true; }
    F.on = false;
    if (any) world.message('😮‍💨 Bråket har lugnat sig.');
}

// Club Diamants vakt/personal: tillbaka till posten runt möblerna. Sista biten, väntan,
// vändning och pose sköter stepPatrol (interiors.js) när vi släppt taget.
function stepBack(def, n, dt) {
    slide(n, def, dt);
    const sp = n.spots[n.si] || n.spots[0];
    const d = Math.hypot(sp.x - n.x, sp.y - n.y);
    n.backT = (n.backT || 0) + dt;
    if (d < 10 || n.backT > BACK_GIVEUP) {
        n.brawl = null; n.backT = 0;
        n.walking = true; n.pose = 'walk';
        return;
    }
    const to = roomStep(def, n.x, n.y, sp.x, sp.y);
    const sx = to.x - n.x, sy = to.y - n.y, sl = Math.hypot(sx, sy);
    const m = Math.min(d, Math.max(n.speed || 0, 50) * dt);
    if (sl > 0.01) {
        n.x += sx / sl * m; n.y += sy / sl * m;
        turnTo(n, Math.atan2(sy, sx), dt * 10);
    }
    n.pose = 'walk';
    n.phase = (n.phase || 0) + m * 0.12;
    collideInterior(def, n, R);
}

// Bråkarna trängs inte på samma punkt, och ingen står inuti spelaren
function spread(I, p) {
    const def = I.def, list = I.state.npcs.filter(n => n.brawl === 'fight');
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        for (let j = i + 1; j < list.length; j++) {
            const b = list[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
            if (d >= 15) continue;
            const ux = d > 0.01 ? dx / d : Math.cos(i + j), uy = d > 0.01 ? dy / d : Math.sin(i + j), k = (15 - d) / 2;
            a.x -= ux * k; a.y -= uy * k; b.x += ux * k; b.y += uy * k;
        }
        const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy);
        if (d < 17) {
            const ux = d > 0.01 ? dx / d : Math.cos(i), uy = d > 0.01 ? dy / d : Math.sin(i);
            a.x += ux * (17 - d); a.y += uy * (17 - d);
        }
    }
    for (const a of list) collideInterior(def, a, R);
}

// Knuffen efter en träff glider ut
function slide(n, def, dt) {
    if (!n.kx && !n.ky) return;
    n.x += n.kx * dt; n.y += n.ky * dt;
    const k = Math.max(0, 1 - 9 * dt);
    n.kx *= k; n.ky *= k;
    if (Math.abs(n.kx) + Math.abs(n.ky) < 6) { n.kx = 0; n.ky = 0; }
    collideInterior(def, n, R);
}

// Vem NPC:n slåss mot just nu (null = målet är borta och bråket slut för den)
function foeOf(world, I, n) {
    const f = n.foe;
    if (f === 'player') return world.player.dead ? null : world.player;
    if (f && f.isCrew) {
        if (f.interior === I.id && !(f.down > 0) && !f.hidden) return f;
    } else if (f && !f.gone && !f.dead && !(f.down > 0) && f.brawl === 'fight' && I.state.npcs.includes(f)) return f;
    // målet är borta: vakterna (och den som gav sig på crewet) går på spelaren, andra ger sig
    if (isGuard(n) || (f && f.isCrew)) { n.foe = 'player'; return world.player; }
    return null;
}

function stepFighter(world, I, n, dt) {
    const def = I.def;
    n.fcd = Math.max(0, (n.fcd || 0) - dt);
    n.stunT = Math.max(0, (n.stunT || 0) - dt);
    n.stunImm = Math.max(0, (n.stunImm || 0) - dt);
    slide(n, def, dt);
    const foe = foeOf(world, I, n);
    if (!foe) { endFight(n); return; }
    const dx = foe.x - n.x, dy = foe.y - n.y, d = Math.hypot(dx, dy);
    if (n.stunT > 0) {
        // vacklar
        n.pose = 'idle';
        n.angle = wrap(n.angle + Math.sin(n.stunT * 38) * 0.08);
        return;
    }
    if (n.windup > 0) {
        n.pose = 'idle';
        turnTo(n, Math.atan2(dy, dx), dt * 10);
        if ((n.windup -= dt) <= 0) { n.windup = 0; strike(world, I, n, foe); }
        return;
    }
    if (d > NPC_REACH) {
        // springer fram (runt borden om det behövs)
        const to = d > 40 ? roomStep(def, n.x, n.y, foe.x, foe.y) : foe;
        const sx = to.x - n.x, sy = to.y - n.y, sl = Math.hypot(sx, sy);
        const m = Math.min(Math.max(0, d - NPC_REACH + 2), (isGuard(n) ? 125 : 90) * dt);
        if (sl > 0.01) {
            n.x += sx / sl * m; n.y += sy / sl * m;
            turnTo(n, Math.atan2(sy, sx), dt * 12);
        }
        n.pose = 'walk';
        n.phase = (n.phase || 0) + m * 0.12;
        collideInterior(def, n, R);
    } else {
        n.pose = 'idle';
        turnTo(n, Math.atan2(dy, dx), dt * 14);
        if (n.fcd <= 0) {
            n.windup = WINDUP;
            if (foe === world.player) fightOf(I).quietT = 0;
        }
    }
}

// Slaget går iväg efter uppdragningen — träffar om målet fortfarande är inom räckhåll
function strike(world, I, n, foe) {
    const rnd = world.rnd;
    n.punchT = 0.18;
    n.fcd = 0.9 + rnd() * 0.4;
    if (Math.hypot(foe.x - n.x, foe.y - n.y) > NPC_REACH + 10) { world.sfxAt('swing', n.x, n.y, 0.4); return; }
    if (foe === world.player) hurtInside(world, isGuard(n) ? 8 + rnd() * 4 : 4 + rnd() * 3, n);
    else if (foe.isCrew) {
        world.hurtCrew(foe, 6 + rnd() * 4, null);
        world.sfxAt('punch', foe.x, foe.y, 0.6);
        fightOf(I).quietT = 0;
    } else {
        world.sfxAt('punch', foe.x, foe.y, 0.5);
        hitNpc(world, foe, 6 + rnd() * 4, n);
    }
}

// Mitt crew i rummet går på den som ger sig på mig (eller på dem)
function stepCrew(world, I, dt) {
    const F = fightOf(I), def = I.def;
    for (const c of world.crew || []) {
        if (c.hidden || c.interior !== I.id) continue;
        c.cd = Math.max(0, (c.cd || 0) - dt);
        c.punchT = Math.max(0, (c.punchT || 0) - dt);
        c.flashT = Math.max(0, (c.flashT || 0) - dt);
        if (c.down > 0) {
            if ((c.down -= dt) <= 0) { c.down = 0; c.hp = Math.ceil(c.maxHp * 0.5); world.floater(c.x, c.y - 22, `💪 ${c.name} är uppe`, '#86efac'); }
            continue;
        }
        if (!F.on) continue;
        let tgt = null, bd = 420;
        for (const n of I.state.npcs) {
            if (n.brawl !== 'fight' || !hittable(n) || !(n.foe === 'player' || (n.foe && n.foe.isCrew))) continue;
            const d = Math.hypot(n.x - c.x, n.y - c.y);
            if (d < bd) { bd = d; tgt = n; }
        }
        if (!tgt) continue;
        const d = bd;
        if (d > 20) {
            const to = d > 40 ? roomStep(def, c.x, c.y, tgt.x, tgt.y) : tgt;
            const sx = to.x - c.x, sy = to.y - c.y, sl = Math.hypot(sx, sy);
            const m = Math.min(d - 18, (c.speed || 160) * 0.8 * dt);
            if (sl > 0.01 && m > 0) { c.x += sx / sl * m; c.y += sy / sl * m; c.angle = Math.atan2(sy, sx); c.phase = (c.phase || 0) + m * 0.12; }
            collideInterior(def, c, c.r || 8);
        } else {
            c.angle = Math.atan2(tgt.y - c.y, tgt.x - c.x);
            if (c.cd <= 0) {
                c.cd = 0.8;
                c.punchT = 0.2;
                world.sfxAt('punch', tgt.x, tgt.y, 0.8);
                hitNpc(world, tgt, 10 + world.rnd() * 6, c);
            }
        }
    }
}

// Tipset inomhus: länsa den som ligger, slå tillbaka, eller (diskret) att man kan starta ett bråk
export function brawlHint(world) {
    const I = world.interior, p = world.player;
    if (!canBrawl(I)) return '';
    const F = I.fight;
    const lootLeft = !F || (F.loots || 0) < LOOT_MAX;
    let down = false, threat = false, guest = false;
    for (const n of I.state.npcs) {
        const d = Math.hypot(n.x - p.x, n.y - p.y);
        if (n.brawl === 'down') { if (!n.looted && lootLeft && d < LOOT) down = true; }
        else if (n.brawl === 'fight') { if (n.foe === 'player' && d < 90) threat = true; }
        else if (d < 30 && !n.leaving && hittable(n) && !isGuard(n) && !isStaff(n)) guest = true;
    }
    if (down) return 'R — Länsa plånboken';
    if (threat) return 'SPACE — SLÅ!';
    if (guest && !(F && F.on)) return 'SPACE — Starta bråk';
    return '';
}
