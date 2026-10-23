import { SLOT_SYMBOLS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum } from '../game/state.js';
import { playSound, spawnParticles, showToast } from '../utils/effects.js';
import { updateHUD } from '../game/core.js';
import { syncState } from '../multiplayer/sync.js';

function done() {
    updateHUD();
    if (gameState.isOnline) syncState();
}

export function initMinigames() {
    const el = document.getElementById('minigames-grid');
    if (!el) return;
    el.innerHTML = `
        <div class="mini-card" onclick="window.game.playDiceBattle()">
            <div style="font-size:36px;">🎲</div><h4>Tärningskrig</h4><p style="font-size:11px;color:rgba(255,255,255,0.3);">Insats: 500 💰</p></div>
        <div class="mini-card" onclick="window.game.playGuessNumber()">
            <div style="font-size:36px;">🔢</div><h4>Gissa Talet</h4><p style="font-size:11px;color:rgba(255,255,255,0.3);">Insats: 300 💰</p></div>
        <div class="mini-card" onclick="window.game.playSlotMachine()">
            <div style="font-size:36px;">🎰</div><h4>Slot Machine</h4><p style="font-size:11px;color:rgba(255,255,255,0.3);">Insats: 200 💰</p></div>
        <div class="mini-card" onclick="window.game.playCoinFlip()">
            <div style="font-size:36px;">🪙</div><h4>Singla Slant</h4><p style="font-size:11px;color:rgba(255,255,255,0.3);">Valfri insats</p></div>`;
}

export function playDiceBattle() {
    const p = currentPlayer();
    if (p.money < 500) { showToast('Inte råd! 500 💰 krävs'); return; }
    p.money -= 500; playSound('dice');
    const you = Math.floor(Math.random() * 6) + 1;
    const bot = Math.floor(Math.random() * 6) + 1;
    const result = document.getElementById('minigame-result');
    if (you > bot) {
        p.money += 1000; result.innerHTML = `<h4 style="color:#22c55e">🎲 Du: ${you} vs Bot: ${bot} — DU VANN! +1000 💰</h4>`;
        playSound('win'); spawnParticles(['🎲', '💰'], 8);
    } else if (you === bot) {
        p.money += 500; result.innerHTML = `<h4 style="color:var(--gold)">🎲 Du: ${you} vs Bot: ${bot} — OAVGJORT! Tillbaka insats</h4>`;
    } else {
        result.innerHTML = `<h4 style="color:var(--danger)">🎲 Du: ${you} vs Bot: ${bot} — FÖRLORADE! -500 💰</h4>`;
        playSound('laugh');
    }
    done();
}

// Knappar i spelet i stället för prompt(), som blockeras i appar och inbäddade sidor
const pickBtn = (label, call) => `<button class="mini-pick" onclick="${call}">${label}</button>`;

export function playGuessNumber(guessArg) {
    const p = currentPlayer();
    if (p.money < 300) { showToast('Inte råd! 300 💰 krävs'); return; }
    const result = document.getElementById('minigame-result');
    const guess = parseInt(guessArg);
    if (isNaN(guess) || guess < 1 || guess > 10) {
        result.innerHTML = `<h4 style="margin-bottom:10px;">🔢 Gissa ett tal mellan 1 och 10 (300 💰)</h4>
            <div class="mini-picks">${Array.from({ length: 10 }, (_, i) => pickBtn(i + 1, `window.game.playGuessNumber(${i + 1})`)).join('')}</div>`;
        return;
    }
    const secret = Math.floor(Math.random() * 10) + 1;
    p.money -= 300;
    if (guess === secret) {
        p.money += 1500; result.innerHTML = `<h4 style="color:#22c55e">🎯 ${secret} — RÄTT! +1500 💰</h4>`;
        playSound('win'); spawnParticles(['🎯', '💰'], 10);
    } else if (Math.abs(guess - secret) <= 2) {
        p.money += 450; result.innerHTML = `<h4 style="color:var(--gold)">🤏 Nära! Rätt svar: ${secret}. +150 💰 bonus</h4>`;
    } else {
        result.innerHTML = `<h4 style="color:var(--danger)">❌ Fel! Rätt svar: ${secret}. -300 💰</h4>`;
        playSound('laugh');
    }
    done();
}

export function playSlotMachine() {
    const p = currentPlayer();
    if (p.money < 200) { showToast('Inte råd! 200 💰 krävs'); return; }
    p.money -= 200;
    const s = [0, 1, 2].map(() => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
    const result = document.getElementById('minigame-result');
    result.innerHTML = `<div style="font-size:48px;letter-spacing:16px;margin-bottom:12px;">${s.join(' ')}</div>`;
    if (s[0] === s[1] && s[1] === s[2]) {
        const win = s[0] === '7️⃣' ? 5000 : 2000;
        p.money += win; result.innerHTML += `<h4 style="color:#22c55e">🎰 JACKPOT! +${formatNum(win)} 💰</h4>`;
        playSound('win'); spawnParticles(s, 15);
    } else if (s[0] === s[1] || s[1] === s[2] || s[0] === s[2]) {
        p.money += 400; result.innerHTML += `<h4 style="color:var(--gold)">✨ Par! +400 💰</h4>`;
        playSound('coin');
    } else {
        result.innerHTML += `<h4 style="color:var(--danger)">💨 Inget... -200 💰</h4>`;
    }
    done();
}

export function playCoinFlip(betArg) {
    const p = currentPlayer();
    const result = document.getElementById('minigame-result');
    const bet = parseInt(betArg);
    if (isNaN(bet)) {
        const opts = [100, 500, 1000, Math.floor(p.money / 2), p.money].filter((v, i, a) => v > 0 && v <= p.money && a.indexOf(v) === i);
        if (!opts.length) { showToast('Du har inga pengar att satsa!'); return; }
        result.innerHTML = `<h4 style="margin-bottom:10px;">🪙 Hur mycket vill du satsa? (Du har ${formatNum(p.money)} 💰)</h4>
            <div class="mini-picks">${opts.map(v => pickBtn(v === p.money ? `ALLT ${formatNum(v)}` : formatNum(v), `window.game.playCoinFlip(${v})`)).join('')}</div>`;
        return;
    }
    if (bet <= 0 || bet > p.money) { showToast('Ogiltig insats!'); return; }
    p.money -= bet;
    const heads = Math.random() < 0.5;
    if (heads) {
        p.money += bet * 2; result.innerHTML = `<div style="font-size:48px;">🪙</div><h4 style="color:#22c55e">KRONA! +${formatNum(bet)} 💰</h4>`;
        playSound('coin'); spawnParticles(['🪙', '💰'], 8);
    } else {
        result.innerHTML = `<div style="font-size:48px;">🪙</div><h4 style="color:var(--danger)">KLAVE! -${formatNum(bet)} 💰</h4>`;
        playSound('laugh');
    }
    done();
}
