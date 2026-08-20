import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import {
  conferirPlanilha,
  doisDigitos,
  type LinhaDaPlanilha,
  nomeDaUnidade,
  payloadDaUnidade,
  type ProblemaDaLinha,
  type UnidadeParaImportar,
} from "./cadastrar-unidades";

// IMPORTAÇÃO DE UNIDADES — a parte que fala com o C2X.
//
// ⚠️ ESTA É UMA DAS POUCAS ESCRITAS NO LEGADO, e a mais perigosa delas: criar unidade NÃO TEM
// DESFAZER pela API. Por isso o desenho tem três travas, e nenhuma é decorativa:
//
//   1. CONFERIR É OBRIGATÓRIO. A rota de importar exige o resultado de uma conferência recente e
//      recusa sem ela. Não existe caminho de "sobe direto".
//   2. O DESTINO APARECE ANTES DO CLIQUE. `C2X_WRITE_API_URL` aponta para `teste.careli.adm.br`
//      no ambiente de dev, e foi exatamente isso que fez 8 cadastros de cliente irem para o
//      ambiente errado em 01/08 — todos respondendo "sucesso". Destino invisível é destino errado.
//   3. O BANCO CONFIRMA, NÃO A API. Depois de enviar, relemos o C2X e comparamos a contagem: a
//      API dizer "criei" não é prova de que criou.
//
// ⚠️ A LEITURA DE DUPLICIDADE NORMALIZA OS DOIS LADOS. O C2X guarda "01" e a planilha traz "1";
// sem `doisDigitos` em ambos, a conferência não acha o que já existe e a importação duplica o
// loteamento inteiro.

const CAMINHO_DA_API = "/api/v1/integrations/panteon/enterprise_units";

export type EmpreendimentoDoImportador = {
  code: string;
  id: number;
  nome: string;
  unidades: number;
};

/** Os empreendimentos do C2X, com quantas unidades cada um já tem. */
export async function empreendimentosParaImportar(): Promise<
  { erro: string; ok: false } | { itens: EmpreendimentoDoImportador[]; ok: true }
> {
  const pool = getHadesDbPool();
  if (!pool.ok) return { erro: `C2X indisponível: ${pool.missing.join(", ")}.`, ok: false };

  try {
    const [linhas] = await pool.pool.query<(RowDataPacket & EmpreendimentoDoImportador)[]>(
      `select e.id, e.code, e.name as nome,
              (select count(*) from enterprise_unities u where u.enterprise_id = e.id) as unidades
         from enterprises e
        order by e.name`,
    );
    return { itens: linhas.map((l) => ({ ...l, id: Number(l.id), unidades: Number(l.unidades) })), ok: true };
  } catch {
    return { erro: "Não foi possível ler os empreendimentos do C2X.", ok: false };
  }
}

/** As chaves `quadra|lote` que o empreendimento já tem, já normalizadas. */
async function unidadesJaNoC2x(
  enterpriseId: number,
): Promise<{ chaves: Set<string>; ok: true; total: number } | { erro: string; ok: false }> {
  const pool = getHadesDbPool();
  if (!pool.ok) return { erro: `C2X indisponível: ${pool.missing.join(", ")}.`, ok: false };

  try {
    const [linhas] = await pool.pool.query<(RowDataPacket & { block: string; lot: string })[]>(
      `select block, lot from enterprise_unities where enterprise_id = ?`,
      [enterpriseId],
    );
    const chaves = new Set(linhas.map((l) => `${doisDigitos(l.block)}|${doisDigitos(l.lot)}`));
    return { chaves, ok: true, total: linhas.length };
  } catch {
    return { erro: "Não foi possível ler as unidades já cadastradas.", ok: false };
  }
}

export type ResultadoDaConferencia = {
  destino: string;
  empreendimento: { code: string; id: number; nome: string; unidadesHoje: number };
  /** Já existem no C2X (mesma quadra e lote): não sobem de novo. */
  jaExistem: { lote: string; quadra: string }[];
  problemas: ProblemaDaLinha[];
  /** As que vão subir, na ordem da planilha. */
  prontas: UnidadeParaImportar[];
};

/** O host de destino, sem a chave. Serve para a tela dizer para onde as unidades vão. */
export function destinoDoC2x(): string {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  if (!base) return "não configurado";
  try {
    return new URL(base).host;
  } catch {
    return "inválido";
  }
}

/** Confere a planilha contra o C2X. NÃO escreve nada. */
export async function conferirImportacao(input: {
  enterpriseId: number;
  linhas: LinhaDaPlanilha[];
}): Promise<{ dados: ResultadoDaConferencia; ok: true } | { erro: string; ok: false }> {
  const emps = await empreendimentosParaImportar();
  if (!emps.ok) return { erro: emps.erro, ok: false };

  const emp = emps.itens.find((e) => e.id === input.enterpriseId);
  if (!emp) return { erro: "Empreendimento não encontrado no C2X.", ok: false };

  const noC2x = await unidadesJaNoC2x(input.enterpriseId);
  if (!noC2x.ok) return { erro: noC2x.erro, ok: false };

  const { problemas, unidades } = conferirPlanilha(input.linhas);

  // ⚠️ O QUE JÁ EXISTE SAI DA LISTA, e não vira erro. Reimportar a mesma planilha é o caso comum
  // (o operador corrige três linhas e sobe de novo); tratar isso como falha faria ele parar de
  // ler os avisos justamente quando eles importam.
  const jaExistem: { lote: string; quadra: string }[] = [];
  const prontas = unidades.filter((u) => {
    if (noC2x.chaves.has(`${u.quadra}|${u.lote}`)) {
      jaExistem.push({ lote: u.lote, quadra: u.quadra });
      return false;
    }
    return true;
  });

  return {
    dados: {
      destino: destinoDoC2x(),
      empreendimento: { code: emp.code, id: emp.id, nome: emp.nome, unidadesHoje: noC2x.total },
      jaExistem,
      problemas,
      prontas,
    },
    ok: true,
  };
}

export type ResultadoDoEnvio = {
  criadas: number;
  destino: string;
  falhas: { erro: string; lote: string; quadra: string }[];
  /** O que o BANCO diz depois — a prova real. */
  unidadesAntes: number;
  unidadesDepois: number;
};

/**
 * Envia as unidades para o C2X, uma a uma.
 *
 * ⚠️ UMA A UMA, E NÃO EM LOTE. A API não tem endpoint de lote, e serializar é o que permite dizer
 * exatamente qual linha falhou — num envio de 300 lotes, "deu erro" sem o número da unidade é um
 * relatório inútil.
 */
export async function importarUnidades(input: {
  enterpriseId: number;
  prefixo: string;
  unidades: UnidadeParaImportar[];
}): Promise<{ dados: ResultadoDoEnvio; ok: true } | { erro: string; ok: false }> {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  const token = process.env.C2X_WRITE_API_TOKEN?.trim();

  if (!base || !token) {
    return { erro: "Integração de escrita do C2X não configurada.", ok: false };
  }

  const antes = await unidadesJaNoC2x(input.enterpriseId);
  if (!antes.ok) return { erro: antes.erro, ok: false };

  const url = `${base.replace(/\/+$/, "")}${CAMINHO_DA_API}`;
  const falhas: ResultadoDoEnvio["falhas"] = [];
  let criadas = 0;

  for (const unidade of input.unidades) {
    // Se a unidade entrou no C2X entre a conferência e o envio (outro operador, a tela do C2X),
    // pular é mais seguro que duplicar.
    if (antes.chaves.has(`${unidade.quadra}|${unidade.lote}`)) continue;

    try {
      const resposta = await fetch(url, {
        body: JSON.stringify(payloadDaUnidade(unidade, input.enterpriseId, input.prefixo)),
        headers: {
          Accept: "application/json",
          // ⚠️ SEM "Bearer". A API do C2X quer o token cru, nos dois cabeçalhos.
          access_token: token,
          Authorization: token,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (resposta.status === 200 || resposta.status === 201) {
        criadas += 1;
        antes.chaves.add(`${unidade.quadra}|${unidade.lote}`);
      } else {
        const texto = await resposta.text();
        falhas.push({
          erro: `HTTP ${resposta.status}: ${texto.slice(0, 160)}`,
          lote: unidade.lote,
          quadra: unidade.quadra,
        });
      }
    } catch (falha) {
      falhas.push({
        erro: falha instanceof Error ? falha.message : "Falha de rede.",
        lote: unidade.lote,
        quadra: unidade.quadra,
      });
    }
  }

  // ⚠️ O BANCO É A PROVA. Em 01/08, 8 cadastros responderam "sucesso" e foram parar no ambiente de
  // teste; só a releitura do banco mostrou. A tela compara os dois números e avisa se divergirem.
  const depois = await unidadesJaNoC2x(input.enterpriseId);

  return {
    dados: {
      criadas,
      destino: destinoDoC2x(),
      falhas,
      unidadesAntes: antes.total,
      unidadesDepois: depois.ok ? depois.total : antes.total,
    },
    ok: true,
  };
}

/** O prefixo sugerido para o nome da unidade: o próprio código do empreendimento. */
export function prefixoSugerido(code: string): string {
  return String(code ?? "").trim().toUpperCase().slice(0, 4);
}

export { nomeDaUnidade };
