import { describe, it, expect } from 'vitest';
import { bundleName, BUILD } from '../src/utils/version.js';

describe('Version', () => {
    it('hittar spelets JS-fil i sidan', () => {
        expect(bundleName('<script type="module" crossorigin src="/empire-of-hustle/assets/index-BBO8C2rE.js"></script>')).toBe('index-BBO8C2rE.js');
        expect(bundleName('<html>ingen fil</html>')).toBe(null);
    });
    it('har en versionsstämpel', () => {
        expect(typeof BUILD).toBe('string');
        expect(BUILD.length).toBeGreaterThan(2);
    });
});
