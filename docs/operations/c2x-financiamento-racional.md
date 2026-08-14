# Financeiro da venda no C2X — o racional (estudo do Power BI, 14/08/2026)

Estudo do `Careli - Dashboard Vista Alegre.pbit`, **aba Financiamento**, feito a pedido do Lucas
("o BI é antigo, não leve a DAX ao pé da letra; entenda o racional e monte o nosso"). Este
documento guarda o RACIONAL — o que cada número significa e de onde sai no legado — para não
precisar reabrir o `.pbit` a cada painel novo.

O painel do coordenador (`/publico/painel`) usa a parte de cobrança disso. A parte de receita
líquida fica registrada aqui, mas **não** entra naquela tela (decisão do Lucas: coordenador quer
cenário de pagamento, não receita do loteador).

## De onde vêm os dados

O BI lê o MySQL de produção direto (`MySQL.Database("sulivam-production…", "prod_careli")`), tabela
`payments`, expandindo os relacionamentos. O de-para dos nomes:

| Nome no BI | Origem no C2X |
|---|---|
| Valor da Parcela | `payments.initial_value` |
| Data de Vencimento / de Pagamento | `payments.due_date` / `payments.payment_date` |
| Perfil de Parcela | `parcel_types.name` — **1 Ato, 2 Sinal, 3 Parcela, 4 Avulso** |
| Status da Parcela | `payment_statuses.name` — **5 Pago, 6 Aguardando pagamento, 7 Atrasado** |
| Valor Unidade (VGV) | `enterprise_unities.price` |
| Entrada | `commercial_plans.initial_input_value` |
| Comissionamento Incorporador | `commercial_policies.commissioning_incorporador` (puxado e **não usado** no BI) |

## O racional do dinheiro

**1. Entrada = Ato + Sinal.** O BI trata as duas juntas (`Perfil de Parcela IN {"Ato","Sinal"}`) e
as separa das mensais. Ato é a parcela de sinalização (R$ 1.000 no Vale do Ouro); Sinal é o
restante da entrada, parcelável em até `commercial_policies.max_signal_parcels` vezes.

**2. A comissão sai INTEIRA da entrada.** Não é rateada pelas mensais. O fator do loteador na
entrada é:

```
fator = (entrada bruta do contrato − comissão × VGV da unidade) ÷ entrada bruta do contrato
```

O contrato inteiro (`acquisition_request_id`) é a unidade de cálculo, não a parcela: a comissão é
do negócio, e cada parcela carrega sua fração dela.

**3. A mensal tem taxa de administração.** O BI usa `0,975` (2,5%) para `Perfil = "Parcela"`.

**4. Receita transferida ≠ receita prevista.** Transferida conta pela **data de pagamento** e só
o que está `Pago`; prevista conta pela **data de vencimento**, tudo. Inadimplência é
`Atrasado ÷ Previsto` no mesmo recorte.

## ⚠️ Onde o BI não serve como está

- **A comissão de 7,5% é do Vista Alegre**, não uma constante da Careli. Ela está chumbada na
  coluna `Fator Loteador` porque aquele dashboard é de um empreendimento só. O valor real está em
  `commercial_policies.total_value_commission`, por empreendimento (medido em 14/08/2026):

  | Empreendimento | Comissão total | Entrada |
  |---|---|---|
  | Vale do Ouro (VLO/VOL/VOC) | 6,0% | 10% |
  | Veredas do Ouro (VDO) | 6,5% | 10% |
  | Recanto do Pará (REP) | 7,0% | 10% |
  | Vista Alegre (VAL) | 7,5% | 10% |

  Qualquer painel multi-empreendimento **tem que ler a política**, senão erra o líquido de todos
  menos um.

- **Duas comissões diferentes dentro do próprio BI**: a coluna `Fator Loteador` usa 7,5% e a
  medida `Entrada (Líquida Loteador)` usa 7%. A coluna é a que alimenta os cartões.

- **14 valores chumbados por id** no `Valor Líquido Loteador` (`SWITCH(IdAtual, 221373, 59.38, …)`).
  É correção manual de planilha; não vira regra de sistema.

- **Fator negativo**: quando a comissão passa da entrada (unidades de teste de R$ 5.000, entrada
  simbólica de R$ 110), o `DIVIDE` da coluna devolve negativo. A medida trava com `MAX(0, …)`; a
  coluna não.

## O que virou código

- `lib/apolo/painel-sinal.ts` — cenário de pagamento da entrada (Ato + Sinal) por empreendimento:
  gerado, quitado, a vencer, atrasado, vencendo em 7 dias, e os que estão **sem boleto no Asaas**
  (`payment_asaas_id` nulo). Sem receita líquida, por decisão do Lucas.
- `lib/apolo/painel-assinatura.ts` — a aba Cenário Assinatura do mesmo `.pbit`, já documentada em
  `c2x-painel-assinatura-dax.md`.
