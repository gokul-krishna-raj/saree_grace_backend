import { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app';
import { User } from '../src/models/User';
import bcrypt from 'bcryptjs';
import { signAccessToken } from '../src/utils/tokens';

export function buildApp(): Express {
  return createApp();
}

export async function createUser(
  overrides: {
    name?: string;
    email?: string;
    password?: string;
    role?: 'customer' | 'admin';
  } = {},
): Promise<{ id: string; email: string; token: string }> {
  const password = overrides.password ?? 'Password123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await User.create({
    name: overrides.name ?? 'Test User',
    email:
      overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    passwordHash,
    role: overrides.role ?? 'customer',
  });
  const token = signAccessToken(user._id.toString(), user.role);
  return { id: user._id.toString(), email: user.email, token };
}

export async function createAdmin(): Promise<{ id: string; email: string; token: string }> {
  return createUser({
    role: 'admin',
    email: `admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
  });
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

export { request };
