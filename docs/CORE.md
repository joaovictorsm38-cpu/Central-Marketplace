# Core — critérios de conclusão

A Fase 1 cobre multiempresa, produtos/SKUs, pedidos, estoque, rastreabilidade, auditoria e infraestrutura de eventos.

## Invariantes

1. Dados sempre são filtrados por companyId.
2. Membro inativo ou inexistente não acessa a empresa.
3. Reserva aumenta reservedQty sem reduzir physicalQty.
4. Consumo de reserva deve reduzir physicalQty e reservedQty na mesma transação.
5. Liberação reduz apenas reservedQty.
6. Operações críticas usam idempotency key.
7. Ledger registra saldo anterior/posterior.
8. Auditoria registra ator, entidade e before/after.
9. Outbox é gravado na mesma transação da mudança de negócio.
10. Estoque físico não pode ficar negativo.

O CI deve ser verde antes de iniciar Finance/Profit Engine.
