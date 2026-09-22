import type { FastifyInstance } from "fastify";
import { prisma } from "@central/database";
import { PERMISSIONS } from "@central/shared";
import { requirePermission } from "./tenant.js";
import { DomainError, NotFoundError } from "./errors.js";

type LockedInventory = { id: string; companyId: string; productId: string; physicalQty: number; reservedQty: number; committedQty: number; inTransitQty: number; minQty: number; maxQty: number | null; version: number; updatedAt: Date };

async function lockInventory(tx: typeof prisma, companyId: string, productId: string): Promise<LockedInventory> {
  const rows = await tx.$queryRawUnsafe<LockedInventory[]>('SELECT id, "companyId", "productId", "physicalQty", "reservedQty", "committedQty", "inTransitQty", "minQty", "maxQty", version, "updatedAt" FROM "Inventory" WHERE "companyId" = $1::uuid AND "productId" = $2::uuid FOR UPDATE', companyId, productId);
  if (!rows[0]) throw new NotFoundError("Estoque do produto não encontrado");
  return rows[0];
}

export async function registerInventoryRoutes(app: FastifyInstance) {
  app.get("/companies/:companyId/inventory/:productId", { preHandler: app.authenticate }, async (request) => {
    const { companyId, productId } = request.params as { companyId: string; productId: string };
    await requirePermission(request, companyId, PERMISSIONS.INVENTORY_READ);
    return prisma.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
  });

  app.post("/companies/:companyId/inventory/:productId/adjust", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId, productId } = request.params as { companyId: string; productId: string };
    await requirePermission(request, companyId, PERMISSIONS.INVENTORY_WRITE);
    const body = request.body as { quantity: number; reason?: string };
    const idempotencyKey = String(request.headers["idempotency-key"] ?? (request.body as { idempotencyKey?: string }).idempotencyKey ?? "");
    if (!Number.isInteger(body.quantity) || !idempotencyKey) return reply.code(400).send({ error: "quantity inteiro e Idempotency-Key são obrigatórios" });

    const result = await prisma.$transaction(async tx => {
      const existing = await tx.stockMovement.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey } } });
      if (existing) return existing;
      const inventory = await lockInventory(tx, companyId, productId);
      const afterPhysical = inventory.physicalQty + body.quantity;
      if (afterPhysical < 0) throw new DomainError("INSUFFICIENT_STOCK", "Estoque físico não pode ficar negativo", 409);
      const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { physicalQty: afterPhysical, version: { increment: 1 } } });
      const movement = await tx.stockMovement.create({ data: { companyId, inventoryId: inventory.id, productId, userId: request.userId, type: body.quantity >= 0 ? "ADJUSTMENT" : "CORRECTION", quantity: Math.abs(body.quantity), beforePhysical: inventory.physicalQty, afterPhysical: updated.physicalQty, beforeReserved: inventory.reservedQty, afterReserved: updated.reservedQty, reason: body.reason, origin: "API", idempotencyKey } });
      await tx.auditLog.create({ data: { companyId, userId: request.userId, action: "INVENTORY_ADJUSTED", entityType: "Inventory", entityId: inventory.id, beforeJson: inventory, afterJson: updated, origin: "API" } });
      await tx.outboxEvent.create({ data: { companyId, eventType: "inventory.adjusted", aggregateType: "Inventory", aggregateId: inventory.id, payload: { movementId: movement.id, productId, quantity: body.quantity } } });
      return movement;
    });
    return reply.send(result);
  });
}