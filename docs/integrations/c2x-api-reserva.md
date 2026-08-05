# C2X · endpoint de RESERVA para a integração Panteon

Especificação do que o Panteon precisa para reservar uma unidade em tempo real, direto do
salão de vendas (terminais POS no lançamento). Documento para encaminhar ao fornecedor do C2X.

**Contexto:** hoje `/api/v1/integrations/panteon/` expõe só `users` e `enterprise_units`.
Sem um endpoint de reserva, o cliente precisa entrar numa fila para que alguém lance a reserva
à mão — é o gargalo que queremos eliminar.

**Autenticação:** a mesma já em uso (`Authorization: <token>` cru + `access_token`).

---

## 1. Criar reserva

```
POST /api/v1/integrations/panteon/acquisition_requests
```

**Corpo:**

```json
{
  "enterprise_unity_id": 5625,
  "client_id": 4713,
  "corretor_id": 3981,
  "stage": "reservado"
}
```

| campo | obrigatório | observação |
|---|---|---|
| `enterprise_unity_id` | sim | a unidade escolhida |
| `client_id` | sim | comprador (user já existente; o Panteon cria pelo endpoint `users`) |
| `corretor_id` | não | corretor que atendeu |
| `stage` | não | padrão `reservado` (etapa 1) |

**Resposta 201:**

```json
{
  "id": 4599,
  "code": "VLO12",
  "stage": "Reservado",
  "unity": { "id": 5625, "block": "05", "lot": "23", "name": "VOL0523" },
  "client": { "id": 4713, "name": "GABRIEL FLORES PARREIRAS" }
}
```

### ⚠️ O requisito mais importante: ATOMICIDADE

Vários terminais operam ao mesmo tempo no salão. **Dois vendedores VÃO tocar no mesmo lote no
mesmo segundo** — isso é certeza, não hipótese.

O endpoint precisa, **numa única transação**, verificar se a unidade já tem pedido aberto e criar
a reserva. Se já houver, **recusar com 409**:

```json
{
  "status": "failed",
  "error": "unidade_indisponivel",
  "current": { "code": "VLO11", "stage": "Reservado" }
}
```

Sem essa garantia no servidor, duas reservas nascem para o mesmo lote e o problema aparece só
no contrato — que é o pior lugar possível.

### Efeito colateral esperado

A unidade deve passar para **Reservado** (`sale_status_id = 2`) no mesmo ato, exatamente como
acontece quando a reserva é feita pela tela do C2X — é isso que faz o masterplan (`show_map`)
mudar de cor para os corretores.

---

## 2. Cancelar reserva

```
DELETE /api/v1/integrations/panteon/acquisition_requests/{id}
```

Ou `PATCH` com `{"stage": "cancelado"}`. Necessário para quando o cliente desiste no balcão:
o lote volta a ficar disponível na hora, sem ninguém precisar entrar no C2X.

**Resposta 200:** `{ "id": 4599, "stage": "Cancelado", "unity_status": "Disponível" }`

---

## 3. Consulta (opcional)

```
GET /api/v1/integrations/panteon/acquisition_requests?enterprise_unity_id=5625
```

Útil para conferência, mas **não é bloqueante**: o Panteon já lê o estado das unidades
direto do banco em modo somente-leitura.

---

## Resumo do que é imprescindível

1. `POST` que cria a reserva **de forma atômica**, recusando com **409** se a unidade já tiver
   pedido aberto.
2. A unidade mudando para **Reservado** no mesmo ato.
3. `DELETE`/`PATCH` para cancelar.

Com esses três, o fluxo do salão fecha: bipar o QR do cliente → escolher quadra/lote → reservar
em tempo real → imprimir o comprovante.
