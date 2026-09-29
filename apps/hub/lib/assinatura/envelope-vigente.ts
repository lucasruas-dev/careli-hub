// A RÉGUA DO ENVELOPE — qual segura o envio e qual VALE para a venda. Uma folha pura, sem banco.
//
// Lucas, 28/09/2026: *"informações de venda, contrato, assinatura tem que morar em um local e ele
// alimentar tudo"*. Até a F2 da fonte única a casa tinha DUAS respostas para "qual é o envelope desta
// venda": a guarda do envio (`envelopeQueSegura`, em `envio-db.ts`) e uma cópia solta no portal
// (`lib/apolo/incorporador/assinaturas.ts`, "o mais recente que não morreu"), que discordavam no
// rascunho e no contrato assinado seguido de um envio novo. Agora as duas moram aqui, e a segunda é
// construída sobre a primeira (plano, seção 4).
//
// ⚠️ SEM IMPORT DE BANCO DE PROPÓSITO: a regra é a mais cara da casa (quem erra cria o segundo
// envelope pago, ou trava uma venda que podia ser reenviada) e só se prova de verdade sobre as
// linhas. `envio-db.ts` reexporta tudo daqui, e os leitores de antes não mudam de import.

/** O que a régua precisa ler de cada linha de `temis_envelopes`. */
export type EnvelopeParaEscolher = {
  criado_em: string;
  /** Quando o provedor recebeu (Clicksign: o carimbo; D4Sign: o envio no C2X). */
  enviado_em?: null | string;
  envelope_id: null | string;
  estado: string;
  falha: null | string;
  id: string;
  provedor: string;
};

/**
 * Os estados que LIBERAM um novo envio.
 *
 * ⚠️ O REENVIO LEGÍTIMO É O CASO DE USO, e não uma exceção rara: envelope cancelado no provedor,
 * recusado por quem ia assinar, ou vencido no prazo são exatamente as três situações em que alguém
 * precisa mandar o contrato DE NOVO. Uma guarda que travasse esses três trocaria um problema caro por
 * uma venda parada.
 *
 * ⚠️ `assinado` NÃO ESTÁ AQUI, e é o que mais importa: um segundo envelope de um contrato já assinado
 * produziria dois contratos assinados da mesma venda.
 */
export const ESTADOS_QUE_LIBERAM_REENVIO: ReadonlySet<string> = new Set<string>([
  "cancelado",
  "expirado",
  "recusado",
]);

/**
 * ESTA linha segura um novo envio?
 *
 * ⚠️ A LINHA SEM `envelope_id` E SEM `falha` TAMBÉM SEGURA: é o envio que começou e ninguém sabe
 * como terminou (e, nos 40 a 90 s de um envio normal, o próprio envio em curso). `falha` sem
 * `envelope_id` libera: nada ficou pendente no provedor.
 *
 * ⚠️ ELA É A RÉGUA DE `envelopeQueSegura` E DE `envelopeVigente`, SOLTA PARA QUEM PRECISA DA LISTA E
 * NÃO DA PRIMEIRA (o termo de acordo do Hades compara duas linhas vivas). Um segundo `find` escrito
 * lá faria a casa ter duas definições de "envelope vivo", e a que discordasse seria a que deixa
 * passar.
 */
export function seguraOEnvio(linha: Pick<EnvelopeParaEscolher, "envelope_id" | "estado" | "falha">): boolean {
  return (
    !ESTADOS_QUE_LIBERAM_REENVIO.has(linha.estado)
    && (linha.envelope_id !== null || linha.falha === null)
  );
}

/**
 * Qual destas linhas segura o envio? `null` = nenhuma, pode mandar.
 *
 * ⚠️ A ORDEM VEM DE QUEM CHAMA. A consulta pede `criado_em desc`, então a linha devolvida é a mais
 * recente que segura: é o id que a frase da recusa manda conferir no provedor, e mandar alguém
 * procurar o envelope mais VELHO seria mandar procurar o errado.
 *
 * ⚠️ GENÉRICA PARA NÃO PODAR A LINHA DE QUEM CHAMA: quem vai cancelar lê `provedor_documento_id` a
 * mais, e o retorno fixo apagaria o campo na saída daqui.
 */
export function envelopeQueSegura<L extends EnvelopeParaEscolher>(linhas: L[]): L | null {
  return linhas.find(seguraOEnvio) ?? null;
}

/** O que a régua responde sobre os envelopes de CONTRATO de uma venda. */
export type VigenciaDoContrato<L> = {
  /**
   * Dois ou mais envelopes que seguram o envio e já saíram (assinado + outro vivo, ou dois vivos),
   * de qualquer provedor. É o aviso "dois contratos em assinatura para a mesma venda": só nas telas
   * internas e no relatório do espelho, nunca no portal.
   */
  doisContratosVivos: boolean;
  /** Existe linha que segura e ainda não saiu (sem `envelope_id` e sem `enviado_em`). */
  envioEmCurso: boolean;
  /** O envelope que vale para a venda. `null` = nenhum enviado vivo nem assinado. */
  vigente: L | null;
  /** As linhas que seguram e já saíram, da mais recente para a mais antiga. */
  vivos: L[];
};

/** A linha já saiu para o provedor? (`envelope_id` ou `enviado_em`.) */
function jaSaiu(linha: EnvelopeParaEscolher): boolean {
  return linha.envelope_id !== null || Boolean(String(linha.enviado_em ?? "").trim());
}

/**
 * Do mais novo para o mais velho, COMO DATA.
 *
 * ⚠️ NUNCA COMO TEXTO: o PostgREST devolve `+00:00` e as linhas do espelho da D4Sign nascem com
 * `-03:00` (o `criado_em` delas é o envio no C2X); em ordem alfabética o mesmo instante pareceria
 * mais novo ou mais velho conforme quem escreveu. Data ilegível vai para o fim.
 */
function maisNovoPrimeiro<L extends EnvelopeParaEscolher>(linhas: readonly L[]): L[] {
  const instante = (l: L) => {
    const t = Date.parse(l.criado_em);
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...linhas].sort((a, b) => instante(b) - instante(a));
}

/**
 * O ENVELOPE QUE VALE para a venda (plano, seção 4). Recebe só envelopes de CONTRATO (`finalidade =
 * 'contrato'`): a view `temis_envelopes_de_contrato` já filtra, e quem lê a tabela filtra na consulta.
 *
 *   1. ordena por `criado_em` desc;
 *   2. existe `assinado` → o vigente é o assinado mais recente;
 *   3. senão, o mais recente que segura e já saiu;
 *   4. o que segura e não saiu (o rascunho do envio em curso) não é vigente: `envioEmCurso`;
 *   5. `doisContratosVivos` = dois ou mais que seguram e já saíram, de qualquer provedor.
 *
 * ⚠️ O ASSINADO VENCE O VIVO MAIS NOVO, e é a mudança de comportamento desta régua. A cópia antiga do
 * portal ficava com o mais recente "que não morreu", e um envio novo de um contrato já assinado
 * (medido como possível: a D4Sign pelo C2X e a Clicksign pela Têmis são duas portas) apagava da tela
 * o contrato que vale juridicamente. O vivo mais novo não some: vira o aviso `doisContratosVivos`.
 *
 * ⚠️ DIFERENÇA ACEITA: o rascunho COM `envelope_id` (o envio que morreu no meio com o envelope criado
 * no provedor) conta como enviado. É o que a guarda do envio já diz dele.
 */
export function envelopeVigente<L extends EnvelopeParaEscolher>(linhas: readonly L[]): VigenciaDoContrato<L> {
  const ordenadas = maisNovoPrimeiro(linhas);
  const seguram = ordenadas.filter(seguraOEnvio);
  const vivos = seguram.filter(jaSaiu);
  const envioEmCurso = seguram.some((l) => !jaSaiu(l));
  const assinado = vivos.find((l) => l.estado === "assinado") ?? null;
  return {
    doisContratosVivos: vivos.length > 1,
    envioEmCurso,
    vigente: assinado ?? vivos[0] ?? null,
    vivos,
  };
}
