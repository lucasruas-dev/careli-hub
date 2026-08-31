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

/** O que o C2X guarda de cada unidade existente — o suficiente para o DIFF da carga. */
export type UnidadeNoC2x = {
  area: null | number;
  id: number;
  price: null | number;
  registration: null | string;
};

/** As chaves `quadra|lote` que o empreendimento já tem, com os campos cadastrais de cada uma. */
async function unidadesJaNoC2x(
  enterpriseId: number,
): Promise<
  | { chaves: Set<string>; existentes: Map<string, UnidadeNoC2x>; ok: true; total: number }
  | { erro: string; ok: false }
> {
  const pool = getHadesDbPool();
  if (!pool.ok) return { erro: `C2X indisponível: ${pool.missing.join(", ")}.`, ok: false };

  try {
    const [linhas] = await pool.pool.query<
      (RowDataPacket & {
        area: null | number | string;
        block: string;
        id: number;
        lot: string;
        price: null | number | string;
        registration: null | string;
      })[]
    >(
      `select id, block, lot, area, price, registration
         from enterprise_unities where enterprise_id = ?`,
      [enterpriseId],
    );
    const chaves = new Set<string>();
    const existentes = new Map<string, UnidadeNoC2x>();
    for (const l of linhas) {
      const chave = `${doisDigitos(l.block)}|${doisDigitos(l.lot)}`;
      chaves.add(chave);
      existentes.set(chave, {
        area: l.area == null ? null : Number(l.area),
        id: Number(l.id),
        price: l.price == null ? null : Number(l.price),
        registration: l.registration?.trim() || null,
      });
    }
    return { chaves, existentes, ok: true, total: linhas.length };
  } catch {
    return { erro: "Não foi possível ler as unidades já cadastradas.", ok: false };
  }
}

export type MudancaDeUnidade = {
  campo: "area" | "matricula" | "valor";
  de: null | number | string;
  para: null | number | string;
};

export type UnidadeDesatualizada = {
  idNoC2x: number;
  lote: string;
  mudancas: MudancaDeUnidade[];
  quadra: string;
  /** O que vai ser gravado, se o operador mandar atualizar. */
  unidade: UnidadeParaImportar;
};

export type ResultadoDaConferencia = {
  /**
   * Já existem no C2X mas a planilha traz PREÇO, ÁREA ou MATRÍCULA diferentes.
   *
   * ⚠️ Pedido do Lucas (29/08/2026): *"subimos uma tabela defasada, consegue liberar que a
   * proxima importação atualize essa unidades?"*. O diff mostra exatamente o que muda em cada
   * uma — e STATUS DE VENDA fica de fora de propósito: status muda por operação (reserva,
   * venda), nunca por carga; uma planilha velha dizendo "disponível" não pode rebaixar um lote
   * vendido.
   */
  desatualizadas: UnidadeDesatualizada[];
  destino: string;
  empreendimento: { code: string; id: number; nome: string; unidadesHoje: number };
  /** Já existem no C2X e estão IGUAIS à planilha: nada a fazer. */
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

  // ⚠️ O QUE JÁ EXISTE SAI DA LISTA DE CRIAÇÃO, e não vira erro. Mas desde 29/08 a conferência
  // SEPARA as existentes em dois montes: iguais à planilha (nada a fazer) e DESATUALIZADAS
  // (preço, área ou matrícula divergem) — que a tela oferece para atualizar.
  const jaExistem: { lote: string; quadra: string }[] = [];
  const desatualizadas: UnidadeDesatualizada[] = [];
  const prontas = unidades.filter((u) => {
    const atual = noC2x.existentes.get(`${u.quadra}|${u.lote}`);
    if (!atual) return true;
    const mudancas: MudancaDeUnidade[] = [];
    // tolerância de 1 centavo/0,01 m²: a planilha e o MySQL arredondam diferente.
    if (atual.price == null || Math.abs(atual.price - u.valor) > 0.01) {
      mudancas.push({ campo: "valor", de: atual.price, para: u.valor });
    }
    if (atual.area == null || Math.abs(atual.area - u.area) > 0.01) {
      mudancas.push({ campo: "area", de: atual.area, para: u.area });
    }
    const matriculaNova = u.matricula?.trim() || null;
    // Matrícula só ENTRA ou muda — planilha sem matrícula não apaga a que o C2X já tem.
    if (matriculaNova && matriculaNova !== atual.registration) {
      mudancas.push({ campo: "matricula", de: atual.registration, para: matriculaNova });
    }
    if (mudancas.length) {
      desatualizadas.push({ idNoC2x: atual.id, lote: u.lote, mudancas, quadra: u.quadra, unidade: u });
    } else {
      jaExistem.push({ lote: u.lote, quadra: u.quadra });
    }
    return false;
  });

  return {
    dados: {
      desatualizadas,
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

export type ResultadoDaAtualizacao = {
  atualizadas: number;
  destino: string;
  falhas: { erro: string; lote: string; quadra: string }[];
};

/**
 * Atualiza no C2X as unidades cuja planilha diverge — SÓ os campos cadastrais.
 *
 * ⚠️ O PAYLOAD LEVA APENAS area, price e matrícula. Nome, quadra/lote e principalmente
 * STATUS DE VENDA ficam de fora: status muda por operação (reserva, venda, distrato), nunca
 * por carga — uma planilha defasada dizendo "disponível" não pode rebaixar lote vendido.
 *
 * ⚠️ O UPDATE USA `PUT {caminho}/{id}` (padrão Rails da mesma integração). Se a API não expuser
 * o update (404/405), TODAS as unidades falham com a mesma mensagem e nada foi escrito — a
 * resposta diz claramente que é preciso cobrar o endpoint do fornecedor, como foi com a
 * reserva.
 */
export async function atualizarUnidades(input: {
  desatualizadas: UnidadeDesatualizada[];
  enterpriseId: number;
}): Promise<{ dados: ResultadoDaAtualizacao; ok: true } | { erro: string; ok: false }> {
  const base = process.env.C2X_WRITE_API_URL?.trim();
  const token = process.env.C2X_WRITE_API_TOKEN?.trim();
  if (!base || !token) {
    return { erro: "Integração de escrita do C2X não configurada.", ok: false };
  }

  const falhas: ResultadoDaAtualizacao["falhas"] = [];
  let atualizadas = 0;

  for (const d of input.desatualizadas) {
    const url = `${base.replace(/\/+$/, "")}${CAMINHO_DA_API}/${d.idNoC2x}`;
    const payload: Record<string, unknown> = {};
    for (const m of d.mudancas) {
      if (m.campo === "valor") payload.price = d.unidade.valor;
      if (m.campo === "area") payload.area = d.unidade.area;
      if (m.campo === "matricula" && d.unidade.matricula) {
        payload.registration = d.unidade.matricula;
        payload.registration_number = d.unidade.matricula;
      }
    }
    if (!Object.keys(payload).length) continue;

    try {
      const resposta = await fetch(url, {
        body: JSON.stringify(payload),
        headers: {
          Accept: "application/json",
          // ⚠️ SEM "Bearer", como no create: a API do C2X quer o token cru nos dois cabeçalhos.
          access_token: token,
          Authorization: token,
          "Content-Type": "application/json",
        },
        method: "PUT",
      });
      if (resposta.status >= 200 && resposta.status < 300) {
        atualizadas += 1;
      } else {
        const texto = await resposta.text();
        falhas.push({
          erro:
            resposta.status === 404 || resposta.status === 405
              ? `HTTP ${resposta.status}: a API do C2X não expõe atualização de unidade — é preciso pedir o endpoint ao fornecedor (mesmo caso da reserva).`
              : `HTTP ${resposta.status}: ${texto.slice(0, 160)}`,
          lote: d.lote,
          quadra: d.quadra,
        });
      }
    } catch (falha) {
      falhas.push({
        erro: falha instanceof Error ? falha.message : "Falha de rede.",
        lote: d.lote,
        quadra: d.quadra,
      });
    }
  }

  return { dados: { atualizadas, destino: destinoDoC2x(), falhas }, ok: true };
}

/** O prefixo sugerido para o nome da unidade: o próprio código do empreendimento. */
export function prefixoSugerido(code: string): string {
  return String(code ?? "").trim().toUpperCase().slice(0, 4);
}

export { nomeDaUnidade };
