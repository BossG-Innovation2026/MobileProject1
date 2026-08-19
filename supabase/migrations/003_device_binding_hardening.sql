-- ============================================================
-- Cabiao SHS Attendance — device binding hardening
-- 1) One account per device id (structural guarantee)
-- 2) resolve_device race-proofing
-- 3) device_owner + admin_unbind_device RPCs
-- ============================================================

-- Max one ACTIVE binding per android_id: two accounts can never own
-- the same phone, even under a simultaneous check-in race.
create unique index if not exists devices_one_account_per_android
  on public.devices (android_id)
  where is_active;

-- Race-proof resolve_device: the unique index above turns a racing
-- double-bind into a unique_violation, converted back to the friendly error.
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
    begin
      insert into public.devices (employee_id, android_id, device_name)
      values (p_employee_id, p_android_id, coalesce(p_device_name, 'Unknown device'))
      returning id into v_device;
    exception
      when unique_violation then
        raise exception 'device_bound_to_other_account';
    end;
  end if;

  return v_device;
end;
$$;

-- Which account currently owns a phone? Used by the app to warn the user
-- that this phone is bound to another account before they try to check in.
create or replace function public.device_owner(p_android_id text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_device public.devices;
  v_employee public.employees;
begin
  select * into v_device
  from public.devices
  where android_id = p_android_id and is_active
  order by bound_at desc limit 1;

  if v_device is null then
    return null;
  end if;

  select * into v_employee from public.employees where id = v_device.employee_id;

  return jsonb_build_object(
    'employee_id', v_employee.id,
    'full_name', v_employee.full_name
  );
end;
$$;

-- Admin: release the device bound to an employee (phone replaced, employee
-- left, etc.) so a new employee can bind to that phone.
create or replace function public.admin_unbind_device(p_employee_email text)
returns jsonb
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
  where device_id in (select id from public.devices where employee_id = v_employee.id);

  delete from public.devices where employee_id = v_employee.id;
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'employee', lower(p_employee_email),
    'devices_removed', v_removed
  );
end;
$$;