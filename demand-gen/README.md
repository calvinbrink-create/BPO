# BPO Demand Generation

Finds people who actually want BPO/outsourcing help, and never invoices
anyone off an inference. Built to replace an earlier, rejected design that
cold-emailed people with zero signaled interest and auto-fired a PayPal
invoice the moment a reply's wording loosely matched a positive keyword —
that was coercive, not lead generation, and nothing here works that way.

## The rule this whole thing follows

**A lead is someone who told you, in some form, that they want this.**
Not someone who happens to be hiring internally (that's a proxy that
assumes intent no one has stated). Not someone who replied "sounds good"
to an email they never asked for. An actual signal: they filled in a form
on a page describing the service, or they published a tender for this
exact work, or they posted in public asking for it.

**An invoice only ever fires from an explicit action**, never from parsed
sentiment. See "Consent → invoice" below.

## Channels

### 1. Inbound landing page (`bpo-control-dashboard.vercel.app/inquire.html`)
A real page describing the service with a contact form. Only people who
submit it become leads.

**Live now, zero setup needed.** `api/lead.js` stores each submission in a
Vercel Blob store (`bpo-leads`) provisioned specifically for this project —
no third-party account, no credential anyone had to go create. The token
that authorizes it (`BLOB_READ_WRITE_TOKEN`) was injected automatically by
Vercel the moment the store was linked to the project. A submission cannot
silently fail to persist for lack of a forgotten credential the way the
earlier GitHub-PAT design could.

- **See captured leads with zero code:** Vercel dashboard → Storage →
  `bpo-leads` → browse objects under `leads/`.
- **Or pull them as JSON:** `GET /api/leads` with
  `Authorization: Bearer <ADMIN_SECRET>` (a random value already generated
  and stored on the project — ask Claude or check the Vercel project's
  environment variables for the value if you need it).
- **Optional real-time email notification:** set `RESEND_API_KEY` (free at
  resend.com, ~2 minutes) and `BUSINESS_EMAIL` on the project, and `api/lead.js`
  will also email you the moment a lead comes in. Not required for leads to
  be captured — purely a convenience layer on top of storage that already works.

Leads land as JSON files in `demand-gen/leads/`, each with `status: "new"`.

### 2. UK procurement tenders (`tenders/fetch_tenders.py`)
Runs daily via `.github/workflows/demand-gen-tenders.yml`. Pulls Contracts
Finder + Find a Tender for published outsourcing/call-centre/back-office
notices — a published tender is real, budgeted demand. Writes a markdown
digest to `tenders/digest/`. **Never submits a bid** — that's a legal act
on the tender portal and stays a deliberate human decision.

### 3. Public asks (`social/reddit_monitor.py`)
Runs every 6 hours via `.github/workflows/demand-gen-social.yml`. Searches
Reddit for people explicitly asking for a BPO/outsourcing/call-center
partner in a handful of relevant subreddits. Writes a markdown digest with
a drafted, non-pitchy reply to `social/digest/`. **Never posts anything
itself** — read the actual post, then decide whether and how to reply.

Uses Reddit's OAuth API, not the anonymous `.json` search endpoints — those
were tested live from this repo's own GitHub Actions runner and got a
blanket HTTP 403 from Reddit's bot detection for every request (a real
finding from an actual triggered run, not a guess). OAuth app-only auth is
Reddit's own documented path for this kind of scripted, read-only access.

**One-time setup needed:** create a free "script"-type app at
[reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) (personal use,
no review needed), then add its client ID and secret as `REDDIT_CLIENT_ID`
/ `REDDIT_CLIENT_SECRET` repo secrets (Settings → Secrets and variables →
Actions). Until then, this workflow runs and exits cleanly without finding
anything — it does not fail the job.

### 4. Paid search — not built
Would require a Google Ads account and ad budget, neither of which can be
created by an automated agent. The landing page and pricing tiers are
already shaped to receive that traffic whenever an account exists; the
campaign/keyword setup itself is a manual one-time step.

## Consent → invoice

Once a lead (from any channel) explicitly says they want to proceed, the
next step is a proposal with a single, unambiguous call to action — an
"Accept & pay deposit" link. Clicking it is the only thing that creates a
real PayPal invoice, via the capability-token endpoints already built in
`src/api/auto-invoice.js`. There is no code path anywhere in this system
that infers agreement from tone, keywords, or anything short of that click.

That bridge is not fully wired yet: it depends on the reconstructed
`src/api/_lib.js` capability scheme (see the repo root README) being
reviewed and deployed to the live `bpo-control-api` project, which hasn't
happened. Until then, turning an accepted proposal into an actual invoice
is a manual step — slower, but it doesn't risk firing a real invoice off
untested code.

## Lead lifecycle

```
demand-gen/leads/*.json   status: new
                           -> a human (or a supervised follow-up routine)
                              reads it and replies like a person would
                           -> replied
                           -> if they explicitly want to proceed: proposal
                              sent with an accept-and-pay link
                           -> if they click it: real invoice, real consent
```

No stage in this chain fires automatically off inferred interest.
