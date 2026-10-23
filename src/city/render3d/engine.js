// ═══════════════════════════════════════════
//  STAN 3D — motorn
//  Samma värld som 2D-renderaren, sedd i 3D:
//  'chase' (snett bakom/ovanför) eller 'fps'
//  (ögonhöjd). Laddas dynamiskt tillsammans med
//  three från ../render3d.js. THREE skickas in.
// ═══════════════════════════════════════════

import { TILE, DX, DY, GANGS } from '../constants.js';
import { VEHICLES } from '../vehicles.js';
import { SHOPS } from '../../data/gameData.js';
import { ITEM_TYPES } from '../items.js';
import { phoneAccess, gangById } from '../missions.js';
import { CREW_LOOK } from '../render.js';
import { bannedFor } from '../brawl.js';
import * as INT from '../interiors.js';
import { dayPalette, cameraSubject, chaseCamera, fpsCamera, smooth, lerp, clamp, parseColor, Pool, EYE_H } from './math.js';
import { paintFxAtlas, fxRect, FX, LabelAtlas } from './paint.js';
import { createQuadBatch } from './batch.js';
import { createActors } from './actors.js';
import { createCity3D } from './city.js';
import { createRoom3D } from './room.js';
import { createViewModel } from './viewmodel.js';

const SKY_V = /* glsl */`
varying vec3 vDir;
void main() {
    vDir = position;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w * 0.99999;
}`;
const SKY_F = /* glsl */`
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 groundC; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
varying vec3 vDir;
void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(horizon, zenith, pow(smoothstep(0.0, 0.55, h), 0.75)) : mix(horizon, groundC, smoothstep(0.0, -0.12, h));
    float s = max(dot(d, sunDir), 0.0);
    // sol på dagen, måne på natten
    float disc = smoothstep(0.9991, 0.9995, s);
    col += sunColor * (disc * mix(3.0, 1.2, night) + pow(s, 14.0) * 0.22 * (1.0 - night * 0.7) + pow(s, 3.0) * 0.06);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
}`;

const PANTS = ['#1f2937', '#273043', '#33333b', '#4b3f2f', '#1e3a5f', '#2b2b2b', '#3f3f46', '#57534e'];
const PICK_ICONS = { cash: '💰', repair: '🔧', nitro: '⚡', bribe: '👮', health: '❤️' };
const PICK_COLS = { cash: '#ffd23f', repair: '#94a3b8', nitro: '#38bdf8', bribe: '#60a5fa', health: '#ef4444' };
const MAX_LIGHTS = 4;
// Färger som återanvänds varje bildruta (inga nya arrayer per anrop)
const K_0_0_0 = [0, 0, 0];
const K_0p13_0p77_0p37 = [0.13, 0.77, 0.37];
const K_0p15_0p3_1 = [0.15, 0.3, 1];
const K_0p22_0p74_0p97 = [0.22, 0.74, 0.97];
const K_0p2_0p35_1 = [0.2, 0.35, 1];
const K_0p2_0p4_1 = [0.2, 0.4, 1];
const K_0p3_0p7_1 = [0.3, 0.7, 1];
const K_0p4_0p4_0p4 = [0.4, 0.4, 0.4];
const K_0p64_0p9_0p21 = [0.64, 0.9, 0.21];
const K_0p92_0p7_0p03 = [0.92, 0.7, 0.03];
const K_0p94_0p27_0p27 = [0.94, 0.27, 0.27];
const K_0p96_0p31_0p7 = [0.96, 0.31, 0.7];
const K_0p96_0p3_0p7 = [0.96, 0.3, 0.7];
const K_0p96_0p45_0p71 = [0.96, 0.45, 0.71];
const K_0p98_0p45_0p09 = [0.98, 0.45, 0.09];
const K_0p98_0p8_0p08 = [0.98, 0.8, 0.08];
const K_1_0p15_0p1 = [1, 0.15, 0.1];
const K_1_0p1_0p05 = [1, 0.1, 0.05];
const K_1_0p1_0p08 = [1, 0.1, 0.08];
const K_1_0p55_0p2 = [1, 0.55, 0.2];
const K_1_0p5_0p15 = [1, 0.5, 0.15];
const K_1_0p6_0p25 = [1, 0.6, 0.25];
const K_1_0p72_0p42 = [1, 0.72, 0.42];
const K_1_0p75_0p2 = [1, 0.75, 0.2];
const K_1_0p75_0p35 = [1, 0.75, 0.35];
const K_1_0p75_0p4 = [1, 0.75, 0.4];
const K_1_0p78_0p5 = [1, 0.78, 0.5];
const K_1_0p7_0p3 = [1, 0.7, 0.3];
const K_1_0p7_0p35 = [1, 0.7, 0.35];
const K_1_0p82_0p25 = [1, 0.82, 0.25];
const K_1_0p85_0p6 = [1, 0.85, 0.6];
const K_1_0p86_0p35 = [1, 0.86, 0.35];
const K_1_0p86_0p5 = [1, 0.86, 0.5];
const K_1_0p88_0p62 = [1, 0.88, 0.62];
const K_1_0p8_0p45 = [1, 0.8, 0.45];
const K_1_0p92_0p7 = [1, 0.92, 0.7];
const K_1_0p95_0p8 = [1, 0.95, 0.8];

export function createEngine(THREE, canvas, options = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: options.antialias ?? true, alpha: false, powerPreference: 'high-performance', stencil: false, depth: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 4);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 2, 9000);
    scene.fog = new THREE.Fog(0x000000, 1000, 3000);
    const disposables = [];
    const keep = o => { disposables.push(o); return o; };

    // ── Himmel och stjärnor (följer kameran) ──
    const skyU = {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, groundC: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, night: { value: 0 }
    };
    const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(8000, 32, 16)), keep(new THREE.ShaderMaterial({ vertexShader: SKY_V, fragmentShader: SKY_F, uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false })));
    sky.renderOrder = -100; sky.frustumCulled = false;
    scene.add(sky);
    const starPos = new Float32Array(900 * 3);
    for (let i = 0; i < 900; i++) {
        const u = Math.random() * Math.PI * 2, v = 0.06 + Math.pow(Math.random(), 0.7) * 0.94;
        const r = 7600, c = Math.sqrt(1 - v * v);
        starPos[i * 3] = Math.cos(u) * c * r; starPos[i * 3 + 1] = v * r; starPos[i * 3 + 2] = Math.sin(u) * c * r;
    }
    const starGeo = keep(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = keep(new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    const stars = new THREE.Points(starGeo, starMat);
    stars.renderOrder = -99; stars.frustumCulled = false;
    scene.add(stars);

    // ── Ljus ──
    const hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(hemi, sun, sun.target);
    const points = [];
    // Antalet punktljus är fast (annars kompileras shadrarna om); färre på mobil
    const nLights = Math.max(0, Math.min(MAX_LIGHTS, options.maxLights ?? MAX_LIGHTS));
    for (let i = 0; i < nLights; i++) { const l = new THREE.PointLight(0xffffff, 0, 320, 1); scene.add(l); points.push(l); }
    const spot = new THREE.SpotLight(0xfff2d0, 0, 620, 0.42, 0.55, 1);
    scene.add(spot, spot.target);

    // ── Effekter och etiketter ──
    const fxTex = keep(new THREE.CanvasTexture(paintFxAtlas()));
    fxTex.colorSpace = THREE.SRGBColorSpace;
    const atlas = new LabelAtlas(1024);
    const atlasTex = keep(new THREE.CanvasTexture(atlas.canvas));
    atlasTex.colorSpace = THREE.SRGBColorSpace;
    atlasTex.anisotropy = 4;
    try { document.fonts?.ready?.then(() => atlas.reset()); } catch (e) { /* inga webbtypsnitt */ }
    const icons = createQuadBatch(THREE, { capacity: 700, map: atlasTex, kind: 'cutout', renderOrder: 3, name: 'icons' });
    const soft = createQuadBatch(THREE, { capacity: 1600, map: fxTex, kind: 'alpha', renderOrder: 1, offset: true, name: 'soft' });
    const glow = createQuadBatch(THREE, { capacity: 2400, map: fxTex, kind: 'add', renderOrder: 4, offset: true, name: 'glow' });
    scene.add(icons.mesh, soft.mesh, glow.mesh);
    const R = {};
    for (const k of Object.keys(FX)) R[k] = fxRect(FX[k]);

    const actors = createActors(THREE, scene);
    const vm = createViewModel(THREE);
    // Kompilera förstapersonens shaders direkt, så att bytet till 'fps' inte hackar
    try { renderer.compile(vm.scene, vm.cam); } catch (e) { /* kompileras vid första bilden */ }

    // ── Stad och rum skapas när de behövs ──
    let city = null, cityKey = null, shadowMesh = null;
    let room = null, roomKey = null;
    function ensureCity(c) {
        if (c === cityKey) return;
        const t0 = performance.now();
        if (city) { city.dispose(); scene.remove(shadowMesh); }
        city = createCity3D(THREE, { city: c, scene, anisotropy: aniso, nearPx: options.nearPx || 512 });
        cityKey = c;
        const shMat = keep(new THREE.MeshBasicMaterial({ map: fxTex, color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
        shadowMesh = new THREE.Mesh(city.shadowGeo, shMat);
        shadowMesh.renderOrder = 0; shadowMesh.name = 'building-shadows';
        city.group.add(shadowMesh);
        // måla marken runt spawn direkt så att första bilden blir skarp
        city.updateGround(c.spawn?.x || 2048, c.spawn?.y || 2048, 700, 9);
        stats.cityBuildMs = Math.round(performance.now() - t0);
    }
    function ensureRoom(I) {
        const key = I ? I.state : null;
        if (key === roomKey) return;
        if (room) { scene.remove(room.group); room.dispose(); room = null; }
        roomKey = key;
        if (I) {
            try {
                const t0 = performance.now();
                room = createRoom3D(THREE, INT, I.state, { anisotropy: aniso });
                stats.roomBuildMs = Math.round(performance.now() - t0);
                scene.add(room.group);
            } catch (e) { console.warn('3D: rummet kunde inte byggas', e); room = null; }
        }
    }

    // ── Kamera ──
    const camSt = { init: false };
    const camT = {}, camF = { x: 0, y: 0, z: 0, lx: 1, ly: 0, lz: 0, fov: 60 }, cur = { x: 0, y: 0, z: 100, lx: 1, ly: 0, lz: 0, fov: 60 };
    let camMode = null, blend = 1, camRoom = undefined;
    const KEYS = ['x', 'y', 'z', 'lx', 'ly', 'lz', 'fov'];
    let blockedFn = null;
    const cityBlocked = (x, y, h) => city.blocked(x, y, h);
    const roomBlocked = (x, y, h) => room.blocked(x, y, h);
    function updateCamera(world, dt, mode, opts) {
        const I = world.interior;
        const rid = I ? I.state : null;
        let snap = false;
        if (rid !== camRoom) { camSt.init = false; camRoom = rid; snap = true; }
        blockedFn = I ? (room ? roomBlocked : null) : (city ? cityBlocked : null);
        const subj = cameraSubject(world);
        if (mode !== camMode) {
            if (camMode !== null && !snap) { for (const k of KEYS) camF[k] = cur[k]; blend = 0; }
            if (mode === 'chase') camSt.init = false;
            camMode = mode;
        }
        if (mode === 'fps') fpsCamera(world, opts, camT);
        else chaseCamera(camSt, subj, dt, opts, !!I, blockedFn, camT);
        if (snap) blend = 1;
        blend = Math.min(1, blend + dt / 0.45);
        const k = smooth(blend);
        for (const key of KEYS) cur[key] = blend >= 1 ? camT[key] : lerp(camF[key], camT[key], k);
        let sx = 0, sy = 0;
        // opts.shake === false: inställningen "kamerarörelse" är av
        if (dt > 0 && world.shake > 0 && opts.shake !== false) { sx = (Math.random() - 0.5) * world.shake * 6; sy = (Math.random() - 0.5) * world.shake * 6; }
        camera.position.set(cur.x + sx, cur.z + sy * 0.5, cur.y + sy);
        camera.lookAt(cur.lx, cur.lz, cur.ly);
        const near = mode === 'fps' || blend < 1 ? 1 : 3;
        // Stående skärm: vidga den lodräta vinkeln så att man ser tillräckligt åt sidorna
        let fov = cur.fov;
        if (camera.aspect < 1) {
            const hmin = (mode === 'fps' ? 50 : 46) * Math.PI / 180;
            fov = Math.min(100, Math.max(fov, 2 * Math.atan(Math.tan(hmin / 2) / camera.aspect) * 180 / Math.PI));
        }
        if (camera.fov !== fov || camera.near !== near) { camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
        camera.updateMatrixWorld();
    }

    // ── Ljuskandidater (de fyra närmaste/starkaste blir riktiga punktljus) ──
    const cand = Array.from({ length: 96 }, () => ({ x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, i: 0, range: 300, d: 0 }));
    let nCand = 0;
    function light(x, y, z, rgb, intensity, range = 300, weight = 1) {
        if (nCand >= cand.length) return;
        const c = cand[nCand++];
        c.x = x; c.y = y; c.z = z; c.r = rgb[0]; c.g = rgb[1]; c.b = rgb[2]; c.i = intensity; c.range = range;
        c.d = Math.hypot(x - focus.x, y - focus.y) / weight;
    }
    const focus = { x: 0, y: 0 };
    const sorted = [];
    const byDist = (a, b) => a.d - b.d;
    function assignLights() {
        sorted.length = 0;
        for (let i = 0; i < nCand; i++) sorted.push(cand[i]);
        sorted.sort(byDist);
        const cut = sorted.length > nLights ? sorted[nLights].d : Infinity;
        for (let i = 0; i < nLights; i++) {
            const l = points[i], c = sorted[i];
            if (!c) { l.intensity = 0; continue; }
            const fade = cut === Infinity ? 1 : clamp((cut - c.d) / 160, 0, 1);
            l.position.set(c.x, c.z, c.y);
            l.color.setRGB(c.r, c.g, c.b, THREE.SRGBColorSpace);
            l.intensity = c.i * fade;
            l.distance = c.range;
        }
    }

    // ── Hjälp för att lägga till saker ──
    const pal = {};
    let T = 0, fogFar = 3000, cullR = 3000;
    const C_WHITE = [1, 1, 1], C_BUL = [1, 0.93, 0.6], C_BUL2 = [1, 0.6, 0.38];
    const near2 = (x, y) => { const dx = x - cur.x, dy = y - cur.y; return dx * dx + dy * dy < cullR * cullR; };
    // Ikoner alldeles intill kameran (förstapersonsvy) krymper så att de inte täcker bilden
    const closeK = (x, y, z) => { const d = Math.hypot(x - cur.x, y - cur.y, z - cur.z); return d < 90 ? Math.max(0.25, d / 90) : 1; };
    const icon = (ch, x, y, z, size, a = 1, mode = 3) => { const e = atlas.icon(ch); const k = closeK(x, y, z); icons.add(x, z, y, size * k, size * k, e.uv, 1, 1, 1, a, mode, 0); };
    const label = (str, color, x, y, z, h, opts, mode = 3, ang = 0) => { const e = atlas.text(str, color, opts); const k = mode === 1 ? 1 : closeK(x, y, z); icons.add(x, z, y, h * e.aspect * k, h * k, e.uv, 1, 1, 1, 1, mode, ang); };
    const decal = (x, y, size, rect, rgb, a, ang = 0, sy = size) => soft.add(x, 0.6, y, size, sy, rect, rgb[0], rgb[1], rgb[2], a, 2, ang);
    const shine = (x, y, z, size, rect, rgb, a, mode = 0, ang = 0, sy = size) => glow.add(x, z, y, size, sy, rect, rgb[0], rgb[1], rgb[2], a, mode, ang);
    const pantsCache = new WeakMap();
    const pantsOf = o => { let c = pantsCache.get(o); if (!c) { c = PANTS[Math.floor(Math.random() * PANTS.length)]; pantsCache.set(o, c); } return c; };
    const gangColor = id => (id ? GANGS.find(g => g.id === id)?.color : null);

    // En återanvänd beskrivning av en figur
    const F = {};
    function fig(x, y, angle, shirt, skin, hair, phase, scale, extra) {
        F.x = x; F.y = y; F.z = extra.z || 0; F.angle = angle; F.shirt = shirt; F.skin = skin; F.hair = hair; F.phase = phase; F.scale = scale;
        F.down = !!extra.down; F.pose = extra.pose || 'walk'; F.moving = extra.moving !== false; F.pants = extra.pants || '#273043';
        F.hood = !!extra.hood; F.cap = extra.cap || null; F.vest = extra.vest || null; F.weapon = extra.weapon || null; F.punch = !!extra.punch;
        F.dress = extra.dress || null; F.scooter = !!extra.scooter; F.shades = !!extra.shades; F.head = extra.head !== false;
        actors.figure(F);
        if (!extra.noShadow) decal(x, y, 22 * scale, R.soft, K_0_0_0, F.down ? 0.4 : 0.32);
    }
    // Tillvalen för en figur: samma objekt varje gång, nollställs fält för fält (ingen delete → snabbt)
    const EX = { down: false, vest: null, hood: false, scooter: false, shades: false, weapon: null, punch: false, pants: null, cap: null, z: 0, pose: null, moving: true, dress: null, noShadow: false, head: true };
    const ex = () => {
        EX.down = false; EX.vest = null; EX.hood = false; EX.scooter = false; EX.shades = false; EX.weapon = null; EX.punch = false;
        EX.pants = null; EX.cap = null; EX.z = 0; EX.pose = null; EX.moving = true; EX.dress = null; EX.noShadow = false; EX.head = true;
        return EX;
    };

    // ── Fordon ──
    const remoteCars = new Pool(() => ({ hp: 1, maxHp: 1, driver: 'remote', vx: 0, vy: 0, remote: true }), 30);
    function drawVehicle(v, world, night, flash, fps) {
        const p = world.player;
        if (!near2(v.x, v.y)) return;
        const own = v === p.vehicle;
        const spec = v.spec || {}, L = spec.l || 44, Wd = spec.w || 22, bike = spec.kind === 'bike';
        if (!(fps && own)) {
            actors.vehicle(v, night, flash, T, gangColor(v.gang));
            soft.add(v.x, 0.5, v.y, L * 1.2, Wd * (bike ? 1.6 : 1.45), R.soft, 0, 0, 0, 0.5, 2, v.angle);
        }
        const ca = Math.cos(v.angle), sa = Math.sin(v.angle);
        // Förare på hoj syns (inte jag i förstapersonsvy)
        if (bike && v.driver && !(fps && own)) {
            let shirt = '#3b82f6', vest = null;
            if (v.driver === 'player') {
                const g = gangById(world.profile.gang);
                shirt = g && g.kind !== 'mc' ? g.color : p.color;
                if (g && g.kind === 'mc') vest = g.color;
            } else if (v.gang) {
                const g = gangById(v.gang);
                shirt = g.kind === 'mc' ? '#3f3f46' : g.color;
                if (g.kind === 'mc') vest = g.color;
            } else if (v.remote) shirt = v.rcolor || shirt;
            const e = ex(); e.pose = 'ride'; e.z = spec.chopper ? -3 : -1; e.vest = vest; e.cap = spec.chopper ? null : '#111827'; e.noShadow = true; e.pants = '#1f2937';
            fig(v.x - ca * L * (spec.chopper ? 0.12 : 0.05), v.y - sa * L * (spec.chopper ? 0.12 : 0.05), v.angle, shirt, '#e0ac69', spec.chopper ? '#3f2a14' : '#111', 0, 1, e);
        }
        if (v.exploded) return;
        // Ljus: strålkastare på natten, bromsljus, blåljus, brinnande vrak
        const driven = !!v.driver || own;
        if (night && driven && !v.wrecked) {
            const fx = v.x + ca * L / 2, fy = v.y + sa * L / 2;
            for (let s = -1; s <= 1; s += 2) {
                const ox = -sa * s * (Wd / 2 - 3.4), oy = ca * s * (Wd / 2 - 3.4);
                shine(fx + ox, fy + oy, bike ? 14 : 8.4, 16, R.flare, K_1_0p95_0p8, 0.75 * pal.lamps);
                if (bike) break;
            }
            // ljuskägla på vägen
            shine(fx + ca * 85, fy + sa * 85, 0.7, 170, R.beam, K_1_0p92_0p7, 0.42 * pal.lamps, 2, v.angle, bike ? 70 : 100);
            const bx = v.x - ca * L / 2, by = v.y - sa * L / 2;
            shine(bx, by, 9, v.braking ? 20 : 12, R.glow, K_1_0p1_0p05, v.braking ? 0.8 : 0.45);
        } else if (v.braking && !v.wrecked) {
            shine(v.x - ca * L / 2, v.y - sa * L / 2, 9, 14, R.glow, K_1_0p1_0p05, 0.55);
        }
        if (v.siren && !v.wrecked) {
            const z = 22;
            shine(v.x, v.y, z, 46, R.flare, flash ? K_1_0p15_0p1 : K_0p2_0p4_1, 0.9);
            shine(v.x, v.y, 0.8, 200, R.glow, flash ? K_1_0p1_0p08 : K_0p15_0p3_1, 0.32, 2);
            light(v.x, v.y, 40, flash ? K_1_0p15_0p1 : K_0p2_0p35_1, 260, 330, 1.6);
        }
        if (v.wrecked && !v.exploded) {
            shine(v.x, v.y, 14, 90, R.glow, K_1_0p5_0p15, 0.45);
            light(v.x, v.y, 30, K_1_0p55_0p2, 200, 300, 1.2);
        }
        if (v.owned && !v.driver && !v.remote) icon('🔑', v.x, v.y, 36, 10);
        const m = world.mission;
        if (v.tag && !v.wrecked && m && (m.car === v || (m.cars || []).includes(v))) decal(v.x, v.y, L * 1.6, R.ring, K_1_0p82_0p25, 0.6 + 0.4 * Math.sin(T * 8));
    }

    // ── Folk ──
    function drawPeople(world, fps) {
        const p = world.player;
        const here = world.interior ? world.interior.id : null;
        for (const ped of here ? [] : world.peds) {
            if (!near2(ped.x, ped.y)) continue;
            const g = ped.vest ? gangById(ped.gang) : null;
            const e = ex();
            e.down = ped.down > 0; e.vest = g ? g.color : null; e.hood = ped.hood; e.scooter = ped.scooter; e.shades = ped.type === 'metro';
            e.weapon = ped.gun && ped.attack ? 'pistol' : null; e.punch = ped.windup > 0; e.pants = pantsOf(ped);
            if (ped.cop) { e.cap = '#0f172a'; e.pants = '#111827'; }
            fig(ped.x, ped.y, ped.angle, ped.cop ? '#1e3a8a' : ped.shirt, ped.skin, ped.cop ? '#0f172a' : ped.hair, ped.phase, 1, e);
            if (ped.muzzle > 0) muzzleAt(ped.x, ped.y, ped.angle, 18, 1);
            if (ped.flashT > 0) shine(ped.x, ped.y, 18, 36, R.glow, C_WHITE, 0.7);
            if (ped.dead) continue;
            if (ped.down > 2) icon('💫', ped.x, ped.y, 40, 10);
            else if (ped.attack && !(ped.down > 0)) {
                decal(ped.x, ped.y, 30, R.ring, ped.targetPed ? parseColor(gangById(ped.gang)?.color || '#22c55e') : K_0p94_0p27_0p27, 0.55 + 0.35 * Math.sin(T * 10));
                icon(ped.targetPed ? '🛡️' : ped.mugger ? '🦹' : ped.cop ? '🚔' : ped.gun ? '🔫' : '😠', ped.x, ped.y, 46, 10);
            } else if (ped.buyer) icon('💸', ped.x, ped.y, 46, 11);
        }
        // Mitt crew
        for (const c of world.crew || []) {
            if (c.hidden || (c.interior || null) !== here || !near2(c.x, c.y)) continue;
            const e = ex();
            e.down = c.down > 0; e.weapon = c.role === 'gunner' ? 'pistol' : null; e.punch = c.punchT > 0; e.pants = '#1f2937'; e.z = floorZ(c.x, c.y);
            fig(c.x, c.y, c.angle || 0, CREW_LOOK[c.role]?.shirt || '#333', '#c68642', '#111', c.phase || 0, 1, e);
            if (c.muzzle > 0) muzzleAt(c.x, c.y, c.angle, 18, 1);
            shine(c.x, c.y, 47, 9, R.arrow, K_0p13_0p77_0p37, 0.95, 0, Math.PI);
            if (c.down > 0) icon('💤', c.x, c.y, 40, 9);
        }
        // Andra riktiga spelare och deras crew
        for (const r of world.remotes()) {
            if ((r.in || null) !== here) continue;
            for (const c of r.crew || []) {
                if (c.d || !near2(c.x, c.y)) continue;
                const e = ex(); e.vest = r.color; e.z = floorZ(c.x, c.y);
                fig(c.x, c.y, c.a || 0, CREW_LOOK[c.r]?.shirt || '#444', '#c68642', '#111', (r.phase || 0) * 0.8, 1, e);
            }
            if (r.v && !here) continue; // kör: bilen ritas bland fordonen
            if (!near2(r.rx, r.ry)) continue;
            const e = ex(); e.down = !!r.dead; e.weapon = r.w && r.w !== 'fists' ? r.w : null; e.z = floorZ(r.rx, r.ry);
            fig(r.rx, r.ry, r.ra || 0, r.color || '#60a5fa', '#e0ac69', '#1f1300', r.phase || 0, 1.06, e);
            const rc = parseColor(r.color || '#60a5fa');
            shine(r.rx, r.ry, 50 + Math.sin(T * 4) * 1.5, 12, R.arrow, rc, 1, 0, Math.PI);
            decal(r.rx, r.ry, 34, R.ring, rc, 0.55);
        }
        // Jag (inte i förstapersonsvy — då syns händerna)
        if (!p.vehicle && !fps) {
            const g = gangById(world.profile.gang), mc = g && g.kind === 'mc';
            const weapon = world.profile.weapon && world.profile.weapon !== 'fists' ? world.profile.weapon : null;
            const e = ex(); e.down = p.dead; e.vest = mc ? g.color : null; e.punch = p.punchT > 0; e.weapon = weapon; e.pants = '#1e293b'; e.z = floorZ(p.x, p.y);
            e.moving = Math.hypot(p.vx || 0, p.vy || 0) > 8;
            fig(p.x, p.y, p.angle, g && !mc ? g.color : p.color, '#e0ac69', '#1f1300', p.walkPhase || 0, 1.06, e);
            decal(p.x, p.y, 34, R.ring, K_1_0p82_0p25, 0.35 + 0.25 * Math.sin(T * 6));
            if (p.muzzle > 0) muzzleAt(p.x, p.y, p.angle, weapon === 'shotgun' ? 30 : 25, 1.4);
        }
        if (p.muzzle > 0) light(p.x, p.y, 26, K_1_0p8_0p45, 260, 280, 3);
    }
    function muzzleAt(x, y, a, dist, k) {
        const fx = x + Math.cos(a) * dist, fy = y + Math.sin(a) * dist;
        shine(fx, fy, 21, 14 * k, R.flare, K_1_0p86_0p5, 1);
        shine(fx, fy, 21, 34 * k, R.glow, K_1_0p7_0p3, 0.6);
    }
    const zero = () => 0;
    let floorZ = zero;

    // ── Platser, dörrar, upphämtning ──
    function drawMarkers(world) {
        const m = world.city.markers, pulse = 0.5 + 0.5 * Math.sin(T * 5);
        for (const ph of m.phones || []) {
            if (!ph || !near2(ph.x, ph.y)) continue;
            const open = phoneAccess(world.profile, ph.gang) && !world.mission;
            const col = parseColor(gangById(ph.gang).color);
            if (open) { decal(ph.x, ph.y, 64 + pulse * 16, R.disc, col, 0.18 + pulse * 0.18); shine(ph.x, ph.y, 39, 26, R.glow, col, 0.5); }
            icon('☎️', ph.x, ph.y, 54 + (open ? Math.sin(T * 20) * 1.2 : 0), 14);
        }
        for (const sp of m.sprays || []) {
            if (!sp || !near2(sp.x, sp.y)) continue;
            decal(sp.x, sp.y, 60, R.square, K_0p22_0p74_0p97, 0.3);
            icon('🎨', sp.x, sp.y, 24, 18);
        }
        if (m.fence && near2(m.fence.x, m.fence.y)) { decal(m.fence.x, m.fence.y, 68, R.stripes, K_0p92_0p7_0p03, 0.75); icon('🔧', m.fence.x, m.fence.y, 26, 20); }
        const spot = (o, ch, rgb, r = 52) => {
            if (!o || !near2(o.x, o.y)) return;
            decal(o.x, o.y, r + pulse * 8, R.disc, rgb, 0.16 + pulse * 0.16);
            decal(o.x, o.y, r, R.ring, rgb, 0.8);
            icon(ch, o.x, o.y, 30 + Math.sin(T * 3 + o.x) * 2, 18);
        };
        spot(m.home, '🏠', K_1_0p82_0p25, 68);
        spot(m.recruit, '👥', K_0p13_0p77_0p37);
        spot(m.dealer, '🎒', K_0p64_0p9_0p21);
        spot(m.guns, '🔫', K_0p98_0p45_0p09);
        const cl = m.club;
        if (cl && near2(cl.x, cl.y)) {
            const open = world.isClubOpen();
            const neon = open && Math.sin(T * 7) > -0.6;
            decal(cl.x, cl.y, 92, R.dash, open ? K_0p96_0p45_0p71 : K_0p4_0p4_0p4, 0.8);
            decal(cl.x, cl.y, 92, R.disc, open ? K_0p96_0p45_0p71 : K_0p4_0p4_0p4, 0.14 + pulse * 0.16);
            icon('🍾', cl.x, cl.y, 40, 20);
            label(open ? 'NATTKLUBBEN' : 'STÄNGT · 20:00', neon ? '#f9a8d4' : open ? '#9d174d' : '#9ca3af', cl.x, cl.y, 60, 12, { glow: neon ? '#f472b6' : '' });
            if (open) {
                const beat = 0.5 + 0.5 * Math.sin(T * 7.3);
                shine(cl.x, cl.y, 1, 300, R.glow, K_0p96_0p31_0p7, 0.25 + beat * 0.2, 2);
                light(cl.x, cl.y, 40, K_0p96_0p3_0p7, 220 * (0.6 + beat * 0.4), 320, 1.4);
            }
        }
        // Dörrar till företag, gömställen och banken
        const prof = world.profile;
        for (const d of world.doors()) {
            const o = d.door || d;
            if (!near2(o.x, o.y)) continue;
            let ic, lab, col;
            if (d.kind === 'business') {
                const shop = SHOPS[d.slot], owned = (prof.owned || []).includes(shop.id);
                ic = shop.icon; col = owned ? '#22c55e' : '#ffd23f';
                lab = owned ? ((prof.cityCollected || []).includes(shop.id) ? 'ÖPPET · DIN' : 'ÖPPET · DIN · 💰') : 'ÖPPET · TILL SALU';
            } else if (d.kind === 'house') {
                const owned = world.ownsHouse(d);
                ic = owned ? '🏡' : '🔑'; col = owned ? '#22c55e' : '#38bdf8'; lab = owned ? 'GÖMSTÄLLE' : 'TILL SALU';
            } else { ic = '🏦'; col = '#a78bfa'; lab = 'BANKEN'; }
            const fx = o.x - DX[o.side] * 15, fy = o.y - DY[o.side] * 15;
            const rgb = parseColor(col);
            decal(fx, fy, 22, R.disc, rgb, 0.25 + (0.5 + 0.5 * Math.sin(T * 4 + o.x)) * 0.35);
            shine(o.x - DX[o.side] * 3, o.y - DY[o.side] * 3, 20, 40, R.glow, rgb, 0.35);
            icon(ic, fx, fy, 56, 14);
            label(lab, col, fx, fy, 45, 6.5, null);
        }
        // Club Diamant och Pang-Pelle: neonskylt på väggen ovanför dörren
        for (const sd of world.specialDoors()) {
            const o = sd.door;
            if (!near2(o.x, o.y)) continue;
            const flick = Math.sin(T * 7 + o.x) > -0.7;
            const out = Math.atan2(-DY[o.side], -DX[o.side]);
            const wx = o.x + DX[o.side] * 3.2, wy = o.y + DY[o.side] * 3.2;
            const rgb = parseColor(sd.color);
            label(sd.title, flick ? sd.neon : sd.color, wx, wy, 62, 15, { glow: flick ? sd.color : '' }, 1, out);
            label(sd.sub, '#ffffff', wx, wy, 50, 6, null, 1, out);
            icon(sd.icon, wx - DX[o.side] * 4, wy - DY[o.side] * 4, 80, 16);
            const fx = o.x - DX[o.side] * 18, fy = o.y - DY[o.side] * 18;
            decal(fx, fy, 30, R.disc, rgb, 0.3 + (0.5 + 0.5 * Math.sin(T * 4 + o.y)) * 0.4);
            shine(wx - DX[o.side] * 6, wy - DY[o.side] * 6, 40, flick ? 120 : 80, R.glow, rgb, 0.5);
            const shut = bannedFor(world, sd.id) > 0; // utslängd efter ett bråk: stängt en stund
            label(shut ? 'STÄNGT' : 'GÅ IN', shut ? '#f87171' : '#ffffff', fx, fy, 24, 4, null);
            light(wx - DX[o.side] * 30, wy - DY[o.side] * 30, 50, rgb, flick ? 160 : 90, 260, 1.2);
        }
        // Butikernas ikon på taket och HQ-skylten
        const owned = prof.owned || [];
        for (const b of world.city.buildings) {
            const cx = (b.x + b.w / 2) * TILE, cy = (b.y + b.h / 2) * TILE;
            if (!near2(cx, cy)) continue;
            const top = city.heights[b.id] || 100;
            if (b.hq) {
                label('HQ', '#ffd23f', cx, cy, top + 26, 34, { glow: '#ffb000', size: 40 });
                shine(cx, cy, top + 26, 160, R.glow, K_1_0p75_0p2, 0.35);
            } else if (b.shopSlot !== undefined && SHOPS[b.shopSlot]) {
                const mine = owned.includes(SHOPS[b.shopSlot].id);
                icon(SHOPS[b.shopSlot].icon, cx, cy, top + 26 + Math.sin(T * 2 + b.id) * 2, 30);
                if (mine) shine(cx, cy, top + 26, 70, R.glow, K_1_0p82_0p25, 0.6);
            }
        }
        // Lådor att plocka upp
        for (const pk of world.pickups || []) {
            if (pk.taken || !near2(pk.x, pk.y)) continue;
            const rgb = parseColor(PICK_COLS[pk.type] || '#fff');
            decal(pk.x, pk.y, 34, R.ring, rgb, 0.8);
            shine(pk.x, pk.y, 12, 40, R.glow, rgb, 0.35);
            icon(PICK_ICONS[pk.type] || '❓', pk.x, pk.y, 12 + Math.sin(T * 4 + pk.phase) * 2.5, 15);
        }
        for (const it of world.groundItems()) {
            if (!near2(it.x, it.y)) continue;
            const def = ITEM_TYPES[it.type];
            const pul = 0.5 + 0.5 * Math.sin(T * 4 + it.x * 0.01);
            decal(it.x, it.y, 32, R.disc, K_0p98_0p8_0p08, 0.18 + pul * 0.22);
            decal(it.x, it.y, 32, R.ring, K_0p98_0p8_0p08, 0.85);
            icon(def.icon, it.x, it.y, 12 + Math.sin(T * 3 + it.x) * 1.5, 14);
            if (world.nearItem === it) label(def.label.toUpperCase(), '#facc15', it.x, it.y, 30, 7, null);
        }
        for (const d of world.drops || []) {
            if (!near2(d.x, d.y) || (d.life < 4 && Math.sin(T * 16) > 0)) continue;
            icon('💵', d.x, d.y, 7 + Math.sin(T * 5 + d.x) * 2, 11);
        }
        const tg = world.mission && world.mission.target;
        if (tg) {
            decal(tg.x, tg.y, 92, R.disc, K_1_0p82_0p25, 0.18 + 0.12 * Math.sin(T * 5));
            decal(tg.x, tg.y, 92, R.ring, K_1_0p82_0p25, 0.9);
            const by = 90 + Math.abs(Math.sin(T * 4)) * 18;
            const e = atlas.icon('⬇️');
            icons.add(tg.x, by, tg.y, 30, 30, e.uv, 1, 1, 1, 1, 3, 0);
            shine(tg.x, tg.y, by, 70, R.glow, K_1_0p82_0p25, 0.4);
        }
    }

    // ── Gatlampor, kulor, partiklar ──
    function drawLamps() {
        const k = pal.lamps;
        if (k < 0.05) return;
        for (const l of city.lampInfo) {
            if (!near2(l.hx, l.hy)) continue;
            shine(l.hx, l.hy, 68.5, 30, R.flare, K_1_0p88_0p62, 0.85 * k);
            shine(l.hx, l.hy, 0.8, 250, R.glow, K_1_0p72_0p42, 0.34 * k, 2);
            light(l.hx, l.hy, 64, K_1_0p78_0p5, 150 * k, 300, 1);
        }
    }
    const vA = new THREE.Vector3(), vB = new THREE.Vector3();
    function streak(x0, y0, z0, x1, y1, z1, w, rgb, a) {
        vA.set(x0, z0, y0).applyMatrix4(camera.matrixWorldInverse);
        vB.set(x1, z1, y1).applyMatrix4(camera.matrixWorldInverse);
        const len = Math.hypot(vB.x - vA.x, vB.y - vA.y);
        if (len < 0.5 || len > 90) return; // en kula/gnista är ett kort streck; längre = hopp i positionen
        glow.add((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2, len, w, R.spark, rgb[0], rgb[1], rgb[2], a, 0, Math.atan2(vB.y - vA.y, vB.x - vA.x));
    }
    function drawFx(world) {
        for (const b of world.bullets || []) {
            if (!near2(b.x, b.y)) continue;
            const bc = b.from === 'player' || b.from === 'crew' ? C_BUL : C_BUL2;
            streak(b.px - (b.x - b.px) * 1.5, b.py - (b.y - b.py) * 1.5, 19, b.x, b.y, 19, 3.2, bc, 1);
            shine(b.x, b.y, 19, 7, R.glow, bc, 0.9);
        }
        for (const pt of world.particles) {
            const pad = pt.type === 'blast';
            if (!pad && !near2(pt.x, pt.y)) continue;
            const a = pt.life / pt.max;
            switch (pt.type) {
                case 'smoke': soft.add(pt.x, 12 + (1 - a) * 46, pt.y, pt.size * 2.6, pt.size * 2.6, R.smoke, 0.26, 0.26, 0.28, a * 0.6, 0, pt.rot); break;
                case 'fire': { const s = pt.size * (0.5 + a * 0.7) * 2.6; shine(pt.x, pt.y, 6 + (1 - a) * 18, s, R.fire, K_1_0p8_0p45, a, 0, pt.rot); break; }
                case 'nitro': shine(pt.x, pt.y, 6, 12 * a + 5, R.glow, K_0p3_0p7_1, a); break;
                case 'spark': streak(pt.x - pt.vx * 0.03, pt.y - pt.vy * 0.03, 12, pt.x, pt.y, 12, 1.8, K_1_0p86_0p35, a); break;
                case 'debris': soft.add(pt.x, 3 + a * 12, pt.y, 6, 4, R.square, 0.12, 0.12, 0.12, a, 0, pt.rot); break;
                case 'stars': icon('💫', pt.x, pt.y, 34 + (1 - a) * 10, 11, a); break;
                case 'blast': {
                    const r = pt.size * (0.35 + (1 - a) * 0.75);
                    shine(pt.x, pt.y, r * 0.45, r * 2.3, R.fire, K_1_0p85_0p6, a);
                    shine(pt.x, pt.y, 0.8, r * 3, R.glow, K_1_0p6_0p25, a * 0.6, 2);
                    light(pt.x, pt.y, 40, K_1_0p7_0p35, 600 * a, 520, 4);
                    break;
                }
            }
        }
        for (const f of world.flashes || []) {
            shine(f.x, f.y, 30, 380, R.glow, K_1_0p75_0p35, Math.min(0.8, f.life * 1.6));
            light(f.x, f.y, 50, K_1_0p75_0p4, 900 * Math.min(1, f.life * 2), 700, 5);
        }
        if (!world.interior) {
            for (const s of world.scorches || []) if (near2(s.x, s.y)) soft.add(s.x, 0.55, s.y, s.r * 2, s.r * 2, R.soft, 0.03, 0.025, 0.02, 0.8, 2, 0);
            const sk = world.skids || [];
            for (let i = Math.max(0, sk.length - 500); i < sk.length; i++) {
                const s = sk[i];
                if (!near2(s.x1, s.y1)) continue;
                const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
                if (dx * dx + dy * dy > 48 * 48) continue; // hopp (bil flyttad) — inget långt sladdspår tvärs över stan
                soft.add((s.x1 + s.x2) / 2, 0.5, (s.y1 + s.y2) / 2, Math.hypot(dx, dy) + 2, 3.5, R.square, 0.04, 0.04, 0.05, Math.min(0.5, s.life / 14 * 0.5), 2, Math.atan2(dy, dx));
            }
        }
    }

    // ── Inomhus ──
    function drawRoom(world, dt) {
        const I = world.interior, st = I.state;
        room.updateLight(st.t, dt);
        for (const n of st.npcs) {
            const look = n.look || {};
            const e = ex();
            e.pose = n.pose || 'walk'; e.dress = look.dress; e.cap = look.cap; e.z = room.floorAt(n.x, n.y); e.pants = pantsOf(n);
            e.moving = n.pose === 'walk' || n.walking || n.beh === 'dancer';
            if (n.beh === 'dancer' && e.pose === 'walk') e.pose = 'dance';
            fig(n.x, n.y, n.angle || 0, look.shirt || '#444', look.skin || '#e0ac69', look.hair || '#1f1300', n.phase || 0, 1, e);
        }
        const it = world.nearInteraction;
        if (it) decal(it.x, it.y, (it.r || 26) * 2, R.ring, K_0p98_0p8_0p08, 0.5 + 0.4 * Math.sin(T * 6));
        const ex_ = I.def.exit;
        if (ex_) { decal(ex_.x, ex_.y - 10, 40, R.disc, K_0p13_0p77_0p37, 0.25 + 0.15 * Math.sin(T * 4)); label('🚪 UT', '#22c55e', ex_.x, ex_.y - 6, 44, 5, null); }
        // Takets lampor: små sken + ljuskäglor i rummets färger
        const fx = room.fixtures;
        for (let i = 0; i < fx.length; i += 2) {
            const sp = room.spots[(i >> 1) % room.spots.length];
            const k = Math.max(0.35, Math.max(sp.c[0], sp.c[1], sp.c[2]));
            const r = 0.35 + 0.65 * sp.c[0] / k, g = 0.35 + 0.65 * sp.c[1] / k, b = 0.35 + 0.65 * sp.c[2] / k;
            const pulse = 0.7 + 0.3 * Math.sin(T * 2.1 + i);
            glow.add(fx[i], 55, fx[i + 1], 14, 14, R.flare, r, g, b, 0.9);
            glow.add(fx[i], 28, fx[i + 1], 34, 56, R.cone, r, g, b, 0.16 * pulse, 3, 0);
        }
        for (const s of room.spots) {
            const k = Math.max(s.c[0], s.c[1], s.c[2]);
            if (k < 0.02) continue;
            const pulse = 0.75 + 0.25 * Math.sin(T * 1.3 + s.ph);
            s.rgb = s.rgb || [0, 0, 0]; // egen array per lampa (skapas en gång)
            s.rgb[0] = s.c[0] / k; s.rgb[1] = s.c[1] / k; s.rgb[2] = s.c[2] / k;
            light(s.x, s.y, 50, s.rgb, (120 + k * 900) * pulse, 520, 1);
        }
    }

    // ── Utseende: himmel, dimma, ljus ──
    const tmpC = new THREE.Color(), horizonC = new THREE.Color(), look = { sky: new THREE.Color(), ground: new THREE.Color(), sun: new THREE.Color(), hemiI: 1, sunI: 1 };
    function applyLook(world, mode, dt) {
        const I = world.interior;
        if (I) {
            scene.fog.color.setRGB(0.01, 0.008, 0.015);
            scene.fog.near = 900; scene.fog.far = 2200;
            skyU.zenith.value.setRGB(0.01, 0.008, 0.02); skyU.horizon.value.setRGB(0.02, 0.015, 0.03); skyU.groundC.value.setRGB(0, 0, 0); skyU.sunColor.value.setRGB(0, 0, 0);
            starMat.opacity = 0;
            hemi.color.setRGB(1, 0.92, 0.95, THREE.SRGBColorSpace); hemi.groundColor.setRGB(0.25, 0.2, 0.3, THREE.SRGBColorSpace); hemi.intensity = 1.25;
            sun.intensity = 0.25; sun.position.set(cur.x + 100, 400, cur.y + 160); sun.target.position.set(cur.x, 0, cur.y);
            fogFar = 2200; cullR = 2400;
            look.sky.copy(hemi.color); look.ground.copy(hemi.groundColor); look.hemiI = 1.3; look.sun.setRGB(1, 0.9, 0.9); look.sunI = 0.5;
            return;
        }
        horizonC.setHex(pal.horizon);
        skyU.zenith.value.setHex(pal.zenith); skyU.horizon.value.copy(horizonC); skyU.groundC.value.setHex(pal.ground);
        skyU.sunDir.value.set(pal.sunDir[0], pal.sunDir[1], pal.sunDir[2]);
        skyU.sunColor.value.setHex(pal.sun); skyU.night.value = pal.night;
        starMat.opacity = pal.night * 0.9;
        const fps = mode === 'fps';
        scene.fog.color.setHex(pal.fog);
        scene.fog.near = fps ? 500 : 1100; scene.fog.far = fps ? 2300 : 3300;
        fogFar = scene.fog.far; cullR = fogFar + 150;
        hemi.color.setHex(pal.zenith).lerp(tmpC.setHex(0xffffff), 0.55);
        hemi.groundColor.setHex(pal.ground);
        hemi.intensity = 0.6 + pal.skyI * 1.05;
        sun.color.setHex(pal.sun);
        sun.intensity = pal.sunI * 1.25;
        sun.position.set(cur.x + pal.sunDir[0] * 1500, pal.sunDir[1] * 1500, cur.y + pal.sunDir[2] * 1500);
        sun.target.position.set(cur.x, 0, cur.y);
        city.updateLook(pal, dt, horizonC, skyU.zenith.value);
        look.sky.copy(hemi.color); look.ground.copy(hemi.groundColor); look.hemiI = hemi.intensity; look.sun.copy(sun.color); look.sunI = sun.intensity;
    }

    // ── Bildrutan ──
    let lastMode = 'chase';
    const stats = { cpuMs: 0, calls: 0, triangles: 0, dpr: 1, figures: 0, vehicles: 0 };
    const fpsOpts = {};
    // Tidtagning per del (ms, glidande medel) — för att hitta det som kostar
    const parts = {};
    let tp = 0;
    const lap = (name) => { const n = performance.now(); parts[name] = (parts[name] || 0) * 0.9 + (n - tp) * 0.1; tp = n; };
    stats.parts = parts;
    function render(world, dt, mode, opts = {}) {
        const t0 = performance.now();
        tp = t0;
        dt = Math.max(0, Math.min(0.1, dt || 0));
        T += dt;
        mode = mode === 'fps' ? 'fps' : 'chase';
        lastMode = mode;
        ensureCity(world.city);
        const I = world.interior;
        ensureRoom(I);
        city.group.visible = !I;
        if (room) room.group.visible = !!I;
        floorZ = I && room ? room.floorAt : zero;
        lap('setup');
        dayPalette(world.hour(), world.darkness(), pal);
        updateCamera(world, dt, mode, opts);
        sky.position.copy(camera.position); stars.position.copy(camera.position);
        applyLook(world, mode, dt);
        const fps = mode === 'fps' && blend > 0.5;
        // fokuspunkten: där kameran tittar (för skarp mark och vilka ljus som tänds)
        if (mode === 'fps') { focus.x = cur.x + (cur.lx - cur.x) * 2.5; focus.y = cur.y + (cur.ly - cur.y) * 2.5; }
        else { focus.x = cur.lx; focus.y = cur.ly; }
        lap('camera');
        if (!I) city.updateGround(focus.x, focus.y, mode === 'fps' ? 650 : 760, 1);
        lap('ground');
        // dynamiskt innehåll
        nCand = 0;
        actors.begin(); icons.begin(); soft.begin(); glow.begin();
        const night = pal.lamps > 0.35, flash = Math.sin(T * 14) > 0;
        if (!I) {
            for (const v of world.vehicles) drawVehicle(v, world, night, flash, fps);
            for (const r of world.remotes()) {
                if (!r.v || r.in || !VEHICLES[r.v]) continue;
                const c = remoteCars.get(r.id ?? r.name ?? r);
                c.x = r.rx; c.y = r.ry; c.angle = r.ra || 0; c.type = r.v; c.spec = VEHICLES[r.v]; c.color = r.vc || '#888'; c.rcolor = r.color;
                drawVehicle(c, world, night, flash, fps);
            }
            remoteCars.sweep();
            lap('vehicles');
            drawMarkers(world);
            drawLamps();
            lap('markers');
        } else if (room) { drawRoom(world, dt); lap('room'); }
        drawPeople(world, fps);
        lap('people');
        drawFx(world);
        lap('fx');
        // spelarens strålkastare som riktigt ljus
        const pv = world.player.vehicle;
        if (pv && night && !I && !pv.wrecked) {
            const ca = Math.cos(pv.angle), sa = Math.sin(pv.angle), L = pv.spec?.l || 44;
            spot.position.set(pv.x + ca * L * 0.45, 14, pv.y + sa * L * 0.45);
            spot.target.position.set(pv.x + ca * 400, 0, pv.y + sa * 400);
            spot.intensity = 900 * pal.lamps;
        } else spot.intensity = 0;
        assignLights();
        actors.end(); icons.end(); soft.end(); glow.end();
        for (const b of [icons, soft, glow]) b.setFog(scene.fog.color, scene.fog.near, scene.fog.far);
        if (atlas.dirty) { atlasTex.needsUpdate = true; atlas.dirty = false; }
        lap('upload');
        // viewmodel
        const p = world.player;
        const kind = mode !== 'fps' || blend < 0.7 ? null : p.vehicle ? (p.vehicle.spec?.kind === 'bike' ? 'bike' : 'car') : 'foot';
        if (kind) {
            const g = gangById(world.profile.gang);
            fpsOpts.weapon = world.profile.weapon; fpsOpts._shirt = g && g.kind !== 'mc' ? g.color : p.color;
            // huvudgung av/på och fri blick i bilen (instrumentbrädan sitter kvar i bilen)
            fpsOpts.bob = opts.bob ?? 1; fpsOpts.lookYaw = opts.lookYaw || 0; fpsOpts.lookPitch = opts.lookPitch || 0;
            vm.update(p, fpsOpts, kind, dt, T, look);
        }
        lap('viewmodel');
        const tCpu = performance.now();
        renderer.info.reset();
        renderer.clear();
        renderer.render(scene, camera);
        if (kind) {
            if (vm.cam.fov !== camera.fov || vm.cam.aspect !== camera.aspect) vm.resize(camera.aspect, camera.fov);
            renderer.clearDepth();
            renderer.render(vm.scene, vm.cam);
        }
        lap('gl');
        const t1 = performance.now();
        stats.cpuMs = stats.cpuMs * 0.9 + (t1 - t0) * 0.1;
        stats.buildMs = (stats.buildMs || 0) * 0.9 + (tCpu - t0) * 0.1;
        stats.calls = renderer.info.render.calls;
        stats.triangles = renderer.info.render.triangles;
        stats.figures = actors.meshes.torso.count;
        stats.vehicles = actors.vmeshes.wheel.count / 4;
    }

    const proj = new THREE.Vector3();
    let W = 1, H = 1, dpr = 1;
    return {
        renderer, scene, camera, stats,
        render,
        resize(w, h, pr) {
            W = Math.max(1, w); H = Math.max(1, h); dpr = pr;
            renderer.setPixelRatio(pr);
            renderer.setSize(W, H, false);
            camera.aspect = W / H; camera.updateProjectionMatrix();
            vm.resize(camera.aspect, camera.fov);
            stats.dpr = pr;
        },
        worldToScreen(x, y, z = 0, out = { x: 0, y: 0, visible: false }) {
            proj.set(x, z, y).applyMatrix4(camera.matrixWorldInverse);
            const depth = -proj.z, front = depth > camera.near;
            proj.applyMatrix4(camera.projectionMatrix);
            out.x = (proj.x + 1) / 2 * W;
            out.y = (1 - proj.y) / 2 * H;
            out.visible = front && out.x >= 0 && out.x <= W && out.y >= 0 && out.y <= H;
            out.depth = front ? depth : Infinity; // avstånd från kameran i px (för att skala text)
            return out;
        },
        get mode() { return lastMode; },
        // Förbered utan att visa: bygg staden och kompilera shadrarna (parallellt om GPU:n kan)
        async prepare(world) {
            ensureCity(world.city);
            const was = camera.position.clone();
            camera.position.set(world.player.x, 200, world.player.y + 300);
            camera.lookAt(world.player.x, 0, world.player.y);
            camera.updateMatrixWorld();
            try {
                if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
                else renderer.compile(scene, camera);
                // ladda upp texturerna (marken, fasaderna, atlasen) nu i stället för vid första bilden
                const seen = new Set();
                scene.traverse(o => {
                    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
                    for (const m of mats) for (const k of ['map', 'emissiveMap', 'normalMap']) {
                        const t = m[k] || (m.uniforms && m.uniforms[k] && m.uniforms[k].value);
                        if (t && t.isTexture && !seen.has(t)) { seen.add(t); renderer.initTexture(t); }
                    }
                });
            } catch (e) { /* kompileras/laddas vid första bilden i stället */ }
            camera.position.copy(was);
        },
        // Kamerans läge i världen: x, y, z (px), yaw (2D-vinkel kameran tittar åt), pitch, fov.
        // Bra för den som kopplar in: styrning relativt kameran, minikartans riktning.
        getView(out = {}) {
            out.x = cur.x; out.y = cur.y; out.z = cur.z;
            out.yaw = Math.atan2(cur.ly - cur.y, cur.lx - cur.x);
            out.pitch = Math.atan2(cur.lz - cur.z, Math.hypot(cur.lx - cur.x, cur.ly - cur.y));
            out.fov = camera.fov; out.mode = lastMode; out.blend = blend;
            return out;
        },
        dispose() {
            actors.dispose(); vm.dispose();
            icons.dispose(); soft.dispose(); glow.dispose();
            if (city) city.dispose();
            if (room) room.dispose();
            for (const d of disposables) d.dispose?.();
            renderer.dispose();
            try { renderer.forceContextLoss(); } catch (e) { /* redan borta */ }
        }
    };
}
