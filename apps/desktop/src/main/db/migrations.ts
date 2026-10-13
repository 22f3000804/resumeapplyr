// Schema history. Append a new entry to change the schema; never edit a shipped one.
export const MIGRATIONS: string[] = [
  /* 1 */ `
  CREATE TABLE profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE resumes (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    source_filename TEXT,
    source_mime TEXT,
    content TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE resume_variants (
    id TEXT PRIMARY KEY,
    resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    job_url TEXT,
    application_id TEXT,
    content TEXT NOT NULL,
    diff_notes TEXT,
    rewrites TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_variants_resume ON resume_variants(resume_id);
  CREATE TABLE boards (
    domain TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    search_url TEXT,
    builtin INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 100
  );
  CREATE TABLE campaigns (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    status_reason TEXT,
    config TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE TABLE jobs (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    salary TEXT,
    type TEXT,
    url TEXT NOT NULL,
    board TEXT,
    match_score INTEGER,
    match_reason TEXT,
    status TEXT NOT NULL,
    description TEXT,
    brief TEXT,
    fail_reason TEXT,
    skip_reason TEXT,
    retry_notes TEXT,
    approved_by TEXT,
    applied_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, key)
  );
  CREATE INDEX idx_jobs_status ON jobs(status);
  CREATE TABLE applications (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT,
    board TEXT,
    source TEXT NOT NULL,
    campaign_id TEXT,
    job_key TEXT,
    match_score INTEGER,
    match_reason TEXT,
    status TEXT NOT NULL DEFAULT 'applied',
    resume_id TEXT,
    resume_variant_id TEXT,
    notes TEXT,
    unchecked INTEGER NOT NULL DEFAULT 0,
    applied_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_applications_applied_at ON applications(applied_at);
  CREATE TABLE application_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    to_status TEXT,
    note TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE cover_letters (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    job_url TEXT,
    job_title TEXT,
    company TEXT,
    source TEXT NOT NULL,
    application_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE questions (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    campaign_id TEXT,
    job_key TEXT,
    kind TEXT NOT NULL,
    question TEXT NOT NULL,
    context TEXT,
    options TEXT,
    answer_key TEXT,
    url TEXT,
    answer TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE TABLE saved_answers (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    skill TEXT NOT NULL,
    args TEXT,
    title TEXT NOT NULL,
    provider TEXT NOT NULL,
    campaign_id TEXT,
    resume_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    exit_code INTEGER,
    summary TEXT,
    error TEXT,
    cost_usd REAL,
    input_tokens INTEGER,
    output_tokens INTEGER
  );
  CREATE TABLE agent_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT,
    data TEXT
  );
  CREATE INDEX idx_agent_events_run ON agent_events(run_id, id);
  `,
];
