import Fastify from "fastify";
import { prisma } from "@central/database";
import { registerRoutes } from "./routes.js";
import { DomainError } from "./errors.js";

export async function buildApp() {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    app.log.error(error);
    return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Erro interno do servidor" });
  });

  app.get("/health", async () => ({ status: "ok", service: "central-api" }));
  app.get("/health/db", async (_request, reply) => {
    try { await prisma.$queryRaw`SELECT 1`; return { status: "ok", database: "ok" }; }
    catch { return reply.code(503).send({ status: "error", database: "unavailable" }); }
  });

  await registerRoutes(app);
  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}

if (process.env.NODE_ENV !== "test") {
  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3001);
  app.listen({ port, host: "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
}
