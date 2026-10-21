// ═══════════════════════════════════════════
//  STAN — kopplingen till huvudspelet
//  Statuspanel, starta stan och konsekvenser
//  av BUSTED / WASTED när man kommer hem.
// ═══════════════════════════════════════════

import { openCity, isCityOpen } from '../city/index.js';
import { GANGS, JOIN_RESPECT } from '../city/constants.js';
import { gameState, currentPlayer, formatNum, jailPlayer, canAct, saveGame } from '../game/state.js';
import { updateHUD } from '../game/core.js';
import { showToast, startMusic, spawnParticles } from '../utils/effects.js';
import { stopRadio, unlockAudio } from '../utils/audio.js';
import { syncState } from '../multiplayer/sync.js';
import { closePhone } from './phone.js';

export function renderStanPanel() {
    const el = document.getElementById('stan-content');
    const p = currentPlayer();
    if (!el || !p) return;
    const left = Math.max(0, gameState.maxMissionsPerRound - (p.missionsThisRound || 0));
    const st = p.cityStats || {};
    const blocked = p.inJail ? '🔒 Du sitter i häktet' : !canAct() ? '⏳ Inte din tur' : '';
    el.innerHTML = `
        <div class="stan-hero">
            <div class="stan-hero-title">HUSTLE CITY</div>
            <div class="stan-hero-sub">Sno bilar. Ta jobb. Skaka av snuten.</div>
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
            </div>
            <div class="stan-card">
                <h4>🏆 Gatans meriter</h4>
                <div class="stan-stat"><span>✅ Klarade uppdrag</span><b>${st.missions || 0}</b></div>
                <div class="stan-stat"><span>💥 Kvaddade bilar</span><b>${st.wrecks || 0}</b></div>
                <div class="stan-stat"><span>🔧 Skrotade bilar</span><b>${st.fenced || 0}</b></div>
                <div class="stan-stat"><span>💸 Langade varor</span><b>${st.sold || 0}</b></div>
                <div class="stan-stat"><span>😤 Opps på dig</span><b>${st.opps || 0}</b></div>
                <div class="stan-stat"><span>🚔 Busted / 💀 Wasted</span><b>${st.busted || 0} / ${st.wasted || 0}</b></div>
            </div>
        </div>`;
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

export function goToCity() {
    const p = currentPlayer();
    if (!p || isCityOpen()) return;
    if (!canAct()) { showToast('⏳ Vänta på din tur!'); return; }
    if (p.inJail) { showToast('🔒 Du sitter i häktet — ingen stan för dig!'); return; }
    unlockAudio();
    stopRadio();
    closePhone();
    openCity(p, {
        round: gameState.round,
        maxMissions: gameState.maxMissionsPerRound,
        maxFence: gameState.maxFencePerRound,
        maxGoods: gameState.maxGoodsPerRound,
        musicMuted: gameState.musicMuted,
        onClose: onCityClosed
    });
}

function onCityClosed(result) {
    const p = currentPlayer();
    if (!p) return;
    if (!p.cityStats) p.cityStats = {};
    if (result.reason === 'busted') {
        const fine = Math.floor(p.money * 0.15);
        p.money -= fine;
        // Häktet räknas ner i slutet av samma tur, så 2 = minst en hel tur bakom galler
        const rounds = 2 + Math.floor((result.stars || 1) / 2);
        jailPlayer(p, '🚔 BUSTED i stan', rounds);
        p.cityStats.busted = (p.cityStats.busted || 0) + 1;
        showToast(`🚔 BUSTED! Böter ${formatNum(fine)} kr och ${rounds} rundor i häktet.`);
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
    if (gameState.isOnline) syncState();
    if (!gameState.musicMuted) startMusic();
}
