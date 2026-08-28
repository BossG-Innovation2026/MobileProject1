-- D1/SQLite schema for Cabiao SHS Employee Attendance
-- Migrated from PostgreSQL/Supabase

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee','admin')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  employee_id TEXT UNIQUE,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  department_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  android_id TEXT NOT NULL,
  device_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, android_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  device_id TEXT,
  check_type TEXT NOT NULL CHECK (check_type IN ('in','out')),
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  gps_accuracy REAL,
  distance_m REAL,
  biometric_verified INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'inside' CHECK (mode IN ('inside','outside')),
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','overridden')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  UNIQUE(name, department_id)
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_active_android ON devices(android_id) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_attendance_employee ON attendance(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_checked_at ON attendance(checked_at);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_position ON employees(position_id);

-- Seed default settings
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('school_location', '{"lat": 15.2447, "lng": 120.9416}'),
  ('check_radius_m', '300'),
  ('max_gps_accuracy_m', '40'),
  ('enforce_work_hours', 'false'),
  ('work_start', '"08:00"'),
  ('work_end', '"17:00"'),
  ('biometric_required', 'true'),
  ('max_devices_per_account', '2');

-- Seed default department and position
INSERT OR IGNORE INTO departments (id, name, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Tech-Pro', 0),
  ('00000000-0000-0000-0000-000000000002', 'ABM/STEM', 1),
  ('00000000-0000-0000-0000-000000000003', 'HumSS/ALS/SNED', 2),
  ('00000000-0000-0000-0000-000000000004', 'SPORTS', 3);

INSERT OR IGNORE INTO positions (id, name, department_id, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Administrator', NULL, 0),
  ('00000000-0000-0000-0000-000000000002', 'Non-teaching', NULL, 1),
  ('00000000-0000-0000-0000-000000000003', 'Teaching', NULL, 2),
  ('00000000-0000-0000-0000-000000000004', 'Utility/Security', NULL, 3);
