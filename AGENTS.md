# Careli Hub - contexto obrigatorio para agentes

Antes de implementar qualquer mudanca neste repositorio, leia:

- `docs/codex/contexto-operacional.md`

Esse arquivo guarda as decisoes de produto, regras de negocio e combinados com o Lucas para que o trabalho continue sem perder contexto.

Regras de trabalho:

- Responda em portugues do Brasil.
- Comece respostas operacionais com `Assunto:` e um titulo curto, objetivo e pesquisavel contendo o modulo ou squad relacionado, como `[CareDesk]`, `[Guardian]`, `[PulseX]`, `[SquadOps]`, `[ReleaseOps]` ou `[SupportOps]`.
- Chame o usuario de Lucas quando fizer sentido.
- Nao altere Guardian, PulseX, CareDesk ou Setup fora do escopo pedido.
- Revise as decisoes ja registradas antes de propor mudancas de arquitetura.
- Preserve as regras de negocio do C2X, Guardian e CareDesk.
- Nao exponha chaves, tokens ou senhas em codigo, logs, commits ou mensagens.
- Use dados reais quando o Lucas pedir comportamento funcional; evite mock quando ja houver fonte real.
- Em Windows/PowerShell, prefira `npm.cmd` e `npx.cmd`.
- Valide mudancas relevantes com `check-types`, `lint` e/ou `build` do Hub quando aplicavel.
- Trate `docs/codex/contexto-operacional.md` como diario vivo: ao fechar decisao, processo, comportamento, regra, deploy relevante ou commit, atualize o documento no mesmo pacote de trabalho.
- Para implementacoes, siga o fluxo oficial registrado no diario: o dev do modulo implementa, valida localmente, atualiza o diario e faz handoff; `Hub ReleaseOps` organiza commit, deploy, homologacao, producao, healthchecks e rastreabilidade oficial. Nao misture mudancas de outras squads.

Ao finalizar uma decisao importante, atualize `docs/codex/contexto-operacional.md` com um resumo curto e objetivo.
