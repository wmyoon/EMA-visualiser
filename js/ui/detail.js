/**
 * The card for the selected record. The dataset supplies the content as plain
 * data (`dataset.detail`); this component owns the layout, the navigation
 * through the current results, the link to EMA and the related records.
 */
import { isEmaUrl } from '../data.js';
import { touched } from '../store.js';
import { $, h, icon, tokenDot, nf } from './dom.js';

const ICONS = {
  close: 'M4 4l8 8M12 4l-8 8',
  prev: 'M10 3.5 5.5 8l4.5 4.5',
  next: 'M6 3.5 10.5 8 6 12.5',
  out: 'M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7.5 8.5',
  copy: 'M5.5 5.5v-2h7v7h-2M3.5 5.5h7v7h-7z',
};

export function mountDetail({ dataset, records, extent, snapshotMs, actions }) {
  const root = $('detail');
  const [y0, y1] = extent;
  const span = y1 + 1 - y0;
  let shown = null;
  let step = { prev: null, next: null };
  let textOpen = false;
  const expanded = new Set(); // ids of connection lists shown in full
  const SHORT = 6;
  root.setAttribute('aria-label', `Selected ${dataset.noun[0]}`);

  const subject = (s) =>
    h(
      'div',
      { class: 'detail__subject', title: s.hint },
      s.code ? h('span', { class: 'code', text: s.code }) : null,
      ...s.parts.map((text, i) => h('span', { class: i ? 'detail__part' : null, text })),
      s.note ? h('em', { text: s.note }) : null,
    );

  const stamps = (list, wide) =>
    h(
      'div',
      { class: wide ? 'stamps stamps--wide' : 'stamps' },
      ...list.map((s) =>
        h(
          'div',
          { class: 'stamp' },
          h('span', { class: 'stamp__key', text: s.key }),
          s.value ? h('span', { class: 'stamp__val', text: s.value }) : h('span', { class: 'stamp__val', dataset: { empty: 'true' }, text: s.empty }),
          s.note ? h('span', { class: 'stamp__note', text: s.note }) : null,
        ),
      ),
    );

  function lifeline(life) {
    const pct = (y) => `${Math.min(100, Math.max(0, ((y - y0) / span) * 100)).toFixed(2)}%`;
    const track = h('div', { class: 'life__track' });
    if (life.to != null) track.append(h('span', { class: 'life__span', style: { left: pct(life.from), width: `calc(${pct(life.to)} - ${pct(life.from)})` } }));
    track.append(h('span', { class: 'life__end', style: { left: pct(life.from) } }));
    if (life.to != null) track.append(h('span', { class: 'life__end life__end--rev', style: { left: pct(life.to) } }));
    return h(
      'div',
      { class: 'life', role: 'img', 'aria-label': `${life.label}, on a timeline from ${y0} to ${y1}.` },
      track,
      h('div', { class: 'life__axis' }, h('span', { text: String(y0) }), h('span', { text: String(y1) })),
      h('p', { class: 'life__label', text: life.label }),
    );
  }

  function longText(text) {
    const body = h('p', { class: 'detail__text', id: 'detail-text', dataset: { open: String(textOpen) }, text: text.body });
    const more = h('button', {
      class: 'link-btn', type: 'button', id: 'detail-text-more', 'aria-controls': 'detail-text', 'aria-expanded': String(textOpen),
      text: textOpen ? 'Show less' : 'Show all',
      onClick: () => {
        textOpen = !textOpen;
        body.dataset.open = String(textOpen);
        more.setAttribute('aria-expanded', String(textOpen));
        more.textContent = textOpen ? 'Show less' : 'Show all';
      },
    });
    return h('section', { class: 'detail__section' }, h('h3', { class: 'related__title', text: text.label }), body, text.body.length > 260 ? more : null);
  }

  /** A titled list of records, each one a button that opens it. Long lists start folded. */
  function recordList(list, go, rerender) {
    const open = expanded.has(list.id) || list.items.length <= SHORT + 1;
    const items = open ? list.items : list.items.slice(0, SHORT);
    return h(
      'section',
      { class: 'related', 'aria-labelledby': `list-${list.id}-title`, dataset: { tone: list.tone ?? '' } },
      h('h3', { class: 'related__title', id: `list-${list.id}-title` }, h('span', { class: 'related__key', 'aria-hidden': 'true' }), list.label, h('span', { class: 'related__n', text: nf.format(list.items.length) })),
      list.note ? h('p', { class: 'related__note', text: list.note }) : null,
      list.caveat ? h('p', { class: 'related__caveat', text: list.caveat }) : null,
      list.items.length
        ? h(
            'ul',
            { class: 'related__list' },
            ...items.map((s) => h('li', {}, h('button', { class: 'related__item', type: 'button', onClick: go(s) }, tokenDot(dataset.row(s).tokens), h('span', { text: s.title })))),
          )
        : h('p', { class: 'related__empty', text: list.empty ?? 'None.' }),
      list.items.length > SHORT + 1
        ? h('button', {
            class: 'link-btn', type: 'button', id: `list-${list.id}-more`, 'aria-expanded': String(open),
            text: open ? 'Show fewer' : `Show all ${nf.format(list.items.length)}`,
            onClick: () => {
              if (open) expanded.delete(list.id);
              else expanded.add(list.id);
              rerender();
            },
          })
        : null,
    );
  }

  function render(r, view) {
    const at = view.results.findIndex((x) => x.i === r.i);
    step = { prev: view.results[at - 1] ?? null, next: at >= 0 ? view.results[at + 1] ?? null : null };
    const d = dataset.detail(r, { snapshotMs, records });
    const safe = isEmaUrl(r.url);

    const label = h('span', { text: 'Copy link' });
    const copy = h(
      'button',
      {
        class: 'btn', type: 'button', id: 'detail-copy',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(r.url);
            label.textContent = 'Copied';
          } catch {
            label.textContent = 'Copy failed, use the EMA page';
          }
          setTimeout(() => (label.textContent = 'Copy link'), 1800);
        },
      },
      icon(ICONS.copy, { width: 1.4 }),
      label,
    );

    const related = dataset.related(records, r);
    const go = (target) => () => target && actions.select(target.i, { from: 'list' });

    root.replaceChildren(
      h(
        'div',
        { class: 'detail__bar' },
        h('span', { class: 'detail__pos', text: at >= 0 ? `${nf.format(at + 1)} of ${nf.format(view.results.length)}` : 'Outside the current filters' }),
        h('button', { class: 'icon-btn', type: 'button', id: 'detail-prev', 'aria-label': 'Previous result', title: 'Previous result (K)', disabled: !step.prev, onClick: go(step.prev) }, icon(ICONS.prev)),
        h('button', { class: 'icon-btn', type: 'button', id: 'detail-next', 'aria-label': 'Next result', title: 'Next result (J)', disabled: !step.next, onClick: go(step.next) }, icon(ICONS.next)),
        h('button', { class: 'icon-btn', type: 'button', id: 'detail-close', 'aria-label': 'Close', title: 'Close (Esc)', onClick: () => actions.select(null) }, icon(ICONS.close)),
      ),
      h(
        'div',
        { class: 'detail__body', id: 'detail-body', tabindex: '-1' },
        h('div', { class: 'detail__tags' }, ...d.tags.map((t) => h('span', { class: 'detail__tag' }, tokenDot(t.tokens), t.label))),
        h('div', { class: 'detail__head' }, h('h2', { class: 'detail__title', text: d.title }), d.subtitle ? h('p', { class: 'detail__subtitle', text: d.subtitle }) : null),
        subject(d.subject),
        d.flags?.length ? h('ul', { class: 'flags', 'aria-label': 'Type' }, ...d.flags.map((text) => h('li', { class: 'flag', text }))) : null,
        d.facts?.length
          ? h('dl', { class: 'facts' }, ...d.facts.flatMap(([key, value]) => [h('dt', { text: key }), h('dd', { text: value })]))
          : null,
        d.text ? longText(d.text) : null,
        stamps(d.stamps, d.stampsWide),
        lifeline(d.life),
        d.notice ? h('p', { class: 'detail__notice', text: d.notice }) : null,
        h(
          'div',
          { class: 'detail__actions' },
          safe
            ? h('a', { class: 'btn btn--primary', id: 'detail-open', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open on ema.europa.eu', icon(ICONS.out, { width: 1.5 }))
            : h('span', { class: 'stamp__note', text: 'This record has no valid EMA link.' }),
          safe ? copy : null,
        ),
        ...(d.lists ?? []).filter((l) => l.items.length || l.empty).map((l) =>
          recordList(l, go, () => {
            const top = $('detail-body').scrollTop;
            render(r, view);
            $('detail-body').scrollTop = top;
          }),
        ),
        related.items.length
          ? h(
              'section',
              { class: 'related', 'aria-labelledby': 'related-title' },
              h('h3', { class: 'related__title', id: 'related-title', text: related.label }),
              h(
                'ul',
                { class: 'related__list' },
                ...related.items.map((s) => {
                  const row = dataset.row(s);
                  return h(
                    'li',
                    {},
                    h(
                      'button',
                      { class: 'related__item', type: 'button', onClick: go(s) },
                      tokenDot(row.tokens),
                      h('span', {}, s.title, related.label === 'Same active substance' ? h('span', { class: 'related__meta', text: row.meta[0] }) : null),
                    ),
                  );
                }),
              ),
            )
          : null,
      ),
    );
  }

  return {
    step: (dir) => {
      const target = dir > 0 ? step.next : step.prev;
      if (target) actions.select(target.i, { from: 'list' });
    },
    update(state, view, changed) {
      if (changed && !touched(changed, 'selected', 'query', 'sel', 'years', 'sort', 'basis')) return;
      const r = state.selected == null ? null : records[state.selected];
      root.hidden = !r;
      $('app').dataset.detail = r ? 'open' : 'closed';
      if (!r) {
        shown = null;
        root.replaceChildren();
        return;
      }
      if (shown !== r.i) {
        textOpen = false;
        expanded.clear();
      }
      const scrollTop = shown === r.i ? $('detail-body')?.scrollTop ?? 0 : 0;
      render(r, view);
      $('detail-body').scrollTop = scrollTop;
      shown = r.i;
    },
  };
}
