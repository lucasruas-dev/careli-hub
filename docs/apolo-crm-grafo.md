# Apolo — CRM de grafo (spec canônico)

> Bússola da reestruturação do Apolo como CRM central da Careli. Desenho fechado
> com o Lucas em 2026-07-09. Este doc guia UI, Front e Back; o estado vivo fica na
> memória e no diário de operações.

## Objetivo

O Apolo é o CRM central: recebe **todos os cadastros** e guarda **tudo** sobre cada
player (cadastro, carteira, financeiro, contratos, notas, interações). Toda
interação (Iris, Hades, Chronos), negociação e alteração vira evento na timeline.

## Princípio-mãe: uma entidade, vários papéis, muitas arestas

**Uma entidade = uma pessoa/empresa real, cadastrada UMA vez**, independente de
quantos chapéus use. O corretor que também é comprador é UMA entidade com dois
papéis, não dois cadastros. Isso mata duplicidade e sustenta o resto.

### Camadas do modelo (Back)

1. **Entidade** (`apolo_entities`): PF ou PJ, deduplicada por CPF/CNPJ.
2. **Papéis** (`apolo_entity_profiles`): prospect, comprador, corretor, imobiliária,
   incorporador, fornecedor, parceiro, colaborador (interno/externo), usuário.
   São **acumuláveis** (prospect vira comprador ganhando o papel, sem perder o
   histórico).
3. **Relacionamentos** (`apolo_relationships`): **arestas tipadas** entre entidades.
   Cada aresta = `de` -> `para` + `tipo` + `subtipo` + `origem` (auto/manual) +
   `desde` + `ativo`.
   - **Tipo `trabalho`**: corretor->imobiliária (`vinculado`), usuário->player
     (`trabalha_em`), corretor->prospect (`cadastrou`), imobiliária->empreendimento
     (`atua_em`).
   - **Tipo `contato`**: comprador->pessoa (`responsavel_financeiro`, `familiar`,
     `indicado_por`).
4. **Empreendimento**: nó de primeira classe (origem C2X). A cadeia de trabalho
   encadeia: prospect -> corretor -> imobiliária -> empreendimento.
5. **Contato leve**: entidade mínima (nome, telefone, e-mail, sem papel de negócio)
   ligada por aresta `contato`. Ex.: o irmão que pede os boletos do comprador. Não
   força ficha completa; continua sendo "entidade + aresta".
6. **Financeiro** (fornecedor/parceiro/colaborador PJ): a entidade cruza com o
   módulo financeiro pelo CNPJ -> notas emitidas, faturas, contratos na ficha.
7. **Timeline**: evento unificado por entidade, alimentado por Iris, Hades, Chronos,
   cadastro e financeiro. É a espinha da "vida do cliente".

### O grafo é a fronteira de permissão

Quando corretor/imobiliária/incorporador logarem (login externo, futuro), cada um
vê **só a sua subárvore** do grafo: corretor vê seus prospects/vendas; imobiliária
vê a dela quebrada por corretor; incorporador vê o empreendimento dele (com o
cenário comercial de vendas + inadimplência incluído). Isso já existe embrionário
no C2X (`vinculed_by_id`). **Modelar as arestas pensando nisso agora** evita
retrabalho gigante depois.

### Auto vs manual

- **Player cadastra** (self-service) -> relacionamento **automático**, inferido da
  sessão de quem cadastra + contexto (empreendimento). Ex.: corretor sobe um CAD ->
  cria `cadastrou` + herda imobiliária + empreendimento.
- **Colaborador cadastra** -> ele **monta** os vínculos na etapa "Vínculo" (a
  semente disso já está no CAD atual: seletor imobiliária/corretor).

## UI / Front: ficha 360 adaptativa

Uma ficha só, com abas que **acendem conforme os papéis**. Nada de N telas.

| Aba | Quando | Conteúdo |
|---|---|---|
| Resumo | sempre | quem é, chips dos papéis, ações rápidas |
| Cadastro | sempre | ficha PF/PJ + CAD |
| Relacionamentos | sempre | rede (grafo) + lista; lentes Trabalho / Contato |
| Timeline | sempre | Iris, Hades, Chronos, cadastro, financeiro |
| Carteira | papel Comprador | parcelas, inadimplência (C2X/Hades) |
| Produção | papel Corretor | CADs cadastrados, vendas |
| Equipe + Funil | papel Imobiliária | corretores, prospects/compradores por corretor |
| Empreendimentos | papel Incorporador | imobiliárias, corretores, compradores + vendas/inadimplência |
| Financeiro | Fornecedor / Parceiro / Colab PJ | notas, faturas, contratos |

### Aba Relacionamentos (o que o Lucas curtiu no Econodata)

Duas superfícies do mesmo grafo:
- **Rede visual** (estratégica): grafo radial centrado na entidade, arestas tipadas
  (Trabalho = linha cheia, Contato = tracejada). Para **não poluir**: mostra só o
  1º nível e **agrupa volume** ("+12 corretores", "+3 sócios"), expandindo no
  clique. Filtro por tipo e por papel. Clicar num nó navega pra ficha dele.
- **Lista estruturada** (operacional): a mesma informação em tabela, rápida de agir.

## Faseamento

- **F1** (base, quase pronto): entidade + papéis + cadastro PF/PJ. Falta acender os
  **chips de papel** e o **esqueleto das abas** na ficha.
- **F2**: modelo de relacionamento + vínculo no cadastro (auto/manual) + **lista**
  de relacionamentos.
- **F3**: **rede visual** (Econodata-style).
- **F4**: abas por papel ligadas a C2X/Hades/financeiro (carteira, produção,
  financeiro).
- **F5**: timeline unificada.
- **F6**: login externo + permissão pela subárvore do grafo.

## Decisões fechadas

1. Entidade única com papéis acumuláveis (não registro por papel).
2. Relacionamento = aresta tipada (`trabalho` / `contato`); o grafo é a fronteira
   de permissão.
3. Um workspace adaptativo (abas por papel), não N telas.
4. Contato leve = entidade mínima + aresta.
5. Timeline como espinha.
6. Auto quando o player cadastra, manual quando é colaborador.

## Decisões de 2026-07-13 (Lucas) — a cadeia de trabalho

### Trabalho x Contato (regra de criação)

- **`trabalho`**: aresta **só entre ENTIDADES**. Os dois lados precisam existir como
  entidade no Apolo. Ao criar, o usuário **seleciona uma entidade existente**.
- **`contato`**: **não exige** entidade prévia. Abre um **formulário** com **Nome,
  Telefone, E-mail e CPF (opcional)** — isso cria a **entidade leve** (sem papel de
  negócio) e a aresta `contato`. É o "irmão que pede o boleto".

### A cadeia (obrigatória)

```
Prospect ──► Corretor ──► Imobiliária ──► Empreendimento
```

- **Corretor exige Imobiliária**: não existe corretor solto. Para cadastrar um corretor,
  a imobiliária tem que existir antes.
- **Prospect exige Corretor**: e herda a imobiliária **por transitividade** (não se cria
  aresta direta prospect→imobiliária).
- ⚠️ **O vínculo corretor→imobiliária é POR EMPREENDIMENTO**: o mesmo corretor pode atuar
  pela Imob A no Empreendimento 1 e pela Imob B no Empreendimento 2 — mas **uma só
  imobiliária por empreendimento**. Logo a aresta de trabalho carrega o **escopo do
  empreendimento**, e o empreendimento é **nó de primeira classe**.

### Histórico e backfill

- **Histórico**: ao trocar de imobiliária, a aresta antiga vira **inativa com data de fim**
  e cria-se a nova. Preserva "quem era de quem" na época da venda (comissão/auditoria).
- **Sem backfill**: o grafo começa **vazio** e só os cadastros novos criam aresta. Os
  rótulos legados de `apolo_relationships` (3.595 "Imobiliaria ou responsavel comercial")
  **não** viram aresta.

### ⚠️ Os RÓTULOS do C2X mentem — a verdade é o Lucas

O cadastro de empreendimento do C2X tem campos com nome **errado**. Não modelar pelo rótulo:

| Coluna C2X | C2X chama de | O que É na Careli | Exibe? |
|---|---|---|---|
| `incorporador_id` | Incorporador | Incorporador | ✅ |
| `manager_id` | ~~Gerente~~ | **Coordenador de Vendas** | ✅ |
| `captivator_id` | Captador | Captador | ✅ |
| `coordenador_id` | ~~Coordenadora de vendas~~ | **dado errado** (o MESMO player nos 24 empreendimentos) | ❌ — fica no payload pro Lucas corrigir no C2X quando houver escrita |

Idem para os nomes: PJ guarda o nome em `fantasy_name`/`social_name` (o `name` vem **vazio**), e
o C2X repete o mesmo texto em razão social e nome fantasia. **Regra de exibição:** o nome é o
FANTASIA; razão social só aparece quando de fato difere.

### Identidade: navegar por id, nunca por nome

O id da entidade no Apolo é **determinístico**: `deterministicUuid("apolo:c2x:users:<id>")` —
a mesma semente do sync. Para abrir a ficha certa a partir de qualquer lugar (ex.: um player do
empreendimento), use o **entityId**; buscar por **nome** casa homônimos e abre a pessoa errada
(bug real em 13/jul). A busca textual serve só pra carregar candidatos.

### Regra global de exibição: Primeira Maiúscula

Todo dado exibido no Hub segue "Primeira Maiúscula" (`lib/format/name-case.ts`). As fontes
legadas vêm em CAIXA ALTA; a normalização é **na exibição**, nunca no dado.

### Achado no C2X (2026-07-13)

- `acquisition_requests.corretor_id` **existe mas está 100% NULL** (0 de 4.181 propostas):
  **o corretor não existe no legado**. Ele nasce no Apolo — não há o que migrar.
- O que o C2X **tem**: `enterprises.incorporador_id` (incorporador→empreendimento, mas
  quase vazio: 2 de 24), `users.imobiliaria_id` (player→imobiliária) e
  `acquisition_requests.client_id` (comprador→unidade→empreendimento). Ou seja, a cadeia
  legada é **empreendimento → imobiliária → comprador**; falta o corretor no meio.
