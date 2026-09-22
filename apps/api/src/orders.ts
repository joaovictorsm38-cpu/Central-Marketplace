import type { FastifyInstance } from "fastify";
import { prisma } from "@central/database";
import { requireCompanyAccess } from "./tenant.js";

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/companies/:companyId/orders", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    await requireCompanyAccess(request, companyId);
    const body = request.body as { number: string; items: Array<{ productId: string; quantity: number; unitPrice: number }> };
    if (!body.number || !body.items?.length) return reply.code(400).send({ error: "number e items são obrigatórios" });

    const order = await prisma.$transaction(async tx => {
      const created = await tx.order.create({
        data: { companyId, number: body.number, status: "CONFIRMED", items: { create: body.items.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })) } },
        include: { items: true }
      });

      for (const item of created.items) {
        const inventory = await tx.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId: item.productId } } });
        const available = inventory.physicalQty - inventory.reservedQty;
        if (available < item.quantity) throw new Error("Estoque disponível insuficiente");
        const updated = await tx.inventory.update({
          where: { id: inventory.id },
          data: { reservedQty: { increment: item.quantity }, version: { increment: 1 } }
        });
        await tx.stockMovement.create({
          data: {
            companyId, inventoryId: inventory.id, productId: item.productId, userId: request.userId, orderId: created.id,
            type: "RESERVATION", quantity: item.quantity,
            beforePhysical: inventory.physicalQty, afterPhysical: updated.physicalQty,
            beforeReserved: inventory.reservedQty, afterReserved: updated.reservedQty,
            origin: "ORDER", idempotencyKey: `order:${created.id}:reservation:${item.id}`, businessKey: `order-item:${item.id}`
          }
        });
      }
      await tx.auditLog.create({ data: { companyId, userId: request.userId, action: "ORDER_CREATED", entityType: "Order", entityId: created.id, afterJson: created, origin: "API" } });
      await tx.outboxEvent.create({ data: { companyId, eventType: "order.created", aggregateType: "Order", aggregateId: created.id, payload: created } });
      return created;
    });
    return reply.code(201).send(order);
  });
}
