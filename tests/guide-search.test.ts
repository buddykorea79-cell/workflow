import assert from 'node:assert/strict';
import test from 'node:test';
import { filterGuideQuestions, questions } from '../src/lib/guide-topics';

test('help search finds answer text and combines terms regardless of whitespace', () => {
  const matches = filterGuideQuestions('  숫자   8자리  ');
  assert.ok(matches.some(question => question.title.includes('처음 접속')));
  assert.deepEqual(matches, filterGuideQuestions('숫자 8자리'));
  assert.deepEqual(filterGuideQuestions('ＡＩ'), filterGuideQuestions('ai'));
});

test('help topics and search narrow results together and clearing restores the list', () => {
  const allDelegation = filterGuideQuestions('', '인수인계·대행');
  const searched = filterGuideQuestions('기본 대행자', '인수인계·대행');
  assert.ok(allDelegation.length > searched.length);
  assert.ok(searched.some(question => question.title.includes('기본 대행자')));
  assert.ok(searched.every(question => question.category === '인수인계·대행'));
  assert.deepEqual(filterGuideQuestions('없는검색어xyz'), []);
  assert.deepEqual(filterGuideQuestions('  ', 'all'), questions);
});
