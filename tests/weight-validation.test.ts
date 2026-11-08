import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWeights } from '../src/lib/unit-evaluation';

const units = [{ id: 'one' }, { id: 'two' }];

test('out-of-range scores show both reasons and never cancel each other in the total', () => {
  assert.deepEqual(validateWeights(units, { one: '60', two: '-10' }), {
    fieldErrors: { one: '50점 이하여야 합니다.', two: '0점 이상이어야 합니다.' },
    total: 0, validTotal: false, canSave: false,
  });
});

test('valid allocations require exactly 50 points and sum decimal hundredths without float drift', () => {
  assert.deepEqual(validateWeights(units, { one: '25', two: '25' }), { fieldErrors: {}, total: 50, validTotal: true, canSave: true });
  const decimalUnits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(validateWeights(decimalUnits, { a: '0.1', b: '0.2', c: '49.7' }), { fieldErrors: {}, total: 50, validTotal: true, canSave: true });
  for (const [values, total] of [[{ one: '20', two: '20' }, 40], [{ one: '30', two: '30' }, 60]] as const) {
    assert.deepEqual(validateWeights(units, values), { fieldErrors: {}, total, validTotal: false, canSave: false });
  }
});

test('blank and missing values remain errors even when the valid subtotal is 50', () => {
  for (const blank of ['', '   ', null, undefined]) {
    assert.deepEqual(validateWeights(units, { one: blank, two: '50' }), {
      fieldErrors: { one: '점수를 입력해 주세요.' }, total: 50, validTotal: true, canSave: false,
    });
  }
});

test('non-numbers and incomplete typing get numeric errors without changing the draft', () => {
  for (const raw of ['-', '+', 'e', '1e', '1e-', 'abc', 'NaN', 'Infinity', '0x10', NaN, Infinity]) {
    const values = { one: raw, two: '12.34' };
    const before = { ...values };
    assert.deepEqual(validateWeights(units, values), {
      fieldErrors: { one: '숫자로 입력해 주세요.' }, total: 12.34, validTotal: false, canSave: false,
    });
    assert.deepEqual(values, before);
  }
});

test('third decimal places are excluded, including tiny exponent values', () => {
  assert.deepEqual(validateWeights(units, { one: '25.555', two: '24.445' }), {
    fieldErrors: { one: '소수 둘째 자리까지 입력할 수 있습니다.', two: '소수 둘째 자리까지 입력할 수 있습니다.' },
    total: 0, validTotal: false, canSave: false,
  });
  for (const raw of ['0.001', '1e-3', '1e-9', '1e-18']) {
    assert.equal(validateWeights(units, { one: raw, two: 50 }).fieldErrors.one, '소수 둘째 자리까지 입력할 수 있습니다.');
  }
});

test('equivalent decimal and exponent spellings are allowed, while unrelated units are ignored', () => {
  for (const [one, two] of [['2.5e1', '25.000'], ['.01', '4.999e1'], ['0', '50'], [0, 50], ['-0', '50']]) {
    assert.deepEqual(validateWeights(units, { one, two, unrelated: 'invalid' }), { fieldErrors: {}, total: 50, validTotal: true, canSave: true });
  }
  assert.deepEqual(validateWeights([], { one: '50' }), { fieldErrors: {}, total: 0, validTotal: false, canSave: false });
});
