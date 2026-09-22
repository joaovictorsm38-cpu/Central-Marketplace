import type { FastifyRequest } from "fastify";
import { prisma } from "@central/database";
import { PERMISSIONS, type Permission } from "@central/shared";
import { ForbiddenError } from "./errors.js";

export async function requireCompanyAccess(request: FastifyRequest, companyId: string) {
  const userId = request.userId;
  if (!userId) throw new ForbiddenError("Usuário não autenticado");

  const member = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId, userId } }
  });

  if (!member || member.status !== "ACTIVE") {
    throw new ForbiddenError("Usuário não pertence à empresa");
  }

  request.companyId = companyId;
  return member;
}

const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  OWNER: Object.values(PERMISSIONS),
  ADMIN: Object.values(PERMISSIONS),
  OPERATOR: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.INVENTORY_WRITE,
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_WRITE
  ],
  VIEWER: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.INVENTORY_READ,
    PERMISSIONS.ORDERS_READ
  ]
};

export async function requirePermission(
  request: FastifyRequest,
  companyId: string,
  permission: Permission
) {
  const member = await requireCompanyAccess(request, companyId);
  if (!ROLE_PERMISSIONS[member.role]?.includes(permission)) {
    throw new ForbiddenError("Permissão insuficiente");
  }
  return member;
}
