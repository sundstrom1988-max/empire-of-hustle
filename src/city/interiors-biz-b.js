// ═══════════════════════════════════════════
//  STAN — verksamheternas rum (b)
//  Nattklubben VIP, KimIT Tech AB, Skyskrapan och RocketFuel Industries.
//  Alla fyra har personal som jobbar hela tiden och kunder som kommer,
//  köar, betalar, gör sitt och går — även innan spelaren köpt stället.
//
//  Gemensam motor (överst): vägsökning över rutnätet, en liten
//  "manusläsare" som styr både personal (loopar) och kunder (en runda
//  genom stället), kö vid disken, rån (panic) och hälsning till ägaren.
//  Rummen (nedan) är sedan bara data + målning + egna detaljer.
// ═══════════════════════════════════════════

import { registerInterior, KIT } from './interiors.js';

const {
    TS, PI, TAU, tc, rand, pick, clamp, SKINS, HAIRS, SHIRTS, DRINKS, SIGN_FONT, EMOJI_FONT,
    makeNpc, trySay, turnToward, solidTile, circleClear,
    tileHash, rgba, rr, disc, box, softShadow, neonText, neonLine, zoneAt, eachTile, sprite, glowSprite,
    wallPass, aoPass, slabGroup, carpetTile, plantAt, exitArrow, chAt
} = KIT;

// ═══════════════════════════════════════════
//  RUTNÄT: byggare och vägsökning
// ═══════════════════════════════════════════

// Rutnätsbyggare: rummen skrivs som kod men blir vanliga strängrader (def.rows)
function mkGrid(w, h, doorX) {
    const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
    const api = {
        set(x, y, c) { g[y][x] = c; return api; },
        rect(x0, y0, rw, rh, c) { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) g[y][x] = c; return api; },
        rows() { return g.map(r => r.join('')); }
    };
    g[h - 1][doorX] = 'e'; g[h - 1][doorX + 1] = 'e';
    return api;
}

// Områden som bara personalen går i (kunderna planerar aldrig rutter dit)
const STAFF_ZONES = new Set(['staff', 'service', 'dj', 'behind']);
const navCache = new WeakMap();
function nav(def, staff) {
    let N = navCache.get(def);
    if (!N) {
        N = { cust: new Uint8Array(def.w * def.h), staff: new Uint8Array(def.w * def.h) };
        for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
            const free = !solidTile(def, tx, ty);
            N.staff[ty * def.w + tx] = free ? 1 : 0;
            N.cust[ty * def.w + tx] = free && !STAFF_ZONES.has(zoneAt(def, tx, ty)) ? 1 : 0;
        }
        navCache.set(def, N);
    }
    return staff ? N.staff : N.cust;
}

const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const LOS_R = 7; // så mycket luft vill vi ha runt en gående figur

function clearAt(def, M, x, y) {
    return circleClear(def, x, y, LOS_R) && M[clamp(Math.floor(y / TS), 0, def.h - 1) * def.w + clamp(Math.floor(x / TS), 0, def.w - 1)] === 1;
}
function lineClear(def, M, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 5);
    for (let i = 1; i < n; i++) {
        const k = i / n;
        if (!clearAt(def, M, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false;
    }
    return true;
}

// Rutt (lista av punkter) från (x0,y0) till (x1,y1): BFS över lediga rutor, sedan sträckt så att
// den går rakt där det går. null om målet inte går att nå.
function findPath(def, x0, y0, x1, y1, staff) {
    const W = def.w, H = def.h, M = nav(def, staff), ix = (x, y) => y * W + x;
    const tileOf = (x, y) => [clamp(Math.floor(x / TS), 0, W - 1), clamp(Math.floor(y / TS), 0, H - 1)];
    const nearFree = (tx, ty, px, py) => {
        if (M[ix(tx, ty)]) return [tx, ty];
        let best = null, bd = Infinity;
        for (let r = 1; r <= 4 && !best; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = tx + dx, y = ty + dy;
                if (x < 0 || y < 0 || x >= W || y >= H || !M[ix(x, y)]) continue;
                const d = (tc(x) - px) ** 2 + (tc(y) - py) ** 2;
                if (d < bd) { bd = d; best = [x, y]; }
            }
        }
        return best;
    };
    const s = nearFree(...tileOf(x0, y0), x0, y0), g = nearFree(...tileOf(x1, y1), x1, y1);
    if (!s || !g) return null;
    const goalTileOk = M[ix(...tileOf(x1, y1))] === 1;
    const end = goalTileOk && circleClear(def, x1, y1, LOS_R) ? { x: x1, y: y1 } : { x: tc(g[0]), y: tc(g[1]) };
    let tiles = [];
    if (s[0] === g[0] && s[1] === g[1]) tiles = [];
    else {
        const prev = new Int16Array(W * H).fill(-1), seen = new Uint8Array(W * H);
        const q = [ix(s[0], s[1])]; seen[q[0]] = 1;
        let found = false;
        for (let qi = 0; qi < q.length && !found; qi++) {
            const cur = q[qi], cx = cur % W, cy = (cur / W) | 0;
            for (let k = 0; k < 8; k++) {
                const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const ni = ix(nx, ny);
                if (seen[ni] || !M[ni]) continue;
                if (k >= 4 && !(M[ix(cx + NEI[k][0], cy)] && M[ix(cx, cy + NEI[k][1])])) continue; // ingen diagonal runt hörn
                seen[ni] = 1; prev[ni] = cur; q.push(ni);
                if (nx === g[0] && ny === g[1]) { found = true; break; }
            }
        }
        if (!found) return null;
        for (let c = ix(g[0], g[1]); c !== ix(s[0], s[1]); c = prev[c]) tiles.push({ x: tc(c % W), y: tc((c / W) | 0) });
        tiles.reverse();
    }
    const pts = [{ x: x0, y: y0 }, ...tiles, end];
    // sträck: gå så rakt som möjligt
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
//  FOLK: manusläsaren
//  Alla (personal och kunder) har n.c = { stages, si, mode, path, ... }.
//  Steg (stages):
//    { k:'visit', x, y, a, pose, t:[min,max], drink, prop, sway }  gå dit, gör något en stund
//    { k:'go', x, y, vanish }          gå dit (vanish: tas bort när man kommit fram)
//    { k:'queue' }                     ställ dig i kön, betala vid disken ('sale')
//    { k:'sit', opts:[{sx,sy,fx,fy,a}], t:[min,max] }   sätt dig på en ledig stol/soffa
//    egna steg via spec.hooks (hiss i skyskrapan)
//  Personal loopar sitt manus (c.loop), kunder går det en gång och försvinner.
// ═══════════════════════════════════════════

const PANIC_LINES = ['Lugn!', 'Ta pengarna!', 'Ta det lugnt!', 'Inga konstigheter!', 'Ta kassan, bara!'];
const GREET_LINES = ['Välkommen, chefen!', 'Chefen! Kul att se dig!', 'Hej chefen!'];

function actor(kind, x, y, rnd, o = {}) {
    const n = makeNpc(kind, x, y, rnd, { look: o.look, beh: 'biz', angle: o.angle || 0, pose: o.pose || 'idle', drink: o.drink });
    n.c = {
        stages: o.stages || [], si: 0, mode: 'new', path: null, pi: 0, wait: 0, speed: o.speed || 44,
        loop: !!o.loop, order: o.order || 'seq', staff: !!o.staff, watch: !!o.watch, age: 0,
        seat: null, frozen: false, run: false, tx: x, ty: y, bx: x, by: y
    };
    n.cust = !o.staff;
    if (o.prop) n.prop = o.prop;
    if (o.lines) { n.lines = o.lines; n.chatT = rand(rnd, 5, 22); }
    return n;
}

function aim(n, def, x, y) {
    const c = n.c;
    c.tx = x; c.ty = y;
    c.path = findPath(def, n.x, n.y, x, y, c.staff);
    c.pi = 0;
    return !!c.path;
}

function walkStep(n, def, dt) {
    const c = n.c, p = c.path && c.path[c.pi];
    if (!p) return true;
    const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy), m = c.speed * (c.run ? 1.55 : 1) * dt;
    const ox = n.x, oy = n.y;
    if (d <= m + 0.01) { n.x = p.x; n.y = p.y; c.pi++; } else {
        n.x += dx / d * m; n.y += dy / d * m;
        turnToward(n, Math.atan2(dy, dx), dt * 10);
    }
    n.phase += Math.hypot(n.x - ox, n.y - oy) * 0.12;
    n.pose = 'walk';
    // aldrig in i väggar/möbler: backa och planera om
    if (!circleClear(def, n.x, n.y, 5) && circleClear(def, ox, oy, 5)) { n.x = ox; n.y = oy; c.pi = Math.max(0, c.pi - 1); aim(n, def, c.tx, c.ty); }
    return c.pi >= c.path.length;
}

// Mjuk knuff så att gående inte går genom varandra
function separate(n, state, dt) {
    const def = state.def, npcs = state.npcs;
    let px = 0, py = 0;
    for (let i = 0; i < npcs.length; i++) {
        const o = npcs[i];
        if (o === n || !o.c || o.c.mode === 'hook') continue;
        const dx = n.x - o.x, dy = n.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 > 15 * 15 || d2 < 0.01) continue;
        const d = Math.sqrt(d2), k = (15 - d) / 15;
        px += dx / d * k; py += dy / d * k;
    }
    if (px || py) {
        const nx = n.x + px * 34 * dt, ny = n.y + py * 34 * dt;
        if (circleClear(def, nx, ny, 6)) { n.x = nx; n.y = ny; }
    }
}

function poseTick(n, dt) {
    switch (n.pose) {
        case 'idle': n.phase += (Math.round(n.phase / PI) * PI - n.phase) * Math.min(1, dt * 5); break;
        case 'dance': n.phase += dt * 3.3; break;
        case 'cheer': n.phase += dt * 2; break;
        case 'sit': n.phase += dt * 1.6; break;
        default: n.phase += dt * 1.5;
    }
}

function biz(state, spec, rnd) {
    let B = state.biz;
    if (B) return B;
    B = state.biz = { spawnT: rand(rnd, 1.2, 3.5), queue: [], taken: new Set(), greeted: false, panic: false, panicSayT: 0, ex: spec.initEx ? spec.initEx(state) : null };
    const q = state.npcs.filter(n => n.c && n.c.mode === 'queue').sort((a, b) => a.c.qo - b.c.qo);
    for (const n of q) B.queue.push(n);
    for (const n of state.npcs) if (n.c && n.c.seat) B.taken.add(n.c.seat.key);
    return B;
}

function nextStage(n, state, B, rnd, spec) {
    const c = n.c;
    if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; }
    if (c.order === 'rand' && c.stages.length > 1) {
        let i = Math.min(c.stages.length - 1, Math.floor(rnd() * c.stages.length));
        if (i === c.si) i = (i + 1) % c.stages.length;
        c.si = i;
    } else c.si++;
    startStage(n, state, B, rnd, spec);
}

function startStage(n, state, B, rnd, spec) {
    const c = n.c, def = state.def;
    for (let guard = 0; guard < 6; guard++) {
        if (c.si >= c.stages.length) {
            if (c.loop && c.stages.length) c.si = 0;
            else { n.dead = true; c.mode = 'dead'; return; }
        }
        const s = c.stages[c.si];
        const hook = spec.hooks && spec.hooks[s.k];
        if (hook) {
            const r = hook.start(n, s, state, B, rnd);
            if (r === 'skip') { c.si++; continue; }
            c.mode = 'hook'; return;
        }
        switch (s.k) {
            case 'queue':
                B.queue.push(n); c.mode = 'queue'; c.qs = -1; c.payT = undefined; return;
            case 'sit': {
                const free = s.opts.filter(o => !B.taken.has(o.key));
                if (!free.length) { c.si++; continue; }
                const o = free[Math.min(free.length - 1, Math.floor(rnd() * free.length))];
                B.taken.add(o.key); c.seat = o;
                if (!aim(n, def, o.fx, o.fy)) { B.taken.delete(o.key); c.seat = null; c.si++; continue; }
                c.mode = 'walk'; return;
            }
            default: // visit, go
                if (!aim(n, def, s.x, s.y)) { c.si++; continue; }
                c.mode = 'walk'; return;
        }
    }
    n.dead = true; c.mode = 'dead';
}

function arrive(n, state, B, rnd, spec) {
    const c = n.c, s = c.stages[c.si];
    if (c.seat && s.k === 'sit') { // glid in på stolen
        c.slide = { x0: n.x, y0: n.y, x1: c.seat.sx, y1: c.seat.sy, t: 0, dur: 0.5, out: false };
        c.mode = 'slide'; return;
    }
    if (s.vanish) { n.dead = true; c.mode = 'dead'; return; }
    if (s.t) {
        c.mode = 'stay'; c.wait = rand(rnd, s.t[0], s.t[1]);
        n.pose = s.pose || 'idle'; c.face = s.a == null ? n.angle : s.a;
        c.bx = n.x; c.by = n.y; c.sway = !!s.sway;
        if (s.drink !== undefined) n.drink = s.drink || null;
        if (s.prop !== undefined) n.prop = s.prop || null;
        if (s.say && rnd() < 0.6) trySay(state, n, s.say, 2.4);
        return;
    }
    nextStage(n, state, B, rnd, spec);
}

function stayStep(n, state, B, dt, rnd, spec) {
    const c = n.c, def = state.def;
    poseTick(n, dt);
    let want = c.face;
    const f = state.focus;
    if (f && c.watch && n.pose !== 'dance') {
        const fx = f.x - n.x, fy = f.y - n.y;
        if (fx * fx + fy * fy < 140 * 140) want = Math.atan2(fy, fx);
    }
    if (c.sway) { // dans: lite svaj runt platsen
        const t = state.t, ph = n.phase * 0.17;
        const nx = c.bx + Math.sin(t * 0.55 + ph) * 6, ny = c.by + Math.cos(t * 0.8 + ph * 1.7) * 4;
        if (circleClear(def, nx, ny, 5)) { n.x = nx; n.y = ny; }
        want = -PI / 2 + Math.sin(t * 0.9 + ph) * 0.8;
        turnToward(n, want, dt * 8);
    } else turnToward(n, want, dt * 6);
    c.wait -= dt;
    if (c.wait > 0) return;
    if (c.seat) { // resa sig och gå ut ur stolen
        c.slide = { x0: n.x, y0: n.y, x1: c.seat.fx, y1: c.seat.fy, t: 0, dur: 0.45, out: true };
        c.mode = 'slide'; return;
    }
    nextStage(n, state, B, rnd, spec);
}

function slideStep(n, state, B, dt, rnd, spec) {
    const c = n.c, s = c.slide;
    s.t += dt;
    const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
    n.x = s.x0 + (s.x1 - s.x0) * e; n.y = s.y0 + (s.y1 - s.y0) * e;
    if (!s.out) { n.pose = 'sit'; turnToward(n, c.seat.a, dt * 10); } else { n.pose = 'idle'; }
    if (k < 1) return;
    c.slide = null;
    if (!s.out) {
        const st = c.stages[c.si];
        c.mode = 'stay'; c.wait = rand(rnd, st.t[0], st.t[1]); n.pose = 'sit'; c.face = c.seat.a; c.sway = false;
        if (st.drink !== undefined) n.drink = st.drink || null;
        if (st.prop !== undefined) n.prop = st.prop || null;
    } else nextStage(n, state, B, rnd, spec);
}

function queueStep(n, state, B, dt, rnd, spec) {
    const c = n.c, def = state.def;
    const idx = B.queue.indexOf(n);
    if (idx < 0) { B.queue.push(n); return; }
    const slot = def.queue[Math.min(idx, def.queue.length - 1)];
    if (c.qs !== idx) {
        c.qs = idx;
        if (Math.hypot(n.x - slot.x, n.y - slot.y) > 3) { aim(n, def, slot.x, slot.y); c.qw = true; }
    }
    if (c.qw) {
        if (walkStep(n, def, dt)) { c.qw = false; n.pose = 'idle'; }
        else { separate(n, state, dt); return; }
    }
    poseTick(n, dt);
    n.pose = 'idle';
    const ahead = idx === 0 ? def.counter : def.queue[Math.min(idx, def.queue.length - 1) - 1] || def.counter;
    turnToward(n, Math.atan2(ahead.y - n.y, ahead.x - n.x), dt * 6);
    if (idx !== 0) return;
    if (c.payT === undefined) c.payT = rand(rnd, 2.3, 4.4);
    c.payT -= dt;
    if (c.payT > 0) return;
    state.events.push({ type: 'sale', x: def.counter.x, y: def.counter.y });
    B.queue.splice(0, 1);
    if (spec.onPay) spec.onPay(n, state, B, rnd);
    nextStage(n, state, B, rnd, spec);
}

function startPanic(state, B, rnd, spec) {
    B.panic = true; B.panicSayT = 0;
    for (const n of state.npcs) {
        const c = n.c;
        if (!c) continue;
        if (c.staff) { c.frozen = true; n.pose = 'cheer'; n.say = null; continue; }
        // kunderna: spring till dörren och ut
        const qi = B.queue.indexOf(n); if (qi >= 0) B.queue.splice(qi, 1);
        if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; if (c.slide && c.mode === 'slide') { n.x = c.slide.x1; n.y = c.slide.y1; } }
        if (spec.onFlee) spec.onFlee(n, state, B);
        const d = state.def.door, o = outPoint(state.def);
        c.stages = [{ k: 'go', x: d.x, y: d.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
        c.loop = false; c.run = true; c.si = 0; c.slide = null;
        startStage(n, state, B, rnd, spec);
    }
}

function endPanic(state, B) {
    B.panic = false;
    for (const n of state.npcs) {
        const c = n.c;
        if (!c || !c.staff || !c.frozen) continue;
        c.frozen = false; n.say = null;
        n.pose = c.mode === 'walk' ? 'walk' : (c.stages[c.si] && c.stages[c.si].pose) || 'idle';
    }
}

// punkten precis utanför dörren där kunderna försvinner
function outPoint(def) { return { x: def.door.x, y: def.h * TS - 12 }; }

function actStep(spec, n, state, dt, rnd) {
    const c = n.c;
    if (!c) return false;
    const B = biz(state, spec, rnd), def = state.def;
    c.age += dt;
    if (c.frozen) { // rån: personalen står still med händerna upp
        n.pose = 'cheer'; n.phase += dt * 2;
        return true;
    }
    if (c.mode === 'new') { startStage(n, state, B, rnd, spec); return true; }
    // sista säkerhetsnätet: ingen kund blir kvar för evigt
    if (n.cust && c.age > 260 && !c.run) {
        const qi = B.queue.indexOf(n); if (qi >= 0) B.queue.splice(qi, 1);
        if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; }
        const o = outPoint(def);
        c.stages = [{ k: 'go', x: def.door.x, y: def.door.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
        c.si = 0; c.run = true; c.loop = false; c.slide = null; startStage(n, state, B, rnd, spec);
    }
    switch (c.mode) {
        case 'walk':
            if (walkStep(n, def, dt)) arrive(n, state, B, rnd, spec);
            else separate(n, state, dt);
            break;
        case 'stay': stayStep(n, state, B, dt, rnd, spec); break;
        case 'slide': slideStep(n, state, B, dt, rnd, spec); break;
        case 'queue': queueStep(n, state, B, dt, rnd, spec); break;
        case 'hook': {
            const s = c.stages[c.si];
            if (spec.hooks[s.k].step(n, s, state, B, dt, rnd) === true) nextStage(n, state, B, rnd, spec);
            break;
        }
        default: break;
    }
    return true;
}

function bizUpdate(spec, state, dt, rnd) {
    const B = biz(state, spec, rnd), def = state.def, npcs = state.npcs;
    // rån: kunderna flyr, personalen jublar med händerna upp; sedan blir allt som vanligt
    if (state.panic > 0) {
        if (!B.panic) startPanic(state, B, rnd, spec);
        B.panicSayT -= dt;
        if (B.panicSayT <= 0) {
            B.panicSayT = 3.2;
            let k = 0;
            for (const n of npcs) if (n.c && n.c.staff && k < 4) { n.say = { text: PANIC_LINES[(k + Math.floor(state.t)) % PANIC_LINES.length], life: 2.6 }; k++; }
        }
        state.panic = Math.max(0, state.panic - dt);
        if (state.panic <= 0) { endPanic(state, B); B.spawnT = rand(rnd, 2, 4); }
    } else if (B.panic) { endPanic(state, B); B.spawnT = rand(rnd, 2, 4); }
    // ägaren: personalen hälsar en gång
    if (state.owned && !B.greeted) {
        B.greeted = true;
        let k = 0;
        for (const n of npcs) if (n.c && n.c.staff && k < 4) { n.say = { text: GREET_LINES[k % GREET_LINES.length], life: 3 }; k++; }
    } else if (!state.owned) B.greeted = false;
    if (spec.tick) spec.tick(state, B, dt, rnd);
    // bort med dem som gått ut
    for (let i = npcs.length - 1; i >= 0; i--) {
        if (!npcs[i].dead) continue;
        const qi = B.queue.indexOf(npcs[i]); if (qi >= 0) B.queue.splice(qi, 1);
        if (npcs[i].c && npcs[i].c.seat) B.taken.delete(npcs[i].c.seat.key);
        npcs.splice(i, 1);
    }
    // nya kunder: takten följer state.flow
    if (state.panic > 0) return;
    const flow = clamp(state.flow === undefined ? 1 : state.flow, 0, 3);
    B.spawnT -= dt * flow;
    if (B.spawnT > 0) return;
    let nc = 0;
    for (const n of npcs) if (n.cust) nc++;
    if (nc >= Math.max(1, Math.round(spec.max * clamp(flow, 0.4, 1.5)))) return;
    if (B.queue.length >= def.queue.length - 1) return;
    const made = spec.spawn(state, B, rnd);
    if (made) { npcs.push(made); B.spawnT = rand(rnd, spec.iv[0], spec.iv[1]); }
}

function doorBlocked(state, x, y, r = 22) {
    for (const n of state.npcs) if (Math.hypot(n.x - x, n.y - y) < r) return true;
    return false;
}

function leaveStages(def) {
    const o = outPoint(def);
    return [{ k: 'go', x: def.door.x, y: def.door.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
}

// Placera en kund mitt i sitt manus (populate): steg idx, redan på plats
function dropIn(n, idx, rnd, pop) {
    const c = n.c, s = c.stages[idx];
    c.si = idx;
    if (s.k === 'queue') { c.mode = 'queue'; c.qo = pop.q++; c.qs = -1; return n; }
    if (s.k === 'sit') {
        const free = s.opts.filter(o => !pop.taken.has(o.key));
        if (!free.length) return null;
        const o = free[Math.min(free.length - 1, Math.floor(rnd() * free.length))];
        pop.taken.add(o.key);
        c.seat = o; n.x = o.sx; n.y = o.sy; n.pose = 'sit'; n.angle = o.a;
        c.mode = 'stay'; c.wait = rand(rnd, 1, s.t[1]); c.face = o.a;
        if (s.drink !== undefined) n.drink = s.drink || null;
        return n;
    }
    n.x = s.x; n.y = s.y;
    c.mode = 'stay'; c.wait = rand(rnd, 0.5, Math.max(1, s.t ? s.t[1] : 1));
    n.pose = s.pose || 'idle'; n.angle = s.a == null ? n.angle : s.a; c.face = n.angle; c.bx = n.x; c.by = n.y; c.sway = !!s.sway;
    if (s.drink !== undefined) n.drink = s.drink || null;
    if (s.prop !== undefined) n.prop = s.prop || null;
    return n;
}

const V = (x, y, a, pose, t0, t1, o = {}) => ({ k: 'visit', x, y, a, pose, t: [t0, t1], ...o });
// Personal: loopar sitt manus (stages) hela tiden. start = vilket steg man står i från början.
function staffAt(kind, rnd, pop, stages, o = {}) {
    const n = actor(kind, 0, 0, rnd, { staff: true, loop: true, order: o.order || 'seq', watch: !!o.watch, speed: o.speed || 38, look: o.look, stages, lines: o.lines, drink: o.drink, prop: o.prop });
    n.role = kind;
    return dropIn(n, o.start || 0, rnd, pop) || dropIn(n, 0, rnd, pop);
}

// Utseenden
const hairOf = rnd => pick(rnd, HAIRS), skinOf = rnd => pick(rnd, SKINS);
function look(rnd, shirts, o = {}) {
    const L = { shirt: pick(rnd, shirts), skin: skinOf(rnd), hair: hairOf(rnd) };
    if (o.dress && rnd() < o.dress) { L.dress = pick(rnd, o.dressCols || shirts); L.shirt = L.dress; }
    if (o.cap && rnd() < o.cap) L.cap = pick(rnd, o.capCols || ['#111827', '#1d4ed8', '#dc2626']);
    return L;
}

// Gemensamma saker i händerna / på kroppen
function accessoryB(ctx, n, t) {
    const L = n.look || {};
    const p = n.prop, goggles = L.goggles;
    if (!p && !goggles && !L.badge) return;
    ctx.save();
    ctx.translate(n.x, n.y); ctx.rotate(n.angle);
    const walk = n.pose === 'walk';
    const sw = walk ? Math.sin(n.phase) * 3.4 : 0;
    if (p === 'case') { // portfölj i högerhanden
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-3 + sw + 1.5, 12.5, 10, 5);
        ctx.fillStyle = '#6b3f1d'; ctx.fillRect(-3 + sw, 11.5, 10, 5);
        ctx.fillStyle = '#92602f'; ctx.fillRect(-3 + sw, 11.5, 10, 1.4);
        ctx.fillStyle = '#d4a72c'; ctx.fillRect(1.5 + sw, 13.2, 2, 1.6);
    } else if (p === 'tablet') { // surfplatta i båda händerna
        const x = walk ? 8 : 10;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 1, -5, 7, 10);
        ctx.fillStyle = '#1f2937'; ctx.fillRect(x, -6, 7, 10);
        ctx.fillStyle = '#7dd3fc'; ctx.fillRect(x + 1, -5, 5, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 1, -5, 5, 1.6);
    } else if (p === 'cup') { // kaffekopp
        const x = walk ? 6 + sw : 9, y = walk ? 11.5 : 4.5;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 1, y + 1.5, 3.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5b3a1a'; ctx.beginPath(); ctx.arc(x, y, 2.1, 0, TAU); ctx.fill();
    } else if (p === 'bag') { // kasse i högerhanden
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-4 + sw + 1.5, 12.5, 9, 7);
        ctx.fillStyle = '#e11d48'; ctx.fillRect(-4 + sw, 11.5, 9, 7);
        ctx.fillStyle = '#fda4af'; ctx.fillRect(-4 + sw, 11.5, 9, 1.6);
        ctx.fillStyle = '#fff'; ctx.fillRect(-1 + sw, 14, 3, 2);
    } else if (p === 'clip') { // klippbräda
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(10, -5.5, 8, 11);
        ctx.fillStyle = '#92602f'; ctx.fillRect(9, -6.5, 8, 11);
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(10, -5.5, 6, 9);
        ctx.fillStyle = '#94a3b8'; ctx.fillRect(11, -3.5, 4, 0.8); ctx.fillRect(11, -1.5, 4, 0.8); ctx.fillRect(11, 0.5, 4, 0.8);
    } else if (p === 'box') { // bär en låda
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(7, -7, 13, 15);
        ctx.fillStyle = '#b4802f'; ctx.fillRect(6, -8, 13, 15);
        ctx.fillStyle = '#d9a24a'; ctx.fillRect(6, -8, 13, 2);
        ctx.fillStyle = '#7a5520'; ctx.fillRect(11.5, -8, 2, 15);
    } else if (p === 'phone') { // mobil mot örat
        ctx.fillStyle = '#111827'; ctx.fillRect(2, -9.5, 5, 2.6);
        ctx.fillStyle = '#60a5fa'; ctx.fillRect(2.6, -9.2, 2.4, 2);
    } else if (p === 'mini') { // miniraket i handen
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(7, 8, 13, 4);
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(6, 7, 11, 3.6);
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.moveTo(17, 7); ctx.lineTo(21, 8.8); ctx.lineTo(17, 10.6); ctx.fill();
        ctx.fillStyle = '#ef4444'; ctx.fillRect(5, 6, 3, 1.6); ctx.fillRect(5, 9.8, 3, 1.6);
    }
    if (goggles) { // skyddsglasögon (ses uppifrån som ett band över ögonen)
        ctx.fillStyle = 'rgba(103,232,249,0.9)'; ctx.fillRect(2.4, -4.6, 2.6, 9.2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(2.4, -4.6, 1, 9.2);
        ctx.strokeStyle = '#0e7490'; ctx.lineWidth = 0.8; ctx.strokeRect(2.4, -4.6, 2.6, 9.2);
    }
    if (L.badge) { // namnbricka på bröstet
        ctx.fillStyle = L.badge; ctx.fillRect(4.6, 3.2, 2.2, 3);
    }
    ctx.restore();
}


// ═══════════════════════════════════════════
//  GEMENSAMMA MÅLARHJÄLPMEDEL
// ═══════════════════════════════════════════

// Rutor av ett visst tecken, räknade en gång per rum
const tileCache = new WeakMap();
function tilesOf(def, chars) {
    let m = tileCache.get(def);
    if (!m) { m = new Map(); tileCache.set(def, m); }
    let l = m.get(chars);
    if (!l) {
        l = [];
        eachTile(def, chars, (tx, ty) => l.push(tx, ty));
        m.set(chars, l);
    }
    return l;
}
const inView = (v, x, y, r) => x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1;

function plate(g, x, y, w, h, r, fill, stroke, lw = 1) {
    rr(g, x, y, w, h, r); g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; rr(g, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, r - 0.5)); g.stroke(); }
}

// Skylt: mörk platta med neontext
function signPlate(g, text, cx, cy, w, h, size, color, glow, rot = 0) {
    g.save(); g.translate(cx, cy); if (rot) g.rotate(rot);
    g.fillStyle = 'rgba(4,8,16,0.88)'; rr(g, -w / 2, -h / 2, w, h, 5); g.fill();
    g.strokeStyle = rgba(glow, 0.85); g.lineWidth = 1.2; rr(g, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 4); g.stroke();
    neonText(g, text, 0, 1, size, color, glow);
    g.restore();
}

// Rund bord sett uppifrån
function roundTable(g, cx, cy, r, side, top, glass) {
    softShadow(g, cx, cy, r + 1, r + 1, 0.35);
    disc(g, cx, cy, r, side); disc(g, cx, cy, r - 1.6, top);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(cx, cy, r - 1.6, PI * 1.1, PI * 1.6); g.lineTo(cx, cy); g.fill();
    if (glass) { disc(g, cx, cy, 3.4, glass); disc(g, cx, cy, 1.8, '#ffffff'); }
}

// Stol sedd uppifrån; dir = åt vilket håll stolen vänder (0 höger, PI vänster, -PI/2 upp, PI/2 ner)
function chairTop(g, cx, cy, dir, body, seat) {
    g.save(); g.translate(cx, cy); g.rotate(dir);
    g.fillStyle = 'rgba(0,0,0,0.3)'; rr(g, -10, -10, 22, 22, 5); g.fill();
    g.fillStyle = body; rr(g, -11, -10, 22, 20, 5); g.fill();
    g.fillStyle = seat; rr(g, -7, -8, 17, 16, 4); g.fill();
    g.fillStyle = body; rr(g, -12, -10, 5, 20, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-12, -10, 1.3, 20);
    g.restore();
}

// Soffsektion; vägg vid sidorna ger ryggstöd
function sofaB(g, def, tx, ty, pal) {
    const x = tx * TS, y = ty * TS;
    const wl = chAt(def, tx - 1, ty) === '#', wr = chAt(def, tx + 1, ty) === '#', wt = chAt(def, tx, ty - 1) === '#', wb = chAt(def, tx, ty + 1) === '#';
    const same = (dx, dy) => chAt(def, tx + dx, ty + dy) === def.rows[ty][tx];
    softShadow(g, x + 16, y + 16, 15, 15, 0.3);
    box(g, x, y, TS, TS, pal.base);
    // ryggstöd där det finns vägg, annars armstöd i ändarna
    const l = wl || !same(-1, 0) && !wt && !wb ? 9 : 2, r = wr || !same(1, 0) && !wt && !wb ? 9 : 2;
    const t = wt ? 9 : 2, b = wb ? 9 : 2;
    g.fillStyle = pal.seat; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, x + l + 2, y + t + 2, TS - l - r - 4, 5, 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.stroke();
    g.fillStyle = pal.back;
    if (wt) g.fillRect(x, y, TS, 9); if (wb) g.fillRect(x, y + TS - 9, TS, 9);
    if (wl) g.fillRect(x, y, 9, TS); if (wr) g.fillRect(x + TS - 9, y, 9, TS);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    if (wt) g.fillRect(x, y, TS, 1.5); if (wr) g.fillRect(x + TS - 1.5, y, 1.5, TS);
}

function bottle(g, x, y, col, len = 9) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 1, y + 1, 4, len);
    g.fillStyle = col; g.fillRect(x, y, 4, len);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 0.6, y, 1, len);
    g.fillStyle = '#1f2937'; g.fillRect(x + 1, y - 2.4, 2, 2.6);
}

// Utgångsskylt (grön ruta)
function exitSign(g, x, y) {
    box(g, x, y, 42, 12, '#052e16'); box(g, x, y, 42, 12, 'rgba(34,197,94,0.25)');
    g.strokeStyle = 'rgba(74,222,128,0.7)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 41, 11);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#4ade80'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTGÅNG', x + 21, y + 6.5);
}


// ═══════════════════════════════════════════
//  1. NATTKLUBBEN VIP  (id: club)
//  Entré med kassa, dansgolv med färgade rutor, DJ-bås, bar, VIP-bås med rep.
//  Blå/turkos stil — ingen scen, ingen show: en vanlig riktigt bra natt.
// ═══════════════════════════════════════════

const CLUB_W = 24, CLUB_H = 16;
const clubGrid = (() => {
    const g = mkGrid(CLUB_W, CLUB_H, 11);
    // DJ-bås: högtalare i sidorna, bord framför, DJ:n står bakom
    g.set(7, 1, 'k').set(7, 2, 'k').set(16, 1, 'k').set(16, 2, 'k').rect(8, 2, 8, 1, 'D');
    // baren längs vänstra väggen: personalen bakom (x1–2), disk (x3), barstolar (x4)
    g.rect(3, 4, 1, 8, 'B').set(1, 3, '2').set(2, 3, '2').set(1, 12, '2').set(2, 12, '2');
    for (const y of [5, 7, 9, 11]) g.set(4, y, 'o');
    // dansgolvet
    g.rect(7, 4, 10, 6, 'd');
    // VIP-båset uppe till höger: rep runt, soffor, bord
    g.rect(17, 1, 1, 4, 'W').rect(17, 7, 6, 1, 'W');
    g.rect(18, 1, 4, 1, 'S').rect(22, 1, 1, 5, 'S').rect(19, 3, 2, 2, 'V').set(18, 6, 'x').set(22, 6, 'x');
    // loungebord med stolar
    g.set(21, 10, 't').set(20, 10, 'h').set(22, 10, 'h').set(21, 13, 't').set(20, 13, 'h').set(22, 13, 'h');
    g.set(6, 13, 't').set(5, 13, 'h').set(7, 13, 'h');
    // kassan vid entrén
    g.rect(14, 12, 4, 1, '1');
    // växter
    g.set(1, 1, 'x').set(6, 1, 'x').set(1, 14, 'x').set(22, 14, 'x').set(9, 14, 'x');
    return g;
})();

const CLUB_QUEUE = [17, 16, 15, 14, 13].map(x => ({ x: tc(x), y: tc(13) }));

const CLUB_DEF = {
    id: 'club', name: 'Nattklubben VIP', theme: 'biz-club', w: CLUB_W, h: CLUB_H,
    rows: clubGrid.rows(),
    legend: {
        D: { name: 'DJ-bord', solid: true }, k: { name: 'högtalare', solid: true }, B: { name: 'bardisk', solid: true },
        o: { name: 'barstol', solid: true }, W: { name: 'repstolpe', solid: true }, S: { name: 'soffa', solid: true },
        V: { name: 'soffbord', solid: true }, t: { name: 'bord', solid: true }, h: { name: 'stol', solid: true },
        x: { name: 'växt', solid: true }, 1: { name: 'kassadisk', solid: true }, 2: { name: 'backbar', solid: true }
    },
    spawn: { x: 384, y: tc(13) },
    exit: { x: 384, y: 15 * TS + 20, r: 22 },
    door: { x: 384, y: tc(14) },
    counter: { x: 512, y: 12 * TS + 14 },
    queue: CLUB_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Kassan: inträde, ägande, intäkter', x: 528, y: tc(13), r: 66 }],
    music: 'club',
    zones: [
        { x: 8, y: 1, w: 8, h: 1, kind: 'dj' },
        { x: 1, y: 4, w: 2, h: 8, kind: 'service' },
        { x: 18, y: 1, w: 5, h: 6, kind: 'vip' },
        { x: 4, y: 12, w: 14, h: 3, kind: 'foyer' }
    ]
};

// ── Måla ──
const CLUB_PAL = { wall: '#0a1325', face: '#162a4e', hi: '#2e5090', line: '#040810' };
const CLUB_NEON = ['#22e5ff', '#3b82f6', '#2dd4bf', '#8b5cf6'];

function clubFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (ch === 'd') {
        const a = (tx + ty) & 1;
        box(g, x, y, TS, TS, a ? '#0b1736' : '#091229');
        g.fillStyle = 'rgba(80,170,255,0.07)'; g.fillRect(x + 4, y + 4, TS - 8, TS - 8);
        g.strokeStyle = a ? 'rgba(60,200,255,0.5)' : 'rgba(80,140,255,0.45)'; g.lineWidth = 1.2; g.strokeRect(x + 3.5, y + 3.5, TS - 7, TS - 7);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + 14, y + 4); g.lineTo(x + 4, y + 14); g.fill();
        return;
    }
    if (zone === 'vip') return carpetTile(g, x, y, '#0f2860', 'rgba(150,205,255,0.24)');
    if (zone === 'dj') {
        box(g, x, y, TS, TS, '#101830');
        g.strokeStyle = 'rgba(120,180,255,0.16)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.beginPath(); g.moveTo(x + 4, y + 16); g.lineTo(x + 28, y + 16); g.stroke();
        return;
    }
    if (zone === 'service') {
        box(g, x, y, TS, TS, '#171e2c');
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 4 + i * 8, y + 4 + j * 8, 3, 3);
        return;
    }
    if (ch === 'e') { box(g, x, y, TS, TS, '#070b16'); return; }
    if (zone === 'foyer') { // svart marmor med blå ådring
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#0a101e' : '#0c1424');
        g.strokeStyle = 'rgba(80,170,255,0.14)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + (h & 15), y); g.lineTo(x + 8 + (h >> 4 & 15), y + 14); g.lineTo(x + 4 + (h >> 8 & 15), y + TS); g.stroke();
        g.strokeStyle = 'rgba(60,110,200,0.14)'; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    // svart blank golv med blå sken
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#0d1526' : '#0b1222');
    g.fillStyle = 'rgba(90,160,255,0.05)'; g.beginPath(); g.moveTo(x, y + 20); g.lineTo(x + 20, y); g.lineTo(x + 28, y); g.lineTo(x, y + 28); g.fill();
    g.strokeStyle = 'rgba(60,110,200,0.12)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
    if (h % 7 === 0) { g.fillStyle = 'rgba(160,220,255,0.18)'; g.fillRect(x + (h >> 3) % 28 + 2, y + (h >> 7) % 28 + 2, 1.6, 1.6); }
}

function paintClubB(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') clubFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, CLUB_PAL);
    aoPass(g, def);
    // ljus runt dansgolvet
    neonLine(g, [[7 * TS + 1, 4 * TS + 1], [17 * TS - 1, 4 * TS + 1], [17 * TS - 1, 10 * TS - 1], [7 * TS + 1, 10 * TS - 1], [7 * TS + 1, 4 * TS + 1]], '#22e5ff', 2);
    clubBarB(g, def);
    clubDjB(g, def);
    clubVipB(g, def);
    clubLoungeB(g, def);
    clubFoyerB(g, def);
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // neon längs väggarna
    neonLine(g, [[40, 27], [7 * TS - 6, 27]], '#22e5ff', 2.2);
    neonLine(g, [[17 * TS + 8, 27], [23 * TS - 6, 27]], '#8b5cf6', 2.2);
    neonLine(g, [[2 * TS, 15 * TS + 6], [10 * TS, 15 * TS + 6]], '#3b82f6', 2.2);
    neonLine(g, [[14 * TS, 15 * TS + 6], [22 * TS + 8, 15 * TS + 6]], '#3b82f6', 2.2);
    // skyltar
    signPlate(g, 'NATTKLUBBEN VIP', 384, 17, 232, 24, 15, '#9df3ff', '#22d3ee');
    signPlate(g, 'BAR', 16, 8 * TS, 44, 24, 13, '#8cf3ff', '#22e5ff', -PI / 2);
    signPlate(g, 'VIP', 23 * TS + 16, 3.5 * TS, 44, 24, 13, '#ffe38a', '#ffb300', PI / 2);
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🍾', 238, 17); g.fillText('🍾', 530, 17);
    exitSign(g, 8 * TS + 4, 15 * TS + 10);
}

function clubBarB(g, def) {
    // bakbar: flaskhylla längs väggen, kylskåp i ändarna
    const y0 = 4 * TS, hh = 8 * TS;
    box(g, TS, y0, 14, hh, '#0a1220'); box(g, TS + 14, y0, 2, hh, '#22d3ee');
    g.fillStyle = 'rgba(34,211,238,0.18)'; g.fillRect(TS, y0, 14, hh);
    const BOT = ['#38bdf8', '#2dd4bf', '#e2e8f0', '#6366f1', '#22d3ee', '#a78bfa', '#7dd3fc'];
    for (let yy = y0 + 6, i = 0; yy < y0 + hh - 8; yy += 12, i++) {
        bottle(g, TS + 3, yy, BOT[(tileHash(i, 3) >> 3) % BOT.length], 8);
        bottle(g, TS + 9, yy + 1, BOT[(tileHash(i, 9) >> 3) % BOT.length], 7);
    }
    // kyl (tecken 2): rostfritt med glasdörr
    eachTile(def, '2', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#2a3444'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#7f93aa'); box(g, x + 2, y + 2, TS - 4, 2, 'rgba(255,255,255,0.35)');
        box(g, x + 5, y + 7, TS - 10, TS - 12, '#10304f'); box(g, x + 5, y + 7, TS - 10, TS - 12, 'rgba(34,211,238,0.25)');
        for (let i = 0; i < 3; i++) bottle(g, x + 7 + i * 6, y + 12, BOT[(tx + ty + i) % BOT.length], 9);
        box(g, x + 5, y + 20, TS - 10, 1.4, 'rgba(255,255,255,0.35)');
    });
    // disken
    slabGroup(g, def, 'B', { side: '#050c18', top: '#123a5e', hi: 'rgba(130,235,255,0.5)' });
    eachTile(def, 'B', (tx, ty) => {
        const h = tileHash(tx, ty), x = tx * TS, y = ty * TS;
        for (let i = 0; i < 2; i++) {
            const gx = x + 9 + ((h >> (i * 5)) & 13), gy = y + 8 + ((h >> (i * 5 + 3)) & 15);
            if ((h >> (i + 9)) & 1) continue;
            disc(g, gx, gy, 3, 'rgba(255,255,255,0.8)'); disc(g, gx, gy, 1.9, BOT[(h >> (i + 2)) % BOT.length]);
        }
    });
    // kassan på baren
    box(g, 3 * TS + 6, 9 * TS + 3, 19, 14, '#0b1220'); box(g, 3 * TS + 8, 9 * TS + 5, 15, 7, '#5eead4'); box(g, 3 * TS + 8, 9 * TS + 5, 15, 2, 'rgba(255,255,255,0.4)');
    neonLine(g, [[4 * TS - 2, 4 * TS + 6], [4 * TS - 2, 12 * TS - 6]], '#22e5ff', 2.2);
    // barstolar
    eachTile(def, 'o', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 11, 11, 0.35);
        disc(g, cx, cy, 11, '#8fa2b8'); disc(g, cx, cy, 9.2, '#0e7490'); disc(g, cx - 3, cy - 3, 3.2, 'rgba(255,255,255,0.3)');
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.stroke();
    });
}

function clubDjB(g, def) {
    slabGroup(g, def, 'D', { side: '#05070d', top: '#18213a', hi: 'rgba(120,200,255,0.45)', ins: 2 });
    // högtalare
    eachTile(def, 'k', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        box(g, x, y, TS, TS, '#05060a'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#12141c');
        disc(g, x + 16, y + 19, 9.5, '#05060a'); disc(g, x + 16, y + 19, 7.5, '#232733'); disc(g, x + 16, y + 19, 3.2, '#0a0b10');
        disc(g, x + 16, y + 7, 2.6, '#232733');
        g.strokeStyle = 'rgba(80,200,255,0.4)'; g.lineWidth = 1; g.beginPath(); g.arc(x + 16, y + 19, 9.5, 0, TAU); g.stroke();
    });
    // utrustning på DJ-bordet (x 256..512, y 64..96)
    for (const px of [300, 468]) {
        box(g, px - 17, 66, 34, 28, '#0a0d16'); box(g, px - 16, 67, 32, 26, '#131a2c');
        disc(g, px, 80, 12.5, '#05060a'); disc(g, px, 80, 11, '#171d2d');
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.8;
        for (const r of [4, 6.5, 9]) { g.beginPath(); g.arc(px, 80, r, 0, TAU); g.stroke(); }
        disc(g, px, 80, 2.6, px < 384 ? '#22e5ff' : '#a78bfa');
    }
    box(g, 360, 67, 48, 26, '#090c14'); box(g, 361, 68, 46, 24, '#1b2338');
    for (let i = 0; i < 4; i++) { box(g, 365 + i * 10.5, 72, 2.4, 14, '#05070d'); box(g, 364.2 + i * 10.5, 74 + (i * 3) % 7, 4, 3, ['#22e5ff', '#3b82f6', '#2dd4bf', '#8b5cf6'][i]); }
    // laptop
    box(g, 496 - 4, 70, 0, 0, '#000');
    neonLine(g, [[8 * TS + 2, 3 * TS + 2], [16 * TS - 2, 3 * TS + 2]], '#8b5cf6', 2);
}

function clubVipB(g, def) {
    // rep: först repen, sedan stolparna
    const rope = (x1, y1, x2, y2) => {
        g.lineCap = 'round';
        g.strokeStyle = '#07163a'; g.lineWidth = 5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = '#2563eb'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1 - 0.8); g.lineTo(x2, y2 - 0.8); g.stroke();
        g.lineCap = 'butt';
    };
    eachTile(def, 'W', (tx, ty) => {
        if (chAt(def, tx + 1, ty) === 'W') rope(tc(tx), tc(ty), tc(tx + 1), tc(ty));
        if (chAt(def, tx, ty + 1) === 'W') rope(tc(tx), tc(ty), tc(tx), tc(ty + 1));
    });
    eachTile(def, 'W', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 7, 7, 0.4);
        disc(g, cx, cy, 6.5, '#27303e'); disc(g, cx, cy, 5.2, '#cbd5e1'); disc(g, cx, cy, 2.6, '#f8fafc');
    });
    eachTile(def, 'S', (tx, ty) => sofaB(g, def, tx, ty, { base: '#0a1b44', seat: '#1d4ed8', back: '#10307a' }));
    // soffbord: glasskiva med champagnekylare
    slabGroup(g, def, 'V', { side: '#c9d6e8', top: '#0c1a33', hi: 'rgba(255,255,255,0.3)', ins: 2 });
    const bx = 20 * TS, by = 4 * TS;
    disc(g, bx, by, 8, '#cbd5e1'); disc(g, bx, by, 6.4, '#7c8aa0'); disc(g, bx, by, 2.4, '#16a34a');
    for (const [dx, dy] of [[-18, -8], [18, 10], [-14, 14], [16, -12]]) { disc(g, bx + dx, by + dy, 2.8, 'rgba(255,255,255,0.8)'); disc(g, bx + dx, by + dy, 1.8, '#a5f3fc'); }
    // "VIP" invävd i mattan
    g.save(); g.translate(18.5 * TS, 5.2 * TS); g.rotate(-PI / 2);
    g.font = `13px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(190,225,255,0.4)'; g.fillText('VIP', 0, 0);
    g.restore();
}

function clubLoungeB(g, def) {
    eachTile(def, 'h', (tx, ty) => {
        const right = chAt(def, tx - 1, ty) === 't'; // stolen står till höger om bordet?
        const left = chAt(def, tx + 1, ty) === 't';
        chairTop(g, tc(tx), tc(ty), left ? 0 : right ? PI : PI / 2, '#0a1b44', '#2563eb');
    });
    eachTile(def, 't', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty), h = tileHash(tx, ty);
        roundTable(g, cx, cy, 14, '#0a1020', '#143a63', '#5eead4');
        for (let i = 0; i < 2; i++) {
            const a = (h >> (i * 4)) % 6 + i * PI, gx = cx + Math.cos(a) * 8, gy = cy + Math.sin(a) * 8;
            disc(g, gx, gy, 2.8, 'rgba(255,255,255,0.8)'); disc(g, gx, gy, 1.8, DRINKS[(h >> (i + 5)) % DRINKS.length]);
        }
    });
}

function clubFoyerB(g, def) {
    // mattan från dörren
    const x = 11 * TS, y = 13 * TS;
    box(g, x + 3, y + 2, 2 * TS - 6, 2 * TS - 4, '#0b2447'); box(g, x + 3, y + 2, 2 * TS - 6, 2 * TS - 4, 'rgba(34,211,238,0.1)');
    g.strokeStyle = 'rgba(34,229,255,0.6)'; g.lineWidth = 1.5; g.strokeRect(x + 4.5, y + 3.5, 2 * TS - 9, 2 * TS - 7);
    // kassan
    slabGroup(g, def, '1', { side: '#050c18', top: '#16405f', hi: 'rgba(130,235,255,0.5)' });
    box(g, 14 * TS + 4, 12 * TS + 5, 22, 20, '#0b1220'); box(g, 14 * TS + 6, 12 * TS + 7, 18, 9, '#5eead4'); box(g, 14 * TS + 6, 12 * TS + 7, 18, 2.4, 'rgba(255,255,255,0.45)');
    box(g, 14 * TS + 7, 12 * TS + 18, 16, 6, '#1f2937'); for (let i = 0; i < 4; i++) box(g, 14 * TS + 9 + i * 3.6, 12 * TS + 20, 2.4, 2.4, '#94a3b8');
    // prislapp
    plate(g, 14 * TS + 30, 12 * TS + 7, 72, 18, 4, '#050b16', '#22d3ee', 1.2);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#9df3ff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('INGÅNG 200', 14 * TS + 66, 12 * TS + 16.5);
    // kreditkortsläsare + biljettbunt
    box(g, 17 * TS + 12, 12 * TS + 7, 14, 17, '#111827'); box(g, 17 * TS + 14, 12 * TS + 9, 10, 5, '#38bdf8'); box(g, 17 * TS + 14, 12 * TS + 16, 10, 5, '#475569');
    // ingångsdörrar (öppna glasdörrar mot nattgatan)
    const dx = 11 * TS, dy = 15 * TS, w = 2 * TS;
    box(g, dx, dy, w, TS, '#050914');
    box(g, dx, dy + 18, w, 14, '#0d1c3d'); box(g, dx, dy + 26, w, 6, '#1a3a78');
    box(g, dx - 2, dy + 1, 4, 17, '#7f93aa'); box(g, dx + w - 2, dy + 1, 4, 17, '#7f93aa');
    box(g, dx - 1, dy + 2, 2, 15, 'rgba(160,230,255,0.5)'); box(g, dx + w - 1, dy + 2, 2, 15, 'rgba(160,230,255,0.5)');
    neonLine(g, [[dx - 4, dy + 1], [dx - 4, dy + 22]], '#22e5ff', 2); neonLine(g, [[dx + w + 4, dy + 1], [dx + w + 4, dy + 22]], '#22e5ff', 2);
}

// ── Rörligt lager ──
const CLUB_COLS = ['#22e5ff', '#3b82f6', '#2dd4bf', '#8b5cf6'];

function dynClubB(ctx, state, v, t) {
    const def = state.def;
    // dansgolvet pulserar i blått och turkos
    const step = Math.floor(t * 2.4), dl = tilesOf(def, 'd');
    for (let i = 0; i < dl.length; i += 2) {
        const tx = dl[i], ty = dl[i + 1], x = tx * TS, y = ty * TS;
        if (x > v.x1 || x + TS < v.x0 || y > v.y1 || y + TS < v.y0) continue;
        ctx.globalAlpha = 0.07 + (Math.sin(t * 3.2 - (tx + ty) * 0.7) * 0.5 + 0.5) * 0.26;
        ctx.fillStyle = CLUB_COLS[(tx * 3 + ty * 5 + step) & 3];
        ctx.fillRect(x + 4, y + 4, TS - 8, TS - 8);
    }
    ctx.globalAlpha = 1;
    // DJ-podiet: LED-rutor som följer takten
    for (let x = 8; x < 16; x++) {
        const px = x * TS, py = TS;
        if (px > v.x1 || px + TS < v.x0) continue;
        const lv = 0.5 + 0.5 * Math.sin(t * 5.1 + x * 1.3);
        ctx.globalAlpha = 0.1 + lv * 0.3; ctx.fillStyle = CLUB_COLS[(x + step) & 3];
        ctx.fillRect(px + 3, py + 3, TS - 6, TS - 6);
    }
    ctx.globalAlpha = 1;
    // högtalarna pumpar i bastakt
    const beat = (t * 2.1) % 1;
    for (const [tx, ty] of [[7, 1], [7, 2], [16, 1], [16, 2]]) {
        const cx = tx * TS + 16, cy = ty * TS + 19;
        ctx.strokeStyle = `rgba(80,220,255,${0.55 * (1 - beat)})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, 7 + beat * 6, 0, TAU); ctx.stroke();
        disc(ctx, cx, cy, 3.2 + (beat < 0.25 ? 1.3 : 0), '#2a3040');
    }
    // DJ:ns skivor snurrar, ljudnivån hoppar
    for (const px of [300, 468]) {
        ctx.save(); ctx.translate(px, 80); ctx.rotate(t * 3.6 + px);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 1.2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(8.5, -0.7, 2.6, 1.4);
        ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
        const lv = 0.3 + 0.7 * Math.abs(Math.sin(t * (4.1 + i * 1.3) + i));
        ctx.fillStyle = lv > 0.85 ? '#f43f5e' : lv > 0.55 ? '#facc15' : '#22d3ee';
        ctx.fillRect(364.4 + i * 10.5, 91 - lv * 9, 3.6, lv * 9);
    }
    // skylten flimrar till ibland
    const f = (t * 0.27) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.065)) { ctx.fillStyle = 'rgba(4,8,16,0.65)'; rr(ctx, 270, 7, 228, 20, 4); ctx.fill(); }
    // kassaskärmen
    if (Math.floor(t * 1.7) % 6 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(14 * TS + 6, 12 * TS + 7, 18, 9); }
    exitArrow(ctx, def, t);
}

const CLUB_GLOWS = [
    [384, 24, 190, '#22d3ee', 0.3, 0],
    [384, 66, 170, '#3b82f6', 0.28, 2.2],
    [112, 250, 150, '#22e5ff', 0.2, 0],
    [112, 400, 110, '#22e5ff', 0.14, 0],
    [660, 110, 170, '#3b82f6', 0.26, 1.7],
    [735, 112, 100, '#ffb300', 0.16, 0],
    [384, 200, 150, '#2dd4bf', 0.13, 1.4],
    [512, 400, 90, '#22e5ff', 0.22, 0],
    [384, 492, 120, '#3b82f6', 0.26, 1.7],
    [680, 330, 90, '#22d3ee', 0.1, 0]
];
const CLUB_BEAMS = [
    [300, 34, '#22e5ff', 230, 52, 0.5, 0.9, 0], [350, 34, '#3b82f6', 250, 52, 0.46, 1.1, 1.7],
    [418, 34, '#8b5cf6', 250, 52, 0.46, 1.0, 3.1], [468, 34, '#2dd4bf', 230, 52, 0.5, 0.8, 4.4]
];
function coneB(hex) {
    return sprite('bcone' + hex, 64, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(hex, 0.75)); gr.addColorStop(1, rgba(hex, 0));
        g.fillStyle = gr;
        for (const k of [1, 0.78, 0.56]) {
            g.globalAlpha = k === 1 ? 0.35 : 0.4;
            g.beginPath(); g.moveTo(w / 2 - 2 * k, 0); g.lineTo(w / 2 + 2 * k, 0); g.lineTo(w / 2 + (w / 2) * k, h); g.lineTo(w / 2 - (w / 2) * k, h); g.closePath(); g.fill();
        }
    });
}
function lightsClubB(ctx, state, v, t, glow) {
    glow(384 + Math.sin(t * 0.6) * 80, 210 + Math.cos(t * 0.5) * 30, 230, '#3b82f6', 0.1);
    glow(384 + Math.cos(t * 0.45) * 100, 215 + Math.sin(t * 0.7) * 30, 200, '#22e5ff', 0.08);
    for (let i = 0; i < 7; i++) {
        const x = 384 + Math.cos(t * 0.5 + i * 0.9) * (50 + 17 * i), y = 205 + Math.sin(t * 0.7 + i * 1.7) * 60;
        glow(x, y, 16, CLUB_COLS[(i + Math.floor(t)) & 3], 0.34);
    }
    for (let i = 0; i < CLUB_BEAMS.length; i++) {
        const b = CLUB_BEAMS[i], cone = coneB(b[2]);
        if (!cone) continue;
        ctx.save();
        ctx.translate(b[0], b[1]); ctx.rotate(Math.sin(t * b[6] + b[7]) * b[5]);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(cone, -b[4] / 2, 0, b[4], b[3]);
        ctx.restore();
    }
    const tb = tilesOf(state.def, 't'), flick = 0.85 + 0.15 * Math.sin(t * 9);
    for (let i = 0; i < tb.length; i += 2) glow(tc(tb[i]), tc(tb[i + 1]), 24, '#5eead4', 0.2 * flick);
}

// ── Folk ──
const CLUB_LINES = {
    cashier: ['Ingång tvåhundra.', 'Nästa!', 'Kort eller swish?', 'Hej, välkommen in.'],
    bartender: ['Vad blir det?', 'En till?', 'Skål!', 'Blå Lagoon på g.'],
    dj: ['Hands up!', 'Mera bas!', 'Nu kör vi!', 'Vem vill ha en önskelåt?'],
    guard: ['Inga bråk här.', 'Ta det lugnt.', 'Köa som alla andra.', 'Namnet på listan?'],
    waitress: ['Champagne på väg!', 'Ursäkta!', 'Passa brickan!'],
    guest: ['Wooo!', 'Skål!', 'Bäst natt!', 'Kom, vi dansar!', 'Yalla!']
};
const CLUB_SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#14b8a6', '#f8fafc', '#0ea5e9', '#111827', '#1d4ed8', '#e11d48'];
const clubLook = rnd => {
    const L = look(rnd, CLUB_SHIRTS, { dress: 0.4, dressCols: ['#e11d48', '#a855f7', '#0ea5e9', '#14b8a6', '#f8fafc', '#facc15', '#ec4899'], cap: 0.12 });
    if (L.dress && rnd() < 0.5) L.sparkle = true;
    return L;
};

const clubBarSpots = [4, 6, 8, 10].map(ty => ({ x: tc(4), y: tc(ty) }));
const clubDanceTiles = [];
for (let ty = 5; ty <= 8; ty++) for (let tx = 8; tx <= 15; tx++) clubDanceTiles.push({ x: tc(tx), y: tc(ty) });
// stolar: sx/sy = stolens mitt, fx/fy = ledig ruta man kommer från, a = vänd mot bordet
const seat = (tx, ty, ftx, fty, a) => ({ key: tx + ',' + ty, sx: tc(tx), sy: tc(ty), fx: tc(ftx), fy: tc(fty), a });
const CLUB_LOUNGE = [seat(5, 13, 5, 14, 0), seat(7, 13, 7, 14, PI), seat(20, 13, 20, 14, 0), seat(22, 13, 22, 14, PI), seat(20, 10, 19, 10, 0), seat(22, 10, 22, 11, PI)];
const CLUB_VIPSEATS = [seat(19, 1, 19, 2, PI / 2), seat(21, 1, 21, 2, PI / 2), seat(22, 3, 21, 2, PI), seat(22, 5, 21, 5, PI)];

function clubScript(rnd, drink) {
    const dance = () => ({ k: 'visit', ...pick(rnd, clubDanceTiles), a: -PI / 2, pose: 'dance', t: [14, 34], sway: true, drink: rnd() < 0.3 ? pick(rnd, DRINKS) : null });
    const bar = () => ({ k: 'visit', ...pick(rnd, clubBarSpots), a: PI, pose: 'idle', t: [6, 12], drink: pick(rnd, DRINKS), say: 'En blå, tack!' });
    const lounge = () => ({ k: 'sit', opts: CLUB_LOUNGE, t: [10, 22], drink: pick(rnd, DRINKS) });
    const vip = () => ({ k: 'sit', opts: CLUB_VIPSEATS, t: [10, 20], drink: '#fde68a' });
    const r = rnd();
    const mid = r < 0.35 ? [bar(), dance()] : r < 0.7 ? [dance(), bar(), dance()] : r < 0.88 ? [dance(), lounge(), dance()] : [vip(), dance()];
    return [{ k: 'queue' }, ...mid, ...leaveStages(CLUB_DEF)];
}

function clubGuest(rnd, from) {
    const n = actor('guest', from.x, from.y, rnd, { look: clubLook(rnd), stages: clubScript(rnd), speed: rand(rnd, 44, 54), lines: CLUB_LINES.guest, angle: -PI / 2 });
    return n;
}

function populateClubB(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    const H = PI / 2;
    add(staffAt('cashier', rnd, pop, [V(tc(15), 368, H, 'work', 6, 12), V(tc(16), 368, H, 'work', 5, 10)], { watch: true, lines: CLUB_LINES.cashier, look: { shirt: '#0e7490', skin: '#c68642', hair: '#111111' } }));
    add(staffAt('bartender', rnd, pop, [V(tc(2), tc(5), 0, 'work', 4, 9), V(tc(2), tc(6) + 6, 0, 'work', 4, 8), V(tc(2), tc(8), 0, 'work', 4, 9), V(tc(2), tc(10), 0, 'work', 4, 9)], { order: 'rand', start: 1, watch: true, lines: CLUB_LINES.bartender, look: { shirt: '#f8fafc', skin: '#c68642', hair: '#3f2a14' } }));
    add(staffAt('dj', rnd, pop, [V(tc(10), tc(1), H, 'work', 3, 7), V(tc(12), tc(1), H, 'work', 3, 7), V(tc(13) + 8, tc(1), H, 'work', 3, 7), V(tc(14), tc(1), H, 'work', 3, 7)], { order: 'rand', start: 1, speed: 28, lines: CLUB_LINES.dj, look: { shirt: '#1e1b4b', skin: '#e0ac69', hair: '#111111', cap: '#22d3ee' } }));
    add(staffAt('guard', rnd, pop, [V(tc(10), tc(13), 0, 'idle', 6, 11), V(tc(10), tc(11), -0.35, 'idle', 5, 9)], { watch: true, lines: CLUB_LINES.guard, look: { shirt: '#111827', skin: '#8d5524', hair: '#111111', cap: '#0f172a' } }));
    add(staffAt('guard', rnd, pop, [V(tc(18), tc(5), PI, 'idle', 8, 14), V(tc(18), tc(6) - 4, PI, 'idle', 6, 10)], { watch: true, start: 1, lines: CLUB_LINES.guard, look: { shirt: '#1e293b', skin: '#c68642', hair: '#111111', cap: '#0f172a' } }));
    add(staffAt('waitress', rnd, pop, [V(tc(5), tc(6), 0, 'idle', 1.5, 3), V(tc(19), tc(11), 0, 'idle', 2, 3.5), V(tc(21), tc(14), -PI / 2, 'idle', 2, 3.5), V(tc(19), tc(5), H, 'idle', 2, 3.5), V(tc(5), tc(14), -PI / 2, 'idle', 1.5, 3)], { speed: 50, lines: CLUB_LINES.waitress, drink: '#f8fafc', look: { shirt: '#111827', skin: '#e0ac69', hair: '#d4a017', dress: '#0e7490' } }));
    // kön vid kassan
    for (let i = 0; i < 2; i++) add(dropIn(clubGuest(rnd, CLUB_QUEUE[i]), 0, rnd, pop));
    // folk mitt i sin natt
    for (let i = 0; i < 9; i++) {
        const n = clubGuest(rnd, def.door), mid = n.c.stages.length - 3;
        add(dropIn(n, 1 + (i % Math.max(1, mid)), rnd, pop));
    }
    return npcs;
}

const CLUB_SPEC = {
    iv: [4.5, 8], max: 8, hooks: null,
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return clubGuest(rnd, state.def.door);
    }
};

registerInterior(CLUB_DEF, {
    populate: (def, rnd) => populateClubB(def, rnd),
    update: (state, dt, rnd) => bizUpdate(CLUB_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(CLUB_SPEC, n, state, dt, rnd),
    paint: paintClubB,
    dyn: dynClubB,
    accessory: accessoryB,
    glows: CLUB_GLOWS,
    lights: lightsClubB
});

// ═══════════════════════════════════════════
//  2. KIMIT TECH AB  (id: tech)
//  Reception, öppet kontorslandskap, serverrum och mötesrum bakom glas,
//  pentry med kaffemaskin och bordsfotboll.
// ═══════════════════════════════════════════

const TECH_W = 24, TECH_H = 16;
const techGrid = (() => {
    const g = mkGrid(TECH_W, TECH_H, 11);
    // mötesrummet uppe till vänster (glasvägg österut och söderut, dörr mot korridoren)
    g.rect(8, 1, 1, 6, '4').rect(1, 6, 7, 1, '4').set(8, 3, '+').set(8, 4, '+');
    g.rect(3, 2, 3, 2, '5');
    for (const [x, y] of [[2, 2], [2, 3], [6, 2], [6, 3], [3, 4], [4, 4], [5, 4]]) g.set(x, y, 'h');
    g.set(1, 5, 'x');
    // serverrummet uppe till höger
    g.rect(16, 1, 1, 5, '4').rect(17, 5, 6, 1, '4').set(16, 2, '+').set(16, 3, '+');
    g.rect(17, 1, 6, 1, '3').rect(17, 4, 6, 1, '3');
    // pentry och bordsfotboll i korridoren
    g.rect(10, 1, 5, 1, '6').set(9, 1, 'x').set(15, 1, 'x');
    g.rect(11, 4, 3, 1, '7');
    // skrivbord: två pods per vinge, två rader
    for (const x of [2, 5, 17, 20]) for (const y of [8, 12]) g.rect(x, y, 2, 1, '2');
    // receptionen: logoväggen, personalen bakom disken, växter i ändarna
    g.rect(9, 8, 6, 1, '9').rect(9, 10, 6, 1, '1').set(8, 9, 'x').set(15, 9, 'x').set(15, 3, '8').set(15, 4, '8');
    g.set(1, 14, 'x').set(22, 14, 'x').set(7, 14, 'x').set(16, 14, 'x').set(1, 7, 'x').set(22, 7, 'x');
    return g;
})();

const TECH_QUEUE = [368, 396, 424, 452].map(y => ({ x: 384, y }));

const TECH_DEF = {
    id: 'tech', name: 'KimIT Tech AB', theme: 'biz-tech', w: TECH_W, h: TECH_H,
    rows: techGrid.rows(),
    legend: {
        '1': { name: 'receptionsdisk', solid: true }, '2': { name: 'skrivbord', solid: true }, '3': { name: 'serverrack', solid: true },
        '4': { name: 'glasvägg', solid: true }, '5': { name: 'mötesbord', solid: true }, '6': { name: 'pentrydisk', solid: true },
        '7': { name: 'bordsfotboll', solid: true }, '8': { name: 'sittsäck', solid: true }, '9': { name: 'logovägg', solid: true },
        h: { name: 'stol', solid: true }, x: { name: 'växt', solid: true }
    },
    spawn: { x: 384, y: tc(13) },
    exit: { x: 384, y: 15 * TS + 20, r: 22 },
    door: { x: 384, y: tc(14) },
    counter: { x: 384, y: 10 * TS + 10 },
    queue: TECH_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Receptionen: ägande, intäkter, tjänster', x: 384, y: 11 * TS + 8, r: 64 }],
    music: null,
    zones: [
        { x: 9, y: 9, w: 6, h: 1, kind: 'staff' },
        { x: 1, y: 1, w: 7, h: 5, kind: 'meeting' },
        { x: 17, y: 1, w: 6, h: 4, kind: 'server' },
        { x: 9, y: 11, w: 6, h: 4, kind: 'lobby' },
        { x: 9, y: 1, w: 7, h: 3, kind: 'kitchen' }
    ]
};

// skrivbordens chefer: de lägre raderna (ty>=10) har stolen norr om bordet
const deskDev = ty => (ty < 10 ? 1 : -1);

// ── Måla ──
const TECH_PAL = { wall: '#1b2434', face: '#2d3a54', hi: '#4a5d84', line: '#090d15' };

function techFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (zone === 'meeting') {
        // ljust trägolv
        for (let i = 0; i < 4; i++) { box(g, x, y + i * 8, TS, 8, ['#8a6c4a', '#826545', '#8f7250', '#7c6041'][(h >> (i * 2)) & 3]); box(g, x, y + i * 8 + 7, TS, 1, 'rgba(0,0,0,0.28)'); }
        const j = (h >> 4) % 28 + 2; box(g, x + j, y + ((h >> 9) & 3) * 8, 1, 7, 'rgba(0,0,0,0.3)');
        return;
    }
    if (zone === 'server') {
        box(g, x, y, TS, TS, '#161d29');
        g.fillStyle = 'rgba(80,200,255,0.1)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 4 + i * 8, y + 4 + j * 8, 3, 3);
        g.strokeStyle = 'rgba(60,160,220,0.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    if (zone === 'staff') { box(g, x, y, TS, TS, '#a9b2c2'); g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS); return; }
    if (zone === 'lobby' || ch === 'e') {
        // ljus polerad betong med fogar
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#b3bccb' : '#aab4c4');
        g.strokeStyle = 'rgba(40,60,90,0.28)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x + 3, y + 22); g.lineTo(x + 21, y + 3); g.lineTo(x + 28, y + 3); g.lineTo(x + 3, y + 28); g.fill();
        if (ch === 'e') box(g, x, y, TS, TS, '#1a2234');
        return;
    }
    if (zone === 'kitchen') {
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#c5ccd8' : '#b6bfcd');
        g.strokeStyle = 'rgba(40,60,90,0.25)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    // kontorsmatta: blågrå plattor
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#3b4960' : '#38455b');
    g.fillStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TS, 1);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 4; i++) g.fillRect(x + i * 8, y, 1, TS);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

function officeChair(g, cx, cy, dir, col) {
    g.save(); g.translate(cx, cy);
    softShadow(g, 0, 0, 10, 10, 0.3);
    g.rotate(dir); // dir = åt vilket håll ryggstödet ligger (bort från bordet)
    g.fillStyle = '#10151e'; for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * TAU / 5); g.fillRect(0, -1, 11, 2); g.restore(); }
    disc(g, 0, 0, 8.4, '#0d1118'); disc(g, 0, 0, 7.4, col);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(0, 0, 7.4, PI * 1.1, PI * 1.6); g.lineTo(0, 0); g.fill();
    g.fillStyle = '#0d1118'; rr(g, 6, -8, 4.4, 16, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(6.4, -8, 1, 16);
    g.restore();
}

const screenCache = new WeakMap();
function techDeskScreens(def) {
    let out = screenCache.get(def);
    if (out) return out;
    out = []; screenCache.set(def, out);
    const l = tilesOf(def, '2');
    for (let i = 0; i < l.length; i += 2) {
        const tx = l[i], ty = l[i + 1], x = tx * TS, y = ty * TS, f = deskDev(ty);
        out.push({ x: x + 5, y: f > 0 ? y + 3 : y + 16, w: 22, h: 13, tx, ty, ph: tileHash(tx, ty) });
    }
    return out;
}

function paintTech(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') techFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, TECH_PAL);
    aoPass(g, def);
    techMeeting(g, def);
    techServer(g, def);
    techKitchen(g, def);
    techOffice(g, def);
    techReception(g, def);
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // väggdekor: kanban-tavla och skärm på sidoväggarna
    techWallArt(g, def);
    // skyltar
    neonLine(g, [[40, 27], [5 * TS, 27]], '#a78bfa', 2.2);
    neonLine(g, [[19 * TS, 27], [23 * TS - 6, 27]], '#38bdf8', 2.2);
    signPlate(g, 'KIMIT TECH AB', 384, 17, 214, 24, 14, '#c9b8ff', '#8b5cf6');
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('💻', 262, 17); g.fillText('🚀', 506, 17);
    exitSign(g, 8 * TS + 4, 15 * TS + 10);
    // ingångsdörr: glasdörrar med kontorets logotyp
    const dx = 11 * TS, dy = 15 * TS;
    box(g, dx, dy, 2 * TS, TS, '#0c121e'); box(g, dx, dy + 18, 2 * TS, 14, '#1b2740'); box(g, dx, dy + 26, 2 * TS, 6, '#2d4270');
    box(g, dx - 2, dy + 1, 4, 17, '#9aa8bd'); box(g, dx + 2 * TS - 2, dy + 1, 4, 17, '#9aa8bd');
    box(g, dx - 1, dy + 2, 2, 15, 'rgba(180,220,255,0.5)'); box(g, dx + 2 * TS - 1, dy + 2, 2, 15, 'rgba(180,220,255,0.5)');
}

function techMeeting(g, def) {
    // glasväggen (tecken 4) och glasdörren (+)
    const glassDef = (tx, ty, horizontal) => {
        const x = tx * TS, y = ty * TS;
        if (horizontal) {
            box(g, x, y + 12, TS, 8, 'rgba(150,210,255,0.28)'); box(g, x, y + 11, TS, 1.6, '#9db4d0'); box(g, x, y + 19, TS, 1.6, '#9db4d0');
            g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x + 4, y + 19); g.lineTo(x + 12, y + 12); g.lineTo(x + 16, y + 12); g.lineTo(x + 8, y + 19); g.fill();
        } else {
            box(g, x + 12, y, 8, TS, 'rgba(150,210,255,0.28)'); box(g, x + 11, y, 1.6, TS, '#9db4d0'); box(g, x + 19, y, 1.6, TS, '#9db4d0');
            g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x + 12, y + 4); g.lineTo(x + 19, y + 12); g.lineTo(x + 19, y + 16); g.lineTo(x + 12, y + 8); g.fill();
        }
    };
    eachTile(def, '4', (tx, ty) => {
        const v = chAt(def, tx, ty - 1) === '4' || chAt(def, tx, ty + 1) === '4';
        const hz = chAt(def, tx - 1, ty) === '4' || chAt(def, tx + 1, ty) === '4';
        if (v && !hz) glassDef(tx, ty, false); else if (hz && !v) glassDef(tx, ty, true);
        else { glassDef(tx, ty, false); glassDef(tx, ty, true); }
        if (v && hz) { glassDef(tx, ty, false); glassDef(tx, ty, true); }
    });
    // glasdörr: ram och handtag (öppningen är gångbar)
    for (const [tx, ty] of [[8, 3], [8, 4]]) {
        const x = tx * TS, y = ty * TS;
        box(g, x + 10, y, 12, TS, 'rgba(150,210,255,0.12)');
        box(g, x + 9, y, 1.5, TS, '#9db4d0'); box(g, x + 21.5, y, 1.5, TS, '#9db4d0');
    }
    box(g, 8 * TS + 14, 3 * TS + 2, 4, 5, '#d4d8de');
    // mötesbordet
    slabGroup(g, def, '5', { side: '#3a2a1a', top: '#a8825a', hi: 'rgba(255,235,200,0.4)', ins: 3 });
    for (const [x, y] of [[102, 70], [132, 70], [160, 98], [106, 100]]) { box(g, x, y, 17, 11, '#e5e7eb'); box(g, x + 1, y + 1, 15, 9, '#cbd5e1'); box(g, x + 2, y + 6, 13, 1, '#94a3b8'); }
    disc(g, 144, 96, 4, '#f8fafc'); disc(g, 144, 96, 2.4, '#5b3a1a'); disc(g, 118, 108, 3.4, '#f8fafc'); disc(g, 118, 108, 2, '#5b3a1a');
    box(g, 150, 78, 8, 14, '#111827'); box(g, 151, 79, 6, 10, '#38bdf8');
    // stolar
    eachTile(def, 'h', (tx, ty) => {
        const dir = chAt(def, tx + 1, ty) === '5' ? PI : chAt(def, tx - 1, ty) === '5' ? 0 : chAt(def, tx, ty - 1) === '5' ? PI / 2 : -PI / 2;
        officeChair(g, tc(tx), tc(ty), dir, '#2563eb');
    });
    // whiteboard på norra väggen: skiss med pilar och postit
    plate(g, 2 * TS + 4, 5, 124, 24, 3, '#e2e8f0', '#64748b', 1.4);
    g.strokeStyle = '#2563eb'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(80, 12); g.lineTo(100, 12); g.lineTo(100, 22); g.lineTo(122, 22); g.stroke();
    g.strokeStyle = '#dc2626'; g.beginPath(); g.moveTo(130, 10); g.lineTo(160, 10); g.moveTo(130, 15); g.lineTo(150, 15); g.stroke();
    box(g, 84, 18, 8, 7, '#fde047'); box(g, 164, 11, 8, 7, '#fb7185'); disc(g, 108, 17, 3, 'rgba(34,197,94,0.8)');
    box(g, 2 * TS + 4, 28, 124, 3, '#94a3b8');
    // skärm på vänstra väggen
    box(g, 22, 2 * TS + 6, 9, 3 * TS - 12, '#05070b'); box(g, 25, 2 * TS + 9, 5, 3 * TS - 18, '#1d4ed8'); box(g, 25, 2 * TS + 9, 5, 3 * TS - 18, 'rgba(255,255,255,0.1)');
}

function techServer(g, def) {
    // racken: svart skåp med fläktar uppifrån och lampor mot gången
    eachTile(def, '3', (tx, ty) => {
        const x = tx * TS, y = ty * TS, up = ty < 3;
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#070a10'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#161c28'); box(g, x + 2, y + 2, TS - 4, 2, 'rgba(160,200,255,0.2)');
        disc(g, x + 10, y + (up ? 12 : 22), 5.2, '#05070b'); disc(g, x + 22, y + (up ? 12 : 22), 5.2, '#05070b');
        g.strokeStyle = 'rgba(120,180,255,0.35)'; g.lineWidth = 0.8;
        for (const cx of [x + 10, x + 22]) { g.beginPath(); g.arc(cx, y + (up ? 12 : 22), 3.4, 0, TAU); g.moveTo(cx - 3.4, y + (up ? 12 : 22)); g.lineTo(cx + 3.4, y + (up ? 12 : 22)); g.stroke(); }
        box(g, x + 4, up ? y + TS - 8 : y + 3, TS - 8, 5, '#0a0e16');
    });
    // kabelrännor och glödande golvlist
    neonLine(g, [[17 * TS + 6, 3 * TS + 2], [23 * TS - 6, 3 * TS + 2]], '#22d3ee', 1.6);
    box(g, 17 * TS, 2 * TS + 14, 6 * TS, 4, 'rgba(34,211,238,0.12)');
    // skylt på glaset
    g.save(); g.translate(16 * TS + 16, 4.5 * TS); g.rotate(PI / 2);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = 'rgba(190,230,255,0.75)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SERVERRUM', 0, 0);
    g.restore();
}

function techKitchen(g, def) {
    slabGroup(g, def, '6', { side: '#2a3342', top: '#d8dee8', hi: 'rgba(255,255,255,0.6)', ins: 2 });
    // kaffemaskin (x 10..11), mikro, diskho, fruktskål
    const y = TS;
    box(g, 10 * TS + 4, y + 5, 22, 20, '#1f2937'); box(g, 10 * TS + 6, y + 7, 18, 7, '#cbd5e1'); box(g, 10 * TS + 8, y + 15, 14, 7, '#0b0f17');
    disc(g, 10 * TS + 15, y + 19, 2.6, '#f8fafc'); disc(g, 10 * TS + 15, y + 19, 1.5, '#5b3a1a');
    box(g, 10 * TS + 26, y + 6, 6, 4, '#ef4444');
    box(g, 11 * TS + 30 - 8, y + 6, 24, 18, '#9aa3b2'); box(g, 11 * TS + 24, y + 8, 14, 14, '#0e1118'); box(g, 11 * TS + 24, y + 8, 14, 14, 'rgba(120,200,255,0.2)');
    box(g, 12 * TS + 5, y + 6, 24, 20, '#aab3c2'); box(g, 12 * TS + 8, y + 9, 18, 14, '#7b8798'); disc(g, 12 * TS + 17, y + 16, 2, '#cbd5e1');
    disc(g, 13 * TS + 11, y + 15, 7, '#e5e7eb'); disc(g, 13 * TS + 11, y + 15, 5.4, '#b45309');
    for (const [dx, dy, c] of [[-2, -2, '#dc2626'], [2, 1, '#facc15'], [-1, 3, '#16a34a'], [3, -3, '#dc2626']]) disc(g, 13 * TS + 11 + dx, y + 15 + dy, 1.8, c);
    for (let i = 0; i < 3; i++) { disc(g, 14 * TS + 6 + i * 8, y + 22, 2.6, ['#f8fafc', '#38bdf8', '#fb7185'][i]); disc(g, 14 * TS + 6 + i * 8, y + 22, 1.5, '#5b3a1a'); }
    // bordsfotboll
    const fx = 11 * TS, fy = 4 * TS, fw = 3 * TS;
    softShadow(g, fx + fw / 2, fy + 16, fw / 2, 15, 0.3);
    box(g, fx, fy, fw, TS, '#101620'); box(g, fx + 2, fy + 2, fw - 4, TS - 4, '#15803d');
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.strokeRect(fx + 5.5, fy + 5.5, fw - 11, TS - 11); g.beginPath(); g.moveTo(fx + fw / 2, fy + 5); g.lineTo(fx + fw / 2, fy + TS - 5); g.stroke();
    g.beginPath(); g.arc(fx + fw / 2, fy + 16, 5, 0, TAU); g.stroke();
    box(g, fx - 3, fy + 12, 5, 8, '#1f2937'); box(g, fx + fw - 2, fy + 12, 5, 8, '#1f2937');
    // sittsäcksgrupp nere vid bordsfotbollen
    eachTile(def, '8', (tx, ty) => {
        const bx = tc(tx), by = tc(ty), c = ty === 3 ? '#f97316' : '#0ea5e9';
        softShadow(g, bx, by, 14, 13, 0.3); disc(g, bx, by, 13.4, c); disc(g, bx - 2.5, by - 2.5, 9, 'rgba(255,255,255,0.2)');
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.beginPath(); g.arc(bx, by, 13.4, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(bx - 8, by + 4); g.quadraticCurveTo(bx, by + 9, bx + 8, by + 4); g.stroke();
    });
}

function techOffice(g, def) {
    // stolar först (under borden), alla platser
    for (const s of techDeskScreens(def)) {
        const f = deskDev(s.ty);
        officeChair(g, tc(s.tx), tc(s.ty + f), f > 0 ? PI / 2 : -PI / 2, ['#334155', '#475569', '#6d28d9', '#0e7490'][s.ph & 3]);
    }
    slabGroup(g, def, '2', { side: '#394257', top: '#dfe4ec', hi: 'rgba(255,255,255,0.7)', ins: 2 });
    for (const s of techDeskScreens(def)) {
        const f = deskDev(s.ty), x = s.tx * TS, y = s.ty * TS;
        // skärm med ram och fot; innehållet ritas i dyn
        box(g, s.x - 1, s.y - 1, s.w + 2, s.h + 2, '#0a0d14');
        box(g, s.x, s.y, s.w, s.h, '#0b1220');
        box(g, x + 13, f > 0 ? y + 16 : y + 14, 6, 2, '#4b5563');
        // tangentbord och mus
        const ky = f > 0 ? y + 20 : y + 7;
        box(g, x + 7, ky, 15, 5, '#1f2937'); box(g, x + 8, ky + 1, 13, 1, '#4b5563'); box(g, x + 8, ky + 3, 13, 1, '#4b5563'); box(g, x + 24, ky, 3, 5, '#374151');
        // mugg eller liten växt på varannat bord
        const h = s.ph;
        if (h % 3 === 0) { disc(g, x + 4, f > 0 ? y + 23 : y + 9, 2.8, '#f8fafc'); disc(g, x + 4, f > 0 ? y + 23 : y + 9, 1.7, '#5b3a1a'); }
        else if (h % 3 === 1) { disc(g, x + 28, f > 0 ? y + 8 : y + 24, 3, '#16a34a'); disc(g, x + 28, f > 0 ? y + 8 : y + 24, 1.6, '#4ade80'); }
    }
}

function techReception(g, def) {
    // logoväggen bakom receptionisten
    const x = 9 * TS, y = 8 * TS, w = 6 * TS;
    softShadow(g, x + w / 2, y + 16, w / 2, 14, 0.3);
    box(g, x, y, w, TS, '#0b0f1a'); box(g, x + 2, y + 2, w - 4, TS - 4, '#161a2e');
    g.fillStyle = 'rgba(139,92,246,0.14)'; g.fillRect(x + 2, y + 2, w - 4, TS - 4);
    neonText(g, 'KimIT', x + w / 2 - 8, y + 16, 19, '#d8c8ff', '#8b5cf6');
    g.font = `15px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚀', x + w - 24, y + 17);
    // receptionsdisken
    slabGroup(g, def, '1', { side: '#2a3342', top: '#e7ebf2', hi: 'rgba(255,255,255,0.85)', ins: 3 });
    const dy = 10 * TS;
    // skärm, telefon, klocka och kontraktsbunt på disken
    box(g, x + 14, dy + 6, 22, 15, '#0a0d14'); box(g, x + 15, dy + 7, 20, 11, '#3b82f6'); box(g, x + 15, dy + 7, 20, 3, 'rgba(255,255,255,0.4)');
    box(g, x + 70, dy + 8, 15, 11, '#1f2937'); box(g, x + 72, dy + 10, 11, 7, '#64748b');
    disc(g, x + 104, dy + 14, 5, '#cbd5e1'); disc(g, x + 104, dy + 14, 2.4, '#f59e0b');
    box(g, x + 128, dy + 8, 17, 13, '#f8fafc'); box(g, x + 130, dy + 10, 13, 1.4, '#94a3b8'); box(g, x + 130, dy + 13, 13, 1.4, '#94a3b8'); box(g, x + 130, dy + 16, 9, 1.4, '#94a3b8');
    box(g, x + 154, dy + 7, 4, 17, '#6d28d9');
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = 'rgba(80,60,160,0.8)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KONTRAKT', x + 100, dy + 26);
}

function techWallArt(g, def) {
    // kanban på vänstra väggen (x 0..32, y 8..13 rader)
    const x = 5, y0 = 8 * TS + 3, hh = 5 * TS - 6;
    box(g, x, y0, 22, hh, '#cbd5e1'); box(g, x + 1, y0 + 1, 20, hh - 2, '#f1f5f9');
    for (let c = 0; c < 3; c++) {
        box(g, x + 1 + c * 7, y0 + 1, 0.8, hh - 2, '#94a3b8');
        for (let i = 0; i < 5 - c; i++) box(g, x + 2 + c * 7, y0 + 4 + i * 9 + c * 3, 5, 6, ['#fde047', '#fb7185', '#7dd3fc', '#86efac'][(c + i) & 3]);
    }
    // stor skärm på högra väggen: diagram
    const rx = 23 * TS + 4, ry = 8 * TS + 6, rh = 5 * TS - 12;
    box(g, rx, ry, 24, rh, '#05070b'); box(g, rx + 1.5, ry + 1.5, 21, rh - 3, '#0f2a4a');
    g.fillStyle = 'rgba(56,189,248,0.4)'; for (let i = 0; i < 7; i++) g.fillRect(rx + 4 + (i % 2) * 9, ry + 6 + i * 20, 5 + (i * 7) % 8, 12);
}

// ── Rörligt ──
const CODE_COLS = ['#7dd3fc', '#86efac', '#fda4af', '#fcd34d', '#c4b5fd', '#e2e8f0'];

function dynTech(ctx, state, v, t) {
    const def = state.def;
    // kodrader som rullar på skärmarna
    const scr = techDeskScreens(def);
    for (const s of scr) {
        if (!inView(v, s.x + s.w / 2, s.y + s.h / 2, 30)) continue;
        const lit = (s.ph >> 5) % 5 !== 0; // en av fem skärmar står på skärmsläckare
        if (!lit) {
            ctx.fillStyle = `rgba(80,140,255,${0.25 + 0.2 * Math.sin(t * 1.5 + s.ph)})`;
            ctx.fillRect(s.x + 2, s.y + 2, s.w - 4, s.h - 4);
            continue;
        }
        const off = (t * (3 + (s.ph % 4)) + s.ph) % 4;
        for (let k = -1; k < 4; k++) {
            const y = s.y + 1.5 + k * 4 - off;
            const y0 = Math.max(s.y + 1, y), y1 = Math.min(s.y + s.h - 1, y + 2);
            if (y1 <= y0) continue;
            const hh = tileHash(s.ph + k + Math.floor((t * (3 + (s.ph % 4)) + s.ph) / 4) * 7, 3);
            ctx.fillStyle = CODE_COLS[hh % CODE_COLS.length];
            ctx.globalAlpha = 0.85;
            const indent = (hh >> 3) % 3 * 3, len = 5 + (hh >> 6) % (s.w - 8 - indent);
            ctx.fillRect(s.x + 2 + indent, y0, len, y1 - y0);
        }
        ctx.globalAlpha = 1;
        if (Math.floor(t * 2 + s.ph) % 2 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x + s.w - 5, s.y + s.h - 4, 2, 2.4); }
    }
    // serverrackens lampor
    const rk = tilesOf(def, '3');
    for (let i = 0; i < rk.length; i += 2) {
        const tx = rk[i], ty = rk[i + 1], x = tx * TS, y = ty * TS, up = ty < 3;
        if (!inView(v, x + 16, y + 16, 24)) continue;
        for (let k = 0; k < 6; k++) {
            const h = tileHash(tx * 7 + k, ty), f = 1.5 + (h % 5) * 1.3;
            const on = Math.sin(t * f + h) > -0.3;
            const col = (h >> 4) % 11 === 0 ? '#f43f5e' : (h >> 3) % 4 === 0 ? '#fbbf24' : '#4ade80';
            ctx.fillStyle = on ? col : 'rgba(20,40,30,0.9)';
            ctx.fillRect(x + 5 + k * 4.2, up ? y + TS - 6 : y + 4.6, 2.4, 2.4);
        }
    }
    // kaffemaskinen ångar och lampan blinkar
    for (let i = 0; i < 3; i++) {
        const k = (t * 0.5 + i / 3) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.32 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(10 * TS + 15 + Math.sin(t * 3 + i) * 2, TS + 12 - k * 12, 2 + k * 2.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = Math.floor(t * 1.4) % 2 ? '#4ade80' : '#14532d'; ctx.fillRect(10 * TS + 26, TS + 6, 6, 4);
    // bordsfotboll: stänger sladdar och bollen rullar
    const fx = 11 * TS, fy = 4 * TS;
    for (let i = 0; i < 4; i++) {
        const off = Math.sin(t * (1.7 + i * 0.5) + i) * 4, rx = fx + 10 + i * 24;
        ctx.fillStyle = '#d1d5db'; ctx.fillRect(rx - 1.2, fy + 3, 2.4, TS - 6);
        ctx.fillStyle = i & 1 ? '#ef4444' : '#2563eb';
        ctx.fillRect(rx - 3, fy + 8 + off, 6, 3.4); ctx.fillRect(rx - 3, fy + 20 + off * 0.6, 6, 3.4);
    }
    disc(ctx, fx + 48 + Math.sin(t * 1.1) * 28, fy + 16 + Math.sin(t * 2.3) * 6, 2.3, '#fafafa');
    // loggan flimrar
    const f = (t * 0.23) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.062)) { ctx.fillStyle = 'rgba(11,15,26,0.7)'; rr(ctx, 9 * TS + 20, 8 * TS + 4, 6 * TS - 40, 24, 4); ctx.fill(); }
    // mötesrummets skärm byter bild
    const slide = Math.floor(t / 3.5) % 3;
    ctx.fillStyle = ['#38bdf8', '#a78bfa', '#4ade80'][slide]; ctx.globalAlpha = 0.5;
    ctx.fillRect(25, 2 * TS + 12 + (slide * 8) % 24, 5, 8); ctx.globalAlpha = 1;
    exitArrow(ctx, def, t);
}

const TECH_GLOWS = [
    [384, 24, 170, '#8b5cf6', 0.26, 0],
    [128, 100, 150, '#cfe8ff', 0.09, 0],
    [660, 90, 170, '#22d3ee', 0.2, 1.8],
    [384, 100, 150, '#ffb347', 0.12, 0],
    [384, 280, 160, '#a855f7', 0.2, 2.4],
    [384, 200, 200, '#cfe8ff', 0.06, 0],
    [384, 440, 130, '#9cc3ff', 0.18, 0],
    [128, 330, 150, '#cfe8ff', 0.05, 0],
    [640, 330, 150, '#cfe8ff', 0.05, 0]
];
function lightsTech(ctx, state, v, t, glow) {
    for (const s of techDeskScreens(state.def)) glow(s.x + s.w / 2, s.y + s.h / 2, 26, '#60a5fa', 0.1 + 0.03 * Math.sin(t * 2 + s.ph));
}

// ── Folk ──
const TECH_LINES = {
    receptionist: ['Välkommen till KimIT!', 'Har ni en bokning?', 'Kontraktet ligger här.', 'Ett ögonblick.'],
    dev: ['Det funkar på min dator.', 'Merge conflict...', 'Mer kaffe.', 'git push --force!', 'Det är en feature.'],
    sysadmin: ['Servern surrar fint.', 'Inget är nere. Än.', 'Starta om den.'],
    client: ['Spännande projekt!', 'Vart skriver jag på?', 'Rocket fuel, sa du?']
};
const TECH_SUITS = ['#1f2937', '#111827', '#334155', '#1e293b', '#3f3f46', '#0f172a', '#1e3a5f', '#3b0764'];
const techLook = rnd => look(rnd, TECH_SUITS, { dress: 0.35, dressCols: ['#7c3aed', '#0f766e', '#be123c', '#1d4ed8', '#334155'] });

// platser: sitter vid mötesbordet (sx/sy = stol, fx/fy = ledig ruta framför)
const TECH_MEET = [seat(2, 2, 1, 2, 0), seat(2, 3, 1, 3, 0), seat(6, 2, 7, 2, PI), seat(6, 3, 7, 3, PI), seat(3, 4, 3, 5, -PI / 2), seat(4, 4, 4, 5, -PI / 2), seat(5, 4, 5, 5, -PI / 2)];
const TECH_COFFEE = { x: 12 * TS + 16, y: 2 * TS + 14 };

function techClient(rnd, from) {
    const stages = [{ k: 'queue' }];
    if (rnd() < 0.3) stages.push({ k: 'visit', x: TECH_COFFEE.x + (rnd() < 0.5 ? -32 : 32), y: TECH_COFFEE.y, a: -PI / 2, pose: 'idle', t: [3, 6], prop: 'cup', say: 'Kaffe, tack.' });
    stages.push({ k: 'sit', opts: TECH_MEET, t: [12, 24], prop: null });
    stages.push(...leaveStages(TECH_DEF));
    const prop = pick(rnd, ['case', 'case', 'tablet', null, 'phone']);
    const n = actor('client', from.x, from.y, rnd, { look: techLook(rnd), stages, speed: rand(rnd, 40, 48), lines: TECH_LINES.client, angle: -PI / 2, prop });
    return n;
}

function populateTech(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    add(staffAt('receptionist', rnd, pop, [V(tc(11), tc(9), PI / 2, 'work', 7, 14), V(tc(13), tc(9), PI / 2, 'work', 6, 12)], { watch: true, lines: TECH_LINES.receptionist, look: { shirt: '#7c3aed', skin: '#e0ac69', hair: '#7c2d12', dress: '#7c3aed' } }));
    // utvecklarna vid sina skrivbord (tx, ty = stolens ruta)
    const seatsDev = [[2, 9], [6, 9], [3, 11], [5, 11], [17, 9], [21, 9], [18, 11], [20, 11]];
    const HOODIES = ['#e11d48', '#f97316', '#22c55e', '#0ea5e9', '#a855f7', '#eab308', '#14b8a6', '#64748b'];
    seatsDev.forEach(([tx, ty], i) => {
        const a = ty < 10 ? -PI / 2 : PI / 2, px = tc(tx), py = tc(ty);
        const stages = [V(px, py, a, 'work', 28, 60)];
        if (i % 3 === 0) stages.push(V(TECH_COFFEE.x + (i % 2 ? 32 : -32), TECH_COFFEE.y, -PI / 2, 'idle', 3, 6, { prop: 'cup', say: 'Kaffe...' }), V(px, py, a, 'work', 25, 50, { prop: null }));
        if (i % 4 === 1) stages.push(V(12 * TS + (i % 2 ? 6 : 26), 3 * TS + 10, PI / 2, 'work', 9, 15), V(px, py, a, 'work', 25, 45));
        if (i % 4 === 2) stages.push(V(12 * TS + 16, 5 * TS + 18, -PI / 2, 'work', 9, 15), V(px, py, a, 'work', 25, 45));
        add(staffAt('dev', rnd, pop, stages, { lines: TECH_LINES.dev, look: { shirt: HOODIES[i], skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS), cap: i === 3 ? '#0f172a' : undefined } }));
    });
    // mötet: presentatör vid whiteboarden, två som sitter
    add(staffAt('dev', rnd, pop, [V(tc(4), tc(1), -PI / 2, 'work', 18, 30), V(tc(5) + 8, tc(1), -PI / 2, 'work', 10, 20)], { order: 'seq', look: { shirt: '#1d4ed8', skin: '#c68642', hair: '#111111' }, lines: TECH_LINES.dev, prop: 'clip' }));
    for (const [i, c] of [[0, TECH_MEET[3]], [1, TECH_MEET[5]]]) {
        add(staffAt('dev', rnd, pop, [{ k: 'sit', opts: [c], t: [26, 50], prop: i ? 'tablet' : null }, V(tc(i ? 20 : 3), tc(i ? 9 : 9), -PI / 2, 'work', 25, 50, { prop: null })], { look: { shirt: i ? '#0ea5e9' : '#f97316', skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) } }));
    }
    // sysadmin i serverrummet
    add(staffAt('sysadmin', rnd, pop, [V(tc(18), tc(2), -PI / 2, 'work', 6, 12), V(tc(21), tc(3), PI / 2, 'work', 6, 12), V(tc(19), tc(3), PI / 2, 'work', 5, 9), V(tc(21), tc(2), -PI / 2, 'work', 5, 9)], { order: 'rand', lines: TECH_LINES.sysadmin, look: { shirt: '#334155', skin: '#e0ac69', hair: '#d6d3d1', cap: '#0ea5e9' }, prop: 'tablet' }));
    // kunder mitt i sin runda
    add(dropIn(techClient(rnd, TECH_QUEUE[0]), 0, rnd, pop));
    add(dropIn(techClient(rnd, TECH_QUEUE[1]), 0, rnd, pop));
    for (let i = 0; i < 2; i++) {
        const c = techClient(rnd, def.door), si = c.c.stages.findIndex(s => s.k === 'sit');
        add(dropIn(c, si, rnd, pop));
    }
    const cf = techClient(rnd, def.door);
    cf.c.stages.splice(1, 0, { k: 'visit', x: TECH_COFFEE.x + 32, y: TECH_COFFEE.y, a: -PI / 2, pose: 'idle', t: [3, 6], prop: 'cup' });
    add(dropIn(cf, 1, rnd, pop));
    return npcs;
}

const TECH_SPEC = {
    iv: [6, 11], max: 7, hooks: null,
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return techClient(rnd, state.def.door);
    }
};

registerInterior(TECH_DEF, {
    populate: (def, rnd) => populateTech(def, rnd),
    update: (state, dt, rnd) => bizUpdate(TECH_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(TECH_SPEC, n, state, dt, rnd),
    paint: paintTech,
    dyn: dynTech,
    accessory: accessoryB,
    glows: TECH_GLOWS,
    lights: lightsTech
});
