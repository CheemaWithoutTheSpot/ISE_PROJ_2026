import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';

const migrationDir = new URL('./migrations/', import.meta.url);
const migrations = await Promise.all(
  (await readdir(fileURLToPath(migrationDir))).filter((name) => name.endsWith('.sql')).sort()
    .map((name) => readFile(new URL(name, migrationDir), 'utf8')),
);

function makeTextPdf(text) {
  const escapedText = text.replace(/[\\()]/g, '\\$&');
  const stream = `BT\n/F1 14 Tf\n72 720 Td\n(${escapedText}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('API enforces authenticated roles, CSRF, classroom membership, and assignment ownership', async () => {
  const database = new PGlite();
  for (const migration of migrations) await database.exec(migration);
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'iseeebro-upload-test-'));
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  const socketServer = new PGLiteSocketServer({ db: database, port, host: '127.0.0.1' });
  await socketServer.start();

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  process.env.SESSION_SECRET = 'integration-test-session-secret-with-more-than-thirty-two-characters';
  process.env.NODE_ENV = 'test';
  process.env.UPLOAD_DIR = uploadDir;
  const [{ default: app }, { pool }] = await Promise.all([
    import('./app.js'),
    import('./config/database.js'),
  ]);

  try {
    const teacher = request.agent(app);
    const teacherCsrfResponse = await teacher.get('/api/auth/csrf').expect(200);
    const teacherRegistration = await teacher.post('/api/auth/register/teacher')
      .set('x-csrf-token', teacherCsrfResponse.body.csrfToken)
      .send({ name: 'Teacher Example', email: 'teacher@example.test', password: 'a-long-test-password-2026' })
      .expect(201);
    assert.equal(teacherRegistration.body.user.role, 'teacher');

    const teacherCsrf = teacherRegistration.body.csrfToken;
    const classroomResponse = await teacher.post('/api/classrooms')
      .set('x-csrf-token', teacherCsrf)
      .send({ name: 'Biology 9', subject: 'Science', gradeLevel: 'Grade 9' })
      .expect(201);
    const classroom = classroomResponse.body.classroom;
    assert.match(classroom.joining_code, /^[A-F0-9]{8}$/);

    const student = request.agent(app);
    const studentCsrfResponse = await student.get('/api/auth/csrf').expect(200);
    const studentRegistration = await student.post('/api/auth/register/student')
      .set('x-csrf-token', studentCsrfResponse.body.csrfToken)
      .send({ name: 'Student Example', email: 'student@example.test', password: 'another-long-test-password' })
      .expect(201);
    assert.equal(studentRegistration.body.user.role, 'student');
    const studentCsrf = studentRegistration.body.csrfToken;

    await student.post('/api/classrooms/join')
      .set('x-csrf-token', studentCsrf)
      .send({ code: classroom.joining_code.toLowerCase() })
      .expect(201);

    const secondStudent = request.agent(app);
    const secondStudentCsrf = await secondStudent.get('/api/auth/csrf').expect(200);
    const secondRegistration = await secondStudent.post('/api/auth/register/student')
      .set('x-csrf-token', secondStudentCsrf.body.csrfToken)
      .send({ name: 'Student Two', email: 'student-two@example.test', password: 'second-long-test-password' })
      .expect(201);
    const secondCsrf = secondRegistration.body.csrfToken;
    await secondStudent.post('/api/classrooms/join')
      .set('x-csrf-token', secondCsrf)
      .send({ code: classroom.joining_code })
      .expect(201);

    const assignmentResponse = await teacher.post('/api/assignments')
      .set('x-csrf-token', teacherCsrf)
      .send({
        classroomId: classroom.id,
        title: 'Cell model report',
        instructions: 'Describe the model.',
        dueAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        criteria: [{ name: 'Evidence', description: 'Use examples.', maxMarks: 4.5 }],
      })
      .expect(201);
    const assignmentId = assignmentResponse.body.assignment.id;

    const questionText = 'Question 1: Explain how a plant cell wall supports the cell.';
    const questionPdf = makeTextPdf(questionText);
    await teacher.post(`/api/assignments/${assignmentId}/questions-document`)
      .set('x-csrf-token', teacherCsrf)
      .attach('file', questionPdf, { filename: 'cell-questions.pdf', contentType: 'application/pdf' })
      .expect(201);
    const sourceDocument = await pool.query('SELECT extracted_text FROM assignment_source_documents WHERE assignment_id = $1', [assignmentId]);
    assert.match(sourceDocument.rows[0].extracted_text, /Question 1: Explain how a plant cell wall supports the cell/);

    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    const firstUpload = await student.post(`/api/assignments/${assignmentId}/submissions`)
      .set('x-csrf-token', studentCsrf)
      .attach('file', pdf, { filename: 'answer.pdf', contentType: 'application/pdf' })
      .expect(201);
    assert.equal(firstUpload.body.submission.version, 1);
    const { queueDueSubmissions } = await import('./workers/evaluationWorker.js');
    await queueDueSubmissions();
    const queuedFirstVersion = await pool.query('SELECT status FROM processing_jobs WHERE submission_id = $1', [firstUpload.body.submission.id]);
    assert.equal(queuedFirstVersion.rows[0].status, 'pending');
    assert.match(firstUpload.body.receiptUrl, /\/receipt$/);
    const receipt = await student.get(firstUpload.body.receiptUrl).expect(200);
    assert.match(receipt.text, /Cell model report/);
    assert.match(receipt.text, /answer\.pdf/);
    await student.get(`/api/submissions/${firstUpload.body.submission.id}/file`).expect(200);
    await secondStudent.get(`/api/submissions/${firstUpload.body.submission.id}/receipt`).expect(404);

    const secondUpload = await student.post(`/api/assignments/${assignmentId}/submissions`)
      .set('x-csrf-token', studentCsrf)
      .attach('file', pdf, { filename: 'answer-final.pdf', contentType: 'application/pdf' })
      .expect(201);
    assert.equal(secondUpload.body.submission.version, 2);
    await queueDueSubmissions();
    const jobVersions = await pool.query(
      `SELECT s.version, j.status FROM processing_jobs j JOIN submissions s ON s.id = j.submission_id
       WHERE s.assignment_id = $1 AND s.student_id = $2 ORDER BY s.version`,
      [assignmentId, studentRegistration.body.user.id],
    );
    assert.deepEqual(jobVersions.rows.map((row) => row.status), ['obsolete', 'pending']);
    await pool.query("INSERT INTO evaluations (submission_id, status) VALUES ($1, 'manual')", [secondUpload.body.submission.id]);
    await pool.query("UPDATE processing_jobs SET status = 'manual', attempt_count = 3 WHERE submission_id = $1", [secondUpload.body.submission.id]);
    const retry = await teacher.post(`/api/assignments/${assignmentId}/reviews/${studentRegistration.body.user.id}/retry-ai`)
      .set('x-csrf-token', teacherCsrf)
      .send({})
      .expect(202);
    assert.equal(retry.body.status, 'pending');
    const retriedJob = await pool.query('SELECT status, attempt_count FROM processing_jobs WHERE submission_id = $1', [secondUpload.body.submission.id]);
    assert.equal(retriedJob.rows[0].status, 'pending');
    assert.equal(retriedJob.rows[0].attempt_count, 0);
    const clearedEvaluation = await pool.query('SELECT 1 FROM evaluations WHERE submission_id = $1', [secondUpload.body.submission.id]);
    assert.equal(clearedEvaluation.rowCount, 0);

    await student.post(`/api/assignments/${assignmentId}/submissions`)
      .set('x-csrf-token', studentCsrf)
      .attach('file', Buffer.from('not a PDF'), { filename: 'fake.pdf', contentType: 'application/pdf' })
      .expect(400);

    const studentAssignments = await student.get('/api/assignments').expect(200);
    assert.equal(studentAssignments.body.assignments.length, 1);
    assert.equal(studentAssignments.body.assignments[0].id, assignmentId);

    await student.get(`/api/assignments/${assignmentId}/reviews`).expect(403);
    await student.post('/api/classrooms')
      .set('x-csrf-token', studentCsrf)
      .send({ name: 'Not allowed' })
      .expect(403);

    const review = await teacher.get(`/api/assignments/${assignmentId}/reviews`).expect(200);
    const studentReview = review.body.reviews.find((item) => item.student_id === studentRegistration.body.user.id);
    assert.equal(studentReview.submission_id, secondUpload.body.submission.id);
    await teacher.patch(`/api/assignments/${assignmentId}/reviews/${studentRegistration.body.user.id}`)
      .set('x-csrf-token', teacherCsrf)
      .send({ criteria: [{ criterionId: assignmentResponse.body.assignment.criteria[0].id, marks: 4 }] })
      .expect(200);

    await pool.query("UPDATE assignments SET due_at = now() - interval '1 minute' WHERE id = $1", [assignmentId]);
    await teacher.post(`/api/assignments/${assignmentId}/confirm-results`)
      .set('x-csrf-token', teacherCsrf)
      .send({})
      .expect(200)
      .expect(({ body }) => assert.equal(body.state, 'released'));
    const releasedResults = await student.get('/api/me/results').expect(200);
    assert.equal(Number(releasedResults.body.results[0].total_marks), 4);
    const noSubmissionResults = await secondStudent.get('/api/me/results').expect(200);
    assert.equal(noSubmissionResults.body.results[0].submission_status, 'not_submitted');
    assert.equal(Number(noSubmissionResults.body.results[0].total_marks), 0);
    await teacher.get(`/api/assignments/${assignmentId}/results/export`).expect(200)
      .expect('content-type', /text\/csv/);

    const studentCsrfRefresh = await student.get('/api/auth/csrf').expect(200);
    await student.post('/api/classrooms/join')
      .set('x-csrf-token', 'not-the-token')
      .send({ code: classroom.joining_code })
      .expect(403);
    assert.ok(studentCsrfRefresh.body.csrfToken);

    await pool.query('SELECT 1');
  } finally {
    await pool.end();
    await socketServer.stop();
    await database.close();
    await rm(uploadDir, { recursive: true, force: true });
  }
});