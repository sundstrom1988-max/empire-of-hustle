import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { bundleName, BUILD } from '../src/utils/version.js';
import { CHARACTERS } from '../src/data/gameData.js';

describe('Version', () => {
    it('hittar spelets JS-fil i sidan', () => {
        expect(bundleName('<script type="module" crossorigin src="/empire-of-hustle/assets/index-BBO8C2rE.js"></script>')).toBe('index-BBO8C2rE.js');
        expect(bundleName('<html>ingen fil</html>')).toBe(null);
    });
    it('har en versionsstämpel', () => {
        expect(typeof BUILD).toBe('string');
        expect(BUILD.length).toBeGreaterThan(2);
    });
    // Den publicerade sidan begärde 1207.png (Dr. KimIT), som aldrig funnits: 404 vid varje start
    it('karaktärsbilderna som startsidan begär finns', () => {
        for (const ch of Object.values(CHARACTERS)) {
            if (ch.img) expect(existsSync(new URL('../public/' + ch.img, import.meta.url)), ch.img).toBe(true);
        }
    });
});
