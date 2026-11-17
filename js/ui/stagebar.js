/** Controls that float over the stage: arrangement, date basis, colour, tools, legend. */
import { touched } from '../store.js';
import { $, h, tokenDot } from './dom.js';

/** A radio group drawn as a segmented control, with arrow-key roving focus. */
function segmented(root, options, onPick, prefix) {
  const buttons = options.map((o) =>
    h('button', { class: 'seg__btn', type: 'button', role: 'radio', id: `${root.id}-${o.id}`, 'aria-checked': 'false', tabindex: '-1', text: o.label, title: o.title, onClick: () => onPick(o.id) }),
  );
  if (prefix) root.append(h('span', { class: 'seg__label', 'aria-hidden': 'true', text: prefix }));
  root.append(...buttons);
  root.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!dir) return;
    const at = buttons.indexOf(document.activeElement);
    const next = buttons[(at + dir + buttons.length) % buttons.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
  return (value) =>
    buttons.forEach((b, i) => {
      const on = options[i].id === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
}

export function mountStagebar({ store, dataset, actions, signal }) {
  const bases = Object.entries(dataset.bases).map(([id, b]) => ({ id, ...b }));
  const setLayout = segmented($('seg-layout'), dataset.layouts, (layout) => store.set({ layout }));
  const setBasis = segmented(
    $('seg-basis'),
    bases.map((b) => ({ id: b.id, label: b.label, title: `Place each ${dataset.noun[0]} by its date ${b.noun}` })),
    (basis) => store.set({ basis }),
  );
  const setColor = segmented($('seg-color'), dataset.colors, (colorBy) => store.set({ colorBy }), 'Colour');

  $('tool-in').addEventListener('click', () => actions.zoom(0.78));
  $('tool-out').addEventListener('click', () => actions.zoom(1.28));
  $('tool-reset').addEventListener('click', () => actions.resetView());

  const help = $('help');
  const helpBtn = $('tool-help');
  $('help-layouts').textContent = dataset.layouts.map((l) => l.label.toLowerCase()).join(', ');
  $('help-layout-keys').replaceChildren(...dataset.layouts.flatMap((_, i) => [h('kbd', { text: String(i + 1) }), ' ']));
  const setHelp = (open) => {
    help.hidden = !open;
    helpBtn.setAttribute('aria-expanded', String(open));
  };
  helpBtn.addEventListener('click', () => setHelp(help.hidden));
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!help.hidden && !help.contains(e.target) && !helpBtn.contains(e.target)) setHelp(false);
    },
    { signal },
  );

  const legend = $('legend');
  return {
    closeHelp: () => (help.hidden ? false : (setHelp(false), true)),
    update(state, _view, changed) {
      if (changed && !touched(changed, 'layout', 'basis', 'colorBy')) return;
      setLayout(state.layout);
      setBasis(state.basis);
      setColor(state.colorBy);
      const mode = dataset.colors.find((c) => c.id === state.colorBy);
      const layout = dataset.layouts.find((l) => l.id === state.layout);
      const basis = bases.find((b) => b.id === state.basis);
      legend.replaceChildren(
        h(
          'div',
          { class: 'legend__keys' },
          mode.legendTitle ? h('span', { class: 'legend__key', text: mode.legendTitle }) : null,
          ...mode.legend.map((k) => h('span', { class: 'legend__key', title: k.title }, tokenDot(k.tokens), k.label)),
        ),
        h('p', { class: 'legend__caption', text: `Each dot is one ${dataset.noun[0]}. ${layout.caption(basis)}` }),
      );
    },
  };
}
