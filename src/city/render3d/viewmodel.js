// ═══════════════════════════════════════════
//  STAN 3D — förstapersonens händer, vapen och
//  instrumentbräda. Egen liten scen som ritas
//  ovanpå (djupet rensas) så att händerna aldrig
//  sticker in i väggar.
// ═══════════════════════════════════════════

import { parseColor } from './math.js';

export function createViewModel(THREE) {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(70, 1, 0.5, 400);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1.4);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(0.4, 1, 0.6);
    const flash = new THREE.PointLight(0xffc870, 0, 60, 1);
    flash.position.set(4, -2, -26);
    scene.add(hemi, sun, flash);
    const L = o => new THREE.MeshLambertMaterial(o);
    const mats = {
        skin: L({ color: 0xe0ac69 }), sleeve: L({ color: 0x334155 }), metal: L({ color: 0x1f2328 }),
        grip: L({ color: 0x3a2a1c }), wood: L({ color: 0xa16207 }), dash: L({ color: 0x17191d }),
        trim: L({ color: 0x30343b }), paint: L({ color: 0x888888 }), glass: new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.08, depthWrite: false }),
        gauge: new THREE.MeshBasicMaterial({ color: 0x7dd3fc }), flashM: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    };
    const geos = [];
    const G = g => { geos.push(g); return g; };
    // ── Armar: underarm + knytnäve, kommer in snett nerifrån ──
    const mkArm = (side) => {
        const g = new THREE.Group();
        const sleeve = new THREE.Mesh(G(new THREE.CylinderGeometry(1.7, 1.5, 12, 8).rotateX(Math.PI / 2).translate(0, 0, 3)), mats.sleeve);
        const cuff = new THREE.Mesh(G(new THREE.CylinderGeometry(1.35, 1.3, 3, 8).rotateX(Math.PI / 2).translate(0, 0, -4)), mats.skin);
        const fist = new THREE.Mesh(G(new THREE.BoxGeometry(3.2, 2.8, 3.6).translate(0, 0.2, -6.8)), mats.skin);
        const knuck = new THREE.Mesh(G(new THREE.BoxGeometry(3.3, 1.3, 1.2).translate(0, 1.1, -8.4)), mats.skin);
        g.add(sleeve, cuff, fist, knuck);
        g.position.set(side * 8.5, -9, -16);
        g.rotation.set(0.08, side * -0.18, 0);
        return g;
    };
    const armR = mkArm(1), armL = mkArm(-1);
    // ── Vapen (sitter i höger hand) ──
    const weapons = {};
    const pistol = new THREE.Group();
    pistol.add(new THREE.Mesh(G(new THREE.BoxGeometry(2.2, 2.6, 12).translate(0, 2.2, -12)), mats.metal));
    pistol.add(new THREE.Mesh(G(new THREE.BoxGeometry(2, 5, 2.8).rotateX(0.25).translate(0, -0.6, -7.6)), mats.grip));
    weapons.pistol = pistol;
    const uzi = new THREE.Group();
    uzi.add(new THREE.Mesh(G(new THREE.BoxGeometry(3, 3.6, 15).translate(0, 2.4, -12)), mats.metal));
    uzi.add(new THREE.Mesh(G(new THREE.BoxGeometry(2.2, 9, 2.4).translate(0, -3, -10)), mats.metal));
    uzi.add(new THREE.Mesh(G(new THREE.CylinderGeometry(0.7, 0.7, 5, 6).rotateX(Math.PI / 2).translate(0, 2.8, -21)), mats.metal));
    weapons.uzi = uzi;
    const shotgun = new THREE.Group();
    shotgun.add(new THREE.Mesh(G(new THREE.CylinderGeometry(1, 1, 30, 8).rotateX(Math.PI / 2).translate(0, 3, -20)), mats.metal));
    shotgun.add(new THREE.Mesh(G(new THREE.BoxGeometry(3, 3.4, 10).translate(0, 1.6, -9)), mats.wood));
    shotgun.add(new THREE.Mesh(G(new THREE.BoxGeometry(2.6, 3.2, 12).rotateX(-0.15).translate(0, -0.2, 2)), mats.wood));
    weapons.shotgun = shotgun;
    const bat = new THREE.Group();
    bat.add(new THREE.Mesh(G(new THREE.CylinderGeometry(2.1, 0.9, 30, 8).rotateX(-0.9).translate(0, 9, -14)), mats.wood));
    weapons.bat = bat;
    for (const w of Object.values(weapons)) { w.visible = false; armR.add(w); }
    const muzzle = new THREE.Mesh(G(new THREE.PlaneGeometry(9, 9)), mats.flashM);
    muzzle.visible = false;
    armR.add(muzzle);
    const hands = new THREE.Group();
    hands.add(armR, armL);
    scene.add(hands);

    // ── Bil: instrumentbräda, ratt, huv, stolpar (vy från förarplatsen) ──
    const cockpit = new THREE.Group();
    // Föraren sitter till vänster: ratten rakt fram, bilens mitt (backspegel, huv) till höger
    const dash = new THREE.Mesh(G(new THREE.BoxGeometry(120, 10, 22).translate(14, -28, -40)), mats.dash);
    const dashTop = new THREE.Mesh(G(new THREE.BoxGeometry(120, 2, 16).rotateX(0.16).translate(14, -22.6, -42)), mats.trim);
    // huven: lutar nedåt bort från rutan, i bilens färg
    const hood = new THREE.Mesh(G(new THREE.BoxGeometry(84, 2, 80).rotateX(0.06).translate(14, -21.5, -94)), mats.paint);
    const wheel = new THREE.Mesh(G(new THREE.TorusGeometry(6.4, 0.8, 6, 22)), mats.trim);
    wheel.position.set(0, -25.5, -30); wheel.rotation.x = -0.45;
    const hub = new THREE.Mesh(G(new THREE.CylinderGeometry(1.8, 1.8, 1.2, 10).rotateX(Math.PI / 2)), mats.dash);
    hub.position.copy(wheel.position); hub.rotation.x = -0.45;
    const gauge1 = new THREE.Mesh(G(new THREE.CircleGeometry(1.2, 12).translate(-3.2, -23.2, -38)), mats.gauge);
    const gauge2 = new THREE.Mesh(G(new THREE.CircleGeometry(1.2, 12).translate(3.2, -23.2, -38)), mats.gauge);
    const pillarL = new THREE.Mesh(G(new THREE.BoxGeometry(1.8, 50, 1.8).rotateZ(-0.55).translate(-46, 6, -40)), mats.trim);
    const pillarR = new THREE.Mesh(G(new THREE.BoxGeometry(2.2, 50, 2.2).rotateZ(0.55).translate(74, 6, -40)), mats.trim);
    const roofE = new THREE.Mesh(G(new THREE.BoxGeometry(140, 2, 4).translate(14, 26.5, -34)), mats.trim);
    const mirror = new THREE.Mesh(G(new THREE.BoxGeometry(5.5, 1.6, 0.6).translate(17, 23.5, -34)), mats.dash);
    cockpit.add(dash, dashTop, hood, wheel, hub, gauge1, gauge2, pillarL, pillarR, roofE, mirror);
    // ── Hoj: styre och tank ──
    const bars = new THREE.Group();
    bars.add(new THREE.Mesh(G(new THREE.CylinderGeometry(0.8, 0.8, 34, 6).rotateZ(Math.PI / 2).translate(0, -8, -22)), mats.metal));
    const tank = new THREE.Mesh(G(new THREE.SphereGeometry(1, 10, 8).scale(7, 4, 10).translate(0, -15, -18)), mats.paint);
    bars.add(tank);
    bars.add(new THREE.Mesh(G(new THREE.BoxGeometry(3, 3, 3).translate(-15, -8, -22)), mats.grip));
    bars.add(new THREE.Mesh(G(new THREE.BoxGeometry(3, 3, 3).translate(15, -8, -22)), mats.grip));
    scene.add(cockpit, bars);

    let punchT = 0;
    // Smal (stående) skärm: händerna närmare mitten så att de syns
    let spread = 1;
    const place = (o, x, y, z) => o.position.set(x * spread, y - (1 - spread) * 6, z);
    return {
        scene, cam, hemi, sun,
        // läge per bildruta. p = världens spelare, prof = profilen, mode: 'foot' | 'car' | 'bike' | null
        update(p, prof, kind, dt, t, look) {
            hands.visible = kind === 'foot' && !p.dead;
            cockpit.visible = kind === 'car';
            bars.visible = kind === 'bike';
            flash.intensity = 0;
            muzzle.visible = false;
            if (look) {
                hemi.color.copy(look.sky); hemi.groundColor.copy(look.ground); hemi.intensity = look.hemiI;
                sun.color.copy(look.sun); sun.intensity = look.sunI;
            }
            if (kind === 'car' || kind === 'bike') {
                const v = p.vehicle;
                mats.paint.color.set(v.exploded ? '#1a1a1a' : v.color || '#888');
                // ratten följer styrningen lite
                wheel.rotation.z = hub.rotation.z = -(v.spin || 0) * 0.12;
                return;
            }
            if (!hands.visible) return;
            const weapon = prof && prof.weapon && prof.weapon !== 'fists' ? prof.weapon : null;
            for (const [k, w] of Object.entries(weapons)) w.visible = k === weapon;
            const moving = Math.hypot(p.vx || 0, p.vy || 0) > 20;
            const ph = p.walkPhase || 0;
            const bobX = moving ? Math.sin(ph) * 0.9 : 0, bobY = moving ? Math.abs(Math.cos(ph)) * 0.8 : Math.sin(t * 1.6) * 0.15;
            hands.position.set(bobX, -bobY, 0);
            const rgb = parseColor(prof?._shirt || '#334155');
            mats.sleeve.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
            punchT = p.punchT > 0 ? Math.min(1, punchT + dt * 14) : Math.max(0, punchT - dt * 6);
            const thrust = Math.sin(punchT * Math.PI * 0.5);
            if (weapon && weapon !== 'bat') {
                // sikta: höger hand mot mitten, vänster stödjer
                place(armR, 5, -8.5 + thrust * 0.6, -15 + thrust * 2.5);
                armR.rotation.set(0.06 + thrust * 0.2, -0.08, 0);
                place(armL, weapon === 'pistol' ? -1 : -4.5, -10.5, weapon === 'pistol' ? -14 : -22);
                armL.rotation.set(0.12, 0.3, 0);
                if (p.muzzle > 0) {
                    const tip = weapon === 'shotgun' ? -36 : weapon === 'uzi' ? -24 : -19;
                    muzzle.position.set(0, weapon === 'shotgun' ? 3 : 2.4, tip);
                    muzzle.rotation.z = Math.random() * 6;
                    muzzle.visible = true;
                    flash.intensity = 40;
                }
            } else if (weapon === 'bat') {
                place(armR, 9, -10 + thrust * 4, -17 - thrust * 6);
                armR.rotation.set(0.15 - thrust * 1.1, -0.25 - thrust * 0.4, -thrust * 0.6);
                place(armL, -9.5, -11.5, -18); armL.rotation.set(0.15, 0.25, 0);
            } else {
                // knytnävar längst ner i bild: höger slår rakt fram
                place(armR, 9.5, -10.5 + thrust * 3, -17 - thrust * 9);
                armR.rotation.set(0.22 + thrust * 0.1, -0.28 + thrust * 0.2, 0);
                place(armL, -9.5, -10.5, -17); armL.rotation.set(0.22, 0.28, 0);
            }
        },
        resize(aspect, fov) {
            cam.aspect = aspect; cam.fov = fov; cam.updateProjectionMatrix();
            spread = Math.max(0.42, Math.min(1, aspect / 1.6));
            hands.scale.setScalar(0.5 + 0.5 * spread);
        },
        dispose() { geos.forEach(g => g.dispose()); Object.values(mats).forEach(m => m.dispose()); }
    };
}
