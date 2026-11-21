import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGuidelinePage, chooseDocument } from '../scripts/download-guidelines.mjs';

const card = ({ title, status, type = 'scientific-guideline', ref = 'EMA/1/2020', published, href }) => `
  <div data-ema-document-type="${type}" class="bcl-file">
    <p class="file-title mb-1 fw-bold" translate="no">${title}</p>
    <div class="file-metadata">${status ? `<small class="file-metadata-row w-100 d-flex text-muted" translate="no"><span class="value">${status}</span> </small>` : ''}
      <small class="file-metadata-row reference-numberfw-normal text-muted"><span class="label">Reference Number: </span><span class="value">${ref}</span></small></div>
    <div class="dates-metadata">First published: ${published}</div>
    <a href="${href}" class="btn">View</a>
  </div>`;
const section = (heading, cards) =>
  `<div class="item"><div class="paragraph paragraph--type--ema-documents"><div><h2 class="h2 documents-title">${heading}</h2></div>${cards.join('')}</div></div>`;
const page = (...sections) => `<html><body><main>
  <div class="item"><div class="paragraph paragraph--type--oe-rich-text"><div class="ecl-editor"><p>This guideline covers &amp; explains things.</p></div></div></div>
  ${sections.join('')}</main></body></html>`;

const adopted = { title: 'Guideline on X (Rev. 1)', status: 'Adopted', published: '01/02/2020', href: '/en/documents/scientific-guideline/x-rev1_en.pdf' };
const draft = { title: 'Draft guideline on X', status: 'Draft: consultation closed', published: '01/02/2019', href: '/en/documents/scientific-guideline/draft-x_en.pdf' };
const comments = { title: 'Overview of comments received on draft guideline on X', type: 'other', published: '05/03/2020', href: '/en/documents/other/comments-x_en.pdf' };
const old = { title: 'Note for guidance on X', status: 'Adopted', published: '01/01/2001', href: '/en/documents/scientific-guideline/x_en.pdf' };

test('parseGuidelinePage reads the summary, sections and document details', () => {
  const p = parseGuidelinePage(page(section('Current effective version', [card(adopted)]), section('Document history - First version', [card(draft), card(comments)])));
  assert.equal(p.summary, 'This guideline covers & explains things.');
  assert.deepEqual(p.sections.map((s) => s.heading), ['Current effective version', 'Document history - First version']);
  assert.deepEqual(p.sections[0].docs[0], {
    title: 'Guideline on X (Rev. 1)', type: 'scientific-guideline', status: 'Adopted', reference: 'EMA/1/2020',
    effective: null, published: '01/02/2020', href: 'https://www.ema.europa.eu/en/documents/scientific-guideline/x-rev1_en.pdf',
  });
  assert.equal(p.sections[1].docs[1].type, 'other');
});

test('chooseDocument prefers the current section, then the history marked current', () => {
  assert.equal(chooseDocument(parseGuidelinePage(page(section('Current version', [card(old), card(adopted)])))).doc.title, old.title);
  const h = chooseDocument(parseGuidelinePage(page(section('Document history - Revision 1 (current version)', [card(comments), card(draft), card(adopted)]))));
  assert.equal(h.doc.title, adopted.title);
  assert.equal(h.rule, 'history section marked current');
});

test('chooseDocument falls back to the newest adopted document, then the newest draft, never comments', () => {
  const a = chooseDocument(parseGuidelinePage(page(section('Document history', [card(comments), card(old), card(adopted), card(draft)]))));
  assert.equal(a.doc.title, adopted.title);
  const d = chooseDocument(parseGuidelinePage(page(section('Documents', [card(comments), card(draft)]))));
  assert.equal(d.doc.title, draft.title);
  assert.equal(chooseDocument(parseGuidelinePage(page())).doc, null);
});

test('chooseDocument takes the first adopted document in the leading section over a newer unmarked one', () => {
  const note = { title: 'Considerations regarding the implementation of X', published: '28/10/2026', href: '/en/documents/scientific-guideline/note_en.pdf' };
  const c = chooseDocument(parseGuidelinePage(page(section('Documents', [card(adopted), card({ ...comments, status: 'Adopted' }), card(note)]), section('Document history', [card(draft)]))));
  assert.equal(c.doc.title, adopted.title);
  assert.equal(c.rule, 'first adopted document listed');
  const unmarked = chooseDocument(parseGuidelinePage(page(section('Documents', [card(note), card(draft)]))));
  assert.equal(unmarked.doc.title, note.title);
});
