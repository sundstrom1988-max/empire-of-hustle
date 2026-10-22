// ═══════════════════════════════════════════
//  STAN 3D — geometribyggare
//  Samlar fyrkanter och lådor (position, normal,
//  uv, färg) per materialgrupp och bygger EN
//  BufferGeometry med grupper → ett ritanrop per
//  material för en hel stad.
// ═══════════════════════════════════════════

import { toLinear } from './batch.js';

export class GeoBuilder {
    constructor(groups = 1) {
        this.pos = []; this.nor = []; this.uv = []; this.col = [];
        this.idx = Array.from({ length: groups }, () => []);
        this.n = 0;
    }
    // a, b, c, d moturs sett från framsidan. uvs: [u0,v0, u1,v1, u2,v2, u3,v3]. cols: 4×[r,g,b] linjära (eller en färg)
    quad(a, b, c, d, nrm, uvs, cols, group = 0) {
        const o = this.n;
        const P = [a, b, c, d];
        for (let i = 0; i < 4; i++) {
            this.pos.push(P[i][0], P[i][1], P[i][2]);
            this.nor.push(nrm[0], nrm[1], nrm[2]);
            this.uv.push(uvs ? uvs[i * 2] : 0, uvs ? uvs[i * 2 + 1] : 0);
            const c = Array.isArray(cols[0]) ? cols[i] : cols;
            this.col.push(c[0], c[1], c[2]);
        }
        this.idx[group].push(o, o + 1, o + 2, o, o + 2, o + 3);
        this.n += 4;
    }
    tri(a, b, c, nrm, cols, group = 0, uvs = null) {
        const o = this.n;
        const P = [a, b, c];
        for (let i = 0; i < 3; i++) {
            this.pos.push(P[i][0], P[i][1], P[i][2]);
            this.nor.push(nrm[0], nrm[1], nrm[2]);
            this.uv.push(uvs ? uvs[i * 2] : 0, uvs ? uvs[i * 2 + 1] : 0);
            const c = Array.isArray(cols[0]) ? cols[i] : cols;
            this.col.push(c[0], c[1], c[2]);
        }
        this.idx[group].push(o, o + 1, o + 2);
        this.n += 3;
    }
    // Låda: färg för sidorna, toppen och (valfritt) mörkare nertill. opts: { top, bottom: false, ao, topUV(x,z) }
    box(x0, y0, z0, x1, y1, z1, col, group = 0, opts = {}) {
        const top = opts.top || col;
        const ao = opts.ao ?? 0.7;
        const lo = [col[0] * ao, col[1] * ao, col[2] * ao];
        const sideCols = [lo, lo, col, col];
        const tuv = opts.topUV;
        // sidornas uv: u längs kanten (px / su), v 0→1 över höjden
        const su = opts.sideU, sg = opts.sideGroup ?? group;
        const suv = (len) => (su ? [0, 0, len / su, 0, len / su, 1, 0, 1] : null);
        // +y
        this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
            tuv ? [...tuv(x0, z1), ...tuv(x1, z1), ...tuv(x1, z0), ...tuv(x0, z0)] : null, top, opts.topGroup ?? group);
        // −z (norr)
        this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], suv(x1 - x0), sideCols, sg);
        // +z (söder)
        this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], suv(x1 - x0), sideCols, sg);
        // −x (väster)
        this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], suv(z1 - z0), sideCols, sg);
        // +x (öster)
        this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], suv(z1 - z0), sideCols, sg);
        if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], null, lo, group);
    }
    // Cylinder (lodrät) med n sidor
    cylinder(cx, y0, cz, r, h, n, col, group = 0, topCol = null) {
        const lo = [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75];
        for (let i = 0; i < n; i++) {
            const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
            const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
            this.quad([p1[0], y0, p1[1]], [p0[0], y0, p0[1]], [p0[0], y0 + h, p0[1]], [p1[0], y0 + h, p1[1]], [Math.cos(am), 0, Math.sin(am)], null, [lo, lo, col, col], group);
            this.tri([cx, y0 + h, cz], [p1[0], y0 + h, p1[1]], [p0[0], y0 + h, p0[1]], [0, 1, 0], topCol || col, group);
        }
    }
    build(THREE) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
        const all = [];
        let start = 0;
        this.idx.forEach((list, gi) => {
            if (list.length) g.addGroup(start, list.length, gi);
            for (const i of list) all.push(i);
            start += list.length;
        });
        g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(all, 1) : new THREE.Uint16BufferAttribute(all, 1));
        g.computeBoundingSphere();
        return g;
    }
}

// sRGB-hex → linjär [r, g, b], med valfri ljusfaktor
export function lin(hex, k = 1) {
    let n = hex;
    if (typeof hex === 'string') {
        let h = hex.replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        n = parseInt(h, 16);
    }
    return [toLinear(Math.min(1, ((n >> 16) & 255) / 255 * k)), toLinear(Math.min(1, ((n >> 8) & 255) / 255 * k)), toLinear(Math.min(1, (n & 255) / 255 * k))];
}
export const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mix3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
