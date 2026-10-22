// ═══════════════════════════════════════════
//  STAN 3D — den stillastående staden
//  Mark (2D-målningen som textur: en grov för hela
//  stan + skarpa bitar nära kameran), hav och kajer,
//  husen (sammanslagna, fem material), träd, gat-
//  lampor, trottoarkanter, yttre muren, dörrar,
//  telefonkiosker och en silhuett av stan runt om.
// ═══════════════════════════════════════════

import { TILE, T, N, E, S, W, DX, DY, GANGS } from '../constants.js';
import { tileAt } from '../map.js';
import { SHOPS } from '../../data/gameData.js';
import { GeoBuilder, lin, mul, mix3 } from './geo.js';
import { paintGround, paintFacade, paintRoof, paintWaterNormals, FACADE } from './paint.js';
import { floorsOf, buildingHeight, facadeStyle, hasGable, GROUND_FLOOR_H, FLOOR_H, MAX_FLOORS } from './math.js';

const CHUNK = 8, CHUNK_PX = CHUNK * TILE;
const BAY = TILE / 3;                 // ett fönsterfack
const WALL_H = 46;                    // yttre muren
const SEA_Y = -7;
const H_ = (x, y) => {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function createCity3D(THREE, { city, scene, anisotropy = 4, nearPx = 512, maxNear = 9 }) {
    const group = new THREE.Group();
    group.name = 'city';
    scene.add(group);
    const disposables = [];
    const keep = o => { disposables.push(o); return o; };
    const canvasTex = (cv, opts = {}) => {
        const t = new THREE.CanvasTexture(cv);
        t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.anisotropy = opts.aniso ?? anisotropy;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
        return keep(t);
    };
    const WPX = city.w * TILE, Hh = city.h * TILE;

    // ═══ MARK ═══
    // Grov textur över hela stan (0,5 texel/px) — 64 bitar i en geometri; bitar nära kameran byts mot skarpa
    const farPx = 2048;
    const farCanvas = paintGround(city, 0, 0, city.w, farPx);
    const farTex = canvasTex(farCanvas);
    const groundMat = keep(new THREE.MeshLambertMaterial({ map: farTex, alphaTest: 0.5 }));
    const nChunks = (city.w / CHUNK) * (city.h / CHUNK);
    const farGeo = new THREE.BufferGeometry();
    const fPos = new Float32Array(nChunks * 4 * 3), fUv = new Float32Array(nChunks * 4 * 2), fNor = new Float32Array(nChunks * 4 * 3);
    const fIdx = [];
    const chunkCorners = [];
    for (let cy = 0; cy < city.h / CHUNK; cy++) for (let cx = 0; cx < city.w / CHUNK; cx++) {
        const i = cy * (city.w / CHUNK) + cx;
        const x0 = cx * CHUNK_PX, z0 = cy * CHUNK_PX, x1 = x0 + CHUNK_PX, z1 = z0 + CHUNK_PX;
        const corners = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
        chunkCorners.push(corners);
        corners.forEach(([x, z], k) => {
            fPos.set([x, 0, z], (i * 4 + k) * 3);
            fNor.set([0, 1, 0], (i * 4 + k) * 3);
            fUv.set([x / WPX, 1 - z / Hh], (i * 4 + k) * 2);
        });
        const o = i * 4;
        fIdx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    farGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    farGeo.setAttribute('normal', new THREE.BufferAttribute(fNor, 3));
    farGeo.setAttribute('uv', new THREE.BufferAttribute(fUv, 2));
    farGeo.setIndex(fIdx);
    farGeo.computeBoundingSphere();
    keep(farGeo);
    const farMesh = new THREE.Mesh(farGeo, groundMat);
    farMesh.name = 'ground-far';
    farMesh.renderOrder = -2;
    group.add(farMesh);
    const hidden = new Uint8Array(nChunks);
    const setHidden = (i, on) => {
        if (hidden[i] === (on ? 1 : 0)) return;
        hidden[i] = on ? 1 : 0;
        const c = chunkCorners[i];
        for (let k = 0; k < 4; k++) {
            // dold bit: alla hörn i samma punkt (degenererad, ritas inte)
            const [x, z] = on ? c[0] : c[k];
            fPos[(i * 4 + k) * 3] = x; fPos[(i * 4 + k) * 3 + 2] = z;
        }
        farGeo.attributes.position.needsUpdate = true;
    };

    // Skarpa bitar nära kameran: målas en i taget och sparas en stund
    const nearGeo = keep(new THREE.PlaneGeometry(CHUNK_PX, CHUNK_PX).rotateX(-Math.PI / 2));
    const nearCache = new Map(); // index → { tex, mat, used }
    const nearMeshes = [];
    for (let i = 0; i < maxNear; i++) {
        const m = new THREE.Mesh(nearGeo, groundMat);
        m.visible = false; m.renderOrder = -2; m.name = 'ground-near';
        group.add(m); nearMeshes.push(m);
    }
    let nearFrame = 0;
    const cw = city.w / CHUNK;
    function paintChunk(i) {
        const cx = i % cw, cy = Math.floor(i / cw);
        const cv = paintGround(city, cx * CHUNK, cy * CHUNK, CHUNK, nearPx);
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = anisotropy;
        tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
        const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
        const e = { tex, mat, used: nearFrame };
        nearCache.set(i, e);
        return e;
    }
    const order = [];
    // fx, fz: punkten kameran tittar på. Målar högst `budget` nya bitar per bildruta.
    function updateGround(fx, fz, radius, budget = 1) {
        nearFrame++;
        order.length = 0;
        for (let i = 0; i < nChunks; i++) {
            const cx = (i % cw) * CHUNK_PX + CHUNK_PX / 2, cz = Math.floor(i / cw) * CHUNK_PX + CHUNK_PX / 2;
            const dx = Math.max(0, Math.abs(fx - cx) - CHUNK_PX / 2), dz = Math.max(0, Math.abs(fz - cz) - CHUNK_PX / 2);
            const d = Math.hypot(dx, dz);
            if (d < radius) order.push(d * 1000 + i);
        }
        order.sort((a, b) => a - b);
        let used = 0, painted = 0;
        for (let k = 0; k < order.length && used < maxNear; k++) {
            const i = order[k] % 1000;
            let e = nearCache.get(i);
            if (!e) { if (painted >= budget) continue; e = paintChunk(i); painted++; }
            e.used = nearFrame;
            const m = nearMeshes[used++];
            m.position.set((i % cw) * CHUNK_PX + CHUNK_PX / 2, 0, Math.floor(i / cw) * CHUNK_PX + CHUNK_PX / 2);
            m.material = e.mat;
            m.visible = true;
        }
        for (let k = used; k < nearMeshes.length; k++) nearMeshes[k].visible = false;
        for (let i = 0; i < nChunks; i++) { const e = nearCache.get(i); setHidden(i, !!e && e.used === nearFrame); }
        // städa bort de som inte använts på länge
        while (nearCache.size > maxNear + 6) {
            let old = -1, ou = Infinity;
            for (const [k, v] of nearCache) if (v.used < ou) { ou = v.used; old = k; }
            if (old < 0 || ou >= nearFrame) break;
            const e = nearCache.get(old);
            e.tex.dispose(); e.mat.dispose(); nearCache.delete(old);
        }
        return painted;
    }

    // ═══ HAV, LAND RUNT OM OCH KAJER ═══
    const seaNorm = canvasTex(paintWaterNormals(), { linear: true, repeat: true, aniso: 2 });
    seaNorm.repeat.set(60, 60);
    const seaMat = keep(new THREE.MeshPhongMaterial({ color: 0x184a78, specular: 0x6f8fb0, shininess: 70, normalMap: seaNorm, normalScale: new THREE.Vector2(0.45, 0.45) }));
    const seaB = new GeoBuilder(1);
    const SEA0 = 61 * TILE - 2, FAR = 16000;
    const seaQuad = (x0, z0, x1, z1) => seaB.quad([x0, SEA_Y, z1], [x1, SEA_Y, z1], [x1, SEA_Y, z0], [x0, SEA_Y, z0], [0, 1, 0], [x0 / 400, -z1 / 400, x1 / 400, -z1 / 400, x1 / 400, -z0 / 400, x0 / 400, -z0 / 400], [1, 1, 1]);
    seaQuad(SEA0, -FAR, FAR, FAR);
    seaQuad(-FAR, SEA0, SEA0, FAR);
    const seaGeo = keep(seaB.build(THREE));
    const sea = new THREE.Mesh(seaGeo, seaMat);
    sea.name = 'sea';
    group.add(sea);

    // Land norr och väster om muren
    const landB = new GeoBuilder(1);
    const landC = lin('#1e2a1c');
    landB.quad([-FAR, 0, 0], [SEA0, 0, 0], [SEA0, 0, -FAR], [-FAR, 0, -FAR], [0, 1, 0], null, landC);
    landB.quad([-FAR, 0, SEA0], [0, 0, SEA0], [0, 0, 0], [-FAR, 0, 0], [0, 1, 0], null, landC);
    // Kajer: där land möter vatten
    const quayC = lin('#4a4743'), quayLo = lin('#2a2826');
    const quay = (ax, az, bx, bz, nx, nz) => landB.quad([ax, SEA_Y - 2, az], [bx, SEA_Y - 2, bz], [bx, 0.2, bz], [ax, 0.2, az], [nx, 0, nz], null, [quayLo, quayLo, quayC, quayC]);
    for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) {
        if (tileAt(city, tx, ty) === T.WATER) continue;
        const x0 = tx * TILE, z0 = ty * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
        if (tx + 1 < city.w && tileAt(city, tx + 1, ty) === T.WATER) quay(x1, z1, x1, z0, 1, 0);
        if (ty + 1 < city.h && tileAt(city, tx, ty + 1) === T.WATER) quay(x0, z1, x1, z1, 0, 1);
        if (tx > 0 && tileAt(city, tx - 1, ty) === T.WATER) quay(x0, z0, x0, z1, -1, 0);
        if (ty > 0 && tileAt(city, tx, ty - 1) === T.WATER) quay(x1, z0, x0, z0, 0, -1);
    }
    quay(SEA0, 0, SEA0, -FAR, 1, 0);
    quay(-FAR, SEA0, 0, SEA0, 0, 1);
    const landGeo = keep(landB.build(THREE));
    const plainMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const land = new THREE.Mesh(landGeo, plainMat);
    land.name = 'land';
    group.add(land);

    // ═══ HUS ═══
    // grupper: 0 bostad, 1 kontor, 2 industri, 3 tak, 4 enfärgat (kanter, ventiler, muren, kiosker, dörrar)
    const facTex = {}, litTex = {};
    for (const st of ['res', 'office', 'ind']) {
        facTex[st] = canvasTex(paintFacade(st, false), { repeat: true });
        litTex[st] = canvasTex(paintFacade(st, true), { repeat: true });
    }
    const roofTex = canvasTex(paintRoof(), { repeat: true });
    const facMats = ['res', 'office', 'ind'].map(st => keep(new THREE.MeshLambertMaterial({
        vertexColors: true, map: facTex[st], emissiveMap: litTex[st], emissive: new THREE.Color(0xffffff), emissiveIntensity: 0
    })));
    const roofMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex }));
    const B = new GeoBuilder(5);
    const STYLE_G = { res: 0, office: 1, ind: 2 };
    const fv = 1 / MAX_FLOORS;
    const heights = new Float32Array(city.buildings.length);

    // En vägg från (ax, az) till (bx, bz); normalen pekar ut från huset
    function wall(b, ax, az, bx, bz, nrm, Hb, col, g, salt) {
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        // Dela långa väggar i partier (2–4 rutor) med egen nyans och eget fönstermönster
        let s = 0, k = 0;
        while (s < len - 1) {
            const segT = 2 + Math.floor(H_(b.id * 31 + salt, k) * 3);
            const e = Math.min(len, s + segT * TILE);
            const shade = 0.92 + H_(b.id + k * 7, salt) * 0.16;
            const c = mul(col, shade);
            const lo = mul(c, 0.55), mid = mul(c, 0.9), hi = mul(c, 1.04);
            const p0 = [ax + dx * s, az + dz * s], p1 = [ax + dx * e, az + dz * e];
            const u0 = Math.floor(H_(b.id, k + salt * 3) * 8) / 8, u1 = u0 + (e - s) / BAY / FACADE.cols;
            const top = Hb;
            // bottenvåning
            B.quad([p0[0], 0, p0[1]], [p1[0], 0, p1[1]], [p1[0], GROUND_FLOOR_H, p1[1]], [p0[0], GROUND_FLOOR_H, p0[1]], nrm,
                [u0, 0, u1, 0, u1, fv, u0, fv], [lo, lo, mid, mid], g);
            // våningarna ovanför
            const fl = (top - GROUND_FLOOR_H) / FLOOR_H;
            B.quad([p0[0], GROUND_FLOOR_H, p0[1]], [p1[0], GROUND_FLOOR_H, p1[1]], [p1[0], top, p1[1]], [p0[0], top, p0[1]], nrm,
                [u0, fv, u1, fv, u1, fv * (1 + fl), u0, fv * (1 + fl)], [mid, mid, hi, hi], g);
            // lisen mellan partierna
            if (s > 0) {
                const cx = p0[0] + nrm[0] * 0.8, cz = p0[1] + nrm[2] * 0.8;
                const hx = 2.2 * Math.abs(dx) + 1.6 * Math.abs(nrm[0]), hz = 2.2 * Math.abs(dz) + 1.6 * Math.abs(nrm[2]);
                B.box(cx - hx, 0, cz - hz, cx + hx, top, cz + hz, mul(col, 0.7), 4, { ao: 0.6 });
            }
            s = e; k++;
        }
    }

    const doorsAt = new Map(); // byggnad → dörrar (för markiser)
    city.buildings.forEach((b, bi) => {
        const x0 = b.x * TILE, z0 = b.y * TILE, x1 = x0 + b.w * TILE, z1 = z0 + b.h * TILE;
        const Hb = buildingHeight(b);
        heights[bi] = Hb;
        const style = facadeStyle(b);
        const g = STYLE_G[style];
        const roof = lin(b.roof), roofDark = lin(b.roofDark);
        let col = style === 'office' ? mix3(lin(b.roof, 1.05), lin('#a9b8c8'), 0.45) : style === 'ind' ? mix3(lin(b.roof, 0.95), lin('#9a958c'), 0.35) : mix3(lin(b.roof, 1.1), lin('#d9cbb6'), 0.4);
        if (b.hq) col = lin('#5a6d80');
        // fyra väggar (normaler utåt)
        // fyra väggar; ordningen (moturs sett utifrån) ger normal utåt och fönster som läses vänster→höger
        wall(b, x1, z0, x0, z0, [0, 0, -1], Hb, col, g, 1);  // norr
        wall(b, x0, z1, x1, z1, [0, 0, 1], Hb, col, g, 2);   // söder
        wall(b, x0, z0, x0, z1, [-1, 0, 0], Hb, col, g, 3);  // väster
        wall(b, x1, z1, x1, z0, [1, 0, 0], Hb, col, g, 4);   // öster
        // hörnlisener
        const pc = mul(col, 0.68);
        for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) B.box(cx - 2.6, 0, cz - 2.6, cx + 2.6, Hb + 0.5, cz + 2.6, pc, 4, { ao: 0.55 });
        // sockel
        const sc = mul(col, 0.45);
        B.box(x0 - 1.2, 0, z0 - 1.2, x1 + 1.2, 4, z1 + 1.2, sc, 4, { ao: 0.8 });
        if (hasGable(b)) {
            // Sadeltak längs husets långa led, med takfot
            const along = b.w >= b.h, o = 5;
            const rx0 = x0 - o, rx1 = x1 + o, rz0 = z0 - o, rz1 = z1 + o;
            const span = along ? (z1 - z0) : (x1 - x0);
            const rh = Math.min(70, span * 0.42);
            const top = Hb + rh, eave = Hb - 2;
            const rc = roof, rcd = mul(roof, 0.8);
            if (along) {
                const mz = (z0 + z1) / 2;
                const n1 = norm([0, span / 2 + o, -rh]), n2 = norm([0, span / 2 + o, rh]);
                B.quad([rx1, eave, rz0], [rx0, eave, rz0], [rx0, top, mz], [rx1, top, mz], n1, [rx1 / 64, 0, rx0 / 64, 0, rx0 / 64, 1.6, rx1 / 64, 1.6], [rcd, rcd, rc, rc], 3);
                B.quad([rx0, eave, rz1], [rx1, eave, rz1], [rx1, top, mz], [rx0, top, mz], n2, [rx0 / 64, 0, rx1 / 64, 0, rx1 / 64, 1.6, rx0 / 64, 1.6], [rcd, rcd, rc, rc], 3);
                B.tri([x0, Hb, z0], [x0, Hb, z1], [x0, top - 2, mz], [-1, 0, 0], col, 4);
                B.tri([x1, Hb, z1], [x1, Hb, z0], [x1, top - 2, mz], [1, 0, 0], col, 4);
            } else {
                const mx = (x0 + x1) / 2;
                const n1 = norm([-rh, span / 2 + o, 0]), n2 = norm([rh, span / 2 + o, 0]);
                B.quad([rx0, eave, rz0], [rx0, eave, rz1], [mx, top, rz1], [mx, top, rz0], n1, [rz0 / 64, 0, rz1 / 64, 0, rz1 / 64, 1.6, rz0 / 64, 1.6], [rcd, rcd, rc, rc], 3);
                B.quad([rx1, eave, rz1], [rx1, eave, rz0], [mx, top, rz0], [mx, top, rz1], n2, [rz1 / 64, 0, rz0 / 64, 0, rz0 / 64, 1.6, rz1 / 64, 1.6], [rcd, rcd, rc, rc], 3);
                B.tri([x1, Hb, z0], [x0, Hb, z0], [mx, top - 2, z0], [0, 0, -1], col, 4);
                B.tri([x0, Hb, z1], [x1, Hb, z1], [mx, top - 2, z1], [0, 0, 1], col, 4);
            }
            // skorsten
            const cx = x0 + (x1 - x0) * (0.3 + H_(b.id, 5) * 0.4), cz = z0 + (z1 - z0) * (0.3 + H_(b.id, 6) * 0.4);
            B.box(cx - 5, Hb, cz - 5, cx + 5, top + 8, cz + 5, mul(lin('#7a4a3a'), 1), 4, { ao: 0.8 });
            heights[bi] = top;
            return;
        }
        // Platt tak med takfot/bröstning
        const tuv = (x, z) => [x / 96, -z / 96];
        B.quad([x0, Hb, z1], [x1, Hb, z1], [x1, Hb, z0], [x0, Hb, z0], [0, 1, 0], [...tuv(x0, z1), ...tuv(x1, z1), ...tuv(x1, z0), ...tuv(x0, z0)], roof, 3);
        const pt = 4.5, ph = 7, ov = 1.6;
        const pcol = b.hq ? lin('#e8b923') : mul(roofDark, 0.92); // HQ: gul kant som i 2D
        B.box(x0 - ov, Hb, z0 - ov, x1 + ov, Hb + ph, z0 + pt, pcol, 4, { ao: 0.85 });
        B.box(x0 - ov, Hb, z1 - pt, x1 + ov, Hb + ph, z1 + ov, pcol, 4, { ao: 0.85 });
        B.box(x0 - ov, Hb, z0 + pt, x0 + pt, Hb + ph, z1 - pt, pcol, 4, { ao: 0.85 });
        B.box(x1 - pt, Hb, z0 + pt, x1 + ov, Hb + ph, z1 - pt, pcol, 4, { ao: 0.85 });
        // Takdetaljer som i 2D (ventilationshus) + lite extra
        const rw = x1 - x0, rh = z1 - z0;
        for (const det of b.details || []) {
            const s = Math.min(rw, rh) * det.s;
            const dx = x0 + rw * det.u, dz = z0 + rh * det.v;
            const h = 6 + s * 0.22;
            B.box(dx, Hb, dz, dx + s, Hb + h, dz + s, mul(roofDark, 0.95), 4, { top: mul(roofDark, 1.1), ao: 0.7 });
            B.box(dx + s * 0.2, Hb + h, dz + s * 0.2, dx + s * 0.8, Hb + h + 2.5, dz + s * 0.8, lin('#555b63'), 4);
        }
        const fl = floorsOf(b);
        if (fl >= 4 && rw >= 128 && rh >= 128) {
            // trapphus på taket
            const hx = x0 + 18 + H_(b.id, 9) * (rw - 60), hz = z0 + 18 + H_(b.id, 10) * (rh - 60);
            B.box(hx, Hb, hz, hx + 26, Hb + 24, hz + 22, mul(col, 0.85), 4, { top: roofDark });
        }
        if (style === 'office' && fl >= 5) {
            // vattentank och antenn
            const tx = x0 + rw * 0.7, tz = z0 + rh * 0.3;
            B.cylinder(tx, Hb, tz, 11, 8, 8, lin('#3f3f46'), 4);
            B.cylinder(tx, Hb + 8, tz, 13, 20, 10, lin('#6b5a48'), 4, lin('#4a3c30'));
            B.box(x0 + rw * 0.3 - 1, Hb, z0 + rh * 0.6 - 1, x0 + rw * 0.3 + 1, Hb + 70, z0 + rh * 0.6 + 1, lin('#9ca3af'), 4);
        }
        // AC-aggregat
        const ac = 1 + Math.floor(H_(b.id, 12) * 3);
        for (let i = 0; i < ac; i++) {
            const ax = x0 + 12 + H_(b.id + i, 13) * (rw - 34), az = z0 + 12 + H_(b.id + i, 14) * (rh - 30);
            B.box(ax, Hb, az, ax + 14, Hb + 9, az + 10, lin('#c4c8cc'), 4, { top: lin('#9aa0a6') });
        }
    });

    // Yttre muren (tegel)
    const brick = lin('#3e3033'), brickTop = lin('#2a2224');
    for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) {
        if (tileAt(city, tx, ty) !== T.WALL) continue;
        B.box(tx * TILE, 0, ty * TILE, tx * TILE + TILE, WALL_H, ty * TILE + TILE, brick, 4, { top: brickTop, ao: 0.6 });
    }

    // Trottoarkanter mot gatan
    const curbC = lin('#9ea1a8');
    for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) {
        if (tileAt(city, tx, ty) !== T.SIDEWALK) continue;
        const x0 = tx * TILE, z0 = ty * TILE, x1 = x0 + TILE, z1 = z0 + TILE;
        for (let d = 0; d < 4; d++) {
            if (tileAt(city, tx + DX[d], ty + DY[d]) !== T.ROAD) continue;
            if (d === N) B.box(x0, 0, z0, x1, 2.6, z0 + 4, curbC, 4, { ao: 0.75 });
            if (d === S) B.box(x0, 0, z1 - 4, x1, 2.6, z1, curbC, 4, { ao: 0.75 });
            if (d === W) B.box(x0, 0, z0, x0 + 4, 2.6, z1, curbC, 4, { ao: 0.75 });
            if (d === E) B.box(x1 - 4, 0, z0, x1, 2.6, z1, curbC, 4, { ao: 0.75 });
        }
    }

    // Dörrar: på husväggen bakom trottoaren (som i 2D: 5 px framför väggen)
    const doorList = [];
    const m = city.markers;
    const addDoor = (o, kind, extra = {}) => {
        if (!o) return;
        const nx = DX[o.side], nz = DY[o.side];           // pekar in i huset
        const wx = o.x + nx * 5, wz = o.y + nz * 5;        // väggens yta
        const w = extra.wide ? 30 : 22, h = extra.wide ? 40 : 36;
        const tx = -nz, tz = nx;                           // längs väggen
        const frame = lin(extra.frame || '#3a2a1a'), door = lin(extra.door || '#2a1a0e');
        const ox = -nx * 1.2, oz = -nz * 1.2;              // lite ut från väggen
        // karm
        B.box(Math.min(wx - tx * (w / 2 + 3), wx + tx * (w / 2 + 3)) + Math.min(0, ox), 0, Math.min(wz - tz * (w / 2 + 3), wz + tz * (w / 2 + 3)) + Math.min(0, oz),
            Math.max(wx - tx * (w / 2 + 3), wx + tx * (w / 2 + 3)) + Math.max(0, ox), h + 3, Math.max(wz - tz * (w / 2 + 3), wz + tz * (w / 2 + 3)) + Math.max(0, oz), frame, 4, { ao: 0.8 });
        // dörrbladet en aning utanför karmen
        const ex = -nx * 1.6, ez = -nz * 1.6;
        const a = [wx - tx * w / 2 + ex, wz - tz * w / 2 + ez], bb = [wx + tx * w / 2 + ex, wz + tz * w / 2 + ez];
        B.quad([a[0], 0, a[1]], [bb[0], 0, bb[1]], [bb[0], h, bb[1]], [a[0], h, a[1]], [-nx, 0, -nz], null, [mul(door, 0.6), mul(door, 0.6), door, door], 4);
        // markis över butiksdörrar
        if (extra.awning) {
            const ac = lin(extra.awning);
            const d0 = 0, d1 = 14;
            const p = (s, d, y) => [wx + tx * s - nx * d, y, wz + tz * s - nz * d];
            B.quad(p(w / 2 + 8, d0, h + 12), p(-w / 2 - 8, d0, h + 12), p(-w / 2 - 8, d1, h + 4), p(w / 2 + 8, d1, h + 4), norm([-nx * 8, 14, -nz * 8]), null, ac, 4);
            B.quad(p(w / 2 + 8, d1, h + 4), p(-w / 2 - 8, d1, h + 4), p(-w / 2 - 8, d1, h - 1), p(w / 2 + 8, d1, h - 1), [-nx, 0, -nz], null, mul(ac, 0.8), 4);
        }
        doorList.push({ x: o.x, y: o.y, side: o.side, wx, wz, nx, nz, h, kind, ...extra });
    };
    const AWN = ['#b91c1c', '#15803d', '#1d4ed8', '#a16207', '#7e22ce', '#0f766e', '#be185d', '#c2410c'];
    for (const b of m.businesses || []) addDoor(b.door, 'business', { slot: b.slot, awning: AWN[b.slot % AWN.length], frame: '#5a3a1a' });
    for (const h of m.houses || []) addDoor(h.door, 'house', { id: h.id, frame: '#4a4a4a' });
    if (m.bank) addDoor(m.bank.door, 'bank', { frame: '#6d5f9a', door: '#1e1b3a', wide: true });
    if (m.stripclub) addDoor(m.stripclub.door, 'stripclub', { frame: '#f472b6', door: '#12060f', wide: true });
    if (m.guns) addDoor(m.guns.door, 'gunshop', { frame: '#f97316', door: '#1a0d05', wide: true });

    // Telefonkiosker i gängets färg
    for (const ph of m.phones || []) {
        if (!ph) continue;
        const gc = lin(GANGS.find(g => g.id === ph.gang)?.color || '#888');
        const x = ph.x, z = ph.y;
        B.box(x - 8, 0, z - 8, x + 8, 3, z + 8, lin('#333'), 4);
        B.box(x - 7, 3, z - 7, x + 7, 36, z + 7, lin('#1f3346'), 4, { ao: 0.9 });
        B.box(x - 8.5, 36, z - 8.5, x + 8.5, 42, z + 8.5, gc, 4, { top: mul(gc, 0.8) });
    }

    // Gatumöbler längs husväggarna: soptunnor, bänkar, brandposter, planteringar
    const avoid = [];
    const addAvoid = o => { if (o) avoid.push(o.door ? o.door : o); };
    [m.home, m.dealer, m.recruit, m.club, m.guns, m.fence, m.bank, m.stripclub].forEach(addAvoid);
    [...(m.phones || []), ...(m.sprays || []), ...(m.businesses || []), ...(m.houses || [])].forEach(addAvoid);
    for (const l of city.lights || []) avoid.push(l);
    const free = (x, y) => avoid.every(o => Math.hypot(o.x - x, o.y - y) > 46);
    const binC = lin('#2f5d3a'), lidC = lin('#1f3d27'), woodC = lin('#8a5a33'), ironC = lin('#26282c'), redC = lin('#c0262d'), potC = lin('#6b4a35'), bushC = lin('#2f6b2a');
    for (let ty = 1; ty < city.h - 1; ty++) for (let tx = 1; tx < city.w - 1; tx++) {
        if (tileAt(city, tx, ty) !== T.SIDEWALK) continue;
        const r = H_(tx * 3 + 7, ty * 5 + 1);
        if (r > 0.2) continue;
        let d = -1;
        for (let k = 0; k < 4; k++) if (tileAt(city, tx + DX[k], ty + DY[k]) === T.BUILDING) { d = k; break; }
        if (d < 0) continue;
        // mot väggen, lite åt sidan
        const along = (H_(tx, ty * 9) - 0.5) * 30;
        const cx = tx * TILE + 32 + DX[d] * 20 + (DX[d] ? 0 : along), cy = ty * TILE + 32 + DY[d] * 20 + (DY[d] ? 0 : along);
        if (!free(cx, cy)) continue;
        const kind = Math.floor(H_(tx + 11, ty + 13) * 4);
        const horiz = DX[d] === 0; // väggen ligger norr/söder → bänken längs x
        if (kind === 0) {
            B.cylinder(cx, 0, cy, 5.2, 14, 8, binC, 4);
            B.cylinder(cx, 14, cy, 5.8, 2, 8, lidC, 4);
        } else if (kind === 1) {
            const hw = horiz ? 14 : 4.5, hd = horiz ? 4.5 : 14;
            B.box(cx - hw, 7, cy - hd, cx + hw, 9, cy + hd, woodC, 4, { ao: 0.9 });
            for (const s of [-1, 1]) {
                const lx = cx + (horiz ? s * (hw - 2) : 0), ly = cy + (horiz ? 0 : s * (hd - 2));
                B.box(lx - 1.2, 0, ly - 1.2, lx + 1.2, 7, ly + 1.2, ironC, 4);
            }
            // ryggstöd mot väggen
            const bx = cx + DX[d] * 4, by = cy + DY[d] * 4;
            B.box(bx - (horiz ? hw : 0.8), 9, by - (horiz ? 0.8 : hd), bx + (horiz ? hw : 0.8), 17, by + (horiz ? 0.8 : hd), woodC, 4, { ao: 0.85 });
        } else if (kind === 2) {
            B.cylinder(cx, 0, cy, 3, 9, 8, redC, 4);
            B.cylinder(cx, 9, cy, 2, 2.5, 8, mul(redC, 0.8), 4);
            B.box(cx - 4.5, 4.5, cy - 1, cx + 4.5, 6.5, cy + 1, mul(redC, 0.9), 4);
        } else {
            B.box(cx - 8, 0, cy - 8, cx + 8, 9, cy + 8, potC, 4, { top: lin('#3a2a1e') });
            B.cylinder(cx, 9, cy, 7, 9, 7, bushC, 4, mul(bushC, 1.25));
        }
    }

    const bGeo = keep(B.build(THREE));
    const buildings = new THREE.Mesh(bGeo, [facMats[0], facMats[1], facMats[2], roofMat, plainMat]);
    buildings.name = 'buildings';
    group.add(buildings);

    // ═══ KONTAKTSKUGGOR runt husen ═══
    const shB = new GeoBuilder(1);
    const SH = 26;
    const edgeUV = (u0, u1) => { const c = 10, uA = (c % 4) / 4 + 0.004, vT = 1 - Math.floor(c / 4) / 4 - 0.004, uB = uA + 0.242, vB = vT - 0.242; return [uA + (uB - uA) * u0, uA + (uB - uA) * u1, vB, vT]; };
    const [eu0, eu1, ev0, ev1] = edgeUV(0, 1);
    const shadeQuad = (ax, az, bx, bz, ox, oz) => {
        // a→b längs väggen, (ox, oz) utåt
        shB.quad([ax, 0.35, az], [bx, 0.35, bz], [bx + ox * SH, 0.35, bz + oz * SH], [ax + ox * SH, 0.35, az + oz * SH], [0, 1, 0], [eu0, ev0, eu0, ev1, eu1, ev1, eu1, ev0], [1, 1, 1]);
    };
    for (const b of city.buildings) {
        const x0 = b.x * TILE, z0 = b.y * TILE, x1 = x0 + b.w * TILE, z1 = z0 + b.h * TILE;
        shadeQuad(x0, z0, x1, z0, 0, -1);
        shadeQuad(x1, z1, x0, z1, 0, 1);
        shadeQuad(x0, z1, x0, z0, -1, 0);
        shadeQuad(x1, z0, x1, z1, 1, 0);
    }
    const shGeo = keep(shB.build(THREE));

    // ═══ TRÄD ═══
    const trees = [];
    for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) if (tileAt(city, tx, ty) === T.TREE) trees.push([tx * TILE + 32, ty * TILE + 32, 1]);
    // en skogsrand utanför muren gör horisonten levande
    for (let i = 0; i < 70; i++) {
        const a = H_(i, 77), d = 60 + H_(i, 78) * 700;
        if (i % 2) trees.push([-d, a * (SEA0 - 64), 0.8 + H_(i, 79) * 0.6]); else trees.push([a * (SEA0 - 64), -d, 0.8 + H_(i, 80) * 0.6]);
    }
    const trunkGeo = keep(new THREE.CylinderGeometry(2.4, 3.4, 30, 6).translate(0, 15, 0));
    const crownGeo = keep(mergeCrowns(THREE));
    const trunkMat = keep(new THREE.MeshLambertMaterial({ color: 0x4a3423 }));
    const crownMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, trees.length);
    const tm = new THREE.Matrix4(), tq = new THREE.Quaternion(), ts = new THREE.Vector3(), tp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), tc = new THREE.Color();
    trees.forEach(([x, z, s], i) => {
        tq.setFromAxisAngle(up, H_(i, 3) * 6.28);
        ts.set(s * (0.9 + H_(i, 4) * 0.3), s * (0.85 + H_(i, 5) * 0.4), s * (0.9 + H_(i, 4) * 0.3));
        tp.set(x, 0, z);
        tm.compose(tp, tq, ts);
        trunks.setMatrixAt(i, tm); crowns.setMatrixAt(i, tm);
        tc.setHSL(0.26 + H_(i, 6) * 0.08, 0.45, 0.24 + H_(i, 7) * 0.08);
        crowns.setColorAt(i, tc);
    });
    trunks.name = 'trunks'; crowns.name = 'crowns';
    group.add(trunks, crowns);

    // ═══ GATLAMPOR ═══
    const lights = city.lights || [];
    const lampInfo = lights.map((l, i) => {
        // armen pekar mot gatan
        const tx = Math.round(l.x / TILE), ty = Math.round(l.y / TILE);
        let ax = 0, az = 0;
        for (const [ox, oy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
            if (tileAt(city, tx + ox, ty + oy) === T.ROAD) { ax += tx + ox + 0.5 - l.x / TILE; az += ty + oy + 0.5 - l.y / TILE; }
        }
        const a = ax || az ? Math.atan2(az, ax) : H_(i, 1) * 6.28;
        return { x: l.x, y: l.y, a, hx: l.x + Math.cos(a) * 20, hy: l.y + Math.sin(a) * 20 };
    });
    const poleGeo = keep(mergeLamp(THREE));
    const headGeo = keep(new THREE.BoxGeometry(9, 2.4, 6).translate(20, 71, 0));
    const poleMat = keep(new THREE.MeshLambertMaterial({ color: 0x2f3338 }));
    const headMat = keep(new THREE.MeshBasicMaterial({ color: 0xfff1c2 }));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, lampInfo.length));
    const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, lampInfo.length));
    lampInfo.forEach((l, i) => {
        tq.setFromAxisAngle(up, -l.a); ts.set(1, 1, 1); tp.set(l.x, 0, l.y);
        tm.compose(tp, tq, ts);
        poles.setMatrixAt(i, tm); heads.setMatrixAt(i, tm);
    });
    poles.count = heads.count = lampInfo.length;
    poles.name = 'lamp-poles'; heads.name = 'lamp-heads';
    group.add(poles, heads);

    // ═══ SILHUETT: avlägsna kvarter runt om (lysande fönster på natten, ingen dimma) ═══
    const skB = new GeoBuilder(1);
    const skyline = [];
    for (let i = 0; i < 150; i++) {
        const side = i % 4, t = H_(i, 41), d = 900 + H_(i, 42) * 2600;
        const w = 120 + H_(i, 43) * 260, dep = 120 + H_(i, 44) * 200, h = 120 + Math.pow(H_(i, 45), 2) * 560;
        let x, z;
        if (side === 0) { x = -1500 + t * (WPX + 3000); z = -d; }
        else if (side === 1) { x = -d; z = -1500 + t * (Hh + 3000); }
        else if (side === 2) { x = WPX + 600 + d * 1.3; z = -1500 + t * (Hh + 3000); }
        else { x = -1500 + t * (WPX + 3000); z = Hh + 600 + d * 1.3; }
        skyline.push([x, z, w, dep, h]);
    }
    for (const [x, z, w, dep, h] of skyline) {
        const x0 = x - w / 2, x1 = x + w / 2, z0 = z - dep / 2, z1 = z + dep / 2;
        const u = (a) => a / BAY / FACADE.cols, v = (y) => y / FLOOR_H / MAX_FLOORS + 0.5;
        const c = [1, 1, 1];
        skB.quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], [0, v(0), u(w), v(0), u(w), v(h), 0, v(h)], c);
        skB.quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], [0, v(0), u(w), v(0), u(w), v(h), 0, v(h)], c);
        skB.quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], [0, v(0), u(dep), v(0), u(dep), v(h), 0, v(h)], c);
        skB.quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], [0, v(0), u(dep), v(0), u(dep), v(h), 0, v(h)], c);
        skB.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [0, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0], [0.4, 0.4, 0.4]);
    }
    const skGeo = keep(skB.build(THREE));
    // Egen enkel shader: mörk silhuett i dis, tända fönster på natten, ljusare (disigare) nertill
    const skyMat = keep(new THREE.ShaderMaterial({
        uniforms: { map: { value: litTex.res }, base: { value: new THREE.Color(0x222233) }, haze: { value: new THREE.Color(0x888899) }, win: { value: 0 } },
        vertexShader: `varying vec2 vUv; varying float vH; void main() { vUv = uv; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 base; uniform vec3 haze; uniform float win; varying vec2 vUv; varying float vH;
            void main() {
                vec3 lit = texture2D(map, vUv).rgb;
                vec3 c = base + lit * win * 0.38;
                c = mix(haze, c, smoothstep(0.0, 320.0, vH) * 0.85);
                gl_FragColor = vec4(c, 1.0);
                #include <colorspace_fragment>
            }`,
        fog: false
    }));
    const skylineMesh = new THREE.Mesh(skGeo, skyMat);
    skylineMesh.name = 'skyline';
    skylineMesh.renderOrder = -5;
    group.add(skylineMesh);

    // ═══ API ═══
    const bldAt = (x, y) => {
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (tx < 0 || ty < 0 || tx >= city.w || ty >= city.h) return 0;
        const t = city.tiles[ty * city.w + tx];
        if (t === T.BUILDING) { const id = city.bld ? city.bld[ty * city.w + tx] : -1; return id >= 0 ? heights[id] : 120; }
        if (t === T.WALL) return WALL_H;
        if (t === T.TREE) return 50;
        return 0;
    };
    let seaT = 0;
    return {
        group, buildings, lampInfo, doorList, heights, shadowGeo: shGeo, facMats, skyMat, seaMat,
        heightAt: bldAt,
        blocked: (x, y, h) => bldAt(x, y) > h - 8,
        updateGround,
        // palett från dayPalette: tända fönster och lampor
        updateLook(pal, dt, horizonColor, zenithColor) {
            const win = pal.windows;
            for (const mt of facMats) mt.emissiveIntensity = win * 0.95;
            headMat.color.setRGB(0.25 + pal.lamps * 0.75, 0.24 + pal.lamps * 0.7, 0.2 + pal.lamps * 0.5, THREE.SRGBColorSpace);
            seaT += dt;
            seaNorm.offset.set(seaT * 0.004, seaT * 0.0025);
            // silhuetten: tonad mot horisonten (dis), tända fönster på natten
            skyMat.uniforms.haze.value.copy(horizonColor);
            skyMat.uniforms.base.value.copy(horizonColor).multiplyScalar(0.3).lerp(zenithColor, 0.25);
            skyMat.uniforms.win.value = win;
        },
        dispose() {
            scene.remove(group);
            for (const d of disposables) d.dispose?.();
            for (const e of nearCache.values()) { e.tex.dispose(); e.mat.dispose(); }
            nearCache.clear();
            trunks.dispose(); crowns.dispose(); poles.dispose(); heads.dispose();
        }
    };
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

// Trädkrona: tre klumpar i grönskalor (vertexfärg ljusare upptill)
function mergeCrowns(THREE) {
    const parts = [[0, 40, 0, 20], [-8, 34, 6, 14], [7, 36, -6, 13], [2, 50, 2, 12]];
    const geos = parts.map(([x, y, z, r], i) => {
        const g = new THREE.IcosahedronGeometry(r, i ? 0 : 1); // stora klumpen rundare, de små kantiga (färre trianglar)
        g.translate(x, y, z);
        const p = g.getAttribute('position'), col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { const k = 0.65 + 0.35 * Math.min(1, Math.max(0, (p.getY(i) - 24) / 36)); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
    });
    return mergeSimple(THREE, geos);
}
// Lyktstolpe med arm åt +x
function mergeLamp(THREE) {
    const pole = new THREE.CylinderGeometry(1.3, 1.9, 74, 6).translate(0, 37, 0).toNonIndexed();
    const base = new THREE.CylinderGeometry(2.8, 3.2, 5, 6).translate(0, 2.5, 0).toNonIndexed();
    const arm = new THREE.BoxGeometry(22, 1.6, 1.6).translate(10, 72.8, 0).toNonIndexed();
    return mergeSimple(THREE, [pole, base, arm]);
}
function mergeSimple(THREE, geos) {
    let n = 0;
    for (const g of geos) n += g.getAttribute('position').count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of geos) {
        pos.set(g.getAttribute('position').array, o * 3);
        nor.set(g.getAttribute('normal').array, o * 3);
        const c = g.getAttribute('color');
        if (c) col.set(c.array, o * 3); else col.fill(1, o * 3, (o + g.getAttribute('position').count) * 3);
        o += g.getAttribute('position').count;
        g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
}

export { SHOPS, SEA_Y, WALL_H };
