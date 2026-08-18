# Cabiao SHS Employee Attendance

Android attendance app with GPS geofence validation, biometric/device-lock
verification, and one-phone-per-employee device binding.

```
Android app (Kotlin + Jetpack Compose)
      │  REST (Supabase anon key, RLS-protected)
      ▼
Supabase (free tier — Postgres + Auth)
      │  server-side validation: radius, GPS accuracy, device binding
      ▼
Admin web dashboard (later phase — Netlify/Vercel, free)
```

## Repository layout

| Path | Contents |
|---|---|
| `supabase/migrations/001_initial.sql` | Full database schema + validation RPCs. Run once in the Supabase SQL editor |
| `android/` | Android Studio project (Kotlin, Compose, Material 3) |

## Why server-side validation?

The phone cannot be trusted to enforce rules — anyone could modify the app.
So all rules live in Postgres RPC functions (`check_in`, `check_out`):

- employee must exist, be active, and be logged in (`auth.uid()`)
- GPS fix must be within `check_radius_m` of `school_location` (haversine)
- GPS accuracy must be ≤ `max_gps_accuracy_m`
- the phone's Android ID must match the device bound to the account
  (binds automatically on first check-in; mismatches are rejected)
- attendance rows can ONLY be inserted through these functions
  (direct table writes are revoked from the app role)

## 1. Set up Supabase (free)

1. Create a project at https://supabase.com (free tier)
2. Open **SQL Editor → New query**, paste the contents of
   `supabase/migrations/001_initial.sql`, run it
3. Update the school coordinates:
   ```sql
   update public.settings
   set value = '{"lat": 15.2447, "lng": 120.9416}'::jsonb
   where key = 'school_location';
   ```
   (get the real Cabiao Senior High School coordinates from Google Maps —
   right-click the school gate → copy coordinates)
4. Create the first employee (an admin) from
   **Authentication → Users → Add user** (email + password).
   Copy the new user's UUID, then:
   ```sql
   insert into public.employees (id, full_name, email, role)
   values ('<user-uuid>', 'Admin Name', 'admin@school.edu.ph', 'admin');
   ```

More employees can be added with the `admin_register_employee(email,
password, full_name, role)` RPC (used by the future web dashboard) — or
the same two-step process above.

## 2. Build the Android app

1. Open the `android/` folder in **Android Studio** (Ladybug or newer;
   it bundles JDK + Gradle — no separate install needed)
2. Copy your project credentials (Dashboard → Settings → API):
   - **Project URL** → `SUPABASE_URL`
   - **anon public key** → `SUPABASE_ANON_KEY`
   - Paste both in `android/gradle.properties`
3. Let Gradle sync, then **Run** on a phone (or Build → Build APK)

The app will refuse to run until Supabase credentials are present and the
phone has a screen lock (PIN/pattern/password/biometric).

## 3. Configurable rules (no code changes)

```sql
update public.settings set value = '200'::jsonb  where key = 'check_radius_m';
update public.settings set value = 'true'::jsonb where key = 'enforce_work_hours';
update public.settings set value = '"07:30"'::jsonb where key = 'work_start';
```

| key | default | meaning |
|---|---|---|
| `school_location` | Cabiao placeholder | `{"lat": .., "lng": ..}` |
| `check_radius_m` | 150 | max distance from school for check-in/out |
| `max_gps_accuracy_m` | 40 | reject weaker GPS fixes |
| `enforce_work_hours` | false | block check-in outside work window |
| `work_start` / `work_end` | 08:00 / 17:00 | window when enforce_work_hours = true |
| `biometric_required` | true | server-side flag for future use |

## 4. Admin dashboard (web)

Static site in `admin-dashboard/` — zero build step, works in any browser.

1. Run `supabase/migrations/002_admin_dashboard.sql` in the SQL editor
   (adds the admin RPCs the dashboard uses)
2. Paste your Supabase URL + anon key into `admin-dashboard/js/config.js`
3. Deploy — any free static host:
   - **Netlify Drop**: drag the `admin-dashboard` folder onto https://app.netlify.com/drop
   - **Vercel**: `vercel` CLI in the folder
   - **School PC**: just open `index.html` in a browser (works offline from a
     copied folder; only needs internet to reach Supabase)

Features: employee management (register/enable/disable), live "clocked in now"
view (auto-refresh), daily records with CSV export, manual overrides, and an
editor for radius / school location / work hours. Non-admin logins are blocked
server-side (`admin_only`).

## 5. Useful admin queries

```sql
-- who is currently clocked in
select e.full_name, a.checked_at
from attendance a join employees e on e.id = a.employee_id
where a.check_type = 'in'
and not exists (
  select 1 from attendance b
  where b.employee_id = a.employee_id and b.check_type = 'out'
    and b.checked_at > a.checked_at
);

-- manual correction (e.g. GPS failure)
select public.admin_override('employee@school.edu.ph', 'in',
                             now() - interval '2 hours', 'GPS failure');
```

## Roadmap

- [x] Schema + server-side validation (Supabase)
- [x] Android app: login, device binding, biometric, GPS check-in/out
- [x] Admin web dashboard (employees, live status, records, CSV export, overrides)
- [ ] Field testing: GPS accuracy at school, biometric on various phones
- [ ] Notifications (optional): late-arrival alerts via email/SMS