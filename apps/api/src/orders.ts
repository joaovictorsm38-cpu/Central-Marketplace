import type { FastifyInstance } from "fastify";
import { prisma } from "@central/database";
import type { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@central/shared";
import { requirePermission } from "./tenant.js";
import { DomainError, NotFoundError } from "./errors.js";

type LockedInventory = { id: string; physicalQty: number; reservedQty: number };
async function lockInventory(tx: Prisma.TransactionClient, companyId: string, productId: string): Promise<LockedInventory> {
  const rows = await tx.$queryRawUnsafe<LockedInventory[]>('SELECT id, "physicalQty", "reservedQty" FROM "Inventory" WHERE "companyId" = $1::uuid AND "productId" = $2::uuid FOR UPDATE', companyId, productId);
  if (!rows[0]) throw new NotFoundError("Estoque do produto não encontrado");
  return rows[0];
}

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post("/companies/:companyId/orders", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    await requirePermission(request, companyId, PERMISSIONS.ORDERS_WRITE);
    const body = request.body as { number: string; items: Array<{ productId: string; quantity: number; unitPrice: number; discount?: number }>; shipping?: number; fees?: number; discount?: number };
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!body.number || !body.items?.length || !idempotencyKey) return reply.code(400).send({ error: "number, items e Idempotency-Key são obrigatórios" });
    if (body.items.some(i => !Number.isInteger(i.quantity) || i.quantity <= 0)) return reply.code(400).send({ error: "Todas as quantidades devem ser inteiros positivos" });

    const order = await prisma.$transaction(async tx => {
      const existingKey = await tx.idempotencyKey.findUnique({ where: { companyId_key: { companyId, key: idempotencyKey } } });
      if (existingKey?.responseJson && typeof existingKey.responseJson === "object" && "orderId" in existingKey.responseJson) return tx.order.findUniqueOrThrow({ where: { id: String((existingKey.responseJson as { orderId: string }).orderId) }, include: { items: true } });
      const subtotal = body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice - (item.discount ?? 0), 0);
      const discount = body.discount ?? 0, shipping = body.shipping ?? 0, fees = body.fees ?? 0, total = subtotal - discount + shipping + fees;
      if (total < 0) throw new DomainError("INVALID_TOTAL", "Total do pedido não pode ser negativo");
      const created = await tx.order.create({ data: { companyId, number: body.number, status: "CONFIRMED", subtotal, discount, shipping, fees, total, items: { create: body.items.map(i => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice, discount: i.discount ?? 0 })) } }, include: { items: true } });
      for (const item of created.items) {
        const inventory = await lockInventory(tx, companyId, item.productId);
        if (inventory.physicalQty - inventory.reservedQty < item.quantity) throw new DomainError("INSUFFICIENT_STOCK", "Estoque disponível insuficiente", 409);
        const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { reservedQty: { increment: item.quantity }, version: { increment: 1 } } });
        await tx.stockMovement.create({ data: { companyId, inventoryId: inventory.id, productId: item.productId, userId: request.userId, orderId: created.id, type: "RESERVATION", quantity: item.quantity, beforePhysical: inventory.physicalQty, afterPhysical: inventory.physicalQty, beforeReserved: inventory.reservedQty, afterReserved: updated.reservedQty, origin: "ORDER", idempotencyKey: idempotencyKey + ":reservation:" + item.id, businessKey: "order-item:" + item.id } });
      }
      await tx.idempotencyKey.create({ data: { companyId, key: idempotencyKey, operation: "order.create", responseJson: { orderId: created.id } } });
      await tx.auditLog.create({ data: { companyId, userId: request.userId, action: "ORDER_CREATED", entityType: "Order", entityId: created.id, afterJson: created, origin: "API" } });
      await tx.outboxEvent.create({ data: { companyId, eventType: "order.created", aggregateType: "Order", aggregateId: created.id, payload: created } });
      return created;
    });
    return reply.code(201).send(order);
  });

  app.post("/companies/:companyId/orders/:orderId/consume", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId, orderId } = request.params as { companyId: string; orderId: string };
    await requirePermission(request, companyId, PERMISSIONS.ORDERS_WRITE);
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!idempotencyKey) return reply.code(400).send({ error: "Idempotency-Key é obrigatório" });
    const result = await prisma.$transaction(async tx => {
      const movementKey = idempotencyKey + ":order";
      const existing = await tx.stockMovement.findFirst({ where: { companyId, orderId, type: "CONSUMPTION", idempotencyKey: movementKey } });
      if (existing) return existing;
      const order = await tx.order.findFirst({ where: { id: orderId, companyId }, include: { items: true } });
      if (!order) throw new NotFoundError("Pedido não encontrado");
      if (order.status === "CANCELLED") throw new DomainError("INVALID_ORDER_STATE", "Pedido cancelado", 409);
      for (const item of order.items) {
        const inventory = await lockInventory(tx, companyId, item.productId);
        if (inventory.reservedQty < item.quantity || inventory.physicalQty < item.quantity) throw new DomainError("INVALID_STOCK_STATE", "Reserva/estoque insuficiente para consumo", 409);
        const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { physicalQty: { decrement: item.quantity }, reservedQty: { decrement: item.quantity }, version: { increment: 1 } } });
        await tx.stockMovement.create({ data: { companyId, inventoryId: inventory.id, productId: item.productId, userId: request.userId, orderId, type: "CONSUMPTION", quantity: item.quantity, beforePhysical: inventory.physicalQty, afterPhysical: updated.physicalQty, beforeReserved: inventory.reservedQty, afterReserved: updated.reservedQty, origin: "ORDER", idempotencyKey: movementKey, businessKey: "order-consume:" + orderId + ":" + item.id } });
      }
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { status: "PROCESSING" }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId, userId: request.userId, action: "ORDER_CONSUMED", entityType: "Order", entityId: orderId, afterJson: updatedOrder, origin: "API" } });
      await tx.outboxEvent.create({ data: { companyId, eventType: "order.consumed", aggregateType: "Order", aggregateId: orderId, payload: { orderId } } });
      return updatedOrder;
    });
    return reply.send(result);
  });

  app.post("/companies/:companyId/orders/:orderId/cancel", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId, orderId } = request.params as { companyId: string; orderId: string };
    await requirePermission(request, companyId, PERMISSIONS.ORDERS_WRITE);
    const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
    if (!idempotencyKey) return reply.code(400).send({ error: "Idempotency-Key é obrigatório" });
    const result = await prisma.$transaction(async tx => {
      const movementKey = idempotencyKey + ":order";
      const existing = await tx.stockMovement.findFirst({ where: { companyId, orderId, type: "RELEASE", idempotencyKey: movementKey } });
      if (existing) return tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const order = await tx.order.findFirst({ where: { id: orderId, companyId }, include: { items: true } });
      if (!order) throw new NotFoundError("Pedido não encontrado");
      if (order.status === "CANCELLED") return order;
      for (const item of order.items) {
        const inventory = await lockInventory(tx, companyId, item.productId);
        if (inventory.reservedQty < item.quantity) throw new DomainError("INVALID_STOCK_STATE", "Reserva insuficiente para liberação", 409);
        const updated = await tx.inventory.update({ where: { id: inventory.id }, data: { reservedQty: { decrement: item.quantity }, version: { increment: 1 } } });
        await tx.stockMovement.create({ data: { companyId, inventoryId: inventory.id, productId: item.productId, userId: request.userId, orderId, type: "RELEASE", quantity: item.quantity, beforePhysical: inventory.physicalQty, afterPhysical: inventory.physicalQty, beforeReserved: inventory.reservedQty, afterReserved: updated.reservedQty, origin: "ORDER", idempotencyKey: movementKey, businessKey: "order-release:" + orderId + ":" + item.id } });
      }
      const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" }, include: { items: true } });
      await tx.auditLog.create({ data: { companyId, userId: request.userId, action: "ORDER_CANCELLED", entityType: "Order", entityId: orderId, beforeJson: order, afterJson: updatedOrder, origin: "API" } });
      await tx.outboxEvent.create({ data: { companyId, eventType: "order.cancelled", aggregateType: "Order", aggregateId: orderId, payload: { orderId } } });
      return updatedOrder;
    });
    return reply.send(result);
  });
}