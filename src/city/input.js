// ═══════════════════════════════════════════
//  STAN — tangentbord, mus, touchknappar och
//  joystick (mobil)
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

// Till fots: gå åt joystickens håll (skärm: upp = norr), spring vid fullt utslag
export function stickWalk(stick) {
    const mag = stick?.active ? stick.mag || 0 : 0;
    if (!(mag > 0)) return { mx: 0, my: 0, run: false };
    return { mx: stick.x / mag, my: stick.y / mag, run: mag > STICK_RUN };
}

// I bilen: "kör dit du drar". Bilen svänger mot joystickens riktning och gasar
// efter utslaget. Rakt bakåt i låg fart = backa (med bakänden mot dit man drar).
// speed = bilens fart framåt (negativ när den backar). maxSpeed (valfri): ett
// halvt utslag håller ungefär halva toppfarten — lättare att smyga i trånga gator.
const REVERSE_CONE = Math.PI * 0.72;   // så här långt från nosen räknas som "bakåt"
const REVERSE_SPEED = 60;              // under den farten får man backa
const STEER_GAIN = 2.2;
export function stickDrive(stick, vehicleAngle, speed = 0, maxSpeed = 0) {
    const mag = stick?.active ? stick.mag || 0 : 0;
    if (!(mag > 0)) return { throttle: 0, steer: 0 };
    const want = Math.atan2(stick.y, stick.x);
    const diff = wrapAngle(want - vehicleAngle);           // + = medurs på skärmen = höger
    const side = speed < 0 ? -1 : 1;                        // backande bil svänger åt andra hållet
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
    KeyV: 'zoom',
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
        // Skriver man i ett textfält (t.ex. SMS) ska spelet inte röra sig
        const typing = (e) => {
            const t = e.target;
            return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
        };
        this.onKeyDown = (e) => {
            if (typing(e)) return;
            const k = MAP[e.code];
            if (!k) return;
            e.preventDefault();
            if (!e.repeat) this.edges.add(k);
            this.held.add(k);
        };
        this.onKeyUp = (e) => {
            if (typing(e)) return;
            const k = MAP[e.code];
            if (k) { this.held.delete(k); e.preventDefault(); }
        };
        this.onBlur = () => { this.held.clear(); this.resetStick?.(); }; // inga fastnade tangenter när fönstret tappar fokus
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);

        // Mus (dator): sikta med pekaren, vänsterklick slår/skjuter, hjulet zoomar.
        // ignoreMouse(x, y) låter staden säga "det här klicket var på kartan".
        this.mouse = { x: 0, y: 0, t: -1e9, inside: false };
        this.wheel = 0;
        this.ignoreMouse = null;
        this.canvas = root.querySelector('canvas');
        if (this.canvas) {
            const pos = (e) => { const b = this.canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
            this.onMouseMove = (e) => {
                if (e.pointerType && e.pointerType !== 'mouse') return;
                Object.assign(this.mouse, pos(e), { t: performance.now(), inside: true });
            };
            this.onMouseDown = (e) => {
                if ((e.pointerType && e.pointerType !== 'mouse') || e.button !== 0) return;
                const p = pos(e);
                Object.assign(this.mouse, p, { t: performance.now(), inside: true });
                if (this.ignoreMouse && this.ignoreMouse(p.x, p.y)) return;
                if (!this.held.has('fire')) this.edges.add('fire');
                this.held.add('fire');
            };
            this.onMouseUp = (e) => { if (e.button === 0) this.held.delete('fire'); };
            this.onMouseLeave = () => { this.mouse.inside = false; this.held.delete('fire'); };
            this.onWheel = (e) => { e.preventDefault(); this.wheel += Math.sign(e.deltaY); };
            this.onContext = (e) => e.preventDefault();
            this.canvas.addEventListener('pointermove', this.onMouseMove);
            this.canvas.addEventListener('pointerdown', this.onMouseDown);
            window.addEventListener('pointerup', this.onMouseUp);
            this.canvas.addEventListener('pointerleave', this.onMouseLeave);
            this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
            this.canvas.addEventListener('contextmenu', this.onContext);
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
                this.stickO = local(e);
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
    }

    has(k) { return this.held.has(k); }
    pressed(k) {
        if (this.edges.has(k)) { this.edges.delete(k); return true; }
        return false;
    }

    // Kontrolltillstånd för den här framen.
    // Joysticken styr gången här; i bilen räknar staden om den med stickDrive().
    state() {
        const up = this.has('up') ? 1 : 0, down = this.has('down') ? 1 : 0;
        const left = this.has('left') ? 1 : 0, right = this.has('right') ? 1 : 0;
        const walk = stickWalk(this.stick);
        const stick = walk.mx !== 0 || walk.my !== 0;
        return {
            throttle: up - down,
            steer: right - left,
            handbrake: this.has('hb'),
            mx: stick ? walk.mx : right - left,
            my: stick ? walk.my : down - up,
            run: this.has('run') || walk.run,
            horn: this.has('horn'),
            action: this.pressed('act'),
            punch: this.pressed('hb') || this.pressed('fire'),   // Space eller vänsterklick till fots = slag/skott
            attack: this.has('hb') || this.has('fire'),          // hålls inne = automateld (Uzi)
            rob: this.pressed('r'),
            weapon: this.pressed('weapon')
        };
    }

    // Musen siktar om den rört sig nyligen (eller en knapp hålls inne). Annars tittar gubben dit han går.
    aimActive(now = performance.now()) { return this.mouse.inside && (now - this.mouse.t < 4000 || this.held.has('fire')); }

    // Hjulet sedan förra gången: -1 = in, +1 = ut, 0 = inget
    takeWheel() { const w = Math.sign(this.wheel); this.wheel = 0; return w; }

    endFrame() { this.edges.clear(); }

    destroy() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        if (this.canvas) {
            this.canvas.removeEventListener('pointermove', this.onMouseMove);
            this.canvas.removeEventListener('pointerdown', this.onMouseDown);
            window.removeEventListener('pointerup', this.onMouseUp);
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
        this.resetStick();
        this.held.clear();
        this.edges.clear();
    }
}
