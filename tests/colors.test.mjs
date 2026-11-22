import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The Confidence colouring: high is the full colour, medium the same colour at about half its
 * saturation (same hue and lightness, in OKLCH), and low is greyed out, a grey that stands out
 * less than either but stays visible. Checked in the light and the dark theme.
 */
const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
const blocks = {
  light: css.slice(css.indexOf(':root'), css.indexOf('@media (prefers-color-scheme: dark)')),
  dark: css.slice(css.indexOf('@media (prefers-color-scheme: dark)')),
};
const token = (block, name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  assert.ok(m, `--${name} is set`);
  return m[1];
};
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
const luminance = (hex) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const oklch = (hex) => {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180) / Math.PI };
};

for (const [theme, block] of Object.entries(blocks)) {
  test(`${theme} theme: medium is high desaturated, and low is greyed out`, () => {
    const surface = token(block, 'surface');
    const [high, medium, low] = ['conf-high', 'conf-medium', 'conf-low'].map((n) => token(block, n));
    const [H, M, Lo] = [high, medium, low].map(oklch);
    assert.ok(Math.abs(H.L - M.L) < 0.02, `same lightness: ${H.L.toFixed(3)} vs ${M.L.toFixed(3)}`);
    assert.ok(Math.abs(H.h - M.h) < 4, `same hue: ${H.h.toFixed(1)} vs ${M.h.toFixed(1)}`);
    assert.ok(M.C > H.C * 0.4 && M.C < H.C * 0.6, `about half the saturation: ${H.C.toFixed(3)} vs ${M.C.toFixed(3)}`);
    assert.ok(Lo.C < 0.01, 'low is grey');
    assert.ok(contrast(low, surface) < contrast(medium, surface) / 1.4, 'low stands out clearly less than medium');
    assert.ok(contrast(low, surface) >= 1.8, 'low is still visible against the surface');
  });
}
