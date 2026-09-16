// OS VÍNCULOS QUE O SETUP GRAVA, CONFERIDOS CONTRA O QUE MUDOU NO BANCO ENQUANTO O FORMULÁRIO ESTAVA ABERTO.
//
// ⚠️ POR QUE ISTO EXISTE (revisão de 16/09/2026). A tela de portais do Setup manda a lista INTEIRA de
// vínculos, e o servidor apaga o que está gravado e não veio na lista. Isso bastava enquanto só o
// Setup escrevia vínculo. Agora o portal também escreve: o produto cadastrado pela Cecílio entra
// sozinho no vínculo do portal (e no da conta que cadastrou). Um admin que abriu o formulário para
// trocar a logo e salvou depois apagava, calado, o vínculo do "Ed. Rubi" criado nesse meio tempo, e o
// produto sumia do portal de quem o cadastrou.
//
// A regra é a de um merge de três pontas: o que a pessoa DESMARCOU sai; o que apareceu no banco
// depois de o formulário abrir (e ela nunca viu) fica. Função pura, sem React e sem rede, para a tela
// e o teste usarem a mesma.

/**
 * A lista de vínculos do portal a gravar.
 *
 * @param gravadosAgora O que o banco tem AGORA (relido antes de salvar).
 * @param iniciais      Os ids que o formulário mostrou ao abrir.
 * @param pedidos       O que o formulário tem marcado agora.
 * @returns `pedidos`, mais o que foi gravado depois da abertura e não está entre eles. O vínculo novo
 *          vai com a carteira que já tinha no banco.
 */
export function vinculosParaSalvar<T extends { enterpriseId: string }>(entrada: {
  gravadosAgora: readonly T[];
  iniciais: readonly string[];
  pedidos: readonly T[];
}): T[] {
  const vistos = new Set(entrada.iniciais.map(limpo));
  const pedidos = new Set(entrada.pedidos.map((p) => limpo(p.enterpriseId)));
  const novosNoBanco = entrada.gravadosAgora.filter((g) => {
    const id = limpo(g.enterpriseId);
    return id !== "" && !vistos.has(id) && !pedidos.has(id);
  });
  return [...entrada.pedidos, ...novosNoBanco];
}

/** A mesma regra para o recorte próprio da conta, que é uma lista de ids. */
export function idsParaSalvar(entrada: {
  gravadosAgora: readonly string[];
  iniciais: readonly string[];
  pedidos: readonly string[];
}): string[] {
  return vinculosParaSalvar({
    gravadosAgora: entrada.gravadosAgora.map((enterpriseId) => ({ enterpriseId })),
    iniciais: entrada.iniciais,
    pedidos: entrada.pedidos.map((enterpriseId) => ({ enterpriseId })),
  }).map((v) => v.enterpriseId);
}

function limpo(id: unknown): string {
  return String(id ?? "").trim();
}

// ── O CORPO DAS ROTAS DO SETUP ──────────────────────────────────────────────────────────────────
//
// ⚠️ A TELA JÁ MANDAVA OS INICIAIS E AS ROTAS JOGAVAM FORA (pendência da onda 2, 16/09/2026). O
// servidor (`salvarIncorporador`, `salvarUsuarioIncorporador`) sabia apagar só o que a pessoa viu e
// desmarcou, mas sem os iniciais caía na regra antiga e o vínculo gravado depois da abertura do
// formulário continuava sumindo. As duas rotas leem o corpo por aqui, e o teste confere o que chega
// ao servidor.

/**
 * Uma lista de ids vinda do corpo: texto sem espaço nas pontas, sem vazio. Só texto e número contam
 * (um objeto viraria "[object Object]" e iria parar no banco como id).
 *
 * @returns `undefined` quando o campo não é lista: para quem salva, ausente é "não mexer", e lista
 *          vazia é "tirar tudo". As duas coisas não podem virar a mesma.
 */
export function idsDoCorpo(valor: unknown): string[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  return valor
    .filter((item): item is number | string => typeof item === "string" || typeof item === "number")
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function campoDoCorpo(corpo: unknown, campo: string): unknown {
  return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>)[campo] : undefined;
}

/** Os vínculos do PORTAL como POST /api/apolo/incorporadores repassa a `salvarIncorporador`. */
export function vinculosDoPortalNoCorpo(corpo: unknown): {
  empreendimentos: { carteiraAdministrada: boolean; enterpriseId: string }[];
  vinculosIniciais: string[] | undefined;
} {
  const pedidos = campoDoCorpo(corpo, "empreendimentos");
  const empreendimentos = (Array.isArray(pedidos) ? pedidos : [])
    .map((pedido: unknown) => ({
      carteiraAdministrada: Boolean(campoDoCorpo(pedido, "carteiraAdministrada")),
      enterpriseId: idsDoCorpo([campoDoCorpo(pedido, "enterpriseId")])?.[0] ?? "",
    }))
    .filter((pedido) => pedido.enterpriseId !== "");

  return { empreendimentos, vinculosIniciais: idsDoCorpo(campoDoCorpo(corpo, "vinculosIniciais")) };
}

/** O recorte próprio da CONTA como POST /api/apolo/incorporadores/usuarios repassa a `salvarUsuarioIncorporador`. */
export function recorteDaContaNoCorpo(corpo: unknown): {
  empreendimentos: string[] | undefined;
  empreendimentosIniciais: string[] | undefined;
} {
  return {
    empreendimentos: idsDoCorpo(campoDoCorpo(corpo, "empreendimentos")),
    empreendimentosIniciais: idsDoCorpo(campoDoCorpo(corpo, "empreendimentosIniciais")),
  };
}
