# Client Portal — Feature Spec

**Status:** Draft for review
**Owner:** Dave
**Last updated:** 2026-06

A self-service portal for Clean Air Lawn Care of Grand Rapids customers. Lets
clients log in (passwordless), pay and manage their billing, see their service
schedule and history, update their card on file, and read educational content
and announcements — reducing the manual work currently done by hand in the
staff app.

---

## 1. Goals & non-goals

### Goals
- Let clients **self-serve the billing tasks** currently done manually: pay an
  invoice, pay off the rest of the season in full, switch the card on file,
  view receipts/history.
- Give clients **visibility** into upcoming visits and past service.
- Provide an **education & communication hub** — guides, seasonal tips, and
  broadcast announcements — to deepen the customer relationship.
- **Passwordless** access via magic link (email/SMS one-time link).
- Reuse the existing Stripe and scheduling plumbing wherever possible.

### Non-goals (initially)
- No client-initiated rescheduling that auto-applies (requests only, later phase).
- No two-way live chat (Phase 3, reuses messaging).
- No public sign-up — accounts exist only for real customers in the CRM.
- No change to the **staff** app's auth or to auto-charge behavior (auto-charge
  stays off; the portal lets *clients* pay, it does not auto-bill them).

---

## 2. What already exists (reuse, don't rebuild)

The app already serves unauthenticated, token-scoped customer pages. The portal
unifies these behind a client identity and adds self-service on top.

| Capability | Where it lives today | Reuse for portal |
|---|---|---|
| Public proposal page + card-save (Stripe setup) | `public/proposal.html`, `routes/estimates.js` (`/public/:token/setup-card`, `/:id/card-save-link`) | Card-on-file management |
| Receipt page | `public/receipt.html`, `/receipt/:token` | Payment history / receipts |
| Pay an invoice (Stripe checkout) | `routes/payments.js`, `utils/stripe.js` | "Pay now" |
| Card on file as default PM | `utils/stripe.js` `attachSetupIntentToCustomer` | "Switch card" |
| Invoices + status lifecycle | `invoices` table, `routes/payments.js` | "My invoices" |
| Schedule / visits | `schedules` table, `routes/schedules.js` | "Upcoming visits" |
| Service history | `applications` table, `routes/applications.js` | "Service history" |
| Messaging / drafts | `routes/messaging.js` | Announcements / notifications |

**The only genuinely new infrastructure** is (a) a stable **client identity**,
(b) **magic-link auth** for clients, and (c) a small **content system** for the
education/communication hub.

---

## 3. Access model — magic link (passwordless)

### Why
No passwords to reset, lowest friction, and it matches the token pattern the app
already uses for proposals/receipts.

### Lifecycle
1. Client visits `/portal` and enters the **email** (or phone) on file.
2. Server looks up a matching **client identity** (see §4). If found, it
   generates a single-use, short-lived token (e.g. 15-min expiry), stores its
   hash, and sends the link by email/SMS:
   `https://<domain>/portal/auth?token=<token>`.
   - To avoid leaking who is a customer, the UI always says "If that email is on
     file, we've sent a link" regardless of match.
3. Client clicks the link. Server verifies the token (exists, unexpired,
   unused), marks it used, and issues a **client session** (signed,
   HTTP-only cookie) scoped to that `client_id`.
4. Session lasts e.g. 30 days with sliding renewal; "log out" clears it.

### Notes
- Client sessions are **completely separate** from staff sessions
  (`routes/auth.js`) — different cookie, different middleware
  (`requireClient` vs `requireAuth`), different identity table. No staff
  privileges are ever reachable from a client session.
- Rate-limit link requests per email/IP to prevent abuse.

---

## 4. Data model changes

### 4.1 Client identity (the foundation)

Today, customer data hangs off `estimates` and `properties` keyed loosely by
`customer_name` + `email`. A client may have multiple estimates/properties. The
portal needs one stable identity that aggregates all of a person's records.

```sql
CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,              -- normalized (lowercased, trimmed) — primary key for magic link
  phone TEXT,                     -- optional alt login channel
  name TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Linking client → their records. Two options:

- **Option A (recommended): add `client_id` to `estimates`** (and derive
  properties/invoices/visits through the estimate → property relationships).
  Backfill `client_id` by normalized email match in a one-time migration; flag
  unmatched/ambiguous rows for manual review.
- Option B: resolve on the fly by normalized email every request. Simpler to
  start, but fragile (email typos, shared emails) and slower. Prefer A.

> **Decision needed:** confirm email is the canonical client key. Edge cases:
> two customers sharing one email; one customer with multiple emails; a
> customer with no email (check-only). These need a documented rule (see §10).

### 4.2 Magic-link tokens

```sql
CREATE TABLE client_auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  token_hash TEXT NOT NULL,       -- store hash, never the raw token
  channel TEXT,                   -- 'email' | 'sms'
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 4.3 Education & communication content

```sql
CREATE TABLE portal_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,             -- markdown or sanitized HTML
  category TEXT,                  -- 'guide' | 'faq' | 'seasonal' | ...
  service_type TEXT,              -- optional: surface after a matching service
  audience TEXT DEFAULT 'all',    -- 'all' | future: segment key
  published INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE portal_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT DEFAULT 'all',
  publish_at DATETIME,
  expires_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Authoring happens in the **staff app** (new admin screen); clients only read.

---

## 5. Security model (highest-stakes — review required)

The core invariant: **a client session can only ever read/act on records that
belong to that `client_id`.** A single mis-scoped query leaks one customer's
billing to another.

Rules:
- Every portal API handler runs behind `requireClient`, which sets
  `req.clientId` from the session. Handlers **must** filter by `req.clientId` —
  never trust an `estimate_id`/`invoice_id` from the request without verifying
  it belongs to `req.clientId`.
- Pattern: resolve the client's owned estimate/property/invoice IDs server-side,
  and reject any requested ID not in that set (403).
- Payment actions (pay invoice, pay-in-full, card save) verify ownership of the
  target invoice/estimate before creating any Stripe session.
- Never expose raw card data — only Stripe-derived status (last4/brand is OK via
  Stripe, but not stored).
- Magic-link tokens: single-use, hashed at rest, short expiry, rate-limited.
- A dedicated **security review** (`/security-review`) before launch, focused on
  cross-client data access.

---

## 6. Feature spec by area

### 6.1 Billing & payments (MVP)
- **My Invoices**: list all invoices for the client across their estimates —
  status (paid / pending / overdue / upcoming / scheduled), amount, due date.
- **Pay invoice**: launches existing Stripe checkout for that invoice.
- **Pay off season in full**: sums the client's outstanding monthly installments,
  voids them, and creates one combined invoice — then pays it. (Automates the
  current manual void-and-recombine. Must be server-side, ownership-checked, and
  idempotent.)
- **Switch card on file**: exposes the existing Stripe setup flow; new card
  becomes default PM (`attachSetupIntentToCustomer` already does this).
- **Receipts / history**: paid invoices with dates and methods.

### 6.2 Service visibility (Phase 2)
- **Upcoming visits**: next scheduled dates + service type from `schedules`.
- **Service history**: completed `applications` — date, service, notes the
  client should see (filtered to client-safe fields).
- **Profile**: update phone, email, address, gate code / pet notes (writes back
  to property/estimate; sensitive changes may notify staff).

### 6.3 Education & communication hub (Phase 3)
- **Library**: published `portal_resources`, browsable by category.
- **Contextual surfacing**: after a service, show resources whose `service_type`
  matches the client's recent visit ("you just had a mosquito/tick app — here's
  what to expect").
- **Announcements**: active `portal_announcements` shown on the dashboard.
- **Staff authoring screen**: CRUD for resources/announcements, publish toggle.

---

## 7. Route & page map

### Client-facing pages (new `public/portal.html` SPA or server-rendered)
- `/portal` — login (request magic link)
- `/portal/auth?token=` — consume link, start session, redirect to dashboard
- `/portal/dashboard` — summary: balance, next visit, announcements
- `/portal/invoices`, `/portal/invoices/:id`
- `/portal/visits`, `/portal/profile`
- `/portal/learn`, `/portal/learn/:id`

### Client API (`routes/portal.js`, all behind `requireClient`)
- `POST /api/portal/request-link` — `{ email | phone }` → sends link (always 200)
- `GET  /api/portal/session` — current client + summary
- `POST /api/portal/logout`
- `GET  /api/portal/invoices` — client's invoices
- `POST /api/portal/invoices/:id/pay` — ownership-checked Stripe checkout
- `POST /api/portal/pay-in-full` — combine + pay remaining season
- `POST /api/portal/card-save-link` — Stripe setup session for new card
- `GET  /api/portal/visits` — upcoming + history
- `PUT  /api/portal/profile`
- `GET  /api/portal/resources`, `GET /api/portal/announcements`

### Staff API (content authoring, behind `requireAuth`/`requireAdmin`)
- `GET/POST/PUT/DELETE /api/admin/portal-resources`
- `GET/POST/PUT/DELETE /api/admin/portal-announcements`

---

## 8. Phased delivery plan

Everything above is in scope; this is the build **order** so it stays shippable.

1. **Phase 0 — Foundation.** `clients` table + email-normalized backfill
   migration; magic-link auth (`client_auth_tokens`, request/consume,
   `requireClient` middleware, client session cookie); security scoping
   harness. *Nothing client-facing ships until scoping is solid.*
2. **Phase 1 — Billing portal.** My Invoices, Pay, Pay-in-full, Switch card,
   Receipts. Retires the most manual work.
3. **Phase 2 — Visibility.** Upcoming visits, service history, profile edits.
4. **Phase 3 — Education & communication.** Resources library + staff authoring,
   then contextual surfacing and announcements.

---

## 9. Notifications (cross-cutting)
- Reuse messaging stack for: "invoice ready," "payment received," "visit
  scheduled," "new announcement."
- All notifications **link into the portal**; the portal is the canonical home.
- Respect per-client contact preferences; never auto-charge.

---

## 10. Decisions — resolved

All open questions have been answered by the owner (June 2026).

1. **Canonical client key → email.** Email is unique per customer and is the
   primary login key. Clients with no email (check-only) log in by phone
   (magic link via SMS); as a fallback you can issue them a direct link manually.
   Multi-property clients have **one email that covers all their properties** —
   logging in surfaces all properties with a switcher; no special handling needed.
2. **Pay-in-full → void + combine.** The "Lisa Royce" method: void remaining
   installments, create one combined invoice for their exact total, charge that.
   Idempotent, ownership-checked, matches the existing manual workflow.
3. **Lump payment by ACH/check → drop the card fee.** The ~3.5% card fee is
   baked into monthly installments. When the combined invoice is paid by bank
   transfer or check (not card), the fee is stripped from the total before the
   invoice is created. Card-only pay-in-full charges the baked-in total as-is.
4. **Profile edits → contact info freely.** Clients can update phone, email,
   gate code, and pet/access notes themselves. Billing-sensitive details
   (payment plan, method preference, estimate amounts) are staff-only.
5. **Content → rich-text authoring in staff app; images uploaded alongside.**
   No external CMS. Staff authors resources/announcements in the CRM admin.
6. **Domain → `/portal` path to start.** No new subdomain or DNS changes needed.
   Move to `portal.` subdomain later if branding calls for it.
7. **Multi-property → property switcher.** Two clients currently have multiple
   properties. Portal shows all properties on login with address labels; client
   selects which property's billing/visits to view. Lightweight — no per-property
   sub-accounts or roles needed.

---

## 11. Risks
- **Cross-client data leakage** — the #1 risk; mitigated by strict `req.clientId`
  scoping + pre-launch security review.
- **Identity backfill ambiguity** — bad email matches could link the wrong
  records; migration must flag, not guess.
- **Scope size** — multi-week feature; phasing is the mitigation.
- **Single-instance app** — sessions/tokens are DB-backed (not the in-memory
  job map used elsewhere), so a restart won't drop client logins. Confirm.

---

## 12. Out of scope (future)
- Client-initiated reschedule that auto-applies (start with requests).
- Two-way live chat.
- Public self-sign-up / lead capture.
- Multi-user accounts per household with roles.
