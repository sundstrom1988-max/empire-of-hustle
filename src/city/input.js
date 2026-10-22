// ═══════════════════════════════════════════
//  STAN — tangentbord + touchknappar
// ═══════════════════════════════════════════

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
        this.onBlur = () => this.held.clear(); // inga fastnade tangenter när fönstret tappar fokus
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
        window.addEventListener('blur', this.onBlur);

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
    }

    has(k) { return this.held.has(k); }
    pressed(k) {
        if (this.edges.has(k)) { this.edges.delete(k); return true; }
        return false;
    }

    // Kontrolltillstånd för den här framen
    state() {
        const up = this.has('up') ? 1 : 0, down = this.has('down') ? 1 : 0;
        const left = this.has('left') ? 1 : 0, right = this.has('right') ? 1 : 0;
        return {
            throttle: up - down,
            steer: right - left,
            handbrake: this.has('hb'),
            mx: right - left,
            my: down - up,
            run: this.has('run'),
            horn: this.has('horn'),
            action: this.pressed('act'),
            punch: this.pressed('hb'),   // Space till fots = slag/skott
            attack: this.has('hb'),      // hålls inne = automateld (Uzi)
            rob: this.pressed('r'),
            weapon: this.pressed('weapon')
        };
    }

    endFrame() { this.edges.clear(); }

    destroy() {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
        window.removeEventListener('blur', this.onBlur);
        this.buttons.forEach(btn => {
            const h = btn._handlers;
            if (!h) return;
            btn.removeEventListener('pointerdown', h.down);
            btn.removeEventListener('pointerup', h.up);
            btn.removeEventListener('pointercancel', h.up);
            btn.removeEventListener('lostpointercapture', h.up);
        });
        this.held.clear();
        this.edges.clear();
    }
}
