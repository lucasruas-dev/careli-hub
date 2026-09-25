# 2026-09-24 · Carteira, Boletos e LSoft no portal da Cecílio: o que existe hoje

Pedido do Lucas (24/09/2026), com prints das três telas: cards que filtram a analítica, baixa manual
pelo time interno, levar o menu de abas do LSoft para Carteira e Boletos, e subir os demais
empreendimentos para o LSoft Integração.

Este documento é o levantamento que antecede qualquer código. Nada foi alterado.

## 1. O de-para das carteiras: Boletos × LSoft (medido em 24/09/2026)

Medido na cópia do `\\SERVIDOR\Sistema\sgc\dados.mdb` (LSoft SGC, Access anterior ao 2000, lido por
Jet 4.0 em PowerShell 32 bits). No LSoft o empreendimento é a **CATEGORIA**.

| slug do boleto | categoria no LSoft | títulos em RECEBER | no Panteon? |
|---|---|---|---|
| `garden` | 124 Condomínio Garden | 12.317 | sim |
| `vale-do-sol` | 102 Vale do Sol | 5.131 | sim |
| `vale-do-ouro-2` | 129 Pórtico Loteamento Vale do Ouro | **0** | 621 parcelas carregadas, fora da tela |
| `giant-towers` | 118 Prédio Giant Towers Rua Sete Setembro | 1.286 | não |
| `on-sky` | 66 On Sky Residence (+ 126 Enxoval On Sky, 31) | 386 | não |
| `guaimbe` | 70 Edifício Guaimbê | 120 | não |
| `ed-rubi` | 115 Edifício Rubi e Jade | 220 (junto com o Jade) | não |
| `ed-jade` | 115 Edifício Rubi e Jade | idem, **mesma categoria** | não |
| `ed-esmeralda` | **não existe** | — | não |
| `ed-cristal` | **não existe** | — | não |

⚠️ **Três achados que mudam o trabalho:**

1. **Esmeralda e Cristal não existem no LSoft.** Varri as 137 categorias: há "Edifício Safira"
   (122), não há Esmeralda nem Cristal. Esses dois não têm carteira para subir.
2. **Rubi e Jade são UMA categoria só no LSoft** e dois slugs na tela de Boletos. Separá-los exige
   parse do texto livre de `OBSERVACOES` (onde mora a unidade) ou decisão de tratá-los como um.
3. **O Vale do Ouro tem 0 títulos em RECEBER**, embora o Panteon já tenha 621 parcelas dele. A
   carteira ou já foi toda baixada para RECEBIDOS, ou veio por outra via. Conferir antes de recarregar.

**Carteiras grandes no LSoft que NÃO estão na tela de Boletos:**

| categoria | títulos | valor |
|---|---|---|
| 17 Vitor | 1.456 | R$ 20,9 mi |
| 69 Loteamento José Lino | 578 | R$ 1,26 mi |

A 17 é a segunda maior em dinheiro de toda a base. O nome sugere carteira pessoal do sócio, não
empreendimento. Decisão do Lucas se entra.

## 2. A trava que vem ANTES de subir qualquer empreendimento

⚠️ **A próxima carga do LSoft APAGA as 160 baixas manuais e as 948 linhas de histórico.**

O importador (`scripts/lsoft/importar-para-supabase.mjs`) apaga todas as parcelas antes de regravar,
e `lsoft_clientes_edicoes.parcela_id` é FK `ON DELETE CASCADE` para `lsoft_parcelas`. O id da parcela
é volátil entre cargas. Resultado: recarregar hoje joga fora o trabalho que o time já fez na tela.

O caminho já provado no repo é o de `lsoft_classificacao_de_parcela`: casar por `impressao_digital`
em vez de FK para o id. **Isto precisa ser feito antes da carga, não depois.**

Segunda trava, menor: o CHECK `lsoft_parcelas_empreendimento_check` só aceita `Garden`,
`Vale do Sol` e `Vale do Ouro - 2`, e já derrubou a carga de 08/09 inteira por isso. Precisa de
migration, e vale trocar a lista fixa por tabela.

## 3. Baixa manual: são três bases diferentes, com três riscos diferentes

| onde | existe hoje? | o que a baixa significa |
|---|---|---|
| **LSoft** | **sim**, e já rodou em 160 parcelas | UPDATE em `lsoft_parcelas` com trilha por campo em `lsoft_clientes_edicoes` |
| **Boletos** | não | o "pago" é sempre o que o Asaas devolve |
| **Carteira** | não | a fonte é o C2X legado, **read-only** |

⚠️ **Na Carteira não existe baixa possível hoje.** A API do C2X não expõe baixa: o
`POST /payments/{id}/settlement` é proposta enviada ao fornecedor
(`docs/integrations/c2x-panteon-openapi.yaml`, `1.0.0-proposta`), não existe do lado deles. Baixa no
C2X hoje é feita pela TELA do C2X. Qualquer baixa que a Carteira ofereça vive só no Panteon e
**diverge do legado** até o fornecedor entregar a rota.

⚠️ **Nos Boletos a decisão é de política:** dar baixa só no Panteon deixa a cobrança aberta no Asaas
(o cliente ainda consegue pagar de novo), e dar baixa no Asaas exige o `receiveInCash`, que não tem
wrapper em `lib/apolo/boletos/emissao.ts`. `boletos_pagamentos` já é escrita pelo webhook e
**nunca é lida por ninguém**.

## 4. Não existe "time interno" dentro do portal

O pedido diz "para o time interno dar baixa". Hoje o portal do incorporador **não tem papel de
usuário**: a única granularidade é o slug do portal inteiro (`autorizar`, `portalVeBaseLsoft`,
`portalOperaVenda`, `portalPodeEmitir`). Quem entra em `/incorporador/cecilio-rocha` é tratado
igual, seja da Careli ou da Cecílio.

Duas saídas: criar um papel na conta do portal (`apolo_incorporador_contas`), ou deixar a baixa na
família interna (`/api/lsoft`, `/api/apolo`) com `authorizeApoloWrite`.

⚠️ E a porta de escrita de parcela do LSoft hoje usa `authorizeApoloRead`, que inclui `viewer` —
levantado em 19/08 e deixado como está. Ampliar a baixa sem apertar isso amplia o furo junto.

## 5. Cards clicáveis

Nem todo card consegue filtrar com o payload de hoje.

- **Filtram com o que já existe:** Vencido e Inadimplentes (o `filtrarUnidades` já entende
  `overdueInstallments`), Clientes, Carteira total.
- **Não filtram:** Recebido e Recuperação (pago no mês) não têm campo por unidade em
  `UnidadeDaTela`. Ou a rota passa a mandar mais campos, ou o filtro vai para o servidor.

O molde certo já existe na própria tela: o **Extrato da aba Indicadores** filtra no servidor, com
debounce de 300ms (`TelaCarteira.tsx:471`). Nos Boletos o estado de filtro está preso dentro do
componente `Emitidos` e precisa subir; as tabelas "A emitir" e "Fora da emissão" não têm filtro
nenhum, só ordenação, então o card "A emitir" não teria onde aterrissar.

## 6. Onde a ficha em abas deve morar (recomendação)

O menu Cadastro · Parcelas · Documentos · Histórico está soldado dentro do `PainelDoCliente` do
`CarteiraLsoft.tsx`. Não existe componente reaproveitável.

**Recomendação: a ficha é da UNIDADE, não do cliente, e abre pelo popup que já existe na Carteira.**

Por quê: as três telas hoje casam por chaves diferentes — Carteira por `unitId`/`pedidoId` do C2X,
Boletos por `empreendimento|unidade|sequência`, LSoft por cliente mais o texto livre
`"LOTE: 109 QUADRA: 08"`. A única chave que as três compartilham é a **unidade**, que é a regra que
já vale para boletos. Ficha por cliente obrigaria a resolver "qual dos dois lotes dele" em toda tela.

O caminho em três passos, do menor risco para o maior:

1. Extrair `FichaEmAbas` genérico (cabeçalho, seletor de abas, rodapé de ações) do LSoft, sem mudar
   comportamento nenhum. O LSoft continua usando, e o componente passa a existir.
2. O popup da Carteira, que o Lucas já aprovou, ganha as abas. A aba Parcelas é o que ele já mostra
   hoje; Documentos e Histórico entram depois da chave de casamento resolvida.
3. A linha de Boletos abre a mesma ficha.

⚠️ `lsoft_documentos` está com **0 linhas**. A aba Documentos vai parecer quebrada nas telas novas se
o estado vazio não for tratado.

## 7. Ordem sugerida

1. Proteger o histórico e as baixas da recarga (item 2). Sem isso, subir empreendimento destrói trabalho feito.
2. Migration do CHECK, ou tabela de empreendimentos.
3. Vale do Ouro - 2 na tela do LSoft: o dado já está no banco, faltam três edições pontuais.
4. Extrair e importar as categorias que o Lucas escolher.
5. Cards clicáveis (o que o payload já permite).
6. `FichaEmAbas` e o popup da Carteira.
7. Baixa manual, depois de decidida a política e o papel de usuário.
