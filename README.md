# Central Marketplace

Sistema operacional inteligente para e-commerce.

## Fase atual

Implementação do Core: multiempresa, autenticação/autorização, produtos/SKUs, estoque, pedidos, auditoria, idempotência e outbox.

Financeiro / Profit Engine permanece fora do escopo desta etapa até que o núcleo transacional esteja validado.

## Monorepo

- apps/web — aplicação web
- apps/api — API
- packages/database — Prisma e banco
- packages/shared — contratos e utilitários compartilhados
- infra — infraestrutura local/CI
