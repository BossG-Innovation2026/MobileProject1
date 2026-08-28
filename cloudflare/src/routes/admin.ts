import { Hono } from 'hono';
import { Env } from '../types';
import { hashPassword, generateUUID } from '../middleware/auth';

const admin = new Hono<{ Bindings: Env }>();

// Admin middleware - verify admin role
admin.use('*', async (c, next) => {
  const userId = c.get('userId') as string;
  const userRole = c.get('userRole') as string;

  if (userRole !== 'admin') {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const user = await c.env.DB.prepare(
    'SELECT is_active FROM employees WHERE id = ?'
  ).bind(userId).first();

  if (!user?.is_active) {
    return c.json({ error: 'Account deactivated' }, 403);
  }

  await next();
});

// GET /api/admin/status - Current clocked-in status
admin.get('/status', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT e.full_name, e.email, a.checked_at, a.distance_m, a.mode, a.note
     FROM attendance a
     JOIN employees e ON e.id = a.employee_id
     WHERE a.check_type = 'in'
     AND e.is_active = 1
     AND NOT EXISTS (
       SELECT 1 FROM attendance b
       WHERE b.employee_id = a.employee_id
       AND b.check_type = 'out'
       AND b.checked_at > a.checked_at
     )
     ORDER BY e.full_name`
  ).all();

  return c.json(result.results);
});

// GET /api/admin/employees - List all employees
admin.get('/employees', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT e.*, d.name as department_name, p.name as position_name
     FROM employees e
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN positions p ON p.id = e.position_id
     ORDER BY e.full_name`
  ).all();

  return c.json(result.results);
});

// POST /api/admin/employees/bulk - Bulk register employees from CSV
admin.post('/employees/bulk', async (c) => {
  const { employees } = await c.req.json();

  if (!employees || !Array.isArray(employees) || employees.length === 0) {
    return c.json({ error: 'No employees provided' }, 400);
  }

  const results = {
    success: [] as { email: string; employee_id: string }[],
    errors: [] as { row: number; email: string; error: string }[],
  };

  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const row = i + 2; // Row number in Excel (1-indexed + header)

    try {
      const { email, employee_id, first_name, middle_name, last_name, role, department_id, position_id } = emp;

      // Validate required fields
      if (!email || !employee_id || !first_name) {
        results.errors.push({ row, email: email || 'N/A', error: 'Missing required fields (email, employee_id, first_name)' });
        continue;
      }

      // Validate employee_id format
      if (!/^\d{7}$/.test(employee_id)) {
        results.errors.push({ row, email, error: 'employee_id must be 7 digits' });
        continue;
      }

      // Check unique email
      const existingEmail = await c.env.DB.prepare(
        'SELECT id FROM employees WHERE email = ?'
      ).bind(email).first();
      if (existingEmail) {
        results.errors.push({ row, email, error: 'Email already exists' });
        continue;
      }

      // Check unique employee_id
      const existingId = await c.env.DB.prepare(
        'SELECT id FROM employees WHERE employee_id = ?'
      ).bind(employee_id).first();
      if (existingId) {
        results.errors.push({ row, email, error: 'Employee ID already exists' });
        continue;
      }

      // Default department/position
      let deptId = department_id;
      let posId = position_id;
      if (!deptId) {
        const genDept = await c.env.DB.prepare(
          'SELECT id FROM departments WHERE name = ?'
        ).bind('General').first();
        deptId = genDept?.id as string;
      }
      if (!posId) {
        const genPos = await c.env.DB.prepare(
          'SELECT id FROM positions WHERE name = ?'
        ).bind('Staff').first();
        posId = genPos?.id as string;
      }

      const id = crypto.randomUUID();
      const fullName = `${first_name} ${last_name || ''}`.trim();

      await c.env.DB.prepare(
        `INSERT INTO employees (id, full_name, email, role, employee_id, first_name, middle_name, last_name, department_id, position_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, fullName, email, role || 'employee', employee_id, first_name, middle_name || null, last_name || null, deptId, posId).run();

      results.success.push({ email, employee_id });
    } catch (err) {
      results.errors.push({ row, email: emp.email || 'N/A', error: (err as Error).message });
    }
  }

  return c.json({
    total: employees.length,
    success: results.success.length,
    failed: results.errors.length,
    details: results,
  });
});
admin.post('/employees', async (c) => {
  const {
    email, employee_id, first_name, middle_name, last_name,
    role = 'employee', department_id, position_id
  } = await c.req.json();

  if (!email || !employee_id || !first_name) {
    return c.json({ error: 'email, employee_id, first_name required' }, 400);
  }

  if (!/^\d{7}$/.test(employee_id)) {
    return c.json({ error: 'employee_id must be 7 digits' }, 400);
  }

  // Check unique email
  const existingEmail = await c.env.DB.prepare(
    'SELECT id FROM employees WHERE email = ?'
  ).bind(email).first();
  if (existingEmail) {
    return c.json({ error: 'Email already exists' }, 400);
  }

  // Check unique employee_id
  const existingId = await c.env.DB.prepare(
    'SELECT id FROM employees WHERE employee_id = ?'
  ).bind(employee_id).first();
  if (existingId) {
    return c.json({ error: 'Employee ID already exists' }, 400);
  }

  // Default department/position
  let deptId = department_id;
  let posId = position_id;
  if (!deptId) {
    const genDept = await c.env.DB.prepare(
      'SELECT id FROM departments WHERE name = ?'
    ).bind('General').first();
    deptId = genDept?.id as string;
  }
  if (!posId) {
    const genPos = await c.env.DB.prepare(
      'SELECT id FROM positions WHERE name = ?'
    ).bind('Staff').first();
    posId = genPos?.id as string;
  }

  const id = generateUUID();
  const hashedPassword = await hashPassword(employee_id); // Password = employee_id

  await c.env.DB.prepare(
    `INSERT INTO employees (id, full_name, email, role, employee_id, first_name, middle_name, last_name, department_id, position_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, `${first_name} ${last_name || ''}`.trim(), email, role, employee_id, first_name, middle_name || null, last_name || null, deptId, posId).run();

  return c.json({ id, email, employee_id }, 201);
});

// PUT /api/admin/employees/:id - Update employee
admin.put('/employees/:id', async (c) => {
  const { id } = c.req.param();
  const {
    email, first_name, middle_name, last_name,
    employee_id, role, department_id, position_id
  } = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM employees WHERE id = ?'
  ).bind(id).first();

  if (!existing) {
    return c.json({ error: 'Employee not found' }, 404);
  }

  // Build update query dynamically
  const updates: string[] = [];
  const values: unknown[] = [];

  if (email) { updates.push('email = ?'); values.push(email); }
  if (first_name) {
    updates.push('first_name = ?');
    values.push(first_name);
    updates.push('full_name = ?');
    values.push(`${first_name} ${last_name || ''}`.trim());
  }
  if (middle_name !== undefined) { updates.push('middle_name = ?'); values.push(middle_name || null); }
  if (last_name !== undefined) {
    updates.push('last_name = ?');
    values.push(last_name || null);
  }
  if (employee_id) { updates.push('employee_id = ?'); values.push(employee_id); }
  if (role) { updates.push('role = ?'); values.push(role); }
  if (department_id) { updates.push('department_id = ?'); values.push(department_id); }
  if (position_id) { updates.push('position_id = ?'); values.push(position_id); }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  values.push(id);
  await c.env.DB.prepare(
    `UPDATE employees SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ id, email, employee_id });
});

// PUT /api/admin/employees/:id/toggle - Toggle active status
admin.put('/employees/:id/toggle', async (c) => {
  const { id } = c.req.param();

  await c.env.DB.prepare(
    'UPDATE employees SET is_active = NOT is_active WHERE id = ?'
  ).bind(id).run();

  return c.json({ success: true });
});

// DELETE /api/admin/employees/:id - Delete employee
admin.delete('/employees/:id', async (c) => {
  const { id } = c.req.param();

  const emp = await c.env.DB.prepare('SELECT id FROM employees WHERE id = ?').bind(id).first();
  if (!emp) return c.json({ error: 'Employee not found' }, 404);

  await c.env.DB.prepare('DELETE FROM devices WHERE employee_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM attendance WHERE employee_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM overrides WHERE employee_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM daily_pairs WHERE pair_id IN (SELECT pair_id FROM daily_pairs WHERE employee_id = ?)').bind(id).run();
  await c.env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// GET /api/admin/devices - List all devices
admin.get('/devices', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT d.*, e.full_name, e.email, e.employee_id as emp_code
     FROM devices d
     JOIN employees e ON e.id = d.employee_id
     ORDER BY d.is_active DESC, e.full_name`
  ).all();

  return c.json(result.results);
});

// GET /api/admin/devices/summary - Device binding summary
admin.get('/devices/summary', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT 
      e.id as employee_id,
      e.full_name,
      e.employee_id as emp_code,
      d.id as device_id,
      d.android_id,
      d.device_name,
      d.is_active as device_active,
      d.bound_at
     FROM employees e
     LEFT JOIN devices d ON d.employee_id = e.id AND d.is_active = 1
     WHERE e.is_active = 1
     ORDER BY e.full_name`
  ).all();

  return c.json(result.results);
});

// DELETE /api/admin/devices/:id - Unbind device
admin.delete('/devices/:id', async (c) => {
  const { id } = c.req.param();

  await c.env.DB.prepare(
    'UPDATE devices SET is_active = 0 WHERE id = ?'
  ).bind(id).run();

  return c.json({ success: true });
});

// POST /api/admin/devices/unbind - Unbind by android_id
admin.post('/devices/unbind', async (c) => {
  const { android_id } = await c.req.json();

  if (!android_id) {
    return c.json({ error: 'android_id required' }, 400);
  }

  const result = await c.env.DB.prepare(
    'UPDATE devices SET is_active = 0 WHERE android_id = ? AND is_active = 1'
  ).bind(android_id).run();

  return c.json({ success: true, changes: result.meta?.changes || 0 });
});

// GET /api/admin/attendance - Get attendance records
admin.get('/attendance', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const departmentId = c.req.query('department_id');

  let query = `
    SELECT a.*, e.full_name, e.email, d.name as department_name, p.name as position_name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (from) { query += ' AND a.checked_at >= ?'; params.push(from); }
  if (to) { query += ' AND a.checked_at <= ?'; params.push(to); }
  if (departmentId) { query += ' AND e.department_id = ?'; params.push(departmentId); }

  query += ' ORDER BY a.checked_at DESC';

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(result.results);
});

// POST /api/admin/override - Manual attendance override
admin.post('/override', async (c) => {
  const { employee_email, check_type, checked_at, note } = await c.req.json();

  const employee = await c.env.DB.prepare(
    'SELECT id FROM employees WHERE email = ?'
  ).bind(employee_email).first();

  if (!employee) {
    return c.json({ error: 'Employee not found' }, 404);
  }

  const id = generateUUID();
  await c.env.DB.prepare(
    `INSERT INTO attendance (id, employee_id, check_type, checked_at, latitude, longitude, mode, status, note)
     VALUES (?, ?, ?, ?, 0, 0, 'inside', 'overridden', ?)`
  ).bind(id, employee.id, check_type, checked_at, note || 'Manual override').run();

  return c.json({ id, success: true });
});

// PUT /api/admin/settings - Update settings
admin.put('/settings', async (c) => {
  const { key, value } = await c.req.json();

  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
  ).bind(key, JSON.stringify(value), JSON.stringify(value)).run();

  return c.json({ success: true });
});

// GET /api/admin/departments - List departments
admin.get('/departments', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM departments ORDER BY sort_order, name'
  ).all();
  return c.json(result.results);
});

// POST /api/admin/departments - Create department
admin.post('/departments', async (c) => {
  const { name, sort_order = 0 } = await c.req.json();
  const id = generateUUID();
  await c.env.DB.prepare(
    'INSERT INTO departments (id, name, sort_order) VALUES (?, ?, ?)'
  ).bind(id, name, sort_order).run();
  return c.json({ id }, 201);
});

// PUT /api/admin/departments/:id - Update department
admin.put('/departments/:id', async (c) => {
  const { id } = c.req.param();
  const { name, is_active } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE departments SET name = ?, is_active = ? WHERE id = ?'
  ).bind(name, is_active ? 1 : 0, id).run();
  return c.json({ success: true });
});

// GET /api/admin/positions - List positions
admin.get('/positions', async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT p.*, d.name as department_name 
     FROM positions p 
     LEFT JOIN departments d ON d.id = p.department_id 
     ORDER BY p.sort_order, p.name`
  ).all();
  return c.json(result.results);
});

// POST /api/admin/positions - Create position
admin.post('/positions', async (c) => {
  const { name, department_id, sort_order = 0 } = await c.req.json();
  const id = generateUUID();
  await c.env.DB.prepare(
    'INSERT INTO positions (id, name, department_id, sort_order) VALUES (?, ?, ?, ?)'
  ).bind(id, name, department_id || null, sort_order).run();
  return c.json({ id }, 201);
});

// PUT /api/admin/positions/:id - Update position
admin.put('/positions/:id', async (c) => {
  const { id } = c.req.param();
  const { name, is_active, department_id } = await c.req.json();
  await c.env.DB.prepare(
    'UPDATE positions SET name = ?, is_active = ?, department_id = ? WHERE id = ?'
  ).bind(name, is_active ? 1 : 0, department_id || null, id).run();
  return c.json({ success: true });
});

// DELETE /api/admin/departments/:id - Delete department
admin.delete('/departments/:id', async (c) => {
  const { id } = c.req.param();
  const empCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM employees WHERE department_id = ?'
  ).bind(id).first();
  if (empCount && (empCount.cnt as number) > 0) {
    return c.json({ error: 'Cannot delete department with employees' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM departments WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// DELETE /api/admin/positions/:id - Delete position
admin.delete('/positions/:id', async (c) => {
  const { id } = c.req.param();
  const empCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM employees WHERE position_id = ?'
  ).bind(id).first();
  if (empCount && (empCount.cnt as number) > 0) {
    return c.json({ error: 'Cannot delete position with employees' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM positions WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/admin/daily-pairs - Paired IN/OUT records
admin.get('/daily-pairs', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');

  let query = `
    SELECT 
      e.id as employee_id,
      e.full_name,
      d.id as department_id,
      d.name as department_name,
      p.id as position_id,
      p.name as position_name,
      inc.checked_at as in_at,
      outc.checked_at as out_at,
      inc.mode as in_mode,
      inc.status as in_status,
      outc.mode as out_mode,
      outc.status as out_status,
      CASE 
        WHEN outc.checked_at IS NOT NULL 
        THEN (julianday(outc.checked_at) - julianday(inc.checked_at)) * 24 * 60
        ELSE NULL 
      END as duration_minutes
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY employee_id, date(checked_at) ORDER BY checked_at) as rn
      FROM attendance WHERE check_type = 'in'
    ) inc ON inc.employee_id = e.id AND inc.rn = 1
    LEFT JOIN (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY employee_id, date(checked_at) ORDER BY checked_at) as rn
      FROM attendance WHERE check_type = 'out'
    ) outc ON outc.employee_id = e.id AND outc.rn = 1 
      AND date(outc.checked_at) = date(inc.checked_at)
    WHERE e.is_active = 1
  `;
  const params: unknown[] = [];

  if (from) { query += ' AND inc.checked_at >= ?'; params.push(from); }
  if (to) { query += ' AND inc.checked_at <= ?'; params.push(to); }

  query += ' ORDER BY e.full_name, inc.checked_at';

  const result = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(result.results);
});

export default admin;
