import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../../errors.js';

process.env.DATABASE_URL ||= 'postgres://postgres:postgres@localhost:5432/iseeebro';
process.env.SESSION_SECRET ||= 'unit-test-session-secret-with-more-than-thirty-two-characters';
process.env.GEMINI_API_KEY = 'mock-gemini-test-key';
const { evaluateWithGemini, validateEvaluation } = await import('./geminiAdapter.js');

const criteria = [
  { id: 'criterion-a', max_marks: 3 },
  { id: 'criterion-b', max_marks: 2.5 },
];

test('accepts complete criterion marks within rubric bounds', () => {
  assert.deepEqual(validateEvaluation({ criteria: [
    { criterionId: 'criterion-a', marks: 2, explanation: 'Clear support.' },
    { criterionId: 'criterion-b', marks: 2.5, explanation: 'Complete.' },
  ] }, criteria), [
    { criterionId: 'criterion-a', marks: 2, explanation: 'Clear support.' },
    { criterionId: 'criterion-b', marks: 2.5, explanation: 'Complete.' },
  ]);
});

test('rejects missing criteria, duplicate criteria, and marks above maximum', () => {
  assert.throws(() => validateEvaluation({ criteria: [] }, criteria), AppError);
  assert.throws(() => validateEvaluation({ criteria: [
    { criterionId: 'criterion-a', marks: 1 },
    { criterionId: 'criterion-a', marks: 1 },
  ] }, criteria), AppError);
  assert.throws(() => validateEvaluation({ criteria: [
    { criterionId: 'criterion-a', marks: 4 },
    { criterionId: 'criterion-b', marks: 1 },
  ] }, criteria), AppError);
});

test('builds a Gemini request and validates its response without making a network call', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ criteria: [
        { criterionId: 'criterion-a', marks: 2, explanation: 'A clear example.' },
        { criterionId: 'criterion-b', marks: 2, explanation: 'Mostly complete.' },
      ] }) }] } }] }),
    };
  };

  try {
    const result = await evaluateWithGemini({
      text: 'A small anonymized sample answer.',
      instructions: 'Answer both questions.',
      questionText: 'Question 1: Explain the cell wall.',
      criteria,
    });
    const payload = JSON.parse(capturedOptions.body);
    const prompt = payload.contents[0].parts[0].text;
    assert.match(capturedUrl, /models\/gemini-3\.8-flash:generateContent$/);
    assert.equal(capturedOptions.headers['x-goog-api-key'], 'mock-gemini-test-key');
    assert.equal(capturedUrl.includes('key='), false);
    assert.match(prompt, /A small anonymized sample answer/);
    assert.match(prompt, /Answer both questions/);
    assert.match(prompt, /Question 1: Explain the cell wall/);
    assert.match(prompt, /criterion-a/);
    assert.deepEqual(result.map((item) => item.marks), [2, 2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not classify a daily free-tier quota limit as a transient retry', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: 'Generate content free tier requests per day limit exceeded.' } }),
  });
  try {
    await assert.rejects(
      evaluateWithGemini({ text: 'Synthetic answer only.', criteria }),
      (error) => error.code === 'ai_quota_exceeded' && error.status === 429,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});