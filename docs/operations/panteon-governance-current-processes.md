# Panteon - processos vigentes de governanca

Assunto: [Governanca] processos vigentes do Panteon

Status: `ATIVO / FONTE CURTA VIGENTE`

Este arquivo e o mapa compacto da governanca atual do Panteon/careli-hub.
Ele nao substitui o diario, os registros de release ou as politicas detalhadas; ele organiza a ordem de leitura e resolve conflitos entre padroes criados ao longo do projeto.

## Por que este arquivo existe

Ao longo do projeto foram criados muitos prompts, contratos, politicas e handoffs. Eles preservam contexto, mas podem confundir agentes novos quando um arquivo antigo fala de uma regra que foi depois refinada.

A regra agora e simples:

- este arquivo mostra o processo vigente;
- documentos detalhados continuam valendo dentro do seu dominio;
- registros antigos continuam como historico e evidencia, nao como regra superior quando conflitarem com a governanca atual.

## Hierarquia de autoridade

Quando houver conflito entre documentos, use esta ordem:

1. Autorizacao explicita do Lucas na conversa atual, respeitando os bloqueios de seguranca.
2. `AGENTS.md` — contrato atualizado em 2026-06-19 com o papel oficial do Hefesto como camada estrategica Claude acima do Zeus Codex.
3. Este arquivo: `docs/operations/panteon-governance-current-processes.md`.
4. `docs/operations/README.md`.
5. Politicas especificas em `docs/architecture/*`.
6. Safety Gates e manifestos vigentes.
7. `docs/operations/panteon-recorte-protocols.md`.
8. Registros objetivos de ambiente:
   - `docs/operations/releases-homologation.md`;
   - `docs/operations/releases-production.md`.
9. Diario canonico `docs/operations/engineering-operations.md`.
10. Prompts, handoffs e documentos antigos, apenas como contexto do recorte.

Importante:

- diario antigo nao autoriza deploy novo;
- prompt antigo nao derruba Safety Gate atual;
- handoff antigo nao substitui commit limpo;
- autorizacao do Lucas deve ser especifica para ambiente, dominio e risco.

## Leitura obrigatoria minima

Todo agente deve iniciar lendo:

- `AGENTS.md`;
- este arquivo;
- `docs/operations/README.md`;
- trecho recente relevante de `docs/operations/engineering-operations.md`;
- `docs/operations/panteon-recorte-protocols.md` quando o trabalho virar recorte;
- politica especifica quando tocar UI, API, env, secret, banco, Vercel, Supabase, homologacao, producao, rollback ou incidente.

Para frontend ou identidade visual:

- `docs/architecture/design-guidelines.md`.

Para API, webhook, token, bearer, banco ou conector:

- `docs/architecture/api-connection-governance.md`.

Para env, secret, Vercel, Supabase, banco, dominio, alias, migration, producao ou rollback:

- `docs/architecture/security-governance.md`;
- `docs/architecture/environment-governance.md`;
- `docs/operations/panteon-vercel-supabase-environment-matrix.md`;
- `docs/architecture/production-safety-policy.md`;
- `docs/architecture/release-and-rollback-policy.md`;
- `docs/architecture/secret-management-policy.md`;
- `docs/architecture/incident-response-policy.md` quando houver incidente.

## Processo vigente por tipo de trabalho

### 1. Tirar duvidas

- Responder no chat.
- Nao criar arquivo.
- Nao implementar.
- Nao rodar acao sensivel.
- Se a pergunta depender do estado atual do repo, fazer leitura read-only.

### 2. Implementacao local de modulo

1. Classificar modulo dono.
2. Confirmar escopo exato e arquivos provaveis.
3. Fazer diagnostico read-only primeiro.
4. Usar worktree/branch do modulo quando disponivel.
5. Alterar somente arquivos do recorte.
6. Validar proporcionalmente ao risco.
7. Registrar decisao ou comportamento relevante no diario.
8. Criar ou atualizar `protocolId` se o recorte puder virar Preview, Homo ou Producao.

Status esperado:

- `VALIDADO_LOCAL`;
- `AGUARDANDO_TESTE_LUCAS`;
- `PRONTO_PARA_HOMO`;
- `BLOQUEADO` se houver mistura, env, banco, deploy ou pendencia externa.

### 3. Frontend, layout e identidade

- Ler `docs/architecture/design-guidelines.md`.
- Preservar Home/Panteon como referencia visual.
- Preservar sidebar/topbar canonicos.
- Nao criar identidade local sem justificativa operacional registrada.
- Validar visualmente quando possivel.

### 4. Homologacao

Homologacao so segue quando houver:

- `protocolId`;
- CEP operacional declarado e validado;
- pacote limpo do modulo;
- inclusoes e exclusoes declaradas;
- validacoes registradas;
- rollback;
- autorizacao do Lucas quando envolver Preview, alias ou operacao sensivel;
- Homologation Safety Gate quando houver Preview candidato a `homo.c2x.app.br` ou alias.

Regra:

- agentes de modulo podem gerar Preview do proprio recorte quando Lucas autorizar;
- `homo.c2x.app.br` e coordenado por Zeus;
- `localhost` nunca e homologacao.

### 5. Producao

Producao so segue quando todos estes itens forem verdadeiros:

- Lucas autorizou explicitamente o protocolo e o dominio alvo;
- CEP operacional declarado e validado;
- existe commit limpo do recorte;
- `sourceWorktreeClean: true`;
- pacote candidato foi montado sobre a base ativa correta;
- `Production Module Safety Gate` retornou `PASS`;
- validacoes passaram;
- rollback foi definido;
- dominio alvo esta correto;
- dominio fora do escopo foi preservado.

Dominios:

- modulos nao-Zeus: `https://c2x.app.br`;
- Zeus/Operations Center: `https://ops.c2x.app.br`.

Se qualquer item faltar, status correto:

- `BLOQUEADO`.

### 6. Incidente, env, secret, banco, Vercel ou Supabase

Sempre iniciar como `BLOQUEADO` ate autorizacao explicita do Lucas para acao mutavel.

Permitido sem autorizacao sensivel:

- diagnostico read-only;
- listar nomes de envs sem valores;
- inspecionar status;
- healthcheck seguro;
- registrar evidencia sanitizada.

Proibido sem autorizacao:

- criar, alterar, remover, copiar ou rotacionar env/secret;
- mover alias ou dominio;
- deploy/redeploy/promote/rollback de producao;
- migration real;
- escrita em banco real;
- expor token, senha, bearer, service role, POSTGRES_URL ou valor sensivel.

## Unidade oficial de recorte

Todo recorte candidato a Preview, Homo ou Producao deve ter:

- `protocolId`;
- CEP operacional do recorte;
- manifesto CEP validado por `scripts/panteon-address-recorte-check.mjs`;
- modulo dono;
- objetivo;
- worktree/branch;
- commit quando for producao;
- arquivos incluidos;
- arquivos excluidos;
- validacoes;
- riscos e pendencias;
- rollback;
- decisao de Lucas;
- status.

Formato recomendado:

```text
<MODULO>-<YYYYMMDD>-<NNN>-<TEMA>
```

## Entrega minima por agente de modulo

Todo agente de modulo deve entregar:

```text
Assunto: [Modulo] handoff do recorte

- Modulo:
- ProtocolId:
- CEP operacional:
- Manifesto CEP:
- Check CEP:
- Branch/worktree:
- Commit:
- Escopo:
- Arquivos incluidos:
- Arquivos excluidos:
- Validacoes:
- Riscos:
- Pendencias:
- Rollback:
- Dominio alvo, se houver:
- Status:
```

## Pedido ideal do Lucas

Implementacao sem deploy:

```text
<Modulo>, implemente <escopo>. Validar localmente, registrar protocolo se virar recorte e nao subir producao.
```

Homologacao:

```text
Zeus, publicar Preview/Homo do protocolo <PROTOCOL_ID>. Somente <modulo>. Se houver mudanca fora do recorte, bloquear.
```

Producao:

```text
Hefesto/Zeus, subir o protocolo <PROTOCOL_ID> para producao em <dominio>. Somente <modulo>. Exigir commit limpo, base ativa correta e Safety Gate PASS. Se qualquer outro modulo mudar, bloquear.
```

## Arquivos antigos e conflito

Estes documentos continuam uteis, mas nao devem superar este arquivo quando estiverem defasados:

- prompts de continuidade antigos;
- handoffs de recortes especificos;
- snapshots de producao antigos;
- `docs/operations/panteon-agent-governance-v2.md`;
- registros antigos do diario;
- scripts/prompt gerados para uma data especifica.

Como usar:

- leia para contexto;
- confirme se a regra ainda esta vigente;
- se houver conflito, siga este arquivo e as politicas detalhadas atuais.

## Arquivos que continuam sendo fonte detalhada

- `AGENTS.md`: contrato inicial do repo.
- `docs/operations/README.md`: mapa operacional da pasta.
- `docs/operations/panteon-recorte-protocols.md`: unidade de recorte.
- `docs/operations/panteon-worktree-operating-model.md`: uso de worktrees.
- `docs/operations/homologation-safety-gate.md`: homologacao.
- `docs/operations/production-module-safety-gate.md`: producao modular.
- `docs/operations/panteon-vercel-supabase-environment-matrix.md`: matriz vigente de dominios, targets Vercel, env scopes e destinos Supabase.
- `docs/operations/panteon-agent-safe-modular-workflow-prompt-2026-06-09.md`: prompt pronto para enviar a agentes.
- `docs/architecture/*`: politicas especificas.

## Conclusao

- Este arquivo e o ponto de partida para entender a governanca vigente.
- O impacto pratico e reduzir confusao entre padroes antigos e regras atuais.
- Quando um agente estiver em duvida, deve seguir este arquivo, bloquear o que for sensivel e perguntar ao Lucas apenas quando a decisao humana for realmente necessaria.
