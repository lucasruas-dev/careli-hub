import { getHadesDbPool } from "@/lib/guardian/db";

// O PERFIL DO COMPRADOR, AGREGADO, para enriquecer o painel de vendas do incorporador.
//
// Pedido do Lucas (18/08/2026): *"o perfil do comprador (como no relatorio do Vale do Ouro),
// podemos trazer para enriquecer esse painel de vendas"*.
//
// A referência é o BI público "Quem é o comprador do Vale do Ouro" (`lib/prometeu/
// bi-vale-do-ouro.ts`), e as REGRAS são as dele, de propósito — os dois painéis têm que contar a
// mesma coisa:
//   • venda = proposta viva em estágio 3, 4, 5, 6 ou 9 (regra fechada pelo Lucas em 10/08:
//     "tudo que estiver em proposta, contrato gerado e assinatura, vamos contar como vendido");
//   • conta POR PROPOSTA: o investidor com 3 lotes pesa 3 — é o peso dele no produto;
//   • sexo/estado civil/renda/profissão saem dos lookups do C2X (`sexes`, `civil_states`,
//     `salary_ranges`, `professions`) — a renda mora em `users.salary_range_id` e as faixas de
//     salários JÁ SÃO o texto do lookup ("1 a 3 salários"), não recalculamos nada;
//   • onde mora = endereço real (`addresses` → `cities`/`states`), não a naturalidade;
//   • idade em faixas a partir de `users.birthday`, as MESMAS faixas do relatório.
//
// ⚠️ TUDO AGREGADO, SEMPRE. Daqui saem contagens e percentuais por faixa — NUNCA um dado
// individual, NUNCA um nome. O comprador com renda X não é identificável nem por eliminação: a
// linha crua fica no servidor e o payload só carrega os baldes.
//
// ⚠️ E AGREGADO TEM PISO (`PISO_DE_AGREGACAO`). Existem empreendimentos com 1–2 vendas vivas no
// C2X (TSC=1, SDT=2, VOR=2), e o filtro `emp` da rota encolhe o recorte à vontade: com 1 venda,
// os "baldes" viram a ficha INDIVIDUAL de uma pessoa que o incorporador vê NOMINALMENTE na tabela
// da mesma tela — renda familiar, idade, estado civil, profissão e cidade dela. Ver o nome (ele é
// parte do contrato) não autoriza ver a renda: é dado de cadastro, não do contrato. Abaixo do
// piso, o perfil NÃO sai — e a regra mora AQUI, na agregação, para valer para qualquer chamador,
// não num `if` de tela que o cliente confere sozinho.
//
// ⚠️ O ESCOPO É DE QUEM CHAMA. `lerCompradoresDasVendas` recebe códigos JÁ filtrados por
// `codigosDaSessao` e não autoriza nada sozinha.

/** Um balde do agregado: rótulo, contagem e percentual (0–100, base = total de vendas). */
export type FatiaDoPerfil = {
  percentual: number;
  quantidade: number;
  rotulo: string;
};

export type PerfilDoComprador = {
  /** Onde mora (cidade/UF), top 5. Sem endereço não entra — ausência não é uma cidade. */
  cidades: FatiaDoPerfil[];
  estadoCivil: FatiaDoPerfil[];
  /** Faixas fixas, na ordem etária; "Não informado" fecha a lista. */
  idades: FatiaDoPerfil[];
  /** Top 6, como no relatório do Vale do Ouro. */
  profissoes: FatiaDoPerfil[];
  /** Faixas de salários do lookup do C2X, das mais frequentes para as menos. */
  rendaFamiliar: FatiaDoPerfil[];
  sexo: FatiaDoPerfil[];
  /** O denominador de todos os percentuais: propostas vivas de venda no escopo. */
  vendas: number;
};

/** Uma linha crua da consulta: UM comprador de UMA venda. NUNCA sai do servidor. */
export type CompradorCru = {
  /** "Cidade/UF" já montado, ou nulo sem endereço. */
  cidade: null | string;
  estado_civil: null | string;
  /** 'YYYY-MM-DD'. */
  nascimento: null | string;
  profissao: null | string;
  renda: null | string;
  sexo: null | string;
};

export const NAO_INFORMADO = "Não informado";

/**
 * Mínimo de vendas para o agregado existir. Abaixo disto, `agregarPerfilDoComprador` devolve
 * nulo e a tela esconde a seção (o mesmo caminho de quando o C2X não responde) — ver o bloco
 * "AGREGADO TEM PISO" no cabeçalho do arquivo.
 */
export const PISO_DE_AGREGACAO = 5;

/** As faixas do relatório do Vale do Ouro, na ordem etária. */
export const FAIXAS_DE_IDADE = ["Até 24", "25 a 34", "35 a 44", "45 a 54", "55+"] as const;

/**
 * Idade completa na data `agoraMs`, sem fuso: compara 'YYYY-MM-DD' com 'YYYY-MM-DD'.
 * (`TIMESTAMPDIFF(YEAR, ...)` do MySQL faz a mesma conta — os testes conferem a equivalência.)
 */
export function faixaDeIdade(nascimento: null | string, agoraMs: number): string {
  const data = String(nascimento ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return NAO_INFORMADO;

  const hoje = new Date(agoraMs).toISOString().slice(0, 10);
  let idade = Number(hoje.slice(0, 4)) - Number(data.slice(0, 4));
  if (hoje.slice(5) < data.slice(5)) idade -= 1;

  if (idade < 0 || idade > 130) return NAO_INFORMADO;
  if (idade < 25) return FAIXAS_DE_IDADE[0];
  if (idade < 35) return FAIXAS_DE_IDADE[1];
  if (idade < 45) return FAIXAS_DE_IDADE[2];
  if (idade < 55) return FAIXAS_DE_IDADE[3];
  return FAIXAS_DE_IDADE[4];
}

function round1(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/** Conta ocorrências de um rótulo; vazio/nulo vira "Não informado". */
function contar(valores: (null | string)[]): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const valor of valores) {
    const rotulo = String(valor ?? "").trim() || NAO_INFORMADO;
    contagem.set(rotulo, (contagem.get(rotulo) ?? 0) + 1);
  }
  return contagem;
}

function fatias(
  contagem: Map<string, number>,
  total: number,
  opcoes?: { top?: number },
): FatiaDoPerfil[] {
  const lista = [...contagem.entries()]
    .map(([rotulo, quantidade]) => ({
      percentual: total > 0 ? round1((quantidade / total) * 100) : 0,
      quantidade,
      rotulo,
    }))
    // Mais frequente primeiro; empate resolve por nome, para a ordem ser estável.
    .sort(
      (a, b) => b.quantidade - a.quantidade || a.rotulo.localeCompare(b.rotulo, "pt-BR"),
    );

  return opcoes?.top ? lista.slice(0, opcoes.top) : lista;
}

/**
 * Agrega as linhas cruas nos baldes do painel. Função PURA: é o que os testes exercitam.
 *
 * Devolve NULO abaixo de `PISO_DE_AGREGACAO` vendas: recorte pequeno não tem agregado, tem a
 * ficha de alguém (ver o cabeçalho do arquivo). O piso vive aqui, e não na rota, de propósito —
 * qualquer chamador futuro herda a proteção sem lembrar dela.
 *
 * O denominador de TODOS os percentuais é o total de vendas — inclusive nas listas top-N e nas
 * cidades (que descartam quem não tem endereço): os percentuais não precisam somar 100, precisam
 * responder "quantos % dos compradores são X", que é a pergunta do relatório.
 */
export function agregarPerfilDoComprador(
  compradores: CompradorCru[],
  agoraMs: number,
): null | PerfilDoComprador {
  const total = compradores.length;

  if (total < PISO_DE_AGREGACAO) {
    return null;
  }

  // Idade tem ordem própria (etária, não por frequência) — monta na mão.
  const porIdade = contar(compradores.map((c) => faixaDeIdade(c.nascimento, agoraMs)));
  const idades: FatiaDoPerfil[] = [...FAIXAS_DE_IDADE, NAO_INFORMADO]
    .map((rotulo) => ({
      percentual: total > 0 ? round1(((porIdade.get(rotulo) ?? 0) / total) * 100) : 0,
      quantidade: porIdade.get(rotulo) ?? 0,
      rotulo,
    }))
    // Faixa zerada não vira linha: "55+: 0" não informa nada no painel.
    .filter((fatia) => fatia.quantidade > 0);

  return {
    // Sem endereço, fora da lista (regra do relatório): a cidade dominante é informação; a
    // quantidade de cadastros incompletos não é uma cidade.
    cidades: fatias(
      contar(compradores.map((c) => c.cidade).filter((cidade) => Boolean(cidade))),
      total,
      { top: 5 },
    ),
    estadoCivil: fatias(contar(compradores.map((c) => c.estado_civil)), total),
    idades,
    profissoes: fatias(contar(compradores.map((c) => c.profissao)), total, { top: 6 }),
    rendaFamiliar: fatias(contar(compradores.map((c) => c.renda)), total),
    sexo: fatias(contar(compradores.map((c) => c.sexo)), total),
    vendas: total,
  };
}

/**
 * Lê no C2X (READ-ONLY) um comprador por venda viva dos empreendimentos dados.
 *
 * O endereço entra deduplicado (o mais recente por pessoa, `max(id)`), senão um comprador com dois
 * endereços viraria duas vendas — o LEFT JOIN direto em `addresses` multiplica linhas.
 *
 * @param codes Códigos JÁ FILTRADOS pelo escopo da sessão (`codigosDaSessao`).
 */
export async function lerCompradoresDasVendas(
  codes: string[],
): Promise<{ compradores: CompradorCru[]; ok: true } | { error: string; ok: false }> {
  const limpos = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (limpos.length === 0) {
    return { compradores: [], ok: true };
  }

  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { error: `Configuracao C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  try {
    const marcadores = limpos.map(() => "?").join(", ");
    const [linhas] = await pool.pool.query(
      // A MESMA régua de venda do BI do Vale do Ouro (estágios 3,4,5,6,9 com ar.open = 1) — os
      // dois painéis contam a mesma coisa de propósito, ver o cabeçalho do arquivo.
      `select date_format(cli.birthday, '%Y-%m-%d') nascimento,
              sx.name sexo,
              cs.name estado_civil,
              pr.name profissao,
              sr.name renda,
              case when ci.name is not null
                   then concat(ci.name, '/', coalesce(st.acronym, '?')) end cidade
         from acquisition_requests ar
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         left join users cli on cli.id = ar.client_id
         left join sexes sx on sx.id = cli.sex_id
         left join civil_states cs on cs.id = cli.civil_state_id
         left join professions pr on pr.id = cli.profession_id
         left join salary_ranges sr on sr.id = cli.salary_range_id
         left join (select ownertable_id, max(id) id
                      from addresses
                     where ownertable_type = 'User'
                     group by ownertable_id) endid on endid.ownertable_id = cli.id
         left join addresses ad on ad.id = endid.id
         left join cities ci on ci.id = ad.city_id
         left join states st on st.id = ad.state_id
        where e.code in (${marcadores})
          and ar.open = 1
          and ar.acquisition_request_stage_id in (3, 4, 5, 6, 9)`,
      limpos,
    );

    return { compradores: linhas as CompradorCru[], ok: true };
  } catch (error) {
    console.error("[apolo][incorporador] falha ao ler o perfil do comprador", error);
    return { error: "Nao foi possivel ler o perfil do comprador agora.", ok: false };
  }
}
