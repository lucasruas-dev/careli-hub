// A REGRA DO SEMEADOR DE EMPREENDIMENTOS, SEM BANCO: agrupar o que o C2X tem e decidir o que falta.
//
// Mora num arquivo à parte de `semear-empreendimentos.mjs` para poder ser testada sem abrir conexão
// com o C2X nem com o Supabase (lib/hercules/semear-empreendimentos.test.ts). O script lê os dois
// bancos, chama estas funções e só então escreve.
//
// ⚠️ O SEMEADOR SÓ INSERE, DESDE 24/09/2026. Lucas, depois de a Nívea renomear no C2X o 43 de
// RECANTO DO VALE/RDV para PORTAL DO IBITURUNA/PDI: *"Tivemos que mudar de nome"*; e *"pode"* para
// travar as portas por onde o C2X ainda mexe no Panteon. Até aqui o semeador fazia UPSERT por código
// e regravava `nome`, `c2x_enterprise_id`, `pai_id` e `vendendo` de toda linha herdada: rodado depois
// de um renome no legado, ele trazia o nome do C2X por cima do que o Panteon decidiu. O cadastro do
// empreendimento vive no Panteon ([[feedback_cadastro_do_empreendimento_no_banco]]); o que já existe
// aqui NÃO é tocado, e a diferença para o C2X só é mostrada.

// OS 11 QUE ESTÃO VENDENDO (Lucas: *"vamos pegar somente as que estamos tendo venda"* → *"os 11"*):
// os empreendimentos com recepção de CAD ligada em 02/09/2026. Por CÓDIGO DO PAI. Só vale para linha
// NOVA: `vendendo` de linha existente é do Panteon.
export const VENDENDO = new Set([
  "VDO", "REP", "VAL", "VLO", "RVP", "GDN", "JDG", "ACP", "LAB", // + Lagoa Bonita (LAB é o pai)
]);

// Nome de mercado do PAI, quando o do C2X não serve como está.
export const NOME_DE_MERCADO = {
  "ALDEIA DAS CACHOEIRAS DAS PEDRAS": "Aldeia das Cachoeiras das Pedras",
  "CONDOMINIO RECANTO DO PARA": "Recanto do Pará",
  "RESIDENCIAL VILLA PARIS": "Villa Paris",
  "VISTAS DA PRAIA RESIDENCIAL": "Vistas da Praia",
};

// Empreendimentos do C2X que NÃO são produto (testes e aditivos): ficam de fora do cadastro.
//
// ⚠️ PELO ID, E NÃO SÓ PELA SIGLA. A lista era de siglas, e a sigla muda no legado: o aditivo 30 foi
// LAG, virou ADT em 16/07 e ACT em 21/09/2026 (auditorias 16039, 33688 e 33689 do C2X). Com a lista
// só de siglas, a próxima rodada autorizada o cadastraria como produto novo ("Aldeia da Cachoeira das
// Pedras - Termo de Adesão e Transferência"). Os ids foram medidos em 24/09/2026 em
// `apolo_enterprise_settings`: 2 = SDT, 30 = ADT (hoje ACT), 34 = TSC. As siglas ficam por garantia.
export const IGNORAR_IDS = new Set(["2", "30", "34"]);
export const IGNORAR_CODIGOS = new Set(["SDT", "TSC", "ADT"]);

// Espelhos = o PAI. O C2X guarda o masterplan e o conjunto inteiro de unidades nestes. Mesmo cuidado
// da lista acima: pelo id (31 = LAB, 35 = VLO), e a sigla por garantia.
export const ESPELHOS_IDS = new Set(["31", "35"]);
export const ESPELHOS_CODIGOS = new Set(["LAB", "VLO"]);

// Os produtos nascidos no Panteon (migration 0170) começam aqui.
export const PRIMEIRO_ID_DO_PANTEON = 100000;

const UF = {
  "Minas Gerais": "MG", "São Paulo": "SP", "Espírito Santo": "ES", "Rio de Janeiro": "RJ",
  "Bahia": "BA", "Goiás": "GO", "Distrito Federal": "DF",
};

export function titulo(nome) {
  const pequenas = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(nome ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((p, i) => (i > 0 && pequenas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ")
    .replace(/\bPara\b/, "Pará");
}

const texto = (v) => String(v ?? "").trim();

/**
 * Agrupa as linhas de `enterprises` do C2X em pais e filhos.
 *
 * A REGRA DO AGRUPAMENTO: filhos do mesmo pai têm o MESMO `name` no C2X ("VALE DO OURO" ×4,
 * "LAGOA BONITA" ×3). O ESPELHO É O PAI; empreendimento único vira pai sem filho; grupo sem espelho
 * ganha um pai só do Panteon, sem id do C2X (LOS/LOU→LOX, RDP/RPS/RPC→RDX, PDV/PVS→PDX).
 */
export function agruparPaisEFilhos(linhas) {
  const grupos = new Map(); // chave = nome normalizado do pai
  for (const l of linhas) {
    const id = texto(l.id);
    const code = texto(l.code).toUpperCase();
    if (!code || IGNORAR_IDS.has(id) || IGNORAR_CODIGOS.has(code)) continue;
    const nomeCru = texto(l.name).toUpperCase().replace(/\s+/g, " ");
    const ehEspelho = /- MASTERPLAN$/.test(nomeCru) || ESPELHOS_IDS.has(id) || ESPELHOS_CODIGOS.has(code);
    const chave = nomeCru.replace(/\s*-\s*MASTERPLAN$/, "");
    const g = grupos.get(chave) ?? { chave, cidade: null, espelho: null, filhos: [], uf: null };
    g.cidade = g.cidade ?? (l.cidade ? texto(l.cidade) : null);
    g.uf = g.uf ?? (l.estado ? (UF[texto(l.estado)] ?? texto(l.estado)) : null);
    if (ehEspelho) g.espelho = { c2xId: id, codigo: code };
    else g.filhos.push({ c2xId: id, codigo: code, nome: titulo(nomeCru) });
    grupos.set(chave, g);
  }

  const pais = [];
  for (const g of grupos.values()) {
    let filhos = [...g.filhos].sort((a, b) => a.codigo.localeCompare(b.codigo));
    let codigoDoPai;
    let c2xDoPai = null;
    if (g.espelho) {
      codigoDoPai = g.espelho.codigo;
      c2xDoPai = g.espelho.c2xId;
    } else if (filhos.length === 1) {
      codigoDoPai = filhos[0].codigo;
      c2xDoPai = filhos[0].c2xId;
      filhos = [];
    } else {
      codigoDoPai = filhos[0].codigo.slice(0, 2) + "X";
    }
    const nome = NOME_DE_MERCADO[g.chave] ?? titulo(g.chave);
    pais.push({
      c2x_enterprise_id: c2xDoPai,
      cidade: g.cidade,
      codigo: codigoDoPai,
      filhos,
      nome,
      uf: g.uf,
      vendendo: VENDENDO.has(codigoDoPai) || filhos.some((f) => VENDENDO.has(f.codigo)),
    });
  }
  pais.sort((a, b) => Number(b.vendendo) - Number(a.vendendo) || a.nome.localeCompare(b.nome));
  return pais;
}

/**
 * Produto que NÃO é da carga do C2X: com dono marcado (`operado_por`, D2 de 16/09/2026), nascido no
 * Panteon (id >= 100000) ou criado pelo hub ou pelo portal. Nada é pendurado nele.
 */
export function motivoDeNaoSerDaCarga(existente) {
  if (texto(existente.operado_por)) return `operado por ${texto(existente.operado_por)}`;
  if (Number(texto(existente.c2x_enterprise_id)) >= PRIMEIRO_ID_DO_PANTEON) {
    return `nascido no Panteon (id ${texto(existente.c2x_enterprise_id)})`;
  }
  if (["hub", "portal"].includes(texto(existente.criado_origem))) {
    return `criado pelo ${texto(existente.criado_origem)}`;
  }
  return null;
}

/**
 * A linha do Panteon que já responde por este empreendimento.
 *
 * ⚠️ PELO ID DO C2X PRIMEIRO, E NÃO PELO CÓDIGO. O código é o que o C2X renomeia (RDV virou PDI): casar
 * só por ele fazia a linha renomeada parecer NOVA, e o insert batia no índice único do id. Sem id do
 * C2X (o pai só do Panteon, como o LOX), o código é a única chave que existe.
 *
 * `conflito` = o código já pertence a OUTRO produto do Panteon. Não dá para inserir (índice único) e
 * não se reescreve: fica para uma pessoa decidir.
 */
export function acharExistente(existentes, { c2xId, codigo }) {
  const id = texto(c2xId);
  const cod = texto(codigo).toUpperCase();
  const peloId = id ? existentes.find((e) => texto(e.c2x_enterprise_id) === id) : undefined;
  if (peloId) return { existente: peloId, tipo: "existe" };

  const peloCodigo = existentes.find((e) => texto(e.codigo).toUpperCase() === cod);
  if (!peloCodigo) return { tipo: "falta" };
  if (!id && !texto(peloCodigo.c2x_enterprise_id)) return { existente: peloCodigo, tipo: "existe" };
  return { existente: peloCodigo, tipo: "conflito" };
}

// O que difere entre o Panteon e o C2X, só para MOSTRAR: o Panteon manda e nada disto é gravado.
function divergencias(existente, esperado) {
  const lista = [];
  if (texto(existente.nome) !== texto(esperado.nome)) {
    lista.push(`nome no Panteon "${texto(existente.nome)}", no C2X "${texto(esperado.nome)}"`);
  }
  if (texto(existente.codigo).toUpperCase() !== texto(esperado.codigo).toUpperCase()) {
    lista.push(`código no Panteon ${texto(existente.codigo)}, no C2X ${texto(esperado.codigo)}`);
  }
  if (esperado.paiId !== undefined && texto(existente.pai_id) !== texto(esperado.paiId)) {
    lista.push("pai diferente no Panteon");
  }
  return lista;
}

/**
 * @typedef {object} FilhoDoPlano
 * @property {"conflito" | "existe" | "inserir"} acao
 * @property {string} codigo
 * @property {string[]} [divergencias]
 * @property {Record<string, unknown>} [linha]
 * @property {string} [motivo]
 */

/**
 * @typedef {object} ItemDoPlano
 * @property {"conflito" | "existe" | "inserir" | "pulado"} acao
 * @property {string} codigo
 * @property {string[]} [divergencias]
 * @property {string} [existenteId]
 * @property {FilhoDoPlano[]} filhos
 * @property {Record<string, unknown>} [linha]
 * @property {string} [motivo]
 * @property {string} [motivoDosFilhos]
 * @property {string} nome
 */

/**
 * O PLANO: o que INSERIR, e só isso. O que já existe sai com `acao: "existe"` e a lista de
 * divergências; o que colide sai como `conflito`; o que não é da carga sai como `pulado`.
 *
 * ⚠️ NENHUMA AÇÃO DESTE PLANO ATUALIZA LINHA. Não existe "atualizar" aqui, de propósito: é isso que
 * impede o semeador de reescrever `nome`, `codigo`, `pai_id` ou `vendendo` de um empreendimento que o
 * Panteon já cadastrou.
 *
 * ⚠️ FILHO SÓ É PENDURADO EM PAI DA CARGA QUE É PAI DE VERDADE. Pai de outro dono (operado, nascido no
 * Panteon) leva os filhos junto no `pulado`, como antes; e pai que no Panteon é FILHO de outro não
 * ganha filho (a tabela não tem neto).
 *
 * @param {any[]} pais o que `agruparPaisEFilhos` devolve
 * @param {any[]} existentes as linhas de `hercules_empreendimentos` do workspace
 * @returns {ItemDoPlano[]}
 */
export function planejarSemeadura(pais, existentes) {
  const lista = [...existentes];
  const ordemDosPais = lista.filter((e) => !texto(e.pai_id)).map((e) => Number(e.ordem) || 0);
  let proximaOrdemDePai = (ordemDosPais.length ? Math.max(...ordemDosPais) : -1) + 1;

  const plano = [];
  for (const p of pais) {
    const achado = acharExistente(lista, { c2xId: p.c2x_enterprise_id, codigo: p.codigo });
    const item = { codigo: p.codigo, filhos: [], nome: p.nome };

    if (achado.tipo === "conflito") {
      plano.push({
        ...item,
        acao: "conflito",
        motivo: `o código ${p.codigo} já é de outro produto no Panteon (${texto(achado.existente.nome)})`,
      });
      continue;
    }

    let paiId = null;
    if (achado.tipo === "existe") {
      const motivo = motivoDeNaoSerDaCarga(achado.existente);
      if (motivo) {
        plano.push({ ...item, acao: "pulado", motivo });
        continue;
      }
      Object.assign(item, {
        acao: "existe",
        divergencias: divergencias(achado.existente, p),
        existenteId: achado.existente.id,
      });
      if (texto(achado.existente.pai_id)) {
        item.motivoDosFilhos = "no Panteon ele é filho de outro empreendimento";
        plano.push(item);
        continue;
      }
      paiId = achado.existente.id;
    } else {
      Object.assign(item, {
        acao: "inserir",
        linha: {
          c2x_enterprise_id: p.c2x_enterprise_id,
          cidade: p.cidade,
          codigo: p.codigo,
          nome: p.nome,
          ordem: proximaOrdemDePai++,
          pai_id: null,
          uf: p.uf,
          vendendo: p.vendendo,
        },
      });
    }

    const irmaos = paiId ? lista.filter((e) => texto(e.pai_id) === texto(paiId)) : [];
    let proximaOrdemDeFilho = (irmaos.length ? Math.max(...irmaos.map((e) => Number(e.ordem) || 0)) : -1) + 1;
    const nomeDoFilho = (f) => `${p.nome} · ${f.codigo}`;

    for (const f of p.filhos) {
      const doFilho = acharExistente(lista, { c2xId: f.c2xId, codigo: f.codigo });
      if (doFilho.tipo === "existe") {
        item.filhos.push({
          acao: "existe",
          codigo: f.codigo,
          divergencias: divergencias(doFilho.existente, {
            codigo: f.codigo,
            nome: nomeDoFilho(f),
            paiId: paiId ?? undefined,
          }),
        });
      } else if (doFilho.tipo === "conflito") {
        item.filhos.push({
          acao: "conflito",
          codigo: f.codigo,
          motivo: `o código ${f.codigo} já é de outro produto no Panteon (${texto(doFilho.existente.nome)})`,
        });
      } else {
        item.filhos.push({
          acao: "inserir",
          codigo: f.codigo,
          // `pai_id` é preenchido na hora de gravar: pai novo só ganha id depois do insert.
          linha: {
            c2x_enterprise_id: f.c2xId,
            cidade: p.cidade,
            codigo: f.codigo,
            nome: nomeDoFilho(f),
            ordem: proximaOrdemDeFilho++,
            uf: p.uf,
            vendendo: p.vendendo,
          },
        });
      }
    }

    plano.push(item);
  }
  return plano;
}
