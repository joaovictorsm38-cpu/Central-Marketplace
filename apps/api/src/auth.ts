import type { FastifyInstance, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import { prisma } from "@central/database";

export async function registerAuth(app: FastifyInstance) {
  await app.register((await import("@fastify/jwt")).default, {
    secret: process.env.JWT_SECRET ?? "development-only-change-me"
  });

  app.decorate("authenticate", async function (request: FastifyRequest) {
    await request.jwtVerify();
    const payload = request.user as { sub?: string };
    if (!payload.sub) throw new Error("Invalid token");
    request.userId = payload.sub;
  });

  app.post("/auth/login", async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.code(400).send({ error: "email e password são obrigatórios" });
    }

    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase().trim() } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: "Credenciais inválidas" });
    }

    const memberships = await prisma.companyMember.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      select: { companyId: true, role: true }
    });
    const token = await app.jwt.sign({ sub: user.id });
    return { token, user: { id: user.id, email: user.email, name: user.name }, memberships };
  });
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    companyId?: string;
  }
}
