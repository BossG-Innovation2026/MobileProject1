PRAGMA defer_foreign_keys=TRUE;

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  department_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  UNIQUE(name, department_id)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE employees (
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

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  android_id TEXT NOT NULL,
  device_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  bound_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE(employee_id, android_id)
);

CREATE TABLE attendance (
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
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('00000000-0000-0000-0000-000000000001','General',0,1,'2026-08-28 06:32:33');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000001','Administration',1,1,'2026-08-28 06:33:19');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000002','Faculty',2,1,'2026-08-28 06:33:19');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000003','Staff',3,1,'2026-08-28 06:33:19');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000004','Guidance',4,1,'2026-08-28 06:33:19');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000005','Library',5,1,'2026-08-28 06:33:19');
INSERT INTO "departments" ("id","name","sort_order","is_active","created_at") VALUES('d0000001-0000-0000-0000-000000000006','Maintenance',6,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('00000000-0000-0000-0000-000000000001','Staff','00000000-0000-0000-0000-000000000001',0,1,'2026-08-28 06:32:33');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000001','Principal','d0000001-0000-0000-0000-000000000001',1,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000002','Teacher','d0000001-0000-0000-0000-000000000002',1,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000003','Clerk','d0000001-0000-0000-0000-000000000003',1,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000004','Counselor','d0000001-0000-0000-0000-000000000004',1,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000005','Librarian','d0000001-0000-0000-0000-000000000005',1,1,'2026-08-28 06:33:19');
INSERT INTO "positions" ("id","name","department_id","sort_order","is_active","created_at") VALUES('p0000001-0000-0000-0000-000000000006','Janitor','d0000001-0000-0000-0000-000000000006',1,1,'2026-08-28 06:33:19');
INSERT INTO "settings" ("key","value","updated_at") VALUES('school_location','{"lat": 15.2447, "lng": 120.9416}','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('check_radius_m','300','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('max_gps_accuracy_m','40','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('enforce_work_hours','false','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('work_start','"08:00"','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('work_end','"17:00"','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('biometric_required','true','2026-08-28 06:32:33');
INSERT INTO "settings" ("key","value","updated_at") VALUES('max_devices_per_account','2','2026-08-28 06:32:33');
INSERT INTO "employees" ("id","full_name","email","role","is_active","created_at","employee_id","first_name","middle_name","last_name","department_id","position_id") VALUES('e0000001-0000-0000-0000-000000000001','Admin User','admin@cabiao.test','admin',1,'2026-08-28 06:33:19','1000001','Admin',NULL,'User','d0000001-0000-0000-0000-000000000001','p0000001-0000-0000-0000-000000000001');
INSERT INTO "employees" ("id","full_name","email","role","is_active","created_at","employee_id","first_name","middle_name","last_name","department_id","position_id") VALUES('e0000001-0000-0000-0000-000000000002','Maria Santos','maria@cabiao.test','employee',1,'2026-08-28 06:33:19','1000002','Maria',NULL,'Santos','d0000001-0000-0000-0000-000000000002','p0000001-0000-0000-0000-000000000002');
INSERT INTO "employees" ("id","full_name","email","role","is_active","created_at","employee_id","first_name","middle_name","last_name","department_id","position_id") VALUES('e0000001-0000-0000-0000-000000000003','Juan Dela Cruz','juan@cabiao.test','employee',1,'2026-08-28 06:33:19','1000003','Juan',NULL,'Dela Cruz','d0000001-0000-0000-0000-000000000002','p0000001-0000-0000-0000-000000000002');
INSERT INTO "employees" ("id","full_name","email","role","is_active","created_at","employee_id","first_name","middle_name","last_name","department_id","position_id") VALUES('e0000001-0000-0000-0000-000000000004','Ana Reyes','ana@cabiao.test','employee',1,'2026-08-28 06:33:19','1000004','Ana',NULL,'Reyes','d0000001-0000-0000-0000-000000000003','p0000001-0000-0000-0000-000000000003');

