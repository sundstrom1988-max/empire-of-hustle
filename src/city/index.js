// ═══════════════════════════════════════════
//  STAN — session: öppnar och stänger stan,
//  kör spelloopen med fast tidssteg och kopplar
//  världens events till ljud och HUD.
// ═══════════════════════════════════════════

import { generateCity } from './map.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { stars } from './wanted.js';
import { gangById } from './missions.js';
import { JOIN_RESPECT } from './constants.js';
import { sfx, playStation, stopRadio, STATIONS, engineStart, engineSet, engineStop, sirenSet, sirenStop, unlockAudio } from '../utils/audio.js';
import { escapeHtml } from '../utils/html.js';

const STEP = 1 / 60;
const CITY_SEED = 1337;
let cityCache = null;
let session = null;

export function isCityOpen() { return !!session; }

const isTouch = () => (typeof window !== 'undefined') && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);

function buildOverlay(touch) {
    const el = document.createElement('div');
    el.id = 'city-overlay';
    el.className = 'city-overlay' + (touch ? ' touch' : '');
    el.innerHTML = `
        <canvas class="city-canvas"></canvas>
        <div class="city-topbar">
            <button class="city-btn" data-cmd="radio" title="Byt radiokanal (R)">📻</button>
            <button class="city-btn" data-cmd="pause" title="Paus (P)">⏸</button>
            <button class="city-btn city-home" data-cmd="home" title="Åk hem (Esc)">🏠 HEM</button>
        </div>
        ${touch ? `
        <div class="city-touch">
            <div class="ct-pad ct-left">
                <button data-key="left" aria-label="Vänster">◀</button>
                <button data-key="right" aria-label="Höger">▶</button>
            </div>
            <div class="ct-pad ct-right">
                <button data-key="act" class="ct-act" aria-label="In/ur bil">E</button>
                <button data-key="hb" class="ct-hb" aria-label="Handbroms">⤵</button>
                <button data-key="horn" class="ct-horn" aria-label="Tuta">📯</button>
                <button data-key="down" aria-label="Broms/back">▼</button>
                <button data-key="up" class="ct-gas" aria-label="Gas">▲</button>
            </div>
        </div>` : ''}
        <div class="city-modal" hidden></div>`;
    return el;
}

function controlsHelp(touch) {
    return touch
        ? `<div class="city-help"><b>▲▼◀▶</b> kör / gå · <b>E</b> in/ur bil · <b>⤵</b> handbroms / slå · <b>📯</b> tuta · <b>📻</b> radio</div>`
        : `<div class="city-help"><b>WASD/Pilar</b> kör/gå · <b>Shift</b> spring · <b>E</b> in/ur bil (sno bilar!) · <b>Space</b> handbroms / slå · <b>H</b> tuta · <b>R</b> radio · <b>P</b> paus · <b>Esc</b> hem</div>`;
}

export function openCity(profile, opts = {}) {
    if (session) return false;
    if (!cityCache) cityCache = generateCity(CITY_SEED);
    const touch = isTouch();
    const overlay = buildOverlay(touch);
    document.body.appendChild(overlay);
    document.body.classList.add('city-open');

    const canvas = overlay.querySelector('.city-canvas');
    const world = new World(cityCache, profile, { round: opts.round, maxMissions: opts.maxMissions, maxFence: opts.maxFence, maxGoods: opts.maxGoods });
    const renderer = new Renderer(canvas);
    const hud = new Hud();
    const input = new Input(overlay);
    const modal = overlay.querySelector('.city-modal');

    session = {
        world, renderer, hud, input, overlay, modal, touch, opts,
        raf: 0, last: performance.now(), acc: 0, paused: true, modalType: 'intro',
        errors: 0, musicMuted: !!opts.musicMuted, pendingMission: null, closing: false
    };

    const onResize = () => renderer.resize();
    const onVis = () => { if (document.hidden && session && !session.paused) showPause(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    session.cleanup = () => {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
    };

    overlay.querySelector('.city-topbar').addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
        if (cmd === 'radio') cycleRadio();
        else if (cmd === 'pause') session.paused ? resume() : showPause();
        else if (cmd === 'home') tryGoHome();
    });

    stopRadio();
    showIntro();
    session.raf = requestAnimationFrame(frame);
    return true;
}

// ── Modaler ──
function showModal(type, html) {
    const s = session;
    s.paused = true;
    // Paus = tyst: ingen siren, motor eller radio bakom menyn (resume startar dem igen)
    sirenSet(0);
    engineStop();
    stopRadio();
    s.modalType = type;
    s.modal.innerHTML = html;
    s.modal.hidden = false;
    s.modal.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => onModalAction(b.dataset.act)));
}

function hideModal() {
    const s = session;
    s.modal.hidden = true;
    s.modal.innerHTML = '';
    s.modalType = null;
}

function showIntro() {
    const p = session.world.profile;
    showModal('intro', `
        <div class="city-card intro">
            <div class="city-logo">HUSTLE CITY</div>
            <p class="city-tag">${escapeHtml(p.char?.icon || '')} ${escapeHtml(p.char?.name || '')} rullar ut på gatan. Sno bilar, ta jobb från gängens telefoner ☎️ och gå med i ett gäng. Köp varor av Langaren vid HQ 🎒 och langa — men på fel turf kommer opps. Skaka av snuten på Lackverkstan 🎨.</p>
            ${controlsHelp(session.touch)}
            <button class="city-go" data-act="start">▶ KÖR!</button>
        </div>`);
}

function showPause() {
    const w = session.world;
    const canHome = w.canGoHome();
    showModal('pause', `
        <div class="city-card">
            <div class="city-logo small">PAUS</div>
            ${controlsHelp(session.touch)}
            <div class="city-row">
                <button class="city-go" data-act="resume">▶ Fortsätt</button>
                <button class="city-go alt" data-act="home" ${canHome ? '' : 'disabled'}>🏠 Åk hem</button>
            </div>
            ${canHome ? '' : '<p class="city-warn">🚨 Du kan inte åka hem med snuten efter dig!</p>'}
        </div>`);
}

// Gängets telefon: ett jobb, och/eller att gå med i (eller lämna) gänget
function showPhone(e) {
    const g = gangById(e.gang);
    const m = e.mission;
    session.pendingMission = m;
    session.pendingPhone = e;
    const joinInfo = e.isMember
        ? `<div class="phone-member">${escapeHtml(g.icon)} Du är medlem i ${escapeHtml(g.name)}${m ? ' · +25% betalt' : ''}</div>`
        : e.canJoin
            ? `<div class="phone-member join">🤝 ${escapeHtml(g.boss)}: "Du har visat respekt. Vill du bli en av oss?"</div>`
            : e.hasGang ? '' : `<div class="phone-member">🤝 Respekt ${e.respect}/${JOIN_RESPECT} för att få gå med</div>`;
    showModal('phone', `
        <div class="city-card phone" style="--gang:${g.color}">
            <div class="phone-head">☎️ ${escapeHtml(g.bossIcon)} ${escapeHtml(g.boss)} · <span>${escapeHtml(g.name)}</span></div>
            ${m ? `<div class="phone-title">${escapeHtml(m.title)}</div>
            <p class="phone-brief">${escapeHtml(m.brief)}</p>
            <div class="phone-reward">💰 ${m.reward.toLocaleString('sv-SE')} kr · ⏱ ${m.timeLimit} s</div>`
            : `<p class="phone-brief">${escapeHtml(e.note || 'Inga jobb just nu.')}</p>`}
            ${joinInfo}
            <div class="city-row">
                ${m ? '<button class="city-go" data-act="accept">✅ TA JOBBET <small>(E)</small></button>' : ''}
                ${e.canJoin ? `<button class="city-go join" data-act="join">🤝 GÅ MED${m ? '' : ' <small>(E)</small>'}</button>` : ''}
                ${e.isMember ? '<button class="city-go alt" data-act="leave">🚪 Hoppa av</button>' : ''}
                <button class="city-go alt" data-act="decline">${m ? '❌ Nej tack' : '👋 Lägg på'} <small>(Esc)</small></button>
            </div>
        </div>`);
}

// Langaren vid HQ
function showShop(e) {
    const n1 = Math.min(5, e.left), n2 = Math.min(10, e.left);
    showModal('shop', `
        <div class="city-card phone" style="--gang:#a3e635">
            <div class="phone-head">🎒 Langaren · <span>bakom HQ</span></div>
            <p class="phone-brief">"Yo. ${e.goods ? `Du har ${e.goods} kvar. ` : ''}Hur många vill du ha? ${e.price} kr styck. Langa på ditt eget turf — gör du det på någon annans kommer opps."</p>
            <div class="city-row">
                <button class="city-go" data-act="buy:${n1}">🎒 ${n1} st · ${n1 * e.price} kr <small>(E)</small></button>
                ${n2 > n1 ? `<button class="city-go" data-act="buy:${n2}">🎒 ${n2} st · ${n2 * e.price} kr</button>` : ''}
                <button class="city-go alt" data-act="decline-shop">Nej <small>(Esc)</small></button>
            </div>
        </div>`);
    session.pendingShop = e;
}

function onModalAction(act) {
    const s = session;
    if (!s) return;
    unlockAudio();
    switch (act) {
        case 'start':
        case 'resume':
            resume();
            break;
        case 'home':
            if (s.world.canGoHome()) close('home');
            break;
        case 'accept':
            if (s.pendingMission) { s.world.startMission(s.pendingMission); s.pendingMission = null; }
            resume();
            break;
        case 'decline':
            if (s.pendingMission) s.world.message('📞 "Okej... din förlust, bram."');
            s.pendingMission = null;
            resume();
            break;
        case 'join':
            if (s.pendingPhone) s.world.joinGang(s.pendingPhone.gang);
            s.pendingMission = null;
            resume();
            break;
        case 'leave':
            s.world.leaveGang();
            s.pendingMission = null;
            resume();
            break;
        case 'decline-shop':
            resume();
            break;
        default:
            if (act.startsWith('buy:')) { s.world.buyGoods(Number(act.slice(4))); resume(); }
    }
}

function resume() {
    const s = session;
    hideModal();
    s.paused = false;
    s.last = performance.now();
    s.acc = 0;
    s.input.held.clear();
    s.input.edges.clear();
    syncVehicleAudio();
}

function tryGoHome() {
    const w = session.world;
    if (w.canGoHome()) close('home');
    else w.message('🚨 Skaka av snuten först! (Lackverkstan 🎨 hjälper)');
}

// ── Ljud ──
function syncVehicleAudio() {
    const s = session;
    const v = s.world.player.vehicle;
    if (v && !v.wrecked) {
        if (v.spec.engine) engineStart(v.spec.engine);
        if (!s.musicMuted && v.radio >= 0) playStation(v.radio); else stopRadio();
    } else {
        engineStop();
        stopRadio();
    }
}

function cycleRadio() {
    const s = session;
    const v = s.world.player.vehicle;
    if (!v) { s.world.message('📻 Radion finns i bilen, bram.'); return; }
    v.radio = v.radio === undefined ? 0 : v.radio + 1;
    if (v.radio >= STATIONS.length) v.radio = -1;
    if (v.radio < 0) { stopRadio(); s.hud.onEvent({ type: 'radio', name: 'RADIO AV', tag: '' }); return; }
    if (!s.musicMuted) playStation(v.radio);
    s.hud.onEvent({ type: 'radio', name: STATIONS[v.radio].name, tag: STATIONS[v.radio].tag });
}

function handleEvents() {
    const s = session, w = s.world;
    for (const e of w.events) {
        switch (e.type) {
            case 'sfx': sfx(e.name, e.vol); break;
            case 'phone': showPhone(e); break;
            case 'shop': showShop(e); break;
            case 'enterCar': {
                const v = e.vehicle;
                if (v.radio >= 0) s.hud.onEvent({ type: 'radio', name: STATIONS[v.radio].name, tag: STATIONS[v.radio].tag });
                syncVehicleAudio();
                break;
            }
            case 'exitCar': syncVehicleAudio(); break;
            default: s.hud.onEvent(e);
        }
    }
    w.events.length = 0;
}

// ── Spelloopen ──
function frame(ts) {
    const s = session;
    if (!s || s.closing) return;
    s.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (ts - s.last) / 1000));
    s.last = ts;
    try {
        const inp = s.input;
        if (s.modalType) {
            // Tangenter i modaler
            if (inp.pressed('act')) {
                const ph = s.pendingPhone;
                const act = s.modalType === 'phone' ? (s.pendingMission ? 'accept' : ph?.canJoin ? 'join' : 'decline')
                    : s.modalType === 'shop' ? `buy:${Math.min(5, s.pendingShop?.left || 0)}`
                        : s.modalType === 'intro' ? 'start' : 'resume';
                onModalAction(act);
            } else if (inp.pressed('exit')) onModalAction({ phone: 'decline', shop: 'decline-shop', pause: 'resume' }[s.modalType] || 'start');
            else if (inp.pressed('pause') && s.modalType === 'pause') onModalAction('resume');
        } else if (!s.paused) {
            if (inp.pressed('pause')) showPause();
            else if (inp.pressed('exit')) tryGoHome();
            if (inp.pressed('radio')) cycleRadio();
        }
        if (s.closing) return;
        if (!s.paused) {
            s.acc += dt;
            const state = inp.state();
            let steps = 0;
            while (s.acc >= STEP && steps < 5) {
                s.world.update(STEP, steps === 0 ? state : { ...state, action: false, punch: false });
                s.acc -= STEP;
                steps++;
            }
            if (steps === 5) s.acc = 0;
            handleEvents();
            s.hud.update(dt);
            const v = s.world.player.vehicle;
            if (v && !v.wrecked) engineSet(Math.hypot(v.vx, v.vy) / v.spec.maxSpeed, Math.max(0, state.throttle), v.spec.engine);
            sirenSet(s.world.sirenIntensity());
            if (s.world.finished) { close(s.world.finished); return; }
        }
        s.renderer.updateCamera(s.world, s.paused ? 0 : dt);
        s.renderer.draw(s.world, s.paused ? 0 : dt);
        s.hud.draw(s.renderer.ctx, s.world, s.renderer, { touch: s.touch });
        inp.endFrame();
        s.errors = Math.max(0, s.errors - 0.02);
    } catch (err) {
        console.error('Stan-fel:', err);
        s.errors++;
        if (s.errors > 20) close('crash');
    }
}

function close(reason) {
    const s = session;
    if (!s || s.closing) return;
    s.closing = true;
    cancelAnimationFrame(s.raf);
    try {
        s.input.destroy();
        s.cleanup();
        engineStop();
        sirenStop();
        stopRadio();
    } catch (e) { console.warn(e); }
    s.overlay.remove();
    document.body.classList.remove('city-open');
    const w = s.world;
    const abandoned = w.abandonMission();
    const result = {
        reason,
        abandoned: abandoned ? abandoned.title : null,
        stars: reason === 'busted' ? (w.bustedStars ?? stars(w.wanted)) : stars(w.wanted),
        moneyDelta: (w.profile.money || 0) - w.moneyStart
    };
    session = null;
    if (s.opts.onClose) {
        try { s.opts.onClose(result); } catch (e) { console.error(e); }
    }
}

export function forceCloseCity() { if (session) close('home'); }

// Endast i dev-läge: gör sessionen åtkomlig för felsökning och röktester.
if (import.meta.env?.DEV && typeof window !== 'undefined') window.__stan = () => session;
