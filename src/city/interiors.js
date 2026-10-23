// ═══════════════════════════════════════════
//  STAN — interiörer
//  Små inomhusvärldar man går in i från en dörr:
//  Club Diamant (nattklubb) och Pang-Pelles Vapen.
//  Här bor kartdata, kollision, NPC-animation och
//  ritning. Folk (NPC:er, spelaren, andra spelare)
//  ritas av stadens renderare via drawPerson.
// ═══════════════════════════════════════════

export const IN_TILE = 32; // px per ruta inomhus
const TS = IN_TILE;
const PI = Math.PI;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const tc = t => t * TS + TS / 2; // mitten av en ruta, i px
const rand = (rnd, a, b) => a + rnd() * (b - a);
const pick = (rnd, arr) => arr[Math.min(arr.length - 1, Math.floor(rnd() * arr.length))];

// ── Teckenförklaring (gäller alla rum) ──
//  Gångbart:  . golv   d dansgolv   c matta   e dörröppning (in/ut)   + innerdörr
//  Solitt:    # vägg   T scen (scenkanten)   P scenstolpe (står på scenen)
//             B bardisk   o barstol   t bord   h stol   S soffa   V soffbord
//             D DJ-bord   k högtalare   x växt   W repstolpe   m skrivbord   f kassaskåp
//             C butiksdisk   G glasmonter   R vapenställ   A ammohylla   Q lådor
export const LEGEND = {
    '#': { name: 'vägg', solid: true },
    '.': { name: 'golv', solid: false },
    d: { name: 'dansgolv', solid: false },
    c: { name: 'matta', solid: false },
    e: { name: 'dörröppning', solid: false },
    '+': { name: 'innerdörr', solid: false },
    T: { name: 'scen', solid: true },
    P: { name: 'scenstolpe', solid: true },
    B: { name: 'bardisk', solid: true },
    o: { name: 'barstol', solid: true },
    t: { name: 'bord', solid: true },
    h: { name: 'stol', solid: true },
    S: { name: 'soffa', solid: true },
    V: { name: 'soffbord', solid: true },
    D: { name: 'DJ-bord', solid: true },
    k: { name: 'högtalare', solid: true },
    x: { name: 'växt', solid: true },
    W: { name: 'repstolpe', solid: true },
    m: { name: 'skrivbord', solid: true },
    f: { name: 'kassaskåp', solid: true },
    C: { name: 'butiksdisk', solid: true },
    G: { name: 'glasmonter', solid: true },
    R: { name: 'vapenställ', solid: true },
    A: { name: 'ammohylla', solid: true },
    Q: { name: 'lådor', solid: true }
};
// Okända tecken räknas som solida så att ingen ramlar ut ur ett trasigt rum
const SOLID = new Uint8Array(128).fill(1);
for (const [ch, info] of Object.entries(LEGEND)) SOLID[ch.charCodeAt(0)] = info.solid ? 1 : 0;

// ═══════════════════════════════════════════
//  RUM
// ═══════════════════════════════════════════

//            0         1         2
//            012345678901234567890123456789
const CLUB_ROWS = [
    '##############################', //  0
    '#.......kTTTTTTTTTTTTkWSSSSSS#', //  1  DJ-golv, scen, VIP-soffa
    '#.......kTTPTTTTTTPTTkWcccccS#', //  2  två scenstolpar
    '#DDDDDDDkTTTTTTTTTTTTkWcccccS#', //  3  DJ-bordet
    '#........TTTTTTTTTTTT.WccVVcS#', //  4
    '#BBB.....dddddTTddddd.WcccccS#', //  5  baren börjar, catwalken ut från scenen
    '#..B.....dddddTTddddd.ccccccS#', //  6  (22,6) och (22,7) är öppningen in till VIP
    '#..Bo....dddddTTddddd.ccccccS#', //  7
    '#..B.....dddddddddddd.WccVVcS#', //  8
    '#..Bo....dddddddddddd.WcccccS#', //  9
    '#..B.....dddddddddddd.WcccccS#', // 10
    '#..Bo....dddddddddddd.Wcccccc#', // 11
    '#..B.....dddddddddddd.WWWWWWW#', // 12
    '#..Bo........................#', // 13
    '#..B..hth....................#', // 14
    '#BBB..............hth.########', // 15  barens nedre hörn, kontorets tak
    '#.............cc......#xccccf#', // 16  röd matta från ingången
    '#.hth....hth..cc......+cccccc#', // 17  (22,17) = kontorsdörren
    '#.............cc..hth.#ccmmmc#', // 18
    '#.............cc......#cccccc#', // 19
    '#x...hth......cc.....x#SSccxc#', // 20
    '##############ee##############'  // 21  ingång/utgång
];

const GUN_ROWS = [
    '################', //  0  skyltvägg
    '#RRRRRRRRRRRRRR#', //  1  vapenväggen
    '#RRRRRRRRRRRRRR#', //  2
    '#..............#', //  3  Pelles sida av disken
    '#..............#', //  4
    '#CCCCCGGGGCCCCC#', //  5  disken med glasmonter
    '#..............#', //  6
    '#A............A#', //  7  ammohyllor längs sidorna
    '#A..GG....GG..A#', //  8  glasmontrar på golvet
    '#A............A#', //  9
    '#Q............Q#', // 10
    '#######ee#######'  // 11  stålporten
];

export const INTERIORS = {
    stripclub: {
        id: 'stripclub', name: 'Club Diamant', theme: 'club', w: 30, h: 22,
        rows: CLUB_ROWS,
        spawn: { x: 480, y: tc(19) },
        exit: { x: 480, y: 21 * TS + 20, r: 22 },
        interactions: [
            { id: 'bartender', label: 'E — Prata med bartendern', x: 148, y: tc(10), r: 64 },
            { id: 'bouncer', label: 'E — Prata med vakten', x: tc(17), y: tc(20) - 6, r: 46 },
            { id: 'manager', label: 'E — Manager: ägande och intäkter', x: tc(26), y: tc(17), r: 54 },
            { id: 'stage', label: 'E — Dusch med sedlar 💸 / tipsa scenen', x: 480, y: 280, r: 96 }
        ],
        music: 'club',
        // scenen: huvudscen + catwalk ut i dansgolvet (px)
        stage: { x0: 9 * TS, y0: 1 * TS, x1: 21 * TS, y1: 5 * TS, runway: { x0: 14 * TS, y0: 5 * TS, x1: 16 * TS, y1: 8 * TS } },
        // golvytor med egen stil (rutor)
        zones: [
            { x: 1, y: 1, w: 7, h: 2, kind: 'dj' },
            { x: 1, y: 6, w: 2, h: 9, kind: 'service' },
            { x: 22, y: 1, w: 7, h: 11, kind: 'vip' },
            { x: 23, y: 16, w: 6, h: 5, kind: 'office' }
        ]
    },
    gunshop: {
        id: 'gunshop', name: 'Pang-Pelles Vapen', theme: 'gunshop', w: 16, h: 12,
        rows: GUN_ROWS,
        spawn: { x: 256, y: tc(9) },
        exit: { x: 256, y: 11 * TS + 24, r: 22 },
        interactions: [
            { id: 'seller', label: 'E — Prata med Pang-Pelle', x: 256, y: tc(6), r: 64 }
        ],
        music: null,
        zones: [{ x: 1, y: 3, w: 14, h: 2, kind: 'staff' }]
    }
};

// ═══════════════════════════════════════════
//  RUTNÄT OCH KOLLISION
// ═══════════════════════════════════════════

function chAt(def, tx, ty) {
    if (!(tx >= 0 && ty >= 0 && tx < def.w && ty < def.h)) return '#';
    return def.rows[ty][tx];
}

function solidTile(def, tx, ty) {
    if (!(tx >= 0 && ty >= 0 && tx < def.w && ty < def.h)) return true;
    const c = def.rows[ty].charCodeAt(tx);
    return c >= 128 || SOLID[c] === 1;
}

// true = blockerat (väggar, disk, bord, soffor, scenkant, ställ ...). Utanför rummet är allt blockerat.
export function interiorSolid(def, x, y) {
    return solidTile(def, Math.floor(x / TS), Math.floor(y / TS));
}

// Är hela cirkeln fri från solida rutor? (för NPC-rutter och tester)
export function circleClear(def, x, y, r) {
    const x0 = Math.floor((x - r) / TS), x1 = Math.floor((x + r) / TS);
    const y0 = Math.floor((y - r) / TS), y1 = Math.floor((y + r) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!solidTile(def, tx, ty)) continue;
        const px = clamp(x, tx * TS, tx * TS + TS), py = clamp(y, ty * TS, ty * TS + TS);
        const dx = x - px, dy = y - py;
        if (dx * dx + dy * dy < r * r) return false;
    }
    return true;
}

// Djupaste kontakten mellan en cirkel och solida rutor (som i physics.js)
function deepestContact(def, cx, cy, r) {
    let best = null;
    const x0 = Math.floor((cx - r) / TS), x1 = Math.floor((cx + r) / TS);
    const y0 = Math.floor((cy - r) / TS), y1 = Math.floor((cy + r) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!solidTile(def, tx, ty)) continue;
        const left = tx * TS, top = ty * TS, right = left + TS, bottom = top + TS;
        const px = clamp(cx, left, right), py = clamp(cy, top, bottom);
        const dx = cx - px, dy = cy - py;
        const d2 = dx * dx + dy * dy;
        let nx, ny, pen;
        if (d2 > 1e-6) {
            if (d2 >= r * r) continue;
            const d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; pen = r - d;
        } else {
            // Mittpunkten ligger inne i rutan: ut via närmaste kant som leder till en fri ruta
            const opts = [
                [cx - left, -1, 0, tx - 1, ty], [right - cx, 1, 0, tx + 1, ty],
                [cy - top, 0, -1, tx, ty - 1], [bottom - cy, 0, 1, tx, ty + 1]
            ];
            let pickd = null;
            for (const o of opts) if (!solidTile(def, o[3], o[4]) && (!pickd || o[0] < pickd[0])) pickd = o;
            if (!pickd) for (const o of opts) if (!pickd || o[0] < pickd[0]) pickd = o;
            nx = pickd[1]; ny = pickd[2]; pen = pickd[0] + r;
        }
        if (!best || pen > best.pen) best = { nx, ny, pen };
    }
    return best;
}

// Närmaste fria ruta (mitten) inom några rutor — sista utväg om någon fastnat i en vägg
function nearestFreeSpot(def, x, y) {
    const ctx0 = Math.floor(x / TS), cty0 = Math.floor(y / TS);
    let best = null, bd = Infinity;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
        const tx = ctx0 + dx, ty = cty0 + dy;
        if (solidTile(def, tx, ty)) continue;
        const d = (tc(tx) - x) ** 2 + (tc(ty) - y) ** 2;
        if (d < bd) { bd = d; best = { x: tc(tx), y: tc(ty) }; }
    }
    return best || def.spawn;
}

// Knuffar ut en cirkel {x, y, vx, vy} ur väggar och möbler och dödar farten in i dem
export function collideInterior(def, ent, r) {
    if (!(Number.isFinite(ent.x) && Number.isFinite(ent.y))) {
        ent.x = def.spawn.x; ent.y = def.spawn.y; ent.vx = 0; ent.vy = 0;
        return;
    }
    const hasV = typeof ent.vx === 'number' && typeof ent.vy === 'number';
    for (let iter = 0; iter < 3; iter++) {
        const hit = deepestContact(def, ent.x, ent.y, r);
        if (!hit) return;
        ent.x += hit.nx * hit.pen;
        ent.y += hit.ny * hit.pen;
        if (hasV) {
            const vn = ent.vx * hit.nx + ent.vy * hit.ny;
            if (vn < 0) { ent.vx -= vn * hit.nx; ent.vy -= vn * hit.ny; }
        }
    }
    if (solidTile(def, Math.floor(ent.x / TS), Math.floor(ent.y / TS))) {
        const p = nearestFreeSpot(def, ent.x, ent.y);
        ent.x = p.x; ent.y = p.y;
        if (hasV) { ent.vx = 0; ent.vy = 0; }
    }
}

// Folket i rummet är solida för spelaren: i förstaperson ska man inte kunna gå rakt in i (och
// genom) en vakt eller kassör. Bara spelaren skjuts undan, aldrig personen. De som gått, försvunnit
// eller ligger ner (bråk, sover) går att kliva över. true = spelaren knuffades (kör väggarna igen).
export const NPC_RADIUS = 7;
export function collideNpcs(state, ent, r, npcR = NPC_RADIUS) {
    const hasV = typeof ent.vx === 'number' && typeof ent.vy === 'number';
    let hit = false;
    for (const n of state.npcs || []) {
        if (n.gone || n.dead || n.down > 0 || n.brawl === 'down' || n.lie || !(Number.isFinite(n.x) && Number.isFinite(n.y))) continue;
        const dx = ent.x - n.x, dy = ent.y - n.y, R = npcR + r, d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2);
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        ent.x = n.x + nx * R; ent.y = n.y + ny * R;
        if (hasV) {
            const vn = ent.vx * nx + ent.vy * ny;
            if (vn < 0) { ent.vx -= vn * nx; ent.vy -= vn * ny; }
        }
        hit = true;
    }
    return hit;
}

// Närmaste interaktion vars cirkel innehåller punkten
export function interactionAt(def, x, y) {
    let best = null, bd = Infinity;
    for (const a of def.interactions) {
        const dx = x - a.x, dy = y - a.y, d = dx * dx + dy * dy;
        if (d <= a.r * a.r && d < bd) { best = a; bd = d; }
    }
    return best;
}

// Står cirkeln i utgångscirkeln? (hjälp åt renderaren/världen)
export function atInteriorExit(def, x, y) {
    const dx = x - def.exit.x, dy = y - def.exit.y;
    return dx * dx + dy * dy <= def.exit.r * def.exit.r;
}

// ═══════════════════════════════════════════
//  FOLK
//  npc: { kind, x, y, angle, phase, pose, look: { shirt, skin, hair, dress?, cap?, sparkle? }, say }
//  kind klubben: dancer, bartender, bouncer, manager, dj, waitress, guest, vip, patron
//  kind butiken: seller, customer
//  pose: 'idle' | 'walk' | 'dance' | 'sit' | 'work' | 'cheer'
//  phase går framåt med rörelsen/dansen (walk: som walkPhase i stan, dance: ~3 rad/s).
//  move (bara dansare): 'orbit' | 'sway' | 'spin' | 'strut'
//  say: { text, life } — life räknas ner av updateInterior, renderaren ritar bubblan.
//  state.focus = { x, y } (valfri, t.ex. spelaren): personalen vänder sig mot den när den är nära.
// ═══════════════════════════════════════════

const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0522d'];
const HAIRS = ['#1f1300', '#5b3a1a', '#d4a017', '#111111', '#7c2d12', '#d6d3d1'];
const SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#14b8a6', '#f8fafc', '#ec4899', '#0ea5e9'];
const VIP_SHIRTS = ['#fef3c7', '#111827', '#f8fafc', '#fbbf24', '#1e3a8a', '#7f1d1d', '#065f46'];
const DRINKS = ['#f472b6', '#38bdf8', '#fbbf24', '#a3e635', '#fb7185'];

const CHEERS = ['Wooo!', 'Skål!', 'Kör!', 'Yeah!', 'Fest!', 'Mer!', 'Bäst!', 'Heja!', 'Yalla!', 'Hell yeah!'];
const LINES = {
    bartender: ['Vad blir det?', 'En till?', 'Skål, chefen!', 'Champagne? Fixar det.'],
    bouncer: ['Inga bråk här.', 'Ta det lugnt.', 'Köa som alla andra.', 'Hej, hej.'],
    manager: ['Siffrorna ser bra ut.', 'Mer champagne!', 'Kassan fylls.'],
    dj: ['Hands up!', 'Mera bas!', 'Nu kör vi!'],
    waitress: ['Champagne på väg!', 'Ursäkta!', 'Passa brickan!'],
    seller: ['Pang-Pelle har allt!', 'Inget bråk i butiken.', 'Kvalitet, kompis.', 'Kolla på montrarna.']
};

function makeNpc(kind, x, y, rnd, o = {}) {
    const look = Object.assign({
        shirt: pick(rnd, SHIRTS), skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS)
    }, o.look);
    const lines = LINES[kind] || null;
    const n = {
        kind, x, y, angle: o.angle || 0, phase: rnd() * 10, pose: o.pose || 'idle', look, say: null,
        beh: o.beh || 'still',
        lines, chatT: lines ? rand(rnd, 5, 22) : 0
    };
    if (o.drink) n.drink = o.drink;
    return Object.assign(n, o.extra);
}

// Patrullerande NPC: går mellan punkter (spots) och står en stund på varje
//  spot: { x, y, a (blickriktning eller null), pose, w: [min, max] väntetid }
function patrol(kind, rnd, spots, o = {}) {
    const first = spots[o.start || 0];
    return makeNpc(kind, first.x, first.y, rnd, {
        angle: first.a == null ? 0 : first.a, pose: first.pose || 'idle', beh: 'patrol', look: o.look, drink: o.drink,
        extra: {
            spots, si: o.start || 0, dir: 1, order: o.order || 'rand', speed: o.speed || 40, watch: !!o.watch,
            walking: false, wait: rand(rnd, 0.5, first.w ? first.w[1] : 3), turnTo: first.a == null ? 0 : first.a
        }
    });
}

function seated(kind, tx, ty, ang, rnd, look, drink) {
    const sx = tc(tx), sy = tc(ty), ph = rnd() * TAU;
    return makeNpc(kind, sx + Math.sin(ph) * 0.6, sy + Math.cos(ph) * 0.6, rnd, {
        angle: ang, pose: 'sit', beh: 'seat', look, drink,
        extra: { sx, sy, ph, cd: rand(rnd, 2, 12) }
    });
}

function floorDancer(tx, ty, rnd, look) {
    const hx = tc(tx), hy = tc(ty), ph = rnd() * TAU;
    // startar där dansen börjar (t = 0), så att första bildrutan inte hoppar
    return makeNpc('patron', hx + Math.sin(ph) * 9, hy + Math.cos(ph * 1.7) * 6, rnd, {
        angle: -PI / 2 + Math.sin(ph) * 0.7, pose: 'dance', beh: 'floor', look,
        drink: rnd() < 0.35 ? pick(rnd, DRINKS) : null,
        extra: { hx, hy, ph, spd: rand(rnd, 2.6, 3.8) }
    });
}

// Dansrutiner. Steg: { d: sekunder, a: ankare, m: rörelse, w: varv/s, amp: sidorörelse }
const POLE_SCRIPT = [
    { d: 5.5, a: 0, m: 'orbit', w: 1.5 },
    { d: 3.5, a: 1, m: 'sway', amp: 11 },
    { d: 1.6, a: 1, m: 'spin' },
    { d: 3.0, a: 1, m: 'sway', amp: 6 },
    { d: 5.5, a: 0, m: 'orbit', w: -1.5 },
    { d: 2.5, a: 1, m: 'sway', amp: 14 }
];
const RUNWAY_SCRIPT = [
    { d: 4.0, a: 0, m: 'sway', amp: 16 },
    { d: 4.8, a: 1, m: 'strut' },
    { d: 3.0, a: 1, m: 'sway', amp: 10 },
    { d: 1.4, a: 1, m: 'spin' },
    { d: 4.8, a: 0, m: 'strut' },
    { d: 2.0, a: 0, m: 'spin' }
];

function dancer(anchors, script, start, rnd, dress, hair, skin) {
    const a = anchors[0];
    return makeNpc('dancer', a.x, a.y, rnd, {
        angle: PI / 2, pose: 'dance', beh: 'dancer',
        look: { shirt: dress, skin, hair, dress, sparkle: true },
        extra: { anchors, script, si: start, st: rnd() * 1.5, bx: a.x, by: a.y, ox: 0, oy: 0, th: rnd() * TAU, mt: rnd() * 10, move: 'sway', rate: rand(rnd, 3, 3.6) }
    });
}

function populateClub(def, rnd) {
    const npcs = [];
    // Dansare: två vid stolparna, en på catwalken
    const poles = [];
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) if (def.rows[ty][tx] === 'P') poles.push({ x: tc(tx), y: tc(ty) });
    poles.sort((a, b) => a.x - b.x);
    const lead = poles[0] || { x: 368, y: 80 }, second = poles[1] || { x: 592, y: 80 };
    npcs.push(dancer([lead, { x: lead.x, y: lead.y + 22 }], POLE_SCRIPT, 0, rnd, '#db2777', '#111111', '#e0ac69'));
    npcs.push(dancer([second, { x: second.x, y: second.y + 22 }], POLE_SCRIPT, 3, rnd, '#06b6d4', '#d4a017', '#f1c27d'));
    npcs.push(dancer([{ x: 480, y: 104 }, { x: 480, y: 232 }], RUNWAY_SCRIPT, 0, rnd, '#a855f7', '#7c2d12', '#8d5524'));

    // Personalen
    npcs.push(patrol('bartender', rnd, [
        { x: 62, y: tc(9), a: 0, pose: 'work', w: [4, 9] },
        { x: 62, y: tc(10), a: 0, pose: 'work', w: [4, 9] },
        { x: 62, y: tc(11), a: 0, pose: 'work', w: [4, 9] }
    ], { speed: 38, watch: true, start: 1, look: { shirt: '#f8fafc', skin: '#c68642', hair: '#3f2a14' } }));
    npcs.push(patrol('bouncer', rnd, [
        { x: tc(17), y: tc(20) - 4, a: 2.8, pose: 'idle', w: [7, 12] },
        { x: tc(17), y: tc(19), a: -0.6, pose: 'idle', w: [4, 7] }
    ], { speed: 30, watch: true, look: { shirt: '#1b2433', skin: '#8d5524', hair: '#111111', cap: '#111827' } }));
    npcs.push(patrol('manager', rnd, [
        { x: tc(26), y: tc(17), a: PI, pose: 'idle', w: [6, 10] },
        { x: tc(27) - 4, y: tc(16) + 2, a: -PI / 2, pose: 'work', w: [3, 5] }
    ], { speed: 28, watch: true, order: 'seq', look: { shirt: '#3b0764', skin: '#f1c27d', hair: '#9ca3af' } }));
    npcs.push(patrol('dj', rnd, [
        { x: 112, y: 76, a: PI / 2, pose: 'work', w: [3, 6] },
        { x: 144, y: 76, a: PI / 2, pose: 'work', w: [3, 6] },
        { x: 176, y: 76, a: PI / 2, pose: 'work', w: [3, 6] }
    ], { speed: 24, look: { shirt: '#1e1b4b', skin: '#e0ac69', hair: '#111111', cap: '#7c3aed' } }));
    npcs.push(patrol('waitress', rnd, [
        { x: tc(5), y: tc(4), a: PI / 2, pose: 'work', w: [2, 3.5] },
        { x: tc(6), y: tc(10), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(9), y: tc(13), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(12), y: tc(16), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(16), y: tc(13), a: PI / 2, pose: 'idle', w: [1.5, 3] },
        { x: tc(21), y: tc(8), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(21), y: tc(6), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(24), y: tc(6), a: 0, pose: 'idle', w: [2, 4] }
    ], { order: 'ping', speed: 52, look: { shirt: '#111827', skin: '#e0ac69', hair: '#d4a017', dress: '#be123c' }, drink: '#f8fafc' }));

    // Gäster vid borden och baren
    const tableSeats = [[6, 14, 0], [8, 14, PI], [2, 17, 0], [4, 17, PI], [9, 17, 0], [11, 17, PI], [18, 15, 0], [20, 15, PI], [18, 18, 0], [20, 18, PI], [5, 20, 0], [7, 20, PI]];
    for (const [tx, ty, a] of tableSeats) {
        if (rnd() < 0.8) npcs.push(seated('guest', tx, ty, a, rnd, null, pick(rnd, DRINKS)));
    }
    for (const [tx, ty, a] of [[4, 7, PI], [4, 9, PI], [4, 11, PI], [4, 13, PI]]) {
        if (rnd() < 0.75) npcs.push(seated('guest', tx, ty, a, rnd, null, pick(rnd, DRINKS)));
    }
    for (const [tx, ty, a] of [[24, 1, PI / 2], [26, 1, PI / 2], [28, 3, PI], [28, 6, PI], [28, 9, PI]]) {
        if (rnd() < 0.85) npcs.push(seated('vip', tx, ty, a, rnd, { shirt: pick(rnd, VIP_SHIRTS), skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) }, '#fde68a'));
    }

    // Folk på dansgolvet och några som strosar runt
    for (const [tx, ty] of [[10.5, 9.5], [12.5, 11.5], [17.5, 9.5], [19.5, 11.5], [15.5, 10.5], [11, 7.5]]) npcs.push(floorDancer(tx, ty, rnd));
    npcs.push(patrol('patron', rnd, [
        { x: tc(9), y: tc(13), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(17), y: tc(13), a: -PI / 2, pose: 'dance', w: [2, 4] }
    ], { order: 'ping', speed: 40, drink: pick(rnd, DRINKS) }));
    npcs.push(patrol('patron', rnd, [
        { x: tc(21), y: tc(13), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(21), y: tc(9), a: -PI / 2, pose: 'dance', w: [1.5, 3.5] }
    ], { order: 'ping', speed: 36, drink: pick(rnd, DRINKS) }));
    npcs.push(patrol('patron', rnd, [
        { x: tc(3), y: tc(4), a: 0, pose: 'dance', w: [2, 4] },
        { x: tc(8), y: tc(4), a: PI, pose: 'dance', w: [2, 4] }
    ], { order: 'ping', speed: 34 }));
    return npcs;
}

function populateGunshop(def, rnd) {
    const npcs = [];
    npcs.push(patrol('seller', rnd, [
        { x: tc(6), y: tc(4), a: PI / 2, pose: 'work', w: [4, 8] },
        { x: tc(8), y: tc(4), a: PI / 2, pose: 'work', w: [4, 8] },
        { x: tc(11), y: tc(4), a: PI / 2, pose: 'work', w: [4, 8] }
    ], { speed: 34, watch: true, start: 1, look: { shirt: '#7c2d12', skin: '#e0ac69', hair: '#9ca3af', cap: '#365314' } }));
    npcs.push(patrol('customer', rnd, [
        { x: tc(3), y: tc(6), a: -PI / 2, pose: 'idle', w: [3, 6] },
        { x: tc(7), y: tc(6), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(7), y: tc(9), a: null, pose: 'walk', w: [0, 0] },
        { x: tc(12), y: tc(9), a: PI / 2, pose: 'idle', w: [3, 7] },
        { x: tc(12), y: tc(6), a: -PI / 2, pose: 'idle', w: [3, 6] }
    ], { order: 'ping', speed: 36, look: { shirt: '#14b8a6', skin: '#c68642', hair: '#111111', cap: '#1d4ed8' } }));
    return npcs;
}

export function createInteriorState(id, rnd = Math.random) {
    const def = INTERIORS[id];
    if (!def) throw new Error('Okänd interiör: ' + id);
    const th = THEMES.get(def.theme);
    const npcs = th ? th.populate(def, rnd) : def.theme === 'club' ? populateClub(def, rnd) : populateGunshop(def, rnd);
    // events: det rummet berättar för världen (t.ex. { type: 'sale', x, y } när en kund betalar)
    // owned/flow/panic sätts av världen: spelaren äger stället, hur mycket folk, rån pågår (sekunder)
    return { id, def, t: 0, npcs, focus: null, talking: 0, events: [], owned: false, flow: 1, panic: 0 };
}

// ── Animation ──
const angDiff = (a, b) => {
    let d = (b - a) % TAU;
    if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
    return d;
};
const wrapAngle = a => {
    if (a > PI) a -= TAU; else if (a < -PI) a += TAU;
    return a > PI || a < -PI ? ((a + PI) % TAU + TAU) % TAU - PI : a;
};
const turnToward = (n, a, k) => { n.angle = wrapAngle(n.angle + angDiff(n.angle, a) * Math.min(1, k)); };

// Högst några bubblor samtidigt, annars blir det som en tecknad serie
const MAX_SAY = 4;
function trySay(st, n, text, life) {
    if (n.say || st.talking >= MAX_SAY) return;
    n.say = { text, life };
    st.talking++;
}

// Håll dansaren på scenen (huvudscenen eller catwalken)
function clampToStage(st, n) {
    const m = 11, rw = st.runway;
    n.y = clamp(n.y, st.y0 + m, rw.y1 - m);
    n.x = n.y > st.y1 - m ? clamp(n.x, rw.x0 + m, rw.x1 - m) : clamp(n.x, st.x0 + m, st.x1 - m);
}

function stepDancer(n, st, dt) {
    let s = n.script[n.si];
    n.st += dt;
    if (n.st >= s.d) { n.st -= s.d; n.si = (n.si + 1) % n.script.length; s = n.script[n.si]; }
    const a = n.anchors[s.a];
    // basen glider mot ankaret, rörelsen läggs ovanpå
    const dx = a.x - n.bx, dy = a.y - n.by, dist = Math.hypot(dx, dy);
    let moving = false;
    if (dist > 0.5) {
        const m = Math.min(dist, 58 * dt);
        n.bx += dx / dist * m; n.by += dy / dist * m;
        moving = dist > 3;
    }
    n.mt += dt;
    let tx = 0, ty = 0, ang = n.angle, spin = false;
    switch (s.m) {
        case 'orbit':
            n.th += s.w * dt;
            tx = Math.cos(n.th) * 11; ty = Math.sin(n.th) * 11;
            ang = n.th + (s.w > 0 ? PI / 2 : -PI / 2);
            break;
        case 'sway':
            tx = Math.sin(n.mt * 2.1) * s.amp; ty = Math.cos(n.mt * 1.3) * 2;
            ang = PI / 2 + Math.sin(n.mt * 2.1) * 0.4;
            break;
        case 'spin':
            spin = true;
            break;
        default: // strut
            ang = moving ? Math.atan2(dy, dx) : PI / 2;
    }
    const k = Math.min(1, dt * 5);
    n.ox += (tx - n.ox) * k; n.oy += (ty - n.oy) * k;
    n.x = n.bx + n.ox; n.y = n.by + n.oy;
    clampToStage(st, n);
    if (spin) n.angle = wrapAngle(n.angle + 6.4 * dt); else turnToward(n, ang, dt * 8);
    n.move = s.m;
    n.phase += dt * (spin ? 4.8 : n.rate);
}

function stepFloorDancer(n, dt, t) {
    n.phase += dt * n.spd;
    n.x = n.hx + Math.sin(t * 0.55 + n.ph) * 9;
    n.y = n.hy + Math.cos(t * 0.8 + n.ph * 1.7) * 6;
    n.angle = wrapAngle(-PI / 2 + Math.sin(t * 0.9 + n.ph) * 0.7);
}

function stepSeated(n, st, dt, t, rnd) {
    n.phase += dt * (n.pose === 'cheer' ? 2 : 1.6);
    n.x = n.sx + Math.sin(t * 1.3 + n.ph) * 0.6;
    n.y = n.sy + Math.cos(t * 1.1 + n.ph) * 0.6;
    n.cd -= dt;
    if (n.cd > 0) return;
    if (n.pose === 'cheer') { n.pose = 'sit'; n.cd = rand(rnd, 5, 15); } else {
        n.pose = 'cheer'; n.cd = rand(rnd, 1.3, 2.3);
        if (rnd() < 0.6) trySay(st, n, pick(rnd, CHEERS), 1.8);
    }
}

function nextSpot(n, rnd) {
    const len = n.spots.length;
    if (len < 2) return;
    if (n.order === 'seq') n.si = (n.si + 1) % len;
    else if (n.order === 'ping') {
        if (n.si + n.dir >= len || n.si + n.dir < 0) n.dir = -n.dir;
        n.si += n.dir;
    } else if (len > 1) {
        let i = Math.min(len - 1, Math.floor(rnd() * len));
        if (i === n.si) i = (i + 1) % len;
        n.si = i;
    }
}

function stepPatrol(n, st, dt, rnd) {
    if (n.walking) {
        const sp = n.spots[n.si];
        const dx = sp.x - n.x, dy = sp.y - n.y, dist = Math.hypot(dx, dy), m = n.speed * dt;
        if (dist <= m + 0.01) {
            n.x = sp.x; n.y = sp.y;
            n.walking = false;
            n.pose = sp.pose || 'idle';
            n.wait = sp.w ? rand(rnd, sp.w[0], sp.w[1]) : 2;
            n.turnTo = sp.a == null ? n.angle : sp.a;
        } else {
            n.x += dx / dist * m; n.y += dy / dist * m;
            turnToward(n, Math.atan2(dy, dx), dt * 10);
            n.phase += m * 0.12;
            return;
        }
    }
    // står stilla: andas, jobbar och tittar gärna på spelaren
    if (n.pose === 'idle') n.phase += (Math.round(n.phase / PI) * PI - n.phase) * Math.min(1, dt * 5);
    else n.phase += dt * (n.pose === 'dance' ? 3.2 : 1.5);
    let want = n.turnTo;
    const f = st.focus;
    if (f && n.watch && n.pose !== 'walk') {
        const fx = f.x - n.x, fy = f.y - n.y;
        if (fx * fx + fy * fy < 140 * 140) want = Math.atan2(fy, fx);
    }
    turnToward(n, want, dt * 6);
    n.wait -= dt;
    if (n.wait > 0) return;
    // vidare till nästa punkt (hoppa över punkter man bara går förbi)
    for (let i = 0; i < n.spots.length; i++) {
        nextSpot(n, rnd);
        const sp = n.spots[n.si];
        if (Math.hypot(sp.x - n.x, sp.y - n.y) > 1) break;
    }
    n.walking = true;
    n.pose = 'walk';
}

// Beteenden som sköts här (inte av ett rums tema)
const OWN_BEH = new Set(['dancer', 'floor', 'seat', 'patrol']);

export function updateInterior(state, dt, rnd = Math.random) {
    if (!(dt > 0)) return;
    if (dt > 0.1) dt = 0.1;
    state.t += dt;
    const t = state.t, npcs = state.npcs, th = THEMES.get(state.def.theme);
    state.talking = 0;
    for (let i = 0; i < npcs.length; i++) if (npcs[i].say) state.talking++;
    let gone = false;
    for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        const own = !(th && th.step) || OWN_BEH.has(n.beh); // sköts av koden här, inte av temat
        if (n.brawl) {
            // Slagsmål (brawl.js) styr NPC:n — temat får bara städa undan köplats och stol
            if (!own) th.step(n, state, dt, rnd);
        } else if (n.leaving) {
            // Bråket är över: ut genom dörren och bort
            if (own || !th.step(n, state, dt, rnd)) gone = stepLeaving(n, state, dt) || gone;
        } else switch (n.beh) {
            case 'dancer': stepDancer(n, state.def.stage, dt); break;
            case 'floor': stepFloorDancer(n, dt, t); break;
            case 'seat': stepSeated(n, state, dt, t, rnd); break;
            case 'patrol': stepPatrol(n, state, dt, rnd); break;
            default: if (!(th && th.step && th.step(n, state, dt, rnd))) n.phase += dt;
        }
        if (n.say) {
            if ((n.say.life -= dt) <= 0) n.say = null;
        } else if (n.lines && !n.brawl && !n.leaving && (n.chatT -= dt) <= 0) {
            n.chatT = rand(rnd, 12, 30);
            trySay(state, n, pick(rnd, n.lines), 2.6);
        }
    }
    if (gone) for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].gone && npcs[i].leaving) npcs.splice(i, 1);
    if (th && th.update) th.update(state, dt, rnd);
}

// ── På väg ut (n.leaving) ──
// Avstånd i rutor till en målruta (BFS, 8 riktningar utan att skära hörn), cachat per rum. -1 = når inte dit.
const flowCache = new WeakMap();
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function roomFlow(def, gx, gy) {
    let m = flowCache.get(def);
    if (!m) { m = new Map(); flowCache.set(def, m); }
    const key = gy * def.w + gx;
    let d = m.get(key);
    if (d) return d;
    d = new Int16Array(def.w * def.h).fill(-1);
    if (!solidTile(def, gx, gy)) {
        const q = [gx, gy];
        d[key] = 0;
        for (let qi = 0; qi < q.length; qi += 2) {
            const x = q[qi], y = q[qi + 1], dist = d[y * def.w + x];
            for (const [ox, oy] of N8) {
                const nx = x + ox, ny = y + oy;
                if (solidTile(def, nx, ny) || d[ny * def.w + nx] >= 0) continue;
                if (ox && oy && (solidTile(def, x + ox, y) || solidTile(def, x, y + oy))) continue;
                d[ny * def.w + nx] = dist + 1;
                q.push(nx, ny);
            }
        }
    }
    if (m.size > 64) m.clear();
    m.set(key, d);
    return d;
}

// Nästa punkt (px) att gå mot för att ta sig från (x, y) till (gx, gy) runt möblerna
export function roomStep(def, x, y, gx, gy) {
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS), Gx = Math.floor(gx / TS), Gy = Math.floor(gy / TS);
    if ((tx === Gx && ty === Gy) || !(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(gx) && Number.isFinite(gy))) return { x: gx, y: gy };
    if (Gx < 0 || Gy < 0 || Gx >= def.w || Gy >= def.h) return { x: gx, y: gy };
    const d = roomFlow(def, Gx, Gy);
    const here = solidTile(def, tx, ty) ? -1 : d[ty * def.w + tx];
    let best = null, bd = here >= 0 ? here : Infinity;
    for (const [ox, oy] of N8) {
        const nx = tx + ox, ny = ty + oy;
        if (solidTile(def, nx, ny)) continue;
        if (ox && oy && here >= 0 && (solidTile(def, tx + ox, ty) || solidTile(def, tx, ty + oy))) continue;
        const nd = d[ny * def.w + nx];
        if (nd >= 0 && nd < bd) { bd = nd; best = { x: tc(nx), y: tc(ny) }; }
    }
    return best || { x: gx, y: gy };
}

// Går mot utgången och markeras n.gone när den är framme. true = försvann den här bildrutan.
function stepLeaving(n, state, dt) {
    const def = state.def, ex = def.exit || def.spawn;
    if (n.down > 0) return false;
    const to = roomStep(def, n.x, n.y, ex.x, ex.y);
    const dx = to.x - n.x, dy = to.y - n.y, dist = Math.hypot(dx, dy);
    const m = Math.min(dist, (state.panic > 0 ? 100 : 66) * dt);
    if (dist > 0.01) {
        n.x += dx / dist * m; n.y += dy / dist * m;
        turnToward(n, Math.atan2(dy, dx), dt * 10);
    }
    collideInterior(def, n, 7);
    n.pose = 'walk';
    n.phase += m * 0.12;
    if (Math.hypot(ex.x - n.x, ex.y - n.y) < 18) { n.gone = true; return true; }
    return false;
}

// ═══════════════════════════════════════════
//  RITNING
//  Det statiska lagret (golv, väggar, möbler, skyltar) ritas en
//  gång till en offscreen-canvas. Varje bildruta läggs sedan det
//  rörliga ovanpå: dansgolvets färger, lampor och folk.
// ═══════════════════════════════════════════

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const SIGN_FONT = 'Bungee, Impact, sans-serif';

function tileHash(x, y) {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex, a) { const c = hexRgb(hex); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
}
function disc(g, x, y, r, fill) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
function box(g, x, y, w, h, fill) { g.fillStyle = fill; g.fillRect(x, y, w, h); }
function softShadow(g, cx, cy, rx, ry, a = 0.28) {
    g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(cx + 2, cy + 3, rx, ry, 0, 0, TAU); g.fill();
}

// shadowBlur följer inte transformen, så den skalas med cachens upplösning
let paintScale = 1;

// Neonskylt: färgad text med sken och ljus kärna
function neonText(g, text, x, y, size, color, glow, font = SIGN_FONT) {
    g.save();
    g.font = `${size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = glow; g.shadowBlur = size * 0.8 * paintScale;
    g.lineWidth = Math.max(2, size * 0.16); g.strokeStyle = glow; g.globalAlpha = 0.5; g.strokeText(text, x, y);
    g.globalAlpha = 1; g.shadowBlur = size * 0.45 * paintScale; g.fillStyle = color; g.fillText(text, x, y);
    g.shadowBlur = 0; g.globalAlpha = 0.4; g.fillStyle = '#ffffff'; g.fillText(text, x, y);
    g.restore();
}
// Neonrör längs en linje
function neonLine(g, pts, color, width = 2.5) {
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = color; g.shadowBlur = 10 * paintScale;
    g.strokeStyle = rgba(color, 0.55); g.lineWidth = width + 2;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = color; g.lineWidth = width; g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = Math.max(0.8, width * 0.3); g.stroke();
    g.restore();
}

function zoneAt(def, tx, ty) {
    for (const z of def.zones) if (tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h) return z.kind;
    return null;
}
function eachTile(def, chars, fn) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        if (chars.indexOf(def.rows[ty][tx]) >= 0) fn(tx, ty);
    }
}

// Härledd data som bara behöver räknas ut en gång per rum
const derivedCache = new WeakMap();
function derived(def) {
    let d = derivedCache.get(def);
    if (d) return d;
    d = { dance: [], bulbs: [], poles: [], tables: [] };
    const isStage = (tx, ty) => { const c = chAt(def, tx, ty); return c === 'T' || c === 'P'; };
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const c = def.rows[ty][tx];
        if (c === 'd') d.dance.push(tx, ty);
        if (c === 'P') d.poles.push({ x: tc(tx), y: tc(ty) });
        if (c === 't') d.tables.push(tc(tx), tc(ty));
        if (c === 'T' || c === 'P') {
            // lampor längs scenkanten som vetter mot publiken
            if (!isStage(tx, ty + 1) && chAt(def, tx, ty + 1) !== '#') d.bulbs.push([tx * TS + 8, ty * TS + TS - 3], [tx * TS + 24, ty * TS + TS - 3]);
            if (!isStage(tx - 1, ty) && chAt(def, tx - 1, ty) !== '#') d.bulbs.push([tx * TS + 3, ty * TS + 8], [tx * TS + 3, ty * TS + 24]);
            if (!isStage(tx + 1, ty) && chAt(def, tx + 1, ty) !== '#') d.bulbs.push([tx * TS + TS - 3, ty * TS + 8], [tx * TS + TS - 3, ty * TS + 24]);
        }
    }
    derivedCache.set(def, d);
    return d;
}

// ── Cache av färdigmålade små bilder (sken, ljuskäglor) ──
const sprites = new Map();
function sprite(key, w, h, paint) {
    const have = sprites.get(key);
    if (have) return have;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return null;
    paint(g, w, h);
    sprites.set(key, cv);
    return cv;
}
function glowSprite(hex) {
    return sprite('glow' + hex, 96, 96, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, rgba(hex, 1)); gr.addColorStop(0.4, rgba(hex, 0.38)); gr.addColorStop(1, rgba(hex, 0));
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
}
function coneSprite(hex) {
    return sprite('cone' + hex, 64, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(hex, 0.75)); gr.addColorStop(1, rgba(hex, 0));
        g.fillStyle = gr;
        for (const k of [1, 0.78, 0.56]) {
            g.globalAlpha = k === 1 ? 0.35 : 0.4;
            g.beginPath(); g.moveTo(w / 2 - 2 * k, 0); g.lineTo(w / 2 + 2 * k, 0); g.lineTo(w / 2 + (w / 2) * k, h); g.lineTo(w / 2 - (w / 2) * k, h); g.closePath(); g.fill();
        }
    });
}

// ── Statiskt lager ──
let layers = new WeakMap();
let fontWatch = false;

function wantScale(ctx) {
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
    const s = m && m.a ? Math.hypot(m.a, m.b) : 2;
    return s <= 1.1 ? 1 : s <= 2.2 ? 2 : 3;
}

function staticLayer(ctx, def) {
    if (typeof document === 'undefined') return null;
    const want = wantScale(ctx);
    let L = layers.get(def);
    if (L && L.scale >= want) return L;
    const cv = document.createElement('canvas');
    cv.width = def.w * TS * want; cv.height = def.h * TS * want;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.scale(want, want);
    paintScale = want;
    try { paintStatic(g, def); } finally { paintScale = 1; }
    L = { cv, scale: want };
    layers.set(def, L);
    // skyltarna använder Bungee: måla om en gång när typsnittet har laddats
    if (!fontWatch && document.fonts && document.fonts.load) {
        fontWatch = true;
        try { document.fonts.load('16px Bungee').then(() => { layers = new WeakMap(); }).catch(() => {}); } catch { /* inget typsnitt, inget problem */ }
    }
    return L;
}

// Släng cachade lager (t.ex. om skärmen ändrat skala)
export function clearInteriorCache() { layers = new WeakMap(); }

function paintStatic(g, def) {
    const th = THEMES.get(def.theme);
    if (th) th.paint(g, def); else if (def.theme === 'club') paintClub(g, def); else paintGun(g, def);
}

// Mörk vägg med ljusare insida mot rummet
function wallPass(g, def, pal) {
    eachTile(def, '#', (tx, ty) => {
        const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
        const open = (dx, dy) => chAt(def, tx + dx, ty + dy) !== '#';
        box(g, x, y, TS, TS, pal.wall);
        // svag tegelstruktur
        g.fillStyle = 'rgba(255,255,255,0.035)';
        for (let r = 0; r < 4; r++) g.fillRect(x + ((r + (h & 1)) & 1) * 16, y + r * 8, 15, 7);
        if (open(0, 1)) { box(g, x, y + TS - 10, TS, 10, pal.face); box(g, x, y + TS - 10, TS, 1, pal.hi); box(g, x, y + TS - 2, TS, 2, pal.line); }
        if (open(0, -1)) { box(g, x, y, TS, 7, pal.face); box(g, x, y, TS, 2, pal.line); }
        if (open(1, 0)) { box(g, x + TS - 8, y, 8, TS, pal.face); box(g, x + TS - 8, y, 1, TS, pal.hi); box(g, x + TS - 2, y, 2, TS, pal.line); }
        if (open(-1, 0)) { box(g, x, y, 8, TS, pal.face); box(g, x, y, 2, TS, pal.line); }
    });
}

// Mjuk skugga på golvet längs väggarna
function aoPass(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        if (def.rows[ty][tx] === '#') continue;
        const x = tx * TS, y = ty * TS;
        const w = d => chAt(def, tx + d[0], ty + d[1]) === '#';
        const strips = [[3, 0.22], [7, 0.12], [12, 0.06]];
        for (const [sz, a] of strips) {
            g.fillStyle = `rgba(0,0,0,${a})`;
            if (w([0, -1])) g.fillRect(x, y, TS, sz);
            if (w([0, 1])) g.fillRect(x, y + TS - sz, TS, sz);
            if (w([-1, 0])) g.fillRect(x, y, sz, TS);
            if (w([1, 0])) g.fillRect(x + TS - sz, y, sz, TS);
        }
    }
}

// Upphöjd kloss (disk, bord, skrivbord) med sammanhängande ovansida
function slabGroup(g, def, chars, o) {
    const same = (tx, ty) => chars.indexOf(chAt(def, tx, ty)) >= 0;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath();
    eachTile(def, chars, (tx, ty) => g.rect(tx * TS + 2, ty * TS + 4, TS, TS));
    g.fill();
    const ins = o.ins === undefined ? 3 : o.ins;
    eachTile(def, chars, (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        const n = same(tx, ty - 1), s = same(tx, ty + 1), w = same(tx - 1, ty), e = same(tx + 1, ty);
        box(g, x, y, TS, TS, o.side);
        const l = w ? 0 : ins, r = e ? 0 : ins, t = n ? 0 : ins, b = s ? 0 : ins;
        box(g, x + l, y + t, TS - l - r, TS - t - b, o.top);
        if (!n) box(g, x + l, y + t, TS - l - r, 1.5, o.hi);
        g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1; g.beginPath();
        if (!n) { g.moveTo(x, y + 0.5); g.lineTo(x + TS, y + 0.5); }
        if (!s) { g.moveTo(x, y + TS - 0.5); g.lineTo(x + TS, y + TS - 0.5); }
        if (!w) { g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + TS); }
        if (!e) { g.moveTo(x + TS - 0.5, y); g.lineTo(x + TS - 0.5, y + TS); }
        g.stroke();
    });
}

// Långa brädor (96 px) med slumpad förskjutning per rad
function plankFloor(g, tx, ty, cols) {
    const x = tx * TS, y = ty * TS;
    for (let i = 0; i < 4; i++) {
        const gy = ty * 4 + i, off = tileHash(gy, 7) % 96;
        const j = (96 - (x + off) % 96) % 96, p0 = Math.floor((x + off) / 96), yy = y + i * 8;
        if (j === 0 || j >= TS) {
            g.fillStyle = cols[tileHash(gy, p0) & 3]; g.fillRect(x, yy, TS, 8);
            if (j === 0) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, yy, 1, 7); }
        } else {
            g.fillStyle = cols[tileHash(gy, p0) & 3]; g.fillRect(x, yy, j, 8);
            g.fillStyle = cols[tileHash(gy, p0 + 1) & 3]; g.fillRect(x + j, yy, TS - j, 8);
            g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + j, yy, 1, 7);
        }
        g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(x, yy + 7, TS, 1);
    }
}

function carpetTile(g, x, y, base, orn) {
    box(g, x, y, TS, TS, base);
    g.strokeStyle = orn; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 16, y + 6); g.lineTo(x + 26, y + 16); g.lineTo(x + 16, y + 26); g.lineTo(x + 6, y + 16); g.closePath(); g.stroke();
    box(g, x + 15, y + 15, 2, 2, orn);
    box(g, x, y, 2, 2, orn); box(g, x + TS - 2, y, 2, 2, orn); box(g, x, y + TS - 2, 2, 2, orn); box(g, x + TS - 2, y + TS - 2, 2, 2, orn);
}

// ═══════════════════════════════════════════
//  CLUB DIAMANT — statiskt lager
// ═══════════════════════════════════════════

const CLUB_WALL = { wall: '#1a1325', face: '#33264a', hi: '#4d3b6e', line: '#0b0710' };
const WOOD_CLUB = ['#46384f', '#43354c', '#483a52', '#41334a'];

function clubFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty);
    if (ch === 'd') {
        const a = (tx + ty) & 1;
        box(g, x, y, TS, TS, a ? '#45366a' : '#392c5a');
        g.beginPath(); g.moveTo(x + 16, y + 4); g.lineTo(x + 28, y + 16); g.lineTo(x + 16, y + 28); g.lineTo(x + 4, y + 16); g.closePath();
        g.fillStyle = a ? 'rgba(255,120,220,0.1)' : 'rgba(80,220,255,0.1)'; g.fill();
        g.strokeStyle = a ? 'rgba(255,130,225,0.42)' : 'rgba(90,225,255,0.42)'; g.lineWidth = 1.4; g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    if (ch === 'T' || ch === 'P') {
        for (let i = 0; i < 4; i++) box(g, x, y + i * 8, TS, 8, i & 1 ? '#231a30' : '#2a1f39');
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x, y, TS, 1);
        g.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8 + 7, TS, 1);
        return;
    }
    if (zone === 'vip') return carpetTile(g, x, y, '#6c2149', 'rgba(255,205,120,0.22)');
    if (zone === 'office') {
        box(g, x, y, TS, TS, '#3a4056');
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TS, 1);
        g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 4; i++) g.fillRect(x + i * 8, y, 1, TS);
        return;
    }
    if (zone === 'dj') {
        box(g, x, y, TS, TS, '#2b2e44');
        g.strokeStyle = 'rgba(160,180,255,0.14)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x + 6, y + 10); g.lineTo(x + 14, y + 6); g.moveTo(x + 22, y + 26); g.lineTo(x + 30, y + 22); g.stroke();
        g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    if (zone === 'service') {
        box(g, x, y, TS, TS, '#2f2b2e');
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 4 + i * 8, y + 4 + j * 8, 3, 3);
        return;
    }
    if (ch === 'c') {
        // röd löpare från ingången
        box(g, x, y, TS, TS, '#8c1c3c');
        g.fillStyle = 'rgba(255,215,130,0.28)'; g.fillRect(x + 14, y + 12, 4, 8); g.fillRect(x + 12, y + 14, 8, 4);
        g.fillStyle = '#d4a72c';
        if (chAt(def, tx - 1, ty) !== 'c') g.fillRect(x, y, 3, TS);
        if (chAt(def, tx + 1, ty) !== 'c') g.fillRect(x + TS - 3, y, 3, TS);
        return;
    }
    if (ch === 'e') {
        box(g, x, y, TS, TS, '#1a1018');
        return;
    }
    plankFloor(g, tx, ty, WOOD_CLUB);
    if (ch === '+') { box(g, x, y, TS, TS, '#33261f'); box(g, x + 12, y, 8, TS, '#8a6a3b'); box(g, x + 12, y, 8, 2, '#c9a24f'); }
}

function paintClub(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') clubFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, CLUB_WALL);
    aoPass(g, def);
    clubStage(g, def);
    clubBar(g, def);
    clubDj(g, def);
    clubSeating(g, def);
    clubVip(g, def);
    clubOffice(g, def);
    clubPlants(g, def);
    clubEntrance(g, def);
    clubSigns(g, def);
}

function clubStage(g, def) {
    const isStage = (tx, ty) => { const c = chAt(def, tx, ty); return c === 'T' || c === 'P'; };
    // scenkant: skuggad sida + guldlist
    eachTile(def, 'TP', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        const edges = [[0, 1], [-1, 0], [1, 0]];
        for (const [dx, dy] of edges) {
            if (isStage(tx + dx, ty + dy) || chAt(def, tx + dx, ty + dy) === '#') continue;
            if (dy === 1) { box(g, x, y + TS, TS, 5, 'rgba(0,0,0,0.5)'); box(g, x, y + TS - 4, TS, 4, '#d4a72c'); box(g, x, y + TS - 4, TS, 1.2, '#f7da7a'); }
            if (dx === -1) { box(g, x - 5, y, 5, TS, 'rgba(0,0,0,0.5)'); box(g, x, y, 4, TS, '#d4a72c'); box(g, x, y, 1.2, TS, '#f7da7a'); }
            if (dx === 1) { box(g, x + TS, y, 5, TS, 'rgba(0,0,0,0.5)'); box(g, x + TS - 4, y, 4, TS, '#d4a72c'); box(g, x + TS - 1.2, y, 1.2, TS, '#f7da7a'); }
        }
    });
    // lamphållare i guldlisten
    for (const b of derived(def).bulbs) disc(g, b[0], b[1], 2.1, '#5a4310');
    // sammetsridå längst bak på scenen
    const st = def.stage;
    for (let i = 0; i < (st.x1 - st.x0) / 8; i++) {
        box(g, st.x0 + i * 8, st.y0, 8, 11, i & 1 ? '#7a1233' : '#5a0d27');
        box(g, st.x0 + i * 8 + 5, st.y0, 1.5, 11, 'rgba(255,255,255,0.1)');
    }
    box(g, st.x0, st.y0 + 10, st.x1 - st.x0, 2, '#d4a72c');
    // scenstolpar: fot och blank stång
    for (const p of derived(def).poles) {
        softShadow(g, p.x, p.y, 10, 10, 0.4);
        disc(g, p.x, p.y, 9, '#120c1b');
        g.strokeStyle = '#d4a72c'; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, 9, 0, TAU); g.stroke();
        disc(g, p.x, p.y, 4.4, '#9aa3b2');
    }
}

function clubBar(g, def) {
    // flaskhylla längs väggen bakom baren
    const y0 = 5 * TS, hh = 11 * TS;
    box(g, 0, y0, TS, hh, '#24140c');
    box(g, 2, y0 + 3, 10, hh - 6, '#33414f');
    g.fillStyle = 'rgba(255,255,255,0.10)';
    for (let yy = y0 + 4; yy < y0 + hh - 8; yy += 38) { g.beginPath(); g.moveTo(3, yy + 18); g.lineTo(11, yy); g.lineTo(11, yy + 8); g.lineTo(3, yy + 26); g.fill(); }
    box(g, 13, y0, 19, hh, '#4a2c1a'); box(g, 13, y0, 1.5, hh, '#6b4329');
    const BOTTLES = ['#d97706', '#16a34a', '#cbd5e1', '#dc2626', '#3b82f6', '#ec4899', '#a3e635'];
    for (let yy = y0 + 8, i = 0; yy < y0 + hh - 4; yy += 11, i++) {
        for (const cx of [20, 27]) {
            const col = BOTTLES[(tileHash(i, cx) >> 3) % BOTTLES.length];
            softShadow(g, cx, yy, 3.6, 3.6, 0.3);
            disc(g, cx, yy, 3.5, col);
            disc(g, cx - 1, yy - 1, 1.1, 'rgba(255,255,255,0.65)');
        }
    }
    // disken
    slabGroup(g, def, 'B', { side: '#2a170d', top: '#5e3822', hi: 'rgba(255,225,180,0.3)' });
    // glas och flaskor på disken
    eachTile(def, 'B', (tx, ty) => {
        const h = tileHash(tx, ty), x = tx * TS, y = ty * TS;
        for (let i = 0; i < 2; i++) {
            const gx = x + 8 + ((h >> (i * 5)) & 15), gy = y + 8 + ((h >> (i * 5 + 3)) & 15);
            if (tx === 3 && ((h >> i) & 1)) continue;
            const col = DRINKS[(h >> (i + 2)) % DRINKS.length];
            disc(g, gx, gy, 3, 'rgba(255,255,255,0.78)'); disc(g, gx, gy, 1.9, col);
        }
    });
    // diskho och kylskåp bakom disken
    box(g, 36, 6 * TS + 4, 56, 22, '#9aa3b2'); box(g, 38, 6 * TS + 6, 23, 18, '#5b6573'); box(g, 65, 6 * TS + 6, 23, 18, '#5b6573');
    box(g, 60, 6 * TS + 3, 6, 4, '#d4d8de'); disc(g, 63, 6 * TS + 4, 1.6, '#4b5563');
    box(g, 36, 13 * TS + 6, 56, 52, '#2c3340'); box(g, 38, 13 * TS + 8, 52, 48, '#8fb8d8');
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(40, 13 * TS + 56); g.lineTo(54, 13 * TS + 8); g.lineTo(62, 13 * TS + 8); g.lineTo(48, 13 * TS + 56); g.fill();
    for (let i = 0; i < 5; i++) { box(g, 41 + i * 9.5, 13 * TS + 14, 6, 14, ['#16a34a', '#dc2626', '#d97706', '#cbd5e1', '#3b82f6'][i]); box(g, 41 + i * 9.5, 13 * TS + 34, 6, 14, ['#ec4899', '#a3e635', '#cbd5e1', '#d97706', '#dc2626'][i]); }
    box(g, 38, 13 * TS + 30, 52, 2, '#2c3340');
    // kassa i övre hörnet
    box(g, 38, 168, 20, 16, '#1f2937'); box(g, 40, 170, 16, 7, '#7dd3fc'); box(g, 40, 170, 16, 2, 'rgba(255,255,255,0.4)');
    // neon under disklisten mot gästerna
    neonLine(g, [[4 * TS - 2, 6 * TS + 6], [4 * TS - 2, 15 * TS - 6]], '#22e5ff', 2.2);
    // barstolar
    eachTile(def, 'o', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 11, 11, 0.35);
        disc(g, cx, cy, 11, '#9aa3b2'); disc(g, cx, cy, 9.4, '#c21d6b'); disc(g, cx - 3, cy - 3, 3.2, 'rgba(255,255,255,0.28)');
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.stroke();
    });
}

function clubDj(g, def) {
    slabGroup(g, def, 'D', { side: '#0f0c16', top: '#272238', hi: 'rgba(160,140,255,0.3)', ins: 2 });
    // högtalare: svart låda med baskon och diskant
    eachTile(def, 'k', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        box(g, x, y, TS, TS, '#08070c'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#17151f');
        disc(g, x + 16, y + 19, 9.5, '#07060a'); disc(g, x + 16, y + 19, 7.5, '#2a2833'); disc(g, x + 16, y + 19, 3.2, '#0c0b10');
        disc(g, x + 16, y + 7, 2.6, '#2a2833');
        g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 1; g.beginPath(); g.arc(x + 16, y + 19, 9.5, 0, TAU); g.stroke();
    });
    // utrustning på DJ-bordet (bordet täcker x 32..256, y 96..128)
    for (const px of [100, 188]) {
        disc(g, px, 112, 12, '#06050a'); disc(g, px, 112, 10.5, '#1a1822');
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.8;
        for (const r of [4, 6, 8, 10]) { g.beginPath(); g.arc(px, 112, r, 0, TAU); g.stroke(); }
        disc(g, px, 112, 3, px < 144 ? '#ff4fd8' : '#22e5ff');
    }
    box(g, 130, 102, 28, 20, '#0b0a10'); box(g, 131, 103, 26, 18, '#1d1a28');
    for (let i = 0; i < 3; i++) disc(g, 135 + i * 8, 108, 1.8, ['#ff4fd8', '#ffd23f', '#22e5ff'][i]);
    box(g, 222, 101, 22, 16, '#0c0c12'); box(g, 224, 103, 18, 12, '#60a5fa'); box(g, 224, 103, 18, 3, 'rgba(255,255,255,0.35)');
    neonLine(g, [[34, 4 * TS - 2], [8 * TS - 2, 4 * TS - 2]], '#a855f7', 2);
}

function clubSeating(g, def) {
    // stolar
    eachTile(def, 'h', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        const tableR = chAt(def, tx + 1, ty) === 't';
        softShadow(g, x + 16, y + 16, 12, 12, 0.3);
        box(g, x + 5, y + 6, 22, 20, '#6e1d46');
        box(g, x + 7, y + 8, 18, 16, '#8f2a5f');
        box(g, tableR ? x + 3 : x + 23, y + 6, 6, 20, '#4a1030');
        box(g, tableR ? x + 3 : x + 23, y + 6, 6, 2, 'rgba(255,255,255,0.18)');
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 5.5, y + 6.5, 21, 19);
    });
    // runda bord med ljus och drinkar
    eachTile(def, 't', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty), h = tileHash(tx, ty);
        softShadow(g, cx, cy, 14, 14, 0.35);
        disc(g, cx, cy, 14, '#2f1d12'); disc(g, cx, cy, 12.6, '#7a5232');
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
        for (const r of [4, 8]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
        g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(cx, cy, 12.6, PI * 1.1, PI * 1.6); g.lineTo(cx, cy); g.fill();
        disc(g, cx, cy, 3.6, '#fde68a'); disc(g, cx, cy, 2, '#fff7d6');
        for (let i = 0; i < 2; i++) {
            const a = (h >> (i * 4)) % 6 + i * PI;
            const gx = cx + Math.cos(a) * 8, gy = cy + Math.sin(a) * 8;
            disc(g, gx, gy, 2.8, 'rgba(255,255,255,0.8)'); disc(g, gx, gy, 1.8, DRINKS[(h >> (i + 5)) % DRINKS.length]);
        }
    });
}

function sofaTile(g, def, tx, ty, pal) {
    const x = tx * TS, y = ty * TS;
    const wl = chAt(def, tx - 1, ty) === '#', wr = chAt(def, tx + 1, ty) === '#', wt = chAt(def, tx, ty - 1) === '#', wb = chAt(def, tx, ty + 1) === '#';
    softShadow(g, x + 16, y + 16, 15, 15, 0.3);
    box(g, x, y, TS, TS, pal.base);
    const l = wl ? 9 : 2, r = wr ? 9 : 2, t = wt ? 9 : 2, b = wb ? 9 : 2;
    g.fillStyle = pal.seat; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.13)'; rr(g, x + l + 2, y + t + 2, TS - l - r - 4, 5, 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.stroke();
    g.fillStyle = pal.back;
    if (wt) g.fillRect(x, y, TS, 9); if (wb) g.fillRect(x, y + TS - 9, TS, 9);
    if (wl) g.fillRect(x, y, 9, TS); if (wr) g.fillRect(x + TS - 9, y, 9, TS);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    if (wt) g.fillRect(x, y, TS, 1.5); if (wr) g.fillRect(x + TS - 1.5, y, 1.5, TS);
}

function clubVip(g, def) {
    // repstolpar: rep först, sedan stolparna
    const rope = (x1, y1, x2, y2) => {
        g.lineCap = 'round';
        g.strokeStyle = '#3b0a14'; g.lineWidth = 5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = '#c81e3a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1 - 0.8); g.lineTo(x2, y2 - 0.8); g.stroke();
        g.lineCap = 'butt';
    };
    eachTile(def, 'W', (tx, ty) => {
        if (chAt(def, tx + 1, ty) === 'W') rope(tc(tx), tc(ty), tc(tx + 1), tc(ty));
        if (chAt(def, tx, ty + 1) === 'W') rope(tc(tx), tc(ty), tc(tx), tc(ty + 1));
    });
    eachTile(def, 'W', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 7, 7, 0.4);
        disc(g, cx, cy, 6.5, '#3a2c0c'); disc(g, cx, cy, 5.2, '#d4a72c'); disc(g, cx, cy, 2.6, '#f7da7a');
    });
    // soffbord med champagne
    slabGroup(g, def, 'V', { side: '#c9a227', top: '#141a26', hi: 'rgba(255,255,255,0.25)', ins: 2 });
    for (const [bx, by] of [[26, 4], [26, 8]]) {
        const cx = bx * TS, cy = by * TS + 16;
        disc(g, cx, cy, 8, '#cbd5e1'); disc(g, cx, cy, 6.4, '#8b97a8'); disc(g, cx, cy, 2.4, '#16a34a');
        disc(g, cx - 18, cy - 4, 2.8, 'rgba(255,255,255,0.8)'); disc(g, cx - 18, cy - 4, 1.8, '#fde68a');
        disc(g, cx + 19, cy + 4, 2.8, 'rgba(255,255,255,0.8)'); disc(g, cx + 19, cy + 4, 1.8, '#fde68a');
    }
    // soffor (VIP och kontor)
    eachTile(def, 'S', (tx, ty) => {
        const z = zoneAt(def, tx, ty);
        sofaTile(g, def, tx, ty, z === 'office' ? { base: '#2b3345', seat: '#58647e', back: '#3b4660' } : { base: '#4a0f2e', seat: '#a02a66', back: '#6b1744' });
    });
    // guldrutan "VIP" på mattan vid ingången till loungen
    g.save();
    g.translate(23.5 * TS, 6.5 * TS); g.rotate(-PI / 2);
    g.font = `15px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(247,218,122,0.5)'; g.fillText('VIP', 0, 0);
    g.restore();
}

function clubOffice(g, def) {
    slabGroup(g, def, 'm', { side: '#3a2414', top: '#7a5232', hi: 'rgba(255,230,190,0.3)' });
    // på skrivbordet (x 25..27, y 18)
    box(g, 25 * TS + 6, 18 * TS + 6, 24, 17, '#111827'); box(g, 25 * TS + 8, 18 * TS + 8, 20, 11, '#60a5fa'); box(g, 25 * TS + 8, 18 * TS + 8, 20, 3, 'rgba(255,255,255,0.35)');
    for (let i = 0; i < 3; i++) { box(g, 27 * TS - 4 + i, 18 * TS + 8 - i, 14, 7, '#2f7d3a'); box(g, 27 * TS - 4 + i, 18 * TS + 8 - i, 14, 1.5, '#4ade80'); }
    disc(g, 26 * TS + 14, 18 * TS + 22, 4, '#facc15'); disc(g, 26 * TS + 14, 18 * TS + 22, 2.4, '#fff7ae');
    // kassaskåp
    eachTile(def, 'f', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#323740'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#7b8494'); box(g, x + 2, y + 2, TS - 4, 2, 'rgba(255,255,255,0.3)');
        disc(g, x + 16, y + 17, 7, '#4b5361'); disc(g, x + 16, y + 17, 5, '#aab2bf'); box(g, x + 15, y + 11, 2, 6, '#1f2937');
        box(g, x + 4, y + 8, 3, 8, '#323740');
    });
}

function plantAt(g, cx, cy, seed) {
    softShadow(g, cx, cy, 13, 11, 0.3);
    for (let i = 0; i < 9; i++) {
        g.save(); g.translate(cx, cy); g.rotate(i / 9 * TAU + seed);
        g.fillStyle = i & 1 ? '#2b7a31' : '#3f9a41';
        g.beginPath(); g.ellipse(8, 0, 9, 3.6, 0, 0, TAU); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(2, -0.5, 12, 1);
        g.restore();
    }
    disc(g, cx, cy, 4, '#6b4423');
}
function clubPlants(g, def) { eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7)); }

function clubEntrance(g, def) {
    // mattan rullar ut genom dörren till den nattblå gatan, dörrbladen står öppna mot väggen
    const x = 14 * TS, y = 21 * TS, w = 2 * TS;
    box(g, x, y, w, TS, '#0d0911');
    box(g, x, y + 20, w, 12, '#1b2747'); box(g, x, y + 28, w, 4, '#2d4474');
    box(g, x, y, w, 20, '#8c1c3c');
    box(g, x, y, 3, 20, '#d4a72c'); box(g, x + w - 3, y, 3, 20, '#d4a72c');
    g.fillStyle = 'rgba(255,215,130,0.28)';
    for (const px of [x + 12, x + 44]) { g.fillRect(px + 2, y + 6, 4, 8); g.fillRect(px, y + 8, 8, 4); }
    box(g, x, y + 19, w, 2, '#d4a72c');
    box(g, x - 3, y + 1, 5, 19, '#4b2a1a'); box(g, x + w - 2, y + 1, 5, 19, '#4b2a1a');
    box(g, x - 3, y + 1, 5, 2, '#6b3d24'); box(g, x + w - 2, y + 1, 5, 2, '#6b3d24');
    for (const px of [x - 4, x + w + 4]) { disc(g, px, y + 3, 3.4, '#d4a72c'); disc(g, px, y + 3, 1.6, '#f7da7a'); }
}

function clubSigns(g, def) {
    // neonrör längs väggarna
    neonLine(g, [[38, 27], [8 * TS - 6, 27]], '#a855f7', 2.4);
    neonLine(g, [[22 * TS + 8, 27], [29 * TS - 6, 27]], '#22e5ff', 2.4);
    neonLine(g, [[3 * TS - 6, 21 * TS + 6], [13 * TS - 4, 21 * TS + 6]], '#ff4fd8', 2.4);
    neonLine(g, [[17 * TS + 4, 21 * TS + 6], [28 * TS, 21 * TS + 6]], '#ff4fd8', 2.4);
    neonLine(g, [[29 * TS + 3, 3 * TS], [29 * TS + 3, 11 * TS]], '#ffd23f', 2.2);
    // skyltplattor
    for (const s of CLUB_SIGNS) {
        g.fillStyle = 'rgba(8,4,14,0.85)'; rr(g, s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, 5); g.fill();
        g.strokeStyle = rgba(s.glow, 0.8); g.lineWidth = 1.2; rr(g, s.x - s.w / 2 + 1, s.y - s.h / 2 + 1, s.w - 2, s.h - 2, 4); g.stroke();
        if (s.rot) {
            g.save(); g.translate(s.x, s.y); g.rotate(s.rot);
            neonText(g, s.text, 0, 1, s.size, s.color, s.glow);
            g.restore();
        } else neonText(g, s.text, s.x, s.y + 1, s.size, s.color, s.glow);
    }
    // diamantlogga på vardera sidan om skylten
    g.font = `18px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('💎', 356, 17); g.fillText('💎', 604, 17);
    // utgångsskylt vid dörren
    box(g, 16 * TS + 6, 21 * TS + 8, 42, 12, '#052e16'); box(g, 16 * TS + 6, 21 * TS + 8, 42, 12, 'rgba(34,197,94,0.25)');
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#4ade80'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTGÅNG', 16 * TS + 27, 21 * TS + 14.5);
    // kontorsskylt vid kontorsdörren
    g.save(); g.translate(22 * TS + 16, 15.5 * TS + 4); g.rotate(-PI / 2);
    box(g, -22, -6, 44, 12, '#8a6a3b'); box(g, -21, -5, 42, 10, '#d4a72c');
    g.font = `8px ${SIGN_FONT}`; g.fillStyle = '#3a2410'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KONTOR', 0, 0.5);
    g.restore();
}

// Skyltarna (den första flimrar till i dynClub)
const CLUB_SIGNS = [
    { text: 'CLUB DIAMANT', x: 480, y: 17, w: 186, h: 24, size: 17, color: '#ff8de8', glow: '#ff2bd6' },
    { text: 'DJ', x: 144, y: 14, w: 40, h: 18, size: 12, color: '#c4a1ff', glow: '#8b5cf6' },
    { text: 'BAR', x: 16, y: 13 * TS, w: 24, h: 40, size: 13, color: '#8cf3ff', glow: '#22e5ff', rot: -PI / 2 },
    { text: 'VIP', x: 29 * TS + 16, y: 7 * TS, w: 24, h: 44, size: 13, color: '#ffe38a', glow: '#ffb300', rot: PI / 2 }
];

// ═══════════════════════════════════════════
//  PANG-PELLES VAPEN — statiskt lager
// ═══════════════════════════════════════════

const GUN_WALL = { wall: '#232826', face: '#38403c', hi: '#4f5a55', line: '#0d100f' };

function gunFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty), zone = zoneAt(def, tx, ty);
    if (ch === 'e') {
        // stålgolv i dörröppningen: räfflad plåt
        box(g, x, y, TS, TS, '#6c727c');
        g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const px = x + 4 + i * 8, py = y + 4 + j * 8; g.beginPath(); if ((i + j) & 1) { g.moveTo(px - 2, py - 2); g.lineTo(px + 2, py + 2); } else { g.moveTo(px + 2, py - 2); g.lineTo(px - 2, py + 2); } g.stroke(); }
        return;
    }
    if (zone === 'staff' || ty <= 4) {
        box(g, x, y, TS, TS, '#3f4146');
        g.fillStyle = 'rgba(255,255,255,0.045)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 3 + i * 8, y + 3 + j * 8, 4, 4);
        return;
    }
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#555a62' : '#51565e');
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 3; i++) { const r = tileHash(h, i); g.fillRect(x + (r % 26) + 2, y + ((r >> 8) % 26) + 2, 2 + (r >> 20) % 3, 2); }
}

function gunPistol(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = col; g.strokeStyle = col;
    g.fillRect(0, 0, 18, 4.2); g.fillRect(1, 4.2, 12, 2.2); g.fillRect(17.4, 0.9, 2.2, 1.6);
    g.beginPath(); g.moveTo(2.5, 6.4); g.lineTo(8, 6.4); g.lineTo(7, 13); g.lineTo(2, 13); g.closePath(); g.fill();
    g.lineWidth = 1.1; g.beginPath(); g.arc(10.2, 7, 2.3, 0.2, PI + 0.4); g.stroke();
    g.restore();
}
function gunRifle(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = col;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(20, 4); g.lineTo(20, 9); g.lineTo(6, 11); g.lineTo(0, 9); g.closePath(); g.fill();
    g.fillRect(20, 3, 26, 6); g.fillRect(24, 1, 14, 2);
    g.beginPath(); g.moveTo(30, 9); g.lineTo(36, 9); g.lineTo(38, 17); g.lineTo(32, 17); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(22, 9); g.lineTo(27, 9); g.lineTo(25, 15); g.lineTo(21, 15); g.closePath(); g.fill();
    g.fillRect(46, 3.4, 22, 5); g.fillRect(68, 5, 22, 2); g.fillRect(88, 3.6, 3, 5);
    g.restore();
}
function gunShotgun(g, x, y, s, col) {
    g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = col;
    g.beginPath(); g.moveTo(0, 3); g.lineTo(22, 5); g.lineTo(22, 10); g.lineTo(4, 13); g.lineTo(0, 10); g.closePath(); g.fill();
    g.fillRect(22, 4, 14, 6); g.fillRect(36, 4.4, 56, 2.6); g.fillRect(36, 8, 50, 2.2);
    rr(g, 52, 7.4, 18, 4.6, 2); g.fill();
    g.fillRect(90, 3.6, 2, 3.6);
    g.beginPath(); g.moveTo(24, 10); g.lineTo(28, 10); g.lineTo(26, 15); g.lineTo(23, 15); g.closePath(); g.fill();
    g.restore();
}
function ammoBox(g, x, y, w, h, col) {
    box(g, x, y, w, h, col); box(g, x, y, w, 2, 'rgba(255,255,255,0.28)'); box(g, x + 1.5, y + h * 0.5, w - 3, h * 0.28, 'rgba(255,255,255,0.8)');
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.strokeRect(x + 0.4, y + 0.4, w - 0.8, h - 0.8);
}
function glassCase(g, x, y, w, h) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 4, w, h);
    box(g, x, y, w, h, '#22272b'); box(g, x + 3, y + 3, w - 6, h - 6, '#5e1616');
    for (let i = 0; i < Math.floor((w - 8) / 22); i++) gunPistol(g, x + 7 + i * 22, y + 9, 0.85, '#d3d8de');
    box(g, x + 3, y + 3, w - 6, h - 6, 'rgba(160,215,240,0.2)');
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(x + 8, y + h - 3); g.lineTo(x + 20, y + 3); g.lineTo(x + 28, y + 3); g.lineTo(x + 16, y + h - 3); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1; g.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
}

function gunRackWall(g) {
    const x0 = TS, y0 = TS, w = 14 * TS, h = 2 * TS;
    box(g, x0, y0, w, h, '#4d5650');
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let yy = y0 + 4; yy < y0 + h; yy += 8) for (let xx = x0 + 4; xx < x0 + w; xx += 8) g.fillRect(xx, yy, 1.6, 1.6);
    box(g, x0, y0, w, 3, '#2a302d'); box(g, x0, y0 + h - 3, w, 3, '#2a302d');
    const ink = '#101314', edge = 'rgba(255,255,255,0.22)';
    const sil = (fn, x, y, s) => { fn(g, x - 0.7, y - 0.7, s, edge); fn(g, x, y, s, ink); };
    for (let i = 0; i < 3; i++) sil(gunRifle, x0 + 8, y0 + 7 + i * 19, 1.1);
    for (let i = 0; i < 3; i++) sil(gunShotgun, x0 + 120, y0 + 8 + i * 19, 1.05);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        const px = x0 + 236 + c * 34, py = y0 + 9 + r * 18;
        disc(g, px + 8, py - 3, 1.5, '#a8b0aa');
        sil(gunPistol, px, py, 1.05);
        box(g, px + 12, py + 9, 7, 5, '#f4f4f4'); box(g, px + 13, py + 10, 2, 3, '#dc2626');
    }
    const cols = ['#556b2f', '#b91c1c', '#d4a017', '#2563eb', '#4b5d3a', '#9a3412'];
    for (let r = 0; r < 3; r++) {
        const sy = y0 + 22 + r * 19;
        for (let i = 0; i < 7; i++) ammoBox(g, x0 + 350 + i * 14, sy - 11, 12.5, 10.5, cols[(i + r * 2) % cols.length]);
        box(g, x0 + 346, sy, 100, 3, '#262b28');
    }
    // stolpar mellan sektionerna
    for (const px of [112, 224, 336]) { box(g, x0 + px - 1, y0, 3, h, '#2a302d'); box(g, x0 + px - 1, y0, 1, h, 'rgba(255,255,255,0.12)'); }
}

function gunCounter(g, def) {
    slabGroup(g, def, 'C', { side: '#22272b', top: '#7b5737', hi: 'rgba(255,230,190,0.3)' });
    // glasmontrar: disken (rad 5) och två fristående (rad 8)
    eachTile(def, 'G', (tx, ty) => {
        if (chAt(def, tx - 1, ty) === 'G') return;
        let len = 1; while (chAt(def, tx + len, ty) === 'G') len++;
        glassCase(g, tx * TS, ty * TS, len * TS, TS);
    });
    // kassaapparat och klocka på disken
    box(g, 11 * TS + 4, 5 * TS + 7, 20, 16, '#1f2937'); box(g, 11 * TS + 6, 5 * TS + 9, 16, 6, '#86efac'); box(g, 11 * TS + 6, 5 * TS + 9, 16, 2, 'rgba(255,255,255,0.4)');
    disc(g, 13 * TS + 16, 5 * TS + 16, 5, '#d4a72c'); disc(g, 13 * TS + 16, 5 * TS + 16, 2.2, '#f7da7a');
    // gul-svart varningsrand framför disken
    g.save(); g.beginPath(); g.rect(TS, 6 * TS, 14 * TS, 5); g.clip();
    box(g, TS, 6 * TS, 14 * TS, 5, '#17181a');
    g.fillStyle = '#e8b923';
    for (let x = TS - 6; x < 15 * TS; x += 14) { g.beginPath(); g.moveTo(x, 6 * TS); g.lineTo(x + 7, 6 * TS); g.lineTo(x + 2, 6 * TS + 5); g.lineTo(x - 5, 6 * TS + 5); g.closePath(); g.fill(); }
    g.restore();
}

function gunFloorItems(g, def) {
    // svart gummimatta innanför dörren
    box(g, 7 * TS + 3, 10 * TS + 6, 2 * TS - 6, 20, '#25272a');
    g.fillStyle = 'rgba(255,255,255,0.07)'; for (let i = 0; i < 6; i++) g.fillRect(7 * TS + 5, 10 * TS + 9 + i * 3, 2 * TS - 10, 1);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(7 * TS + 3.5, 10 * TS + 6.5, 2 * TS - 7, 19);
    // ammohyllor längs sidorna
    eachTile(def, 'A', (tx, ty) => {
        const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 3, TS, TS);
        box(g, x, y, TS, TS, '#2a302d'); box(g, x + 1, y + 1, TS - 2, TS - 2, '#3e4642');
        const cols = ['#556b2f', '#b91c1c', '#d4a017', '#2563eb', '#4b5d3a', '#9a3412'];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) ammoBox(g, x + 3 + i * 14, y + 3 + j * 14, 12, 11, cols[(h >> (i * 2 + j)) % cols.length]);
    });
    // träbackar i hörnen
    eachTile(def, 'Q', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 4, TS - 2, TS - 2);
        box(g, x + 1, y + 1, TS - 2, TS - 2, '#8a6a3b');
        g.fillStyle = 'rgba(0,0,0,0.3)'; for (let i = 1; i < 4; i++) g.fillRect(x + 1, y + i * 8, TS - 2, 1);
        g.strokeStyle = '#4a361b'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, TS - 4, TS - 4);
        g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + TS - 3, y + TS - 3); g.stroke();
        g.fillStyle = '#e8b923'; g.fillRect(x + 6, y + 12, 6, 8);
    });
}

function gunWalls(g, def) {
    // skylt på överväggen
    g.fillStyle = 'rgba(10,8,6,0.9)'; rr(g, 110, 4, 292, 24, 5); g.fill();
    g.strokeStyle = 'rgba(255,140,30,0.8)'; g.lineWidth = 1.2; rr(g, 111, 5, 290, 22, 4); g.stroke();
    neonText(g, 'PANG-PELLES VAPEN', 256, 17, 13, '#ffb454', '#ff6a00');
    g.font = `16px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🔫', 90, 17); g.fillText('🔫', 422, 17);
    // måltavla på högra väggen
    const px = 15 * TS + 16, py = 8 * TS + 16;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(px - 10, py - 30, 24, 64);
    box(g, px - 12, py - 32, 24, 64, '#e9e4d3');
    g.fillStyle = '#1f2937'; g.beginPath(); g.ellipse(px, py - 20, 6, 7, 0, 0, TAU); g.fill();
    g.beginPath(); g.moveTo(px - 11, py + 28); g.lineTo(px - 10, py - 8); g.quadraticCurveTo(px, py - 14, px + 10, py - 8); g.lineTo(px + 11, py + 28); g.closePath(); g.fill();
    for (const r of [4, 8, 12]) { g.strokeStyle = r === 8 ? '#dc2626' : '#e9e4d3'; g.lineWidth = 1; g.beginPath(); g.arc(px, py + 6, r, 0, TAU); g.stroke(); }
    for (const [dx, dy] of [[0, 6], [3, 2], [-4, 9], [1, -9], [-2, 15], [5, 13]]) disc(g, px + dx, py + dy, 1.1, '#000');
    // affisch "KONTANT" på vänstra väggen
    box(g, 4, 8 * TS + 2, 24, 28, '#c2410c'); box(g, 6, 8 * TS + 4, 20, 24, '#fde68a');
    g.font = `10px ${SIGN_FONT}`; g.fillStyle = '#7c2d12'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('$$$', 16, 8 * TS + 14); box(g, 9, 8 * TS + 22, 14, 2, '#7c2d12'); box(g, 11, 8 * TS + 26, 10, 1.5, '#7c2d12');
    // kamerans fäste (själva kameran är animerad)
    box(g, 0, 6 * TS + 10, 8, 12, '#111');
    // utgångsskylt
    box(g, 5 * TS - 6, 11 * TS + 8, 42, 12, '#052e16'); box(g, 5 * TS - 6, 11 * TS + 8, 42, 12, 'rgba(34,197,94,0.25)');
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#4ade80'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTGÅNG', 5 * TS + 15, 11 * TS + 14.5);
}

function gunDoor(g, def) {
    // tung stålport sedd uppifrån: två flak, nitar och varningsränder
    const x = 7 * TS, y = 11 * TS, w = 2 * TS;
    box(g, x, y, w, TS, '#59606a');
    for (const side of [0, 1]) {
        const bx = x + 2 + side * 31;
        box(g, bx, y + 2, 29, 28, '#78808b'); box(g, bx, y + 2, 29, 3, 'rgba(255,255,255,0.28)');
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(bx + 0.5, y + 2.5, 28, 27);
        for (const [dx, dy] of [[4, 6], [25, 6], [4, 26], [25, 26]]) disc(g, bx + dx, y + dy, 1.4, '#3a3f47');
    }
    box(g, x, y + 24, w, 6, '#17181a');
    g.fillStyle = '#e8b923';
    for (let xx = x - 4; xx < x + w; xx += 12) { g.beginPath(); g.moveTo(xx, y + 24); g.lineTo(xx + 6, y + 24); g.lineTo(xx + 2, y + 30); g.lineTo(xx - 4, y + 30); g.closePath(); g.fill(); }
    box(g, x + 31, y + 2, 2, 22, '#2a2f36');
    disc(g, x + 26, y + 13, 3, '#2a2f36'); disc(g, x + 38, y + 13, 3, '#2a2f36');
    box(g, x + 29, y + 11, 6, 4, '#22c55e');
}

function paintGun(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') gunFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, GUN_WALL);
    aoPass(g, def);
    gunRackWall(g);
    gunCounter(g, def);
    gunFloorItems(g, def);
    gunDoor(g, def);
    gunWalls(g, def);
}

// ═══════════════════════════════════════════
//  RÖRLIGT LAGER — dansgolv, lampor, folk
// ═══════════════════════════════════════════

const DANCE_COLORS = ['#ff4fd8', '#22e5ff', '#a855f7', '#ffd23f'];

function exitArrow(ctx, def, t) {
    const e = def.exit, p = 0.5 + 0.5 * Math.sin(t * 4);
    ctx.globalAlpha = 0.35 + p * 0.5;
    ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const y = e.y - 10 + p * 4;
    ctx.beginPath(); ctx.moveTo(e.x - 9, y - 6); ctx.lineTo(e.x, y + 3); ctx.lineTo(e.x + 9, y - 6); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
}

function dynClub(ctx, state, v, t) {
    const def = state.def, d = derived(def);
    // dansgolvet pulserar i färg
    const step = Math.floor(t * 2.2), dl = d.dance;
    for (let i = 0; i < dl.length; i += 2) {
        const tx = dl[i], ty = dl[i + 1], x = tx * TS, y = ty * TS;
        if (x > v.x1 || x + TS < v.x0 || y > v.y1 || y + TS < v.y0) continue;
        ctx.globalAlpha = 0.04 + (Math.sin(t * 3.4 - (tx + ty) * 0.8) * 0.5 + 0.5) * 0.15;
        ctx.fillStyle = DANCE_COLORS[(tx * 3 + ty * 5 + step) & 3];
        ctx.fillRect(x + 3, y + 3, TS - 6, TS - 6);
    }
    ctx.globalAlpha = 1;
    // scenlamporna jagar längs kanten
    ctx.fillStyle = '#fff1b8'; ctx.beginPath();
    for (let i = 0; i < d.bulbs.length; i++) {
        const b = d.bulbs[i];
        if (b[0] < v.x0 - 8 || b[0] > v.x1 + 8 || b[1] < v.y0 - 8 || b[1] > v.y1 + 8) continue;
        if ((Math.floor((b[0] + b[1]) / 12 - t * 7) % 3 + 3) % 3 !== 0) continue;
        ctx.moveTo(b[0] + 2.4, b[1]); ctx.arc(b[0], b[1], 2.4, 0, TAU);
    }
    ctx.fill();
    // skylten flimrar till ibland
    const f = (t * 0.31) % 1;
    if (f < 0.025 || (f > 0.06 && f < 0.075)) {
        const s = CLUB_SIGNS[0];
        ctx.fillStyle = 'rgba(8,4,14,0.62)'; rr(ctx, s.x - s.w / 2 + 2, s.y - s.h / 2 + 2, s.w - 4, s.h - 4, 4); ctx.fill();
    }
    // DJ-bordet: skivor snurrar, ljudnivån hoppar
    for (const px of [100, 188]) {
        ctx.save(); ctx.translate(px, 112); ctx.rotate(t * 3.6);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, 0, 7, 0, 1.3); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillRect(7.5, -0.7, 2.6, 1.4);
        ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
        const lv = 0.3 + 0.7 * Math.abs(Math.sin(t * (4.1 + i * 1.3) + i));
        ctx.fillStyle = lv > 0.82 ? '#ef4444' : lv > 0.55 ? '#facc15' : '#22c55e';
        ctx.fillRect(134 + i * 6, 120 - lv * 10, 3.6, lv * 10);
    }
    exitArrow(ctx, def, t);
}

function dynGun(ctx, state, v, t) {
    const def = state.def;
    // övervakningskameran sveper över butiken
    const cx = 12, cy = 6 * TS + 16, a = Math.sin(t * 0.7) * 0.6;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
    ctx.fillStyle = 'rgba(255,255,210,0.07)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 160, -0.4, 0.4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#1b1d20'; rr(ctx, -3, -5, 15, 10, 3); ctx.fill();
    ctx.fillStyle = '#3b3f45'; ctx.fillRect(10, -3.4, 4, 6.8);
    ctx.fillStyle = Math.floor(t * 1.6) % 2 ? '#ff2a2a' : '#5c1010'; ctx.beginPath(); ctx.arc(1, -2, 1.3, 0, TAU); ctx.fill();
    ctx.restore();
    // kassaskärmen blinkar till
    if (Math.floor(t * 2) % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(11 * TS + 6, 5 * TS + 9, 16, 6); }
    exitArrow(ctx, def, t);
}

function drawPoleTops(ctx, def, v) {
    const poles = derived(def).poles;
    for (let i = 0; i < poles.length; i++) {
        const p = poles[i];
        if (p.x < v.x0 - 12 || p.x > v.x1 + 12 || p.y < v.y0 - 12 || p.y > v.y1 + 12) continue;
        ctx.fillStyle = '#c8cfdb'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(p.x - 1, p.y - 1, 1.2, 0, TAU); ctx.fill();
    }
}

// Drinkar, bricka och glitter ovanpå figurerna. Lägena följer händerna i renderarens
// drawPedShape (skala 1,6): lx framåt, ly åt höger.
function glassAt(ctx, x, y, r, col) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

function accessory(ctx, n, t) {
    const L = n.look || {};
    let rot = n.angle;
    if (n.kind === 'waitress') {
        // bricka framför bröstet, hållen med båda armarna
        const c = Math.cos(rot), s = Math.sin(rot), x = n.x + c * 15, y = n.y + s * 15;
        ctx.lineCap = 'round'; ctx.strokeStyle = L.dress || L.shirt || '#111827'; ctx.lineWidth = 3.2;
        for (let k = -1; k <= 1; k += 2) {
            ctx.beginPath(); ctx.moveTo(n.x - s * 5.5 * k, n.y + c * 5.5 * k); ctx.lineTo(n.x + c * 13 - s * 5 * k, n.y + s * 13 + c * 5 * k); ctx.stroke();
        }
        ctx.lineCap = 'butt';
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 1.5, y + 2, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#64748b'; ctx.lineWidth = 0.8; ctx.stroke();
        for (let i = 0; i < 3; i++) glassAt(ctx, x + Math.cos(i * 2.1 + 0.4) * 3.6, y + Math.sin(i * 2.1 + 0.4) * 3.6, 2.2, DRINKS[i]);
    } else if (n.drink && n.pose !== 'work') {
        let lx = Math.sin(n.phase) * 3.84, ly = 11.5, r = 2.7;
        if (n.pose === 'cheer') { lx = 3.2 + 3.2 * Math.abs(Math.sin(n.phase * 3)); ly = 13.6; r = 3.4; }
        else if (n.pose === 'dance') { rot += Math.sin(n.phase * 2) * 0.45; lx = -Math.sin(n.phase * 2) * 6.4; ly = 13.6; }
        else if (n.pose === 'sit') { lx = 11; ly = 8.5; }
        const c = Math.cos(rot), s = Math.sin(rot), x = n.x + lx * c - ly * s, y = n.y + lx * s + ly * c;
        if (n.pose === 'sit') {
            // sittande figurer saknar händer i renderaren: en arm och en hand om glaset
            ctx.lineCap = 'round'; ctx.strokeStyle = L.shirt || '#888'; ctx.lineWidth = 3.4;
            ctx.beginPath(); ctx.moveTo(n.x - s * 5.5, n.y + c * 5.5); ctx.lineTo(x, y); ctx.stroke(); ctx.lineCap = 'butt';
            ctx.fillStyle = L.skin || '#e0ac69'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, TAU); ctx.fill();
        }
        glassAt(ctx, x, y, r, n.drink);
        if (n.pose === 'cheer') {
            ctx.fillStyle = '#fff';
            const k = Math.sin(t * 14 + n.phase);
            ctx.fillRect(x + 4 + k, y - 5, 1.3, 1.3); ctx.fillRect(x - 5 - k, y - 3, 1.3, 1.3); ctx.fillRect(x + 1, y - 7 + k, 1.3, 1.3);
        }
    }
    if (L.sparkle) {
        // paljettglitter som blinkar runt dansarna
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 3; i++) {
            const a = t * 2.3 + n.phase * 0.2 + i * 2.1, r = 12 + 4 * Math.sin(t * 3 + i);
            const al = 0.5 + 0.5 * Math.sin(t * 9 + i * 3 + n.phase);
            if (al < 0.3) continue;
            const px = n.x + Math.cos(a) * r, py = n.y + Math.sin(a * 1.3) * r;
            ctx.globalAlpha = al;
            ctx.fillRect(px - 0.7, py - 2.4, 1.4, 4.8); ctx.fillRect(px - 2.4, py - 0.7, 4.8, 1.4);
        }
        ctx.globalAlpha = 1;
    }
}

// Enkel reservfigur om renderaren inte skickar med drawPerson
function fallbackPerson(ctx, n) {
    const L = n.look || {};
    const swing = n.pose === 'walk' || n.pose === 'dance' ? Math.sin(n.phase) * 4 : 0;
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2.5, 2.5, 9, 11, 0, 0, TAU); ctx.fill();
    ctx.rotate(n.angle); ctx.scale(1.6, 1.6);
    if (n.pose !== 'sit') { ctx.fillStyle = '#1f2937'; ctx.fillRect(swing - 2, -4, 5, 3); ctx.fillRect(-swing - 2, 1, 5, 3); }
    if (n.pose === 'cheer') { ctx.fillStyle = L.skin || '#e0ac69'; ctx.fillRect(2, -7.5, 4, 2.2); ctx.fillRect(2, 5.3, 4, 2.2); }
    ctx.fillStyle = L.dress || L.shirt || '#888'; ctx.beginPath(); ctx.ellipse(0, 0, L.dress ? 5 : 4.2, 7, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = L.skin || '#e0ac69'; ctx.beginPath(); ctx.arc(0.5, 0, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = L.hair || '#222'; ctx.beginPath(); ctx.arc(-0.6, 0, 3.2, PI * 0.5, PI * 1.5); ctx.fill();
    if (L.cap) { ctx.fillStyle = typeof L.cap === 'string' ? L.cap : '#111827'; ctx.beginPath(); ctx.arc(0, 0, 3.7, PI * 0.35, PI * 1.65); ctx.fill(); ctx.fillRect(2, -2.2, 2.4, 4.4); }
    ctx.restore();
}

function drawStaticLayer(ctx, def, v) {
    const W = def.w * TS, H = def.h * TS;
    const x0 = Math.max(0, Math.floor(v.x0)), y0 = Math.max(0, Math.floor(v.y0));
    const x1 = Math.min(W, Math.ceil(v.x1)), y1 = Math.min(H, Math.ceil(v.y1));
    if (x1 <= x0 || y1 <= y0) return;
    const L = staticLayer(ctx, def);
    if (L) {
        const s = L.scale;
        ctx.drawImage(L.cv, x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s, x0, y0, x1 - x0, y1 - y0);
    } else paintStatic(ctx, def); // utan DOM (tester): rita direkt
}

// Ritar golv, möbler, skyltar och folk (via drawPerson). Pratbubblor (npc.say) ritar renderaren.
// ctx är redan transformerad: 1 enhet = 1 px inomhus. view = { x0, y0, x1, y1 }.
export function drawInterior(ctx, state, view, t, drawPerson) {
    const def = state.def;
    if (t === undefined) t = state.t;
    const v = view || { x0: 0, y0: 0, x1: def.w * TS, y1: def.h * TS };
    drawStaticLayer(ctx, def, v);
    const th = THEMES.get(def.theme);
    if (th) { if (th.dyn) th.dyn(ctx, state, v, t); } else if (def.theme === 'club') dynClub(ctx, state, v, t); else dynGun(ctx, state, v, t);
    const draw = drawPerson || fallbackPerson, npcs = state.npcs;
    for (let i = 0; i < npcs.length; i++) {
        const n = npcs[i];
        if (n.x < v.x0 - 40 || n.x > v.x1 + 40 || n.y < v.y0 - 40 || n.y > v.y1 + 40) continue;
        draw(ctx, n);
        accessory(ctx, n, t);
        if (th && th.accessory) th.accessory(ctx, n, t);
    }
    if (th) { if (th.over) th.over(ctx, state, v, t); } else if (def.theme === 'club') drawPoleTops(ctx, def, v);
}

// ═══════════════════════════════════════════
//  LJUS — additivt sken efter att folk ritats
// ═══════════════════════════════════════════

//  [x, y, radie, färg, styrka, pulsfart]
const CLUB_GLOWS = [
    [480, 26, 170, '#ff2bd6', 0.3, 0],
    [144, 70, 120, '#8b5cf6', 0.26, 2.4],
    [112, 300, 150, '#22e5ff', 0.2, 0],
    [112, 450, 120, '#22e5ff', 0.16, 0],
    [830, 200, 190, '#ffb300', 0.13, 0],
    [830, 330, 160, '#ff2bd6', 0.14, 1.6],
    [368, 96, 84, '#ff4fd8', 0.2, 3.1],
    [592, 96, 84, '#22e5ff', 0.2, 2.7],
    [480, 205, 96, '#a855f7', 0.16, 2.1],
    [850, 590, 120, '#facc15', 0.1, 0],
    [480, 690, 120, '#ff4fd8', 0.2, 1.3]
];
// ljuskäglor från scenens tak: [x, y, färg, längd, bredd, grundvinkel, sväng, fart, fas]
const CLUB_BEAMS = [
    [300, 26, '#ff4fd8', 210, 54, PI / 2, 0.55, 0.9, 0],
    [348, 26, '#22e5ff', 230, 54, PI / 2, 0.5, 1.1, 1.7],
    [612, 26, '#a855f7', 230, 54, PI / 2, 0.5, 1.0, 3.1],
    [660, 26, '#ffd23f', 210, 54, PI / 2, 0.55, 0.8, 4.4]
];
const GUN_GLOWS = [
    [256, 16, 150, '#ff6a00', 0.3, 0],
    [128, 240, 140, '#cfe8ff', 0.09, 0],
    [384, 240, 140, '#cfe8ff', 0.09, 0],
    [256, 150, 120, '#fff1c9', 0.1, 0],
    [256, 372, 80, '#22c55e', 0.24, 3.2]
];

function lightGlow(ctx, x, y, r, hex, a, v) {
    if (a <= 0.004 || x + r < v.x0 || x - r > v.x1 || y + r < v.y0 || y - r > v.y1) return;
    const s = glowSprite(hex);
    if (!s) return;
    ctx.globalAlpha = a;
    ctx.drawImage(s, x - r, y - r, r * 2, r * 2);
}

export function drawInteriorLights(ctx, state, view, t) {
    const def = state.def;
    if (t === undefined) t = state.t;
    const v = view || { x0: 0, y0: 0, x1: def.w * TS, y1: def.h * TS };
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, def.w * TS, def.h * TS); ctx.clip(); // inget sken utanför rummet
    ctx.globalCompositeOperation = 'lighter';
    const th = THEMES.get(def.theme);
    const glows = th ? th.glows || [] : def.theme === 'club' ? CLUB_GLOWS : GUN_GLOWS;
    for (let i = 0; i < glows.length; i++) {
        const g = glows[i];
        const pulse = g[5] ? 0.7 + 0.3 * Math.sin(t * g[5] + i) : 1;
        lightGlow(ctx, g[0], g[1], g[2], g[3], g[4] * pulse, v);
    }
    if (th && th.lights) th.lights(ctx, state, v, t, (x, y, r, hex, a) => lightGlow(ctx, x, y, r, hex, a, v));
    if (!th && def.theme === 'club') {
        // dansgolvets rörliga färgfläckar
        lightGlow(ctx, 480 + Math.sin(t * 0.6) * 90, 300 + Math.cos(t * 0.5) * 40, 250, '#a855f7', 0.1, v);
        lightGlow(ctx, 480 + Math.cos(t * 0.45) * 110, 310 + Math.sin(t * 0.7) * 36, 220, '#22e5ff', 0.08, v);
        // ljusprickar som sveper över golvet
        for (let i = 0; i < 7; i++) {
            const x = 480 + Math.cos(t * 0.5 + i * 0.9) * (70 + 18 * i), y = 290 + Math.sin(t * 0.7 + i * 1.7) * 82;
            lightGlow(ctx, x, y, 17, DANCE_COLORS[(i + Math.floor(t)) & 3], 0.34, v);
        }
        // strålkastare över scenen och dansgolvet
        for (let i = 0; i < CLUB_BEAMS.length; i++) {
            const b = CLUB_BEAMS[i], cone = coneSprite(b[2]);
            if (!cone) continue;
            ctx.save();
            ctx.translate(b[0], b[1]); ctx.rotate(b[5] + Math.sin(t * b[7] + b[8]) * b[6] - PI / 2);
            ctx.globalAlpha = 0.5;
            ctx.drawImage(cone, -b[4] / 2, 0, b[4], b[3]);
            ctx.restore();
        }
        // levande ljus på borden
        const flick = 0.85 + 0.15 * Math.sin(t * 9), tb = derived(def).tables;
        for (let i = 0; i < tb.length; i += 2) lightGlow(ctx, tb[i], tb[i + 1], 24, '#ffb347', 0.22 * flick, v);
    }
    ctx.restore();
}

// ═══════════════════════════════════════════
//  FLER RUM — verksamheterna (interiors-biz-*.js) registrerar sig här
//  theme = {
//    populate(def, rnd) → npcs        personal och kunder när man kommer in
//    update(state, dt, rnd)            kundflöde, köer, försäljning (state.events), panik
//    step(n, state, dt, rnd) → bool    egna beteenden (n.beh) — true om hanterad
//    paint(g, def)                     statiskt lager (golv, väggar, möbler, skyltar)
//    dyn(ctx, state, view, t)          rörliga detaljer under folk (skärmar, ånga, maskiner)
//    accessory(ctx, n, t)              saker i händerna (mat, hantlar, laptop …)
//    over(ctx, state, view, t)         sådant som ska ligga ovanpå folk
//    glows: [[x, y, r, '#hex', styrka, puls]], lights(ctx, state, view, t, glow)
//  }
//  def.legend = { 'K': { name: 'grill', solid: true } } lägger till egna möbeltecken.
// ═══════════════════════════════════════════
const THEMES = new Map();

export function registerInterior(def, theme) {
    if (def.legend) for (const [ch, info] of Object.entries(def.legend)) {
        LEGEND[ch] = info;
        SOLID[ch.charCodeAt(0)] = info.solid ? 1 : 0;
    }
    if (!def.zones) def.zones = [];
    INTERIORS[def.id] = def;
    THEMES.set(def.theme, theme);
}

// Samma verktyg som klubben och vapenaffären är byggda med
export const KIT = {
    TS, PI, TAU, tc, rand, pick, clamp, SKINS, HAIRS, SHIRTS, DRINKS, SIGN_FONT, EMOJI_FONT,
    makeNpc, patrol, seated, trySay, angDiff, wrapAngle, turnToward,
    chAt, solidTile, interiorSolid, circleClear, nearestFreeSpot,
    tileHash, rgba, rr, disc, box, softShadow, neonText, neonLine, zoneAt, eachTile, sprite, glowSprite,
    wallPass, aoPass, slabGroup, plankFloor, carpetTile, plantAt, exitArrow, glassAt
};
