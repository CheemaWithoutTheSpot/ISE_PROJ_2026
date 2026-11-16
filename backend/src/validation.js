import { AppError } from './errors.js';

export function requiredText(value, label, max = 180) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    throw new AppError(400, `${label} is required and must be ${max} characters or fewer.`, 'invalid_input');
  }
  return value.trim();
}

export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254) throw new AppError(400, 'Enter a valid email address.', 'invalid_email');
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, 'Enter a valid email address.', 'invalid_email');
  return email;
}

export function validateCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length < 1 || criteria.length > 50) {
    throw new AppError(400, 'A rubric must contain between 1 and 50 criteria.', 'invalid_rubric');
  }
  return criteria.map((criterion, position) => {
    const maxMarks = Number(criterion.maxMarks);
    if (!Number.isFinite(maxMarks) || maxMarks < 0 || maxMarks > 100000) throw new AppError(400, 'Criterion marks must be non-negative numbers.', 'invalid_rubric');
    return {
      position,
      name: requiredText(criterion.name, 'Criterion name', 120),
      description: typeof criterion.description === 'string' ? criterion.description.trim().slice(0, 2000) : '',
      maxMarks,
    };
  });
}

export function parseDate(value, label = 'Deadline') {
  const date = new Date(value);
  if (!value || Number.isNaN(date.valueOf())) throw new AppError(400, `${label} must be a valid date.`, 'invalid_date');
  return date;
}