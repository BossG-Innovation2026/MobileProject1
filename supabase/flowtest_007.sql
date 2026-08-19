create temp table _r (step text, outcome text);

select set_config('request.jwt.claim.sub',
  (select id::text from public.employees where email = 'temp5@cabiao.test'), false);
select set_config('request.jwt.claim.role', 'authenticated', false);

do $$
declare
  v jsonb;
  v_lat double precision := (select ((value ->> 'lat')::double precision) from public.settings where key = 'school_location');
  v_lng double precision := (select ((value ->> 'lng')::double precision) from public.settings where key = 'school_location');
  v_far_lat double precision := v_lat + 0.5;  -- ~55 km away
begin

  -- 1) rules RPC
  v := public.get_check_rules();
  insert into _r values ('1 rules',
    case when (v ->> 'check_radius_m')::double precision = 300
      and (v ->> 'max_gps_accuracy_m')::double precision = 40
      and (v ->> 'school_lat')::double precision is not null
    then 'PASS' else 'FAIL ' || v::text end);

  -- 2) check_in at school -> inside
  v := public.check_in(v_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', now() - interval '4 minutes', null);
  insert into _r values ('2 in@school',
    case when v ->> 'mode' = 'inside' then 'PASS' else 'FAIL ' || v::text end);

  -- 3) check_out at school -> inside
  v := public.check_out(v_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', now() - interval '3 minutes', null);
  insert into _r values ('3 out@school',
    case when v ->> 'mode' = 'inside' then 'PASS' else 'FAIL ' || v::text end);

  -- 4) check_in far away -> accepted, outside
  v := public.check_in(v_far_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', now() - interval '2 minutes', null);
  insert into _r values ('4 in@far',
    case when v ->> 'mode' = 'outside' and (v ->> 'distance_m')::double precision > 300
    then 'PASS' else 'FAIL ' || v::text end);

  -- 5) check_out far away (old p_mode='inside' payload) -> outside, NOT rejected
  v := public.check_out(v_far_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', now() - interval '1 minute', null);
  insert into _r values ('5 out@far-oldmode',
    case when v ->> 'mode' = 'outside' then 'PASS' else 'FAIL ' || v::text end);

  -- 6) accuracy rule still enforced
  begin
    v := public.check_in(v_lat, v_lng, 50, 'flowtest-007a', 'FlowTest', true, 'inside', null, null);
    insert into _r values ('6 accuracy', 'FAIL accepted acc=50: ' || v::text);
  exception when others then
    insert into _r values ('6 accuracy',
      case when sqlerrm like '%gps_accuracy_too_low%' then 'PASS' else 'FAIL ' || sqlerrm end);
  end;

  -- 7) duplicate check-in still rejected (already_checked_in from step 6 rollback? step 6 failed before insert; last record is 'out' -> not_checked_in expected)
  begin
    v := public.check_in(v_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', null, null);
    insert into _r values ('7 second-in', 'PASS (first)' || v::text);
    begin
      v := public.check_in(v_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', null, null);
      insert into _r values ('7 second-in dup', 'FAIL accepted duplicate');
    exception when others then
      insert into _r values ('7 second-in dup',
        case when sqlerrm like '%already_checked_in%' then 'PASS' else 'FAIL ' || sqlerrm end);
    end;
    v := public.check_out(v_lat, v_lng, 10, 'flowtest-007a', 'FlowTest', true, 'inside', null, null);
  exception when others then
    insert into _r values ('7 second-in', 'FAIL ' || sqlerrm);
  end;

  -- 8) clean up flowtest rows + device (unbind as admin)
  delete from public.attendance where device_id in
    (select id from public.devices where android_id = 'flowtest-007a');
  perform set_config('request.jwt.claim.sub',
    (select id::text from public.employees where email = 'innov.proj2026@gmail.com'), false);
  perform public.admin_unbind_device('temp5@cabiao.test', 'flowtest-007a');
  insert into _r values ('8 cleanup',
    case when exists (select 1 from public.devices where android_id = 'flowtest-007a') then 'FAIL' else 'PASS' end);

end $$;

select step, outcome from _r order by step;