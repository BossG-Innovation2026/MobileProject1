import { Hono } from 'hono';
import { Env } from '../types';
import { hashPassword, verifyPassword, createJWT, generateUUID } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

// POST /api/auth/login - Employee ID login
auth.post('/login', async (c) => {
  const { employee_id } = await c.req.json();
  
  if (!employee_id || !/^\d{7}$/.test(employee_id)) {
    return c.json({ error: 'Invalid employee ID format' }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, full_name, employee_id, role, is_active FROM employees WHERE employee_id = ?'
  ).bind(employee_id).first();

  if (!user) {
    return c.json({ error: 'Employee not found' }, 404);
  }

  if (!user.is_active) {
    return c.json({ error: 'Account is deactivated' }, 403);
  }

  const token = await createJWT({
    id: user.id as string,
    email: user.email as string,
    full_name: user.full_name as string,
    employee_id: user.employee_id as string,
    role: user.role as 'employee' | 'admin',
    is_active: user.is_active as number,
    department_id: '',
    position_id: '',
  }, c.env.JWT_SECRET);

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      employee_id: user.employee_id,
      role: user.role,
    },
  });
});

// POST /api/auth/device-owner - Check device binding
auth.post('/device-owner', async (c) => {
  const { android_id } = await c.req.json();

  if (!android_id) {
    return c.json({ error: 'android_id required' }, 400);
  }

  const device = await c.env.DB.prepare(
    `SELECT d.id, d.employee_id, e.full_name 
     FROM devices d 
     JOIN employees e ON e.id = d.employee_id 
     WHERE d.android_id = ? AND d.is_active = 1`
  ).bind(android_id).first();

  if (!device) {
    return c.json({ bound: false });
  }

  return c.json({
    bound: true,
    employee_id: device.employee_id,
    full_name: device.full_name,
  });
});

export default auth;
