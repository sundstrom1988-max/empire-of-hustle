import { CHARACTERS, SHOPS, EVENTS, PITCH_SUCCESS, PITCH_FAIL, CARS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum, createPlayerState, saveGame } from '../game/state.js';
import { playSound, spawnParticles, showToast, startMusic } from '../utils/effects.js';
import { syncState } from '../multiplayer/sync.js';
import { checkEvidence, showHeistButton } from '../features/gargamel.js';

// ── HUD ──
export function updateHUD() {
    const p = currentPlayer();
    if (!p) return;
    const el = (id) => document.getElementById(id);
    if (el('hud-name')) el('hud-name').textContent = `${p.char.icon} ${p.char.name}`;
    if (el('hud-money')) el('hud-money').textContent = `💰 ${formatNum(p.money)}`;
    if (el('hud-rep')) el('hud-rep').textContent = `⭐ ${p.rep}`;
    if (el('hud-round')) el('hud-round').textContent = `📅 Runda ${gameState.round}`;
    if (el('hud-biz')) el('hud-biz').textContent = `🏢 ${p.owned.length}`;
    const container = el('hud-name');
    if (container) container.style.color = p.char.color;
}

// ── Tabs ──
export function switchTab(id, btn) {
    document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('panel-' + id);
    if (panel) panel.style.display = 'block';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// ── Empire ──
export function renderEmpire() {
    const p = currentPlayer();
    const el = document.getElementById('empire-list');
    if (!el) return;
    if (p.owned.length === 0) {
        el.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:40px 0;">Inga företag ännu! Gå till Butik och köp. 🛒</p>';
        return;
    }
    el.innerHTML = `<!-- Stash Section -->
        <div class="stash-section">
            <div class="stash-info">
                <span class="stash-icon">🏦</span>
                <div>
                    <div class="stash-label">Stash (gömda pengar)</div>
                    <div class="stash-amount">${formatNum(p.stash || 0)} 💰</div>
                </div>
            </div>
            <div class="stash-actions">
                <button class="btn-stash" onclick="window.game.showStashModal('deposit')" ${p.money > 0 ? '' : 'disabled'}>📥 Stasha</button>
                <button class="btn-stash withdraw" onclick="window.game.showStashModal('withdraw')" ${(p.stash || 0) > 0 ? '' : 'disabled'}>📤 Ta ut</button>
            </div>
        </div>
        <p style="font-size:10px;color:rgba(255,255,255,0.2);margin-bottom:16px;">⚠️ Polisen kan göra razzia — allt du INTE stashat försvinner!</p>
    ` + p.owned.map(id => {
        const biz = SHOPS.find(s => s.id === id);
        const lv = p.levels[id] || 1;
        const income = calcIncome(biz, lv, p);
        const upgCost = Math.floor(biz.price * lv * 0.6);
        const afford = p.money >= upgCost;
        const sellPrice = Math.floor(biz.price * 0.5 * lv);
        return `<div class="biz-card">
            <div class="biz-icon">${biz.icon}</div>
            <div class="biz-info"><h4>${biz.name}</h4><p>Lvl ${lv} · ${formatNum(income)} 💰/runda</p></div>
            <div class="biz-buttons">
                <button class="btn-upgrade" onclick="window.game.upgradeBiz('${id}')" ${afford ? '' : 'disabled'}>⬆️ ${formatNum(upgCost)}</button>
                <button class="btn-sell" onclick="window.game.sellBiz('${id}')">💸 Sälj ${formatNum(sellPrice)}</button>
            </div>
        </div>`;
    }).join('');
}

export function upgradeBiz(id) {
    const p = currentPlayer();
    const biz = SHOPS.find(s => s.id === id);
    const lv = p.levels[id] || 1;
    const cost = Math.floor(biz.price * lv * 0.6);
    if (p.money < cost) return;
    p.money -= cost; p.levels[id] = lv + 1;
    p.totalSpent = (p.totalSpent || 0) + cost;
    playSound('coin'); updateHUD(); renderEmpire();
    showToast(`⬆️ ${biz.name} → Lvl ${lv + 1}!`);
    if (gameState.isOnline) syncState();
}

// ── Sell Business ──
export function sellBiz(id) {
    const p = currentPlayer();
    const biz = SHOPS.find(s => s.id === id);
    if (!biz || !p.owned.includes(id)) return;
    const lv = p.levels[id] || 1;
    const sellPrice = Math.floor(biz.price * 0.5 * lv);

    // Confirm via overlay
    const overlay = document.getElementById('overlay-event');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="overlay-box">
        <div style="font-size:48px;margin-bottom:12px;">${biz.icon}</div>
        <h3 style="font-family:'Outfit';font-weight:900;">Sälj ${biz.name}?</h3>
        <p style="color:rgba(255,255,255,0.4);margin:8px 0;">Lvl ${lv} · Du får 50% tillbaka</p>
        <div style="font-size:24px;color:var(--gold);font-family:'Outfit';font-weight:900;margin:12px 0;">+${formatNum(sellPrice)} 💰</div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn-buy" onclick="window.game.confirmSellBiz('${id}')" style="background:var(--danger);">💸 Sälj!</button>
            <button class="btn-guest" onclick="document.getElementById('overlay-event').style.display='none'">Avbryt</button>
        </div>
    </div>`;
}

export function confirmSellBiz(id) {
    const p = currentPlayer();
    const biz = SHOPS.find(s => s.id === id);
    if (!biz || !p.owned.includes(id)) return;
    const lv = p.levels[id] || 1;
    const sellPrice = Math.floor(biz.price * 0.5 * lv);

    p.money += sellPrice;
    p.totalEarned = (p.totalEarned || 0) + sellPrice;
    p.owned = p.owned.filter(x => x !== id);
    delete p.levels[id];

    document.getElementById('overlay-event').style.display = 'none';
    playSound('coin');
    showToast(`💸 Sålde ${biz.name} för ${formatNum(sellPrice)} 💰!`);
    spawnParticles([biz.icon, '💸', '💰'], 8);
    updateHUD(); renderEmpire(); renderShop();
    if (gameState.isOnline) syncState();
}

// ── Stash System ──
export function showStashModal(mode) {
    const p = currentPlayer();
    const overlay = document.getElementById('overlay-event');
    if (!overlay) return;

    const max = mode === 'deposit' ? p.money : (p.stash || 0);
    const title = mode === 'deposit' ? '📥 Stasha pengar' : '📤 Ta ut pengar';
    const desc = mode === 'deposit'
        ? 'Göm pengar från polisen. Stashade pengar ger ingen inkomst men överlever razzior!'
        : 'Ta ut pengar från din stash till fickan.';

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="overlay-box">
        <div style="font-size:48px;margin-bottom:8px;">🏦</div>
        <h3 style="font-family:'Outfit';font-weight:900;">${title}</h3>
        <p style="color:rgba(255,255,255,0.4);font-size:12px;margin:8px 0;">${desc}</p>
        <div style="margin:16px 0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:12px;color:rgba(255,255,255,0.4);">💰 ${mode === 'deposit' ? 'Ficka' : 'Stash'}: ${formatNum(max)}</span>
            </div>
            <input type="range" id="stash-slider" min="0" max="${max}" value="${Math.floor(max / 2)}" style="width:100%;accent-color:var(--gold);" oninput="document.getElementById('stash-val').textContent=parseInt(this.value).toLocaleString('sv-SE')">
            <div style="font-size:24px;color:var(--gold);font-family:'Outfit';font-weight:900;margin-top:8px;"><span id="stash-val">${Math.floor(max / 2).toLocaleString('sv-SE')}</span> 💰</div>
        </div>
        <div style="display:flex;gap:10px;justify-content:center;">
            <button class="btn-buy" onclick="window.game.doStash('${mode}')">${mode === 'deposit' ? '📥 Stasha' : '📤 Ta ut'}</button>
            <button class="btn-guest" onclick="document.getElementById('overlay-event').style.display='none'">Avbryt</button>
        </div>
    </div>`;
}

export function doStash(mode) {
    const p = currentPlayer();
    const slider = document.getElementById('stash-slider');
    const amount = parseInt(slider?.value || 0);
    if (amount <= 0) return;

    if (mode === 'deposit') {
        if (amount > p.money) return;
        p.money -= amount;
        p.stash = (p.stash || 0) + amount;
        showToast(`📥 Stashade ${formatNum(amount)} 💰`);
    } else {
        if (amount > (p.stash || 0)) return;
        p.stash -= amount;
        p.money += amount;
        showToast(`📤 Tog ut ${formatNum(amount)} 💰 från stash`);
    }

    document.getElementById('overlay-event').style.display = 'none';
    playSound('coin');
    updateHUD(); renderEmpire();
    if (gameState.isOnline) syncState();
}

// ── Police Raid (Razzia) ──
export function policeRaid() {
    const p = currentPlayer();
    const lostMoney = p.money;
    const lostRep = Math.floor(p.rep * 0.5);
    const lostBiz = [...p.owned];
    const savedStash = p.stash || 0;

    // Wipe everything except stash
    p.money = 0;
    p.rep = Math.max(0, p.rep - lostRep);
    p.owned = [];
    p.levels = {};
    p.inJail = true;
    p.jailRoundsLeft = 3;
    p.jailReason = '🚨 RAZZIA — Polisen tog allt!';
    p.jailRecord.push({ deal: '🚨 RAZZIA', round: gameState.round });

    // Show dramatic overlay
    const overlay = document.getElementById('overlay-event');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.innerHTML = `<div class="overlay-box razzia-box">
            <div style="font-size:80px;margin-bottom:12px;">🚨</div>
            <h2 style="font-family:'Outfit';font-weight:900;font-size:28px;color:var(--danger);margin-bottom:8px;">RAZZIA!</h2>
            <p style="color:rgba(255,255,255,0.5);margin-bottom:16px;">Polisen slog till! Allt du inte stashat är borta...</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;text-align:left;margin-bottom:16px;">
                <div class="razzia-stat"><span style="color:var(--danger);">💰 Förlorade</span><strong>-${formatNum(lostMoney)}</strong></div>
                <div class="razzia-stat"><span style="color:var(--danger);">⭐ Rykte</span><strong>-${lostRep}</strong></div>
                <div class="razzia-stat"><span style="color:var(--danger);">🏢 Företag</span><strong>-${lostBiz.length} st</strong></div>
                <div class="razzia-stat"><span style="color:var(--mehmet);">🏦 Stash (säkrat)</span><strong>${formatNum(savedStash)}</strong></div>
            </div>
            ${savedStash > 0 ? '<p style="color:var(--mehmet);font-weight:700;">🏦 Din stash överlevde! Kloka drag.</p>' : '<p style="color:var(--danger);font-weight:700;">Du hade inget stashat... allt borta.</p>'}
            <button class="btn-guest" onclick="document.getElementById('overlay-event').style.display='none'" style="margin-top:16px;">😭 OK...</button>
        </div>`;
    }

    playSound('jail');
    spawnParticles(['🚨', '👮', '🚔', '💀'], 20);
    updateHUD(); renderEmpire(); renderShop();
    if (gameState.isOnline) syncState();
}

export function calcIncome(biz, level, player) {
    if (!biz) return 0;
    const p = player || currentPlayer();
    let base = biz.income * level;
    if (p.char?.ability === 'income_boost') base *= (1 + p.char.abilityVal);
    // Car bonus (including pimp upgrades)
    let carBonus = 0;
    if (p.cars) {
        p.cars.forEach(id => {
            const c = CARS.find(x => x.id === id);
            if (c?.boostType === 'income') {
                carBonus += c.val;
                // Add pimp bonuses
                if (p.carPimps && p.carPimps[id] && c.pimps) {
                    for (let i = 0; i < p.carPimps[id] && i < c.pimps.length; i++) {
                        carBonus += c.pimps[i].bonus;
                    }
                }
            }
        });
    }
    // Sabotage debuff (Gargamel heist)
    let sabotageMultiplier = 1;
    if (p.sabotagedRounds > 0) sabotageMultiplier = 0.5;
    return Math.floor(base * (1 + carBonus) * sabotageMultiplier);
}

// ── Shop ──
export function renderShop() {
    const p = currentPlayer();
    const el = document.getElementById('shop-grid');
    if (!el) return;
    el.innerHTML = SHOPS.map(s => {
        const owned = p.owned.includes(s.id);
        const afford = p.money >= s.price;
        return `<div class="shop-card ${owned ? 'owned' : ''}">
            <div class="shop-icon">${s.icon}</div><h4>${s.name}</h4><p style="font-size:12px;color:rgba(255,255,255,0.35);">${s.desc}</p>
            <div class="shop-price">${formatNum(s.price)} 💰</div>
            <div style="font-size:12px;color:var(--gold);">+${formatNum(s.income)}/runda</div>
            <button class="btn-buy" onclick="window.game.buyShop('${s.id}')" ${owned || !afford ? 'disabled' : ''}>
                ${owned ? '✅ Äger' : afford ? '🛒 KÖP' : '🔒 Inte råd'}</button>
        </div>`;
    }).join('');
}

export function buyShop(id) {
    const p = currentPlayer();
    const biz = SHOPS.find(s => s.id === id);
    if (p.money < biz.price || p.owned.includes(id)) return;
    p.money -= biz.price; p.owned.push(id); p.levels[id] = 1;
    playSound('coin'); updateHUD(); renderShop(); renderEmpire();
    showToast(`${biz.icon} Köpte ${biz.name}!`);
    spawnParticles([biz.icon, '💰', '🔥'], 12);
    if (gameState.isOnline) syncState();
}

// ── Pitch ──
export function doPitch() {
    const p = currentPlayer();
    if (p.pitchesThisRound >= gameState.maxPitchesPerRound) { showToast('Max pitchar denna runda!'); return; }
    p.pitchesThisRound++;
    let chance = 0.45;
    if (p.char?.ability === 'pitch_boost') chance += p.char.abilityVal;
    if (Math.random() < chance) {
        const r = PITCH_SUCCESS[Math.floor(Math.random() * PITCH_SUCCESS.length)];
        const win = Math.floor(500 + Math.random() * 2500 + p.owned.length * 200);
        p.money += win; p.rep += 2;
        document.getElementById('pitch-result').innerHTML =
            `<h3 style="color:${r.color}">${r.verdict}</h3><p>${r.text}</p><p style="color:var(--gold);">+${formatNum(win)} 💰 | +2 ⭐</p>`;
        playSound('win');
    } else {
        const r = PITCH_FAIL[Math.floor(Math.random() * PITCH_FAIL.length)];
        document.getElementById('pitch-result').innerHTML =
            `<h3 style="color:var(--danger)">${r.verdict}</h3><p>${r.text}</p>`;
        playSound('laugh');
    }
    updateHUD();
    if (gameState.isOnline) syncState();
}

// ── Dice / Events ──
export function rollDice() {
    const p = currentPlayer();
    if (p.rollsThisRound >= gameState.maxRollsPerRound) { showToast('Max tärningar denna runda!'); return; }
    p.rollsThisRound++;
    const roll = Math.floor(Math.random() * 6) + 1;
    const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    playSound('dice');

    // Razzia — special handling
    if (ev.type === 'razzia') {
        const el = document.getElementById('dice-result');
        if (el) el.innerHTML = `<div style="font-size:42px;margin-bottom:10px;">🎲 ${roll}</div><h4>${ev.title}</h4><p>${ev.desc}</p>`;
        policeRaid();
        return;
    }

    let amt = Math.floor(ev.minAmt + Math.random() * (ev.maxAmt - ev.minAmt));
    if (p.char?.ability === 'event_boost' && (ev.type === 'gain' || ev.type === 'rep')) amt = Math.floor(amt * (1 + p.char.abilityVal));
    if (p.char?.ability === 'save_money' && ev.type === 'loss') amt = Math.floor(amt * (1 - p.char.abilityVal));
    let desc = '';
    switch (ev.type) {
        case 'gain': p.money += amt; p.totalEarned = (p.totalEarned || 0) + amt; desc = `+${formatNum(amt)} 💰`; break;
        case 'loss': p.money = Math.max(0, p.money - amt); desc = `-${formatNum(amt)} 💰`; break;
        case 'rep': p.rep += amt; desc = `+${amt} ⭐`; break;
        case 'rep_loss': p.rep = Math.max(0, p.rep - amt); desc = `-${amt} ⭐`; break;
    }
    const el = document.getElementById('dice-result');
    if (el) el.innerHTML = `<div style="font-size:42px;margin-bottom:10px;">🎲 ${roll}</div><h4>${ev.title}</h4><p>${ev.desc}</p><p style="font-weight:800;">${desc}</p>`;
    updateHUD();
    if (gameState.isOnline) syncState();
}

// ── Turn System ──
export function endTurn() {
    const p = currentPlayer();
    // Collect income
    let totalIncome = 0;
    p.owned.forEach(id => {
        const biz = SHOPS.find(s => s.id === id);
        totalIncome += calcIncome(biz, p.levels[id] || 1, p);
    });
    p.money += totalIncome;
    p.totalEarned = (p.totalEarned || 0) + totalIncome;
    if (totalIncome > 0) showToast(`💰 Inkomst: +${formatNum(totalIncome)}`);
    // Track money history
    if (!p.moneyHistory) p.moneyHistory = [];
    p.moneyHistory.push(p.money);
    // Jail countdown
    if (p.inJail) {
        p.jailRoundsLeft--;
        if (p.jailRoundsLeft <= 0) { p.inJail = false; showToast(`🔓 ${p.char.name} är fri!`); }
    }
    // Reset round limits
    p.dealsThisRound = 0; p.rollsThisRound = 0; p.pitchesThisRound = 0;
    // Check evidence timers (Gargamel heist)
    checkEvidence();
    // Next player
    gameState.currentPlayerIdx = (gameState.currentPlayerIdx + 1) % gameState.players.length;
    if (gameState.currentPlayerIdx === 0) gameState.round++;
    // Check AI
    const next = currentPlayer();
    if (next.isAI) { setTimeout(() => doAITurn(), 1000); }
    // Check win
    if (p.money >= gameState.winAmount) { showWin(p); return; }
    updateHUD(); renderEmpire(); renderShop();
    // Refresh heist button visibility
    showHeistButton();
    saveGame();
    updateTurnBar();
    if (gameState.isOnline) syncState();
}

export function updateTurnBar() {
    const el = document.getElementById('turn-indicator');
    if (!el) return;
    const p = currentPlayer();
    el.style.display = 'block';
    el.innerHTML = `<span>${p.char.icon} ${p.char.name}s tur</span> · <span>Runda ${gameState.round}</span>`;
    el.style.borderColor = p.char.color;
}

function showWin(p) {
    playSound('win');
    spawnParticles([p.char.icon, '👑', '🏆', '💎', '🎉'], 30);
    const overlay = document.getElementById('overlay-event');
    if (overlay) {
        overlay.style.display = 'flex';
        overlay.innerHTML = `<div class="overlay-box" style="text-align:center;">
            <div style="font-size:80px;">${p.char.icon}</div>
            <h2 style="font-family:'Outfit';font-weight:900;font-size:30px;color:var(--gold);margin:16px 0;">👑 ${p.char.name} VINNER!</h2>
            <p style="font-size:18px;">Imperiet nådde ${formatNum(p.money)} 💰</p>
            <button class="btn-buy" onclick="location.reload()" style="margin-top:20px;">🔄 Spela igen</button>
        </div>`;
    }
}

// ── AI ──
function doAITurn() {
    const p = currentPlayer();
    showToast(`🤖 ${p.char.name} tänker...`);
    setTimeout(() => {
        // Buy cheapest affordable shop
        const canBuy = SHOPS.filter(s => !p.owned.includes(s.id) && p.money >= s.price).sort((a, b) => a.price - b.price);
        if (canBuy.length > 0 && Math.random() < 0.6) {
            const biz = canBuy[0]; p.money -= biz.price; p.owned.push(biz.id); p.levels[biz.id] = 1;
            showToast(`🤖 ${p.char.name} köpte ${biz.name}!`);
        }
        // Roll dice
        if (Math.random() < 0.7) {
            const ev = EVENTS[Math.floor(Math.random() * EVENTS.length)];
            const amt = Math.floor(ev.minAmt + Math.random() * (ev.maxAmt - ev.minAmt));
            if (ev.type === 'gain') p.money += amt; else if (ev.type === 'loss') p.money = Math.max(0, p.money - amt);
        }
        endTurn();
    }, 1500);
}
