// ═══════════════════════════════════════════
//  STAN 3D — inomhus (Club Diamant, Pang-Pelle,
//  verksamheterna). Rummets 2D-målning blir golv-
//  textur, väggar och möbler reses som lådor med
//  samma målning på toppen. Rummets eget ljus
//  (drawInteriorLights) målas i låg upplösning och
//  läggs additivt på golvet + styr fyra punktljus.
// ═══════════════════════════════════════════

import { GeoBuilder, mul } from './geo.js';
import { paintRoom, paintRoomLight, makeCanvas } from './paint.js';
import { furnitureHeight, ROOM_H } from './math.js';
import { toLinear } from './batch.js';

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
    // Medelfärg per ruta (för möblernas sidor)
    const small = makeCanvas(def.w, def.h);
    const sg = small.getContext('2d', { willReadFrequently: true });
    sg.drawImage(floorCv, 0, 0, def.w, def.h);
    const px = sg.getImageData(0, 0, def.w, def.h).data;
    const tileCol = (tx, ty, k = 1) => {
        const i = (ty * def.w + tx) * 4;
        return [toLinear(px[i] / 255 * k), toLinear(px[i + 1] / 255 * k), toLinear(px[i + 2] / 255 * k)];
    };

    const B = new GeoBuilder(2); // 0: toppar med golvtexturen, 1: sidor i enfärg
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
                const side = tileCol(tx, ty, wall ? 1.25 : 0.9);
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
                    B.box(x0 + inset, 0, z0 + inset, x1 - inset, h, z1 - inset, side, 1, { top: [1, 1, 1], topGroup: 0, topUV: uvAt, ao: wall ? 0.45 : 0.6 });
                    // Väggarna får en list upptill och en mörk sockel
                    if (wall) B.box(x0, h - 3, z0, x1, h, z1, mul(side, 0.6), 1);
                }
            }
            tx += n;
        }
    }
    const geo = keep(B.build(THREE));
    const topMat = keep(new THREE.MeshLambertMaterial({ map: floorTex, vertexColors: true }));
    const sideMat = keep(new THREE.MeshLambertMaterial({ vertexColors: true }));
    const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
    mesh.name = 'room';
    group.add(mesh);

    // Rummets ljus som additivt lager på golvet
    const LS = 0.25;
    const lightCv = makeCanvas(Math.ceil(W * LS), Math.ceil(H * LS));
    const lightTex = keep(new THREE.CanvasTexture(lightCv));
    lightTex.colorSpace = THREE.SRGBColorSpace;
    lightTex.generateMipmaps = false;
    lightTex.minFilter = THREE.LinearFilter;
    const lightMat = keep(new THREE.MeshBasicMaterial({ map: lightTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const lightGeo = keep(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2).translate(W / 2, 0.6, H / 2));
    const lightMesh = new THREE.Mesh(lightGeo, lightMat);
    lightMesh.renderOrder = 2;
    lightMesh.name = 'room-light';
    group.add(lightMesh);
    // Fyra punktljus i rummets kvadranter, färgade efter golvljuset där
    const spots = [[0.27, 0.3], [0.73, 0.3], [0.27, 0.72], [0.73, 0.72]].map(([u, v]) => ({ x: u * W, y: v * H, c: [0.5, 0.5, 0.5] }));
    let lightT = 1;
    function updateLight(t, dt) {
        lightT += dt;
        if (lightT < 0.08) return false;
        lightT = 0;
        paintRoomLight(INT, state, lightCv, LS, t);
        lightTex.needsUpdate = true;
        try {
            const d = lightCv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, lightCv.width, lightCv.height).data;
            for (const s of spots) {
                // medel över ett område runt punkten
                let r = 0, g = 0, b = 0, n = 0;
                const cx = Math.floor(s.x * LS), cy = Math.floor(s.y * LS), R = Math.floor(Math.min(W, H) * LS * 0.2);
                for (let y = cy - R; y <= cy + R; y += 3) for (let x = cx - R; x <= cx + R; x += 3) {
                    if (x < 0 || y < 0 || x >= lightCv.width || y >= lightCv.height) continue;
                    const i = (y * lightCv.width + x) * 4;
                    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
                }
                if (n) { s.c[0] = r / n / 255; s.c[1] = g / n / 255; s.c[2] = b / n / 255; }
            }
        } catch (e) { /* inget ljus att läsa */ }
        return true;
    }

    const heightAt = (x, y) => {
        const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
        if (tx < 0 || ty < 0 || tx >= def.w || ty >= def.h) return ROOM_H;
        return heights[ty * def.w + tx];
    };
    return {
        id: def.id, state, group, W, H, spots,
        heightAt,
        // för kameran: väggar och höga möbler skymmer
        blocked: (x, y, h) => heightAt(x, y) > Math.min(h, ROOM_H - 1) - 2 && heightAt(x, y) >= 30,
        // var en figur står: på scenen (låg och solid) står man ovanpå
        floorAt: (x, y) => { const h = heightAt(x, y); return h > 0 && h <= 14 ? h : 0; },
        updateLight,
        dispose() { for (const d of disposables) d.dispose?.(); }
    };
}
