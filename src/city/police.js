// ═══════════════════════════════════════════
//  STAN — polisen
//  Graderad reaktion: nivå 0–5 med insatstak, trafikstopp,
//  incidenter med begriplig orsak, jakt → sökning vid senast
//  kända plats → avslut. Ren logik utan DOM och utan världen:
//  world.js berättar vad snuten ser och vad som hände.
//
//  Fyra värden hålls isär:
//  - level: efterlysningsnivån (stiger bara av nya händelser, aldrig av tid)
//  - incidents: historiken (vad, när, vilken nivå det gav)
//  - fordonsskada: ligger på bilarna (v.hp), polisen läser bara av den
//  - heat: kvarvarande tryck som avtar sakta när det är lugnt
//
//  Alla värden är förslag att speltesta (masterprompt avsnitt 5).
// ═══════════════════════════════════════════

// cars = tak för jagande polisbilar i en insats, foot = snutar till fots,
// search = sekunder de letar där de såg dig sist, speed = andel av polisbilens toppfart (460),
// gas = hur hårt de gasar (polisbilen accelererar annars mycket snabbare än en vanlig bil).
// Låga nivåer: långsammare än startbilen (Volvo 240, 350 px/s) — den kan köra ifrån och bryta sikten.
// sight = hur långt de ser dig under en insats (fri sikt krävs alltid), corner = fart de högst
// tar en sväng i (0 = ingen gräns: på höga nivåer kör de hårt).
export const LEVELS = [
    { name: 'Lugn', cars: 0, foot: 0, search: 0, speed: 0.55, gas: 0.55, sight: 560, corner: 150 },
    { name: 'Trafikincident', cars: 1, foot: 1, search: 15, speed: 0.55, gas: 0.55, sight: 460, corner: 150 },
    { name: 'Efterlysning', cars: 2, foot: 2, search: 20, speed: 0.58, gas: 0.6, sight: 480, corner: 160 },
    { name: 'Allvarligt hot', cars: 3, foot: 2, search: 30, speed: 0.8, gas: 0.85, sight: 540, corner: 220 },
    { name: 'Väpnat hot', cars: 4, foot: 3, search: 40, speed: 0.9, gas: 1, sight: 560, corner: 0 },
    { name: 'Maxinsats', cars: 6, foot: 4, search: 50, speed: 1, gas: 1, sight: 600, corner: 0 }
];
export const MAX_LEVEL = 5;

// Balansvärden. Alla tider i sekunder, farter i px/s.
export const POLICE = {
    patrol: 2,              // patrullbilar runt spelaren när inget pågår
    patrolHeat: 2,          // över det här trycket: en patrull till
    totalCars: 8,           // tak för polisbilar i den lokala simuleringen
    districtCars: 6,        // tak för polisbilar i ett och samma distrikt
    reinforceGap: [0, 5, 5, 4, 3, 2.5], // minst så här länge mellan nya enheter, per nivå
    lostAfter: [3, 3, 3, 4, 4.5, 5],    // utom synhåll så länge → sökning
    stopWindow: 10,         // trafikstopp: tid att hitta en plats och stanna (förlängs i fart)
    stopWindowMax: 14,
    stopStill: 1.2,         // står still minst så länge = har stannat
    stillSpeed: 25,
    stopTalk: 2.5,          // så länge pratar polisen innan beskedet
    stopWait: 20,           // stod still men ingen polis hann fram: de släpper det
    talkRange: 150,         // polisen måste vara så här nära för att prata
    // Krockar
    sepTime: 0.6,           // fordonen isär minst så länge = en ny kontakt (annars samma)
    reSmash: 90,            // en ny smäll mitt i en kontakt: så mycket hårdare än förra toppen
    faultSpeed: 35,         // spelaren måste röra sig mot den andra minst så här fort för att vara skyldig
    ramSpeed: 70,           // ...och så här fort med gas och nosen (eller bakänden) mot målet = medveten ramning
    ramGap: 1.5,            // en ny ramning räknas först så här länge efter förra skyldiga kontakten
    pushGrace: 0.6,         // nyss knuffad av någon annan: kedjekrock, inte spelarens fel
    crashImpact: 260,       // en så hård smäll (relativ fart) är en "hård krock", inte en buckla
    crashDamage: 18,        // ...eller om polisbilen tog så mycket skada
    // Böter och tryck
    fine: [0, 300, 900, 0, 0, 0],
    repairPerHp: 6,         // kr per skadepoäng på polisbilen
    repairCap: 1500,
    serviceHours: 2,        // har man inte råd: samhällstjänst (klockan går), inget mer
    heatMax: 10,
    heatDecay: 1 / 60,      // per sekund när inget pågår (en enhet i minuten)
    endShow: 5              // så länge syns "polisen gav upp" o.d.
};

// Händelser. base = nivån den ger, cap = den kan aldrig höja över det här,
// step = en ny separat upprepning höjer ett steg (inom cap, tidigast stepGap efter förra höjningen),
// once = räknas bara en gång per insats, dedupe = samma händelse inom så kort tid är samma händelse,
// minor = en liten trafikincident (kan sluta med en varning).
export const EVENTS = {
    bump: { base: 1, cap: 1, heat: 0.5, minor: true, text: 'Lätt krock med en polisbil' },
    crash: { base: 2, cap: 2, heat: 1, text: 'Hård krock med en polisbil' },
    ram: { base: 2, cap: 3, heat: 1, step: true, stepGap: 1, text: 'Körde in i polisbilen igen', stepText: 'Upprepad ramning med gas och styrning mot polisen' },
    ignoredStop: { base: 2, cap: 2, heat: 1, once: true, text: 'Stannade inte när polisen ville prata' },
    hitPed: { base: 2, cap: 3, heat: 1, step: true, stepGap: 6, dedupe: 1.5, text: 'Körde på en fotgängare', stepText: 'Körde på folk igen' },
    assault: { base: 1, cap: 2, heat: 0.5, step: true, stepGap: 5, dedupe: 1.5, minor: true, text: 'Misshandel på öppen gata', stepText: 'Fortsatt misshandel' },
    rob: { base: 2, cap: 2, heat: 1, dedupe: 1.5, text: 'Rånade någon framför polisen' },
    loot: { base: 1, cap: 2, heat: 0.5, dedupe: 1.5, text: 'Länsade någon som låg ner' },
    deal: { base: 1, cap: 1, heat: 0.5, minor: true, text: 'Langade framför polisen' },
    carjack: { base: 2, cap: 2, heat: 1, text: 'Drog ut en förare och tog bilen' },
    wreck: { base: 2, cap: 3, heat: 1, step: true, stepGap: 6, text: 'Kvaddade en bil', stepText: 'Kvaddade bil efter bil' },
    stealCop: { base: 3, cap: 3, heat: 2, text: 'Snodde en polisbil' },
    fenceCop: { base: 2, cap: 2, heat: 1, text: 'Skrotade en polisbil' },
    copWreck: { base: 3, cap: 4, heat: 2, step: true, stepGap: 4, text: 'Kvaddade en polisbil', stepText: 'Kvaddade polisbil efter polisbil' },
    explosion: { base: 3, cap: 4, heat: 2, step: true, stepGap: 4, text: 'Sprängde en bil', stepText: 'Fler explosioner' },
    copAssault: { base: 3, cap: 3, heat: 1.5, text: 'Gav dig på en polis' },
    robShop: { base: 3, cap: 3, heat: 2, text: 'Rånade en butik' },
    brawlCall: { base: 1, cap: 2, heat: 0.5, minor: true, text: 'Personalen ringde polisen efter bråket' },
    shot: { base: 4, cap: 5, heat: 2, step: true, stepGap: 6, dedupe: 2, text: 'Skottlossning på öppen gata', stepText: 'Fortsatt skottlossning' },
    shotCop: { base: 4, cap: 5, heat: 3, step: true, stepGap: 3, dedupe: 1, text: 'Sköt på polisen', stepText: 'Sköt på polisen igen' },
    copKill: { base: 4, cap: 5, heat: 3, step: true, stepGap: 2, dedupe: 0.5, text: 'Sänkte en polis', stepText: 'Sänkte ännu en polis' },
    alarm: { base: 1, cap: MAX_LEVEL, heat: 1, text: 'Larm' }   // larm (bankrån, uppdrag): nivån anges vid anropet
};

const PHASES = ['calm', 'stop', 'chase', 'search'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function createPolice() {
    return {
        level: 0, phase: 'calm', reason: '', phaseT: 0,
        incidents: [],      // historik: { id, kind, level, text, t, x, y }
        heat: 0,
        lastSeen: null,     // senast kända plats — uppdateras BARA när en snut faktiskt ser dig
        seenT: 99,          // sekunder sedan någon snut såg dig
        searchT: 0,         // sökningens nedräkning
        stop: null,         // trafikstopp: { t, max, still, talk, wait }
        incident: null,     // pågående insats
        seq: 0,             // insatsernas id-räknare
        record: 0,          // avslutade insatser (sparas)
        ended: null,        // { text, why, t } — syns en stund efter avslut
        lastEnd: null,      // hur förra insatsen slutade (finns kvar)
        known: null,        // dörren de såg dig gå in genom ({x,y}) — platsen är känd
        flash: 0,           // HUD blinkar när nivån stiger
        time: 0,            // polisens egen klocka
        alarmPos: false     // ett larm utan plats: världen fyller i var du är just nu
    };
}

// ── Nivåer och tak ──
export function levelName(level) { return LEVELS[clamp(level | 0, 0, MAX_LEVEL)].name; }
export function carCap(level) { return LEVELS[clamp(level | 0, 0, MAX_LEVEL)].cars; }
export function footCap(level) { return LEVELS[clamp(level | 0, 0, MAX_LEVEL)].foot; }
// Fartfaktor för jagande polisbilar: fast per nivå (ingen gummibandsfart), aldrig över 1
export function chaseSpeed(level) { return Math.min(1, LEVELS[clamp(level | 0, 0, MAX_LEVEL)].speed); }
export function chaseGas(level) { return Math.min(1, LEVELS[clamp(level | 0, 0, MAX_LEVEL)].gas); }
export function sightRange(level) { return LEVELS[clamp(level | 0, 0, MAX_LEVEL)].sight; }
export function cornerSpeed(level) { return LEVELS[clamp(level | 0, 0, MAX_LEVEL)].corner; }
// Skjuter polisen? Aldrig på nivå 1–2. Nivå 3 bara om du själv bär skjutvapen, nivå 4–5 alltid.
export function copsArmed(level, playerArmed = false) { return level >= 4 || (level >= 3 && !!playerArmed); }
// Gripande och fängelse bara för det som motiverar det. Nivå 1–2 löses med bot/varning.
export function arrestMeans(level) { return level >= 3 ? 'busted' : 'fine'; }
export function lostAfter(level) { return POLICE.lostAfter[clamp(level | 0, 0, MAX_LEVEL)]; }
// Hur många polisbilar insatsen ska ha just nu
export function wantedUnits(P) {
    if (P.phase === 'stop') return 1;
    if (P.phase === 'chase' || P.phase === 'search') return carCap(P.level);
    return 0;
}
export function patrolTarget(P) { return POLICE.patrol + (P.heat >= POLICE.patrolHeat ? 1 : 0); }
export function stopWindow(speed = 0) { return clamp(POLICE.stopWindow + Math.max(0, speed) / 90, POLICE.stopWindow, POLICE.stopWindowMax); }

// Är något på gång (stopp, jakt eller sökning)?
export function active(P) { return P.phase !== 'calm'; }

function newIncident(P, at) {
    P.seq++;
    P.incident = {
        id: P.seq, t0: P.time, kinds: {}, last: {}, stepT: -1e9,
        faultContacts: 0, lastFaultT: -1e9, copDamage: 0, heat0: P.heat,
        start: at ? { x: at.x, y: at.y } : null
    };
    return P.incident;
}

function log(P, kind, text, at) {
    P.incidents.push({ id: P.incident ? P.incident.id : P.seq, kind, level: P.level, text, t: Math.round(P.time * 10) / 10, x: at ? Math.round(at.x) : null, y: at ? Math.round(at.y) : null });
    if (P.incidents.length > 30) P.incidents.splice(0, P.incidents.length - 30);
}

function setPhase(P, phase) {
    if (P.phase === phase) return;
    P.phase = phase;
    P.phaseT = 0;
    if (phase !== 'stop') P.stop = null;
    if (phase === 'search') P.searchT = LEVELS[P.level].search;
}

// ── En händelse som polisen upptäckt ──
// opts: { witnessed = true, at: {x,y} (där det hände), speed (spelarens fart, för stoppfönstret), level (bara 'alarm'), text }
// Returnerar null om inget hände, annars { kind, level, raised, text }.
export function report(P, kind, opts = {}) {
    const ev = EVENTS[kind];
    if (!ev || opts.witnessed === false) return null;   // ett brott ingen snut ser får inga följder
    const inc = P.incident || newIncident(P, opts.at);
    const lastK = inc.last[kind] ?? -1e9;
    if (P.time - lastK < (ev.dedupe ?? 1)) return null; // samma händelse rapporterad igen (t.ex. flera bildrutor i rad)
    if (ev.once && inc.kinds[kind]) return null;
    inc.last[kind] = P.time;
    inc.kinds[kind] = (inc.kinds[kind] || 0) + 1;
    const before = P.level;
    let cand = kind === 'alarm' ? clamp(opts.level | 0, 1, MAX_LEVEL) : ev.base;
    const cap = kind === 'alarm' ? cand : ev.cap;
    let text = opts.text || ev.text;
    // En ny, separat upprepning av samma sak höjer ett steg — men aldrig över händelsens tak
    if (ev.step && inc.kinds[kind] > 1 && before >= ev.base && P.time - inc.stepT >= (ev.stepGap ?? 3)) {
        cand = before + 1;
        text = ev.stepText || text;
    }
    const level = Math.max(before, Math.min(cap, cand));
    const raised = level > before;
    P.level = level;
    if (raised) { inc.stepT = P.time; P.flash = 2; }
    if (raised || !P.reason) P.reason = text;
    P.heat = Math.min(POLICE.heatMax, P.heat + (ev.heat || 0));
    if (opts.at) { P.lastSeen = { x: opts.at.x, y: opts.at.y }; P.seenT = 0; }
    else if (kind === 'alarm') P.alarmPos = true;
    // Vad polisen gör nu
    if (P.level >= 2) {
        setPhase(P, 'chase');
        if (kind !== 'ignoredStop' || opts.at) P.seenT = 0;
    } else if (P.level === 1 && P.phase === 'calm') {
        setPhase(P, 'stop');
        const max = stopWindow(opts.speed || 0);
        P.stop = { t: max, max, still: 0, talk: 0, wait: 0 };
    } else if (P.phase === 'search') setPhase(P, 'chase');
    P.ended = null;
    log(P, kind, text, opts.at);
    return { kind, level, raised, text };
}

// Larm (bankrån, gängets uppdrag): nivån direkt, och de vet var du är just nu
export function alarm(P, level, text = 'Larm', at = null) {
    return report(P, 'alarm', { level, text, at });
}

// ── Krockar ──
// Bedöm en kontakt mellan spelarens bil (pv) och en annan (ov). n = enhetsvektor från
// spelaren mot den andra. Hastigheterna ska vara de FÖRE studsen. input = { throttle, pushedT }.
// Skyldig: spelaren rör sig mot den andra (minst faultSpeed) och minst lika fort som den andra
// rör sig mot spelaren — en polis som kör in i en stillastående eller väjande spelare ger inget brott.
// Medveten: dessutom gas åt det hållet, nosen (eller bakänden vid back) mot målet och fart.
export function judgeContact(pv, ov, n, input = {}, cfg = POLICE) {
    const pApp = Math.max(0, pv.vx * n.x + pv.vy * n.y);
    const oApp = Math.max(0, -(ov.vx * n.x + ov.vy * n.y));
    const pushed = (input.pushedT ?? 99) < cfg.pushGrace;
    const fault = !pushed && pApp >= cfg.faultSpeed && pApp >= oApp * 0.8;
    const facing = Math.cos(pv.angle || 0) * n.x + Math.sin(pv.angle || 0) * n.y;
    const th = input.throttle || 0;
    const gas = (th > 0.4 && facing > 0.75) || (th < -0.4 && facing < -0.75);
    return { pApp, oApp, fault, deliberate: fault && gas && pApp >= cfg.ramSpeed, pushed };
}

// En ny (separerad) kontakt där spelaren är skyldig mot en polisbil. Första kontakten i en
// insats är en buckla (1) eller en hård krock (2). Därefter räknas bara medvetna ramningar
// (gas + styrning mot målet, efter tydlig separation) — en oavsiktlig kontakt mitt i en jakt
// höjer ingenting. Returnerar händelsens namn eller null.
export function copContactKind(P, { deliberate, impact = 0, damage = 0 }, cfg = POLICE) {
    const inc = P.incident;
    const prior = inc ? inc.faultContacts : 0;
    if (prior === 0) return impact >= cfg.crashImpact || damage >= cfg.crashDamage ? 'crash' : 'bump';
    if (!deliberate) return null;
    if (P.time - inc.lastFaultT < cfg.ramGap) return null;
    return 'ram';
}

// Registrera kontakten: händelsen (om någon) och skadan på polisbilen
export function copContact(P, info, opts = {}) {
    const kind = copContactKind(P, info);
    let res = null;
    if (kind) res = report(P, kind, opts);
    const inc = P.incident;
    if (inc) {
        inc.faultContacts++;
        inc.lastFaultT = P.time;
        inc.copDamage += Math.max(0, info.damage || 0);
    }
    return res;
}

// Kontaktbok: en sammanhängande kontakt per fordonspar (stabil identitet = bilarnas id).
// En ny kontakt börjar först när paret varit isär minst sepTime. Skada räknas bara från
// smällen när kontakten börjar (relativ fart), eller en tydligt hårdare ny smäll mitt i den.
export function createContacts() { return new Map(); }
export function pairKey(a, b) { return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`; }
export function touchContact(book, a, b, impact, now, cfg = POLICE) {
    const k = pairKey(a, b);
    let c = book.get(k);
    const fresh = !c || now - c.last > cfg.sepTime;
    if (fresh) {
        c = { first: now, last: now, peak: impact, n: (c ? c.n : 0) + 1 };
        book.set(k, c);
        return { fresh: true, smash: impact, prev: 0, c };
    }
    c.last = now;
    if (impact > c.peak + cfg.reSmash) {
        const prev = c.peak;
        c.peak = impact;
        return { fresh: false, smash: impact, prev, c };
    }
    c.peak = Math.max(c.peak, impact);
    return { fresh: false, smash: 0, prev: c.peak, c };
}
export function pruneContacts(book, now, cfg = POLICE) {
    for (const [k, c] of book) if (now - c.last > cfg.sepTime * 3) book.delete(k);
}

// ── Varje steg ──
// s = { playing, sees, pos: {x,y}, speed, nearCop (en polis inom talkRange med fri sikt),
//       inside (i ett rum/ställe), known (de såg dig gå in) }
// Returnerar händelser för världen: { type: 'stopDone' | 'stopIgnored' | 'lost' | 'spotted' | 'ended', ... }
export function tickPolice(P, dt, s = {}) {
    const out = [];
    P.time += dt;
    P.phaseT += dt;
    P.flash = Math.max(0, P.flash - dt);
    if (P.ended && P.time - P.ended.t > POLICE.endShow) P.ended = null;
    // Gripen, död eller i en meny som stoppar spelet: inga nya brott och inga timers
    if (s.playing === false) return out;
    if (P.alarmPos && s.pos) { P.lastSeen = { x: s.pos.x, y: s.pos.y }; P.seenT = 0; P.alarmPos = false; }
    const seen = !!s.sees && !s.inside && P.level > 0;
    if (seen) { P.seenT = 0; if (s.pos) P.lastSeen = { x: s.pos.x, y: s.pos.y }; }
    else P.seenT += dt;

    switch (P.phase) {
        case 'stop': {
            const st = P.stop || (P.stop = { t: POLICE.stopWindow, max: POLICE.stopWindow, still: 0, talk: 0, wait: 0 });
            // Inne på ett ställe de vet om: de väntar utanför och vill prata när du kommer ut
            if (s.inside && s.known) { st.still = 0; st.talk = 0; break; }
            st.t -= dt;
            const still = (s.speed || 0) < POLICE.stillSpeed;
            st.still = still ? st.still + dt : 0;
            if (st.still >= POLICE.stopStill && s.nearCop) {
                st.talk += dt;
                if (st.talk >= POLICE.stopTalk) out.push({ type: 'stopDone' });
            } else if (!still) st.talk = 0;
            if (st.t <= 0 && P.phase === 'stop' && !out.length) {
                if (st.still < POLICE.stopStill) {
                    // Struntade i stoppet: registreras EN gång, sedan begränsad jakt
                    const r = report(P, 'ignoredStop', { at: seen ? s.pos : null });
                    if (!seen) setPhase(P, 'search');
                    out.push({ type: 'stopIgnored', res: r });
                } else if ((st.wait += dt) > POLICE.stopWait) {
                    endIncident(P, 'noshow', 'Polisen hann aldrig fram – du är fri');
                    out.push({ type: 'ended', why: 'noshow' });
                }
            }
            break;
        }
        case 'chase':
            if (P.seenT > lostAfter(P.level)) {
                setPhase(P, 'search');
                out.push({ type: 'lost' });
            }
            break;
        case 'search':
            if (seen) {
                setPhase(P, 'chase');   // ny faktisk upptäckt: jakten börjar om (samma insats)
                out.push({ type: 'spotted' });
                break;
            }
            // Inne på ett ställe de såg dig gå in i: de väntar utanför (klockan står)
            if (!(s.inside && s.known)) P.searchT -= dt;
            if (P.searchT <= 0) {
                endIncident(P, 'lost', 'Polisen gav upp sökningen');
                out.push({ type: 'ended', why: 'lost' });
            }
            break;
    }
    // Trycket avtar när inget pågår (och långsamt medan de söker)
    if (P.phase === 'calm') P.heat = Math.max(0, P.heat - POLICE.heatDecay * dt);
    else if (P.phase === 'search') P.heat = Math.max(0, P.heat - POLICE.heatDecay * 0.3 * dt);
    return out;
}

// Avsluta insatsen. Nivån går till 0, historiken och trycket finns kvar.
export function endIncident(P, why, text) {
    if (P.incident || P.level > 0) {
        log(P, 'end:' + why, text, null);
        P.record++;
    }
    P.level = 0;
    P.incident = null;
    P.stop = null;
    P.searchT = 0;
    P.known = null;
    P.alarmPos = false;
    P.reason = '';
    setPhase(P, 'calm');
    P.ended = { text, why, t: P.time };
    P.lastEnd = P.ended;
}

// Sänk nivån (frisören, mutor). Når den 0 är insatsen över.
export function reduceLevel(P, n, text) {
    if (P.level <= 0) return false;
    P.level = Math.max(0, P.level - n);
    if (P.level === 0) endIncident(P, 'cleared', text);
    else {
        if (P.phase === 'search') P.searchT = Math.min(P.searchT, LEVELS[P.level].search);
        P.reason = text;
        log(P, 'reduce', text, null);
    }
    return true;
}

export function clearPolice(P, text = 'Polisen släppte det') {
    if (P.level <= 0 && !P.incident) return false;
    endIncident(P, 'cleared', text);
    return true;
}

// Sågs du gå in genom en dörr? Då är platsen känd: sökningen står still medan du är inne
// och de väntar utanför. Annars kan tiden inne bidra till att sökningen tar slut.
export function enteredPlace(P, door, seen) {
    if (!active(P)) return;
    if (seen) {
        P.known = { x: door.x, y: door.y };
        P.lastSeen = { x: door.x, y: door.y };
        P.seenT = 0;
        log(P, 'seenEnter', 'Polisen såg dig gå in', door);
    }
    if (P.phase === 'chase') setPhase(P, 'search');
}
export function leftPlace(P) {
    if (P.known && active(P)) {
        P.seenT = 0;
        if (P.phase === 'search') setPhase(P, 'chase');
        // Trafikstopp: de väntade utanför — ett nytt fönster att stanna och prata
        if (P.phase === 'stop' && P.stop) P.stop.t = Math.max(P.stop.t, POLICE.stopWindow);
    }
    P.known = null;
}

// ── Trafikstoppets besked ──
// Varning: en liten incident (bara buckla/småsak), ingen skada värd att nämna och lågt tryck innan.
// Annars bot (+ reparation av polisbilen). Har man inte råd: man betalar det man har och resten
// blir samhällstjänst (klockan går) — en tydlig, begränsad följd som inte låser spelet.
export function stopOutcome(P, money, cfg = POLICE) {
    const inc = P.incident || { kinds: {}, copDamage: 0, heat0: 0 };
    const level = Math.max(1, Math.min(2, P.level));
    const kinds = Object.keys(inc.kinds);
    const minor = level <= 1 && kinds.every(k => EVENTS[k]?.minor);
    const repair = Math.round(Math.min(cfg.repairCap, (inc.copDamage || 0) * cfg.repairPerHp) / 10) * 10;
    if (minor && inc.heat0 < 1 && repair < 50) return { warning: true, fine: 0, repair: 0, total: 0, paid: 0, short: 0 };
    const fine = minor ? Math.round(cfg.fine[1] / 2) : cfg.fine[level];
    const total = fine + repair;
    const paid = Math.max(0, Math.min(Math.floor(money || 0), total));
    return { warning: false, fine, repair, total, paid, short: total - paid };
}
export function outcomeText(o) {
    if (o.warning) return 'Varning – kör försiktigt. Du är fri att åka.';
    const kr = n => n.toLocaleString('sv-SE') + ' kr';
    const what = o.repair ? `bot ${kr(o.fine)} + reparation ${kr(o.repair)}` : `bot ${kr(o.fine)}`;
    if (o.short > 0) return `${what} – du hade bara ${kr(o.paid)}. Resten blir ${POLICE.serviceHours} timmars samhällstjänst.`;
    return `${what} betald. Du är fri.`;
}

// ── HUD:ens bild av läget ──
export function policeStatus(P) {
    const L = LEVELS[clamp(P.level | 0, 0, MAX_LEVEL)];
    const st = { level: P.level, name: L.name, phase: P.phase, action: '', countdown: null, reason: P.reason || '', heat: P.heat, ended: P.ended, tone: 'calm' };
    switch (P.phase) {
        case 'stop': {
            const s = P.stop || {};
            if (P.known) { st.action = 'Polisen väntar utanför – de vill prata'; }
            else if (s.talk > 0) { st.action = 'Polisen pratar med dig – stå kvar'; st.countdown = Math.max(0, POLICE.stopTalk - s.talk); }
            else if ((s.t ?? 0) > 0) { st.action = 'Polisen vill prata – stanna på en säker plats'; st.countdown = s.t; }
            else { st.action = 'Väntar på polisen – stå kvar'; }
            st.tone = 'stop';
            break;
        }
        case 'chase': st.action = 'JAGAR DIG'; st.tone = 'chase'; break;
        case 'search':
            st.action = P.known ? 'Väntar utanför – de såg dig gå in' : 'SÖKER där du sågs senast';
            st.countdown = P.known ? null : Math.max(0, P.searchT);
            st.tone = 'search';
            break;
        default:
            if (P.ended) { st.action = P.ended.text; st.tone = 'ended'; }
    }
    return st;
}

// ── Sparning (i profilen) ──
// Allt som behövs för att fortsätta efter omladdning, HEM eller en ny session. Fordonen
// (enheterna) sparas inte: dispatchern skickar nya utom synhåll.
export function policeSnapshot(P) {
    const inc = P.incident;
    return {
        v: 1, level: P.level, phase: P.phase, reason: P.reason, phaseT: Math.round(P.phaseT * 10) / 10,
        heat: Math.round(P.heat * 100) / 100, lastSeen: P.lastSeen ? { x: Math.round(P.lastSeen.x), y: Math.round(P.lastSeen.y) } : null,
        seenT: Math.min(99, Math.round(P.seenT * 10) / 10), searchT: Math.round(P.searchT * 10) / 10,
        stop: P.stop ? { t: Math.round(P.stop.t * 10) / 10, max: P.stop.max } : null,
        incident: inc ? { id: inc.id, kinds: { ...inc.kinds }, faultContacts: inc.faultContacts, copDamage: Math.round(inc.copDamage), heat0: inc.heat0 } : null,
        incidents: P.incidents.slice(-12), seq: P.seq, record: P.record,
        lastEnd: P.lastEnd ? { why: P.lastEnd.why, text: P.lastEnd.text } : null,
        known: P.known ? { x: Math.round(P.known.x), y: Math.round(P.known.y) } : null
    };
}

// Tillbaka från en sparning. Tvättar allt (sparfilen kan vara gammal eller från nätet).
// En jakt som pågick blir en sökning där de såg dig sist: när du kommer tillbaka ser ingen dig.
export function restorePolice(raw) {
    const P = createPolice();
    if (!raw || typeof raw !== 'object') return P;
    P.level = clamp(Math.floor(num(raw.level)), 0, MAX_LEVEL);
    P.heat = clamp(num(raw.heat), 0, POLICE.heatMax);
    P.seq = Math.max(0, Math.floor(num(raw.seq)));
    P.record = Math.max(0, Math.floor(num(raw.record)));
    P.reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 80) : '';
    const pt = p => (p && typeof p === 'object' && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: Number(p.x), y: Number(p.y) } : null);
    P.lastSeen = pt(raw.lastSeen);
    P.known = pt(raw.known);
    if (raw.lastEnd && typeof raw.lastEnd === 'object') P.lastEnd = { why: String(raw.lastEnd.why || '').slice(0, 20), text: String(raw.lastEnd.text || '').slice(0, 80), t: -1e9 };
    if (Array.isArray(raw.incidents)) {
        P.incidents = raw.incidents.slice(-30).filter(e => e && typeof e === 'object').map(e => ({
            id: Math.floor(num(e.id)), kind: String(e.kind || '').slice(0, 20), level: clamp(Math.floor(num(e.level)), 0, MAX_LEVEL),
            text: String(e.text || '').slice(0, 80), t: num(e.t), x: e.x === null ? null : num(e.x), y: e.y === null ? null : num(e.y)
        }));
    }
    const phase = PHASES.includes(raw.phase) ? raw.phase : 'calm';
    if (P.level === 0) { P.phase = 'calm'; return P; }
    const ri = raw.incident && typeof raw.incident === 'object' ? raw.incident : {};
    P.incident = {
        id: Math.floor(num(ri.id, P.seq)) || P.seq, t0: 0, kinds: {}, last: {}, stepT: -1e9,
        faultContacts: Math.max(0, Math.floor(num(ri.faultContacts))), lastFaultT: -1e9,
        copDamage: Math.max(0, num(ri.copDamage)), heat0: clamp(num(ri.heat0), 0, POLICE.heatMax), start: null
    };
    if (ri.kinds && typeof ri.kinds === 'object') for (const [k, n] of Object.entries(ri.kinds)) if (EVENTS[k]) P.incident.kinds[k] = Math.max(0, Math.floor(num(n)));
    if (phase === 'stop' || (phase === 'calm' && P.level === 1)) {
        const max = clamp(num(raw.stop?.max, POLICE.stopWindow), POLICE.stopWindow, POLICE.stopWindowMax);
        P.phase = 'stop';
        P.stop = { t: clamp(num(raw.stop?.t, max), 0.5, max), max, still: 0, talk: 0, wait: 0 };
        P.alarmPos = !P.lastSeen;
    } else {
        // Jakt eller sökning: de letar där de såg dig sist (eller väntar vid dörren)
        P.phase = 'search';
        P.searchT = clamp(num(raw.searchT, LEVELS[P.level].search), 1, LEVELS[P.level].search);
        if (phase === 'chase') P.searchT = LEVELS[P.level].search;
        if (!P.lastSeen) P.alarmPos = true;
    }
    P.seenT = 99;
    return P;
}
