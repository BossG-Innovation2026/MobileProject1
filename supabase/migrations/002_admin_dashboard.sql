-- ============================================================
-- Cabiao SHS Attendance — admin dashboard RPCs
-- Run after 001_initial.sql (SQL Editor > New query)
-- ============================================================

-- Who is currently clocked in (admin only)
create or replace function public.admin_current_status()
returns table (
  full_name text,
  email text,
  checked_at timestamptz,
  distance_m double precision
)
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  return query
  select e.full_name, e.email, a.checked_at, a.distance_m
  from (
    select distinct on (employee_id) *
    from public.attendance
    order by employee_id, checked_at desc
  ) a
  join public.employees e on e.id = a.employee_id
  where a.check_type = 'in' and e.is_active
  order by a.checked_at desc;
end;
$$;

-- Update a settings value (admin only)
create or replace function public.admin_update_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  insert into public.settings (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
end;
$$;

-- Activate / deactivate an employee (admin only)
create or replace function public.admin_set_active(p_email text, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_employee public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  select * into v_employee from public.employees where email = lower(p_email);
  if v_employee is null then raise exception 'employee_not_found'; end if;

  update public.employees set is_active = p_active where id = v_employee.id;
end;
$$;