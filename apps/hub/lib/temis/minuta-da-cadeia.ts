// A MINUTA QUE HERDA — qual modelo vale para esta venda, e DE ONDE ele veio.
//
// Lucas (21/09/2026): quando a divisão (filho) ou a categoria não tem minuta própria, ela HERDA do
// nível de cima, e a TELA MOSTRA DE ONDE VEIO.
//
// ⚠️ O MAIS ESPECÍFICO VENCE, E SÓ ELE. Ao contrário dos anexos, que somam, aqui um degrau responde
// e os outros calam: dois contratos não se somam. A cadeia é a de `cadeia-do-contrato.ts` e a
// travessia para no primeiro degrau que tem minuta PUBLICADA do tipo `contrato`.
//
// ⚠️ "TEM MINUTA PRÓPRIA" NÃO É A MESMA COISA QUE "TEM MINUTA USÁVEL", e a diferença decide o
// comportamento. A categoria que NÃO cadastrou minuta herda, calada e certa. A categoria que
// cadastrou uma e essa minuta foi ARQUIVADA não herda: ela RECUSA, com o nome das duas. Seguir para
// o degrau de cima imprimiria o contrato do empreendimento no recorte que existe justamente para
// assinar outro texto — e nada na tela denunciaria. É a mesma régua de `temOrdemPropria`, em
// `ordem-da-categoria.ts`: quem decide, decide; o que ele decidiu estar quebrado é erro, não herança.
//
// ⚠️ DOIS MODELOS PUBLICADOS NO MESMO DEGRAU RECUSAM, EM VEZ DE SORTEAR. O único de
// `temis_minutas` é `(workspace_id, enterprise_id, nome) where situacao = 'publicada'` (0113): por
// NOME. Ou seja, "VOL-NORMAL" e "VOL-CAUCAO" podem estar publicadas no mesmo produto, e até aqui a
// escolha entre elas era `order(atualizado_em desc).limit(1)` — sorteio pela data, exatamente o que
// o comentário da 0113 diz querer evitar. Hoje nenhum produto tem duas (medido em 21/09/2026), e é
// por isso que dá para consertar agora de graça.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type CadeiaDoContrato,
  type DegrauDoContrato,
  NOME_DO_DEGRAU,
  type NivelDaCadeia,
} from "./cadeia-do-contrato";

export type MinutaDaCadeia = {
  /** A capa cadastrada NESTA minuta (0156). PDF ou imagem; o montador a põe na frente. */
  capaNome: string;
  capaPath: string;
  conteudo: unknown;
  id: string;
  nome: string;
  /** O degrau que respondeu. `pedida` = alguém mandou o id na mão. */
  origem: DegrauDoContrato | "pedida";
  /** O nome humano do degrau: "Condomínio", "Vale do Ouro VOL". Nunca um id. */
  rotulo: string;
  versao: null | number;
};

export type EscolhaDaMinuta =
  | { erro: string; ok: false }
  | { minuta: MinutaDaCadeia; ok: true }
  /** Nenhum degrau respondeu. Quem chama monta a frase do 409 dizendo onde procurou. */
  | { minuta: null; ok: true };

type LinhaDaMinuta = {
  capa_nome: null | string;
  capa_path: null | string;
  conteudo: unknown;
  enterprise_id: null | string;
  id: string;
  nome: null | string;
  situacao: null | string;
  tipo: null | string;
  versao: null | number;
};

const COLUNAS = "capa_nome, capa_path, conteudo, enterprise_id, id, nome, situacao, tipo, versao";

/**
 * A minuta que vale para esta venda, percorrendo a cadeia.
 *
 * ⚠️ AS CONSULTAS SÃO NO MÁXIMO DUAS, e na venda comum é UMA. A da categoria só roda quando a
 * unidade tem categoria com `minuta_id`; a dos produtos pede os ids da divisão, do empreendimento e
 * do pai de uma vez (`.in`) e escolhe entre eles aqui, em memória, pela ordem da cadeia. Ir degrau
 * a degrau no banco faria três viagens para achar o que uma acha.
 */
export async function escolherMinutaDaCadeia(
  sb: SupabaseClient,
  cadeia: CadeiaDoContrato,
): Promise<EscolhaDaMinuta> {
  // ⚠️ A FAMÍLIA DA VENDA, MONTADA ANTES DE QUALQUER LEITURA. São os degraus de PRODUTO desta
  // cadeia — a divisão do lote, o empreendimento da proposta e o pai —, os mesmos ids que o degrau
  // 2 usa no `.in()`. É a régua de família desta função, e ela vale para os dois caminhos.
  const familia = new Map<string, NivelDaCadeia>();
  for (const nivel of cadeia.niveis) {
    if (nivel.degrau === "unidade" || nivel.degrau === "categoria") continue;
    if (!familia.has(nivel.id)) familia.set(nivel.id, nivel);
  }

  // ── 1. A CATEGORIA (e as mães dela) ──
  for (const nivel of cadeia.niveis) {
    if (nivel.degrau !== "categoria" || !nivel.minutaId) continue;

    const { data, error } = await sb
      .from("temis_minutas")
      .select(COLUNAS)
      .eq("id", nivel.minutaId)
      .maybeSingle();

    if (error) {
      console.error("[temis][minuta] falha ao ler a minuta da categoria", error);
      return {
        erro: `Não consegui ler a minuta cadastrada na categoria "${nivel.rotulo}". Tente de novo em instantes.`,
        ok: false,
      };
    }

    const linha = data as LinhaDaMinuta | null;
    if (!linha) {
      return {
        erro: `A categoria "${nivel.rotulo}" aponta para uma minuta que não existe mais. Escolha outra minuta na categoria, ou limpe o campo para ela voltar a herdar o modelo do empreendimento.`,
        ok: false,
      };
    }
    if (linha.situacao !== "publicada" || linha.tipo !== "contrato") {
      return {
        erro: `A categoria "${nivel.rotulo}" aponta para a minuta "${textoDe(linha.nome) || linha.id}", que está ${textoDe(linha.situacao) || "sem situação"} e não pode virar contrato. Publique essa minuta, escolha outra na categoria, ou limpe o campo para ela herdar o modelo do empreendimento.`,
        ok: false,
      };
    }

    // ⚠️ A MINUTA DA CATEGORIA TAMBÉM PASSA PELA RÉGUA DE FAMÍLIA, e até 21/09/2026 ela era a única
    // peça da cadeia sem ela. O caminho irmão — `minutaPedida`, com `empreendimentosQueServem` —
    // ganhou a trava em 16/09/2026 porque *"bastava trocar o minutaId para imprimir o contrato de
    // um loteamento com o modelo de outro"*; aqui o `minuta_id` da categoria fazia exatamente isso,
    // e a categoria vence TODOS os outros degraus, então o erro não teria segundo dono.
    //
    // Hoje não morde: as 6 categorias estão com `minuta_id` nulo (medido em 21/09/2026). Morde no
    // dia em que a tela de vínculo categoria → minuta existir, e ela nasce nesta mesma onda
    // (`categorias-tab.tsx`).
    const daMinuta = textoDe(linha.enterprise_id);
    if (!familia.has(daMinuta)) {
      const daVenda = [...familia.values()].map((n) => n.rotulo);
      return {
        erro:
          `A categoria "${nivel.rotulo}" aponta para a minuta "${textoDe(linha.nome) || linha.id}", que é de outro empreendimento. ` +
          (daVenda.length > 0
            ? `Esta venda é de ${daVenda.join(", ")}. `
            : "") +
          "Escolha na categoria uma minuta publicada deste empreendimento, ou limpe o campo para ela herdar o modelo de cima.",
        ok: false,
      };
    }

    return { minuta: paraFora(linha, nivel), ok: true };
  }

  // ── 2. OS PRODUTOS: divisão da unidade → empreendimento da proposta → pai ──
  const porProduto = familia;
  if (porProduto.size === 0) return { minuta: null, ok: true };

  const { data, error } = await sb
    .from("temis_minutas")
    .select(COLUNAS)
    .in("enterprise_id", [...porProduto.keys()])
    .eq("situacao", "publicada")
    .eq("tipo", "contrato");

  if (error) {
    console.error("[temis][minuta] falha ao ler as minutas da cadeia", error);
    return {
      erro: "Não consegui ler as minutas publicadas deste empreendimento. Tente de novo em instantes.",
      ok: false,
    };
  }

  const publicadas = (data ?? []) as LinhaDaMinuta[];

  // A ORDEM DA CADEIA MANDA: percorre os níveis, e não as linhas do banco.
  for (const nivel of porProduto.values()) {
    const doNivel = publicadas.filter((m) => textoDe(m.enterprise_id) === nivel.id);
    if (doNivel.length === 0) continue;

    if (doNivel.length > 1) {
      const nomes = doNivel
        .map((m) => `"${textoDe(m.nome) || m.id}"`)
        .sort()
        .join(" e ");
      return {
        erro: `${maiuscula(NOME_DO_DEGRAU[nivel.degrau])} ${nivel.rotulo} tem ${doNivel.length} minutas publicadas ao mesmo tempo (${nomes}) e eu não escolho por sorteio. Arquive a que não vale, ou ligue a certa à categoria do lote.`,
        ok: false,
      };
    }

    const linha = doNivel[0];
    if (linha) return { minuta: paraFora(linha, nivel), ok: true };
  }

  return { minuta: null, ok: true };
}

/**
 * A frase que a tela mostra: "modelo herdado do Vale do Ouro".
 *
 * ⚠️ A ORIGEM É UM ENUM E O RÓTULO É O NOME QUE O OPERADOR CONHECE, nunca um id — a mesma regra de
 * `NivelDeOrdem.rotulo`. E a frase é montada no SERVIDOR: deixar a tela recalcular a cadeia é como
 * a tela e o motor passam a discordar sobre o mesmo contrato.
 */
export function fraseDaOrigem(minuta: {
  origem: DegrauDoContrato | "pedida";
  rotulo: string;
}): string {
  if (minuta.origem === "pedida") return "modelo escolhido à mão para esta venda";
  if (minuta.origem === "categoria") return `modelo da categoria ${minuta.rotulo}`;
  if (minuta.origem === "divisao") return `modelo da divisão ${minuta.rotulo}`;
  if (minuta.origem === "pai") return `modelo herdado do ${minuta.rotulo}`;
  if (minuta.origem === "unidade") return `modelo desta unidade`;
  return `modelo do empreendimento ${minuta.rotulo}`;
}

/**
 * Herdou de um degrau acima do mais específico que existia?
 *
 * ⚠️ É O QUE DECIDE SE A TELA DESTACA. No caso normal — a venda cujo lote está no mesmo produto da
 * proposta e sem categoria — a linha fica discreta: quem emite não precisa ler nada. Quando o
 * modelo veio de cima, ela fica em evidência, porque é aí que a herança pode estar errada.
 */
export function minutaFoiHerdada(
  cadeia: CadeiaDoContrato,
  minuta: { origem: DegrauDoContrato | "pedida" },
): boolean {
  if (minuta.origem === "pedida") return false;
  const primeiro = cadeia.niveis.find((n) => n.degrau !== "unidade");
  if (!primeiro) return false;
  return primeiro.degrau !== minuta.origem;
}

function paraFora(linha: LinhaDaMinuta, nivel: NivelDaCadeia): MinutaDaCadeia {
  return {
    capaNome: textoDe(linha.capa_nome),
    capaPath: textoDe(linha.capa_path),
    conteudo: linha.conteudo,
    id: linha.id,
    nome: textoDe(linha.nome),
    origem: nivel.degrau,
    rotulo: nivel.rotulo,
    versao: typeof linha.versao === "number" ? linha.versao : null,
  };
}

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}

function maiuscula(frase: string): string {
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/**
 * A frase que a tela de trabalho mostra depois de gerar: de qual modelo o papel saiu e o que foi
 * junto.
 *
 * ⚠️ ELA É MONTADA A PARTIR DO QUE O SERVIDOR RESPONDEU, e não recalculada na tela. É a mesma
 * disciplina de `ordem-da-categoria.ts`: se a tela refizesse a travessia, ela e o motor passariam a
 * discordar sobre o mesmo contrato, e a discordância não apareceria no dia em que fosse escrita.
 *
 * ⚠️ E A HERANÇA APARECE POR EXTENSO. Quando o modelo veio do degrau mais específico que a venda
 * tinha, a frase é discreta; quando veio de cima, ela DIZ que foi herdado, porque é aí que a
 * herança pode estar errada e é aí que quem emite tem de olhar.
 */
export function recadoDaGeracao(
  data:
    | undefined
    | {
        anexos?: { nome: string }[];
        minuta?: { herdada?: boolean; nome?: string; origemFrase?: string; versao?: null | number };
      },
): string {
  const minuta = data?.minuta;
  if (!minuta?.nome) return "Contrato gerado.";

  const versao = typeof minuta.versao === "number" ? ` v${minuta.versao}` : "";
  const origem = minuta.origemFrase ? ` (${minuta.origemFrase})` : "";
  const herdou = minuta.herdada ? ", herdado de um nível acima" : "";

  // ⚠️ "SEM ANEXOS" SOZINHO NÃO AJUDA NINGUÉM. Lucas, 22/09/2026: *"não estamos conseguindo colocar
  // os anexos"*, com o print desta frase. Ela estava CERTA — medido no dia, `temis_anexos` tinha
  // zero linhas no sistema inteiro —, mas era a única pista que o operador recebia, e não dizia
  // onde resolver. O lugar é o bloco "Anexos do contrato", na aba Minutas do empreendimento (ver
  // `minutas-tab.tsx`), o mesmo card que recebe a capa.
  const anexos = data?.anexos ?? [];
  const peças =
    anexos.length === 0
      ? " Sem anexos: eles se cadastram no empreendimento, na aba Minutas, no bloco Anexos do contrato."
      : ` Foram junto: ${anexos.map((a) => a.nome).join(", ")}.`;

  return `Contrato gerado com ${minuta.nome}${versao}${origem}${herdou}.${peças}`;
}
