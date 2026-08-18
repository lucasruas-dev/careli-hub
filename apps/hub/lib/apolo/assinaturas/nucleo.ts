// NÚCLEO DE ASSINATURA — o que a tela do PORTAL do incorporador e a tela CONTRATOS do Apolo têm
// em comum, num lugar só.
//
// A história: o painel interno (`lib/apolo/painel-assinatura.ts`) inspirou a aba de assinaturas do
// portal (`lib/apolo/incorporador/assinaturas.ts`), que ficou melhor — e o Lucas pediu (18/08/2026)
// *"que tela maravilhosa essa de assinatura, quero levá-la para dentro do Apolo"*, logo seguido de
// *"a tela de assinatura devia chamar CONTRATOS e tirar a tela de contratos que tem hoje... no
// final dessa linha vai ter o contrato para ser baixado"*. Trazer isso de volta duplicando as 700
// linhas do agregador criaria duas verdades sobre o MESMO contrato, que é exatamente o erro que
// este arquivo existe para evitar.
//
// A DIVISÃO É ESTA:
//   • as funções PURAS (fila por degrau, tradução de perfil, régua de 7 dias, montagem do quadro,
//     taxas, agrupamento por perfil, dados do contrato na linha) não sabem nada de escopo e são
//     reusadas INTEIRAS pelas duas telas;
//   • o ESCOPO fica só na borda: a rota do portal estreita por `codigosDaSessao`; a rota do Apolo
//     autoriza pelo papel no Hub (`authorizeApoloRead`) e recorta pelo empreendimento que a tela
//     escolheu, validado contra a lista que o próprio C2X devolve (`resolverCodes`);
//   • o que sobra aqui é o pouco que SÓ a versão interna tem: o e-mail do assinante e o documento
//     do PDF.
//
// ⚠️ POR QUE ISTO RE-EXPORTA EM VEZ DE MOVER O CÓDIGO: `lib/apolo/incorporador/assinaturas.ts`
// acabou de subir em produção com o portal e continua em obra (a fusão das abas do portal). Mover
// a função agora seria conflito garantido. O ponto de importação passa a ser ESTE arquivo para os
// dois lados; quando o portal estabilizar, o corpo de `montarQuadroDeAssinaturas` muda de casa sem
// que nenhum chamador precise mudar de linha.
//
// ⚠️ NADA AQUI PODE SER IMPORTADO POR COMPONENTE "use client": a cadeia puxa `mysql2`. Nas telas,
// só `import type`.
export {
  marcarSituacao,
  perfilDeTela,
  prazoDoComprador,
  PRAZO_COMPRADOR,
  type LinhaAssinatura,
} from "@/lib/apolo/painel-assinatura";

export {
  montarQuadroDeAssinaturas,
  type AssinanteDoQuadro,
  type AssinaturaDoEsquema,
  type ContratoVivo,
  type DadosDoContrato,
  type DegrauDaFila,
  type EnvioSemAssinante,
  type FichaDoContratoVivo,
  type GrupoDaUnidade,
  type KpisDeAssinatura,
  type QuadroDeAssinaturas,
  type TaxaDoPerfil,
  type UnidadeDeAssinatura,
} from "@/lib/apolo/incorporador/assinaturas";

export {
  escolherEnvio,
  ESTAGIOS_COM_CONTRATO,
  ESTAGIOS_DE_GERACAO,
  SITUACAO_ASSINATURA_LABELS,
  type EnvioDeAssinatura,
  type SituacaoDaAssinatura,
} from "@/lib/apolo/incorporador/contratos";

import type {
  AssinanteDoQuadro,
  AssinaturaDoEsquema,
  UnidadeDeAssinatura,
} from "@/lib/apolo/incorporador/assinaturas";
import type { LinhaAssinatura } from "@/lib/apolo/painel-assinatura";

/** O rótulo da unidade, como o C2X a batiza: o nome dela, e no vazio o código+quadra+lote. */
export const SQL_UNIDADE_ROTULO =
  "coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot))";

/**
 * A consulta das LINHAS de assinatura, escopada por CÓDIGO de empreendimento.
 *
 * É a consulta do painel interno com dois campos a mais (`ar_id` e `uuid_doc`, para escolher o
 * envio e ligar o PDF) e uma diferença deliberada: `contract_signature_signers` entra por LEFT
 * JOIN, porque existe envio válido SEM nenhuma linha de assinante — com join interno ele sumiria da
 * lista e cairia (errado) no indicador de "aguardando emissão".
 *
 * ⚠️ O RÓTULO DA UNIDADE É O `SQL_UNIDADE_ROTULO`, o MESMO da leitura dos contratos vivos: as duas
 * metades da lista precisam escrever o nome da unidade igual, senão a mesma unidade aparece com
 * dois nomes na mesma tela.
 *
 * @param placeholders Os `?` dos códigos, montados por quem chama (`codes.map(() => "?")`).
 */
export const SQL_LINHAS_POR_CODE = (placeholders: string): string => `
  select
    e.code as emp,
    ${SQL_UNIDADE_ROTULO} as unidade,
    u.block as quadra, u.lot, u.price as valor,
    cs.id as id_ass,
    ar.id as ar_id,
    nullif(trim(cs.uuidDoc), '') as uuid_doc,
    cs.contract_signature_status_id as status_c2x,
    date_format(cs.created_at, '%Y-%m-%d') as envio,
    datediff(now(), cs.created_at) as dias_envio,
    ss.id as signer_id,
    ss.user_name as usuario,
    ss.email,
    pf.name as perfil_c2x,
    ss.signed as assinado,
    date_format(ss.date_signed, '%Y-%m-%d') as data_assinatura,
    ss.after_position as posicao
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  left join contract_signature_signers ss on ss.contract_signature_id = cs.id
  left join contract_signers csg on csg.id = ss.contract_signer_id
  left join signers sg on sg.id = csg.signer_id
  left join users usr on usr.id = sg.user_id
  left join profiles pf on pf.id = usr.profile_id
  where e.code in (${placeholders})
    and cs.send_document_signature = 1
    and cs.contract_signature_status_id <> 6
  order by e.code, u.block, u.lot, ss.after_position, ss.id`;

/** Uma linha do esquema de assinatura na versão INTERNA: a do portal, mais o e-mail do assinante. */
export type AssinaturaInterna = AssinaturaDoEsquema & {
  /**
   * ⚠️ SÓ NA TELA INTERNA. O portal é vitrine de cliente externo e não recebe e-mail de terceiro
   * (decisão do Lucas, 18/08/2026); o painel do time SEMPRE mostrou o e-mail sob o nome, e é ele
   * que distingue três sócios da mesma razão social. Quem preenche é a borda interna.
   */
  email: null | string;
};

/** Um assinante do quadro na versão interna: o do portal, com o e-mail que o painel já mostrava. */
export type AssinanteInterno = AssinanteDoQuadro & {
  email: null | string;
  /** Quantos e-mails DIFERENTES o mesmo nome usa no recorte, além do exibido. 0 no caso normal. */
  emailsExtras: number;
};

/**
 * Uma linha da tela Contratos do Apolo: a linha do portal (com os dados do contrato já pendurados
 * e as três situações — aguardando emissão, em assinatura, concluído) mais as duas coisas que só o
 * time vê: o e-mail de quem assina e o documento do PDF.
 */
export type ContratoDoPainel = Omit<UnidadeDeAssinatura, "esquema"> & {
  /**
   * `uuidDoc` do envio escolhido. É o que a tela interna passa para
   * `/api/apolo/empreendimentos/contrato/[documentId]`, o mesmo caminho da coluna Contrato da
   * Carteira. Nulo = não há documento para abrir.
   *
   * ⚠️ O PORTAL NÃO RECEBE ISTO. Lá o botão de PDF manda o `unitId` e a rota resolve o uuid no
   * servidor, reconferindo o escopo da sessão; aqui quem autoriza é o papel no Hub.
   */
  documentoId: null | string;
  esquema: AssinaturaInterna[];
};

/** Um empreendimento oferecido no filtro da tela: nunca só o nome. Ver o aviso do Vale do Ouro. */
export type EmpreendimentoDoFiltro = {
  code: string;
  /** Contratos que ele tem (enviados + vivos, sem contar duas vezes): dá peso ao item do seletor. */
  contratos: number;
  nome: string;
};

/**
 * O recorte PADRÃO da tela interna: exatamente o que `/apolo/assinaturas` mostra hoje.
 *
 * ⚠️ VALE DO OURO SÃO QUATRO EMPREENDIMENTOS NO C2X, todos com o nome "VALE DO OURO": VLO (35, o
 * espelho histórico), VOL (36, do Lino), VOC (37, do Cecílio) e VOR (41, o novo). Há auditoria em
 * curso sobre o agrupamento, então esta tela NÃO agrupa por nome em lugar nenhum: o recorte é por
 * CÓDIGO, e o seletor mostra o código ao lado do nome. Somar dois "Vale do Ouro" diferentes é o
 * erro que isto previne — e o nome repete em mais quatro famílias (Lagoa Bonita tem três códigos,
 * Rio de Pedras, Portal dos Vales, Lavra do Ouro e Milenium têm dois cada).
 */
export const CODES_PADRAO_DO_PAINEL = ["VOC", "VOL"];

/**
 * Resolve o que a tela pediu contra o que o C2X tem.
 *
 * ⚠️ ALLOWLIST, e é o ponto: a rota interna aceita `emp` da query string (o time troca de
 * empreendimento na tela, diferente do portal, onde o recorte vem do token). Sem confrontar com a
 * lista real, um código inventado viraria consulta com filtro que não casa — e, no dia em que
 * alguém montar a query por concatenação, viraria injeção. Aqui o código só passa se existir.
 *
 * @param pedidos     Códigos pedidos pela tela (vazio = o padrão; `["*"]` = tudo o que existe).
 * @param disponiveis Os empreendimentos que o C2X devolveu.
 */
export function resolverCodes(
  pedidos: string[],
  disponiveis: EmpreendimentoDoFiltro[],
): string[] {
  const existentes = new Set(disponiveis.map((item) => item.code));
  const limpos = pedidos.map((code) => code.trim().toUpperCase()).filter(Boolean);

  if (limpos.includes("*")) return [...existentes].sort();

  const validos = limpos.filter((code) => existentes.has(code));
  if (validos.length > 0) return [...new Set(validos)].sort();

  // Sem pedido válido, o padrão — e só o que de fato existe (num banco sem Vale do Ouro, a tela
  // abre no que houver em vez de consultar código ausente).
  const padrao = CODES_PADRAO_DO_PAINEL.filter((code) => existentes.has(code));

  return padrao.length > 0 ? padrao : [...existentes].sort();
}

/**
 * O e-mail de cada assinante no recorte, pelo NOME — a chave que o quadro do portal usa.
 *
 * ⚠️ NOME NÃO É IDENTIDADE. Dois assinantes homônimos com e-mails diferentes existem, e este mapa
 * não os funde: guarda os e-mails distintos daquele nome, e a tela mostra o primeiro com um "+N"
 * ao lado. É informação de exibição do painel interno, não vínculo de cadastro.
 */
export function emailsPorNome(linhas: LinhaAssinatura[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>();

  for (const linha of linhas) {
    const nome = linha.usuario;
    const email = linha.email.trim();
    if (!nome || !email) continue;

    const atual = mapa.get(nome) ?? [];
    if (!atual.includes(email)) atual.push(email);
    mapa.set(nome, atual);
  }

  return mapa;
}

/** O quadro por assinante com o e-mail que o painel interno sempre mostrou sob o nome. */
export function enriquecerAssinantes(
  assinantes: AssinanteDoQuadro[],
  emails: Map<string, string[]>,
): AssinanteInterno[] {
  return assinantes.map((assinante) => {
    const doNome = emails.get(assinante.nome) ?? [];

    return {
      ...assinante,
      email: doNome[0] ?? null,
      emailsExtras: Math.max(0, doNome.length - 1),
    };
  });
}

/**
 * Pendura na linha o que só a tela interna mostra: o documento do PDF e o e-mail de cada assinante.
 *
 * O resto — valor, imobiliária, geração, faturamento, situação, barrinhas, ordem — já vem pronto do
 * núcleo compartilhado, e é de propósito: um segundo lugar calculando a mesma coisa é um segundo
 * lugar para divergir.
 *
 * O e-mail é resolvido DENTRO do envio (envio + nome), não no recorte inteiro: é o par exato que
 * assinou aquele documento. Contrato sem envio (aguardando emissão) não tem esquema nem documento.
 */
export function enriquecerUnidades({
  linhas,
  unidades,
  uuidPorEnvio,
}: {
  linhas: LinhaAssinatura[];
  unidades: UnidadeDeAssinatura[];
  uuidPorEnvio: Map<number, null | string>;
}): ContratoDoPainel[] {
  const emailPorEnvioENome = new Map<string, string>();
  for (const linha of linhas) {
    const email = linha.email.trim();
    if (!email || !linha.usuario) continue;
    const chave = `${linha.contrato}|${linha.usuario}`;
    if (!emailPorEnvioENome.has(chave)) emailPorEnvioENome.set(chave, email);
  }

  return unidades.map((unidade) => ({
    ...unidade,
    // O documento vem do ENVIO escolhido, não do contrato: é aquele envio que virou PDF. A linha
    // sem envio usa `envioId` 0, que nunca está no mapa — e nela não há PDF mesmo.
    documentoId: uuidPorEnvio.get(unidade.envioId) ?? null,
    esquema: unidade.esquema.map((item) => ({
      ...item,
      email: emailPorEnvioENome.get(`${unidade.envioId}|${item.nome}`) ?? null,
    })),
  }));
}
