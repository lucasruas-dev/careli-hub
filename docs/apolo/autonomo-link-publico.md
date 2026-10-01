# Link público do corretor autônomo (desenho de 01/10/2026)

> Pedido do Lucas, 01/10/2026: *"fizemos o processo de cadastro de corretor autonomo, mas ele seria para o time interno, preciso criar o link publico igual temos da cad, imobiliaria"*.
> Branch `feat/autonomo-link-publico`. Sem migration: nada no banco muda de forma.

## A regra que não pode quebrar

O cadastro feito pelo link cai na **mesma entidade** e na **mesma validação** que o time já usa. Nada de cadastro paralelo. Nada vira autônomo, nem vai ao C2X ou ao Asaas, sem uma pessoa do time decidir.

## O que existia antes (medido em 01/10/2026)

- O autônomo nascia só pelo cadastro interno do Apolo (`/apolo/cadastro?tipo=corretor`), já valendo, porque quem preenche é da casa. Mesma regra da imobiliária: *"cadastro feito pelo operador vale já como validação"*.
- O que faz alguém ser autônomo é o **código CA** (`apolo_entities.broker_code`). Todo leitor de autônomo exige o código: `lerAutonomo` e `lerCorretoresAutonomos` em `lib/apolo/habilitacao-do-autonomo.ts`. Por eles passam a CAD do cliente, a reserva, a habilitação e o envio ao C2X.
- Não havia fila de validação de autônomo: o Board deixa corretor de fora de propósito (`bornRole = corretor`).
- A habilitação por empreendimento existia só no servidor (`/api/apolo/corretores-autonomos/[id]/habilitar`). Nenhuma tela chamava a rota.
- Produção: zero autônomos com código, zero habilitações (SELECT de 01/10/2026).

## Decisões do Lucas (01/10/2026)

| Pergunta | Decisão |
|---|---|
| Onde o time valida | Tela nova no Apolo, com as três ações da imobiliária: aprovar, pedir correção, indeferir. Na mesma tela, o botão de habilitar em empreendimento. |
| Empreendimentos no link | O autônomo **indica interesse**. É só um pedido; quem habilita é o time. |
| Documentos | Identidade e comprovante de endereço, **sem certidão de estado civil**. |
| Aviso de cadastro novo | Notificação no sino do hub. |
| Link | Fixo, `https://c2x.app.br/publico/autonomo` (padrão dos outros dois links). |

## Como funciona

### Lado de quem se cadastra (celular)

1. **Empreendimentos de interesse.** A vitrine é a mesma da imobiliária (`listEmpreendimentosParaImobiliaria`: master + `recepcao_imobiliaria`). Sem nenhum aberto, dá para seguir.
2. **CPF.** `POST /api/publico/autonomo/iniciar` confere o CPF e responde uma de três coisas:
   - liberado: devolve a pré-sessão assinada, amarrada ao CPF;
   - já é autônomo: frase fixa, sem nome nem dado da ficha;
   - em análise: frase fixa.
3. **Assistente.** O mesmo `CadastroFlow` do time, `tipo="corretor"`, em modo público. Os textos falam com a pessoa ("seu documento"). Não pede certidão nem cônjuge.
4. **Envio.** `POST /api/publico/autonomo/cadastro` grava e devolve o código de autenticação e o PDF. Não devolve o id da ficha.

### O que é gravado (`lib/apolo/autonomo-do-link.ts`, `registrarCadastroDoLink`)

- A ficha, por `createApoloEntity`: a mesma porta do cadastro interno, com `role: corretor`, `persona: pf`, `dedupPorDocumento: true` (o mesmo CPF anexa na ficha que já existe) e `cadastroDeCorretorAutonomo: true`. **Sem gerador de código.**
- A entrada é por lista de inclusão. O corpo não consegue mandar `empreendimentos` (viraria habilitação), `corretores`, `empresa`, `vinculo` nem imobiliária.
- O papel `corretor` fica `review`. A exceção é quem já era corretor `active` de uma imobiliária: continua ativo, porque rebaixar tiraria a imobiliária dele do ar. Sem código, ele não é autônomo de qualquer jeito.
- O **pedido** vai para `apolo_audit_events` (`corretor_autonomo_solicitado`, com o interesse no `metadata`). Não vai para o `metadata` da ficha, que o sync do C2X reescreve inteiro.
- Documentos agrupados no drive da ficha, PDF com autenticação, e o aviso no sino para administradores e líderes ativos. Medido: não existe permissão do Apolo no hub, e eram 7 das 10 pessoas ativas.

### Lado do time (Apolo > Autônomos)

- **Em análise**, **Em correção**, **Decididos (30 dias)** e **Habilitação**. A fila sai da trilha: o estado de cada ficha é a última das quatro ações (`solicitado`, `aprovado`, `correcao`, `indeferido`).
- **Aprovar** faz o que o cadastro interno faz: código CA da sequência do banco, gravado só em ficha sem código (`broker_code is null` no próprio UPDATE, então dois cliques não dão dois códigos), e papel `corretor` `active`. Não habilita nada.
- **Pedir correção** registra o motivo e manda WhatsApp com o link. A pessoa abre o link, informa o CPF e reenvia; o portão reabre para quem está em correção, e a ficha é a mesma.
- **Indeferir** registra o motivo, bloqueia o papel que o link pôs em análise e avisa. Quem já era corretor ativo de imobiliária não é tocado.
- **Habilitação** lista todo autônomo aprovado, inclusive os do cadastro interno, e chama a rota que já existia. Ela grava auditoria e avisa o coordenador.
- Os documentos ficam na ficha do CRM ("Abrir ficha e documentos" abre na aba Documentos).
- O aviso ao corretor sai pelo celular do Relacionamento (`enviarPeloRelacionamento`) e fica registrado em `apolo_disparos`. O código CA não vai na mensagem: o código aparece *"somente no CRM"*.

## Segurança do link aberto

- **Prefixo mínimo no proxy**: só `/api/publico/autonomo`, com duas rotas. A fila e as decisões moram em `/api/apolo/corretores-autonomos/*`, com Bearer. Coberto por `lib/publico/cad/proxy-autonomo.test.ts`, que importa o proxy de verdade.
- **Sessão validada em cada rota**: pré-sessão HS256 própria (`preAutonomo`, header `x-autonomo-pre-sessao`), que não vale nos outros links. Os tokens dos outros links também não valem aqui.
- **Anti-troca**: o CPF do documento tem de ser o do token.
- **Torneiras pagas**: com o token do autônomo, o enriquecimento por CPF só vale para o CPF dele, e a consulta de CNPJ é recusada. Sem isso, o link virava um balcão de consulta de dados de terceiros.
- **Rate limit**: balde próprio `autonomo` no portão (24 por 10 min por IP, com atraso progressivo). O envio usa o balde `enviar`.
- **Documentos**: o bucket privado de sempre, com URL assinada. O dono do staging é um resumo do CPF, nunca o CPF em claro.
- **CPF já cadastrado**: frase fixa, sem nome, e-mail ou id.
- **E-mail repetido**: o mesmo CPF não barra a si mesmo, porque fichas da mesma pessoa são ignoradas (`cadastroDeCorretorAutonomo`). Entre pessoas diferentes, recusa 409 com o que fazer, sem dizer de quem é o e-mail (`recusaPublicaDoCorretor`).
- **Vocabulário**: nada de fila, Board, código CA ou divisão interna nas telas e mensagens externas.
- **Celular**: `publico-shell` em todas as telas (exceção do `html{min-width:1024px}`).

## Arquivos

- Público: `app/publico/autonomo/page.tsx`, `modules/publico/autonomo/AutonomoPublicoPortal.tsx`, `app/api/publico/autonomo/{iniciar,cadastro}/route.ts`.
- Compartilhado: `lib/publico/cad/sessao.ts` (pré-sessão), `rate-limit.ts` (balde), `app/api/publico/cad/{ocr,upload-url}/route.ts` (aceitam o token novo), `proxy.ts`.
- Domínio: `lib/apolo/autonomo-do-link.ts`, `lib/apolo/credenciamento-mensagens.ts` (três mensagens), `lib/apolo/cadastro-obrigatorios.ts` (`semEstadoCivil`).
- Interno: `app/api/apolo/corretores-autonomos/fila/route.ts`, `.../[id]/decisao/route.ts`, `modules/apolo/blocks/autonomos/autonomos-view.tsx`, `lib/apolo/catalog.ts`, `modules/apolo/ApoloPage.tsx` (`?tela=autonomos`).
- Assistente: `modules/apolo/blocks/cadastro/cadastro-flow.tsx` (`autonomoPublico`, `extrasDoEnvio`, `semChecagemCpf`).
- Testes: `lib/publico/cad/sessao.autonomo.test.ts`, `lib/apolo/autonomo-do-link.test.ts`, `app/api/publico/autonomo/rotas.test.ts`, `lib/publico/cad/proxy-autonomo.test.ts`.

## Fora deste recorte (pendências)

- O link **não** entrou na aba Links do empreendimento. Essa aba também aparece no portal do incorporador (Gurgel), fora da Careli. O time copia o link pelo botão da tela Autônomos.
- A pessoa que é corretor de imobiliária **e** pede para ser autônomo fica com as duas coisas depois da aprovação. Falta o Lucas dizer se isso pode.
- O cadastro interno do autônomo continua pedindo a certidão. A decisão de 01/10 foi só sobre o link.
- A habilitação não avisa o próprio autônomo, só o coordenador. Isso já era assim antes.
