import { CHARACTERS, SHOPS, EVENTS, PITCH_SUCCESS, PITCH_FAIL, CARS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum, createPlayerState, saveGame } from '../game/state.js';
import { playSound, spawnParticles, showToast, startMusic } from '../utils/effects.js';
import { syncState } from '../multiplayer/sync.js';

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
    el.innerHTML = p.owned.map(id => {
        const biz = SHOPS.find(s => s.id === id);
        const lv = p.levels[id] || 1;
        const income = calcIncome(biz, lv);
        const upgCost = Math.floor(biz.price * lv * 0.6);
        const afford = p.money >= upgCost;
        return `<div class="biz-card">
            <div class="biz-icon">${biz.icon}</div>
            <div class="biz-info"><h4>${biz.name}</h4><p>Lvl ${lv} · ${formatNum(income)} 💰/runda</p></div>
            <button class="btn-upgrade" onclick="window.game.upgradeBiz('${id}')" ${afford ? '' : 'disabled'}>⬆️ ${formatNum(upgCost)}</button>
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
    playSound('coin'); updateHUD(); renderEmpire();
    showToast(`⬆️ ${biz.name} → Lvl ${lv + 1}!`);
    if (gameState.isOnline) syncState();
}

export function calcIncome(biz, level) {
    if (!biz) return 0;
    const p = currentPlayer();
    let base = biz.income * level;
    if (p.char?.ability === 'income_boost') base *= (1 + p.char.abilityVal);
    // Car bonus
    let carBonus = 0;
    if (p.cars) {
        p.cars.forEach(id => { const c = CARS.find(x => x.id === id); if (c?.boostType === 'income') carBonus += c.val; });
    }
    return Math.floor(base * (1 + carBonus));
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
    let amt = Math.floor(ev.minAmt + Math.random() * (ev.maxAmt - ev.minAmt));
    if (p.char?.ability === 'event_boost' && (ev.type === 'gain' || ev.type === 'rep')) amt = Math.floor(amt * (1 + p.char.abilityVal));
    if (p.char?.ability === 'save_money' && ev.type === 'loss') amt = Math.floor(amt * (1 - p.char.abilityVal));
    let desc = '';
    switch (ev.type) {
        case 'gain': p.money += amt; desc = `+${formatNum(amt)} 💰`; break;
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
        totalIncome += calcIncome(biz, p.levels[id] || 1);
    });
    p.money += totalIncome;
    if (totalIncome > 0) showToast(`💰 Inkomst: +${formatNum(totalIncome)}`);
    // Jail countdown
    if (p.inJail) {
        p.jailRoundsLeft--;
        if (p.jailRoundsLeft <= 0) { p.inJail = false; showToast(`🔓 ${p.char.name} är fri!`); }
    }
    // Reset round limits
    p.dealsThisRound = 0; p.rollsThisRound = 0; p.pitchesThisRound = 0;
    // Next player
    gameState.currentPlayerIdx = (gameState.currentPlayerIdx + 1) % gameState.players.length;
    if (gameState.currentPlayerIdx === 0) gameState.round++;
    // Check AI
    const next = currentPlayer();
    if (next.isAI) { setTimeout(() => doAITurn(), 1000); }
    // Check win
    if (p.money >= gameState.winAmount) { showWin(p); return; }
    updateHUD(); renderEmpire(); renderShop();
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
