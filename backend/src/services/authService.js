import bcrypt from 'bcryptjs';
import { query } from '../config/database.js';
import { AppError } from '../errors.js';
import { normalizeEmail, requiredText } from '../validation.js';

export async function register({ name, email, password }, role) {
  const fullName = requiredText(name, 'Name', 120);
  const normalizedEmail = normalizeEmail(email);
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw new AppError(400, 'Password must be between 10 and 200 characters.', 'invalid_password');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, role`,
    [fullName, normalizedEmail, passwordHash, role],
  );
  return toSessionUser(rows[0]);
}

export async function authenticate({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const { rows } = await query('SELECT id, full_name, email, password_hash, role FROM users WHERE email = $1', [normalizedEmail]);
  const user = rows[0];
  if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError(401, 'Email or password is incorrect.', 'invalid_credentials');
  }
  return toSessionUser(user);
}

function toSessionUser(user) {
  return { id: user.id, name: user.full_name, email: user.email, role: user.role };
}