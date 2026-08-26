-- Homeworker v0.2.0 hosted persistence.
-- The browser has no direct table or object access; the owner-scoped API is the only data path.

create schema if not exists homeworker;

revoke all on schema homeworker from public, anon, authenticated;

create table homeworker.projects (
  id varchar(36) primary key,
  owner_id varchar(64) not null,
  filename varchar(255) not null,
  mime_type varchar(64) not null,
  sha256 varchar(64) not null,
  source_key varchar(512) not null unique,
  source_size integer not null check (source_size >= 0),
  status varchar(32) not null check (status in ('processing', 'needs_review', 'ready', 'failed')),
  revision integer not null check (revision >= 1),
  page_count integer not null check (page_count >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index ix_projects_owner_id on homeworker.projects (owner_id);
create index ix_projects_owner_updated on homeworker.projects (owner_id, updated_at desc, id);
create index ix_projects_owner_status on homeworker.projects (owner_id, status);
create index ix_projects_sha256 on homeworker.projects (sha256);
create index ix_projects_status on homeworker.projects (status);
create index ix_projects_expires_at on homeworker.projects (expires_at);

create table homeworker.project_revisions (
  project_id varchar(36) not null references homeworker.projects(id) on delete cascade,
  revision integer not null check (revision >= 1),
  owner_id varchar(64) not null,
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null,
  primary key (project_id, revision)
);

create index ix_revisions_owner_project
  on homeworker.project_revisions (owner_id, project_id, revision);

create table homeworker.jobs (
  id varchar(36) primary key,
  project_id varchar(36) not null references homeworker.projects(id) on delete cascade,
  owner_id varchar(64) not null,
  status varchar(24) not null check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null,
  lease_expires_at timestamptz,
  leased_by varchar(80),
  last_error varchar(500),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_jobs_project unique (project_id)
);

create index ix_jobs_claim
  on homeworker.jobs (status, available_at, lease_expires_at, created_at, id);
create index ix_jobs_owner on homeworker.jobs (owner_id, created_at);

create table homeworker.artifacts (
  project_id varchar(36) not null references homeworker.projects(id) on delete cascade,
  revision integer not null check (revision >= 1),
  kind varchar(32) not null check (
    kind in ('handwritten_pdf', 'companion_pdf', 'companion_text')
  ),
  owner_id varchar(64) not null,
  object_key varchar(512) not null unique,
  sha256 varchar(64) not null,
  size integer not null check (size >= 0),
  media_type varchar(96) not null,
  created_at timestamptz not null,
  primary key (project_id, revision, kind)
);

create index ix_artifacts_owner_project
  on homeworker.artifacts (owner_id, project_id, revision);

create table homeworker.rate_limits (
  owner_id varchar(64) not null,
  action varchar(40) not null,
  window_start timestamptz not null,
  count integer not null check (count >= 1),
  expires_at timestamptz not null,
  primary key (owner_id, action, window_start)
);

create index ix_rate_limits_expires_at on homeworker.rate_limits (expires_at);

create table homeworker.object_deletions (
  object_key varchar(512) primary key,
  owner_id varchar(64) not null,
  created_at timestamptz not null
);

create index ix_object_deletions_owner_id on homeworker.object_deletions (owner_id);
create index ix_object_deletions_created
  on homeworker.object_deletions (created_at, object_key);

alter table homeworker.projects enable row level security;
alter table homeworker.projects force row level security;
alter table homeworker.project_revisions enable row level security;
alter table homeworker.project_revisions force row level security;
alter table homeworker.jobs enable row level security;
alter table homeworker.jobs force row level security;
alter table homeworker.artifacts enable row level security;
alter table homeworker.artifacts force row level security;
alter table homeworker.rate_limits enable row level security;
alter table homeworker.rate_limits force row level security;
alter table homeworker.object_deletions enable row level security;
alter table homeworker.object_deletions force row level security;

revoke all on all tables in schema homeworker from public, anon, authenticated;
revoke all on all sequences in schema homeworker from public, anon, authenticated;
alter default privileges in schema homeworker
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema homeworker
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema homeworker
  revoke all on functions from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'homeworker-private',
  'homeworker-private',
  false,
  20971520,
  array['application/pdf', 'image/png', 'image/jpeg', 'text/plain']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on schema homeworker is
  'Private Homeworker data. Browser roles have no direct access.';
comment on table homeworker.project_revisions is
  'Immutable canonical document snapshots used for revision-exact exports.';
comment on table homeworker.jobs is
  'Durable leased extraction queue; safe to reclaim after worker interruption.';
comment on table homeworker.object_deletions is
  'Outbox for retryable deletion of private Storage objects.';
