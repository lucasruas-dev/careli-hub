# Panteon - governanca de migrations

Este documento define como o Panteon deve tratar migrations para evitar gargalo, colisao de versao, renomeacao historica indevida e deploy com banco fora de controle.

## Principios

- Migration aplicada ou ja publicada nao deve ser renomeada, apagada ou reordenada sem decisao explicita registrada.
- Toda migration real continua `BLOQUEADO` ate autorizacao explicita do Lucas.
- Migrations novas devem nascer em recorte proprio, com dono, rollback path, validacao em homologacao e registro em release.
- O runner deve considerar o nome completo do arquivo, nao apenas o prefixo numerico.
- Se algum runner externo considerar apenas o prefixo numerico, a aplicacao deve ser manual/controlada ate existir recorte de normalizacao aprovado.

## Estado atual controlado

Existe uma duplicidade historica conhecida:

| Prefixo | Arquivos | Status | Motivo |
| --- | --- | --- | --- |
| `0003` | `0003_setup_beta_policies.sql`, `0003_setup_operational_access.sql` | `CONTROLADO` | Os dois arquivos fazem parte do historico do Setup e ja estavam reconhecidos no plano de homologacao. Renomear agora poderia quebrar rastreabilidade. |

Essa duplicidade nao deve bloquear auditorias locais quando os dois nomes forem exatamente os acima. Ela deve continuar visivel como item controlado para impedir esquecimento.

## Numeracao futura

- Proxima migration nova deve usar o proximo prefixo livre depois do maior prefixo existente.
- Na leitura atual do repositorio, o maior prefixo e `0029`; portanto o proximo recorte de banco deve iniciar em `0030`, salvo se outro agente ja tiver criado migration validada antes.
- Antes de criar qualquer migration, rodar auditoria e confirmar `git status` do worktree do agente dono.

## Checklist antes de criar migration

1. Confirmar se a mudanca realmente precisa de banco.
2. Confirmar dono: Zeus/DataOps, modulo especifico ou Hefesto.
3. Confirmar ambiente alvo: local, homologacao ou producao.
4. Registrar risco e rollback path.
5. Criar migration em branch/worktree do agente dono.
6. Validar sintaxe e dependencias em ambiente seguro.
7. Aplicar primeiro em homologacao quando houver risco operacional.
8. Registrar resultado em `releases-homologation.md`.
9. Promover producao somente com autorizacao explicita.
10. Registrar producao em `releases-production.md` e no diario canonico.

## Auditoria

O script `scripts/panteon-operational-audit.ps1` classifica a duplicidade `0003` como `CONTROLLED`, nao como `WARN`, quando os nomes batem exatamente com o estado historico reconhecido.

Modo recomendado:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-operational-audit.ps1 -Strict
```

O modo `-Strict` deve falhar apenas para alertas nao controlados. Itens `CONTROLLED` aparecem no relatorio, mas nao travam a rotina.

Checks opcionais do mesmo auditor:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-operational-audit.ps1 -CheckWatcher
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-operational-audit.ps1 -CheckVercelAliases
```

Esses checks continuam read-only. O primeiro le logs locais do watcher; o segundo usa `vercel inspect` para relatar aliases e deployments.

Observacao: `-CheckVercelAliases` confirma deployment, target e status dos aliases. Ele nao substitui o registro de release para provar paridade de commit entre producao e homologacao.

## Bloqueios

Continuam bloqueados ate autorizacao explicita:

- aplicar migration em Supabase real;
- alterar historico de migrations ja publicadas;
- renomear arquivos antigos;
- corrigir sequencia no banco real;
- alterar RLS, grants, service role, env ou connection string;
- promover producao com migration pendente ou nao validada.
