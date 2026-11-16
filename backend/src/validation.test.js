import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './errors.js';
import { normalizeEmail, parseDate, validateCriteria } from './validation.js';

test('normalizes email addresses before persistence', () => {
  assert.equal(normalizeEmail('  Teacher@Example.com '), 'teacher@example.com');
  assert.throws(() => normalizeEmail('not-an-email'), AppError);
});

test('accepts fractional non-negative rubric marks', () => {
  const criteria = validateCriteria([{ name: 'Evidence', description: 'Use examples', maxMarks: 2.5 }]);
  assert.deepEqual(criteria[0], { position: 0, name: 'Evidence', description: 'Use examples', maxMarks: 2.5 });
  assert.throws(() => validateCriteria([{ name: 'Evidence', maxMarks: -1 }]), AppError);
});

test('requires a valid deadline', () => {
  assert.equal(parseDate('2026-11-14T12:00:00Z').toISOString(), '2026-11-14T12:00:00.000Z');
  assert.throws(() => parseDate('not a date'), AppError);
});