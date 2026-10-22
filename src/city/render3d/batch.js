// ═══════════════════════════════════════════
//  STAN 3D — instansierade fyrkanter i ett anrop
//  Ikoner, skyltar, sken, partiklar, skuggor och
//  ringar på marken. Varje instans: position,
//  storlek, uv-ruta, färg och läge:
//    0 = vänd mot kameran (kan roteras i bildplanet)
//    1 = lodrät skylt med riktning (normalens 2D-vinkel)
//    2 = platt på marken (2D-vinkel)
//    3 = vänd mot kameran men alltid lodrät (cylindrisk)
//  THREE skickas in — inget statiskt three-beroende.
// ═══════════════════════════════════════════

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUV;
attribute vec4 iColor;
attribute vec2 iRot;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
uniform float fogNear;
uniform float fogFar;
void main() {
    vUv = mix(iUV.xy, iUV.zw, uv);
    vColor = iColor;
    vec2 q = position.xy * iSize;
    float c = cos(iRot.y), s = sin(iRot.y);
    vec4 mv;
    if (iRot.x < 0.5) {
        mv = modelViewMatrix * vec4(iPos, 1.0);
        mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
    } else if (iRot.x < 1.5) {
        mv = modelViewMatrix * vec4(iPos + vec3(s * q.x, q.y, -c * q.x), 1.0);
    } else if (iRot.x < 2.5) {
        mv = modelViewMatrix * vec4(iPos + vec3(c * q.x - s * q.y, 0.0, s * q.x + c * q.y), 1.0);
    } else {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        right.y = 0.0;
        right = normalize(right + vec3(1e-5, 0.0, 0.0));
        mv = modelViewMatrix * vec4(iPos + right * q.x + vec3(0.0, q.y, 0.0), 1.0);
    }
    gl_Position = projectionMatrix * mv;
    vFog = smoothstep(fogNear, fogFar, -mv.z);
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 fogColor;
uniform float alphaTest;
uniform float additive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
    vec4 c = texture2D(map, vUv) * vColor;
    if (c.a < alphaTest) discard;
    if (additive > 0.5) {
        gl_FragColor = vec4(c.rgb, c.a * (1.0 - vFog));
    } else {
        gl_FragColor = vec4(mix(c.rgb, fogColor, vFog), c.a);
    }
    #include <colorspace_fragment>
}`;

// sRGB → linjärt (snabb approximation räcker för effekter)
const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const LUT = new Float32Array(256);
for (let i = 0; i < 256; i++) LUT[i] = lin(i / 255);
export const toLinear = c => LUT[Math.max(0, Math.min(255, Math.round(c * 255)))];

export function createQuadBatch(THREE, { capacity = 256, map, kind = 'alpha', renderOrder = 0, name = 'batch' }) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const mkAttr = (n) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n);
        a.setUsage(THREE.DynamicDrawUsage);
        return a;
    };
    const aPos = mkAttr(3), aSize = mkAttr(2), aUV = mkAttr(4), aCol = mkAttr(4), aRot = mkAttr(2);
    geo.setAttribute('iPos', aPos); geo.setAttribute('iSize', aSize); geo.setAttribute('iUV', aUV);
    geo.setAttribute('iColor', aCol); geo.setAttribute('iRot', aRot);
    geo.instanceCount = 0;
    const additive = kind === 'add';
    const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG,
        uniforms: {
            map: { value: map }, fogColor: { value: new THREE.Color(0x000000) },
            fogNear: { value: 1e5 }, fogFar: { value: 2e5 },
            alphaTest: { value: kind === 'cutout' ? 0.42 : 0.004 },
            additive: { value: additive ? 1 : 0 }
        },
        transparent: kind !== 'cutout',
        depthWrite: kind === 'cutout',
        depthTest: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        polygonOffset: kind === 'ground', polygonOffsetFactor: -2, polygonOffsetUnits: -4
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.name = name;
    const P = aPos.array, Z = aSize.array, U = aUV.array, C = aCol.array, R = aRot.array;
    let n = 0;
    const batch = {
        mesh, capacity,
        get count() { return n; },
        begin() { n = 0; },
        // x, y, z i three-koordinater. uv = [u0, v0, u1, v1]. färg i sRGB 0–1.
        add(x, y, z, w, h, uv, r, g, b, a, mode = 0, ang = 0) {
            if (n >= capacity) return false;
            const i3 = n * 3, i2 = n * 2, i4 = n * 4;
            P[i3] = x; P[i3 + 1] = y; P[i3 + 2] = z;
            Z[i2] = w; Z[i2 + 1] = h;
            U[i4] = uv[0]; U[i4 + 1] = uv[1]; U[i4 + 2] = uv[2]; U[i4 + 3] = uv[3];
            C[i4] = toLinear(r); C[i4 + 1] = toLinear(g); C[i4 + 2] = toLinear(b); C[i4 + 3] = a;
            R[i2] = mode; R[i2 + 1] = ang;
            n++;
            return true;
        },
        end() {
            geo.instanceCount = n;
            mesh.visible = n > 0;
            for (const at of [aPos, aSize, aUV, aCol, aRot]) {
                at.clearUpdateRanges();
                at.addUpdateRange(0, Math.max(1, n) * at.itemSize);
                at.needsUpdate = true;
            }
        },
        setFog(color, near, far) {
            mat.uniforms.fogColor.value.copy(color);
            mat.uniforms.fogNear.value = near; mat.uniforms.fogFar.value = far;
        },
        setMap(tex) { mat.uniforms.map.value = tex; },
        dispose() { geo.dispose(); base.dispose(); mat.dispose(); }
    };
    return batch;
}
