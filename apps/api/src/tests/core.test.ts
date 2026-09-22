import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "../server.js";

const prisma = new PrismaClient();
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken = "";
let viewerToken = "";
let productId = "";
let companyId = "";
let otherCompanyId = "";

async function login(email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200);
  return response.json().token as string;
}

before(async () => {
  app = await buildApp();

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@central.local" } });
  const demo = await prisma.company.findUniqueOrThrow({ where: { slug: "demo" } });
  companyId = demo.id;
  adminToken = await login(admin.email, process.env.SEED_ADMIN_PASSWORD ?? "admin123");

  const suffix = Date.now().toString();
  otherCompanyId = (await prisma.company.create({ data: { name: "Other " + suffix, slug: "other-" + suffix } })).id;

  const viewer = await prisma.user.create({
    data: {
      email: "viewer-" + suffix + "@central.local",
      name: "Viewer",
      passwordHash: await bcrypt.hash("viewer-password", 10),
      memberships: { create: { companyId, role: "VIEWER", status: "ACTIVE" } }
    }
  });
  viewerToken = await login(viewer.email, "viewer-password");

  const product = await prisma.product.create({
    data: { companyId, sku: "TEST-" + suffix, name: "Test Product", cost: 10, price: 20, inventory: { create: { companyId } } }
  });
  productId = product.id;
});

after(async () => {
  await prisma.order.deleteMany({ where: { companyId, number: { startsWith: "TEST-ORDER-" } } });
  await prisma.stockMovement.deleteMany({ where: { companyId, businessKey: { startsWith: "order-" } } });
  await prisma.company.delete({ where: { id: otherCompanyId } }).catch(() => undefined);
  await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { email: { startsWith: "viewer-" } } });
  await app.close();
  await prisma.$disconnect();
});

test("blocks cross-company access", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/companies/" + otherCompanyId + "/products",
    headers: { authorization: "Bearer " + adminToken }
  });
  assert.equal(response.statusCode, 403);
});

test("enforces RBAC for viewer writes", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/products",
    headers: { authorization: "Bearer " + viewerToken },
    payload: { sku: "DENIED", name: "Denied", cost: 1, price: 2 }
  });
  assert.equal(response.statusCode, 403);
});

test("reservation does not reduce physical stock and idempotent adjustment applies once", async () => {
  let response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/inventory/" + productId + "/adjust",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-adjust-1" },
    payload: { quantity: 10, reason: "test" }
  });
  assert.equal(response.statusCode, 200);

  response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/inventory/" + productId + "/adjust",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-adjust-1" },
    payload: { quantity: 10, reason: "duplicate" }
  });
  assert.equal(response.statusCode, 200);

  const inventoryBefore = await prisma.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
  assert.equal(inventoryBefore.physicalQty, 10);

  response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/orders",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-order-1" },
    payload: { number: "TEST-ORDER-1", items: [{ productId, quantity: 3, unitPrice: 20 }] }
  });
  assert.equal(response.statusCode, 201);

  const inventoryAfter = await prisma.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
  assert.equal(inventoryAfter.physicalQty, 10);
  assert.equal(inventoryAfter.reservedQty, 3);
});

test("consumption atomically reduces physical and reserved stock", async () => {
  const order = await prisma.order.findUniqueOrThrow({ where: { companyId_number: { companyId, number: "TEST-ORDER-1" } } });
  const response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/orders/" + order.id + "/consume",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-consume-1" }
  });
  assert.equal(response.statusCode, 200);

  const inventory = await prisma.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
  assert.equal(inventory.physicalQty, 7);
  assert.equal(inventory.reservedQty, 0);
});

test("cancellation releases reservation without changing physical stock", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/orders",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-order-2" },
    payload: { number: "TEST-ORDER-2", items: [{ productId, quantity: 2, unitPrice: 20 }] }
  });
  assert.equal(response.statusCode, 201);
  const order = await prisma.order.findUniqueOrThrow({ where: { companyId_number: { companyId, number: "TEST-ORDER-2" } } });

  const cancel = await app.inject({
    method: "POST",
    url: "/companies/" + companyId + "/orders/" + order.id + "/cancel",
    headers: { authorization: "Bearer " + adminToken, "idempotency-key": "test-cancel-1" }
  });
  assert.equal(cancel.statusCode, 200);

  const inventory = await prisma.inventory.findUniqueOrThrow({ where: { companyId_productId: { companyId, productId } } });
  assert.equal(inventory.physicalQty, 7);
  assert.equal(inventory.reservedQty, 0);
});
