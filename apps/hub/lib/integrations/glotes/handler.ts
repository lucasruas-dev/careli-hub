// O caminho comum das cinco rotas do GLOTES: autoriza, valida parâmetro, consulta, registra.
//
// Existe para as rotas ficarem de três linhas cada. Cinco cópias do mesmo bloco de segurança é
// como uma delas acaba esquecendo o teto de requisições ou o log — e a que esquecer vai ser
// justamente a de `clientes`, que é a que tem CPF.
import { NextResponse } from "next/server";

import {
  type Filtros,
  cursorValido,
  listarClientes,
  listarLoteamentos,
  listarLotes,
  listarRecebimentos,
  listarVendas,
} from "./consultas";
import {
  autorizar,
  dentroDoTeto,
  falhaInterna,
  ipDe,
  lerAlteradoDesde,
  lerData,
  lerLimite,
  pedidoInvalido,
  registrarAcesso,
} from "./porta";

export type Conjunto = "clientes" | "loteamentos" | "lotes" | "recebimentos" | "vendas";

const CONSULTA = {
  clientes: listarClientes,
  loteamentos: listarLoteamentos,
  lotes: listarLotes,
  recebimentos: listarRecebimentos,
  vendas: listarVendas,
} as const;

/** Só `vendas` e `recebimentos` aceitam carga incremental — os outros três mudam pouco e o
 *  contrato manda recarregar por inteiro. */
// Clientes entrou em 24/08 (pedido do Lucas): o GLOTES precisa puxar as atualizações de
// cadastro — e-mail e telefone — sem varrer a base inteira.
const ACEITA_ALTERADO_DESDE = new Set<Conjunto>(["clientes", "recebimentos", "vendas"]);

export async function responder(
  request: Request,
  conjunto: Conjunto,
): Promise<NextResponse> {
  const auth = autorizar(request);
  if ("resposta" in auth) return auth.resposta;

  const ip = ipDe(request);
  const teto = dentroDoTeto(ip);
  if ("resposta" in teto) return teto.resposta;

  const url = new URL(request.url);
  const q = (nome: string) => url.searchParams.get(nome);

  const limite = lerLimite(q("limite"));
  if ("erro" in limite) return pedidoInvalido(limite.erro);

  const cursor = q("cursor");
  if (!cursorValido(cursor)) {
    return pedidoInvalido("O cursor é inválido. Repasse o valor de proxima_pagina sem alterar.");
  }

  const alteradoDesde = lerAlteradoDesde(ACEITA_ALTERADO_DESDE.has(conjunto) ? q("alterado_desde") : null);
  if ("erro" in alteradoDesde) return pedidoInvalido(alteradoDesde.erro);

  const vencimentoDe = lerData(q("vencimento_de"), "vencimento_de");
  if ("erro" in vencimentoDe) return pedidoInvalido(vencimentoDe.erro);

  const vencimentoAte = lerData(q("vencimento_ate"), "vencimento_ate");
  if ("erro" in vencimentoAte) return pedidoInvalido(vencimentoAte.erro);

  const filtros: Filtros = {
    alteradoDesde: alteradoDesde.valor,
    codigoVenda: q("codigo_venda"),
    cursor,
    incluirCanceladas: q("incluir_canceladas") === "true",
    limite: limite.valor,
    statusParcela: q("status_parcela"),
    vencimentoAte: vencimentoAte.valor,
    vencimentoDe: vencimentoDe.valor,
  };

  try {
    const pagina = await CONSULTA[conjunto](filtros);

    registrarAcesso({
      conjunto,
      // Os filtros entram no log; as LINHAS não. Ver o comentário em registrarAcesso.
      filtros: {
        alterado_desde: filtros.alteradoDesde ?? null,
        codigo_venda: filtros.codigoVenda ?? null,
        limite: filtros.limite ?? null,
        pagina: filtros.cursor ? "seguinte" : "primeira",
      },
      ip,
      linhas: pagina.dados.length,
    });

    return NextResponse.json(pagina, {
      headers: {
        // Dado pessoal não fica em cache de CDN nem de navegador, em nenhuma hipótese.
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    console.error(`[glotes][${conjunto}] falha`, error);
    return falhaInterna();
  }
}
