// A PROVA DE PERTENCIMENTO da pessoa pedida pelas rotas novas do portal (documentos, histórico).
//
// É a mesma regra de `montarFicha` (crm.ts), extraída para as rotas que precisam provar a pessoa
// SEM montar a ficha inteira: a prova é achar a pessoa DENTRO da consulta já estreitada por
// `codigosDaSessao`/`idsDaSessao`. Roda ANTES de qualquer leitura de documento ou evento — quem
// não aparece na consulta escopada recebe 404, o mesmo "não existe" de `foraDoEscopo`.
import {
  loadApoloEnterpriseCarteira,
  type ApoloCarteiraUnit,
} from "@/lib/apolo/carteira";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";

import { lerEsteiraDoEscopo, type TipoDaFicha } from "./crm";
import { codigosDaSessao, idsDaSessao } from "./escopo";
import type { SessaoIncorporador } from "./sessao";

export type PessoaNoEscopo = {
  /** Os codes que a sessão alcança — as leituras seguintes continuam estreitadas por eles. */
  codes: string[];
  /** O empreendimento da CAD (só prospect; comprador pode ter vários). */
  enterpriseIdDaCad: null | string;
  enterpriseIds: string[];
  entityId: string;
  ok: true;
  /** As unidades de CARTEIRA da pessoa (vazio para prospect) — fonte dos contratos D4Sign. */
  unidadesDaPessoa: ApoloCarteiraUnit[];
};

export type PessoaForaDoEscopo = { ok: false; status: 404 | 503 };

/**
 * Reconfere NO SERVIDOR, a cada chamada, que a pessoa pedida pertence ao escopo da sessão.
 *
 * ⚠️ "O id veio da lista" NÃO é proteção — o cliente pode trocar o id da URL por um id válido de
 * outro loteador. Imobiliária responde 404 de propósito: as rotas de documentos/histórico do
 * portal são de PESSOA (comprador/prospect); documento de imobiliária é operação interna.
 */
export async function pessoaNoEscopo({
  id,
  sessao,
  tipo,
}: {
  id: string;
  sessao: SessaoIncorporador;
  tipo: TipoDaFicha;
}): Promise<PessoaForaDoEscopo | PessoaNoEscopo> {
  const alvo = String(id ?? "").trim();
  if (!alvo || tipo === "imobiliaria") return { ok: false, status: 404 };

  const [codes, enterpriseIds] = await Promise.all([
    codigosDaSessao(sessao),
    idsDaSessao(sessao),
  ]);

  if (codes.length === 0 && enterpriseIds.length === 0) return { ok: false, status: 404 };

  if (tipo === "prospect") {
    if (enterpriseIds.length === 0) return { ok: false, status: 404 };

    const admin = createApoloAdminClient();
    if (!admin) return { ok: false, status: 503 };

    // A esteira já sai filtrada pelos empreendimentos da sessão; o id (chave
    // `entity:enterprise`) só casa com linha que a sessão alcança.
    const esteira = await lerEsteiraDoEscopo(admin, enterpriseIds);
    if (!esteira.ok) return { ok: false, status: 503 };

    const linha = esteira.linhas.find(
      (candidata) => `${candidata.entity_id}:${candidata.enterprise_id ?? ""}` === alvo,
    );
    if (!linha) return { ok: false, status: 404 };

    return {
      codes,
      enterpriseIdDaCad: linha.enterprise_id,
      enterpriseIds,
      entityId: linha.entity_id,
      ok: true,
      unidadesDaPessoa: [],
    };
  }

  // Comprador: as leituras escopadas por code são a prova — quem não está nelas não é deste
  // loteador. Sem catálogo (codes vazio) o C2X não respondeu: indisponível, nunca "não existe".
  if (codes.length === 0) return { ok: false, status: 503 };

  const [carteira, vendas] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    loadApoloEnterpriseVendas(codes),
  ]);

  if (!carteira.ok || !vendas.ok) return { ok: false, status: 503 };

  const unidadesDaPessoa = carteira.data.units.filter(
    (unidade) => unidade.client?.entityId === alvo,
  );
  const temVenda = vendas.data.units.some((unidade) => unidade.client?.entityId === alvo);

  if (unidadesDaPessoa.length === 0 && !temVenda) return { ok: false, status: 404 };

  return {
    codes,
    enterpriseIdDaCad: null,
    enterpriseIds,
    entityId: alvo,
    ok: true,
    unidadesDaPessoa,
  };
}
