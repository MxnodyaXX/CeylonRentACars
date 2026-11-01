-- Undo 13_partner_applications.sql
-- Removes the applicant functions and the storage rules. The applications table and the uploaded
-- files are KEPT (they hold people's documents and signed agreements) — delete them by hand
-- only if you are sure:
--   drop table public.partner_applications;
--   (Storage → partner-files → delete the files, then the bucket)

drop policy if exists partner_files_insert on storage.objects;
drop policy if exists partner_files_admin on storage.objects;
drop function if exists private.own_partner_folder(text);
drop function if exists public.reply_partner_application(text, text, jsonb, jsonb);
drop function if exists public.my_partner_applications();
drop function if exists public.submit_partner_application(jsonb);

notify pgrst, 'reload schema';
