# Panteon - contexto obrigatorio para agentes

Antes de implementar qualquer mudanca neste repositorio, leia:

- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`

O caminho legado `docs/codex/engineering-operations.md` existe apenas como ponte de compatibilidade e deve apontar para a central operacional atual. A fonte viva do diario, das decisoes de produto, regras de negocio e combinados com o Lucas e `docs/operations/engineering-operations.md`.

Regras de trabalho:

- Responda em portugues do Brasil.
- Comece respostas operacionais com `Assunto:` e um titulo curto, objetivo e pesquisavel contendo o modulo ou squad relacionado, como `[Iris]`, `[Hades]`, `[Hermes]`, `[Zeus]` ou `[Hefesto]`.
- Chame o usuario de Lucas quando fizer sentido.
- Nao altere Hades, Hermes, Iris, Setup, Atlas, Chronos ou outro modulo fora do escopo pedido.
- Revise as decisoes ja registradas antes de propor mudancas de arquitetura.
- Preserve as regras de negocio do C2X, Hades e Iris.
- Nao exponha chaves, tokens ou senhas em codigo, logs, commits ou mensagens.
- Bloqueie qualquer deploy, redeploy, promocao ou operacao Vercel/Supabase que envolva criacao, alteracao, remocao, renomeacao ou exposicao de chaves, secrets, tokens, variaveis de ambiente ou aliases de env. So execute esse tipo de acao com autorizacao explicita do Lucas; pode auditar nomes/impacto, mas nunca publique, altere envs ou registre valores sensiveis sem aprovacao.
- Qualquer operacao envolvendo Vercel, Supabase, banco, dominio, alias, production deployment, migration, service role, `POSTGRES_URL`, chave externa ou variavel sensivel deve iniciar como `BLOQUEADO` ate autorizacao expressa do Lucas.
- Antes de operar envs, secrets, APIs externas, conectores, homologacao, producao, rollback, safe mode, incidente de infraestrutura ou governanca de agentes, siga tambem as politicas em `docs/architecture/agent-operating-model.md`, `docs/architecture/security-governance.md`, `docs/architecture/environment-governance.md`, `docs/architecture/api-connection-governance.md`, `docs/architecture/production-safety-policy.md`, `docs/architecture/incident-response-policy.md`, `docs/architecture/release-and-rollback-policy.md` e `docs/architecture/secret-management-policy.md`.
- Producao e ambiente critico: nao executar alteracao destrutiva, migration real, troca de chave, troca de banco, dominio, alias ou deploy sensivel direto em producao sem validacao previa em homologacao e aprovacao explicita do Lucas.
- Use dados reais quando o Lucas pedir comportamento funcional; evite mock quando ja houver fonte real.
- Em Windows/PowerShell, prefira `npm.cmd` e `npx.cmd`.
- A tela principal/Home do Panteon e a referencia visual oficial para composicao dos modulos: densidade operacional, hierarquia, ritmo de cards/surfaces, cabecalhos e linguagem executiva devem seguir esse padrao antes de criar uma identidade local.
- Todos os sidebars do Panteon, globais ou internos de modulo, devem seguir o mesmo layout, cor e comportamento do sidebar principal do Panteon. A base visual canonica e grafite `#101820`, com accent `#A07C3B`, header compacto sem subtitulo operacional redundante, icone ativo com fundo preto, estados active/hover/focus consistentes e modo recolhido/expandido coerente. O topo do sidebar deve manter a ordem icone preto do modulo, nome do modulo, botao para abrir o sidebar/launcher do Panteon e botao de recolher/expandir, com divisor separando o header da navegacao. Variacoes so podem existir por necessidade operacional explicita e registrada.
- O perfil do usuario logado pertence ao topbar/header da tela, no canto superior direito, com avatar, nome, status e acao de saida alinhados ao Panteon principal. Nao usar o topo do sidebar para identidade do usuario; sidebar e navegacao/contexto do modulo.
- Valide mudancas relevantes com `check-types`, `lint`, `build` e validacao funcional/visual local quando aplicavel.
- Trate `docs/operations/engineering-operations.md` como central operacional viva: ao fechar decisao, processo, comportamento, regra, deploy relevante ou commit, atualize o documento no mesmo pacote de trabalho.
- Quando Lucas solicitar scripts, prompts ou encaminhamentos para agentes/squads, crie ou atualize um arquivo em `docs/operations/` e responda no chat apenas com caminho, resumo, validacao e status. Evite despejar scripts longos diretamente na conversa, salvo se Lucas pedir explicitamente.
- Para implementacoes, siga o fluxo oficial registrado no diario: o agente do modulo implementa, valida, atualiza o diario e, quando Lucas autorizar, publica o proprio recorte em homologacao; nao existe mais etapa separada de `Hub QA`. Ao concluir homologacao, o agente deve sinalizar no Zeus/Operations Center o modulo, pacote, atividades, commit/deploy de homologacao, validacoes, riscos e status `PRONTO PARA PRODUCAO` ou bloqueio equivalente. Nao misture mudancas de outras squads.
- Quando Lucas pedir deploy em homologacao, o agente do modulo deve gerir apenas o recorte do proprio modulo e registrar o handoff para producao. Quando Lucas pedir producao, `Hefesto` deve comparar diario canonico e Git, separar recortes por modulo, publicar somente o que estiver homologado/validado, bloquear o que depender de correcao, env/chave, migration ou outra squad, e registrar tanto o que subiu quanto o que ficou pendente. `Hefesto` fica responsavel pela promocao para producao, healthchecks finais, rollback e rastreabilidade oficial de producao.
- Quando um agente estiver atuando como `Zeus` e tiver autorizacao explicita do Lucas para executar/publicar seu proprio recorte, ele deve fechar o ciclo tambem na fonte viva do Operations Center: criar ou atualizar registros em `hub_engineering_operation_records`, reconciliar protocolos `AT/CB/TI/OP/AL/DP` afetados para o status real (`EM PRODUCAO`, `CORRIGIDO`, `BLOQUEADO` etc.), preencher commit/deploy/validacoes, atualizar releases estruturadas quando aplicavel e so entao registrar no diario. Nunca considerar uma entrega Zeus concluida apenas por mensagem no chat ou por registro Markdown.
- Ao final de devolutivas tecnicas ou operacionais, inclua uma secao `Conclusao` com explicacao didatica: o que aconteceu, impacto pratico, se precisa de acao agora, quem deve agir e qual o proximo passo.

Ao finalizar uma decisao importante, atualize `docs/operations/engineering-operations.md` com um resumo curto e objetivo.
