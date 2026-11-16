# Architecture Decision Records (ADRs)

Project: AI-Assisted Rubric-Based Assignment Evaluation System\
Status: Decisions approved by the group unless a record explicitly says
otherwise.

------------------------------------------------------------------------

## ADR-001: Use a Layered Monolithic Architecture

**Status:** Accepted

### Context

The project is a student prototype with limited time, budget and
deployment complexity. It needs a web API, business rules, database
access and background AI evaluation. Separate microservices or a
distributed worker would add deployment and operational overhead.

### Decision

Use a layered monolith with: - Presentation layer (React frontend and
Express API boundary) - Business logic layer (services and in-process
background-processing subsystem) - Data access layer (repositories and
PostgreSQL)

The worker runs in the same backend process. Job state is stored in
PostgreSQL so work can be recovered after restarts.

### Consequences

**Positive** - Simpler development and local demonstration. - One
backend deployment and codebase. - Clear separation of
responsibilities. - No Redis, RabbitMQ or separate worker service
required initially.

**Negative** - API and worker share process resources. - Worker capacity
is limited by the single process. - Scaling API and background work
independently is not available initially.

### Reliability measures

Persist job state, atomically claim jobs, use expiring processing
leases, reclaim expired claims, limit retries and make result
persistence idempotent. Do not reset all Processing jobs on startup.
Exactly-once external AI calls are not guaranteed after a crash, but
duplicate saved results must be prevented.

------------------------------------------------------------------------

## ADR-002: Isolate AI Provider Integration with an AI Adapter

**Status:** Accepted

### Context

The application needs AI-generated criterion-level marks and
explanations. Binding business logic directly to one provider would make
provider changes difficult. The prototype also has a limited budget.

### Decision

Create a provider-independent AI Adapter interface. The initial
provider-specific implementation uses Gemini's free tier. The AI
Evaluation Service calls the adapter, then validates output before
persistence. No automatic multi-provider failover is included.

The worker extracts document text locally and sends only extracted text
plus rubric data to Gemini, not the original uploaded file.

### Consequences

**Positive** - Provider-specific details stay isolated. - Business logic
can be tested with mocked responses. - A provider can be replaced by
implementing another adapter.

**Negative** - Adapter and validation code add some initial structure. -
Gemini free-tier limits and response times may affect real processing. -
The adapter does not itself provide failover or guarantee provider
availability.

### Safeguards

-   API key stored in environment variables.
-   Timeouts and limited retries for temporary errors.
-   Server-side validation of response shape and marks.
-   Failures and unreadable documents flagged for manual grading.
-   Use synthetic/anonymized prototype data. Do not send real student
    work to a free-tier external service without privacy review and
    authorization.
-   Test mostly with mocked AI responses, then perform smaller
    real-provider integration tests.

------------------------------------------------------------------------

## ADR-003: Use Repository Pattern with PostgreSQL and Separate File Storage

**Status:** Accepted

### Context

The system stores structured academic records and uploaded student
documents. Mixing file contents with application records or placing
private uploads in a public folder would create maintainability and
security risks.

### Decision

Use PostgreSQL for structured data and the Repository Pattern for
persistence. Store uploaded files separately on a private local
filesystem with persistent storage. Store file metadata and storage
references in PostgreSQL.

### Consequences

**Positive** - Database operations are separated from business
services. - Structured data benefits from relational constraints and
transactions. - Files are not exposed as public static assets. - File
storage can later be replaced without redesigning all business logic.

**Negative** - Database and filesystem operations cannot share one
ordinary database transaction. - Orphan-file cleanup is needed when one
operation succeeds and the other fails. - Local storage is not suitable
for multiple application hosts without a shared-storage design.

### Safeguards

Validate extension, MIME type, file signature and 10 MB size limit.
Generate random filenames. Store files outside the public directory and
authorize every download. If the database write fails after a file
write, attempt cleanup; if cleanup fails, log the orphan for later
cleanup.

------------------------------------------------------------------------

## ADR-004: Centralize Authentication and Enforce Ownership in Business Logic

**Status:** Accepted

### Context

Teachers and students have different permissions. A logged-in user must
not access another teacher's classroom/assignment or another student's
submission/results. Hiding buttons in React is not a security boundary.

### Decision

Use centralized Express authentication middleware with server-side
sessions. Enforce role, teacher ownership and student classroom
membership in the business logic for each protected operation. The
backend assigns roles during registration and never trusts
client-provided role or ownership identifiers.

### Consequences

**Positive** - Common authentication checks are consistent. - Business
rules enforce resource-level authorization. - Sessions can be
invalidated server-side.

**Negative** - Every protected service/API operation needs appropriate
authorization checks. - Session storage and cookie security need
configuration.

### Safeguards

Hash passwords; regenerate sessions after login; destroy sessions on
logout; use HTTP-only cookies, Secure in HTTPS production and
SameSite=Lax for same-site deployment; use a PostgreSQL-backed session
store; apply CSRF protection for cookie-based authentication. Do not use
Express's in-memory session store for persistent deployment.

------------------------------------------------------------------------

## ADR-005: Use a Separate React Frontend with a Layered Express Backend

**Status:** Accepted

### Context

The project requires teacher and student interfaces while retaining a
backend responsible for data, authentication, AI evaluation and file
access. Keeping the frontend separate makes UI work easier to develop
independently.

### Decision

Use React, React Router, Plain CSS, React `useState`/`useContext` and
Native Fetch. Keep frontend and backend in separate folders. Use Node.js
and Express 5 for REST APIs. The backend remains the source of truth.

### Consequences

**Positive** - UI and backend can be developed in parallel. - Teacher
and student pages can be separated. - Standard HTTP APIs connect the two
applications. - No additional state-management framework is required
initially.

**Negative** - Frontend/backend API contracts must remain aligned. -
Authentication cookies, CORS or development proxy configuration must be
handled correctly.

### Implementation notes

Use multipart FormData for uploads and do not manually set the multipart
Content-Type header. Check `response.ok` when handling Fetch responses.
React state is temporary; persistent data and authorization remain on
the backend. A Vite development proxy may be used if selected. In a
same-origin production setup, Express can serve the built React
application.
