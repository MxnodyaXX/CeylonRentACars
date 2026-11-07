-- Undo 14_wedding_cars.sql
-- Removes the website's view and request function. The vehicles.web_wedding ticks and the inquiries
-- already received are KEPT. To remove the ticks too: alter table public.vehicles drop column web_wedding;

drop function if exists public.submit_wedding_request(jsonb);
drop view if exists public.wedding_vehicles;

notify pgrst, 'reload schema';
