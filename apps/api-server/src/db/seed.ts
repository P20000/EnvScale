import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import { Pool } from 'pg';

import { users, workspaces, workspaceMembers } from './schema';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://envscale:envscale_password@localhost:5432/envscale';

const pool = new Pool({ connectionString });
const db = drizzle(pool, { schema: { users, workspaces, workspaceMembers } });

function hashPassword(password: string) {
  return createHash('sha256').update(password).digest('hex');
}

async function seedDemoUsers() {
  const demoUsers = [
    {
      email: 'alex@envscale.dev',
      name: 'Alex Morgan',
      passwordHash: hashPassword('admin123'),
      avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e',
      role: 'admin',
      isActive: true,
    },
    {
      email: 'maya@envscale.dev',
      name: 'Maya Chen',
      passwordHash: hashPassword('admin123'),
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330',
      role: 'admin',
      isActive: true,
    },
    {
      email: 'leo@envscale.dev',
      name: 'Leo Patel',
      passwordHash: hashPassword('member123'),
      avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d',
      role: 'member',
      isActive: true,
    },
    {
      email: 'priya@envscale.dev',
      name: 'Priya Nair',
      passwordHash: hashPassword('viewer123'),
      avatar: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f',
      role: 'viewer',
      isActive: true,
    },
  ];

  await db.insert(users).values(demoUsers).onConflictDoNothing();

  return db
    .select()
    .from(users)
    .where(inArray(users.email, demoUsers.map((user) => user.email)));
}

async function seedDemoWorkspaces(userMap: Map<string, string>) {
  const workspaceSeed = [
    {
      name: 'Platform Core',
      slug: 'platform-core',
      description: 'Shared platform operations and cluster health review workspace.',
      ownerId: userMap.get('alex@envscale.dev')!,
      logo: 'https://example.com/logos/platform-core.png',
      metadata: { region: 'us-east-1', tier: 'production' },
      isActive: true,
    },
    {
      name: 'Production Ops',
      slug: 'production-ops',
      description: 'Mission-critical production monitoring and incident response.',
      ownerId: userMap.get('maya@envscale.dev')!,
      logo: 'https://example.com/logos/production-ops.png',
      metadata: { region: 'eu-west-1', tier: 'production' },
      isActive: true,
    },
    {
      name: 'Staging Lab',
      slug: 'staging-lab',
      description: 'Pre-production experimentation and feature validation workspace.',
      ownerId: userMap.get('leo@envscale.dev')!,
      logo: 'https://example.com/logos/staging-lab.png',
      metadata: { region: 'ap-south-1', tier: 'staging' },
      isActive: true,
    },
  ];

  await db.insert(workspaces).values(workspaceSeed).onConflictDoNothing();

  return db
    .select()
    .from(workspaces)
    .where(inArray(workspaces.slug, workspaceSeed.map((workspace) => workspace.slug)));
}

async function seedWorkspaceMemberships(
  userMap: Map<string, string>,
  workspaceMap: Map<string, string>
) {
  const memberships = [
    {
      workspaceId: workspaceMap.get('platform-core')!,
      userId: userMap.get('alex@envscale.dev')!,
      role: 'ADMIN',
    },
    {
      workspaceId: workspaceMap.get('platform-core')!,
      userId: userMap.get('maya@envscale.dev')!,
      role: 'MEMBER',
    },
    {
      workspaceId: workspaceMap.get('platform-core')!,
      userId: userMap.get('priya@envscale.dev')!,
      role: 'VIEWER',
    },
    {
      workspaceId: workspaceMap.get('production-ops')!,
      userId: userMap.get('maya@envscale.dev')!,
      role: 'ADMIN',
    },
    {
      workspaceId: workspaceMap.get('production-ops')!,
      userId: userMap.get('leo@envscale.dev')!,
      role: 'MEMBER',
    },
    {
      workspaceId: workspaceMap.get('production-ops')!,
      userId: userMap.get('alex@envscale.dev')!,
      role: 'VIEWER',
    },
    {
      workspaceId: workspaceMap.get('staging-lab')!,
      userId: userMap.get('leo@envscale.dev')!,
      role: 'ADMIN',
    },
    {
      workspaceId: workspaceMap.get('staging-lab')!,
      userId: userMap.get('alex@envscale.dev')!,
      role: 'MEMBER',
    },
    {
      workspaceId: workspaceMap.get('staging-lab')!,
      userId: userMap.get('maya@envscale.dev')!,
      role: 'VIEWER',
    },
  ];

  await db.insert(workspaceMembers).values(memberships).onConflictDoNothing();

  return memberships;
}

async function main() {
  try {
    const usersInserted = await seedDemoUsers();
    const userMap = new Map(usersInserted.map((user) => [user.email, user.id]));

    const workspacesInserted = await seedDemoWorkspaces(userMap);
    const workspaceMap = new Map(
      workspacesInserted.map((workspace) => [workspace.slug, workspace.id])
    );

    await seedWorkspaceMemberships(userMap, workspaceMap);

    console.log('Seed complete: demo users, workspaces, and RBAC memberships created.');
  } catch (error) {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
