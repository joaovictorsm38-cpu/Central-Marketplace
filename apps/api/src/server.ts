import Fastify from "fastify";
import { prisma } from "@central/database";
import { registerRoutes } from "./routes.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ status: "ok", service: "central-api" }));
app.get("/health/db", async (_request, reply) => {
  try { await prisma.$queryRaw`SELECT 1`; return { status: "ok", database: "ok" }; }
  catch { return reply.code(503).send({ status: "error", database: "unavailable" }); }
});

await registerRoutes(app);
app.addHook("onClose", async () => prisma.$disconnect());

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: "0.0.0.0" }).catch((error) => { app.log.error(error); process.exit(1); });
