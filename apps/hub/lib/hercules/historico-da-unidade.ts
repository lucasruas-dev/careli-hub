// O HISTÓRICO DE UMA UNIDADE — tudo o que aconteceu com aquele lote, quando e por quem.
//
// Pedido do Lucas (03/09/2026), na ficha da unidade: *"aqui eu quero ter um histórico de tudo que
// foi feito naquela unidade, tudo tem que ficar registrado, trazendo o que foi feito, quando, por
// quem tudo, um histórico bem completo"*.
//
// ⚠️ A UNIDADE PASSA POR VÁRIAS PESSOAS, e é isso que faz esta tela valer. O lote 01 04 do Portal
// dos Vales teve proposta de sete clientes diferentes em quatro dias de julho/2024 antes de vender:
// a linha do tempo por PROPOSTA esconde isso, porque cada proposta olha só para si. Aqui o eixo é o
// lote, e o cliente vira coluna do evento.
//
// ⚠️ OS NOMES SÃO OS DOS ONZE ESTÁGIOS DO C2X, e não os cinco do funil. A dobra existe para o
// coordenador planejar ("Análise de crédito" e "Proposta realizada" viram os dois "Proposta"); num
// histórico ela apagaria a diferença entre o que de fato aconteceu — quem quer auditoria precisa da
// transição fiel. É a mesma decisão do feed de movimentação do Apolo.
//
// ⚠️ 3.831 DAS 12.295 LINHAS NÃO TÊM ORIGEM NEM DESTINO. São gravações do C2X sem troca de estágio
// (edição do registro, recálculo). Elas continuam no histórico como "Registro atualizado": sumir
// com elas esconderia que alguém mexeu naquela proposta naquele dia, que é metade do que uma
// auditoria procura.

import { codigoDaVenda } from "@/lib/hercules/codigo-da-venda";

/** Os onze estágios do C2X pelo nome real. */
const ESTAGIO: Record<number, string> = {
  1: "Reservado",
  2: "Análise de crédito",
  3: "Contrato gerado",
  4: "Faturado",
  5: "Em assinatura",
  6: "Finalizado",
  7: "Cancelado",
  8: "Reprovado na análise",
  9: "Proposta realizada",
  10: "Em distrato",
  11: "Distratado",
};

/**
 * Uma proposta da unidade — a importada do C2X e a que NASCEU aqui.
 *
 * ⚠️ OS CAMPOS DA NATIVA SÃO OPCIONAIS PORQUE AS 4.857 IMPORTADAS NÃO OS TÊM. `criado_em_c2x` é o
 * que separa as duas: nulo = a proposta nasceu no Panteon, e aí quem responde "quando" é
 * `criado_em` (NOT NULL na tabela desde a 0126), quem responde "por quem" é `criado_por_nome` e o
 * COD vem de `protocolo_numero`, copiado da reserva.
 */
export type PropostaDoHistorico = {
  /**
   * O cancelamento da proposta nativa — os mesmos três campos que a reserva já usa.
   *
   * ⚠️ NÃO VÊM DE `hercules_proposta_etapas`. Os movimentos do C2X moram lá, mas a proposta que
   * nasce aqui não escreve naquela tabela: sem estes campos, "Proposta cancelada" simplesmente não
   * apareceria na ficha do lote — o lote voltaria para a disponibilidade sem nada explicando por
   * quê, que é justamente a pergunta que o histórico existe para responder.
   */
  cancelada_em?: null | string;
  cancelada_motivo?: null | string;
  cancelada_por_nome?: null | string;
  cliente_nome: null | string;
  codigo: null | string;
  /** O prazo CONTRATADO. Ver `plano_parcelas`: aquele é o molde, este é a venda. */
  contrato_parcelas?: null | number;
  /** Quando a linha nasceu no Panteon. Só serve de data quando `criado_em_c2x` é nulo. */
  criado_em?: null | string;
  criado_em_c2x: null | string;
  /** Quem gerou a proposta aqui. O C2X não guarda quem abriu as dele. */
  criado_por_nome?: null | string;
  etapa: string;
  id: string;
  imobiliaria_nome: null | string;
  observacao?: null | string;
  plano_nome?: null | string;
  /** O prazo do MOLDE. Entra só quando o contrato não tem o dele. */
  plano_parcelas?: null | number;
  /** O número cru do COD. A forma sai de `codigoDaVenda`, num lugar só. */
  protocolo_numero?: null | number;
  valor: null | number | string;
};

export type MovimentoDoHistorico = {
  autor_nome: null | string;
  de_c2x: null | number;
  motivo: null | string;
  observacao: null | string;
  para_c2x: null | number;
  proposta_id: string;
  quando: string;
};

/**
 * Pagamento ou assinatura — o que aconteceu na proposta além de mudar de etapa.
 *
 * ⚠️ PARCELA NÃO ENTRA AQUI (Lucas, 03/09/2026: *"parcela não precisa"*). São 15.715 parcelas pagas
 * no legado; num lote de 156 parcelas elas cobririam os cinco eventos que importam. Ato e Sinal são
 * o que o coordenador acompanha — a mesma régua da tela de Parcelas do portal.
 */
export type EventoImportado = {
  descricao: null | string;
  documento: null | string;
  proposta_id: string;
  quando: string;
  quem: null | string;
  tipo: string;
  valor: null | number | string;
};

export type EventoDaUnidade = {
  /** Quem estava comprando naquele momento. A unidade passa por várias pessoas. */
  cliente: null | string;
  /**
   * `000123` — o COD da venda, quando o evento tem um.
   *
   * ⚠️ NULO NO QUE VEIO DO C2X, e isso é fiel: o legado não tem código, e inventar um daria número
   * novo para venda antiga a cada carga. Só o que nasceu no Panteon tem.
   */
  codigo: null | string;
  /** O que aconteceu, em uma frase. */
  fato: string;
  id: string;
  /** Nulo quando o C2X não gravou. */
  observacao: null | string;
  /** A proposta a que o evento pertence, para agrupar na tela se ela quiser. */
  propostaId: string;
  quando: string;
  /** Quem fez. */
  quem: null | string;
  /** `pagamento` e `assinatura` ganham destaque na tela; `etapa` é o corpo da linha do tempo. */
  tipo: "assinatura" | "etapa" | "pagamento";
  /** Só no pagamento. */
  valor: null | number;
};

/**
 * `077.655.646-09` → `***.655.646-**`; CNPJ → `**.***.899/0001-**`.
 *
 * ⚠️ A PRIMEIRA VERSÃO CORTAVA O CNPJ EM "doc. 1-87", que não identifica nada e ainda parecia
 * defeito. Documento de empresa tem 14 dígitos e merece a própria máscara: some com a raiz e com o
 * verificador, mostra o miolo, que é o que se confere de olho.
 */
function mascarar(documento: string): string {
  const so = documento.replace(/\D/g, "");
  if (so.length === 11) return `***.${so.slice(3, 6)}.${so.slice(6, 9)}-**`;
  if (so.length === 14) return `**.${so.slice(2, 5)}.${so.slice(5, 8)}/${so.slice(8, 12)}-**`;
  return so.length > 4 ? `***${so.slice(-4)}` : "documento";
}

/**
 * O que aconteceu, com o VERBO — e não o nome da coisa.
 *
 * ⚠️ "Ato · R$ 1.000" NÃO DIZ SE FOI PAGO (Lucas, 03/09/2026: *"eu não sei se foi pago, se foi
 * assinado, tem que vir a ação"*). Num histórico, cada linha precisa dizer o FATO: "Ato pago",
 * "Assinado como parte". O substantivo sozinho deixa o leitor supondo — e num registro de auditoria
 * supor é o que não pode acontecer.
 *
 * ⚠️ E AQUI, E NÃO NA CARGA: reescrever o texto no importador obrigaria a reimportar 19.531 linhas
 * a cada ajuste de palavra. A carga guarda o dado cru do C2X ("Assinar como parte", que é o nome do
 * tipo lá); a frase é da tela.
 */
function acaoDoEvento(tipo: string, descricao: null | string): string {
  const bruto = texto(descricao);

  if (tipo === "pagamento") return bruto ? `${bruto} pago` : "Pagamento";

  if (tipo === "assinatura") {
    // "Assinatura · Assinar como parte" → "Assinado como parte".
    const papel = bruto?.replace(/^Assinatura\s*·\s*/i, "").replace(/^Assinar\s+/i, "");
    return papel && papel.toLowerCase() !== "assinatura" ? `Assinado ${papel}` : "Assinado";
  }

  return bruto ?? "Registro";
}

const texto = (v: null | string | undefined): null | string => {
  const t = String(v ?? "").trim();
  return t || null;
};

/**
 * A frase do evento.
 *
 * ⚠️ "DE → PARA" SÓ QUANDO HÁ OS DOIS. Com origem nula (3.831 linhas) o C2X está dizendo "entrou
 * neste estágio", não "veio de lá"; inventar uma origem seria escrever no histórico algo que não
 * aconteceu.
 */
function fraseDoMovimento(m: MovimentoDoHistorico): string {
  const de = m.de_c2x ? (ESTAGIO[m.de_c2x] ?? `Estágio ${m.de_c2x}`) : null;
  const para = m.para_c2x ? (ESTAGIO[m.para_c2x] ?? `Estágio ${m.para_c2x}`) : null;

  if (de && para) return `${de} → ${para}`;
  if (para) return para;
  return "Registro atualizado";
}

/**
 * O contexto da proposta nascida aqui: com quem ela foi feita, em que prazo e o que ficou anotado.
 *
 * ⚠️ AS CONDIÇÕES ENTRAM PORQUE SÃO METADE DA PERGUNTA. Um histórico que diz "Proposta gerada" e
 * nada mais obriga quem lê a abrir o PDF para saber se aquela proposta era de 60x ou de 180x — e é
 * comparando as propostas que morreram que o coordenador entende por que o lote não vendeu.
 *
 * ⚠️ O PRAZO É O CONTRATADO, E O MOLDE SÓ NA FALTA DELE — a mesma precedência de `fluxoDoPlano`
 * (lib/hercules/fluxo-de-venda.ts). Estampar `plano_parcelas` direto escreveria "180x" no histórico
 * de uma proposta de 120x, porque 180 é o tamanho do produto, não o desta venda.
 */
function contextoDaProposta(p: PropostaDoHistorico): null | string {
  const parcelas = p.contrato_parcelas ?? p.plano_parcelas ?? null;
  const plano = [texto(p.plano_nome), parcelas ? `${parcelas}x` : null].filter(Boolean).join(" · ");
  const linhas = [
    texto(p.imobiliaria_nome) ? `Imobiliária: ${texto(p.imobiliaria_nome)}` : null,
    plano ? `Plano: ${plano}` : null,
    texto(p.observacao),
  ].filter(Boolean);
  return linhas.length > 0 ? linhas.join("\n") : null;
}

/**
 * Monta a linha do tempo do lote: a abertura de cada proposta mais cada movimento dela.
 *
 * A ordem é a mais recente primeiro — é assim que se lê histórico procurando "o que houve agora".
 */
export function historicoDaUnidade(
  propostas: PropostaDoHistorico[],
  movimentos: MovimentoDoHistorico[],
  importados: EventoImportado[] = [],
): EventoDaUnidade[] {
  const porProposta = new Map(propostas.map((p) => [p.id, p]));
  const eventos: EventoDaUnidade[] = [];

  for (const p of propostas) {
    // ⚠️ A PROPOSTA NATIVA ENTRA PELO `criado_em`, e é por isso que este laço não pula mais quem
    // está sem `criado_em_c2x`. O `continue` de antes descartava justamente a proposta que nasce
    // aqui: quem gerou, quando e em que condições sumia da ficha do lote — na MESMA tela em que a
    // reserva que a originou já aparecia. Sem data nenhuma (linha quebrada) ela continua fora: um
    // evento sem "quando" não tem lugar numa linha do tempo.
    const nativa = !p.criado_em_c2x;
    const quando = p.criado_em_c2x ?? texto(p.criado_em);
    if (!quando) continue;

    eventos.push({
      // ⚠️ O COD SÓ EXISTE NO QUE NASCEU AQUI — o legado não tem código, e inventar um daria número
      // novo para venda antiga a cada carga. Na nativa ele é o MESMO da reserva, copiado no ato da
      // geração: é o número que amarra o histórico ao WhatsApp e à busca da lista.
      codigo: nativa ? codigoDaVenda(p.protocolo_numero) || null : null,
      cliente: texto(p.cliente_nome),
      // ⚠️ QUEM GEROU NÃO É A IMOBILIÁRIA — a mesma correção que a reserva já sofreu (Lucas,
      // 04/09/2026: *"a reserva tem que vir criada por quem criou"*). "Proposta gerada · GURGEL"
      // diria que a imobiliária agiu, quando quem clicou foi o coordenador; ela desce para o
      // contexto, junto do prazo contratado. O texto da importada fica como estava, porque lá não
      // há autor nenhum para confundir com ela.
      fato: nativa
        ? "Proposta gerada"
        : texto(p.imobiliaria_nome)
          ? `Proposta aberta · ${texto(p.imobiliaria_nome)}`
          : "Proposta aberta",
      id: `abertura:${p.id}`,
      observacao: nativa ? contextoDaProposta(p) : texto(p.codigo) ? `Proposta ${texto(p.codigo)}` : null,
      propostaId: p.id,
      quando,
      tipo: "etapa",
      valor: null,
      // ⚠️ O C2X NÃO GUARDA QUEM ABRIU a proposta — só quem a moveu depois. Deixar em branco é o
      // honesto; pôr o autor do primeiro movimento seria atribuir a alguém um ato que pode não ter
      // sido dele. A nativa sabe: é o usuário da sessão que clicou em "Gerar proposta".
      quem: nativa ? texto(p.criado_por_nome) : null,
    });

    // ⚠️ O CANCELAMENTO É O PAR DA ABERTURA, e sem ele a ficha do lote fica com a metade que não
    // explica nada: "Proposta gerada" em setembro e a unidade disponível em outubro, sem uma linha
    // dizendo o que aconteceu no meio. O motivo é o que o coordenador procura quando alguém
    // pergunta por que este lote soltou — a mesma razão pela qual a reserva já grava o dela.
    if (p.cancelada_em) {
      eventos.push({
        cliente: texto(p.cliente_nome),
        codigo: nativa ? codigoDaVenda(p.protocolo_numero) || null : null,
        fato: "Proposta cancelada",
        id: `cancelada:${p.id}`,
        observacao: texto(p.cancelada_motivo),
        propostaId: p.id,
        quando: p.cancelada_em,
        quem: texto(p.cancelada_por_nome),
        tipo: "etapa",
        valor: null,
      });
    }
  }

  for (const m of movimentos) {
    const p = porProposta.get(m.proposta_id);
    eventos.push({
      codigo: null,
      cliente: texto(p?.cliente_nome ?? null),
      fato: fraseDoMovimento(m),
      id: `mov:${m.proposta_id}:${m.quando}:${m.de_c2x ?? "-"}:${m.para_c2x ?? "-"}`,
      observacao: texto(m.motivo) ?? texto(m.observacao),
      propostaId: m.proposta_id,
      quando: m.quando,
      quem: texto(m.autor_nome),
      tipo: "etapa",
      valor: null,
    });
  }

  // ⚠️ O DOCUMENTO DO SIGNATÁRIO SAI MASCARADO. O portal é externo: o coordenador precisa saber
  // QUEM assinou, não o CPF inteiro de ninguém. É a mesma regra da tela de boletos.
  for (const e of importados) {
    const p = porProposta.get(e.proposta_id);
    const valor = e.valor === null || e.valor === undefined ? null : Number(e.valor);
    eventos.push({
      codigo: null,
      cliente: texto(p?.cliente_nome ?? null),
      fato: acaoDoEvento(e.tipo, e.descricao),
      id: `${e.tipo}:${e.proposta_id}:${e.quando}:${texto(e.quem) ?? ""}`,
      observacao: e.documento ? mascarar(e.documento) : null,
      propostaId: e.proposta_id,
      quando: e.quando,
      quem: texto(e.quem),
      tipo: e.tipo === "pagamento" ? "pagamento" : "assinatura",
      valor: Number.isFinite(valor) ? valor : null,
    });
  }

  return eventos.sort((a, b) => b.quando.localeCompare(a.quando));
}

// ── A RESERVA NASCIDA NO PANTEON, NA LINHA DO TEMPO ─────────────────────────
//
// Lucas (04/09/2026), olhando a ficha do lote que ele mesmo tinha acabado de reservar: *"o
// histórico não está ligado"* — a tela dizia "nada registrado nesta unidade, ela nunca teve
// proposta" embaixo de uma reserva ativa, com cliente e data logo acima.
//
// ⚠️ O HISTÓRICO INTEIRO LIA SÓ O QUE VEIO DO C2X: propostas, etapas e eventos importados. O que
// nasce aqui não passava por nenhuma dessas três tabelas, e a unidade parecia virgem — a pior
// resposta possível numa tela cujo trabalho é dizer o que já aconteceu.
//
// ⚠️ CADA RESERVA VIRA ATÉ TRÊS LINHAS, e não uma: criada, cancelada e vencida são fatos
// diferentes, em datas diferentes, e uma linha só ("reserva") esconderia justamente o que a pessoa
// quer saber quando abre o histórico — por que ela não está mais de pé.

export type ReservaDoHistorico = {
  cancelada_em: null | string;
  cancelada_motivo: null | string;
  cancelada_por_nome?: null | string;
  corretor_nome?: null | string;
  criado_em: string;
  criado_por_nome: null | string;
  id: string;
  imobiliaria_nome?: null | string;
  observacao: null | string;
  proponentes: unknown;
  /** O numero cru do COD. A forma sai de codigoDaVenda, num lugar so. */
  protocolo_numero?: null | number;
  situacao: string;
  validade_em: null | string;
};

/** O nome do titular, para a linha dizer de quem é a reserva. */
function titularDaReserva(proponentes: unknown): null | string {
  const lista = Array.isArray(proponentes) ? proponentes : [];
  const primeiro = lista[0] as null | undefined | { nome?: unknown };
  return typeof primeiro?.nome === "string" && primeiro.nome.trim() ? primeiro.nome.trim() : null;
}

export function eventosDaReserva(reservas: ReservaDoHistorico[]): EventoDaUnidade[] {
  const eventos: EventoDaUnidade[] = [];

  for (const r of reservas) {
    const cliente = titularDaReserva(r.proponentes);
    // ⚠️ O COD ENTRA EM TODOS OS TRÊS EVENTOS da reserva (Lucas, 04/09/2026: *"aqui pode vir o
    // código também"*). Ele já viajava para o WhatsApp e já era BUSCÁVEL na lista — mas não
    // aparecia em lugar nenhum, então dava para procurar por um número que a tela nunca mostrou.
    const codigo = codigoDaVenda(r.protocolo_numero) || null;

    // ⚠️ O FATO NÃO CARREGA A IMOBILIÁRIA, e isso foi um erro que o Lucas pegou na primeira leitura:
    // "Reserva criada pela RAIANE IMOBILIARIA" diz que a imobiliária FEZ a reserva, quando quem fez
    // foi o coordenador — *"a reserva tem que vir criada por quem criou, que no caso foi reservada
    // pelo meu usuário"*. A imobiliária é quem VENDE, não quem agiu; ela desce para o contexto da
    // linha, junto do que o coordenador anotou.
    // ⚠️ O CORRETOR ENTRA JUNTO (Lucas, 04/09/2026: *"acho que pode vir o nome do corretor"*). Ele
    // é quem atende o cliente: numa reserva de seis meses atrás, saber a imobiliária sem saber a
    // pessoa deixa quem lê com meia resposta.
    const contexto = [
      r.imobiliaria_nome ? `Imobiliária: ${r.imobiliaria_nome}` : null,
      r.corretor_nome ? `Corretor: ${r.corretor_nome}` : null,
      r.observacao?.trim() || null,
    ].filter(Boolean);

    eventos.push({
      cliente,
      codigo,
      fato: "Reserva criada",
      id: `reserva:${r.id}:criada`,
      observacao: contexto.length > 0 ? contexto.join("\n") : null,
      propostaId: `reserva:${r.id}`,
      quando: r.criado_em,
      quem: r.criado_por_nome,
      tipo: "etapa",
      valor: null,
    });

    if (r.cancelada_em) {
      eventos.push({
        cliente,
        codigo,
        fato: "Reserva cancelada",
        id: `reserva:${r.id}:cancelada`,
        observacao: r.cancelada_motivo,
        propostaId: `reserva:${r.id}`,
        quando: r.cancelada_em,
        quem: r.cancelada_por_nome ?? null,
        tipo: "etapa",
        valor: null,
      });
    }

    // ⚠️ VENCIDA É DEDUZIDA, e por isso só entra quando a reserva NÃO foi cancelada nem virou
    // proposta: nesses casos o que encerrou a reserva foi outra coisa, e dizer "venceu" seria
    // inventar um fato que não aconteceu.
    if (
      r.situacao === "expirada" &&
      !r.cancelada_em &&
      r.validade_em
    ) {
      eventos.push({
        cliente,
        codigo,
        fato: "Reserva vencida",
        id: `reserva:${r.id}:vencida`,
        observacao: null,
        propostaId: `reserva:${r.id}`,
        quando: r.validade_em,
        quem: null,
        tipo: "etapa",
        valor: null,
      });
    }
  }

  return eventos.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
}

// ── A COR DA LINHA DO TEMPO ─────────────────────────────────────────────────
//
// ⚠️ ESTA CLASSIFICAÇÃO MORA AQUI, JUNTO DE QUEM ESCREVE OS FATOS, e a razão é um defeito real:
// a régua vivia no componente, procurando o radical "reservad", e quando o fato do Panteon passou
// a ser "Reserva criada" (04/09/2026) ele deixou de casar — o ponto do evento caiu no cinza de
// transição comum, numa tela onde a reserva tem cor própria em todo lugar. O Lucas viu na hora:
// *"a cor da reserva não está na mesma cor"*.
//
// Com a classificação ao lado dos textos, quem mudar uma frase esbarra na régua que a lê; e o teste
// confere os fatos que ESTE arquivo emite, coisa que um regex escondido no componente não permitia.

export type ClasseDoFato =
  | "assinatura"
  | "cancelado"
  | "contrato"
  | "faturado"
  | "pagamento"
  | "proposta"
  | "reserva"
  | "transicao";

/**
 * Em que família este fato entra — é ela que decide a cor do ponto na linha do tempo.
 *
 * ⚠️ A ORDEM DOS TESTES É A REGRA. "Reserva cancelada" é CANCELAMENTO, não reserva: o vermelho tem
 * que vencer, senão o que se procura na lista some no meio do amarelo.
 */
export function classeDoFato(fato: string, tipo?: EventoDaUnidade["tipo"]): ClasseDoFato {
  if (tipo === "pagamento") return "pagamento";
  if (tipo === "assinatura") return "assinatura";

  const texto = String(fato ?? "").toLowerCase();
  if (/cancelad|reprovad|distrat/.test(texto)) return "cancelado";
  if (/faturad|finalizad/.test(texto)) return "faturado";
  if (/assinatura/.test(texto)) return "assinatura";
  if (/contrato/.test(texto)) return "contrato";
  if (/proposta|análise|analise/.test(texto)) return "proposta";
  if (/reserva/.test(texto)) return "reserva";
  return "transicao";
}
