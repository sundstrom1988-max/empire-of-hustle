// ═══════════════════════════════════════════
//  Vilken version körs — och finns det en nyare ute?
//  GitHub Pages låter webbläsaren cacha sidan i 10 minuter,
//  så spelet kollar själv och erbjuder en omladdning.
// ═══════════════════════════════════════════

/* global __BUILD__ */
export const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';

// Filnamnet på spelets JS i en sida, t.ex. "index-BBO8C2rE.js"
export function bundleName(html) {
    const m = String(html || '').match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
    return m ? m[1] : null;
}

export function watchForUpdates(onNew, everyMs = 90000) {
    if (typeof document === 'undefined' || !import.meta.env?.PROD) return;
    const mine = bundleName([...document.scripts].map(s => s.src).join(' '));
    if (!mine) return;
    let told = false;
    const check = async () => {
        if (told) return;
        try {
            const res = await fetch(`${location.pathname}?v=${Date.now()}`, { cache: 'no-store' });
            const live = bundleName(await res.text());
            if (live && live !== mine) { told = true; onNew(); }
        } catch (e) { /* offline just nu — nästa koll */ }
    };
    setTimeout(check, 4000);
    setInterval(check, everyMs);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
