import { config } from '../../config/env.js';
import { AppError } from '../../errors.js';

export async function evaluateWithGemini({ text, questionText = '', instructions = '', criteria }) {
  if (!config.geminiApiKey) throw new AppError(503, 'AI evaluation is not configured. Manual grading is required.', 'ai_not_configured');
  const payload = {
    contents: [{ parts: [{ text: [
      'Evaluate this student work against the supplied rubric. Return only JSON, no markdown.',
      'Use exactly this shape: {"criteria":[{"criterionId":"...","marks":0,"explanation":"..."}]}.',
      'Include every criterion exactly once. Marks must be between zero and that criterion maximum.',
      'Explanations must be short, specific, and grounded only in the submitted text.',
      `ASSIGNMENT INSTRUCTIONS: ${instructions || '(none supplied)'}`,
      `TEACHER QUESTION SHEET (locally extracted from the uploaded PDF): ${questionText || '(none supplied)'}`,
      `RUBRIC: ${JSON.stringify(criteria)}`,
      `SUBMITTED TEXT:\n${text}`,
    ].join('\n\n') }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.geminiModel)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey }, body: JSON.stringify(payload), signal: controller.signal,
    });
  } catch (error) {
    const retryable = error.name === 'AbortError' || error instanceof TypeError;
    throw new AppError(retryable ? 503 : 502, 'The AI provider could not be reached.', retryable ? 'ai_temporary_failure' : 'ai_provider_error');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const providerMessage = errorBody?.error?.message || '';
    const dailyQuotaExhausted = response.status === 429 &&
      /per day|daily|free.?tier.*requests/i.test(providerMessage);
    if (dailyQuotaExhausted) {
      throw new AppError(429, 'Gemini daily request quota is exhausted. Check the AI plan/rate limits or retry after the quota resets.', 'ai_quota_exceeded');
    }
    const retryable = response.status === 429 || response.status >= 500;
    throw new AppError(retryable ? 503 : 502, `The AI provider returned status ${response.status}.`, retryable ? 'ai_temporary_failure' : 'ai_provider_error');
  }
  let body;
  try { body = await response.json(); } catch { throw new AppError(502, 'The AI provider response was not valid JSON.', 'ai_invalid_response'); }
  const raw = body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!raw) throw new AppError(502, 'The AI provider did not return an evaluation.', 'ai_invalid_response');
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch { throw new AppError(502, 'The AI provider returned malformed evaluation data.', 'ai_invalid_response'); }
  return validateEvaluation(parsed, criteria);
}

export function validateEvaluation(result, criteria) {
  if (!result || !Array.isArray(result.criteria) || result.criteria.length !== criteria.length) {
    throw new AppError(502, 'The AI evaluation did not match the rubric.', 'ai_invalid_response');
  }
  const expected = new Map(criteria.map((criterion) => [criterion.id, Number(criterion.max_marks)]));
  const seen = new Set();
  const validated = result.criteria.map((item) => {
    const marks = Number(item.marks);
    if (!expected.has(item.criterionId) || seen.has(item.criterionId) || !Number.isFinite(marks) || marks < 0 || marks > expected.get(item.criterionId)) {
      throw new AppError(502, 'The AI returned marks outside the rubric.', 'ai_invalid_marks');
    }
    seen.add(item.criterionId);
    return { criterionId: item.criterionId, marks, explanation: typeof item.explanation === 'string' ? item.explanation.slice(0, 2000) : '' };
  });
  if (seen.size !== expected.size) throw new AppError(502, 'The AI omitted a rubric criterion.', 'ai_invalid_response');
  return validated;
}