-- 004_fix_rls_recursion.sql
-- The original select policies embedded `exists (select 1 from public.employees ...)`
-- directly, which re-entered the employees policy -> infinite recursion -> 500 on
-- every direct table select as any authenticated user (breaking the app login flow).
-- Fix: a security-definer helper that checks the role WITHOUT triggering RLS.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.employees where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;

drop policy if exists "employees select own or admin" on public.employees;
create policy "employees select own or admin" on public.employees
  for select
  using (
    auth.uid() = id
    or public.is_admin()
  );

drop policy if exists "devices select own or admin" on public.devices;
create policy "devices select own or admin" on public.devices
  for select
  using (
    employee_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "attendance select own or admin" on public.attendance;
create policy "attendance select own or admin" on public.attendance
  for select
  using (
    employee_id = auth.uid()
    or public.is_admin()
  );