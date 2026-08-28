# Project3 Log — Cabiao SHS Attendance System

Resume-point document. When you come back, start here.

---

## 1. Project Overview

School attendance system for Cabiao SHS:

- **Android app** (Kotlin + Jetpack Compose) — employees check in/out with GPS, device binding, biometric flag
- **Supabase** (Postgres + Auth) — all server-side validation RPCs (`check_in`, `check_out`, admin functions)
- **Admin web dashboard** — static site (no build step), hosted on Netlify

Repository layout:

| Path | Contents |
|---|---|
| `admin-dashboard/` | Admin web dashboard (HTML + JS, zero build) |
| `android/` | Android Studio project |
| `supabase/migrations/` | SQL migrations 001–009 |
| `supabase/seed_demo_data.sql` | Wipe + reseed demo data (re-runnable) |
| `supabase/flowtest_*.sql` | Flow tests (007, 009) |

---

## 2. Live URLs & Access

| Item | Value |
|---|---|
| Admin dashboard | https://cshs-attendance2026.netlify.app |
| Netlify site name | `cshs-attendance2026` |
| Netlify site ID | `ffc7ddf9-b193-4045-913a-7b27404c6f45` |
| Netlify admin URL | https://app.netlify.com/projects/cshs-attendance2026 |
| Netlify account email | `innov.proj2026@gmail.com` (team: BossG Innovations) |
| Supabase project URL | https://fhtmvstalbankfurfiei.supabase.co |
| Supabase project ref | `fhtmvstalbankfurfiei` |
| GitHub repo | https://github.com/BossG-Innovation2026/mobileproject3.git |

---

## 3. Credentials & Tokens

> ⚠️ **SECURITY: this file contains live secrets. Keep the repo PRIVATE.** Rotate/revoke any token below the moment it is suspected of leaking. The Supabase PAT was also shared in a chat session — consider revoking it and generating a fresh one.

### Supabase

| Item | Value |
|---|---|
| Project ref | `fhtmvstalbankfurfiei` |
| Project URL | `https://fhtmvstalbankfurfiei.supabase.co` |
| Anon key (public, used by dashboard) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZodG12c3RhbGJhbmtmdXJmaWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwODExNzQsImV4cCI6MjEwMjY1NzE3NH0.V27S4ocqi-h-AtWu7vy4luyLtVOdJdzocGNQlqkclOc` |
| Personal Access Token (PAT, full account access) | **REDACTED** — see Supabase dashboard |
| PAT management page | https://supabase.com/dashboard/account/tokens |
| Dashboard admin login (sample data) | `admin@cabiao.test` / password `1000001` |
| Old admin (DELETED in seed wipe) | `innov.proj2026@gmail.com` |
| Old real employee (DELETED) | `erickson.glodo@deped.gov.ph` |

### Netlify

| Item | Value |
|---|---|
| Account email | `innov.proj2026@gmail.com` |
| Auth method | Browser OAuth via `netlify login` (CLI config: `~/.netlify/config.json`) |
| CLI | `netlify-cli` v27 installed globally |
| Deploy command | `netlify deploy --prod --dir admin-dashboard` (run from repo root) |
| ⚠️ Quirk | First deploy attempt often hangs (timeout) — re-run; second attempt succeeds |

### GitHub

| Item | Value |
|---|---|
| Repo | `https://github.com/BossG-Innovation2026/mobileproject3.git` |
| git user.name | `serErick2026` |
| git user.email | `erickson.glodo@deped.gov.ph` |
| Push auth | Windows Credential Manager (`credential.helper=manager`) — cached, no PAT needed |

### Local machine (this dev PC)

| Item | Value |
|---|---|
| Node | v24.19.0 |
| npm | 11.17.0 |
| Global CLIs | `netlify-cli` 27.1.2, `supabase` |
| Temp API script | `C:\Users\BossG\AppData\Local\Temp\opencode\supabase-run.js` (runs SQL via Supabase Management API using the PAT) |
| Project path | `D:\Test APp\Project3` |

---

## 4. Database State (current)

- Migrations **001–009 applied** (008 = departments/positions tables; 009 = register/update employee dept+pos params, position scoping, `admin_daily_pairs` RPC)
- **6 departments**: Tech-Pro, ABM/STEM, HUMSS, SPORTS, ADMIN, U-SG
- **12 positions** (Teacher + Staff per department)
- **18 sample employees** (3 per dept, emails `xxx@cabiao.test`, 7-digit employee ID = login password)
- Demo attendance: 3 complete IN/OUT pairs + 4 still clocked in
- Settings (school location, radius 300 m, etc.) preserved — seed does NOT touch settings
- Reset demo data anytime: run `supabase/seed_demo_data.sql` (Supabase SQL editor or Management API)

Sample data summary (ID = password):

| Dept | Emails |
|---|---|
| ADMIN | `admin@cabiao.test` (1000001, **role admin**), `admin2@`, `admin3@` |
| Tech-Pro | `techpro1@` (1000011), `techpro2@`, `techpro3@` |
| ABM/STEM | `abmstem1@` (1000021), `abmstem2@`, `abmstem3@` |
| HUMSS | `humss1@` (1000031), `humss2@`, `humss3@` |
| SPORTS | `sports1@` (1000041), `sports2@`, `sports3@` |
| U-SG | `usg1@` (1000061), `usg2@`, `usg3@` |

---

## 5. Work Log — Session 2026-08-20

1. **Audit of `ab5f9af`** (Add department/position feature) → found **broken**:
   - `app.js` had a fatal JS syntax error (unclosed `.concat(` in `renderLive`) — whole dashboard dead
   - Migration 008 alone: register employee threw NOT NULL on `department_id`; position RPCs missing `p_department_id`; `admin_daily_pairs` did not exist; fragile PostgREST embed syntax in `fetchEmployees`
2. **Fixes committed**:
   - `e286e42` — app.js rewrite (flat select + client-side join, correct RPC args), migration 009 (register/update employee with dept/pos defaulting to General/Staff, position scoping, `admin_daily_pairs`), flowtest 009, README, index.html polish
   - `107b17f` — flowtest 009 bugfix: `public.auth.users` → `auth.users`
3. **Applied migration 009 to live DB** via Management API (008 was already applied). Verified all RPC signatures. Ran `flowtest_009.sql` → **12/12 PASS** (register with/without dept, update dept, position scoping, daily pairs, current status, cleanup)
4. **First Netlify deployment** of the fixed dashboard (site: `cshs-attendance2026`)
5. **Dashboard evolution** (each deployed + pushed):
   - `a77d98f` — filter dropdowns → clickable department cards (clocked-in counts) with per-dept drill-down
   - `44f309b` — added "All departments" card → full table grouped by department
   - `8fc14b9` — All view: clocked-in grouped by department first, then flat alphabetical grayed not-clocked-in list
   - `0f8a92e` — removed the 3 tally cards → **today's date banner**; auto-refresh changed 60 s → **20 s**
6. **Wiped all data + seeded demo** (`de5aba9`) — 6 departments, 18 employees, demo attendance. Old admin deleted; new admin `admin@cabiao.test` / `1000001`
7. **Added Reports view** (`d1bd3a8`) — printable daily summary per employee: date picker, scope (All departments / one dept), Time In / Time Out / Duration / Status per employee, totals row, `@media print` styles

---

## 6. Git History (recent)

```
d1bd3a8 Add Reports view: printable daily summary per employee (all depts or one dept, IN/OUT/duration, totals)
0f8a92e Dashboard: replace tally cards with today's date banner, auto-refresh every 20s
8fc14b9 Dashboard All view: clocked-in grouped by department first, then flat alphabetical grayed not-clocked-in list
44f309b Dashboard: add All departments card, show full table grouped by department with clocked-in first
de5aba9 Add demo seed script: 6 departments, 18 sample employees, demo attendance
a77d98f Dashboard: replace filter dropdowns with clickable department cards (clocked-in counts + per-department drill-down)
107b17f Fix flowtest_009: use auth.users schema reference
e286e42 Add department/position feature: fixes registration NOT NULL, adds department/position params to employee CRUD, adds admin_daily_pairs RPC, and updates dashboard UI
ab5f9af Add department/position feature: filters, forms, paired IN/OUT view   <-- BROKEN, superseded
```

---

## 7. Resume Instructions

### Redeploy dashboard to Netlify

```
netlify deploy --prod --dir admin-dashboard
```
Run from repo root. If it hangs (common first-attempt), re-run — second attempt succeeds. Add `--json` for machine-readable output.

### Verify JS syntax locally

```
node --check admin-dashboard/js/app.js
```
(Or pipe through `new Function` after stripping the import line.)

### Run SQL against Supabase (migrations / seed / flowtests)

- **Option A (recommended, no secrets)**: Supabase Dashboard → SQL Editor → paste file contents, run
- **Option B (via PAT)**: `node "C:\Users\BossG\AppData\Local\Temp\opencode\supabase-run.js" file <path.sql>`

### Useful database queries

```sql
-- department employee counts
select d.name, count(e.id) from departments d
left join employees e on e.department_id = d.id
group by d.name, d.sort_order order by d.sort_order;

-- verify RPC signatures
select proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('admin_daily_pairs','admin_register_employee');
```

---

## 8. Notes & Pitfalls

- **Supabase PAT shared in chat** — revoke at https://supabase.com/dashboard/account/tokens and regenerate if the chat is not private
- **`project3log.md` contains live secrets** — do not make the GitHub repo public
- `admin_daily_pairs` only pairs IN/OUT where the IN falls inside the requested day (IN before midnight won't pair)
- Inactive employees are excluded from pairs and dashboard; Reports shows only active employees (absent = "No record")
- Netlify deploys only the `admin-dashboard/` folder (site root = its contents)