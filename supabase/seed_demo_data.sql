-- ============================================================
-- seed_demo_data.sql — wipe everything, then seed demo data
-- Departments: Tech-Pro, ABM/STEM, HUMSS, SPORTS, ADMIN, U-SG
-- 18 sample employees (3 per department), dummy @cabiao.test emails.
-- Login password = 7-digit employee ID for every account.
-- Settings (radius, school location, ...) are preserved.
-- Run in the Supabase SQL editor or via the Management API.
-- ============================================================

-- ------------------------------------------------------------------
-- 1) WIPE existing data
-- ------------------------------------------------------------------
delete from public.attendance;
delete from public.devices;
delete from auth.users;   -- cascades to employees (id FK)
delete from public.positions;
delete from public.departments;

-- ------------------------------------------------------------------
-- 2) Departments
-- ------------------------------------------------------------------
insert into public.departments (name, sort_order) values
  ('Tech-Pro', 0),
  ('ABM/STEM', 1),
  ('HUMSS', 2),
  ('SPORTS', 3),
  ('ADMIN', 4),
  ('U-SG', 5);

-- ------------------------------------------------------------------
-- 3) Positions (Teacher + Staff per department)
-- ------------------------------------------------------------------
insert into public.positions (name, department_id, sort_order)
select 'Teacher', id, 0 from public.departments;
insert into public.positions (name, department_id, sort_order)
select 'Staff', id, 1 from public.departments;

-- ------------------------------------------------------------------
-- 4) Sample employees
-- ------------------------------------------------------------------
create temp table _seed (
  email text,
  emp_id text,
  first_name text,
  last_name text,
  role text,
  dept text,
  pos text
);

insert into _seed (email, emp_id, first_name, last_name, role, dept, pos) values
  -- ADMIN
  ('admin@cabiao.test',    '1000001', 'Maria',   'Santos',    'admin',    'ADMIN',   'Teacher'),
  ('admin2@cabiao.test',   '1000052', 'Arlene',  'Domingo',   'employee', 'ADMIN',   'Staff'),
  ('admin3@cabiao.test',   '1000053', 'Joshua',  'Torres',    'employee', 'ADMIN',   'Staff'),
  -- Tech-Pro
  ('techpro1@cabiao.test', '1000011', 'Jomar',   'Reyes',     'employee', 'Tech-Pro', 'Teacher'),
  ('techpro2@cabiao.test', '1000012', 'Althea',  'Cruz',      'employee', 'Tech-Pro', 'Teacher'),
  ('techpro3@cabiao.test', '1000013', 'Kevin',   'Mercado',   'employee', 'Tech-Pro', 'Staff'),
  -- ABM/STEM
  ('abmstem1@cabiao.test', '1000021', 'Bea',     'Ramos',     'employee', 'ABM/STEM', 'Teacher'),
  ('abmstem2@cabiao.test', '1000022', 'Daniel',  'Garcia',    'employee', 'ABM/STEM', 'Teacher'),
  ('abmstem3@cabiao.test', '1000023', 'Sofia',   'Villanueva','employee', 'ABM/STEM', 'Staff'),
  -- HUMSS
  ('humss1@cabiao.test',   '1000031', 'Angelo',  'Bautista',  'employee', 'HUMSS',   'Teacher'),
  ('humss2@cabiao.test',   '1000032', 'Camille', 'Flores',    'employee', 'HUMSS',   'Teacher'),
  ('humss3@cabiao.test',   '1000033', 'Paolo',   'Mendoza',   'employee', 'HUMSS',   'Staff'),
  -- SPORTS
  ('sports1@cabiao.test',  '1000041', 'Renz',    'Aquino',    'employee', 'SPORTS',  'Teacher'),
  ('sports2@cabiao.test',  '1000042', 'Janelle', 'Navarro',   'employee', 'SPORTS',  'Teacher'),
  ('sports3@cabiao.test',  '1000043', 'Mark',    'Dela Cruz', 'employee', 'SPORTS',  'Staff'),
  -- U-SG
  ('usg1@cabiao.test',     '1000061', 'Kate',    'Salvador',  'employee', 'U-SG',    'Teacher'),
  ('usg2@cabiao.test',     '1000062', 'Miguel',  'Pascual',   'employee', 'U-SG',    'Teacher'),
  ('usg3@cabiao.test',     '1000063', 'Nina',    'Domingo',   'employee', 'U-SG',    'Staff');

do $$
declare
  r record;
  v_uid uuid;
  v_full text;
begin
  for r in select * from _seed loop
    v_full := btrim(concat_ws(' ', r.first_name, r.last_name));
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      reauthentication_token, phone_change_token, phone_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      lower(r.email), crypt(r.emp_id, gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '', '', '', '', ''
    ) returning id into v_uid;

    insert into public.employees (
      id, full_name, first_name, middle_name, last_name,
      email, employee_id, role, department_id, position_id
    ) values (
      v_uid, v_full, r.first_name, null, r.last_name,
      lower(r.email), r.emp_id, r.role,
      (select id from public.departments where name = r.dept),
      (select p.id from public.positions p
        join public.departments d on d.id = p.department_id
        where d.name = r.dept and p.name = r.pos)
    );
  end loop;
end $$;

-- ------------------------------------------------------------------
-- 5) Demo attendance for today (via the real check_in/check_out RPCs)
--    3 complete pairs + 4 still clocked in right now
-- ------------------------------------------------------------------
do $$
declare
  v_lat double precision := (select ((value ->> 'lat')::double precision) from public.settings where key = 'school_location');
  v_lng double precision := (select ((value ->> 'lng')::double precision) from public.settings where key = 'school_location');
  v_uid uuid;
begin
  -- techpro1 (Jomar): complete pair
  select id into v_uid from public.employees where email = 'techpro1@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-jomar', 'Jomar phone', true, 'inside', now() - interval '7 hours', null);
  perform public.check_out(v_lat, v_lng, 10, 'demo-jomar', 'Jomar phone', true, 'inside', now() - interval '2 hours', null);

  -- abmstem1 (Bea): complete pair
  select id into v_uid from public.employees where email = 'abmstem1@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-bea', 'Bea phone', true, 'inside', now() - interval '6 hours 30 minutes', null);
  perform public.check_out(v_lat, v_lng, 10, 'demo-bea', 'Bea phone', true, 'inside', now() - interval '30 minutes', null);

  -- admin2 (Arlene): complete pair
  select id into v_uid from public.employees where email = 'admin2@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-arlene', 'Arlene phone', true, 'inside', now() - interval '6 hours', null);
  perform public.check_out(v_lat, v_lng, 10, 'demo-arlene', 'Arlene phone', true, 'inside', now() - interval '3 hours', null);

  -- humss1 (Angelo): still clocked in
  select id into v_uid from public.employees where email = 'humss1@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-angelo', 'Angelo phone', true, 'inside', now() - interval '1 hour 45 minutes', null);

  -- sports1 (Renz): still clocked in
  select id into v_uid from public.employees where email = 'sports1@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-renz', 'Renz phone', true, 'inside', now() - interval '2 hours 15 minutes', null);

  -- usg1 (Kate): still clocked in
  select id into v_uid from public.employees where email = 'usg1@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-kate', 'Kate phone', true, 'inside', now() - interval '50 minutes', null);

  -- techpro2 (Althea): still clocked in
  select id into v_uid from public.employees where email = 'techpro2@cabiao.test';
  perform set_config('request.jwt.claim.sub', v_uid::text, false);
  perform public.check_in(v_lat, v_lng, 10, 'demo-althea', 'Althea phone', true, 'inside', now() - interval '3 hours 30 minutes', null);
end $$;

drop table _seed;