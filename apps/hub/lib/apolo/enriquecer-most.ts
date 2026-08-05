// Preenche pelo MOST o que sobrou depois que a ficha do operador já foi aproveitada.
//
// Contexto: a maior parte do "buraco" de dados das CADs do lançamento não era falta de dado, era
// dado parado em `apolo_esteira.ficha` que a integração não lia (ver `cadastro-cascata.ts`). Feita
// aquela ligação, sobram poucas fichas — e só para elas vale pagar consulta.
//
// A consulta CARELI_PF_01 custa ~R$ 1,06 por CPF (6 datasets), então o desenho aqui é todo em
// cima de NÃO gastar à toa:
//   · só entra quem realmente falta algum dos campos que a PF_01 sabe responder;
//   · `dryRun` (o padrão) mostra a conta antes de qualquer chamada;
//   · a gravação usa `gravarFichaDoLote`, que só preenche chave VAZIA — nunca sobrescreve o que
//     um humano digitou, nem o que a própria ficha já tinha.
//
// O que a PF_01 responde: nome da mãe, data de nascimento, sexo e faixa de renda. Escolaridade e
// regime de bens NÃO têm base pública: são declaratórios e continuam sendo trabalho de operador.

import { gravarFichaDoLote } from "./asana-import";
// ⚠️ Existem DUAS `matchFaixaRendaId` no projeto, com o mesmo nome e comportamentos diferentes:
// a de `c2x-match` casa por similaridade contra os rótulos do C2X (serve para texto digitado, e
// devolve null para "DE 2 A 4 SALARIOS MINIMOS"); a de `c2x-fields` lê o limite inferior e foi
// escrita para o formato do MOST. Aqui é o MOST, então é a de `c2x-fields`.
import { matchFaixaRendaId, matchSexoId } from "./c2x-fields";
import { unirCadastroEFicha } from "./cadastro-cascata";
import { maisRecentePorEntidade } from "./esteira-cad";
import { enrichPerson } from "./mostqi";
import { precoDataset } from "./most-precos";
import { createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Os 6 datasets que a CARELI_PF_01 dispara. O custo da consulta é a soma deles.
const DATASETS_PF_01 = [
  "addresses_extended",
  "basic_data",
  "emails_extended",
  "financial_data",
  "occupation_data",
  "phones_extended",
];

export function custoPorConsulta(): number {
  return DATASETS_PF_01.reduce(
    (soma, dataset) => soma + (precoDataset("pf", dataset)?.preco ?? 0),
    0,
  );
}

export type FaltanteMost = {
  // Campos que a PF_01 pode responder e que estão vazios nesta ficha.
  campos: string[];
  cpf: string;
  entityId: string;
  nome: string;
};

export type ResultadoEnriquecimento = {
  custoEstimado: number;
  custoGasto: number;
  dryRun: boolean;
  faltantes: FaltanteMost[];
  itens: {
    entityId: string;
    erro?: string;
    nome: string;
    // Campos que a consulta devolveu e que foram gravados.
    preenchidos: string[];
    // Campos que continuaram vazios porque a base não sabia.
    semResposta: string[];
  }[];
  resumo: { consultados: number; comErro: number; preenchidos: number };
};

// Campos que a PF_01 sabe responder, na chave que a ficha usa.
const CAMPOS_DA_BASE = ["dataNascimento", "nomeMae", "rendaId", "sexoId"] as const;

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// Levanta quem ainda precisa de consulta, DEPOIS da cascata cadastro+ficha. Sem isto pagaríamos
// por 335 CPFs para descobrir um sexo que já estava gravado na ficha.
export async function levantarFaltantes(
  client: AdminClient,
  limite = 1000,
): Promise<FaltanteMost[]> {
  const { data: entidades } = await client
    .from("apolo_entities")
    .select("id, display_name, document_masked, metadata")
    .eq("entity_kind", "pf")
    .eq("metadata->>source", "apolo")
    .limit(limite);

  const linhas = (entidades ?? []) as {
    display_name: string | null;
    document_masked: string | null;
    id: string;
    metadata: Record<string, unknown> | null;
  }[];

  const candidatas = linhas.filter((e) => {
    const meta = e.metadata ?? {};
    return Boolean(meta.cadastro) && meta.c2xSynced !== true;
  });

  // Fichas em blocos de 100: `.in()` com centenas de uuids estoura a URL do PostgREST.
  const fichas = new Map<string, Record<string, unknown>>();
  const ids = candidatas.map((e) => e.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await client
      .from("apolo_esteira")
      .select("entity_id, enterprise_id, ficha, atualizado_em, created_at")
      .in("entity_id", ids.slice(i, i + 100));
    // Uma linha por CAD desde a 0080: o mapa por pessoa fica com a MAIS RECENTE (ordem explícita,
    // nunca a que o banco devolveu por último). Este relatório diz "o que falta preencher para
    // enriquecer na MOST" — ler a ficha de outra CAD faria a lista de faltantes mentir.
    for (const [entityId, l] of maisRecentePorEntidade(
      (data ?? []) as Array<{
        atualizado_em: string | null;
        created_at: string | null;
        enterprise_id: string | null;
        entity_id: string;
        ficha: Record<string, unknown> | null;
      }>,
    )) {
      if (l.ficha) fichas.set(entityId, l.ficha);
    }
  }

  const faltantes: FaltanteMost[] = [];
  for (const ent of candidatas) {
    const unido = unirCadastroEFicha(
      (ent.metadata ?? {}).cadastro as Record<string, unknown>,
      fichas.get(ent.id),
    );
    const campos = CAMPOS_DA_BASE.filter((c) => !texto(unido.valores[c]));
    if (campos.length === 0) continue;

    // Sem CPF completo não há o que consultar — a base é indexada por documento.
    const cpf = texto(ent.document_masked).replace(/\D/g, "");
    if (cpf.length !== 11) continue;

    faltantes.push({
      campos: [...campos],
      cpf,
      entityId: ent.id,
      nome: ent.display_name ?? "",
    });
  }
  return faltantes;
}

// Traduz o retorno do MOST para as chaves da ficha. Nascimento e nome da mãe passam direto (a base
// já devolve no formato da ficha); sexo e renda viram id das listas do C2X.
//
// O que a base não souber sai como `undefined`, nunca como string vazia: `gravarFichaDoLote` só
// escreve valor com conteúdo, e campo vazio gravado esconderia que a consulta não respondeu.
export function fichaDoEnriquecimento(dados: {
  nascimento: string;
  nomeMae: string;
  renda: string;
  sexo: string;
}): Record<string, string | null | undefined> {
  const sexoId = matchSexoId(dados.sexo);
  const rendaId = matchFaixaRendaId(dados.renda);
  return {
    dataNascimento: dados.nascimento || undefined,
    nomeMae: dados.nomeMae || undefined,
    rendaId: rendaId || undefined,
    sexoId: sexoId ? String(sexoId) : undefined,
  };
}

// Consulta em ondas pequenas: o módulo do MOST não tem fila nem semáforo próprio, e disparar
// centenas de POSTs de uma vez é a receita para tomar bloqueio de IP no proxy.
const POR_ONDA = 4;

export async function enriquecerPeloMost(input: {
  client?: AdminClient;
  dryRun: boolean;
  limit?: number;
}): Promise<ResultadoEnriquecimento> {
  const client = input.client ?? createApoloAdminClient();
  const vazio: ResultadoEnriquecimento = {
    custoEstimado: 0,
    custoGasto: 0,
    dryRun: input.dryRun,
    faltantes: [],
    itens: [],
    resumo: { comErro: 0, consultados: 0, preenchidos: 0 },
  };
  if (!client) return vazio;

  const faltantes = await levantarFaltantes(client, input.limit ?? 1000);
  const preco = custoPorConsulta();
  const custoEstimado = faltantes.length * preco;

  // Padrão seguro: mostra a conta e a lista, sem gastar um centavo.
  if (input.dryRun) return { ...vazio, custoEstimado, faltantes };

  const itens: ResultadoEnriquecimento["itens"] = [];
  const paraGravar: { campos: Record<string, string | null | undefined>; entityId: string }[] = [];
  let consultados = 0;

  for (let i = 0; i < faltantes.length; i += POR_ONDA) {
    const onda = faltantes.slice(i, i + POR_ONDA);
    const respostas = await Promise.all(
      onda.map(async (f) => {
        try {
          const r = await enrichPerson(f.cpf);
          return { erro: null as string | null, faltante: f, resultado: r };
        } catch (erro) {
          return {
            erro: erro instanceof Error ? erro.message : String(erro),
            faltante: f,
            resultado: null,
          };
        }
      }),
    );

    for (const { erro, faltante, resultado } of respostas) {
      consultados += 1;

      // ⚠️ `available: true` NÃO quer dizer que a consulta foi real: sem `MOSTQI_CLIENT_KEY` o
      // módulo cai em MODO SIMULADO e devolve `mockEnrichment()`, que também vem com
      // `available: true` — e com "JOANA MARIA DA SILVA" no nome da mãe. Esse campo vai para o
      // contrato no C2X, então dado simulado aqui é pior do que campo vazio. Só `source:"mostqi"`
      // é consulta de verdade; qualquer outra coisa aborta o lote inteiro, porque se a chave
      // sumiu ela sumiu para todos (é a armadilha da env "Sensitive" que já nos mordeu).
      if (resultado && resultado.source !== "mostqi") {
        throw new Error(
          "O MOST respondeu em MODO SIMULADO (MOSTQI_CLIENT_KEY ausente ou vazia). " +
            "Nada foi gravado: dado simulado não pode entrar em ficha que vira contrato.",
        );
      }

      if (erro || !resultado?.available) {
        itens.push({
          entityId: faltante.entityId,
          erro: erro ?? "A base não respondeu para este CPF.",
          nome: faltante.nome,
          preenchidos: [],
          semResposta: faltante.campos,
        });
        continue;
      }

      const campos = fichaDoEnriquecimento({
        nascimento: resultado.nascimento,
        nomeMae: resultado.nomeMae,
        renda: resultado.renda,
        sexo: resultado.sexo,
      });

      // Só interessa o que FALTAVA nesta ficha: se a consulta trouxe a mãe mas a ficha já tinha,
      // não entra no relatório como ganho (e `gravarFichaDoLote` também não sobrescreveria).
      const doInteresse = Object.fromEntries(
        Object.entries(campos).filter(([chave]) => faltante.campos.includes(chave)),
      );
      const preenchidos = Object.entries(doInteresse)
        .filter(([, v]) => texto(v))
        .map(([k]) => k);

      if (preenchidos.length > 0) paraGravar.push({ campos: doInteresse, entityId: faltante.entityId });

      itens.push({
        entityId: faltante.entityId,
        nome: faltante.nome,
        preenchidos,
        semResposta: faltante.campos.filter((c) => !preenchidos.includes(c)),
      });
    }
  }

  const gravacao = await gravarFichaDoLote({ client, itens: paraGravar });

  return {
    custoEstimado,
    custoGasto: consultados * preco,
    dryRun: false,
    faltantes,
    itens: itens.map((i) => ({
      ...i,
      erro: i.erro ?? gravacao.erros.find((e) => e.startsWith(i.entityId)),
    })),
    resumo: {
      comErro: itens.filter((i) => i.erro).length,
      consultados,
      preenchidos: gravacao.atualizados,
    },
  };
}
