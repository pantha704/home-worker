-- Replay-safe project create (owner + Idempotency-Key).

alter table homeworker.projects
  add column if not exists idempotency_key varchar(128);

create unique index if not exists uq_projects_owner_idempotency
  on homeworker.projects (owner_id, idempotency_key)
  where idempotency_key is not null;
