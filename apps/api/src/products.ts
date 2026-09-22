import type { FastifyInstance } from "fastify";
import { prisma } from "@central/database";
import { requireCompanyAccess } from "./tenant.js";

export async function registerProductRoutes(app: FastifyInstance) {
  app.get("/companies/:companyId/products", { preHandler: app.authenticate }, async (request) => {
    const { companyId } = request.params as { companyId: string };
    await requireCompanyAccess(request, companyId);
    return prisma.product.findMany({ where: { companyId }, orderBy: { createdAt: "desc" } });
  });

  app.post("/companies/:companyId/products", { preHandler: app.authenticate }, async (request, reply) => {
    const { companyId } = request.params as { companyId: string };
    await requireCompanyAccess(request, companyId);
    const body = request.body as { sku: string; name: string; cost: number; price: number };
    if (!body.sku || !body.name) return reply.code(400).send({ error: "sku e name são obrigatórios" });
    const product = await prisma.$transaction(async tx => {
      const created = await tx.product.create({
        data: { companyId, sku: body.sku, name: body.name, cost: body.cost, price: body.price }
      });
      await tx.inventory.create({ data: { companyId, productId: created.id } });
      await tx.auditLog.create({
        data: { companyId, userId: request.userId, action: "PRODUCT_CREATED", entityType: "Product", entityId: created.id, afterJson: created }
      });
      return created;
    });
    return reply.code(201).send(product);
  });
}
