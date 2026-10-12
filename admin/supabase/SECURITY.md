# Security lockdown — rollout steps

**Why:** row-level security was off on every table and the admin and website share the same
public key (it ships inside the website). Anyone could read or change customers, bookings and
the logins table (plain-text passwords). Admin login was checked in the browser, with a
built-in `admin` / `admin123`.

**After:** staff sign in with Supabase Auth (passwords hashed by Supabase), every table only
answers signed-in staff, the website keeps working through its views + functions, and only
staff can trigger SMS / WhatsApp.

> Do the steps **in order**. Step 5 locks the tables — if the new admin login isn't working by
> then, the admin can't load any data (undo: see the end).

---

## 1. Create your admin login (Supabase dashboard)

1. **Authentication → Users → Add user → Create new user**
   - Email: `admin@staff.ceylonrentacars.com` (you'll sign in with the username **admin**)
   - Password: a strong new password (not `admin123`)
   - Tick **Auto Confirm User**
2. **SQL Editor** — make that login an admin:

   ```sql
   update auth.users
   set raw_app_meta_data = raw_app_meta_data
     || '{"role": "admin", "username": "admin", "name": "Ceylon Admin"}'::jsonb
   where email = 'admin@staff.ceylonrentacars.com';
   ```

   (Another admin later: same two steps with `<username>@staff.ceylonrentacars.com`.)
3. **Authentication → Sign In / Providers → Email:** enabled. Under **User Signups**, turn
   **"Allow new users to sign up" OFF** (staff logins are created by the admin).

## 2. Deploy the Edge Functions

From the `admin` folder:

```
npx supabase functions deploy staff-users --no-verify-jwt
npx supabase functions deploy send-sms --no-verify-jwt
npx supabase functions deploy whatsapp-send --no-verify-jwt
npx supabase functions deploy whatsapp-templates --no-verify-jwt
npx supabase functions deploy whatsapp-onboard --no-verify-jwt
```

After this, SMS / WhatsApp only work from the **new** admin (step 3) — do step 3 right away.

## 3. Deploy the admin app

Commit and push (Vercel deploys it). Open the admin and sign in as **admin** with the password
from step 1. The old `admin` / `admin123` no longer works.

## 4. Move the owner logins

**Settings → Messaging & security → Move old logins.** Owners keep their username and PIN.
Check **Permissions**: each owner shows their username and "Last signed in".

Because the old PINs were readable by anyone, give each owner a new one: **Permissions →
Reset PIN** (shown once — send it to them).

## 5. Lock the database

**SQL Editor → run `admin/supabase/security-lockdown.sql`.** It switches on row-level security
everywhere, keeps the website's views/functions public, locks storage, and deletes the old
plain-text logins table (only if every login was moved in step 4 — otherwise it keeps it and
says so; re-run after moving them).

If the storage part errors with "must be owner of table objects", remove the old rules under
**Storage → Policies** by hand and re-run the file.

## 6. Check

- Admin: sign in, Dashboard / Bookings / Inquiries load, a test edit saves.
- An owner can sign in and sees their vehicles.
- Website `https://ceylonrentacars.com`: vehicles show, a vehicle's details open, a test booking
  request goes through (delete it in the admin afterwards).
- The public key can't read private tables any more — in a terminal:

  ```
  curl "https://<project>.supabase.co/rest/v1/customers?select=id&limit=1" -H "apikey: <anon key>"
  ```
  → `[]` (empty) or 401, not customer rows.

## Undo (emergency only)

If the admin can't load data after step 5 and you need it back immediately, in the SQL Editor:

```sql
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I disable row level security', t.tablename);
  end loop;
end $$;
```

This re-opens the data to the public key — fix the login problem and run step 5 again.

## Still to do later

- **Owners can technically read other owners' data** through the database (the admin screens
  only show their own). Tightening that needs per-owner rules on each table — a follow-up.
- `whatsapp-media` stays public because the admin loads it as an image link; it only serves
  photos that arrived in your WhatsApp conversations.
