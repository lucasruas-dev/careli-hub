# A fronteira dos módulos — o que cada um resolve

> ⚠️ **ESTE DOCUMENTO EXISTE PORQUE A FALTA DELE JÁ CUSTOU TRÊS CORREÇÕES DA MESMA COISA.**
> Lucas, 14/09/2026: *"é isso que tem que ficar claro, o que cada módulo resolve. se não cada
> módulo vai ter sua interpretação"*. E, na mesma conversa: *"não podemos ter duas interpretações
> e duas visões na mesma tela"*.

## A regra, em uma linha por módulo

| módulo | resolve |
|---|---|
| **Apolo** | **quem as coisas SÃO** — o cadastro. Pessoa, empresa, empreendimento, vínculo entre eles. |
| **Hércules** | **o que se FAZ com o que está à venda** — unidade, espelho, reserva, proposta, venda. |
| **Têmis** | **o que se ASSINA** — plano, minuta, contrato, assinatura. |
| **Hades** | **o que se COBRA** — carteira, parcela, boleto, acordo. |
| **Íris** | **quem FALA com quem** — atendimento, canal, mensagem. |

Lucas, 14/09/2026, fixando a que estava em disputa:

> *"o cadastro dos empreendimentos vem do apolo, é lá que eu tenho que resolver se aquele
> empreendimento é pai, se tem filhos, então a parte cadastral é o apolo, o hercules resolve a
> parte comercial, venda, reserva, proposta"*

## O teste prático

A pergunta que resolve 90% dos casos: **isso é um FATO sobre a coisa, ou uma AÇÃO sobre ela?**

Fato é Apolo. Ação é do módulo da ação.

| isto | é | dono |
|---|---|---|
| o empreendimento existe, tem código, nome, cidade | fato | Apolo |
| **ele é pai · ele tem filhos · qual a ordem entre eles** | **fato** | **Apolo** |
| a incorporadora dele é a Wlm | fato | Apolo |
| a unidade 12 da quadra 3 está disponível | ação (mudou porque alguém vendeu) | Hércules |
| o corretor reservou a unidade | ação | Hércules |
| a proposta virou contrato | ação | Têmis |
| a parcela venceu | ação | Hades |

⚠️ **UM CASO NÃO É NENHUM DOS DOIS, e ele é a armadilha:** a **política comercial** — comissão,
entrada mínima, faixa de prazo, ordem de assinatura, taxa de cessão. Não é um fato sobre o
empreendimento nem uma ação sobre uma unidade: é um **acordo**, que muda sem que nada no mundo
mude. Ela tem dono próprio (a aba Política Comercial) e **não se mistura com o cadastro** — senão,
daqui a um mês, esta mesma discussão volta com outro nome.

## ⚠️ Onde o código viola isto hoje — medido em 14/09/2026

**Existem TRÊS cópias do cadastro de empreendimento**, e a tela principal lê a errada:

| onde | o que guarda | arquivos que leem |
|---|---|---|
| Listas fixas em código (`ENTERPRISE_GROUPS`, `ENTERPRISE_MIRRORS`, `EXCLUDED_ENTERPRISE_CODES`, `GRUPOS_C2X` — `lib/guardian/c2x-analytics.ts`) | grupos, espelhos e exclusões escritos à mão | **24** |
| `hercules_empreendimentos` | `pai_id`, código, nome, cidade, uf, `c2x_enterprise_id`, vendendo, ordem | **17** |
| `apolo_enterprise_settings` | 26 colunas: credenciamento, comissões, entrada mínima, vendedora, coordenação, ordem de assinatura, `masterplan_url` | — |

Apenas **4 arquivos** leem mais de uma. O resto escolheu um lado — e é por isso que *a mesma tela
em módulos diferentes se comporta diferente*.

Três coisas erradas, pela régua acima:

1. ⚠️ **`hercules_empreendimentos` tem doze colunas e TODAS são cadastrais.** Não há uma linha de
   comercial ali. É um cadastro do Apolo com nome de Hércules — e é ele que guarda o `pai_id`, ou
   seja, **a decisão que o Lucas toma mora no módulo que só deveria vender**.
2. ⚠️ **As listas fixas são uma terceira verdade, e a mais lida.** Elas envelhecem sozinhas: o VOR
   nasceu depois da lista e teve de ser costurado à mão em 08/09/2026.
3. ⚠️ **`apolo_enterprise_settings` mistura cadastro com política** — `masterplan_url` (fato) ao
   lado de `comissao_imobiliaria_percentual` (acordo).

### A prova de que remendar a tela não resolve

O mesmo defeito foi "corrigido" três vezes, sempre na tela, nunca na fonte:

- **08/09/2026** — Lucas: *"na tela da gurgel, vale do ouro está agrupado, no apolo não"*. A
  correção foi uma entrada nova em `ENTERPRISE_GROUPS`. Está escrita no comentário do código, com
  o nome dele.
- **13/09/2026** — o VLO aparecia como linha solta ao lado do grupo. A correção foi uma tarja
  "Histórico" — que contradizia o cadastro.
- **14/09/2026** — Lucas: *"VLO é o pai, porque tem dois vale do ouro, **já expliquei isso para
  vc**"*.

**Enquanto as três cópias existirem, alguém edita uma e esquece as outras.** Não é descuido de
quem editou: é o desenho pedindo o erro.

## O conserto combinado

Uma fonte só para o cadastro, no Apolo, com pai, filhos, ordem e quem está vendendo. Todos os 24
arquivos passam a consumi-la. As listas fixas viram **uma carga única** para o cadastro e depois
são **apagadas** — não mantidas em paralelo, porque paralelo é exatamente o problema.

Ver a memória `reference_apolo_cadastra_hercules_vende`, e
`feedback_uma_ficha_para_todos_os_modulos` — é a mesma regra da casa que já vale para PESSOA
("uma ficha para todos os módulos"), aplicada agora a EMPREENDIMENTO.

## Como usar este documento

Antes de criar tabela, coluna ou lista que descreva uma coisa do mundo, pergunte: **é fato ou é
ação?** Se for fato e você não estiver no Apolo, você está prestes a criar a quarta cópia.

E se a resposta for "mas eu preciso disso aqui e o Apolo não me dá" — o conserto é **fazer o Apolo
dar**, não guardar de novo.
