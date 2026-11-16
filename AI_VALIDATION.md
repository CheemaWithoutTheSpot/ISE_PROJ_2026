# AI-Assisted Architecture Validation and Refinement Record

## 1. Purpose and status

The project brief asks the team to provide project context to an AI reviewer without implementation code, obtain a suggested project structure and architecture critique, evaluate the suggestions, refine the context and review the updated context again.

**Recorded activity:** A structured architecture review and a second-pass consistency review were performed by ChatGPT in the current conversation using the project documentation. The findings and document refinements are recorded below.

**Important limitation:** This review was not conducted in a separate fresh AI workspace. It must not be described as a separate-model or fresh-workspace validation. If the instructor specifically requires an independent fresh workspace, the group still needs to repeat the prompts there and attach genuine screenshots or exported transcripts. No screenshots, external AI responses, implementation tests or group approvals have been fabricated.

No implementation source code was supplied for this review. The review used the PRD, architecture description, ADRs and agent instructions.

## 2. Initial review prompt

The review was guided by this prompt:

> You are reviewing a university software engineering project architecture. Read the PRD, architecture and ADRs. Do not write implementation code. Identify the functional and quality-attribute drivers, assess whether the proposed folder structure follows the documented architecture, and identify contradictions, missing responsibilities, security risks, data consistency risks and unnecessary complexity. Do not silently redesign the system. Separate genuine defects from optional improvements. Do not claim that any requirement is implemented or tested.

## 3. Initial review findings

The following findings were identified during the first review pass.

| ID | Finding | Classification | Recommended treatment |
|---|---|---|---|
| V-01 | The PRD provenance paragraph incorrectly stated that current FR-01 through FR-19 were all part of the original client-validated baseline, while the documented original baseline contained 15 functional requirements. | Genuine documentation contradiction | Correct the provenance and provide a traceability map from original FR-01–FR-15 to current requirement IDs. |
| V-02 | Classroom registration, joining-code and membership requirements were included in the consolidated PRD but their source was not clearly distinguished from client-validated requirements. | Traceability gap | Label classroom requirements as group-designed functionality unless separate client validation is evidenced. |
| V-03 | TA additions (submission receipts, reusable rubric templates and CSV export) need to be distinguished from the original client baseline. | Traceability requirement | Attribute these additions to TA feedback after the Deliverable 2 demonstration. |
| V-04 | The throughput NFR added an upper limit of ten rubric criteria, but that limit was not present in the recorded approved requirement. | Unsupported assumption | Remove the unapproved criteria cap and state the throughput target without adding it. |
| V-05 | The worker design describes atomic claiming, expiring leases, retries and stale-version checks. These are appropriate safeguards, but they remain design intentions until tested. | Verification limitation | Keep the architecture wording and clearly state that recovery/performance must be tested. |
| V-06 | The backend structure separates routes, controllers, services, repositories, middleware, workers and configuration, and the frontend separates pages, components, API calls and styles. | Consistent with architecture | Retain the structure; do not add microservices, Redis or a separate worker process. |
| V-07 | The architecture does not define every final API request/response schema or every endpoint needed for classroom membership and manual-grading workflows. | Implementation detail / open contract | Keep endpoint examples explicitly illustrative; finalize complete API contracts during implementation. |
| V-08 | The local filesystem and single-process worker are appropriate for the agreed local-first prototype, but do not provide multi-host scaling. | Known constraint | Retain the local-first design and keep multi-host deployment out of initial scope. |

## 4. Group evaluation and decisions

This table records the documentation treatment. It does not claim that a separate group meeting or vote occurred. The group should confirm the decisions before submission.

| Finding | Treatment | Reason
|---|---|---|
| V-01 | Accepted and corrected | The previous provenance statement conflicted with the original 15-requirement baseline recorded in the project context. |
| V-02 | Accepted and corrected | Classroom functionality was agreed as group-designed product functionality; it should not be presented as client-validated without evidence. |
| V-03 | Accepted and corrected | The three additional requirements came from TA feedback after the Deliverable 2 demonstration. |
| V-04 | Accepted and corrected | The ten-criteria cap was not an approved constraint and could unnecessarily narrow the requirement. |
| V-05 | Accepted as a verification note | The design safeguards remain appropriate, but documentation cannot prove they work. |
| V-06 | Accepted | The proposed layer-based folder structure matches the approved layered monolith and React/Express split. |
| V-07 | Accepted as an open implementation task | The architecture explicitly describes endpoint examples as illustrative, not a final API contract. |
| V-08 | Accepted as a known limitation | This matches the approved local-first deployment decision and avoids adding unnecessary infrastructure. |

## 5. Refinements made to the project context

The following documentation refinements were made after the first review pass:

1. Updated the PRD provenance section to map the original client-validated FR-01–FR-15 to the current consolidated FR identifiers.
2. Separated original client requirements, TA feedback additions and group-designed classroom functionality.
3. Removed the unsupported ten-criteria limit from NFR-02. The 30-submission/30-minute target remains a target requiring performance testing.
4. Updated `README.md` so it no longer says the contribution log is blank or that AI validation has not been attempted. It now explains the actual review limitation.
5. Kept the approved architecture decisions unchanged. No new service, framework or paid infrastructure was introduced.

## 6. Second-pass review prompt

After the refinements, the updated PRD and README were reviewed again against the architecture and ADRs using this prompt:

> Review the updated project documents. Do not write code. Compare the initial findings with the refined context. Check whether the provenance issue is resolved, whether group-designed and TA-added requirements are clearly distinguished, whether the throughput target contains unsupported assumptions, and whether the folder structure still matches the approved architecture and ADRs. Identify remaining contradictions, missing responsibilities and verification limitations. Distinguish documented decisions from assumptions and unverified implementation claims.

## 7. Second-pass findings

- The PRD now distinguishes the original client-validated baseline from TA feedback additions and group-designed classroom functionality. The original-to-current FR mapping is explicit.
- The throughput target no longer adds an unsupported ten-criteria maximum. It remains a performance objective, not a proven result.
- The layer-based backend structure and separate React frontend remain consistent with ADR-001 and ADR-005.
- The repository, PostgreSQL, local file storage, AI adapter and session decisions remain consistent with ADR-002, ADR-003 and ADR-004.
- No architecture change was necessary as a result of this review.
- The exact API schemas, database columns/constraints, parser-library selection and operational cleanup procedure still need implementation-level definition and testing. These are not reasons to add more infrastructure to the initial prototype.

## 8. Comparison: first pass and second pass

| Area | First pass | After refinement / second pass |
|---|---|---|
| Requirement provenance | Client baseline incorrectly described as current FR-01–FR-19. | Original 15 requirements mapped to current IDs; TA and group additions separated. |
| Classroom functionality | Source of requirements not sufficiently clear. | Explicitly labelled group-designed functionality. |
| TA feedback | Added requirements needed clearer attribution. | Receipt, rubric-template and CSV requirements identified as TA additions. |
| Throughput target | Included an unsupported ten-criteria cap. | Cap removed; target remains subject to performance testing. |
| Architecture structure | Folder structure matched the layered design. | Retained without unnecessary architectural changes. |
| Verification claims | Risk of readers interpreting design safeguards as proven behavior. | Documents explicitly distinguish intended design from tested implementation. |

## 9. Remaining limitations and evidence required

- Run the same exercise in a separate fresh AI workspace if required by the instructor. Attach the actual context files, prompts and complete responses.
- Have all three group members review and confirm the contribution allocation and the refinement decisions.
- Compare the PRD traceability map with the original client-validated PRD and actual TA feedback notes.
- Add actual dates, Git commits, meeting notes or screenshots only if they exist and are required.
- Implementation, unit/integration/worker/performance tests, security verification and deployment have not been demonstrated by this documentation review.

## 10. Conclusion

The documentation review found and corrected requirement-provenance and traceability issues and removed an unsupported performance constraint. The approved architecture and folder structure remained suitable for the agreed low-complexity, local-first prototype. This review improves documentation consistency but does not establish implementation correctness, performance compliance, security assurance or a separate fresh-workspace AI validation.

## 11. Evidence log

| Evidence | Current record | Additional evidence needed if requested |
|---|---|---|
| Initial context | Project PRD, architecture, ADRs and AGENTS instructions were reviewed in this conversation. | Screenshot/export from a separate fresh AI workspace. |
| Initial prompt and findings | Prompt and findings recorded in Sections 2–3. | Full transcript/screenshot from the separate workspace. |
| Evaluation decisions | Review treatment recorded in Section 4. | Group confirmation/meeting record if required. |
| Refined context | Updated `PRD.md` and `README.md`. | Attach the exact updated files to the separate workspace if repeating the exercise. |
| Second prompt and findings | Prompt and second-pass findings recorded in Sections 6–7. | Full second response from the separate workspace. |
| Final comparison | Recorded in Section 8. | Update after the separate workspace exercise, if required. |
