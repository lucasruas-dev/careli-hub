// O MENOR RECORTE CONFIGURADO GANHA — a régua de categoria → filho → pai, num lugar só.
//
// Lucas (15/09/2026): *"eu posso ter planos por categoria, por filho, e somente por pai. tem que
// seguir essa hierarquia, se eu cadastrar os planos somente no pai, prevalece em todas categorias
// (se tiver) em todos os filhos. se precisar cadastrar um plano e vincular a categoria, quando eu
// seleciono a unidade daquela categoria o plano e as faixas tem que respeitar e assim é para o
// filho."*
//
// E, em 08/09/2026, a mesma regra dita de outro jeito: *"prevalece a categoria caso o mesmo esteja
// configurado, se não do empreendimento (categoria, filho) essas três quebras, sempre o menor vai
// ter preferência"*.
//
// ⚠️ ISTO EXISTE PORQUE A CASA JÁ TEM SEIS IMPLEMENTAÇÕES DIFERENTES DA MESMA IDEIA, e elas
// discordam entre si: minuta (0140), vendedora (0141), ordem de assinatura (0142), comissão (0145)
// e entrada mínima (0128) — todas pulando o degrau do FILHO — mais a tela de categorias, onde o
// PAI chega a vencer o filho, invertendo a regra. Uma sétima cópia faria a mesma tela obedecer a
// duas leis conforme o campo, que é pior do que obedecer a lei errada.
//
// ⚠️ "CONFIGURADO" É A PALAVRA EXATA, e a diferença entre nulo e vazio é o coração desta régua.
// Nível sem NADA cadastrado não decide: ele passa a vez para o de cima. Só quando um nível tem ao
// menos um item ele fecha a questão — e aí os de cima não entram, nem para completar. Meio-termo
// (juntar o que o filho tem com o que o pai tem) é o que transforma "o menor ganha" em "todo mundo
// ganha um pouco", e foi assim que o Vale do Ouro passou a mostrar SEIS planos onde existem três.
//
// ⚠️ E A CATEGORIA ATRAVESSA OS FILHOS — não é uma boneca russa. Medido em 15/09/2026: a categoria
// "Condomínio", cadastrada no PAI (Lagoa Bonita, 31), cobre 400 lotes do próprio pai, 186 do LBR,
// 125 do LBP e 39 do LBF. Ou seja, um lote é do filho LBF **e** da categoria Condomínio ao mesmo
// tempo, e os dois recortes podem ter plano. Quem ganha é a categoria, porque é o recorte MENOR —
// é o que o Lucas descreveu ao dizer que, ao escolher a unidade daquela categoria, o plano dela tem
// de ser respeitado.

/** De onde veio o que está valendo. Vai para a tela e para o registro da venda. */
export type OrigemDoRecorte = "categoria" | "filho" | "pai";

/** O mínimo que um item precisa dizer para esta régua o colocar num degrau. */
export type ItemComDono = {
  /** Nulo = não é de categoria nenhuma. */
  categoriaId?: null | string;
  /**
   * O `enterprise_id` (id do C2X, como texto) de quem cadastrou o item.
   *
   * ⚠️ `undefined` É ACEITO E SIGNIFICA O MESMO QUE NULO: item sem dono declarado não casa com
   * degrau nenhum. Os tipos que atravessam a rede (`PlanoDaVenda`, `PlanoComercial`) declaram o
   * campo como opcional, e exigir `null` explícito aqui obrigaria cada chamador a normalizar —
   * trabalho que a régua faz melhor, num lugar só.
   */
  enterpriseId?: null | string;
};

/** O lote para o qual se está perguntando. */
export type RecorteDaUnidade = {
  /** A categoria da unidade, quando ela tem. */
  categoriaId: null | string;
  /** O `enterprise_id` da unidade — o FILHO, nos produtos divididos. */
  enterpriseId: null | string;
  /** O `enterprise_id` do PAI, quando o empreendimento da unidade tem pai. */
  paiEnterpriseId: null | string;
};

export type Escolha<T> = {
  /** Vazio quando nenhum degrau tem item — e isso NÃO é erro: é cadastro por fazer. */
  itens: T[];
  /** Nulo quando `itens` está vazio. */
  origem: null | OrigemDoRecorte;
};

const mesmo = (a: null | string | undefined, b: null | string | undefined): boolean => {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  return x !== "" && x === y;
};

/**
 * Os itens que valem para esta unidade, e de qual degrau vieram.
 *
 * Serve plano, faixa de prazo e qualquer outra coisa que se cadastre nos três níveis. O tipo `T` só
 * precisa dizer quem é o dono (`ItemComDono`).
 *
 * ⚠️ O ITEM DE CATEGORIA SÓ ENTRA NO DEGRAU DE CATEGORIA. Um plano com `categoriaId` preenchido não
 * é "plano do empreendimento que por acaso tem categoria": é plano DAQUELA categoria, e para um lote
 * de outra categoria ele não existe. Sem esta separação, o primeiro plano de categoria cadastrado
 * vaza para todos os lotes do produto — que é exatamente o que a Mesa de Venda faria hoje, porque
 * `lerPlanosDoPanteon` nem traz a coluna.
 *
 * ⚠️ E A UNIDADE SEM CATEGORIA PULA O PRIMEIRO DEGRAU, em vez de cair em lista vazia. São 4.634 das
 * 5.541 unidades hoje.
 */
export function itensDoMenorRecorte<T extends ItemComDono>(
  unidade: RecorteDaUnidade,
  itens: readonly T[],
): Escolha<T> {
  const semCategoria = itens.filter((i) => !String(i.categoriaId ?? "").trim());

  if (String(unidade.categoriaId ?? "").trim()) {
    const daCategoria = itens.filter((i) => mesmo(i.categoriaId, unidade.categoriaId));
    if (daCategoria.length > 0) return { itens: daCategoria, origem: "categoria" };
  }

  const doFilho = semCategoria.filter((i) => mesmo(i.enterpriseId, unidade.enterpriseId));
  if (doFilho.length > 0) return { itens: doFilho, origem: "filho" };

  // ⚠️ O PAI SÓ ENTRA QUANDO É OUTRO EMPREENDIMENTO. Num produto sem divisão, a unidade e o "pai"
  // são o mesmo `enterprise_id`, e o degrau de cima repetiria o do meio — devolvendo origem "pai"
  // para um plano que é do próprio produto, e escrevendo isso no registro da venda.
  if (unidade.paiEnterpriseId && !mesmo(unidade.paiEnterpriseId, unidade.enterpriseId)) {
    const doPai = semCategoria.filter((i) => mesmo(i.enterpriseId, unidade.paiEnterpriseId));
    if (doPai.length > 0) return { itens: doPai, origem: "pai" };
  }

  return { itens: [], origem: null };
}

/**
 * A frase que a tela mostra para explicar de onde veio o que está valendo.
 *
 * ⚠️ MOSTRAR A HERANÇA É PARTE DA REGRA, e não enfeite. Campo vazio numa tela de herança faz o
 * operador achar que não há nada cadastrado e criar uma cópia "por segurança" — e aí a herança morre
 * calada: mudar o pai deixa de alcançar quem copiou.
 */
export function comoSeHerdou(origem: null | OrigemDoRecorte): string {
  if (origem === "categoria") return "da categoria desta unidade";
  if (origem === "filho") return "do empreendimento desta unidade";
  if (origem === "pai") return "herdado do empreendimento principal";
  return "nada cadastrado";
}
