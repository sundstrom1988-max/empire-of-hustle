// ═══════════════════════════════════════════
//  STAN — kameralägen (ren logik, ingen DOM)
//  FÖRSTAPERSON ('fps'), FÖLJKAMERA ('chase') och
//  ÖVERBLICK ('top'): valet, zoomstegen, det som
//  sparas, blicken och hur joysticken räknas om.
//  index.js kopplar ihop det med input, världen
//  och 3D-renderaren. Kamerabyte ändrar bara hur
//  stan visas — aldrig räckvidder, träffregler
//  eller var man står.
//  Testas i tests/camera.test.js.
// ═══════════════════════════════════════════

import { distToVehicle } from './physics.js';
import { ITEM_TYPES } from './items.js';
import { bannedFor } from './brawl.js';

// ── Lägen ──
export const CAM_MODES = ['fps', 'chase', 'top'];          // V/C/🔍 går i den här ordningen
export const CAM_NAMES = { fps: 'FÖRSTAPERSON', chase: 'FÖLJKAMERA', top: 'ÖVERBLICK' };
export const CAM_ICONS = { fps: '👁️', chase: '🎥', top: '🗺️' };
export const DEFAULT_CAM = 'chase';
export const is3D = cam => cam === 'fps' || cam === 'chase';
export const nextCam = cam => CAM_MODES[(Math.max(0, CAM_MODES.indexOf(cam)) + 1) % CAM_MODES.length];

// ── Det som sparas i webbläsaren ──
export const CAM_KEY = 'hustle_city_cam';
export const VIEW_KEY = 'hustle_city_view';
export const ZOOM_KEY = 'hustle_city_zoom';    // överblickens zoom (samma nyckel som förut)
export const CHASE_KEY = 'hustle_city_chase';  // följkamerans avstånd

// Överblick: samma tre steg som förut (index sparas). TOP_ORDER går utifrån och in.
export const TOP_ZOOMS = [
    { name: 'NORMAL', mul: 1 },
    { name: 'LÅNGT', mul: 0.66 },
    { name: 'NÄRA', mul: 1.35 }
];
export const TOP_ORDER = [1, 0, 2];
// Följkameran: avståndet som andel av grundläget (render3d/math.js CHASE), utifrån och in
export const CHASE_ZOOMS = [
    { name: 'LÅNGT', dist: 1.4 },
    { name: 'NORMAL', dist: 1 },
    { name: 'NÄRA', dist: 0.72 }
];
export const CHASE_DEFAULT = 1;

// Inställningar (pausmenyn): muskänslighet, synfält i förstaperson, kamerarörelse, inverterad Y
export const DEFAULT_VIEW = { sens: 1, fov: 75, bob: true, invertY: false };
export const SENS_RANGE = [0.2, 3];
export const FOV_RANGE = [60, 100];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;
export const wrapAngle = a => { const r = Math.atan2(Math.sin(a), Math.cos(a)); return r === -Math.PI ? Math.PI : r; };
const angleDiff = (a, b) => wrapAngle(b - a);

// store: localStorage eller något med samma getItem/setItem. Privat läge kastar — då gäller valet bara nu.
const read = (store, key) => { try { return store ? store.getItem(key) : null; } catch (e) { return null; } };
const write = (store, key, val) => { try { if (store) store.setItem(key, val); return true; } catch (e) { return false; } };

export function loadCam(store) {
    const c = read(store, CAM_KEY);
    return CAM_MODES.includes(c) ? c : DEFAULT_CAM;
}
export function saveCam(store, cam) { return CAM_MODES.includes(cam) && write(store, CAM_KEY, cam); }

export function loadIndex(store, key, n, def) {
    const raw = read(store, key);
    const i = raw === null || raw === '' ? NaN : Number(raw);
    return Number.isInteger(i) && i >= 0 && i < n ? i : def;
}
export function saveIndex(store, key, i) { return write(store, key, String(i)); }

export function sanitizeView(v) {
    const o = v && typeof v === 'object' ? v : {};
    const num = (x, [a, b], d) => (typeof x === 'number' && Number.isFinite(x) ? clamp(x, a, b) : d);
    return {
        sens: num(o.sens, SENS_RANGE, DEFAULT_VIEW.sens),
        fov: Math.round(num(o.fov, FOV_RANGE, DEFAULT_VIEW.fov)),
        bob: typeof o.bob === 'boolean' ? o.bob : DEFAULT_VIEW.bob,
        invertY: typeof o.invertY === 'boolean' ? o.invertY : DEFAULT_VIEW.invertY
    };
}
export function loadView(store) {
    try { return sanitizeView(JSON.parse(read(store, VIEW_KEY) || 'null')); } catch (e) { return { ...DEFAULT_VIEW }; }
}
export function saveView(store, v) { return write(store, VIEW_KEY, JSON.stringify(sanitizeView(v))); }

// ── Scrollhjulet: en enda kedja från längst ut till närmast ──
//  överblick LÅNGT · NORMAL · NÄRA → följkamera LÅNGT · NORMAL · NÄRA → förstaperson
//  v = { cam, top (index i TOP_ZOOMS), chase (index i CHASE_ZOOMS) }, dir: −1 = in, +1 = ut.
//  Utan 3D stannar hjulet i överblicken. Ger ett nytt objekt, eller samma om inget ändrades.
export const CHAIN_LEN = TOP_ORDER.length + CHASE_ZOOMS.length + 1;
export function chainPos(v) {
    if (v.cam === 'top') return Math.max(0, TOP_ORDER.indexOf(v.top));
    if (v.cam === 'chase') return TOP_ORDER.length + clamp(v.chase | 0, 0, CHASE_ZOOMS.length - 1);
    return CHAIN_LEN - 1;
}
export function wheelView(v, dir, can3d = true) {
    if (!dir) return v;
    const pos = chainPos(v);
    const max = can3d ? CHAIN_LEN - 1 : TOP_ORDER.length - 1;
    const next = clamp(pos - Math.sign(dir), 0, max);
    if (next === pos) return v;
    if (next < TOP_ORDER.length) return { ...v, cam: 'top', top: TOP_ORDER[next] };
    if (next < TOP_ORDER.length + CHASE_ZOOMS.length) return { ...v, cam: 'chase', chase: next - TOP_ORDER.length };
    return { ...v, cam: 'fps' };
}
// ── Nyp-zoom (touch): steglöst längs samma kedja som hjulet ──
//  En sammanhängande skala u (logaritmisk, så att samma nyp känns lika stort överallt):
//    [0, TOP_END]            överblicken, zoomMul TOP_MUL[0] → TOP_MUL[1]
//    (TOP_END, CHASE_START)  glapp: nyper man vidare stannar bilden vid NÄRA tills glappet är passerat
//    [CHASE_START, CHASE_END] följkameran, avstånd CHASE_DIST[1] → CHASE_DIST[0]
//    (CHASE_END, FPS_U)      glapp
//    FPS_U                   förstaperson
//  Glappen ger hysteres: ett läge byts först när man nypt en bit förbi gränsen, och tillbaka
//  först när man nypt hela glappet åt andra hållet — inget fladder fram och tillbaka.
export const TOP_MUL = [TOP_ZOOMS[1].mul, TOP_ZOOMS[2].mul];                 // LÅNGT … NÄRA
export const CHASE_DIST = [CHASE_ZOOMS[2].dist, CHASE_ZOOMS[0].dist];        // NÄRA … LÅNGT
export const PINCH_GAP = Math.log(1.3);       // nyp 30 % förbi gränsen för att byta läge
export const TOP_END = Math.log(TOP_MUL[1] / TOP_MUL[0]);
export const CHASE_START = TOP_END + PINCH_GAP;
export const CHASE_END = CHASE_START + Math.log(CHASE_DIST[1] / CHASE_DIST[0]);
export const FPS_U = CHASE_END + PINCH_GAP;
export const ZOOMX_KEY = 'hustle_city_zoomx';  // de steglösa värdena { top, chase }

// Läge + zoom → u (där nypet börjar)
export function pinchU(z) {
    if (z.cam === 'top') return clamp(Math.log(clamp(z.topMul, TOP_MUL[0], TOP_MUL[1]) / TOP_MUL[0]), 0, TOP_END);
    if (z.cam === 'chase') return CHASE_START + Math.log(CHASE_DIST[1] / clamp(z.chaseDist, CHASE_DIST[0], CHASE_DIST[1]));
    return FPS_U;
}
// z = { cam, topMul, chaseDist, u? }, f = nypets skalfaktor (>1 = isär = in). Ger ett nytt objekt.
export function pinchView(z, f, can3d = true) {
    if (!(f > 0) || f === 1) return z;
    const max = can3d ? FPS_U : TOP_END;
    const u = clamp((Number.isFinite(z.u) ? z.u : pinchU(z)) + Math.log(f), 0, max);
    let cam = z.cam;
    if (cam === 'top' && u >= CHASE_START) cam = u >= FPS_U ? 'fps' : 'chase';
    else if (cam === 'chase') cam = u <= TOP_END ? 'top' : u >= FPS_U ? 'fps' : 'chase';
    else if (cam === 'fps' && u <= CHASE_END) cam = u <= TOP_END ? 'top' : 'chase';
    const out = { ...z, cam, u };
    if (cam === 'top') out.topMul = TOP_MUL[0] * Math.exp(Math.min(u, TOP_END));
    else if (cam === 'chase') out.chaseDist = CHASE_DIST[1] / Math.exp(clamp(u, CHASE_START, CHASE_END) - CHASE_START);
    return out;
}
// När nypet är slut: u tillbaka till läget (ett halvt nyp i glappet sparas inte till nästa gång)
export function pinchSettle(z) { return { ...z, u: pinchU(z) }; }
// Närmaste namngivna steg (för hjulet och bannern) till ett steglöst värde
export function nearestIndex(list, key, val) {
    let best = 0, bd = Infinity;
    list.forEach((e, i) => { const d = Math.abs(Math.log(e[key] / val)); if (d < bd) { bd = d; best = i; } });
    return best;
}
export function loadZoomX(store) {
    try {
        const o = JSON.parse(read(store, ZOOMX_KEY) || 'null');
        const ok = (x, [a, b]) => typeof x === 'number' && Number.isFinite(x) && x >= a && x <= b;
        return { top: o && ok(o.top, TOP_MUL) ? o.top : null, chase: o && ok(o.chase, CHASE_DIST) ? o.chase : null };
    } catch (e) { return { top: null, chase: null }; }
}
export function saveZoomX(store, top, chase) { return write(store, ZOOMX_KEY, JSON.stringify({ top, chase })); }

// Namnet på steget (bannern): "FÖLJKAMERA · NÄRA"
export function viewLabel(v) {
    if (v.cam === 'top') return `${CAM_NAMES.top} · ${(TOP_ZOOMS[v.top] || TOP_ZOOMS[0]).name}`;
    if (v.cam === 'chase') return `${CAM_NAMES.chase} · ${(CHASE_ZOOMS[v.chase] || CHASE_ZOOMS[CHASE_DEFAULT]).name}`;
    return CAM_NAMES.fps;
}

// ── Blick med musen (pekarlås) och touch-dragning ──
export const LOOK_RAD = 0.0025;        // radianer per px musrörelse vid känslighet 1
export const TOUCH_LOOK = 1.8;         // ett finger flyttar sig mindre exakt: lite mer per px
export const PITCH_MAX = 75 * Math.PI / 180;
export function lookTurn(dx, sens = 1, touch = false) { return (dx || 0) * LOOK_RAD * sens * (touch ? TOUCH_LOOK : 1); }
// Musen uppåt (dy < 0) = titta upp (+). Bara presentation: man flyger aldrig.
export function stepPitch(pitch, dy, sens = 1, invertY = false, touch = false, max = PITCH_MAX) {
    const d = (dy || 0) * LOOK_RAD * sens * (touch ? TOUCH_LOOK : 1) * (invertY ? 1 : -1);
    return clamp((pitch || 0) + d, -max, max);
}

// ── Musen siktar i överblicken ──
//  Riktningen räknas i skärmen från spelarens ritade position (ps) mot pekaren, så att den
//  inte hoppar av kamerans eftersläp. Nära gubben (dödzonen) siktar musen inte alls: då
//  står blicken kvar i stället för att slå om 180° när man går förbi pekaren.
export const AIM_DEADZONE = 20;
export function aimPoint(mouse, ps, player, zoom, dead = AIM_DEADZONE) {
    if (!mouse || !ps || !player || !(zoom > 0)) return null;
    const dx = mouse.x - ps.x, dy = mouse.y - ps.y;
    if (!(Math.hypot(dx, dy) > dead)) return null;
    return { x: player.x + dx / zoom, y: player.y + dy / zoom };
}

// ── Hur långt bort folk och bilar skapas (world.viewExtra / world.viewDense) ──
//  Samma ring och täthet i alla kameralägen och zoomnivåer (kontraktet avsnitt 1). Att inget
//  poppar upp i bild sköter världen själv: inget skapas eller städas där spelaren ser det — fri
//  sikt i 3D, och skärmens rektangel i överblicken (world.viewBox från index.js).
export function spawnView() {
    return { extra: 0, dense: 1 };
}

// ── Tryck på minikartan (canvasens pointerdown) ──
//  Sant om trycket ska öppna/stänga stora kartan: på minikartan, eller var som helst när den
//  är uppe. Med fångad mus (3D) står clientX/Y kvar där låset togs — ett klick är då alltid
//  ett slag/skott mitt i bild (input.js), aldrig ett tryck på kartan (M öppnar den).
//  Ett nypfinger och tryck bakom en meny räknas inte.
export function mapTapToggles(rect, x, y, { locked = false, pinching = false, modal = false, showMap = false } = {}) {
    if (!rect || modal || pinching || locked) return false;
    return !!showMap || (x >= rect.x && x <= rect.x + rect.size && y >= rect.y && y <= rect.y + rect.size);
}

// ── Joysticken: skärmens riktning → världens ──
//  Överblick: upp = norr (ingen vridning). Följkamera/förstaperson: upp = rakt fram i bild
//  (kamerans yaw), höger = höger om blicken. Längden behålls.
export function stickToWorld(mx, my, cam, yaw) {
    if (cam === 'top' || !(mx || my) || !Number.isFinite(yaw)) return { mx: mx || 0, my: my || 0 };
    const f = -my, r = mx, c = Math.cos(yaw), s = Math.sin(yaw);
    return { mx: f * c - r * s, my: f * s + r * c };
}

// ── Följkamerans riktning (yaw) ──
//  turn (musen/touch) vrids in direkt; resten glider mot målet med rate per sekund.
export function followYaw(yaw, target, dt, rate, turn = 0) {
    if (!Number.isFinite(yaw)) return wrapAngle(target);
    const y = yaw + (turn || 0);
    return wrapAngle(y + angleDiff(y, target) * clamp(dt * rate, 0, 1));
}
// Hur snabbt följkameran svänger in bakom: bilen följs mjukt; till fots med mus följer den
// blicken nästan direkt. Till fots på touch svänger den ALDRIG in av sig själv: joysticken
// räknas relativt kameran, så en kamera som följer gubben gör att en tumme som håller lite
// snett (upp-höger) får gubben att gå i en stor cirkel. Där vrids kameran bara med
// titt-joysticken eller ett finger på bilden.
export function chaseRate({ car = false, touch = false, room = false } = {}) {
    if (car) return 3.2;
    if (touch) return 0;
    return room ? 9 : 10;
}

// ── Titt-joysticken (touch, höger tumme) ──
//  Utslaget ger en vridfart, inte en position: hålls den ute snurrar blicken. Kurvan gör
//  små utslag fina och fullt utslag snabbt. Svaret är "touch-px" så att samma väg som ett
//  finger på bilden används (känslighet, invertera Y, fri blick i bilen).
export const LOOK_STICK_YAW = 2.4;     // rad/s vid fullt utslag (känslighet 1)
export const LOOK_STICK_PITCH = 1.4;
const stickCurve = v => Math.sign(v) * Math.pow(Math.abs(v), 1.5);
export function lookStickDelta(stick, dt) {
    if (!stick?.active || !(stick.mag > 0) || !(dt > 0)) return { dx: 0, dy: 0 };
    const px = 1 / (LOOK_RAD * TOUCH_LOOK);
    return { dx: stickCurve(stick.x) * LOOK_STICK_YAW * dt * px, dy: stickCurve(stick.y) * LOOK_STICK_PITCH * dt * px };
}

// ── Kamerans riktning i 3D den här bildrutan ──
//  Blicken (musen) kommer varje bildruta, men gubben vrids bara i världens fasta steg (1/60 s).
//  pending = vridning som tagits emot men inte gått in i ett steg än. Den visas direkt — annars
//  står bilden still på bildrutor utan steg (90/120/144 Hz-skärmar) och rycker sedan ikapp.
//  freeYaw = fri blick i bilen. Följkameran (chase) har sin egen vinkel (camYaw, followYaw).
export function viewYaw(cam, player, camYaw, pending = 0, freeYaw = 0) {
    const v = player.vehicle;
    const own = v ? v.angle : player.angle + (pending || 0);
    if (cam === 'chase' && Number.isFinite(camYaw)) return camYaw + freeYaw;
    return own + freeYaw;
}

// Riktningen kontrollerna räknas från (joysticken, kamerans framåt). Fri blick i bilen ingår
// INTE: att titta åt sidan får aldrig ändra vart bilen kör.
export function controlYaw(cam, player, camYaw) {
    const v = player.vehicle;
    if (cam === 'fps') return v ? v.angle : player.angle;
    if (cam === 'chase') return Number.isFinite(camYaw) ? camYaw : (v ? v.angle : player.angle);
    return 0;
}

// ── Fri blick i bilen (bara presentation) ──
//  Musen/fingret vrider blicken; släpper man den fjädrar den tillbaka efter FREE_HOLD s.
export const FREE_HOLD = 1.2;
export const FREE_MAX_YAW = 2.6;       // ~150° åt varje håll
export const FREE_MAX_PITCH = 0.6;
export const FREE_RETURN = 5;          // per sekund
export function createFreeLook() { return { yaw: 0, pitch: 0, idle: 0 }; }
export function stepFreeLook(fl, dx, dy, dt, { sens = 1, invertY = false, touch = false } = {}) {
    if (dx || dy) {
        fl.yaw = clamp(fl.yaw + lookTurn(dx, sens, touch), -FREE_MAX_YAW, FREE_MAX_YAW);
        fl.pitch = stepPitch(fl.pitch, dy, sens, invertY, touch, FREE_MAX_PITCH);
        fl.idle = 0;
    } else {
        fl.idle += dt;
        if (fl.idle > FREE_HOLD) {
            const k = 1 - Math.exp(-dt * FREE_RETURN);
            fl.yaw -= fl.yaw * k; fl.pitch -= fl.pitch * k;
            if (Math.abs(fl.yaw) < 1e-3) fl.yaw = 0;
            if (Math.abs(fl.pitch) < 1e-3) fl.pitch = 0;
        }
    }
    return fl;
}
export function resetFreeLook(fl) { fl.yaw = 0; fl.pitch = 0; fl.idle = 0; return fl; }

// ── Vad E väljer just nu (samma ordning som världen: föremål, dörr, bil; inne: närmaste person) ──
//  Bara för markeringen i bild — världen avgör själv vad som händer.
//  → { kind: 'talk'|'item'|'door'|'car', x, y, z, label, shut? } eller null
export function eTarget(world) {
    const p = world.player;
    if (!p || p.dead || world.state !== 'play' || world.fade) return null;
    if (world.interior) {
        const it = world.nearInteraction;
        return it ? { kind: 'talk', x: it.x, y: it.y, z: 30, label: String(it.label || '').replace(/^E — /, '') } : null;
    }
    if (p.vehicle) return null;
    if (world.nearItem) {
        const it = world.nearItem, def = ITEM_TYPES[it.type] || { icon: '📦', label: 'Föremål' };
        return { kind: 'item', x: it.x, y: it.y, z: 8, label: `Plocka upp ${def.icon} ${def.label}` };
    }
    const car = world.nearestVehicle(p.x, p.y, 38), door = world.doorInReach(46);
    if (door && (!car || door.d - door.extra < distToVehicle(car, p.x, p.y))) {
        const at = doorSpot(world, door);
        if (at) {
            const shut = door.room ? bannedFor(world, door.room) > 0 : false;
            return { kind: 'door', x: at.x, y: at.y, z: 30, label: shut ? `${door.icon} ${door.name} — STÄNGT` : `GÅ IN · ${door.icon} ${door.name}`, shut };
        }
    }
    if (car && !car.wrecked) {
        const name = car.spec?.name || 'bilen';
        return { kind: 'car', x: car.x, y: car.y, z: 24, label: car.driver && car.driver !== 'player' ? `Sno ${name}` : `Kör ${name}`, car };
    }
    return null;
}
// Var dörren som doorInReach valde ligger (den ger bara avstånd och namn)
function doorSpot(world, door) {
    const p = world.player;
    const hit = (x, y) => Math.abs(Math.hypot(x - p.x, y - p.y) - door.d) < 1e-6;
    for (const pl of world.doors()) { const o = pl.door || pl; if (hit(o.x, o.y)) return o; }
    for (const sd of world.specialDoors()) if (hit(sd.door.x, sd.door.y)) return sd.door;
    const nc = world.nightclubPlace?.();
    if (nc && hit(nc.x, nc.y)) return nc;
    return null;
}

// ── Mätning av bildrutor: median, p90 och ryck ──
export function frameStats(ms) {
    const a = ms.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return { n: 0, median: 0, p90: 0, p99: 0, max: 0, hitches: 0 };
    const q = k => a[Math.min(a.length - 1, Math.floor(k * (a.length - 1) + 0.5))];
    const median = q(0.5);
    return { n: a.length, median, p90: q(0.9), p99: q(0.99), max: a[a.length - 1], hitches: a.filter(x => x > Math.max(34, median * 2)).length };
}

export const _test = { TAU, angleDiff };
