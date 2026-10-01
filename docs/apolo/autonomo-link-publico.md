# Link público do corretor autônomo (desenho de 01/10/2026, segunda versão)

> Pedido do Lucas, 01/10/2026: *"fizemos o processo de cadastro de corretor autonomo, mas ele seria para o time interno, preciso criar o link publico igual temos da cad, imobiliaria"*.
> Branch `feat/autonomo-link-publico`. Sem migration.
> A segunda versão responde à revisão da Publicação (versão 1.404.0, não publicada).

## A regra que não pode quebrar

O cadastro feito pelo link cai na **mesma entidade** e na **mesma validação** que o time já usa. Nada de cadastro paralelo.

**Nada do que chega pelo link vira dado antes de uma pessoa da coordenação aprovar.** Isso vale para:
- ficha, papel, contato, endereço e documento na ficha;
- código CA e habilitação;
- C2X e Asaas.

## Por que a segunda versão

A primeira versão gravava a ficha no envio: criava a ficha nova ou acrescentava na que já existia. A revisão da Publicação provou que acrescentar ainda é gravar.

Em ficha que já existe, o cadastro preenche os campos **vazios** com o que foi digitado: qualificação, endereço primário e cônjuge `verified`. Esses campos alimentam o contrato da Têmis, a CAD, o C2X e o Board. Indeferir não desfazia. E o link não prova que quem digita é dono do CPF.

## O desenho

### O envio grava só o pedido

`POST /api/publico/autonomo/cadastro` → `registrarPedidoDoLink` (`lib/apolo/autonomo-do-link.ts`).

O pedido é um evento `corretor_autonomo_solicitado` em `apolo_audit_events`, **sem ficha** (`entity_id` nulo). O `metadata` leva:
- o resumo do CPF (`cpfHash`, o mesmo hash de `document_hash`) e o CPF mascarado;
- a proposta, por lista de inclusão:
  - `identidade`: nome, CPF, nascimento, naturalidade, filiação, órgão emissor;
  - `perfil`: e-mail, celular, sexo, estado civil, escolaridade, renda, profissão;
  - `endereco`.

  Cada campo tem teto de 200 caracteres. Não entram cônjuge, empreendimentos, empresa, vínculo, imobiliária nem o texto livre "lido do documento".
- os documentos no **staging privado** do bucket (`entidade/_pendente/a-<resumo do CPF>/`), só identidade e comprovante;
- os empreendimentos de interesse, conferidos contra a vitrine do servidor.

Nenhuma tabela de ficha é lida ou escrita no envio. O teste `NÃO ENCOSTA EM FICHA` cobre as sete tabelas.

Sem migration: `apolo_audit_events.entity_id` aceita nulo e `action` é texto sem CHECK (medido em 01/10/2026). A tabela tem RLS, e só a leitura de `authenticated` (usuário do hub) passa, o mesmo nível das fichas. O anônimo não lê.

### A aprovação grava pela porta do cadastro interno

`POST /api/apolo/corretores-autonomos/pedidos/[id]/decisao` com `acao: "aprovar"` → `aprovarPedido`. Nesta ordem:

1. **Confere no momento da decisão.** Recusa se:
   - alguma ficha do CPF já tem código CA (uma pessoa, um código);
   - alguma ficha do CPF é PJ ou tem o papel imobiliária (*"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria"*);
   - o pedido não é o mais recente do CPF.
2. **`createApoloEntity`** com `role: corretor`, `persona: pf`, `dedupPorDocumento` e `fichaExistente: "acrescentar"`:
   - CPF novo nasce inteiro, como no cadastro interno;
   - CPF com ficha só é acrescentado, sem trocar nada; telefone e e-mail não entram (são chave da Iris e assinatura do D4Sign) e ficam como pendência na ficha.
3. **Papel `corretor` ativo** (upsert): é a decisão de quem aprovou.
4. **Código CA** da sequência do banco, gravado com `broker_code is null` no UPDATE, então dois cliques não dão dois códigos.
5. **Documentos** do staging vão para o drive da ficha (`agruparEUploadDocumentos`).
6. **Evento `corretor_autonomo_aprovado`**, com a ficha e o código.

Nenhuma habilitação nasce da aprovação.

### Pedir correção e indeferir não encostam em ficha

Os dois só gravam o evento (`pedidoId` no `metadata`) e avisam a pessoa. A correção diz para abrir o link de novo. O reenvio é um **pedido novo, com a proposta inteira**, e substitui o anterior na fila. Antes, o reenvio caía em "acrescentar" e não atualizava nada.

### Avisos

- **Ao corretor:** vão para o celular **digitado** no pedido, porque é quem pediu.
  - Na aprovação, saem por `enviarPeloRelacionamento` e ficam registrados em `apolo_disparos`.
  - Na correção e no indeferimento, a pessoa ainda não tem ficha e `apolo_disparos.entity_id` é NOT NULL. Por isso saem direto pelo gateway, e o resultado aparece na tela.
  - O código CA nunca vai na mensagem.
- **Ao time:** o sino toca para administradores e líderes. Com mais de 5 pedidos em 15 minutos, ele para de tocar a cada um.

## Segurança

- **Proxy:** só `/api/publico/autonomo` é público. A fila, a decisão, os documentos do pedido e a habilitação ficam em `/api/apolo/corretores-autonomos/*`, com Bearer.
- **Só a coordenação** (`authorizeApoloCoordenacao`: admin e líder) lê a fila, vê os documentos, decide e habilita. Antes, `authorizeApoloWrite` deixava o operador, inclusive o externo, decidir.
- **Pré-sessão própria** amarrada ao CPF (`preAutonomo`), que não vale nos outros links. **Anti-troca:** o CPF do documento tem de ser o do token.
- **Consulta paga fechada:** com o token do autônomo, `/api/publico/cad/ocr` só lê a foto (`extract`). `enrich` e `enrich-company` dão 403, mesmo para o CPF do próprio token, porque o portão emite token para qualquer CPF. O wizard do link nem pergunta (`semEnriquecimento`).
- **A resposta do envio não revela nada.** O sucesso é sempre `{ recebido: true }`, sem id, código ou PDF. CPF que virou autônomo ou entrou em análise depois do portão recebe a **mesma** resposta, sem gravar. Como nada é gravado em ficha, não existe recusa de "e-mail em outro cadastro".
- **Tetos:**
  - por IP: portão (balde `autonomo`, 24 por 10 min, com atraso progressivo), envio (`enviar`) e leitura (`ocr`);
  - teto **geral** de 40 pedidos por hora.
- **Celular obrigatório,** conferido por dígitos (`/\D/g`).

## O que não mudou (com teste)

- **CAD do cliente:** consulta CPF com `query`/`datasets` como antes. Dono do upload `s-<sessão>`. Não entra no modo do autônomo.
- **Imobiliária:** consulta CNPJ e CPF dos sócios como antes. Dono do upload `c-<CNPJ>`. Não entra no modo do autônomo.
- **Portal do incorporador e cadastro interno:** não entram no modo do autônomo (`ehAutonomoPublico`).
- **Certidão e cônjuge** continuam obrigatórios fora do link.
- **O papel `corretor` da ficha não muda antes da aprovação**, então a resposta da CAD pública para aquele CPF continua a mesma.

## Decisões do Lucas (01/10/2026)

| Pergunta | Decisão |
|---|---|
| Onde validar | Tela nova no Apolo (Autônomos), com aprovar, pedir correção e indeferir, e a aba Habilitação |
| Empreendimentos | O autônomo indica interesse; quem habilita é o time |
| Documentos | Identidade e comprovante de endereço, sem certidão |
| Aviso | Sino do hub |
| Captcha | Ir ao ar sem captcha, com teto geral por hora; captcha numa segunda entrega |

## Arquivos

- **Público:**
  - `app/publico/autonomo/page.tsx`
  - `modules/publico/autonomo/AutonomoPublicoPortal.tsx`
  - `app/api/publico/autonomo/{iniciar,cadastro}/route.ts`
- **Compartilhado:**
  - `lib/publico/cad/sessao.ts`
  - `lib/publico/cad/rate-limit.ts`
  - `app/api/publico/cad/{ocr,upload-url}/route.ts`
  - `proxy.ts`
- **Domínio:**
  - `lib/apolo/autonomo-do-link.ts`
  - `lib/apolo/credenciamento-mensagens.ts`
  - `lib/apolo/cadastro-obrigatorios.ts` (`semEstadoCivil`)
  - `lib/apolo/cadastro-tipos.ts` (`ehAutonomoPublico`)
- **Interno:**
  - `app/api/apolo/corretores-autonomos/fila/route.ts`
  - `app/api/apolo/corretores-autonomos/pedidos/[id]/{decisao,documentos}/route.ts`
  - `app/api/apolo/corretores-autonomos/[id]/habilitar/route.ts` (agora só a coordenação)
  - `modules/apolo/blocks/autonomos/autonomos-view.tsx`
  - `lib/apolo/catalog.ts`
  - `modules/apolo/ApoloPage.tsx`
- **Assistente:** `modules/apolo/blocks/cadastro/cadastro-flow.tsx`
- **Testes:**
  - `lib/apolo/autonomo-do-link.test.ts`
  - `app/api/publico/autonomo/rotas.test.ts`
  - `app/api/publico/cad/{ocr,upload-url}/tokens.test.ts`
  - `lib/apolo/cadastro-autonomo-publico.test.ts`
  - `lib/publico/cad/sessao.autonomo.test.ts`
  - `lib/publico/cad/proxy-autonomo.test.ts`

## Pendências

- **Captcha (Turnstile):** decidido para depois de ir ao ar.
- **Link fora da aba Links do empreendimento,** porque a aba aparece no portal da Gurgel. O time copia o link na tela Autônomos.
- **Corretor de imobiliária que também vira autônomo** fica com as duas coisas: falta a decisão do Lucas.
- **Documentos de pedido indeferido** ficam no staging. Não há limpeza automática.
- **Cópia do token da imobiliária:** a correção do enrich do token da imobiliária está sendo feita em separado. Aqui o token do autônomo não consulta nada.
