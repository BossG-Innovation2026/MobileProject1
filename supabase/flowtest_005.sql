do $$
declare
  r text;
begin
  -- 1) temp1 binds devA
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp1@cabiao.test'),
      'test-devA', 'FlowTest A');
    raise notice 'STEP1 bind devA: OK';
  exception when others then raise notice 'STEP1 bind devA: %', sqlerrm;
  end;

  -- 2) temp1 binds devB (2nd slot)
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp1@cabiao.test'),
      'test-devB', 'FlowTest B');
    raise notice 'STEP2 bind devB: OK';
  exception when others then raise notice 'STEP2 bind devB: %', sqlerrm;
  end;

  -- 3) temp1 binds devC -> max_devices_reached
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp1@cabiao.test'),
      'test-devC', 'FlowTest C');
    raise notice 'STEP3 bind devC: OK (UNEXPECTED)';
  exception when others then raise notice 'STEP3 bind devC: %', sqlerrm;
  end;

  -- 4) temp2 tries devA -> device_bound_to_other_account
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp2@cabiao.test'),
      'test-devA', 'FlowTest A');
    raise notice 'STEP4 temp2 on devA: OK (UNEXPECTED)';
  exception when others then raise notice 'STEP4 temp2 on devA: %', sqlerrm;
  end;

  -- 5) admin unbinds only devA
  begin
    r := public.admin_unbind_device('temp1@cabiao.test', 'test-devA')::text;
    raise notice 'STEP5 unbind devA: %', r;
  exception when others then raise notice 'STEP5 unbind devA: %', sqlerrm;
  end;

  -- 6) temp1 binds devC now
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp1@cabiao.test'),
      'test-devC', 'FlowTest C');
    raise notice 'STEP6 bind devC: OK';
  exception when others then raise notice 'STEP6 bind devC: %', sqlerrm;
  end;

  -- 7) temp2 binds its own fresh phone -> OK
  begin
    perform public.resolve_device(
      (select id from public.employees where email = 'temp2@cabiao.test'),
      'test-temp2phone', 'FlowTest T2');
    raise notice 'STEP7 temp2 own phone: OK';
  exception when others then raise notice 'STEP7 temp2 own phone: %', sqlerrm;
  end;

  -- 8) device_owner still reports correctly
  begin
    r := public.device_owner('test-devB')::text;
    raise notice 'STEP8 device_owner devB: %', r;
  exception when others then raise notice 'STEP8 device_owner devB: %', sqlerrm;
  end;

  -- 9) cleanup: unbind every test phone, keep the real phone
  perform public.admin_unbind_device('temp1@cabiao.test', 'test-devA');
  perform public.admin_unbind_device('temp1@cabiao.test', 'test-devB');
  perform public.admin_unbind_device('temp1@cabiao.test', 'test-devC');
  perform public.admin_unbind_device('temp2@cabiao.test', 'test-temp2phone');
  raise notice 'STEP9 cleanup: done';

  -- 10) final state
  raise notice 'STEP10 remaining devices: %',
    (select count(*) from public.devices where android_id like 'test-%');
end $$;