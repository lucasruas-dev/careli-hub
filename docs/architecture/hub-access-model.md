# Careli Hub Access Model

Este documento define o modelo conceitual de acesso operacional do Careli Hub. Ele prepara a Home, os modulos e as futuras policies sem alterar a autenticacao Supabase atual.

## Perfis Operacionais

A hierarquia crescente e:

| Perfil | Significado | Escopo padrao |
| --- | --- | --- |
| `op1` | Operador nivel 1 | `self` |
| `op2` | Operador nivel 2 | `self` |
| `op3` | Operador nivel 3 | `self` |
| `ldr` | Lider | `sector` |
| `cdr` | Coordenador | `department` |
| `adm` | Administrador | `global` |

## Regra De Escopo

- Operador (`op1`, `op2`, `op3`) enxerga apenas informacoes dele mesmo.
- Lider (`ldr`) enxerga informacoes do setor.
- Coordenador (`cdr`) enxerga informacoes do departamento.
- Administrador (`adm`) enxerga toda a operacao.

O escopo deve ser aplicado primeiro na Home e depois reaproveitado por modulos, notificacoes, atividades, mencoes e realtime.

## Compatibilidade Com Roles Atuais

O schema atual ainda usa `admin`, `leader`, `operator` e `viewer`. Para manter compatibilidade:

| Role atual | Perfil operacional temporario |
| --- | --- |
| `admin` | `adm` |
| `leader` | `ldr` |
| `operator` | `op1` |
| `viewer` | `op1` |

Esse mapeamento vive em `@repo/shared` e deve ser substituido por campos reais quando o schema operacional for promovido.

## Estrutura Organizacional

O modelo conceitual segue:

```text
usuario -> setor -> departamento
```

Um usuario pertence a um setor. Um setor pertence a um departamento. O departamento pode liberar modulos para os usuarios daquele contexto.

## Modulos Por Departamento

O contrato `DepartmentModuleAccess` define:

- `departmentId`
- `moduleId`
- `status`: `enabled`, `disabled` ou `planned`

Na etapa atual, somente modulos ativos no registry e liberados no contrato aparecem na sidebar e na Home. Modulos planejados, travados ou inexistentes nao devem aparecer como navegacao operacional.

## Impacto Na Home

A Home e a Central Operacional do Hub. Ela deve:

- calcular o escopo do usuario;
- mostrar indicadores coerentes com esse escopo;
- exibir status da equipe sem chamar o painel de "Presenca";
- mostrar atividades do dia como contrato preparatorio para Task;
- listar novidades do produto por dados estruturados;
- oferecer acesso rapido apenas a modulos ativos e liberados.

Para `adm`, a primeira versao mostra visao global. Para outros perfis, os mesmos blocos devem filtrar por `self`, `sector` ou `department`.

## Impacto Nos Modulos

Cada modulo deve respeitar o mesmo escopo:

- `self`: registros do proprio usuario;
- `sector`: registros do setor do usuario;
- `department`: registros do departamento;
- `global`: registros de toda a operacao.

Esse modelo ainda nao implementa RLS nova. Quando RLS for criada, as policies devem refletir estes escopos sem liberar leitura ampla insegura.
