import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const migrationDir = new URL('./', import.meta.url);
const migrations = await Promise.all(
  (await readdir(fileURLToPath(migrationDir))).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => readFile(new URL(name, migrationDir), 'utf8')),
);

test('initial PostgreSQL migration creates domain schema and enforces integrity', async () => {
  const database = new PGlite();
  try {
    for (const migration of migrations) await database.exec(migration);
    const teacher = await database.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ('Teacher One', 'teacher@example.test', 'hash', 'teacher') RETURNING id",
    );
    const student = await database.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ('Student One', 'student@example.test', 'hash', 'student') RETURNING id",
    );
    const classroom = await database.query(
      "INSERT INTO classrooms (teacher_id, name, joining_code) VALUES ($1, 'Science', 'SCIENCE1') RETURNING id",
      [teacher.rows[0].id],
    );
    await database.query('INSERT INTO classroom_memberships (classroom_id, student_id) VALUES ($1, $2)', [classroom.rows[0].id, student.rows[0].id]);
    const assignment = await database.query(
      "INSERT INTO assignments (classroom_id, teacher_id, title, due_at) VALUES ($1, $2, 'Lab', now()) RETURNING id",
      [classroom.rows[0].id, teacher.rows[0].id],
    );
    await database.query(
      "INSERT INTO assignment_criteria (assignment_id, position, name, max_marks) VALUES ($1, 0, 'Evidence', 2.5)",
      [assignment.rows[0].id],
    );
    await assert.rejects(() => database.query(
      "INSERT INTO assignment_criteria (assignment_id, position, name, max_marks) VALUES ($1, 0, 'Duplicate', 1)",
      [assignment.rows[0].id],
    ));
    await assert.rejects(() => database.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ('Bad Role', 'bad@example.test', 'hash', 'admin')",
    ));
    const tableCount = await database.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
    assert.ok(tableCount.rows[0].count >= 12);
    const sourceDocumentTable = await database.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'assignment_source_documents'");
    assert.equal(sourceDocumentTable.rowCount, 1);
  } finally {
    await database.close();
  }
});