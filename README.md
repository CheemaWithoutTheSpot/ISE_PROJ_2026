# Deliverable 3 Documentation Pack

**Project:** AI-Assisted Rubric-Based Assignment Evaluation System  
**Group:** SE-3B

## Files

1. `architecture.md` — system architecture, components, workflows, data model, security, testing and deployment.
2. `ADRs.md` — five accepted architectural decision records.
3. `AGENTS.md` — repository and coding-agent instructions.
4. `PRD.md` — consolidated requirements with traceability between the original client-validated baseline, TA feedback additions and group-designed classroom functionality.
5. `AI_VALIDATION.md` — AI-assisted architecture review record, refinement summary and remaining evidence requirements.
6. `CONTRIBUTION_LOG.md` — agreed responsibility allocation and shared group contributions.

## Review and completion notes

- The documents describe the group's agreed design. The repository now includes a runnable React/Express/PostgreSQL implementation and automated API/schema tests. It has not been deployed to production, and the 30-submission performance target and live Gemini provider behavior have not been independently verified.
- The contribution allocation should be confirmed by all three members. Add real Git commits, meeting notes or dates only where available and required.
- An architecture review was performed in the current ChatGPT conversation and recorded in `AI_VALIDATION.md`. This was not a separate fresh AI workspace. If the instructor explicitly requires a fresh independent workspace, the group must still run that separate exercise and attach genuine screenshots/exports.
- Compare the PRD traceability mapping with the original client-validated PRD and actual TA feedback notes before final submission.
- Review the instructor's exact submission instructions and ensure all required evidence is included.

## Running the application locally

Requirements: Node.js 22.13+ or 24+, Docker Desktop with Compose (or the optional embedded dev database), and a Gemini API key if automatic AI evaluation is required. AI evaluation remains isolated behind the adapter; without a key, submissions are routed to manual grading.

1. Copy `.env.example` to `.env`. Set a unique `SESSION_SECRET` of at least 32 characters and add `GEMINI_API_KEY` to enable Gemini evaluation. Use only synthetic or anonymized student documents unless external-provider privacy review has been completed.
2. Start PostgreSQL: `docker compose up -d`. Without Docker, `npm run db:embedded` runs a local PGlite compatibility database for development only; it is not a production database substitute.
3. Install dependencies and apply the schema: `npm install` then `npm run migrate`.
4. Start the API and frontend in separate terminals with `npm run dev:backend` and `npm run dev`.
5. Open the Vite URL, normally `http://localhost:5173`.

`npm run test` runs backend unit tests and `npm run build` builds the frontend. The backend serves the production frontend from `frontend/dist` when that build exists. Keep `.env` and `backend/private-uploads` out of source control.

Teachers can attach a text-based PDF question sheet while creating an assignment. Accepted student submissions are queued immediately; the worker evaluates the latest version using locally extracted question/answer text, instructions and rubric. Late submissions remain rejected, and newer versions obsolete older pending evaluations. Scanned PDFs still require manual grading because OCR is out of scope.

If a job exhausts its automatic retries and is flagged for manual grading, the owning teacher can use **Retry AI** after fixing provider configuration. The retry applies only to the latest version and is unavailable after final marks or result release.
