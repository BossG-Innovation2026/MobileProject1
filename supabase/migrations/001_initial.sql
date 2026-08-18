-- ============================================================
-- Cabiao SHS Attendance — initial schema
-- Run this in the Supabase SQL editor (Dashboard > SQL > New query)
-- All location/device validation happens SERVER-SIDE here so the
-- app cannot fake a check-in.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Employees (1:1 with Supabase Auth user)
-- ------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text not null unique,
  role text not null default 'employee' check (role in ('employee', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Devices (one Android phone bound to one employee)
-- ------------------------------------------------------------
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  android_id text not null,
  device_name text,
  is_active boolean not null default true,
  bound_at timestamptz not null default now(),
  unique (employee_id, android_id)
);

-- ------------------------------------------------------------
-- Attendance records
-- ------------------------------------------------------------
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  device_id uuid references public.devices (id),
  check_type text not null check (check_type in ('in', 'out')),
  checked_at timestamptz not null default now(),
  latitude double precision not null,
  longitude double precision not null,
  gps_accuracy double precision,
  distance_m double precision,
  biometric_verified boolean not null default true,
  mode text not null default 'inside' check (mode in ('inside', 'outside')),
  status text not null default 'valid' check (status in ('valid', 'overridden')),
  note text,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Configurable settings (editable from the admin dashboard)
-- ------------------------------------------------------------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Seed defaults.
-- IMPORTANT: update school_location to the actual coordinates of
-- Cabiao Senior High School before going live.
insert into public.settings (key, value) values
  ('school_location',   '{"lat": 15.2447, "lng": 120.9416}'::jsonb),
  ('check_radius_m',    '150'::jsonb),
  ('max_gps_accuracy_m','40'::jsonb),
  ('enforce_work_hours','false'::jsonb),
  ('work_start',        '"08:00"'::jsonb),
  ('work_end',          '"17:00"'::jsonb),
  ('biometric_required','true'::jsonb)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

-- Haversine distance between two coordinates, in meters.
create or replace function public.haversine_m(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable parallel safe
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians($3 - $1) / 2), 2) +
    cos(radians($1)) * cos(radians($3)) *
    power(sin(radians($4 - $2) / 2), 2)
  ));
$$;

create or replace function public.get_setting(p_key text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select value from public.settings where key = p_key;
$$;

-- ------------------------------------------------------------
-- Device resolution + binding (used by check_in / check_out)
-- ------------------------------------------------------------
create or replace function public.resolve_device(
  p_employee_id uuid,
  p_android_id text,
  p_device_name text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_device uuid;
begin
  if p_android_id is null or p_android_id = '' then
    raise exception 'device_identity_missing';
  end if;

  -- this phone already bound to a different account?
  if exists (
    select 1 from public.devices
    where android_id = p_android_id and employee_id <> p_employee_id and is_active
  ) then
    raise exception 'device_bound_to_other_account';
  end if;

  -- this account already bound to a different phone?
  if exists (
    select 1 from public.devices
    where employee_id = p_employee_id and is_active and android_id <> p_android_id
  ) then
    raise exception 'device_mismatch: use the phone bound to this account';
  end if;

  select id into v_device
  from public.devices
  where employee_id = p_employee_id and android_id = p_android_id and is_active;

  if v_device is null then
    insert into public.devices (employee_id, android_id, device_name)
    values (p_employee_id, p_android_id, coalesce(p_device_name, 'Unknown device'))
    returning id into v_device;
  end if;

  return v_device;
end;
$$;

-- ------------------------------------------------------------
-- check_in / check_out — the ONLY way attendance rows are created
-- ------------------------------------------------------------
create or replace function public.check_in(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_android_id text,
  p_device_name text,
  p_biometric boolean,
  p_mode text default 'inside',
  p_checked_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_employee public.employees;
  v_device_id uuid;
  v_dist double precision;
  v_radius double precision;
  v_max_acc double precision;
  v_last public.attendance;
  v_record public.attendance;
  v_checked_at timestamptz;
begin
  select * into v_employee from public.employees where id = auth.uid() for update;
  if v_employee is null then raise exception 'unauthorized'; end if;
  if not v_employee.is_active then raise exception 'account_disabled'; end if;

  if p_lat is null or p_lng is null then raise exception 'location_missing'; end if;
  if p_mode not in ('inside', 'outside') then raise exception 'invalid_mode'; end if;

  -- Offline entries carry their captured time; guard against fabrication.
  v_checked_at := coalesce(p_checked_at, now());
  if v_checked_at > now() + interval '5 minutes' then
    raise exception 'future_timestamp';
  end if;
  if v_checked_at < now() - interval '24 hours' then
    raise exception 'too_old: entries older than 24 hours are rejected';
  end if;

  v_radius  := (public.get_setting('check_radius_m'))::double precision;
  v_max_acc := (public.get_setting('max_gps_accuracy_m'))::double precision;

  if p_accuracy is not null and p_accuracy > v_max_acc then
    raise exception 'gps_accuracy_too_low: %m (max %)', p_accuracy, v_max_acc;
  end if;

  -- Radius rule only applies when physically inside the school grounds.
  if p_mode = 'inside' then
    v_dist := public.haversine_m(
      p_lat, p_lng,
      (public.get_setting('school_location') ->> 'lat')::double precision,
      (public.get_setting('school_location') ->> 'lng')::double precision
    );
    if v_dist > v_radius then
      raise exception 'outside_radius: %m from school (max %)', round(v_dist), round(v_radius);
    end if;
  else
    v_dist := public.haversine_m(
      p_lat, p_lng,
      (public.get_setting('school_location') ->> 'lat')::double precision,
      (public.get_setting('school_location') ->> 'lng')::double precision
    );
  end if;

  v_device_id := public.resolve_device(v_employee.id, p_android_id, p_device_name);

  select * into v_last from public.attendance
  where employee_id = v_employee.id
  order by checked_at desc limit 1;
  if v_last.id is not null and v_last.check_type = 'in' then
    raise exception 'already_checked_in';
  end if;

  if (public.get_setting('enforce_work_hours'))::boolean then
    if localtime < ((public.get_setting('work_start')) #>> '{}')::time
       or localtime > ((public.get_setting('work_end')) #>> '{}')::time then
      raise exception 'outside_work_hours';
    end if;
  end if;

  insert into public.attendance
    (employee_id, device_id, check_type, checked_at, latitude, longitude,
     gps_accuracy, distance_m, biometric_verified, mode, note)
  values
    (v_employee.id, v_device_id, 'in', v_checked_at, p_lat, p_lng,
     p_accuracy, v_dist, coalesce(p_biometric, false), p_mode, p_note)
  returning * into v_record;

  return jsonb_build_object(
    'id', v_record.id,
    'check_type', v_record.check_type,
    'checked_at', v_record.checked_at,
    'distance_m', v_record.distance_m,
    'mode', v_record.mode
  );
end;
$$;

create or replace function public.check_out(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_android_id text,
  p_device_name text,
  p_biometric boolean,
  p_mode text default 'inside',
  p_checked_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_employee public.employees;
  v_device_id uuid;
  v_dist double precision;
  v_radius double precision;
  v_max_acc double precision;
  v_last public.attendance;
  v_record public.attendance;
  v_checked_at timestamptz;
begin
  select * into v_employee from public.employees where id = auth.uid() for update;
  if v_employee is null then raise exception 'unauthorized'; end if;
  if not v_employee.is_active then raise exception 'account_disabled'; end if;

  if p_lat is null or p_lng is null then raise exception 'location_missing'; end if;
  if p_mode not in ('inside', 'outside') then raise exception 'invalid_mode'; end if;

  v_checked_at := coalesce(p_checked_at, now());
  if v_checked_at > now() + interval '5 minutes' then
    raise exception 'future_timestamp';
  end if;
  if v_checked_at < now() - interval '24 hours' then
    raise exception 'too_old: entries older than 24 hours are rejected';
  end if;

  v_radius  := (public.get_setting('check_radius_m'))::double precision;
  v_max_acc := (public.get_setting('max_gps_accuracy_m'))::double precision;

  if p_accuracy is not null and p_accuracy > v_max_acc then
    raise exception 'gps_accuracy_too_low: %m (max %)', p_accuracy, v_max_acc;
  end if;

  v_dist := public.haversine_m(
    p_lat, p_lng,
    (public.get_setting('school_location') ->> 'lat')::double precision,
    (public.get_setting('school_location') ->> 'lng')::double precision
  );
  if p_mode = 'inside' and v_dist > v_radius then
    raise exception 'outside_radius: %m from school (max %)', round(v_dist), round(v_radius);
  end if;

  v_device_id := public.resolve_device(v_employee.id, p_android_id, p_device_name);

  select * into v_last from public.attendance
  where employee_id = v_employee.id
  order by checked_at desc limit 1;
  if v_last.id is null or v_last.check_type = 'out' then
    raise exception 'not_checked_in';
  end if;

  insert into public.attendance
    (employee_id, device_id, check_type, checked_at, latitude, longitude,
     gps_accuracy, distance_m, biometric_verified, mode, note)
  values
    (v_employee.id, v_device_id, 'out', v_checked_at, p_lat, p_lng,
     p_accuracy, v_dist, coalesce(p_biometric, false), p_mode, p_note)
  returning * into v_record;

  return jsonb_build_object(
    'id', v_record.id,
    'check_type', v_record.check_type,
    'checked_at', v_record.checked_at,
    'distance_m', v_record.distance_m,
    'mode', v_record.mode
  );
end;
$$;

-- ------------------------------------------------------------
-- Admin RPCs (used by the web dashboard)
-- ------------------------------------------------------------

-- Register an employee: creates the auth user + employee row.
create or replace function public.admin_register_employee(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text default 'employee'
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_admin public.employees;
  v_user_id uuid;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  if p_role not in ('employee', 'admin') then raise exception 'invalid_role'; end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change_token, phone_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(), 'authenticated', 'authenticated',
    lower(p_email), crypt(p_password, gen_salt('bf')),
    now(), now(), now(),
    '', '', '', '', '', '', '', ''
  )
  returning id into v_user_id;

  insert into public.employees (id, full_name, email, role)
  values (v_user_id, p_full_name, lower(p_email), p_role);

  return jsonb_build_object('id', v_user_id, 'email', lower(p_email));
end;
$$;

-- Manually fix/correct an attendance record (GPS failure, etc.)
create or replace function public.admin_override(
  p_employee_email text,
  p_check_type text,
  p_checked_at timestamptz,
  p_note text,
  p_mode text default 'inside'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_employee public.employees;
  v_record public.attendance;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  if p_check_type not in ('in', 'out') then raise exception 'invalid_type'; end if;
  if p_mode not in ('inside', 'outside') then raise exception 'invalid_mode'; end if;

  select * into v_employee from public.employees where email = lower(p_employee_email);
  if v_employee is null then raise exception 'employee_not_found'; end if;

  insert into public.attendance
    (employee_id, check_type, checked_at, latitude, longitude, biometric_verified, mode, status, note)
  values
    (v_employee.id, p_check_type, p_checked_at, 0, 0, false, p_mode, 'overridden', coalesce(p_note, 'manual override'))
  returning * into v_record;

  return jsonb_build_object('id', v_record.id, 'status', v_record.status);
end;
$$;

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------
alter table public.employees  enable row level security;
alter table public.devices    enable row level security;
alter table public.attendance enable row level security;
alter table public.settings   enable row level security;

-- Employees: read own row; admins read all. No direct writes (handled by RPCs/service role).
drop policy if exists "employees select own or admin" on public.employees;
create policy "employees select own or admin" on public.employees
  for select
  using (
    auth.uid() = id
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "devices select own or admin" on public.devices;
create policy "devices select own or admin" on public.devices
  for select
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "attendance select own or admin" on public.attendance;
create policy "attendance select own or admin" on public.attendance
  for select
  using (
    employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id = auth.uid() and e.role = 'admin')
  );

drop policy if exists "settings read" on public.settings;
create policy "settings read" on public.settings
  for select using (auth.role() = 'authenticated');

-- Strip direct write access; attendance rows may ONLY come from the RPCs above.
revoke all on public.attendance from anon, authenticated;
grant  select on public.attendance to authenticated;
revoke all on public.devices    from anon, authenticated;
grant  select on public.devices to authenticated;
revoke all on public.employees  from anon, authenticated;
grant  select on public.employees to authenticated;