// ═══════════════════════════════════════════
//  STAN 3D — folk och fordon
//  Allt är instansierat: en InstancedMesh per
//  kroppsdel/bildel för ALLA figurer/fordon, så
//  antalet ritanrop är detsamma med 5 eller 100
//  gubbar. Matriserna skrivs direkt i buffertarna
//  (inga nya objekt per bildruta).
// ═══════════════════════════════════════════

import { rootMatrix, jointMatrix, applyMatrix, figurePose, parseColor, yawOf, CAR_H } from './math.js';
import { toLinear } from './batch.js';

const MAX_FIG = 200, MAX_CAR = 120;
// Färger som återanvänds varje bildruta (inga nya arrayer per anrop)
const K_0p04_0p04_0p05 = [0.04, 0.04, 0.05];
const K_0p05_0p05_0p06 = [0.05, 0.05, 0.06];
const K_0p05_0p1_0p35 = [0.05, 0.1, 0.35];
const K_0p07_0p07_0p08 = [0.07, 0.07, 0.08];
const K_0p08_0p06_0p05 = [0.08, 0.06, 0.05];
const K_0p08_0p08_0p08 = [0.08, 0.08, 0.08];
const K_0p11_0p3_0p85 = [0.11, 0.3, 0.85];
const K_0p15_0p35_1 = [0.15, 0.35, 1];
const K_0p16_0p16_0p18 = [0.16, 0.16, 0.18];
const K_0p1_0p1_0p11 = [0.1, 0.1, 0.11];
const K_0p1_0p1_0p12 = [0.1, 0.1, 0.12];
const K_0p35_0p05_0p05 = [0.35, 0.05, 0.05];
const K_0p42_0p04_0p04 = [0.42, 0.04, 0.04];
const K_0p45_0p05_0p05 = [0.45, 0.05, 0.05];
const K_0p55_0p55_0p5 = [0.55, 0.55, 0.5];
const K_0p63_0p38_0p03 = [0.63, 0.38, 0.03];
const K_0p75_0p75_0p7 = [0.75, 0.75, 0.7];
const K_0p75_0p75_0p78 = [0.75, 0.75, 0.78];
const K_0p82_0p82_0p78 = [0.82, 0.82, 0.78];
const K_0p85_0p05_0p04 = [0.85, 0.05, 0.04];
const K_0p8_0p08_0p06 = [0.8, 0.08, 0.06];
const K_0p99_0p85_0p2 = [0.99, 0.85, 0.2];
const K_1_0p12_0p1 = [1, 0.12, 0.1];
const K_1_0p15_0p1 = [1, 0.15, 0.1];
const K_1_0p1_0p08 = [1, 0.1, 0.08];
const K_1_0p88_0p25 = [1, 0.88, 0.25];
const K_1_0p95_0p8 = [1, 0.95, 0.8];
const K_1_0p96_0p82 = [1, 0.96, 0.82];
const K_1_1_1 = [1, 1, 1];

// ── Hjälp: geometri med vertexfärger ──
function paint(THREE, geo, fn) {
    const pos = geo.getAttribute('position'), n = pos.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
        col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
}
const flat = v => () => [v, v, v];
const ni = g => (g.index ? g.toNonIndexed() : g);

function merge(THREE, list) {
    // Enkel sammanslagning (position, normal, color, ev. uv)
    const geos = list.map(ni);
    let n = 0;
    for (const g of geos) n += g.getAttribute('position').count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    for (const g of geos) {
        const p = g.getAttribute('position'), q = g.getAttribute('normal'), c = g.getAttribute('color');
        pos.set(p.array, o * 3); nor.set(q.array, o * 3);
        if (c) col.set(c.array, o * 3); else col.fill(1, o * 3, (o + p.count) * 3);
        o += p.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
}

// ── Figurens delar (lokalt: framåt = +x, upp = +y, höger = +z; origo i leden) ──
function figureGeometries(THREE) {
    const G = {};
    // Ben från höften ner till foten, med sko
    const leg = new THREE.CylinderGeometry(2.25, 1.85, 13, 6); leg.translate(0, -6.5, 0);
    paint(THREE, leg, (x, y) => [y > -2 ? 0.92 : 1, y > -2 ? 0.92 : 1, y > -2 ? 0.92 : 1]);
    const shoe = new THREE.BoxGeometry(5.6, 2.4, 3.4); shoe.translate(1.1, -14, 0);
    paint(THREE, shoe, flat(0.22));
    G.leg = merge(THREE, [leg, shoe]);
    // Bål: bredare i axlarna, platt framifrån
    const torso = new THREE.CylinderGeometry(1, 0.82, 13.5, 10, 1);
    torso.scale(3.5, 1, 5.9); torso.translate(0, 6.75, 0);
    paint(THREE, torso, (x, y) => { const k = 0.82 + 0.18 * (y / 13.5); return [k, k, k]; });
    const shoulders = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    shoulders.scale(3.5, 2.4, 5.9); shoulders.translate(0, 13.4, 0);
    paint(THREE, shoulders, flat(1));
    G.torso = merge(THREE, [torso, shoulders]);
    // Arm (ärm) från axeln ner, hand i änden
    const arm = new THREE.CylinderGeometry(1.6, 1.35, 11.5, 6); arm.translate(0, -5.75, 0);
    paint(THREE, arm, (x, y) => [y > -1 ? 0.95 : 1, y > -1 ? 0.95 : 1, y > -1 ? 0.95 : 1]);
    G.arm = merge(THREE, [arm]);
    const hand = new THREE.SphereGeometry(1.85, 7, 5); hand.translate(0, -12.6, 0);
    paint(THREE, hand, flat(1));
    G.hand = merge(THREE, [hand]);
    // Huvud med hals; origo vid halsens bas
    const head = new THREE.IcosahedronGeometry(4.1, 1); head.scale(1, 1.1, 0.95); head.translate(0.3, 4.6, 0);
    paint(THREE, head, (x, y) => { const k = 0.9 + 0.1 * Math.min(1, y / 8); return [k, k, k]; });
    const neck = new THREE.CylinderGeometry(1.5, 1.7, 2.2, 6); neck.translate(0, 0.6, 0);
    paint(THREE, neck, flat(0.85));
    const nose = new THREE.BoxGeometry(1.2, 1.3, 1.1); nose.translate(4.35, 4.2, 0);
    paint(THREE, nose, flat(0.92));
    G.head = merge(THREE, [head, neck, nose]);
    // Hår: kalott som sitter lite bakåt
    const hair = new THREE.SphereGeometry(4.5, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55);
    hair.scale(1, 1.05, 1); hair.translate(-0.4, 5.3, 0);
    const back = new THREE.SphereGeometry(4.3, 10, 6, Math.PI * 0.6, Math.PI * 0.8, Math.PI * 0.3, Math.PI * 0.45);
    back.translate(-0.2, 4.8, 0);
    paint(THREE, hair, flat(1)); paint(THREE, back, flat(0.9));
    G.hair = merge(THREE, [hair, back]);
    // Ögon
    const e1 = new THREE.BoxGeometry(0.7, 1.1, 0.9); e1.translate(3.85, 5.4, -1.5);
    const e2 = new THREE.BoxGeometry(0.7, 1.1, 0.9); e2.translate(3.85, 5.4, 1.5);
    paint(THREE, e1, flat(1)); paint(THREE, e2, flat(1));
    G.eyes = merge(THREE, [e1, e2]);
    // Keps/mössa
    const cap = new THREE.SphereGeometry(4.75, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42); cap.translate(-0.2, 5.5, 0);
    const brim = new THREE.BoxGeometry(4.2, 0.7, 6.2); brim.translate(4.4, 6.8, 0);
    paint(THREE, cap, flat(1)); paint(THREE, brim, flat(0.8));
    G.cap = merge(THREE, [cap, brim]);
    // Skinnväst (öppen framtill) och ryggmärke
    const vest = new THREE.CylinderGeometry(1.08, 0.9, 12.5, 12, 1, true, Math.PI / 2 + 0.75, Math.PI * 2 - 1.5);
    vest.scale(3.6, 1, 6.05); vest.translate(0, 6.6, 0);
    paint(THREE, vest, flat(1));
    G.vest = merge(THREE, [vest]);
    const patch = new THREE.CircleGeometry(2.7, 12); patch.rotateY(-Math.PI / 2); patch.translate(-3.95, 8.5, 0);
    paint(THREE, patch, flat(1));
    G.patch = merge(THREE, [patch]);
    // Kjol/klänning från midjan
    const skirt = new THREE.CylinderGeometry(4.4, 6.6, 10, 12, 1, true); skirt.translate(0, -5, 0);
    paint(THREE, skirt, (x, y) => { const k = 0.85 + 0.15 * (1 + y / 10); return [k, k, k]; });
    G.skirt = merge(THREE, [skirt]);
    // Pistol i handen: pipan längs armen (−y)
    const gun = new THREE.BoxGeometry(1.7, 7, 1.6); gun.translate(0.4, -15, 0);
    const grip = new THREE.BoxGeometry(1.6, 1.5, 2.8); grip.translate(0.4, -12.4, 0);
    paint(THREE, gun, flat(1)); paint(THREE, grip, flat(0.8));
    G.gun = merge(THREE, [gun, grip]);
    // Basebollträ
    const bat = new THREE.CylinderGeometry(1.3, 0.6, 17, 6); bat.rotateX(-0.3); bat.translate(0, -18, 2.4);
    paint(THREE, bat, flat(1));
    G.bat = merge(THREE, [bat]);
    // Elsparkcykel
    const deck = new THREE.BoxGeometry(17, 1.4, 4.2); deck.translate(-1, 1.6, 0);
    const stem = new THREE.CylinderGeometry(0.6, 0.6, 20, 5); stem.translate(7.5, 11, 0);
    const bar = new THREE.CylinderGeometry(0.5, 0.5, 8, 5); bar.rotateX(Math.PI / 2); bar.translate(7.5, 21, 0);
    const w1 = new THREE.CylinderGeometry(1.6, 1.6, 1.2, 8); w1.rotateX(Math.PI / 2); w1.translate(7.5, 1.6, 0);
    const w2 = w1.clone(); w2.translate(-15.5, 0, 0);
    paint(THREE, deck, flat(1)); paint(THREE, stem, flat(0.7)); paint(THREE, bar, flat(0.7)); paint(THREE, w1, flat(0.2)); paint(THREE, w2, flat(0.2));
    G.scooter = merge(THREE, [deck, stem, bar, w1, w2]);
    return G;
}

// ── Fordonsformer (normaliserad längd och bredd: x, z i [−0,5, 0,5]; höjd i px) ──
function extrudeProfile(THREE, pts, depth) {
    const s = new THREE.Shape();
    pts.forEach((p, i) => (i ? s.lineTo(p[0], p[1]) : s.moveTo(p[0], p[1])));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    g.computeVertexNormals();
    return ni(g);
}
const GLASS = [0.16, 0.2, 0.26];
// Färga bilen: lack (1) på plåt, mörkt glas på rutorna, mörkare nertill
function carColors(THREE, geo, glassFn) {
    const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
        // per triangel: välj färg efter normalen
        const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
        const nx = (nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) / 3;
        const nz = (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2)) / 3;
        const yMid = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
        const glass = glassFn(nx, ny, nz, yMid);
        for (let k = 0; k < 3; k++) {
            const y = pos.getY(i + k);
            const ao = glass ? 1 : Math.min(1, 0.5 + y / 14);
            const c = glass ? GLASS : [ao, ao, ao];
            col.set(c, (i + k) * 3);
        }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
}

function vehicleGeometries(THREE) {
    const G = {};
    // Sedan: kaross + smalare kupé
    const sedanLow = extrudeProfile(THREE, [[-0.5, 3.6], [0.5, 3.6], [0.5, 8.6], [0.47, 10.6], [0.15, 11.8], [-0.32, 11.8], [-0.49, 11.2], [-0.5, 9.6]], 1);
    carColors(THREE, sedanLow, () => false);
    const sedanCab = extrudeProfile(THREE, [[0.15, 11.6], [-0.33, 11.6], [-0.23, 19.2], [0.0, 19.2]], 0.84);
    carColors(THREE, sedanCab, (nx, ny) => ny < 0.9);
    G.sedan = merge(THREE, [sedanLow, sedanCab]);
    // Sportbil: låg kil
    const sportLow = extrudeProfile(THREE, [[-0.5, 3.2], [0.5, 3.2], [0.5, 6.4], [0.42, 8.2], [0.12, 9.6], [-0.38, 10.4], [-0.5, 10.2]], 1);
    carColors(THREE, sportLow, () => false);
    const sportCab = extrudeProfile(THREE, [[0.12, 9.4], [-0.36, 10.2], [-0.24, 15.4], [-0.06, 15.4]], 0.78);
    carColors(THREE, sportCab, (nx, ny) => ny < 0.9);
    G.sport = merge(THREE, [sportLow, sportCab]);
    // Skåpbil: hög låda med sluttande vindruta
    const van = extrudeProfile(THREE, [[-0.5, 3.6], [0.5, 3.6], [0.5, 10.4], [0.44, 12.6], [0.3, 24], [-0.5, 24]], 0.98);
    carColors(THREE, van, (nx, ny) => nx > 0.3 && ny > 0.2);
    const side = new THREE.BoxGeometry(0.12, 6, 1.0); side.translate(0.17, 18, 0);
    paint(THREE, side, () => GLASS);
    G.van = merge(THREE, [van, ni(side)]);
    // Cykel/moped: ram, sadel, styre, liten tank (lack)
    const frame = new THREE.BoxGeometry(0.62, 2.2, 0.22); frame.translate(0, 9, 0);
    const seat = new THREE.BoxGeometry(0.22, 1.6, 0.42); seat.translate(-0.14, 12.5, 0);
    const fork = new THREE.BoxGeometry(0.05, 10, 0.2); fork.rotateZ(-0.25); fork.translate(0.33, 9.5, 0);
    const bar = new THREE.BoxGeometry(0.06, 1.2, 1.25); bar.translate(0.3, 15.5, 0);
    const tank = new THREE.BoxGeometry(0.3, 3.4, 0.48); tank.translate(0.08, 11.3, 0);
    paint(THREE, frame, flat(0.35)); paint(THREE, seat, flat(0.12)); paint(THREE, fork, flat(0.6)); paint(THREE, bar, flat(0.55)); paint(THREE, tank, flat(1));
    G.bike = merge(THREE, [frame, seat, fork, bar, tank]);
    // Chopper: lång gaffel, droppformad tank, apehangers, avgasrör
    const cframe = new THREE.BoxGeometry(0.62, 2.4, 0.2); cframe.translate(-0.06, 7.6, 0);
    const ctank = new THREE.SphereGeometry(1, 10, 6); ctank.scale(0.16, 2.6, 0.32); ctank.translate(0.1, 11.4, 0);
    const cseat = new THREE.BoxGeometry(0.2, 1.4, 0.45); cseat.translate(-0.13, 9.8, 0);
    const cfork = new THREE.BoxGeometry(0.03, 14, 0.18); cfork.rotateZ(-0.62); cfork.translate(0.36, 9.6, 0);
    const ape = new THREE.BoxGeometry(0.03, 6, 1.3); ape.translate(0.22, 16, 0);
    const pipe = new THREE.BoxGeometry(0.42, 1, 0.08); pipe.translate(-0.24, 5.4, 0.42);
    paint(THREE, cframe, flat(0.18)); paint(THREE, ctank, flat(1)); paint(THREE, cseat, flat(0.12));
    paint(THREE, cfork, flat(0.85)); paint(THREE, ape, flat(0.75)); paint(THREE, pipe, flat(0.95));
    G.chopper = merge(THREE, [cframe, ni(ctank), cseat, cfork, ape, pipe]);
    // Hjul (bil): axel längs z
    const wheel = new THREE.CylinderGeometry(4.5, 4.5, 3.4, 10); wheel.rotateX(Math.PI / 2);
    paint(THREE, wheel, (x, y, z) => (Math.abs(z) > 1.6 && Math.hypot(x, y) < 2.6 ? K_0p75_0p75_0p78 : K_0p1_0p1_0p11));
    G.wheel = merge(THREE, [wheel]);
    const bw = new THREE.CylinderGeometry(5, 5, 1.6, 12); bw.rotateX(Math.PI / 2);
    paint(THREE, bw, flat(0.1));
    G.bikeWheel = merge(THREE, [bw]);
    // Lampor, sirener, taxiskylt, rand
    G.lamp = new THREE.BoxGeometry(1, 1, 1);
    G.stripe = new THREE.BoxGeometry(1, 1, 1);
    return G;
}

// ── Figurer och fordon ──
export function createActors(THREE, scene) {
    const FG = figureGeometries(THREE), VG = vehicleGeometries(THREE);
    const lambert = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    const basic = () => new THREE.MeshBasicMaterial({ vertexColors: false, toneMapped: false });
    const meshes = [];
    const inst = (geo, mat, cap, name) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.count = 0;
        m.name = name;
        m.n = 0; m.cap = cap;
        scene.add(m);
        meshes.push(m);
        return m;
    };
    const skinMat = lambert();
    const F = {
        leg: inst(FG.leg, lambert(), MAX_FIG * 2, 'leg'),
        torso: inst(FG.torso, lambert(), MAX_FIG, 'torso'),
        arm: inst(FG.arm, lambert(), MAX_FIG * 2, 'arm'),
        hand: inst(FG.hand, skinMat, MAX_FIG * 2, 'hand'),
        head: inst(FG.head, skinMat, MAX_FIG, 'head'),
        hair: inst(FG.hair, lambert(), MAX_FIG, 'hair'),
        eyes: inst(FG.eyes, basic(), MAX_FIG, 'eyes'),
        cap: inst(FG.cap, lambert(), MAX_FIG, 'cap'),
        vest: inst(FG.vest, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), MAX_FIG, 'vest'),
        patch: inst(FG.patch, lambert(), MAX_FIG, 'patch'),
        skirt: inst(FG.skirt, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), MAX_FIG, 'skirt'),
        gun: inst(FG.gun, lambert(), MAX_FIG, 'gun'),
        bat: inst(FG.bat, lambert(), MAX_FIG, 'bat'),
        scooter: inst(FG.scooter, lambert(), 32, 'scooter')
    };
    const carPaint = new THREE.MeshLambertMaterial({ vertexColors: true });
    const V = {
        sedan: inst(VG.sedan, carPaint, MAX_CAR, 'sedan'),
        sport: inst(VG.sport, carPaint, 32, 'sport'),
        van: inst(VG.van, carPaint, 48, 'van'),
        bike: inst(VG.bike, carPaint, 48, 'bike'),
        chopper: inst(VG.chopper, carPaint, 48, 'chopper'),
        wheel: inst(VG.wheel, lambert(), MAX_CAR * 4, 'wheel'),
        bikeWheel: inst(VG.bikeWheel, lambert(), 96 * 2, 'bikeWheel'),
        head: inst(VG.lamp, basic(), MAX_CAR * 2, 'headlight'),
        tail: inst(VG.lamp, basic(), MAX_CAR * 2 + 16, 'taillight'), // + backljusen på de bilar som backar
        siren: inst(VG.lamp, basic(), MAX_CAR * 2, 'siren'),
        stripe: inst(VG.stripe, lambert(), MAX_CAR * 2, 'stripe'),
        sign: inst(VG.lamp, basic(), MAX_CAR, 'sign')
    };
    // Vit vertexfärg för de enkla lådorna
    for (const g of [VG.lamp, VG.stripe]) paint(THREE, g, flat(1));

    const root = new Float32Array(16), tmp = new Float32Array(16);
    const pose = {};
    const all = Object.values(F).concat(Object.values(V));

    function setColor(m, i, rgb, k = 1) {
        const a = m.instanceColor.array, o = i * 3;
        a[o] = toLinear(rgb[0] * k); a[o + 1] = toLinear(rgb[1] * k); a[o + 2] = toLinear(rgb[2] * k);
    }
    // Lägg till en del med en matris från `src` (root eller tmp)
    function put(m, src, rgb, k = 1) {
        const i = m.n;
        if (i >= m.cap) return -1;
        m.instanceMatrix.array.set(src, i * 16);
        setColor(m, i, rgb, k);
        m.n++;
        return i;
    }
    function putJoint(m, jx, jy, jz, rz, rx, rgb, sx = 1, sy = 1, sz = 1) {
        const i = m.n;
        if (i >= m.cap) return -1;
        jointMatrix(m.instanceMatrix.array, i * 16, root, 0, jx, jy, jz, rz, rx, sx, sy, sz);
        setColor(m, i, rgb);
        m.n++;
        return i;
    }
    // Som putJoint, men delen vriden runt lodaxeln (yaw i three, absolut): framhjulen som styr
    const at = { x: 0, y: 0, z: 0 };
    function putJointYaw(m, jx, jy, jz, yaw, rgb, sx = 1, sy = 1, sz = 1) {
        const i = m.n;
        if (i >= m.cap) return -1;
        applyMatrix(root, 0, jx, jy, jz, at);
        rootMatrix(tmp, 0, at.x, at.y, at.z, yaw, 0, 1);
        jointMatrix(m.instanceMatrix.array, i * 16, tmp, 0, 0, 0, 0, 0, 0, sx, sy, sz);
        setColor(m, i, rgb);
        m.n++;
        return i;
    }
    const BLACK = K_0p04_0p04_0p05, DARK = K_0p1_0p1_0p12;

    // Senaste figurens huvud (för t.ex. pratbubblor) — inte behövt av anroparen
    const api = {
        begin() { for (const m of all) m.n = 0; },
        end() {
            for (const m of all) {
                m.count = m.n;
                m.visible = m.n > 0;
                if (m.n) {
                    m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, m.n * 16); m.instanceMatrix.needsUpdate = true;
                    m.instanceColor.clearUpdateRanges(); m.instanceColor.addUpdateRange(0, m.n * 3); m.instanceColor.needsUpdate = true;
                }
            }
        },
        // f = { x, y (världens), z (höjd), angle, scale, down, pose, phase, moving, shirt, pants, skin, hair,
        //       hood, cap, vest, patch, weapon ('pistol'|'uzi'|'shotgun'|'bat'), punch, dress, scooter, head: false för att dölja huvudet }
        figure(f) {
            const s = f.scale || 1;
            const yaw = yawOf(f.angle || 0);
            figurePose(f.pose || 'walk', f.phase || 0, f.moving !== false, pose);
            const yawExtra = pose.sway;
            if (f.down) {
                // Liggande: ryggen mot marken, huvudet åt det håll man tittade
                const a = f.angle || 0;
                rootMatrix(root, 0, f.x - Math.cos(a) * 16 * s, (f.z || 0) + 3.2 * s, f.y - Math.sin(a) * 16 * s, yaw, Math.PI / 2, s);
            } else {
                const sitDrop = pose.sit ? (f.pose === 'ride' ? 0 : 7) : 0;
                rootMatrix(root, 0, f.x, (f.z || 0) + (pose.bob - sitDrop) * s, f.y, yaw + yawExtra, pose.lean, s);
            }
            const shirt = parseColor(f.shirt), skin = parseColor(f.skin || '#e0ac69');
            const pants = parseColor(f.pants || '#273043');
            const hair = parseColor(f.hood ? '#111827' : (f.hair || '#1f1300'));
            const dress = f.dress ? parseColor(f.dress) : null;
            // Ben
            const legC = dress ? skin : pants;
            putJoint(F.leg, 0, 15, -2.4, pose.legL, 0, legC);
            putJoint(F.leg, 0, 15, 2.4, pose.legR, 0, legC);
            if (dress) putJoint(F.skirt, 0, 16, 0, 0, 0, dress);
            // Bål
            putJoint(F.torso, 0, 14, 0, 0, 0, dress || shirt);
            if (f.vest) {
                putJoint(F.vest, 0, 14, 0, 0, 0, K_0p07_0p07_0p08);
                putJoint(F.patch, 0, 14, 0, 0, 0, parseColor(f.vest));
            }
            // Armar: vapen = höger arm rakt fram, slag = utsträckt
            let armR = pose.armR, armL = pose.armL;
            if (f.weapon && f.weapon !== 'bat') armR = 1.5;
            if (f.weapon === 'shotgun' || f.weapon === 'uzi') armL = 1.25;
            if (f.weapon === 'bat') armR = f.punch ? 1.7 : 0.6;
            if (f.punch && !f.weapon) armR = 1.62;
            const sleeve = dress ? skin : shirt;
            putJoint(F.arm, 0, 26.2, -6.6, armL, pose.sideL, sleeve);
            putJoint(F.hand, 0, 26.2, -6.6, armL, pose.sideL, skin);
            const ri = F.arm.n;
            putJoint(F.arm, 0, 26.2, 6.6, armR, -pose.sideR, sleeve);
            putJoint(F.hand, 0, 26.2, 6.6, armR, -pose.sideR, skin);
            if (f.weapon) {
                const m = f.weapon === 'bat' ? F.bat : F.gun;
                const long = f.weapon === 'shotgun' ? 1.7 : f.weapon === 'uzi' ? 1.3 : 1;
                if (ri < F.arm.cap) {
                    tmp.set(F.arm.instanceMatrix.array.subarray(ri * 16, ri * 16 + 16));
                    const i = m.n;
                    if (i < m.cap) {
                        // längre pipa: skala längs armen (−y) kring handen
                        jointMatrix(m.instanceMatrix.array, i * 16, tmp, 0, 0, f.weapon === 'bat' ? 0 : -12.6 * (1 - long), 0, 0, 0, 1, f.weapon === 'bat' ? 1 : long, 1);
                        setColor(m, i, f.weapon === 'bat' ? K_0p63_0p38_0p03 : DARK);
                        m.n++;
                    }
                }
            }
            if (f.head !== false) {
                putJoint(F.head, 0.2, 27.6, 0, 0, 0, skin);
                putJoint(F.eyes, 0.2, 27.6, 0, 0, 0, f.shades ? BLACK : K_0p08_0p06_0p05);
                if (f.cap) putJoint(F.cap, 0.2, 27.6, 0, 0, 0, parseColor(f.cap === true ? '#111827' : f.cap));
                else putJoint(F.hair, 0.2, 27.6, 0, 0, 0, hair, f.hood ? 1.08 : 1, f.hood ? 1.04 : 1, f.hood ? 1.08 : 1);
            }
            if (f.scooter) {
                rootMatrix(tmp, 0, f.x, f.z || 0, f.y, yaw, 0, s);
                put(F.scooter, tmp, K_0p16_0p16_0p18);
            }
        },
        // v = världens fordon (eller låtsasbil för andra spelare)
        // gangColor: gängets färg (rand längs sidan) eller null
        vehicle(v, night, flash, t, gangColor = null) {
            const spec = v.spec || {}, L = spec.l || 44, W = spec.w || 22;
            const yaw = yawOf(v.angle || 0);
            const body = v.exploded ? K_0p08_0p08_0p08 : parseColor(v.color || '#888');
            const k = v.wrecked && !v.exploded ? 0.38 : 1;
            if (spec.kind === 'bike') {
                const chop = !!spec.chopper;
                rootMatrix(root, 0, v.x, 0, v.y, yaw, 0, 1);
                // skala: längd L, bredd W
                const m = chop ? V.chopper : V.bike;
                const i = m.n;
                if (i < m.cap) {
                    jointMatrix(m.instanceMatrix.array, i * 16, root, 0, 0, 0, 0, 0, 0, L, 1, W);
                    setColor(m, i, body, k); m.n++;
                }
                const r = chop ? 6 : spec.engine ? 5.2 : 4.8;
                putJoint(V.bikeWheel, L * 0.36, r, 0, 0, 0, K_1_1_1, r / 5, r / 5, chop ? 1.4 : 1);
                putJoint(V.bikeWheel, -L * 0.36, r, 0, 0, 0, K_1_1_1, (chop ? 6.8 : r) / 5, (chop ? 6.8 : r) / 5, chop ? 2.4 : 1);
                if (!v.wrecked) {
                    putJoint(V.head, L * 0.42, 14, 0, 0, 0, night ? K_1_0p95_0p8 : K_0p75_0p75_0p7, 1.2, 2, 2.4);
                    putJoint(V.tail, -L * 0.48, 10, 0, 0, 0, v.braking ? K_1_0p15_0p1 : night ? K_0p8_0p08_0p06 : K_0p45_0p05_0p05, 1, 1.4, 2);
                }
                return;
            }
            const shape = spec.sport ? V.sport : (v.type === 'van' || L >= 54 && !spec.police && v.type !== 'rolls') ? V.van : V.sedan;
            const low = v.type === 'gang_taco' ? -1.2 : 0;
            rootMatrix(root, 0, v.x, low, v.y, yaw, 0, 1);
            const i = shape.n;
            if (i < shape.cap) {
                jointMatrix(shape.instanceMatrix.array, i * 16, root, 0, 0, 0, 0, 0, 0, L, 1, W);
                setColor(shape, i, body, k); shape.n++;
            }
            // Hjul. Framhjulen visar styrningen (v.steerPos −1..1 från fysiken, + = höger): framänden syns
            const wx = L * 0.31, wz = W / 2 - 1.6, r = v.type === 'van' ? 4.8 : 4.5;
            const steer = v.wrecked || !Number.isFinite(v.steerPos) ? 0 : v.steerPos * 0.5;
            for (let b = -1; b <= 1; b += 2) {
                putJoint(V.wheel, -wx, r - low, b * wz, 0, 0, K_1_1_1, r / 4.5, r / 4.5, 1);
                if (steer) putJointYaw(V.wheel, wx, r - low, b * wz, yaw - steer, K_1_1_1, r / 4.5, r / 4.5, 1);
                else putJoint(V.wheel, wx, r - low, b * wz, 0, 0, K_1_1_1, r / 4.5, r / 4.5, 1);
            }
            if (v.exploded) return;
            const roof = shape === V.van ? 24 : shape === V.sport ? 15.4 : 19.2;
            // Strålkastare och baklampor
            const hl = night && (v.driver || v.parked === false) ? K_1_0p96_0p82 : night ? K_0p55_0p55_0p5 : K_0p82_0p82_0p78;
            const tl = v.braking ? K_1_0p1_0p08 : night ? K_0p85_0p05_0p04 : K_0p42_0p04_0p04;
            if (!v.wrecked) {
                for (let b = -1; b <= 1; b += 2) {
                    putJoint(V.head, L / 2 - 0.3, 8.4, b * (W / 2 - 3.4), 0, 0, hl, 1, 2.2, 4.2);
                    putJoint(V.tail, -L / 2 + 0.3, 9, b * (W / 2 - 3.2), 0, 0, tl, 1, 2, 4.4);
                    // Backljus: vita lampor innanför baklamporna medan bilen backar
                    if (v.reversing) putJoint(V.tail, -L / 2 + 0.25, 9, b * (W / 2 - 7.6), 0, 0, K_1_1_1, 1, 1.8, 2.6);
                }
            }
            // Polis: blåljusramp, blå rand. Taxi: skylt. Gäng: rand i gängets färg.
            if (spec.police) {
                const on = v.siren && !v.wrecked;
                putJoint(V.siren, -L * 0.06, roof + 1.1, -W * 0.18, 0, 0, on && flash ? K_1_0p12_0p1 : K_0p35_0p05_0p05, 3.2, 2.2, W * 0.32);
                putJoint(V.siren, -L * 0.06, roof + 1.1, W * 0.18, 0, 0, on && !flash ? K_0p15_0p35_1 : K_0p05_0p1_0p35, 3.2, 2.2, W * 0.32);
                putJoint(V.stripe, 0, 7.4, 0, 0, 0, K_0p11_0p3_0p85, L * 0.94, 2.2, W + 0.35);
            }
            if (spec.taxi) putJoint(V.sign, -L * 0.08, roof + 1.6, 0, 0, 0, night ? K_1_0p88_0p25 : K_0p99_0p85_0p2, 4.5, 3.2, 8);
            if (v.gang && !spec.police) {
                const g = gangColor ? parseColor(gangColor) : null;
                if (g) putJoint(V.stripe, 0, 7.6, 0, 0, 0, g, L * 0.96, 1.6, W + 0.3);
            }
            if (spec.sport) putJoint(V.stripe, 0, 9.3, 0, 0, 0, K_0p05_0p05_0p06, L * 0.9, 0.5, W * 0.18);
        },
        meshes: F,
        vmeshes: V,
        dispose() {
            for (const m of all) { scene.remove(m); m.dispose?.(); }
            const mats = new Set(all.map(m => m.material));
            mats.forEach(m => m.dispose());
            Object.values(FG).forEach(g => g.dispose());
            Object.values(VG).forEach(g => g.dispose());
        }
    };
    return api;
}
export { CAR_H };
