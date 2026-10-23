// ═══════════════════════════════════════════
//  STAN — kopplingen till huvudspelet
//  Statuspanel, starta stan och konsekvenser
//  av BUSTED / WASTED när man kommer hem.
// ═══════════════════════════════════════════

import { openCity, isCityOpen } from '../city/index.js';
import { GANGS, JOIN_RESPECT } from '../city/constants.js';
import { WEAPONS, WEAPON_ORDER, ownsWeapon } from '../city/weapons.js';
import { HOUSES } from '../city/map.js';
import { ROLES, CREW_MAX } from '../city/crew.js';
import { PROPERTIES } from '../multiplayer/authority.js';
import { gameState, currentPlayer, myPlayer, formatNum, jailPlayer, canAct, saveGame } from '../game/state.js';
import { updateHUD, ensureAITurn } from '../game/core.js';
import { showToast, startMusic, spawnParticles } from '../utils/effects.js';
import { stopRadio, unlockAudio } from '../utils/audio.js';
import { syncState, syncMe } from '../multiplayer/sync.js';
import { closePhone } from './phone.js';
import { escapeHtml } from '../utils/html.js';
import { openSmsOverlay, smsUnread } from './sms.js';

// Online är stan gemensam och öppen för alla, även mellan turerna
function canGoToCity() {
    if (gameState.gameOver) return false;
    return gameState.isOnline ? !!myPlayer() : canAct();
}

export function renderStanPanel() {
    const el = document.getElementById('stan-content');
    const p = myPlayer();
    if (!el || !p) return;
    const left = Math.max(0, gameState.maxMissionsPerRound - (p.missionsThisRound || 0));
    const st = p.cityStats || {};
    const blocked = p.inJail ? '🔒 Du sitter i häktet' : !canGoToCity() ? '⏳ Inte din tur' : '';
    el.innerHTML = `
        <div class="stan-hero">
            <div class="stan-hero-title">HUSTLE CITY</div>
            <div class="stan-hero-sub">Sno bilar. Råna folk. Köp järn. Ragga. Skaka av snuten.</div>
            <button class="stan-go" onclick="window.game.goToCity()" ${blocked ? 'disabled' : ''}>
                ${blocked || '🚗 ÅK UT PÅ STAN'}
            </button>
        </div>
        <div class="stan-grid">
            ${gangCard(p)}
            <div class="stan-card">
                <h4>🤝 Respekt</h4>
                ${GANGS.map(g => {
        const v = (p.respect || {})[g.id] || 0;
        const w = Math.abs(v) / 2;
        return `<div class="resp-row">
                        <span class="resp-icon">${g.icon}</span>
                        <span class="resp-name">${g.name}${p.gang === g.id ? ' ⭐' : ''}</span>
                        <div class="resp-bar"><div class="resp-fill ${v < 0 ? 'neg' : ''}" style="${v < 0 ? `right:50%` : `left:50%`};width:${w}%;--gc:${g.color}"></div></div>
                        <span class="resp-val" style="color:${v < 0 ? 'var(--danger)' : g.color}">${v > 0 ? '+' : ''}${v}</span>
                    </div>`;
    }).join('')}
                <p class="stan-note">+${JOIN_RESPECT} = du får gå med via deras telefon ☎️. Under −25 lägger de på och jagar dig.</p>
            </div>
            <div class="stan-card">
                <h4>📟 Den här rundan</h4>
                <div class="stan-stat"><span>☎️ Uppdrag kvar</span><b>${left} / ${gameState.maxMissionsPerRound}</b></div>
                <div class="stan-stat"><span>🔧 Bilar att skrota</span><b>${Math.max(0, gameState.maxFencePerRound - (p.fencedThisRound || 0))} / ${gameState.maxFencePerRound}</b></div>
                <div class="stan-stat"><span>🏢 Kassor att hämta</span><b>${Math.max(0, p.owned.length - (p.cityCollected || []).length)}</b></div>
                <div class="stan-stat"><span>🎒 Varor att langa</span><b>${p.cityGoods || 0} · köp ${Math.max(0, gameState.maxGoodsPerRound - (p.goodsBoughtThisRound || 0))} till</b></div>
                <div class="stan-stat"><span>🚗 Bilar i garaget</span><b>${(p.cars || []).length || 'Morsans Volvo'}</b></div>
                <div class="stan-stat"><span>💃 Dejt vid Nattklubben</span><b>${p.dateThisRound ? '✔ Klar' : 'Ledig efter 20:00'}</b></div>
            </div>
            <div class="stan-card">
                <h4>🔫 Arsenal</h4>
                ${weaponRows(p)}
                <p class="stan-note">Köp mer hos Pang-Pelle 🔫 i Industrin. Åker du fast tar snuten dina vapen.</p>
            </div>
            <div class="stan-card">
                <h4>🏡 Gömställen och styrka</h4>
                ${(p.cityHouses || []).map(id => `<div class="stan-stat"><span>🏡 ${HOUSES[id.replace('house-', '')]?.[0] || id}</span><b>✔</b></div>`).join('') || '<p class="stan-note">Inga gömställen än. Gå in genom en dörr med 🔑 TILL SALU i stan.</p>'}
                <div class="stan-stat"><span>🏋️ Styrka (Hustle Gym)</span><b>${p.strength || 0} / 5</b></div>
                <div class="stan-stat"><span>🦺 Skyddsväst</span><b>${Math.round(p.armor || 0)} / 100</b></div>
                <div class="stan-stat"><span>💎 Club Diamant</span><b>${clubOwnerText(p)}</b></div>
            </div>
            <div class="stan-card">
                <h4>👥 Crew (${(p.crew || []).length}/${CREW_MAX})</h4>
                ${(p.crew || []).map(m => `<div class="stan-stat"><span>${ROLES[m.role]?.icon || '👤'} ${escapeHtml(m.name)} · ${ROLES[m.role]?.name || ''}</span><b>❤️ ${m.hp}</b></div>`).join('') || '<p class="stan-note">Inget crew än. Rekrytera vid 👥 nära HQ eller anställ vakten på Club Diamant.</p>'}
                <p class="stan-note">I stan: 1 följ · 2 stanna · 3 anfall. Du betalar en gång — inga löner.</p>
            </div>
            <div class="stan-card">
                <h4>🏆 Gatans meriter</h4>
                <div class="stan-stat"><span>✅ Klarade uppdrag</span><b>${st.missions || 0}</b></div>
                <div class="stan-stat"><span>💥 Kvaddade bilar</span><b>${st.wrecks || 0}</b></div>
                <div class="stan-stat"><span>🔧 Skrotade bilar</span><b>${st.fenced || 0}</b></div>
                <div class="stan-stat"><span>💸 Langade varor</span><b>${st.sold || 0}</b></div>
                <div class="stan-stat"><span>😤 Opps på dig</span><b>${st.opps || 0}</b></div>
                <div class="stan-stat"><span>🎳 Påkörda</span><b>${st.knockouts || 0}</b></div>
                <div class="stan-stat"><span>💰 Rån</span><b>${st.robbed || 0}</b></div>
                <div class="stan-stat"><span>💃 Dejter</span><b>${st.dates || 0}</b></div>
                <div class="stan-stat"><span>🏦 Butiks- och bankrån</span><b>${st.heists || 0}</b></div>
                <div class="stan-stat"><span>🚔 Snutar nere</span><b>${st.copsDown || 0}</b></div>
                <div class="stan-stat"><span>⚔️ PvP vinster / förluster</span><b>${st.pvpWins || 0} / ${st.pvpLosses || 0}</b></div>
                <div class="stan-stat"><span>🚔 Busted / 💀 Wasted</span><b>${st.busted || 0} / ${st.wasted || 0}</b></div>
            </div>
        </div>`;
}

function clubOwnerText(p) {
    const own = (gameState.cityOwners || {}).stripclub;
    if (!own) return `Till salu · ${PROPERTIES.stripclub.price.toLocaleString('sv-SE')} kr`;
    if (own.owner === p.charKey) return `Din · +${PROPERTIES.stripclub.income.toLocaleString('sv-SE')} kr/runda`;
    return escapeHtml(gameState.players.find(x => x.charKey === own.owner)?.char?.name || own.owner);
}

function weaponRows(p) {
    const owned = WEAPON_ORDER.filter(id => ownsWeapon(p, id));
    return owned.map(id => {
        const w = WEAPONS[id];
        return `<div class="stan-stat"><span>${w.icon} ${w.name}${p.weapon === id ? ' ⭐' : ''}</span><b>${w.melee ? '—' : `${(p.ammo || {})[id] || 0} skott`}</b></div>`;
    }).join('');
}

function gangCard(p) {
    const g = GANGS.find(x => x.id === p.gang);
    if (!g) {
        return `<div class="stan-card">
            <h4>🤝 Ditt gäng</h4>
            <p class="stan-gang-none">Du är ingens. Jobba för ett gäng tills du har +${JOIN_RESPECT} respekt och svara i deras telefon för att gå med.</p>
            <div class="stan-gang-list">${GANGS.map(x => `<span title="${x.name}" style="--gc:${x.color}">${x.icon} ${x.short}${x.kind === 'mc' ? ' MC' : ''}</span>`).join('')}</div>
        </div>`;
    }
    const rival = GANGS.find(x => x.id === g.rival);
    return `<div class="stan-card stan-gang" style="--gc:${g.color}">
        <h4>🤝 Ditt gäng</h4>
        <div class="stan-gang-name">${g.icon} ${g.name}</div>
        <div class="stan-stat"><span>${g.kind === 'mc' ? '🦺 Väst + HD vid HQ' : '🚗 Gängets bil vid HQ'}</span><b>✔</b></div>
        <div class="stan-stat"><span>💸 Langa säkert i</span><b>${g.district.toUpperCase()}</b></div>
        <div class="stan-stat"><span>⚔️ Rivaler</span><b>${rival.icon} ${rival.short}</b></div>
    </div>`;
}

let cityProfile = null;

// Omladdning eller stängd flik mitt i stan: spara (polisens läge ligger i profilen, p.cityPolice),
// så att en pågående jakt eller sökning inte raderas av en omladdning.
// Online sparas inget lokalt (värden har läget; doSave säger samma sak).
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (isCityOpen() && !gameState.isOnline) saveGame(); });

// Gripen i stan men sidan laddades om under BUSTED-skärmen (p.cityBusted sparades vid pagehide):
// gripandet verkställs direkt när sparfilen laddats — häkte, böter på saldot vid gripandet och
// beslag — inte först nästa gång man åker till stan. main.js anropar det efter loadGame
// (solo: den mänskliga spelare som greps, även om det är en AI:s tur när sparfilen laddas).
export function applyPendingBust(p = gameState.isOnline ? myPlayer() : gameState.players.find(x => x.cityBusted && !x.isAI)) {
    if (!p || !p.cityBusted || p.inJail || isCityOpen()) return false;
    cityProfile = p;
    onCityClosed({ reason: 'busted', stars: p.cityBusted.stars || 3, moneyDelta: 0 });
    return true;
}

export function goToCity() {
    const p = myPlayer();
    if (!p || isCityOpen()) return;
    if (!canGoToCity()) { showToast('⏳ Vänta på din tur!'); return; }
    // Skydd: gripandet gäller även om det inte verkställdes vid inloggningen
    if (applyPendingBust(p)) return;
    if (p.inJail) { showToast('🔒 Du sitter i häktet — ingen stan för dig!'); return; }
    unlockAudio();
    stopRadio();
    closePhone();
    cityProfile = p;
    openCity(p, {
        round: gameState.round,
        maxMissions: gameState.maxMissionsPerRound,
        maxFence: gameState.maxFencePerRound,
        maxGoods: gameState.maxGoodsPerRound,
        musicMuted: gameState.musicMuted,
        slot: gameState.isOnline ? Math.max(0, gameState.players.indexOf(p)) : 0,
        sms: { open: openSmsOverlay, unread: smsUnread },
        onClose: onCityClosed
    });
}

function onCityClosed(result) {
    // Samma spelare som åkte ut (online kan turen ha gått vidare under tiden)
    const p = cityProfile || myPlayer();
    cityProfile = null;
    if (!p) return;
    if (!p.cityStats) p.cityStats = {};
    delete p.cityBusted;
    if (result.reason === 'busted') {
        const fine = Math.floor(p.money * 0.15);
        p.money -= fine;
        // Häktet räknas ner i slutet av samma tur, så 2 = minst en hel tur bakom galler
        const rounds = 2 + Math.floor((result.stars || 1) / 2);
        jailPlayer(p, '🚔 BUSTED i stan', rounds);
        p.cityStats.busted = (p.cityStats.busted || 0) + 1;
        const hadWeapons = (p.weapons || []).length > 0;
        // Snuten beslagtar allt du bar på
        p.weapons = []; p.ammo = {}; p.weapon = 'fists';
        showToast(`🚔 BUSTED! Böter ${formatNum(fine)} kr och ${rounds} rundor i häktet.${hadWeapons ? ' Vapnen beslagtogs.' : ''}`);
    } else if (result.reason === 'wasted') {
        const bill = Math.min(p.money, 200 + Math.floor(p.money * 0.1));
        p.money -= bill;
        p.cityStats.wasted = (p.cityStats.wasted || 0) + 1;
        showToast(`💀 WASTED! Sjukhusräkningen: ${formatNum(bill)} kr.`);
    } else if (result.reason === 'crash') {
        showToast('⚠️ Stan krånglade — du är hemma igen, pengarna är kvar.');
    }
    if (result.abandoned) showToast(`📞 Du lämnade jobbet "${result.abandoned}" — gänget är besviket.`);
    const delta = result.moneyDelta;
    if (delta > 0) { showToast(`🏙️ Stan gav +${formatNum(delta)} kr`); spawnParticles(['💰', '🚗', '🔥'], 12); }
    updateHUD();
    window.game?.refreshUI?.();
    renderStanPanel();
    saveGame();
    // Online: den som har turen skickar hela läget, annars bara sin egen spelare
    if (gameState.isOnline) { if (p === currentPlayer()) syncState(); else syncMe(); }
    if (!gameState.musicMuted) startMusic();
    // En AI-tur som väntade medan stan var öppen (värden kör AI-turerna) fortsätter nu
    ensureAITurn();
}
