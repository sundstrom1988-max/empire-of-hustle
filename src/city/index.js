// ═══════════════════════════════════════════
//  STAN — session: öppnar och stänger stan,
//  kör spelloopen med fast tidssteg och kopplar
//  världens events till ljud och HUD.
// ═══════════════════════════════════════════

import { generateCity } from './map.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { createRenderer3D } from './render3d.js';
import { Hud } from './hud.js';
import { Input, stickCar } from './input.js';
import {
    is3D, nextCam, loadCam, saveCam, loadView, saveView, loadIndex, saveIndex, ZOOM_KEY, CHASE_KEY, TOP_ZOOMS, CHASE_ZOOMS, CHASE_DEFAULT,
    pinchView, pinchSettle, nearestIndex, loadZoomX, saveZoomX,
    CAM_NAMES, CAM_ICONS, wheelView, viewLabel, lookTurn, stepPitch, aimPoint, stickToWorld, followYaw, chaseRate, controlYaw,
    createFreeLook, stepFreeLook, resetFreeLook, SENS_RANGE, FOV_RANGE
} from './camera.js';
import { stars } from './wanted.js';
import { gangById } from './missions.js';
import { JOIN_RESPECT } from './constants.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon } from './weapons.js';
import { ROLES, CREW_MAX } from './crew.js';
import { sfx, playStation, stopRadio, STATIONS, engineStart, engineSet, engineStop, sirenSet, sirenStop, unlockAudio } from '../utils/audio.js';
import { escapeHtml } from '../utils/html.js';
import { BUILD } from '../utils/version.js';
import { cityEnter, cityExit, cityPublish, cityRemotes, cityTaken, cityRequest, onCityNet, cityNetActive } from '../multiplayer/citynet.js';
import { syncMe, syncState } from '../multiplayer/sync.js';
import { gameState, isMyTurn } from '../game/state.js';

const STEP = 1 / 60;
const CITY_SEED = 1337;
let cityCache = null;
let session = null;

export function isCityOpen() { return !!session; }

const isTouch = () => (typeof window !== 'undefined') && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
// localStorage (null i privat läge eller utan webbläsare): kameravalet gäller då bara nu
const storage = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };

function buildOverlay(touch) {
    const el = document.createElement('div');
    el.id = 'city-overlay';
    el.className = 'city-overlay' + (touch ? ' touch' : '');
    el.innerHTML = `
        <canvas class="city-canvas"></canvas>
        <div class="city-topbar">
            <button class="city-btn" data-cmd="phone" title="Telefon: SMS, taxi, doktor, crew (T)">📱</button>
            <button class="city-btn" data-cmd="cam" title="Byt kamera: förstaperson → följkamera → överblick (V eller C)">🔍</button>
            <button class="city-btn" data-cmd="radio" title="Byt radiokanal (R)">📻</button>
            <button class="city-btn" data-cmd="pause" title="Paus (P)">⏸</button>
            <button class="city-btn city-home" data-cmd="home" title="Åk hem (Esc)">🏠 HEM</button>
        </div>
        ${touch ? `
        <div class="ct-stick" aria-label="Joystick: dra för att gå eller köra">
            <div class="ct-stick-base"><div class="ct-stick-knob"></div></div>
        </div>
        <div class="city-touch">
            <div class="ct-pad ct-right">
                <button data-key="r" class="ct-rob" aria-label="Råna">💰</button>
                <button data-key="crew" class="ct-crew" aria-label="Crew-order">👥</button>
                <button data-key="weapon" class="ct-wpn" aria-label="Byt vapen">🔫</button>
                <button data-key="horn" class="ct-horn" aria-label="Tuta">📯</button>
                <button data-key="act" class="ct-act" aria-label="In/ur bil">E</button>
                <button data-key="hb" class="ct-hb ct-fight" aria-label="Slå">👊</button>
            </div>
        </div>` : ''}
        <div class="city-modal" hidden></div>`;
    return el;
}

function controlsHelp(touch) {
    return touch
        ? `<div class="city-help"><b>🕹️ Joysticken</b> (tummen nere till vänster) gå dit du drar — i förstaperson och följkamera är upp = framåt i bild · ända ut = spring (🏃 uthållighet) · <b>i bilen</b> kör dit du drar, dra bakåt = backa · <b>dra med ett finger på bilden</b> titta runt (3D) · <b>nyp</b> zooma — och vidare till nästa kamera · <b>👊</b> slå / skjut (blir <b>⤵</b> handbroms i bilen) · <b>E</b> gå in genom dörrar, in/ur bil, prata, plocka upp · <b>💰</b> råna · <b>🔫</b> byt vapen · <b>👥</b> crew-order · <b>📯</b> tuta · <b>📱</b> telefon · <b>🔍</b> byt kamera: förstaperson → följkamera → överblick<br><small>Version ${escapeHtml(BUILD)}</small></div>`
        : `<div class="city-help"><b>W/S</b> gå framåt/bakåt dit du tittar · <b>A/D</b> sidsteg · <b>Musen</b> styr blicken (3D: klicka i bilden så fångas musen) — i överblicken siktar pekaren · <b>vänsterklick</b> / <b>Space</b> slå / skjut · <b>Shift</b> spring (🏃 uthållighet) · <b>E</b> gå in genom dörrar, in/ur bil, prata, plocka upp · <b>I bilen</b> W gas · S broms/back · A/D sväng · Space handbroms · musen tittar runt · <b>R</b> råna (till fots) / radio (i bil) · <b>Q</b> byt vapen · <b>V</b> eller <b>C</b> byt kamera: förstaperson → följkamera → överblick · <b>hjulet</b> zoomar — och vidare till nästa kamera · <b>M</b> karta · <b>T</b> telefon · <b>1 2 3</b> crew: följ / stanna / anfall · <b>H</b> tuta · <b>P</b> paus · <b>Esc</b> släpper musen i 3D (paus), annars hem · <b>🏠 HEM</b> åk hem<br><small>Version ${escapeHtml(BUILD)}</small></div>`;
}

export function openCity(profile, opts = {}) {
    if (session) return false;
    if (!cityCache) cityCache = generateCity(CITY_SEED);
    const touch = isTouch();
    const overlay = buildOverlay(touch);
    document.body.appendChild(overlay);
    document.body.classList.add('city-open');

    const canvas = overlay.querySelector('.city-canvas');
    // Den delade staden: andra spelares positioner och värdens beslut kommer via nätet
    const net = { online: cityNetActive(), remotes: cityRemotes, taken: cityTaken, request: cityRequest };
    const world = new World(cityCache, profile, { round: opts.round, maxMissions: opts.maxMissions, maxFence: opts.maxFence, maxGoods: opts.maxGoods, slot: opts.slot, net });
    world.ownersRef = () => gameState.cityOwners;
    world.nameOf = id => gameState.players.find(pl => pl.charKey === id)?.char?.name || id;
    cityEnter(profile.charKey);
    const renderer = new Renderer(canvas);
    // Kameran: valt läge och zoomsteg från förra gången (camera.js). 3D laddas först när det behövs.
    const st = storage();
    const topZoom = loadIndex(st, ZOOM_KEY, TOP_ZOOMS.length, 0);
    const chaseZoom = loadIndex(st, CHASE_KEY, CHASE_ZOOMS.length, CHASE_DEFAULT);
    // Nyp-zoomen är steglös: senaste värdet om det finns, annars det namngivna steget
    const zx = loadZoomX(st);
    renderer.zoomMul = zx.top ?? TOP_ZOOMS[topZoom].mul;
    const hud = new Hud();
    const input = new Input(overlay);
    // Klick på minikartan/helkartan (eller bakom en meny) är inte ett slag
    input.ignoreMouse = (x, y) => {
        const r = session?.hud.mapRect;
        return !session || !!session.modalType || world.showMap || (!!r && x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size);
    };
    // Joysticken: med stora kartan uppe stänger trycket kartan i stället (som på resten av skärmen)
    input.stickGate = () => {
        if (!session || session.modalType) return false;
        if (world.showMap) { world.showMap = false; return false; }
        return true;
    };
    const modal = overlay.querySelector('.city-modal');

    session = {
        world, renderer, hud, input, overlay, modal, touch, opts,
        raf: 0, last: performance.now(), acc: 0, paused: true, modalType: 'intro',
        errors: 0, musicMuted: !!opts.musicMuted, pendingMission: null, closing: false,
        // Kameran (camera.js): cam = spelarens val, som gäller tills hen själv byter
        cam: loadCam(st), topZoom, chaseZoom, view: loadView(st),
        topMul: renderer.zoomMul, chaseDist: zx.chase ?? CHASE_ZOOMS[chaseZoom].dist, pinch: null,
        r3: null, r3State: 'idle', r3Shown: false, wheelT: 0,
        look: { pitch: 0, camYaw: NaN, turn: 0, free: createFreeLook(), veh: null, room: undefined, x: 0, y: 0 }
    };
    session.view3 = make3DView(session);
    // Tappar man pekarlåset mitt i spelet (Esc, fokusbyte) kommer pausmenyn — inte "åk hem"
    input.onLockChange = (locked) => {
        const s = session;
        if (!s || locked || s.closing) return;
        if (s.input.lockWanted && !s.modalType && !s.paused) showPause();
    };
    if (is3D(session.cam)) ensure3D();

    const onResize = () => { renderer.resize(); session?.r3?.resize(); };
    const onVis = () => { if (document.hidden && session && !session.paused) showPause(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    const netOff = onCityNet(e => {
        try { world.onNet(e); } catch (err) { console.error('Stad-nät:', err); }
        // Svaret från värden om klubben: visa managern igen med det nya läget
        if ((e.type === 'buyRes' || e.type === 'owners') && session?.modalType === 'manager') setTimeout(() => session?.modalType === 'manager' && showInteraction('manager'), 0);
    });
    // Tryck på minikartan öppnar den stora kartan (och tryck var som helst stänger den)
    const onMapTap = (e) => {
        const r = session?.hud.mapRect;
        if (!r || session.modalType || input.pinching) return; // ett nypfinger på minikartan öppnar inte kartan
        const b = canvas.getBoundingClientRect();
        const x = e.clientX - b.left, y = e.clientY - b.top;
        if (world.showMap || (x >= r.x && x <= r.x + r.size && y >= r.y && y <= r.y + r.size)) world.showMap = !world.showMap;
    };
    canvas.addEventListener('pointerdown', onMapTap);
    session.syncT = 0;
    session.cleanup = () => {
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('pointerdown', onMapTap);
        netOff();
        cityExit();
    };

    onTap(overlay.querySelector('.city-topbar'), '[data-cmd]', (b) => {
        const cmd = b.dataset.cmd;
        if (cmd === 'cam') cycleCam();
        else if (cmd === 'radio') cycleRadio();
        else if (cmd === 'phone') { if (!session.modalType) showCityPhone(); }
        else if (cmd === 'pause') session.paused ? resume() : showPause();
        else if (cmd === 'home') tryGoHome();
    }, touch);
    // Menyernas knappar: en lyssnare på modalen (innehållet byts varje gång den visas)
    onTap(modal, '[data-act]', b => onModalAction(b.dataset.act), touch);
    // Pausmenyns reglage (känslighet, synfält, kamerarörelse, inverterad Y)
    modal.addEventListener('input', onSetting);
    modal.addEventListener('change', (e) => { onSetting(e); if (e.target?.dataset?.set) e.target.blur(); }); // fokus tillbaka till spelet (P/Esc)

    stopRadio();
    showIntro();
    session.raf = requestAnimationFrame(frame);
    return true;
}

// Knappar (rubriken och menyerna). Webbläsaren ger inget click för ett andra finger
// när ett annat redan är nere — och på mobilen vilar tummen nästan alltid på joysticken.
// På touch körs knappen därför på pointerup över samma knapp som fick pointerdown;
// click finns kvar för datorn och tangentbordet (men inte direkt efter ett sådant tryck).
function onTap(el, sel, fn, touch) {
    let tapT = -1e9;
    const hit = (e) => { const b = e.target?.closest?.(sel); return b && el.contains(b) && !b.disabled ? b : null; };
    el.addEventListener('click', (e) => {
        const b = hit(e);
        if (b && performance.now() - tapT > 700) fn(b);
    });
    if (!touch) return;
    const downs = new Map(); // pointerId → knappen fingret sattes ned på
    el.addEventListener('pointerdown', (e) => { const b = hit(e); if (b) downs.set(e.pointerId, b); });
    el.addEventListener('pointercancel', (e) => downs.delete(e.pointerId)); // t.ex. scrollar i menyn
    el.addEventListener('pointerup', (e) => {
        const b = downs.get(e.pointerId);
        downs.delete(e.pointerId);
        // Touch fångar pekaren åt knappen: kolla att fingret fortfarande är över den
        const over = b?.isConnected && !b.disabled ? document.elementFromPoint(e.clientX, e.clientY) : null;
        if (!over || !b.contains(over)) return;
        tapT = performance.now();
        fn(b);
    });
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
    // Menyer släpper pekarlåset (musen behövs för knapparna). Läget och blicken står kvar.
    s.look.turn = 0;
    updateLock(s);
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
            <p class="city-tag">${escapeHtml(p.char?.icon || '')} ${escapeHtml(p.char?.name || '')} rullar ut på gatan. Sno bilar, ta jobb från gängens telefoner ☎️ och gå med i ett gäng. Köp varor av Langaren vid HQ 🎒 och langa — men på fel turf kommer opps. Kör över folk, råna dem, köp vapen hos Pang-Pelle 🔫 i Industrin och plocka upp en dejt vid Nattklubben 🍾 i Centrum efter 20:00. Gå in genom dörrarna: köp fastigheter och gömställen, råna butiker och banken. Snuten bryr sig bara om det de ser — kommer du utom synhåll tappar de spåret.</p>
            ${controlsHelp(session.touch)}
            <button class="city-go" data-act="start">▶ KÖR!</button>
        </div>`);
}

// Kamera och blick i pausmenyn: läget, känslighet, synfält, kamerarörelse och inverterad Y (sparas)
function cameraSettings(s) {
    const vw = s.view;
    const btn = cam => `<button class="cs-cam${s.cam === cam ? ' on' : ''}" data-act="cam:${cam}" aria-pressed="${s.cam === cam}">${CAM_ICONS[cam]} ${CAM_NAMES[cam]}</button>`;
    const note = s.r3State === 'failed' ? `<p class="city-warn">⚠️ 3D går inte här (${escapeHtml(s.r3Reason || 'WebGL2 saknas')}) — bara ÖVERBLICK.</p>` : '';
    return `
        <div class="city-settings">
            <div class="cs-title">🎥 Kamera <small>${s.touch ? '🔍 byter' : 'V / C byter · hjulet zoomar'}</small></div>
            <div class="cs-cams">${btn('fps')}${btn('chase')}${btn('top')}</div>
            ${note}
            <label class="cs-row"><span>${s.touch ? 'Känslighet (dra för att titta)' : 'Muskänslighet'}</span><input type="range" min="${SENS_RANGE[0]}" max="${SENS_RANGE[1]}" step="0.1" value="${vw.sens}" data-set="sens"><b data-out="sens">${vw.sens.toFixed(1)}</b></label>
            <label class="cs-row"><span>Synfält (förstaperson)</span><input type="range" min="${FOV_RANGE[0]}" max="${FOV_RANGE[1]}" step="1" value="${vw.fov}" data-set="fov"><b data-out="fov">${vw.fov}°</b></label>
            <label class="cs-check"><input type="checkbox" data-set="bob" ${vw.bob ? 'checked' : ''}> Kamerarörelse (gung när du går, skakningar)</label>
            <label class="cs-check"><input type="checkbox" data-set="invertY" ${vw.invertY ? 'checked' : ''}> Invertera Y (titta upp/ned)</label>
        </div>`;
}

function showPause() {
    const w = session.world;
    const canHome = w.canGoHome();
    showModal('pause', `
        <div class="city-card">
            <div class="city-logo small">PAUS</div>
            ${cameraSettings(session)}
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

// Pang-Pelle i Industrin: vapen och ammo
function showGuns() {
    const prof = session.world.profile;
    const rows = WEAPON_ORDER.filter(id => id !== 'fists').map(id => {
        const w = WEAPONS[id];
        const owned = ownsWeapon(prof, id);
        const info = w.melee ? `${w.dmg[0]}–${w.dmg[1]} skada · närstrid` : `${w.dmg}${w.pellets > 1 ? '×' + w.pellets : ''} skada · ${w.auto ? 'automat · ' : ''}${owned ? `${prof.ammo[id] || 0} skott` : `${w.ammo} skott ingår`}`;
        const btn = !owned
            ? `<button class="city-go" data-act="gun:${id}" ${prof.money < w.price ? 'disabled' : ''}>Köp · ${w.price.toLocaleString('sv-SE')} kr</button>`
            : w.melee ? '<button class="city-go alt" disabled>✔ Din</button>'
                : `<button class="city-go" data-act="ammo:${id}" ${prof.money < w.ammoPrice ? 'disabled' : ''}>+${w.ammo} skott · ${w.ammoPrice} kr</button>`;
        return `<div class="gun-row"><div class="gun-icon">${w.icon}</div><div class="gun-name">${escapeHtml(w.name)}<small>${info}</small></div>${btn}</div>`;
    }).join('');
    showModal('guns', `
        <div class="city-card phone" style="--gang:#f97316">
            <div class="phone-head">🔫 Pang-Pelle · <span>bakdörren i Industrin</span></div>
            <p class="phone-brief">"Psst. Allt är kallt, inga frågor. Bär du skjutvapen kommer opps också beväpnade — tänk på det."</p>
            <div class="gun-list">${rows}
                <div class="gun-row"><div class="gun-icon">🦺</div><div class="gun-name">Skyddsväst<small>+50 skydd · tar hälften av skadan · du har ${Math.round(session.world.player.armor || 0)}/100</small></div><button class="city-go" data-act="armor" ${prof.money < 800 || (session.world.player.armor || 0) >= 100 ? 'disabled' : ''}>+50 · 800 kr</button></div>
            </div>
            <div class="phone-member">💰 Du har ${(prof.money || 0).toLocaleString('sv-SE')} kr · ${session.touch ? '👊 slår/skjuter · 🔫 byter vapen' : 'SPACE slår/skjuter · Q byter vapen'}</div>
            <div class="city-row"><button class="city-go alt" data-act="decline-guns">Klar <small>(Esc)</small></button></div>
        </div>`);
}

// Inne på ett ställe: fastighet, gömställe eller banken
function showPlace() {
    const w = session.world;
    const info = w.placeInfo();
    if (!info) { resume(); return; }
    const p = w.profile;
    const rows = info.actions.map(a => `<button class="city-go place-act${a.id === 'leave' ? ' alt' : ''}" data-act="place:${a.id}" ${a.disabled ? 'disabled' : ''}>${escapeHtml(a.label)}${a.note ? `<small>${escapeHtml(a.note)}</small>` : ''}</button>`).join('');
    showModal('place', `
        <div class="city-card phone" style="--gang:${info.color}">
            <div class="phone-head">${escapeHtml(info.icon)} ${escapeHtml(info.title)}</div>
            <p class="phone-brief">${escapeHtml(info.desc)}</p>
            <div class="place-actions">${rows}</div>
            <div class="phone-member">💰 ${(p.money || 0).toLocaleString('sv-SE')} kr · ❤️ ${Math.ceil(w.player.hp)}/${w.player.maxHp}${stars(w.wanted) ? ` · 👮 ${stars(w.wanted)}` : ''}</div>
        </div>`);
}

// Rekryteraren vid HQ: se vilka som finns, roll, egenskaper och pris innan du anställer
function showRecruit() {
    const w = session.world;
    const offers = w.recruitOffers();
    const crew = w.profile.crew || [];
    const rows = offers.map(o => {
        const R = ROLES[o.role];
        const hired = crew.some(m => m.id === o.id);
        return `<div class="gun-row"><div class="gun-icon">${R.icon}</div><div class="gun-name">${escapeHtml(o.name)} · ${R.name}<small>${escapeHtml(R.desc)} · ${escapeHtml(o.trait)} · ❤️ ${o.hp} · 👊 ${o.dmg[0]}–${o.dmg[1]} · 🏃 ${o.speed}</small></div>
            <button class="city-go" data-act="hire:${o.id}" ${o.ok ? '' : 'disabled'}>${hired ? '✔ Anställd' : o.ok ? `Anställ · ${o.cost.toLocaleString('sv-SE')} kr` : escapeHtml(o.reason)}</button></div>`;
    }).join('');
    const mine = crew.map(m => `<div class="gun-row"><div class="gun-icon">${ROLES[m.role].icon}</div><div class="gun-name">${escapeHtml(m.name)} · ${ROLES[m.role].name}<small>${escapeHtml(m.trait || '')}</small></div><button class="city-go alt" data-act="fire:${m.id}">Säg upp</button></div>`).join('');
    showModal('recruit', `
        <div class="city-card phone" style="--gang:#22c55e">
            <div class="phone-head">👥 Rekryteraren · <span>${crew.length}/${CREW_MAX} i ditt crew</span></div>
            <p class="phone-brief">"Behöver du folk? Du betalar en gång — inga löner. Slås de ner reser de sig efter en stund." Order: 1 följ · 2 stanna · 3 anfall (👥 på mobilen)</p>
            <div class="gun-list">${rows}</div>
            ${mine ? `<div class="phone-member">Ditt crew</div><div class="gun-list">${mine}</div>` : ''}
            <div class="phone-member">💰 Du har ${(w.profile.money || 0).toLocaleString('sv-SE')} kr</div>
            <div class="city-row"><button class="city-go alt" data-act="close-modal">Klar <small>(Esc)</small></button></div>
        </div>`);
}

// Telefonen i stan: tjänster och crew-order (SMS kopplas in när man spelar online)
function showCityPhone() {
    const w = session.world;
    const money = w.profile.money || 0;
    const taxi = w.taxiDestinations().map(d => `<button class="city-go place-act" data-act="taxi:${d.i}" ${money >= d.price ? '' : 'disabled'}>🚕 ${escapeHtml(d.label)} · ${d.price.toLocaleString('sv-SE')} kr</button>`).join('');
    const doc = w.doctorPrice();
    const sms = session.opts.sms;
    showModal('cityphone', `
        <div class="city-card phone" style="--gang:#38bdf8">
            <div class="phone-head">📱 Telefonen · <span>${money.toLocaleString('sv-SE')} kr</span></div>
            ${sms && cityNetActive() ? `<button class="city-go place-act" data-act="sms">💬 SMS till andra spelare${sms.unread() ? ` (${sms.unread()} olästa)` : ''}</button>` : '<p class="phone-brief">💬 SMS till andra spelare fungerar när du spelar online.</p>'}
            <div class="phone-member">🚑 Doktorn</div>
            <button class="city-go place-act" data-act="doctor" ${money >= doc ? '' : 'disabled'}>🚑 Ring doktorn · ${doc.toLocaleString('sv-SE')} kr<small>Full hälsa för dig och crewet · kommer inte mitt i en strid</small></button>
            <div class="phone-member">👮 Polisen · ${escapeHtml(w.policeLine())}</div>
            <div class="phone-member">🚕 Taxi · inte med snuten efter dig</div>
            <div class="place-actions">${taxi}</div>
            <div class="phone-member">👥 Crew (${(w.crew || []).length}/${CREW_MAX})</div>
            <div class="city-row">
                <button class="city-go" data-act="crew:follow">1 Följ</button>
                <button class="city-go" data-act="crew:hold">2 Stanna</button>
                <button class="city-go" data-act="crew:attack">3 Anfall</button>
            </div>
            <div class="city-row" style="margin-top:12px"><button class="city-go alt" data-act="close-modal">Stäng <small>(Esc)</small></button></div>
        </div>`);
}

// Inne i en lokal: prata med personalen
function showInteraction(id) {
    const w = session.world;
    if (id === 'seller') { showGuns(); return; }
    // Disken i ett av företagen: verksamhetens meny (köp, töm kassan, tjänsten, råna).
    // Händelsen 'place' plockas upp av handleEvents som kör just nu.
    if (id === 'counter' && w.interior?.biz) { w.enterPlace(w.interior.biz); return; }
    const money = w.profile.money || 0;
    const card = (color, head, brief, rows) => `
        <div class="city-card phone" style="--gang:${color}">
            <div class="phone-head">${head}</div>
            <p class="phone-brief">${brief}</p>
            <div class="place-actions">${rows}</div>
            <div class="phone-member">💰 ${money.toLocaleString('sv-SE')} kr · ❤️ ${Math.ceil(w.player.hp)}/${w.player.maxHp}</div>
            <div class="city-row"><button class="city-go alt" data-act="close-modal">Gå därifrån <small>(Esc)</small></button></div>
        </div>`;
    if (id === 'bartender') {
        const free = w.clubMine();
        showModal('club', card('#f472b6', '🍸 Bartendern', free ? '"Chefen! Allt är på huset ikväll."' : '"Vad får det lov att vara?"', `
            <button class="city-go place-act" data-act="club:drink" ${free || money >= 150 ? '' : 'disabled'}>🍸 En drink · ${free ? 'gratis' : '150 kr'}<small>+25 hälsa</small></button>
            ${free ? '<button class="city-go place-act" data-act="club:rest">🛋️ Låt crewet vila i VIP-rummet<small>Full hälsa för dig och crewet — klubben är er bas</small></button>' : ''}`));
    } else if (id === 'bouncer') {
        const b = w.bouncerOffer();
        const taken = w.doneThisRound('bouncer');
        showModal('club', card('#f472b6', '🕴️ Vakten', '"Inga vapen, inga bråk. Behöver du en livvakt? Jag slutar här ikväll om priset är rätt."', `
            <button class="city-go place-act" data-act="club:hire" ${taken || money < b.cost ? 'disabled' : ''}>🛡️ Anställ ${b.name} · ${b.cost.toLocaleString('sv-SE')} kr<small>Livvakt · ❤️ ${b.hp} · 👊 ${b.dmg[0]}–${b.dmg[1]}${taken ? ' · redan anställd den här rundan' : ''}</small></button>`));
    } else if (id === 'manager') {
        const info = w.propertyInfo('stripclub');
        const owner = info.owner ? w.nameOf(info.owner) : null;
        const waiting = !!w.pending.buy;
        const brief = info.mine ? `"Klubben är din. ${info.income.toLocaleString('sv-SE')} kr per runda går till dig, och crewet kan vila här."`
            : owner ? `"${escapeHtml(owner)} äger stället. Vill du ta över får du betala dubbelt — ${escapeHtml(owner)} får ${Math.round(info.price * 0.75).toLocaleString('sv-SE')} kr i ersättning."`
                : `"Klubben är till salu. Den ger ${info.income.toLocaleString('sv-SE')} kr per runda och blir en bas för ditt crew."`;
        showModal('manager', card('#f472b6', '💼 Managern · Club Diamant', brief, info.mine ? '' : `
            <button class="city-go place-act" data-act="club:buy" ${waiting || money < info.price ? 'disabled' : ''}>${waiting ? '⏳ Väntar på värden...' : `💎 ${owner ? 'Ta över' : 'Köp'} klubben · ${info.price.toLocaleString('sv-SE')} kr`}<small>Ägare: ${owner ? escapeHtml(owner) : 'ingen'} · intäkt ${info.income.toLocaleString('sv-SE')} kr/runda · alla spelare ser ägandet</small></button>`));
    } else if (id === 'stage') {
        showModal('club', card('#f472b6', '💃 Scenen', 'Musiken dunkar och publiken jublar.', `
            <button class="city-go place-act" data-act="club:tip" ${money >= 300 ? '' : 'disabled'}>💸 Regna sedlar över scenen · 300 kr<small>+1 rykte</small></button>`));
    }
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
        case 'decline-guns':
            resume();
            break;
        default:
            if (act.startsWith('buy:')) { s.world.buyGoods(Number(act.slice(4))); resume(); }
            else if (act.startsWith('place:')) {
                const r = s.world.placeAction(act.slice(6));
                handleEvents();
                if (r.close) { s.world.leavePlace(); resume(); } else showPlace();
            }
            else if (act === 'close-modal') resume();
            else if (act.startsWith('club:')) {
                const what = act.slice(5);
                if (what === 'drink') s.world.clubDrink();
                else if (what === 'rest') s.world.clubCrewRest();
                else if (what === 'hire') s.world.hireBouncer();
                else if (what === 'tip') s.world.clubTip();
                else if (what === 'buy') { s.world.buyProperty('stripclub'); handleEvents(); showInteraction('manager'); return; }
                handleEvents();
                resume();
            }
            else if (act.startsWith('hire:')) { s.world.recruit(act.slice(5)); handleEvents(); showRecruit(); }
            else if (act.startsWith('fire:')) { s.world.dismiss(act.slice(5)); handleEvents(); showRecruit(); }
            else if (act.startsWith('taxi:')) { const ok = s.world.taxi(Number(act.slice(5))); handleEvents(); if (ok) resume(); else showCityPhone(); }
            else if (act === 'doctor') { const ok = s.world.callDoctor(); handleEvents(); if (ok) resume(); else showCityPhone(); }
            else if (act.startsWith('crew:')) { s.world.orderCrew(act.slice(5)); resume(); }
            else if (act === 'sms') { resume({ lock: false }); s.opts.sms?.open(); }
            else if (act.startsWith('cam:')) { s.pinch = null; setCam(act.slice(4)); showPause(); }
            else if (act === 'armor') { s.world.buyArmor(); handleEvents(); showGuns(); }
            else if (act.startsWith('gun:') || act.startsWith('ammo:')) {
                const [kind, id] = act.split(':');
                if (kind === 'gun') s.world.buyWeapon(id); else s.world.buyAmmo(id);
                handleEvents();
                showGuns(); // stanna kvar i butiken
            }
    }
}

// Tillbaka till spelet: samma kameraläge, position och tillstånd som innan menyn.
// lock: ta pekarlåset direkt i 3D (klicket på "Fortsätt" räknas som användarens tryck).
function resume({ lock = true } = {}) {
    const s = session;
    hideModal();
    s.paused = false;
    s.last = performance.now();
    s.acc = 0;
    s.input.held.clear();
    s.input.edges.clear();
    s.input.takeLook?.();
    s.look.turn = 0;
    syncVehicleAudio();
    updateLock(s, lock);
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

// ── Kameran: FÖRSTAPERSON, FÖLJKAMERA och ÖVERBLICK (logiken i camera.js) ──
// Spelarens val (s.cam) gäller tills hen själv byter: dörrar, rum, bil, menyer, uppdrag,
// omladdning och återanslutning rör det aldrig. Bytet ändrar bara hur stan ritas.

// Det som faktiskt visas: valt 3D-läge när 3D är klart, annars överblicken (laddar, eller 3D går inte)
function shownCam(s) { return is3D(s.cam) && s.r3State === 'ready' && s.r3?.available ? s.cam : 'top'; }

// 3D (three + motorn) laddas första gången ett 3D-läge behövs, inte när stan öppnas
function ensure3D() {
    const s = session;
    if (!s || s.r3State !== 'idle') return;
    s.r3State = 'loading';
    const fail = (why) => {
        if (session !== s || s.closing) return;
        s.r3State = 'failed';
        s.r3Reason = why;
        // Stanna i överblicken och säg varför — spelarens val skrivs inte över
        s.hud.onEvent({ type: 'cam', name: CAM_NAMES.top, icon: '⚠️', tag: `3D går inte här (${why})` });
        s.world.message(`⚠️ 3D-vyn går inte att starta här (${why}). Du spelar i ÖVERBLICK.`);
        updateLock(s);
    };
    createRenderer3D(s.overlay).then(async (r3) => {
        if (session !== s || s.closing) { r3.dispose(); return; }
        if (!r3.available) { fail(r3.reason || 'WebGL2 saknas'); return; }
        r3.setVisible(false);
        await r3.prepare(s.world); // bygg staden och kompilera i förväg: första 3D-bilden hackar inte
        if (session !== s || s.closing) { r3.dispose(); return; }
        if (!r3.available) { r3.dispose(); fail('WebGL tappades'); return; }
        s.r3 = r3;
        s.r3State = 'ready';
        if (is3D(s.cam)) camBanner(s);
        updateLock(s);
    }).catch((e) => { console.warn('3D:', e); fail('laddningen misslyckades'); });
}

// Banner med lägets namn när det byts (och när 3D blivit klart)
function camBanner(s) {
    const loading = is3D(s.cam) && s.r3State !== 'ready' && s.r3State !== 'failed';
    s.hud.onEvent({
        type: 'cam', icon: CAM_ICONS[s.cam],
        name: viewLabel({ cam: s.cam, top: s.topZoom, chase: s.chaseZoom }),
        tag: loading ? '⏳ Laddar 3D…' : s.touch ? '🔍 byter kamera · dra på skärmen för att titta' : 'V / C byter · hjulet zoomar'
    });
}

// Spelaren väljer läge (V/C, 🔍, hjulet eller pausmenyn)
function setCam(cam, { save = true } = {}) {
    const s = session;
    if (!s || !['fps', 'chase', 'top'].includes(cam)) return;
    if (is3D(cam) && s.r3State === 'failed') {
        s.world.message(`⚠️ ${CAM_NAMES[cam]} kräver 3D (WebGL2), som inte går att starta här. Du stannar i ÖVERBLICK.`);
        cam = 'top'; save = false;
    }
    s.cam = cam;
    if (save) saveCam(storage(), cam);
    if (is3D(cam)) ensure3D();
    camBanner(s);
    // Till 3D med V/C/hjulet: ta musen direkt (tangenttrycket räknas som användarens gest en kort stund)
    updateLock(s, is3D(cam));
}
function cycleCam() { session.pinch = null; setCam(nextCam(session.cam)); }

// Scrollhjulet: ett steg in (−1) eller ut (+1) — inom läget och vidare över lägesgränserna
function wheelCam(dir) {
    const s = session;
    s.pinch = null;
    const cur = { cam: s.cam, top: s.topZoom, chase: s.chaseZoom };
    const next = wheelView(cur, dir, s.r3State !== 'failed');
    if (next === cur) return;
    const st = storage();
    if (next.top !== s.topZoom) { s.topZoom = next.top; s.topMul = s.renderer.zoomMul = TOP_ZOOMS[next.top].mul; saveIndex(st, ZOOM_KEY, next.top); }
    if (next.chase !== s.chaseZoom) { s.chaseZoom = next.chase; s.chaseDist = CHASE_ZOOMS[next.chase].dist; saveIndex(st, CHASE_KEY, next.chase); }
    saveZoomX(st, s.topMul, s.chaseDist);
    // Över en lägesgräns: lite längre paus, så att en pekplatta inte far förbi alla steg på en gång
    s.wheelT = next.cam !== s.cam ? 0.35 : 0.12;
    if (next.cam !== s.cam) setCam(next.cam); else camBanner(s);
}

// Nyp-zoom (touch, två fingrar på bilden): som hjulet men steglöst — inom läget och vidare
// över lägesgränserna (camera.js pinchView). f = skalfaktor sedan förra bilden (>1 = isär = in).
// Ett nyp som tar slut mitt i ett glapp vid en lägesgräns räknas inte till nästa nyp.
function pinchCam(f, dt) {
    const s = session;
    const z = s.pinch || { cam: s.cam, topMul: s.topMul, chaseDist: s.chaseDist };
    if (!(f > 0) || Math.abs(f - 1) < 1e-4) {
        if (s.pinch && (s.pinch.idle += dt) > 0.35) {
            s.pinch = null;
            const st = storage();
            s.topZoom = nearestIndex(TOP_ZOOMS, 'mul', s.topMul);
            s.chaseZoom = nearestIndex(CHASE_ZOOMS, 'dist', s.chaseDist);
            saveIndex(st, ZOOM_KEY, s.topZoom); saveIndex(st, CHASE_KEY, s.chaseZoom);
            saveZoomX(st, s.topMul, s.chaseDist);
        }
        return;
    }
    const next = pinchView(z, f, s.r3State !== 'failed');
    s.pinch = { ...next, idle: 0 };
    s.topMul = s.renderer.zoomMul = next.topMul;
    s.chaseDist = next.chaseDist;
    if (next.cam !== s.cam) {
        s.topZoom = nearestIndex(TOP_ZOOMS, 'mul', s.topMul);
        s.chaseZoom = nearestIndex(CHASE_ZOOMS, 'dist', s.chaseDist);
        setCam(next.cam);
        if (s.cam !== next.cam) s.pinch = { ...pinchSettle({ ...next, cam: s.cam }), idle: 0 }; // 3D gick inte
    }
}

// Pekarlåset (dator, 3D): önskat när man spelar — inte i menyer, på stora kartan eller med SMS uppe.
// request: ta det direkt (bara från ett klick/tryck, annars säger webbläsaren nej).
function updateLock(s, request = false) {
    if (!s || s.touch) return;
    const inp = s.input;
    const smsOpen = typeof document !== 'undefined' && !!document.querySelector('.sms-overlay');
    const want = is3D(shownCam(s)) && !s.modalType && !s.paused && !s.world.showMap && !smsOpen && !s.closing;
    inp.lockWanted = want;
    if (!want) { if (inp.locked) inp.releaseLock?.(); }
    else if (request && !inp.locked) inp.requestLock?.();
}

// Blicken från musen (låst) eller ett finger på skärmen. Till fots vrids gubben (vid nästa steg);
// i bilen är det fri blick som bara syns i bild och fjädrar tillbaka. Höjdvinkeln är bara bild.
function applyLook(s, look, mode, dt) {
    const p = s.world.player, v = p.vehicle, fl = s.look.free, vw = s.view;
    if (v !== s.look.veh) { resetFreeLook(fl); s.look.veh = v; }
    const dx = is3D(mode) && look ? look.dx : 0, dy = is3D(mode) && look ? look.dy : 0;
    if (v) { stepFreeLook(fl, dx, dy, dt, { sens: vw.sens, invertY: vw.invertY, touch: s.touch }); return; }
    if (!dx && !dy) return;
    s.look.turn += lookTurn(dx, vw.sens, s.touch);
    if (mode === 'fps') s.look.pitch = stepPitch(s.look.pitch, dy, vw.sens, vw.invertY, s.touch);
}

// Kontrollerna för ett steg: input.state() + blick (turn), sikte (aim) och joysticken i världens riktning
function buildState(s, mode, stepDt) {
    const inp = s.input, w = s.world, p = w.player, car = p.vehicle;
    const state = inp.state();
    state.turn = 0;
    state.aim = null;
    state.lookOnly = !!car; // i bilen: blicken är bara bild, aldrig styrning
    if (is3D(mode)) {
        if (!car) state.turn = s.look.turn;
    } else if (!s.touch && !car && inp.aimActive()) {
        // Överblick: pekaren siktar, med dödzon runt gubben (räknat i skärmen från där han ritas)
        state.aim = aimPoint(inp.mouse, s.renderer.worldToScreen(p.x, p.y), p, s.renderer.cam?.zoom || 1);
    }
    s.look.turn = 0;
    // Joysticken: skärmens riktning → världens (i 3D: upp = rakt fram i bild)
    const yaw = controlYaw(mode, p, s.look.camYaw);
    if (state.mx || state.my) Object.assign(state, stickToWorld(state.mx, state.my, mode, yaw));
    state.faceMove = !!inp.stick?.active && mode !== 'fps'; // förstaperson: blicken står kvar, man går i sidled
    // Joysticken i bilen: kör dit man drar (gas och ratt räknas om från riktningen).
    // stickCar minns om bilen står fast mot en vägg och backar då loss den.
    if (car && inp.stick?.active) {
        const r = mode === 'top' ? inp.stick : stickToWorld(inp.stick.x, inp.stick.y, mode, yaw);
        const stick = mode === 'top' ? inp.stick : { active: true, mag: inp.stick.mag, x: r.mx, y: r.my };
        Object.assign(state, stickCar(s.stickMem || (s.stickMem = {}), stick, car, stepDt));
    } else s.stickMem = null;
    return state;
}

// Följkamerans riktning: bakom bilen, eller blicken till fots (vridningen från musen går in direkt)
function updateCamYaw(s, dt, turned) {
    const w = s.world, p = w.player, v = p.vehicle, L = s.look;
    const room = w.interior ? w.interior.id : null;
    // Dörr, taxi eller avstigning långt bort: ställ kameran bakom direkt i stället för att svepa
    if (room !== L.room || Math.hypot(p.x - L.x, p.y - L.y) > 300) L.camYaw = NaN;
    L.room = room; L.x = p.x; L.y = p.y;
    const stick = s.input.stick;
    const up = stick?.active && stick.mag > 0 ? -stick.y / stick.mag : 0;
    const rate = chaseRate({ car: !!v, touch: s.touch, stickActive: !!stick?.active, stickUp: up, room: !!room });
    L.camYaw = followYaw(L.camYaw, v ? v.angle : p.angle, dt, rate, v ? 0 : turned);
}

// Det 3D-motorn får: vinklar, avstånd och inställningarna
function camOpts(s, mode) {
    const p = s.world.player, v = p.vehicle, fl = s.look.free, vw = s.view;
    const o = s.camOpts || (s.camOpts = {});
    o.bob = vw.bob ? 1 : 0; o.shake = vw.bob; o.fov = vw.fov;
    o.lookYaw = v ? fl.yaw : 0; o.lookPitch = v ? fl.pitch : 0;
    if (mode === 'fps') {
        o.yaw = (v ? v.angle : p.angle) + o.lookYaw;
        o.pitch = v ? fl.pitch : s.look.pitch;
        o.dist = undefined;
    } else {
        o.yaw = (Number.isFinite(s.look.camYaw) ? s.look.camYaw : (v ? v.angle : p.angle)) + o.lookYaw;
        o.pitch = v && fl.pitch ? fl.pitch : undefined;
        o.dist = s.chaseDist;
    }
    return o;
}

// HUD:ens bild av 3D-kameran: samma w/h/dpr som 2D-canvasen, och världen → skärmen genom 3D
function make3DView(s) {
    const v = {};
    const view = {
        get w() { return s.renderer.w; }, get h() { return s.renderer.h; }, get dpr() { return s.renderer.dpr; },
        mode: 'chase',
        // Bakom kameran finns ingen bild: ge en punkt långt ut åt rätt håll (pilarna mot målet)
        worldToScreen(x, y, z = 0) {
            const o = { x: 0, y: 0, visible: false, depth: Infinity };
            const r3 = s.r3;
            if (!r3) return o;
            r3.worldToScreen(x, y, z, o);
            if (o.depth !== Infinity && Number.isFinite(o.x) && Number.isFinite(o.y)) return o;
            r3.getView(v);
            const dx = x - v.x, dy = y - v.y, c = Math.cos(v.yaw), sn = Math.sin(v.yaw);
            const f = dx * c + dy * sn, r = -dx * sn + dy * c, L = Math.hypot(f, r) || 1;
            o.x = view.w / 2 + r / L * 1e5; o.y = view.h / 2 - f / L * 1e5; o.visible = false;
            return o;
        }
    };
    return view;
}

// Pausmenyns inställningar: ändras direkt och sparas
function onSetting(e) {
    const s = session, el = e.target;
    const k = el?.dataset?.set;
    if (!s || !k) return;
    const vw = s.view;
    if (k === 'sens') vw.sens = Math.min(SENS_RANGE[1], Math.max(SENS_RANGE[0], Number(el.value) || 1));
    else if (k === 'fov') vw.fov = Math.round(Math.min(FOV_RANGE[1], Math.max(FOV_RANGE[0], Number(el.value) || 75)));
    else if (k === 'bob') vw.bob = !!el.checked;
    else if (k === 'invertY') vw.invertY = !!el.checked;
    saveView(storage(), vw);
    const out = s.modal.querySelector(`[data-out="${k}"]`);
    if (out) out.textContent = k === 'sens' ? vw.sens.toFixed(1) : k === 'fov' ? `${vw.fov}°` : '';
}

// Touch: samma knapp är slag/skott till fots och handbroms i bilen — visa vilket just nu
function updateTouchLabels() {
    const s = session, w = s.world;
    const hb = s.hbBtn || (s.hbBtn = s.overlay.querySelector('.ct-hb'));
    if (!hb) return;
    const inCar = !!w.player.vehicle;
    const wpn = WEAPONS[w.profile.weapon] || WEAPONS.fists;
    const mode = inCar ? 'car' : wpn.id;
    if (hb.dataset.mode === mode) return;
    hb.dataset.mode = mode;
    hb.textContent = inCar ? '⤵' : wpn.icon;
    hb.setAttribute('aria-label', inCar ? 'Handbroms' : wpn.melee ? 'Slå' : 'Skjut');
    hb.classList.toggle('ct-fight', !inCar);
}

function handleEvents() {
    const s = session, w = s.world;
    for (const e of w.events) {
        switch (e.type) {
            case 'sfx': sfx(e.name, e.vol); break;
            case 'phone': showPhone(e); break;
            case 'shop': showShop(e); break;
            case 'guns': showGuns(); break;
            case 'recruit': showRecruit(); break;
            case 'interact': showInteraction(e.id); break;
            case 'interior':
                // Musik inne i klubben, tyst i vapenaffären
                stopRadio();
                if (e.music === 'club' && !s.musicMuted) playStation(STATIONS.findIndex(st => st.id === 'diamant'));
                else if (!e.id) syncVehicleAudio();
                s.hud.onEvent(e);
                break;
            case 'place': showPlace(); break;
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
    let keepEdges = false; // inget steg den här framen: knapptrycken väntar på nästa
    try {
        const inp = s.input;
        // Blicken (låst mus, touch-look) läses varje bild: syns direkt, vridningen går in vid nästa steg
        const look = inp.takeLook ? inp.takeLook() : null;
        const pinch = inp.takePinch ? inp.takePinch() : 1; // nyp bakom en meny räknas inte
        if (s.modalType) {
            // Tangenter i modaler
            if (inp.pressed('act')) {
                const ph = s.pendingPhone;
                const act = s.modalType === 'phone' ? (s.pendingMission ? 'accept' : ph?.canJoin ? 'join' : 'decline')
                    : s.modalType === 'shop' ? `buy:${Math.min(5, s.pendingShop?.left || 0)}`
                        : s.modalType === 'guns' ? 'decline-guns'
                            : ['recruit', 'cityphone', 'club', 'manager'].includes(s.modalType) ? 'close-modal'
                            : s.modalType === 'place' ? 'place:leave'
                            : s.modalType === 'intro' ? 'start' : 'resume';
                onModalAction(act);
            } else if (inp.pressed('exit')) onModalAction({ phone: 'decline', shop: 'decline-shop', guns: 'decline-guns', place: 'place:leave', pause: 'resume', recruit: 'close-modal', cityphone: 'close-modal', club: 'close-modal', manager: 'close-modal' }[s.modalType] || 'start');
            else if (inp.pressed('pause') && s.modalType === 'pause') onModalAction('resume');
        } else if (!s.paused) {
            if (inp.pressed('pause')) showPause();
            else if (inp.pressed('exit')) { if (s.world.showMap) s.world.showMap = false; else tryGoHome(); }
            if (inp.pressed('map')) s.world.showMap = !s.world.showMap;
            // Crew-order: 1 följ, 2 stanna, 3 anfall (👥 på mobilen växlar)
            if (inp.pressed('c1')) s.world.orderCrew('follow');
            if (inp.pressed('c2')) s.world.orderCrew('hold');
            if (inp.pressed('c3')) s.world.orderCrew('attack');
            if (inp.pressed('crew')) { const cur = s.world.crew[0]?.order; s.world.orderCrew(cur === 'follow' ? 'attack' : cur === 'attack' ? 'hold' : 'follow'); }
            if (inp.pressed('phone')) showCityPhone();
            if (inp.pressed('cam')) cycleCam();
            const wheel = inp.takeWheel();
            s.wheelT = Math.max(0, s.wheelT - dt);
            if (wheel && s.wheelT <= 0) wheelCam(wheel);
            pinchCam(pinch, dt);
            if (s.world.player.vehicle && inp.pressed('r')) cycleRadio(); // till fots betyder R rån
            applyLook(s, look, shownCam(s), dt);
        }
        if (s.closing) return;
        let turned = 0;
        if (!s.paused) {
            s.acc += dt;
            // Läs kontrollerna bara när ett steg faktiskt körs: 90/120 Hz-skärmar har frames
            // utan steg, och då skulle knapptryck (👊, E, 💰 …) ätas upp och försvinna
            if (s.acc >= STEP) {
                const state = buildState(s, shownCam(s), Math.min(5, Math.floor(s.acc / STEP)) * STEP);
                turned = state.turn;
                s.throttle = state.throttle;
                let steps = 0;
                while (s.acc >= STEP && steps < 5) {
                    // Engångssaker (tryck och blickens vridning) bara i första steget
                    s.world.update(STEP, steps === 0 ? state : { ...state, turn: 0, action: false, punch: false, rob: false, weapon: false });
                    s.acc -= STEP;
                    steps++;
                }
                if (steps === 5) s.acc = 0;
            } else keepEdges = true;
            handleEvents();
            s.hud.update(dt);
            const v = s.world.player.vehicle;
            if (v && !v.wrecked) engineSet(Math.hypot(v.vx, v.vy) / v.spec.maxSpeed, Math.max(0, s.throttle || 0), v.spec.engine);
            sirenSet(s.world.sirenIntensity());
            if (s.world.finished) { close(s.world.finished); return; }
        }
        // Berätta för de andra var jag är (~10 ggr/s), även när jag pausat
        cityPublish(s.world.netSnapshot(s.paused));
        if (gameState.isOnline && (s.syncT += dt) > 4) {
            // Mina pengar och grejer till värden då och då (den som har turen skickar hela läget)
            s.syncT = 0;
            const j = JSON.stringify(s.world.profile);
            if (j !== s.lastSynced) { s.lastSynced = j; if (isMyTurn()) syncState(); else syncMe(); }
        }
        if (s.touch) updateTouchLabels();
        updateCamYaw(s, s.paused ? 0 : dt, turned);
        updateLock(s);
        drawFrame(s, s.paused ? 0 : dt);
        if (!keepEdges) inp.endFrame();
        s.errors = Math.max(0, s.errors - 0.02);
    } catch (err) {
        console.error('Stan-fel:', err);
        s.errors++;
        if (s.errors > 20) close('crash');
    }
}

// ── Bilden: 3D (förstaperson/följkamera) med HUD:en ovanpå, eller 2D (överblick) ──
// I 3D ser man långt längs gatorna: folk och bilar skapas och städas längre bort (world.manageSpawns),
// där dimman redan tagit dem, så att de inte poppar upp mitt i bild. Lite tätare för att det inte ska kännas tomt.
const VIEW_3D = { fps: { extra: 700, dense: 1.4 }, chase: { extra: 800, dense: 1.45 } };
function drawFrame(s, dt) {
    const mode = shownCam(s), r = s.renderer, w = s.world;
    r.updateCamera(w, dt); // 2D-kameran följer med även i 3D: överblicken är redo direkt vid byte
    const three = is3D(mode);
    if (s.r3 && three !== s.r3Shown) { s.r3.setVisible(three); s.r3Shown = three; }
    if (three !== s.cam3dClass) { s.overlay.classList.toggle('cam3d', three); s.cam3dClass = three; } // HUD-layouten i 3D (city.css)
    r.zoomRate = s.pinch ? 14 : 0; // nyp: överblickens zoom följer fingrarna direkt
    if (three) {
        w.viewExtra = VIEW_3D[mode].extra; w.viewDense = VIEW_3D[mode].dense;
        s.r3.render(w, dt, mode, camOpts(s, mode));
        // 2D-canvasen är genomskinlig ovanpå 3D: bara HUD:en och det som hör till platser i världen
        const ctx = r.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, r.canvas.width, r.canvas.height);
        s.view3.mode = mode;
        s.hud.drawWorld3D(ctx, w, s.view3, { touch: s.touch, mode, lockHint: !s.touch && s.input.lockWanted && !s.input.locked });
        s.hud.draw(ctx, w, s.view3, { touch: s.touch, cam: mode, locked: !s.touch && s.input.locked });
        return;
    }
    // Utzoomat ser man längre: folk och bilar ska dyka upp utanför bild (world.manageSpawns)
    const zm = r.zoomMul || 1;
    const viewR = Math.hypot(r.w, r.h) / 2 / Math.min(r.cam.zoom, r.zTarget || 9);
    // (fotgängare skapas 520 px bort i normalvyn — utzoomat ska det vara bortom skärmens hörn)
    w.viewExtra = zm < 1 ? Math.max(viewR * (1 - zm), viewR + 40 - 520) : 0;
    w.viewDense = zm < 1 ? Math.min(1.6, 1 / (zm * zm)) : 1;
    r.draw(w, dt);
    s.hud.draw(r.ctx, w, r, { touch: s.touch, cam: 'top' });
}

function close(reason) {
    const s = session;
    if (!s || s.closing) return;
    s.closing = true;
    cancelAnimationFrame(s.raf);
    try {
        s.input.destroy();
        s.cleanup();
        s.r3?.dispose();
        s.r3 = null;
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
