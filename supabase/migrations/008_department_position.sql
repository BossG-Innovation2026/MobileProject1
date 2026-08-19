-- ============================================================
-- 008_department_position.sql
-- Department & Position lookup tables (admin-defined, user-created)
-- ============================================================

-- Departments lookup table (admin-created, user-defined)
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Positions lookup table (admin-created, optionally scoped to department)
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department_id uuid references public.departments(id) on delete set null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (name, department_id)
);

-- Employees: add nullable FKs (will be backfilled + made NOT NULL)
alter table public.employees
  add column department_id uuid references public.departments(id),
  add column position_id uuid references public.positions(id);

-- Backfill existing employees with a default department + position
do $$
declare
  v_def_dept uuid;
  v_def_pos uuid;
begin
  -- Create default department if not exists
  insert into public.departments (name, sort_order)
  values ('General', 0);

  -- Create default position if not exists
  insert into public.positions (name, sort_order)
  values ('Staff', 0);

  -- Update existing employees
  update public.employees
  set department_id = (select id from public.departments where name = 'General'),
      position_id = (select id from public.positions where name = 'Staff')
  where department_id is null or position_id is null;
end $$;

-- Now make the columns NOT NULL (they are guaranteed populated above)
alter table public.employees
  alter column department_id set not null,
  alter column position_id set not null;

-- RLS: departments + positions readable by all authenticated users
alter table public.departments enable row level security;
alter table public.positions enable row level security;

create policy "departments read" on public.departments for select using (auth.role() = 'authenticated');
create policy "positions read" on public.positions for select using (auth.role() = 'authenticated');

-- -------------------------------------------------------------------------
-- Admin CRUD: Departments
-- -------------------------------------------------------------------------

create or replace function public.admin_create_department(p_name text, p_sort_order int default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_id uuid;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  insert into public.departments (name, sort_order) values (p_name, p_sort_order) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_update_department(p_id uuid, p_name text, p_is_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  update public.departments set name = p_name, is_active = p_is_active where id = p_id;
end; $$;

create or replace function public.admin_toggle_department(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_active boolean;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  update public.departments set is_active = not is_active where id = p_id returning is_active into v_active;
  return case when v_active then 'activated' else 'deactivated' end;
end; $$;

-- -------------------------------------------------------------------------
-- Admin CRUD: Positions
-- -------------------------------------------------------------------------

create or replace function public.admin_create_position(p_name text, p_sort_order int default 0)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_id uuid;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  insert into public.positions (name, sort_order) values (p_name, p_sort_order) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.admin_update_position(p_id uuid, p_name text, p_is_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  update public.positions set name = p_name, is_active = p_is_active where id = p_id;
end; $$;

create or replace function public.admin_toggle_position(p_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_active boolean;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  update public.positions set is_active = not is_active where id = p_id returning is_active into v_active;
  return case when v_active then 'activated' else 'deactivated' end;
end; $$;

-- -------------------------------------------------------------------------
-- Update employee department/position (admin only)
-- -------------------------------------------------------------------------

create or replace function public.admin_set_employee_department_position(p_employee_id uuid, p_department_id uuid, p_position_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin public.employees;
  v_employee public.employees;
begin
  select * into v_admin from public.employees where id = auth.uid();
  if v_admin is null or v_admin.role <> 'admin' then raise exception 'admin_only'; end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee is null then raise exception 'employee_not_found'; end if;
  update public.employees set department_id = p_department_id, position_id = p_position_id where id = v_employee.id;
  return jsonb_build_object('employee_id', p_employee_id, 'department_id', p_department_id, 'position_id', p_position_id);
end; $$;