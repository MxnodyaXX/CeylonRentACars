-- Undo 04_assistant_limits.sql. The vehicle-assistant function falls back to its own
-- in-memory limit when this function is missing, so the chat keeps working.
drop function if exists public.assistant_allow(text);
notify pgrst, 'reload schema';
