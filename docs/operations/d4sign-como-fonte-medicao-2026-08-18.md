# A tela de contratos está batendo com o C2X? (medido em 18/08/2026)

Pergunta do dono: *"olha se está batendo com o C2X, por favor"*, no contexto do pedido anterior
*"queria usar somente o D4Sign, o C2X tem muito gap ainda"*.

**Resposta curta: sim, bate — casa por casa. E o gap do C2X existe, mas não está no Vale do Ouro:
91% dele está na Lavra do Ouro.**

Reprodução (read-only, credencial do `.env.local`, nada de dado pessoal na saída):

```
node scripts/apolo/conferir-tela-vs-c2x.mjs        # o recorte da tela, assinante a assinante
node scripts/apolo/onde-o-c2x-esta-furado.mjs      # o acervo inteiro, por empreendimento
```

## 1. A tela bate com o C2X

Três lados conferidos de forma independente — SQL cru com o filtro exato do painel, a rota que roda
em produção, e a contagem da tela:

| | linhas | assinadas | unidades |
| --- | --- | --- | --- |
| SQL cru (VOC 37 + VOL 36) | 2.295 | 1.202 | 185 |
| `/api/publico/bi/assinaturas` em produção | 2.295 | 1.202 | 185 |

Batem exatamente. O filtro que faz a conta fechar é `cs.send_document_signature = 1` junto com
`contract_signature_status_id <> 6`: sem ele seriam 2.420 linhas / 195 envios, ou seja **125 linhas
e 10 envios que a tela nunca mostra**. Quem contar sem esse filtro vai achar que a tela está
perdendo dado.

## 2. No Vale do Ouro o C2X está CERTO

Conferido assinante a assinante contra a D4Sign, nos 185 envios do recorte:

| medida | valor |
| --- | --- |
| linhas pareadas com a D4Sign | 1.487 (658 delas só pelo nome, o e-mail não bastou) |
| **D4Sign diz assinado e o C2X diz pendente** | **0** |
| **C2X diz assinado e a D4Sign diz pendente** | **0** |
| linhas sem par | 808 |
| signatários da D4Sign sem par | 808 |

Os dois "sem par" dão **o mesmo número, 808**. Não é assinatura faltando: é a mesma pessoa gravada
com e-mail e grafia diferentes nos dois sistemas, então o pareamento não fecha. Onde ele fecha, os
dois sistemas concordam em 100% das linhas.

## 3. O gap do C2X, e onde ele está

Régua: documento que a D4Sign diz **finalizado** tem todas as assinaturas colhidas por definição.
Se o C2X ainda marca o envio como aberto, toda linha pendente dele é pendência que não existe.
Isso sai do catálogo em lote, sem uma chamada por documento, então cobre o acervo inteiro (2.171
envios com uuid, todos presentes no catálogo).

| emp | empreendimento | envios | pendentes | **falsas** | docs |
| --- | --- | --- | --- | --- | --- |
| LOS | Lavra do Ouro (id 4) | 275 | 457 | **454** | 151 |
| LBR | Lagoa Bonita | 211 | 27 | 13 | 6 |
| REP | Recanto do Pará | 80 | 9 | 6 | 4 |
| CDJ | Cidade Jardim | 375 | 6 | 6 | 6 |
| PDV | Portal dos Vales | 153 | 5 | 5 | 2 |
| RDP | Rio de Pedras | 370 | 5 | 5 | 5 |
| VDO | Veredas do Ouro | 138 | 14 | 4 | 4 |
| MLN / MLC | — | 37 | 3 | 3 | 3 |

**Total: 496 assinaturas cobradas indevidamente**, e 454 delas (91%) são da Lavra do Ouro, em 151
documentos. Mais 1 envio que a D4Sign cancelou e o C2X mostra vivo (3 linhas).

**Limpos, batendo com a D4Sign: 14 dos 23 empreendimentos** — entre eles VOC, VOL, VOR, VAL
(Vista Alegre) e LBF (Lagoa Bonita), ou seja, todos os portais ativos.

⚠️ **O GLOTES NÃO propaga as 454** (conferido no código em 18/08, depois de eu ter afirmado o
contrário). A API entrega loteamentos, clientes, lotes, vendas e recebimentos; assinatura não
está no contrato, e `lib/integrations/glotes/consultas.ts` nunca toca `contract_signatures` —
vendas lê `sale_statuses`. Se um dia o cliente pedir assinatura, a regra é servir do quadro
conciliado (`montarQuadroComD4Sign`), não do legado cru.

## 4. Por que o teto de 20 não perde essas 496

`consultarDocumentosD4Sign` resolve documento **terminal** pelo catálogo, antes de chegar ao teto:

```ts
if (documento && situacaoEhTerminal(documento.situacao)) { /* resolvido, sem /list */ }
```

Finalizado é terminal. Logo as 496 são corrigidas pela listagem em lote (~3 s, uma vez a cada
5 min para o Hub inteiro) sem nenhuma chamada por documento. O `desisteDaLista` só abre mão do
detalhe pessoa a pessoa de documento **em movimento** — e no Vale do Ouro, onde isso acontece (185
em movimento, todos no catálogo), o C2X está certo, então não se perde nada.

Ou seja: o pedido *"usar somente o D4Sign"* está cumprido no que muda a operação. Persistir a
conciliação numa tabela com cron continua sendo o caminho para confirmar também o detalhe dos
documentos em movimento, mas deixou de ser urgente — não é ali que a pendência falsa mora.

## 5. Os três leitores que continuam no C2X puro

Ligados à D4Sign em 18/08: a tela Contratos do Apolo (`carregarPainelDeContratos`) e a visão
Contratos do portal (`lerAssinaturasDoPortal`), ambas por `montarQuadroComD4Sign`.

Continuam em `carregarPainelAssinatura` (C2X puro):

- `/api/apolo/painel-assinatura` — o painel interno;
- `/api/publico/bi/assinaturas` — o BI público do Vale do Ouro;
- `/publico/painel` — o painel do coordenador (LIVE).

No Vale do Ouro os três continuam batendo com a tela nova, porque lá os dois sistemas concordam.
Eles só passariam a divergir num recorte com pendência falsa — Lavra do Ouro, por exemplo. O BI é
público e sem login: mudar a fonte dele é decisão de custo e exposição, não detalhe técnico.

## 6. Erros de medição que custaram tempo (para não repetir)

1. **Casar assinante por e-mail com um `Map`, sem consumir o par.** Um signatário assinado casa com
   N linhas do mesmo e-mail e inventa divergência. Deu "120 erradas no Vale do Ouro" numa primeira
   conta; o número era artefato. O pareamento tem que ser 1-para-1, como `conciliarDocumento`.
2. **Ler o campo errado da D4Sign.** No `/list` o nome é `user_name`, não `name` — com `name` o
   casamento por nome dá zero e a medição fica limpa e falsa. E `assinou` exige `signed === "1"`
   **e** `sign_info` presente.
3. **Contar sem o `send_document_signature = 1`.** Infla o recorte em 125 linhas.

## 7. Privacidade (o que não atravessa)

`GET /documents/{uuid}/list` devolve CPF (`user_document`), e-mail, IP, geolocalização e user-agent
do assinante. `signatarioParaTela` é a única porta de saída e passa nome, papel, assinou e quando.
`whoCanceled` (e-mail do operador da Careli) é interno.

A rota do portal também barra `cancelados` (ids crus de `contract_signatures`) e `resumoDaFonte`
(contabilidade interna da reconciliação): aquele payload vai para o navegador de cliente externo e
entrega só o que a tela desenha.

O BI público expõe nome e e-mail de quem assina sem login — decisão registrada do dono em
17/08/2026 (*"só deixa público, somente isso"*), com a página em `noindex`.
