-- ============================================================
-- Cabiao SHS Attendance — employee-ID login (7-digit ID = password)
-- 1) employees gains employee_id (unique 7-digit), first_name,
--    middle_name, last_name
-- 2) legacy rows backfilled with random 7-digit IDs
-- 3) admin_register_employee rewritten: admin supplies the 7-digit
--    ID; the auth password is the ID itself
-- 4) admin_update_employee: edit names/email/id/role; changing the
--    ID also resets the auth password to the new ID
-- 5) resolve_login: employee_id -> email for the app login screen
--    (runs before any session exists, so RLS cannot be used)
-- ============================================================

alter table public.employees
  add column employee_id text,
  add column first_name text,
  add column middle_name text,
  add column last_name text;

create unique index if not exists employees_employee_id_key
  on public.employees (employee_id)
  where employee_id is not null;

-- Backfill legacy accounts with random, collision-free 7-digit IDs.
-- Names only exist as full_name in old rows -> first_name = full_name.
do $$
declare
  v_rec record;
  v_id text;
begin
  for v_rec in
    select id, full_name from public.employees
    where employee_id is null
  loop
    loop
      v_id := (1000000 + floor(random() * 9000000))::int::text;
      exit when not exists (
        select 1 from public.employees where employee_id = v_id
      );
    end loop;
    update public.employees
    set employee_id = v_id,
        first_name = v_rec.full_name
    where id = v_rec.id;
  end loop;
end;
$$;

-- Legacy accounts: the employee ID is now the auth password too.
-- (Admins keep their own password — they sign in on the dashboard.)
update auth.users u
set encrypted_password = crypt(e.employee_id, gen_salt('bf')),
    updated_at = now()
from public.employees e
where u.id = e.id
  and e.role = 'employee'
  and e.employee_id is not null;

-- Admin registers an employee. The 7-digit employee ID is the login
-- credential (it is also the auth password), so there is no p_password.
create or replace function public.admin_register_employee(
  p_email text,
  p_employee_id text,
  p_first_name text,
  p_middle_name text default null,
  p_last_name text default null,
  p_role text default 'employee'
) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_admin public.employees;
  v_user_id uuid;
  v_full_name text;
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
    email, employee_id, role
  ) values (
    v_user_id, v_full_name, p_first_name, p_middle_name, p_last_name,
    lower(p_email), p_employee_id, p_role
  );

  return jsonb_build_object(
    'id', v_user_id,
    'email', lower(p_email),
    'employee_id', p_employee_id
  );
end;
$$;

-- Admin edits an employee. Changing the employee ID also changes the
-- auth password (password = employee ID), so the admin must pass the
-- NEW ID here.
create or replace function public.admin_update_employee(
  p_current_employee_id text,
  p_email text,
  p_first_name text,
  p_middle_name text default null,
  p_last_name text default null,
  p_employee_id text default null,
  p_role text default null
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
      role = v_new_role
  where id = v_employee.id;

  return jsonb_build_object(
    'id', v_employee.id,
    'email', lower(p_email),
    'employee_id', v_new_id
  );
end;
$$;

-- Login screen lookup: employee_id -> email. Security definer because
-- the caller has no session yet (RLS would hide every row).
create or replace function public.resolve_login(p_employee_id text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_employee public.employees;
begin
  select * into v_employee
  from public.employees
  where employee_id = p_employee_id and is_active;
  if v_employee is null then raise exception 'employee_not_found'; end if;
  return jsonb_build_object(
    'email', v_employee.email,
    'employee_id', v_employee.employee_id,
    'full_name', v_employee.full_name
  );
end;
$$;

revoke all on function public.resolve_login(text) from public;
grant execute on function public.resolve_login(text) to anon, authenticated;

-- Drop the legacy single-arg overload (003) so admin_unbind_device(email)
-- resolves to the 005 (email, android_id default null) version — otherwise
-- every one-arg call fails with "function is not unique".
drop function if exists public.admin_unbind_device(text);