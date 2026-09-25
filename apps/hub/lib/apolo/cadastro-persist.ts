// Persistencia do cadastro manual do Apolo: cria uma ENTIDADE (PF/PJ) a partir de um PAPEL de
// nascimento. Hoje o unico processo ligado e o do PROSPECT; os demais papeis (imobiliaria,
// corretor, fornecedor...) reusam esta camada depois. Escreve coordenadamente nas tabelas
// apolo_* (via service role; RLS so libera SELECT), espelhando o que o sync do C2X ja faz.
// Ver [[project_apolo_cadastro_prospect]], [[project_apolo_crm_grafo]].
import { depoisDaResposta } from "@/lib/apolo/depois-da-resposta";
import { conflitoDeEmailRepetido } from "@/lib/apolo/email-unico";
import { lerCadsDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  expansorDeEmpreendimentos,
  registrarHabilitacaoPeloCadastro,
  separarVinculosNovos,
} from "@/lib/apolo/habilitacao-pelo-cadastro";
import { conflitoDeNucleoFamiliar, mensagemDeConflito } from "@/lib/apolo/nucleo-familiar";
import { normalizarProfissaoLivre } from "@/lib/apolo/profissao";
import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Papel de nascimento da entidade. So 'prospect' esta ligado por enquanto; os outros ja existem
// no enum de apolo_entity_profiles e entram quando cada processo for construido.
export type ApoloBirthRole =
  | "prospect"
  | "imobiliaria"
  | "corretor"
  | "fornecedor"
  | "incorporador"
  | "parceiro"
  | "colaborador";

export type CreateApoloEntityInput = {
  role: ApoloBirthRole;
  persona: "pf" | "pj";
  origem?: string;
  ownerUserId?: string | null;
  // Liga o DEDUP por documento: se o CPF/CNPJ já tem ficha, NÃO cria uma segunda — retorna
  // ok:false com entityIdExistente. Ligado nos fluxos de PROSPECT (cadastro manual + portal CAD),
  // onde não pode haver ficha dupla. Os fluxos de imobiliária/corretor têm dedup próprio por papel
  // (reaproveitam a entidade), então NÃO ligam este — senão o "mesma pessoa, outro papel" quebra.
  dedupPorDocumento?: boolean;
  // Empreendimento desta CAD (id do C2X). A duplicidade é POR EMPREENDIMENTO: com ele, o dedup
  // barra só quem já tem CAD NO MESMO loteamento e libera quem quer comprar em outro. SEM ele o
  // dedup não tem como distinguir as duas coisas e volta a barrar tudo — é o ramo conservador,
  // documentado no bloco de decisão lá embaixo.
  enterpriseId?: null | number | string;
  identidade?: {
    cpf?: string;
    dataNascimento?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    nomePai?: string;
    orgaoEmissor?: string;
  } | null;
  empresa?: {
    atividade?: string;
    cnae?: string;
    cnpj?: string;
    // CRECI Jurídico (só imobiliária). Opcional.
    creci?: string;
    dataAbertura?: string;
    dataAtualizacao?: string;
    email?: string;
    naturezaJuridica?: string;
    nomeFantasia?: string;
    porte?: string;
    razaoSocial?: string;
    situacaoCadastral?: string;
    socios?: Array<{ nome: string; qualificacao: string }>;
    telefone?: string;
  } | null;
  // Corretores da imobiliária (papel imobiliaria) → relacionamento de CONTATO. Cadastro simples.
  corretores?: Array<{
    cpf?: string;
    creci?: string;
    email?: string;
    nome?: string;
    telefone?: string;
  }>;
  // Empreendimentos vinculados à imobiliária → relacionamento de TRABALHO. id = enterprise do C2X.
  empreendimentos?: Array<{ id?: string; label?: string }>;
  // Socios CADASTRADOS (PJ): pessoas fisicas com ficha propria. Por ora ficam na metadata do
  // cadastro (a ficha corrida registra quem sao); virar entidade PF vinculada e o modelo de
  // grafo, decisao a parte.
  socios?: Array<{
    cpf?: string;
    dataNascimento?: string;
    email?: string;
    estadoCivilId?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    representanteLegal?: boolean;
    sexoId?: string;
    telefone?: string;
    endereco?: {
      bairro?: string;
      cep?: string;
      cidade?: string;
      logradouro?: string;
      numero?: string;
      uf?: string;
    };
  }>;
  perfil?: {
    email?: string;
    escolaridadeId?: string;
    estadoCivilId?: string;
    imobiliariaId?: string;
    imobiliariaLabel?: string;
    patrimonio?: string;
    profissaoId?: string;
    // Profissão DIGITADA à mão no wizard (não existe entre as 234 do C2X). Viaja e é guardada, mas
    // NUNCA vira `profession` no envio ao C2X — lá só o rótulo de um id do catálogo vale.
    // Ver lib/apolo/profissao.ts.
    profissaoOutro?: string;
    // Regime de bens (property_regimes do C2X) — só casado / união estável.
    regimeBensId?: string;
    rendaId?: string;
    sexoId?: string;
    telefone?: string;
  } | null;
  endereco?: {
    bairro?: string;
    cep?: string;
    cidade?: string;
    complemento?: string;
    logradouro?: string;
    numero?: string;
    uf?: string;
  } | null;
  conjuge?: {
    cpf?: string;
    dataNascimento?: string;
    email?: string;
    escolaridadeId?: string;
    nacionalidade?: string;
    naturalidade?: string;
    nome?: string;
    nomeMae?: string;
    patrimonio?: string;
    profissaoId?: string;
    profissaoOutro?: string;
    rendaId?: string;
    sexoId?: string;
    telefone?: string;
  } | null;
};

// POR QUE A RECUSA FOI, em categoria. A mensagem (`error`) é escrita para o time da Careli e nomeia
// terceiros: o empreendimento onde a CAD já existe, o dono do e-mail, o titular do núcleo familiar.
// Quem responde para gente de FORA da Careli (o CRM do portal do incorporador) não pode repassar a
// frase, e adivinhar o motivo lendo o texto quebraria na primeira revisão de redação. O hub ignora
// este campo: a resposta dele continua sendo a de sempre.
export type MotivoDaRecusaDoCadastro =
  | "cad-no-empreendimento"
  | "dados-invalidos"
  | "email-repetido"
  | "falha-ao-gravar"
  | "nucleo-familiar"
  | "verificacao-indisponivel";

// QUEM CADASTROU, QUANDO NÃO É USUÁRIO DO HUB. Decisão do Lucas (16/09/2026): a equipe da Cecílio
// cadastra cliente novo pelo CRM do portal. `owner_user_id` é do `hub_users` e não cabe o usuário
// do portal (`apolo_incorporador_usuarios.id`), então a autoria vai para `metadata.cadastradoPor`.
export type AutorDeForaDoHub = {
  nome: null | string;
  origem: "portal";
  slug: string;
  usuarioId: string;
};

/**
 * O que a PORTA decide sobre o cadastro, e que por isso NÃO mora no `input`.
 *
 * ⚠️ FORA DO INPUT DE PROPÓSITO (revisão da onda 3, 16/09/2026). As rotas públicas chamam
 * `createApoloEntity(adminClient, { ...payload, ... })` espalhando o CORPO da requisição: um campo
 * de autoria dentro do input seria preenchido por quem manda o JSON, e a ficha nasceria dizendo que
 * foi cadastrada por um usuário do portal da Cecílio. Aqui só entra o que o servidor escreveu.
 *
 *   • `autor`: ausente ou nulo (o hub e o link público) = nada muda na ficha.
 *   • `fichaExistente`: o que fazer quando o documento JÁ TEM ficha e nenhuma CAD neste produto.
 *       - `anexar` (padrão, o de sempre no hub e no link público): a CAD nova entra na ficha
 *         existente e a gravação escreve nela como numa ficha nova (metadata mesclado com o
 *         `cadastro` novo por cima, contato, endereço, relacionamentos, índice de busca).
 *       - `acrescentar` (o portal do incorporador): a CAD nova entra na MESMA ficha, mas nada do que
 *         a ficha já tem é trocado. Decisão do Lucas (16/09/2026): *"aproveita o cadastro"*, uma
 *         ficha por pessoa, sem devolver nada do que a Careli já tem e sem sobrescrever telefone,
 *         e-mail, endereço e os demais dados globais. Ver `metadataAcrescentado` e
 *         `linhasQueFaltamNaFicha` logo abaixo.
 *
 * (Até 16/09/2026 existia `recusar`, que respondia 409 "fale com a central" para quem já tinha
 * ficha. Saiu com a decisão acima: o portal passou a aproveitar a ficha.)
 */
export type OpcoesDoCadastro = {
  autor?: AutorDeForaDoHub | null;
  fichaExistente?: "acrescentar" | "anexar";
  /**
   * (24/09/2026) O cadastro é do OPERADOR DA CARELI (o wizard do hub), e a imobiliária que ele grava
   * nasce habilitada (regra de 17/08). Ligado: o vínculo de empreendimento `verified` NOVO grava a
   * auditoria `credenciamento_habilitado` e avisa o coordenador do empreendimento; o que a ficha já
   * tinha habilitado não é gravado nem avisado de novo. Ver lib/apolo/habilitacao-pelo-cadastro.ts.
   *
   * ⚠️ AS PORTAS PÚBLICAS NÃO LIGAM, e não podem ligar: elas também passam por aqui com o papel
   * `imobiliaria`, mas REBAIXAM o papel para `review` e o vínculo para `pending` logo depois
   * (/api/publico/imobiliaria/cadastro e /credenciar). Avisar ali diria ao coordenador que uma
   * imobiliária que ninguém validou está habilitada. Ausente = desligado.
   */
  habilitacaoInterna?: boolean;
};

/**
 * O que a porta que ACRESCENTA registra de si na ficha que já existia, numa lista à parte
 * (`metadata.cadsAcrescentadas`). Fica à parte porque `cadastradoPor` diz quem CRIOU a ficha, e a
 * ficha não foi criada por quem só acrescentou a CAD de um produto: gravar ali apagaria a autoria
 * original (ou inventaria uma, quando a ficha veio do sync do C2X).
 */
export type CadAcrescentada = {
  /**
   * O telefone e o e-mail que o portal digitou, guardados SÓ AQUI, como pendência para a Careli
   * conferir (ver `TIPOS_DE_CONTATO_QUE_IDENTIFICAM`). Ausente quando não veio nenhum.
   */
  contatoInformado?: { email: null | string; telefone: null | string };
  em: string;
  enterpriseId: null | string;
  nome: null | string;
  origem: string;
  slug: null | string;
  usuarioId: null | string;
};

function vazioNaFicha(valor: unknown): boolean {
  if (valor === undefined || valor === null) return true;
  if (typeof valor === "string") return valor.trim() === "";
  if (Array.isArray(valor)) return valor.length === 0;
  if (typeof valor === "object") return Object.keys(valor as Record<string, unknown>).length === 0;
  return false;
}

/**
 * O metadata da ficha que já existe, com a CAD acrescentada pela porta de fora.
 *
 * ⚠️ O QUE A FICHA JÁ TEM VENCE. O metadata inteiro é preservado (`source`, `c2xSynced`,
 * `c2xUserId`, `autenticacao`, `cadastradoPor`, `origem`...). Em `metadata.cadastro` só entram as
 * chaves que a ficha não tem ou tem vazias: o nascimento, a mãe ou o estado civil que o time da
 * Careli conferiu não são trocados pelo que o portal digitou. Exportada para o teste.
 */
export function metadataAcrescentado(
  atual: Record<string, unknown>,
  cadastroNovo: Record<string, unknown>,
  acrescimo: CadAcrescentada,
): Record<string, unknown> {
  const cadastroAtual =
    typeof atual.cadastro === "object" && atual.cadastro !== null && !Array.isArray(atual.cadastro)
      ? (atual.cadastro as Record<string, unknown>)
      : {};
  const cadastro: Record<string, unknown> = { ...cadastroAtual };
  for (const [chave, valor] of Object.entries(cadastroNovo)) {
    if (vazioNaFicha(cadastro[chave]) && !vazioNaFicha(valor)) cadastro[chave] = valor;
  }
  const anteriores = Array.isArray(atual.cadsAcrescentadas) ? atual.cadsAcrescentadas : [];

  return { ...atual, cadastro, cadsAcrescentadas: [...anteriores, acrescimo] };
}

/**
 * As linhas que a porta que ACRESCENTA pode inserir numa ficha que já existe: só o que a ficha não
 * tem do MESMO tipo. Exportada para o teste.
 *
 * ⚠️ NUNCA UPDATE, NUNCA NOVO PRIMÁRIO POR CIMA. O contato e o endereço nascem `is_primary`: inserir
 * um telefone novo numa ficha que já tem telefone deixaria DOIS primários, e a Iris, a cobrança e o
 * disparo escolheriam entre eles sem critério. Por isso, se a ficha já tem telefone, o telefone
 * digitado no portal não entra (o mesmo para e-mail, endereço, identificador e cônjuge).
 *
 * Relacionamento de trabalho (imobiliária, corretor, empreendimento) é outra natureza: a pessoa
 * pode ter mais de um, e o da CAD nova é um fato novo. Esse só não entra repetido (mesma ficha
 * ligada, ou o mesmo rótulo quando não há ficha ligada).
 *
 * `existentes` nulo = a leitura daquela tabela falhou: não se sabe o que a ficha tem, então nada
 * daquela tabela é inserido (o salvar registra o aviso).
 *
 * (16/09/2026, revisão do conjunto) ⚠️ TELEFONE E E-MAIL NUNCA ENTRAM NA FICHA QUE JÁ EXISTIA, NEM
 * QUANDO FALTAM. Eles não são "mais um dado": são CHAVE DE IDENTIDADE. A Iris acha a pessoa primeiro
 * pelo hash do identificador `phone`/`email` e depois pelo texto de `apolo_contacts`
 * (lib/iris/apolo/identidade-contato.ts). Um cliente da Careli que veio do sync sem identificador de
 * telefone, cadastrado no Garden com o WhatsApp de quem opera o portal, passava a ter esse número
 * como chave: a central e a CACÁ tratariam o atendente da Cecílio como o cliente (boletos, parcelas,
 * contratos). O que o portal digitou fica só como pendência em `metadata.cadsAcrescentadas`
 * (`contatoInformado`), para a Careli confirmar. Na ficha NOVA (sem ficha anterior) nada muda.
 */
export const TIPOS_DE_CONTATO_QUE_IDENTIFICAM: ReadonlySet<string> = new Set(["email", "phone", "whatsapp"]);

export function linhasQueFaltamNaFicha(
  novas: {
    contatos: Array<Record<string, unknown>>;
    enderecos: Array<Record<string, unknown>>;
    identificadores: Array<Record<string, unknown>>;
    relacionamentos: Array<Record<string, unknown>>;
  },
  existentes: {
    contatos: null | Array<{ contact_type: null | string }>;
    enderecos: null | Array<unknown>;
    identificadores: null | Array<{ identifier_type: null | string }>;
    relacionamentos:
      | null
      | Array<{ label: null | string; related_entity_id: null | string; relationship_type: null | string }>;
  },
): {
  contatos: Array<Record<string, unknown>>;
  enderecos: Array<Record<string, unknown>>;
  identificadores: Array<Record<string, unknown>>;
  relacionamentos: Array<Record<string, unknown>>;
} {
  const tiposDeContato = new Set((existentes.contatos ?? []).map((l) => l.contact_type));
  const tiposDeIdentificador = new Set(
    (existentes.identificadores ?? []).map((l) => l.identifier_type),
  );
  const tiposDeRelacionamento = new Set(
    (existentes.relacionamentos ?? []).map((l) => l.relationship_type),
  );
  const chaveDoVinculo = (linha: {
    label?: unknown;
    related_entity_id?: unknown;
    relationship_type?: unknown;
  }) =>
    `${String(linha.relationship_type ?? "")}|${
      linha.related_entity_id ? `id:${String(linha.related_entity_id).toLowerCase()}` : `rotulo:${text(linha.label).toLowerCase()}`
    }`;
  const vinculosExistentes = new Set((existentes.relacionamentos ?? []).map(chaveDoVinculo));

  return {
    contatos: existentes.contatos
      ? novas.contatos.filter(
          (l) =>
            !TIPOS_DE_CONTATO_QUE_IDENTIFICAM.has(String(l.contact_type)) &&
            !tiposDeContato.has(String(l.contact_type)),
        )
      : [],
    enderecos: existentes.enderecos && existentes.enderecos.length === 0 ? novas.enderecos : [],
    identificadores: existentes.identificadores
      ? novas.identificadores.filter(
          (l) =>
            !TIPOS_DE_CONTATO_QUE_IDENTIFICAM.has(String(l.identifier_type)) &&
            !tiposDeIdentificador.has(String(l.identifier_type)),
        )
      : [],
    relacionamentos: existentes.relacionamentos
      ? novas.relacionamentos.filter((l) =>
          RELACIONAMENTOS_DE_TRABALHO.has(String(l.relationship_type))
            ? !vinculosExistentes.has(chaveDoVinculo(l))
            : !tiposDeRelacionamento.has(String(l.relationship_type)),
        )
      : [],
  };
}

// Vínculos que a pessoa pode ter vários (um por CAD, por produto). Os demais (cônjuge, sócio,
// representante legal) são dado GLOBAL da ficha: só entram quando a ficha não tem nenhum do tipo.
const RELACIONAMENTOS_DE_TRABALHO = new Set(["corretor", "empreendimento", "imobiliaria"]);

/** Tira o id da ficha existente da recusa: quem acrescenta é de fora e não recebe id da Careli. */
function recusaDaPorta(
  recusa: Extract<CreateApoloEntityResult, { ok: false }>,
  acrescentar: boolean,
): Extract<CreateApoloEntityResult, { ok: false }> {
  if (!acrescentar) return recusa;
  const semId = { ...recusa };
  delete semId.entityIdExistente;
  return semId;
}

/**
 * As fichas que um documento já tem, nas DUAS fontes: `document_hash` (quem nasce no Apolo) e
 * `apolo_entity_identifiers` (quem veio do sync/import). `falhou` = alguma das duas leituras deu
 * erro, e a lista pode estar incompleta: quem precisa de certeza (o portal) trata como "não sei".
 */
export async function fichasDoDocumento(
  adminClient: AdminClient,
  docKind: "cnpj" | "cpf",
  digits: string,
): Promise<{ falhou: boolean; ids: string[] }> {
  const docHash = hashIdentifier(docKind, digits);
  const [porIdentificador, porDocumento] = await Promise.all([
    adminClient
      .from("apolo_entity_identifiers")
      .select("entity_id")
      .eq("identifier_type", docKind)
      .eq("value_hash", docHash),
    adminClient.from("apolo_entities").select("id").eq("document_hash", docHash),
  ]);

  const ids = [
    ...new Set([
      ...((porIdentificador.data ?? []) as Array<{ entity_id: string }>).map((l) => l.entity_id),
      ...((porDocumento.data ?? []) as Array<{ id: string }>).map((l) => l.id),
    ]),
  ].filter(Boolean);

  return { falhou: Boolean(porIdentificador.error || porDocumento.error), ids };
}

export type CreateApoloEntityResult =
  | { autenticacao: string; entityId: string; ok: true; warnings: string[] }
  // entityIdExistente presente = o documento JÁ tem ficha; o caller pode redirecionar para ela em
  // vez de criar uma segunda (dedup — ver o incidente dos "dois Pedro Alexandro").
  | {
      entityIdExistente?: string;
      error: string;
      motivo?: MotivoDaRecusaDoCadastro;
      ok: false;
    };

// Codigo de autenticacao da CAD. A forca dele NAO esta no segredo: esta em ser gerado no
// SERVIDOR e ficar registrado na entidade -- conferir uma CAD e perguntar ao banco se o codigo
// existe e bate com aquela ficha. CAD forjada com codigo inventado nao acha par no banco.
// (Gerar isso no browser nao autenticaria nada: o forjador roda o mesmo codigo.)
export function gerarCodigoAutenticacao(entityId: string, criadoEm: Date): string {
  const hash = hashIdentifier("cad-autenticacao", entityId).slice(0, 8).toUpperCase();
  return `CAD-${criadoEm.getFullYear()}-${hash}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createApoloEntity(
  adminClient: AdminClient,
  input: CreateApoloEntityInput,
  opcoes: OpcoesDoCadastro = {},
): Promise<CreateApoloEntityResult> {
  // A porta de fora (portal do incorporador): aproveita a ficha existente sem trocar nada dela, e
  // nenhuma recusa devolve o id de ficha da Careli (ver `OpcoesDoCadastro.fichaExistente`).
  const acrescentar = opcoes.fichaExistente === "acrescentar";
  const isPj = input.persona === "pj";
  const identidade = input.identidade ?? {};
  const empresa = input.empresa ?? {};
  const perfil = input.perfil ?? {};
  const endereco = input.endereco ?? {};
  // Imobiliária: corretores válidos (nome + CPF) e empreendimentos vinculados (id do C2X).
  const corretores = (input.corretores ?? []).filter(
    (c) => text(c?.nome) && onlyDigits(c?.cpf).length === 11,
  );
  const empreendimentos = (input.empreendimentos ?? []).filter((e) => text(e?.id));

  const rawDoc = isPj ? empresa.cnpj : identidade.cpf;
  const digits = onlyDigits(rawDoc);
  const docKind = documentKind(digits); // 'cpf' | 'cnpj' | null

  const displayName = text(
    isPj ? empresa.razaoSocial || empresa.nomeFantasia : identidade.nome,
  );
  if (!displayName) {
    return {
      error: "Sem nome/razao social para criar a entidade.",
      motivo: "dados-invalidos",
      ok: false,
    };
  }
  if (!docKind) {
    return { error: "Documento (CPF/CNPJ) invalido ou ausente.", motivo: "dados-invalidos", ok: false };
  }

  // Modo anexo: id da ficha EXISTENTE (sem esteira) que vai receber esta CAD em vez de nascer
  // uma entidade nova. Preenchido pelo dedup abaixo.
  let anexarEm: string | null = null;
  // Todas as fichas do mesmo documento (as cópias do Asana inclusive). Ver a trava de e-mail único.
  let fichasDoMesmoDocumento: string[] = [];

  // DEDUP por documento (opt-in via input.dedupPorDocumento): a migration 0026 dropou o índice
  // único de document_hash e o INSERT abaixo é cego. Sem esta checagem o mesmo CPF/CNPJ vira DUAS
  // entidades — foi o incidente dos "dois Pedro Alexandro" (cadastro manual duplicando quem já
  // estava credenciado). Casa nas DUAS fontes: document_hash (quem nasce no Apolo) e
  // apolo_entity_identifiers (quem veio do sync/import).
  if (input.dedupPorDocumento) {
    // ⚠️ TODAS as fichas deste documento, nunca UMA.
    //
    // Até 12/08 aqui havia `.limit(1).maybeSingle()` nas duas pernas, e a trava conferia as CADs
    // de UMA ficha escolhida sem ordem nenhuma. Só que a MESMA PESSOA tem mais de uma ficha em
    // 516 casos na base: o import do Asana (paliativo, hoje descontinuado) criava uma cópia COM
    // `document_hash` e sem vínculo nenhum, enquanto a CAD ficava na outra, SEM hash. São 437
    // fichas soltas, todas com hash, contra 116 das 656 CADs reais.
    //
    // O efeito era perverso: a busca por hash caía justamente na cópia vazia, perguntava se ELA
    // tinha CAD naquele empreendimento, ouvia que não, e LIBERAVA a duplicata. Foi assim que
    // Lucélia, Ronaldo e Rafael entraram duas vezes no Vale do Ouro, cada um por uma imobiliária.
    // Ler todas as fichas conserta o furo mesmo com as cópias ainda na base.
    const fichas = await fichasDoDocumento(adminClient, docKind, digits);
    const idsDoDocumento = fichas.ids;
    fichasDoMesmoDocumento = idsDoDocumento;

    // ⚠️ QUEM ACRESCENTA (o portal) NÃO SEGUE ÀS CEGAS. Leitura que falhou pode estar escondendo a
    // ficha, e seguir criaria uma segunda ficha do mesmo CPF. O hub continua como sempre esteve
    // (lista vazia por erro segue), para esta regra não mudar o comportamento dele.
    if (acrescentar && fichas.falhou) {
      return {
        error:
          "Não foi possível verificar cadastros existentes agora. Tente novamente em instantes.",
        motivo: "verificacao-indisponivel",
        ok: false,
      };
    }

    const entityIdExistente = idsDoDocumento[0] ?? null;
    if (entityIdExistente) {
      // FICHA EXISTIR não é CAD EXISTIR (achado da revisão de 03/08): 3.920 CPFs vivem na base
      // vindos do sync C2X/backfill do Asana SEM nenhuma CAD — e o corretor tomava um 409 falso
      // ("já existe uma CAD") no último passo. A prova de CAD em andamento é a ESTEIRA:
      //   • com esteira  -> recusa VERDADEIRA (CAD em andamento; central resolve);
      //   • sem esteira  -> a CAD nova ANEXA na ficha existente (modo anexo, abaixo).
      // FAIL-CLOSED: se a leitura da esteira falhar (blip de rede, RLS), NÃO dá para afirmar que a
      // pessoa não tem CAD. Seguir em frente liberaria o upsert POR CIMA de uma CAD viva. "Não sei"
      // é tratado como "não libere": barra e pede pra tentar de novo, nunca segue às cegas.
      let cadsExistentes: {
        empreendimento: null | string;
        enterprise_id: null | string;
        entity_id: string;
      }[];
      try {
        // As CADs de TODAS as fichas deste documento, juntas. Ler só as de uma delas é o mesmo
        // furo de antes por outro caminho: a CAD viva pode estar na ficha que não foi lida.
        const porFicha = await Promise.all(
          idsDoDocumento.map((id) =>
            lerCadsDaEsteira<{
              empreendimento: null | string;
              enterprise_id: null | string;
              entity_id: string;
            }>(adminClient, id, "empreendimento, enterprise_id, entity_id"),
          ),
        );
        cadsExistentes = porFicha.flat();
      } catch {
        return recusaDaPorta(
          {
            entityIdExistente,
            error:
              "Não foi possível verificar cadastros existentes agora. Tente novamente em instantes.",
            motivo: "verificacao-indisponivel",
            ok: false,
          },
          acrescentar,
        );
      }

      // ✅ A CAD É POR EMPREENDIMENTO (regra do Lucas), e desde a migration 0080 a esteira
      // comporta isso: a chave passou de `entity_id` para `(entity_id, enterprise_id)`. Quem já
      // comprou no Vale do Ouro pode abrir CAD em outro loteamento sem passar pela central.
      //
      // O que a trava barra AGORA é só a duplicata de verdade: a MESMA pessoa mandando a MESMA
      // CAD para o MESMO empreendimento. CAD em outro loteamento passa direto e nasce como linha
      // própria — não sobrescreve nada da primeira.
      //
      // (Até 04/08 a trava era GLOBAL de propósito: com `entity_id` como chave primária, a
      // segunda CAD entrava por cima da primeira em silêncio — empreendimento, corretor,
      // imobiliária, origem e etapa da CAD antiga eram substituídos, e ela sumia do relatório do
      // empreendimento dela. Aquele motivo acabou junto com a chave antiga.)
      const alvoEnterpriseId = normalizarEnterpriseId(input.enterpriseId);
      const jaTemNesteEmpreendimento = alvoEnterpriseId
        ? cadsExistentes.find(
            (cad) => normalizarEnterpriseId(cad.enterprise_id) === alvoEnterpriseId,
          )
        : // SEM empreendimento no pedido não dá para dizer se é a mesma CAD ou outra, e liberar às
          // cegas recriaria o problema antigo por outro caminho. Aqui a trava continua global, de
          // propósito — mas este ramo é raro: o portal público exige o empreendimento (derivado do
          // token) e o wizard interno só grava esteira quando o operador escolheu um.
          (cadsExistentes[0] ?? null);

      if (jaTemNesteEmpreendimento) {
        const onde = jaTemNesteEmpreendimento.empreendimento?.trim();
        return recusaDaPorta(
          {
            // A ficha que REALMENTE tem a CAD, não a primeira da lista: é ela que a tela precisa
            // abrir quando o operador for conferir a duplicata.
            entityIdExistente: jaTemNesteEmpreendimento.entity_id,
            error:
              `Este ${docKind === "cnpj" ? "CNPJ" : "CPF"} já tem CAD cadastrada` +
              `${onde ? ` no empreendimento ${onde}` : ""}. ` +
              "Não precisa reenviar. Qualquer dúvida, fale com a central.",
            motivo: "cad-no-empreendimento",
            ok: false,
          },
          acrescentar,
        );
      }

      // Tem ficha e pode ter CAD em OUTRO empreendimento (ou nenhuma CAD): a CAD nova ANEXA na
      // ficha existente, em vez de nascer uma segunda entidade para o mesmo CPF. Quem ACRESCENTA
      // (o portal) entra pelo mesmo caminho: a diferença é o que a gravação escreve na ficha.
      //
      // Entre as cópias, anexa na que JÁ TEM esteira. Anexar na cópia vazia deixaria a pessoa com
      // CAD em duas fichas diferentes, que é exatamente a bagunça que esta trava veio desfazer.
      anexarEm = cadsExistentes[0]?.entity_id ?? entityIdExistente;
    }

    // NÚCLEO FAMILIAR: a trava acima é por documento e nunca ia pegar marido e mulher, que têm
    // CPFs diferentes. Esta olha o par {titular, cônjuge} contra o par de toda CAD do
    // empreendimento. Roda DEPOIS, porque a de documento é mais barata e mais específica.
    if (!isPj) {
      const conflito = await conflitoDeNucleoFamiliar({
        adminClient,
        cpfConjuge: input.conjuge?.cpf ?? null,
        cpfTitular: digits,
        enterpriseId: input.enterpriseId ?? null,
        // As fichas do próprio titular não contam: a CAD dele mesmo já foi avaliada acima.
        ignorarEntityIds: idsDoDocumento,
      });

      if (conflito) {
        return recusaDaPorta(
          {
            entityIdExistente: entityIdExistente ?? undefined,
            error: mensagemDeConflito(conflito),
            motivo: "nucleo-familiar",
            ok: false,
          },
          acrescentar,
        );
      }
    }
  }

  const ownerUserId =
    input.ownerUserId && UUID_RE.test(input.ownerUserId) ? input.ownerUserId : null;
  // No PJ o contato é da EMPRESA (empresa.email/telefone); no PF, do perfil. Sem isto o telefone
  // e o e-mail digitados no PJ não viravam contato e a ficha mostrava "-".
  const email = text(isPj ? empresa.email : perfil.email);

  // UM E-MAIL, UMA PESSOA. Lucas (07/09/2026): *"temos que travar bem travado o e-mail, não podemos
  // ter o mesmo e-mail para duas pessoas"* · *"esse e-mail tem que ser validado lá na hora que eu
  // estou subindo a cad"*.
  //
  // ⚠️ A ASSINATURA ELETRÔNICA IDENTIFICA A PESSOA PELO E-MAIL. No D4Sign não existe campo de nome
  // nem de CPF no signatário: o vínculo da rubrica e a chave do webhook são o endereço. Dois
  // signatários com o mesmo e-mail produzem um contrato assinado em que não se sabe quem assinou —
  // e isso não dá erro em lugar nenhum, sai no papel.
  //
  // ⚠️ FORA DO `if (dedupPorDocumento)` DE PROPÓSITO: aquele bloco é opt-in, e esta trava vale para
  // TODA porta de entrada de CAD (wizard interno, link público, imobiliária), que é o que o
  // "bem travado" pede. Roda depois das outras duas porque é a mais cara: consulta por texto.
  const conflitoEmail = await conflitoDeEmailRepetido({
    adminClient,
    email,
    // A própria ficha que esta CAD vai atualizar não conta contra ela mesma.
    //
    // (16/09/2026, revisão do conjunto) Quem ACRESCENTA ignora TODAS as fichas do mesmo documento: a
    // mesma pessoa tem ficha duplicada em 516 casos (a cópia do Asana), e o e-mail dela na cópia
    // barrava o cadastro da própria pessoa com "este e-mail já está em outro cadastro", confirmando
    // ainda que o e-mail existe na base da Careli. O hub e o link público seguem como eram.
    ignorarEntityIds: anexarEm
      ? acrescentar
        ? [...new Set([anexarEm, ...fichasDoMesmoDocumento])]
        : [anexarEm]
      : [],
  });

  if (conflitoEmail) {
    return recusaDaPorta(
      {
        entityIdExistente: conflitoEmail.donos[0]?.entityId,
        error: conflitoEmail.mensagem,
        motivo: "email-repetido",
        ok: false,
      },
      acrescentar,
    );
  }
  const telefone = text(isPj ? empresa.telefone : perfil.telefone);
  const location = { city: text(endereco.cidade), state: text(endereco.uf) };

  // Guarda o demografico/PJ que nao tem coluna propria no core do Apolo (o CAD detalhado vai
  // pro drive; aqui fica o essencial pra ficha e pro futuro write-back ao C2X).
  const cadastro = pruneEmpty({
    atividade: text(empresa.atividade),
    cnae: text(empresa.cnae),
    // CRECI Jurídico (imobiliária). corretores/empreendimentos ficam na metadata pra ficha corrida.
    creci: text(empresa.creci),
    corretores: corretores.map((c) => ({
      cpf: text(c.cpf),
      creci: text(c.creci),
      email: text(c.email),
      nome: text(c.nome),
      telefone: text(c.telefone),
    })),
    empreendimentos: empreendimentos.map((e) => ({ id: text(e.id), label: text(e.label) })),
    dataAbertura: text(empresa.dataAbertura),
    dataAtualizacaoCadastral: text(empresa.dataAtualizacao),
    dataNascimento: text(identidade.dataNascimento),
    escolaridadeId: text(perfil.escolaridadeId),
    estadoCivilId: text(perfil.estadoCivilId),
    nacionalidade: text(identidade.nacionalidade),
    naturalidade: text(identidade.naturalidade),
    naturezaJuridica: text(empresa.naturezaJuridica),
    nomeMae: text(identidade.nomeMae),
    nomePai: text(identidade.nomePai),
    orgaoEmissor: text(identidade.orgaoEmissor),
    patrimonio: text(perfil.patrimonio),
    porte: text(empresa.porte),
    profissaoId: text(perfil.profissaoId),
    // O que o cliente DECLAROU quando a profissão não estava na lista. Fica ao lado do id (nunca
    // dentro dele) e é o que a validação da CAD usa para padronizar — e o que sobrevive depois,
    // como observação, quando alguém já padronizou. `pruneEmpty` some com ele quando vazio.
    profissaoOutro: normalizarProfissaoLivre(perfil.profissaoOutro),
    regimeBensId: text(perfil.regimeBensId),
    rendaId: text(perfil.rendaId),
    sexoId: text(perfil.sexoId),
    situacaoCadastral: text(empresa.situacaoCadastral),
    // QSA lido do enriquecimento (informativo).
    qsa: (empresa.socios ?? []).filter((s) => text(s?.nome)),
    // Socios cadastrados de verdade (ficha + endereco + quem assina).
    socios: (input.socios ?? [])
      .filter((s) => text(s?.nome) || text(s?.cpf))
      .map((s) => ({
        cpf: text(s.cpf),
        dataNascimento: text(s.dataNascimento),
        email: text(s.email),
        endereco: pruneEmpty({
          bairro: text(s.endereco?.bairro),
          cep: text(s.endereco?.cep),
          cidade: text(s.endereco?.cidade),
          logradouro: text(s.endereco?.logradouro),
          numero: text(s.endereco?.numero),
          uf: text(s.endereco?.uf),
        }),
        estadoCivilId: text(s.estadoCivilId),
        nacionalidade: text(s.nacionalidade),
        naturalidade: text(s.naturalidade),
        nome: text(s.nome),
        nomeMae: text(s.nomeMae),
        representanteLegal: Boolean(s.representanteLegal),
        sexoId: text(s.sexoId),
        telefone: text(s.telefone),
      })),
  });

  // Só existe quando quem cadastra é de fora do hub (ver `OpcoesDoCadastro.autor`: vem da porta,
  // nunca do input). Vai nos DOIS caminhos, ficha nova e anexo, e também no registro do código de
  // autenticação lá embaixo, que regrava o metadata que ficou gravado.
  const autor = opcoes.autor ?? null;
  const cadastradoPor =
    autor && autor.origem === "portal"
      ? {
          cadastradoPor: {
            em: new Date().toISOString(),
            nome: text(autor.nome) || null,
            origem: autor.origem,
            slug: text(autor.slug),
            usuarioId: text(autor.usuarioId),
          },
        }
      : {};

  const entityRow = {
    display_name: displayName,
    document_hash: hashIdentifier(docKind, digits),
    document_kind: docKind,
    document_masked: formatDocument(digits),
    entity_kind: isPj ? "pj" : "pf",
    legal_name: isPj ? text(empresa.razaoSocial) || null : null,
    metadata: {
      bornRole: input.role,
      c2xSynced: false,
      cadastro,
      imobiliariaId: text(perfil.imobiliariaId) || null,
      origem: input.origem || "cadastro",
      source: "apolo",
      ...cadastradoPor,
    },
    owner_user_id: ownerUserId,
    primary_city: location.city || null,
    primary_state: location.state || null,
    quality_score: 0,
    status: "review",
    trade_name: isPj ? text(empresa.nomeFantasia) || null : null,
    workspace_id: "careli",
  };

  let entityId: string;
  // O metadata QUE FICOU GRAVADO na ficha, para o registro do código de autenticação lá embaixo
  // regravar por cima dele (e não por cima do `entityRow` da ficha nova, que no modo anexo nunca
  // foi gravado).
  let metadataGravado: Record<string, unknown> = entityRow.metadata;
  // A CAD entrou numa ficha que já existia pela porta que ACRESCENTA (o portal do incorporador).
  const acrescentouNaFicha = Boolean(anexarEm && acrescentar);
  // O código de autenticação que a ficha acrescentada ficou tendo (o dela, quando já tinha).
  let autenticacaoDaFicha: null | string = null;
  if (anexarEm && acrescentar) {
    // MODO ACRESCENTAR (decisão do Lucas, 16/09/2026): a ficha é da Careli e continua como está. Só
    // o metadata é regravado, e sem trocar nada (`metadataAcrescentado`); `display_name`, cidade,
    // dono e status ficam. A leitura é obrigatória e FAIL-CLOSED: update troca o jsonb inteiro, e
    // gravar sem ter lido apagaria a ficha.
    const { data: atual, error: leituraDaFicha } = await adminClient
      .from("apolo_entities")
      .select("metadata")
      .eq("id", anexarEm)
      .maybeSingle<{ metadata: Record<string, unknown> | null }>();
    if (leituraDaFicha || !atual) {
      return {
        error:
          "Não foi possível verificar cadastros existentes agora. Tente novamente em instantes.",
        motivo: "verificacao-indisponivel",
        ok: false,
      };
    }

    const metaAtual = atual.metadata ?? {};
    // ⚠️ O CÓDIGO QUE A FICHA JÁ TEM VENCE: a CAD antiga dela foi impressa com ele, e a CAD gerada
    // de novo (`cad-de-entidade.ts`) também usa o salvo. A CAD nova sai com o mesmo código.
    const registrado = text(
      (metaAtual.autenticacao as { codigo?: unknown } | null | undefined)?.codigo,
    );
    const agora = new Date();
    const informado = { email: email || null, telefone: telefone || null };
    const metadata = metadataAcrescentado(metaAtual, cadastro, {
      ...(informado.email || informado.telefone ? { contatoInformado: informado } : {}),
      em: agora.toISOString(),
      enterpriseId: normalizarEnterpriseId(input.enterpriseId),
      nome: text(autor?.nome) || null,
      origem: autor?.origem ?? (input.origem || "cadastro"),
      slug: text(autor?.slug) || null,
      usuarioId: text(autor?.usuarioId) || null,
    });
    const codigo = registrado || gerarCodigoAutenticacao(anexarEm, agora);
    if (!registrado) {
      metadata.autenticacao = { codigo, geradoEm: agora.toISOString() };
    }

    const { error: acrescimoError } = await adminClient
      .from("apolo_entities")
      .update({ metadata })
      .eq("id", anexarEm);
    if (acrescimoError) {
      return {
        error: `Nao foi possivel registrar a CAD na ficha existente: ${acrescimoError.message}`,
        motivo: "falha-ao-gravar",
        ok: false,
      };
    }
    entityId = anexarEm;
    metadataGravado = metadata;
    autenticacaoDaFicha = codigo;
  } else if (anexarEm) {
    // MODO ANEXO: a ficha já existe (veio do sync C2X / backfill, SEM CAD). A CAD entra nela.
    // O merge do metadata é OBRIGATÓRIO ler-antes-de-gravar (armadilha conhecida: update
    // substitui o jsonb INTEIRO): preserva `source`, `c2xSynced`, `c2xUserId` e tudo que a
    // ficha já carregava; só o `cadastro` novo entra por cima (é mais completo) e a origem
    // pública fica registrada.
    const { data: atual } = await adminClient
      .from("apolo_entities")
      .select("display_name, metadata")
      .eq("id", anexarEm)
      .maybeSingle<{ display_name: string | null; metadata: Record<string, unknown> | null }>();
    const metaAtual = atual?.metadata ?? {};
    const cadastroAtual =
      typeof metaAtual.cadastro === "object" && metaAtual.cadastro !== null
        ? (metaAtual.cadastro as Record<string, unknown>)
        : {};
    const metadataMesclado: Record<string, unknown> = {
      ...metaAtual,
      cadastro: { ...cadastroAtual, ...cadastro },
      origemCadPublica: input.origem || "cadastro",
      ...cadastradoPor,
    };
    const { error: anexoError } = await adminClient
      .from("apolo_entities")
      .update({
        display_name: atual?.display_name?.trim() ? atual.display_name : displayName,
        metadata: metadataMesclado,
      })
      .eq("id", anexarEm);
    if (anexoError) {
      return {
        error: `Nao foi possivel anexar a CAD na ficha existente: ${anexoError.message}`,
        motivo: "falha-ao-gravar",
        ok: false,
      };
    }
    entityId = anexarEm;
    metadataGravado = metadataMesclado;
  } else {
    const { data: created, error: entityError } = await adminClient
      .from("apolo_entities")
      .insert(entityRow)
      .select("id")
      .single<{ id: string }>();

    if (entityError || !created?.id) {
      return {
        error: `Nao foi possivel criar a entidade: ${entityError?.message ?? "sem id"}`,
        motivo: "falha-ao-gravar",
        ok: false,
      };
    }

    entityId = created.id;
  }
  const autenticacao = autenticacaoDaFicha ?? gerarCodigoAutenticacao(entityId, new Date());
  const warnings: string[] = [];
  const warn = (label: string, error: { message?: string } | null) => {
    if (error) {
      warnings.push(`${label}: ${error.message ?? "falha"}`);
    }
  };

  // Papel de nascimento (prospect etc). Precisa do enum atualizado (migration 0051 pra prospect).
  const profileRows = [
    { entity_id: entityId, profile: input.role, status: "active" },
  ];

  // Identificadores (doc + email + telefone) com o MESMO hash do sync (dedup por documento).
  const identifierRows: Array<Record<string, unknown>> = [
    identifierRow(entityId, docKind, digits, formatDocument(digits), true),
  ];
  if (email) {
    identifierRows.push(
      identifierRow(entityId, "email", email.toLowerCase(), maskEmail(email), false),
    );
  }
  if (onlyDigits(telefone)) {
    identifierRows.push(
      identifierRow(entityId, "phone", onlyDigits(telefone), maskPhone(telefone), false),
    );
  }

  const contactRows: Array<Record<string, unknown>> = [];
  if (email) {
    contactRows.push({
      contact_type: "email",
      entity_id: entityId,
      is_primary: true,
      metadata: { source: "apolo" },
      normalized_value: email.toLowerCase(),
      status: "pending",
      value: email,
    });
  }
  if (telefone) {
    contactRows.push({
      contact_type: "phone",
      entity_id: entityId,
      is_primary: true,
      metadata: { source: "apolo" },
      normalized_value: onlyDigits(telefone),
      status: "pending",
      value: telefone,
    });
  }

  const addressRows: Array<Record<string, unknown>> = [];
  if (text(endereco.logradouro) || text(endereco.cep) || location.city) {
    addressRows.push({
      city: location.city || null,
      complement: text(endereco.complemento) || null,
      country: "BR",
      district: text(endereco.bairro) || null,
      entity_id: entityId,
      is_primary: true,
      label: "Principal",
      metadata: { source: "apolo" },
      number: text(endereco.numero) || null,
      postal_code: text(endereco.cep) || null,
      state: location.state || null,
      status: "pending",
      street: text(endereco.logradouro) || null,
    });
  }

  const relationshipRows: Array<Record<string, unknown>> = [];
  const conjugeNome = text(input.conjuge?.nome);
  if (conjugeNome) {
    relationshipRows.push({
      entity_id: entityId,
      label: conjugeNome,
      metadata: {
        cpf: text(input.conjuge?.cpf) || null,
        createdBy: ownerUserId,
        // A FICHA COMPLETA do cônjuge mora aqui (23/08): o wizard sempre coletou tudo, mas só
        // cpf/email/phone sobreviviam — nascimento, mãe, sexo, renda, escolaridade, profissão,
        // patrimônio e naturalidade morriam neste insert e a validação abria vazia (o dado
        // sobrevivia apenas no PDF da CAD). "Tem que subir tudo, documentos, dados, tudo" (Lucas).
        dataNascimento: text(input.conjuge?.dataNascimento) || null,
        email: text(input.conjuge?.email) || null,
        escolaridadeId: text(input.conjuge?.escolaridadeId) || null,
        kind: "contato",
        nacionalidade: text(input.conjuge?.nacionalidade) || null,
        naturalidade: text(input.conjuge?.naturalidade) || null,
        nomeMae: text(input.conjuge?.nomeMae) || null,
        patrimonio: text(input.conjuge?.patrimonio) || null,
        phone: text(input.conjuge?.telefone) || null,
        profissaoId: text(input.conjuge?.profissaoId) || null,
        profissaoOutro: normalizarProfissaoLivre(input.conjuge?.profissaoOutro) || null,
        rendaId: text(input.conjuge?.rendaId) || null,
        sexoId: text(input.conjuge?.sexoId) || null,
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "conjuge",
      status: "verified",
    });
  }
  // Cada sócio (PJ) vira um relacionamento de CONTATO — aparece na aba Relacionamentos. Quem
  // assina pela empresa é marcado no nível.
  for (const socio of input.socios ?? []) {
    const nome = text(socio.nome);
    if (!nome) continue;
    relationshipRows.push({
      entity_id: entityId,
      label: nome,
      metadata: {
        cpf: text(socio.cpf) || null,
        createdBy: ownerUserId,
        email: text(socio.email) || null,
        kind: "contato",
        phone: text(socio.telefone) || null,
        role: socio.representanteLegal ? "representante legal" : "socio",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: socio.representanteLegal ? "representante_legal" : "socio",
      status: "verified",
    });
  }

  const imobiliariaId = text(perfil.imobiliariaId);
  const imobiliariaLabel = text(perfil.imobiliariaLabel);
  if (imobiliariaId || imobiliariaLabel) {
    relationshipRows.push({
      entity_id: entityId,
      label: imobiliariaLabel || "Imobiliaria",
      metadata: { createdBy: ownerUserId, kind: "trabalho", role: "imobiliaria", source: "apolo" },
      related_entity_id: UUID_RE.test(imobiliariaId) ? imobiliariaId : null,
      relationship_type: "imobiliaria",
      status: "verified",
    });
  }

  // Cada corretor da imobiliária vira um relacionamento de CONTATO (aparece na aba Relacionamentos).
  for (const corretor of corretores) {
    relationshipRows.push({
      entity_id: entityId,
      label: text(corretor.nome),
      metadata: {
        cpf: text(corretor.cpf) || null,
        createdBy: ownerUserId,
        creci: text(corretor.creci) || null,
        email: text(corretor.email) || null,
        kind: "contato",
        phone: text(corretor.telefone) || null,
        role: "corretor",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "corretor",
      status: "verified",
    });
  }

  // Cada empreendimento vinculado vira um relacionamento de TRABALHO. O empreendimento é do C2X
  // (não é entidade Apolo), então guardamos o id/rótulo na metadata e related_entity_id fica null.
  for (const emp of empreendimentos) {
    relationshipRows.push({
      entity_id: entityId,
      label: text(emp.label) || "Empreendimento",
      metadata: {
        createdBy: ownerUserId,
        enterpriseId: text(emp.id) || null,
        kind: "trabalho",
        role: "empreendimento",
        source: "apolo",
      },
      related_entity_id: null,
      relationship_type: "empreendimento",
      status: "verified",
    });
  }

  const searchRow = {
    display_name: displayName,
    document_masked: formatDocument(digits),
    entity_id: entityId,
    entity_kind: isPj ? "pj" : "pf",
    last_synced_at: new Date().toISOString(),
    location_label: [location.city, location.state].filter(Boolean).join(" - ") || null,
    metadata: { source: "apolo" },
    normalized_text: normalizeSearchText(
      [
        displayName,
        isPj ? text(empresa.nomeFantasia) : null,
        formatDocument(digits),
        location.city,
        location.state,
        ROLE_SEARCH_LABEL[input.role],
        // Na ficha que já existia, o índice de busca não aprende telefone nem e-mail que o portal
        // digitou (a busca por contato também acha a pessoa; ver `linhasQueFaltamNaFicha`).
        acrescentouNaFicha ? null : email,
        acrescentouNaFicha ? null : telefone,
        imobiliariaLabel,
      ]
        .filter(Boolean)
        .join(" "),
    ),
    profile_labels: [ROLE_LABEL[input.role]],
    quality_score: 0,
    status: "review",
  };

  // MODO ACRESCENTAR: só o que a ficha não tem do mesmo tipo (ver `linhasQueFaltamNaFicha`). As
  // leituras são por ficha (poucas linhas cada), e a de relacionamentos só dos tipos que esta CAD
  // traria. Leitura que falha não insere nada daquela tabela e vira aviso.
  let linhas = {
    contatos: contactRows,
    enderecos: addressRows,
    identificadores: identifierRows,
    relacionamentos: relationshipRows,
  };
  if (acrescentouNaFicha) {
    const tiposDeRelacionamento = [
      ...new Set(relationshipRows.map((linha) => String(linha.relationship_type))),
    ];
    const [contatosDaFicha, enderecosDaFicha, identificadoresDaFicha, relacionamentosDaFicha] =
      await Promise.all([
        adminClient.from("apolo_contacts").select("contact_type").eq("entity_id", entityId),
        adminClient.from("apolo_addresses").select("id").eq("entity_id", entityId).limit(1),
        adminClient
          .from("apolo_entity_identifiers")
          .select("identifier_type")
          .eq("entity_id", entityId),
        // ⚠️ VÍNCULO ARQUIVADO NÃO É "A FICHA JÁ TEM" (revisão de 24/09/2026). Arquivar é o jeito
        // de o time tirar um vínculo da ficha (e o Mover CAD arquiva o do empreendimento de
        // origem). Contar a linha arquivada aqui fazia a CAD nova, que traz o MESMO vínculo, nascer
        // sem ele: a ficha ficava só com a linha arquivada, como se ninguém o tivesse trazido de
        // volta. `status` é NOT NULL (default 'pending'), então o `neq` não perde linha sem status.
        // ⚠️ Isto NÃO cria vínculo de EMPREENDIMENTO para a CAD do portal: o portal e o wizard do hub
        // não mandam `empreendimentos` para prospect. Medido em 24/09/2026: só as 172 CADs
        // publico-cad têm vínculo de empreendimento (0 das 38 cadastro-manual, 0 das 575 asana).
        tiposDeRelacionamento.length
          ? adminClient
              .from("apolo_relationships")
              .select("label, related_entity_id, relationship_type")
              .eq("entity_id", entityId)
              .in("relationship_type", tiposDeRelacionamento)
              .neq("status", "archived")
          : Promise.resolve({ data: [], error: null }),
      ]);
    warn("contatos", contatosDaFicha.error);
    warn("endereco", enderecosDaFicha.error);
    warn("identificadores", identificadoresDaFicha.error);
    warn("relacionamentos", relacionamentosDaFicha.error);

    linhas = linhasQueFaltamNaFicha(linhas, {
      contatos: contatosDaFicha.error
        ? null
        : ((contatosDaFicha.data ?? []) as Array<{ contact_type: null | string }>),
      enderecos: enderecosDaFicha.error ? null : ((enderecosDaFicha.data ?? []) as unknown[]),
      identificadores: identificadoresDaFicha.error
        ? null
        : ((identificadoresDaFicha.data ?? []) as Array<{ identifier_type: null | string }>),
      relacionamentos: relacionamentosDaFicha.error
        ? null
        : ((relacionamentosDaFicha.data ?? []) as Array<{
            label: null | string;
            related_entity_id: null | string;
            relationship_type: null | string;
          }>),
    });
  }

  // (24/09/2026) A HABILITAÇÃO PELO CADASTRO INTERNO. Só com a porta do hub ligando e só para a
  // imobiliária (ver `OpcoesDoCadastro.habilitacaoInterna`). Aqui se decide, ANTES de gravar, o que é
  // habilitação nova: na ficha que já existia, o vínculo que ela já tem `verified` sai das linhas
  // (nem é gravado de novo nem avisado) e o papel dela diz se é a primeira vez.
  let habilitacaoNova: null | {
    empreendimentos: Array<{ enterpriseId: string; label: string }>;
    primeiraVez: boolean;
  } = null;
  const vinculosDeEmpreendimento = linhas.relacionamentos.filter(
    (linha) => linha.relationship_type === "empreendimento",
  );
  if (
    opcoes.habilitacaoInterna === true &&
    input.role === "imobiliaria" &&
    vinculosDeEmpreendimento.length > 0
  ) {
    let jaHabilitados: string[] = [];
    // Ficha nova não tinha papel nenhum: é a primeira vez dela com a Careli.
    let primeiraVez = !anexarEm;
    if (anexarEm) {
      const [vinculosDaFicha, papelDaFicha] = await Promise.all([
        adminClient
          .from("apolo_relationships")
          .select("metadata")
          .eq("entity_id", entityId)
          .eq("relationship_type", "empreendimento")
          .eq("status", "verified")
          .limit(1000),
        adminClient
          .from("apolo_entity_profiles")
          .select("status")
          .eq("entity_id", entityId)
          .eq("profile", "imobiliaria")
          .maybeSingle<{ status: null | string }>(),
      ]);
      // ⚠️ LEITURA QUE FALHA NÃO CALA O AVISO. Sem saber o que a ficha tinha, tudo é tratado como novo
      // (gravado como sempre foi, e avisado): o pior caso é um aviso repetido ao coordenador, que se
      // vê, contra uma habilitação que ninguém fica sabendo, que não se vê.
      warn("vinculos da ficha", vinculosDaFicha.error);
      jaHabilitados = vinculosDaFicha.error
        ? []
        : ((vinculosDaFicha.data ?? []) as Array<{ metadata: { enterpriseId?: unknown } | null }>)
            .map((linha) => String(linha.metadata?.enterpriseId ?? "").trim())
            .filter(Boolean);
      // Papel ilegível numa ficha que já existia: "já trabalha com a gente" é o palpite menos errado
      // (as fichas que o wizard reaproveita vêm quase todas do C2X, com o papel ativo).
      primeiraVez = !papelDaFicha.error && papelDaFicha.data?.status !== "active";
    }

    const expandir = await expansorDeEmpreendimentos([
      ...jaHabilitados,
      ...vinculosDeEmpreendimento.map((linha) =>
        String((linha.metadata as { enterpriseId?: unknown } | undefined)?.enterpriseId ?? ""),
      ),
    ]);
    const separados = separarVinculosNovos(linhas.relacionamentos, jaHabilitados, expandir);
    linhas = { ...linhas, relacionamentos: separados.relacionamentos };
    habilitacaoNova = { empreendimentos: separados.novos, primeiraVez };
  }

  // Secundarios: best-effort (a entidade ja existe em status 'review'; falhas viram warning pra
  // o operador revisar, sem perder o cadastro). Espelha o estilo best-effort do sync.
  //
  // No modo ACRESCENTAR os upserts viram "insere se faltar" (`ignoreDuplicates`): o papel prospect
  // que já existe não volta para `active` (podia estar `blocked`), e o índice de busca da ficha não
  // perde o nome, os rótulos de papel e o status que já tinha.
  const [profileRes, identifierRes, contactRes, addressRes, relationshipRes, searchRes] =
    await Promise.all([
      adminClient.from("apolo_entity_profiles").upsert(profileRows, {
        ignoreDuplicates: acrescentouNaFicha,
        onConflict: "entity_id,profile",
      }),
      linhas.identificadores.length
        ? adminClient.from("apolo_entity_identifiers").upsert(linhas.identificadores, {
            ignoreDuplicates: acrescentouNaFicha,
            onConflict: "entity_id,identifier_type,value_hash",
          })
        : noop(),
      linhas.contatos.length ? adminClient.from("apolo_contacts").insert(linhas.contatos) : noop(),
      linhas.enderecos.length ? adminClient.from("apolo_addresses").insert(linhas.enderecos) : noop(),
      linhas.relacionamentos.length
        ? adminClient.from("apolo_relationships").insert(linhas.relacionamentos)
        : noop(),
      adminClient.from("apolo_search_entries").upsert([searchRow], {
        ignoreDuplicates: acrescentouNaFicha,
        onConflict: "entity_id",
      }),
    ]);

  warn("papel", profileRes.error);
  warn("identificadores", identifierRes.error);
  warn("contatos", contactRes.error);
  warn("endereco", addressRes.error);
  warn("relacionamentos", relationshipRes.error);
  warn("indice de busca", searchRes.error);

  // AUDITA E AVISA O COORDENADOR da habilitação nova, DEPOIS de gravar e só se os vínculos entraram:
  // vínculo recusado pelo banco não habilitou nada. Best-effort: `registrarHabilitacaoPeloCadastro`
  // não lança, e `depoisDaResposta` é a segunda trava, porque o cadastro já está gravado e não pode
  // virar erro.
  //
  // ⚠️ DEPOIS DA RESPOSTA, NÃO ANTES (revisão de 24/09/2026). O aviso lê o coordenador (às vezes no
  // C2X) e manda pelo Evolution, que tem teto de 30 s: dentro do salvamento, o gateway lento segurava o
  // operador na tela sem nada para mostrar, porque o resultado do aviso não volta para ela. O disparo
  // fica registrado em `apolo_disparos`, que é onde a tela de status lê.
  if (habilitacaoNova && habilitacaoNova.empreendimentos.length > 0 && !relationshipRes.error) {
    const avisoDaHabilitacao = {
      autorUserId: ownerUserId,
      cnpj: docKind === "cnpj" ? formatDocument(digits) : null,
      empreendimentos: habilitacaoNova.empreendimentos,
      entityId,
      imobiliaria: displayName,
      primeiraVez: habilitacaoNova.primeiraVez,
    };
    await depoisDaResposta(
      () => registrarHabilitacaoPeloCadastro(adminClient, avisoDaHabilitacao),
      "[cadastro] falha no aviso da habilitacao",
    );
  }

  // Registra o codigo na entidade: e o que permite conferir a CAD depois.
  //
  // ⚠️ POR CIMA DO QUE FICOU GRAVADO (revisão da onda 3, 16/09/2026). Até aqui este update espalhava
  // `entityRow.metadata`, o metadata de uma ficha NOVA. No modo anexo isso apagava o merge feito
  // logo acima: a ficha que veio do sync do C2X perdia `source`, `c2xSynced` e `c2xUserId` no
  // último passo do cadastro (update troca o jsonb inteiro). Valia para o hub, o público e o portal.
  //
  // No modo ACRESCENTAR o código já foi para a ficha na mesma gravação do metadata (e só quando ela
  // não tinha um): nada a regravar aqui.
  if (!acrescentouNaFicha) {
    const { error: autenticacaoError } = await adminClient
      .from("apolo_entities")
      .update({
        metadata: {
          ...metadataGravado,
          autenticacao: { codigo: autenticacao, geradoEm: new Date().toISOString() },
        },
      })
      .eq("id", entityId);
    warn("codigo de autenticacao", autenticacaoError);
  }

  return { autenticacao, entityId, ok: true, warnings };
}

// Rotulo de papel para busca/exibicao (o enum nao carrega label).
const ROLE_LABEL: Record<ApoloBirthRole, string> = {
  colaborador: "Colaborador",
  corretor: "Corretor",
  fornecedor: "Fornecedor",
  imobiliaria: "Imobiliaria",
  incorporador: "Incorporador",
  parceiro: "Parceiro",
  prospect: "Prospect",
};
const ROLE_SEARCH_LABEL = ROLE_LABEL;

function identifierRow(
  entityId: string,
  type: string,
  rawValue: string,
  masked: string,
  isPrimary: boolean,
): Record<string, unknown> {
  return {
    confidence_score: 90,
    entity_id: entityId,
    identifier_type: type,
    is_primary: isPrimary,
    metadata: { source: "apolo" },
    source_system: "apolo",
    value_hash: hashIdentifier(type, rawValue),
    value_masked: masked,
  };
}

async function noop(): Promise<{ error: null }> {
  return { error: null };
}

// ---- helpers (espelham o sync; masks/normalize sao so display/busca) -----------------------

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) ? value.length : value) {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

function onlyDigits(value: string | null | undefined): string {
  return value?.replace(/\D/g, "") ?? "";
}

function documentKind(digits: string): "cnpj" | "cpf" | null {
  if (digits.length === 11) return "cpf";
  if (digits.length === 14) return "cnpj";
  return null;
}

// Documento COMPLETO formatado (não mascarado). O Serasa consulta a partir de
// `document_masked` e a esteira inteira (crédito -> pré-venda) depende disso; guardar só os 2
// últimos dígitos travava a análise ("A ficha nao tem CPF completo", incidente 22/jul com a
// primeira CAD real do portal). Decisão do Lucas 22/jul: o CPF/CNPJ fica legível na ficha, no
// mesmo formato das CADs importadas do Asana. O nome `document_masked` da coluna é histórico;
// o conteúdo agora é o número inteiro.
function formatDocument(digits: string): string {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return "Documento em revisao";
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "E-mail em revisao";
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "Telefone em revisao";
  return `(**) *****-**${digits.slice(-2)}`;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
