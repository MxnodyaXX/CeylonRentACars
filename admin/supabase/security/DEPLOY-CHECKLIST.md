# Security lockdown — deployment checklist

Nothing in this folder has been run against production. Do the steps **in order**, tick each one,
and stop at any step whose check fails (see **Rollback** at the end).

| File | What it does | Undo |
|---|---|---|
| `01_scoped_access.sql` | Row-level security on every table: admins see everything, each owner only their own vehicles / bookings / commissions / customers / money. Website visitors get no table access. Customer files and receipts become private. | `rollback/01_rollback_scoped_access.sql` |
| `02_public_functions.sql` | Booking, feedback and "choose an alternative" functions: rate limits, input checks, server-side price estimate, secret token on alternatives links. | `rollback/02_rollback_public_functions.sql` |
| `03_remove_legacy_logins.sql` | Deletes the old `users` table (plain-text passwords) — refuses unless every old owner login has a matching secure login. | none — **last step** |
| `verify.sql` | Read-only checks. Prints PASS / FAIL for each rule. | — |

**Why:** row-level security was off on every table, and the public key ships inside the website,
so anyone could read or change customers, bookings and the old logins table. Admin login was
checked in the browser (`admin` / `admin123`). SMS / WhatsApp functions could be called by anyone.

---

## 0. Before you start

- [ ] **Backup:** Supabase → Database → Backups (or `pg_dump`). Note the time.
- [ ] **Local tests pass:**
  ```
  cd admin/supabase/security/tests
  npm install
  npm test          # expect: 145 passed · 42 passed · 13 passed · 33 passed, 0 failed
  ```
- [ ] Pick a quiet time (about 30–45 min). Have the owners' phone numbers ready (step 7).

## 1. Admin login and Auth settings (Supabase dashboard)

- [ ] **Authentication → Users → Add user → Create new user**
  - Email `admin@staff.ceylonrentacars.com` (you sign in with username **admin**)
  - A strong **new** password (10+ characters, letters and numbers — not `admin123`)
  - Tick **Auto Confirm User**
- [ ] **SQL Editor** — make it an admin (role lives in `app_metadata`, which users can't edit):
  ```sql
  update auth.users
  set raw_app_meta_data = raw_app_meta_data
    || '{"role": "admin", "username": "admin", "name": "Ceylon Admin"}'::jsonb
  where email = 'admin@staff.ceylonrentacars.com';
  ```
- [ ] **Authentication → Sign In / Providers → Email:** turn **Allow new users to sign up** OFF.
- [ ] Same page (Email provider): **Minimum password length** 10.

## 2. Missing columns

- [ ] SQL Editor → run `admin/supabase/fix-missing-columns.sql` (only adds columns, incl. `inquiries.alt_token`; safe to re-run, and it no longer reopens anything after the lockdown).

## 3. Secrets

- [ ] Reminder cron secret — `send-reminders` now **refuses** every call without it:
  ```
  npx supabase secrets set CRON_SECRET=<long random string>
  ```
- [ ] Check the cron job URL ends in `?key=<the same string>` (see `admin/supabase/sms-cron.sql`).

## 4. Deploy the Edge Functions

From `admin/`:

```
npx supabase functions deploy staff-users --no-verify-jwt
npx supabase functions deploy send-sms --no-verify-jwt
npx supabase functions deploy whatsapp-send --no-verify-jwt
npx supabase functions deploy whatsapp-templates --no-verify-jwt
npx supabase functions deploy whatsapp-onboard --no-verify-jwt
npx supabase functions deploy send-reminders --no-verify-jwt
```

(`--no-verify-jwt` because each function checks the caller itself — staff login, or the cron secret.)

- [ ] Deployed. From now on SMS / WhatsApp only work from the **new** admin — go straight on.

## 5. Public website functions

- [ ] SQL Editor → run `02_public_functions.sql`.
- [ ] Website still works: open the site, submit a test booking request, see it in Inquiries.
- Old "alternatives" links already sent to customers stop working (no token) — resend from the inquiry if someone asks.

## 6. Deploy the admin and the website

- [ ] Commit, push to `main` (Vercel deploys both).
- [ ] Open the admin, sign in as **admin** with the password from step 1. `admin123` no longer works.
- [ ] Settings shows **My password** and **Messaging & security**.

## 7. Move the owner logins

- [ ] **Settings → Move old logins → Check old logins.** Read the list:
  - *will move* — a valid owner login
  - *skipped* — with the reason (admin rows are never moved; bad usernames, missing owners and duplicates are listed)
- [ ] **Move N logins.** Each owner gets a **new temporary password**, shown once → **Copy all**, store it safely until handed over.
- [ ] Send each owner their username + temporary password (phone / in person — not in a group chat).
- [ ] On first sign-in each owner must choose their own password before anything opens.
- [ ] Owners with no old login: **Permissions → Create Login Account**.

## 8. Lock the tables

- [ ] SQL Editor → run `01_scoped_access.sql`.

## 9. Verify

- [ ] SQL Editor → run `verify.sql`. The last result lists every check — **expect 0 FAIL**.
  (It also picks two real owners and checks that neither sees the other's data.)

## 10. Functional checks

| Who | Check | ✓ |
|---|---|---|
| Visitor (private window) | Catalog, vehicle pages and reviews load | |
| Visitor | Booking request goes through (limits: 6 per hour per network, 3 per day per phone number) | |
| Visitor | Feedback form works | |
| Visitor | A fresh alternatives link (sent from the admin after step 6) lets the customer pick a car | |
| Admin | Dashboard, bookings, customers, commissions all load | |
| Admin | Confirm a booking → receipt SMS / email link opens the PDF | |
| Admin | Upload a booking document and open it | |
| Admin | Send a test SMS (unless SMS is paused in Settings) | |
| Owner A | Sees only their vehicles, bookings, commissions, customers | |
| Owner A | Cannot change payout / commission figures | |
| Owner B | Does **not** see owner A's data | |
| Owner | Settings → My password works | |

## 11. Remove the old logins (later, separate step)

When every owner has signed in (**Permissions → Last signed in**):

- [ ] SQL Editor → run `03_remove_legacy_logins.sql`. It deletes `public.users` only if every row has a matching secure login (same username, role owner, same owner). Otherwise it stops and lists what's wrong — fix and re-run.
- [ ] Run `verify.sql` again.

---

## Rollback

Security stays **on** in every rollback.

| Problem | Do |
|---|---|
| Admin or owners can't load data after step 8 | Run `rollback/01_rollback_scoped_access.sql` — any signed-in staff sees everything again (visitors still locked out). Fix, then re-run `01`. |
| Website bookings / feedback fail after step 5 | Run `rollback/02_rollback_public_functions.sql` — previous functions back. Re-run `02` after fixing. |
| New admin can't sign in | Check step 1 SQL ran (`select raw_app_meta_data from auth.users where email like 'admin@%'`). Until fixed, **don't** run step 8. |
| Need the old admin build back | Vercel → Deployments → Promote the previous one (only before step 8 — it doesn't sign in with Supabase Auth). |

`03` can't be undone except from the backup — that's why it comes last.

Re-running an old setup script (`schema.sql`, `website.sql`, `whatsapp.sql`) turns security off again —
if you ever do, run `01`, `02` and `verify.sql` straight after.

## Known limitations

- Old alternatives links (sent before step 6) and old receipt links (public bucket) stop working.
- Receipt links last 30 days.
- A disabled owner's current session can last up to 1 hour (token lifetime) — reduce the JWT expiry in Auth settings if needed.
- Owners see bookings they referred on other owners' vehicles (read-only), but not that owner's name.
- Settling commissions is admin-only.
- "Must change password" is enforced by the admin app, not the database — the temporary password only works for its own owner's data anyway.
- An admin who creates a login through **Create User Profile** sets that password themselves (no forced change).

## Part 2 — closing the last gaps (after steps 1–10)

| Gap | Fix |
|---|---|
| `whatsapp-media` gave a customer's WhatsApp photo / document to anyone with the link | Only a signed-in **admin** gets files; the admin loads them with its login (no shareable link exists) |
| `sms-inbound` / `sms-delivery-webhook` accepted posts from anyone (fake opt-outs / delivery statuses) | Need `?key=<SMS_WEBHOOK_SECRET>` in the URL; refuse everything if the secret isn't set |
| Website AI chat limit lived in memory (reset on every restart) | Limits in the database (`04_assistant_limits.sql`): 25 per 10 min and 80 per day per visitor, **1500 per day for the whole site** |

- [ ] Run `04_assistant_limits.sql` in the SQL Editor (undo: `rollback/04_rollback_assistant_limits.sql`).
- [ ] Webhook secret (make one the same way as CRON_SECRET):
  ```
  npx supabase secrets set SMS_WEBHOOK_SECRET=<random>
  ```
- [ ] Deploy:
  ```
  npx supabase functions deploy vehicle-assistant --no-verify-jwt
  npx supabase functions deploy whatsapp-media --no-verify-jwt
  npx supabase functions deploy sms-inbound --no-verify-jwt
  npx supabase functions deploy sms-delivery-webhook --no-verify-jwt
  ```
- [ ] **Text.lk dashboard** — if inbound SMS / delivery reports are set up there, add `?key=<SMS_WEBHOOK_SECRET>` to the end of both webhook URLs (they are refused without it).
- [ ] Push the admin (the WhatsApp chat now loads photos with the admin's login).
- [ ] Check: the website AI chat answers; in Messages, a customer photo still shows (when WhatsApp is on).

## Part 3 — customer portal ("My Bookings" on the website)

Customers sign in at **/my-bookings** with their phone number + a 6-digit SMS code and see their
bookings (car, dates, status, total / paid / balance) and booking requests. Only numbers that have
booked or enquired get a code. Codes go out through Text.lk with the current sender ID
(`TEXTLK_SENDER_ID`) — changing the sender ID later needs no code change.

- [ ] SQL Editor → run `05_customer_portal.sql` (undo: `rollback/05_rollback_customer_portal.sql`).
- [ ] Deploy:
  ```
  npx supabase functions deploy portal-login --no-verify-jwt
  npx supabase functions deploy portal-sms --no-verify-jwt
  ```
- [ ] **Authentication → Sign In / Providers → Phone:** turn it **on**. Set **SMS OTP expiry** to `600` (10 min) and **OTP length** `6`.
  If it insists on an SMS provider, pick any (e.g. Twilio) with placeholder values — the hook below replaces it.
  Leave **Allow new users to sign up** OFF (portal-login creates customer logins itself).
- [ ] **Authentication → Hooks → Add hook → Send SMS hook** → type **HTTPS** →
  URL `https://oclzkjdcgjddsnkaogsc.supabase.co/functions/v1/portal-sms` → **Generate secret** → copy it → **Create**. Then:
  ```
  npx supabase secrets set PORTAL_SMS_HOOK_SECRET="v1,whsec_...the secret..."
  ```
- [ ] SMS must be **on** in admin Settings (codes aren't sent while it's paused).
- [ ] Push the website (adds the page and the header's **My Bookings** button).
- [ ] Test: open `/my-bookings`, enter a number that has a booking, get the SMS, enter the code → bookings show.
  An unknown number gets "We couldn't find any bookings" and no SMS.

**New sender ID later:** `npx supabase secrets set TEXTLK_SENDER_ID="<new id>"` — used by all SMS, including portal codes.

## Review notes

- **Service key:** only inside Edge Functions (`serviceClient()`); never in `src/` or `admin/src/`. Functions that use it check the caller first (`staffCaller`, admin-only actions, cron secret).
- **Privilege escalation:** roles live in `app_metadata` (server-only). `staff-users` can't create, edit or delete admins, filters permissions to known `can*` flags, and an owner can't change their own `owner_id`, payouts, commission rates or a vehicle's owner (database triggers).
- **Missing authorization:** every table has row-level security; visitors only reach the website views and three functions (`submit_booking_request`, `submit_feedback`, `choose_alternative`); all other functions are closed to visitors.
