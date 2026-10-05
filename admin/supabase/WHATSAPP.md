# WhatsApp inbox — setup guide (Option 1: keep the phone app + add the admin)

This connects the number you **already use in the WhatsApp Business app** to the admin.
Meta calls this **coexistence**. Once it's set up:

- The phone keeps working as it does today. **Calls** stay on the phone, and so do groups and status.
- Every customer chat also appears in the admin's **Messages** page and on each inquiry.
- Replies typed on the phone show up in the admin, and replies sent from the admin show up on the phone.
- Up to 6 months of existing chat history is copied into the admin.

```
Customer ──► Meta ──┬──► WhatsApp Business app (phone, calls)
                    └──► whatsapp-webhook ──► whatsapp_messages ──► Admin (live)
Admin ──► whatsapp-send ──► Meta ──► Customer (also appears on the phone)
```

> **Why "Add phone number" on developers.facebook.com didn't work:** that button only registers
> a number that is **not** on WhatsApp. It refuses a number that is active in the WhatsApp Business app,
> or asks you to delete that account. To keep the app, you connect through Meta's **Embedded Signup**
> pop-up. The admin's **WhatsApp setup** page opens it (step 5 below).

---

## 0. Before you start (check these)

| Requirement | How to check |
|---|---|
| The number uses the **WhatsApp Business** app (green "B" icon), not ordinary WhatsApp | If not, back up chats and switch: WhatsApp Business → *Use a different number?* → it moves your chats over |
| App version **2.24.17 or newer** | Play Store / App Store → update WhatsApp Business |
| Number has been used in the app for **at least 7 days** with real chats | Brand-new numbers are rejected |
| You can open the app on the phone during setup | You confirm in the app with a code |
| Linked devices: WhatsApp **Web / Mac / iPad** still work. **WhatsApp for Windows** doesn't, so unlink it | Settings → Linked devices |

What changes on the phone after connecting: **disappearing messages** and **view-once** are switched off,
and **broadcast lists** become read-only. Chats, calls, groups, catalogue and labels keep working.

---

## 1. Meta Business account + developer app (you've already done part of this)

1. <https://business.facebook.com>: choose or create **Ceylon Rent A Cars**.
   Start **Business verification** (Settings → Security Center). Testing works without it,
   but sending to customers at volume needs it.
2. <https://developers.facebook.com/apps>: open your app (type **Business**).
   If you have none, use *Create app* → **Other** → **Business**.
3. In the app, go to *Add product* → **WhatsApp** → *Set up*, and link it to the business above.
   **Ignore** "API Setup → Add phone number". That's the step you got stuck on, and you don't need it.
4. Go to *Add product* → **Facebook Login for Business** → *Set up*.
5. Go to **App settings → Basic** and fill in:
   - **App domains:** your admin's domain (e.g. `ceylon-admin.vercel.app`)
   - **Privacy policy URL:** e.g. `https://ceylon-rent-a-cars.vercel.app/` (any public page with your policy)
   - Category: *Travel*. Click **Save**.
   - Copy the **App ID** (top of the page) and the **App secret** (*Show*).
6. In **Facebook Login for Business → Settings**:
   - **Login with the JavaScript SDK:** **Yes**
   - **Allowed domains for the JavaScript SDK:** your admin URL, e.g. `https://ceylon-admin.vercel.app`.
     It must be **https**. To test locally, run the admin with `npx vite --https` and add
     `https://localhost:5173`, or simply use the deployed admin.
   - **Valid OAuth redirect URIs:** the same admin URL. Click **Save**.
7. In **Facebook Login for Business → Configurations → Create configuration**:
   - Name: `WhatsApp coexistence`
   - Login variation: **WhatsApp Embedded Signup**
   - Assets: **WhatsApp accounts**. Permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
   - Create it, then copy the **Configuration ID**.
8. The app's **mode** (top bar): leave it in **Development** while you're the only one connecting.
   You're an admin of the app, so that's enough for your own business.

> **If the pop-up later says the app isn't allowed to use this flow:** Meta sometimes restricts
> coexistence onboarding to *Tech Providers*. You can become one (App Dashboard → *WhatsApp → Quickstart →
> "Become a Tech Provider"*: business verification plus app review). The quicker fallback is a Meta partner that
> supports coexistence, such as **360dialog**, **WATI** or **Dualhook**. They run the same pop-up for you; you then
> point their webhook or API at our functions. Tell Claude which one you choose and it will adapt `whatsapp-send`.

## 2. Admin settings

Add to `admin/.env.local` (and to the admin's Vercel environment variables), then restart or redeploy:

```
VITE_META_APP_ID=<App ID from 1.5>
VITE_META_WA_CONFIG_ID=<Configuration ID from 1.7>
```

(`VITE_WHATSAPP_ENABLED=true` comes in step 7. Leave it off until everything is connected.)

## 3. Database

Already done: `admin/supabase/whatsapp.sql`.

## 4. Edge Functions + secrets (Supabase CLI, from the `admin` folder)

```bash
npx supabase login
npx supabase link --project-ref oclzkjdcgjddsnkaogsc

npx supabase functions deploy whatsapp-send    --no-verify-jwt
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
npx supabase functions deploy whatsapp-media   --no-verify-jwt
npx supabase functions deploy whatsapp-onboard --no-verify-jwt
```

**Permanent token:** Business Settings (business.facebook.com) → Users → **System users** → *Add*
(role **Admin**) → *Assign assets*: your **app** (full control). After step 5 below, also assign the
**WhatsApp account** that appears. Then *Generate new token* → choose the app, expiry **Never**, permissions
`whatsapp_business_messaging` + `whatsapp_business_management` → copy it.

```bash
npx supabase secrets set WHATSAPP_TOKEN="<system user token>" \
  WHATSAPP_APP_SECRET="<App secret from 1.5>" \
  WHATSAPP_VERIFY_TOKEN="crc-wa-7f3k29" \
  WHATSAPP_API_VERSION="v23.0"
```

## 5. Webhook

Developer app → **WhatsApp → Configuration** → Webhook → *Edit*:

- **Callback URL:** `https://oclzkjdcgjddsnkaogsc.supabase.co/functions/v1/whatsapp-webhook`
- **Verify token:** `crc-wa-7f3k29` (same as the secret)
- *Verify and save*. Then, under **Webhook fields**, **Subscribe** to all four:
  - `messages`: customer messages and delivery ticks
  - `smb_message_echoes`: replies typed on the phone
  - `history`: old chats copied in
  - `smb_app_state_sync`: contact names from the phone

## 6. Connect the number (the step you were stuck on)

1. In the admin, open **WhatsApp setup** (sidebar, admins only) → **Connect with Meta**.
2. In Meta's pop-up:
   - Log in → choose **Ceylon Rent A Cars** as the business.
   - Choose **"Connect your existing WhatsApp Business app"** (not "create new").
   - Enter the company's WhatsApp number.
3. On the **phone**, open WhatsApp Business. You'll get a message from Facebook/Meta.
   Tap it → **Connect to the Business Platform** → allow **sharing chat history** → confirm with the code shown.
4. Back in the pop-up, click *Finish*. The admin page now shows the **WhatsApp Business Account ID**
   (it's filled in automatically).
5. In Business Settings → System users → your system user → *Assign assets* → add that **WhatsApp account**
   (full control). The token from step 4 then works for it; you don't need a new token.
6. On the admin page, click **Finish setup** (within **24 hours** of connecting, or the chat history can't be copied).
   You should see green ticks for: Find phone number · Subscribe app · Sync contacts · Sync chat history · Check status,
   and **Platform: CLOUD_API**, **On WhatsApp Business app: true**.
7. Copy the **Phone number ID** it shows, then run:
   ```bash
   npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID="<Phone number ID>"
   ```

## 7. Switch on the inbox

Add `VITE_WHATSAPP_ENABLED=true` to `admin/.env.local` (and Vercel), then restart or redeploy.
Open **Messages**: your contacts and history appear as Meta delivers them (history can take a few minutes).
Send yourself a WhatsApp from another phone to test that it appears live.

## 8. Message templates (to start a chat or reply after 24 h)

Create and manage templates in the admin: **Messages → Message templates** (admins only).

One-time setup:

```powershell
npx supabase functions deploy whatsapp-templates --no-verify-jwt
npx supabase secrets set WHATSAPP_WABA_ID=<WhatsApp Business Account ID from the WhatsApp setup page>
npx supabase functions deploy whatsapp-send --no-verify-jwt
```

Then click a ready-made template (or write your own), and click **Submit to Meta for approval**.
The status changes from *In review* to *Approved*, usually within minutes. Approved templates appear
in every chat automatically. Green variables (name, vehicle, dates, reference) fill in from the inquiry;
other variables (e.g. pickup time) are typed by staff when sending.

Choose **Utility** for messages about a specific booking (cheaper, approved faster). Add a payment
method in WhatsApp Manager → Billing before sending templates to customers.

---

## How it behaves

- **Window open** (customer wrote in the last 24 h): type freely in the admin or on the phone. Free of charge.
- **Window closed:** in the admin, pick a template. On the phone you can still message normally (phone messages are free).
- **Ticks:** ✓ sent · ✓✓ delivered · blue ✓✓ read · ⚠ failed (with the reason).
- Messages from the phone show as *"WhatsApp app (phone)"* in the admin.
- Conversations are matched to inquiries by phone number.
- **Calls:** answer and make them on the phone as usual. The API can't take calls for a coexistence number.
- **Keep the phone app open at least once every 14 days**, or Meta disconnects the API side.

## Costs (Sri Lanka = "Rest of Asia Pacific")

Replies within 24 h are free. Templates outside it are charged per delivered message:
Utility ≈ US$0.011, Marketing ≈ US$0.084. Check WhatsApp Manager → Billing for current rates.

## Troubleshooting

| Problem | Fix |
|---|---|
| Pop-up: "domain not allowed" / JSSDK error | Step 1.6: add the exact https admin URL to *Allowed domains* |
| Pop-up has no "existing WhatsApp Business app" option | App version < 2.24.17, number used for less than 7 days, or the app isn't allowed this flow (see the box in step 1) |
| Finish setup: "does WHATSAPP_TOKEN have access" | Step 6.5: assign the WhatsApp account to the system user |
| Sync chat history fails | More than 24 h since connecting. Contacts and new messages still work; history can't be re-synced |
| Nothing arrives in Messages | Step 5 fields subscribed? `WHATSAPP_VERIFY_TOKEN` matches? Check Supabase → Edge Functions → whatsapp-webhook → Logs |
| Send fails "re-engagement" | 24 h window closed. Send a template |

## Security note

Like the rest of MRAC (which uses its own logins, not Supabase Auth), these functions can be called
by anyone who has the project's public key. Before wide use, consider moving the admin to Supabase Auth
and checking the user inside `whatsapp-send` and `whatsapp-onboard`.
