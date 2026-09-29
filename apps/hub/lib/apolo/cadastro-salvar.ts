import { PDFDocument } from "pdf-lib";

import {
  COMPROVANTE_RENDA_LABELS,
  validarCamposMinimos,
  validarDocumentosObrigatorios,
} from "@/lib/apolo/cadastro-obrigatorios";
import {
  createApoloEntity,
  type ApoloBirthRole,
  type AutorDeForaDoHub,
  type CreateApoloEntityInput,
  type CreateApoloEntityResult,
  type GeradorDoCodigoDoCorretor,
  type OpcoesDoCadastro,
} from "@/lib/apolo/cadastro-persist";
import { formatoDoCadastro } from "@/lib/apolo/cadastro-tipos";
import { proximoCodigoDoCorretor } from "@/lib/apolo/codigo-do-corretor";
import {
  APOLO_DOC_MAX_BYTES,
  MENSAGEM_DOCUMENTO_GRANDE,
  caminhoUploadDiretoValido,
  documentoTemArquivo,
  lerDocumentoDoStorage,
  removerDocumentoDoStorage,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
import { nomeDeMercadoDoEmpreendimento } from "@/lib/apolo/empreendimento-de-mercado";
import { exigeComprovanteRenda } from "@/lib/apolo/enterprise-settings";
import {
  type Autonomo,
  conferirHabilitacaoDoAutonomo,
  MENSAGEM_NAO_E_AUTONOMO,
} from "@/lib/apolo/habilitacao-do-autonomo";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { montarCadPdf, type CadDoc } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// O SALVAR DO CADASTRO — UMA FUNÇÃO, DUAS PORTAS.
//
// Fecha o ciclo do cadastro: cria a ENTIDADE (papel de nascimento) e salva no drive os documentos
// anexados + o CAD em PDF. Até 16/09/2026 tudo isto morava dentro de /api/apolo/cadastro/salvar. O
// Lucas decidiu (16/09/2026) que a equipe da Cecílio *cadastra cliente novo pelo CRM do portal*, com
// as MESMAS regras do hub (campos, documentos obrigatórios, uma ficha por pessoa). Copiar a rota
// para o portal seria ter duas travas de obrigatórios que um dia discordam, que é exatamente o
// incidente de 04/08. Então a regra mora aqui e as duas rotas chamam esta função:
//   • /api/apolo/cadastro/salvar            → o operador da Careli (Bearer do hub);
//   • /api/incorporador/crm/cadastro/salvar → o time do incorporador (cookie do portal), que antes
//     confere produto e imobiliária em `lib/apolo/incorporador/cadastro-do-portal.ts`.
//
// ⚠️ O QUE MUDA ENTRE AS PORTAS NÃO É REGRA, É QUEM ESTÁ DO OUTRO LADO: o dono do staging do upload
// direto, o nome que vai para o drive, o `owner_user_id` e a origem gravada. Tudo isso entra pelo
// `autor` e pelas origens. A RESPOSTA também não mora aqui: cada rota traduz o resultado, porque a
// recusa que o hub mostra inteira (nome do empreendimento, id da ficha existente) não pode sair
// para gente de fora da Careli.
//
// Ver [[project_apolo_cadastro_prospect]].

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// So o processo do PROSPECT esta ligado; os demais papeis entram quando cada processo existir.
// ⚠️ A IMOBILIÁRIA CADASTRADA AQUI NASCE CREDENCIADA, e isso é REGRA, não esquecimento.
//
// Decisão do Lucas (17/08/2026): "cadastro feito pelo operador vale já como validação". Quem
// preenche este wizard é gente da Careli, com os documentos na mão — mandá-la para a fila de
// validação seria pedir que alguém revalide o que a própria casa acabou de conferir.
//
// Por isso este caminho NÃO rebaixa o papel, ao contrário dos dois portais PÚBLICOS
// (/api/publico/imobiliaria/cadastro e /credenciar), onde quem preenche é a própria imobiliária:
// lá o papel nasce `review` e os vínculos `pending` de propósito, e a liberação passa pela
// validação humana no Board.
//
// Uma revisão automática já apontou isto como defeito ("nasce credenciada sem validação"). Não é:
// a diferença entre os dois caminhos é QUEM preencheu. (O portal do incorporador só cadastra
// PROSPECT: a imobiliária credenciada fica fora do alcance dele, ver `cadastro-do-portal.ts`.)
//
// ⚠️ O CORRETOR AUTÔNOMO ENTROU EM 27/09/2026. Decisão do Lucas: *"Preciso cadastrar corretor
// autonomo, tipo, ele nao sera vinculado a uma imobiliaria, ele sera uma entidade. Quem fara esse
// cadastro e time nosso interno. precisa tudo no apolo para receber essa nova entidade"*.
//
// A camada de baixo já aceitava o papel (`ApoloBirthRole` e o CHECK de `apolo_entity_profiles` têm
// `corretor`, e nenhuma coluna de `apolo_entities` é NOT NULL para imobiliária — medido em
// 27/09/2026: 9 colunas NOT NULL, nenhuma delas de vínculo). O que não existia era a PORTA: esta
// lista recusava com 400 antes de gravar, e `CADASTRO_TIPOS` não tinha o tipo, então
// `/apolo/cadastro?tipo=corretor` abria o cadastro de CLIENTE em silêncio.
//
// ⚠️ ELE NASCE COM CÓDIGO PRÓPRIO E SEM IMOBILIÁRIA. O código vem da sequência do banco (ver
// `proximoCodigoDoCorretor` mais abaixo) e é o que diz que a pessoa é autônoma — Lucas: *"assim
// saberemos que ele e autonomo"*, e ele aparece *"somente no CRM"*.
const ENABLED_ROLES: ApoloBirthRole[] = ["prospect", "imobiliaria", "corretor"];

// Um documento pode ter varios arquivos (RG frente+verso, contrato social com N paginas) e o PJ
// ainda soma 2 documentos por socio -- uma empresa com 4 socios ja passa de 20.
const MAX_FILES = 40;
const MAX_BASE64_LENGTH = 28_000_000; // ~20MB por arquivo

// Categoria (document_type) -> rotulo legivel usado na nomeacao "Nome + categoria".
const CATEGORIA_LABEL: Record<string, string> = {
  cad: "CAD",
  certidao: "Certidão",
  comprovante_endereco: "Comprovante de endereço",
  // As TRÊS formas do comprovante de renda: o rótulo carrega a forma entregue (extrato bancário /
  // contracheque / imposto de renda), que é o que a aba Documentos da ficha mostra.
  ...COMPROVANTE_RENDA_LABELS,
  contrato_social: "Contrato social",
  identificacao: "Identificação",
  identificacao_conjuge: "Identificação (cônjuge)",
  outros: "Outros",
  renda: "Renda",
};

// Documentos de socio carregam o indice na categoria ("identificacao_socio_2"): cada socio vira
// UM arquivo no drive. Sem o indice, o agrupamento por categoria fundiria os documentos de
// todos os socios num PDF so.
const SOCIO_CATEGORIA_RE = /^(identificacao|comprovante)_socio_(\d+)$/;

function rotuloCategoria(categoria: string): string {
  const socio = SOCIO_CATEGORIA_RE.exec(categoria);
  if (socio) {
    const tipo = socio[1] === "identificacao" ? "Identificação" : "Comprovante de endereço";
    return `${tipo} (sócio ${socio[2]})`;
  }
  return CATEGORIA_LABEL[categoria] ?? "Documento";
}

// Teto para JUNTAR paginas baixando do Storage (gemeo do de lib/apolo/cadastro-upload.ts).
const TETO_JUNCAO_BYTES = 24 * 1024 * 1024;

export type IncomingDoc = {
  categoria?: string;
  extractedPayload?: unknown;
  // Documento PEQUENO: o arquivo vem em base64 dentro do JSON (fluxo de sempre).
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  // Documento GRANDE: o browser ja gravou no bucket (via /upload-url da porta) e manda so a
  // referencia. A Vercel corta o corpo em ~4,5MB, entao acima disso nao ha como viajar aqui.
  sizeBytes?: number;
  storagePath?: string;
};

// A CAD chega como ESTRUTURA (seções), não como PDF pronto: o PDF é montado aqui, no servidor,
// já com o código de autenticação impresso. Se o browser mandasse o PDF, o código não valeria
// nada (o forjador geraria o dele).
export type SalvarPayload = CreateApoloEntityInput & {
  cad?: Omit<CadDoc, "autenticacao"> | null;
  documentos?: IncomingDoc[];
  // Vínculo escolhido no wizard (imobiliária -> empreendimento -> corretor). A imobiliária vem em
  // perfil.imobiliariaId; aqui vêm o empreendimento e o corretor. Grava a esteira igual ao portal
  // público, para a CAD manual NÃO nascer órfã de empreendimento.
  vinculo?: {
    /**
     * O CORRETOR AUTÔNOMO como VÍNCULO da CAD, no lugar da imobiliária (fatia 2, 28/09/2026).
     *
     * ⚠️ É A ENTIDADE DO AUTÔNOMO (`apolo_entities.id`), e ela ocupa `apolo_esteira.corretor_entity_id`,
     * NUNCA `imobiliaria_entity_id`. Medido em produção em 28/09/2026: `imobiliaria_entity_id` aponta
     * para PJ em 100% das 357 linhas preenchidas e `corretor_entity_id` para PF em 186 de 186. Pôr o
     * autônomo no slot da imobiliária seria o primeiro PF ali, e é literalmente o que o Lucas proibiu
     * em 27/09/2026: *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria"*.
     *
     * ⚠️ E ELE É EXCLUSIVO COM `perfil.imobiliariaId`: uma CAD tem UM vínculo (ver a barra na porta).
     */
    corretorAutonomoEntityId?: string;
    corretorEmail?: string;
    corretorEntityId?: string;
    corretorNome?: string;
    empreendimentoNome?: string;
    enterpriseId?: string;
  };
};

/** Quem está salvando, no que a regra precisa saber dele. */
export type AutorDoSalvar = {
  /**
   * O dono do staging do upload direto (`donoUploadOperador` no hub). O /salvar só aceita caminho
   * que ESTE dono recebeu em /upload-url: sem isso um corpo forjado apontaria a linha do documento
   * para o arquivo de outra pessoa.
   */
  donoUpload: string;
  /**
   * O nome que vai para `uploaded_by_name`. É FUNÇÃO porque o hub resolve no `hub_users`, e resolve
   * DEPOIS das validações, como sempre fez: corpo inválido não custa consulta.
   */
  nome: () => Promise<null | string>;
  /** `hub_users.id` do operador. Nulo quando quem cadastra não é usuário do hub. */
  ownerUserId: null | string;
  /** Autoria gravada na ficha quando quem cadastra é de fora do hub (ver `OpcoesDoCadastro`). */
  registro: AutorDeForaDoHub | null;
};

export type SalvarCadastroInput = {
  adminClient: AdminClient;
  autor: AutorDoSalvar;
  /**
   * O que fazer quando o documento JÁ TEM ficha (sem CAD neste empreendimento). Padrão `anexar`, o
   * de sempre no hub. O portal do incorporador passa `acrescentar`: a CAD entra na mesma ficha sem
   * trocar nada do que ela tem (ver `OpcoesDoCadastro`).
   */
  fichaExistente?: OpcoesDoCadastro["fichaExistente"];
  /** `apolo_esteira.origem` da CAD que entra na fila por aqui. */
  origemDaEsteira: string;
  /** `metadata.origem` da ficha quando o corpo não manda uma. */
  origemPadrao: string;
  payload: SalvarPayload;
};

/** O corpo de sucesso, no formato que o wizard lê (`SalvarResposta` em cadastro-flow.tsx). */
export type CadastroSalvo = {
  autenticacao: string;
  cadBase64: null | string;
  entityId: string;
  ok: true;
  savedDocs: string[];
  warnings: string[];
};

/**
 * O que aconteceu com a ESTEIRA (a fila do board):
 *   • `gravada`     → a CAD entrou na fila de validação;
 *   • `falhou`      → tentou e o banco recusou (o motivo foi para `warnings`);
 *   • `sem-vinculo` → não tentou: falta empreendimento, ou falta o vínculo (imobiliária OU corretor
 *                     autônomo habilitado). ⚠️ O autônomo NÃO HABILITADO nem chega aqui: a porta
 *                     recusa com 400 antes de criar a ficha (fatia 2, 28/09/2026).
 */
export type EsteiraDoSalvar = "falhou" | "gravada" | "sem-vinculo";

export type ResultadoDoSalvarCadastro =
  | { corpo: CadastroSalvo; esteira: EsteiraDoSalvar; ok: true }
  /** Corpo recusado ANTES de gravar qualquer coisa (400/413). A frase é da regra, sem terceiros. */
  | { error: string; ok: false; status: number; tipo: "invalido" }
  /** A ficha não nasceu: dedup, núcleo familiar, e-mail repetido ou falha de gravação. */
  | { ok: false; recusa: Extract<CreateApoloEntityResult, { ok: false }>; tipo: "recusado" };

export async function salvarCadastroDoApolo(
  input: SalvarCadastroInput,
): Promise<ResultadoDoSalvarCadastro> {
  const { adminClient, autor, payload } = input;
  const invalido = (error: string, status: number): ResultadoDoSalvarCadastro => ({
    error,
    ok: false,
    status,
    tipo: "invalido",
  });

  const role = payload.role;
  if (!role || !ENABLED_ROLES.includes(role)) {
    return invalido("Processo de cadastro ainda nao disponivel para este papel.", 400);
  }
  if (payload.persona !== "pf" && payload.persona !== "pj") {
    return invalido("Informe se e PF ou PJ.", 400);
  }

  // Documento anexado em QUALQUER uma das duas formas: base64 no corpo (pequeno) ou caminho de
  // arquivo ja gravado no bucket (grande, upload direto).
  const documentos = (payload.documentos ?? []).filter(documentoTemArquivo);
  const cad = payload.cad?.secoes?.length ? payload.cad : null;
  const totalFiles = documentos.length + (cad ? 1 : 0);
  if (totalFiles > MAX_FILES) {
    return invalido(`Maximo de ${MAX_FILES} arquivos por cadastro.`, 413);
  }
  for (const doc of documentos) {
    const caminho = (doc.storagePath ?? "").trim();
    if (caminho) {
      // O caminho tem que ser um que ESTE autor recebeu para gravar (rota /upload-url): sem
      // isso um corpo forjado apontaria a linha do documento para o arquivo de outra pessoa.
      if (!caminhoUploadDiretoValido(caminho, autor.donoUpload)) {
        return invalido("Arquivo enviado nao confere com esta sessao.", 400);
      }
      if ((doc.sizeBytes ?? 0) > APOLO_DOC_MAX_BYTES) {
        return invalido(MENSAGEM_DOCUMENTO_GRANDE, 413);
      }
      continue;
    }
    if ((doc.fileBase64?.length ?? 0) > MAX_BASE64_LENGTH) {
      return invalido(MENSAGEM_DOCUMENTO_GRANDE, 413);
    }
  }

  // 🔒 MESMA TRAVA DE OBRIGATÓRIOS DO PORTAL PÚBLICO (incidente 04/08). Esta rota interna também
  // só validava quantidade/tamanho de arquivo: o mesmo furo. O wizard interno já trava por etapa,
  // mas a validação de cliente pode ser burlada, então a barra de verdade fica aqui. Exige o
  // ARQUIVO anexado, nunca o sucesso do OCR (v1.105.0 — [[project_apolo_most_sem_trava]]).
  // Ver lib/apolo/cadastro-obrigatorios.ts.
  const campos = validarCamposMinimos({
    empresa: payload.empresa,
    identidade: payload.identidade,
    persona: payload.persona,
  });
  if (!campos.ok) {
    return invalido(campos.mensagem, 400);
  }
  // Etapa COMPROVANTE DE RENDA (Setup do empreendimento). Vale só para a CAD do cliente: a
  // imobiliária passa por esta mesma rota como PJ, e a etapa fala do COMPRADOR, não do parceiro.
  //
  // ⚠️ CAD INTERNA SEM EMPREENDIMENTO NÃO TEM COMO SER COBRADA. O operador só escolhe o
  // empreendimento no bloco Vínculo, e ele é opcional no hub (é o mesmo buraco que gera as CADs
  // órfãs). Sem `enterpriseId` não existe chave que consultar, então a exigência não se aplica —
  // não é um furo desta etapa, é o furo do vínculo faltando, que se resolve exigindo o
  // empreendimento no wizard. (No portal ele é obrigatório: a porta de lá barra antes.)
  const rendaObrigatoria =
    role === "prospect"
      ? await exigeComprovanteRenda(adminClient, payload.vinculo?.enterpriseId)
      : false;
  const obrigatorios = validarDocumentosObrigatorios({
    documentos,
    exigeComprovanteRenda: rendaObrigatoria,
    perfil: payload.perfil,
    persona: payload.persona,
  });
  if (!obrigatorios.ok) {
    return invalido(obrigatorios.mensagem, 400);
  }

  const formato = formatoDoCadastro(role);

  // O VÍNCULO DA CAD: A IMOBILIÁRIA **OU** O CORRETOR AUTÔNOMO, E A BARRA É AQUI (fatia 2, 28/09/2026).
  //
  // Lucas (27/09/2026), perguntado se o autônomo vende em tudo: *"Sim, empreendimento a empreendimento"*.
  // Ou seja: o cliente do autônomo só pode abrir CAD onde a coordenação habilitou o autônomo.
  //
  // ⚠️ RECUSA ANTES DE CRIAR A FICHA, e não aviso depois. A ficha é criada em `createApoloEntity` logo
  // abaixo, e uma recusa dali para frente deixaria a pessoa cadastrada e a CAD faltando — que é
  // exatamente o estado invisível que a fatia 1 registrou como pendência ("a esteira só é gravada com
  // imobiliária... e sem CAD a reserva não vira proposta"). Aqui nada foi gravado.
  //
  // ⚠️ E OS DOIS JUNTOS SÃO RECUSADOS. Sem esta barra, um corpo com imobiliária E autônomo gravaria a
  // linha com `imobiliaria_entity_id` preenchido e o autônomo em `corretor_entity_id`, e a CAD passaria
  // a contar como CAD daquela imobiliária no CRM do incorporador e no relatório de 18h30 — uma venda do
  // autônomo aparecendo como venda dela. Uma CAD tem UM vínculo.
  const imobiliariaDoPedido = formato.exigeVinculo
    ? (payload.perfil?.imobiliariaId?.trim() ?? "")
    : "";
  const autonomoDoPedido = formato.exigeVinculo
    ? (payload.vinculo?.corretorAutonomoEntityId?.trim() ?? "")
    : "";
  let autonomoDoVinculo: null | Autonomo = null;
  if (autonomoDoPedido && imobiliariaDoPedido) {
    return invalido(
      "Escolha a imobiliária OU o corretor autônomo desta CAD, nunca os dois.",
      400,
    );
  }
  if (autonomoDoPedido) {
    if (!UUID_RE.test(autonomoDoPedido)) {
      return invalido(MENSAGEM_NAO_E_AUTONOMO, 400);
    }
    const conferida = await conferirHabilitacaoDoAutonomo(adminClient, {
      enterpriseId: payload.vinculo?.enterpriseId ?? "",
      entityId: autonomoDoPedido,
    });
    if (!conferida.ok) {
      // `falha` é indisponibilidade (leitura do banco caiu), não pedido errado: 503, como a sequência
      // do código faz. As outras duas são o corpo que não serve: 400.
      return invalido(conferida.mensagem, conferida.motivo === "falha" ? 503 : 400);
    }
    autonomoDoVinculo = conferida.autonomo;
  }

  // O CÓDIGO DO CORRETOR AUTÔNOMO (27/09/2026).
  //
  // ⚠️ QUEM PEDE O NÚMERO É A GRAVAÇÃO, DEPOIS DAS TRAVAS. A porta entrega uma FUNÇÃO, e
  // `createApoloEntity` a chama já passadas a recusa de CAD duplicada, a de núcleo familiar e a de
  // e-mail único, imediatamente antes de montar a linha da ficha. `nextval` não volta atrás: pedido
  // aqui em cima, cada recusa queimava um número, e a numeração que o Lucas pediu (*"CA-0001,
  // CA-0002"*) nascia salteada sem nada que explicasse os buracos — bastava o operador errar o e-mail
  // uma vez para o primeiro autônomo da casa nascer CA-0002.
  //
  // ⚠️ E NUNCA UM NÚMERO INVENTADO: enquanto a migration 0193 não rodar, isto RECUSA com frase clara
  // (ver lib/apolo/codigo-do-corretor.ts). Contar quantos existem e somar um repetiria código em dois
  // cadastros simultâneos.
  let falhaDoCodigoDoCorretor: null | string = null;
  const gerarCodigoDoCorretor: GeradorDoCodigoDoCorretor = async () => {
    const sequencia = await proximoCodigoDoCorretor(adminClient);
    if (!sequencia.ok) {
      // Guardado para a resposta sair 503 (indisponível), e não 500: o cadastro está certo, o que
      // falta é a sequência no banco.
      falhaDoCodigoDoCorretor = sequencia.mensagem;
    }
    return sequencia;
  };

  // Autor do cadastro (nome de quem preencheu).
  const uploadedByName = await autor.nome();

  // QUEM NÃO TEM BLOCO VÍNCULO NÃO GRAVA IMOBILIÁRIA, E A BARRA É AQUI (27/09/2026).
  //
  // ⚠️ Lucas: *"NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA, isso sera bem
  // restrito"*. Até agora essa regra morava SÓ NA TELA: `formatoDoCadastro().exigeVinculo` era lido
  // pelo wizard, e esta função repassava `payload.perfil` inteiro. No persist o relacionamento de
  // imobiliária nasce por PRESENÇA do campo, sem olhar o papel (`if (imobiliariaId ||
  // imobiliariaLabel)`), o `imobiliariaLabel` entra no índice de busca e o `imobiliariaId` no metadata
  // da ficha. Um POST com `role: "corretor"` e `perfil.imobiliariaId` preenchido (aba velha
  // reenviada, script interno, a próxima porta que reusar esta função) gravava justamente a
  // informação proibida. É a doutrina que este arquivo já escreve: *"a validação de cliente pode ser
  // burlada, então a barra de verdade fica aqui"*.
  //
  // ⚠️ MEDIDO ANTES DE MEXER: hoje isto não muda nada nas duas telas que existem. O wizard só mostra
  // o seletor de imobiliária quando o formato pede vínculo, e `payload.vinculo` só é montado nesse
  // caso (modules/apolo/blocks/cadastro/cadastro-flow.tsx, o `vinculoProspect`); a imobiliária e o
  // corretor chegam com os dois campos vazios. O que muda é a porta deixar de ACEITAR o que a tela
  // não manda. O portal do incorporador só cadastra prospect, que exige vínculo, e passa intacto.
  //
  // ⚠️ O VÍNCULO DO AUTÔNOMO APAGA A IMOBILIÁRIA DA FICHA PELO MESMO MOTIVO (fatia 2, 28/09/2026). A
  // barra lá em cima já recusa os dois juntos; aqui é a segunda volta da chave, para que nem por
  // caminho novo o `imobiliariaLabel` do autônomo entre no índice de busca da ficha.
  const perfilDoPapel =
    formato.exigeVinculo && !autonomoDoVinculo
      ? payload.perfil
      : { ...payload.perfil, imobiliariaId: "", imobiliariaLabel: "" };
  const vinculoDoPapel = formato.exigeVinculo ? payload.vinculo : undefined;

  // 1) Cria a entidade coordenadamente — com DEDUP por documento (não cria 2ª ficha do mesmo CPF).
  const result = await createApoloEntity(
    adminClient,
    {
      ...payload,
      dedupPorDocumento: true,
      perfil: perfilDoPapel,
      // A duplicidade é POR EMPREENDIMENTO: quem já tem CAD no Vale do Ouro pode abrir CAD em
      // outro loteamento. Sem este campo o dedup barra tudo (era o 409 que travava o time).
      enterpriseId: vinculoDoPapel?.enterpriseId ?? null,
      origem: payload.origem || input.origemPadrao,
      ownerUserId: autor.ownerUserId,
    },
    // A autoria e a regra da ficha existente vêm da PORTA, num argumento à parte: o `payload` é o
    // corpo espalhado, e nada que o JSON mande chega a este terceiro argumento.
    {
      autor: autor.registro ?? null,
      // ⚠️ O AFROUXAMENTO DAS DUAS TRAVAS DO AUTÔNOMO NASCE AQUI, NA PORTA, e não do `role` do JSON:
      // senão o operador que tomasse "Este CPF já tem CAD cadastrada" trocaria `?tipo=prospect` por
      // `?tipo=corretor` na URL e passaria. Esta rota é a do HUB (Bearer do operador da Careli).
      ...(role === "corretor"
        ? {
            cadastroDeCorretorAutonomo: true,
            // O código do autônomo viaja PELA PORTA, junto da autoria e pelo mesmo motivo: no
            // `payload` ele seria escolhido por quem manda o JSON. É uma FUNÇÃO porque o número só
            // pode ser consumido depois das travas (ver `GeradorDoCodigoDoCorretor`).
            codigoDoCorretor: gerarCodigoDoCorretor,
          }
        : {}),
      fichaExistente: input.fichaExistente ?? "anexar",
      // (24/09/2026) Quem salva pelo HUB é o operador da Careli: a imobiliária que ele habilita no
      // cadastro grava auditoria e avisa o coordenador (Lucas, "3 - Isso ae"). O portal (autor de fora
      // do hub) não liga: ele só cadastra prospect, e habilitação não é dele.
      habilitacaoInterna: !autor.registro,
    },
  );

  if (!result.ok) {
    // A sequência do código não respondeu (migration 0193 não aplicada, por exemplo): a resposta é
    // 503 com a frase do operador, e não o 500 genérico da recusa. Nada foi gravado.
    if (falhaDoCodigoDoCorretor) {
      return invalido(falhaDoCodigoDoCorretor, 503);
    }
    return { ok: false, recusa: result, tipo: "recusado" };
  }

  const entityId = result.entityId;
  const nomeCliente =
    payload.persona === "pj"
      ? payload.empresa?.razaoSocial?.trim() || "Empresa"
      : payload.identidade?.nome?.trim() || "Cliente";

  // Avisos acumulados (esteira + documentos): a entidade já existe, então falhas aqui viram aviso.
  const uploadWarnings: string[] = [];
  const savedDocs: string[] = [];

  // 1b) VÍNCULO na esteira (empreendimento + imobiliária + corretor), como o portal público faz —
  // para a CAD manual entrar na fila COM empreendimento e não nascer órfã (o bug das órfãs). Só
  // grava quando o empreendimento E a imobiliária vieram; best-effort com aviso.
  //
  // ⚠️ CORRETOR NÃO ENTRA NA ESTEIRA (regra do Lucas, 05/08). A esteira existe para VALIDAR
  // DOCUMENTO DE COMPRADOR: validação, análise de crédito, pré-venda, credenciamento. O corretor
  // não compra nada, então não há o que validar: ele é cadastrado, vinculado à imobiliária, e
  // acabou. Antes esta condição olhava só empreendimento + imobiliária, e como o cadastro de
  // corretor também tem os dois, ele caía na fila de Validação junto com os clientes.
  //
  // A IMOBILIÁRIA continua entrando de propósito: ela TEM documento para validar (contrato social,
  // ficha dos sócios). Só o corretor está fora.
  //
  // ⚠️ E O CORRETOR AUTÔNOMO ABRE CAD PARA O CLIENTE DELE, SEM IMOBILIÁRIA (fatia 2, 28/09/2026).
  // A condição exigia `imobiliariaId` por CÓPIA, não por necessidade de nenhum leitor: o bloco foi
  // escrito para gravar *"como o portal público faz"*, e no portal público a imobiliária é obrigatória
  // por CHECK de banco (`apolo_esteira_vinculo_publico_check`, migration 0061, escopado em
  // `origem = 'publico-cad'`). Aqui ela nunca foi necessária, e isso está MEDIDO em produção
  // (bxgukywoxgivlrhjkwjx, 28/09/2026):
  //   • `apolo_esteira.imobiliaria` e `imobiliaria_entity_id` são as duas NULLABLE, e o único CHECK que
  //     as exige é o escopado por origem acima. ESTA FATIA NÃO PRECISA DE MIGRATION;
  //   • 41 das 843 linhas de hoje JÁ ESTÃO sem as duas (nem id, nem texto), inclusive em etapa
  //     `credenciado` e `revisao`, e nada quebrou;
  //   • nenhum dos 17 leitores da esteira esconde a CAD por falta de imobiliária. O Board mostra a
  //     coluna vazia (lib/apolo/board-do-servidor.ts:773, `?? null`), a régua da venda NEM LÊ a coluna
  //     (lib/hercules/cliente-credenciado.ts:764), e a aba Imobiliárias do portal já tem balde próprio
  //     para o caso (`cadsForaDaLista`, lib/apolo/incorporador/imobiliarias-do-produto.ts:251).
  //   ⚠️ A ÚNICA EXCEÇÃO CONHECIDA, e ela fica de fora desta fatia de propósito:
  //     lib/apolo/relatorio-imobiliaria.ts:218 faz `if (!imob) continue` e DESCARTA a CAD em silêncio.
  //     Está certo para a regra (o relatório de 18h30 é enviado A CADA imobiliária, e o autônomo não é
  //     uma), mas é o número que vai deixar de bater com o Board. Quem perguntar "por que o total do
  //     relatório não fecha com a fila" acha a resposta nessa linha.
  //
  // ⚠️ O PRECEDENTE JÁ ESTAVA NO AR: lib/hercules/cad-do-comprador.ts:112-118 grava, por desenho e
  // desde a v1.385.0, uma linha desta tabela com `imobiliaria: null` e `imobiliaria_entity_id: null`.
  const vinculo = payload.vinculo;
  const imobiliariaId = autonomoDoVinculo ? "" : payload.perfil?.imobiliariaId?.trim();
  let esteira: EsteiraDoSalvar = "sem-vinculo";
  if (role !== "corretor" && vinculo?.enterpriseId && (imobiliariaId || autonomoDoVinculo)) {
    const imobiliariaNome = imobiliariaId
      ? await nomeDaImobiliaria(adminClient, imobiliariaId, payload.perfil?.imobiliariaLabel)
      : "";
    const { error: esteiraError } = await adminClient.from("apolo_esteira").upsert(
      {
        chegou_em: new Date().toISOString(),
        // ⚠️ COM AUTÔNOMO, O NOME VEM DO SERVIDOR (`autonomoDoVinculo.nome`, resolvido pela ficha do id
        // que a porta conferiu), e NUNCA do texto do browser: é a mesma doutrina do empreendimento
        // impresso na CAD, que o corpo não dita. `corretorNome` do payload é o corretor DA IMOBILIÁRIA.
        corretor: autonomoDoVinculo?.nome ?? (vinculo.corretorNome?.trim() || null),
        corretor_email: autonomoDoVinculo ? null : vinculo.corretorEmail?.trim() || null,
        corretor_entity_id: autonomoDoVinculo
          ? autonomoDoVinculo.entityId
          : vinculo.corretorEntityId && UUID_RE.test(vinculo.corretorEntityId)
            ? vinculo.corretorEntityId
            : null,
        empreendimento: vinculo.empreendimentoNome?.trim() || null,
        enterprise_id: vinculo.enterpriseId,
        entity_id: entityId,
        etapa: "validacao",
        imobiliaria: imobiliariaNome || null,
        imobiliaria_entity_id:
          imobiliariaId && UUID_RE.test(imobiliariaId) ? imobiliariaId : null,
        origem: input.origemDaEsteira,
      },
      // A chave da esteira é `(entity_id, enterprise_id)` desde a 0080: uma CAD por pessoa POR
      // EMPREENDIMENTO. `enterprise_id` já vai no registro acima (o `if` acima garante), então
      // este upsert cria a CAD nova do loteamento sem tocar na CAD que a pessoa tem em outro.
      { onConflict: "entity_id,enterprise_id" },
    );
    if (esteiraError) {
      uploadWarnings.push(`esteira: ${esteiraError.message}`);
      esteira = "falhou";
    } else {
      esteira = "gravada";
    }
  }

  // 2) Sobe os documentos anexados + o CAD pro drive da entidade. Best-effort: falha de upload
  // vira warning (a entidade ja existe), nao derruba o cadastro.
  //
  // ⚠️ A MARCA DO EMPREENDIMENTO (`metadata.enterpriseId`). `apolo_documents` não tem coluna de
  // empreendimento, e o portal decide o que mostra de uma pessoa pela marca
  // (`lib/apolo/incorporador/documentos-do-portal.ts`): sem ela, a CAD de quem tem dois produtos
  // some dos dois portais, ou aparece no do vizinho.
  //   • a CAD em PDF é SEMPRE de um produto: leva a marca em toda porta que sabe o produto;
  //   • os documentos enviados (RG, comprovante, renda) são da PESSOA e valem para qualquer produto
  //     dela no hub. Só a porta do portal marca, porque ali o documento foi entregue para AQUELE
  //     produto por gente de fora, e a régua do portal decide com a marca quem mais pode abrir.
  const enterpriseIdDoVinculo = normalizarEnterpriseId(payload.vinculo?.enterpriseId);
  const marcaDoProduto = enterpriseIdDoVinculo ? { enterpriseId: enterpriseIdDoVinculo } : undefined;
  const marcaDosDocumentos = autor.registro?.origem === "portal" ? marcaDoProduto : undefined;

  // Agrupa por documento: as varias faces/paginas de um mesmo documento viram UM arquivo no
  // drive (frente+verso do RG, contrato social inteiro), em vez de varios soltos.
  const porCategoria = new Map<string, IncomingDoc[]>();
  for (const doc of documentos) {
    const categoria = normalizeCategoria(doc.categoria);
    porCategoria.set(categoria, [...(porCategoria.get(categoria) ?? []), doc]);
  }

  for (const [categoria, arquivos] of porCategoria) {
    const rotulo = `${nomeCliente} - ${rotuloCategoria(categoria)}`;
    const varias = arquivos.length > 1;
    const primeiro = arquivos[0];

    // Documento de arquivo UNICO que subiu direto: a linha so aponta pro arquivo que ja esta no
    // bucket. Nada e baixado nem re-enviado -- e o caminho dos arquivos grandes.
    if (!varias && primeiro && (primeiro.storagePath ?? "").trim()) {
      const upload = await uploadApoloDocument({
        adminClient,
        documentType: categoria,
        extractedPayload: primeiro.extractedPayload,
        fileName: primeiro.fileName || `${categoria}.pdf`,
        label: rotulo,
        metadataExtra: marcaDosDocumentos,
        mimeType: primeiro.mimeType || null,
        ownerId: entityId,
        scope: "entidade",
        sizeBytes: primeiro.sizeBytes ?? null,
        storagePath: primeiro.storagePath,
        uploadedByName,
      });
      if (upload.ok) savedDocs.push(categoria);
      else uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
      continue;
    }

    // Documento com VARIAS paginas em que alguma subiu direto: pra virar UM PDF so (o que o time ve
    // no drive hoje) o servidor precisa dos bytes, entao baixa do Storage. Acima do teto, guarda
    // uma pagina por arquivo em vez de estourar a memoria da function.
    const algumDireto = arquivos.some((a) => (a.storagePath ?? "").trim());
    const soma = arquivos.reduce((total, a) => total + tamanhoAproximado(a), 0);
    if (varias && algumDireto && soma > TETO_JUNCAO_BYTES) {
      uploadWarnings.push(
        `documento ${categoria}: as páginas somam ${(soma / 1_048_576).toFixed(1)}MB e ficaram como arquivos separados no drive`,
      );
      for (const arquivo of arquivos) {
        const upload = await uploadApoloDocument({
          adminClient,
          documentType: categoria,
          extractedPayload: arquivo.extractedPayload,
          fileBase64: arquivo.fileBase64 ?? null,
          fileName: arquivo.fileName || `${categoria}.pdf`,
          label: rotulo,
          metadataExtra: marcaDosDocumentos,
          mimeType: arquivo.mimeType || null,
          ownerId: entityId,
          scope: "entidade",
          sizeBytes: arquivo.sizeBytes ?? null,
          storagePath: arquivo.storagePath ?? null,
          uploadedByName,
        });
        if (upload.ok) savedDocs.push(categoria);
        else uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
      }
      continue;
    }

    let fileBase64: string;
    let fileName: string;
    let mimeType: string | null;

    try {
      fileBase64 = varias
        ? await juntarEmPdf(adminClient, arquivos)
        : (primeiro?.fileBase64 as string);
      fileName = varias
        ? `${rotulo}.pdf`
        : primeiro?.fileName || `${categoria}.pdf`;
      mimeType = varias ? "application/pdf" : primeiro?.mimeType || null;
    } catch (error) {
      uploadWarnings.push(
        `documento ${categoria}: falha ao juntar as páginas (${(error as Error).message})`,
      );
      continue;
    }

    const upload = await uploadApoloDocument({
      adminClient,
      documentType: categoria,
      // A leitura guardada e a da primeira face (e onde estao os dados do titular).
      extractedPayload: primeiro?.extractedPayload,
      fileBase64,
      fileName,
      label: rotulo,
      metadataExtra: marcaDosDocumentos,
      mimeType,
      ownerId: entityId,
      scope: "entidade",
      uploadedByName,
    });
    if (upload.ok) {
      savedDocs.push(categoria);
    } else {
      uploadWarnings.push(`documento ${categoria}: ${upload.error}`);
    }

    // As paginas que subiram direto viraram parte do PDF unico: os originais no staging nao tem
    // mais dono. Limpeza best-effort, pra nao deixar arquivo orfao no bucket.
    if (upload.ok && algumDireto) {
      for (const arquivo of arquivos) {
        const caminho = (arquivo.storagePath ?? "").trim();
        if (caminho) await removerDocumentoDoStorage(adminClient, caminho);
      }
    }
  }

  // 3) Monta a CAD aqui (com o codigo de autenticacao impresso) e salva no drive. O mesmo PDF
  //    volta pra quem cadastrou baixar -- o que ele baixa e exatamente o que ficou guardado.
  let cadBase64: string | null = null;

  if (cad) {
    try {
      // ⚠️ A imobiliaria impressa e RESOLVIDA AQUI, sobrescrevendo o que veio no payload. O
      // `cad` inteiro (inclusive `vinculo`) e montado no BROWSER e a rota so repassava: quem
      // envia ditava o que sai impresso na propria CAD. Agora o nome sai do id que o autor
      // autenticado escolheu (perfil.imobiliariaId).
      // O `corretor` NÃO é impresso por esta função: o PDF sai só com o que o `cad` do browser
      // trouxer nesse campo. O wizard interno até manda o corretor escolhido em
      // `payload.vinculo.corretorNome`, mas imprimi-lo daqui é decisão pendente com o Lucas. A CAD
      // do corretor pelo link público é outra rota (/api/publico/cad/salvar), que imprime
      // imobiliária e corretor do TOKEN. (O comentário antigo citava /api/publico/cad/enviar,
      // apagada em 21/07/2026.)
      const imobiliariaNome = await nomeDaImobiliaria(
        adminClient,
        payload.perfil?.imobiliariaId,
        payload.perfil?.imobiliariaLabel,
      );
      // EMPREENDIMENTO abaixo do corretor (Lucas, 24/09/2026). ⚠️ Pelo ID do vínculo, que a porta
      // já conferiu, e NUNCA pelo texto do browser: o `cad.empreendimento` que vier no corpo é
      // sobrescrito aqui, mesmo quando não há id (aí a linha simplesmente não sai). Sai o nome de
      // MERCADO, o do pai; a divisão (VOC, LBF) não vai para o papel. Só a CAD do CLIENTE leva: a
      // ficha da imobiliária não tem "o" empreendimento.
      const empreendimento =
        role === "prospect"
          ? await nomeDeMercadoDoEmpreendimento(adminClient, payload.vinculo?.enterpriseId)
          : "";
      // ⚠️ COM CORRETOR AUTÔNOMO, O CAMPO "Imobiliaria" DO PDF SAI VAZIO, E O `vinculo` LEGADO TAMBÉM
      // (fatia 2, 28/09/2026). O PDF imprime `cad.imobiliaria || cad.vinculo` sob o rótulo
      // "Imobiliaria" (modules/apolo/blocks/cadastro/cad-pdf.ts:290-293), e o `vinculo` é montado no
      // BROWSER: sem apagá-lo, o nome do autônomo sairia IMPRESSO como imobiliária no papel que vai
      // para o corretor e para o coordenador. É literalmente o que o Lucas proibiu em 27/09/2026:
      // *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria"*. Quem vendeu vai na
      // linha do CORRETOR, que é o campo próprio dele.
      const bytes = await montarCadPdf({
        ...cad,
        autenticacao: result.autenticacao,
        ...(autonomoDoVinculo
          ? { corretor: cad.corretor?.trim() || autonomoDoVinculo.nome, vinculo: "" }
          : {}),
        empreendimento: empreendimento || undefined,
        imobiliaria: autonomoDoVinculo ? "" : imobiliariaNome || cad.vinculo || "",
      });
      cadBase64 = Buffer.from(bytes).toString("base64");

      const upload = await uploadApoloDocument({
        adminClient,
        documentType: "cad",
        fileBase64: cadBase64,
        fileName: `${cad.arquivo || `CAD - ${nomeCliente}`}.pdf`,
        label: `CAD - ${nomeCliente}`,
        metadataExtra: marcaDoProduto,
        mimeType: "application/pdf",
        ownerId: entityId,
        scope: "entidade",
        uploadedByName,
      });
      if (upload.ok) {
        savedDocs.push("cad");
      } else {
        uploadWarnings.push(`CAD: ${upload.error}`);
      }
    } catch (error) {
      uploadWarnings.push(`CAD: falha ao gerar o PDF (${(error as Error).message})`);
    }
  }

  return {
    corpo: {
      autenticacao: result.autenticacao,
      cadBase64,
      entityId,
      ok: true,
      savedDocs,
      warnings: [...result.warnings, ...uploadWarnings],
    },
    esteira,
    ok: true,
  };
}

// Nome da imobiliaria a partir do ID escolhido pelo autor. Cai no rotulo que o wizard
// mandou quando o id nao for um uuid (o seletor permite texto livre em imobiliaria nova).
async function nomeDaImobiliaria(
  adminClient: AdminClient,
  imobiliariaId: string | undefined,
  imobiliariaLabel: string | undefined,
): Promise<string> {
  const id = (imobiliariaId ?? "").trim();
  if (!UUID_RE.test(id)) return (imobiliariaLabel ?? "").trim();

  const { data, error } = await adminClient
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", id)
    .maybeSingle<{ display_name: string | null; legal_name: string | null }>();

  if (error || !data) return (imobiliariaLabel ?? "").trim();
  return data.legal_name || data.display_name || (imobiliariaLabel ?? "").trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeCategoria(value: string | undefined): string {
  const key = (value ?? "").trim().toLowerCase();
  if (SOCIO_CATEGORIA_RE.test(key)) return key;
  return key in CATEGORIA_LABEL && key !== "cad" ? key : "outros";
}

function stripDataUrl(value: string): Buffer {
  const cru = value.startsWith("data:") ? value.slice(value.indexOf(",") + 1) : value;
  return Buffer.from(cru, "base64");
}

// Bytes de UM arquivo do payload, venha ele em base64 no corpo (fluxo de sempre) ou ja gravado no
// bucket (upload direto). So e chamado no agrupamento: documento de arquivo unico que subiu direto
// nem baixa nem re-sobe.
async function bytesDoArquivo(adminClient: AdminClient, arquivo: IncomingDoc): Promise<Buffer> {
  const caminho = (arquivo.storagePath ?? "").trim();
  if (caminho) {
    const bytes = await lerDocumentoDoStorage(adminClient, caminho);
    if (!bytes) throw new Error("arquivo enviado não foi encontrado no armazenamento");
    return bytes;
  }
  return stripDataUrl(arquivo.fileBase64 as string);
}

// Tamanho aproximado de um arquivo do payload, pra decidir se da pra juntar em memoria.
function tamanhoAproximado(arquivo: IncomingDoc): number {
  if ((arquivo.storagePath ?? "").trim()) return arquivo.sizeBytes ?? 0;
  return Math.floor(((arquivo.fileBase64 ?? "").length * 3) / 4);
}

// Junta os arquivos de UM documento (RG frente+verso, contrato social com N paginas) num PDF
// unico: o drive guarda 1 arquivo por documento em vez de varios soltos. Imagem vira pagina do
// tamanho dela; PDF entra com as paginas copiadas.
async function juntarEmPdf(adminClient: AdminClient, arquivos: IncomingDoc[]): Promise<string> {
  const doc = await PDFDocument.create();

  for (const arquivo of arquivos) {
    const bytes = await bytesDoArquivo(adminClient, arquivo);
    const nome = (arquivo.fileName ?? "").toLowerCase();
    const mime = (arquivo.mimeType ?? "").toLowerCase();
    const ehPdf = mime.includes("pdf") || nome.endsWith(".pdf");

    if (ehPdf) {
      const origem = await PDFDocument.load(bytes);
      const paginas = await doc.copyPages(origem, origem.getPageIndices());
      for (const pagina of paginas) doc.addPage(pagina);
      continue;
    }

    const ehPng = mime.includes("png") || nome.endsWith(".png");
    const imagem = ehPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const pagina = doc.addPage([imagem.width, imagem.height]);
    pagina.drawImage(imagem, { height: imagem.height, width: imagem.width, x: 0, y: 0 });
  }

  return Buffer.from(await doc.save()).toString("base64");
}
