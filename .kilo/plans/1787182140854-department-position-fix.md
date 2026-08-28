# Fix department/position feature (migration 008 + dashboard rework)

## Goal

Repair the broken department/position commit (`ab5f9af`) and restructure the admin
dashboard per user decisions:

- Main dashboard = Live "clocked in now" view with a true paired IN/OUT table
  (per employee per day: IN time, OUT time, duration, department, position, mode).
- Employee/account management (employee list, add/edit, device binding, department &
  position management) moves to its own **Accounts** page in the main menu.
- Departments/positions are persisted when adding/editing employees (currently never
  saved), and the NOT NULL registration failure is fixed.

No Android app changes required (dept/position are dashboard-only).

## Background facts (verified in code)

- `employees.department_id` / `position_id` were added NOT NULL by migration 008 and
  backfilled to `General` / `Staff`, but `admin_register_employee` (006) inserts without
  them → every new registration throws a NOT NULL violation.
- `admin_current_status` (002) returns no department/position columns, yet app.js reads
  `s.department_id/position_id/name` → Live view always renders "—" and filters are empty.
- `fetchEmployees` uses `departments!inner(department_id) -> name as department_name` —
  invalid PostgREST embed/cast syntax; likely throws at runtime.
- `init()` populates `#aeDepartment`/`#aePosition` before `render()` creates those nodes
  → null TypeError on load; even without the crash, `render()` rebuilds `view.innerHTML`
  and wipes those options on every render.
- Live filter change handlers compute `selected` but never filter; Records filters
  (`#recDeptFilter`/`#recPosFilter`) are never populated.
- `admin_create_position`/`admin_update_position` cannot set `department_id` despite the
  FK on `positions.department_id`.
- Misc: duplicate `onAuthStateChange` registration; dead `createMultiSelect` (references
  `items.selectedOpt` before assignment); employees-table empty-row `colspan="7"` while
  the table has 9 columns.
- Attendance pairing data available: `attendance(check_type in/out, checked_at,
  status valid/overridden, mode inside/outside)`.

## Task 1 — Migration `supabase/migrations/009_department_position_fix.sql`

New file; `create or replace` everything below (must run cleanly even if 008 already applied):

1. **`admin_register_employee`** — add params
   `p_department_id uuid default null, p_position_id uuid default null`.
   Resolve to seeded defaults when null:
   `coalesce(p_department_id, (select id from public.departments where name = 'General'))`
   (same for `Staff`). Insert both columns. Keeps NOT NULL satisfied.
2. **`admin_update_employee`** — add `p_department_id uuid default null,
   p_position_id uuid default null`; when non-null, validate existence and set the
   columns (leave unchanged when null).
3. **`admin_create_position`** — add `p_department_id uuid default null`; validate the
   department exists when given; insert it. **`admin_update_position`** — add
   `p_department_id uuid default null`; update when non-null.
4. **New `admin_daily_pairs(p_from timestamptz, p_to timestamptz)`** — admin-only guard
   (`role <> 'admin' → admin_only`), returns:
   ```
   employee_id uuid, full_name text,
   department_id uuid, department_name text, position_id uuid, position_name text,
   in_at timestamptz, out_at timestamptz,
   in_mode text, in_status text, out_mode text, out_status text,
   duration_minutes int
   ```
   - One row per IN/OUT pair (pairs only; employees without a pair in the range are
     added by the client merge in Task 2, not here). For each employee, take `attendance`
     rows with `checked_at >= p_from and checked_at < p_to` ordered by `checked_at`;
     each `in` opens a pair, the next `out` closes it.
   - Trailing `in` without `out` → `out_at/out_mode/out_status/duration_minutes` NULL
     (that row is "currently clocked in").
   - `duration_minutes` = `extract(epoch from (out_at - in_at))/60` rounded.
   - Join `employees` → `departments`/`positions` for names. Left join positions so a
     null position_id still shows the employee.
   - Only count pairs whose `in` falls inside the range (an `in` before the range is
     not shown; documented limitation).
5. `grant execute ... to authenticated` on `admin_daily_pairs` for consistency with the
   other admin RPCs (they currently rely on default PUBLIC execute; keep the same pattern
   as 006's `resolve_login`, i.e. `revoke all` + `grant` is optional — match 001/002 style,
   which used defaults).

## Task 2 — Dashboard restructure (`admin-dashboard/js/app.js`)

### Nav / routing
- `VIEWS = ["dashboard", "accounts", "records", "overrides", "settings"]`; default stays
  `dashboard`. Drop `"live"` (or alias `#/live` → dashboard). Nav labels:
  Dashboard · Accounts · Records · Overrides · Settings.
- `renderDashboard(v)` becomes the live view (below). New `renderAccounts(v)`.

### `init()` fixes
- Remove the early `#aeDepartment`/`#aePosition` population (the null-crash source).
- Keep one `onAuthStateChange` registration (remove the duplicate added at app.js:58-61).

### Data helpers
- `fetchDepartments()` / `fetchPositions()` stay, but expose a lazy cached promise:
  `window.departmentsPromise` / `window.positionsPromise` so any render function can
  `await` them without refetching; set `window.departments` / `window.positions` on resolve.
- `fetchEmployees()`: replace the invalid embed with a flat select —
  `id, employee_id, full_name, email, role, is_active, created_at, department_id, position_id`
  — and join names client-side from the cached lists (`department_name`/`position_name`
  computed in `renderAccounts`/records code). Do not rely on PostgREST embed syntax.

### `renderDashboard(v)` — main live view
- Summary cards: "Clocked in now" (count of pairs with `out_at IS NULL`), "Records today",
  "Active employees" (fetched as before).
- **Every active employee is visible** — the paired data from `admin_daily_pairs`
  (browser-local day range via `localDayRange(new Date())`, same timezone logic as
  Records) is merged client-side with the full active employee list (`fetchEmployees`
  filtered by `is_active`), keyed by `employee_id`. Employees with no pair in the range
  appear as a row with "—" times.
  Columns: Employee · Department · Position · IN Time · OUT Time · Duration ·
  Mode (badge from `in_mode`/`out_mode`) · Status (badge `In`/`Out`; `overridden` if
  `in_status` or `out_status` = 'overridden').
- **Two sections (one table, subheading rows):**
  1. **Clocked in (top)** — employees currently clocked in (`in_at` present,
     `out_at IS NULL`), normal styling. Grouped under a department subheading row
     (department name, e.g. a `.dept-head` row spanning the table); departments sorted
     alphabetically, employees within each department by position, then name. Departments
     with nobody clocked in are omitted.
  2. **Not clocked in (bottom)** — all other active employees (no pair in range, or
     already clocked out), listed flat and alphabetically by full name — NOT grouped by
     department — with a grayed/muted style (e.g. `.live-gray` class: muted text/
     background). A section header (e.g. "Not clocked in") separates it from the top.
- Department + Position multi-select filters that actually filter rows client-side on
  `change` (re-render tbody only, keep selections). Filtering applies to both sections;
  section grouping and grayed styling persist after filtering.
- Keep the 60 s auto-refresh.

### `renderAccounts(v)` — employee/account management
- Move here: employees table (ID, name, email, role, department, position, status,
  devices with remove/reset buttons, Disable/Enable, Edit) and the Register employee form.
- Populate `#aeDepartment`/`#aePosition`/`#eeDepartment`/`#eePosition` **after** the
  `v.innerHTML` assignment, from the cached lists. On Edit click, pre-select the
  employee's current department/position.
- Register submit → `admin_register_employee` including `p_department_id`, `p_position_id`.
- Edit submit → `admin_update_employee` including both params.
- Departments & Positions management panel (compact, uses the 008 RPCs):
  - Departments: list with name + active toggle (`admin_toggle_department`), add
    (`admin_create_department`), rename (`admin_update_department`).
  - Positions: same with `admin_toggle_position` / `admin_create_position(p_name,
    p_department_id)` / `admin_update_position`. Re-render the section after each
    mutation so employee-form dropdowns refresh.
- Fix the empty-row `colspan` (9 columns) and remove the dead `createMultiSelect`.

### Records view
- Populate `#recDeptFilter` / `#recPosFilter` from cached lists; filter the rendered
  rows client-side by the employee's `department_id`/`position_id` (employee map already
  built in `load`); CSV export honors the filtered `window.__csvRows`.

## Task 3 — Flow test `supabase/flowtest_009.sql`

Follow the `flowtest_005/007` pattern (set `request.jwt.claim.sub`/`role` to a known
admin, record step/outcome into a temp table):

1. Register an employee **without** dept/position → succeeds, gets General/Staff
   (verifies NOT NULL fix).
2. Register with explicit department/position → values persisted.
3. `admin_update_employee` changes dept/position → persisted.
4. `admin_create_position(p_name, p_department_id)` → row scoped to department;
   `admin_update_position` with new department works.
5. Two employees clock in/out (use `check_in`/`check_out` with distinct android_ids) →
   `admin_daily_pairs` returns one pair per employee with correct
   `in_at`/`out_at`/`duration_minutes`/names; one employee with a trailing `in` has
   NULL `out_at` (counted clocked-in). An employee with no attendance in the range is
   absent from the RPC result (the client merge shows them grayed).
6. `admin_current_status` unchanged behavior (still returns clocked-in list).
7. Cleanup: delete flowtest attendance/device rows.

## Task 4 — README + housekeeping

- Update `README.md`: settings table (`check_radius_m` default 300 after 007), migration
  list (003–009), dashboard features (paired live view, Accounts page, departments/
  positions), remove stale "future web dashboard" wording.
- `node --check admin-dashboard/js/app.js` must pass.

## Validation

1. `node --check admin-dashboard/js/app.js`
2. Run `supabase/migrations/009_department_position_fix.sql` then
   `supabase/flowtest_009.sql` in the Supabase SQL editor; all steps PASS.
3. Manual dashboard: login → Dashboard shows two sections: clocked-in employees at the
   top, grouped under alphabetical department subheadings (by position, then name within
   each department), and a "Not clocked in" section at the bottom listing the remaining
   active employees flat, alphabetically by name, grayed/muted; filters narrow both
   sections and grouping/styling persists after filtering; Accounts page registers an
   employee with dept/position, edits persist, devices reset works; dept/position panel
   creates/renames/toggles and dropdowns refresh; Records filters narrow rows and CSV
   matches the filtered set.
4. Confirm new employee registration no longer throws NOT NULL.

## Risks / notes

- Migration 009 must be applied before the new JS goes live, or registration breaks.
- `admin_daily_pairs` pairs only within the requested range; an `in` before the range
  won't produce a row (acceptable for a daily view; documented in a code comment).
- Positions can now be department-scoped via the RPCs; the Accounts UI sends
  `department_id` when creating a position.
- Do not reintroduce PostgREST embed syntax in `fetchEmployees`; client-side join is
  intentionally used to avoid parse errors.
