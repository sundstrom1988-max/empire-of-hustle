// ═══════════════════════════════════════════
//  STAN 3D — inomhus (Club Diamant, Pang-Pelle,
//  verksamheterna). Rummets 2D-målning blir golv-
//  textur, väggar och möbler reses som lådor med
//  samma målning på toppen. Rummets eget ljus
//  (drawInteriorLights) målas i låg upplösning och
//  läggs additivt på golvet + styr fyra punktljus.
// ═══════════════════════════════════════════

import { GeoBuilder, mul } from './geo.js';
import { paintRoom, paintRoomLight, makeCanvas, paintShelf, paintWall } from './paint.js';
import { furnitureHeight, ROOM_H } from './math.js';
import { toLinear } from './batch.js';

// Sidornas färg: väggar ljusare (annars blir rummet en svart låda), hyllor ljusa under varorna
function sideColor(side, wall, shelfy) {
    if (wall) return mul(side, 1.6);
    if (shelfy) return [side[0] * 0.5 + 0.45, side[1] * 0.5 + 0.45, side[2] * 0.5 + 0.45];
    return side;
}

// Liten nedskalad kopia → pixlar, asynkront (createImageBitmap). Utan stöd: null (standardfärger).
function readSmall(cv, w, h) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(null);
    return createImageBitmap(cv, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' }).then(bmp => {
        const c = makeCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        if (bmp.close) bmp.close();
        return g.getImageData(0, 0, w, h).data;
    }).catch(() => null);
}

export function createRoom3D(THREE, INT, state, { anisotropy = 4, maxTex = 2048 } = {}) {
    const def = state.def, TS = INT.IN_TILE || 32;
    const W = def.w * TS, H = def.h * TS;
    const group = new THREE.Group();
    group.name = 'room:' + def.id;
    const disposables = [];
    const keep = o => { disposables.push(o); return o; };

    // Golvet: rummet målat uppifrån (utan folk)
    const scale = Math.min(2, maxTex / Math.max(W, H));
    const floorCv = paintRoom(INT, state, scale);
    const floorTex = keep(new THREE.CanvasTexture(floorCv));
    floorTex.colorSpace = THREE.SRGBColorSpace;
    floorTex.anisotropy = anisotropy;
    floorTex.minFilter = THREE.LinearMipmapLinearFilter;
    // Medelfärg per ruta (för möblernas sidor) läses asynkront — en synkron pixelläsning av en
    // stor canvas tvingar fram en väntan på grafikkortet. Tills dess: neutrala standardfärger.
    let px = null, dead = false;
    const tileCol = (tx, ty, k = 1, wall = false) => {
        if (!px) return wall ? [0.02 * k, 0.018 * k, 0.025 * k] : [0.07 * k, 0.065 * k, 0.07 * k];
        const i = (ty * def.w + tx) * 4;
        return [toLinear(px[i] / 255 * k), toLinear(px[i + 1] / 255 * k), toLinear(px[i + 2] / 255 * k)];
    };
    const recolor = []; // { from, to, tx, ty, wall, shelfy, ao } — sidornas hörn i geometrin
    const B = new GeoBuilder(5); // 0: toppar med golvtexturen, 1: sidor i enfärg, 2: hyllor, 3: vapenställ, 4: väggar
    const uvAt = (x, z) => [x / W, 1 - z / H];
    // Golvet
    B.quad([0, 0, H], [W, 0, H], [W, 0, 0], [0, 0, 0], [0, 1, 0], [...uvAt(0, H), ...uvAt(W, H), ...uvAt(W, 0), ...uvAt(0, 0)], [1, 1, 1], 0);
    const heights = new Float32Array(def.w * def.h);
    const LEG = INT.LEGEND || {};
    for (let ty = 0; ty < def.h; ty++) {
        const row = def.rows[ty];
        let tx = 0;
        while (tx < def.w) {
            const ch = row[tx];
            const info = LEG[ch];
            const solid = info ? info.solid : ch !== '.';
            const h = solid ? furnitureHeight(ch, info) : 0;
            // slå ihop en rad av samma tecken till en låda
            let n = 1;
            while (tx + n < def.w && row[tx + n] === ch) n++;
            for (let k = 0; k < n; k++) heights[ty * def.w + tx + k] = h;
            if (h > 0) {
                const x0 = tx * TS, x1 = (tx + n) * TS, z0 = ty * TS, z1 = z0 + TS;
                const wall = ch === '#';
                // Väggens sida: lite ljusare än toppen så att rummet inte blir en svart låda
                const side = tileCol(tx, ty, wall ? 1.25 : 0.9, wall);
                const name = (info && info.name || '').toLowerCase();
                if (ch === 'P' || /stolpe/.test(name)) {
                    // Stolpe: smal krom-cylinder (scenstolpen står på scenen)
                    for (let k = 0; k < n; k++) {
                        const cx = (tx + k) * TS + TS / 2, cz = z0 + TS / 2;
                        const base = ch === 'P' ? 10 : 0;
                        if (ch === 'P') B.box((tx + k) * TS, 0, z0, (tx + k + 1) * TS, base, z1, side, 1, { top: [1, 1, 1], topGroup: 0, topUV: uvAt });
                        B.cylinder(cx, base, cz, ch === 'P' ? 1.6 : 1.8, (ch === 'P' ? ROOM_H : h) - base, 8, ch === 'P' ? [0.75, 0.75, 0.8] : [0.6, 0.55, 0.3], 1);
                    }
                } else if (/växt|palm/.test(name) || ch === 'x') {
                    for (let k = 0; k < n; k++) {
                        const cx = (tx + k) * TS + TS / 2, cz = z0 + TS / 2;
                        B.cylinder(cx, 0, cz, 7, 10, 8, [0.25, 0.12, 0.06], 1);
                        B.cylinder(cx, 10, cz, 10, 16, 7, [0.05, 0.22, 0.06], 1, [0.08, 0.32, 0.08]);
                    }
                } else if (ch === 'o' || /barstol|pall/.test(name)) {
                    for (let k = 0; k < n; k++) {
                        const cx = (tx + k) * TS + TS / 2, cz = z0 + TS / 2;
                        B.cylinder(cx, 0, cz, 1.5, h - 2, 6, [0.6, 0.6, 0.65], 1);
                        B.cylinder(cx, h - 2, cz, 7, 2.5, 10, side, 1);
                    }
                } else {
                    const inset = wall ? 0 : 1.5;
                    // höga hyllor och ställ får varor/vapen på sidorna, väggarna paneler
                    const rack = ch === 'R' || /vapen/.test(name);
                    const shelf = !wall && !rack && (ch === 'A' || /hylla|kyl|frys|skåp|automat|ställ|bokhyll/.test(name)) && h >= 24;
                    const sg = wall ? 4 : rack ? 3 : shelf ? 2 : 1;
                    const sc = sideColor(side, wall, rack || shelf);
                    recolor.push({ from: B.n + 4, to: B.n + 20, tx, ty, wall, shelfy: rack || shelf, ao: wall ? 0.75 : 0.6 });
                    B.box(x0 + inset, 0, z0 + inset, x1 - inset, h, z1 - inset, sc, 1, { top: [1, 1, 1], topGroup: 0, topUV: uvAt, ao: wall ? 0.75 : 0.6, sideGroup: sg, sideU: sg > 1 ? (wall ? 64 : 48) : 0 });
                }
            }
            tx += n;
        }
    }
    const geo = keep(B.build(THREE));
    // när rutfärgerna finns: färga om väggar och möbler (samma formel som ovan)
    const applyColors = () => {
        const col = geo.getAttribute('color');
        for (const r of recolor) {
            const sc = sideColor(tileCol(r.tx, r.ty, r.wall ? 1.25 : 0.9, r.wall), r.wall, r.shelfy);
            for (let v = r.from; v < r.to; v++) {
                const m = (v - r.from) % 4 < 2 ? r.ao : 1;
                col.setXYZ(v, sc[0] * m, sc[1] * m, sc[2] * m);
            }
        }
        col.needsUpdate = true;
    };
    readSmall(floorCv, def.w, def.h).then(d => { if (dead || !d) return; px = d; applyColors(); });
    const topMat = keep(new THREE.MeshLambertMaterial({ map: floorTex, vertexColors: true }));
    const sideMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const texMat = (cv) => {
        const t = keep(new THREE.CanvasTexture(cv));
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = anisotropy;
        return keep(new THREE.MeshLambertMaterial({ map: t, vertexColors: true }));
    };
    const mesh = new THREE.Mesh(geo, [topMat, sideMat, texMat(paintShelf('shelf')), texMat(paintShelf('rack')), texMat(paintWall())]);
    mesh.name = 'room';
    group.add(mesh);

    // Rummets ljus som additivt lager på golvet
    const LS = 0.25;
    const lightCv = makeCanvas(Math.ceil(W * LS), Math.ceil(H * LS));
    const lightTex = keep(new THREE.CanvasTexture(lightCv));
    lightTex.colorSpace = THREE.SRGBColorSpace;
    lightTex.generateMipmaps = false;
    lightTex.minFilter = THREE.LinearFilter;
    // färgen > 1 förstärker skenet (2D-ljuset är gjort för att läggas över en mörk bild)
    const lightMat = keep(new THREE.MeshBasicMaterial({ map: lightTex, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const lightGeo = keep(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(W / 2, 0.6, H / 2));
    const lightMesh = new THREE.Mesh(lightGeo, lightMat);
    lightMesh.renderOrder = 2;
    lightMesh.name = 'room-light';
    group.add(lightMesh);
    // Fyra punktljus i rummets kvadranter, färgade efter golvljuset där. Färgen läses EN gång
    // (att läsa pixlar varje bildruta tvingar fram en synk med grafikkortet).
    const spots = [[0.27, 0.3], [0.73, 0.3], [0.27, 0.72], [0.73, 0.72]].map(([u, v], i) => ({ x: u * W, y: v * H, c: [0.5, 0.45, 0.5], ph: i * 1.7 }));
    paintRoomLight(INT, state, lightCv, LS, state.t || 0);
    readSmall(lightCv, 8, 6).then(d => {
        if (dead || !d) return;
        for (const s of spots) {
            const cx = Math.min(7, Math.floor(s.x / W * 8)), cy = Math.min(5, Math.floor(s.y / H * 6));
            let r = 0, g = 0, b = 0, n = 0;
            for (let y = Math.max(0, cy - 1); y <= Math.min(5, cy + 1); y++) for (let x = Math.max(0, cx - 1); x <= Math.min(7, cx + 1); x++) {
                const i = (y * 8 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
            }
            s.c[0] = r / n / 255; s.c[1] = g / n / 255; s.c[2] = b / n / 255;
        }
    });
    let lightT = 1;
    function updateLight(t, dt) {
        lightT += dt;
        if (lightT < 0.08) return false;
        lightT = 0;
        paintRoomLight(INT, state, lightCv, LS, t);
        lightTex.needsUpdate = true;
        return true;
    }

    // Tak: mörkt, med lysrör/spotlights i rader (syns i förstapersonsvy)
    const ceilB = new GeoBuilder(1);
    const cc = [0.012, 0.01, 0.016];
    ceilB.quad([0, ROOM_H, 0], [W, ROOM_H, 0], [W, ROOM_H, H], [0, ROOM_H, H], [0, -1, 0], null, cc);
    const fixtures = [];
    for (let y = TS * 2.5; y < H - TS; y += TS * 4) for (let x = TS * 2.5; x < W - TS; x += TS * 4) {
        ceilB.box(x - 5, ROOM_H - 2.5, y - 5, x + 5, ROOM_H, y + 5, [0.05, 0.05, 0.06], 0, { bottom: true });
        fixtures.push(x, y);
    }
    const ceilGeo = keep(ceilB.build(THREE));
    const ceil = new THREE.Mesh(ceilGeo, keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    ceil.name = 'room-ceiling';
    group.add(ceil);

    const heightAt = (x, y) => {
        const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
        if (tx < 0 || ty < 0 || tx >= def.w || ty >= def.h) return ROOM_H;
        return heights[ty * def.w + tx];
    };
    return {
        id: def.id, state, group, W, H, spots, fixtures,
        heightAt,
        // för kameran: väggar och höga möbler skymmer
        blocked: (x, y, h) => heightAt(x, y) > Math.min(h, ROOM_H - 1) - 2 && heightAt(x, y) >= 30,
        // var en figur står: på scenen (låg och solid) står man ovanpå
        floorAt: (x, y) => { const h = heightAt(x, y); return h > 0 && h <= 14 ? h : 0; },
        updateLight,
        dispose() { dead = true; for (const d of disposables) d.dispose?.(); }
    };
}
