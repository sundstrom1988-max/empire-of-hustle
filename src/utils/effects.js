import { SOUNDS } from '../data/gameData.js';
import { gameState } from '../game/state.js';

const audioCache = {};

export function playSound(key) {
    if (gameState.sfxMuted) return;
    if (!audioCache[key]) { audioCache[key] = new Audio(SOUNDS[key]); audioCache[key].volume = 0.4; }
    audioCache[key].currentTime = 0;
    audioCache[key].play().catch(() => { });
}

let bgAudio = null;
export function toggleMusic() {
    gameState.musicMuted = !gameState.musicMuted;
    const btn = document.getElementById('btn-music');
    if (btn) btn.textContent = gameState.musicMuted ? '🔇' : '🎵';
    if (gameState.musicMuted) { if (bgAudio) bgAudio.pause(); }
    else {
        if (!bgAudio) { bgAudio = new Audio(SOUNDS.bgMusic); bgAudio.loop = true; bgAudio.volume = 0.15; }
        bgAudio.play().catch(() => { });
    }
}

export function toggleSfx() {
    gameState.sfxMuted = !gameState.sfxMuted;
    const btn = document.getElementById('btn-sfx');
    if (btn) btn.textContent = gameState.sfxMuted ? '🔕' : '🔔';
}

export function startMusic() {
    if (!gameState.musicMuted && !bgAudio) {
        bgAudio = new Audio(SOUNDS.bgMusic); bgAudio.loop = true; bgAudio.volume = 0.15;
        bgAudio.play().catch(() => { });
    }
}

export function spawnParticles(emojis, count) {
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div'); p.className = 'particle';
        p.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        p.style.left = Math.random() * 100 + 'vw'; p.style.top = '-30px';
        p.style.fontSize = (16 + Math.random() * 24) + 'px';
        p.style.animationDuration = (2 + Math.random() * 3) + 's';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 5000);
    }
}

export function showToast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    c.appendChild(t); setTimeout(() => t.remove(), 3200);
}
