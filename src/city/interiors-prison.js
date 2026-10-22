// ═══════════════════════════════════════════
//  STAN — fängelset Kåken
//  Ett gångbart rum: cellblock A med sex celler, vaktrum
//  bakom glas, matsal med serveringslucka, rastgård med
//  basketkorg, gym och vakttorn, besöksrum med glasbås,
//  direktörens kontor och porten med slussen.
//
//  Fångarna lever sitt liv (basket, skivstång, mat, kort,
//  cellen, gården), vakterna går sina rundor och besökare
//  kommer in genom porten, sätter sig i ett bås och går.
//
//  Världen sätter (sekunder, räknas ner här):
//    state.lockdown   larm: fångarna in i cellerna, gallret stängs, vakterna till slussen
//    state.riot       bråk på gården: fångarna samlas i grupper och skriker
//    state.panic      slagsmål (brawl.js): fångarna samlas runt och hejar, besökarna går
//    state.lockCells  [i] = true håller cell i:s gallerdörr stängd (t.ex. spelarens)
//  state.prison.doors[i] = hur öppen cell i:s gallerdörr är (1 öppen, 0 stängd).
//  Gallerdörrarna är gångbara rutor — stängda dörrar ritas bara (kollision sköts av världen).
//
//  Barbråk (brawl.js): n.brawl → vi rör inte NPC:n. Efteråt (leaving) går
//  fångar till sin cell, vakter tillbaka på sin runda och besökare ut och bort.
// ═══════════════════════════════════════════

import { registerInterior, KIT } from './interiors.js';

const {
    TS, PI, TAU, tc, rand, pick, clamp, SKINS, HAIRS, SHIRTS, SIGN_FONT,
    makeNpc, trySay, turnToward, chAt, solidTile, circleClear,
    tileHash, rgba, rr, disc, box, softShadow, neonText, zoneAt, eachTile, sprite,
    wallPass, aoPass, plankFloor, plantAt, exitArrow
} = KIT;

// ═══════════════════════════════════════════
//  RUTNÄTET
//  Egna tecken (LEGEND är gemensam för alla rum):
//   [ brits   { toalett   | galler   " glas   _ serveringsdisk   < bord   > pall/bänk
//   ] skrivbord/konsol   } skåp/skärm   ' flagga/växt   , staket   : gym   ^ basketkorg   ` vakttorn
// ═══════════════════════════════════════════

const W = 32, H = 24;
const CELL_X = [1, 5, 9, 13, 17, 21];        // cellernas vänsterkant (ruta), tre rutor breda
const PLAYER_CELL = 0;                       // spelarens cell (längst till vänster, mot ytterväggen)
const BOOTH_X = [2, 4, 6, 8];                // besöksbåsens pallar
const NPC_BOOTHS = [0, 1, 2];                // bås 3 är spelarens (def.visit)
const VISIT_DOOR = [11, 21];                 // dörren hallen → besökssidan

const ROWS = (() => {
    const g = Array.from({ length: H }, () => Array(W).fill('#'));
    const rect = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g[y][x] = c; };
    const set = (x, y, c) => { g[y][x] = c; };
    // Cellblock A: brits och toalett i varje cell, galler med en dörr mot korridoren
    for (const x0 of CELL_X) {
        rect(x0, 1, 3, 3, '.');
        set(x0, 1, '['); set(x0, 2, '['); set(x0 + 2, 1, '{');
        set(x0, 4, '|'); set(x0 + 1, 4, '+'); set(x0 + 2, 4, '|');
    }
    // Vaktrummet: konsol med monitorer, nyckelskåp, glasruta mot korridoren
    rect(25, 1, 6, 3, '.'); rect(25, 1, 4, 1, ']'); set(30, 1, '}');
    rect(25, 4, 6, 1, '"'); set(29, 4, '+');
    // Korridoren, dörrar till matsalen och gården
    rect(1, 5, 30, 2, '.');
    set(8, 7, '+'); set(9, 7, '+'); set(21, 7, '+'); set(22, 7, '+');
    // Matsalen: köket (rad 8) bakom serveringsdisken, långbord med bänkar, kortbordet
    rect(1, 8, 10, 7, '.');
    rect(1, 9, 6, 1, '_');
    rect(2, 11, 6, 1, '>'); rect(2, 12, 6, 1, '<'); rect(2, 13, 6, 1, '>');
    set(9, 12, '<'); set(9, 11, '>'); set(9, 13, '>');
    set(1, 15, '+');
    // Besöksrummet: glasvägg med fyra bås, fångsidan uppe och besökssidan nere
    rect(1, 16, 10, 7, '.');
    rect(1, 19, 10, 1, '"');
    for (const bx of BOOTH_X) { set(bx, 18, '>'); set(bx, 20, '>'); set(bx + 1, 18, '}'); set(bx + 1, 20, '}'); }
    set(VISIT_DOOR[0], VISIT_DOOR[1], '+');
    // Direktörens kontor: skrivbord, arkivskåp, flagga, växt, fönster mot gården
    rect(12, 8, 6, 5, '.');
    set(12, 8, '}'); set(17, 8, "'"); set(14, 10, ']'); set(15, 10, ']'); set(17, 12, "'");
    set(18, 9, '"'); set(18, 10, '"');
    set(13, 13, '+');
    // Hallen innanför porten: väntbänk, vaktens lucka, porten
    rect(12, 14, 6, 9, '.');
    set(12, 15, '>'); set(12, 16, '>');
    set(16, 20, ']'); set(17, 20, ']');
    set(14, 23, 'e'); set(15, 23, 'e');
    // Staketet mellan hallen och gården, slussgrinden
    rect(18, 14, 1, 9, ','); set(18, 18, '+');
    // Rastgården: basketkorg, gym, bänkar, vakttornet i hörnet
    rect(19, 8, 12, 15, '.');
    set(25, 8, '^');
    set(20, 20, ':'); set(20, 21, ':'); set(22, 22, ':');
    rect(24, 22, 3, 1, '>');
    rect(29, 21, 2, 2, '`');
    return g.map(r => r.join(''));
})();

const RIM = { x: tc(25), y: 8 * TS + 26 };   // korgens ring (px)
const PAYPHONE = { x: 26, y: 17 * TS + 9 };  // telefonautomaten på väggen

const PRISON_DEF = {
    id: 'prison', name: 'Kåken', theme: 'prison', w: W, h: H,
    rows: ROWS,
    legend: {
        '[': { name: 'brits (säng)', solid: true },
        '{': { name: 'toalettstol', solid: true },
        '|': { name: 'gallervägg', solid: true },
        '"': { name: 'glasvägg', solid: true },
        _: { name: 'serveringsdisk', solid: true },
        '<': { name: 'bord', solid: true },
        '>': { name: 'sittpall', solid: true },
        ']': { name: 'skrivbord', solid: true },
        '}': { name: 'skåp', solid: true },
        "'": { name: 'flagga/växt', solid: true },
        ',': { name: 'staketvägg', solid: true },
        ':': { name: 'träningsbänk', solid: true },
        '^': { name: 'basketstolpe', solid: true },
        '`': { name: 'vakttorn (mur)', solid: true }
    },
    // besökarsidan innanför porten
    spawn: { x: 480, y: tc(21) },
    exit: { x: 480, y: 23 * TS + 20, r: 22 },
    // där besökare (och fångar i undantagsfall) kommer in och går ut
    door: { x: 480, y: tc(22) },
    // slussgrinden mellan hallen och gården (vakterna springer hit vid larm)
    gate: { x: tc(18), y: tc(18) },
    // mitten av varje cell, gallerdörren och cellens ruta (px)
    cells: CELL_X.map(x0 => ({ x: tc(x0 + 1), y: tc(2), door: { x: tc(x0 + 1), y: tc(4) }, box: { x0: x0 * TS, y0: TS, x1: (x0 + 3) * TS, y1: 4 * TS } })),
    playerCell: PLAYER_CELL,
    yard: { x0: 19 * TS, y0: 8 * TS, x1: 31 * TS, y1: 23 * TS },
    // lös platta i spelarens cell (nedanför britsen)
    tunnel: { x: tc(1), y: tc(3) },
    // spelarens bås: stående platser framför pallarna, och pallarna
    visit: {
        inmate: { x: tc(BOOTH_X[3]), y: tc(17) }, visitor: { x: tc(BOOTH_X[3]), y: tc(21) },
        seatIn: { x: tc(BOOTH_X[3]), y: tc(18) }, seatOut: { x: tc(BOOTH_X[3]), y: tc(20) }
    },
    warden: { x: 480, y: 300 },
    interactions: [
        { id: 'bail', label: 'E — Vakten: borgen och frisläppning', x: 544, y: tc(21) - 6, r: 48 },
        { id: 'warden', label: 'E — Prata med direktören', x: 480, y: tc(11) - 4, r: 52 },
        { id: 'weights', label: 'E — Träna', x: tc(21) + 2, y: 21 * TS, r: 46 },
        { id: 'dealer', label: 'E — Snacka med Snus-Sune', x: tc(12), y: tc(6), r: 48 },
        { id: 'tunnel', label: 'E — Gräv', x: tc(1), y: tc(3), r: 40 },
        { id: 'phone', label: 'E — Ring crewet', x: tc(1), y: tc(17), r: 44 },
        { id: 'guard', label: 'E — Snacka med vakten', x: tc(28), y: tc(6), r: 50 }
    ],
    music: null,
    // golvytor (första träffen gäller)
    zones: [
        { x: 1, y: 8, w: 6, h: 1, kind: 'kitchen' },
        { x: 19, y: 18, w: 4, h: 5, kind: 'gym' },
        { x: 1, y: 1, w: 23, h: 3, kind: 'cells' },
        { x: 25, y: 1, w: 6, h: 3, kind: 'guard' },
        { x: 1, y: 5, w: 30, h: 2, kind: 'corridor' },
        { x: 1, y: 8, w: 10, h: 7, kind: 'mess' },
        { x: 1, y: 16, w: 10, h: 3, kind: 'visitIn' },
        { x: 1, y: 19, w: 10, h: 4, kind: 'visitOut' },
        { x: 12, y: 8, w: 6, h: 5, kind: 'office' },
        { x: 12, y: 14, w: 6, h: 9, kind: 'hall' },
        { x: 19, y: 8, w: 12, h: 15, kind: 'yard' }
    ]
};

// ═══════════════════════════════════════════
//  VÄGSÖKNING
//  Tre nät: personalen går överallt, fångarna aldrig i vaktrum,
//  kök, kontor, hall eller på besökssidan, besökarna bara i
//  hallen och på besökssidan.
// ═══════════════════════════════════════════

const NO_INMATE = new Set(['guard', 'kitchen', 'office', 'hall', 'visitOut']);
const navCache = new WeakMap();
function navOf(def, kind) {
    let N = navCache.get(def);
    if (!N) {
        const n = def.w * def.h;
        N = { staff: new Uint8Array(n), inmate: new Uint8Array(n), visitor: new Uint8Array(n) };
        for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
            const i = ty * def.w + tx, free = !solidTile(def, tx, ty), z = zoneAt(def, tx, ty), ch = def.rows[ty][tx];
            N.staff[i] = free ? 1 : 0;
            N.inmate[i] = free && !NO_INMATE.has(z) ? 1 : 0;
            N.visitor[i] = free && (z === 'hall' || z === 'visitOut' || ch === 'e' || (tx === VISIT_DOOR[0] && ty === VISIT_DOOR[1])) ? 1 : 0;
        }
        navCache.set(def, N);
    }
    return N[kind] || N.staff;
}
const tileIdx = (def, x, y) => clamp(Math.floor(y / TS), 0, def.h - 1) * def.w + clamp(Math.floor(x / TS), 0, def.w - 1);

const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const LOS_R = 7;
function lineClear(def, M, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 5);
    for (let i = 1; i < n; i++) {
        const k = i / n, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
        if (!M[tileIdx(def, x, y)] || !circleClear(def, x, y, LOS_R)) return false;
    }
    return true;
}

// Rutt (punkter) från (x0,y0) till (x1,y1): BFS över nätet, sedan sträckt. null = går inte.
function findPath(def, x0, y0, x1, y1, M) {
    const Wd = def.w, Hd = def.h, ix = (x, y) => y * Wd + x;
    const tileOf = (x, y) => [clamp(Math.floor(x / TS), 0, Wd - 1), clamp(Math.floor(y / TS), 0, Hd - 1)];
    const nearFree = (tx, ty, px, py) => {
        if (M[ix(tx, ty)]) return [tx, ty];
        let best = null, bd = Infinity;
        for (let r = 1; r <= 3 && !best; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = tx + dx, y = ty + dy;
                if (x < 0 || y < 0 || x >= Wd || y >= Hd || !M[ix(x, y)]) continue;
                const d = (tc(x) - px) ** 2 + (tc(y) - py) ** 2;
                if (d < bd) { bd = d; best = [x, y]; }
            }
        }
        return best;
    };
    const s = nearFree(...tileOf(x0, y0), x0, y0), g = nearFree(...tileOf(x1, y1), x1, y1);
    if (!s || !g) return null;
    const end = M[ix(...tileOf(x1, y1))] && circleClear(def, x1, y1, LOS_R) ? { x: x1, y: y1 } : { x: tc(g[0]), y: tc(g[1]) };
    let tiles = [];
    if (s[0] !== g[0] || s[1] !== g[1]) {
        const prev = new Int16Array(Wd * Hd).fill(-1), seen = new Uint8Array(Wd * Hd);
        const q = [ix(s[0], s[1])]; seen[q[0]] = 1;
        let found = false;
        for (let qi = 0; qi < q.length && !found; qi++) {
            const cur = q[qi], cx = cur % Wd, cy = (cur / Wd) | 0;
            for (let k = 0; k < 8; k++) {
                const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
                if (nx < 0 || ny < 0 || nx >= Wd || ny >= Hd) continue;
                const ni = ix(nx, ny);
                if (seen[ni] || !M[ni]) continue;
                if (k >= 4 && !(M[ix(nx, cy)] && M[ix(cx, ny)])) continue; // inte runt hörn
                seen[ni] = 1; prev[ni] = cur; q.push(ni);
                if (nx === g[0] && ny === g[1]) { found = true; break; }
            }
        }
        if (!found) return null;
        for (let c = ix(g[0], g[1]); c !== ix(s[0], s[1]); c = prev[c]) tiles.push({ x: tc(c % Wd), y: tc((c / Wd) | 0) });
        tiles.reverse();
    }
    const pts = [{ x: x0, y: y0 }, ...tiles, end];
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !lineClear(def, M, pts[i], pts[j])) j--;
        out.push(pts[j]); i = j;
    }
    return out;
}

// ═══════════════════════════════════════════
//  FOLK
//  Alla har n.p = { role, steps, si, mode, ... }. Steg:
//   { k:'go', x, y, run }                         gå dit
//   { k:'visit', x, y, a, pose, t, prop, say, give, jostle, shout }   gå dit och stanna en stund
//   { k:'sit', fx, fy, sx, sy, a, t, prop, lie, booth }   gå till (fx,fy), glid in på platsen, sitt/ligg
//   { k:'basket', t }                              spela basket runt korgen
//   { k:'vanish' }                                 försvinn (besökare som gått ut)
//  Personal loopar sitt manus (p.script), fångar väljer en ny aktivitet
//  när en är slut, besökare går ett varv och försvinner.
//  p.ov = 'lock' | 'riot' | 'panic' när ett larm styr NPC:n.
// ═══════════════════════════════════════════

const ORANGE = '#f97316';
const RUN = 112;          // springfart vid larm (px/s)
const LONG = [1e9, 1e9];  // "tills vidare"

const LINES_P = {
    guard: ['Röra på er!', 'Inga konstigheter.', 'Håll avståndet.', 'Tio minuter kvar.', 'Lugnt nu.', 'Jag ser dig.', 'Händerna synliga!', 'Rastgården stänger snart.'],
    inmate: ['Vad glor du på?', 'Jag är oskyldig, bror.', 'Har du snus?', 'Tre år kvar...', 'Advokaten fixar det.', 'Ingen tjallar här.', 'Kåken är kåken.', 'Maten är kass idag.', 'Ses på gården.', 'Vem tog min tvål?', 'Nästa vecka är jag ute.', 'Lugnt, lugnt.'],
    dealer: ['Psst... snus? Cigg?', 'Sune fixar allt.', 'Kontant eller prillor.', 'Behöver du nåt, bror?', 'Inga frågor, inga svar.'],
    warden: ['Ordning och reda.', 'Mitt fängelse, mina regler.', 'Ingen rymmer från Kåken.', 'Skicka in nästa.'],
    cook: ['Nästa!', 'Ta en bricka.', 'Kålpudding idag.', 'Ät upp nu.', 'Inga extra köttbullar!'],
    visitor: ['Hur mår du?', 'Mamma hälsar.', 'Vi saknar dig.', 'Håll huvudet kallt.', 'Advokaten ringer.']
};
const SAY = {
    basket: ['Passa!', 'Min boll!', 'Kör!', 'Försvar!'],
    bench: ['En till!', 'Lätt!', 'Pumpa!', 'Kolla armarna.'],
    curl: ['Brända armar.', 'Tio till.', 'Känn pumpen.'],
    queue: ['Vad är det idag?', 'Mer sås!', 'Fiskpinnar igen?'],
    eat: ['Är det här köttbullar?', 'Smakar kartong.', 'Skicka saltet.'],
    cards: ['Giv!', 'Jag är med.', 'Höjer två prillor.', 'Fusk!', 'Pass.'],
    rest: ['Zzz...', 'Lämna mig ifred.'],
    cell: ['Hemma igen...', 'Fyra väggar.', 'Tråkigt.'],
    hang: ['Läget?', 'Hört nåt nytt?', 'Han tjallade.', 'Snart ute.'],
    mill: ['Läget?', 'Har du en cigg?', 'Vakterna glor.'],
    phone: ['Hallå? Det är jag.', 'Fixa advokaten!', 'Skicka pengar.'],
    visitor: ['Hej älskling.', 'Hur är maten?', 'Vi fixar det här.'],
    booth: ['Besök? Till mig?', 'Äntligen!', 'Kommer!']
};
const LOCK_GUARD = ['INLÅSNING!', 'Alla in i cellerna!', 'Rör på er!', 'In, in, in!', 'Larm i blocket!'];
const LOCK_INMATE = ['Vad har hänt?', 'Släpp ut oss!', 'Inlåsning igen...', 'Det var inte jag!'];
const RIOT_LINES = ['Kom igen då!', 'Ut med vakterna!', 'Det här är vår gård!', 'Bättre mat!', 'Bråk! Bråk!', 'Vi tar dem!', 'Kåken är vår!'];
const RIOT_GUARD = ['Backa!', 'Lugna ner er!', 'Tillbaka!', 'Förstärkning till gården!'];
const CROWD_LINES = ['Slagsmål!', 'Kör, kör!', 'Ge honom!', 'Oooh!', 'Hörru!', 'Slå tillbaka!'];
const SCARED = ['Jag går nu!', 'Hjälp!', 'Vakten!', 'Inte här...'];

// ── Platser ──
const EAT_SEATS = [];
for (let x = 2; x <= 7; x++) {
    EAT_SEATS.push({ fx: tc(x), fy: tc(10), sx: tc(x), sy: tc(11) + 1, a: PI / 2 });
    EAT_SEATS.push({ fx: tc(x), fy: tc(14), sx: tc(x), sy: tc(13) - 1, a: -PI / 2 });
}
const CARD_SEATS = [
    { fx: tc(9), fy: tc(10), sx: tc(9), sy: tc(11) + 2, a: PI / 2 },
    { fx: tc(9), fy: tc(14), sx: tc(9), sy: tc(13) - 2, a: -PI / 2 },
    { fx: tc(10), fy: tc(12), sx: tc(10) - 1, sy: tc(12), a: PI },
    { fx: tc(8), fy: tc(12), sx: tc(8) + 1, sy: tc(12), a: 0 }
];
const BENCH_SEAT = { fx: tc(21), fy: 21 * TS, sx: tc(20), sy: 21 * TS, a: -PI / 2 };
const YARD_SEATS = [24, 25, 26].map(x => ({ fx: tc(x), fy: tc(21), sx: tc(x), sy: tc(22) - 3, a: -PI / 2 }));
const HANG_C = { x: tc(25), y: tc(18) };
const HANG = [0.4, 2.5, 4.5].map(a => ({ x: HANG_C.x + Math.cos(a) * 17, y: HANG_C.y + Math.sin(a) * 17, a: a + PI }));
const MILL = [{ x: tc(4), y: tc(6), a: -2.4 }, { x: tc(16), y: tc(6), a: -PI / 2 }, { x: tc(19) + 6, y: tc(5), a: PI }, { x: tc(24), y: tc(6), a: -PI / 2 }];
const WALK = [[20, 16], [28, 16], [28, 20], [24, 20]].map(([x, y]) => ({ x: tc(x), y: tc(y) }));
const COUNTER_X = [2, 3, 4, 5];
const GATE_SPOTS = [[19, 17], [19, 19], [20, 18], [17, 17], [17, 19], [20, 16], [20, 20], [16, 18]].map(([x, y]) => ({ x: tc(x), y: tc(y) }));
const RIOT_AT = [{ x: tc(23), y: tc(12) }, { x: tc(26) + 4, y: tc(18) - 4 }];
const COURT = { x0: 20 * TS + 8, y0: 9 * TS + 8, x1: 30 * TS + 20, y1: 15 * TS };

// ── Personalens manus ──
const V = (x, y, a, pose, t0, t1, o = {}) => ({ k: 'visit', x, y, a, pose, t: [t0, t1], ...o });
const CONSOLE_STEPS = [
    V(tc(26), tc(2) - 3, -PI / 2, 'sit', 14, 26),
    V(tc(27), tc(3), PI / 2, 'idle', 4, 8),
    V(tc(26), tc(2) - 3, -PI / 2, 'sit', 12, 22),
    V(tc(29), tc(1) + 4, 0, 'work', 3, 5)
];
const GATE_STEPS = [
    V(544, tc(19), PI / 2, 'idle', 10, 18),
    V(tc(14), tc(21) + 4, PI / 2, 'idle', 3, 6),
    V(544, tc(19), PI / 2, 'idle', 8, 14),
    V(tc(17), tc(17), 0, 'idle', 3, 6)
];
const BRIBE_STEPS = [V(tc(28), tc(6), PI, 'idle', 8, 14), V(tc(27), tc(5), -PI / 2, 'idle', 3, 5)];
const CORRIDOR_STEPS = [...CELL_X.map(x0 => V(tc(x0 + 1), tc(5), -PI / 2, 'idle', 2, 4)), V(tc(25), tc(6), PI, 'idle', 2, 4)];
const YARD_STEPS = [
    V(tc(20), tc(9), PI / 4, 'idle', 4, 8),
    V(tc(19), tc(15), 0, 'idle', 4, 8),
    V(tc(28), tc(16), -PI / 2, 'idle', 4, 9),
    V(tc(23), tc(17), -PI / 2, 'idle', 3, 6),
    V(tc(29), tc(12), PI, 'idle', 4, 8)
];
const VISIT_STEPS = [V(tc(10), tc(17), PI, 'idle', 8, 14), V(tc(10), tc(16), PI * 0.75, 'idle', 5, 9), V(tc(5), tc(16), PI / 2, 'idle', 3, 6)];
const WARDEN_STEPS = [
    V(480, 300, PI / 2, 'sit', 14, 26),
    V(tc(17), 320, 0, 'idle', 5, 10),
    V(480, 300, PI / 2, 'sit', 10, 20),
    V(tc(13), tc(8), PI, 'work', 3, 5)
];
const COOK_STEPS = [V(tc(2), tc(8), PI / 2, 'work', 3, 7), V(tc(4), tc(8), PI / 2, 'work', 3, 7), V(tc(6), tc(8), PI / 2, 'work', 3, 6)];
const DEALER_STEPS = [V(tc(12), tc(6) + 2, -PI / 2, 'idle', 10, 22), V(tc(13) + 4, tc(6), -PI * 0.7, 'idle', 3, 6)];

// ── Utseenden ──
const GUARD_SHIRTS = ['#1e3a5f', '#1c355a', '#21406a'];
const guardLook = rnd => ({ shirt: pick(rnd, GUARD_SHIRTS), skin: pick(rnd, SKINS), hair: pick(rnd, ['#111111', '#1f1300', '#5b3a1a', '#3f2a14']), cap: '#0c1729' });
function inmateLook(rnd) {
    const skin = pick(rnd, SKINS);
    const L = { shirt: ORANGE, skin, hair: rnd() < 0.22 ? skin : pick(rnd, HAIRS) };
    const r = rnd();
    if (r < 0.12) L.cap = '#1f2937'; else if (r < 0.2) L.cap = '#991b1b';
    return L;
}
function visitorLook(rnd) {
    const L = { shirt: pick(rnd, SHIRTS), skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) };
    if (rnd() < 0.45) { L.dress = pick(rnd, ['#be123c', '#7c3aed', '#0ea5e9', '#f8fafc', '#15803d', '#a16207']); L.shirt = L.dress; }
    return L;
}

function actor(kind, role, x, y, rnd, o = {}) {
    const n = makeNpc(kind, x, y, rnd, { look: o.look, beh: 'prison', angle: o.angle || 0, pose: 'idle' });
    n.lines = o.lines || null;
    n.chatT = rand(rnd, 4, 22);
    n.p = {
        role, nav: role === 'inmate' ? 'inmate' : role === 'visitor' ? 'visitor' : 'staff',
        steps: [], si: 0, dir: 1, mode: 'new', path: null, pi: 0, tx: x, ty: y, wait: 0,
        speed: o.speed || 40, run: false, loop: false, order: o.order || 'seq', watch: !!o.watch,
        script: null, seat: null, slide: null, after: null, slot: null, act: null,
        cell: o.cell == null ? -1 : o.cell, spot: o.spot || 0, face: o.angle || 0, bx: x, by: y,
        ov: null, homing: false, brawled: false, bt: 0, bwalk: false, bspeed: 60, shoutT: rand(rnd, 1, 4),
        tag: o.tag || null, gi: 0, grp: 0, cx: 0, cy: 0, inBooth: -1, partner: null, visitor: null, partnerT: 0
    };
    if (o.staff) n.staff = true;
    if (o.name) n.name = o.name;
    return n;
}

// ═══════════════════════════════════════════
//  RUMMETS TILLSTÅND
// ═══════════════════════════════════════════

function prisonOf(state, rnd) {
    let P = state.prison;
    if (!P) {
        P = state.prison = {
            taken: new Map(), doors: CELL_X.map(() => 1),
            lockOn: false, lockT: 0, riotOn: false, riotT: 0, panicOn: false, crowdT: 0,
            visT: rand(rnd, 12, 24), shoutT: 1, depth: 0,
            ball: { mode: 'loose', x: tc(24), y: tc(12), vx: 0, vy: 0, holder: null, to: null, from: null, x0: 0, y0: 0, tx: 0, ty: 0, z0: 0, z1: 0, k: 0, dur: 1, peak: 0, hold: 0, wait: 0.5, made: false, swish: 0 },
            st: state, def: state.def, rnd
        };
        for (const n of state.npcs) if (n.p && n.p.slot) P.taken.set(n.p.slot, n);
        if (!Array.isArray(state.lockCells)) state.lockCells = CELL_X.map(() => false);
        if (!(state.lockdown >= 0)) state.lockdown = 0;
        if (!(state.riot >= 0)) state.riot = 0;
    }
    P.st = state; P.rnd = rnd;
    return P;
}

const inBox = (n, b) => n.x >= b.x0 && n.x < b.x1 && n.y >= b.y0 && n.y < b.y1;
const inCell = (def, n, i) => i >= 0 && inBox(n, def.cells[i].box);
const inYard = (def, n) => inBox(n, def.yard);
const restKey = n => 'r' + n.p.cell + '_' + n.p.spot;
function walkableAt(def, M, x, y) { return M[tileIdx(def, x, y)] === 1 && circleClear(def, x, y, 7); }

// ── Platser (en NPC per plats) ──
function slotFree(P, key) {
    const o = P.taken.get(key);
    return !o || o.dead || !o.p || o.p.slot !== key || !P.st.npcs.includes(o);
}
function take(P, n, key) {
    release(P, n);
    if (key) { P.taken.set(key, n); n.p.slot = key; }
}
function release(P, n) {
    const p = n.p;
    if (p.slot && P.taken.get(p.slot) === n) P.taken.delete(p.slot);
    p.slot = null;
    const B = P.ball;
    if (B.holder === n) looseBall(P, n);
    if (B.to === n) B.to = null;
    if (p.partner) { const m = p.partner; p.partner = null; if (m.p && m.p.visitor === n) m.p.visitor = null; }
    if (p.visitor) { const v = p.visitor; p.visitor = null; if (v.p && v.p.partner === n) v.p.partner = null; }
}

// ═══════════════════════════════════════════
//  MANUSLÄSAREN
// ═══════════════════════════════════════════

// Byt manus. Sitter man ner reser man sig först (glider ut), sen vidare.
function setSteps(P, n, steps, o = {}) {
    const p = n.p;
    if (!o.keepProp) { n.prop = null; n.phoneAt = null; }
    p.homing = !!o.homing;
    p.loop = !!o.loop;
    if (p.seat && (p.mode === 'stay' || p.mode === 'slide')) {
        p.slide = { x0: n.x, y0: n.y, x1: p.seat.fx, y1: p.seat.fy, t: 0, dur: 0.32, out: true };
        p.mode = 'slide'; p.after = steps; p.afterSi = o.si || 0;
        return;
    }
    p.seat = null; p.slide = null; p.after = null; n.lie = false;
    p.steps = steps; p.si = o.si || 0; p.dir = 1;
    startStep(P, n);
}

function startStep(P, n) {
    const p = n.p;
    if (P.depth > 3) { p.mode = 'stay'; p.wait = 1.5; p.steps = []; p.si = 0; return; } // inget går: stå still en stund
    P.depth++;
    try {
        for (let guard = 0; guard < 10; guard++) {
            if (p.si < 0 || p.si >= p.steps.length) { if (stepsDone(P, n)) continue; return; }
            const s = p.steps[p.si];
            p.run = !!s.run;
            if (s.k === 'vanish') { n.dead = true; p.mode = 'dead'; return; }
            if (s.k === 'basket') {
                p.mode = 'basket'; p.wait = rand(P.rnd, s.t[0], s.t[1]); p.bt = rand(P.rnd, 0.2, 1.2); p.bwalk = false; n.pose = 'idle';
                return;
            }
            const tx = s.k === 'sit' ? s.fx : s.x, ty = s.k === 'sit' ? s.fy : s.y;
            if (tx == null || Math.hypot(tx - n.x, ty - n.y) < 2) { arrive(P, n); return; }
            if (aim(P, n, tx, ty)) { p.mode = 'walk'; return; }
            p.si++; // går inte att nå: hoppa över
        }
        p.mode = 'stay'; p.wait = 2; p.steps = []; p.si = 0;
    } finally { P.depth--; }
}

// Manuset slut. true = kör vidare med p.steps
function stepsDone(P, n) {
    const p = n.p;
    if (p.loop && p.steps.length) { p.si = 0; return true; }
    if (p.role === 'inmate') {
        if (p.ov === 'lock') { setSteps(P, n, cellSteps(p.cell, p.spot, LONG, false)); return false; }
        if (p.ov) { p.mode = 'stay'; p.wait = 1e9; return false; }
        chooseActivity(P, n); return false;
    }
    if (p.role === 'visitor') { n.dead = true; p.mode = 'dead'; return false; }
    if (p.script) { setSteps(P, n, p.script, { loop: true }); return false; }
    p.mode = 'stay'; p.wait = 3; return false;
}

function nextStep(P, n) {
    const p = n.p, L = p.steps.length;
    if (p.loop && L > 1) {
        if (p.order === 'rand') {
            let i = Math.min(L - 1, Math.floor(P.rnd() * L));
            if (i === p.si) i = (i + 1) % L;
            p.si = i;
        } else if (p.order === 'ping') {
            if (p.si + p.dir >= L || p.si + p.dir < 0) p.dir = -p.dir;
            p.si += p.dir;
        } else p.si = (p.si + 1) % L;
    } else p.si++;
    startStep(P, n);
}

function aim(P, n, x, y) {
    const p = n.p, def = P.def;
    p.tx = x; p.ty = y;
    p.path = findPath(def, n.x, n.y, x, y, navOf(def, p.nav));
    if (!p.path && p.nav !== 'staff') p.path = findPath(def, n.x, n.y, x, y, navOf(def, 'staff'));
    p.pi = 0;
    return !!p.path;
}

function arrive(P, n) {
    const p = n.p, s = p.steps[p.si];
    if (!s || s.k === 'go') { nextStep(P, n); return; }
    if (s.k === 'sit') {
        p.seat = s;
        p.slide = { x0: n.x, y0: n.y, x1: s.sx, y1: s.sy, t: 0, dur: 0.45, out: false };
        p.mode = 'slide'; n.pose = 'sit';
        return;
    }
    beginStay(P, n, s);
}

function beginStay(P, n, s) {
    const p = n.p, rnd = P.rnd;
    p.mode = 'stay'; p.wait = rand(rnd, s.t[0], s.t[1]);
    n.pose = s.k === 'sit' ? 'sit' : s.pose || 'idle';
    p.face = s.a == null ? n.angle : s.a;
    p.bx = n.x; p.by = n.y; p.shoutT = rand(rnd, 0.4, 2.5);
    if (s.prop !== undefined) n.prop = s.prop;
    if (s.phoneAt) n.phoneAt = s.phoneAt;
    if (s.lie) n.lie = true;
    if (s.say && rnd() < 0.5) trySay(P.st, n, pick(rnd, s.say), 2.4);
}

function poseTick(n, dt) {
    switch (n.pose) {
        case 'idle': n.phase += (Math.round(n.phase / PI) * PI - n.phase) * Math.min(1, dt * 5); break;
        case 'cheer': n.phase += dt * 2.2; break;
        case 'sit': n.phase += dt * 1.6; break;
        default: n.phase += dt * 1.5;
    }
}

function walkStep(P, n, dt, speed) {
    const p = n.p, def = P.def, pt = p.path && p.path[p.pi];
    if (!pt) return true;
    const dx = pt.x - n.x, dy = pt.y - n.y, d = Math.hypot(dx, dy), m = speed * dt;
    const ox = n.x, oy = n.y;
    if (d <= m + 0.01) { n.x = pt.x; n.y = pt.y; p.pi++; } else {
        n.x += dx / d * m; n.y += dy / d * m;
        turnToward(n, Math.atan2(dy, dx), dt * 10);
    }
    n.phase += Math.hypot(n.x - ox, n.y - oy) * 0.12;
    n.pose = 'walk';
    // aldrig in i väggar och möbler: backa och planera om
    if (!circleClear(def, n.x, n.y, 5) && circleClear(def, ox, oy, 5)) { n.x = ox; n.y = oy; aim(P, n, p.tx, p.ty); }
    return !p.path || p.pi >= p.path.length;
}

// Mjuk knuff så att gående inte går rakt igenom varandra
function separate(P, n, dt) {
    const npcs = P.st.npcs, def = P.def;
    let px = 0, py = 0;
    for (let i = 0; i < npcs.length; i++) {
        const o = npcs[i];
        if (o === n || o.pose === 'sit' || o.brawl) continue;
        const dx = n.x - o.x, dy = n.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 > 225 || d2 < 0.01) continue;
        const d = Math.sqrt(d2), k = (15 - d) / 15;
        px += dx / d * k; py += dy / d * k;
    }
    if (px || py) {
        const nx = n.x + px * 30 * dt, ny = n.y + py * 30 * dt;
        if (circleClear(def, nx, ny, 6)) { n.x = nx; n.y = ny; }
    }
}

function stayStep(P, n, dt) {
    const p = n.p, st = P.st, def = P.def, s = p.steps[p.si] || {};
    poseTick(n, dt);
    let want = p.face;
    const f = st.focus;
    if (f && p.watch && n.pose !== 'sit' && !p.ov) {
        const fx = f.x - n.x, fy = f.y - n.y;
        if (fx * fx + fy * fy < 140 * 140) want = Math.atan2(fy, fx);
    }
    if (s.jostle) {
        // knuffas och gestikulerar i gruppen
        const off = Math.sin(st.t * 2.6 + p.bx * 0.07) * 3.2, side = Math.cos(st.t * 1.7 + p.by * 0.05) * 2;
        const c = Math.cos(p.face), sn = Math.sin(p.face);
        const nx = p.bx + c * off - sn * side, ny = p.by + sn * off + c * side;
        if (circleClear(def, nx, ny, 6)) { n.x = nx; n.y = ny; }
        n.pose = Math.sin(st.t * 1.3 + p.bx) > -0.2 ? 'cheer' : 'idle';
    }
    if (s.shout && (p.shoutT -= dt) <= 0) {
        p.shoutT = rand(P.rnd, 2.2, 5.5);
        if (P.rnd() < 0.65) trySay(st, n, pick(P.rnd, s.shout), 1.8);
    }
    turnToward(n, want, dt * 6);
    // besöket: när besökaren gått reser sig fången
    if (p.act === 'booth') {
        const v = p.visitor;
        if ((!v || v.dead || !v.p || v.p.inBooth < 0 || v.p.partner !== n) && p.wait > 0.8) p.wait = rand(P.rnd, 0.3, 0.8);
    }
    if (p.role === 'visitor' && p.inBooth >= 0 && !p.partner && (p.partnerT -= dt) <= 0) {
        p.partnerT = 3;
        requestPartner(P, n, p.inBooth);
    }
    p.wait -= dt;
    if (p.wait > 0) return;
    if (s.give) n.prop = s.give;
    if (p.role === 'visitor' && p.inBooth >= 0) { p.inBooth = -1; release(P, n); }
    if (p.seat) {
        p.slide = { x0: n.x, y0: n.y, x1: p.seat.fx, y1: p.seat.fy, t: 0, dur: 0.45, out: true };
        p.mode = 'slide';
        return;
    }
    nextStep(P, n);
}

function slideStep(P, n, dt) {
    const p = n.p, s = p.slide;
    s.t += dt;
    const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
    n.x = s.x0 + (s.x1 - s.x0) * e; n.y = s.y0 + (s.y1 - s.y0) * e;
    n.pose = 'sit'; // sittande hela glidet (pallen är en solid ruta)
    if (!s.out && p.seat) turnToward(n, p.seat.a, dt * 10);
    if (k < 1) return;
    p.slide = null;
    if (!s.out) {
        beginStay(P, n, p.seat);
        if (p.role === 'visitor' && p.seat.booth != null) { p.inBooth = p.seat.booth; p.partnerT = 0; }
        return;
    }
    n.pose = 'idle'; n.lie = false;
    const was = p.seat;
    p.seat = null;
    if (was && was.prop) { n.prop = null; n.phoneAt = null; } // brickan, korten och luren blir kvar
    if (p.after) {
        const steps = p.after;
        p.after = null; p.steps = steps; p.si = p.afterSi || 0; p.dir = 1;
        startStep(P, n);
    } else nextStep(P, n);
}

// ── Basket: spring runt korgen, passa och skjut (bollen styrs av rummet) ──
function courtPoint(P, n) {
    const def = P.def, rnd = P.rnd;
    for (let i = 0; i < 12; i++) {
        const x = rand(rnd, COURT.x0, COURT.x1), y = rand(rnd, COURT.y0, COURT.y1);
        if (!circleClear(def, x, y, 9)) continue;
        let crowd = false;
        for (const o of P.st.npcs) if (o !== n && o.p && o.p.act === 'basket' && Math.hypot(o.x - x, o.y - y) < 24) { crowd = true; break; }
        if (!crowd) return { x, y };
    }
    return { x: tc(25), y: tc(11) };
}

function basketStep(P, n, dt) {
    const p = n.p, B = P.ball;
    p.wait -= dt;
    if (p.bwalk) {
        if (walkStep(P, n, dt, p.bspeed)) { p.bwalk = false; n.pose = 'idle'; p.bt = rand(P.rnd, 0.5, 2.2); } else separate(P, n, dt);
        return;
    }
    poseTick(n, dt);
    const hold = B.holder === n;
    const tx = hold ? RIM.x : B.holder ? B.holder.x : B.x, ty = hold ? RIM.y : B.holder ? B.holder.y : B.y;
    if (Math.hypot(tx - n.x, ty - n.y) > 1) turnToward(n, Math.atan2(ty - n.y, tx - n.x), dt * 7);
    if (p.wait <= 0) { if (hold) looseBall(P, n); nextStep(P, n); return; }
    if ((p.bt -= dt) <= 0) {
        const c = courtPoint(P, n);
        if (aim(P, n, c.x, c.y)) { p.bwalk = true; p.bspeed = rand(P.rnd, 52, 80); } else p.bt = 1;
    }
}

// ═══════════════════════════════════════════
//  AKTIVITETER (fångar)
// ═══════════════════════════════════════════

function cellSteps(cell, spot, t, run) {
    const x0 = CELL_X[cell];
    if (spot === 0) return [{ k: 'sit', fx: tc(x0 + 1), fy: tc(2), sx: tc(x0), sy: 2 * TS, a: PI / 2, lie: true, t: t.slice(), run, say: run ? null : SAY.rest }];
    if (spot === 1) return [{ k: 'visit', x: tc(x0 + 1), y: tc(3), a: PI / 2, pose: 'idle', t: t.slice(), run, say: run ? null : SAY.cell }];
    return [{ k: 'visit', x: tc(x0 + 2), y: tc(2) + 3, a: PI, pose: 'sit', t: t.slice(), run, say: run ? null : SAY.cell }];
}

function walkSteps(P, n) {
    let i0 = 0, bd = Infinity;
    WALK.forEach((w, i) => { const d = Math.hypot(w.x - n.x, w.y - n.y); if (d < bd) { bd = d; i0 = i; } });
    const count = 5 + Math.floor(P.rnd() * 3), steps = [];
    for (let k = 0; k < count; k++) { const w = WALK[(i0 + k) % WALK.length]; steps.push({ k: 'go', x: w.x, y: w.y }); }
    const last = steps[steps.length - 1];
    steps.push({ k: 'visit', x: last.x, y: last.y, a: null, pose: 'idle', t: [3, 6], say: SAY.hang });
    return steps;
}

function boothSteps(b) {
    const bx = BOOTH_X[b];
    return [{ k: 'sit', fx: tc(bx), fy: tc(17), sx: tc(bx), sy: tc(18) + 2, a: PI / 2, t: LONG.slice(), prop: 'phone', phoneAt: { x: tc(bx) + 9, y: 19 * TS + 5 } }];
}

const ACTS = [
    { act: 'basket', w: 3, keys: ['b0', 'b1', 'b2'], build: (P, n) => { const c = courtPoint(P, n); return [{ k: 'go', x: c.x, y: c.y }, { k: 'basket', t: [24, 48] }]; } },
    { act: 'bench', w: 1.2, keys: ['w0'], build: () => [{ k: 'sit', ...BENCH_SEAT, t: [14, 28], prop: 'barbell', say: SAY.bench }] },
    { act: 'curl', w: 1, keys: ['w1'], build: () => [V(tc(22), tc(21) - 3, PI / 2, 'idle', 12, 24, { prop: 'dumbbells', say: SAY.curl })] },
    {
        act: 'eat', w: 2.6, keys: EAT_SEATS.map((_, i) => 'e' + i),
        build: (P, n, key) => {
            const s = EAT_SEATS[+key.slice(1)], cx = COUNTER_X[Math.min(3, Math.floor(P.rnd() * 4))];
            return [V(tc(cx), tc(10), -PI / 2, 'idle', 2, 3.6, { give: 'tray', say: SAY.queue }), { k: 'sit', ...s, t: [18, 34], prop: 'tray', say: SAY.eat }];
        }
    },
    { act: 'cards', w: 1.6, keys: ['c0', 'c1', 'c2', 'c3'], build: (P, n, key) => [{ k: 'sit', ...CARD_SEATS[+key.slice(1)], t: [26, 50], prop: 'cards', say: SAY.cards }] },
    { act: 'rest', w: 2, keys: n => [restKey(n)], build: (P, n) => cellSteps(n.p.cell, n.p.spot, [18, 40], false) },
    { act: 'walk', w: 1.3, keys: ['wk0', 'wk1'], build: (P, n) => walkSteps(P, n) },
    { act: 'yardsit', w: 1.1, keys: ['ys0', 'ys1', 'ys2'], build: (P, n, key) => [{ k: 'sit', ...YARD_SEATS[+key.slice(2)], t: [14, 30], say: SAY.hang }] },
    { act: 'hang', w: 1.2, keys: ['h0', 'h1', 'h2'], build: (P, n, key) => [{ k: 'visit', ...HANG[+key.slice(1)], pose: 'idle', t: [12, 26], say: SAY.hang }] },
    { act: 'mill', w: 1, keys: ['m0', 'm1', 'm2', 'm3'], build: (P, n, key) => [{ k: 'visit', ...MILL[+key.slice(1)], pose: 'idle', t: [8, 16], say: SAY.mill }] },
    { act: 'phone', w: 0.5, keys: ['pay'], build: () => [V(tc(1), tc(17), PI, 'idle', 8, 16, { prop: 'phone', phoneAt: PAYPHONE, say: SAY.phone })] }
];
const ACT_BY = Object.fromEntries(ACTS.map(a => [a.act, a]));

function chooseActivity(P, n) {
    const p = n.p, rnd = P.rnd;
    release(P, n);
    if (p.tag === 'dealer') { take(P, n, 'dealer'); p.act = 'dealer'; setSteps(P, n, DEALER_STEPS, { loop: true }); return; }
    const opts = [];
    let total = 0;
    for (const A of ACTS) {
        if (A.act === p.act && rnd() < 0.75) continue; // gärna något annat än nyss
        const keys = (typeof A.keys === 'function' ? A.keys(n) : A.keys).filter(k => slotFree(P, k));
        if (!keys.length) continue;
        opts.push([A, keys]); total += A.w;
    }
    let A = ACT_BY.rest, keys = [restKey(n)];
    if (opts.length) {
        let r = rnd() * total;
        [A, keys] = opts[opts.length - 1];
        for (const o of opts) { r -= o[0].w; if (r <= 0) { [A, keys] = o; break; } }
    }
    const key = pick(rnd, keys);
    take(P, n, key);
    p.act = A.act;
    setSteps(P, n, A.build(P, n, key));
}

// En besökare har satt sig: närmaste lediga fånge kommer till båsets andra sida
function requestPartner(P, v, b) {
    const key = 'ib' + b;
    if (!slotFree(P, key)) return false;
    let best = null, bd = Infinity;
    for (const n of P.st.npcs) {
        const p = n.p;
        if (!p || p.role !== 'inmate' || p.tag === 'dealer' || n.brawl || n.leaving || n.dead || p.ov || p.homing || p.seat || p.mode === 'slide' || p.act === 'booth') continue;
        const d = Math.hypot(n.x - tc(BOOTH_X[b]), n.y - tc(17));
        if (d < bd) { bd = d; best = n; }
    }
    if (!best) return false;
    take(P, best, key);
    best.p.act = 'booth';
    best.p.visitor = v; v.p.partner = best;
    setSteps(P, best, boothSteps(b));
    trySay(P.st, best, pick(P.rnd, SAY.booth), 2.2);
    return true;
}

function leaveSteps(def, run) {
    return [{ k: 'go', x: def.door.x, y: def.door.y, run }, { k: 'go', x: def.door.x, y: def.h * TS - 12, run }, { k: 'vanish' }];
}

function visitorSteps(b) {
    const bx = BOOTH_X[b];
    return [
        { k: 'sit', fx: tc(bx), fy: tc(21), sx: tc(bx), sy: tc(20) - 2, a: -PI / 2, t: [18, 32], prop: 'phone', phoneAt: { x: tc(bx) + 9, y: 19 * TS + 27 }, booth: b, say: SAY.visitor },
        ...leaveSteps(PRISON_DEF, false)
    ];
}

function makeVisitor(rnd, x, y) {
    const n = actor('visitor', 'visitor', x, y, rnd, { look: visitorLook(rnd), lines: LINES_P.visitor, speed: rand(rnd, 38, 46), angle: -PI / 2 });
    if (rnd() < 0.5) n.bag = pick(rnd, ['#7c2d12', '#111827', '#be185d', '#a16207']);
    return n;
}

function spawnVisitor(P, rnd) {
    const st = P.st, def = P.def;
    let nv = 0;
    for (const n of st.npcs) if (n.p && n.p.role === 'visitor' && !n.dead) nv++;
    if (nv >= 2) return null;
    const free = NPC_BOOTHS.filter(b => slotFree(P, 'vb' + b) && slotFree(P, 'ib' + b));
    if (!free.length) return null;
    const ox = def.door.x, oy = def.h * TS - 12;
    for (const n of st.npcs) if (Math.hypot(n.x - ox, n.y - oy) < 26) return null;
    const b = pick(rnd, free);
    const v = makeVisitor(rnd, ox, oy);
    st.npcs.push(v);
    take(P, v, 'vb' + b);
    setSteps(P, v, visitorSteps(b));
    return v;
}

// ═══════════════════════════════════════════
//  LARM: inlåsning, bråk på gården, slagsmål
// ═══════════════════════════════════════════

function restoreScript(P, n) {
    const p = n.p;
    p.ov = null;
    if (!p.script) { chooseActivity(P, n); return; }
    // börja från närmaste punkt på rundan
    let si = 0, bd = Infinity;
    p.script.forEach((s, i) => { if (s.x == null) return; const d = Math.hypot(s.x - n.x, s.y - n.y); if (d < bd) { bd = d; si = i; } });
    setSteps(P, n, p.script, { loop: true, si });
}

// Larmet går: in i cellen (fångar), till slussen (vakter), ut (besökare)
function lockOne(P, n) {
    const p = n.p, def = P.def;
    p.ov = 'lock';
    if (p.role === 'inmate') {
        if (p.cell < 0) return;
        // redan hemma i cellen: stanna kvar
        if (p.act === 'rest' && inCell(def, n, p.cell) && p.mode === 'stay') { p.wait = 1e9; return; }
        release(P, n);
        p.act = 'lock';
        setSteps(P, n, cellSteps(p.cell, p.spot, LONG, true));
        return;
    }
    if (p.role === 'guard') {
        const s = GATE_SPOTS[p.gi % GATE_SPOTS.length], g = def.gate;
        setSteps(P, n, [{ k: 'visit', x: s.x, y: s.y, a: Math.atan2(g.y - s.y, g.x - s.x), pose: 'idle', t: LONG.slice(), run: true, shout: LOCK_GUARD }]);
        return;
    }
    if (p.role === 'visitor') { release(P, n); p.inBooth = -1; setSteps(P, n, leaveSteps(def, true)); }
    // direktören och kocken stannar där de är
}

// Larmet över (ett par sekunder kvar där man är, sen vidare)
function calm(P, n, lo, hi) {
    const p = n.p;
    for (const s of p.steps) if (s.t && s.t[0] >= 1e8) s.t = [lo, hi];
    if (p.after) for (const s of p.after) if (s.t && s.t[0] >= 1e8) s.t = [lo, hi];
    if (p.mode === 'stay' && p.wait > hi) p.wait = rand(P.rnd, lo, hi);
}

function endAlarm(P, kind, lo, hi) {
    for (const n of P.st.npcs) {
        const p = n.p;
        if (!p || p.ov !== kind) continue;
        p.ov = null;
        if (n.brawl || n.dead) continue;
        if (p.role === 'inmate') { calm(P, n, lo, hi); if (p.act !== 'rest') { release(P, n); p.act = null; } }
        else if (p.role === 'visitor') p.ov = 'leave';
        else if (p.script) restoreScript(P, n);
    }
}

function updateRiot(P, dt) {
    if ((P.riotT -= dt) > 0) return;
    P.riotT = 1.5;
    const st = P.st, def = P.def, groups = [0, 0];
    for (const n of st.npcs) if (n.p && n.p.ov === 'riot' && n.p.role === 'inmate') groups[n.p.grp]++;
    for (const n of st.npcs) {
        const p = n.p;
        if (!p || n.brawl || n.dead || n.leaving || p.homing || p.ov) continue;
        if (p.role === 'inmate' && p.tag !== 'dealer' && inYard(def, n)) {
            const gi = Math.hypot(n.x - RIOT_AT[0].x, n.y - RIOT_AT[0].y) < Math.hypot(n.x - RIOT_AT[1].x, n.y - RIOT_AT[1].y) ? 0 : 1;
            const k = groups[gi]++, c = RIOT_AT[gi], a = k * 2.4 + gi, r = 24 + (k % 3) * 10;
            let x = c.x + Math.cos(a) * r, y = c.y + Math.sin(a) * r;
            if (!circleClear(def, x, y, 8)) { x = c.x + Math.cos(a) * 16; y = c.y + Math.sin(a) * 16; }
            p.ov = 'riot'; p.grp = gi;
            release(P, n); p.act = 'riot';
            setSteps(P, n, [{ k: 'visit', x, y, a: Math.atan2(c.y - y, c.x - x), pose: 'cheer', t: LONG.slice(), run: true, jostle: true, shout: RIOT_LINES }]);
        } else if (p.role === 'guard' && (p.tag === 'yard' || p.tag === 'corridor')) {
            p.ov = 'riot';
            const s = p.tag === 'yard' ? { x: tc(21), y: tc(8) + 4 } : { x: tc(22), y: tc(8) + 4 };
            setSteps(P, n, [{ k: 'visit', ...s, a: PI / 2, pose: 'idle', t: LONG.slice(), run: true, shout: RIOT_GUARD }]);
        }
    }
}

function fightCenter(st) {
    let x = 0, y = 0, k = 0;
    for (const n of st.npcs) if (n.brawl === 'fight') { x += n.x; y += n.y; k++; }
    return k ? { x: x / k, y: y / k } : null;
}

function crowdOne(P, n, c) {
    const p = n.p, def = P.def, M = navOf(def, 'inmate');
    const a0 = Math.atan2(n.y - c.y, n.x - c.x);
    let pos = null;
    for (let k = 0; k < 9 && !pos; k++) {
        const a = a0 + (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.42, x = c.x + Math.cos(a) * 60, y = c.y + Math.sin(a) * 60;
        if (walkableAt(def, M, x, y)) pos = { x, y };
    }
    if (!pos) pos = { x: n.x, y: n.y };
    p.ov = 'panic'; p.cx = c.x; p.cy = c.y;
    release(P, n); p.act = 'crowd';
    setSteps(P, n, [{ k: 'visit', x: pos.x, y: pos.y, a: Math.atan2(c.y - pos.y, c.x - pos.x), pose: 'cheer', t: LONG.slice(), run: true, jostle: true, shout: CROWD_LINES }]);
}

// Slagsmål: fångarna i närheten samlas runt och hejar, besökarna går
function updateCrowd(P, dt) {
    if ((P.crowdT -= dt) > 0) return;
    P.crowdT = 0.6;
    const st = P.st, c = fightCenter(st);
    for (const n of st.npcs) {
        const p = n.p;
        if (!p || n.brawl || n.dead) continue;
        if (p.role === 'visitor') {
            if (!p.ov) { p.ov = 'panic'; release(P, n); p.inBooth = -1; setSteps(P, n, leaveSteps(P.def, true)); if (P.rnd() < 0.5) trySay(st, n, pick(P.rnd, SCARED), 1.8); }
            continue;
        }
        if (p.role !== 'inmate' || !c || n.leaving || p.homing || p.tag === 'dealer') continue;
        if (p.ov === 'panic') { if (Math.hypot(p.cx - c.x, p.cy - c.y) > 70) crowdOne(P, n, c); continue; }
        if (p.ov || n.lie || inCell(P.def, n, p.cell) || Math.hypot(n.x - c.x, n.y - c.y) > 240) continue;
        crowdOne(P, n, c);
    }
}

// Gallerdörrarna: stängs när cellens fångar är inne (eller efter en stund), öppnas när larmet är över
function updateDoors(P, dt) {
    const st = P.st, def = P.def;
    for (let i = 0; i < CELL_X.length; i++) {
        let shut = !!st.lockCells[i];
        if (!shut && P.lockOn) {
            shut = true;
            if (i !== PLAYER_CELL && P.lockT < 9) {
                for (const n of st.npcs) {
                    const p = n.p;
                    if (!p || p.role !== 'inmate' || p.cell !== i || n.brawl || n.dead) continue;
                    if (!inCell(def, n, i) || p.mode === 'walk' || p.mode === 'slide') { shut = false; break; }
                }
            }
        }
        const target = shut ? 0 : 1;
        P.doors[i] += clamp(target - P.doors[i], -dt * 1.3, dt * 1.3);
    }
}

// ═══════════════════════════════════════════
//  BOLLEN
// ═══════════════════════════════════════════

function looseBall(P, from) {
    const B = P.ball, rnd = P.rnd;
    if (from && B.holder === from) {
        B.x = from.x + Math.cos(from.angle) * 10; B.y = from.y + Math.sin(from.angle) * 10;
    }
    B.holder = null; B.to = null; B.mode = 'loose';
    B.vx = (rnd() - 0.5) * 50; B.vy = (rnd() - 0.5) * 50; B.wait = rand(rnd, 0.4, 1.2);
}

function handPos(n) {
    const c = Math.cos(n.angle), s = Math.sin(n.angle);
    return { x: n.x + c * 9 - s * 7, y: n.y + s * 9 + c * 7 };
}

// Var bollen är just nu: { x, y, z } (z = höjd över asfalten)
function ballPos(P, t) {
    const B = P.ball;
    if (B.mode === 'hold' && B.holder) { const h = handPos(B.holder); return { x: h.x, y: h.y, z: Math.abs(Math.sin(t * 8.5)) * 7 }; }
    if (B.mode === 'pass' || B.mode === 'shot' || B.mode === 'drop') {
        const k = clamp(B.k, 0, 1);
        let tx = B.tx, ty = B.ty;
        if (B.to) { const h = handPos(B.to); tx = h.x; ty = h.y; }
        return { x: B.x0 + (tx - B.x0) * k, y: B.y0 + (ty - B.y0) * k, z: B.z0 + (B.z1 - B.z0) * k + B.peak * 4 * k * (1 - k) };
    }
    return { x: B.x, y: B.y, z: 0 };
}

function fly(P, mode, to, tx, ty, dur, peak, z1) {
    const B = P.ball, cur = ballPos(P, P.st.t);
    B.from = B.holder; B.holder = null;
    B.mode = mode; B.to = to; B.tx = tx; B.ty = ty;
    B.x0 = cur.x; B.y0 = cur.y; B.z0 = cur.z; B.z1 = z1;
    B.k = 0; B.dur = dur; B.peak = peak;
}

function updateBall(P, dt) {
    const B = P.ball, rnd = P.rnd, st = P.st;
    const players = [];
    for (const n of st.npcs) if (n.p && n.p.mode === 'basket' && !n.brawl && !n.p.ov && !n.dead) players.push(n);
    if (B.holder && !players.includes(B.holder)) looseBall(P, B.holder);
    if (B.to && !players.includes(B.to)) {
        const cur = ballPos(P, st.t);
        B.to = null; B.tx = cur.x; B.ty = cur.y + (B.mode === 'shot' ? 0 : 0);
    }
    if (B.swish > 0) B.swish = Math.max(0, B.swish - dt);
    switch (B.mode) {
        case 'loose': {
            B.x += B.vx * dt; B.y += B.vy * dt;
            const k = Math.max(0, 1 - 2.4 * dt); B.vx *= k; B.vy *= k;
            if (B.x < 19 * TS + 6 || B.x > 31 * TS - 6) B.vx = -B.vx;
            if (B.y < 8 * TS + 30 || B.y > 23 * TS - 6) B.vy = -B.vy;
            B.x = clamp(B.x, 19 * TS + 6, 31 * TS - 6); B.y = clamp(B.y, 8 * TS + 30, 23 * TS - 6);
            if (players.length && (B.wait -= dt) <= 0) {
                let best = players[0], bd = Infinity;
                for (const n of players) { const d = Math.hypot(n.x - B.x, n.y - B.y); if (d < bd) { bd = d; best = n; } }
                fly(P, 'pass', best, 0, 0, 0.25 + bd / 320, 6, 4);
            }
            break;
        }
        case 'hold':
            if ((B.hold -= dt) > 0) break;
            if (players.length > 1 && rnd() < 0.6) {
                const others = players.filter(n => n !== B.holder), to = pick(rnd, others);
                fly(P, 'pass', to, 0, 0, 0.3 + Math.hypot(to.x - B.holder.x, to.y - B.holder.y) / 330, 8, 4);
            } else {
                const d = Math.hypot(RIM.x - B.holder.x, RIM.y - B.holder.y);
                B.shooter = B.holder;
                fly(P, 'shot', null, RIM.x, RIM.y + 18, 0.55 + d / 520, 22 + d * 0.06, 18);
            }
            break;
        case 'pass': case 'shot': case 'drop':
            B.k += dt / B.dur;
            if (B.k < 1) break;
            if (B.mode === 'pass') {
                if (B.to) { B.holder = B.to; B.to = null; B.mode = 'hold'; B.hold = rand(rnd, 1.2, 3.2); } else { B.x = B.tx; B.y = B.ty; looseBall(P, null); }
            } else if (B.mode === 'shot') {
                B.made = rnd() < 0.5;
                const s = B.shooter;
                if (s && !s.brawl && rnd() < 0.7) trySay(st, s, B.made ? pick(rnd, ['Swish!', 'Tvåa!', 'Pang!']) : pick(rnd, ['Brick!', 'Nej!', 'Ringen...']), 1.6);
                if (B.made) B.swish = 0.6;
                fly(P, 'drop', null, RIM.x + (B.made ? 0 : (rnd() - 0.5) * 50), RIM.y + 18 + (B.made ? 4 : 20), B.made ? 0.38 : 0.5, B.made ? 0 : 10, 0);
            } else {
                B.x = B.tx; B.y = B.ty; looseBall(P, null);
                B.vx = (rnd() - 0.5) * 90; B.vy = 30 + rnd() * 60;
            }
            break;
        default: B.mode = 'loose';
    }
}

// ═══════════════════════════════════════════
//  VARJE BILDRUTA
// ═══════════════════════════════════════════

// En NPC (anropas av updateInterior). true = hanterad här.
function stepPrison(n, state, dt, rnd) {
    const p = n.p;
    if (!p) return false;
    const P = prisonOf(state, rnd);
    if (n.brawl) {
        // slagsmål: spelets kod flyttar, vänder och byter pose — vi släpper bara platsen
        if (!p.brawled) {
            p.brawled = true;
            release(P, n);
            p.seat = null; p.slide = null; p.after = null; p.ov = null; p.homing = false; p.inBooth = -1; p.mode = 'new';
            n.lie = false; n.prop = null; n.phoneAt = null;
        }
        return true;
    }
    if (n.dead) return true;
    if (p.brawled) {
        p.brawled = false;
        if (!n.leaving) { if (p.script) restoreScript(P, n); else if (p.role === 'visitor') goHome(P, n); else chooseActivity(P, n); }
    }
    if (n.leaving && !p.homing && p.ov !== 'lock') goHome(P, n);
    // fången är hemma i sin cell: bråket är glömt
    if (n.leaving && p.role === 'inmate' && p.mode !== 'walk' && p.mode !== 'slide' && inCell(P.def, n, p.cell)) { n.leaving = false; p.homing = false; }
    if (p.mode === 'new') startStep(P, n);
    switch (p.mode) {
        case 'walk':
            if (walkStep(P, n, dt, p.run ? RUN : p.homing && p.role === 'visitor' ? 60 : p.speed)) arrive(P, n);
            else if (p.ov !== 'lock') separate(P, n, dt);
            break;
        case 'stay': stayStep(P, n, dt); break;
        case 'slide': slideStep(P, n, dt); break;
        case 'basket': basketStep(P, n, dt); break;
        default: poseTick(n, dt);
    }
    return true;
}

// Bråket över (n.leaving): fångar till cellen, vakter och personal till jobbet, besökare ut
function goHome(P, n) {
    const p = n.p;
    release(P, n);
    p.inBooth = -1;
    if (p.role === 'inmate') {
        if (P.lockOn) { lockOne(P, n); return; }
        p.ov = null; p.act = 'rest';
        if (p.tag !== 'dealer') take(P, n, restKey(n));
        setSteps(P, n, cellSteps(p.cell, p.spot, [14, 28], false), { homing: true });
        return;
    }
    if (p.role === 'visitor') { p.ov = 'leave'; setSteps(P, n, leaveSteps(P.def, false), { homing: true }); return; }
    n.leaving = false; p.homing = false;
    restoreScript(P, n);
}

function updatePrison(state, dt, rnd) {
    const P = prisonOf(state, rnd), npcs = state.npcs;
    const lock = state.lockdown > 0, riot = !lock && state.riot > 0, pan = !lock && !riot && state.panic > 0;
    if (lock) {
        if (!P.lockOn) {
            if (P.riotOn) { P.riotOn = false; endAlarm(P, 'riot', 0.5, 1); }
            if (P.panicOn) { P.panicOn = false; endAlarm(P, 'panic', 0.5, 1); }
            P.lockOn = true; P.lockT = 0; P.shoutT = 0.2;
        }
        P.lockT += dt;
        for (const n of npcs) {
            const p = n.p;
            if (p && !n.brawl && !n.dead && p.ov !== 'lock' && p.role !== 'warden' && p.role !== 'cook') lockOne(P, n);
        }
        if ((P.shoutT -= dt) <= 0) {
            P.shoutT = 2.6;
            let g = 0, f = 0;
            for (const n of npcs) {
                if (!n.p || n.brawl || n.say) continue;
                if (n.kind === 'guard' && g < 2 && rnd() < 0.7) { trySay(state, n, pick(rnd, LOCK_GUARD), 2); g++; }
                else if (n.kind === 'inmate' && f < 1 && rnd() < 0.25) { trySay(state, n, pick(rnd, LOCK_INMATE), 2); f++; }
            }
        }
    } else if (P.lockOn) { P.lockOn = false; endAlarm(P, 'lock', 1.2, 4); }
    if (riot) { if (!P.riotOn) { P.riotOn = true; P.riotT = 0; } updateRiot(P, dt); }
    else if (P.riotOn) { P.riotOn = false; endAlarm(P, 'riot', 0.5, 2.5); }
    if (pan) { if (!P.panicOn) { P.panicOn = true; P.crowdT = 0; } updateCrowd(P, dt); }
    else if (P.panicOn) { P.panicOn = false; endAlarm(P, 'panic', 0.5, 2.5); }
    updateDoors(P, dt);
    updateBall(P, dt);
    // besökare kommer in genom porten då och då
    if (!lock && !riot && !pan && (P.visT -= dt) <= 0) {
        P.visT = rand(rnd, 20, 42);
        spawnVisitor(P, rnd);
    }
    // bort med dem som gått ut genom porten
    for (let i = npcs.length - 1; i >= 0; i--) {
        const n = npcs[i];
        if (n.dead && !n.brawl) { if (n.p) release(P, n); npcs.splice(i, 1); }
    }
    if (state.lockdown > 0) state.lockdown = Math.max(0, state.lockdown - dt);
    if (state.riot > 0) state.riot = Math.max(0, state.riot - dt);
    if (state.panic > 0) state.panic = Math.max(0, state.panic - dt);
}

// ── Uppställningen när man kommer in ──
function placeAt(n, idx, rnd) {
    const p = n.p, s = p.steps[idx];
    p.si = idx;
    if (s.k === 'sit') {
        p.seat = s; n.x = s.sx; n.y = s.sy; n.angle = s.a; n.pose = 'sit';
        p.mode = 'stay'; p.wait = rand(rnd, 2, Math.min(s.t[1], 40)); p.face = s.a;
        if (s.prop !== undefined) n.prop = s.prop;
        if (s.phoneAt) n.phoneAt = s.phoneAt;
        if (s.lie) n.lie = true;
        return n;
    }
    if (s.k === 'basket') {
        const prev = p.steps[idx - 1];
        n.x = prev.x; n.y = prev.y;
        p.mode = 'basket'; p.wait = rand(rnd, 10, s.t[1]); p.bt = rand(rnd, 0.3, 2); n.pose = 'idle';
        return n;
    }
    n.x = s.x; n.y = s.y;
    if (s.k === 'go') { p.mode = 'new'; p.si = idx + 1; return n; }
    p.mode = 'stay'; p.wait = rand(rnd, 0.5, Math.max(1, s.t[1])); n.pose = s.pose || 'idle';
    if (s.a != null) n.angle = s.a;
    p.face = n.angle; p.bx = n.x; p.by = n.y;
    if (s.prop !== undefined) n.prop = s.prop;
    if (s.phoneAt) n.phoneAt = s.phoneAt;
    return n;
}

function staff(kind, rnd, tag, steps, o = {}) {
    const n = actor(kind, kind === 'guard' ? 'guard' : kind, 0, 0, rnd, {
        look: o.look || (kind === 'guard' ? guardLook(rnd) : null), lines: o.lines || LINES_P[kind], speed: o.speed || 38,
        order: o.order, watch: o.watch, tag, staff: true, name: o.name
    });
    const p = n.p;
    p.script = steps; p.steps = steps; p.loop = true;
    return placeAt(n, o.start || 0, rnd);
}

function populatePrison(def, rnd) {
    const npcs = [];
    const claim = (n, key) => { n.p.slot = key; };
    // ── vakterna (minst fyra) ──
    const guards = [
        staff('guard', rnd, 'console', CONSOLE_STEPS),
        staff('guard', rnd, 'gate', GATE_STEPS, { watch: true }),
        staff('guard', rnd, 'bribe', BRIBE_STEPS, { watch: true, name: 'Vakten Berra' }),
        staff('guard', rnd, 'corridor', CORRIDOR_STEPS, { order: 'ping', start: 2, speed: 36 }),
        staff('guard', rnd, 'yard', YARD_STEPS, { order: 'rand', start: 2, watch: true }),
        staff('guard', rnd, 'visit', VISIT_STEPS, { order: 'rand', watch: true })
    ];
    guards.forEach((n, i) => { n.p.gi = i; npcs.push(n); });
    npcs.push(staff('warden', rnd, 'warden', WARDEN_STEPS, { look: { shirt: '#3f3f46', skin: '#f1c27d', hair: '#d6d3d1' }, speed: 32, watch: true, name: 'Direktören' }));
    npcs.push(staff('cook', rnd, 'cook', COOK_STEPS, { look: { shirt: '#f8fafc', skin: '#c68642', hair: '#111111', cap: '#ffffff' }, order: 'rand', speed: 30, name: 'Kocken' }));
    // ── fångarna: cell 1–5, tre i varje (spelarens cell 0 står tom) ──
    const PLAN = ['rest', 'rest', 'eat', 'basket', 'basket', 'cards', 'cards', 'eat', 'bench', 'basket', 'cards', 'booth', 'walk', 'curl', 'dealer'];
    const keyUse = new Set();
    const firstKey = A => { const ks = typeof A.keys === 'function' ? null : A.keys; const k = ks && ks.find(x => !keyUse.has(x)); if (k) keyUse.add(k); return k; };
    const fake = { rnd, st: { npcs, t: 0 }, def };
    PLAN.forEach((act, i) => {
        const cell = 1 + (i % 5), spot = Math.floor(i / 5);
        const dealer = act === 'dealer';
        const n = actor('inmate', 'inmate', 0, 0, rnd, {
            look: dealer ? { shirt: ORANGE, skin: '#f1c27d', hair: '#5b3a1a', cap: '#3f2a14' } : inmateLook(rnd),
            lines: dealer ? LINES_P.dealer : LINES_P.inmate, cell, spot, speed: rand(rnd, 36, 44),
            tag: dealer ? 'dealer' : null, name: dealer ? 'Snus-Sune' : null
        });
        const p = n.p;
        npcs.push(n);
        if (dealer) { claim(n, 'dealer'); p.act = 'dealer'; p.steps = DEALER_STEPS; p.loop = true; placeAt(n, 0, rnd); return; }
        if (act === 'booth') {
            // ett besök pågår redan i bås 1
            const v = makeVisitor(rnd, 0, 0);
            v.p.steps = visitorSteps(1); claim(v, 'vb1'); placeAt(v, 0, rnd); v.p.inBooth = 1;
            p.steps = boothSteps(1); claim(n, 'ib1'); p.act = 'booth'; placeAt(n, 0, rnd);
            v.p.partner = n; p.visitor = v;
            npcs.push(v);
            return;
        }
        const A = ACT_BY[act];
        const key = act === 'rest' ? restKey(n) : firstKey(A);
        claim(n, key); p.act = act;
        const steps = A.build(fake, n, key);
        p.steps = steps;
        placeAt(n, act === 'eat' || act === 'basket' ? 1 : act === 'walk' ? 1 + (i % 3) : 0, rnd);
    });
    return npcs;
}

// ═══════════════════════════════════════════
//  RITNING — statiskt lager
// ═══════════════════════════════════════════

const WALL_PAL = { wall: '#2a2e31', face: '#5a625f', hi: '#808a86', line: '#111413' };
const BLANKETS = ['#6b7280', '#5b6b52', '#7a5c48'];

function speckle(g, x, y, seed, col, k) {
    g.fillStyle = col;
    for (let i = 0; i < k; i++) { const r = tileHash(seed, i * 7 + 3); g.fillRect(x + (r % 30) + 1, y + ((r >> 8) % 30) + 1, 1 + ((r >> 16) & 1), 1 + ((r >> 17) & 1)); }
}

// Upphöjd kloss (disk, bord, konsol) över en rektangel
function slabRect(g, x, y, w, h, o) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 4, w, h);
    box(g, x, y, w, h, o.side);
    const i = o.ins == null ? 3 : o.ins;
    box(g, x + i, y + i, w - 2 * i, h - 2 * i, o.top);
    box(g, x + i, y + i, w - 2 * i, 1.5, o.hi);
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

// Skylt: platta med text
function plate(g, text, cx, cy, w, h, o) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; rr(g, cx - w / 2 + 1.5, cy - h / 2 + 2, w, h, 3); g.fill();
    g.fillStyle = o.bg; rr(g, cx - w / 2, cy - h / 2, w, h, 3); g.fill();
    g.strokeStyle = o.edge; g.lineWidth = 1; rr(g, cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1, 3); g.stroke();
    g.font = `${o.size}px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = o.fg;
    g.fillText(text, cx, cy + 0.5);
    if (w > 40) { disc(g, cx - w / 2 + 4, cy, 1.1, 'rgba(255,255,255,0.45)'); disc(g, cx + w / 2 - 4, cy, 1.1, 'rgba(255,255,255,0.45)'); }
}
const STENCIL = { bg: '#e8b923', edge: '#7a5a06', fg: '#1c1917', size: 8 };
const ENAMEL = { bg: '#1e3a5f', edge: '#cbd5e1', fg: '#f1f5f9', size: 8 };

// Gul-svarta varningsränder
function hazard(g, x, y, w, h) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    box(g, x, y, w, h, '#17181a');
    g.fillStyle = '#e8b923';
    for (let xx = x - h - 12; xx < x + w + h; xx += 12) { g.beginPath(); g.moveTo(xx, y + h); g.lineTo(xx + 6, y + h); g.lineTo(xx + 6 + h, y); g.lineTo(xx + h, y); g.closePath(); g.fill(); }
    g.restore();
}

function neighborZone(def, tx, ty) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const z = zoneAt(def, tx + dx, ty + dy);
        if (z && chAt(def, tx + dx, ty + dy) !== '#') return z;
    }
    return 'hall';
}

function floorTile(g, def, tx, ty) {
    const ch = def.rows[ty][tx];
    if (ch === '#') return;
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
    const z = zoneAt(def, tx, ty) || (ch === 'e' ? 'gate' : neighborZone(def, tx, ty));
    switch (z) {
        case 'cells': // sliten betong
            box(g, x, y, TS, TS, (h & 1) ? '#8b877c' : '#87837a');
            speckle(g, x, y, h, 'rgba(0,0,0,0.12)', 8);
            speckle(g, x, y, h >> 5, 'rgba(255,255,255,0.07)', 5);
            if (h % 5 === 0) { g.fillStyle = 'rgba(70,50,25,0.13)'; g.beginPath(); g.ellipse(x + 8 + (h >> 3) % 16, y + 8 + (h >> 7) % 16, 7, 4, (h % 7) * 0.4, 0, TAU); g.fill(); }
            g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS);
            break;
        case 'corridor': // blank linoleum
            box(g, x, y, TS, TS, (tx + ty) & 1 ? '#a4aaa9' : '#9ea4a3');
            g.fillStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(x, y + 22); g.lineTo(x + 22, y); g.lineTo(x + 30, y); g.lineTo(x, y + 30); g.fill();
            g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS);
            if (h % 6 === 0) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + (h >> 4) % 24 + 3, y + (h >> 9) % 24 + 3, 3, 2); }
            break;
        case 'guard':
            box(g, x, y, TS, TS, '#35414f');
            g.fillStyle = 'rgba(255,255,255,0.06)';
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 3 + i * 8, y + 3 + j * 8, 2, 2);
            g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS);
            break;
        case 'kitchen':
            for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(g, x + i * 16, y + j * 16, 16, 16, ((i + j + tx + ty) & 1) ? '#8d3d2c' : '#83382a');
            g.fillStyle = 'rgba(40,15,10,0.6)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y + 16, TS, 1); g.fillRect(x, y, 1, TS); g.fillRect(x + 16, y, 1, TS);
            break;
        case 'mess': // schackrutigt
            box(g, x, y, TS, TS, (tx + ty) & 1 ? '#cfc6ad' : '#b7ad92');
            speckle(g, x, y, h, 'rgba(0,0,0,0.06)', 5);
            g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS);
            break;
        case 'visitIn':
            box(g, x, y, TS, TS, '#8f948f');
            g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y + 16, TS, 1); g.fillRect(x, y, 1, TS); g.fillRect(x + 16, y, 1, TS);
            speckle(g, x, y, h, 'rgba(255,255,255,0.06)', 4);
            break;
        case 'visitOut': // varm linoleum på besökssidan
            box(g, x, y, TS, TS, '#c3b08c');
            speckle(g, x, y, h, 'rgba(90,60,30,0.14)', 9);
            g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, y, TS, 1);
            break;
        case 'office':
            plankFloor(g, tx, ty, ['#7b5634', '#75512f', '#815b37', '#6f4c2b']);
            break;
        case 'hall': // betongplattor
            box(g, x, y, TS, TS, (h & 3) ? '#7d7f7b' : '#787a76');
            speckle(g, x, y, h, 'rgba(0,0,0,0.1)', 7);
            speckle(g, x, y, h >> 4, 'rgba(255,255,255,0.06)', 4);
            g.fillStyle = 'rgba(0,0,0,0.2)';
            if (!(tx & 1)) g.fillRect(x, y, 1, TS);
            if (!(ty & 1)) g.fillRect(x, y, TS, 1);
            break;
        case 'gym': // gummimatta
            box(g, x, y, TS, TS, '#272b2e');
            g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS); g.fillRect(x, y + 16, TS, 1); g.fillRect(x + 16, y, 1, TS);
            speckle(g, x, y, h, 'rgba(255,255,255,0.05)', 6);
            break;
        case 'gate':
            box(g, x, y, TS, TS, '#5d636b');
            g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1.1;
            for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const px = x + 4 + i * 8, py = y + 4 + j * 8; g.beginPath(); if ((i + j) & 1) { g.moveTo(px - 2, py - 2); g.lineTo(px + 2, py + 2); } else { g.moveTo(px + 2, py - 2); g.lineTo(px - 2, py + 2); } g.stroke(); }
            break;
        default: { // rastgården: asfalt
            box(g, x, y, TS, TS, (h & 1) ? '#3f4346' : '#3c4043');
            speckle(g, x, y, h, 'rgba(255,255,255,0.07)', 10);
            speckle(g, x, y, h >> 6, 'rgba(0,0,0,0.2)', 8);
            if (h % 7 === 0) {
                g.strokeStyle = 'rgba(15,15,15,0.55)'; g.lineWidth = 1;
                const sx = x + (h >> 3) % 20 + 4, sy = y + (h >> 8) % 20 + 4;
                g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 6, sy + 3); g.lineTo(sx + 9, sy + 9); g.lineTo(sx + 15, sy + 11); g.stroke();
            }
            if (h % 11 === 0) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.beginPath(); g.ellipse(x + 16, y + 16, 9, 5, (h % 5) * 0.6, 0, TAU); g.fill(); }
        }
    }
}

// Basketplanen: målad zon, linjer och bågar
function courtLines(g) {
    const L = 19 * TS + 10, R = 31 * TS - 10, T = 8 * TS + 2, B = 16 * TS + 6, cx = RIM.x;
    g.fillStyle = 'rgba(150,40,30,0.5)'; g.fillRect(cx - 42, T, 84, 146);
    g.fillStyle = 'rgba(30,64,120,0.22)'; g.beginPath(); g.arc(cx, B, 44, PI, TAU); g.fill();
    g.strokeStyle = 'rgba(236,236,228,0.72)'; g.lineWidth = 2;
    g.strokeRect(L, T, R - L, B - T);
    g.strokeRect(cx - 42, T, 84, 146);
    g.beginPath(); g.arc(cx, T + 146, 42, 0, PI); g.stroke();
    g.setLineDash([5, 5]); g.beginPath(); g.arc(cx, T + 146, 42, PI, TAU); g.stroke(); g.setLineDash([]);
    const r3 = 190, dx3 = 160, dy3 = Math.sqrt(r3 * r3 - dx3 * dx3), a3 = Math.atan2(dy3, dx3);
    g.beginPath(); g.moveTo(cx + dx3, T); g.lineTo(cx + dx3, RIM.y + dy3); g.arc(cx, RIM.y, r3, a3, PI - a3); g.lineTo(cx - dx3, T); g.stroke();
    g.beginPath(); g.arc(cx, B, 44, PI, TAU); g.stroke();
    g.beginPath(); g.arc(cx, RIM.y, 26, 0.2, PI - 0.2); g.stroke();
    for (const k of [40, 70, 100]) { g.fillStyle = 'rgba(236,236,228,0.72)'; g.fillRect(cx - 47, T + k, 5, 2); g.fillRect(cx + 42, T + k, 5, 2); }
    // nött färg: mörka fläckar över linjerna
    g.fillStyle = 'rgba(55,58,60,0.55)';
    for (let i = 0; i < 70; i++) { const r = tileHash(i, 991); g.fillRect(L + (r % (R - L)), T + ((r >> 10) % (B - T)), 2, 1.5); }
}

function paintCells(g, def) {
    const POSTERS = ['map', 'pinup', 'car', 'family', 'football', 'beach'];
    for (let i = 0; i < CELL_X.length; i++) {
        const x0 = CELL_X[i], X = x0 * TS;
        // britsen: stålram, madrass, kudde, hopvikt filt
        softShadow(g, X + 16, TS + 34, 14, 30, 0.3);
        box(g, X + 2, TS + 2, 28, 60, '#3d454e'); box(g, X + 2, TS + 2, 28, 1.5, 'rgba(255,255,255,0.25)');
        g.fillStyle = '#56657a'; rr(g, X + 4, TS + 4, 24, 56, 3); g.fill();
        for (let k = 0; k < 7; k++) box(g, X + 4, TS + 8 + k * 7.5, 24, 1, 'rgba(255,255,255,0.08)');
        g.fillStyle = '#ddd8ca'; rr(g, X + 6, TS + 6, 20, 11, 4); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke();
        g.fillStyle = BLANKETS[i % 3]; rr(g, X + 4, TS + 40, 24, 18, 3); g.fill();
        box(g, X + 4, TS + 43, 24, 2, 'rgba(255,255,255,0.16)'); box(g, X + 4, TS + 51, 24, 1, 'rgba(0,0,0,0.2)');
        for (const [dx, dy] of [[4, 4], [28, 4], [4, 60], [28, 60]]) disc(g, X + dx, TS + dy, 1.1, '#9aa3ad');
        // toalett i stål med handfat
        const tx = (x0 + 2) * TS, ty = TS;
        softShadow(g, tx + 16, ty + 16, 12, 13, 0.3);
        g.fillStyle = '#7d8894'; rr(g, tx + 4, ty + 1, 24, 9, 2); g.fill();
        disc(g, tx + 10, ty + 5.5, 3.2, '#475260'); disc(g, tx + 10, ty + 5.5, 2, '#8fb3c9'); box(g, tx + 14, ty + 3, 2, 3, '#d1d5db');
        g.fillStyle = '#b2bbc5'; g.beginPath(); g.ellipse(tx + 16, ty + 19, 9, 10, 0, 0, TAU); g.fill();
        g.fillStyle = '#5e6a76'; g.beginPath(); g.ellipse(tx + 16, ty + 20, 6.2, 7, 0, 0, TAU); g.fill();
        g.fillStyle = '#86aec6'; g.beginPath(); g.ellipse(tx + 16, ty + 21.5, 4.2, 4.8, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.beginPath(); g.arc(tx + 16, ty + 19, 8, PI * 1.1, PI * 1.6); g.stroke();
        disc(g, tx + 27, ty + 26, 3.2, '#f5f5f4'); disc(g, tx + 27, ty + 26, 1.2, '#a8a29e');
        // affisch på bakväggen, tejpad
        const kind = POSTERS[i % POSTERS.length], px = X + 38, py = 6, pw = 20, ph = 24;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px + 1.5, py + 2, pw, ph);
        if (kind === 'map') { // flyktplan
            box(g, px, py, pw, ph, '#e7dcc0');
            g.strokeStyle = 'rgba(80,60,30,0.6)'; g.lineWidth = 0.7;
            for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(px + 2, py + 4 + k * 5); g.lineTo(px + pw - 2, py + 5 + k * 5); g.stroke(); }
            g.setLineDash([2, 1.5]); g.strokeStyle = '#b91c1c'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 4, py + 4); g.lineTo(px + 6, py + 15); g.lineTo(px + 15, py + 19); g.stroke(); g.setLineDash([]);
            g.strokeStyle = '#b91c1c'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(px + 13, py + 17); g.lineTo(px + 18, py + 22); g.moveTo(px + 18, py + 17); g.lineTo(px + 13, py + 22); g.stroke();
        } else if (kind === 'pinup') {
            box(g, px, py, pw, ph, '#f9a8d4');
            g.fillStyle = '#9d174d'; g.beginPath(); g.ellipse(px + 10, py + 6, 2.6, 3, 0, 0, TAU); g.fill();
            g.beginPath(); g.moveTo(px + 7, py + 9); g.quadraticCurveTo(px + 15, py + 13, px + 8, py + 16); g.quadraticCurveTo(px + 14, py + 19, px + 9, py + 23); g.lineTo(px + 12, py + 23); g.quadraticCurveTo(px + 17, py + 18, px + 12, py + 16); g.quadraticCurveTo(px + 17, py + 12, px + 12, py + 9); g.fill();
        } else if (kind === 'car') {
            box(g, px, py, pw, ph, '#1e3a8a'); box(g, px, py + ph - 7, pw, 7, '#334155');
            g.fillStyle = '#dc2626'; rr(g, px + 2, py + 11, 16, 6, 2); g.fill(); rr(g, px + 5, py + 8, 9, 4, 2); g.fill();
            disc(g, px + 6, py + 17, 2, '#111'); disc(g, px + 14, py + 17, 2, '#111');
            g.font = `5px ${SIGN_FONT}`; g.fillStyle = '#fde047'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('V8', px + 10, py + 4);
        } else if (kind === 'family') {
            box(g, px, py, pw, ph, '#f5f5f4'); box(g, px + 2, py + 2, pw - 4, ph - 7, '#7dd3fc'); box(g, px + 2, py + 12, pw - 4, 5, '#4d7c0f');
            for (const [dx, c] of [[6, '#e0ac69'], [10, '#8d5524'], [14, '#f1c27d']]) { disc(g, px + dx, py + 9, 2, c); box(g, px + dx - 2, py + 11, 4, 4, '#be123c'); }
        } else if (kind === 'football') {
            box(g, px, py, pw, ph, '#15803d');
            g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 0.7; g.strokeRect(px + 2, py + 2, pw - 4, ph - 4); g.beginPath(); g.moveTo(px + 2, py + 12); g.lineTo(px + pw - 2, py + 12); g.stroke();
            g.beginPath(); g.arc(px + 10, py + 12, 3, 0, TAU); g.stroke();
            g.font = `5px ${SIGN_FONT}`; g.fillStyle = '#fde047'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MFF', px + 10, py + 6.5);
        } else {
            box(g, px, py, pw, ph, '#38bdf8'); box(g, px, py + 15, pw, 9, '#fcd34d'); disc(g, px + 15, py + 6, 3, '#fde68a');
            g.strokeStyle = '#78350f'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(px + 6, py + 19); g.quadraticCurveTo(px + 5, py + 12, px + 8, py + 8); g.stroke();
            g.fillStyle = '#15803d'; for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(px + 8 + Math.cos(k * 1.6) * 3, py + 8 + Math.sin(k * 1.6) * 2, 3.5, 1.4, k * 1.6, 0, TAU); g.fill(); }
        }
        g.fillStyle = 'rgba(235,235,225,0.75)';
        for (const [dx, dy] of [[-2, -1], [pw - 3, -1], [-2, ph - 2], [pw - 3, ph - 2]]) g.fillRect(px + dx, py + dy, 5, 3);
        // streck på väggen: dagarna räknas
        g.strokeStyle = 'rgba(230,230,220,0.55)'; g.lineWidth = 0.8;
        const days = 3 + tileHash(i, 5) % 9;
        for (let d = 0; d < days; d++) {
            const gx = X + 66 + Math.floor(d / 5) * 9 + (d % 5) * 1.6, gy = 12;
            g.beginPath();
            if (d % 5 === 4) { g.moveTo(gx - 7, gy + 8); g.lineTo(gx + 1, gy + 1); } else { g.moveTo(gx, gy); g.lineTo(gx, gy + 9); }
            g.stroke();
        }
        // småsaker: en bok och en mugg
        const h = tileHash(i, 77);
        g.save(); g.translate(X + 52 + (h % 12), TS + 76 + ((h >> 4) % 10)); g.rotate((h % 9) * 0.2);
        box(g, -5, -3.5, 10, 7, ['#7f1d1d', '#1e3a8a', '#365314'][i % 3]); box(g, -5, -3.5, 1.5, 7, 'rgba(255,255,255,0.3)');
        g.restore();
        disc(g, X + 80, TS + 52, 3.2, '#e5e7eb'); disc(g, X + 80, TS + 52, 2.2, '#57361b');
        const rugCol = ['#7f1d1d', '#1e3a8a', '#3f6212', '#78350f', '#4c1d95', '#334155'][i];
        g.fillStyle = rgba(rugCol, 0.55); rr(g, X + 38, TS + 40, 22, 30, 3); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; rr(g, X + 40, TS + 42, 18, 26, 2); g.stroke();
        if (i % 2) { g.fillStyle = ORANGE; rr(g, X + 66, TS + 66, 16, 9, 3); g.fill(); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(X + 66, TS + 70, 16, 1); }
        if (i === PLAYER_CELL) {
            // den lösa plattan: sprickor och lite grus runt kanten
            const tx0 = X, ty0 = 3 * TS;
            g.strokeStyle = 'rgba(30,25,20,0.75)'; g.lineWidth = 1.2; g.strokeRect(tx0 + 5.5, ty0 + 5.5, 21, 21);
            g.strokeStyle = 'rgba(30,25,20,0.5)'; g.lineWidth = 0.8;
            g.beginPath(); g.moveTo(tx0 + 6, ty0 + 14); g.lineTo(tx0 + 12, ty0 + 17); g.lineTo(tx0 + 16, ty0 + 25); g.moveTo(tx0 + 26, ty0 + 9); g.lineTo(tx0 + 20, ty0 + 13); g.stroke();
            g.fillStyle = 'rgba(120,110,95,0.9)'; for (let k = 0; k < 7; k++) { const r = tileHash(k, 909); g.fillRect(tx0 + 3 + (r % 26), ty0 + ((r >> 5) & 1 ? 2 : 27) + ((r >> 8) % 3), 1.6, 1.4); }
        }
        // cellnummer på gallret
        plate(g, 'A' + (i + 1), (x0 + 2) * TS + 22, 4 * TS + 6, 16, 9, { bg: '#e8b923', edge: '#6b4f05', fg: '#111827', size: 6 });
    }
}

// Galler: två skenor och tätt satta stänger (lite perspektiv nedåt)
function barsRow(g, x, y, w) {
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, y + 22, w, 8);
    box(g, x, y + 7, w, 3, '#2c3238'); box(g, x, y + 7, w, 1, '#9aa4ae');
    for (let px = x + 2; px < x + w - 1; px += 5.3) {
        box(g, px, y + 6, 2.6, 18, '#48505a');
        box(g, px, y + 6, 1, 18, '#c2cad3');
        disc(g, px + 1.3, y + 6, 1.4, '#d4dae0');
    }
    box(g, x, y + 21, w, 3, '#2c3238'); box(g, x, y + 21, w, 1, '#7b8590');
}

function paintBars(g, def) {
    eachTile(def, '|', (tx, ty) => barsRow(g, tx * TS, ty * TS, TS));
    // dörröppningarna: skenor i golvet och taket (själva dörren ritas i dyn)
    for (const x0 of CELL_X) {
        const x = (x0 + 1) * TS, y = 4 * TS;
        box(g, x, y + 7, TS, 2, '#2c3238'); box(g, x, y + 23, TS, 2, '#2c3238');
        box(g, x, y + 7, TS, 0.8, 'rgba(255,255,255,0.3)');
    }
}

function officeChair(g, cx, cy, face, seat = '#1f2937', back = '#111827') {
    g.save(); g.translate(cx, cy); g.rotate(face);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(2, 3, 11, 0, TAU); g.fill();
    g.strokeStyle = '#374151'; g.lineWidth = 2;
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); g.stroke(); }
    disc(g, 0, 0, 8.5, seat); disc(g, -1, -1, 3.5, 'rgba(255,255,255,0.1)');
    g.fillStyle = back; rr(g, -13, -9, 5, 18, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(-13, -9, 1.2, 18);
    g.restore();
}

function paintGuardRoom(g) {
    // konsolen med fyra monitorer (bilderna rullar i dyn), tangentbord och knappar
    slabRect(g, 25 * TS, TS, 4 * TS, TS, { side: '#171b21', top: '#2c333d', hi: 'rgba(160,190,230,0.3)', ins: 2 });
    for (let i = 0; i < 4; i++) {
        const mx = 25 * TS + 5 + i * TS;
        box(g, mx, TS + 3, 22, 16, '#07090c'); box(g, mx + 1.5, TS + 4.5, 19, 13, '#0f2a1f');
        box(g, mx + 9, TS + 19, 4, 2, '#07090c');
        box(g, mx + 2, TS + 23, 18, 5, '#9ca3af'); for (let k = 0; k < 6; k++) box(g, mx + 3 + k * 2.8, TS + 24, 1.8, 1.4, '#4b5563');
    }
    disc(g, 28 * TS + 25, TS + 25, 3, '#f8fafc'); disc(g, 28 * TS + 25, TS + 25, 2, '#5b3a1a'); // kaffe
    for (let k = 0; k < 3; k++) disc(g, 25 * TS + 26 + k * 4, TS + 25, 1.3, ['#ef4444', '#22c55e', '#facc15'][k]);
    // nyckelskåpet
    const kx = 30 * TS, ky = TS;
    softShadow(g, kx + 16, ky + 16, 14, 14, 0.3);
    box(g, kx + 2, ky + 1, 28, 28, '#4b5563'); box(g, kx + 4, ky + 3, 24, 24, '#2b3440');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
        const hx = kx + 7 + c * 6, hy = ky + 6 + r * 8;
        disc(g, hx, hy, 0.8, '#9ca3af');
        box(g, hx - 0.6, hy + 1, 1.3, 3.5, '#d4a72c'); disc(g, hx, hy + 1.2, 1.3, '#d4a72c');
        box(g, hx + 0.8, hy + 2.5, 2, 2.5, ['#ef4444', '#3b82f6', '#22c55e', '#f8fafc'][(r + c) % 4]);
    }
    // stolar
    officeChair(g, tc(26), tc(2) - 3, -PI / 2);
    officeChair(g, tc(28), tc(2) - 1, -PI / 2 + 0.4);
    disc(g, 25 * TS + 8, 3 * TS + 22, 5, '#475569'); disc(g, 25 * TS + 8, 3 * TS + 22, 3.6, '#1e293b'); // papperskorg
    // klocka på väggen
    disc(g, 29 * TS + 16, 15, 7, '#111827'); disc(g, 29 * TS + 16, 15, 5.8, '#f8fafc');
    g.strokeStyle = '#111827'; g.lineWidth = 1; g.beginPath(); g.moveTo(29 * TS + 16, 15); g.lineTo(29 * TS + 16, 11); g.moveTo(29 * TS + 16, 15); g.lineTo(29 * TS + 19, 16); g.stroke();
    // glasrutan mot korridoren och dörren
    glassRow(g, 25 * TS, 4 * TS, 4 * TS);
    glassRow(g, 30 * TS, 4 * TS, TS);
    const dx = 29 * TS, dy = 4 * TS;
    box(g, dx, dy + 6, 3, 20, '#4b5563'); box(g, dx + TS - 3, dy + 6, 3, 20, '#4b5563');
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(dx + 7, dy - 18, 4, 26); // öppen dörr in mot rummet
    box(g, dx + 3, dy - 20, 5, 28, '#aab3bd'); box(g, dx + 3, dy - 20, 1.2, 28, 'rgba(255,255,255,0.5)'); box(g, dx + 7, dy - 20, 1, 28, '#6b7280');
    disc(g, dx + 8.5, dy - 14, 1.6, '#e5e7eb');
    plate(g, 'VAKT', 27 * TS, 4 * TS + 16, 30, 11, ENAMEL);
}

// Glasvägg sedd uppifrån: ram, glas, mittposter och reflexer
function glassRow(g, x, y, w) {
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y + 20, w, 6);
    box(g, x, y + 9, w, 2.5, '#4b5563'); box(g, x, y + 20.5, w, 2.5, '#4b5563');
    box(g, x, y + 11.5, w, 9, 'rgba(150,210,245,0.42)');
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    for (let k = x + 6; k < x + w; k += 23) { g.beginPath(); g.moveTo(k, y + 19.5); g.lineTo(k + 6, y + 12.5); g.stroke(); }
    for (let k = x; k <= x + w; k += TS) box(g, Math.min(k, x + w - 3), y + 8, 3, 16, '#374151');
}

function benchH(g, x, y, w, o = {}) {
    softShadow(g, x + w / 2, y + 17, w / 2, 8, 0.25);
    box(g, x + 1, y + 8, w - 2, 16, o.side || '#2f3a45');
    box(g, x + 2, y + 9, w - 4, 13, o.top || '#4a5866');
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 1; k < 3; k++) g.fillRect(x + 2, y + 9 + k * 4.4, w - 4, 1);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 2, y + 9, w - 4, 1);
    for (const bx of [x + 5, x + w - 5]) disc(g, bx, y + 15.5, 1.3, '#9aa3ad');
}

function stool(g, cx, cy, top = '#64748b') {
    softShadow(g, cx, cy, 9, 9, 0.3);
    disc(g, cx, cy, 8.5, '#374151'); disc(g, cx, cy, 6.6, top); disc(g, cx - 2, cy - 2, 2.4, 'rgba(255,255,255,0.22)');
}

function paintMess(g) {
    // köket: rostfri vägg med spis, kastruller och slevar
    const kx = TS, ky = 7 * TS;
    box(g, kx, ky + 14, 6 * TS, 18, '#8d97a2'); box(g, kx, ky + 14, 6 * TS, 1.5, 'rgba(255,255,255,0.45)');
    for (let i = 0; i < 6; i++) box(g, kx + i * TS, ky + 14, 1, 18, 'rgba(0,0,0,0.25)');
    for (const [px, inner] of [[kx + 18, '#7c4a1e'], [kx + 52, '#e7dcc0'], [kx + 118, '#b45309']]) {
        disc(g, px, ky + 23, 9.5, '#4b5563'); disc(g, px, ky + 23, 8.2, '#aeb6bf'); disc(g, px, ky + 23, 6.4, inner);
        disc(g, px - 2, ky + 21, 1.6, 'rgba(255,255,255,0.35)');
    }
    disc(g, kx + 86, ky + 23, 8, '#111827'); disc(g, kx + 86, ky + 23, 6, '#27272a'); box(g, kx + 93, ky + 22, 9, 2.4, '#111827'); // stekpanna
    for (let i = 0; i < 4; i++) { const sx = kx + 148 + i * 9; box(g, sx, ky + 15, 1.3, 8, '#cbd5e1'); disc(g, sx + 0.6, ky + 24, 2.6, '#cbd5e1'); }
    // serveringsdisken med bleck och brickstapel
    slabRect(g, TS, 9 * TS, 6 * TS, TS, { side: '#3f474f', top: '#b3bcc5', hi: 'rgba(255,255,255,0.5)', ins: 2 });
    const FOOD = [['#efe4bd', 'mos'], ['#5f9e2a', 'ärtor'], ['#6b3f1f', 'köttbullar'], ['#d4a24c', 'fisk']];
    for (let i = 0; i < 4; i++) {
        const px = TS + 5 + i * 37, py = 9 * TS + 4;
        box(g, px, py, 31, 18, '#d1d5db'); box(g, px + 1.5, py + 1.5, 28, 15, FOOD[i][0]);
        const h = tileHash(i, 41);
        if (i === 0) { g.strokeStyle = 'rgba(160,130,60,0.5)'; g.lineWidth = 0.8; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(px + 7 + k * 6, py + 9, 3, PI, TAU); g.stroke(); } }
        if (i === 1) for (let k = 0; k < 16; k++) { const r = tileHash(h, k); disc(g, px + 3 + (r % 25), py + 3 + ((r >> 6) % 11), 1.3, (k & 1) ? '#4d7c0f' : '#84cc16'); }
        if (i === 2) { box(g, px + 1.5, py + 1.5, 28, 15, '#7a4a22'); for (let k = 0; k < 7; k++) { const r = tileHash(h, k); disc(g, px + 5 + (k % 4) * 6.5 + (r & 1), py + 5 + Math.floor(k / 4) * 7, 2.7, '#5a3010'); disc(g, px + 4.4 + (k % 4) * 6.5, py + 4.4 + Math.floor(k / 4) * 7, 0.9, 'rgba(255,255,255,0.3)'); } }
        if (i === 3) for (let k = 0; k < 5; k++) { box(g, px + 3 + k * 5, py + 3, 3.6, 11, '#c2862f'); box(g, px + 3 + k * 5, py + 3, 3.6, 1.2, '#e8b45c'); }
        box(g, px + 22, py - 1, 1.6, 9, '#e5e7eb'); disc(g, px + 22.8, py + 8, 2.4, '#e5e7eb'); // slev
    }
    for (let k = 0; k < 5; k++) { box(g, 5 * TS + 22 + k * 0.6, 9 * TS + 3 + k * 2.6, 34, 15, k & 1 ? '#7c5a3a' : '#8b6844'); box(g, 5 * TS + 22 + k * 0.6, 9 * TS + 3 + k * 2.6, 34, 1, 'rgba(255,255,255,0.25)'); }
    box(g, TS, 9 * TS + 26, 6 * TS, 3.5, 'rgba(170,220,255,0.45)'); box(g, TS, 9 * TS + 26, 6 * TS, 0.8, 'rgba(255,255,255,0.7)'); // nysskydd
    // långbordet och bänkarna
    benchH(g, 2 * TS, 11 * TS, 6 * TS); benchH(g, 2 * TS, 13 * TS - 8, 6 * TS);
    slabRect(g, 2 * TS, 12 * TS, 6 * TS, TS, { side: '#4b5563', top: '#c8d1d8', hi: 'rgba(255,255,255,0.55)' });
    for (let k = 0; k < 5; k++) box(g, 2 * TS + 34 + k * 32, 12 * TS + 3, 1, 26, 'rgba(0,0,0,0.08)');
    disc(g, 4 * TS + 10, 12 * TS + 16, 2.2, '#f8fafc'); disc(g, 4 * TS + 15, 12 * TS + 16, 2.2, '#292524'); // salt och peppar
    disc(g, 6 * TS + 20, 12 * TS + 10, 3, '#e5e7eb'); disc(g, 6 * TS + 20, 12 * TS + 10, 2, '#7dd3fc');
    for (let k = 0; k < 8; k++) { const r = tileHash(k, 63); g.fillStyle = 'rgba(120,90,50,0.4)'; g.fillRect(2 * TS + 8 + (r % 170), 12 * TS + 6 + ((r >> 9) % 18), 1.4, 1.4); }
    // kortbordet: pallar, backar och spelet
    stool(g, tc(9), tc(11) + 2); stool(g, tc(9), tc(13) - 2);
    for (const cx of [tc(8) + 1, tc(10) - 1]) {
        softShadow(g, cx, tc(12), 10, 10, 0.3);
        box(g, cx - 10, tc(12) - 10, 20, 20, '#1d4ed8'); box(g, cx - 8, tc(12) - 8, 16, 16, '#1e40af');
        g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.fillRect(cx - 7 + i * 5.2, tc(12) - 7 + j * 5.2, 3.2, 3.2);
    }
    const cx = tc(9), cy = tc(12);
    softShadow(g, cx, cy, 15, 15, 0.35);
    box(g, cx - 15, cy - 15, 30, 30, '#5b3a1e'); box(g, cx - 13, cy - 13, 26, 26, '#2f5d3a');
    for (let k = 0; k < 6; k++) {
        const r = tileHash(k, 88);
        g.save(); g.translate(cx - 6 + (r % 12), cy - 6 + ((r >> 5) % 12)); g.rotate((r % 20) * 0.3);
        box(g, -2.5, -3.5, 5, 7, '#f8fafc'); box(g, -1.2, -1.5, 2.4, 2.4, (k & 1) ? '#dc2626' : '#111827');
        g.restore();
    }
    for (const [dx, dy] of [[-10, -10], [10, 9], [-9, 10]]) { disc(g, cx + dx, cy + dy, 2.6, '#1d4ed8'); disc(g, cx + dx, cy + dy, 1.6, '#e5e7eb'); } // snusdosor
    // menytavla och klocka
    plate(g, 'MENY', 5 * TS, 15 * TS + 10, 54, 14, { bg: '#1c1917', edge: '#a8a29e', fg: '#f5f5f4', size: 7 });
    g.fillStyle = 'rgba(245,245,244,0.6)'; g.font = `5px ${SIGN_FONT}`; g.textAlign = 'center'; g.fillText('KÅLPUDDING · MOS', 5 * TS, 15 * TS + 21);
    disc(g, 10 * TS + 16, 7 * TS + 18, 7, '#111827'); disc(g, 10 * TS + 16, 7 * TS + 18, 5.8, '#f8fafc');
    g.strokeStyle = '#111827'; g.lineWidth = 1; g.beginPath(); g.moveTo(10 * TS + 16, 7 * TS + 18); g.lineTo(10 * TS + 16, 7 * TS + 14); g.moveTo(10 * TS + 16, 7 * TS + 18); g.lineTo(10 * TS + 13, 7 * TS + 19); g.stroke();
}

function paintVisit(g) {
    // glasväggen med hyllor på båda sidor
    const y = 19 * TS;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(TS, y + 2, 10 * TS, 30);
    box(g, TS, y, 10 * TS, 9, '#8b7b5e'); box(g, TS, y, 10 * TS, 1.5, 'rgba(255,255,255,0.3)');
    box(g, TS, y + 23, 10 * TS, 9, '#8b7b5e'); box(g, TS, y + 23, 10 * TS, 1.5, 'rgba(255,255,255,0.3)');
    box(g, TS, y + 9, 10 * TS, 14, '#3f4a55');
    box(g, TS, y + 10.5, 10 * TS, 11, 'rgba(160,215,245,0.5)');
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1;
    for (let k = TS + 8; k < 11 * TS; k += 26) { g.beginPath(); g.moveTo(k, y + 20); g.lineTo(k + 7, y + 11.5); g.stroke(); }
    // skärmar mellan båsen, pallar och telefoner
    for (const bx of BOOTH_X) {
        for (const sy of [18, 20]) {
            const px = (bx + 1) * TS, py = sy * TS;
            g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 14, py, 8, TS);
            box(g, px + 11, py, 9, TS, '#c8bfa9'); box(g, px + 11, py, 1.5, TS, 'rgba(255,255,255,0.35)'); box(g, px + 18.5, py, 1.5, TS, 'rgba(0,0,0,0.25)');
            stool(g, tc(bx), sy === 18 ? tc(18) + 2 : tc(20) - 2, '#7c6f5a');
        }
        box(g, (bx + 1) * TS + 11, y, 9, 32, '#b3aa94');
        for (const py of [y + 2, y + 25]) {
            box(g, tc(bx) + 4, py, 11, 6, '#1f2937'); box(g, tc(bx) + 5, py + 1, 9, 1.4, '#374151');
            for (let k = 0; k < 3; k++) disc(g, tc(bx) + 6.5 + k * 3, py + 4, 0.7, '#9ca3af');
        }
    }
    // telefonautomaten på väggen (fångsidan)
    const ax = 18, ay = 17 * TS + 2;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(ax + 2, ay + 2, 13, 24);
    box(g, ax, ay, 13, 24, '#334155'); box(g, ax + 1.5, ay + 1.5, 10, 6, '#94a3b8'); box(g, ax + 2.5, ay + 2.5, 8, 4, '#a3e635');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) box(g, ax + 2.5 + c * 3, ay + 10 + r * 3, 2, 2, '#cbd5e1');
    box(g, ax + 4.5, ay + 20, 4, 1.4, '#0f172a');
    plate(g, 'TELEFON', 32, 16 * TS + 10, 40, 10, { bg: '#0f172a', edge: '#64748b', fg: '#e2e8f0', size: 5.5 });
    plate(g, 'BESÖK', 6 * TS, 15 * TS + 26, 40, 10, STENCIL);
    plate(g, 'BESÖKSTID 10–16', 5 * TS + 16, 23 * TS + 9, 84, 11, { bg: '#f5f5f4', edge: '#78716c', fg: '#292524', size: 6 });
    plantAt(g, tc(1) - 2, tc(22) + 2, 4);
    disc(g, tc(10) + 6, tc(22) + 6, 6, '#475569'); disc(g, tc(10) + 6, tc(22) + 6, 4.4, '#1e293b');
    // barnteckningar på väggen vid båsen
    for (let k = 0; k < 3; k++) { const px = [TS + 8, 8 * TS + 2, 9 * TS + 2][k], py = 23 * TS + 2; box(g, px, py, 14, 10, '#fefce8'); disc(g, px + 5, py + 4, 2, ['#f59e0b', '#ef4444', '#22c55e'][k]); box(g, px + 2, py + 7, 10, 1.2, '#3b82f6'); }
}

function paintOffice(g) {
    // matta under skrivbordet
    const rx = 13 * TS + 4, ry = 9 * TS + 2, rw = 4 * TS - 8, rh = 3 * TS - 4;
    box(g, rx, ry, rw, rh, '#6b1d2a'); g.strokeStyle = '#d4a72c'; g.lineWidth = 1.5; g.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);
    g.strokeStyle = 'rgba(212,167,44,0.4)'; g.lineWidth = 1; g.strokeRect(rx + 8, ry + 8, rw - 16, rh - 16);
    // dagsljus från fönstret
    g.fillStyle = 'rgba(255,250,220,0.10)'; g.beginPath(); g.moveTo(18 * TS, 9 * TS + 4); g.lineTo(18 * TS, 11 * TS - 4); g.lineTo(15 * TS, 11 * TS + 20); g.lineTo(15 * TS, 9 * TS + 30); g.fill();
    // skrivbordet med lampa, papper, namnskylt och telefon
    slabRect(g, 14 * TS, 10 * TS, 2 * TS, TS, { side: '#3b2414', top: '#7a4a24', hi: 'rgba(255,220,170,0.35)' });
    const dx = 14 * TS, dy = 10 * TS;
    disc(g, dx + 9, dy + 9, 4, '#a16207'); g.fillStyle = '#166534'; rr(g, dx + 4, dy + 5, 11, 6, 3); g.fill(); box(g, dx + 5, dy + 6, 9, 1, 'rgba(255,255,255,0.35)');
    for (let k = 0; k < 3; k++) { g.save(); g.translate(dx + 28 + k, dy + 14 - k); g.rotate(-0.15 + k * 0.1); box(g, -7, -9, 14, 18, k === 2 ? '#fef9c3' : '#f8fafc'); g.restore(); }
    g.fillStyle = 'rgba(30,41,59,0.6)'; for (let k = 0; k < 4; k++) g.fillRect(dx + 24, dy + 8 + k * 3, 9 - (k & 1) * 3, 0.8);
    box(g, dx + 40, dy + 4, 12, 9, '#111827'); box(g, dx + 41, dy + 5, 10, 2.5, '#374151');
    box(g, dx + 18, dy + 23, 28, 6, '#a16207'); box(g, dx + 19, dy + 24, 26, 4, '#d4a72c');
    g.font = `4px ${SIGN_FONT}`; g.fillStyle = '#3a2410'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('DIREKTÖR', dx + 32, dy + 26.2);
    disc(g, dx + 56, dy + 20, 3, '#f8fafc'); disc(g, dx + 56, dy + 20, 2, '#57361b');
    officeChair(g, 480, 292, PI / 2, '#3b2414', '#2a170c');
    // arkivskåp, flagga, växt
    const fx = 12 * TS, fy = 8 * TS;
    softShadow(g, fx + 16, fy + 16, 14, 14, 0.3);
    box(g, fx + 2, fy + 2, 28, 26, '#6b7280'); box(g, fx + 2, fy + 2, 28, 1.5, 'rgba(255,255,255,0.35)');
    for (let k = 0; k < 3; k++) { box(g, fx + 4, fy + 5 + k * 8, 24, 6.5, '#4b5563'); box(g, fx + 12, fy + 7.5 + k * 8, 8, 1.6, '#d1d5db'); }
    const px = 17 * TS + 22, py = 8 * TS + 8;
    softShadow(g, px, py, 5, 5, 0.4);
    g.save(); g.translate(px, py); g.rotate(2.35);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(2, -5, 24, 14);
    box(g, 0, -7, 24, 14, '#1d4ed8'); box(g, 7, -7, 3.5, 14, '#facc15'); box(g, 0, -1.75, 24, 3.5, '#facc15');
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(14, -7, 2, 14); g.fillRect(20, -7, 1.5, 14);
    g.restore();
    disc(g, px, py, 3.2, '#78350f'); disc(g, px, py, 2, '#facc15');
    plantAt(g, tc(17), tc(12), 2);
    // fönster mot gården (med galler)
    const wx = 18 * TS, wy = 9 * TS;
    box(g, wx + 7, wy + 2, 18, 60, '#3f454b'); box(g, wx + 9, wy + 4, 14, 56, '#9cc9e6');
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(wx + 9, wy + 30); g.lineTo(wx + 23, wy + 12); g.lineTo(wx + 23, wy + 20); g.lineTo(wx + 9, wy + 38); g.fill();
    for (let k = 0; k < 5; k++) box(g, wx + 9, wy + 8 + k * 12, 14, 1.6, '#2b3036');
    // bokhylla och tavlor på väggarna
    for (let k = 0; k < 14; k++) { const r = tileHash(k, 17); box(g, 11 * TS + 23, 9 * TS + 2 + k * 6.6, 8 - (r % 3), 5.4, ['#7f1d1d', '#1e3a8a', '#365314', '#78350f', '#334155'][r % 5]); }
    box(g, 14 * TS + 2, 7 * TS + 15, 30, 16, '#a16207'); box(g, 14 * TS + 4, 7 * TS + 17, 26, 12, '#60a5fa'); box(g, 14 * TS + 4, 7 * TS + 24, 26, 5, '#4d7c0f');
    g.fillStyle = '#e5e7eb'; g.beginPath(); g.moveTo(14 * TS + 8, 7 * TS + 24); g.lineTo(14 * TS + 15, 7 * TS + 18); g.lineTo(14 * TS + 22, 7 * TS + 24); g.fill();
    box(g, 16 * TS + 4, 7 * TS + 17, 18, 13, '#f8fafc'); disc(g, 16 * TS + 18, 7 * TS + 26, 2.4, '#b91c1c');
    g.fillStyle = 'rgba(30,41,59,0.5)'; for (let k = 0; k < 3; k++) g.fillRect(16 * TS + 7, 7 * TS + 20 + k * 2.6, 12, 0.8);
    plate(g, 'DIREKTÖR', 12 * TS + 16, 13 * TS + 22, 30, 9, { bg: '#d4a72c', edge: '#78350f', fg: '#3a2410', size: 4.5 });
}

function paintHall(g) {
    // väntbänk längs väggen
    const bx = 12 * TS, by = 15 * TS;
    softShadow(g, bx + 16, by + 32, 10, 30, 0.25);
    box(g, bx + 6, by + 2, 20, 60, '#5b3a1e'); for (let k = 0; k < 4; k++) box(g, bx + 7 + k * 4.8, by + 2, 3.6, 60, '#8b5e34');
    box(g, bx + 6, by + 2, 20, 1.5, 'rgba(255,255,255,0.2)');
    // vaktens lucka: disk, glasskydd med springa, liggare, stämpel, skärm
    slabRect(g, 16 * TS, 20 * TS, 2 * TS, TS, { side: '#3f3a33', top: '#9a8f7a', hi: 'rgba(255,255,255,0.35)' });
    const lx = 16 * TS, ly = 20 * TS;
    box(g, lx + 4, ly + 4, 20, 14, '#f8fafc'); box(g, lx + 14, ly + 4, 0.8, 14, 'rgba(0,0,0,0.3)');
    g.fillStyle = 'rgba(30,41,59,0.5)'; for (let k = 0; k < 4; k++) { g.fillRect(lx + 6, ly + 7 + k * 3, 6, 0.7); g.fillRect(lx + 16, ly + 7 + k * 3, 6, 0.7); }
    box(g, lx + 44, ly + 3, 16, 11, '#111827'); box(g, lx + 45.5, ly + 4.5, 13, 7, '#38bdf8');
    disc(g, lx + 33, ly + 10, 3, '#7f1d1d'); box(g, lx + 32, ly + 4, 2, 6, '#3f2a14');
    box(g, lx, ly + 24, 2 * TS, 4, 'rgba(170,220,255,0.5)'); box(g, lx + 22, ly + 24, 20, 4, '#9a8f7a');
    disc(g, lx + 32, ly + 27, 2.4, '#d4a72c');
    // metallbåge på väg in mot slussen
    const mx = 15 * TS + 6, my = 17 * TS + 2;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(mx + 2, my + 4, 46, 8);
    box(g, mx, my, 6, 12, '#9ca3af'); box(g, mx + 40, my, 6, 12, '#9ca3af');
    box(g, mx, my + 2, 46, 5, '#d1d5db'); box(g, mx, my + 2, 46, 1.2, '#ffffff');
    disc(g, mx + 23, my + 4.5, 1.4, '#22c55e');
    // golvmarkeringar: vänta här, pilar
    box(g, 15 * TS + 10, 21 * TS + 2, 2 * TS + 22, 2.5, 'rgba(234,179,8,0.85)');
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = 'rgba(234,179,8,0.7)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('VÄNTA HÄR', 16 * TS + 24, 21 * TS + 11);
    g.fillText('◀ BESÖK', 12 * TS + 34, 21 * TS + 22);
    // slussgrindens gula ruta på gårdssidan
    g.strokeStyle = 'rgba(234,179,8,0.7)'; g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeRect(19 * TS + 2, 17 * TS + 2, TS + 12, 3 * TS - 4); g.setLineDash([]);
    // porten: skjutport i stål, varningsränder, gatan utanför
    const gx = 14 * TS, gy = 23 * TS;
    box(g, gx, gy + 20, 2 * TS, 12, '#1b2028'); box(g, gx, gy + 27, 2 * TS, 5, '#2a3140');
    box(g, gx, gy + 3, 2 * TS, 2, '#1f2937'); box(g, gx, gy + 17, 2 * TS, 2, '#1f2937');
    hazard(g, gx - TS, 22 * TS + 26, 4 * TS, 6);
    const sx = 16 * TS;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(sx + 2, gy + 4, 56, 18);
    box(g, sx, gy + 2, 54, 16, '#6b7280'); box(g, sx, gy + 2, 54, 2, 'rgba(255,255,255,0.3)');
    for (let k = 0; k < 8; k++) box(g, sx + 3 + k * 6.6, gy + 5, 2.4, 10, '#4b5563');
    hazard(g, sx, gy + 14, 54, 4);
    disc(g, sx + 4, gy + 10, 1.4, '#22c55e');
    // KÅKEN-skylten över hallen, utgångsskylt vid porten
    g.fillStyle = 'rgba(10,8,6,0.9)'; rr(g, 14 * TS + 4, 13 * TS + 3, 4 * TS - 8, 24, 5); g.fill();
    g.strokeStyle = 'rgba(249,115,22,0.85)'; g.lineWidth = 1.2; rr(g, 14 * TS + 5, 13 * TS + 4, 4 * TS - 10, 22, 4); g.stroke();
    neonText(g, 'KÅKEN', 16 * TS, 13 * TS + 16, 15, '#fdba74', '#f97316');
    box(g, 12 * TS + 4, 23 * TS + 10, 42, 12, '#052e16'); box(g, 12 * TS + 4, 23 * TS + 10, 42, 12, 'rgba(34,197,94,0.25)');
    g.strokeStyle = 'rgba(74,222,128,0.7)'; g.lineWidth = 1; g.strokeRect(12 * TS + 4.5, 23 * TS + 10.5, 41, 11);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#4ade80'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTGÅNG', 12 * TS + 25, 23 * TS + 16.5);
}

// Staket med nät och stolpar, slussgrinden står öppen
function paintFence(g, def) {
    eachTile(def, ',', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 20, y, 6, TS);
        g.save(); g.beginPath(); g.rect(x + 11, y, 10, TS); g.clip();
        g.strokeStyle = 'rgba(196,204,210,0.75)'; g.lineWidth = 0.8;
        for (let k = -12; k < TS + 12; k += 4) { g.beginPath(); g.moveTo(x + 11, y + k); g.lineTo(x + 21, y + k + 10); g.moveTo(x + 21, y + k); g.lineTo(x + 11, y + k + 10); g.stroke(); }
        g.restore();
        box(g, x + 10, y, 1.5, TS, '#8a939b'); box(g, x + 20.5, y, 1.5, TS, '#8a939b');
        disc(g, x + 16, y + 2, 3.3, '#3f4750'); disc(g, x + 15.3, y + 1.3, 1.2, '#cbd5e1');
        g.strokeStyle = 'rgba(205,210,215,0.7)'; g.lineWidth = 0.8;
        for (let k = 0; k < TS; k += 5) { g.beginPath(); g.arc(x + 16, y + k + 2.5, 2.8, 0, TAU); g.stroke(); }
    });
    // slussgrinden (18,18): stolpar och en öppen grind uppskjuten längs staketet
    const x = 18 * TS, y = 18 * TS;
    for (const py of [y + 1, y + TS - 1]) { disc(g, x + 16, py, 4.4, '#1f2937'); disc(g, x + 16, py, 3, '#e8b923'); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 23, y - 24, 4, 28);
    box(g, x + 20, y - 26, 4, 28, '#6b7280'); box(g, x + 20, y - 26, 1.2, 28, '#cbd5e1');
    box(g, x + 19, y + 5, 5, 6, '#111827'); disc(g, x + 21.5, y + 8, 1, '#ef4444');
    box(g, x + 4, y + 15, 24, 2, 'rgba(234,179,8,0.6)');
}

function paintYard(g) {
    courtLines(g);
    // korgen: stolpe vid väggen, arm och tavla (ringen ritas ovanpå folk)
    const hx = RIM.x, hy = 8 * TS;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(hx - 22, hy + 16, 50, 7);
    box(g, hx - 7, hy, 14, 9, '#1f2937'); box(g, hx - 7, hy + 6, 14, 3, '#e8b923');
    box(g, hx - 2, hy + 6, 4, 8, '#374151');
    box(g, hx - 24, hy + 10, 48, 6, '#f1f5f9'); box(g, hx - 24, hy + 10, 48, 1.4, '#ffffff'); box(g, hx - 24, hy + 15, 48, 1, '#94a3b8');
    g.strokeStyle = '#ea580c'; g.lineWidth = 1.2; g.strokeRect(hx - 8, hy + 11, 16, 4);
    // gymmet: bänkpress med ställning, hantelställ, viktskivor
    const bx = 20 * TS, by = 20 * TS;
    softShadow(g, bx + 16, by + 32, 8, 28, 0.3);
    box(g, bx + 12, by + 4, 8, 58, '#4b5563');
    g.fillStyle = '#111827'; rr(g, bx + 9, by + 12, 14, 46, 4); g.fill();
    g.fillStyle = '#b91c1c'; rr(g, bx + 10, by + 13, 12, 44, 3.5); g.fill();
    box(g, bx + 11, by + 14, 10, 1.4, 'rgba(255,255,255,0.3)');
    for (const px of [bx + 3, bx + 29]) { disc(g, px, by + 8, 3.4, '#1f2937'); disc(g, px, by + 8, 1.6, '#9ca3af'); }
    box(g, bx + 3, by + 4, 26, 2, '#374151');
    const rx = 22 * TS, ry = 22 * TS;
    softShadow(g, rx + 16, ry + 16, 15, 13, 0.3);
    box(g, rx + 2, ry + 3, 28, 25, '#374151'); box(g, rx + 3, ry + 4, 26, 23, '#1f2937');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) {
        const dx = rx + 5 + c * 13, dy = ry + 7 + r * 7;
        box(g, dx, dy, 3, 4.6, '#0b0f14'); box(g, dx + 3, dy + 1.6, 4.5, 1.4, '#cbd5e1'); box(g, dx + 7.5, dy, 3, 4.6, '#0b0f14');
    }
    for (const [cx, cy, r] of [[19 * TS + 10, 22 * TS + 18, 10], [19 * TS + 10, 22 * TS + 18, 7], [19 * TS + 22, 21 * TS + 26, 6]]) {
        disc(g, cx, cy, r, '#111827'); disc(g, cx, cy, r - 1.5, '#27272a'); disc(g, cx, cy, 1.6, '#9ca3af');
    }
    disc(g, 21 * TS + 22, 22 * TS + 22, 5, '#111827'); box(g, 21 * TS + 19, 22 * TS + 14, 6, 3, '#111827'); // kettlebell
    // bänkar på gården
    benchH(g, 24 * TS, 22 * TS - 2, 3 * TS, { side: '#5b5f63', top: '#8b5e34' });
    // vakttornets fot och stege (hytten ritas ovanpå folk)
    const tx = 29 * TS, ty = 21 * TS;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(tx - 6, ty + 4, 70, 62);
    box(g, tx, ty, 64, 64, '#4b5156'); box(g, tx + 4, ty + 4, 56, 56, '#5a6166');
    for (let k = 0; k < 4; k++) box(g, tx + 4, ty + 14 + k * 12, 56, 1, 'rgba(0,0,0,0.25)');
    box(g, tx - 9, ty + 6, 2, 54, '#9ca3af'); box(g, tx - 2, ty + 6, 2, 54, '#9ca3af');
    for (let k = 0; k < 9; k++) box(g, tx - 9, ty + 9 + k * 6, 9, 1.5, '#9ca3af');
    // brunn och ogräs
    const dx = 23 * TS + 4, dy = 20 * TS + 8;
    box(g, dx, dy, 16, 12, '#1f2326'); g.fillStyle = '#4b5563'; for (let k = 0; k < 4; k++) g.fillRect(dx + 2 + k * 3.6, dy + 2, 1.6, 8);
    for (let k = 0; k < 14; k++) {
        const r = tileHash(k, 404), wx = 19 * TS + 2 + (r % (12 * TS - 4)), wy = (r & 1) ? 8 * TS + 2 : 23 * TS - 4;
        g.fillStyle = (k & 1) ? '#4d7c0f' : '#65a30d';
        for (let j = 0; j < 3; j++) g.fillRect(wx + j * 1.6, wy - j, 1.2, 3 + j);
    }
}

// Taggtråd på murkrönet runt gården
function paintWire(g) {
    g.strokeStyle = 'rgba(200,206,212,0.75)'; g.lineWidth = 0.9;
    for (let y = 8 * TS + 4; y < 23 * TS; y += 6) { g.beginPath(); g.arc(31 * TS + 13, y, 4, 0, TAU); g.stroke(); }
    for (let x = 19 * TS + 4; x < 31 * TS; x += 6) { g.beginPath(); g.arc(x, 23 * TS + 13, 4, 0, TAU); g.stroke(); }
    g.strokeStyle = 'rgba(30,30,30,0.6)'; g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(31 * TS + 13, 8 * TS); g.lineTo(31 * TS + 13, 23 * TS); g.moveTo(19 * TS, 23 * TS + 13); g.lineTo(31 * TS, 23 * TS + 13); g.stroke();
    // strålkastare på gårdens hörn
    for (const [lx, ly] of [[19 * TS + 8, 7 * TS + 27], [30 * TS + 24, 7 * TS + 27]]) { box(g, lx - 6, ly - 4, 12, 7, '#1f2937'); box(g, lx - 5, ly + 1, 10, 2, '#fef9c3'); }
}

function paintCorridorFloor(g) {
    box(g, TS, 5 * TS + 4, 30 * TS, 2.5, 'rgba(234,179,8,0.85)');
}

function paintCorridor(g) {
    // brandsläckare och slangskåp på väggen
    const ex = 17 * TS + 10, ey = 7 * TS + 9;
    g.fillStyle = '#b91c1c'; rr(g, ex, ey, 7, 15, 3); g.fill(); box(g, ex + 1, ey + 2, 2, 9, 'rgba(255,255,255,0.3)'); box(g, ex + 2, ey - 2, 3, 3, '#111827');
    box(g, 3 * TS + 4, 7 * TS + 7, 18, 18, '#b91c1c'); box(g, 3 * TS + 6, 7 * TS + 9, 14, 14, '#dc2626');
    g.strokeStyle = '#f8fafc'; g.lineWidth = 1.2; g.beginPath(); g.arc(3 * TS + 13, 7 * TS + 16, 4, 0, TAU); g.stroke();
    plate(g, 'CELLBLOCK A', 19 * TS + 18, 7 * TS + 11, 92, 15, ENAMEL);
    plate(g, 'MATSAL', 7 * TS + 10, 7 * TS + 9, 46, 12, STENCIL);
    plate(g, 'RASTGÅRD', 25 * TS, 7 * TS + 15, 66, 14, STENCIL);
    const bx = 30 * TS + 10, by = 6 * TS + 14;
    softShadow(g, bx, by, 8, 7, 0.3);
    g.fillStyle = '#eab308'; rr(g, bx - 8, by - 6, 16, 13, 3); g.fill(); box(g, bx - 6, by - 4, 9, 8, '#5b7a8c');
    g.strokeStyle = '#a16207'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(bx - 2, by); g.lineTo(bx - 14, by - 14); g.stroke();
    g.fillStyle = '#e5e7eb'; g.beginPath(); g.arc(bx - 2, by, 3, 0, TAU); g.fill();
}

// Övervakningskameror: fästen (huvudena rör sig i dyn)
const CAMS = [[TS + 6, 5 * TS + 4, 0.5], [30 * TS + 26, 5 * TS + 4, PI - 0.5], [19 * TS + 6, 8 * TS + 4, 0.8], [12 * TS + 6, 14 * TS + 4, 0.8], [10 * TS + 26, 8 * TS + 4, PI - 0.8]];

function paintPrison(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) floorTile(g, def, tx, ty);
    paintCorridorFloor(g);
    wallPass(g, def, WALL_PAL);
    aoPass(g, def);
    paintWire(g);
    paintCorridor(g);
    paintCells(g, def);
    paintBars(g, def);
    paintGuardRoom(g);
    paintMess(g);
    paintVisit(g);
    paintOffice(g);
    paintHall(g);
    paintFence(g, def);
    paintYard(g);
    for (const [x, y] of CAMS) { box(g, x - 3, y - 3, 6, 6, '#111827'); }
}

// ═══════════════════════════════════════════
//  RÖRLIGT LAGER
// ═══════════════════════════════════════════

const FEEDS = [
    { x0: 19 * TS, y0: 8 * TS, x1: 31 * TS, y1: 23 * TS },
    { x0: TS, y0: TS, x1: 24 * TS, y1: 7 * TS },
    { x0: TS, y0: 8 * TS, x1: 11 * TS, y1: 15 * TS },
    { x0: 12 * TS, y0: 14 * TS, x1: 18 * TS, y1: 23 * TS }
];

// Vaktrummets monitorer: prickar där folk går, scanlinjer, ibland brus
function monitors(ctx, state, v, t) {
    if (v.x1 < 25 * TS || v.y0 > 2 * TS) return;
    for (let i = 0; i < 4; i++) {
        const sx = 25 * TS + 6.5 + i * TS, sy = TS + 4.5, sw = 19, sh = 13, F = FEEDS[i];
        const glitch = ((t * 0.21 + i * 0.29) % 1) < 0.04;
        ctx.fillStyle = glitch ? '#4b5563' : '#0f281d'; ctx.fillRect(sx, sy, sw, sh);
        if (glitch) {
            for (let k = 0; k < 7; k++) { const r = tileHash(Math.floor(t * 30) + k, i); ctx.fillStyle = (r & 1) ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'; ctx.fillRect(sx, sy + (r % sh), sw, 1); }
            continue;
        }
        ctx.strokeStyle = 'rgba(140,255,190,0.28)'; ctx.lineWidth = 0.6; ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
        const kx = (sw - 2) / (F.x1 - F.x0), ky = (sh - 2) / (F.y1 - F.y0);
        for (const n of state.npcs) {
            if (n.x < F.x0 || n.x > F.x1 || n.y < F.y0 || n.y > F.y1) continue;
            ctx.fillStyle = n.kind === 'guard' ? '#93c5fd' : n.kind === 'inmate' ? '#fdba74' : '#e5e7eb';
            ctx.fillRect(sx + 1 + (n.x - F.x0) * kx - 0.6, sy + 1 + (n.y - F.y0) * ky - 0.6, 1.4, 1.4);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let yy = 0; yy < sh; yy += 2) ctx.fillRect(sx, sy + yy, sw, 0.7);
        const band = (t * 9 + i * 5) % (sh + 6) - 3;
        ctx.fillStyle = 'rgba(200,255,220,0.13)'; ctx.fillRect(sx, sy + clamp(band, 0, sh - 2), sw, 2);
        if (Math.floor(t * 1.5 + i) % 2) { ctx.fillStyle = '#ef4444'; ctx.fillRect(sx + 1.5, sy + 1.5, 1.6, 1.6); }
    }
}

// Gallerdörrarna: skjuts åt sidan när de öppnas
function cellDoors(ctx, P, v, lockOn, t) {
    if (v.y0 > 5 * TS || v.y1 < 4 * TS) return;
    for (let i = 0; i < CELL_X.length; i++) {
        const f = P.doors[i], X = (CELL_X[i] + 1) * TS, Y = 4 * TS;
        if (X > v.x1 + TS || X < v.x0 - 2 * TS) continue;
        const px = X - f * 27;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px + 2, Y + 22, TS - 2, 6);
        ctx.fillStyle = '#353c44'; ctx.fillRect(px, Y + 5, TS, 3); ctx.fillRect(px, Y + 22, TS, 3);
        ctx.fillStyle = '#2b3138'; ctx.fillRect(px, Y + 5, 2.5, 20); ctx.fillRect(px + TS - 2.5, Y + 5, 2.5, 20);
        for (let k = 0; k < 5; k++) {
            const rx = px + 4.5 + k * 5.3;
            ctx.fillStyle = '#56606b'; ctx.fillRect(rx, Y + 6, 2.6, 18);
            ctx.fillStyle = '#d3dae2'; ctx.fillRect(rx, Y + 6, 1, 18);
        }
        ctx.fillStyle = '#c8d0d8'; ctx.fillRect(px, Y + 5, TS, 1);
        ctx.fillStyle = '#111827'; ctx.fillRect(px + TS - 7, Y + 11, 6, 9);
        ctx.fillStyle = f < 0.05 ? (lockOn && Math.floor(t * 4) % 2 ? '#fca5a5' : '#ef4444') : '#22c55e';
        ctx.fillRect(px + TS - 5.5, Y + 13, 3, 2.4);
    }
}

// Luren ligger på klykan när ingen pratar i den
function handsets(ctx, state, v) {
    if (v.x0 > 11 * TS || v.y1 < 16 * TS || v.y0 > 23 * TS) return;
    const used = new Set();
    for (const n of state.npcs) if (n.phoneAt && n.prop === 'phone') used.add(Math.round(n.phoneAt.x) + ',' + Math.round(n.phoneAt.y));
    for (const bx of BOOTH_X) for (const py of [19 * TS + 5, 19 * TS + 27]) {
        const x = tc(bx) + 9;
        if (used.has(Math.round(x) + ',' + py)) continue;
        ctx.fillStyle = '#0b0f19'; rr(ctx, x - 6, py - 2.6, 12, 3.6, 1.8); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x - 4, py - 2.2, 8, 0.8);
    }
    if (!used.has(PAYPHONE.x + ',' + PAYPHONE.y)) { ctx.fillStyle = '#0b0f19'; rr(ctx, 29, 17 * TS + 4, 3.6, 12, 1.8); ctx.fill(); }
}

function steam(ctx, v, t) {
    if (v.x0 > 7 * TS || v.y1 < 7 * TS || v.y0 > 10 * TS) return;
    for (let i = 0; i < 5; i++) {
        const bx = i < 4 ? TS + 20 + i * 37 : TS + 52, by = i < 4 ? 9 * TS + 12 : 7 * TS + 22;
        for (let k = 0; k < 2; k++) {
            const ph = (t * 0.45 + i * 0.37 + k * 0.5) % 1;
            ctx.globalAlpha = 0.22 * (1 - ph);
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(bx + Math.sin(t * 1.3 + i + k) * 3, by - ph * 16, 3 + ph * 5, 0, TAU); ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

function cams(ctx, v, t) {
    for (let i = 0; i < CAMS.length; i++) {
        const [x, y, a0] = CAMS[i];
        if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue;
        const a = a0 + Math.sin(t * 0.5 + i * 1.7) * 0.5;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = 'rgba(255,255,210,0.05)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 120, -0.35, 0.35); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#1b1d20'; rr(ctx, -3, -4, 13, 8, 2.5); ctx.fill();
        ctx.fillStyle = '#3b3f45'; ctx.fillRect(9, -2.6, 3.4, 5.2);
        ctx.fillStyle = Math.floor(t * 1.6 + i) % 2 ? '#ff2a2a' : '#5c1010'; ctx.beginPath(); ctx.arc(1, -1.5, 1.2, 0, TAU); ctx.fill();
        ctx.restore();
    }
}

// Larmlampor (roterande) vid inlåsning
const BEACONS = [[TS + 6, 5 * TS + 3], [16 * TS, 5 * TS + 3], [30 * TS + 26, 5 * TS + 3], [20 * TS + 16, 8 * TS + 3], [31 * TS + 3, 15 * TS], [12 * TS + 18, 14 * TS + 3], [5 * TS, 8 * TS + 3], [6 * TS, 16 * TS + 3]];
function beacons(ctx, v, t) {
    for (let i = 0; i < BEACONS.length; i++) {
        const [x, y] = BEACONS[i];
        if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue;
        const a = t * 6 + i * 1.3;
        ctx.fillStyle = '#3f0d0d'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fecaca'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 4, a, a + 1.1); ctx.closePath(); ctx.fill();
    }
}

function dynPrison(ctx, state, v, t) {
    const P = state.prison;
    monitors(ctx, state, v, t);
    if (P) {
        cellDoors(ctx, P, v, P.lockOn, t);
        // skivstången vilar i ställningen när ingen ligger på bänken
        if (slotFree(P, 'w0')) {
            const bx = 20 * TS + 16, by = 20 * TS + 9;
            ctx.fillStyle = '#9ca3af'; ctx.fillRect(bx - 20, by - 1, 40, 2);
            for (const s of [-1, 1]) { ctx.fillStyle = '#111827'; ctx.fillRect(bx + s * 17 - 2, by - 5, 4, 10); ctx.fillStyle = '#374151'; ctx.fillRect(bx + s * 14 - 1, by - 3.5, 2.4, 7); }
        }
        if (P.lockOn) beacons(ctx, v, t);
    }
    handsets(ctx, state, v);
    steam(ctx, v, t);
    cams(ctx, v, t);
    // KÅKEN-skylten blinkar LARM vid inlåsning
    if (P && P.lockOn) {
        // larmet pulserar rött över golvet
        ctx.fillStyle = `rgba(255,20,20,${0.05 + 0.08 * (0.5 + 0.5 * Math.sin(t * 5.5))})`;
        ctx.fillRect(Math.max(0, v.x0), Math.max(0, v.y0), Math.min(state.def.w * TS, v.x1) - Math.max(0, v.x0), Math.min(state.def.h * TS, v.y1) - Math.max(0, v.y0));
    }
    if (P && P.lockOn && Math.floor(t * 3) % 2) {
        ctx.fillStyle = 'rgba(40,0,0,0.92)'; rr(ctx, 14 * TS + 6, 13 * TS + 5, 4 * TS - 12, 20, 4); ctx.fill();
        ctx.font = `13px ${SIGN_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fca5a5'; ctx.fillText('LARM', 16 * TS, 13 * TS + 16);
    }
    exitArrow(ctx, state.def, t);
}

// ── Ovanpå folk: korgens ring, bollen, vakttornets hytt ──
function overPrison(ctx, state, v, t) {
    const P = state.prison;
    if (v.x1 > 19 * TS && v.y0 < 16 * TS) {
        const sw = P && P.ball.swish > 0 ? Math.sin(P.ball.swish * 40) * 1.5 * P.ball.swish : 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 0.8;
        for (let k = 0; k < 8; k++) {
            const a = k / 8 * TAU;
            ctx.beginPath(); ctx.moveTo(RIM.x + Math.cos(a) * 7.5, RIM.y + Math.sin(a) * 4.5); ctx.lineTo(RIM.x + sw + Math.cos(a) * 4, RIM.y + 7 + Math.sin(a) * 2.5); ctx.stroke();
        }
        ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(RIM.x, RIM.y, 8, 5, 0, 0, TAU); ctx.stroke();
    }
    if (P) {
        const b = ballPos(P, t);
        if (b.x > v.x0 - 20 && b.x < v.x1 + 20 && b.y > v.y0 - 40 && b.y < v.y1 + 20) {
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(b.x + 1.5, b.y + 2, 4.2, 2.8, 0, 0, TAU); ctx.fill();
            const y = b.y - b.z;
            ctx.fillStyle = '#ea580c'; ctx.beginPath(); ctx.arc(b.x, y, 4.3, 0, TAU); ctx.fill();
            ctx.strokeStyle = 'rgba(40,15,5,0.8)'; ctx.lineWidth = 0.7;
            ctx.beginPath(); ctx.moveTo(b.x - 4.3, y); ctx.lineTo(b.x + 4.3, y); ctx.moveTo(b.x, y - 4.3); ctx.lineTo(b.x, y + 4.3); ctx.stroke();
            ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(b.x - 1.4, y - 1.4, 1.4, 0, TAU); ctx.fill();
        }
    }
    // vakttornets hytt: plattform med räcke, glasad hytt med pyramidtak, antenn och strålkastare
    const ox = TOWER.x, oy = TOWER.y, S = 74;
    if (ox - 20 < v.x1 && oy - 20 < v.y1) {
        ctx.fillStyle = 'rgba(0,0,0,0.38)'; rr(ctx, ox + 9, oy + 13, S, S, 4); ctx.fill();
        ctx.fillStyle = '#3f4650'; rr(ctx, ox, oy, S, S, 3); ctx.fill();
        ctx.fillStyle = '#5b6470'; ctx.fillRect(ox + 3, oy + 3, S - 6, S - 6);
        ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let k = 1; k < 8; k++) ctx.fillRect(ox + 3, oy + 3 + k * 8.5, S - 6, 1);
        ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.4; ctx.strokeRect(ox + 2.5, oy + 2.5, S - 5, S - 5);
        ctx.fillStyle = '#e2e8f0'; for (let k = 0; k <= 4; k++) for (const [px, py] of [[ox + 2.5 + k * (S - 5) / 4, oy + 2.5], [ox + 2.5 + k * (S - 5) / 4, oy + S - 2.5], [ox + 2.5, oy + 2.5 + k * (S - 5) / 4], [ox + S - 2.5, oy + 2.5 + k * (S - 5) / 4]]) { ctx.beginPath(); ctx.arc(px, py, 1.5, 0, TAU); ctx.fill(); }
        const c0 = ox + 13, c1 = oy + 13, C = S - 26, mx = c0 + C / 2, my = c1 + C / 2;
        ctx.fillStyle = '#7fb4d6'; ctx.fillRect(c0 - 2, c1 - 2, C + 4, C + 4);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(c0 - 2, c1 - 2, C + 4, 1.5); ctx.fillRect(c0 - 2, c1 - 2, 1.5, C + 4);
        const tri = (ax, ay, bx, by, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(mx, my); ctx.closePath(); ctx.fill(); };
        tri(c0 - 4, c1 - 4, c0 + C + 4, c1 - 4, '#59616a');
        tri(c0 - 4, c1 - 4, c0 - 4, c1 + C + 4, '#4a5159');
        tri(c0 + C + 4, c1 - 4, c0 + C + 4, c1 + C + 4, '#353b41');
        tri(c0 - 4, c1 + C + 4, c0 + C + 4, c1 + C + 4, '#2c3136');
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath();
        ctx.moveTo(c0 - 4, c1 - 4); ctx.lineTo(c0 + C + 4, c1 + C + 4); ctx.moveTo(c0 + C + 4, c1 - 4); ctx.lineTo(c0 - 4, c1 + C + 4); ctx.stroke();
        ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + 8, my - 14); ctx.stroke();
        ctx.fillStyle = Math.floor(t * 1.2) % 2 ? '#ef4444' : '#7f1d1d'; ctx.beginPath(); ctx.arc(mx + 8, my - 14, 2.2, 0, TAU); ctx.fill();
        const a = spotAngle(state, t);
        ctx.save(); ctx.translate(SPOT.x, SPOT.y); ctx.rotate(a);
        ctx.fillStyle = '#111827'; rr(ctx, -6, -6, 15, 12, 3); ctx.fill();
        ctx.fillStyle = '#374151'; ctx.fillRect(-4, -4, 9, 2);
        ctx.fillStyle = '#fffbe6'; ctx.fillRect(8, -4.5, 2.6, 9);
        ctx.restore();
    }
}

const TOWER = { x: 29 * TS - 10, y: 21 * TS - 12 };
const SPOT = { x: TOWER.x + 6, y: TOWER.y + 6 };

// Strålkastarens riktning (från tornets hörn ut över gården)
function spotAngle(state, t) {
    const fast = state.prison && state.prison.lockOn;
    return -PI * 0.76 + Math.sin(t * (fast ? 1.15 : 0.42)) * 0.5;
}

// ── Saker i händerna, märken och den som sover ──
function sleeper(ctx, n, t) {
    const L = n.look || {}, col = BLANKETS[Math.max(0, n.p ? n.p.cell : 0) % 3];
    ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.angle);
    ctx.fillStyle = '#e7e2d3'; rr(ctx, -20, -9.5, 13, 19, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 0.8; ctx.stroke();
    disc(ctx, -12, 0, 5, L.skin || '#e0ac69');
    ctx.fillStyle = L.cap || L.hair || '#222'; ctx.beginPath(); ctx.arc(-13, 0, 5, PI * 0.5, PI * 1.5); ctx.fill();
    const br = 1 + Math.sin(t * 1.6 + n.phase) * 0.035;
    ctx.save(); ctx.scale(1, br);
    ctx.fillStyle = col; rr(ctx, -7.5, -12, 31, 24, 4); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(-7.5, -12, 4, 24);
    ctx.fillStyle = 'rgba(0,0,0,0.13)'; ctx.fillRect(4, -12, 1.2, 24); ctx.fillRect(14, -12, 1.2, 24);
    ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(19, -4, 3.5, 3, 0, 0, TAU); ctx.ellipse(19, 4, 3.5, 3, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(-4, -8.5); ctx.rotate(0.55);
    ctx.fillStyle = ORANGE; rr(ctx, 0, -1.9, 11, 3.8, 1.9); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 1.2, 11, 0.7);
    disc(ctx, 11.5, 0, 2, L.skin || '#e0ac69');
    ctx.restore();
    ctx.restore();
    const z = (t * 0.5 + n.phase * 0.1) % 1;
    ctx.globalAlpha = 0.75 * (1 - z);
    ctx.font = `bold ${7 + z * 4}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e0f2fe';
    ctx.fillText('z', n.x + 8 + z * 6, n.y - 10 - z * 12);
    ctx.globalAlpha = 1;
}

function accessoryPrison(ctx, n, t) {
    if (!n.p) return;
    const L = n.look || {};
    if (n.lie && !n.brawl && !(n.down > 0)) { sleeper(ctx, n, t); return; }
    if (n.down > 0) return;
    const c = Math.cos(n.angle), s = Math.sin(n.angle);
    // telefonsladden till luren
    if (n.prop === 'phone' && n.phoneAt) {
        const hx = n.x + c * 3 + s * 9, hy = n.y + s * 3 - c * 9;
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(n.phoneAt.x, n.phoneAt.y);
        const dx = hx - n.phoneAt.x, dy = hy - n.phoneAt.y, len = Math.hypot(dx, dy) || 1;
        for (let k = 1; k <= 10; k++) { const f = k / 10, w = Math.sin(f * PI * 6) * 1.6; ctx.lineTo(n.phoneAt.x + dx * f - dy / len * w, n.phoneAt.y + dy * f + dx / len * w + Math.sin(f * PI) * 3); }
        ctx.stroke();
    }
    ctx.save();
    ctx.translate(n.x, n.y); ctx.rotate(n.angle);
    const skin = L.skin || '#e0ac69';
    if (n.kind === 'inmate') { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(-6.4, -2.4, 2.2, 4.8); } // fångnummer på ryggen
    if (n.kind === 'guard') {
        disc(ctx, 3.6, -3.9, 1.5, '#facc15');
        ctx.fillStyle = '#0b0f19'; ctx.fillRect(-1.6, 5.4, 3.2, 2.6); ctx.fillRect(-0.6, 7.6, 0.8, 2.4);
        if (n.pose !== 'sit') { ctx.strokeStyle = '#0b0b0b'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(-5, 8.6); ctx.lineTo(2.5, 10); ctx.stroke(); }
    }
    switch (n.prop) {
        case 'tray': {
            const sit = n.pose === 'sit', bx = sit ? 13 : 8;
            ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(bx + 1.5, -6, 12, 15);
            ctx.fillStyle = '#7c5a3a'; rr(ctx, bx, -7.5, 12, 15, 2); ctx.fill();
            ctx.fillStyle = '#efe4bd'; ctx.fillRect(bx + 1.5, -6, 4.5, 5.5);
            ctx.fillStyle = '#5f9e2a'; ctx.fillRect(bx + 1.5, 0.8, 4.5, 5);
            ctx.fillStyle = '#6b3f1f'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(bx + 9, -4 + k * 4, 1.7, 0, TAU); ctx.fill(); }
            if (sit) {
                const k = (Math.sin(n.phase * 2.4) + 1) / 2, hx = 7 + k * 8, hy = 4.5 - k * 2;
                ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + 4, hy - 1.5); ctx.stroke();
                disc(ctx, hx, hy, 1.9, skin);
            } else { disc(ctx, bx, -6.5, 1.9, skin); disc(ctx, bx, 6.5, 1.9, skin); }
            break;
        }
        case 'cards':
            for (let j = 0; j < 4; j++) {
                ctx.save(); ctx.translate(9, 0); ctx.rotate(-0.5 + j * 0.33);
                ctx.fillStyle = '#f8fafc'; ctx.fillRect(1, -2.2, 6, 4.4);
                ctx.fillStyle = j & 1 ? '#dc2626' : '#111827'; ctx.fillRect(4.5, -0.7, 1.4, 1.4);
                ctx.restore();
            }
            disc(ctx, 8.5, -3, 1.9, skin); disc(ctx, 8.5, 3, 1.9, skin);
            break;
        case 'phone':
            ctx.fillStyle = '#0b0f19'; rr(ctx, -2.5, -10.5, 9, 3.4, 1.6); ctx.fill();
            disc(ctx, 3, -8.6, 1.9, skin);
            break;
        case 'barbell': {
            const k = (1 - Math.cos(n.phase * 1.9)) / 2, bx = 2 + k * 5, ps = 1 + k * 0.25;
            ctx.fillStyle = '#9ca3af'; ctx.fillRect(bx - 1, -18, 2, 36);
            for (const sd of [-1, 1]) {
                ctx.fillStyle = '#111827'; ctx.fillRect(bx - 4.5 * ps, sd * 14.5 - 2 * ps, 9 * ps, 4 * ps);
                ctx.fillStyle = '#374151'; ctx.fillRect(bx - 3 * ps, sd * 11.6 - 1.2, 6 * ps, 2.4);
                disc(ctx, bx, sd * 7.5, 2, skin);
            }
            break;
        }
        case 'dumbbells':
            for (const sd of [-1, 1]) {
                const k = (1 + Math.sin(t * 3.2 + (sd > 0 ? 0 : PI))) / 2, x = 3 + k * 7, y = sd * 8.6;
                ctx.fillStyle = '#9ca3af'; ctx.fillRect(x - 0.8, y - 3.5, 1.6, 7);
                ctx.fillStyle = '#111827'; ctx.fillRect(x - 2.2, y - 5, 4.4, 2.4); ctx.fillRect(x - 2.2, y + 2.6, 4.4, 2.4);
                disc(ctx, x, y, 1.9, skin);
            }
            break;
        default: break;
    }
    if (n.p.tag === 'dealer' && n.pose !== 'walk') { disc(ctx, 0.5, 11.5, 2.8, '#e5e7eb'); disc(ctx, 0.5, 11.5, 2, '#1d4ed8'); } // snusdosan
    if (n.kind === 'cook' && n.pose === 'work') {
        ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(8.5, 5.5); ctx.lineTo(16, 5); ctx.stroke();
        disc(ctx, 17, 5, 2.4, '#d1d5db'); disc(ctx, 17, 5, 1.5, '#b45309');
    }
    if (n.bag && n.pose !== 'sit') { const sw = n.pose === 'walk' ? Math.sin(n.phase) * 2.5 : 0; ctx.fillStyle = n.bag; ctx.fillRect(-3 + sw, 10.5, 8, 6); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(-3 + sw, 10.5, 8, 1.2); }
    ctx.restore();
    // bråk på gården / runt ett slagsmål: ilsket märke ovanför huvudet
    if ((n.p.ov === 'riot' || n.p.ov === 'panic') && n.kind === 'inmate' && n.p.mode === 'stay') anger(ctx, n.x + 7, n.y - 17, 1 + 0.15 * Math.sin(t * 9 + n.x), n.p.ov === 'riot' ? '#dc2626' : '#f59e0b');
}

function anger(ctx, x, y, s, col) {
    ctx.strokeStyle = col; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
        const a = PI / 4 + k * PI / 2, cx = x + Math.cos(a) * 4.6 * s, cy = y + Math.sin(a) * 4.6 * s;
        ctx.beginPath(); ctx.arc(cx, cy, 2.8 * s, a + PI - 0.85, a + PI + 0.85); ctx.stroke();
    }
    ctx.lineCap = 'butt';
}

// ═══════════════════════════════════════════
//  LJUS
// ═══════════════════════════════════════════

const GLOWS = [
    ...[3, 8, 13, 18, 23, 28].map(x => [tc(x), 5 * TS + 16, 95, '#e0f2fe', 0.11, 0]),
    ...CELL_X.map(x0 => [tc(x0 + 1), 2 * TS, 46, '#fde68a', 0.09, 0]),
    [27 * TS, 44, 90, '#38bdf8', 0.2, 2.1],
    [tc(5), tc(11), 160, '#fff7e0', 0.11, 0],
    [tc(3), 8 * TS + 20, 70, '#fb923c', 0.16, 1.5],
    [6 * TS, 19 * TS + 16, 150, '#e0f2fe', 0.1, 0],
    [14 * TS + 9, 10 * TS + 9, 54, '#fde68a', 0.3, 0],
    [17 * TS + 20, 10 * TS, 70, '#bae6fd', 0.16, 0],
    [480, 18 * TS, 140, '#f1f5f9', 0.08, 0],
    [16 * TS, 13 * TS + 16, 110, '#f97316', 0.22, 0],
    [480, 23 * TS + 4, 70, '#22c55e', 0.2, 3.2],
    [19 * TS + 8, 8 * TS + 6, 170, '#fef9c3', 0.1, 0],
    [30 * TS + 24, 8 * TS + 6, 170, '#fef9c3', 0.1, 0]
];
const RED_WASH = [[16 * TS, 6 * TS], [6 * TS, 12 * TS], [25 * TS, 15 * TS], [6 * TS, 19 * TS], [15 * TS, 18 * TS], [16 * TS, 3 * TS]];

function coneP(hex) {
    return sprite('kakcone' + hex, 64, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(hex, 0.7)); gr.addColorStop(1, rgba(hex, 0.05));
        g.fillStyle = gr;
        for (const k of [1, 0.7, 0.45]) {
            g.globalAlpha = 0.38;
            g.beginPath(); g.moveTo(w / 2 - 2 * k, 0); g.lineTo(w / 2 + 2 * k, 0); g.lineTo(w / 2 + (w / 2) * k, h); g.lineTo(w / 2 - (w / 2) * k, h); g.closePath(); g.fill();
        }
    });
}

function lightsPrison(ctx, state, v, t, glow) {
    const P = state.prison, lock = P && P.lockOn;
    // vakttornets strålkastare sveper över gården
    const lx = SPOT.x, ly = SPOT.y, a = spotAngle(state, t), L = 250 + 60 * Math.sin(t * 0.29);
    const sx = lx + Math.cos(a) * L, sy = ly + Math.sin(a) * L;
    const cone = coneP('#fff8dc');
    if (cone && v.x1 > 19 * TS && v.y1 > 8 * TS) {
        ctx.save();
        ctx.beginPath(); ctx.rect(19 * TS, 8 * TS, 12 * TS, 15 * TS); ctx.clip();
        ctx.translate(lx, ly); ctx.rotate(a - PI / 2);
        ctx.globalAlpha = 0.42;
        ctx.drawImage(cone, -34, 0, 68, L);
        ctx.restore();
    }
    glow(sx, sy, 52, '#fffbe6', 0.34);
    glow(sx, sy, 22, '#ffffff', 0.3);
    if (lock) {
        // inlåsning: roterande röda lampor och ett pulserande rött sken över allt
        const pulse = 0.5 + 0.5 * Math.sin(t * 5.5);
        for (const [x, y] of RED_WASH) glow(x, y, 330, '#ff1a1a', 0.12 + 0.2 * pulse);
        for (let i = 0; i < BEACONS.length; i++) {
            const [x, y] = BEACONS[i], r = t * 6 + i * 1.3;
            glow(x, y, 46, '#ff3030', 0.55);
            glow(x + Math.cos(r) * 52, y + Math.sin(r) * 52, 78, '#ff2020', 0.42);
        }
    }
    if (P && P.riotOn) {
        const f = 0.7 + 0.3 * Math.sin(t * 13) * Math.sin(t * 7.3);
        for (const c of RIOT_AT) glow(c.x, c.y, 110, '#f97316', 0.22 * f);
    }
    // monitorernas flimmer
    glow(27 * TS, TS + 12, 40, '#86efac', 0.08 + 0.05 * Math.sin(t * 17));
}

// ═══════════════════════════════════════════
//  REGISTRERA RUMMET
// ═══════════════════════════════════════════

registerInterior(PRISON_DEF, {
    populate: (def, rnd) => populatePrison(def, rnd),
    update: updatePrison,
    step: stepPrison,
    paint: paintPrison,
    dyn: dynPrison,
    accessory: accessoryPrison,
    over: overPrison,
    glows: GLOWS,
    lights: lightsPrison
});

export { PRISON_DEF, CELL_X, PLAYER_CELL };
