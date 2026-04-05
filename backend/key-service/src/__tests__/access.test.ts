import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureHeaderToken, resolveHeaderToken } from '../lib/access.js';

test('resolveHeaderToken handles strings, arrays, and empty values', () => {
  assert.equal(resolveHeaderToken(undefined), null);
  assert.equal(resolveHeaderToken('   '), null);
  assert.equal(resolveHeaderToken(' token-1 '), 'token-1');
  assert.equal(resolveHeaderToken(['', '  token-2  ']), 'token-2');
  assert.equal(resolveHeaderToken(['', ' ']), null);
});

test('ensureHeaderToken accepts valid token and rejects invalid inputs', () => {
  assert.doesNotThrow(() => {
    ensureHeaderToken('expected-token', 'expected-token', 'service token');
  });

  assert.doesNotThrow(() => {
    ensureHeaderToken(['', ' expected-token '], 'expected-token', 'admin token');
  });

  assert.throws(
    () => ensureHeaderToken(undefined, 'expected-token', 'service token'),
    /Missing or invalid service token/
  );

  assert.throws(
    () => ensureHeaderToken('wrong-token', 'expected-token', 'admin token'),
    /Missing or invalid admin token/
  );
});