/**
 * O COMPRADOR DA CECÍLIO ROCHA NO APOLO.
 *
 * Lucas (02/10/2026): *"vamos criar dentro do apolo um perfil comprador cecilio e vamos cria-los com os
 * dados que temos. segue a mesma estrutura, só que não vamos ter todos os dados. O principal objetivo
 * é o time conseguir fazer contato para realizar cobrança."*
 *
 * ⚠️ É UM PAPEL GRAVADO, E NÃO O "COMPRADOR" CALCULADO. O "Comprador" do Apolo é derivado da carteira
 * do C2X (`buyerStatusLabel` exige o papel 'usuario' e `entity.isBuyer`), e a Cecílio não tem NENHUM
 * vínculo com o C2X (Lucas, 29/09/2026: *"esquece o c2x, cecilio não tem nenhum vinculo com o legado
 * c2x"*). Reaproveitar 'usuario' faria o cliente aparecer como Prospect e, se forçado a Comprador,
 * ganhar o selo verde "Adimplente" de quem está devendo, porque o financeiro do C2X chega zerado.
 *
 * ⚠️ SEM DADO FINANCEIRO, DE PROPÓSITO. A situação de cada boleto mora no Asaas e é lida ao vivo pela
 * aba Boletos do portal. Por isso a Iris não mostra selo de adimplência para este papel e a CACÁ não
 * consulta nada financeiro: passa direto para um atendente (`ehCompradorCecilio`).
 */

export const PERFIL_COMPRADOR_CECILIO = "comprador_cecilio" as const;

export const ROTULO_COMPRADOR_CECILIO = "Comprador Cecílio";

/**
 * A ficha tem o papel de comprador da Cecílio? Aceita o id do papel (`comprador_cecilio`) e o rótulo
 * ("Comprador Cecílio", com ou sem acento), porque a Iris recebe os dois formatos conforme a rota.
 */
export function ehCompradorCecilio(perfis: readonly (string | null | undefined)[] | null | undefined) {
  return (perfis ?? []).some((perfil) => {
    const chave = normalizarChave(perfil);
    return chave === PERFIL_COMPRADOR_CECILIO || chave === "comprador cecilio";
  });
}

/**
 * Por que a CACÁ não atende sozinha este cliente. Vai para o motivo do handoff, que o time lê.
 */
export const MOTIVO_HANDOFF_COMPRADOR_CECILIO =
  "Cliente da carteira Cecílio Rocha: a cobrança é feita por um analista. A Cacá não consulta financeiro deste cadastro.";

/**
 * O que o cliente lê. ⚠️ NÃO CITA DÍVIDA, PARCELA NEM CARTEIRA: quem escreve pode não ser o titular
 * (telefone de cônjuge, de sócio), e a frase tem de servir para qualquer pessoa.
 */
export const RESPOSTA_HANDOFF_COMPRADOR_CECILIO =
  "Localizei o seu cadastro. Para esse atendimento, quem dá continuidade é um analista da Careli. Já estou encaminhando a sua conversa.";

export type UnidadeDaCarteiraCecilio = {
  carteira: string;
  unidade: string | null;
};

/**
 * As unidades da Cecílio gravadas na ficha (`metadata.cecilio.unidades`), pela carga
 * `scripts/apolo/importar-compradores-cecilio.mjs`. Uma pessoa pode ter várias, em carteiras diferentes.
 *
 * ⚠️ NÃO VÃO EM `apolo_commercial_links`: aquela tabela é a carteira do C2X, e a CACÁ e o Apolo leem
 * as linhas dela como venda do legado (unidade com papel de usuário = comprador com carteira).
 */
export function unidadesDaCarteiraCecilio(metadata: unknown): UnidadeDaCarteiraCecilio[] {
  const cecilio = objeto(objeto(metadata)?.cecilio);
  const brutas = Array.isArray(cecilio?.unidades) ? cecilio.unidades : [];
  const vistas = new Set<string>();
  const unidades: UnidadeDaCarteiraCecilio[] = [];

  for (const bruta of brutas) {
    const item = objeto(bruta);
    const carteira = texto(item?.carteira);
    if (!carteira) continue;
    const unidade = texto(item?.unidade);
    const chave = `${carteira}::${unidade ?? ""}`;
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    unidades.push({ carteira, unidade });
  }

  return unidades;
}

/** "Garden · 404 BL 03" — o rótulo de uma unidade na ficha. */
export function rotuloDaUnidadeCecilio(unidade: UnidadeDaCarteiraCecilio) {
  return unidade.unidade ? `${unidade.carteira} · ${unidade.unidade}` : unidade.carteira;
}

function normalizarChave(valor: string | null | undefined) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function objeto(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}
