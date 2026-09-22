import bcrypt from "bcryptjs";
import { PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? "admin123", 12);
  const user = await prisma.user.upsert({
    where: { email: "admin@central.local" },
    update: { passwordHash },
    create: { email: "admin@central.local", name: "Administrador", passwordHash }
  });
  const company = await prisma.company.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Empresa Demo", slug: "demo" }
  });
  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: { role: RoleCode.OWNER, status: "ACTIVE" },
    create: { companyId: company.id, userId: user.id, role: RoleCode.OWNER }
  });
}
main().finally(() => prisma.$disconnect());
