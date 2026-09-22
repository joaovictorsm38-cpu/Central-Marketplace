import type { FastifyInstance } from "fastify";
import { registerAuth } from "./auth.js";
import { registerProductRoutes } from "./products.js";
import { registerInventoryRoutes } from "./inventory.js";
import { registerOrderRoutes } from "./orders.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerAuth(app);
  await registerProductRoutes(app);
  await registerInventoryRoutes(app);
  await registerOrderRoutes(app);
}
