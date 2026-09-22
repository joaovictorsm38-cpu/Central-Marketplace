import type { FastifyInstance } from "fastify";
import { prisma } from "@central/database";
import { requireCompanyAccess } from "./tenant.js";

export async function registerInventoryRoutes(app: FastifyInstance) {
  app.get("/companies/:companyId/inventory/:productId", { preHandler: app.authenticate }, async (request) => {
    const { companyId, productId } = request.params as { companyId: string; productId: string };
    await requireCompanyAccess(request, companyId);
    return prisma.inventory.findFirstOrThrow({ where: { companyId, productId } });
  });

  app.post("/companies/:companyId/inventory/:productId/adjust", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId, productId } = request.params as { companyId: string; productId: string };
    await requireCompanyAccess(request, companyId);
    const body = request.body as { quantity: number; reason?: string; idempotencyKey?: string };
    if (!Number.isInteger(body.quantity) || !body.idempotencyKey) return reply.code(400).send({ error: "quantity inteiro e idempotencyKey são obrigatórios" });

    const result = await prisma.$transaction(async tx => {
      const existing = await tx.stockMovement.findUnique({ where: { companyId_idempotencyKey: { companyId, idempotencyKey: body.idempotencyKey! } } });
      if (existing) return existing;
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
      const after = inventory.physicalQty + body.quantity;
      if (after < 0) throw new Error("Estoque físico não pode ficar negativo");
      const updated = await tx.inventory.update({
        where: { id: inventory.id },
        data: { physicalQty: after, version: { increment: 1 } }
      });
      const movement = await tx.stockMovement.create({
        data: {
          companyId, inventoryId: inventory.id, productId, userId: request.userId,
          type: body.quantity >= 0 ? "ADJUSTMENT" : "CORRECTION",
          quantity: Math.abs(body.quantity), beforePhysical: inventory.physicalQty, afterPhysical: updated.physicalQty,
          beforeReserved: inventory.reservedQty, afterReserved: inventory.reservedQty,
          reason: body.reason, origin: "API", idempotencyKey: body.idempotencyKey!
        }
      });
      await tx.auditLog.create({ data: {
        companyId, userId: request.userId, action: "INVENTORY_ADJUSTED", entityType: "Inventory", entityId: inventory.id,
        beforeJson: inventory, afterJson: updated, origin: "API"
      }});
      return movement;
    });
    return reply.send(result);
  });
}
