-- =============================================================================
-- EMRAC Management System — Sample Data Seed
-- Run this AFTER schema.sql to populate the database with demo records.
-- Safe to re-run: uses ON CONFLICT DO NOTHING.
-- =============================================================================

-- ── Owners ───────────────────────────────────────────────────────────────────
insert into owners (id,name,phone,email,commission_rate,total_earnings,pending_payout,created_at) values
  ('o1','Sumod Pieris',   '0758313004','sumod.pieris@email.com', 15,142000,28400,'2024-01-10T00:00:00Z'),
  ('o2','Pavith Bimsara', '0716986695','pavith.bimsara@email.com',15, 98000,14700,'2024-02-15T00:00:00Z'),
  ('o3','Roshan Fernando','0763456789','roshan@email.com',12, 67500, 8100,'2024-03-01T00:00:00Z')
on conflict (id) do nothing;

-- ── Vehicles ─────────────────────────────────────────────────────────────────
insert into vehicles (id,vehicle_number,brand,model,year,owner_id,daily_rent,status,insurance,revenue,rent_count,color,seats,fuel_type,transmission,mileage,created_at) values
  ('v1','CAB-1234','Toyota',    'Prius',   2021,'o1',5500,'Reserved',  '{"provider":"Ceylinco Insurance","policyNumber":"CEY-2024-001","expiryDate":"2025-12-31","premium":45000}',88000,2,'Silver',     5,'Hybrid',  'Automatic',42000,'2024-01-10T00:00:00Z'),
  ('v2','CAD-8899','Suzuki',    'WagonR',  2022,'o2',3500,'Available', '{"provider":"AIA Insurance","policyNumber":"AIA-2024-042","expiryDate":"2025-08-15","premium":32000}',    56000,2,'White',      5,'Petrol',  'Manual',   28000,'2024-02-15T00:00:00Z'),
  ('v3','CBF-5567','Toyota',    'Axio',    2020,'o1',4500,'Ongoing',   '{"provider":"Ceylinco Insurance","policyNumber":"CEY-2024-055","expiryDate":"2026-01-20","premium":38000}',54000,2,'Blue',       5,'Hybrid',  'Automatic',61000,'2024-03-05T00:00:00Z'),
  ('v4','CAA-3312','Honda',     'Fit',     2019,'o3',3800,'Maintenance','{"provider":"Union Assurance","policyNumber":"UA-2024-009","expiryDate":"2025-11-30","premium":29000}',  67500,2,'Red',        5,'Petrol',  'Automatic',79000,'2024-01-20T00:00:00Z'),
  ('v5','CBD-7721','Nissan',    'Dayz',    2023,'o2',4200,'Available', '{"provider":"AIA Insurance","policyNumber":"AIA-2024-101","expiryDate":"2026-05-10","premium":41000}',    42000,2,'Pearl White',4,'Petrol',  'CVT',      11000,'2024-04-01T00:00:00Z'),
  ('v6','CPK-4456','Toyota',    'Premio',  2018,'o1',4800,'Available', '{"provider":"Ceylinco Insurance","policyNumber":"CEY-2024-077","expiryDate":"2026-03-15","premium":36000}',36000,2,'Silver',     5,'Petrol',  'Automatic',88000,'2024-05-10T00:00:00Z'),
  ('v7','CPC-2287','Mitsubishi','Lancer',  2017,'o3',4000,'Available', '{"provider":"Union Assurance","policyNumber":"UA-2024-033","expiryDate":"2025-10-20","premium":31000}',   29500,2,'White',      5,'Petrol',  'Manual',  104000,'2024-06-01T00:00:00Z'),
  ('v8','CBB-9934','Suzuki',    'Alto',    2022,'o2',2800,'Maintenance','{"provider":"AIA Insurance","policyNumber":"AIA-2024-210","expiryDate":"2026-07-30","premium":22000}',    24000,2,'Red',        4,'Petrol',  'Manual',   19000,'2024-07-15T00:00:00Z'),
  ('v9','CAC-6618','Mazda',     'Demio',   2019,'o3',3200,'Available', '{"provider":"Ceylinco Insurance","policyNumber":"CEY-2024-099","expiryDate":"2025-09-05","premium":27000}',19500,2,'Blue',       5,'Petrol',  'Automatic',67000,'2024-08-01T00:00:00Z'),
  ('v10','CBE-3341','Honda',    'Vezel',   2020,'o1',5200,'Reserved',  '{"provider":"Union Assurance","policyNumber":"UA-2024-058","expiryDate":"2026-02-28","premium":44000}',   14000,2,'Grey',       5,'Hybrid',  'CVT',      35000,'2024-09-10T00:00:00Z')
on conflict (id) do nothing;

-- ── Bookings ─────────────────────────────────────────────────────────────────
insert into bookings (id,vehicle_id,customer_id,customer_name,customer_phone,customer_nic,start_date,end_date,total_days,total_amount,paid_amount,status,referral,notes,pickup_location,drop_location,created_at) values
  ('bk1','v1','c1','Amila Jayasinghe', '0712345678','199012345678','2026-05-25','2026-05-28',3,16500,16500,'Confirmed','Brother','Airport pickup required','BIA Airport','Kandy',    '2026-05-20T00:00:00Z'),
  ('bk2','v3','c2','Suresh Kumara',    '0756789012',null,           '2026-05-22','2026-05-26',4,18000, 9000,'Ongoing', 'Direct', null,                   null,          null,        '2026-05-21T00:00:00Z'),
  ('bk3','v2','c3','Priya Fernando',   '0771234000',null,           '2026-05-15','2026-05-18',3,10500,10500,'Completed','Sister',null,                   null,          null,        '2026-05-12T00:00:00Z'),
  ('bk4','v5','c4','Dinesh Wickrama',  '0763344556',null,           '2026-06-01','2026-06-05',4,16800, 8400,'Confirmed','Brother',null,                  null,          null,        '2026-05-24T00:00:00Z')
on conflict (id) do nothing;

-- ── Inquiries ────────────────────────────────────────────────────────────────
insert into inquiries (id,customer_name,customer_phone,requested_vehicle,start_date,end_date,referral,status,notes,created_at) values
  ('inq1','Amila Bandara',         '0712233445','Axio',     '2026-06-01','2026-06-03','Brother',    'Pending',   'Needs AC, prefers white or silver','2026-05-23T00:00:00Z'),
  ('inq2','Kavindi Rathnayake',    '0779988776','Prius',    '2026-06-10','2026-06-14','Direct',     'Pending',   null,                               '2026-05-24T00:00:00Z'),
  ('inq3','Nalinda Dissanayake',   '0765544332','Van / KDH','2026-05-30','2026-06-01','Facebook Ad','Lost',      'Wanted KDH but we don''t have one','2026-05-20T00:00:00Z'),
  ('inq4','Tharaka Senevirathne', '0712987654','WagonR',   '2026-06-05','2026-06-07','Sister',     'Converted', null,                               '2026-05-22T00:00:00Z')
on conflict (id) do nothing;

-- ── Commissions ──────────────────────────────────────────────────────────────
insert into commissions (id,booking_id,vehicle_id,owner_id,referral,total_income,commission_rate,commission_amount,owner_payout,status,created_at) values
  ('cm1','bk1','v1','o1','Brother',16500,15,2475, 14025,'Paid',   '2026-05-20T00:00:00Z'),
  ('cm2','bk2','v3','o1','Direct', 18000,15,2700, 15300,'Pending','2026-05-21T00:00:00Z'),
  ('cm3','bk3','v2','o2','Sister', 10500,15,1575,  8925,'Paid',   '2026-05-15T00:00:00Z'),
  ('cm4','bk4','v5','o2','Brother',16800,15,2520, 14280,'Pending','2026-05-24T00:00:00Z')
on conflict (id) do nothing;

-- ── Expenses ─────────────────────────────────────────────────────────────────
insert into expenses (id,vehicle_id,category,amount,description,date,created_at) values
  ('ex1','v4','Repair', 18500,'Engine mount replacement',   '2026-05-20','2026-05-20T00:00:00Z'),
  ('ex2','v1','Service', 6500,'5000km service + oil change','2026-05-10','2026-05-10T00:00:00Z'),
  ('ex3','v3','Tire',   22000,'2x front tires replaced',    '2026-04-28','2026-04-28T00:00:00Z'),
  ('ex4','v2','Fine',    2500,'Parking fine - Colombo',     '2026-05-14','2026-05-14T00:00:00Z')
on conflict (id) do nothing;

-- ── Drivers ──────────────────────────────────────────────────────────────────
insert into drivers (id,name,phone,license_number,license_expiry,status,daily_rate,total_earnings,current_booking_id,joined_at,nic) values
  ('d1','Chaminda Rajapaksa','0712233111','B1234567','2027-06-30','On Duty',  1500,45000,'bk2','2024-02-01T00:00:00Z','890123456789'),
  ('d2','Lasantha Wickrama', '0776655443','B9876543','2026-09-15','Available',1800,67200,null, '2023-08-15T00:00:00Z','870456789012'),
  ('d3','Rohan Mendis',      '0762211334','B5556789','2025-12-01','Off',      1500,28500,null, '2024-05-01T00:00:00Z','950789012345')
on conflict (id) do nothing;

-- ── Notifications ─────────────────────────────────────────────────────────────
insert into notifications (id,type,title,message,related_id,read,created_at) values
  ('n1','ReturnReminder', 'Vehicle Return Today',     'Suresh Kumara''s booking (Axio CBF-5567) ends today – confirm return.',             'bk2',false,'2026-05-26T07:00:00Z'),
  ('n2','BookingReminder','Upcoming Booking Tomorrow','Amila Jayasinghe picks up Prius CAB-1234 tomorrow from BIA Airport.',               'bk1',false,'2026-05-24T08:00:00Z'),
  ('n3','InsuranceExpiry','Insurance Expiring Soon',  'WagonR CAD-8899 insurance expires on 2025-08-15 – renew before expiry.',           'v2', true, '2026-05-23T09:00:00Z'),
  ('n4','ServiceReminder','Service Due',              'Honda Fit CAA-3312 is due for scheduled service.',                                  'v4', true, '2026-05-22T10:00:00Z')
on conflict (id) do nothing;
