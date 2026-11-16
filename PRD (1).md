# Product Requirements Document (PRD)

## AI-Assisted Rubric-Based Assignment Evaluation System

**Group:** SE-3B\
**Members:** Muhammad Faiq Haider (25i-3073), Ahmed Shahbaz (25i-2089),
Cheema Murtaza (25i-3125)

## 1. Purpose

The system helps teachers evaluate quizzes, lab tasks and short
assignments using teacher-defined rubrics and AI-generated
criterion-level suggestions. Teachers remain responsible for reviewing,
editing and approving final marks.

## 2. Problem statement

Manual evaluation of student submissions takes substantial teacher time.
The system aims to reduce repetitive grading effort while keeping
teachers in control of final marks and results release.

## 3. Users and roles

### Teacher

Registers as a teacher, creates classrooms, manages students, creates
assignments and rubrics, reviews AI suggestions, enters manual marks
when needed, releases results and exports released marks.

### Student

Registers as a student, joins a classroom using its joining code,
submits supported assignment files, downloads submission receipts and
views released final marks.

Both roles can self-register. The backend assigns the role based on the
registration flow and enforces it server-side.

## 4. Scope

### In scope

-   Teacher and student registration/login.
-   Teacher-owned classrooms and student joining codes.
-   Classroom membership management.
-   Classroom assignments and rubrics.
-   Reusable rubric templates.
-   PDF, DOC and DOCX submissions up to 10 MB.
-   Submission version retention and latest valid pre-deadline
    selection.
-   Local document text extraction without OCR.
-   AI criterion-wise suggested marks and explanations.
-   Teacher review, edits, manual grading and final release.
-   Submission receipts.
-   CSV export of released results.

### Out of scope for initial version

-   OCR for scanned documents.
-   Student access to AI suggestions or explanations.
-   Grade-change history.
-   Partial result release.
-   Plagiarism detection, analytics and unrelated LMS features.
-   Automatic multi-provider AI failover.
-   Cloud provider selection and production multi-server deployment.

## 5. Functional requirements

### FR-01 Authentication and roles

The system shall allow users to register and log in as Teacher or
Student. The backend shall enforce the stored role and protected
operations.

### FR-02 Classroom management

Teachers shall be able to create and manage multiple classrooms. Each
classroom shall have a unique joining code. Students shall be able to
join using a valid code.

### FR-03 Classroom membership

Teachers shall be able to regenerate classroom codes and remove
students. Students shall be able to leave classrooms. Regenerating a
code shall invalidate the old code without removing existing members.
Removing/leaving shall not delete academic records.

### FR-04 Assignment management

Teachers shall be able to create assignments within classrooms and
manage permitted assignment details. A teacher may attach a PDF question
sheet to an assignment before submissions begin.

### FR-05 Rubric management

Teachers shall define rubric criteria with names, descriptions and
maximum marks. Negative maximum marks shall not be allowed; fractional
marks are allowed. The system shall calculate total marks automatically.

### FR-06 Rubric locking

Once submissions begin, the rubric shall be locked. Assignment details
may be edited where allowed, but the rubric shall not be changed after
locking.

### FR-07 Student submissions

Students shall submit PDF, DOC or DOCX files up to 10 MB before or at
the deadline. Unsupported formats and late submissions shall be
rejected.

### FR-08 Submission version handling

The system shall retain each accepted submission version and select the
latest valid version submitted by the deadline for evaluation.

### FR-09 Submission receipt

For every accepted submission, the system shall provide a downloadable
receipt containing assignment title, filename, date/time and submission
status.

### FR-10 Missing submissions

A student with no submission shall be marked Not submitted and receive
zero. Missing submissions shall not require AI evaluation.

### FR-11 Evaluation scheduling

After every accepted submission, the system shall promptly schedule
evaluation of the latest valid version without waiting for the deadline.
A newer accepted version shall obsolete any pending job for an older
version, and a result shall be saved only if its version is still the
latest selected version. At the deadline, new submissions shall be
rejected while already accepted work continues processing. If the
assignment has no valid submissions, it shall use a separate No
submissions state and skip AI evaluation and teacher confirmation.

### FR-12 AI evaluation

The system shall generate suggested marks and explanations for each
rubric criterion using locally extracted student text, the teacher's
question PDF text when supplied, assignment instructions and rubric
information. The original student and question files shall not be sent to
the AI provider.

### FR-13 AI failure handling

Failed, unreadable or invalid AI evaluations shall be flagged for
teacher attention and manual grading before release.

### FR-14 Evaluation dashboard

The teacher dashboard shall show evaluation status. Required statuses
are Not started, In progress, Ready for teacher review, Confirmed /
Results released, and Error / Needs attention. No submissions is a
separate empty state.

### FR-15 Teacher review

Teachers shall be able to review AI suggestions and criterion
explanations and edit suggested marks. AI explanations shall not be
shown to students.

### FR-16 Manual grading

Teachers shall be able to enter marks manually where AI evaluation fails
or cannot be used.

### FR-17 Final result confirmation

The teacher shall perform one final confirmation to release results for
an assignment. All submitted students must be resolved before release.
Missing submissions receive zero automatically and do not require
review. Partial release is not allowed. If marks change before release,
confirmation must be performed again.

### FR-18 Student results

Students shall see final marks only after release. Students shall not
see AI suggestions or explanations.

### FR-19 Post-release mark updates

Teachers shall be able to edit a released result. The latest mark shall
replace the existing mark; grade-change history is not retained.
Students shall see the latest mark.

### FR-20 Reusable rubric templates

Teachers shall be able to save reusable rubric templates containing
criterion names, descriptions and maximum marks. When creating an
assignment, a teacher may select a saved template. Its criteria shall be
copied into the assignment and may be modified before submissions begin.
Editing or deleting a template shall not change existing assignments or
locked rubrics.

### FR-21 CSV results export

Teachers shall be able to export released final results for their own
assignments as CSV. The export shall include assignment title, student
names and IDs, final marks, maximum marks and submission statuses. The
export is read-only and restricted to the authorized teacher.

## 6. Non-functional requirements

### NFR-01 Performance

Common page actions should complete within five seconds, excluding AI
evaluation and file upload.

### NFR-02 Evaluation throughput

Thirty accepted submissions should each reach a terminal state (AI
evaluation completed or explicitly flagged for manual grading) within
thirty minutes under documented test conditions. The 10 MB upload limit
is a separate file constraint. This is a target to verify through
performance testing, not a currently proven guarantee; actual performance
depends on the test environment, document sizes, extraction time and
AI-provider limits.

### NFR-03 Security

The system shall enforce role-based access, resource ownership and
classroom membership on the backend. Private files shall require
authenticated and authorized access.

### NFR-04 Reliability

Evaluation failures shall be visible and recoverable where appropriate.
The system shall avoid duplicate saved evaluation results and stale
results from obsolete submission versions. Failed/unreadable cases shall
be available for manual grading.

### NFR-05 Usability

Teacher and student workflows shall be understandable, with clear
submission and evaluation statuses and clear review/release controls.

## 7. Business rules

-   Each assignment belongs to exactly one classroom.
-   Only the classroom teacher may manage its assignments and rubric.
-   Only classroom members may access/submit to the classroom's
    assignments, subject to assignment rules.
-   Joining-code regeneration invalidates the previous code but keeps
    existing members.
-   Leaving/removing a student does not cascade-delete academic records.
-   Rubrics lock when submissions begin.
-   Templates are copied; template changes do not mutate assignment
    rubrics.
-   Latest valid pre-deadline submission is selected.
-   Late submissions are rejected.
-   If the latest selected submission is unreadable, flag it for manual
    grading; do not fall back to an older version.
-   Scanned PDFs are not OCR-processed in the initial version.
-   Original student files are not sent to Gemini.
-   AI suggestions and final teacher marks are stored separately.
-   All submitted students must be resolved before one final result
    release.
-   Missing submissions receive zero and do not need review.
-   Students see final marks only.
-   Post-release edits replace the current result; no history is
    retained.

## 8. File and AI constraints

Accepted file formats: PDF, DOC, DOCX. Maximum file size: 10 MB.
Validate extension, MIME type and file signature. Store files privately
with server-generated filenames.

Extract text locally. Send extracted text and rubric information to
Gemini through an AI Adapter. Keep the API key in an environment
variable. Use synthetic/anonymized data for prototype testing. Real
student data requires privacy review and authorization before use with
an external free-tier provider.

## 9. Acceptance criteria overview

-   A teacher can register, create a classroom and create an assignment
    with a rubric.
-   A student can register, join with a code and submit a supported
    file.
-   The system retains accepted versions and chooses the latest valid
    pre-deadline version.
-   A receipt can be downloaded for each accepted submission.
-   AI suggestions are criterion-wise and are stored separately from
    final teacher marks.
-   AI failure/unreadable input is flagged for manual grading.
-   A teacher can review all submitted students and release results once
    all are resolved.
-   Missing students receive zero.
-   Students cannot see results before release or AI explanations.
-   Authorized teachers can export released CSV results.
-   Reusable templates do not mutate already-created assignment rubrics.
-   Security and performance requirements are verified by tests.

## 10. Requirement provenance and validation status

**Client-validated baseline:** The original baseline contained 15
functional requirements (original FR-01 through FR-15) and five
non-functional requirements (NFR-01 through NFR-05), discussed and
validated with the client on 5 November 2026, as recorded by the group.
The current FR numbering was reorganized when later requirements and
classroom functionality were consolidated. Therefore, the current FR
numbers must not be mistaken for the original numbering.

| Original client requirement | Current PRD requirement(s) | Subject |
|---|---|---|
| Original FR-01 | FR-01 | Authentication and roles |
| Original FR-02 | FR-04 | Assignment management |
| Original FR-03 | FR-05 | Rubric management |
| Original FR-04 | FR-04, FR-06 | Assignment edits and rubric locking |
| Original FR-05 | FR-07 | Student submissions |
| Original FR-06 | FR-08 | Latest valid submission |
| Original FR-07 | FR-10 | Missing submissions receive zero |
| Original FR-08 | FR-11 | Automatic evaluation and no-submission handling |
| Original FR-09 | FR-12 | AI criterion-level suggestions |
| Original FR-10 | FR-13, FR-16 | AI failure handling and manual grading |
| Original FR-11 | FR-14 | Evaluation dashboard statuses |
| Original FR-12 | FR-15 | Teacher review |
| Original FR-13 | FR-16 | Manual grading |
| Original FR-14 | FR-17 | One final confirmation and release |
| Original FR-15 | FR-18, FR-19 | Student result visibility and post-release mark updates |

The client-validated NFR-01 through NFR-05 correspond to the five
non-functional requirements in Section 6. Their targets remain subject
to implementation and testing; validation of a requirement does not
mean the system has already met it.

**TA feedback after the Deliverable 2 demonstration:** The following
current requirements were added in response to TA feedback and are not
part of the original client-validated baseline unless separately
confirmed by the client:

- FR-09: downloadable receipt for every accepted submission.
- FR-20: reusable rubric templates.
- FR-21: CSV export of released final results.

**Group-designed product functionality:** FR-02 (classroom management)
and FR-03 (classroom membership) capture the group's agreed classroom
registration and joining-code design. The open self-registration flow
where a user chooses Teacher or Student is also a group design choice
within FR-01. These are group design decisions, not claims of separate
client validation. Classroom ownership and assignment-to-classroom
relationships are reflected in the architecture and business rules.

**Group architecture decisions:** Technical decisions are recorded in
`architecture.md` and `ADRs.md`. Group approval of an architecture
choice is not the same as client or TA validation.

Before submission, compare this consolidated PRD with the original
validated PRD and the actual TA feedback notes. The mapping above is a
traceability aid; correct it if the source documents use different
wording or numbering.
