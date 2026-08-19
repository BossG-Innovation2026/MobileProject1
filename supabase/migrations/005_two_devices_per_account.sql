-- ============================================================
-- Cabiao SHS Attendance — up to 2 devices per account
-- 1) max_devices_per_account setting (configurable, default 2)
-- 2) resolve_device rewritten to allow N devices per account
-- 3) admin_unbind_device gains per-device unbind (p_android_id)
-- ============================================================

insert into public.settings (key, value)
values ('max_devices_per_account', '2')
on conflict (key) do nothing;

create or replace function public.resolve_device(
  p_employee_id uuid,
  p_android_id text,
  p_device_name text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_device uuid;
  v_max integer;
  v_count integer;
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

  -- already one of this account's devices? reuse it.
  select id into v_device
  from public.devices
  where employee_id = p_employee_id and android_id = p_android_id and is_active;

  if v_device is not null then
    return v_device;
  end if;

  v_max := coalesce(
    public.get_setting('max_devices_per_account')::integer,
    2
  );

  select count(*) into v_count
  from public.devices
  where employee_id = p_employee_id and is_active;

  if v_count >= v_max then
    raise exception 'max_devices_reached: this account already has % device(s) bound (max %)', v_count, v_max;
  end if;

  begin
    insert into public.devices (employee_id, android_id, device_name)
    values (p_employee_id, p_android_id, coalesce(p_device_name, 'Unknown device'))
    returning id into v_device;
  exception
    when unique_violation then
      raise exception 'device_bound_to_other_account';
  end;

  return v_device;
end;
$$;

-- Admin: release devices bound to an employee. When p_android_id is given,
-- only that phone is unbound (an employee with 2 phones can swap one);
-- otherwise all of the employee's devices are released (old behaviour).
create or replace function public.admin_unbind_device(
  p_employee_email text,
  p_android_id text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_employee public.employees;
  v_removed integer;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;

  select * into v_employee from public.employees where email = lower(p_employee_email);
  if v_employee is null then raise exception 'employee_not_found'; end if;

  -- Keep attendance history; just drop the device link so the phone can be reused.
  update public.attendance
  set device_id = null
  where device_id in (
    select id from public.devices
    where employee_id = v_employee.id
      and (p_android_id is null or android_id = p_android_id)
  );

  delete from public.devices
  where employee_id = v_employee.id
    and (p_android_id is null or android_id = p_android_id);
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'employee', lower(p_employee_email),
    'devices_removed', v_removed
  );
end;
$$;