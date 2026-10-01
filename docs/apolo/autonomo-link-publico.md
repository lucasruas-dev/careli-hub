# Link público do corretor autônomo (desenho de 01/10/2026, terceira versão)

> Pedido do Lucas, 01/10/2026: *"fizemos o processo de cadastro de corretor autonomo, mas ele seria para o time interno, preciso criar o link publico igual temos da cad, imobiliaria"*.
> Branch `feat/autonomo-link-publico`. Sem migration.
> A segunda versão está no ar (1.404.0, commit `47e19c01`). Esta terceira versão responde à segunda revisão da Publicação.

## A regra que não pode quebrar

O cadastro feito pelo link cai na **mesma entidade** e na **mesma validação** que o time já usa. Nada de cadastro paralelo.

**Nada do que chega pelo link vira dado antes de uma pessoa da coordenação aprovar.** E, numa ficha que já existe, **nem depois**: a aprovação grava só o papel, o código CA e os documentos. Isso vale para:
- ficha, papel, contato, endereço e documento na ficha;
- código CA e habilitação;
- C2X e Asaas.

## O envio grava só o pedido

`POST /api/publico/autonomo/cadastro` → `registrarPedidoDoLink` (`lib/apolo/autonomo-do-link.ts`).

O pedido é um evento `corretor_autonomo_solicitado` em `apolo_audit_events`, **sem ficha** (`entity_id` nulo). O `metadata` leva:
- o resumo do CPF (`cpfHash`, o mesmo hash de `document_hash` e de `apolo_entity_identifiers.value_hash`) e o CPF mascarado;
- a proposta, por lista de inclusão:
  - `identidade`: nome, CPF, nascimento, naturalidade, filiação, órgão emissor;
  - `perfil`: e-mail, celular, sexo, estado civil, escolaridade, renda, profissão;
  - `endereco`.

  Cada campo tem teto de 200 caracteres. Não entram cônjuge, empreendimentos, empresa, vínculo, imobiliária nem o texto "lido do documento".
- os documentos no **staging privado** do bucket, só identidade e comprovante;
- os empreendimentos de interesse, conferidos contra a vitrine do servidor.

O envio não lê nem escreve nenhuma das tabelas da ficha (o teste `NÃO ENCOSTA EM FICHA` cobre as sete). Sem migration: `entity_id` aceita nulo e `action` é texto sem CHECK. A tabela tem RLS, e só a leitura de usuário do hub passa.

**O reenvio** (depois de "pedir correção") é um pedido novo com a proposta inteira. Ele substitui o anterior na fila e **apaga do staging os documentos do pedido substituído**.

## Os freios, sem captcha

O Lucas decidiu, em 01/10/2026, não ter captcha nos links públicos. São três contadores **atômicos** (o "compara e troca" de `consumir`, `lib/publico/cad/rate-limit.ts`), todos conferidos **antes de qualquer documento ser guardado**:

| Freio | Balde | Teto |
|---|---|---|
| Por IP | `autonomoEnvio` | 10 envios por hora |
| Por CPF | `autonomoCpf` (chave: resumo do CPF, nunca o CPF) | 5 por dia |
| Geral, de emergência | `autonomoGeral` | 300 por hora |

O portão do CPF tem o seu (`autonomo`, 24 por 10 min, com atraso progressivo).

O teto de 40 por hora da segunda versão saiu. Ele era uma contagem de eventos, sem atomicidade, e virava negação de serviço barata: um IP enchia a hora e barrava todo cadastro legítimo.

## A aprovação

`POST /api/apolo/corretores-autonomos/pedidos/[id]/decisao`, `acao: "aprovar"` → `aprovarPedido`.

1. **Lê as fichas do CPF nas duas fontes** (`fichasDoDocumento`: `document_hash` e o identificador do sync do C2X). Recusa se:
   - alguma ficha já tem código CA (uma pessoa, um código);
   - alguma é PJ ou tem o papel imobiliária;
   - o pedido não é o mais recente do CPF.
2. **CPF novo:** a ficha nasce pela porta do cadastro interno (`createApoloEntity`, `role: corretor`, `dedupPorDocumento`), inteira.
3. **CPF que já tem ficha:** `createApoloEntity` **não é chamado**. A ficha usada é a que tem o papel `corretor`, senão a mais antiga (`escolherFicha`, a mesma régua que a tela mostra). Ela recebe só:
   - o papel `corretor` ativo;
   - o código CA;
   - os documentos.

   Qualificação, endereço, contato e cônjuge digitados **não entram**. A versão anterior, no modo que acrescenta, preenchia os campos vazios, e eles chegavam ao contrato da Têmis. O que foi digitado fica no evento da aprovação (`propostaNaoGravada`), no histórico da ficha, como pendência.
4. **Código CA** da sequência do banco, gravado com `broker_code is null` no UPDATE.
5. **Documentos** do staging vão para o drive da ficha. **A falha não é descartada:** volta na resposta (a tela pede para anexar pela ficha) e fica no evento (`documentosComFalha`).

Nenhuma habilitação nasce da aprovação.

## Pedir correção e indeferir

Os dois só gravam o evento e não encostam em ficha.
- **Pedir correção:** avisa o celular digitado, com o link para reenviar.
- **Indeferir:** **não manda WhatsApp.** O número foi digitado num formulário aberto e pode ser de qualquer pessoa, e uma recusa não tem o que pedir de volta. Os documentos do pedido saem do staging. A tela diz que ninguém foi avisado.

## A tela do time (Apolo > Autônomos)

Só a coordenação (admin e líder) lê, decide e habilita. Antes de aprovar, o cartão mostra:
- os dados digitados e os documentos do pedido, por URL assinada de 10 minutos;
- **"Este CPF já tem ficha na Careli"**, com o nome, os papéis e o botão para abrir a ficha. A ficha é achada nas duas fontes, inclusive a do sync do C2X que só tem o identificador. A versão anterior olhava só `document_hash`, e 20 CPFs escapavam;
- **"Se aprovar, fica gravado:"**, a lista que sai de `oQueSeraGravado`, a mesma régua da aprovação.

**A fila não tem teto escondido.** Os pedidos são paginados (páginas de 1.000, até 20 mil) e as decisões são lidas pelo id de cada pedido. Se o teto for atingido, a tela avisa. A versão anterior lia os 1.000 eventos mais recentes, e sob inundação o pedido legítimo sumia.

## Segurança da borda (sem mudança desde a segunda versão)

- **Proxy:** só `/api/publico/autonomo` é público.
- **Pré-sessão** própria amarrada ao CPF, com anti-troca.
- **Consulta paga fechada:** com o token do autônomo, `/api/publico/cad/ocr` só lê a foto.
- **A resposta do envio é sempre a mesma** (`{ recebido: true }`), inclusive para CPF que já é autônomo ou está em análise.
- **Celular obrigatório,** conferido por dígitos.

## Testes

- **Regra principal** (`lib/apolo/autonomo-do-link.test.ts`):
  - o envio não encosta em ficha;
  - o reenvio apaga os documentos antigos;
  - aprovar CPF novo e CPF com ficha (só papel, código e documentos);
  - a falha de documento aparece;
  - indeferir não manda WhatsApp e apaga os documentos;
  - a fila acha a ficha do sync pelo identificador e pagina.
- **Rotas** (`app/api/publico/autonomo/rotas.test.ts`): os três freios na ordem, antes de guardar documento, e a chave do CPF sem o CPF.
- **Telas montadas de verdade** (`modules/publico/autonomo/telas-publicas.test.tsx`):
  - a vitrine da imobiliária e a do autônomo;
  - o wizard nos três links (CAD do cliente, imobiliária, autônomo).
- **Adaptador do wizard** (`modules/apolo/blocks/cadastro/cadastro-flow.adaptador.test.ts`): o que cada link manda para o servidor e como a resposta é lida.
- **Mutação conferida:** três quebras de propósito ficaram vermelhas:
  - o modo do autônomo vazando para os outros links;
  - a consulta paga liberada;
  - a imobiliária seguindo sem empreendimento.
- **Já existentes e mantidos:**
  - `app/api/publico/cad/{ocr,upload-url}/tokens.test.ts`
  - `lib/apolo/cadastro-autonomo-publico.test.ts`
  - `lib/publico/cad/{sessao.autonomo,proxy-autonomo}.test.ts`

## Pendências

- O link fica fora da aba Links do empreendimento, porque essa aba aparece no portal da Gurgel.
- Falta a decisão do Lucas sobre o corretor de imobiliária que também vira autônomo.
- Arquivo que sobe pelo upload direto e cujo envio nunca acontece fica no staging. É o mesmo comportamento da CAD pública.
- A correção do enrich do token da imobiliária está sendo feita em separado. O token do autônomo não consulta nada.
