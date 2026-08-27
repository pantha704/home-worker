# Privacy

Homeworker is a document tool. It is **not** a school platform, not directed at children, and not a place for identity documents, signatures, medical records, or other people's homework.

## Local mode

Files stay on the machine that runs the API. There is no account. Do not expose local mode to the internet.

## Hosted mode (optional)

If you turn hosted mode on:

- Sign-in uses Supabase magic links.
- Source files and exports live in private storage scoped to your account.
- Projects expire after the configured retention window (default 14 days) and are then deleted.
- OCR text is treated as uncertain evidence, not as truth, and is not used to train a handwriting clone of you or anyone else.
- Logs must not contain document body text.

We do not sell document contents. We cannot promise vendor-free hosted mode: Cloudflare, Render, and Supabase see what their platforms always see (TLS metadata, account email).

## What we never do

- Clone a real person's handwriting or signature from samples.
- Auto-submit work to a school or LMS.
- Treat OCR as a source of legal or academic truth.
