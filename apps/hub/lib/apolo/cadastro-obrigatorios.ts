// Trava de dados obrigatórios do cadastro/CAD — vale no SERVIDOR e no cliente.
//
// POR QUE EXISTE (incidente 04/08): 12 clientes subiram CAD pelo link público trazendo SÓ o PDF
// do formulário, sem documento de identificação e sem comprovante de endereço. O sistema só
// detectava a falta DEPOIS, na etapa de "correção" — o portal deixava submeter. Decisão do Lucas
// (dono do produto): "não pode deixar subir sem todos os dados obrigatórios preenchidos". O envio
// tem que ser BARRADO na origem, não aceito-e-marcado-correção.
//
// A trava do CLIENTE pode ser burlada (bundle antigo em cache, replay do POST, estado parcial); a
// do SERVIDOR não. Por isso as duas rotas de salvar chamam esta camada ANTES de criar a entidade:
//   • público  → app/api/publico/cad/salvar/route.ts
//   • interno  → app/api/apolo/cadastro/salvar/route.ts
// O wizard (modules/apolo/blocks/cadastro/cadastro-flow.tsx) usa as MESMAS regras só para
// desabilitar o botão Enviar e listar o que falta — espelho, nunca a trava de verdade.
//
// ⚠️ REGRA DO OCR (v1.105.0 — [[project_apolo_most_sem_trava]]): a leitura do MOST NUNCA trava o
// cadastro. Se o OCR falhar, o campo abre para preenchimento manual e o arquivo é salvo assim
// mesmo. Portanto esta trava exige que o ARQUIVO do documento esteja ANEXADO (em qualquer uma das
// duas formas: `fileBase64` no corpo ou `storagePath` do upload direto), e NUNCA que o OCR tenha
// lido com sucesso, nem que a "qualidade"/score da leitura
// passe de algum limite. Confundir as duas coisas recria exatamente o bug que o Lucas mandou
// remover em v1.105.0. As duas coisas são diferentes de propósito.
//
// O conjunto de obrigatórios é o MESMO que o wizard já exige para avançar entre as etapas
// (perfilOk/anexado/canNext) — aqui não se inventa exigência nova, só se fecha o furo de o
// servidor nunca ter checado.
import { cpfValido, soDigitos } from "@/lib/apolo/documento";

export type PersonaCadastro = "pf" | "pj";

// Estado civil (ids do C2X, os mesmos do wizard):
//   2 = casado · 3 = divorciado · 4 = separado · 6 = união estável
// Espelha `needsCertidao`/`temConjuge` de cadastro-flow.tsx.
const ESTADO_CIVIL_EXIGE_CERTIDAO = new Set(["2", "3", "4", "6"]); // needsCertidao
const ESTADO_CIVIL_TEM_CONJUGE = new Set(["2", "6"]); // temConjuge

// Documento de sócio carrega o índice na categoria ("identificacao_socio_2"); espelha o
// SOCIO_CATEGORIA_RE do upload. A família (id / comprovante) é o que interessa aqui.
const SOCIO_IDENTIFICACAO_RE = /^identificacao_socio_\d+$/;
const SOCIO_COMPROVANTE_RE = /^comprovante_socio_\d+$/;

export type RequisitoDocumento = {
  // Casa a categoria do documento anexado (exata, como "identificacao", ou de família, como o
  // grupo de sócios). Recebe a categoria já normalizada (trim + minúsculas).
  match: (categoria: string) => boolean;
  // Forma de frase, para a mensagem do 400 ("Anexe o documento de identificação ...").
  rotulo: string;
  // Forma curta, para a lista do wizard ("Falta: comprovante de endereço").
  rotuloCurto: string;
};

// Normaliza a categoria vinda do payload. Aceita tanto `categoria` (o que o wizard manda) quanto
// `document_type` (nome alternativo). NÃO mapeia desconhecido para "outros": precisamos preservar
// os índices de sócio ("identificacao_socio_1") para casar a família.
export function normalizarCategoria(valor: string | null | undefined): string {
  return (valor ?? "").trim().toLowerCase();
}

// O conjunto de documentos obrigatórios daquela persona/estado civil. Baseado no que o wizard já
// trava para avançar:
//   PF  → identificação + comprovante de endereço (sempre); certidão quando o estado civil pede
//         (casado/divorciado/separado/união); identificação do cônjuge quando casado/união.
//   PJ  → cartão CNPJ (chega na categoria "identificacao") + contrato social + a ficha de cada
//         sócio (identificação + comprovante DELE). Vale para prospect PJ e imobiliária: os dois
//         passam pelas etapas Contrato social e Sócios.
export function requisitosDocumentos(input: {
  persona: PersonaCadastro;
  estadoCivilId?: string | null;
}): RequisitoDocumento[] {
  if (input.persona === "pj") {
    return [
      {
        match: (c) => c === "identificacao",
        rotulo: "o cartão CNPJ",
        rotuloCurto: "cartão CNPJ",
      },
      {
        match: (c) => c === "contrato_social",
        rotulo: "o contrato social",
        rotuloCurto: "contrato social",
      },
      {
        match: (c) => SOCIO_IDENTIFICACAO_RE.test(c),
        rotulo: "o documento de identificação de ao menos um sócio",
        rotuloCurto: "identificação de sócio",
      },
      {
        match: (c) => SOCIO_COMPROVANTE_RE.test(c),
        rotulo: "o comprovante de endereço de ao menos um sócio",
        rotuloCurto: "comprovante de sócio",
      },
    ];
  }

  const requisitos: RequisitoDocumento[] = [
    {
      match: (c) => c === "identificacao",
      rotulo: "o documento de identificação",
      rotuloCurto: "documento de identificação",
    },
    {
      match: (c) => c === "comprovante_endereco",
      rotulo: "o comprovante de endereço",
      rotuloCurto: "comprovante de endereço",
    },
  ];

  const estadoCivil = normalizarCategoria(input.estadoCivilId);
  if (ESTADO_CIVIL_EXIGE_CERTIDAO.has(estadoCivil)) {
    requisitos.push({
      match: (c) => c === "certidao",
      rotulo: "a certidão de estado civil",
      rotuloCurto: "certidão de estado civil",
    });
  }
  if (ESTADO_CIVIL_TEM_CONJUGE.has(estadoCivil)) {
    requisitos.push({
      match: (c) => c === "identificacao_conjuge",
      rotulo: "o documento de identificação do cônjuge",
      rotuloCurto: "identificação do cônjuge",
    });
  }
  return requisitos;
}

// Um documento do payload tem ARQUIVO anexado? Conta o arquivo presente, jamais o sucesso da
// leitura — é o coração da regra do OCR (v1.105.0).
//
// ⚠️ DUAS FORMAS DE ANEXO, as duas valem: o documento PEQUENO viaja em `fileBase64` dentro do JSON
// (fluxo de sempre) e o GRANDE sobe direto para o Storage e viaja como `storagePath` (o caminho do
// arquivo já gravado). Aceitar só o base64 aqui faria a CAD com documento grande ser recusada por
// "falta documento" mesmo com tudo anexado.
export type DocumentoAnexado = {
  categoria?: string | null;
  document_type?: string | null;
  fileBase64?: string | null;
  storagePath?: string | null;
};

export function temArquivo(doc: DocumentoAnexado | null | undefined): boolean {
  const base64 = typeof doc?.fileBase64 === "string" ? doc.fileBase64.trim() : "";
  const caminho = typeof doc?.storagePath === "string" ? doc.storagePath.trim() : "";
  return base64.length > 0 || caminho.length > 0;
}

// As categorias que têm ARQUIVO anexado de verdade. Um documento cuja leitura falhou (extração
// vazia) e cujos campos foram preenchidos à mão entra aqui do mesmo jeito.
export function categoriasComArquivo(
  documentos: DocumentoAnexado[] | null | undefined,
): string[] {
  return (documentos ?? [])
    .filter(temArquivo)
    .map((doc) => normalizarCategoria(doc.categoria ?? doc.document_type));
}

// Os rótulos (forma de frase) dos obrigatórios que NÃO têm arquivo anexado. Vazio = tudo presente.
export function documentosFaltando(
  input: { persona: PersonaCadastro; estadoCivilId?: string | null },
  categoriasPresentes: Iterable<string>,
): string[] {
  const presentes = new Set<string>();
  for (const categoria of categoriasPresentes) presentes.add(normalizarCategoria(categoria));
  return requisitosDocumentos(input)
    .filter((requisito) => ![...presentes].some((categoria) => requisito.match(categoria)))
    .map((requisito) => requisito.rotulo);
}

// Igual a documentosFaltando, mas em forma curta (para a lista "Falta: ..." do wizard).
export function documentosFaltandoCurto(
  input: { persona: PersonaCadastro; estadoCivilId?: string | null },
  categoriasPresentes: Iterable<string>,
): string[] {
  const presentes = new Set<string>();
  for (const categoria of categoriasPresentes) presentes.add(normalizarCategoria(categoria));
  return requisitosDocumentos(input)
    .filter((requisito) => ![...presentes].some((categoria) => requisito.match(categoria)))
    .map((requisito) => requisito.rotuloCurto);
}

// Junta os rótulos em português natural ("X", "X e Y", "X, Y e Z").
export function juntarPtBr(itens: string[]): string {
  if (itens.length === 0) return "";
  if (itens.length === 1) return itens[0]!;
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

// Mensagem acionável do 400 quando faltam documentos.
export function mensagemDocumentosFaltando(faltando: string[]): string {
  return `Anexe ${juntarPtBr(faltando)} para enviar o cadastro.`;
}

export type ValidacaoObrigatorios =
  | { ok: true }
  | { faltando: string[]; mensagem: string; ok: false };

// A validação que o SERVIDOR chama antes de criar a entidade. Só olha para os documentos
// obrigatórios (arquivo anexado); nome e CPF/CNPJ válidos são checados à parte pelas rotas (o
// createApoloEntity já recusa nome/documento ausentes; a checagem de dígito verificador do CPF é
// feita na rota, ver validarDocumentoObrigatorio).
export function validarDocumentosObrigatorios(payload: {
  persona: PersonaCadastro;
  perfil?: { estadoCivilId?: string | null } | null;
  documentos?: DocumentoAnexado[] | null;
}): ValidacaoObrigatorios {
  const faltando = documentosFaltando(
    { persona: payload.persona, estadoCivilId: payload.perfil?.estadoCivilId },
    categoriasComArquivo(payload.documentos),
  );
  if (faltando.length === 0) return { ok: true };
  return { faltando, mensagem: mensagemDocumentosFaltando(faltando), ok: false };
}

export type ValidacaoCampos = { mensagem: string; ok: false } | { ok: true };

// Campos mínimos que o servidor não pode aceitar vazios/inválidos. É o mesmo piso que o wizard já
// exige (nome + CPF/CNPJ) e que o createApoloEntity já recusa em parte — aqui só antecipamos com
// um 400 acionável e, no PF, acrescentamos o dígito verificador do CPF (o createApoloEntity
// checa só o TAMANHO; o wizard já exige `cpfValido`, então isto não barra nada que o cliente
// deixaria passar, mas fecha o furo de um POST forjado com CPF de 11 dígitos inválidos).
//
// PJ: exige nome + CNPJ com os 14 dígitos (mesmo piso do createApoloEntity). Não aplico o dígito
// verificador do CNPJ de propósito: o cartão CNPJ é read-only no wizard (não dá para o operador
// corrigir um dígito que o OCR leu torto), então travar aí seria inventar exigência que o fluxo
// não tem e deixaria o cadastro num beco sem saída — contra a regra do OCR (v1.105.0).
//
// PF exige também a NATURALIDADE (incidente 05/08): 8 CADs voltaram RECUSADAS pelo C2X com
// "Naturalidade não pode ficar em branco" e/ou "Nacionalidade não pode ficar em branco"; nas 8 a
// naturalidade estava vazia tanto na ficha quanto no cadastro. Só a naturalidade é cobrada porque
// a NACIONALIDADE é DERIVADA dela (derivarNacionalidade/partesDaNaturalidade em
// lib/apolo/cadastro-cascata.ts, usadas pelo lib/apolo/c2x-write-server.ts): garantida a cidade de
// nascimento, a nacionalidade se resolve sozinha. Isto NÃO é trava de OCR (v1.105.0): o wizard já
// abre o campo Naturalidade para digitação sempre que a leitura vem vazia, então o operador tem
// como cumprir a exigência mesmo quando o documento não trouxe nada.
export function validarCamposMinimos(payload: {
  persona: PersonaCadastro;
  identidade?: { cpf?: string | null; naturalidade?: string | null; nome?: string | null } | null;
  empresa?: { cnpj?: string | null; nomeFantasia?: string | null; razaoSocial?: string | null } | null;
}): ValidacaoCampos {
  if (payload.persona === "pj") {
    const nome = (payload.empresa?.razaoSocial ?? payload.empresa?.nomeFantasia ?? "").trim();
    if (!nome) {
      return { mensagem: "Informe a razão social da empresa para enviar o cadastro.", ok: false };
    }
    if (soDigitos(payload.empresa?.cnpj ?? "").length !== 14) {
      return {
        mensagem: "Anexe o cartão CNPJ com o número legível para enviar o cadastro.",
        ok: false,
      };
    }
    return { ok: true };
  }

  const nome = (payload.identidade?.nome ?? "").trim();
  if (!nome) {
    return { mensagem: "Informe o nome do cliente para enviar o cadastro.", ok: false };
  }
  if (!cpfValido(payload.identidade?.cpf ?? "")) {
    return { mensagem: "Informe um CPF válido do cliente para enviar o cadastro.", ok: false };
  }
  // Sem naturalidade o C2X recusa a CAD depois (e a nacionalidade, que dela deriva, nasce vazia
  // junto). Barrar aqui é mais barato que descobrir na recusa, dias depois do cliente ir embora.
  if (!(payload.identidade?.naturalidade ?? "").trim()) {
    return {
      mensagem: "Informe a naturalidade (a cidade de nascimento do cliente) para enviar o cadastro.",
      ok: false,
    };
  }
  return { ok: true };
}
