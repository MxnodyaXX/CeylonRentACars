# Booking e-Agreement (CRC-AGR-003) — Stage 1 audit & Stage 2 design

Status: **all stages built and tested (17 Nov 2026)** — database files 22–25, Edge Functions agreement-notify + agreement-pdf, eagreement-cron.sql, the customer page, My bookings → Agreements, the admin panel / e-Agreements / Payment checks pages. Tests: tests/eagreement.test.mjs (56) + tests/eagreement-flow.test.mjs (134, incl. verify.sql) and browser runs of the customer page (phone + desktop) and the admin flow. Deploy: DEPLOY-CHECKLIST Parts 20–23. Still to do by people: approved wording, policy values, rehearsal, go-live date.
Decisions (17 Nov 2026): D1 = **every new booking** passes the gate (walk-ins accept at the counter with the SMS code; Module 13 manual fallback for outages) · D3 = **not yet** — built as a switch (`split_admin_approvals`), every admin approves for now · D5 = **SMS code via the portal login**.
Times are stored as UTC `timestamptz` and shown in Asia/Colombo (UTC+05:30).

---

## 1. Stage 1 — what the project has today

| Area | What exists | Where | Gap for the e-Agreement |
|---|---|---|---|
| Inquiries | `inquiries` table, text dates, `stage` pipeline (NEW … QUOTATION_SENT → CUSTOMER_DECISION → CONFIRMED → BOOKED), jsonb `quote`, `consultation`, `vehicle_history` | `schema.sql`, `fix-missing-columns.sql`, `InquiryPage.tsx`, `InquiryConsultation.tsx` | No customer id (customers are matched by phone, `private.phone_key`) — keep that rule |
| Quotation | One `inquiry.quote` (dailyRate, days, discount, extras, deposit, total, status draft/sent/accepted) | `InquiryQuoteBuilder.tsx` | **No quotation id or version.** Revisions overwrite the quote |
| "Agreed terms" | `consultation.agreement` (vehicle, dates, total, advance, deposit, balance due, confirmedVia Call/WhatsApp, confirmedBy) + `agreementHistory` (superseded copies) | `InquiryConsultation.tsx` `confirmTerms` | Staff record the customer's acceptance themselves — no customer evidence. This is what CRC-AGR-003 replaces |
| Booking creation | Staff with `canBook` insert `bookings` **directly** (RLS rule), status `Confirmed` straight away; "Create booking" from the agreement pre-fills the form | `16_staff_roles.sql` L75, `db.ts insertBooking` | No server-side rule ties a booking to an accepted agreement or a verified advance |
| Double-booking | Checked **in the browser only** (`lib/availability.ts`, turnaround by start/end time). Breakdown holds in 07 | `availability.ts`, `07_breakdown_holds.sql` | **No database guard.** Two staff saving at once can double-book. No priority holds exist |
| Payments | Ledger in `bookings.payments` (jsonb). Anyone with `canTakePayments` records money; it counts at once. Company accounts + month close in 18 | `useStore.ts`, `18_company_accounts.sql` | No "payment request", no "reported vs verified" split, no Finance verification step |
| Customer portal | Website "My bookings": phone + SMS code (Supabase Auth phone login, delivered by Text.lk via `portal-sms`); `my_bookings()`, `my_requests()` security-definer RPCs, rate limits | `05_customer_portal.sql`, `functions/portal-login`, `src/components/portal` | Ready to reuse for **identity verification** and **My Agreements** |
| Messaging | WhatsApp Business API is built but **paused until the business is registered**; staff send `wa.me` links. SMS through Text.lk works (`send-sms`, `sms-cron.sql`, pg_cron) | `lib/whatsapp.ts`, `functions/send-sms` | No delivery receipts for `wa.me`. SMS has delivery webhooks |
| Roles | `admin` (Brian, IT) = everything; `staff` logins with abilities (`canBook`, `canTakePayments`, `canViewFinance`, …); owners; customers | `16_staff_roles.sql`, `Permissions.tsx` | IT and the Managing Director have the same power. No Finance-only "verify payment" ability |
| Settings | `app_settings` key/value (staff read, admin write) | 18, agreement design | Good home for the policy values |
| Printed agreement | CRC-AGR-002 designer (PDF background + fields) | `AgreementDesign.tsx`, `lib/agreementTemplate.ts` | Stays the handover agreement. The e-Agreement is a separate document |
| Tests | Node tests against RLS, staff users, webhooks | `security/tests/*.test.mjs` | Extend with agreement / hold / gate tests |

**Main finding:** today the business rules live in the admin app (the browser). The brief requires the backend to enforce them. So every new step must be a **security-definer database function (RPC)** or Edge Function, and the direct table writes that could skip a step must be closed for the new flow.

---

## 2. Design principles

1. **Extend, don't duplicate.** Inquiries stay the customer journey. Bookings stay bookings. Customers stay matched by `private.phone_key(phone)`.
2. **New records live in a private `esign` schema** that no login can read or write directly (re-running 01 can't open it, unlike tables in `public`). All changes go through RPCs that check permissions and state, and write an event row.
3. **Evidence is append-only.** Acceptances, events and accepted snapshots cannot be updated or deleted, by staff or admins (trigger blocks it; only a migration by the database owner could).
4. **Policy values are settings, not code.** Nothing is sent while a required policy value is still blank. Blank means "not approved yet" and blocks sending.
5. **One priority entitlement per inquiry**, moving through stages with deadlines. It is not a new hold per stage.
6. **Old data keeps working.** Bookings and inquiries made before go-live are not touched. Every booking created after go-live passes the gate (D1).

---

## 3. Data model (migration `22_booking_eagreement.sql`)

### 3.1 Quotation versions — `esign.quotations`
`inquiry.quote` stays for the current UI. Each time a quote is **sent**, it is frozen as a row:

`id uuid, reference text unique ('CRC-Q-2026-000123'), inquiry_id, version int, vehicle_id, pickup_at timestamptz, return_at timestamptz, pickup_location, return_location, rental_type, rate, units, included_km, extra_km_rate, extras jsonb, discount, total, advance_required, deposit, valid_until timestamptz, status ('SENT','ACCEPTED','SUPERSEDED','EXPIRED','WITHDRAWN'), accepted_at, created_by, created_at` — unique `(inquiry_id, version)`.

### 3.2 Priority holds — `esign.priority_holds`
`id, inquiry_id, quotation_id, vehicle_id, hold_range tstzrange (pickup − buffer, return + buffer), status ('ACTIVE','CONFIRMED','EXPIRED','RELEASED','CANCELLED'), stage ('AWAITING_AGREEMENT','AWAITING_ADVANCE','PAYMENT_REPORTED','ALLOCATING'), stage_deadline timestamptz, expires_at timestamptz (overall entitlement), released_at, release_reason, created_by, created_at`.

**Concurrency:** `btree_gist` exclusion constraint:
`exclude using gist (vehicle_id with =, hold_range with &&) where (status = 'ACTIVE')`.
Two simultaneous acceptances for an overlapping period: the second insert fails at the database. Bookings get the same guard (§3.7), so a hold also cannot overlap a booking.

**Waiting queue:** `esign.hold_waitlist (inquiry_id, vehicle_id, wanted, status, created_at)` — order = created_at. When a hold ends, the next eligible inquiry is offered (staff notified). It never takes the hold automatically.

### 3.3 Templates — `esign.agreement_templates`
`id, document_code ('CRC-AGR-003'), version, title, sections jsonb (ordered headings + body with {{fields}}), acceptance_statement, status ('DRAFT','APPROVED','RETIRED'), effective_at, approved_by, created_at`. Only one `APPROVED` per code at a time. Approving needs the **business-approval** right (D3). IT can draft but not approve.

### 3.4 Agreements — `esign.agreements`
`id uuid, reference ('CRC-EA-2026-000123') unique, inquiry_id, customer_phone_key, quotation_id, quotation_version, template_id, template_version, version int, snapshot jsonb (every value printed), rendered_html text, document_hash text (SHA-256 of the canonical snapshot + html), pdf_path (private bucket 'agreements'), status ('DRAFT','SENT','VIEWED','ACCEPTED','DECLINED','EXPIRED','SUPERSEDED','REVOKED'), expires_at, superseded_by uuid, generated_by, created_at`.
`NOT_GENERATED` = no row. Unique: one non-final agreement per inquiry (partial unique index on `inquiry_id where status in ('DRAFT','SENT','VIEWED')`).

Once `SENT`, the `snapshot`, `rendered_html` and `document_hash` columns cannot change (trigger). A revision is a **new row** (`version + 1`); the old one becomes `SUPERSEDED` and keeps its history.

### 3.5 Links — `esign.access_tokens`
`id, agreement_id, token_hash text (SHA-256 hex), expires_at, revoked_at, last_used_at, access_attempt_count`. The token is 32 random bytes (base64url, 43 chars), shown **once** when generated, and never stored. The link is `https://ceylonrentacars.lk/booking-agreement/<token>`. Rate limits reuse `private.rate_limits` (per token and per IP).

### 3.6 Evidence — `esign.acceptances`, `esign.events`
- `esign.acceptances`: `agreement_id (unique → idempotent), decision ('ACCEPTED','DECLINED'), decided_at, verification_method ('SMS_OTP_PORTAL_LOGIN' | 'MANUAL_REVIEWED'), verified_phone_key, auth_user_id, acceptance_statement (exact text), accepted_document_hash, decline_reason, evidence jsonb (ip, user agent, token id, template version)`. No codes or secrets.
- `esign.events`: `inquiry_id, agreement_id, event_type (GENERATED, SENT_WHATSAPP_LINK, SENT_SMS, SMS_DELIVERED, SMS_FAILED, LINK_COPIED, VIEWED, OTP_VERIFIED, ACCEPTED, DECLINED, CLARIFICATION_REQUESTED, EXPIRED, REVOKED, SUPERSEDED, MANUAL_ACCEPTANCE_RECORDED …), actor_type ('staff','customer','system'), actor_id, at, metadata jsonb`.
- Both are append-only (update/delete trigger raises).

### 3.7 Payments & allocation
- `esign.payment_requests`: `id, inquiry_id, agreement_id, quotation_id, hold_id, amount, collection_account_id (company_accounts), deadline, status ('REQUESTED','REPORTED','VERIFIED','PARTIAL','LATE','CANCELLED'), requested_by, created_at`.
- `esign.payment_receipts` (what Finance sees): `id, request_id null (null = unsolicited), inquiry_id null, booking_id null, amount, account_id, bank_reference, received_at, reported_by_customer bool, evidence_path (screenshot = supporting only), status ('REPORTED','VERIFIED','REJECTED','DUPLICATE','UNMATCHED','REFUND_DUE','REFUNDED'), verified_by, verified_at, note`.
- `esign.booking_allocations`: the one-time ticket that lets a booking be saved under the gate. `esign.exceptions`: audited exceptions (gate-exempt booking, manual acceptance, conflict override) decided by a business approver who is not the requester.
- **Booking guard:** add `bookings.occupies tstzrange` (filled by a trigger from the start/end date + time) and the same exclusion constraint against other active bookings, plus a check against `ACTIVE` holds of *other* inquiries. Before adding it, the migration **reports** existing overlaps (they're not removed). See decision D2.

### 3.8 Permissions (new abilities, same mechanism as 16)
| Ability | Who (proposed) | Allows |
|---|---|---|
| `canSendAgreements` | Reservations, Buddhi | generate / preview / send / resend / revoke / revise agreements, place holds |
| `canRequestAdvance` | Reservations, Buddhi | issue an advance request (still gated) |
| `canVerifyPayments` | Dinithi | verify / reject / match receipts, refund resolution |
| `canApprovePolicy` (`business_approver`) | Brian | approve templates and policy values, approve the audited conflict exception and the manual-acceptance fallback |
| IT admin | Manodya | configuration and technical admin. **Does not** get `canVerifyPayments` / `canApprovePolicy` by being admin (D3) |

---

## 4. State machines

**Agreement:** `DRAFT → SENT → VIEWED → ACCEPTED | DECLINED`; any of DRAFT/SENT/VIEWED → `EXPIRED` (time), `REVOKED` (staff), `SUPERSEDED` (revision). ACCEPTED → `SUPERSEDED` only through a revision (the evidence stays).

**Hold stage** (one entitlement, `expires_at` caps the whole thing):
`AWAITING_AGREEMENT` (deadline A) → on acceptance `AWAITING_ADVANCE` (deadline B) → customer reports payment `PAYMENT_REPORTED` (deadline C, for Finance) → verified `ALLOCATING` → booking created → hold `CONFIRMED`.
Any missed deadline → `EXPIRED` (pg_cron every 5 min) → release, notify staff, offer the waitlist.

**Payment request gate** — `request_advance(inquiry_id)` refuses unless all of these hold, checked in one transaction with the hold row locked (`for update`):
inquiry exists · phone identified · quotation SENT/ACCEPTED, latest version, `valid_until` > now · agreement ACCEPTED, `quotation_version` and `document_hash` match the current quotation · hold ACTIVE, stage AWAITING_ADVANCE, not past deadline · vehicle still free (no booking / other hold overlap, vehicle active, not in a breakdown) · amount = `quotation.advance_required` (policy) · caller has `canRequestAdvance`.

**Confirmation** — `confirm_booking_from_inquiry(inquiry_id)`: needs a VERIFIED receipt ≥ advance, rechecks all of the above, inserts the booking (the exclusion constraint is the final word), marks the hold CONFIRMED, links `booking.inquiry_id` + `agreement_id`, and notifies. If the insert conflicts, the money stays recorded and a **resolution case** is opened (alternative vehicle / refund), never a silent failure.

**Revision rule** — material fields: vehicle, pickup/return time, total, advance, deposit, included km / extra-km rate, cancellation policy version, specific conditions. Any change to these after SENT ⇒ new quotation version ⇒ the open agreement is SUPERSEDED, the advance request (if any, unpaid) is CANCELLED and the gate re-closes until the new version is accepted.

---

## 5. Interfaces

- **Website `/booking-agreement/:token`** (new page in `src/`, plus a Vercel rewrite): header (CRC, reference, expiry) → 1 Summary → 2 full terms (sections from the template) + "Download PDF" → 3 highlighted conditions → 4 Acceptance. To accept or decline, the customer **signs in with the SMS code to the phone on the inquiry**, reusing `portal-login`. The phone must match `customer_phone_key`, otherwise the page refuses. The checkbox starts unticked. Decline asks for an optional reason. "Ask CRC a question" creates a clarification event and notifies staff. Payment instructions are shown **only after** a valid advance request exists.
- **RPCs for the page** (anon + customer): `agreement_open(token)` returns only that agreement's display data and logs VIEWED. `agreement_decide(token, decision, statement_version, reason)` requires the customer JWT and is idempotent. `agreement_clarify(token, message)`.
- **PDF:** the Edge Function `agreement-pdf` (pdf-lib, runs in Deno) renders the frozen snapshot when the agreement is generated and again at acceptance (with the acceptance block). It stores it in the private `agreements` bucket and records its SHA-256. Customers and staff download through short-lived signed URLs.
- **Admin › Inquiry:** a new **e-Agreement** tab with status, reference, version, linked quotation, generated / sent / viewed / accepted times, method, expiry, history, and actions shown by status and ability. The **Advance payment** tab shows the three gate banners ("Agreement Pending — Advance Request Locked" / "Eligible" / "Priority Expired — Revalidation Required"). The timeline gains the 13 events.
- **Finance:** a "Payments to verify" list (receipts REPORTED/UNMATCHED) with match / verify / reject / duplicate / refund due.
- **Dashboard:** seven counts from the brief. Agreement counts are kept apart from booking counts.
- **Portal › My Agreements:** `my_agreements()` lists reference, related inquiry/booking, document type, status, version, accepted at, booking status, preview, PDF and history. CRC-AGR-002 shows as "Pending handover" until the handover is done.
- **Notifications:** rows in the existing `notifications` table for the assigned employee. SMS to the customer for link, reminders and revision (Text.lk). The WhatsApp option uses a `wa.me` link and is logged as "link opened in WhatsApp by staff", **not** "delivered".

---

## 6. Delivery plan (each stage ends with tests run, not just code)

| Stage | Content | Tests |
|---|---|---|
| 3a | Migration 22: tables, constraints, RLS, append-only triggers, abilities, settings keys (blank) | SQL tests: exclusion constraint under two parallel transactions, append-only, RLS per role |
| 3b | RPCs: quotation freeze, hold place/advance/expire/release, agreement generate/send/revoke/revise, open/decide/clarify, request_advance, receipts, confirm | Node tests per brief scenarios 3–6, 8–10, 14–18, 21–24, 27 |
| 3c | Edge Functions `agreement-pdf`, `agreement-notify` (SMS); pg_cron expiry job | PDF hash stable, expiry job |
| 4 | Customer page `/booking-agreement/:token` | Playwright mobile + desktop: view, decline, accept with code, wrong phone refused, expired refused |
| 5 | Admin e-Agreement + Advance tabs, Finance list, dashboard counts, notifications, timeline | Playwright (demo mode) + gate-bypass attempts from a staff JWT |
| 6 | Portal My Agreements | Playwright |
| 7 | End-to-end inquiry → confirmed booking, exceptions (late pay, unsolicited, owner withdrawal, revision) | Scenario 1–28 checklist |
| 8 | Deploy checklist entry, rollback file, verify.sql additions | Run on a Supabase branch / copy first |

Rough size: a large piece of work, about 4–6 focused sessions. Stages 3a–3b are the foundation and can be reviewed on their own.

---

## 7. Decisions

- **D1 — Which bookings must pass the gate?** **Decided: every new booking.** Walk-ins go through the same steps at the counter (the customer accepts on their phone with the SMS code; cash is recorded as a receipt and verified by a second person). A booking that truly can't (e.g. an owner using their own car) needs an approved **gate exemption** (§3.7).
- **D2 — Existing overlapping bookings.** If the overlap report finds any, they must be fixed or marked as accepted exceptions before the exclusion constraint is turned on.
- **D3 — Split admin power.** **Decided: not yet.** Built as the switch `eagreement_policy.split_admin_approvals`; when turned on, only admins with `business_approver` may approve.
- **D4 — Policy values (Brian):** agreement link validity, hold deadlines A/B/C and overall cap, turnaround buffer, advance rule (% or fixed per category), quotation validity, reminder times, cancellation & refund schedule text + version, approved acceptance statement wording. Until set, sending stays blocked.
- **D5 — Customer identity check:** **Decided: SMS code** through the existing portal login (Text.lk, about 1 SMS per acceptance). The WhatsApp API stays paused.
- **D6 — Collection account:** which `company_accounts` row is the approved advance account. The customer sees its details only after an advance request.

## 7b. How the booking form stays the same (Stage 3b)

The admin booking form keeps working out commissions, company share and the payment ledger. When the advance is verified, `eag_allocate()` issues a one-time **allocation ticket** (a booking id). The form saves the booking with that id; the database refuses it unless the car, the pickup/return times and the bill (total + extras − discount) equal the accepted agreement, then confirms the hold and links everything. A booking that can't come from an inquiry (e.g. an owner using their own car) needs an approved **gate exemption** from a business approver who didn't ask for it.

Resending an agreement makes a **new link** and switches the old one off (the link itself is never stored, so the same link can't be sent again).

## 8. Not possible / out of scope as written

- WhatsApp **delivery status** while the API is paused. Only SMS delivery receipts are real.
- Legal approval of the wording — the system stores the version that was shown; a lawyer must approve the text.
- "Owner authorization" at allocation: owners have no approval step today. Proposed: an owner-withdrawn flag on the vehicle that the allocation checks.
