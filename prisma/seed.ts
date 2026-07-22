/**
 * Database seed — replaces the Spring `DataInitializer` CommandLineRunner.
 * Seeds the 4 roles and a super-admin user. Idempotent: safe to re-run.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient, roles_name } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const ROLES: roles_name[] = [
  roles_name.ROLE_USER,
  roles_name.BUSINESS_USER,
  roles_name.ROLE_ADMIN,
  roles_name.ROLE_SUPER_ADMIN,
];

// Matches the Spring DataInitializer super-admin.
const SUPER_ADMIN = {
  email: 'discoverforoneself@gmail.com',
  firstName: 'Super',
  lastName: 'Admin',
  password: 'password1234',
};

async function main() {
  // Roles — `roles.name` has no unique constraint, so guard with findFirst.
  const roleIdByName = new Map<roles_name, number>();
  for (const name of ROLES) {
    let role = await prisma.roles.findFirst({ where: { name } });
    if (!role) {
      role = await prisma.roles.create({ data: { name } });
      console.log(`created role ${name} (id=${role.id})`);
    }
    roleIdByName.set(name, role.id);
  }

  // Super-admin user.
  let admin = await prisma.users.findFirst({ where: { email: SUPER_ADMIN.email } });
  if (!admin) {
    const hashed = await bcrypt.hash(SUPER_ADMIN.password, 10);
    admin = await prisma.users.create({
      data: {
        email: SUPER_ADMIN.email,
        username: SUPER_ADMIN.email,
        first_name: SUPER_ADMIN.firstName,
        last_name: SUPER_ADMIN.lastName,
        password: hashed,
        status: true,
        verified: true,
        date_added: new Date().toISOString(),
      },
    });
    console.log(`created super-admin user (id=${admin.id})`);
  }

  const superRoleId = roleIdByName.get(roles_name.ROLE_SUPER_ADMIN)!;
  await prisma.user_role.upsert({
    where: { user_id_role_id: { user_id: admin.id, role_id: superRoleId } },
    create: { user_id: admin.id, role_id: superRoleId },
    update: {},
  });

  console.log('seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
