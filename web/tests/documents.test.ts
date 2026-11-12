import test from 'node:test';
import assert from 'node:assert/strict';
import { documentInput, documentLink, documentScore } from '../src/domain/documents';

const payload = {
  title: 'หนังสือรับรองสุขภาพ (HC1)',
  category: 'แบบฟอร์มทั่วไป',
  description: 'แบบฟอร์มรับรองสุขภาพ',
  keywords: ['HC1', 'ใบสุขภาพ'],
  audience: 'all',
  url: 'https://www.allianz.co.th/content/dam/forms/HC1.pdf',
  label: 'ฉบับตรวจทาน',
  effectiveDate: '',
  note: 'เพิ่มเอกสาร',
};
test('document links allow only company PDFs and individual Drive files', () => {
  for (const url of [
    payload.url,
    'https://drive.google.com/file/d/example_123/view?usp=sharing&resourcekey=key',
    'https://drive.google.com/open?id=file-123',
  ])
    assert.ok(documentLink(url));
  for (const url of [
    'javascript:alert(1)',
    'http://drive.google.com/file/d/a/view',
    'https://drive.google.com.evil.test/file/d/a/view',
    'https://evil.test/?url=https://drive.google.com',
    'https://drive.google.com/drive/folders/a',
    'https://user:pass@drive.google.com/file/d/a/view',
    'https://www.allianz.co.th/redirect?url=https://evil.test',
    'https://drive.google.com:444/file/d/a/view',
    'https://drive.google.com/file/d/a/view/../../redirect',
  ])
    assert.equal(documentLink(url), null, url);
});
test('metadata validation and Thai/English alias search', () => {
  const data = documentInput.parse(payload);
  assert.equal(documentScore(data, 'hc1'), 100);
  assert.equal(documentScore(data, 'ใบสุขภาพ'), 100);
  assert.ok(documentScore(data, 'สุขภาพ HC1') > 0);
  assert.equal(documentScore(data, 'เคลม'), 0);
  assert.equal(documentInput.safeParse({ ...payload, audience: 'public' }).success, false);
  assert.equal(documentInput.safeParse({ ...payload, effectiveDate: '2026-02-30' }).success, false);
});
