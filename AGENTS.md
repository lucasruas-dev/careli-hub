# Careli Hub - contexto obrigatorio para agentes

Antes de implementar qualquer mudanca neste repositorio, leia:

- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`

O caminho legado `docs/codex/engineering-operations.md` existe apenas como ponte de compatibilidade e deve apontar para a central operacional atual. A fonte viva do diario, das decisoes de produto, regras de negocio e combinados com o Lucas e `docs/operations/engineering-operations.md`.

Regras de trabalho:

- Responda em portugues do Brasil.
- Comece respostas operacionais com `Assunto:` e um titulo curto, objetivo e pesquisavel contendo o modulo ou squad relacionado, como `[CareDesk]`, `[Guardian]`, `[PulseX]`, `[SquadOps]`, `[ReleaseOps]` ou `[SupportOps]`.
- Chame o usuario de Lucas quando fizer sentido.
- Nao altere Guardian, PulseX, CareDesk ou Setup fora do escopo pedido.
- Revise as decisoes ja registradas antes de propor mudancas de arquitetura.
- Preserve as regras de negocio do C2X, Guardian e CareDesk.
- Nao exponha chaves, tokens ou senhas em codigo, logs, commits ou mensagens.
- Bloqueie qualquer deploy, redeploy, promocao ou operacao Vercel/Supabase que envolva criacao, alteracao, remocao, renomeacao ou exposicao de chaves, secrets, tokens, variaveis de ambiente ou aliases de env. So execute esse tipo de acao com autorizacao explicita do Lucas; pode auditar nomes/impacto, mas nunca publique, altere envs ou registre valores sensiveis sem aprovacao.
- Qualquer operacao envolvendo Vercel, Supabase, banco, dominio, alias, production deployment, migration, service role, `POSTGRES_URL`, chave externa ou variavel sensivel deve iniciar como `BLOQUEADO` ate autorizacao expressa do Lucas.
- Antes de operar envs, secrets, homologacao, producao, rollback, safe mode, incidente de infraestrutura ou governanca de agentes, siga tambem as politicas em `docs/architecture/agent-operating-model.md`, `docs/architecture/security-governance.md`, `docs/architecture/environment-governance.md`, `docs/architecture/production-safety-policy.md`, `docs/architecture/incident-response-policy.md`, `docs/architecture/release-and-rollback-policy.md` e `docs/architecture/secret-management-policy.md`.
- Producao e ambiente critico: nao executar alteracao destrutiva, migration real, troca de chave, troca de banco, dominio, alias ou deploy sensivel direto em producao sem validacao previa em homologacao e aprovacao explicita do Lucas.
- Use dados reais quando o Lucas pedir comportamento funcional; evite mock quando ja houver fonte real.
- Em Windows/PowerShell, prefira `npm.cmd` e `npx.cmd`.
- Valide mudancas relevantes com `check-types`, `lint`, `build` e validacao funcional/visual local quando aplicavel.
- Trate `docs/operations/engineering-operations.md` como central operacional viva: ao fechar decisao, processo, comportamento, regra, deploy relevante ou commit, atualize o documento no mesmo pacote de trabalho.
- Quando Lucas solicitar scripts, prompts ou encaminhamentos para agentes/squads, crie ou atualize um arquivo em `docs/operations/` e responda no chat apenas com caminho, resumo, validacao e status. Evite despejar scripts longos diretamente na conversa, salvo se Lucas pedir explicitamente.
- Para implementacoes, siga o fluxo oficial registrado no diario: o dev do modulo implementa, valida localmente, atualiza o diario e faz handoff direto para `Hub ReleaseOps`; nao existe mais etapa separada de `Hub QA`. `Hub ReleaseOps` organiza commit, deploy, homologacao, producao, healthchecks e rastreabilidade oficial. Nao misture mudancas de outras squads.
- Quando Lucas pedir deploy, `Hub ReleaseOps` deve gerir o processo: comparar diario canonico e Git, separar recortes, publicar somente o que estiver seguro/validado, bloquear o que depender de correcao, env/chave, migration ou outra squad, e registrar tanto o que subiu quanto o que ficou pendente.
- Ao final de devolutivas tecnicas ou operacionais, inclua uma secao `Conclusao` com explicacao didatica: o que aconteceu, impacto pratico, se precisa de acao agora, quem deve agir e qual o proximo passo.

Ao finalizar uma decisao importante, atualize `docs/operations/engineering-operations.md` com um resumo curto e objetivo.
