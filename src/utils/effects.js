import { gameState } from '../game/state.js';
import { sfx, setSfxMuted, setMusicMuted, playStation, stopRadio, unlockAudio } from './audio.js';

export function playSound(key, vol = 1) {
    if (gameState.sfxMuted) return;
    sfx(key, vol);
}

// Menymusik = radiokanalen Hustle FM
export function toggleMusic() {
    unlockAudio();
    gameState.musicMuted = !gameState.musicMuted;
    setMusicMuted(gameState.musicMuted);
    const btn = document.getElementById('btn-music');
    if (btn) btn.textContent = gameState.musicMuted ? '🔇' : '🎵';
    if (gameState.musicMuted) stopRadio();
    else if (!window.city?.isOpen?.()) playStation(0);
}

export function toggleSfx() {
    unlockAudio();
    gameState.sfxMuted = !gameState.sfxMuted;
    setSfxMuted(gameState.sfxMuted);
    const btn = document.getElementById('btn-sfx');
    if (btn) btn.textContent = gameState.sfxMuted ? '🔕' : '🔔';
}

export function startMusic() {
    unlockAudio();
    setMusicMuted(gameState.musicMuted);
    setSfxMuted(gameState.sfxMuted);
    if (!gameState.musicMuted) playStation(0);
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

// Toasts ser ut som en GTA1-personsökare 📟
export function showToast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    c.appendChild(t);
    while (c.children.length > 4) c.firstChild.remove();
    setTimeout(() => t.remove(), 3400);
}
