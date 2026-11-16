# System Architecture

## 1. Purpose and scope

The AI-Assisted Rubric-Based Assignment Evaluation System supports
classroom-based quizzes, lab tasks and short assignments. Teachers
create assignments and rubrics, students submit supported documents, the
system produces criterion-wise AI suggestions, and teachers review and
release final marks.

The system is initially developed and demonstrated locally. It is a
**layered monolith**: one backend application process and codebase
containing the API, business logic, data access and
background-processing subsystem. The frontend is maintained separately.

## 2. Architecture drivers

### Functional drivers

-   Role-based teacher and student accounts.
-   Teacher-owned classrooms with joining codes and student membership.
-   Classroom assignments, reusable rubric templates and teacher question sheets.
-   PDF, DOC and DOCX submissions, with accepted versions retained.
-   Latest valid pre-deadline submission selected for evaluation.
-   Criterion-wise AI suggestions and explanations.
-   Teacher review, editing and one final release confirmation.
-   Submission receipts and teacher CSV exports.

### Quality attributes

-   Security and ownership isolation.
-   Reliable background processing and recovery.
-   Data integrity and consistency.
-   Usability and understandable evaluation status.
-   Common page actions under five seconds, excluding AI evaluation and
    file upload.
-   Thirty submissions evaluated or explicitly flagged within thirty
    minutes, subject to verification.

## 3. Technology choices

  Area             Choice
  ---------------- ---------------------------------------------------
  Frontend         React, React Router, Plain CSS
  Frontend state   React `useState` / `useContext`
  Frontend HTTP    Native Fetch
  Backend          Node.js, Express 5
  Database         PostgreSQL
  Data access      Repository Pattern
  AI integration   Provider-independent AI Adapter; Gemini initially
  File storage     Private local filesystem with persistent storage
  API style        REST
  Authentication   Server-side sessions
  Development      Localhost

Vite may be used as the React development/build tool if adopted by the
implementation team. It is not a business-architecture dependency.

## 4. System context and component flow

``` text
Teacher / Student
       |
       v
React frontend (teacher and student pages)
       |
       | Native Fetch / REST
       v
Express backend
  |-- Authentication and authorization middleware
  |-- Routes
  |-- Controllers
  |-- Business services
  |     |-- Classroom and assignment services
  |     |-- Rubric and template services
  |     |-- Submission and result services
  |     |-- AI evaluation service / AI Adapter
  |     |-- Background job coordination
  |-- Repositories
  |-- In-process background workers
       |-- Private file retrieval
       |-- PDF/DOC/DOCX text extraction
       |-- AI Adapter invocation
       |-- Output validation and persistence
       |
       +------ PostgreSQL
       |
       +------ Private local file storage
       |
       +------ Gemini API (extracted text and rubric only)
```

The worker is part of the same backend process, not a separate
microservice. PostgreSQL stores job state so unfinished work can be
recovered after a restart.

## 5. Backend organization

``` text
backend/
  src/
    routes/
    controllers/
    services/
      ai/
    repositories/
    middleware/
    workers/
    config/
    app.js
  server.js
  package.json
```

-   `routes/`: maps HTTP methods and paths to controllers.
-   `controllers/`: parses requests, invokes services and creates HTTP
    responses.
-   `services/`: implements business rules and use cases.
-   `services/ai/`: provider adapter, AI output validation and failure
    handling.
-   `repositories/`: PostgreSQL queries and persistence operations.
-   `middleware/`: authentication, request validation and centralized
    error handling.
-   `workers/`: same-process background job polling/claiming and
    execution.
-   `config/`: database, session, AI and storage configuration.
-   `app.js`: configures Express and registers middleware/routes.
-   `server.js`: starts the backend process and worker subsystem.

## 6. Frontend organization

``` text
frontend/
  src/
    components/
    pages/
      teacher/
      student/
    services/
      api.js
    styles/
    App.jsx
    main.jsx
  public/
  package.json
```

The frontend presents role-specific screens and sends requests to the
backend. It is not trusted to enforce security or business rules. The
backend is authoritative for identity, role, ownership, membership,
deadlines, marks and release state.

## 7. Core modules and responsibilities

### 7.1 Authentication and authorization

Users select Teacher or Student during open self-registration. The
backend assigns and stores the role; it never trusts a role supplied by
the browser. Login creates a server-side session. Protected operations
pass through centralized authentication middleware and then
business-level ownership or membership checks.

### 7.2 Classroom management

A teacher can create and manage multiple classrooms. Each classroom has
a unique joining code. Students join using that code. Regenerating a
code invalidates the previous code but preserves existing members.
Students may leave and teachers may remove students. Removing membership
does not cascade-delete submissions or results.

### 7.3 Assignments and rubrics

Each assignment belongs to exactly one classroom. A teacher can create
assignments and define criteria with descriptions and maximum marks.
Criterion maximum marks must be non-negative; fractional values are
permitted. The total is calculated from criteria. Once submissions
begin, the assignment rubric is locked. Assignment details may be edited
after publication where allowed, but the locked rubric cannot be
changed.

Reusable rubric templates contain criterion names, descriptions and
maximum marks. Selecting a template copies its criteria into the new
assignment. Editing or deleting a template must not alter an
assignment's copied rubric.

Before submissions begin, a teacher may attach one text-based PDF question
sheet to an assignment. The original remains in private storage and its
text is extracted locally for evaluation.

### 7.4 Submission management

The system accepts PDF, DOC and DOCX files up to 10 MB. It validates
extension, MIME type and file signature, assigns a random
server-generated filename, and stores the file outside the public web
directory. The database stores file metadata and a storage reference,
not the file contents.

Every accepted version is retained as a separate submission record. Only
the latest valid version submitted on or before the deadline is selected
for evaluation. Late uploads are rejected. Each accepted version is
queued for evaluation immediately, without waiting for the deadline; a
newer accepted version obsoletes an older pending job. Before saving, the
worker verifies that the evaluated version is still selected. A receipt
is available for each accepted submission and contains assignment title,
filename, date/time and submission status.

If the file write succeeds but the database record fails, the
application attempts to remove the orphaned file. If cleanup also fails,
the error is logged for later cleanup.

### 7.5 Document extraction

Text extraction occurs locally in the background worker. The initial
version supports text-based PDFs and readable DOC/DOCX submissions and
text-based PDF question sheets. OCR is not included initially. Scanned
PDFs, empty documents and unreadable files are flagged for manual grading.
Neither the original student submission nor original question PDF is
sent to Gemini.

Candidate extraction libraries must be checked for current compatibility
and tested with representative files before implementation selection.

### 7.6 AI evaluation

The AI Evaluation Service calls a provider-independent AI Adapter. The
initial adapter communicates with Gemini. It receives extracted student
text, extracted question-sheet text when present, assignment instructions
and rubric data, not original uploaded files. The response is parsed and
validated server-side. Invalid structure, invalid marks, provider
failures and unreadable input are flagged for manual grading.

The provider adapter isolates provider-specific request/response
handling. The design does not promise automatic multi-provider failover.
API keys are held in environment variables. Use synthetic or anonymized
data for the prototype; real student submissions must not be sent to an
external free-tier provider without privacy review and authorization.

If an evaluation reaches Needs Manual Grading, the owning teacher may
explicitly retry AI after correcting provider configuration. The retry
resets only the latest selected submission's job, is rejected after final
marks or result release, and still falls back to manual grading if the
provider fails again.

### 7.7 Teacher review and final results

AI evaluation parent records and criterion-level AI suggestions are
stored separately from teacher-approved final results. Teachers can
inspect and edit criterion-level marks. A single final confirmation
releases results for the assignment only after all submitted students
have been resolved. Missing submissions are automatically assigned zero
and do not require manual review. There is no partial release.

Students see final marks only, not AI explanations or suggestions.
Post-release teacher edits update the existing final-result records;
grade-change history is not retained.

### 7.8 Export

An authorized teacher may download a CSV export of released results for
their own assignment. The export is read-only and includes assignment
title, student names and IDs, final marks, maximum marks and submission
statuses.

## 8. Data model

The following are logical entities; exact columns, keys and
normalization should be finalized during database implementation.

  -----------------------------------------------------------------------
  Entity                              Responsibility
  ----------------------------------- -----------------------------------
  Users                               Teacher/student accounts and roles

  Sessions                            Server-side sessions

  Classrooms                          Teacher-owned classrooms and
                                      joining codes

  ClassroomMemberships                Student-to-classroom membership

  Assignments                         Classroom assignment details,
                                      deadline and state

  RubricTemplates                     Reusable teacher-owned rubric
                                      templates

  RubricCriteria                      Criteria belonging to a template or
                                      assignment rubric

  Submissions                         Accepted versions, timestamps and
                                      private file metadata

  ProcessingJobs                      Background job status, attempts,
                                      lease and error information

  Evaluations                         Parent AI evaluation record for a
                                      selected submission

  EvaluationCriteria                  AI-suggested marks and explanations
                                      per criterion

  FinalResults                        Teacher-approved result parent
                                      record

  FinalResultCriteria                 Teacher's final marks per criterion
  -----------------------------------------------------------------------

Key relationships and integrity rules: - One teacher owns many
classrooms. - A classroom has many student memberships and
assignments. - An assignment belongs to one classroom. - An assignment
has one rubric definition composed of criteria. - A student may have
multiple accepted submission versions for an assignment. - An evaluation
refers to the selected submission version. - An evaluation has
criterion-level AI results. - A final result has criterion-level teacher
marks. - Processing jobs refer to the work they process. - Use foreign
keys, unique constraints, NOT NULL constraints and CHECK constraints
alongside backend validation. - Academic records must not be
cascade-deleted merely because a student leaves or is removed from a
classroom.

## 9. Submission version consistency

When a newer valid submission is accepted: 1. It becomes the selected
version for evaluation. 2. A pending job for an older version is marked
obsolete/cancelled where possible. 3. An already-running external AI
request may not be cancellable. 4. Before saving an AI result, the
backend verifies that the submission is still selected and the job is
still valid. 5. The validation and result persistence are protected by
an appropriate transaction or atomic database operation. 6. An obsolete
job cannot overwrite the current evaluation.

If the latest selected version is unreadable, it is flagged for manual
grading. The system does not silently fall back to an older readable
version.

## 10. Background job processing and recovery

Jobs are persisted in PostgreSQL with fields such as: - `job_id` -
`submission_id` - `status` - `attempt_count` - `locked_until` -
`last_error` - `created_at` - `completed_at`

Initial worker configuration: - Two concurrent jobs, configurable. - Up
to three attempts for temporary failures. - Permanent/unreadable
failures become `Needs Manual Grading`. - Workers atomically claim
jobs. - Expired processing leases can be reclaimed after a crash. -
Duplicate active jobs and duplicate saved evaluation records are
prevented. - Startup does not blindly reset every Processing job; only
expired claims are eligible for recovery.

Exactly-once external AI requests cannot be guaranteed if the provider
responds and the process crashes before persistence. The application
must nevertheless prevent duplicate saved results and stale results.

## 11. API conventions

The API is RESTful. Normal requests and responses use JSON. File uploads
use `multipart/form-data`. Use appropriate HTTP methods and status
codes, validate input on the backend, and return a consistent
success/error response shape. Centralized Express error middleware
handles unexpected errors.

Illustrative endpoints (final request/response schemas remain an
implementation task):

  ---------------------------------------------------------------------------------------------
  Method                  Endpoint                                      Purpose
  ----------------------- --------------------------------------------- -----------------------
  POST                    `/api/auth/register`                          Register

  POST                    `/api/auth/login`                             Login

  POST                    `/api/auth/logout`                            Logout

  POST                    `/api/classrooms`                             Create classroom

  POST                    `/api/classrooms/join`                        Join with code

  GET                     `/api/classrooms/:id`                         View classroom

  POST                    `/api/assignments`                            Create assignment

  GET                     `/api/assignments`                            List authorized
                                                                        assignments

  PATCH                   `/api/assignments/:id`                        Edit permitted
                                                                        assignment details

  POST                    `/api/assignments/:id/submissions`            Submit a file

  GET                     `/api/evaluations/:id`                        View authorized
                                                                        evaluation

  PATCH                   `/api/evaluations/:id/marks`                  Update teacher-reviewed
                                                                        marks

  POST                    `/api/assignments/:id/confirm-results`        Confirm and release
                                                                        results

  POST/GET                `/api/rubric-templates`                       Create/list templates

  GET/PATCH/DELETE        `/api/rubric-templates/:id`                   Read/update/delete
                                                                        template

  POST                    `/api/assignments/:id/rubric/from-template`   Copy template criteria

  GET                     `/api/submissions/:id/receipt`                Download receipt

  GET                     `/api/assignments/:id/results/export`         Export released CSV
  ---------------------------------------------------------------------------------------------

These are proposed route examples, not a finalized API contract.

## 12. Security controls

-   Hash passwords using an appropriate password-hashing library.
-   Use server-side sessions and regenerate the session after login.
-   Destroy sessions on logout.
-   Use HTTP-only cookies; enable Secure in HTTPS production; use
    SameSite=Lax for the intended same-site deployment.
-   Use a PostgreSQL-backed session store rather than the default
    in-memory store for persistent use.
-   Apply CSRF protection for cookie-based authentication.
-   Never trust role, ownership, marks, deadlines or release status
    supplied by the client.
-   Enforce teacher ownership and student membership in business logic.
-   Store uploads privately and serve them only through authenticated,
    authorized backend routes.
-   Validate upload extension, MIME type, file signature and size.
-   Keep secrets in environment variables and out of version control.

## 13. Testing strategy

### Unit tests

Test rubric calculations, mark validation, deadline rules, release
gating and authorization/business rules.

### Integration tests

Test Express APIs with PostgreSQL, sessions, uploads, ownership checks,
classroom membership and database constraints.

### Worker tests

Test document extraction, mocked AI success/failure, timeouts, retries,
crash recovery, stale-version rejection and duplicate prevention.

### Performance tests

Test 30 synthetic submissions and verify every job reaches `Completed`
or `Needs Manual Grading` within 30 minutes. Mock AI for most automated
tests. Run smaller real Gemini integration tests separately to measure
provider behavior. Mock tests do not prove real-provider performance.

Potential tools include Vitest, Supertest, a dedicated PostgreSQL test
database and k6; confirm tool versions and setup during implementation.

## 14. Deployment

Initial development and demonstration are local: - Local PostgreSQL. -
Persistent local file storage. - One backend process with in-process
workers. - Separate frontend/backend source folders. - React production
build served by Express if using a same-origin deployment. - Environment
variables such as `DATABASE_URL`, `SESSION_SECRET`, `GEMINI_API_KEY`,
`UPLOAD_DIR` and `PORT`. - `.env` excluded from Git.

Cloud provider and production hosting are not yet selected. A future
multi-instance deployment may require managed PostgreSQL, shared object
storage and a separately scaled job system; that is outside the initial
architecture.

## 15. Limitations and verification

The design does not guarantee that Gemini's free tier meets the
performance target. Two worker slots are an initial configuration, not a
measured capacity. OCR is excluded. Local file storage is not a
multi-server storage design. Security, recovery, performance and
integration claims require implementation tests before they can be
described as verified.
