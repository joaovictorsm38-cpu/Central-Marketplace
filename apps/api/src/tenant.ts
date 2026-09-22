import type { FastifyRequest } from "fastify";
import { prisma } from "@central/database";
import { ForbiddenError } from "./errors.js";

export async function requireCompanyAccess(request: FastifyRequest, companyId: string) {
  const userId = request.userId;
  if (!userId) throw new ForbiddenError("Usuário não autenticado");
  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } }
  });
  if (!member || member.status !== "ACTIVE") throw new ForbiddenError("Usuário não pertence à empresa");
  request.companyId = companyId;
  return member;
}
