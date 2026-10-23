# Thesis Vault

A web-based digital thesis archive and management system for LNMIIT Jaipur, built from the team's CS314 Software Development Lab documentation (Labs 1–7, Team T054).

Scholars submit their thesis with metadata and a PDF. The system runs a similarity check, then routes the thesis through guide review, committee/examiner evaluation and library cataloguing. The finished thesis is published to a searchable repository. Every version, decision and action is recorded.

## Quick start

Requires **Node.js 22.13 or newer**. There is no separate database server: SQLite comes built into Node.

```bash
npm install
npm run seed      # creates demo users and 14 theses in every workflow state
npm start         # http://localhost:3000
```

`npm run reset` wipes the data and reseeds it. `npm test` runs the integration tests against a throwaway database.

### Demo accounts

All demo accounts use the password `Password@123`. The login page also has one-click buttons for each role.

| Role | Email | What to try |
|---|---|---|
| Research Scholar | `scholar@lnmiit.ac.in` | Has a thesis with a revision request: upload a revised version |
| Supervisor / Guide | `guide@lnmiit.ac.in` | Review queue: annotate, then approve or request revision |
| Examiner / Committee | `examiner@lnmiit.ac.in` | Evaluate a thesis at the committee stage |
| Librarian | `librarian@lnmiit.ac.in` | Catalogue an approved thesis and publish it with a DOI |
| Administrator | `admin@lnmiit.ac.in` | Users and roles, guide and examiner assignment, audit log, settings |
| Institute / Management | `dean.research@lnmiit.ac.in` | Research output reports |
| Scholar without a guide | `dev.patel@lnmiit.ac.in` | Shows that submission is blocked until a guide is assigned |

The `samples/` folder holds two PDFs for trying the submission form. `original-thesis.pdf` passes the similarity check. `plagiarised-thesis.pdf` copies a published thesis and is rejected with a ~97% similarity score.

## What is implemented

| Area | SRS reference | Notes |
|---|---|---|
| Registration and login | FR-001–004, NFR-003 | Institutional email domain required; bcrypt hashes; httpOnly session cookie; login throttling |
| Role-based access control | FR-005–007, BR-002, BR-006, BR-007, NFR-013 | Six roles. Guides and examiners only see theses assigned to them |
| Thesis submission with metadata | FR-008–012, BR-004, UC-003 | Draft and submit, PDF validation (magic bytes, 50 MB limit), declaration of originality |
| Version management | FR-013–015, BR-005, UC-004 | Append-only versions, enforced by database triggers |
| Guide review | FR-016–020, UC-006/007/008 | Saved draft reviews, page-anchored annotations, approve / request revision / reject |
| Similarity checking | FR-021–024, BR-003, UC-009/010 | Third-party adapter with a threshold configurable by the admin (default 20%) |
| Multi-level approval | FR-025–028, BR-001, UC-011/012 | Guide → Committee → Librarian, recorded per version; examiner auto-assigned by department and workload |
| Cataloguing and archival | FR-029–030, BR-008, UC-013/014 | Accession number, DDC class, Public/Restricted visibility, APA/IEEE citations, DOI |
| Repository search | Objective h, UC-015/016, NFR-002 | SQLite FTS5 over metadata and extracted PDF text, with filters and snippets; guests see public theses only |
| Notifications | Objective i, BR-009, UC-017 | In-app; every status change notifies the relevant people |
| Audit log | NFR-016, UC-018 | Append-only; records user, action, entity, details, IP and timestamp |
| Reports and dashboards | Objective j, BR-010, UC-019 | Role dashboards; research report with charts; CSV export |
| Atomic writes | NFR-008 | Each operation runs in one transaction; files are written via temp-file + rename and removed if the transaction fails |

The thesis lifecycle follows the Lab 5 state diagram exactly:

```
Draft → Submitted → UnderGuideReview ⇄ RevisionRequired
                         ↓ approve
                  UnderCommitteeReview → Rejected
                         ↓ approve            (revision → RevisionRequired)
                      Approved → Catalogued → Published/Archived
```

The API returns the error codes defined in the Lab 7 Software Interface Specification (`MISSING_REQUIRED`, `INVALID_FILE`, `GUIDE_NOT_ASSIGNED`, `PLAGIARISM_THRESHOLD_EXCEEDED`, `REVISION_NOT_REQUESTED`, `NOT_ASSIGNED`, `NOT_REVIEWABLE`, `COMMENTS_REQUIRED`, `ALREADY_DECIDED`, `NOT_COMMITTEE_APPROVED`, `MISSING_CLASSIFICATION`, `ALREADY_CATALOGUED`, `INVALID_FILTER`, `SERVICE_UNAVAILABLE`, …). The UI screens follow the Lab 7 wireframes (Figures 1–4).

## Architecture

The system has separate frontend, backend and database layers (NFR-010). The backend modules map one-to-one to the components in the Lab 7 component diagram.

```
public/                     Web UI / role-based portal (vanilla JS single-page app, no build step)
  js/app.js                 router, role navigation, shell
  js/views/*.js             scholar, review, catalogue, repository, admin, reports …
server/
  index.js                  Express app, security headers, optional HTTPS
  routes/                   HTTP endpoints (auth, theses, library, admin)
  services/
    workflow.js             ThesisWorkflowService: state machine and access rules
    submission.js           Thesis Submission Service: submitThesis, saveDraft, uploadRevision
    review.js               Review & Approval Service: recordReview, annotations, examiner assignment
    catalogue.js            Cataloguing Service: completeCataloguing, publishToRepository
    plagiarism.js           Plagiarism Check Service: third-party adapter
    storage.js              DocumentStorage: PDF validation, text extraction, file store
    history.js              History & Notification: audit log, thesis history, notifications
    search.js, reports.js   Repository search and research reports
  db/schema.sql             tables, append-only triggers, FTS5 index
  db/seed.js                demo data, created by driving the real services
tests/workflow.test.js      integration tests for FRs and business rules
```

Uploaded PDFs and the SQLite database live in `data/`, which git ignores.

## Configuration

Set these as environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev value | **Must be set in production**; signs session tokens |
| `DATA_DIR` | `./data` | Database and uploaded files |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | — | Serve HTTPS directly (NFR-004). Or put a TLS reverse proxy in front |
| `PLAGIARISM_PROVIDER` | `mock` | `http` to call a real similarity service |
| `PLAGIARISM_API_URL`, `PLAGIARISM_API_KEY` | — | The service receives `{documentId, text}` and returns `{similarityScore, matches?}` |
| `DOI_PREFIX` | `10.5555/lnmiit` | Prefix for DOIs assigned on publication |

The similarity threshold and the institutional email domain are set by the administrator under **Settings**.

## Limitations and next steps

- **Similarity checking.** The SRS puts an in-house plagiarism engine out of scope. The `mock` provider is a development stand-in: it measures 6-word-shingle overlap against theses already in the vault. Production needs a licensed service such as Turnitin or iThenticate, connected through the `http` provider.
- **Notifications are in-app only.** The SRS change-request example (automated email notifications) can be added in `services/history.js#notify`.
- **DOIs are generated locally.** Registering them requires a DataCite/Crossref membership.
- **PDF text extraction.** Scanned PDFs without a text layer are archived but not full-text indexed.
