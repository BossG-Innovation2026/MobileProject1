-- ============================================================
-- flowtest_009.sql — department/position fix + admin_daily_pairs
-- Run AFTER 009_department_position_fix.sql.
-- Must run as a real admin from the DB (same one flowtest_007 uses).
-- Steps:
--   1) register employee WITHOUT dept/position -> General/Staff defaults
--   2) register WITH explicit department/position -> persisted
--   3) admin_update_employee changes dept/position -> persisted
--   4) admin_create_position(p_name, p_department_id) scoped to dept;
--      admin_update_position moves it to another department
--   5) two employees check in/out -> admin_daily_pairs returns one pair
--      per employee (complete pair + trailing IN); an employee with no
--      attendance is absent from the result
--   6) admin_current_status still reports the clocked-in list
--   7) cleanup deletes all flowtest rows
-- ============================================================

create temp table _r (step text, outcome text);

select set_config('request.jwt.claim.sub',
  (select id::text from public.employees where email = 'innov.proj2026@gmail.com'), false);
select set_config('request.jwt.claim.role', 'authenticated', false);

do $$
declare
  v jsonb;
  v_lat double precision := (select ((value ->> 'lat')::double precision) from public.settings where key = 'school_location');
  v_lng double precision := (select ((value ->> 'lng')::double precision) from public.settings where key = 'school_location');
  v_dept uuid;
  v_pos uuid;
  v_pos2 uuid;
  v_emp_a uuid;
  v_emp_b uuid;
  v_emp_c uuid;
begin

  -- Pre-clean leftovers from a previous run
  delete from public.attendance
  where employee_id in (select id from public.employees where email like 'ft009%@cabiao.test');
  delete from public.devices
  where employee_id in (select id from public.employees where email like 'ft009%@cabiao.test');
  delete from auth.users where email in ('ft009a@cabiao.test', 'ft009b@cabiao.test', 'ft009c@cabiao.test');
  delete from public.positions where name like 'FT Nine %';
  delete from public.departments where name = 'FT Nine Dept';

  -- 1) register WITHOUT dept/position -> seeded General/Staff defaults
  v := public.admin_register_employee('ft009a@cabiao.test', '9000911', 'Flow Nine A', null, null, 'employee');
  v_emp_a := (v ->> 'id')::uuid;
  insert into _r values ('1 register-no-dept',
    case when (select department_id from public.employees where id = v_emp_a) =
                (select id from public.departments where name = 'General')
      and (select position_id from public.employees where id = v_emp_a) =
                (select id from public.positions where name = 'Staff')
    then 'PASS' else 'FAIL' end);

  -- 2) register WITH explicit department/position -> persisted
  v_dept := public.admin_create_department('FT Nine Dept');
  v_pos := public.admin_create_position('FT Nine Pos', v_dept);
  v := public.admin_register_employee('ft009b@cabiao.test', '9000922', 'Flow Nine B', null, null, 'employee', v_dept, v_pos);
  v_emp_b := (v ->> 'id')::uuid;
  insert into _r values ('2 register-with-dept',
    case when (select department_id from public.employees where id = v_emp_b) = v_dept
      and (select position_id from public.employees where id = v_emp_b) = v_pos
    then 'PASS' else 'FAIL' end);

  -- 3) admin_update_employee changes dept/position
  perform public.admin_update_employee('9000922', 'ft009b@cabiao.test', 'Flow Nine B', null, null, '9000922', 'employee',
    (select id from public.departments where name = 'General'),
    (select id from public.positions where name = 'Staff'));
  insert into _r values ('3 update-dept',
    case when (select department_id from public.employees where employee_id = '9000922') =
                (select id from public.departments where name = 'General')
      and (select position_id from public.employees where employee_id = '9000922') =
                (select id from public.positions where name = 'Staff')
    then 'PASS' else 'FAIL' end);

  -- 3b) null dept/position params leave the columns unchanged
  perform public.admin_update_employee('9000922', 'ft009b@cabiao.test', 'Flow Nine B', null, null, '9000922', 'employee');
  insert into _r values ('3b update-null-keeps',
    case when (select department_id from public.employees where employee_id = '9000922') =
                (select id from public.departments where name = 'General')
      and (select position_id from public.employees where employee_id = '9000922') =
                (select id from public.positions where name = 'Staff')
    then 'PASS' else 'FAIL' end);

  -- 4) admin_create_position(p_name, p_department_id) scopes the position
  v_pos2 := public.admin_create_position('FT Nine Pos 2', v_dept);
  insert into _r values ('4 create-position-scoped',
    case when (select department_id from public.positions where id = v_pos2) = v_dept
    then 'PASS' else 'FAIL' end);

  -- 4b) admin_update_position moves it to another department
  perform public.admin_update_position(v_pos2, 'FT Nine Pos 2', true,
    (select id from public.departments where name = 'General'));
  insert into _r values ('4b update-position-dept',
    case when (select department_id from public.positions where id = v_pos2) =
                (select id from public.departments where name = 'General')
    then 'PASS' else 'FAIL' end);

  -- 5) attendance + admin_daily_pairs
  v := public.admin_register_employee('ft009c@cabiao.test', '9000933', 'Flow Nine C', null, null, 'employee');
  v_emp_c := (v ->> 'id')::uuid;

  -- employee A: complete pair (in @ -4 min, out @ -3 min)
  perform set_config('request.jwt.claim.sub', v_emp_a::text, false);
  v := public.check_in(v_lat, v_lng, 10, 'ft009-dev-a', 'FT Nine A', true, 'inside', now() - interval '4 minutes', null);
  v := public.check_out(v_lat, v_lng, 10, 'ft009-dev-a', 'FT Nine A', true, 'inside', now() - interval '3 minutes', null);

  -- employee B: trailing IN (still clocked in)
  perform set_config('request.jwt.claim.sub', v_emp_b::text, false);
  v := public.check_in(v_lat, v_lng, 10, 'ft009-dev-b', 'FT Nine B', true, 'inside', now() - interval '2 minutes', null);

  -- back to admin for the admin-only reads
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.employees where email = 'innov.proj2026@gmail.com'), false);

  insert into _r values ('5 pairs-ours-only',
    case when (select count(*) from public.admin_daily_pairs(now() - interval '1 hour', now())
      where employee_id in (v_emp_a, v_emp_b, v_emp_c)) = 2
    then 'PASS' else 'FAIL' end);

  insert into _r values ('5 pair-a-complete',
    case when exists (select 1 from public.admin_daily_pairs(now() - interval '1 hour', now())
      where employee_id = v_emp_a
        and full_name = 'Flow Nine A'
        and in_at is not null and out_at is not null
        and duration_minutes = 1)
    then 'PASS' else 'FAIL' end);

  insert into _r values ('5 pair-b-open',
    case when exists (select 1 from public.admin_daily_pairs(now() - interval '1 hour', now())
      where employee_id = v_emp_b
        and in_at is not null and out_at is null
        and out_mode is null and out_status is null and duration_minutes is null)
    then 'PASS' else 'FAIL' end);

  insert into _r values ('5 pair-c-absent',
    case when not exists (select 1 from public.admin_daily_pairs(now() - interval '1 hour', now())
      where employee_id = v_emp_c)
    then 'PASS' else 'FAIL' end);

  -- 6) admin_current_status unchanged behaviour: only B is clocked in
  insert into _r values ('6 current-status',
    case when exists (select 1 from public.admin_current_status() where email = 'ft009b@cabiao.test')
      and not exists (select 1 from public.admin_current_status() where email = 'ft009a@cabiao.test')
      and not exists (select 1 from public.admin_current_status() where email = 'ft009c@cabiao.test')
    then 'PASS' else 'FAIL' end);

  -- 7) cleanup: drop every flowtest row (auth cascade removes employees,
  --    attendance and devices)
  delete from public.attendance where employee_id in (v_emp_a, v_emp_b, v_emp_c);
  delete from public.devices where employee_id in (v_emp_a, v_emp_b, v_emp_c);
  delete from auth.users where id in (v_emp_a, v_emp_b, v_emp_c);
  delete from public.positions where id in (v_pos, v_pos2);
  delete from public.departments where id = v_dept;
  insert into _r values ('7 cleanup',
    case when not exists (select 1 from public.employees where email like 'ft009%@cabiao.test')
      and not exists (select 1 from public.devices where android_id like 'ft009-%')
      and not exists (select 1 from public.positions where name like 'FT Nine %')
      and not exists (select 1 from public.departments where name = 'FT Nine Dept')
    then 'PASS' else 'FAIL' end);

end $$;

select step, outcome from _r order by step;
