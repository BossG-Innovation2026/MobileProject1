-- ============================================================
-- 009_department_position_fix.sql
-- Fixes the broken department/position feature (008):
-- 1) admin_register_employee no longer throws NOT NULL — new
--    registrations default to the seeded General/Staff rows
-- 2) admin_update_employee can set department_id/position_id
-- 3) admin_create_position / admin_update_position can scope a
--    position to a department (positions.department_id FK)
-- 4) NEW admin_daily_pairs(p_from, p_to): pairs IN/OUT attendance
--    rows per employee for the dashboard live view
-- Must run cleanly even if 008 was already applied.
-- ============================================================

-- Drop the stale overloads whose signatures changed below, so named-arg
-- calls from the dashboard cannot resolve to the broken versions.
drop function if exists public.admin_register_employee(text, text, text, text);
drop function if exists public.admin_register_employee(text, text, text, text, text, text);
drop function if exists public.admin_update_employee(text, text, text, text, text, text, text);
drop function if exists public.admin_create_position(text, integer);
drop function if exists public.admin_update_position(uuid, text, boolean);

-- -------------------------------------------------------------------------
-- Register an employee. Department/position default to the seeded
-- General/Staff rows when not given (employees.department_id/position_id
-- are NOT NULL since 008).
-- -------------------------------------------------------------------------
create or replace function public.admin_register_employee(
  p_email text,
  p_employee_id text,
  p_first_name text,
  p_middle_name text default null,
  p_last_name text default null,
  p_role text default 'employee',
  p_department_id uuid default null,
  p_position_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_admin public.employees;
  v_user_id uuid;
  v_full_name text;
  v_department_id uuid;
  v_position_id uuid;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  if p_role not in ('employee', 'admin') then raise exception 'invalid_role'; end if;
  if p_employee_id !~ '^[0-9]{7}$' then raise exception 'invalid_employee_id: must be a 7-digit number'; end if;
  if exists (select 1 from public.employees where employee_id = p_employee_id) then
    raise exception 'employee_id_taken';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' then raise exception 'first_name_required'; end if;

  v_full_name := btrim(concat_ws(' ', p_first_name, p_middle_name, p_last_name));

  -- Resolve to the seeded defaults when not given; the columns are NOT NULL.
  v_department_id := coalesce(p_department_id,
    (select id from public.departments where name = 'General'));
  v_position_id := coalesce(p_position_id,
    (select id from public.positions where name = 'Staff'));
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'department_not_found';
  end if;
  if p_position_id is not null
     and not exists (select 1 from public.positions where id = p_position_id) then
    raise exception 'position_not_found';
  end if;
  if v_department_id is null then raise exception 'department_not_found: no General department'; end if;
  if v_position_id is null then raise exception 'position_not_found: no Staff position'; end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current,
    reauthentication_token, phone_change_token, phone_change
  ) values (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(), 'authenticated', 'authenticated',
    lower(p_email), crypt(p_employee_id, gen_salt('bf')),
    now(), now(), now(),
    '', '', '', '', '', '', '', ''
  )
  returning id into v_user_id;

  insert into public.employees (
    id, full_name, first_name, middle_name, last_name,
    email, employee_id, role, department_id, position_id
  ) values (
    v_user_id, v_full_name, p_first_name, p_middle_name, p_last_name,
    lower(p_email), p_employee_id, p_role, v_department_id, v_position_id
  );

  return jsonb_build_object(
    'id', v_user_id,
    'email', lower(p_email),
    'employee_id', p_employee_id
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Edit an employee. Department/position are updated only when given
-- (null keeps the current value). Changing the ID resets the auth
-- password to the new ID (password = employee ID).
-- -------------------------------------------------------------------------
create or replace function public.admin_update_employee(
  p_current_employee_id text,
  p_email text,
  p_first_name text,
  p_middle_name text default null,
  p_last_name text default null,
  p_employee_id text default null,
  p_role text default null,
  p_department_id uuid default null,
  p_position_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_admin public.employees;
  v_employee public.employees;
  v_new_id text;
  v_new_role text;
  v_full_name text;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  select * into v_employee from public.employees where employee_id = p_current_employee_id;
  if v_employee is null then raise exception 'employee_not_found'; end if;

  v_new_id := coalesce(p_employee_id, v_employee.employee_id);
  v_new_role := coalesce(p_role, v_employee.role);

  if p_email is null or btrim(p_email) = '' then raise exception 'email_required'; end if;
  if v_new_role not in ('employee', 'admin') then raise exception 'invalid_role'; end if;
  if v_new_id !~ '^[0-9]{7}$' then raise exception 'invalid_employee_id: must be a 7-digit number'; end if;
  if v_new_id <> v_employee.employee_id
     and exists (select 1 from public.employees where employee_id = v_new_id) then
    raise exception 'employee_id_taken';
  end if;
  if p_first_name is null or btrim(p_first_name) = '' then raise exception 'first_name_required'; end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'department_not_found';
  end if;
  if p_position_id is not null
     and not exists (select 1 from public.positions where id = p_position_id) then
    raise exception 'position_not_found';
  end if;

  v_full_name := btrim(concat_ws(' ', p_first_name, p_middle_name, p_last_name));

  update auth.users
  set email = lower(p_email),
      encrypted_password = case when v_new_id <> v_employee.employee_id
                                then crypt(v_new_id, gen_salt('bf'))
                                else encrypted_password end,
      updated_at = now()
  where id = v_employee.id;

  update public.employees
  set email = lower(p_email),
      employee_id = v_new_id,
      first_name = p_first_name,
      middle_name = p_middle_name,
      last_name = p_last_name,
      full_name = v_full_name,
      role = v_new_role,
      department_id = coalesce(p_department_id, v_employee.department_id),
      position_id = coalesce(p_position_id, v_employee.position_id)
  where id = v_employee.id;

  return jsonb_build_object(
    'id', v_employee.id,
    'email', lower(p_email),
    'employee_id', v_new_id
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Admin CRUD: Positions (008 versions could not set department_id)
-- -------------------------------------------------------------------------
create or replace function public.admin_create_position(
  p_name text,
  p_department_id uuid default null,
  p_sort_order int default 0
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_id uuid;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'department_not_found';
  end if;
  insert into public.positions (name, sort_order, department_id)
  values (p_name, p_sort_order, p_department_id)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_update_position(
  p_id uuid,
  p_name text,
  p_is_active boolean,
  p_department_id uuid default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  if p_department_id is not null
     and not exists (select 1 from public.departments where id = p_department_id) then
    raise exception 'department_not_found';
  end if;
  update public.positions
  set name = p_name,
      is_active = p_is_active,
      department_id = coalesce(p_department_id, department_id)
  where id = p_id;
end; $$;

-- -------------------------------------------------------------------------
-- Daily IN/OUT pairs (admin only) — powers the dashboard live view.
-- One row per pair per employee; a trailing IN without an OUT yields
-- NULL out_at/out_mode/out_status/duration_minutes ("currently clocked in").
-- Only pairs whose IN falls inside [p_from, p_to) are shown; an IN
-- before the range is not paired (documented limitation, acceptable for
-- a daily view). Inactive employees are excluded.
-- -------------------------------------------------------------------------
create or replace function public.admin_daily_pairs(p_from timestamptz, p_to timestamptz)
returns table (
  employee_id uuid,
  full_name text,
  department_id uuid,
  department_name text,
  position_id uuid,
  position_name text,
  in_at timestamptz,
  out_at timestamptz,
  in_mode text,
  in_status text,
  out_mode text,
  out_status text,
  duration_minutes int
)
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_emp record;
  v_row record;
  v_open boolean;
  v_in_at timestamptz;
  v_in_mode text;
  v_in_status text;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  for v_emp in
    select distinct e.id as emp_id, e.full_name, e.department_id, e.position_id,
           d.name as department_name, p.name as position_name
    from public.attendance a
    join public.employees e on e.id = a.employee_id
    left join public.departments d on d.id = e.department_id
    left join public.positions p on p.id = e.position_id
    where a.checked_at >= p_from and a.checked_at < p_to
      and e.is_active
    order by e.full_name
  loop
    v_open := false;

    for v_row in
      select a.check_type, a.checked_at, a.mode, a.status
      from public.attendance a
      where a.employee_id = v_emp.emp_id
        and a.checked_at >= p_from and a.checked_at < p_to
      order by a.checked_at
    loop
      if v_row.check_type = 'in' then
        if v_open then
          -- A second IN while a pair is open (possible after admin
          -- overrides): emit the open pair as never checked out first.
          employee_id := v_emp.emp_id;
          full_name := v_emp.full_name;
          department_id := v_emp.department_id;
          department_name := v_emp.department_name;
          position_id := v_emp.position_id;
          position_name := v_emp.position_name;
          in_at := v_in_at;
          in_mode := v_in_mode;
          in_status := v_in_status;
          out_at := null;
          out_mode := null;
          out_status := null;
          duration_minutes := null;
          return next;
        end if;
        v_open := true;
        v_in_at := v_row.checked_at;
        v_in_mode := v_row.mode;
        v_in_status := v_row.status;
      else
        if v_open then
          employee_id := v_emp.emp_id;
          full_name := v_emp.full_name;
          department_id := v_emp.department_id;
          department_name := v_emp.department_name;
          position_id := v_emp.position_id;
          position_name := v_emp.position_name;
          in_at := v_in_at;
          in_mode := v_in_mode;
          in_status := v_in_status;
          out_at := v_row.checked_at;
          out_mode := v_row.mode;
          out_status := v_row.status;
          duration_minutes := round(extract(epoch from (v_row.checked_at - v_in_at)) / 60)::int;
          return next;
          v_open := false;
        end if;
        -- OUT without an open IN inside the range: its IN was before
        -- p_from (or the data was overridden); the pair is not shown.
      end if;
    end loop;

    if v_open then
      employee_id := v_emp.emp_id;
      full_name := v_emp.full_name;
      department_id := v_emp.department_id;
      department_name := v_emp.department_name;
      position_id := v_emp.position_id;
      position_name := v_emp.position_name;
      in_at := v_in_at;
      in_mode := v_in_mode;
      in_status := v_in_status;
      out_at := null;
      out_mode := null;
      out_status := null;
      duration_minutes := null;
      return next;
    end if;
  end loop;
end;
$$;
