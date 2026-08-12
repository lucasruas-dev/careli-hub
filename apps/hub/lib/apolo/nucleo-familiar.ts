// NÚCLEO FAMILIAR: casal é UM cadastro por empreendimento.
//
// Regra do Lucas (12/08/2026), depois do caso Alcimar e Sirlei: o casal pode comprar quantas
// unidades quiser, o que não pode é ter cadastros distintos entre eles no mesmo empreendimento.
// O Rômulo subiu a CAD do Alcimar em 20/07 com o CPF da esposa preenchido no campo de cônjuge;
// em 05/08 o Caio subiu a CAD da Sirlei pelo portal público e o sistema aceitou. O dado para
// barrar estava no banco havia 16 dias, em `apolo_esteira.ficha->>'conjugeCpf'`, mas nenhuma
// regra lia esse campo.
//
// O NÚCLEO de uma CAD é o par {CPF do titular, CPF do cônjuge}. Duas CADs do MESMO empreendimento
// pertencem ao mesmo núcleo quando os pares se cruzam em qualquer CPF. Isso cobre os quatro
// sentidos de uma vez, inclusive o caso em que o cônjuge entrou PRIMEIRO, que aconteceu em quatro
// dos dez pares encontrados na base.
//
// POR QUE A FICHA DA ESTEIRA, E NÃO `apolo_relationships`. O cônjuge também é gravado como
// relacionamento, mas só 16 das 114 linhas têm o CPF, e `related_entity_id` é `null` em todas
// (nasce fixo assim em cadastro-persist.ts). Já a ficha da CAD tem 94 com `conjugeCpf` completo,
// e vive junto do `enterprise_id`, que é o recorte que interessa. A esteira é a fonte melhor e
// mais direta; o relacionamento entra como reforço.
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type ConflitoNucleo = {
  /** CPF que apareceu nos dois lados (só os 3 primeiros dígitos, para não expor documento). */
  cpfParcial: string;
  /** Como o CPF colidiu: o titular novo já é cônjuge de alguém, o cônjuge novo já tem CAD, etc. */
  motivo:
    | "conjuge-informado-ja-tem-cad"
    | "conjuge-informado-ja-e-conjuge"
    | "titular-ja-e-conjuge-de-quem-tem-cad";
  /** Nome de quem já tem a CAD, para o operador reconhecer o caso. */
  nomeExistente: null | string;
  empreendimento: null | string;
};

const digitos = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

/** CPF válido de verdade (dígito verificador). CPF em branco ou lixo casaria com todo mundo. */
export function cpfValidoParaNucleo(valor: unknown): boolean {
  const d = digitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t += 1) {
    let soma = 0;
    for (let i = 0; i < t; i += 1) soma += Number(d[i]) * (t + 1 - i);
    if (((soma * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}

const parcial = (cpf: string) => `${cpf.slice(0, 3)}.***.***-**`;

/**
 * Procura, no empreendimento alvo, uma CAD que pertença ao MESMO núcleo familiar.
 *
 * Devolve `null` quando não há conflito. Nunca lança: em falha de leitura devolve `null` e deixa
 * a decisão para a trava por documento, que é fail-closed. Barrar venda boa por causa de um blip
 * de rede seria pior que o furo que esta função fecha.
 */
export async function conflitoDeNucleoFamiliar(params: {
  adminClient: AdminClient;
  /** Empreendimento da CAD que está entrando. Sem ele não há o que comparar. */
  enterpriseId: null | number | string;
  /** CPF do cônjuge informado na CAD nova (pode vir vazio). */
  cpfConjuge?: null | string;
  /** CPF do titular da CAD nova. */
  cpfTitular: string;
  /** Fichas do titular que já são conhecidas, para não acusar a própria CAD dele. */
  ignorarEntityIds?: string[];
}): Promise<ConflitoNucleo | null> {
  const alvo = normalizarEnterpriseId(params.enterpriseId);
  if (!alvo) return null;

  const titular = digitos(params.cpfTitular);
  const conjuge = digitos(params.cpfConjuge);
  const ignorar = new Set(params.ignorarEntityIds ?? []);

  // Só CPF válido entra na comparação, dos dois lados.
  const titularOk = cpfValidoParaNucleo(titular);
  const conjugeOk = cpfValidoParaNucleo(conjuge);
  if (!titularOk && !conjugeOk) return null;

  // Uma leitura só: todas as CADs do empreendimento com a ficha, e daí comparamos em memória.
  // São centenas de linhas por empreendimento, não milhares, e evita três idas ao banco.
  const { data, error } = await params.adminClient
    .from("apolo_esteira")
    .select("entity_id, empreendimento, ficha")
    .eq("enterprise_id", String(alvo));

  if (error || !data) return null;

  const nomeDe = async (entityId: string): Promise<null | string> => {
    const { data: ficha } = await params.adminClient
      .from("apolo_entities")
      .select("display_name, legal_name")
      .eq("id", entityId)
      .maybeSingle<{ display_name: null | string; legal_name: null | string }>();
    return ficha?.legal_name ?? ficha?.display_name ?? null;
  };

  for (const linha of data as {
    empreendimento: null | string;
    entity_id: string;
    ficha: null | Record<string, unknown>;
  }[]) {
    if (ignorar.has(linha.entity_id)) continue;
    const conjugeDaCad = digitos(linha.ficha?.conjugeCpf);
    if (!cpfValidoParaNucleo(conjugeDaCad)) continue;

    // (a) o cônjuge que estou informando agora JÁ É cônjuge de outra CAD: mesmo casal, dois
    //     cadastros. Foi o caso Alcimar e Sirlei visto pelo outro lado.
    if (conjugeOk && conjugeDaCad === conjuge) {
      return {
        cpfParcial: parcial(conjuge),
        empreendimento: linha.empreendimento,
        motivo: "conjuge-informado-ja-e-conjuge",
        nomeExistente: await nomeDe(linha.entity_id),
      };
    }

    // (b) EU sou o cônjuge declarado numa CAD que já existe. É exatamente o caso da Sirlei: o CPF
    //     dela estava na ficha do Alcimar desde 20/07.
    if (titularOk && conjugeDaCad === titular) {
      return {
        cpfParcial: parcial(titular),
        empreendimento: linha.empreendimento,
        motivo: "titular-ja-e-conjuge-de-quem-tem-cad",
        nomeExistente: await nomeDe(linha.entity_id),
      };
    }
  }

  // (c) o cônjuge que estou informando já tem CAD PRÓPRIA neste empreendimento (ele é titular
  //     de uma, eu estou abrindo outra). O sentido inverso do caso do Lucas.
  if (conjugeOk) {
    const donos = new Set(
      (data as { entity_id: string }[]).map((l) => l.entity_id).filter((id) => !ignorar.has(id)),
    );
    if (donos.size) {
      const { data: fichas } = await params.adminClient
        .from("apolo_entities")
        .select("id, display_name, legal_name, document_masked")
        .in("id", [...donos].slice(0, 100));

      const dono = (fichas ?? []).find(
        (f: { document_masked: null | string }) => digitos(f.document_masked) === conjuge,
      ) as undefined | { display_name: null | string; id: string; legal_name: null | string };

      if (dono) {
        const linha = (data as { empreendimento: null | string; entity_id: string }[]).find(
          (l) => l.entity_id === dono.id,
        );
        return {
          cpfParcial: parcial(conjuge),
          empreendimento: linha?.empreendimento ?? null,
          motivo: "conjuge-informado-ja-tem-cad",
          nomeExistente: dono.legal_name ?? dono.display_name ?? null,
        };
      }
    }
  }

  return null;
}

/**
 * A frase que o corretor lê. CURTA e objetiva (Lucas, 12/08), no formato que ele escreveu:
 *
 *   "O CPF do Alcimar já possui CAD para esse empreendimento."
 *   "O CPF do cônjuge do Alcimar já possui CAD para esse empreendimento."
 *
 * O que muda entre as duas é o PAPEL que aquele CPF ocupa na CAD que já existe: titular, e aí
 * vale o nome direto; ou cônjuge de alguém, e aí a frase diz de quem.
 *
 * Diz o NOME DO CLIENTE, que é o que o corretor precisa para entender o caso, mas nunca a
 * IMOBILIÁRIA que cadastrou antes: isso é carteira de concorrente.
 */
export function mensagemDeConflito(conflito: ConflitoNucleo): string {
  const onde = conflito.empreendimento?.trim();
  const quem = conflito.nomeExistente?.trim() ?? "outro cliente";
  const local = onde ? `para o empreendimento ${onde}` : "para esse empreendimento";

  // O CPF entrou como TITULAR da CAD que já existe.
  if (conflito.motivo === "conjuge-informado-ja-tem-cad") {
    return `O CPF do ${quem} já possui CAD ${local}.`;
  }
  // O CPF está lá como CÔNJUGE de quem tem a CAD.
  return `O CPF do cônjuge do ${quem} já possui CAD ${local}.`;
}
