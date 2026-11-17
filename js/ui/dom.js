/** Tiny DOM helpers. All text goes in through textContent, never innerHTML. */

/**
 * @param {string} tag
 * @param {Record<string, any>} [props] class, text, dataset, on<Event>, or any attribute
 * @param {...(Node|string|null|false|undefined)} children
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style') for (const [k, v] of Object.entries(value)) node.style.setProperty(k, v);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children) if (child != null && child !== false) node.append(child);
  return node;
}

export const $ = (id) => document.getElementById(id);

const NS = 'http://www.w3.org/2000/svg';
/** Inline icon from a path string, 16px grid. */
export function icon(d, { size = 16, width = 1.7 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', width);
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

/** A dot wearing one to three colour tokens (CSS custom-property names); a split disc when several. */
export function tokenDot(tokens, extraClass = '') {
  const node = h('span', { class: `dot ${extraClass}`.trim(), 'aria-hidden': 'true' });
  const step = 100 / tokens.length;
  node.style.background =
    tokens.length === 1
      ? `var(${tokens[0]})`
      : `conic-gradient(${tokens.map((t, i) => `var(${t}) ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
  return node;
}

/** Text with every occurrence of the query tokens wrapped in <mark>. */
export function highlight(text, tokens) {
  const frag = document.createDocumentFragment();
  if (!tokens.length) {
    frag.append(text);
    return frag;
  }
  const lower = text.toLowerCase();
  /** @type {[number,number][]} */
  const spans = [];
  for (const t of tokens) {
    for (let at = lower.indexOf(t); at !== -1; at = lower.indexOf(t, at + t.length)) spans.push([at, at + t.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  let pos = 0;
  for (const [a, b] of spans) {
    if (a < pos) continue;
    if (a > pos) frag.append(text.slice(pos, a));
    frag.append(h('mark', { text: text.slice(a, b) }));
    pos = b;
  }
  if (pos < text.length) frag.append(text.slice(pos));
  return frag;
}

export const nf = new Intl.NumberFormat('en-GB');
