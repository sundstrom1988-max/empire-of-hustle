// ═══════════════════════════════════════════
//  GARGAMEL — Hemligt Heist-system 🧙‍♂️
//  Syns BARA för Gargamel. Andra vet inget.
// ═══════════════════════════════════════════

import { gameState, currentPlayer, formatNum, jailPlayer } from '../game/state.js';
import { CHARACTERS, SHOPS } from '../data/gameData.js';
import { updateHUD } from '../game/core.js';
import { playSound, showToast, spawnParticles } from '../utils/effects.js';
import { syncState, sendEffect } from '../multiplayer/sync.js';

// ── Mystiska meddelanden som offret ser ──
const MYSTERIOUS_STEAL = [
    '🌑 Pengar försvann mystiskt från ditt kassaskåp...',
    '🕳️ Okända krafter dränerade delar av dina tillgångar...',
    '👤 Någon i skuggorna plockade ur din ficka...',
    '🌫️ Ett mörkt moln la sig över dina finanser...',
    '🔮 Mörk magi tömde delar av ditt konto...'
];

const MYSTERIOUS_SABOTAGE = [
    '🕳️ Okänd skada upptäcktes på dina lokaler...',
    '🌑 Mystisk olycka drabbade ditt företag i natten...',
    '⚡ Oförklarliga störningar skadar din verksamhet...',
    '🦇 Nattliga krafter saboterar dina affärer...',
    '🌫️ Ditt företag drabbades av mystiska problem...'
];

const MYSTERIOUS_SMEAR = [
    '👻 Mörka rykten sprids om dig från okänd källa...',
    '🌑 Någon i skuggorna svärtar ditt namn...',
    '🕸️ Hemliga krafter underminerar ditt rykte...',
    '🌫️ Osynliga fiender talar illa om dig...',
    '🔮 Dunkla whispers förstör ditt anseende...'
];

// ── Kolla om nuvarande spelare är Gargamel ──
export function isGargamelGod() {
    const p = currentPlayer();
    return p && p.charKey === 'gargamel';
}

// ── Visa den hemliga knappen i HUD (bara Gargamel) ──
export function showHeistButton() {
    // Ta bort eventuell gammal knapp
    const existing = document.getElementById('btn-heist');
    if (existing) existing.remove();

    if (!isGargamelGod()) return;

    const controls = document.querySelector('.hud-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.id = 'btn-heist';
    btn.className = 'hud-btn heist-btn';
    btn.textContent = '🌑';
    btn.title = ''; // Ingen tooltip — hemligt
    btn.addEventListener('click', openHeistMenu);
    // Sätt in före de andra knapparna, ser ut som dekoration
    controls.insertBefore(btn, controls.firstChild);

    // Kolla om det finns bevis att sopa
    updateEvidenceWarning();
}

// ── Uppdatera bevis-varning ──
function updateEvidenceWarning() {
    const p = currentPlayer();
    if (!isGargamelGod()) return;

    const btn = document.getElementById('btn-heist');
    if (!btn) return;

    const hasEvidence = p.pendingEvidence && p.pendingEvidence.length > 0;
    btn.classList.toggle('has-evidence', hasEvidence);
    if (hasEvidence) {
        btn.textContent = '🌑⚠️';
    } else {
        btn.textContent = '🌑';
    }
}

// ── Öppna heist-menyn ──
function openHeistMenu() {
    const p = currentPlayer();
    if (!isGargamelGod()) return;

    const overlay = document.getElementById('overlay-event');
    if (!overlay) return;

    // Kolla om det finns bevis att sopa först
    if (p.pendingEvidence && p.pendingEvidence.length > 0) {
        showEvidencePanel(overlay);
        return;
    }

    if (p.heistCooldown > 0) {
        showToast(`🌑 Mörka krafter laddas... ${p.heistCooldown} rundor kvar`);
        return;
    }

    if (p.inJail) {
        showToast('🔒 Du sitter i häktet!');
        return;
    }

    // Hämta möjliga mål
    const targets = gameState.players
        .map((pl, idx) => ({ ...pl, idx }))
        .filter(pl => pl.charKey !== 'gargamel');

    if (targets.length === 0) {
        showToast('🌑 Inga mål tillgängliga...');
        return;
    }

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="overlay-box heist-menu">
        <div class="heist-title">🌑 Mörk Magi</div>
        <p class="heist-sub">Välj ditt offer och typ av attack</p>

        <div class="heist-targets">
            ${targets.map(t => `
                <div class="heist-target ${gameState.heistSelectedTarget === t.idx ? 'selected' : ''}"
                     onclick="window.game.selectHeistTarget(${t.idx})"
                     style="--tc:${t.char.color}">
                    <span class="ht-icon">${t.char.icon}</span>
                    <span class="ht-name">${t.char.name}</span>
                    <span class="ht-money">💰 ${formatNum(t.money)}</span>
                </div>
            `).join('')}
        </div>

        <div class="heist-types">
            <button class="heist-type-btn" onclick="window.game.doHeist('steal')" id="heist-steal">
                💰 <span>Stjäl pengar</span>
                <small>10-25% av deras cash</small>
            </button>
            <button class="heist-type-btn" onclick="window.game.doHeist('sabotage')" id="heist-sabotage">
                🏢 <span>Sabotera</span>
                <small>-50% inkomst i 1 runda</small>
            </button>
            <button class="heist-type-btn" onclick="window.game.doHeist('smear')" id="heist-smear">
                ⭐ <span>Smutskasta</span>
                <small>-3 till -6 rykte</small>
            </button>
        </div>

        <button class="btn-guest" onclick="document.getElementById('overlay-event').style.display='none'" style="margin-top:12px;">Stäng</button>
    </div>`;

    gameState.heistSelectedTarget = targets[0].idx;
    overlay.querySelector('.heist-target')?.classList.add('selected');
}

// ── Visa bevis-panel (sopa) ──
function showEvidencePanel(overlay) {
    const p = currentPlayer();
    overlay.style.display = 'flex';

    overlay.innerHTML = `<div class="overlay-box heist-menu">
        <div class="heist-title">⚠️ Bevis att sopa</div>
        <p class="heist-sub">Mörka spår leder tillbaka till dig... sopa undan innan det är för sent!</p>

        ${p.pendingEvidence.map((ev, i) => {
        const sweepCost = Math.floor(ev.value * 0.15);
        return `<div class="evidence-card">
                <div class="ev-info">
                    <span class="ev-type">${ev.type === 'steal' ? '💰' : ev.type === 'sabotage' ? '🏢' : '⭐'} ${ev.type === 'steal' ? 'Stöld' : ev.type === 'sabotage' ? 'Sabotage' : 'Ryktesspridning'}</span>
                    <span class="ev-target">mot ${CHARACTERS[ev.targetKey]?.name || 'Okänd'}</span>
                    <span class="ev-timer" style="color:${ev.roundsLeft <= 1 ? 'var(--danger)' : 'var(--gold)'}">⏰ ${ev.roundsLeft} rundor kvar</span>
                </div>
                <button class="btn-sweep" onclick="window.game.sweepEvidence(${i})"
                    ${p.money >= sweepCost ? '' : 'disabled'}>
                    🧹 Sopa — ${formatNum(sweepCost)} 💰
                </button>
            </div>`;
    }).join('')}

        <button class="btn-guest" onclick="document.getElementById('overlay-event').style.display='none'" style="margin-top:12px;">Stäng</button>
    </div>`;
}

// ── Välj heist-mål ──
export function selectHeistTarget(idx) {
    gameState.heistSelectedTarget = idx;
    document.querySelectorAll('.heist-target').forEach(el => el.classList.remove('selected'));
    const targets = document.querySelectorAll('.heist-target');
    targets.forEach(el => {
        if (el.getAttribute('onclick')?.includes(idx)) el.classList.add('selected');
    });
}

// ── Utför heist ──
export function doHeist(type) {
    const p = currentPlayer();
    if (!isGargamelGod() || p.heistCooldown > 0 || p.inJail) return;

    const targetIdx = gameState.heistSelectedTarget;
    if (targetIdx === undefined || targetIdx === null) { showToast('Välj ett mål!'); return; }

    const target = gameState.players[targetIdx];
    if (!target || target.charKey === 'gargamel') return;

    // Stäng overlay
    document.getElementById('overlay-event').style.display = 'none';

    // Lyckas-chans: 50% (40% bas + 10% steal ability)
    const successChance = 0.50;
    const success = Math.random() < successChance;

    if (!success) {
        // Misslyckad — 20% chans att hamna i häktet
        if (Math.random() < 0.20) {
            jailPlayer(p, 'Misstänkt för mörka affärer', 2);
            showToast('🚔 Gripen! Misstänkt för mörka affärer...');
            playSound('jail');
        } else {
            showToast('🌑 Mörkrets krafter misslyckades denna gång...');
        }
        p.heistCooldown = 3;
        updateHUD();
        showHeistButton();
        if (gameState.isOnline) syncState();
        return;
    }

    // LYCKAD HEIST
    let stolenValue = 0;
    let mysteriousMsg = '';

    switch (type) {
        case 'steal': {
            const pct = 0.10 + Math.random() * 0.15; // 10-25%
            stolenValue = Math.floor(target.money * pct);
            target.money -= stolenValue;
            sendEffect(target.charKey, { money: -stolenValue });
            p.money += stolenValue;
            p.totalEarned = (p.totalEarned || 0) + stolenValue;
            mysteriousMsg = MYSTERIOUS_STEAL[Math.floor(Math.random() * MYSTERIOUS_STEAL.length)];
            spawnParticles(['🌑', '💰', '🧙‍♂️'], 6);
            showToast(`🌑 Mörk magi! Stal ${formatNum(stolenValue)} 💰 från ${target.char.name}!`);
            break;
        }
        case 'sabotage': {
            target.sabotagedRounds = (target.sabotagedRounds || 0) + 1;
            sendEffect(target.charKey, { sabotagedRounds: 1 });
            stolenValue = Math.floor(target.money * 0.05); // for sweep cost calc
            mysteriousMsg = MYSTERIOUS_SABOTAGE[Math.floor(Math.random() * MYSTERIOUS_SABOTAGE.length)];
            spawnParticles(['🌑', '🏢', '💥'], 6);
            showToast(`🌑 ${target.char.name}s företag saboterat!`);
            break;
        }
        case 'smear': {
            const repLoss = 3 + Math.floor(Math.random() * 4); // 3-6
            target.rep = Math.max(0, target.rep - repLoss);
            sendEffect(target.charKey, { rep: -repLoss });
            stolenValue = repLoss * 200; // for sweep cost calc
            mysteriousMsg = MYSTERIOUS_SMEAR[Math.floor(Math.random() * MYSTERIOUS_SMEAR.length)];
            spawnParticles(['🌑', '⭐', '👻'], 6);
            showToast(`🌑 ${target.char.name} förlorade ${repLoss} rykte!`);
            break;
        }
    }

    p.successfulDeals = (p.successfulDeals || 0) + 1;
    p.heistCooldown = 3;

    // Spår-risk: 30%
    if (Math.random() < 0.30) {
        if (!p.pendingEvidence) p.pendingEvidence = [];
        p.pendingEvidence.push({
            type,
            targetKey: target.charKey,
            targetIdx,
            value: stolenValue,
            roundsLeft: 2,
            mysteriousMsg
        });
        showToast('⚠️ Du lämnade spår... sopa undan bevisen!');
    }

    updateHUD();
    showHeistButton();
    if (gameState.isOnline) syncState();
}

// ── Sopa bevis ──
export function sweepEvidence(evidenceIdx) {
    const p = currentPlayer();
    if (!p.pendingEvidence || !p.pendingEvidence[evidenceIdx]) return;

    const ev = p.pendingEvidence[evidenceIdx];
    const cost = Math.floor(ev.value * 0.15);

    if (p.money < cost) {
        showToast('💰 Inte tillräckligt med pengar för att sopa!');
        return;
    }

    p.money -= cost;
    p.totalSpent = (p.totalSpent || 0) + cost;
    p.pendingEvidence.splice(evidenceIdx, 1);

    showToast('🧹 Bevis sopade! Perfekt brott.');
    spawnParticles(['🧹', '✨', '🌑'], 6);

    updateHUD();
    // Uppdatera panel om den fortfarande är öppen
    const overlay = document.getElementById('overlay-event');
    if (overlay && overlay.style.display === 'flex') {
        if (p.pendingEvidence.length > 0) {
            showEvidencePanel(overlay);
        } else {
            overlay.style.display = 'none';
        }
    }
    showHeistButton();
    if (gameState.isOnline) syncState();
}

// ── Kolla bevis-timer (körs i endTurn) ──
export function checkEvidence() {
    gameState.players.forEach(player => {
        // Minska heist cooldown
        if (player.heistCooldown > 0) player.heistCooldown--;

        // Minska sabotage-rundor
        if (player.sabotagedRounds > 0) player.sabotagedRounds--;

        // Kolla Gargamels bevis
        if (player.charKey === 'gargamel' && player.pendingEvidence) {
            const expired = [];
            player.pendingEvidence.forEach((ev, i) => {
                ev.roundsLeft--;
                if (ev.roundsLeft <= 0) {
                    expired.push(i);
                    // Exponera! Men mystiskt — offret ser bara vagt meddelande
                    exposeEvidence(ev);
                }
            });
            // Ta bort expirerade bevis (bakifrån för att undvika indexfel)
            for (let i = expired.length - 1; i >= 0; i--) {
                player.pendingEvidence.splice(expired[i], 1);
            }
        }
    });
}

// ── Mystisk exponering (offret ser aldrig Gargamel) ──
function exposeEvidence(ev) {
    const target = gameState.players[ev.targetIdx];
    if (!target) return;

    // Offret ser BARA ett mystiskt meddelande
    showToast(ev.mysteriousMsg);

    // Liten extra bestraffning för Gargamel (böter)
    const gargamel = gameState.players.find(p => p.charKey === 'gargamel');
    if (gargamel) {
        const fine = Math.floor(ev.value * 0.10);
        gargamel.money = Math.max(0, gargamel.money - fine);
    }
}
