import test from 'node:test';
import assert from 'node:assert/strict';
import { slugOf, mainLinks, mayReplace } from '../scripts/update-links.mjs';
import guidelines, { normalise } from '../js/datasets/guidelines.js';

test('every URL form EMA uses for a guideline resolves to the same slug', () => {
  assert.equal(slugOf('/en/scientific-guidelines/investigation-bioequivalence'), 'investigation-bioequivalence');
  assert.equal(slugOf('https://www.ema.europa.eu/en/scientific-guidelines/investigation-bioequivalence#history'), 'investigation-bioequivalence');
  assert.equal(slugOf('https://www.ema.europa.eu/en/investigation-bioequivalence-scientific-guideline'), 'investigation-bioequivalence');
  assert.equal(slugOf('/investigation-bioequivalence-scientific-guideline'), 'investigation-bioequivalence');
});

test('documents, topic pages and other sites are not guideline links', () => {
  assert.equal(slugOf('/en/documents/scientific-guideline/guideline-investigation-bioequivalence-rev1_en.pdf'), null);
  assert.equal(slugOf('/en/human-regulatory-overview/research-development/scientific-guidelines/ich-guidelines'), null);
  assert.equal(slugOf('https://example.com/en/scientific-guidelines/investigation-bioequivalence'), null);
  assert.equal(slugOf('mailto:someone@example.com'), null);
});

test('only links inside <main> are read', () => {
  const html = '<nav><a href="/en/scientific-guidelines/menu">x</a></nav><main><p><a class="a" href="/en/scientific-guidelines/one">1</a> <a href="/two-scientific-guideline">2</a></p></main><footer><a href="/en/scientific-guidelines/foot">x</a></footer>';
  assert.deepEqual(mainLinks(html), ['/en/scientific-guidelines/one', '/two-scientific-guideline']);
  assert.deepEqual(mainLinks('<p>no main</p>'), []);
});

const row = (slug) => ({ title: slug, category: 'Human', first_published_date: '01/01/2020', url: `https://www.ema.europa.eu/en/scientific-guidelines/${slug}` });
const url = (slug) => row(slug).url;

test('links become outgoing references and backlinks', () => {
  const records = normalise([row('a'), row('b'), row('c')], {
    links: [
      { from: url('a'), to: [url('b'), url('c'), url('a'), url('missing')] },
      { from: url('b'), to: [url('c'), url('c')] },
    ],
  });
  const [a, b, c] = records;
  assert.deepEqual(a.out, [b.i, c.i]); // self-links and unknown targets are dropped
  assert.deepEqual(b.out, [c.i]); // duplicates collapse
  assert.deepEqual(c.back, [a.i, b.i]);
  assert.deepEqual(a.back, []);
  assert.ok(records.every((r) => r.linked));

  const card = guidelines.detail(c, { snapshotMs: Date.UTC(2026, 0, 1), records });
  assert.deepEqual(card.lists.map((l) => [l.label, l.items.map((r) => r.title).sort()]), [['Referenced by', ['a', 'b']], ['Refers to', []]]);
  assert.deepEqual(guidelines.links(b), { from: b.i, incoming: [a.i], outgoing: [c.i] });
  assert.equal(guidelines.row(c).meta[1], '2 backlinks');
  assert.ok(guidelines.sorts['back-desc'].fn(c, a) < 0, 'most referenced sorts first');
});

test('without the link map the card simply has no reference lists', () => {
  const records = normalise([row('a'), row('b')]);
  assert.ok(records.every((r) => !r.linked && r.back.length === 0));
  assert.deepEqual(guidelines.detail(records[0], { snapshotMs: Date.UTC(2026, 0, 1), records }).lists, []);
});

test('a run that read fewer pages never replaces a bigger map unless forced', () => {
  assert.equal(mayReplace({ pages_read: 407 }, 12), false);
  assert.equal(mayReplace({ pages_read: 407 }, 12, true), true);
  assert.equal(mayReplace({ pages_read: 407 }, 407), true);
  assert.equal(mayReplace({ pages_read: 407 }, 1001), true);
  assert.equal(mayReplace(null, 0), true); // no map yet
  assert.equal(mayReplace({}, 0), true);
});
