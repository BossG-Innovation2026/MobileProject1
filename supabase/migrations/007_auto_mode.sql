-- 007: inside/outside is decided by the server from GPS distance.
-- No check is rejected for being far away anymore: <= check_radius_m is
-- recorded as 'inside', beyond it as 'outside'. The app still prompts
-- for a location description when the fix is outside the radius.

update public.settings
set value = '300'::jsonb, updated_at = now()
where key = 'check_radius_m' and (value #>> '{}')::double precision < 300;

-- Rules the mobile app fetches BEFORE recording a check, so it can decide
-- locally (also while offline) whether to ask for a location description.
create or replace function public.get_check_rules()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'school_lat',
      ((select value from public.settings where key = 'school_location') ->> 'lat')::double precision,
    'school_lng',
      ((select value from public.settings where key = 'school_location') ->> 'lng')::double precision,
    'check_radius_m',
      ((select value from public.settings where key = 'check_radius_m') #>> '{}')::double precision,
    'max_gps_accuracy_m',
      ((select value from public.settings where key = 'max_gps_accuracy_m') #>> '{}')::double precision
  );
$$;

grant execute on function public.get_check_rules() to anon, authenticated;

create or replace function public.check_in(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_android_id text,
  p_device_name text,
  p_biometric boolean,
  p_mode text default 'inside',
  p_checked_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_employee public.employees;
  v_device_id uuid;
  v_dist double precision;
  v_radius double precision;
  v_max_acc double precision;
  v_mode text;
  v_last public.attendance;
  v_record public.attendance;
  v_checked_at timestamptz;
begin
  select * into v_employee from public.employees where id = auth.uid() for update;
  if v_employee is null then raise exception 'unauthorized'; end if;
  if not v_employee.is_active then raise exception 'account_disabled'; end if;

  if p_lat is null or p_lng is null then raise exception 'location_missing'; end if;

  -- Offline entries carry their captured time; guard against fabrication.
  v_checked_at := coalesce(p_checked_at, now());
  if v_checked_at > now() + interval '5 minutes' then
    raise exception 'future_timestamp';
  end if;
  if v_checked_at < now() - interval '24 hours' then
    raise exception 'too_old: entries older than 24 hours are rejected';
  end if;

  v_radius  := (public.get_setting('check_radius_m'))::double precision;
  v_max_acc := (public.get_setting('max_gps_accuracy_m'))::double precision;

  if p_accuracy is not null and p_accuracy > v_max_acc then
    raise exception 'gps_accuracy_too_low: %m (max %)', p_accuracy, v_max_acc;
  end if;

  v_dist := public.haversine_m(
    p_lat, p_lng,
    (public.get_setting('school_location') ->> 'lat')::double precision,
    (public.get_setting('school_location') ->> 'lng')::double precision
  );
  v_mode := case when v_dist <= v_radius then 'inside' else 'outside' end;

  v_device_id := public.resolve_device(v_employee.id, p_android_id, p_device_name);

  select * into v_last from public.attendance
  where employee_id = v_employee.id
  order by checked_at desc limit 1;
  if v_last.id is not null and v_last.check_type = 'in' then
    raise exception 'already_checked_in';
  end if;

  if (public.get_setting('enforce_work_hours'))::boolean then
    if localtime < ((public.get_setting('work_start')) #>> '{}')::time
       or localtime > ((public.get_setting('work_end')) #>> '{}')::time then
      raise exception 'outside_work_hours';
    end if;
  end if;

  insert into public.attendance
    (employee_id, device_id, check_type, checked_at, latitude, longitude,
     gps_accuracy, distance_m, biometric_verified, mode, note)
  values
    (v_employee.id, v_device_id, 'in', v_checked_at, p_lat, p_lng,
     p_accuracy, v_dist, coalesce(p_biometric, false), v_mode, p_note)
  returning * into v_record;

  return jsonb_build_object(
    'id', v_record.id,
    'check_type', v_record.check_type,
    'checked_at', v_record.checked_at,
    'distance_m', v_record.distance_m,
    'mode', v_record.mode
  );
end;
$$;

create or replace function public.check_out(
  p_lat double precision,
  p_lng double precision,
  p_accuracy double precision,
  p_android_id text,
  p_device_name text,
  p_biometric boolean,
  p_mode text default 'inside',
  p_checked_at timestamptz default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_employee public.employees;
  v_device_id uuid;
  v_dist double precision;
  v_radius double precision;
  v_max_acc double precision;
  v_mode text;
  v_last public.attendance;
  v_record public.attendance;
  v_checked_at timestamptz;
begin
  select * into v_employee from public.employees where id = auth.uid() for update;
  if v_employee is null then raise exception 'unauthorized'; end if;
  if not v_employee.is_active then raise exception 'account_disabled'; end if;

  if p_lat is null or p_lng is null then raise exception 'location_missing'; end if;

  v_checked_at := coalesce(p_checked_at, now());
  if v_checked_at > now() + interval '5 minutes' then
    raise exception 'future_timestamp';
  end if;
  if v_checked_at < now() - interval '24 hours' then
    raise exception 'too_old: entries older than 24 hours are rejected';
  end if;

  v_radius  := (public.get_setting('check_radius_m'))::double precision;
  v_max_acc := (public.get_setting('max_gps_accuracy_m'))::double precision;

  if p_accuracy is not null and p_accuracy > v_max_acc then
    raise exception 'gps_accuracy_too_low: %m (max %)', p_accuracy, v_max_acc;
  end if;

  v_dist := public.haversine_m(
    p_lat, p_lng,
    (public.get_setting('school_location') ->> 'lat')::double precision,
    (public.get_setting('school_location') ->> 'lng')::double precision
  );
  v_mode := case when v_dist <= v_radius then 'inside' else 'outside' end;

  v_device_id := public.resolve_device(v_employee.id, p_android_id, p_device_name);

  select * into v_last from public.attendance
  where employee_id = v_employee.id
  order by checked_at desc limit 1;
  if v_last.id is null or v_last.check_type = 'out' then
    raise exception 'not_checked_in';
  end if;

  insert into public.attendance
    (employee_id, device_id, check_type, checked_at, latitude, longitude,
     gps_accuracy, distance_m, biometric_verified, mode, note)
  values
    (v_employee.id, v_device_id, 'out', v_checked_at, p_lat, p_lng,
     p_accuracy, v_dist, coalesce(p_biometric, false), v_mode, p_note)
  returning * into v_record;

  return jsonb_build_object(
    'id', v_record.id,
    'check_type', v_record.check_type,
    'checked_at', v_record.checked_at,
    'distance_m', v_record.distance_m,
    'mode', v_record.mode
  );
end;
$$;