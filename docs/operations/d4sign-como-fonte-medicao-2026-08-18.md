# D4Sign como fonte da verdade das assinaturas — o que foi medido (18/08/2026)

Pedido do dono: *"queria usar somente o D4Sign, o C2X tem muito gap ainda"*.

Este documento existe porque a resposta honesta é **"está cumprido em dois empreendimentos e não
está no terceiro"**, e o terceiro é justamente o recorte padrão da tela. O número está aqui para a
decisão não depender de memória de conversa.

Reprodução: `node scripts/apolo/medir-divergencia-d4sign.mjs` (read-only, credencial do
`.env.local`, nenhum dado pessoal na saída).

## O defeito que motivou a troca

No C2X, `contract_signatures`:

- `statusId` é **NULO em 100%** das 3.675 linhas;
- `contract_signature_status_id` tem **1.470 "Em aberto" (7)** — documentos que a D4Sign já
  finalizou e o C2X nunca soube;
- `create_webhook = 0` em 100% das linhas: o webhook nunca foi ligado, então o C2X nunca ia saber.

O erro tem direção conhecida: o C2X erra **para menos** (mostra pendente o que já foi assinado).
Ele não inventa assinatura. Por isso o fallback mostra o dado antigo com aviso em vez de esconder
a tela.

## O que a medição encontrou no Vale do Ouro (VOC 37 + VOL 36)

| medida | valor |
| --- | --- |
| envios no recorte | 195 (185 com `uuidDoc`) |
| linhas de assinatura | 2.420 (1.202 marcadas assinadas no C2X) |
| documentos do recorte presentes no catálogo da D4Sign | 185 de 185 (**0 fora**) |
| finalizados / cancelados no recorte | **0 / 0** |
| em movimento | **185** |
| linhas conferidas assinante a assinante | 1.534 |
| **D4Sign diz ASSINADO e o C2X diz pendente** | **120** |
| C2X diz assinado e a D4Sign diz pendente | 0 |

As 120 são cobrança indevida hoje: o painel pede assinatura de quem já assinou.

## O achado que muda a conclusão

`consultarDocumentosD4Sign` decide **tudo ou nada** por recorte:

```ts
const desisteDaLista =
  paraLista.length > TETO_ASSINANTES_POR_CARGA &&      // 185 > 20
  conhecidosNoCatalogo.length === paraLista.length;    // 185 === 185
```

No Vale do Ouro as duas condições são sempre verdadeiras, então **o `/list` não é chamado para
nenhum documento** e todas as linhas voltam como `d4sign-status`: situação confirmada, marcação de
quem assinou vinda do C2X. E a situação que a D4Sign confirma ali ("aguardando assinaturas") é a
mesma que o C2X já tinha certa.

**Consequência: no recorte padrão, a troca de fonte não corrige nenhuma das 120.** Ela corrige em
Vista Alegre (1 documento em movimento) e Lagoa Bonita (13), onde tudo cabe no teto.

O "tudo ou nada" está certo como regra: perseguir "o que couber" faria metade das linhas
confirmadas e metade não, com a metade mudando a cada F5. O problema não é a regra, é o volume.

## Por que teto maior não resolve

Medido, com 6 chamadas em paralelo:

- catálogo inteiro (3.923 documentos, 9 páginas): **14,4 s sequencial**, ~3 s em paralelo, cacheado
  5 min e compartilhado pelo Hub inteiro;
- `/list` dos 185 em movimento: **54,4 s** (mediana de 1.481 ms por chamada).

Orçamento de uma carga de tela é 8 s. 54 s não cabem em teto nenhum, e subir a concorrência é
apostar contra um rate limit que a D4Sign não publica (nenhum cabeçalho `rate`/`limit`/`retry`).

## O que falta para cumprir o pedido inteiro

Persistir a conciliação, não ampliá-la em tempo de request:

1. tabela própria com o resultado por documento (situação, assinantes, quando foi conferido);
2. cron incremental que renova os documentos em movimento em lotes, respeitando o orçamento;
3. telas lendo do banco, com o carimbo de quando foi conferido.

Isso é **migration + cron**, ou seja, operação sensível: depende de OK do Lucas. Enquanto não
existir, o aviso na tela é o que impede a leitura errada — e é por isso que ele não pode ser
removido por "poluir".

## Os três leitores que continuam no C2X puro

Ligados à D4Sign em 18/08: a tela Contratos do Apolo (`carregarPainelDeContratos`) e a visão
Contratos do portal (`lerAssinaturasDoPortal`), ambas por `montarQuadroComD4Sign`.

Continuam lendo `carregarPainelAssinatura` (C2X puro):

- `/api/apolo/painel-assinatura` — o painel interno;
- `/api/publico/bi/assinaturas` — o BI público do Vale do Ouro;
- `/publico/painel` — o painel do coordenador (LIVE).

Hoje isso **não** produz divergência visível, porque no Vale do Ouro a tela nova cai em
`d4sign-status` e mostra os mesmos números. No dia em que a persistência entrar, os três passam a
discordar da tela nova em até 120 assinaturas e precisam ser migrados no mesmo pacote. O BI é
público e sem login: mudar a fonte dele significa consulta externa disparada por visitante
anônimo — decisão de custo e exposição, não detalhe de implementação.

## Privacidade (o que não atravessa)

`GET /documents/{uuid}/list` devolve CPF (`user_document`), e-mail, IP, geolocalização e
user-agent do assinante. `signatarioParaTela` é a única porta de saída e passa nome, papel,
assinou e quando. `whoCanceled` (e-mail do operador da Careli) é interno.

A rota do portal também barra `cancelados` (ids crus de `contract_signatures`) e `resumoDaFonte`
(contabilidade interna): o payload vai para o navegador de cliente externo e entrega só o que a
tela desenha.
