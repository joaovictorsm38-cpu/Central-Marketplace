import { PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "admin@central.local" },
    update: {},
    create: { email: "admin@central.local", name: "Administrador", passwordHash: "CHANGE_ME" }
  });
  const company = await prisma.company.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Empresa Demo", slug: "demo" }
  });
  await prisma.companyMember.upsert({
    where: { companyId_userId: { companyId: company.id, userId: user.id } },
    update: { role: RoleCode.OWNER },
    create: { companyId: company.id, userId: user.id, role: RoleCode.OWNER }
  });
}
main().finally(() => prisma.$disconnect());
