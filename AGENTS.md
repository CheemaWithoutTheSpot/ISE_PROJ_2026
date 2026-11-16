# AGENTS.md --- Project Instructions for AI Coding Agents

## 1. Project summary

This repository contains an AI-assisted, rubric-based assignment
evaluation system for teachers and students. Read
`docs/architecture.md`, `docs/ADRs.md` and `docs/PRD.md` before making
architectural or requirement-level changes.

## 2. Mandatory working rules

-   Follow the approved architecture and accepted ADRs.
-   Do not introduce microservices, Redis, RabbitMQ, a separate worker
    server, paid services or unnecessary frameworks without asking the
    team first.
-   Do not silently change requirements or approved decisions.
-   Do not invent client or TA approvals, test results, contributions or
    deployment facts.
-   If a requirement is ambiguous or conflicts with an ADR, stop and ask
    the team rather than guessing.
-   Prefer the simplest implementation that satisfies the documented
    requirements.
-   Do not add unrelated features.

## 3. Technology constraints

-   Frontend: React, React Router, Plain CSS, `useState`/`useContext`,
    Native Fetch.
-   Backend: Node.js and Express 5.
-   Database: PostgreSQL.
-   Persistence: Repository Pattern.
-   AI: provider-independent adapter, Gemini initial provider.
-   Sessions: server-side sessions with persistent PostgreSQL session
    storage.
-   File storage: private local filesystem outside the public directory.
-   API: REST; JSON except multipart file upload.
-   Do not add a state-management library or UI framework without
    approval.

## 4. Code organization

Backend:

``` text
backend/src/
  routes/
  controllers/
  services/
    ai/
  repositories/
  middleware/
  workers/
  config/
  app.js
backend/server.js
```

Frontend:

``` text
frontend/src/
  components/
  pages/
    teacher/
    student/
  services/api.js
  styles/
  App.jsx
  main.jsx
```

Keep responsibilities in the correct layer: - Routes map HTTP
endpoints. - Controllers handle HTTP request/response concerns. -
Services enforce business rules and coordinate workflows. - Repositories
handle database access. - Middleware handles cross-cutting request
checks. - Workers perform background processing. - Frontend components
must not implement trusted authorization or business rules.

## 5. Security requirements

-   Never trust a role, owner ID, student ID, mark, deadline or release
    state merely because the client sent it.
-   Enforce authentication centrally and resource ownership/membership
    in business logic.
-   A teacher may access only their own classrooms, assignments,
    templates and exports.
-   A student may access only classrooms they belong to and their own
    permitted submissions/results.
-   Store password hashes, never plaintext passwords.
-   Keep secrets in environment variables. Never commit `.env`, API
    keys, session secrets or real student data.
-   Use HTTP-only session cookies; Secure under HTTPS; SameSite=Lax for
    the intended same-site setup; regenerate after login and destroy on
    logout.
-   Apply CSRF protection for cookie-based authentication.
-   Keep uploads private and outside public/static directories.
-   Validate extension, MIME type, file signature and the 10 MB maximum.
-   Generate server-side random filenames; do not trust client filenames
    as storage paths.
-   Authorize every file download through the backend.
-   Use database foreign keys, unique, NOT NULL and CHECK constraints
    where applicable.

## 6. Domain rules that must not be broken

-   Users register as Teacher or Student; the backend determines the
    stored role.
-   Teachers can own multiple classrooms; each classroom has a unique
    joining code.
-   Regenerating a joining code invalidates the old code but keeps
    existing members.
-   Students may leave; teachers may remove students. Do not
    cascade-delete academic records.
-   Every assignment belongs to exactly one classroom.
-   Rubrics lock once submissions begin.
-   A template is copied into an assignment; later template
    edits/deletion must not change the copied rubric.
-   Accept only PDF, DOC and DOCX, up to 10 MB.
-   Reject late submissions.
-   Retain each accepted submission version.
-   Select only the latest valid version submitted by the deadline.
-   If the latest selected version is unreadable, flag it for manual
    grading; do not fall back to an older version.
-   A newer accepted version makes an older pending evaluation obsolete.
    Before saving, verify the version is still selected and the job is
    still valid.
-   No OCR initially. Scanned, empty or unreadable files require manual
    grading.
-   Do not send original uploaded files to Gemini; send locally
    extracted text and rubric data only.
-   Store AI suggestions/explanations separately from teacher final
    marks.
-   Missing submissions receive zero automatically.
-   All submitted students must be resolved before one final
    confirmation releases results; no partial release.
-   Students see final marks only, not AI suggestions or explanations.
-   Post-release edits update the current final result; do not add grade
    history.
-   CSV export is restricted to the owning teacher and released results.
-   Every accepted submission has a downloadable receipt.

## 7. Background worker rules

-   Workers run inside the same backend process.
-   Persist jobs in PostgreSQL.
-   Initial concurrency is two jobs and must remain configurable.
-   Maximum three attempts for temporary failures.
-   Use atomic job claiming and expiring leases.
-   Reclaim expired Processing jobs after crashes; do not reset all
    Processing jobs on startup.
-   Prevent duplicate active jobs and duplicate saved result records.
-   Permanent failures become `Needs Manual Grading`.
-   Do not claim exactly-once external AI execution. Prevent duplicate
    persistence and stale-result overwrites.

## 8. AI integration rules

-   Keep provider-specific code inside the AI adapter.
-   Validate parsed output and every criterion mark server-side.
-   Handle timeouts, provider errors, malformed responses and invalid
    marks.
-   Use mocked AI responses for most automated tests.
-   Use synthetic/anonymized data for prototype integration tests.
-   Never claim Gemini free tier meets performance or production privacy
    requirements without evidence.

## 9. API and error handling

-   Use resource-oriented REST endpoints and appropriate HTTP
    methods/status codes.
-   Use JSON for ordinary requests/responses and multipart/form-data for
    uploads.
-   Keep response and error formats consistent.
-   Use centralized error middleware.
-   Validate all inputs on the backend.
-   Do not expose stack traces, secrets, internal file paths or
    sensitive data to clients.

## 10. Frontend rules

-   Treat the backend as the source of truth.
-   Frontend route guards and hidden buttons are usability features, not
    security controls.
-   Use Native Fetch; check `response.ok`.
-   For file uploads, use FormData and let the browser set the multipart
    Content-Type boundary.
-   Keep API calls in the API service module where practical.
-   Do not duplicate business rules in React.

## 11. Testing expectations

Add or update tests for every changed behavior: - Unit tests for rubric
calculations, marks, deadlines, release rules and service
authorization. - Integration tests for APIs, PostgreSQL, sessions,
uploads, ownership and membership. - Worker tests for extraction, AI
failure, retries, recovery, stale versions and duplicate prevention. -
Performance test for 30 submissions within 30 minutes, ending in
Completed or Needs Manual Grading. - Mock Gemini for repeatable tests;
run separate smaller real-provider integration tests. - Never report a
test as passed unless it was actually run and passed.

## 12. Change workflow

Before editing: 1. Identify the relevant requirement and architecture
layer. 2. Read relevant ADR and existing code. 3. State the planned
change briefly. 4. Avoid broad rewrites.

After editing: 1. Run relevant tests and report exact results. 2.
Identify tests not run. 3. Note any migration/configuration steps. 4.
Update documentation when behavior or architecture changes. 5. If an
accepted ADR must change, propose a new ADR or amendment and obtain team
approval first.
