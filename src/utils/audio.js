// ═══════════════════════════════════════════
//  LJUDMOTOR — allt syntas med Web Audio.
//  Inga externa filer = inga trasiga länkar.
//  SFX, tre radiokanaler, motorljud och siren.
// ═══════════════════════════════════════════

let ctx = null;
let master, sfxBus, musicBus, noiseBuf;
let sfxMuted = false, musicMuted = false;

function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
        ctx = new AC();
    } catch (e) { return null; }
    master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxMuted ? 0 : 0.9; sfxBus.connect(comp);
    musicBus = ctx.createGain(); musicBus.gain.value = musicMuted ? 0 : 0.5; musicBus.connect(comp);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
}

// Måste anropas från en användarhandling (klick/tangent) för att låsa upp ljudet.
export function unlockAudio() {
    const c = getCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => { });
}

export function setSfxMuted(m) {
    sfxMuted = m;
    if (sfxBus) sfxBus.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.02);
}
export function setMusicMuted(m) {
    musicMuted = m;
    if (musicBus) musicBus.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.05);
}
export function setMusicVolume(v) {
    if (musicBus && !musicMuted) musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.1);
}

// ── Byggstenar ──
function env(gainNode, t, attack, peak, decay, sustain = 0.0001) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t + attack + decay);
}

function osc(type, freq, t, dur, vol, dest, opts = {}) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(opts.to, 1), t + (opts.glide || dur));
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    env(g, t, opts.attack || 0.005, vol, dur);
    let node = o;
    if (opts.lp) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = opts.q || 1;
        f.frequency.setValueAtTime(opts.lp, t);
        if (opts.lpTo) f.frequency.exponentialRampToValueAtTime(opts.lpTo, t + dur);
        node.connect(f); node = f;
    }
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t + (opts.attack || 0.005) + dur + 0.05);
    return o;
}

function noise(t, dur, vol, dest, filterType = 'highpass', freq = 1000, q = 1, freqTo = null) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = ctx.createGain(); env(g, t, 0.002, vol, dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}

const midi = n => 440 * Math.pow(2, (n - 69) / 12);

const drumHit = (t, d) => { osc('sine', 120, t, 0.25, 0.6, d, { to: 45 }); noise(t, 0.12, 0.3, d, 'lowpass', 900); };

// ── Ljudeffekter ──
const SFX = {
    coin(t, d) { osc('square', 988, t, 0.08, 0.15, d); osc('square', 1319, t + 0.07, 0.25, 0.15, d); },
    pickup(t, d) { [72, 76, 79, 84].forEach((n, i) => osc('square', midi(n), t + i * 0.05, 0.08, 0.12, d)); },
    dice(t, d) { for (let i = 0; i < 6; i++) noise(t + i * 0.05 + Math.random() * 0.02, 0.04, 0.35, d, 'bandpass', 2500 + Math.random() * 2000, 4); },
    jail(t, d) {
        osc('square', 220, t, 0.6, 0.18, d, { to: 196, lp: 1800 });
        osc('square', 233, t, 0.6, 0.12, d, { lp: 1800 });
        noise(t, 0.3, 0.3, d, 'bandpass', 3000, 8);
    },
    win(t, d) { [60, 64, 67, 72, 67, 72, 76].forEach((n, i) => osc('square', midi(n), t + i * 0.09, i === 6 ? 0.6 : 0.1, 0.13, d, { lp: 3000 })); },
    mission(t, d) {
        [67, 72, 76, 79].forEach((n, i) => osc('sawtooth', midi(n), t + i * 0.11, 0.18, 0.1, d, { lp: 2500 }));
        osc('sawtooth', midi(84), t + 0.45, 0.9, 0.12, d, { lp: 3000 });
        osc('square', midi(48), t + 0.45, 0.9, 0.12, d, { lp: 800 });
    },
    fail(t, d) { [67, 63, 60, 55].forEach((n, i) => osc('sawtooth', midi(n), t + i * 0.16, 0.2, 0.12, d, { lp: 1200 })); },
    laugh(t, d) { // "wah-wah-waaah"
        [62, 61, 60].forEach((n, i) => osc('sawtooth', midi(n), t + i * 0.28, 0.24, 0.1, d, { lp: 900 }));
        osc('sawtooth', midi(59), t + 0.84, 0.8, 0.1, d, { to: midi(57), lp: 900 });
    },
    crash(t, d, v = 1) {
        noise(t, 0.25, 0.5 * v, d, 'lowpass', 2500, 1, 300);
        osc('square', 90, t, 0.15, 0.2 * v, d, { to: 40 });
    },
    explosion(t, d) {
        noise(t, 1.3, 0.9, d, 'lowpass', 1800, 1, 80);
        osc('sine', 120, t, 0.8, 0.6, d, { to: 30 });
    },
    horn(t, d) { osc('square', 330, t, 0.35, 0.08, d, { lp: 1500, attack: 0.01 }); osc('square', 415, t, 0.35, 0.08, d, { lp: 1500, attack: 0.01 }); },
    phone(t, d) { for (let i = 0; i < 4; i++) { osc('sine', 1100, t + i * 0.1, 0.05, 0.12, d); osc('sine', 1400, t + i * 0.1 + 0.05, 0.05, 0.12, d); } },
    door(t, d) { noise(t, 0.08, 0.3, d, 'bandpass', 600, 2); osc('square', 140, t + 0.05, 0.06, 0.12, d); },
    busted(t, d) { [76, 72, 69, 64].forEach((n, i) => osc('square', midi(n), t + i * 0.18, 0.16, 0.12, d, { lp: 2000 })); },
    wasted(t, d) { osc('sawtooth', 220, t, 1.6, 0.14, d, { to: 55, lp: 1200 }); noise(t, 0.8, 0.3, d, 'lowpass', 800, 1, 100); },
    skid(t, d) { noise(t, 0.18, 0.12, d, 'bandpass', 1800, 6); },
    spray(t, d) { noise(t, 1.2, 0.25, d, 'highpass', 3000, 1); osc('square', midi(72), t + 1.2, 0.3, 0.1, d); },
    punch(t, d) { noise(t, 0.06, 0.4, d, 'lowpass', 900); osc('sine', 160, t, 0.08, 0.3, d, { to: 60 }); },
    nitro(t, d) { noise(t, 0.6, 0.3, d, 'bandpass', 600, 2, 3000); },
    opps(t, d) { // hotfull blåsstöt när rivalerna kommer
        [40, 40, 43].forEach((n, i) => osc('sawtooth', midi(n), t + i * 0.22, i === 2 ? 0.7 : 0.16, 0.22, d, { lp: 700, q: 3 }));
        drumHit(t, d); drumHit(t + 0.22, d);
    },
    shot(t, d) { noise(t, 0.12, 0.7, d, 'lowpass', 3500, 1, 400); osc('square', 140, t, 0.06, 0.3, d, { to: 50 }); },
    uzi(t, d) { noise(t, 0.05, 0.5, d, 'bandpass', 2200, 1.5); osc('square', 180, t, 0.03, 0.2, d, { to: 80 }); },
    shotgun(t, d) { noise(t, 0.35, 0.9, d, 'lowpass', 2200, 1, 150); osc('sine', 90, t, 0.25, 0.6, d, { to: 35 }); },
    click(t, d) { noise(t, 0.02, 0.4, d, 'highpass', 4000); },
    reload(t, d) { noise(t, 0.04, 0.4, d, 'bandpass', 3000, 3); noise(t + 0.12, 0.05, 0.45, d, 'bandpass', 2000, 3); },
    swing(t, d) { noise(t, 0.12, 0.15, d, 'bandpass', 900, 2, 2500); },
    bat(t, d) { osc('triangle', 300, t, 0.08, 0.4, d, { to: 120 }); noise(t, 0.08, 0.4, d, 'lowpass', 1200); },
    thud(t, d) { osc('sine', 110, t, 0.18, 0.6, d, { to: 45 }); noise(t, 0.1, 0.4, d, 'lowpass', 700); },
    hurt(t, d) { osc('sawtooth', 300, t, 0.15, 0.12, d, { to: 160, lp: 1400 }); },
    combo(t, d) { [72, 76, 79, 84, 88].forEach((n, i) => osc('square', midi(n), t + i * 0.06, 0.1, 0.1, d, { lp: 3500 })); },
    love(t, d) { // smörig saxofon-ish slinga
        [64, 67, 71, 74, 72].forEach((n, i) => osc('sawtooth', midi(n), t + i * 0.16, i === 4 ? 0.7 : 0.15, 0.08, d, { lp: 1600, attack: 0.03 }));
    }
};

export function sfx(name, vol = 1) {
    const c = getCtx();
    if (!c || sfxMuted || !SFX[name]) return;
    if (c.state === 'suspended') c.resume().catch(() => { });
    try {
        const g = c.createGain(); g.gain.value = vol; g.connect(sfxBus);
        SFX[name](c.currentTime + 0.01, g, vol);
        setTimeout(() => g.disconnect(), 3000);
    } catch (e) { /* ljud får aldrig krascha spelet */ }
}

// ═══════════════════════════════
//  RADIO — tre procedurella kanaler
// ═══════════════════════════════
function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function drumKick(t, d, v = 1) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain(); env(g, t, 0.002, 0.9 * v, 0.32);
    o.connect(g); g.connect(d); o.start(t); o.stop(t + 0.4);
}
function drum808(t, d, freq, dur) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2.5, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const g = ctx.createGain(); env(g, t, 0.003, 0.7, dur);
    const sh = ctx.createWaveShaper(); const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    sh.curve = curve;
    o.connect(sh); sh.connect(g); g.connect(d); o.start(t); o.stop(t + dur + 0.1);
}
const drumSnare = (t, d, v = 1) => { noise(t, 0.16, 0.45 * v, d, 'highpass', 1500); osc('triangle', 190, t, 0.08, 0.3 * v, d, { to: 140 }); };
const drumClap = (t, d) => { [0, 0.012, 0.024].forEach(o => noise(t + o, 0.1, 0.4, d, 'bandpass', 1400, 3)); };
const drumHat = (t, d, open = false, v = 1) => noise(t, open ? 0.22 : 0.035, 0.18 * v, d, 'highpass', 7500);
const darbukaDum = (t, d) => { osc('sine', 110, t, 0.25, 0.7, d, { to: 70 }); };
const darbukaTek = (t, d, v = 1) => { noise(t, 0.05, 0.35 * v, d, 'bandpass', 3800, 5); osc('sine', 600, t, 0.03, 0.15 * v, d); };

// Varje kanal: tempo, steg per takt (16-delar) och en funktion som spelar ett steg.
function makeStations() {
    return [
        {
            id: 'hustle', name: 'HUSTLE FM 104.2', tag: 'Trap från orten', bpm: 140, bars: 4,
            setup() {
                const r = seeded(104);
                const scale = [57, 60, 62, 64, 67, 69, 72]; // A-moll pentaton
                this.mel = Array.from({ length: 64 }, (_, i) => (i % 4 === 0 || r() < 0.25) && r() < 0.7 ? scale[Math.floor(r() * scale.length)] + 12 : 0);
                this.roots = [33, 29, 36, 31]; // A1 F1 C2 G1
            },
            step(i, t, d, sd) {
                const s = i % 16, bar = Math.floor(i / 16) % this.bars;
                if ([0, 6, 10].includes(s) || (bar === 3 && s === 14)) drumKick(t, d, 0.9);
                if (s === 0 || s === 10) drum808(t, d, midi(this.roots[bar]), s === 0 ? 0.9 : 0.4);
                if (s === 8) drumClap(t, d);
                drumHat(t, d, false, s % 2 ? 0.55 : 0.85);
                if ((bar === 1 || bar === 3) && s >= 12 && s % 2 === 0) drumHat(t + sd / 2, d, false, 0.5);
                const n = this.mel[(i % 64)];
                if (n) osc('triangle', midi(n), t, 0.35, 0.09, d, { attack: 0.003 });
            }
        },
        {
            id: 'kebab', name: 'KEBAB RADIO 88.6', tag: 'Arabesk-pop med vitsås', bpm: 104, bars: 4,
            setup() {
                const r = seeded(886);
                const scale = [64, 65, 68, 69, 71, 72, 74, 76]; // E frygisk dominant
                this.mel = Array.from({ length: 64 }, (_, i) => (i % 2 === 0 && r() < 0.75) ? scale[Math.floor(r() * scale.length)] : 0);
                this.roots = [40, 40, 41, 40];
            },
            step(i, t, d) {
                const s = i % 16, bar = Math.floor(i / 16) % this.bars;
                // Maqsum: DUM tek - tek DUM - tek -
                if (s === 0 || s === 8) darbukaDum(t, d);
                if ([2, 6, 10, 14].includes(s)) darbukaTek(t, d);
                if ([5, 13].includes(s)) darbukaTek(t, d, 0.6);
                if (s === 4 || s === 12) drumKick(t, d, 0.5);
                if (s % 4 === 0) osc('sawtooth', midi(this.roots[bar]), t, 0.25, 0.12, d, { lp: 500 });
                const n = this.mel[i % 64];
                if (n) osc('sawtooth', midi(n), t, 0.22, 0.06, d, { lp: 2200, q: 4, detune: 6 });
            }
        },
        {
            id: 'morker', name: 'MÖRKER 66.6', tag: 'Darksynth för mörka affärer', bpm: 100, bars: 4,
            setup() {
                this.chords = [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]]; // Dm Bb C A
            },
            step(i, t, d, sd) {
                const s = i % 16, bar = Math.floor(i / 16) % this.bars;
                const ch = this.chords[bar];
                if (s % 4 === 0) drumKick(t, d, 0.8);
                if (s === 4 || s === 12) drumSnare(t, d, 0.8);
                if (s % 4 === 2) drumHat(t, d, true, 0.6);
                osc('sawtooth', midi(ch[0] - 12 + (s % 2 ? 12 : 0)), t, sd * 0.9, 0.09, d, { lp: 700, lpTo: 300 });
                if (s === 0) ch.forEach(n => osc('sawtooth', midi(n + 12), t, sd * 15, 0.035, d, { attack: 0.4, lp: 1400, detune: 8 }));
                if (s % 3 === 0) osc('square', midi(ch[(s / 3) % 3] + 24), t, 0.12, 0.03, d, { lp: 3000 });
            }
        },
        {
            id: 'diamant', name: 'CLUB DIAMANT', tag: 'Neon, bas och dyra flaskor', bpm: 122, bars: 4,
            setup() {
                this.chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]]; // Am F G Em
            },
            step(i, t, d, sd) {
                const s = i % 16, bar = Math.floor(i / 16) % this.bars;
                const ch = this.chords[bar];
                if (s % 4 === 0) drumKick(t, d, 1);
                if (s % 4 === 2) drumHat(t, d, true, 0.5);
                if (s === 4 || s === 12) drumClap(t, d);
                if (s % 2 === 1) drumHat(t, d, false, 0.4);
                if (s % 4 === 2) osc('sawtooth', midi(ch[0] - 24), t, sd * 1.6, 0.13, d, { lp: 420 });
                if (s === 2 || s === 10) ch.forEach(n => osc('sawtooth', midi(n), t, sd * 2.5, 0.04, d, { lp: 1800, detune: 9 }));
            }
        }
    ];
}

export const STATIONS = makeStations().map(s => ({ id: s.id, name: s.name, tag: s.tag }));
let stations = null;
let radio = { idx: -1, timer: null, step: 0, next: 0, bus: null };

export function playStation(idx) {
    const c = getCtx();
    if (!c) return;
    if (!stations) { stations = makeStations(); stations.forEach(s => s.setup()); }
    if (radio.idx === idx && radio.timer) return;
    stopRadio();
    if (idx < 0 || idx >= stations.length) return;
    const st = stations[idx];
    const bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(musicBus);
    bus.gain.exponentialRampToValueAtTime(0.8, c.currentTime + 0.4);
    radio = { idx, step: 0, next: c.currentTime + 0.1, bus, timer: null };
    const stepDur = 60 / st.bpm / 4;
    radio.timer = setInterval(() => {
        if (c.state !== 'running') { radio.next = c.currentTime + 0.1; return; }
        if (radio.next < c.currentTime - 0.5) radio.next = c.currentTime + 0.05; // efter en paus
        while (radio.next < c.currentTime + 0.15) {
            try { st.step(radio.step, radio.next, bus, stepDur); } catch (e) { /* hoppa över steget */ }
            radio.step++;
            radio.next += stepDur;
        }
    }, 30);
}

export function stopRadio() {
    if (radio.timer) clearInterval(radio.timer);
    if (radio.bus && ctx) {
        const b = radio.bus;
        b.gain.cancelScheduledValues(ctx.currentTime);
        b.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
        setTimeout(() => b.disconnect(), 400);
    }
    radio = { idx: -1, timer: null, step: 0, next: 0, bus: null };
}

export function currentStation() { return radio.idx; }

// ═══════════════════════════════
//  MOTOR + SIREN (kontinuerliga ljud)
// ═══════════════════════════════
let engine = null, siren = null;

export function engineStart(baseFreq = 45) {
    const c = getCtx();
    if (!c || engine) return;
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    const g = c.createGain(); g.gain.value = 0.0001;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(sfxBus);
    o1.start(); o2.start();
    engine = { o1, o2, f, g, base: baseFreq };
}

export function engineSet(speedFrac, throttle, baseFreq) {
    if (!engine || !ctx) return;
    if (baseFreq) engine.base = baseFreq;
    const t = ctx.currentTime;
    const freq = engine.base * (1 + Math.abs(speedFrac) * 2.4 + throttle * 0.3);
    engine.o1.frequency.setTargetAtTime(freq, t, 0.05);
    engine.o2.frequency.setTargetAtTime(freq * 0.501, t, 0.05);
    engine.f.frequency.setTargetAtTime(300 + Math.abs(speedFrac) * 900 + throttle * 300, t, 0.05);
    engine.g.gain.setTargetAtTime(0.025 + throttle * 0.02 + Math.abs(speedFrac) * 0.015, t, 0.08);
}

export function engineStop() {
    if (!engine) return;
    const e = engine; engine = null;
    e.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    setTimeout(() => { try { e.o1.stop(); e.o2.stop(); e.g.disconnect(); } catch (err) { /* redan stoppad */ } }, 300);
}

export function sirenSet(intensity) {
    const c = getCtx();
    if (!c) return;
    if (intensity <= 0.01) {
        if (siren) { siren.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.1); }
        return;
    }
    if (!siren) {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 800;
        const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.6;
        const lfoGain = c.createGain(); lfoGain.gain.value = 260;
        lfo.connect(lfoGain); lfoGain.connect(o.frequency);
        const g = c.createGain(); g.gain.value = 0.0001;
        o.connect(g); g.connect(sfxBus); o.start(); lfo.start();
        siren = { o, lfo, g };
    }
    siren.g.gain.setTargetAtTime(0.06 * Math.min(1, intensity), c.currentTime, 0.15);
}

export function sirenStop() {
    if (!siren) return;
    const s = siren; siren = null;
    s.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    setTimeout(() => { try { s.o.stop(); s.lfo.stop(); s.g.disconnect(); } catch (e) { /* ignore */ } }, 300);
}

// Pausa allt när fliken är dold
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend().catch(() => { });
        else ctx.resume().catch(() => { });
    });
}
