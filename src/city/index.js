// ═══════════════════════════════════════════
//  STAN — session: öppnar och stänger stan,
//  kör spelloopen med fast tidssteg och kopplar
//  världens events till ljud och HUD.
// ═══════════════════════════════════════════

import { generateCity } from './map.js';
import { World } from './world.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input, stickDrive } from './input.js';
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

function buildOverlay(touch) {
    const el = document.createElement('div');
    el.id = 'city-overlay';
    el.className = 'city-overlay' + (touch ? ' touch' : '');
    el.innerHTML = `
        <canvas class="city-canvas"></canvas>
        <div class="city-topbar">
            <button class="city-btn" data-cmd="phone" title="Telefon: SMS, taxi, doktor, crew (T)">📱</button>
            <button class="city-btn" data-cmd="zoom" title="Byt vy: zooma in och ut (V)">🔍</button>
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
        ? `<div class="city-help"><b>🕹️ Joysticken</b> — sätt tummen nere till vänster och dra: gå dit du drar, hela vägen ut = spring · i bilen kör den dit du drar (dra bakåt för att backa) · <b>👊</b> slå / skjut (blir <b>⤵</b> handbroms i bilen) · <b>E</b> gå in genom dörrar, in/ur bil, plocka upp · <b>💰</b> råna · <b>🔫</b> byt vapen · <b>👥</b> crew-order · <b>📯</b> tuta · <b>📱</b> telefon · <b>🔍</b> byt vy<br><small>Version ${escapeHtml(BUILD)}</small></div>`
        : `<div class="city-help"><b>WASD/Pilar</b> kör/gå · <b>Musen</b> siktar, <b>vänsterklick</b> slår/skjuter, <b>hjulet</b> zoomar · <b>Shift</b> spring · <b>E</b> gå in genom dörrar, in/ur bil, plocka upp · <b>Space</b> handbroms / slå / skjut · <b>R</b> råna (till fots) / radio (i bil) · <b>Q</b> byt vapen · <b>M</b> karta · <b>T</b> telefon · <b>V</b> byt vy · <b>1 2 3</b> crew: följ / stanna / anfall · <b>H</b> tuta · <b>P</b> paus · <b>Esc</b> hem<br><small>Version ${escapeHtml(BUILD)}</small></div>`;
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
    renderer.zoomMul = ZOOMS[loadZoom()].mul;
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
        errors: 0, musicMuted: !!opts.musicMuted, pendingMission: null, closing: false
    };

    const onResize = () => renderer.resize();
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
        if (!r || session.modalType) return;
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

    overlay.querySelector('.city-topbar').addEventListener('click', (e) => {
        const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
        if (cmd === 'zoom') cycleZoom();
        else if (cmd === 'radio') cycleRadio();
        else if (cmd === 'phone') { if (!session.modalType) showCityPhone(); }
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
            <p class="city-tag">${escapeHtml(p.char?.icon || '')} ${escapeHtml(p.char?.name || '')} rullar ut på gatan. Sno bilar, ta jobb från gängens telefoner ☎️ och gå med i ett gäng. Köp varor av Langaren vid HQ 🎒 och langa — men på fel turf kommer opps. Kör över folk, råna dem, köp vapen hos Pang-Pelle 🔫 i Industrin och plocka upp en dejt vid Nattklubben 🍾 i Centrum efter 20:00. Gå in genom dörrarna: köp fastigheter och gömställen, råna butiker och banken. Snuten bryr sig bara om det de ser — kommer du utom synhåll tappar de spåret.</p>
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
            <div class="phone-member">💰 Du har ${(prof.money || 0).toLocaleString('sv-SE')} kr · SPACE slår/skjuter · Q byter vapen</div>
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
            else if (act === 'sms') { resume(); s.opts.sms?.open(); }
            else if (act === 'armor') { s.world.buyArmor(); handleEvents(); showGuns(); }
            else if (act.startsWith('gun:') || act.startsWith('ammo:')) {
                const [kind, id] = act.split(':');
                if (kind === 'gun') s.world.buyWeapon(id); else s.world.buyAmmo(id);
                handleEvents();
                showGuns(); // stanna kvar i butiken
            }
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

// ── Vy: hur nära kameran är (sparas i webbläsaren) ──
const ZOOMS = [
    { name: 'NORMAL', mul: 1 },
    { name: 'LÅNGT', mul: 0.66 },
    { name: 'NÄRA', mul: 1.35 }
];
const ZOOM_KEY = 'hustle_city_zoom';
function loadZoom() {
    try { const i = Number(localStorage.getItem(ZOOM_KEY)); return Number.isInteger(i) && ZOOMS[i] ? i : 0; } catch (e) { return 0; }
}
function setZoom(i) {
    const s = session;
    try { localStorage.setItem(ZOOM_KEY, String(i)); } catch (e) { /* privat läge: gäller bara nu */ }
    s.zoomIdx = i;
    s.renderer.zoomMul = ZOOMS[i].mul;
    s.hud.onEvent({ type: 'view', name: `VY: ${ZOOMS[i].name}`, tag: s.touch ? '🔍 byter' : 'V / 🔍 / scrollhjulet' });
}
function cycleZoom() { setZoom(((session.zoomIdx ?? loadZoom()) + 1) % ZOOMS.length); }
// Scrollhjulet: ett steg närmare (-1) eller längre ut (+1), utan att gå runt
function zoomStep(dir) {
    const order = [1, 0, 2]; // LÅNGT, NORMAL, NÄRA
    const at = order.indexOf(session.zoomIdx ?? loadZoom());
    const next = order[Math.max(0, Math.min(order.length - 1, at - dir))];
    if (next !== (session.zoomIdx ?? loadZoom())) setZoom(next);
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
    try {
        const inp = s.input;
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
            if (inp.pressed('zoom')) cycleZoom();
            const wheel = inp.takeWheel();
            if (wheel) zoomStep(wheel);
            if (s.world.player.vehicle && inp.pressed('r')) cycleRadio(); // till fots betyder R rån
        }
        if (s.closing) return;
        if (!s.paused) {
            s.acc += dt;
            const state = inp.state();
            // Musen siktar (dator): världskoordinaten under pekaren
            state.aim = !s.touch && inp.aimActive() ? s.renderer.screenToWorld(inp.mouse.x, inp.mouse.y) : null;
            // Joysticken i bilen: kör dit man drar (gas och ratt räknas om från riktningen)
            const car = s.world.player.vehicle;
            if (car && inp.stick.active) Object.assign(state, stickDrive(inp.stick, car.angle, car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle), car.spec.maxSpeed));
            let steps = 0;
            while (s.acc >= STEP && steps < 5) {
                s.world.update(STEP, steps === 0 ? state : { ...state, action: false, punch: false, rob: false, weapon: false });
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
        // Berätta för de andra var jag är (~10 ggr/s), även när jag pausat
        cityPublish(s.world.netSnapshot(s.paused));
        if (gameState.isOnline && (s.syncT += dt) > 4) {
            // Mina pengar och grejer till värden då och då (den som har turen skickar hela läget)
            s.syncT = 0;
            const j = JSON.stringify(s.world.profile);
            if (j !== s.lastSynced) { s.lastSynced = j; if (isMyTurn()) syncState(); else syncMe(); }
        }
        if (s.touch) updateTouchLabels();
        s.renderer.updateCamera(s.world, s.paused ? 0 : dt);
        // Utzoomat ser man längre: folk och bilar ska dyka upp utanför bild (world.manageSpawns)
        const zm = s.renderer.zoomMul || 1;
        const viewR = Math.hypot(s.renderer.w, s.renderer.h) / 2 / Math.min(s.renderer.cam.zoom, s.renderer.zTarget || 9);
        // (fotgängare skapas 520 px bort i normalvyn — utzoomat ska det vara bortom skärmens hörn)
        s.world.viewExtra = zm < 1 ? Math.max(viewR * (1 - zm), viewR + 40 - 520) : 0;
        s.world.viewDense = zm < 1 ? Math.min(1.6, 1 / (zm * zm)) : 1;
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
