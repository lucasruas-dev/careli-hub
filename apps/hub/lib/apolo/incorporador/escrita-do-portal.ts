// O QUE O PORTAL QUE NÃO É A CARELI PODE ESCREVER NUMA FICHA DO APOLO.
//
// Por que existe (revisão da onda do Cecílio, 16/09/2026): as rotas do board passaram a aceitar o
// Cecílio (`autorizarOperacaoDeVenda`), e duas delas escrevem em dado que NÃO é da CAD, é da PESSOA
// (ou da imobiliária) inteira:
//   • PATCH /board/[id]: telefone e e-mail vão para `apolo_contacts` e `metadata.cadastroEditado`,
//     que a CACÁ, a Iris, os avisos de venda e a cobrança de TODOS os empreendimentos leem; na
//     imobiliária (sem esteira), o cadastro inteiro e o `trade_name` são a mesma ficha para os
//     produtos de outros clientes;
//   • POST /board/[id]/identidade: nome, CPF/CNPJ, identificadores e índice de busca da entidade, e
//     o motivo gravado em TODAS as CADs dela.
// *"eles meio que vão andar sozinhos sem o time administrativo da Careli"*: andar sozinho no próprio
// produto, não mexer no telefone que a cobrança do Lagoa Bonita usa.
//
// A régua: fora do comercial, o dado compartilhado só é escrito quando TODOS os empreendimentos que
// o Apolo conhece da pessoa (CADs e vínculos) estão no recorte CRU da sessão. Sem o espelho do pai:
// o espelho vale para LER a CAD do próprio comprador (familia-no-portal.ts), mas ele é compartilhado
// entre donos diferentes, e escrita não se decide por equivalência.
//
// ⚠️ O COMERCIAL NÃO MUDA: a Careli vendendo edita como sempre editou.
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";

/** Os empreendimentos que o Apolo conhece da pessoa (`lerEmpreendimentosDaPessoa`). */
export type EmpreendimentosDaPessoa = {
  esteira: readonly string[];
  vinculos: readonly string[];
};

/** Os campos da ficha da CAD que `salvarFichaDoBoard` espelha em dado global da entidade. */
export const CAMPOS_ESPELHADOS_NA_ENTIDADE: ReadonlySet<string> = new Set(["email", "telefone"]);

export const RECUSA_DA_IMOBILIARIA_COMPARTILHADA =
  "Esta imobiliária também trabalha outros empreendimentos. A alteração do cadastro dela é feita pela Careli.";
export const RECUSA_DO_CONTATO_COMPARTILHADO =
  "O telefone e o e-mail desta pessoa também valem para outro empreendimento. Peça a alteração à Careli.";
export const RECUSA_DA_IDENTIDADE_COMPARTILHADA =
  "Esta ficha também é usada em outro empreendimento. A correção de nome e documento é feita pela Careli.";
export const COLISAO_NO_PORTAL = "Este documento já está em outra ficha. Fale com a Careli.";

/**
 * Todo empreendimento conhecido da pessoa está no recorte? Pessoa sem nenhum conhecido: NÃO (não dá
 * para provar que o dado é só deste produto).
 */
export function pessoaSoNoRecorte(
  pessoa: EmpreendimentosDaPessoa,
  recorte: ReadonlySet<string>,
): boolean {
  const ids = new Set(
    [...pessoa.esteira, ...pessoa.vinculos]
      .map((id) => normalizarEnterpriseId(id))
      .filter((id): id is string => id !== null),
  );
  if (ids.size === 0) return false;
  for (const id of ids) if (!recorte.has(id)) return false;
  return true;
}

/**
 * A edição da ficha pedida pelo portal pode ser gravada? `null` = pode; texto = a recusa (409).
 *
 *   • comercial: sempre pode (como antes);
 *   • IMOBILIÁRIA (entrou pelo vínculo, grava no cadastro da entidade): só quando ela não trabalha
 *     empreendimento fora do recorte, porque TODO campo dela é global;
 *   • CAD: a ficha da esteira é daquela CAD e pode sempre; só telefone e e-mail, que são espelhados
 *     na entidade, exigem a pessoa inteira no recorte.
 */
export function recusaDaEdicaoNoPortal(entrada: {
  campos: Record<string, unknown>;
  comercial: boolean;
  imobiliaria: boolean;
  pessoa: EmpreendimentosDaPessoa;
  recorte: ReadonlySet<string>;
}): null | string {
  if (entrada.comercial) return null;
  const soNoRecorte = pessoaSoNoRecorte(entrada.pessoa, entrada.recorte);

  if (entrada.imobiliaria) {
    return soNoRecorte ? null : RECUSA_DA_IMOBILIARIA_COMPARTILHADA;
  }

  const mexeNoCompartilhado = Object.keys(entrada.campos).some((chave) =>
    CAMPOS_ESPELHADOS_NA_ENTIDADE.has(chave),
  );
  if (mexeNoCompartilhado && !soNoRecorte) return RECUSA_DO_CONTATO_COMPARTILHADO;
  return null;
}

/**
 * A correção de identidade pedida pelo portal pode seguir? `null` = pode.
 *
 * ⚠️ NÃO É SÓ O NOME NA TELA. `atualizarIdentidade` reescreve documento, identificadores (a CACÁ
 * procura cliente por eles) e o índice de busca da entidade, e grava o motivo em TODAS as CADs dela.
 * Fora do comercial, só com a pessoa inteira no recorte: aí as CADs que recebem o motivo são todas
 * deste portal.
 */
export function recusaDaIdentidadeNoPortal(entrada: {
  comercial: boolean;
  pessoa: EmpreendimentosDaPessoa;
  recorte: ReadonlySet<string>;
}): null | string {
  if (entrada.comercial) return null;
  return pessoaSoNoRecorte(entrada.pessoa, entrada.recorte)
    ? null
    : RECUSA_DA_IDENTIDADE_COMPARTILHADA;
}

/**
 * O vínculo de imobiliária `eid` está DENTRO do recorte, para decidir se o portal pode indeferir,
 * devolver para correção ou reabrir a imobiliária inteira (board/[id]/habilitar)?
 *
 * ⚠️ O RECORTE FICA CRU; SÓ O VÍNCULO É CANONIZADO. Canonizar o recorte transformava a sessão com
 * só o 37 no grupo do Vale do Ouro inteiro, e o vínculo no 36 (VOL, do Lino) passava a contar como
 * dentro. O grupo só está no recorte quando o produto cobre TODAS as divisões (`recorteDoProduto`),
 * então o vínculo gravado como grupo continua casando com quem é dono do conjunto.
 */
export function vinculoDentroDoRecorte(
  eid: string,
  recorte: ReadonlySet<string>,
  canon: (id: string) => string,
): boolean {
  const id = eid.trim();
  return recorte.has(id) || recorte.has(canon(id));
}

/**
 * O erro de `atualizarIdentidade` como o portal pode recebê-lo.
 *
 * ⚠️ A COLISÃO TRAZIA O NOME DO DONO DO DOCUMENTO, de qualquer ficha da base ("Este documento ja
 * pertence a outra ficha (Fulano)"): um oráculo CPF para nome sobre a casa inteira. Pelo portal, de
 * qualquer tipo, sai a frase neutra. Os outros erros (documento inválido, espelho do C2X) não
 * carregam dado de terceiro e passam como vieram.
 */
export function erroDaIdentidadeParaOPortal(resultado: { erro: string; motivo: string }): string {
  return resultado.motivo === "colisao" ? COLISAO_NO_PORTAL : resultado.erro;
}
