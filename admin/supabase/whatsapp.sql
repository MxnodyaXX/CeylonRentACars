-- =============================================================================
-- Ceylon Rent A Cars — WhatsApp inbox (Meta WhatsApp Cloud API)
-- Run once in the Supabase SQL Editor ("Run without RLS"), after website.sql.
-- Messages are written by the Edge Functions (whatsapp-send / whatsapp-webhook)
-- and shown live in the admin (Messages page + the chat on each inquiry).
-- See WHATSAPP.md for the Meta setup.
-- =============================================================================

create table if not exists whatsapp_messages (
  id          uuid primary key default gen_random_uuid(),
  wa_id       text unique,                         -- Meta message id (wamid.…)
  phone       text not null,                       -- customer number, international digits only (94771234567)
  direction   text not null check (direction in ('in', 'out')),
  kind        text not null default 'text',        -- text | image | document | audio | video | location | template | other
  body        text,                                -- text / caption / template preview
  media_id    text,                                -- Meta media id (served through the whatsapp-media function)
  media_mime  text,
  media_name  text,                                -- document file name
  template    text,                                -- template name for template messages
  status      text not null default 'sent',        -- in: received | out: sent → delivered → read, or failed
  error       text,
  staff       text,                                -- who sent it (outgoing)
  created_at  timestamptz not null default now(),
  status_at   timestamptz
);
create index if not exists whatsapp_messages_phone_idx on whatsapp_messages (phone, created_at desc);

-- One row per customer chat: their WhatsApp profile name and when staff last read it
create table if not exists whatsapp_chats (
  phone        text primary key,
  name         text,
  last_read_at timestamptz
);

-- The admin signs in with its own logins (not Supabase Auth), like the rest of MRAC
alter table whatsapp_messages disable row level security;
alter table whatsapp_chats disable row level security;

-- Live updates in the admin
do $$
begin
  alter publication supabase_realtime add table whatsapp_messages;
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
