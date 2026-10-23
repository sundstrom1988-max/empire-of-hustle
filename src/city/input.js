// ═══════════════════════════════════════════
//  STAN — tangentbord, mus, touchknappar,
//  joystick (mobil), pekarlås och blick, samt
//  styrningen till fots (W längs blicken)
// ═══════════════════════════════════════════

// ── Joystick: ren matematik (testas i tests/joystick.test.js) ──
export const STICK_RADIUS = 55;     // px: så långt knoppen får gå från basen
export const STICK_DEAD = 0.15;     // dödzon (andel av radien)
export const STICK_RUN = 0.85;      // drar man nästan i botten springer man

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Fingrets förskjutning från basen → riktning och styrka 0..1.
// Dödzonen skalas om så att styrkan börjar på 0 vid kanten (inget hopp).
export function stickVector(dx, dy, radius = STICK_RADIUS, dead = STICK_DEAD) {
    const d = Math.hypot(dx, dy);
    if (!(radius > 0) || !(d > dead * radius)) return { x: 0, y: 0, mag: 0 };
    const mag = clamp((Math.min(1, d / radius) - dead) / (1 - dead), 0, 1);
    return { x: dx / d * mag, y: dy / d * mag, mag };
}

// Var knoppen ritas: följer fingret men stannar på ringen
export function stickKnob(dx, dy, radius = STICK_RADIUS) {
    const d = Math.hypot(dx, dy);
    if (d <= radius || d === 0) return { x: dx, y: dy };
    return { x: dx / d * radius, y: dy / d * radius };
}

// Var basen hamnar när tummen sätts ned: där tummen är, men hela ringen (radius) ska
// rymmas på skärmen (area = skärmen i zonens koordinater). Annars når fingret inte fullt
// utslag mot kanten. Klampad bas = knoppen visar direkt ett utslag mot fingret.
export function stickOrigin(p, area, radius) {
    const fit = (v, a0, len) => len >= radius * 2 ? clamp(v, a0 + radius, a0 + len - radius) : a0 + len / 2;
    return { x: fit(p.x, area.x, area.w), y: fit(p.y, area.y, area.h) };
}

// Till fots: gå åt joystickens håll (skärm: upp = norr), spring vid fullt utslag
export function stickWalk(stick) {
    const mag = stick?.active ? stick.mag || 0 : 0;
    if (!(mag > 0)) return { mx: 0, my: 0, run: false };
    return { mx: stick.x / mag, my: stick.y / mag, run: mag > STICK_RUN };
}

// I bilen i 3D (förstaperson/följkamera): gaspedal och ratt, relativt bilen. Upp = gas,
// ned = broms/back, åt sidan = ratt. "Kör dit du drar" fungerar bara när kameran står
// still (överblicken) — bakom en bil som svänger skulle målet vrida sig med kameran.
export function stickPedals(stick) {
    const mag = stick?.active ? stick.mag || 0 : 0;
    if (!(mag > 0)) return { throttle: 0, steer: 0 };
    const sx = stick.x, sy = stick.y;
    return {
        throttle: clamp(-sy * 1.15, -1, 1),
        steer: clamp(Math.sign(sx) * Math.pow(Math.abs(sx), 1.2) * 1.25, -1, 1)
    };
}

// I bilen: "kör dit du drar". Bilen svänger mot joystickens riktning och gasar
// efter utslaget. Rakt bakåt i låg fart = backa (med bakänden mot dit man drar).
// speed = bilens fart framåt (negativ när den backar). maxSpeed (valfri): ett
// halvt utslag håller ungefär halva toppfarten — lättare att smyga i trånga gator.
// blocked: bilen står fast med nosen mot något (stickCar) — backa loss och vrid
// nosen mot draget, som en trepunktsvändning.
const REVERSE_CONE = Math.PI * 0.72;   // så här långt från nosen räknas som "bakåt"
const REVERSE_SPEED = 60;              // under den farten får man backa
const STEER_GAIN = 2.2;
const REVERSE_SIDE = 15;               // px/s bakåt innan ratten räknas som backande
export function stickDrive(stick, vehicleAngle, speed = 0, maxSpeed = 0, blocked = false) {
    const mag = stick?.active ? stick.mag || 0 : 0;
    if (!(mag > 0)) return { throttle: 0, steer: 0 };
    const want = Math.atan2(stick.y, stick.x);
    const diff = wrapAngle(want - vehicleAngle);           // + = medurs på skärmen = höger
    // Backande bil svänger åt andra hållet — men först när den verkligen backar: mot en vägg
    // studsar en bil som gasar fram till ~−0,4 px/s, och då vände rattutslaget så att den
    // vred sig åt fel håll i stället för loss längs väggen (C, NOTES)
    const side = speed < -REVERSE_SIDE ? -1 : 1;
    if (blocked) return { throttle: -Math.max(0.6, mag), steer: clamp(diff * STEER_GAIN, -1, 1) * (speed < 0 ? -1 : 1) };
    const reversing = speed < -15 && Math.abs(diff) > Math.PI / 2;
    if (reversing || (Math.abs(diff) > REVERSE_CONE && speed < REVERSE_SPEED)) {
        const tail = wrapAngle(want - vehicleAngle - Math.PI);
        return { throttle: -mag, steer: clamp(tail * STEER_GAIN, -1, 1) * side };
    }
    // Rakt fram = full gas, i sidled försiktigare. Åt fel håll: i fart bromsar den
    // in i svängen, sakta vänder den med lite gas (mjuk övergång mellan dem).
    const align = Math.cos(diff);
    const fast = clamp((speed - REVERSE_SPEED) / 120, 0, 1);
    let throttle = mag * (align >= 0 ? 0.35 + 0.65 * align : 0.35 + 1.35 * align * fast);
    if (maxSpeed > 0 && throttle > 0 && mag < 0.95) {
        const cap = maxSpeed * Math.max(0.25, mag);
        if (speed > cap) throttle = speed > cap + 40 ? -0.25 : 0;
    }
    return { throttle, steer: clamp(diff * STEER_GAIN, -1, 1) * side };
}

// Joysticken i bilen, med minne mellan stegen (mem: ett objekt som staden håller).
// En bil som står still kan inte svänga (styrningen kräver fart), så med nosen mot en
// vägg och draget åt sidan trycker den bara mot väggen. Märker vi det backar den loss
// en stund (stickDrive med blocked) och sedan styr man som vanligt igen.
const STUCK_TIME = 0.25;    // s med gasen i utan att komma någonstans
const STUCK_PUSH = 8;       // px/s: minst så fort gasen borde ha fått upp bilen hittills...
const STUCK_SLOW = 5;       // ...men den står i princip still (väggen trycker tillbaka den)
const UNSTICK_TIME = 0.7;   // backa så här länge som mest
const UNSTICK_DIST = 36;    // ...eller tills den kommit så här långt
const UNSTICK_AIM = 0.6;    // ...eller tills nosen pekar nästan dit man drar (och den backat en bit)
export function stickCar(mem, stick, car, dt) {
    if (mem.car !== car) Object.assign(mem, { car, t: 0, backT: 0 });
    const fwd = car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
    const max = car.spec.maxSpeed;
    const moved = () => Math.hypot(car.x - mem.x, car.y - mem.y);
    if (mem.backT > 0) {
        const aim = Math.abs(wrapAngle(Math.atan2(stick.y, stick.x) - car.angle));
        const d = moved();
        mem.backT = d >= UNSTICK_DIST || (aim < UNSTICK_AIM && d >= UNSTICK_DIST * 0.45) ? 0 : mem.backT - dt;
        if (mem.backT > 0) return stickDrive(stick, car.angle, fwd, max, true);
    }
    const ctl = stickDrive(stick, car.angle, fwd, max);
    // Gasar framåt och vill svänga men står still? (rakt in i väggen = spelarens val)
    if (ctl.throttle > 0 && Math.abs(ctl.steer) > 0.8 && Math.abs(fwd) < STUCK_SLOW) {
        if (!(mem.t > 0) || moved() > 2) Object.assign(mem, { t: 0, push: 0, f0: fwd, x: car.x, y: car.y });
        mem.t += dt;
        mem.push += car.spec.accel * ctl.throttle * dt;
        // Fri bil hade fått upp farten med push (minus lite friktion) — den här har inte det
        if (mem.t >= STUCK_TIME && mem.push > STUCK_PUSH && fwd - mem.f0 < mem.push * 0.4) {
            Object.assign(mem, { t: 0, backT: UNSTICK_TIME, x: car.x, y: car.y });
            return stickDrive(stick, car.angle, fwd, max, true);
        }
    } else mem.t = 0;
    return ctl;
}

// ── Till fots: blick, gång och uthållighet (ren matematik, tests/controls.test.js) ──
// W går längs blicken och A/D är sidsteg relativt den — aldrig fasta världsaxlar.
// Vinklar som i resten av stan: 0 = öster (+x), π/2 = söder (+y, nedåt på skärmen).
const TAU = Math.PI * 2;

// Vinkeln i (−π, π], hur många varv man än snurrat (−π blir π)
export function normAngle(a) {
    if (!Number.isFinite(a)) return 0;
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    else if (a <= -Math.PI) a += TAU;
    return a;
}

// Blicken: turn (radianer, musen i 3D eller touch-look) vrider gubben, annars tittar
// han mot aim (världspunkten under pekaren i överblick). Ingen av dem flyttar honom.
export function lookAngle(angle, input, x, y) {
    if (input.turn) return normAngle(angle + input.turn);
    const a = input.aim;
    if (a && (a.x !== x || a.y !== y)) return normAngle(Math.atan2(a.y - y, a.x - x));
    return normAngle(angle);
}

// Vart gubben går, i världen (längd 0 eller 1):
//  - joysticken (mx, my) är redan omräknad till världsriktning av staden (index.js)
//  - annars tangenterna relativt blicken a: F = (cos a, sin a), R = (−sin a, cos a),
//    v = fwd·F + strafe·R, normerad så att diagonalen inte går fortare
export function footMove(angle, input) {
    const mx = input.mx || 0, my = input.my || 0;
    const sl = Math.hypot(mx, my);
    if (sl > 0.01) return { x: mx / sl, y: my / sl, stick: true };
    const f = input.fwd || 0, s = input.strafe || 0;
    if (!f && !s) return { x: 0, y: 0, stick: false };
    const c = Math.cos(angle), n = Math.sin(angle);
    const x = f * c - s * n, y = f * n + s * c;
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len, stick: false } : { x, y, stick: false };
}

// Uthållighet 0–100: spring drar, vila fyller på. Den som kört slut är andfådd och
// kan inte springa igen förrän den är tillbaka på STAMINA_RECOVER. Allt per sekund,
// så det blir samma oavsett bildfrekvens.
export const STAMINA_MAX = 100;
export const STAMINA_DRAIN = 12;     // i spring: full → tom på drygt 8 s
export const STAMINA_WALK = 10;      // tillbaka när man går
export const STAMINA_REST = 20;      // ... när man står still eller sitter i bilen
export const STAMINA_RECOVER = 30;
// s = spelaren ({ stamina, winded }). Ger true om han springer det här steget.
export function staminaStep(s, dt, wantRun, moving) {
    if (!Number.isFinite(s.stamina)) s.stamina = STAMINA_MAX;
    if (s.winded && s.stamina >= STAMINA_RECOVER) s.winded = false;
    const run = !!wantRun && !!moving && !s.winded && s.stamina > 0;
    if (run) {
        s.stamina = Math.max(0, s.stamina - STAMINA_DRAIN * dt);
        if (s.stamina <= 0) s.winded = true;
    } else s.stamina = Math.min(STAMINA_MAX, s.stamina + (moving ? STAMINA_WALK : STAMINA_REST) * dt);
    return run;
}

const PINCH_MIN = 16;   // px: fingrar närmare än så räknas som så här långt isär (inga jättefaktorer)

// Pekgränssnittet (joystickar, knappar, inget pekarlås) bara när den PRIMÄRA pekaren är ett
// finger. En bärbar dator med pekskärm har touch-händelser ('ontouchstart') men mus och
// tangentbord — där ska musen styra blicken, annars går blicken inte att vrida alls.
export function primaryTouch(win = typeof window !== 'undefined' ? window : null) {
    try { return !!win?.matchMedia?.('(pointer: coarse)').matches; } catch (e) { return false; }
}

// Skriver man i ett textfält (chatt, SMS) ska spelet inte röra sig
export function isTypingTarget(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
}

const MAP = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'hb',
    KeyE: 'act', Enter: 'act', KeyF: 'act',
    KeyH: 'horn',
    KeyR: 'r',          // radio i bilen, rån till fots
    KeyQ: 'weapon',
    KeyM: 'map',
    KeyT: 'phone',
    KeyV: 'cam', KeyC: 'cam',   // byt kameraläge: förstaperson → följkamera → överblick
    Digit1: 'c1', Digit2: 'c2', Digit3: 'c3',
    ShiftLeft: 'run', ShiftRight: 'run',
    KeyP: 'pause',
    Escape: 'exit'
};

export class Input {
    constructor(root) {
        this.held = new Set();
        this.edges = new Set();
        this.root = root;
        const doc = typeof document !== 'undefined' ? document : null;
        this.doc = doc;
        // Fokus i ett textfält (chatt, SMS): inga spelkontroller
        const typing = (e) => isTypingTarget(e.target) || isTypingTarget(doc?.activeElement);
        this.onKeyDown = (e) => {
            const k = MAP[e.code];
            if (!k || typing(e)) return;
            // Esc som släpper pekarlåset (3D) är inte "åk hem"
            if (k === 'exit' && (this.locked || performance.now() - this.lockLostT < 300)) return;
            e.preventDefault();
            if (!e.repeat) this.edges.add(k);
            this.held.add(k);
        };
        // Släppa går alltid, även i ett textfält: annars fastnar W om man klickar in i chatten med den nere
        this.onKeyUp = (e) => {
            const k = MAP[e.code];
            if (!k) return;
            this.held.delete(k);
            if (!typing(e)) e.preventDefault();
        };
        // Inga fastnade tangenter eller knappar när fönstret tappar fokus, fliken döljs eller man börjar skriva
        this.onBlur = () => this.releaseAll();
        this.onVisibility = () => { if (doc?.hidden) this.releaseAll(); };
        this.onFocusIn = (e) => { if (isTypingTarget(e.target)) this.releaseAll(); };
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);
        doc?.addEventListener('visibilitychange', this.onVisibility);
        doc?.addEventListener('focusin', this.onFocusIn);

        // Mus (dator): sikta med pekaren, vänsterklick slår/skjuter, hjulet zoomar.
        // ignoreMouse(x, y) låter staden säga "det här klicket var på kartan" (eller bakom en meny).
        this.mouse = { x: 0, y: 0, t: -1e9, inside: false };
        this.wheel = 0;
        this.ignoreMouse = null;
        // Pekarlås (3D): index.js sätter lockWanted. Klicket som tar låset sväljs (inget skott).
        // I låst läge summeras musens rörelse till blicken (takeLook).
        // Fingrar på canvasen (inte joysticken eller knapparna, de har egna element):
        // ett finger tittar runt (touch-look → takeLook), två är ett nyp (zoom → takePinch).
        this.lockWanted = false;
        this.onLockChange = null;
        this.lockLostT = -1e9;
        this.look = { dx: 0, dy: 0 };
        this.lookId = null;
        this.touches = new Map();   // pointerId → { x, y } för fingrarna på canvasen
        this.pinch = null;          // { a, b, d } medan två fingrar nyper
        this.pinchScale = 1;
        this.canvas = root.querySelector('canvas');
        if (this.canvas) {
            const pos = (e) => { const b = this.canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
            // Låst: pekaren står still där låset togs — räkna klicket som mitt i bild
            const mid = () => { const b = this.canvas.getBoundingClientRect(); return { x: b.width / 2, y: b.height / 2 }; };
            const clampMove = v => Math.max(-250, Math.min(250, Number(v) || 0)); // webbläsare ger ibland ett jättehopp precis vid låset
            const isMouse = e => !e.pointerType || e.pointerType === 'mouse';
            this.onMouseMove = (e) => {
                if (!isMouse(e)) { if (this.touches.has(e.pointerId)) this.touchMove(e); return; }
                if (this.locked) { this.look.dx += clampMove(e.movementX); this.look.dy += clampMove(e.movementY); return; }
                Object.assign(this.mouse, pos(e), { t: performance.now(), inside: true });
            };
            this.onMouseDown = (e) => {
                if (!isMouse(e)) { this.touchDown(e, pos(e)); return; }
                if (e.button !== 0) return;
                const locked = this.locked;
                const p = locked ? mid() : pos(e);
                if (!locked) Object.assign(this.mouse, p, { t: performance.now(), inside: true });
                if (this.ignoreMouse && this.ignoreMouse(p.x, p.y)) return;
                if (this.lockWanted && !locked) { this.requestLock(); return; }
                if (!this.held.has('fire')) this.edges.add('fire');
                this.held.add('fire');
            };
            this.onMouseUp = (e) => {
                if (!isMouse(e)) { if (this.touches.has(e.pointerId)) this.touchUp(e.pointerId); return; }
                if (e.button === 0) this.held.delete('fire');
            };
            this.onTouchEnd = (e) => { if (!isMouse(e) && this.touches.has(e.pointerId)) this.touchUp(e.pointerId); };
            this.onMouseLeave = (e) => {
                if (!isMouse(e) || this.locked) return;
                this.mouse.inside = false;
                this.held.delete('fire');
            };
            this.onWheel = (e) => { e.preventDefault(); this.wheel += Math.sign(e.deltaY); };
            this.onContext = (e) => e.preventDefault();
            this.canvas.addEventListener('pointermove', this.onMouseMove);
            this.canvas.addEventListener('pointerdown', this.onMouseDown);
            window.addEventListener('pointerup', this.onMouseUp);
            this.canvas.addEventListener('pointercancel', this.onTouchEnd);
            this.canvas.addEventListener('lostpointercapture', this.onTouchEnd);
            this.canvas.addEventListener('pointerleave', this.onMouseLeave);
            this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
            this.canvas.addEventListener('contextmenu', this.onContext);
            // Låset kommer och går (Esc, fokusbyte): blicken nollas, och pekarens gamla
            // position siktar inte förrän musen rört sig igen
            this.onLockEv = () => {
                const on = this.locked;
                if (!on) this.lockLostT = performance.now();
                this.held.delete('fire');
                this.look.dx = this.look.dy = 0;
                this.mouse.t = -1e9;
                if (this.onLockChange) this.onLockChange(on);
            };
            doc?.addEventListener('pointerlockchange', this.onLockEv);
        }

        // Touchknappar: <button data-key="up"> osv.
        this.buttons = [...root.querySelectorAll('[data-key]')];
        this.buttons.forEach(btn => {
            const k = btn.dataset.key;
            const down = (e) => {
                e.preventDefault();
                try { btn.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
                if (!this.held.has(k)) this.edges.add(k);
                this.held.add(k);
                btn.classList.add('pressed');
            };
            const up = (e) => {
                e.preventDefault();
                this.held.delete(k);
                btn.classList.remove('pressed');
            };
            btn.addEventListener('pointerdown', down);
            btn.addEventListener('pointerup', up);
            btn.addEventListener('pointercancel', up);
            btn.addEventListener('lostpointercapture', up);
            btn.addEventListener('contextmenu', e => e.preventDefault());
            btn._handlers = { down, up };
        });

        // Joysticken (mobil): flytande — basen hamnar där tummen sätts ned i zonen.
        // Bara ett finger styr den (pointerId), så knapparna till höger funkar samtidigt.
        // stickGate() låter staden säga nej (t.ex. "det trycket stängde kartan").
        this.stick = { x: 0, y: 0, mag: 0, active: false };
        this.stickGate = null;
        this.stickId = null;
        this.zone = root.querySelector('.ct-stick');
        if (this.zone) {
            const base = this.zone.querySelector('.ct-stick-base');
            const knob = this.zone.querySelector('.ct-stick-knob');
            const local = (e) => { const b = this.zone.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
            const move = (e) => {
                const p = local(e);
                const dx = p.x - this.stickO.x, dy = p.y - this.stickO.y;
                Object.assign(this.stick, stickVector(dx, dy, this.stickR));
                const k = stickKnob(dx, dy, this.stickR);
                knob.style.transform = `translate(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px)`;
                base.classList.toggle('run', this.stick.mag > STICK_RUN);
            };
            this.onStickDown = (e) => {
                e.preventDefault();
                if (this.stickId !== null) return; // ett finger styr redan
                if (this.stickGate && !this.stickGate()) return;
                this.stickId = e.pointerId;
                try { this.zone.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
                // Radien följer basens storlek i CSS (mindre på små skärmar)
                this.stickR = base.offsetWidth ? Math.max(30, base.offsetWidth / 2 - 6) : STICK_RADIUS;
                // Nära skärmkanten flyttas basen in så att hela ringen syns och fingret når fullt utslag
                const z = this.zone.getBoundingClientRect(), o = root.getBoundingClientRect();
                const ring = (base.offsetWidth ? base.offsetWidth / 2 : this.stickR + 6) + 4;
                this.stickO = stickOrigin(local(e), { x: o.left - z.left, y: o.top - z.top, w: o.width, h: o.height }, ring);
                base.style.left = `${this.stickO.x}px`;
                base.style.top = `${this.stickO.y}px`;
                base.classList.add('on');
                this.stick.active = true;
                move(e);
            };
            this.onStickMove = (e) => {
                if (e.pointerId !== this.stickId) return;
                e.preventDefault();
                move(e);
            };
            this.onStickUp = (e) => {
                if (e.pointerId !== this.stickId) return;
                this.resetStick();
            };
            this.resetStick = () => {
                this.stickId = null;
                Object.assign(this.stick, { x: 0, y: 0, mag: 0, active: false });
                base.classList.remove('on', 'run');
                base.style.left = base.style.top = '';
                knob.style.transform = '';
            };
            this.zone.addEventListener('pointerdown', this.onStickDown);
            this.zone.addEventListener('pointermove', this.onStickMove);
            this.zone.addEventListener('pointerup', this.onStickUp);
            this.zone.addEventListener('pointercancel', this.onStickUp);
            this.zone.addEventListener('lostpointercapture', this.onStickUp);
            this.zone.addEventListener('contextmenu', this.onContextZone = e => e.preventDefault());
        } else this.resetStick = () => { };

        // Titt-joysticken (mobil, höger tumme, bara i 3D): fast bas. Utslaget vrider blicken
        // så länge den hålls (staden räknar om det med lookStickDelta).
        this.lookStick = { x: 0, y: 0, mag: 0, active: false };
        this.lookStickId = null;
        this.lookZone = root.querySelector('.ct-look');
        if (this.lookZone) {
            const base = this.lookZone.querySelector('.ct-look-base');
            const knob = this.lookZone.querySelector('.ct-look-knob');
            const move = (e) => {
                const b = base.getBoundingClientRect();
                const r = Math.max(24, b.width / 2 - 8);
                const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
                Object.assign(this.lookStick, stickVector(dx, dy, r, 0.12));
                const k = stickKnob(dx, dy, r);
                knob.style.transform = `translate(${k.x.toFixed(1)}px, ${k.y.toFixed(1)}px)`;
            };
            this.onLookDown = (e) => {
                e.preventDefault();
                if (this.lookStickId !== null) return;
                this.lookStickId = e.pointerId;
                try { this.lookZone.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
                base.classList.add('on');
                this.lookStick.active = true;
                move(e);
            };
            this.onLookMove = (e) => { if (e.pointerId === this.lookStickId) { e.preventDefault(); move(e); } };
            this.onLookUp = (e) => { if (e.pointerId === this.lookStickId) this.resetLookStick(); };
            this.resetLookStick = () => {
                this.lookStickId = null;
                Object.assign(this.lookStick, { x: 0, y: 0, mag: 0, active: false });
                base.classList.remove('on');
                knob.style.transform = '';
            };
            this.lookZone.addEventListener('pointerdown', this.onLookDown);
            this.lookZone.addEventListener('pointermove', this.onLookMove);
            this.lookZone.addEventListener('pointerup', this.onLookUp);
            this.lookZone.addEventListener('pointercancel', this.onLookUp);
            this.lookZone.addEventListener('lostpointercapture', this.onLookUp);
            this.lookZone.addEventListener('contextmenu', this.onContextLook = e => e.preventDefault());
        } else this.resetLookStick = () => { };
    }

    has(k) { return this.held.has(k); }
    pressed(k) {
        if (this.edges.has(k)) { this.edges.delete(k); return true; }
        return false;
    }

    // ── Pekarlås och blick ──
    get locked() { return !!this.canvas && !!this.doc && this.doc.pointerLockElement === this.canvas; }
    requestLock() {
        const c = this.canvas;
        if (!c || !c.requestPointerLock || this.locked) return;
        try {
            const r = c.requestPointerLock();
            if (r && typeof r.catch === 'function') r.catch(() => { }); // t.ex. direkt efter Esc: nästa klick försöker igen
        } catch (e) { /* inget pekarlås här (iframe, äldre webbläsare) */ }
    }
    releaseLock() {
        if (!this.locked) return;
        try { this.doc.exitPointerLock(); } catch (e) { /* redan släppt */ }
    }
    // ── Fingrar på canvasen: ett = titta runt (touch-look), två = nyp (zoom) ──
    // Det första fingret räknas inte på minikartan eller bakom en meny (samma ignoreMouse
    // som musen); ett andra finger är ett nyp var det än landar. Ett tredje ignoreras.
    touchDown(e, p) {
        const t = this.touches;
        if (t.has(e.pointerId) || t.size >= 2) return;
        if (!t.size && this.ignoreMouse && this.ignoreMouse(p.x, p.y)) return;
        t.set(e.pointerId, { x: e.clientX, y: e.clientY });
        try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
        if (t.size === 1) { this.lookId = e.pointerId; return; }
        // Två fingrar: nyp. Ingen blick under tiden — inte heller det som första fingret
        // hann dra innan det andra landade.
        const [a, b] = [...t.keys()];
        this.lookId = null;
        this.look.dx = this.look.dy = 0;
        this.pinch = { a, b, d: this.fingerDist(a, b) };
    }
    touchMove(e) {
        const f = this.touches.get(e.pointerId);
        const dx = e.clientX - f.x, dy = e.clientY - f.y;
        f.x = e.clientX; f.y = e.clientY;
        const pi = this.pinch;
        if (pi && (e.pointerId === pi.a || e.pointerId === pi.b)) {
            const d = this.fingerDist(pi.a, pi.b);
            this.pinchScale *= d / pi.d;
            pi.d = d;
        } else if (e.pointerId === this.lookId) {
            this.look.dx += dx;
            this.look.dy += dy;
        }
    }
    // Ett finger lyfts. Efter ett nyp tittar fingret som är kvar inte runt förrän det också
    // lyfts (inget ryck när fingrarna släpper olika fort); ett nytt finger bredvid = nytt nyp.
    touchUp(id) {
        this.touches.delete(id);
        if (this.lookId === id) this.lookId = null;
        if (this.pinch && (id === this.pinch.a || id === this.pinch.b)) this.pinch = null;
    }
    fingerDist(a, b) {
        const p = this.touches.get(a), q = this.touches.get(b);
        return Math.max(PINCH_MIN, Math.hypot(p.x - q.x, p.y - q.y));
    }
    get pinching() { return !!this.pinch; }
    // Blicken sedan förra gången: musens rörelse i låst läge + touch-look, i skärm-px
    takeLook() {
        const l = { dx: this.look.dx, dy: this.look.dy };
        this.look.dx = this.look.dy = 0;
        return l;
    }
    // Nypet sedan förra gången som skalfaktor: 1 = ingen ändring, >1 = fingrarna isär (zooma in),
    // <1 = ihop (zooma ut). Flera rörelser mellan två läsningar multipliceras ihop.
    takePinch() {
        const s = this.pinchScale;
        this.pinchScale = 1;
        return Number.isFinite(s) && s > 0 ? s : 1;
    }

    // Släpp allt som hålls nere: fokusbyte, dold flik, textfält
    releaseAll() {
        this.held.clear();
        this.edges.clear();
        this.buttons?.forEach(b => b.classList?.remove('pressed'));
        this.resetStick?.();
        this.resetLookStick?.();
        this.lookId = null;
        this.look.dx = this.look.dy = 0;
        this.touches?.clear();
        this.pinch = null;
        this.pinchScale = 1;
    }

    // Kontrolltillstånd för den här framen.
    // Bil: throttle/steer. Till fots: fwd/strafe relativt blicken (world.js vrider dem
    // med gubbens vinkel). mx/my = joysticken i skärmens riktning (upp = −y); staden
    // räknar om den till världsriktning, och i bilen till gas/ratt med stickCar().
    state() {
        const up = this.has('up') ? 1 : 0, down = this.has('down') ? 1 : 0;
        const left = this.has('left') ? 1 : 0, right = this.has('right') ? 1 : 0;
        const walk = stickWalk(this.stick);
        return {
            throttle: up - down,
            steer: right - left,
            handbrake: this.has('hb'),
            fwd: up - down,
            strafe: right - left,
            mx: walk.mx,
            my: walk.my,
            run: this.has('run') || walk.run,
            horn: this.has('horn'),
            action: this.pressed('act'),
            punch: this.pressed('hb') || this.pressed('fire'),   // Space eller vänsterklick till fots = slag/skott
            attack: this.has('hb') || this.has('fire'),          // hålls inne = automateld (Uzi)
            rob: this.pressed('r'),
            weapon: this.pressed('weapon')
        };
    }

    // Musen siktar om den rört sig nyligen (eller en knapp hålls inne). Låst (3D) siktar den aldrig mot en punkt.
    aimActive(now = performance.now()) { return !this.locked && this.mouse.inside && (now - this.mouse.t < 4000 || this.held.has('fire')); }

    // Hjulet sedan förra gången: -1 = in, +1 = ut, 0 = inget
    takeWheel() { const w = Math.sign(this.wheel); this.wheel = 0; return w; }

    endFrame() { this.edges.clear(); }

    destroy() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.doc?.removeEventListener('visibilitychange', this.onVisibility);
        this.doc?.removeEventListener('focusin', this.onFocusIn);
        if (this.canvas) {
            this.releaseLock();
            this.doc?.removeEventListener('pointerlockchange', this.onLockEv);
            this.canvas.removeEventListener('pointermove', this.onMouseMove);
            this.canvas.removeEventListener('pointerdown', this.onMouseDown);
            window.removeEventListener('pointerup', this.onMouseUp);
            this.canvas.removeEventListener('pointercancel', this.onTouchEnd);
            this.canvas.removeEventListener('lostpointercapture', this.onTouchEnd);
            this.canvas.removeEventListener('pointerleave', this.onMouseLeave);
            this.canvas.removeEventListener('wheel', this.onWheel);
            this.canvas.removeEventListener('contextmenu', this.onContext);
        }
        this.buttons.forEach(btn => {
            const h = btn._handlers;
            if (!h) return;
            btn.removeEventListener('pointerdown', h.down);
            btn.removeEventListener('pointerup', h.up);
            btn.removeEventListener('pointercancel', h.up);
            btn.removeEventListener('lostpointercapture', h.up);
        });
        if (this.zone) {
            this.zone.removeEventListener('pointerdown', this.onStickDown);
            this.zone.removeEventListener('pointermove', this.onStickMove);
            this.zone.removeEventListener('pointerup', this.onStickUp);
            this.zone.removeEventListener('pointercancel', this.onStickUp);
            this.zone.removeEventListener('lostpointercapture', this.onStickUp);
            this.zone.removeEventListener('contextmenu', this.onContextZone);
        }
        if (this.lookZone) {
            this.lookZone.removeEventListener('pointerdown', this.onLookDown);
            this.lookZone.removeEventListener('pointermove', this.onLookMove);
            this.lookZone.removeEventListener('pointerup', this.onLookUp);
            this.lookZone.removeEventListener('pointercancel', this.onLookUp);
            this.lookZone.removeEventListener('lostpointercapture', this.onLookUp);
            this.lookZone.removeEventListener('contextmenu', this.onContextLook);
        }
        this.resetStick();
        this.resetLookStick();
        this.held.clear();
        this.edges.clear();
    }
}
