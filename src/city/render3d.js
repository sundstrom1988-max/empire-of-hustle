// ═══════════════════════════════════════════
//  STAN 3D — samma värld, sedd i 3D
//  Ett andra sätt att rita stan: 'chase' (snett
//  bakom/ovanför, GTA-känsla) och 'fps' (ögonhöjd).
//  three laddas först när någon ber om 3D, så 2D-
//  spelet laddar precis som förut.
//
//  const r3 = await createRenderer3D(overlay);
//  await r3.prepare(world);  // valfritt: bygg staden + kompilera shadrar i förväg
//  if (r3.available) r3.render(world, dt, 'chase' | 'fps', { yaw, pitch, dist });
//  r3.worldToScreen(x, y, z) → { x, y, visible, depth } (CSS-px, för HUD:en)
//  r3.getView() → { x, y, z, yaw, pitch, fov, mode } (t.ex. styrning relativt kameran)
//  r3.resize(); r3.setVisible(bool); r3.dispose();
//
//  OBS för den som kopplar in: 2D-canvasen ligger kvar ovanpå för HUD:en —
//  i 3D-läge måste den vara genomskinlig (getContext('2d', { alpha: true })
//  och clearRect i stället för den mörka bakgrunden), annars syns inte 3D.
// ═══════════════════════════════════════════

// Ren logik (ingen three) — återexporteras för tester och för den som kopplar in
export {
    toScene, fromScene, yawOf, floorsOf, buildingHeight, chaseCamera, fpsCamera, cameraSubject,
    dayPalette, figurePose, Pool, PERSON_H, EYE_H, FLOOR_H, GROUND_FLOOR_H, CAR_H, CHASE, FPS
} from './render3d/math.js';

export const MODES = ['chase', 'fps'];

// Finns WebGL alls? (utan att skapa three)
export function webglSupported() {
    if (typeof document === 'undefined') return false;
    try {
        const c = document.createElement('canvas');
        const gl = c.getContext('webgl2'); // three (r163+) kräver WebGL2
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch (e) { return false; }
}

// Det anroparen får om 3D inte går: allt är tyst och ofarligt
function unavailable(reason) {
    return {
        available: false, reason, canvas: null, stats: {},
        render() {}, resize() {}, setVisible() {}, dispose() {}, getView: (out = {}) => out, prepare: async () => false,
        worldToScreen(x, y, z, out = { x: 0, y: 0, visible: false }) { out.x = 0; out.y = 0; out.visible = false; return out; }
    };
}

// options: { maxDpr (2), adaptive (true: sänk upplösningen om det går segt), antialias, maxLights (4, mobil 2) }
export async function createRenderer3D(container, options = {}) {
    if (!container || typeof document === 'undefined') return unavailable('ingen container');
    if (!webglSupported()) return unavailable('WebGL saknas');
    let THREE, engineMod;
    try {
        [THREE, engineMod] = await Promise.all([import('three'), import('./render3d/engine.js')]);
    } catch (e) {
        console.warn('3D: kunde inte ladda three', e);
        return unavailable('laddning misslyckades');
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'city-canvas3d';
    // Under 2D-canvasen (som ritar HUD:en ovanpå) men ovanför overlayens bakgrund
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', zIndex: '-1', display: 'block', pointerEvents: 'none' });
    try {
        const cs = getComputedStyle(container);
        if (cs.position === 'static') container.style.position = 'relative';
        // z-index −1 måste stanna inne i containern: ge den en egen staplingskontext om den saknar en
        if (cs.zIndex === 'auto') container.style.isolation = 'isolate';
    } catch (e) { /* ingen stil */ }
    container.insertBefore(canvas, container.firstChild);

    const maxDpr = options.maxDpr ?? 2;
    const isTouch = typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
    let engine;
    try {
        // MSAA kostar mycket på mobil med hög upplösning — där räcker den höga pixeltätheten
        engine = engineMod.createEngine(THREE, canvas, { antialias: options.antialias ?? !isTouch, nearPx: options.nearPx, maxLights: options.maxLights ?? (isTouch ? 2 : 4) });
    } catch (e) {
        console.warn('3D: WebGL kunde inte startas', e);
        canvas.remove();
        return unavailable('WebGL-fel');
    }

    let lost = false, broken = false, errors = 0, visible = true;
    const onLost = (e) => { e.preventDefault(); lost = true; };
    const onRestored = () => { lost = false; };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    // Upplösning: devicePixelRatio (max 2), sänks steg för steg om bildrutorna blir för långa
    let dprCap = Math.min(maxDpr, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (isTouch) dprCap = Math.min(dprCap, 1.75);
    let dpr = dprCap, slowT = 0, fastT = 0, ema = 1 / 60;
    const adaptive = options.adaptive !== false;
    const resize = () => {
        const w = container.clientWidth || canvas.clientWidth || 1, h = container.clientHeight || canvas.clientHeight || 1;
        try { engine.resize(w, h, dpr); } catch (e) { console.warn('3D: resize', e); }
    };
    resize();

    const api = {
        get available() { return !lost && !broken; },
        canvas,
        get stats() { return engine.stats; },
        get three() { return THREE; },
        get _engine() { return engine; }, // för felsökning och mätning
        render(world, dt, mode = 'chase', opts = {}) {
            if (lost || broken || !visible || !world) return;
            try {
                engine.render(world, dt, mode, opts);
                errors = Math.max(0, errors - 0.02);
            } catch (e) {
                console.error('3D-fel:', e);
                if (++errors > 10) { broken = true; console.warn('3D: för många fel, stänger av 3D'); }
                return;
            }
            if (adaptive && dt > 0) {
                ema += (Math.min(0.1, dt) - ema) * 0.05;
                if (ema > 1 / 42) { slowT += dt; fastT = 0; } else if (ema < 1 / 57) { fastT += dt; slowT = 0; } else { slowT = fastT = 0; }
                if (slowT > 2 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); slowT = 0; resize(); }
                else if (fastT > 6 && dpr < dprCap) { dpr = Math.min(dprCap, dpr + 0.25); fastT = 0; resize(); }
            }
        },
        resize,
        // x, y i världen (px), z = höjd över marken (px). out kan återanvändas.
        worldToScreen(x, y, z = 0, out) { return engine.worldToScreen(x, y, z, out); },
        // Bygg staden och kompilera shadrarna i förväg (t.ex. när stan öppnas), så att
        // första växlingen till 3D inte hackar. Valfritt — render() bygger annars vid behov.
        async prepare(world) {
            if (lost || broken || !world) return false;
            try { await engine.prepare(world); return true; } catch (e) { console.warn('3D: prepare', e); return false; }
        },
        // Var kameran är och åt vilket håll den tittar: { x, y, z, yaw, pitch, fov, mode, blend }
        getView(out) { return engine.getView(out); },
        setVisible(on) {
            visible = !!on;
            canvas.style.display = visible ? 'block' : 'none';
        },
        dispose() {
            canvas.removeEventListener('webglcontextlost', onLost);
            canvas.removeEventListener('webglcontextrestored', onRestored);
            try { engine.dispose(); } catch (e) { console.warn('3D: dispose', e); }
            canvas.remove();
            broken = true;
        }
    };
    return api;
}
