-- Thesis Vault schema (SRS §6 Data Requirements, Lab 4 class model, Lab 6 data design)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('scholar','supervisor','examiner','librarian','admin','institute')),
  department_id   INTEGER REFERENCES departments(id),
  contact         TEXT,
  specialization  TEXT,
  roll_number     TEXT,
  guide_id        INTEGER REFERENCES users(id),           -- scholars only: officially assigned guide (BR-002)
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS theses (
  id                  INTEGER PRIMARY KEY,
  author_id           INTEGER NOT NULL REFERENCES users(id),
  guide_id            INTEGER REFERENCES users(id),
  examiner_id         INTEGER REFERENCES users(id),
  title               TEXT NOT NULL,
  abstract            TEXT NOT NULL DEFAULT '',
  keywords            TEXT NOT NULL DEFAULT '',
  department_id       INTEGER REFERENCES departments(id),
  degree              TEXT NOT NULL DEFAULT 'PhD',
  year                INTEGER,
  status              TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN
                        ('Draft','Submitted','UnderGuideReview','RevisionRequired','UnderCommitteeReview',
                         'Approved','Rejected','Catalogued','Published')),
  declaration         INTEGER NOT NULL DEFAULT 0,
  current_version_id  INTEGER,
  submission_date     TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_theses_status ON theses(status);
CREATE INDEX IF NOT EXISTS idx_theses_author ON theses(author_id);
CREATE INDEX IF NOT EXISTS idx_theses_guide ON theses(guide_id);

-- BR-005: versions are append-only; there is no UPDATE/DELETE path for file data.
CREATE TABLE IF NOT EXISTS thesis_versions (
  id              INTEGER PRIMARY KEY,
  thesis_id       INTEGER NOT NULL REFERENCES theses(id),
  version_number  INTEGER NOT NULL,
  file_path       TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  full_text       TEXT NOT NULL DEFAULT '',
  page_count      INTEGER,
  revision_notes  TEXT,
  uploaded_by     INTEGER NOT NULL REFERENCES users(id),
  upload_date     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (thesis_id, version_number)
);
CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON thesis_versions
BEGIN SELECT RAISE(ABORT, 'BR-005: thesis versions cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_overwrite BEFORE UPDATE OF file_path, file_name, version_number ON thesis_versions
BEGIN SELECT RAISE(ABORT, 'BR-005: thesis versions cannot be overwritten'); END;

CREATE TABLE IF NOT EXISTS plagiarism_checks (
  id                INTEGER PRIMARY KEY,
  thesis_id         INTEGER NOT NULL REFERENCES theses(id),
  version_id        INTEGER REFERENCES thesis_versions(id),
  similarity_score  REAL,
  threshold         REAL NOT NULL,
  tool              TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('Initiated','InProgress','Passed','Flagged','Failed')),
  report_json       TEXT,
  check_date        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id                   INTEGER PRIMARY KEY,
  thesis_id            INTEGER NOT NULL REFERENCES theses(id),
  version_id           INTEGER NOT NULL REFERENCES thesis_versions(id),
  reviewer_id          INTEGER NOT NULL REFERENCES users(id),
  stage                TEXT NOT NULL CHECK (stage IN ('Guide','Committee')),
  comments             TEXT NOT NULL DEFAULT '',
  feedback_to_student  TEXT NOT NULL DEFAULT '',
  outcome              TEXT CHECK (outcome IN ('Approved','RevisionRequested','Rejected')),
  is_submitted         INTEGER NOT NULL DEFAULT 0,
  review_date          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS annotations (
  id           INTEGER PRIMARY KEY,
  version_id   INTEGER NOT NULL REFERENCES thesis_versions(id),
  reviewer_id  INTEGER NOT NULL REFERENCES users(id),
  page         INTEGER,
  note         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revision_requests (
  id                   INTEGER PRIMARY KEY,
  thesis_id            INTEGER NOT NULL REFERENCES theses(id),
  review_id            INTEGER REFERENCES reviews(id),
  requested_by         INTEGER NOT NULL REFERENCES users(id),
  reason               TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Resolved')),
  resolved_version_id  INTEGER REFERENCES thesis_versions(id),
  request_date         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- BR-001: one approval per level per reviewed version, in order Guide → Committee → Librarian.
CREATE TABLE IF NOT EXISTS approvals (
  id             INTEGER PRIMARY KEY,
  thesis_id      INTEGER NOT NULL REFERENCES theses(id),
  version_id     INTEGER NOT NULL REFERENCES thesis_versions(id),
  approver_id    INTEGER NOT NULL REFERENCES users(id),
  level          TEXT NOT NULL CHECK (level IN ('Guide','Committee','Librarian')),
  status         TEXT NOT NULL DEFAULT 'Approved',
  comments       TEXT,
  approval_date  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (thesis_id, version_id, level)
);

CREATE TABLE IF NOT EXISTS catalogue_records (
  id              INTEGER PRIMARY KEY,
  thesis_id       INTEGER NOT NULL UNIQUE REFERENCES theses(id),
  accession_no    TEXT NOT NULL UNIQUE,
  ddc_class       TEXT,
  category        TEXT,
  research_area   TEXT,
  visibility      TEXT NOT NULL DEFAULT 'Public' CHECK (visibility IN ('Public','Restricted')),
  citation_apa    TEXT,
  citation_ieee   TEXT,
  doi             TEXT UNIQUE,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'InProgress' CHECK (status IN ('InProgress','Catalogued','Published')),
  catalogued_by   INTEGER REFERENCES users(id),
  catalogue_date  TEXT,
  published_date  TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS thesis_history (
  id           INTEGER PRIMARY KEY,
  thesis_id    INTEGER NOT NULL REFERENCES theses(id),
  actor_id     INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id            INTEGER PRIMARY KEY,
  recipient_id  INTEGER NOT NULL REFERENCES users(id),
  thesis_id     INTEGER REFERENCES theses(id),
  type          TEXT NOT NULL,
  message       TEXT NOT NULL,
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_id, is_read);

-- NFR-016: append-only audit log.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  details      TEXT,
  ip           TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

-- FR/UC-015: full-text index of published theses (metadata + extracted PDF text).
CREATE VIRTUAL TABLE IF NOT EXISTS thesis_fts USING fts5(
  title, abstract, keywords, author, body,
  thesis_id UNINDEXED,
  tokenize = 'porter unicode61'
);
