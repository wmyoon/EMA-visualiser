import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/**
 * The Confidence colouring must read in order: a surer assessment stands out more. Salience is
 * measured as contrast against the stage surface (WCAG relative luminance) and as colourfulness
 * (OKLCH chroma); both must fall from high to medium to low, in the light and the dark theme.
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
const chroma = (hex) => {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return Math.hypot(A, B);
};

for (const [theme, block] of Object.entries(blocks)) {
  test(`${theme} theme: higher confidence stands out more`, () => {
    const surface = token(block, 'surface');
    const [high, medium, low] = ['conf-high', 'conf-medium', 'conf-low'].map((n) => token(block, n));
    const c = [high, medium, low].map((x) => contrast(x, surface));
    assert.ok(c[0] > c[1] * 1.25 && c[1] > c[2] * 1.15, `contrast falls clearly: ${c.map((x) => x.toFixed(2))}`);
    const k = [high, medium, low].map(chroma);
    assert.ok(k[0] > k[1] * 2 && k[1] > k[2], `colour fades towards grey: ${k.map((x) => x.toFixed(3))}`);
    assert.ok(k[2] < 0.01, 'low is grey');
    assert.ok(c[2] >= 1.8, 'low is still visible against the surface');
  });
}
