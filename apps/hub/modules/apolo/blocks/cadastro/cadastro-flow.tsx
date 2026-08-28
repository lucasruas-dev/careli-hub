"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Loader2,
  Lock,
  Mail,
  Pencil,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserRound,
  X,
} from "lucide-react";

import {
  type C2xOption,
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  mapDocType,
  matchEstadoCivilId,
  matchFaixaRendaId,
  matchRegimeBensId,
  matchSexoId,
  mesesDesde,
  normalizeSearch,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import {
  COMPROVANTE_RENDA_OPCOES,
  type ComprovanteRendaCategoria,
  documentosFaltandoCurto,
  juntarPtBr,
} from "@/lib/apolo/cadastro-obrigatorios";
import { cpfValido } from "@/lib/apolo/documento";
import {
  casarProfissaoNaLista,
  normalizarProfissaoLivre,
  profissaoExibida,
  profissaoPendenteDePadronizacao,
  temProfissao,
} from "@/lib/apolo/profissao";
import { getHubSupabaseClient } from "@/lib/supabase/client";

import {
  type CadCampo,
  type CadDoc,
  type CadSecao,
} from "./cad-pdf";
import {
  arquivoParaDrive,
  arquivoParaLeitura,
  ehPdf,
  trocarExtensaoParaJpg,
} from "../../lib/document-capture";
import {
  type AssinaturaUpload,
  bytesDoBase64,
  subirDocumentoDireto,
} from "../../lib/document-upload";
import { buscarEnderecoPorCep, soDigitos } from "../../lib/cep";
import { CampoCidade } from "./campo-cidade";

// Wizard de cadastro de CAD (prospect). Etapas: Identificação -> Endereço ->
// (Cônjuge se casado) -> Revisão. Campos read-only vêm do documento/MOST;
// perfil (sexo/estado civil/escolaridade/renda) usa seletores do C2X.

// Opção de seletor que aceita id numérico (lookups do C2X) ou string (entidades
// do Apolo, como as imobiliárias vindas do read-model).
type SelectOption = { id: number | string; label: string };

type CadastroDraft = Record<string, string>;
type Extraction = {
  cadastro: CadastroDraft;
  // Aviso NÃO-bloqueante de baixa confiança: preenchido pelo conferirDocumento quando o doc é de
  // uma família que não trava (comprovante/certidão/genérico). O DocUploader mostra em âmbar.
  avisoQualidade?: string;
  // Confiança do documento inteiro, dita pela MOST (result[].score) — é o porteiro.
  confiancaDocumento?: number | null;
  // Recorte tratado que a MOST devolve (endireitado, sem fundo). Vai pro drive no lugar da
  // foto crua quando existir.
  crop?: string;
  documentType: string;
  fields: { confidence: number | null; key: string; label: string; value: string }[];
  overallConfidence: number | null;
};
type Enrichment = {
  available: boolean;
  conjuge: string;
  // CRECI do conselho de classe (class_organization). Best-effort — pode vir vazio. Ver mostqi.ts.
  creci: string;
  emails: string[];
  estadoCivil: string;
  // Nome completo do titular (basic_data.name). É o que permite pedir SÓ o CPF e preencher o resto.
  nome: string;
  nomeMae: string;
  nomePai: string;
  patrimonio: string;
  profissao: string;
  raw?: unknown;
  renda: string;
  sexo: string;
  source: string;
  telefones: string[];
  warnings: string[];
};

const ENRICH_VAZIO: Enrichment = {
  available: false, conjuge: "", creci: "", emails: [], estadoCivil: "", nome: "", nomeMae: "",
  nomePai: "", patrimonio: "", profissao: "", renda: "", sexo: "",
  source: "", telefones: [], warnings: [],
};

// Sem RG: o número do RG está sendo extinto (decisão do Lucas 16/jul) — o cadastro se apoia
// no CPF. Isso vale pro titular, pro cônjuge e pra CAD.
// Espelha o CompanyEnrichment do mostqi (o wizard não importa o módulo server-side).
type CompanyEnrichment = {
  atividade: string;
  available: boolean;
  cnae: string;
  dataAbertura: string;
  emails: string[];
  naturezaJuridica: string;
  nomeFantasia: string;
  porte: string;
  razaoSocial: string;
  situacaoCadastral: string;
  socios: Array<{ nome: string; qualificacao: string }>;
  source: string;
  telefones: string[];
  warnings: string[];
};

type Identidade = {
  cpf: string;
  dataNascimento: string;
  // Vêm do próprio documento (a CNH devolve LOCAL_NASCIMENTO e NACIONALIDADE, ~98%).
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  nomePai: string;
  orgaoEmissor: string;
  tipoDocumento: string;
};
type Endereco = {
  bairro: string;
  cep: string;
  cidade: string;
  complemento: string;
  dataDocumento: string;
  logradouro: string;
  numero: string;
  tipoDocumento: string;
  uf: string;
};
type Perfil = {
  email: string;
  escolaridadeId: string;
  estadoCivilId: string;
  imobiliariaId: string;
  patrimonio: string;
  profissaoId: string;
  // PROFISSÃO DIGITADA à mão, quando ela não existe entre as 234 do C2X (pedido do Lucas 27/08).
  // Fica SEPARADA de `profissaoId` de propósito: aquele campo alimenta uma FK do C2X
  // (users.profession_id, bigint) e é lido por 7 conversores id↔rótulo. Ver lib/apolo/profissao.ts.
  // O backoffice escolhe a profissão equivalente da lista na tela de validação da CAD.
  profissaoOutro: string;
  // Regime de bens (só casado / união estável). Fonte = certidão de casamento.
  regimeBensId: string;
  rendaEstimada: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};

const PERFIL_VAZIO: Perfil = {
  email: "", escolaridadeId: "", estadoCivilId: "", imobiliariaId: "",
  patrimonio: "", profissaoId: "", profissaoOutro: "", regimeBensId: "", rendaEstimada: "",
  rendaId: "", sexoId: "", telefone: "",
};

// Cônjuge: mesma ficha do titular. Documento (nome/cpf/rg/nascimento/mãe) +
// enriquecimento próprio (sexo, telefone, faixa de renda, patrimônio) +
// escolaridade/profissão manuais. Estado civil herda do titular.
type Conjuge = {
  cpf: string;
  dataNascimento: string;
  documentoLido: boolean;
  email: string;
  escolaridadeId: string;
  // Lidos do documento do próprio cônjuge (o RG dela traz naturalidade e nacionalidade).
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  patrimonio: string;
  profissaoId: string;
  // Mesma saída do titular: profissão digitada quando não está na lista do C2X.
  profissaoOutro: string;
  rendaId: string;
  sexoId: string;
  telefone: string;
};

const CONJUGE_VAZIO: Conjuge = {
  cpf: "", dataNascimento: "", documentoLido: false, email: "",
  escolaridadeId: "", nacionalidade: "", naturalidade: "", nome: "", nomeMae: "",
  patrimonio: "", profissaoId: "", profissaoOutro: "", rendaId: "", sexoId: "", telefone: "",
};

// Persona do cadastro, definida pelo documento: RG/CNH -> pessoa física (pf);
// cartão CNPJ -> pessoa jurídica (pj).
type Persona = "pf" | "pj";

// Arquivo que o operador anexou. Fica retido no fluxo porque, no envio, o original vai pro
// drive da entidade junto do CAD (decisão do Lucas: "Arquivos + CAD").
type ArquivoAnexado = { fileBase64: string; fileName: string; mimeType: string };
// Categoria do documento no drive (vira document_type no Apolo).
// As três formas do comprovante de renda entram como categorias IRMÃS (não como uma só): é o que
// faz o documento chegar na ficha já dizendo qual das três o cliente entregou.
type DocCategoria =
  | "certidao"
  | "comprovante_endereco"
  | "contrato_social"
  | "identificacao"
  | "identificacao_conjuge"
  | ComprovanteRendaCategoria;
// N arquivos por categoria: um documento pode ter frente + verso, ou varias paginas.
type DocumentosAnexados = Partial<Record<DocCategoria, ArquivoAnexado[]>>;

// ---------------------------------------------------------------------------
// Dois caminhos para o arquivo, escolhidos por TAMANHO (decisão do Lucas)
// ---------------------------------------------------------------------------
//
// PEQUENO: segue o fluxo de HOJE, base64 dentro do JSON de /salvar. Nada muda — nem o agrupamento
// de RG frente+verso num PDF único, nem a leitura, nem a ordem das coisas.
// GRANDE: sobe DIRETO pro Storage (URL assinada) e no JSON viaja só o caminho do arquivo gravado.
//
// O corte isola o risco: o caminho novo só é exercitado por arquivo que HOJE JÁ FALHA.
//
// DE ONDE SAI O NÚMERO: a Vercel corta o corpo da requisição em ~4,5MB ANTES de a rota rodar, e o
// base64 infla o arquivo em ~33% (4,5MB de base64 são ~3,4MB de arquivo). Descontando o resto do
// JSON (a estrutura da CAD, ficha, sócios), sobra o teto de 3,2MB de base64 que JÁ roda em
// produção hoje. Mantê-lo é o que garante que todo cadastro que funciona hoje continue idêntico:
// se tudo cabe em 3,2MB, nada sobe direto.
const TETO_CORPO_BASE64 = 3_200_000;
// Teto por documento, em bytes REAIS do arquivo. Acima disso não existe caminho: nem o direto.
const TETO_DOCUMENTO_BYTES = 20 * 1024 * 1024;

type DocumentoEnvio = {
  categoria: string;
  fileBase64?: string;
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  storagePath?: string;
};

// Quais CATEGORIAS não cabem no corpo e vão pelo caminho direto.
//
// A decisão é por CATEGORIA, nunca por arquivo solto: frente e verso do mesmo documento têm que ir
// pelo mesmo caminho, senão o servidor fica com os bytes de uma face e o caminho da outra e o PDF
// único do drive quebraria. Categorias MENORES primeiro: o orçamento do corpo é gasto com o que já
// cabe hoje e só o excedente vai pro caminho novo.
function categoriasParaUploadDireto(docs: DocumentoEnvio[]): Set<string> {
  const porCategoria = new Map<string, number>();
  for (const doc of docs) {
    const atual = porCategoria.get(doc.categoria) ?? 0;
    porCategoria.set(doc.categoria, atual + (doc.fileBase64?.length ?? 0));
  }

  const direto = new Set<string>();
  let usado = 0;
  for (const [categoria, tamanho] of [...porCategoria.entries()].sort((a, b) => a[1] - b[1])) {
    if (usado + tamanho <= TETO_CORPO_BASE64) usado += tamanho;
    else direto.add(categoria);
  }
  return direto;
}

// QSA que vem do enriquecimento por CNPJ: informativo, read-only.
type Socio = { nome: string; qualificacao: string };

// Sócio CADASTRADO pelo operador — ficha própria, porque é pessoa física de verdade e é quem
// responde/assina pela empresa. O comprovante de endereço nasce DENTRO do bloco do sócio
// (decisão do Lucas 17/jul): em etapas separadas não dá pra saber qual comprovante é de quem.
// Estado civil é manual e NÃO puxa cônjuge — no PJ o cônjuge não interessa ao negócio.
type SocioCadastro = {
  arquivosComprovante: ArquivoAnexado[];
  arquivosIdentificacao: ArquivoAnexado[];
  cpf: string;
  dataNascimento: string;
  documentoLido: boolean;
  email: string;
  endereco: Endereco;
  estadoCivilId: string;
  id: string;
  nacionalidade: string;
  naturalidade: string;
  nome: string;
  nomeMae: string;
  // Quem assina pela empresa (o contrato social é que define). Sem isto a CAD não habilita
  // contrato, que é o propósito dela.
  representanteLegal: boolean;
  sexoId: string;
  telefone: string;
};

const SOCIO_VAZIO: Omit<SocioCadastro, "id"> = {
  arquivosComprovante: [],
  arquivosIdentificacao: [],
  cpf: "",
  dataNascimento: "",
  documentoLido: false,
  email: "",
  endereco: {
    bairro: "", cep: "", cidade: "", complemento: "", dataDocumento: "",
    logradouro: "", numero: "", tipoDocumento: "", uf: "",
  },
  estadoCivilId: "",
  nacionalidade: "",
  naturalidade: "",
  nome: "",
  nomeMae: "",
  representanteLegal: false,
  sexoId: "",
  telefone: "",
};
// Pessoa jurídica: dados da empresa (cartão CNPJ + enriquecimento por CNPJ) +
// contato + vínculo. Sem sexo/estado civil/escolaridade (isso é PF).
type Empresa = {
  atividade: string;
  cnae: string;
  cnpj: string;
  // CRECI Jurídico (só imobiliária). Best-effort pelo enriquecimento; editável; NÃO obrigatório.
  creci: string;
  dataAbertura: string;
  // Data da atualização cadastral. O C2X exige; a fonte é o contrato social (leitura), com
  // fallback pra data de situação cadastral do cartão CNPJ. Prospect não informa NIRE nem
  // inscrição municipal (vão "isento" no C2X) — decisão do Lucas 17/jul.
  dataAtualizacao: string;
  documentoLido: boolean;
  email: string;
  naturezaJuridica: string;
  nomeFantasia: string;
  porte: string;
  razaoSocial: string;
  situacaoCadastral: string;
  socios: Socio[];
  telefone: string;
  tipoDocumento: string;
};

const EMPRESA_VAZIA: Empresa = {
  atividade: "", cnae: "", cnpj: "", creci: "", dataAbertura: "", dataAtualizacao: "",
  documentoLido: false, email: "", naturezaJuridica: "",
  nomeFantasia: "", porte: "", razaoSocial: "", situacaoCadastral: "",
  socios: [], telefone: "", tipoDocumento: "",
};

// Corretor vinculado à imobiliária (só no cadastro de imobiliária). Cadastro SIMPLES, digitado —
// nome, CPF, telefone, e-mail e CRECI. O CRECI tenta vir do enriquecimento por CPF; se não vier,
// o operador digita. Nada além de nome/CPF é obrigatório. Cada corretor vira um relacionamento de
// CONTATO da imobiliária (decisão do Lucas 18/jul).
type CorretorCadastro = {
  cpf: string;
  creci: string;
  // true = CRECI veio do enriquecimento (read-only); false = digitado à mão.
  creciLido: boolean;
  email: string;
  id: string;
  nome: string;
  telefone: string;
};

function corretorVazio(): CorretorCadastro {
  const id = `corretor-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return { cpf: "", creci: "", creciLido: false, email: "", id, nome: "", telefone: "" };
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}


// Sem mock: o localhost lê documento e enriquece de verdade, igual produção (Lucas 19/jul).
// ⚠️ Cada leitura/enriquecimento aqui é uma consulta COBRADA na MOST.

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Acha a data de emissão/referência/vencimento do comprovante nos campos lidos
// pelo MOST (pra saber se está atual). Prefere um campo com rótulo de data;
// senão pega a primeira data encontrada.
// Uma data de comprovante só é confiável se for PLAUSÍVEL: entre 24 meses atrás e 1 mês à
// frente. ⚠️ Sem este filtro, o fallback abaixo (que aceita a primeira data de QUALQUER campo)
// pescava lixo da leitura — número de medidor, código de barras, histórico de consumo — e uma
// "data" de 2007 virava "comprovante vencido: emitido há 227 meses", travando a CAD (caso real
// de 22/08). Data implausível = leitura não confiável = melhor devolver vazio e AVISAR do que
// acusar um vencimento que não existe.
function dataPlausivel(valor: string): boolean {
  const meses = mesesDesde(valor);
  return meses !== null && meses >= -1 && meses <= 24;
}

function acharDataComprovante(fields: Extraction["fields"]): string {
  const dateRe = /\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;
  const prefer = /emiss|referenc|venc|competenc|data/i;
  for (const field of fields) {
    if (prefer.test(`${field.label} ${field.key}`)) {
      const match = field.value.match(dateRe);
      if (match && dataPlausivel(match[0])) return match[0];
    }
  }
  for (const field of fields) {
    const match = field.value.match(dateRe);
    if (match && dataPlausivel(match[0])) return match[0];
  }
  return "";
}



// Anexo puro (contrato social): nada foi lido, entao nao ha campo, tipo nem score pra conferir.
const EXTRACAO_VAZIA: Extraction = {
  cadastro: {},
  confiancaDocumento: null,
  crop: "",
  documentType: "",
  fields: [],
  overallConfidence: null,
};









// MOST classifica o documento. Cartão CNPJ / comprovante de inscrição -> PJ.
function isCnpjDoc(type: string): boolean {
  return /cnpj|cartao.?cnpj|comprovante.*inscri|pessoa.?jur|company|business/i.test(
    String(type ?? ""),
  );
}



// ---------- telefone internacional (bandeira + formato por país) ----------

type PhoneCountry = { dial: string; flag: string; iso: string; mask: string; name: string };

// Brasil primeiro (padrão). Máscara usa # por dígito.
const BR_PHONE: PhoneCountry = {
  dial: "55", flag: "🇧🇷", iso: "BR", mask: "(##) #####-####", name: "Brasil",
};
const PHONE_COUNTRIES: PhoneCountry[] = [
  BR_PHONE,
  { dial: "351", flag: "🇵🇹", iso: "PT", mask: "### ### ###", name: "Portugal" },
  { dial: "1", flag: "🇺🇸", iso: "US", mask: "(###) ###-####", name: "Estados Unidos" },
  { dial: "54", flag: "🇦🇷", iso: "AR", mask: "## ####-####", name: "Argentina" },
  { dial: "595", flag: "🇵🇾", iso: "PY", mask: "### ### ###", name: "Paraguai" },
  { dial: "598", flag: "🇺🇾", iso: "UY", mask: "#### ####", name: "Uruguai" },
  { dial: "56", flag: "🇨🇱", iso: "CL", mask: "# #### ####", name: "Chile" },
  { dial: "57", flag: "🇨🇴", iso: "CO", mask: "### ### ####", name: "Colômbia" },
  { dial: "591", flag: "🇧🇴", iso: "BO", mask: "### #####", name: "Bolívia" },
  { dial: "34", flag: "🇪🇸", iso: "ES", mask: "### ## ## ##", name: "Espanha" },
  { dial: "39", flag: "🇮🇹", iso: "IT", mask: "### ### ####", name: "Itália" },
  { dial: "33", flag: "🇫🇷", iso: "FR", mask: "# ## ## ## ##", name: "França" },
  { dial: "49", flag: "🇩🇪", iso: "DE", mask: "#### #######", name: "Alemanha" },
  { dial: "44", flag: "🇬🇧", iso: "GB", mask: "##### ######", name: "Reino Unido" },
  { dial: "52", flag: "🇲🇽", iso: "MX", mask: "## #### ####", name: "México" },
  { dial: "244", flag: "🇦🇴", iso: "AO", mask: "### ### ###", name: "Angola" },
];

function applyPhoneMask(digits: string, mask: string): string {
  let out = "";
  let di = 0;
  for (const ch of mask) {
    if (di >= digits.length) break;
    if (ch === "#") out += digits[di++];
    else out += ch;
  }
  if (di < digits.length) out += digits.slice(di);
  return out;
}

function parsePhone(value: string): { country: PhoneCountry; national: string } {
  const v = String(value ?? "").trim();
  if (v.startsWith("+")) {
    const digits = v.replace(/\D/g, "");
    const byLen = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
    const match = byLen.find((c) => digits.startsWith(c.dial));
    if (match) return { country: match, national: digits.slice(match.dial.length) };
  }
  return { country: BR_PHONE, national: v.replace(/\D/g, "") };
}

function composePhone(country: PhoneCountry, national: string): string {
  const nat = applyPhoneMask(national, country.mask);
  return nat ? `+${country.dial} ${nat}` : `+${country.dial}`;
}



// Tenta achar o REGIME DE BENS na certidão lida pelo MOST. Best-effort de propósito: o
// catálogo de enriquecimento do MOST não tem regime de bens (só estado civil), e não temos
// confirmação de que o iOCR devolve esse campo na certidão. Então primeiro procuramos um campo
// rotulado "regime"; se não houver, varremos os valores atrás do texto do regime. Não achando,
// devolve "" e o operador escolhe na mão — nunca trava o fluxo.
function acharRegimeCertidao(ext: Extraction): string {
  for (const campo of ext.fields) {
    if (/regime/i.test(campo.key) || /regime/i.test(campo.label)) {
      const id = matchRegimeBensId(campo.value);
      if (id) return id;
    }
  }
  for (const campo of ext.fields) {
    const id = matchRegimeBensId(campo.value);
    if (id) return id;
  }
  return "";
}

// MOST valida se o documento e mesmo uma certidao (classificacao do tipo).
function isCertidao(type: string): boolean {
  return /certid|casamento|nascimento|uniao|marriage|birth/i.test(type);
}

// Familia do documento, usando a MESMA classificacao do mapDocType (fonte unica). Serve pra
// barrar documento trocado de etapa: o cadastro pede identificacao e o operador sobe o
// comprovante, o iOCR "meio que le" e a ficha nasce com dado do documento errado.
type FamiliaDoc = "certidao" | "cnpj" | "comprovante" | "identidade" | "outro";

const LABELS_IDENTIDADE = ["RG", "CNH", "Passaporte"];
const LABELS_COMPROVANTE = [
  "Comprovante de endereço",
  "Conta de gás",
  "Conta de luz",
  "Conta de telefone",
  "Conta de água",
  "Correspondência bancária",
];

function familiaDoc(type: string): FamiliaDoc {
  if (isCnpjDoc(type)) return "cnpj";
  if (isCertidao(type)) return "certidao";
  const label = mapDocType(type);
  if (LABELS_IDENTIDADE.includes(label)) return "identidade";
  if (LABELS_COMPROVANTE.includes(label)) return "comprovante";
  return "outro";
}

// Confiança MÍNIMA do documento (o score que a própria MOST dá pro documento inteiro).
// Identificação (RG/CNH/cartão CNPJ) é padronizada: 80%. Comprovante e certidão são documentos
// variados (conta de luz, certidão de cartório) que a MOST lê com menos confiança — 65% (decisão
// do Lucas 17/jul), senão o corte barrava documento legítimo.
const CONFIANCA_MINIMA: Record<FamiliaDoc, number> = {
  certidao: 0.65,
  cnpj: 0.8,
  comprovante: 0.65,
  identidade: 0.8,
  outro: 0.65,
};


// Confere o documento e ANOTA AVISOS — nunca trava (decisão do Lucas, 02/08: "tira a trava da
// certidão de casamento e outras; se a MOST não conseguir ler, abre manual, mas salva o
// arquivo"). Antes, tipo trocado e qualidade baixa de RG/CNH lançavam erro e o ARQUIVO ERA
// DESCARTADO junto — no dia do evento isso barrou certidão legítima que a MOST não reconhece.
// A leitura vira apoio: preenche o que conseguir, avisa o que desconfiou, e quem confere é o
// operador na Validação. O arquivo enviado SEMPRE fica salvo (retenção no DocUploader).
function conferirDocumento(ext: Extraction, aceitas: FamiliaDoc[], pedido: string): void {
  const familia = familiaDoc(ext.documentType);
  const avisos: string[] = [];

  // Tipo trocado com clareza ("outro" não conta): não barra mais, mas avisa alto.
  if (familia !== "outro" && !aceitas.includes(familia)) {
    const lido = mapDocType(ext.documentType);
    avisos.push(
      `A leitura reconheceu ${lido ? `"${lido}"` : "outro tipo de documento"}. Confira se ` +
        `anexou ${pedido}. O arquivo foi salvo; se estiver certo, siga e preencha os campos na mão.`,
    );
  }

  // Qualidade do documento: usa o score que a PRÓPRIA MOST dá pro documento inteiro
  // (result[].score). Não usar a média dos campos: ela afunda com QR code / código de segurança
  // e reprovaria documento bom.
  const minima = CONFIANCA_MINIMA[familia];
  const confianca = ext.confiancaDocumento ?? null;
  if (confianca !== null && confianca < minima) {
    avisos.push(
      `A foto ficou difícil de ler (${Math.round(confianca * 100)}% de nitidez). ` +
        "Alguns dados podem faltar: confira o que foi preenchido e complete na mão.",
    );
  }

  if (avisos.length) ext.avisoQualidade = avisos.join(" ");
}

function mapCertidao(type: string): string {
  const v = type.toLowerCase();
  if (v.includes("casamento")) return "Certidão de casamento";
  if (v.includes("uniao")) return "Certidão de união estável";
  if (v.includes("nascimento")) return "Certidão de nascimento";
  return "Certidão";
}

// Certidão que o CAD exige conforme o estado civil (id do C2X).
function certidaoEsperada(estadoCivilId: string): { hint: string; titulo: string } {
  switch (estadoCivilId) {
    case "3":
      return {
        hint: "Certidão de casamento com averbação do divórcio",
        titulo: "Certidão de casamento (averbação do divórcio)",
      };
    case "4":
      return {
        hint: "Certidão de casamento com averbação da separação",
        titulo: "Certidão de casamento (averbação da separação)",
      };
    case "6":
      return {
        hint: "Certidão ou escritura pública de união estável",
        titulo: "Certidão de união estável",
      };
    default:
      return { hint: "Certidão de casamento atualizada", titulo: "Certidão de casamento" };
  }
}



async function apiPost<T>(body: Record<string, unknown>): Promise<T> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/mostqi", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!response.ok || !json?.data) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return json.data;
}

// Fecha o ciclo: cria a ENTIDADE (papel prospect) e salva os documentos + a CAD no drive.
// Diferente do apiPost (que fala com a leitura documental), esta rota escreve no Apolo.
// A CAD volta pronta do servidor (com o código de autenticação impresso).
type SalvarResposta = {
  autenticacao: string;
  cadBase64: string | null;
  entityId: string;
  savedDocs: string[];
  warnings: string[];
};

async function apiSalvarCadastro(body: Record<string, unknown>): Promise<SalvarResposta> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/cadastro/salvar", {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | (Partial<SalvarResposta> & { error?: string })
    | null;
  if (!response.ok || !json?.entityId) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return {
    autenticacao: json.autenticacao ?? "",
    cadBase64: json.cadBase64 ?? null,
    entityId: json.entityId,
    savedDocs: json.savedDocs ?? [],
    warnings: json.warnings ?? [],
  };
}

// Baixa a CAD que o SERVIDOR gerou (base64) — é o mesmo arquivo guardado no drive, com o
// código de autenticação impresso.
function baixarCadBase64(base64: string, nomeArquivo: string): void {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let index = 0; index < binario.length; index += 1) {
    bytes[index] = binario.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo.replace(/[\\/:*?"<>|]+/g, " ").trim();
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function apiGetImobiliarias(): Promise<SelectOption[]> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/imobiliarias", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: { imobiliarias?: SelectOption[] } }
    | null;
  return json?.data?.imobiliarias ?? [];
}

// Empreendimentos que o operador pode vincular: SÓ os marcados como "na ativa" (recebendo
// credenciamento) — decisão do Lucas 18/jul. É a mesma lista que o portal oferece.
async function apiGetEmpreendimentos(): Promise<SelectOption[]> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/credenciamento", {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: { empreendimentos?: Array<{ id?: string; name?: string }> } }
    | null;
  return (json?.data?.empreendimentos ?? [])
    .filter((row) => row?.id && row?.name)
    .map((row) => ({ id: String(row.id), label: String(row.name) }));
}

// Empreendimentos que UMA imobiliária específica trabalha (só prospect interno): alimenta o
// seletor "Empreendimento" do bloco Vínculo. Bearer via accessToken(); `[]` em erro.
async function apiEmpreendimentosDaImob(
  imobId: string,
): Promise<Array<{ enterpriseId: string; nome: string }>> {
  try {
    const token = await accessToken();
    const response = await fetch(`/api/apolo/imobiliarias/${imobId}/empreendimentos`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = (await response.json().catch(() => null)) as
      | { data?: { empreendimentos?: Array<{ enterpriseId?: string; nome?: string }> } }
      | null;
    return (json?.data?.empreendimentos ?? [])
      .filter((row) => row?.enterpriseId && row?.nome)
      .map((row) => ({ enterpriseId: String(row.enterpriseId), nome: String(row.nome) }));
  } catch {
    return [];
  }
}

// Corretores vinculados a UMA imobiliária (só prospect interno): alimenta o seletor "Corretor" do
// bloco Vínculo. Bearer via accessToken(); `[]` em erro.
async function apiCorretoresDaImob(
  imobId: string,
): Promise<Array<{ entityId: string; nome: string; email: string | null }>> {
  try {
    const token = await accessToken();
    const response = await fetch(`/api/apolo/imobiliarias/${imobId}/corretores`, {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = (await response.json().catch(() => null)) as
      | {
          data?: {
            corretores?: Array<{ entityId?: string; nome?: string; email?: string | null }>;
          };
        }
      | null;
    return (json?.data?.corretores ?? [])
      .filter((row) => row?.entityId && row?.nome)
      .map((row) => ({
        email: row.email ?? null,
        entityId: String(row.entityId),
        nome: String(row.nome),
      }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Adapter de I/O: interno (Bearer) x público (token de sessão do corretor).
//
// POR QUE UM ADAPTER: o wizard é o MESMO nos dois modos (é o pedido do Lucas: "é o mesmo
// processo"). Todo o acoplamento com login mora nos 4 helpers acima, que passam pela
// `accessToken()` (Bearer). Em vez de reescrever o componente, injetamos um adapter: no modo
// interno ele É exatamente os 4 helpers de hoje (default = comportamento atual, byte a byte);
// no público ele fala com /api/publico/cad/* levando o token assinado no HEADER, nunca Bearer.
// `accessToken()` NÃO é chamada em modo público — o adapter público jamais a invoca.
export type PublicoConfig = {
  // Token HS256 emitido pela antessala: sessão do corretor (CAD) OU pré-sessão da imobiliária.
  sessao: string;
  // Header em que o token viaja. CAD do corretor = x-cad-sessao (default); imobiliária =
  // x-cad-pre-sessao-imob. O vínculo sai SEMPRE de dentro do token, no servidor.
  header?: string;
  // Rota de salvamento. CAD = /api/publico/cad/salvar (default); imobiliária =
  // /api/publico/imobiliaria/cadastro. Ambos os modos leem o OCR de /api/publico/cad/ocr.
  salvarUrl?: string;
  // Só para o cabeçalho "CAD para X" (informativo).
  empreendimentoNome?: string;
  // Vínculo que o TOKEN carrega, repassado pelo portão. É a ÚNICA forma de a revisão mostrar
  // imobiliária e corretor no modo público: a lista de imobiliárias (que resolve o rótulo no
  // interno) não é carregada aqui, e não existe rota pública que a liste.
  imobiliariaNome?: string;
  corretorNome?: string;
  // Vitrine de empreendimentos ATIVOS (só imobiliária pública): alimenta o multi-select e a
  // resolução de rótulos, já que NÃO há rota pública que os liste. Vem do server component.
  empreendimentos?: SelectOption[];
};

// O que o EMPREENDIMENTO desta CAD exige além do conjunto de sempre. Hoje só o comprovante de
// renda (etapa nova do Setup); a forma é um objeto para caber a próxima sem mudar assinatura.
export type ExigenciasCad = { comprovanteRenda: boolean };

// Nada exigido a mais. É o valor de partida E o de qualquer falha: a tela nunca inventa uma
// exigência que não conseguiu confirmar — quem barra a CAD é o servidor, no envio.
const SEM_EXIGENCIAS: ExigenciasCad = { comprovanteRenda: false };

export type ApiCadastro = {
  ocr: <T>(body: Record<string, unknown>) => Promise<T>;
  salvar: (body: Record<string, unknown>) => Promise<SalvarResposta>;
  imobiliarias: () => Promise<SelectOption[]>;
  empreendimentos: () => Promise<SelectOption[]>;
  // Permissão de gravar UM documento grande direto no Storage. Mora no adapter porque interno e
  // público falam com rotas diferentes (Bearer x token de sessão).
  assinarUpload: (fileName: string) => Promise<AssinaturaUpload>;
  // Duplicidade conferida NA IDENTIFICAÇÃO DO CPF, venha do MOST ou da digitação (Lucas, 12/08).
  // A trava de verdade continua no salvar; esta aqui existe para o corretor não preencher a ficha
  // inteira e só descobrir no fim que a CAD não pode ser aberta.
  checarCpf: (dados: ChecagemCpfPedido) => Promise<ChecagemCpf>;
  // Etapas extras ligadas no Setup do EMPREENDIMENTO (hoje: comprovante de renda). Interno manda o
  // id escolhido no Vínculo; no público o empreendimento sai do token e o argumento é ignorado.
  exigencias: (enterpriseId?: null | string) => Promise<ExigenciasCad>;
};

export type ChecagemCpfPedido = {
  cpf: string;
  cpfConjuge?: string;
  /** Só o modo interno manda: no público o empreendimento sai do token assinado. */
  enterpriseId?: null | string;
};

export type ChecagemCpf = {
  /** false quando não deu para conferir (CPF incompleto, sem empreendimento, falha de rede). */
  conferido: boolean;
  conflito: null | { mensagem: string; tipo: string };
};

// Nunca deixa a checagem derrubar o wizard: a conferência é conveniência, e a autoridade é a
// trava do servidor no salvar, que é fail-closed. Erro aqui vira "não conferido" e segue.
const SEM_CHECAGEM: ChecagemCpf = { conferido: false, conflito: null };

async function apiChecarCpfInterno(dados: ChecagemCpfPedido): Promise<ChecagemCpf> {
  try {
    const token = await accessToken();
    const response = await fetch("/api/apolo/cadastro/checar-cpf", {
      body: JSON.stringify(dados),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      method: "POST",
    });
    const json = (await response.json().catch(() => null)) as null | { data?: ChecagemCpf };
    return json?.data ?? SEM_CHECAGEM;
  } catch {
    return SEM_CHECAGEM;
  }
}

// Etapas extras do empreendimento no modo INTERNO. Lê as settings de TODOS os empreendimentos (a
// rota que já existe) e recorta a do escolhido no Vínculo. Sem empreendimento escolhido não há o
// que exigir — e é o mesmo estado em que o servidor também não consegue cobrar.
async function apiExigenciasInterno(enterpriseId?: null | string): Promise<ExigenciasCad> {
  const id = (enterpriseId ?? "").trim();
  if (!id) return SEM_EXIGENCIAS;
  try {
    const token = await accessToken();
    const response = await fetch("/api/apolo/empreendimentos/settings", {
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const json = (await response.json().catch(() => null)) as null | {
      data?: { settings?: Record<string, { comprovanteRendaHabilitado?: boolean }> };
    };
    return {
      comprovanteRenda: json?.data?.settings?.[id]?.comprovanteRendaHabilitado === true,
    };
  } catch {
    return SEM_EXIGENCIAS;
  }
}

// Espelho público: o empreendimento sai do TOKEN, então a rota não recebe id nenhum.
async function apiExigenciasPublico(headers: Record<string, string>): Promise<ExigenciasCad> {
  try {
    const response = await fetch("/api/publico/cad/exigencias", { cache: "no-store", headers });
    const json = (await response.json().catch(() => null)) as null | {
      comprovanteRenda?: boolean;
    };
    return { comprovanteRenda: json?.comprovanteRenda === true };
  } catch {
    return SEM_EXIGENCIAS;
  }
}

// Pede a permissão de upload direto no modo INTERNO (operador logado, Bearer).
async function apiAssinarUploadCadastro(fileName: string): Promise<AssinaturaUpload> {
  const token = await accessToken();
  const response = await fetch("/api/apolo/cadastro/upload-url", {
    body: JSON.stringify({ fileName }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | (Partial<AssinaturaUpload> & { error?: string })
    | null;
  if (!response.ok || !json?.bucket || !json?.path || !json?.token) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return { bucket: json.bucket, path: json.path, token: json.token };
}

// Espelho público: mesma forma, token de sessão no header em vez de Bearer.
async function assinarUploadPublico(
  headers: Record<string, string>,
  fileName: string,
): Promise<AssinaturaUpload> {
  const response = await fetch("/api/publico/cad/upload-url", {
    body: JSON.stringify({ fileName }),
    cache: "no-store",
    headers,
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | (Partial<AssinaturaUpload> & { error?: string })
    | null;
  if (!response.ok || !json?.bucket || !json?.path || !json?.token) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return { bucket: json.bucket, path: json.path, token: json.token };
}

// Espelho público de `apiPost`: mesma forma (desembrulha `{ data }`), troca Bearer por o header
// de sessão. A rota /api/publico/cad/ocr é um multiplexer por `action`, igual /api/apolo/mostqi.
async function postPublico<T>(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers,
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | { data?: T; error?: string }
    | null;
  if (!response.ok || !json?.data) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return json.data;
}

// Espelho público de `apiSalvarCadastro`: mesmo shape de resposta (`entityId`/`autenticacao`/
// `cadBase64`/`savedDocs`/`warnings`), para o modal de sucesso do wizard funcionar sem mudar.
async function salvarPublico(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<SalvarResposta> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers,
    method: "POST",
  });
  const json = (await response.json().catch(() => null)) as
    | (Partial<SalvarResposta> & { error?: string })
    | null;
  if (!response.ok || !json?.entityId) {
    throw new Error(json?.error ?? `Falha HTTP ${response.status}`);
  }
  return {
    autenticacao: json.autenticacao ?? "",
    cadBase64: json.cadBase64 ?? null,
    entityId: json.entityId,
    savedDocs: json.savedDocs ?? [],
    warnings: json.warnings ?? [],
  };
}

// INTERNO: os 4 helpers de hoje, sem mudança. PÚBLICO: mesmas formas, outra rota + outro header.
// No público a imobiliária e o empreendimento vêm FIXOS do token (antessala), então as listas
// devolvem `[]` e os seletores somem — não há rota pública para enumerar parceiros.
function criarApiCadastro(publico?: PublicoConfig): ApiCadastro {
  if (!publico) {
    return {
      assinarUpload: apiAssinarUploadCadastro,
      checarCpf: apiChecarCpfInterno,
      empreendimentos: apiGetEmpreendimentos,
      exigencias: apiExigenciasInterno,
      imobiliarias: apiGetImobiliarias,
      ocr: apiPost,
      salvar: apiSalvarCadastro,
    };
  }
  const header = publico.header ?? "x-cad-sessao";
  const salvarUrl = publico.salvarUrl ?? "/api/publico/cad/salvar";
  const headers = (): Record<string, string> => ({
    "Content-Type": "application/json",
    [header]: publico.sessao,
  });
  return {
    // A rota pública que assina o upload aceita os DOIS tokens (corretor e imobiliária), então
    // basta repassar o mesmo header que o resto do adapter usa.
    assinarUpload: (fileName: string) => assinarUploadPublico(headers(), fileName),
    // No público o empreendimento sai do TOKEN, então o corpo não manda enterpriseId: mandar
    // deixaria o corretor consultar a carteira de qualquer loteamento.
    checarCpf: async (dados: ChecagemCpfPedido) => {
      try {
        return await postPublico<ChecagemCpf>(
          "/api/publico/cad/checar-cpf",
          { cpf: dados.cpf, cpfConjuge: dados.cpfConjuge ?? "" },
          headers(),
        );
      } catch {
        return SEM_CHECAGEM;
      }
    },
    // Imobiliária pública: a vitrine de ativos vem do token/prop, não de rede (não há rota que
    // liste). CAD do corretor: `[]` — imobiliária e empreendimento já vêm FIXOS do token.
    empreendimentos: async () => publico.empreendimentos ?? [],
    // Só o CAD do corretor tem a rota (o token dela é o `x-cad-sessao`). O auto-cadastro da
    // imobiliária usa o MESMO wizard com outro token, e ali a etapa nem se aplica: ela fala do
    // comprador, não do parceiro. Por isso o portal da imobiliária nunca chega a chamar isto
    // (ver o efeito em CadastroFlow, travado em `!isImobiliaria`).
    exigencias: () => apiExigenciasPublico(headers()),
    imobiliarias: async () => [],
    ocr: <T,>(body: Record<string, unknown>) =>
      postPublico<T>("/api/publico/cad/ocr", body, headers()),
    salvar: (body: Record<string, unknown>) => salvarPublico(salvarUrl, body, headers()),
  };
}

// Contexto que entrega o adapter (e o flag `modoPublico`) aos steps-filhos, que é onde os
// fetches acontecem (DocUploader, StepIdentificacao, BlocoSocio, BlocoCorretor, StepRevisao).
// O DEFAULT é o modo interno: um filho fora do provider (não acontece) ainda funciona igual hoje.
type CadastroCtx = { api: ApiCadastro; modoPublico: boolean };

const ApiCadastroContext = createContext<CadastroCtx>({
  api: {
    assinarUpload: apiAssinarUploadCadastro,
    checarCpf: apiChecarCpfInterno,
    empreendimentos: apiGetEmpreendimentos,
    exigencias: apiExigenciasInterno,
    imobiliarias: apiGetImobiliarias,
    ocr: apiPost,
    salvar: apiSalvarCadastro,
  },
  modoPublico: false,
});

function useCadastroCtx(): CadastroCtx {
  return useContext(ApiCadastroContext);
}

// ---------- geração do documento CAD (PDF impresso) ----------

type Registro = { completo: string; data: string; hora: string };

function formatRegistro(d: Date): Registro {
  const p = (n: number) => String(n).padStart(2, "0");
  const data = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return { completo: `${data} ${hora}`, data, hora };
}

// Monta um campo estruturado do CAD (o PDF cuida do layout).
function cadField(label: string, value: string, full = false): CadCampo {
  return { full, label, value: (value ?? "").trim() || "—" };
}

function cadSection(title: string, fields: CadCampo[]): CadSecao {
  return { fields, title };
}

export function CadastroFlow({
  aviso,
  empreendimentosIniciais,
  publico,
  tipo = "prospect",
}: {
  // Faixa de contexto vinda do portal (ex.: "não encontramos seu CNPJ"). Só aparece na PRIMEIRA
  // etapa: era pra ser uma explicação de entrada, não um aviso que persegue o usuário.
  aviso?: ReactNode;
  // Vem do portal de credenciamento: a imobiliária JÁ escolheu os empreendimentos no passo 1,
  // então o seletor não se repete aqui (só aparece no credenciamento feito pelo nosso time).
  empreendimentosIniciais?: string[];
  // Presente = modo PÚBLICO (link sem login): troca os 4 fetches por /api/publico/cad/*. Ausente
  // = modo INTERNO (default), comportamento de produção intacto.
  publico?: PublicoConfig;
  tipo?: string;
}) {
  // Papel de nascimento da entidade (vem do menu "+" do Apolo). A imobiliária é SEMPRE PJ e tem
  // duas peças a mais que o PJ do prospect: CRECI + vínculo de empreendimentos (na Identificação)
  // e uma etapa de Corretores.
  const isImobiliaria = tipo === "imobiliaria";
  // Adapter de I/O do wizard. No interno é `undefined` → os 4 helpers de hoje; no público troca a
  // origem sem tocar em mais nada. Vai por contexto porque os fetches moram nos steps-filhos.
  const modoPublico = Boolean(publico);
  const ctx = useMemo<CadastroCtx>(
    () => ({ api: criarApiCadastro(publico), modoPublico: Boolean(publico) }),
    [publico],
  );
  const { api } = ctx;
  // Remontar tudo do zero: incrementar esta key recria o wizard (inclusive o estado interno dos
  // uploaders, que guardam a lista de arquivos localmente) — é o "recomeçar cadastro".
  const [resetKey, setResetKey] = useState(0);
  const [step, setStep] = useState(0);
  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [perfil, setPerfil] = useState<Perfil>(PERFIL_VAZIO);
  const [enrich, setEnrich] = useState<Enrichment | null>(null);
  const [endereco, setEndereco] = useState<Endereco | null>(null);
  const [conjuge, setConjuge] = useState<Conjuge>(CONJUGE_VAZIO);
  // Persona definida pelo documento (RG/CNH -> pf, cartão CNPJ -> pj). Imobiliária já nasce PJ.
  const [persona, setPersona] = useState<Persona>(isImobiliaria ? "pj" : "pf");
  const [empresa, setEmpresa] = useState<Empresa>(EMPRESA_VAZIA);
  // Originais anexados em cada etapa; vao pro drive da entidade no envio.
  const [documentos, setDocumentos] = useState<DocumentosAnexados>({});
  // Sócios cadastrados (PJ). Cada um carrega os próprios arquivos.
  const [socios, setSocios] = useState<SocioCadastro[]>([]);
  const [imobiliarias, setImobiliarias] = useState<SelectOption[]>([]);
  // Só imobiliária: empreendimentos ativos (vínculo de trabalho) e corretores (vínculo de contato).
  const [empreendimentos, setEmpreendimentos] = useState<SelectOption[]>([]);
  const [empreendimentosSel, setEmpreendimentosSel] = useState<string[]>(
    empreendimentosIniciais ?? [],
  );
  // Seleção herdada do portal = não repete o seletor na Identificação.
  const empreendimentosHerdados = Boolean(empreendimentosIniciais?.length);
  const [corretores, setCorretores] = useState<CorretorCadastro[]>([]);
  // Prospect INTERNO: depois de escolher a imobiliária no "Vínculo", vincula-se um empreendimento
  // (que ELA trabalha) e um corretor (dela). Rotas próprias por imobiliária; só existe quando
  // `!isImobiliaria && !modoPublico`. Ver o effect e o objeto `vinculoProspect` abaixo.
  const [empImobLista, setEmpImobLista] = useState<Array<{ enterpriseId: string; nome: string }>>(
    [],
  );
  const [empImobSel, setEmpImobSel] = useState("");
  const [corretorImobLista, setCorretorImobLista] = useState<
    Array<{ entityId: string; nome: string; email: string | null }>
  >([]);
  const [corretorImobSel, setCorretorImobSel] = useState("");
  // Etapas extras que o EMPREENDIMENTO liga no Setup (hoje: comprovante de renda). Parte de
  // "nenhuma": a tela só acrescenta etapa depois de o servidor confirmar que ela está ligada.
  const [exigencias, setExigencias] = useState<ExigenciasCad>(SEM_EXIGENCIAS);

  // Imobiliárias reais do Apolo (read-model), inclusive no localhost: a chave de serviço do
  // .env.local valida contra o projeto de produção (verificado 16/jul). Sem lista, o seletor
  // fica vazio -- nunca placeholder, pra não vincular a CAD a uma imobiliária inexistente.
  useEffect(() => {
    // No público a imobiliária vem FIXA do token (antessala): não há seletor nem rota para listar.
    if (modoPublico) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api.imobiliarias();
        if (alive && list.length) setImobiliarias(list);
      } catch {
        // sem lista: seletor fica vazio
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, modoPublico]);

  // Empreendimentos ativos pro vínculo de trabalho da imobiliária. Interno lê o C2X read-only;
  // na imobiliária PÚBLICA o adapter devolve a vitrine que veio do token/prop (sem rede). Só a
  // imobiliária usa isto — no CAD do corretor `isImobiliaria` é false e o efeito nem roda.
  useEffect(() => {
    if (!isImobiliaria) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api.empreendimentos();
        if (alive && list.length) setEmpreendimentos(list);
      } catch {
        // sem lista: multi-select fica vazio
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, isImobiliaria, modoPublico]);

  // Prospect INTERNO: ao escolher a imobiliária no "Vínculo", carrega os empreendimentos que ELA
  // trabalha e os corretores dela (rotas próprias). Só dispara quando `imobiliariaId` é uma
  // imobiliária de verdade (UUID) — o mesmo seletor casa corretores avulsos, cujo id não é UUID.
  // Trocar de imobiliária zera as seleções; 1 empreendimento já seleciona; 0 ou vários = operador.
  useEffect(() => {
    if (isImobiliaria || modoPublico) return;
    const imobId = perfil.imobiliariaId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imobId);
    if (!isUuid) {
      setEmpImobLista([]);
      setEmpImobSel("");
      setCorretorImobLista([]);
      setCorretorImobSel("");
      return;
    }
    let alive = true;
    // Zera a seleção de corretor de cara: a lista da imobiliária ANTERIOR não vale pra esta.
    setCorretorImobSel("");
    void (async () => {
      const [emps, cors] = await Promise.all([
        apiEmpreendimentosDaImob(imobId),
        apiCorretoresDaImob(imobId),
      ]);
      if (!alive) return;
      setEmpImobLista(emps);
      // Exatamente 1 → já seleciona (read-only na tela); 0 ou vários → operador decide.
      setEmpImobSel(emps.length === 1 && emps[0] ? emps[0].enterpriseId : "");
      setCorretorImobLista(cors);
      setCorretorImobSel("");
    })();
    return () => {
      alive = false;
    };
  }, [isImobiliaria, modoPublico, perfil.imobiliariaId]);

  // Etapas extras do EMPREENDIMENTO (hoje só o comprovante de renda). No público o empreendimento
  // vem do token e a leitura acontece uma vez; no interno ela reage à escolha do Vínculo, porque é
  // ali que o operador decide de qual empreendimento é esta CAD.
  //
  // A IMOBILIÁRIA FICA DE FORA: o auto-cadastro dela roda neste mesmo wizard, mas a etapa fala do
  // COMPRADOR da CAD, não do parceiro — e o token dela nem abre a rota pública de exigências.
  useEffect(() => {
    if (isImobiliaria) {
      setExigencias(SEM_EXIGENCIAS);
      return;
    }
    let alive = true;
    void api
      .exigencias(modoPublico ? null : empImobSel)
      .then((valor) => {
        if (alive) setExigencias(valor);
      })
      .catch(() => {
        // A trava de verdade é o servidor no envio: aqui, falha = não mostra etapa nova.
        if (alive) setExigencias(SEM_EXIGENCIAS);
      });
    return () => {
      alive = false;
    };
  }, [api, empImobSel, isImobiliaria, modoPublico]);

  // PJ não tem certidão/cônjuge. PF: Casado(2), Divorciado(3), Separado(4) e
  // União Estável(6) exigem certidão (o MOST valida a autenticidade).
  const isPj = persona === "pj";
  const needsCertidao = !isPj && ["2", "3", "4", "6"].includes(perfil.estadoCivilId);
  // Cônjuge presente: casado ou união estável (só PF).
  const temConjuge = !isPj && ["2", "6"].includes(perfil.estadoCivilId);
  // PJ tem jornada própria (Lucas 17/jul): o endereço da empresa já vem do cartão CNPJ, então
  // não se pede comprovante dela — o que se pede é o contrato social e a ficha de cada sócio
  // (com o comprovante DELE dentro do próprio bloco).
  //
  // A etapa RENDA entra por último, logo antes da Revisão, e só quando o empreendimento a liga
  // (`exigencias.comprovanteRenda`). Vai no fim de propósito: é a única etapa que não depende do
  // que foi lido antes, então acrescentá-la ali não reordena nada que o corretor já conhece — e a
  // numeração dos cartões sai da posição no array, não de número fixo.
  const exigeRenda = !isImobiliaria && exigencias.comprovanteRenda;
  const steps = isImobiliaria
    ? ["Identificação", "Contrato social", "Sócios", "Corretores", "Revisão"]
    : [
        ...(isPj
          ? ["Identificação", "Contrato social", "Sócios"]
          : needsCertidao
            ? ["Identificação", "Endereço", "Certidão"]
            : ["Identificação", "Endereço"]),
        ...(exigeRenda ? ["Renda"] : []),
        "Revisão",
      ];
  const current = steps[Math.min(step, steps.length - 1)];

  function jump(target: number) {
    if (target <= step) setStep(target);
  }

  const reterDocumento = (categoria: DocCategoria) => (arquivo: ArquivoAnexado) =>
    setDocumentos((prev) => ({ ...prev, [categoria]: [...(prev[categoria] ?? []), arquivo] }));

  // Trocar a FORMA do comprovante de renda descarta o que já tinha sido anexado nas outras duas.
  // Sem isto, quem sobe o contracheque, se arrepende e escolhe o extrato manda os DOIS para o
  // drive — e a ficha fica com dois comprovantes de renda de tipos diferentes, um deles
  // abandonado, sem ninguém saber qual vale.
  const limparOutrasRendas = (manter: ComprovanteRendaCategoria) =>
    setDocumentos((prev) => {
      const proximo = { ...prev };
      for (const opcao of COMPROVANTE_RENDA_OPCOES) {
        if (opcao.categoria !== manter) delete proximo[opcao.categoria];
      }
      return proximo;
    });

  // Zera tudo pra começar outro cadastro do zero. Reseta os estados daqui E remonta os steps
  // (resetKey) — os uploaders guardam a lista de arquivos internamente, então só limpar o estado
  // do wizard não bastava.
  function recomecar() {
    if (!window.confirm("Recomeçar o cadastro? Todos os documentos e dados anexados serão descartados.")) {
      return;
    }
    setStep(0);
    setIdentidade(null);
    setPerfil(PERFIL_VAZIO);
    setEnrich(null);
    setEndereco(null);
    setConjuge(CONJUGE_VAZIO);
    setPersona(isImobiliaria ? "pj" : "pf");
    setEmpresa(EMPRESA_VAZIA);
    setDocumentos({});
    setSocios([]);
    setEmpreendimentosSel([]);
    setCorretores([]);
    setEmpImobLista([]);
    setEmpImobSel("");
    setCorretorImobLista([]);
    setCorretorImobSel("");
    setResetKey((k) => k + 1);
  }

  // Vínculo do prospect INTERNO (empreendimento + corretor da imobiliária) que vai no payload do
  // salvar. Só existe quando um empreendimento foi resolvido (auto no caso de 1, ou escolhido).
  const empImobSelObj = empImobLista.find((e) => e.enterpriseId === empImobSel);
  const corretorImobSelObj = corretorImobLista.find((c) => c.entityId === corretorImobSel);
  const vinculoProspect =
    !isImobiliaria && !modoPublico && empImobSel
      ? {
          corretorEmail: corretorImobSelObj?.email ?? undefined,
          corretorEntityId: corretorImobSel || undefined,
          corretorNome: corretorImobSelObj?.nome ?? undefined,
          empreendimentoNome: empImobSelObj?.nome ?? undefined,
          enterpriseId: empImobSel,
        }
      : null;

  const activeIndex = Math.min(step, steps.length - 1);
  const pct = Math.round(((activeIndex + 1) / steps.length) * 100);

  return (
    <ApiCadastroContext.Provider value={ctx}>
    <section className="grid h-full min-h-0 gap-4 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-1 py-1 pb-20">
        {aviso && step === 0 ? (
          <div className="rounded-xl border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-4 py-3 print:hidden">
            {aviso}
          </div>
        ) : null}
        <div className="rounded-2xl border border-line bg-surface px-6 py-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] print:hidden">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-lg font-semibold tracking-tight text-ink">
              {isImobiliaria
                ? "Cadastro de Imobiliária"
                : modoPublico
                  ? "Cadastro do cliente"
                  : "Cadastro de CAD"}
            </h1>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-subtle px-3 py-1.5 text-xs font-medium text-ink-soft sm:inline-flex">
                <ShieldCheck className="size-3.5 text-emerald-500" aria-hidden="true" />
                Ambiente seguro
              </span>
              <button
                type="button"
                onClick={recomecar}
                title="Recomeçar cadastro (descarta tudo)"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-subtle hover:text-ink"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Recomeçar
              </button>
              {/* Sair para o Apolo só faz sentido no modo interno (logado). No público não há
                  app para onde voltar: o "Recomeçar" já zera tudo. */}
              {modoPublico ? null : (
                <a
                  href="/apolo"
                  aria-label="Sair do cadastro"
                  title="Sair do cadastro"
                  className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  <X className="size-4" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
          {/* No público a barra do portão já contou "parte 1"; sem esta legenda o corretor vê o
              contador voltar para 1 e acha que perdeu o que preencheu. */}
          {modoPublico ? (
            <span className="mt-5 block text-xs text-ink-muted">
              {/* O mesmo wizard serve o CAD do cliente E o auto-cadastro da imobiliária. Falar em
                  "cliente" na tela da imobiliária confundiria quem está cadastrando a si mesma. */}
              Parte 2 de 2: {isImobiliaria ? "dados da imobiliária" : "dados do cliente"}
              {publico?.empreendimentoNome ? ` · ${publico.empreendimentoNome}` : ""}
            </span>
          ) : null}
          <span
            className={`block text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${
              modoPublico ? "mt-2" : "mt-5"
            }`}
          >
            Etapa {activeIndex + 1} de {steps.length}
          </span>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-inverse transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <Stepper steps={steps} step={step} onJump={jump} />
        </div>

        {/* key={resetKey}: incrementar remonta todos os steps (e o estado interno dos uploaders,
            que guardam a lista de arquivos localmente). `contents` = sem caixa, layout intacto. */}
        <div key={resetKey} className="contents">
        {current === "Identificação" ? (
          <StepIdentificacao
            conjuge={conjuge}
            corretorImobLista={corretorImobLista}
            corretorImobSel={corretorImobSel}
            empImobLista={empImobLista}
            empImobSel={empImobSel}
            empreendimentos={empreendimentos}
            empreendimentosHerdados={empreendimentosHerdados}
            empreendimentosSel={empreendimentosSel}
            empresa={empresa}
            enrich={enrich}
            identidade={identidade}
            imobiliarias={imobiliarias}
            isImobiliaria={isImobiliaria}
            perfil={perfil}
            persona={persona}
            onConjugeChange={(patch) => setConjuge((c) => ({ ...c, ...patch }))}
            onCorretorImobChange={setCorretorImobSel}
            onEmpImobChange={setEmpImobSel}
            onEmpreendimentosChange={setEmpreendimentosSel}
            onDocumento={reterDocumento("identificacao")}
            onDocumentoConjuge={reterDocumento("identificacao_conjuge")}
            onEmpresaChange={(patch) => setEmpresa((e) => ({ ...e, ...patch }))}
            onEmpresaExtract={(ext, emp) => {
              const c = ext.cadastro;
              // Regra: o DOCUMENTO manda, o enriquecimento cobre o que ele não trouxe.
              // (Antes era `c.campo ?? ""`, que apagava o valor do enriquecimento sempre que o
              // cartão CNPJ não tinha o campo — ou seja, quase sempre.)
              setEmpresa((prev) => ({
                ...prev,
                ...emp,
                atividade: c.atividade || emp.atividade || "",
                cnae: c.cnae || emp.cnae || "",
                cnpj: c.cnpj || emp.cnpj || "",
                dataAbertura: c.dataAbertura || emp.dataAbertura || "",
                // Fallback do cartão pra atualização cadastral; a leitura do contrato social
                // (a fonte preferida) e o aviso ao operador entram com a tela de validação.
                dataAtualizacao: c.dataAtualizacao || "",
                documentoLido: true,
                naturezaJuridica: c.naturezaJuridica || emp.naturezaJuridica || "",
                nomeFantasia: c.nomeFantasia || emp.nomeFantasia || "",
                porte: c.porte || emp.porte || "",
                razaoSocial: c.razaoSocial || emp.razaoSocial || "",
                situacaoCadastral: c.situacaoCadastral || emp.situacaoCadastral || "",
                tipoDocumento: ext.documentType,
              }));
              // O endereço da empresa vem no próprio cartão CNPJ.
              if (c.logradouro || c.cidade) {
                setEndereco({
                  bairro: c.bairro ?? "", cep: c.cep ?? "", cidade: c.cidade ?? "",
                  complemento: "", dataDocumento: "", logradouro: c.logradouro ?? "",
                  numero: c.numero ?? "", tipoDocumento: ext.documentType, uf: c.uf ?? "",
                });
              }
            }}
            onPersona={setPersona}
            onExtract={(ext, enr) => {
              const c = ext.cadastro;
              setIdentidade({
                cpf: c.cpf ?? "", dataNascimento: c.dataNascimento ?? "",
                nacionalidade: c.nacionalidade ?? "",
                naturalidade: c.naturalidade ?? "",
                nome: c.nome ?? "", nomeMae: c.nomeMae || enr.nomeMae,
                nomePai: c.nomePai || enr.nomePai,
                orgaoEmissor: c.orgaoEmissor ?? "",
                tipoDocumento: ext.documentType,
              });
              setPerfil((p) => ({
                ...p,
                email: p.email || enr.emails[0] || "",
                estadoCivilId:
                  matchEstadoCivilId(enr.estadoCivil)?.toString() || p.estadoCivilId,
                patrimonio: p.patrimonio || enr.patrimonio,
                rendaEstimada: enr.renda || p.rendaEstimada,
                rendaId: p.rendaId || matchFaixaRendaId(enr.renda),
                // Sexo: o documento manda (RG/CNH trazem impresso); o enriquecimento é a rede.
                sexoId:
                  matchSexoId(c.sexo ?? "")?.toString() ||
                  matchSexoId(enr.sexo)?.toString() ||
                  p.sexoId,
                telefone: p.telefone || enr.telefones[0] || "",
              }));
              setEnrich(enr);
            }}
            onIdentidadeChange={(patch) =>
              setIdentidade((atual) => (atual ? { ...atual, ...patch } : atual))
            }
            onPerfilChange={(patch) => setPerfil((p) => ({ ...p, ...patch }))}
            onNext={() => setStep(1)}
          />
        ) : null}

        {current === "Contrato social" ? (
          <StepContratoSocial
            anexado={(documentos.contrato_social ?? []).length > 0}
            onBack={() => setStep((v) => v - 1)}
            onDocumento={reterDocumento("contrato_social")}
            onNext={() => setStep((v) => v + 1)}
          />
        ) : null}

        {current === "Sócios" ? (
          <StepSocios
            socios={socios}
            onAdicionar={() =>
              setSocios((lista) => [
                ...lista,
                { ...SOCIO_VAZIO, id: `socio-${Date.now()}-${lista.length}` },
              ])
            }
            onBack={() => setStep((v) => v - 1)}
            onAnexar={(id, campo, arquivo) =>
              // Updater: acumula sobre o estado atual, então frente+verso subidos juntos ficam
              // ambos (o closure sobrescrevia e salvava só o último).
              setSocios((lista) =>
                lista.map((socio) =>
                  socio.id === id ? { ...socio, [campo]: [...socio[campo], arquivo] } : socio,
                ),
              )
            }
            onMudar={(id, patch) =>
              setSocios((lista) =>
                lista.map((socio) => (socio.id === id ? { ...socio, ...patch } : socio)),
              )
            }
            onNext={() => setStep((v) => v + 1)}
            onRemover={(id) => setSocios((lista) => lista.filter((socio) => socio.id !== id))}
          />
        ) : null}

        {current === "Corretores" ? (
          <StepCorretores
            corretores={corretores}
            onAdicionar={() => setCorretores((lista) => [...lista, corretorVazio()])}
            onBack={() => setStep((v) => v - 1)}
            onMudar={(id, patch) =>
              setCorretores((lista) =>
                lista.map((c) => (c.id === id ? { ...c, ...patch } : c)),
              )
            }
            onNext={() => setStep((v) => v + 1)}
            onRemover={(id) => setCorretores((lista) => lista.filter((c) => c.id !== id))}
          />
        ) : null}

        {current === "Endereço" ? (
          <StepEndereco
            endereco={endereco}
            onDocumento={reterDocumento("comprovante_endereco")}
            onEnderecoChange={(patch) =>
              setEndereco((atual) => ({
                bairro: "", cep: "", cidade: "", complemento: "", dataDocumento: "",
                logradouro: "", numero: "", tipoDocumento: "", uf: "",
                ...atual,
                ...patch,
              }))
            }
            onExtract={(ext) => {
              const c = ext.cadastro;
              setEndereco({
                bairro: c.bairro ?? "", cep: c.cep ?? "", cidade: c.cidade ?? "",
                complemento: "", dataDocumento: acharDataComprovante(ext.fields),
                logradouro: c.logradouro ?? "", numero: c.numero ?? "",
                tipoDocumento: ext.documentType, uf: c.uf ?? "",
              });
            }}
            onBack={() => setStep(step - 1)}
            onNext={() => setStep(step + 1)}
          />
        ) : null}

        {current === "Certidão" ? (
          <StepCertidao
            estadoCivilId={perfil.estadoCivilId}
            onBack={() => setStep(step - 1)}
            onDocumento={reterDocumento("certidao")}
            onNext={() => setStep(step + 1)}
            onPerfilChange={(patch) => setPerfil((p) => ({ ...p, ...patch }))}
            regimeBensId={perfil.regimeBensId}
          />
        ) : null}

        {current === "Renda" ? (
          <StepRenda
            anexados={documentos}
            numero={activeIndex + 1}
            onBack={() => setStep(step - 1)}
            onDocumento={(categoria) => reterDocumento(categoria)}
            onNext={() => setStep(step + 1)}
            onTrocarTipo={limparOutrasRendas}
          />
        ) : null}

        {current === "Revisão" ? (
          <StepRevisao
            exigeComprovanteRenda={exigeRenda}
            conjuge={temConjuge ? conjuge : null}
            publico={publico}
            corretores={corretores}
            documentos={documentos}
            empreendimentos={empreendimentos}
            empreendimentosSel={empreendimentosSel}
            empresa={empresa}
            endereco={endereco}
            identidade={identidade}
            imobiliarias={imobiliarias}
            isImobiliaria={isImobiliaria}
            perfil={perfil}
            persona={persona}
            socios={socios}
            steps={steps}
            tipo={tipo}
            vinculo={vinculoProspect}
            onBack={() => setStep(step - 1)}
            onEditar={(target) => setStep(target)}
          />
        ) : null}
        </div>
      </div>
    </section>
    </ApiCadastroContext.Provider>
  );
}

function Stepper({
  onJump,
  step,
  steps,
}: {
  onJump: (n: number) => void;
  step: number;
  steps: string[];
}) {
  return (
    <div className="mt-4 flex items-center">
      {steps.map((label, index) => {
        const state = index === step ? "current" : index < step ? "done" : "todo";
        return (
          <div key={label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(index)}
              disabled={index > step}
              className="flex shrink-0 items-center gap-2"
            >
              <span
                className={[
                  "flex size-7 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                  state === "todo"
                    ? "border-line bg-surface text-ink-muted"
                    : "border-line-strong bg-inverse text-brand-ink",
                ].join(" ")}
              >
                {state === "done" ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <span
                className={[
                  "hidden text-xs font-semibold sm:inline",
                  state === "todo" ? "text-ink-muted" : "text-ink",
                ].join(" ")}
              >
                {label}
              </span>
            </button>
            {index < steps.length - 1 ? (
              <div
                className={`mx-2 h-px flex-1 ${index < step ? "bg-inverse/30" : "bg-subtle"}`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ---------- uploader ----------

// Um DOCUMENTO pode ter varios arquivos: RG antigo tem os dados partidos entre frente (foto,
// nome, filiacao) e verso (CPF, nascimento, naturalidade), e contrato social tem N paginas.
// Mesclamos o que cada face trouxe: o primeiro valor preenchido ganha, o score do conjunto e o
// da PIOR face, e os campos crus sao concatenados.
function mesclarExtracoes(extracoes: Extraction[]): Extraction {
  const cadastro: CadastroDraft = {};
  const fields: Extraction["fields"] = [];
  const scores: number[] = [];
  const tipos: string[] = [];
  let crop = "";

  for (const ext of extracoes) {
    for (const [chave, valor] of Object.entries(ext.cadastro ?? {})) {
      if (valor && !cadastro[chave]) cadastro[chave] = valor;
    }
    fields.push(...(ext.fields ?? []));
    if (typeof ext.confiancaDocumento === "number") scores.push(ext.confiancaDocumento);
    if (ext.documentType) tipos.push(ext.documentType);
    if (!crop && ext.crop) crop = ext.crop;
  }

  const gerais = extracoes
    .map((ext) => ext.overallConfidence)
    .filter((valor): valor is number => typeof valor === "number");

  return {
    cadastro,
    // Vale a PIOR face: um verso ilegivel nao pode passar escondido atras de uma frente boa.
    confiancaDocumento: scores.length ? Math.min(...scores) : null,
    crop,
    // Junta os tipos: a familia do documento é reconhecida por qualquer uma das faces.
    documentType: tipos.join(" "),
    fields,
    overallConfidence: gerais.length
      ? gerais.reduce((total, valor) => total + valor, 0) / gerais.length
      : null,
  };
}

type ArquivoLido = { arquivo: ArquivoAnexado; ext: Extraction; nome: string };

function DocUploader({
  busy,
  hint,
  label,
  onExtracted,
  onFile,
  // Documento que e SO anexo (contrato social): nao manda pra leitura. Cada arquivo lido e uma
  // consulta cobrada -- um contrato de 8 paginas queimava 8 consultas sem usar nada.
  semLeitura = false,
}: {
  busy?: boolean;
  hint: string;
  label: string;
  onExtracted: (ext: Extraction) => void | Promise<void>;
  onFile?: (arquivo: ArquivoAnexado) => void;
  semLeitura?: boolean;
}) {
  // Adapter de leitura: interno fala com /api/apolo/mostqi; público com /api/publico/cad/ocr.
  const { api, modoPublico } = useCadastroCtx();
  const [lidos, setLidos] = useState<ArquivoLido[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const working = loading || Boolean(busy);
  const done = lidos.length > 0;

  // Ao importar, ja le automaticamente (sem botao).
  async function processFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setAviso(null);
    setLoading(true);
    try {
      const novos: ArquivoLido[] = [];
      let falhaDeLeitura = false;
      // Mensagem ESPECÍFICA quando a falha não é da leitura em si (429 do teto, 401 de sessão).
      let avisoDeLeitura: string | null = null;

      for (const file of files) {
        let ext: Extraction = EXTRACAO_VAZIA;
        // Rotação que a MOST reconheceu (0 = imagem já em pé, ou PDF, ou anexo puro).
        let graus = 0;

        if (semLeitura) {
          // Anexo puro (contrato): nao le, entao nem gera a versao de alta qualidade.
          ext = EXTRACAO_VAZIA;
        } else {
          // Foto do WhatsApp costuma vir deitada e a MOST não gira sozinha (result vazio). Tenta
          // em pé; se não reconhecer nada, gira e tenta de novo. PDF não gira. So paga consulta
          // extra quando o documento veio vazio — documento bom lê na primeira.
          // No público cada rotação é uma consulta COBRADA e o teto do balde `ocr` é apertado:
          // paramos em [0, 90] (a tela orienta a fotografar na horizontal). Interno mantém as 4.
          //
          // ⚠️ FALHA DE LEITURA NÃO DERRUBA O ENVIO (Lucas, 02/08): se a MOST der erro, o
          // arquivo segue o fluxo com extração VAZIA — fica salvo, e os campos abrem para o
          // preenchimento manual. Antes, o erro descartava o arquivo e travava o cadastro.
          try {
            const rotacoes = ehPdf(file) ? [0] : modoPublico ? [0, 90] : [0, 90, 270, 180];
            for (const tentativa of rotacoes) {
              const paraLeitura = await arquivoParaLeitura(file, tentativa);
              ext = await api.ocr<Extraction>({
                action: "extract",
                fileBase64: paraLeitura.fileBase64,
                fileName: paraLeitura.fileName,
              });
              // Reconheceu = extraiu ao menos um campo. Não dá pra usar documentType: result vazio
              // volta como "desconhecido" (truthy), o que faria parar sem girar.
              if (ext.fields.length > 0) {
                graus = tentativa;
                break;
              }
            }
          } catch (erroLeitura) {
            ext = EXTRACAO_VAZIA;
            falhaDeLeitura = true;
            // 429 (teto de leituras) e 401 (sessão expirada) NÃO são "leitura falhou": mascarar
            // fazia o corretor digitar tudo na mão sem saber que era bloqueio — e no 401 o
            // Enviar ia morrer no fim de qualquer jeito. A mensagem da rota é acionável.
            const msg = erroLeitura instanceof Error ? erroLeitura.message : "";
            if (/sess[aã]o/i.test(msg)) {
              // "CPF de corretor" só vale no CAD do cliente. No auto-cadastro da imobiliária quem
              // abriu a sessão é a própria empresa, e mandá-la informar "CPF de corretor" confunde.
              avisoDeLeitura =
                "Sua sessão expirou. Você ainda consegue preencher os campos na mão, mas o envio " +
                "vai pedir os seus dados de novo. Reabra o link para continuar.";
            } else if (/limite|429|aguarde/i.test(msg)) {
              avisoDeLeitura = msg;
            }
          }
        }
        // Pro DRIVE: o recorte tratado da MOST (ja pequeno) se veio; senao, versao comprimida na
        // MESMA rotação que a leitura reconheceu (pro arquivo guardado ficar em pé).
        const arquivo: ArquivoAnexado = ext.crop
          ? {
              fileBase64: ext.crop,
              fileName: trocarExtensaoParaJpg(file.name),
              mimeType: "image/jpeg",
            }
          : await arquivoParaDrive(file, graus);
        novos.push({ arquivo, ext, nome: file.name });
      }

      const todos = [...lidos, ...novos];
      // O ARQUIVO É RETIDO ANTES de qualquer validação (Lucas, 02/08): aconteça o que acontecer
      // com a leitura, o documento enviado fica salvo. A única exceção continua sendo regra de
      // NEGÓCIO no onExtracted (ex.: documento do titular no lugar do cônjuge), que lança — e
      // mesmo aí o arquivo já foi anexado; a tela avisa para o operador trocar.
      for (const novo of novos) onFile?.(novo.arquivo);
      setLidos(todos);

      // Alimenta a ficha com TUDO que foi lido (frente + verso). Leitura falha/vazia passa por
      // aqui do mesmo jeito: os campos do formulário abrem em branco para o preenchimento manual.
      const merged = mesclarExtracoes(todos.map((item) => item.ext));
      await onExtracted(merged);
      // Avisos de conferência (tipo trocado, baixa confiança): mostram, não travam.
      if (merged.avisoQualidade) setAviso(merged.avisoQualidade);
      if (falhaDeLeitura) {
        setAviso(
          avisoDeLeitura ??
            "Não conseguimos ler este documento. O arquivo foi salvo mesmo assim: " +
              "siga e preencha os campos na mão.",
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={working}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong bg-subtle px-4 py-7 text-center transition-colors hover:border-line-strong/40 hover:bg-subtle disabled:cursor-wait"
      >
        {working ? (
          <>
            <Loader2 className="size-6 animate-spin text-ink" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">
              {loading ? "Lendo documento…" : "Consultando dados pelo CPF…"}
            </span>
            <span className="text-xs text-ink-muted">Aguarde um instante</span>
          </>
        ) : done ? (
          <>
            <CheckCircle2 className="size-6 text-emerald-500" aria-hidden="true" />
            <span className="text-sm font-medium text-ink">
              {lidos.length === 1 ? "1 arquivo anexado" : `${lidos.length} arquivos anexados`}
            </span>
            <span className="text-xs text-ink-muted">
              Toque aqui para anexar mais arquivos
            </span>
          </>
        ) : (
          <>
            <UploadCloud className="size-6 text-ink-muted" aria-hidden="true" />
            <span className="text-sm font-medium text-ink-soft">{label}</span>
            <span className="text-xs text-ink-muted">{hint}</span>
          </>
        )}
      </button>

      {/* Cada arquivo lido do documento (frente, verso, páginas do contrato). */}
      {lidos.length ? (
        <ul className="mt-2 grid gap-1">
          {lidos.map((item, index) => (
            <li
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-ink-soft"
              key={`${item.nome}-${index}`}
            >
              <FileText className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.nome}</span>
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
            </li>
          ))}
        </ul>
      ) : null}

      {/* No PC o seletor aceita varios de uma vez (e clicar de novo acumula); no celular a
          camera tira uma foto por vez e cada foto se soma as anteriores. */}
      <button
        type="button"
        onClick={() => cameraRef.current?.click()}
        disabled={working}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
      >
        <Camera className="size-3.5" aria-hidden="true" />
        Tirar foto agora com a câmera
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void processFiles(files);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void processFiles(files);
          event.target.value = "";
        }}
      />
      {working ? (
        <ReadingBar text={loading ? "Lendo documento…" : "Consultando dados pelo CPF…"} />
      ) : null}
      {error ? (
        <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{error}</p>
      ) : null}
      {aviso && !error ? (
        <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-300">{aviso}</p>
      ) : null}
    </div>
  );
}

// Barra de leitura (indeterminada) durante a validação do documento/consulta.
function ReadingBar({ text }: { text: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-ink-muted">
        <ShieldCheck className="size-3 text-emerald-500" aria-hidden="true" />
        {text}
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <div className="reading-bar h-full w-1/3 rounded-full bg-inverse" />
      </div>
      <style>{`
        @keyframes readingSlide { 0%{transform:translateX(-120%)} 100%{transform:translateX(320%)} }
        .reading-bar { animation: readingSlide 1.1s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// ---------- etapas ----------

function StepCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <div className="mt-4 grid gap-5">{children}</div>
    </div>
  );
}

function Secao({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
        {title}
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </div>
  );
}

function NavButtons({
  canNext,
  nextLabel = "Confirmar e avançar",
  onBack,
  onNext,
}: {
  canNext: boolean;
  nextLabel?: string;
  onBack?: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 print:hidden">
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft hover:bg-subtle"
        >
          Voltar
        </button>
      ) : (
        <span />
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={!canNext}
        className="inline-flex h-9 items-center rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {nextLabel}
      </button>
    </div>
  );
}

function StepIdentificacao({
  conjuge,
  corretorImobLista,
  corretorImobSel,
  empImobLista,
  empImobSel,
  empreendimentos,
  empreendimentosHerdados,
  empreendimentosSel,
  empresa,
  enrich,
  identidade,
  imobiliarias,
  isImobiliaria,
  onConjugeChange,
  onCorretorImobChange,
  onDocumento,
  onDocumentoConjuge,
  onEmpImobChange,
  onEmpreendimentosChange,
  onEmpresaChange,
  onEmpresaExtract,
  onExtract,
  onIdentidadeChange,
  onNext,
  onPerfilChange,
  onPersona,
  perfil,
  persona,
}: {
  conjuge: Conjuge;
  corretorImobLista: Array<{ entityId: string; nome: string; email: string | null }>;
  corretorImobSel: string;
  empImobLista: Array<{ enterpriseId: string; nome: string }>;
  empImobSel: string;
  empreendimentos: SelectOption[];
  empreendimentosHerdados: boolean;
  empreendimentosSel: string[];
  empresa: Empresa;
  enrich: Enrichment | null;
  identidade: Identidade | null;
  imobiliarias: SelectOption[];
  isImobiliaria: boolean;
  onConjugeChange: (patch: Partial<Conjuge>) => void;
  onCorretorImobChange: (id: string) => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onDocumentoConjuge: (arquivo: ArquivoAnexado) => void;
  onEmpImobChange: (id: string) => void;
  onEmpreendimentosChange: (ids: string[]) => void;
  onEmpresaChange: (patch: Partial<Empresa>) => void;
  onEmpresaExtract: (ext: Extraction, emp: Partial<Empresa>) => void;
  onExtract: (ext: Extraction, enr: Enrichment) => void;
  // Correção à mão do que a leitura não trouxe. Ver o comentário do bloco "Dados do documento".
  onIdentidadeChange: (patch: Partial<Identidade>) => void;
  onNext: () => void;
  onPerfilChange: (patch: Partial<Perfil>) => void;
  onPersona: (persona: Persona) => void;
  perfil: Perfil;
  persona: Persona;
  publico?: { corretorNome?: string; imobiliariaNome?: string } | null;
}) {
  // Adapter de leitura/enriquecimento + flag público (esconde o seletor de imobiliária e
  // dispensa `imobiliariaId`, que no público vem do token).
  const { api, modoPublico } = useCadastroCtx();
  const [enriching, setEnriching] = useState(false);
  const [enrichingConjuge, setEnrichingConjuge] = useState(false);
  const isPj = persona === "pj";

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValido = emailRegex.test(perfil.email);
  // Cônjuge presente: casado (2) ou união estável (6).
  const temConjuge = ["2", "6"].includes(perfil.estadoCivilId);
  const estadoCivilLabel =
    C2X_ESTADO_CIVIL.find((o) => o.id.toString() === perfil.estadoCivilId)?.label ?? "";
  const conjugeEmailOk =
    emailRegex.test(conjuge.email) &&
    conjuge.email.trim().toLowerCase() !== perfil.email.trim().toLowerCase();
  const conjugeOk =
    !temConjuge ||
    Boolean(
      conjuge.documentoLido &&
        conjuge.sexoId &&
        conjuge.rendaId &&
        conjuge.escolaridadeId &&
        temProfissao(conjuge.profissaoId, conjuge.profissaoOutro) &&
        conjugeEmailOk,
    );

  // Lê o documento do cônjuge e, em seguida, enriquece pelo CPF (sexo, telefone,
  // faixa de renda, patrimônio). Escolaridade e profissão continuam manuais.
  async function lerConjuge(ext: Extraction) {
    conferirDocumento(
      ext,
      ["identidade"],
      "o documento de identificação do cônjuge (RG, CNH ou passaporte)",
    );
    const c = ext.cadastro;
    // Barra o documento do PRÓPRIO titular subido no lugar do cônjuge: mesmo CPF (ou, sem
    // CPF legível, mesmo nome) = documento repetido, e a ficha do cônjuge nasceria do titular.
    const soDigitos = (valor: string) => valor.replace(/\D/g, "");
    const mesmoCpf =
      soDigitos(c.cpf ?? "") &&
      soDigitos(c.cpf ?? "") === soDigitos(identidade?.cpf ?? "");
    const mesmoNome =
      normalizeSearch(c.nome ?? "") &&
      normalizeSearch(c.nome ?? "") === normalizeSearch(identidade?.nome ?? "");
    if (mesmoCpf || mesmoNome) {
      throw new Error(
        "Este é o documento do titular. Envie o documento de identificação do cônjuge.",
      );
    }
    setEnrichingConjuge(true);
    let enr: Enrichment = ENRICH_VAZIO;
    try {
      enr = await api.ocr<Enrichment>({ action: "enrich", cpf: c.cpf ?? "" });
    } catch {
      // enriquecimento é best-effort; segue com o que o documento trouxe
    } finally {
      setEnrichingConjuge(false);
    }
    onConjugeChange({
      cpf: c.cpf ?? "",
      dataNascimento: c.dataNascimento ?? "",
      documentoLido: true,
      nacionalidade: c.nacionalidade ?? "",
      naturalidade: c.naturalidade ?? "",
      nome: c.nome ?? "",
      nomeMae: c.nomeMae || enr.nomeMae,
      patrimonio: conjuge.patrimonio || enr.patrimonio || perfil.patrimonio,
      rendaId: conjuge.rendaId || matchFaixaRendaId(enr.renda),
      sexoId:
        conjuge.sexoId ||
        matchSexoId(c.sexo ?? "")?.toString() ||
        matchSexoId(enr.sexo)?.toString() ||
        "",
      telefone: conjuge.telefone || enr.telefones[0] || "",
    });
  }

  // Lê o cartão CNPJ e enriquece por CNPJ (sócios, porte, CNAE, contato).
  async function lerEmpresa(ext: Extraction) {
    let emp: Partial<Empresa> = {};
    setEnriching(true);
    try {
      {
        // O cartão CNPJ dá o número; razão social, fantasia, abertura, situação e o QSA vêm do
        // enriquecimento por CNPJ (CARELI_PJ_01). Sem isto o fluxo PJ nascia todo vazio.
        const cnpj = ext.cadastro.cnpj ?? "";
        if (cnpj) {
          const dados = await api.ocr<CompanyEnrichment>({ action: "enrich-company", cnpj });
          emp = {
            dataAbertura: dados.dataAbertura,
            email: dados.emails[0] ?? "",
            nomeFantasia: dados.nomeFantasia,
            porte: dados.porte,
            razaoSocial: dados.razaoSocial,
            situacaoCadastral: dados.situacaoCadastral,
            socios: dados.socios,
            telefone: dados.telefones[0] ?? "",
          };
        }
      }
    } catch {
      // enriquecimento é best-effort: segue com o que o cartão CNPJ trouxe
    } finally {
      setEnriching(false);
    }
    onEmpresaExtract(ext, emp);
  }

  // Prospect INTERNO: escolhida a imobiliária, exige o EMPREENDIMENTO (senão a ficha nasceria sem
  // empreendimento — o bug das órfãs) e o CORRETOR quando a imobiliária tem corretores cadastrados.
  // No público a imobiliária/empreendimento vêm do token; na imobiliária este vínculo não existe.
  const vinculoProspectOk =
    isImobiliaria ||
    modoPublico ||
    (Boolean(empImobSel) && (corretorImobLista.length === 0 || Boolean(corretorImobSel)));

  // O que o documento NÃO entregou. Só nome e CPF impedem de seguir (é o que o servidor exige
  // em cadastro-persist); os outros entram na lista pra ficar claro o que vale preencher.
  const faltaNoDocumento = identidade
    ? [
        identidade.nome.trim() ? null : "nome",
        // "CPF válido", não "CPF preenchido": ver o comentário do campo, o contracheque devolve
        // texto solto nesse campo e um valor errado é pior que um vazio.
        cpfValido(identidade.cpf) ? null : "CPF",
        identidade.nomeMae.trim() ? null : "nome da mãe",
        identidade.naturalidade.trim() ? null : "naturalidade",
        identidade.nacionalidade.trim() ? null : "nacionalidade",
      ].filter((item): item is string => item !== null)
    : [];
  // CPF digitado errado nao pode passar: o cadastro inteiro pendura nele (dedupe, consulta de
  // credito, vinculo com o C2X). Validamos aqui pra falhar na hora, e nao no fim do wizard.
  const cpfDaIdentidadeOk = Boolean(identidade && cpfValido(identidade.cpf));

  // DUPLICIDADE CONFERIDA NA IDENTIFICAÇÃO (Lucas, 12/08: "prefiro na identificação do cpf, pode
  // ser via most ou digitação"). Este ponto serve aos dois: o MOST escreve em `identidade.cpf`
  // exatamente como a digitação, então basta observar o valor.
  //
  // A trava de verdade é a do servidor, no salvar. Esta existe para o corretor não montar a ficha
  // inteira e só descobrir no fim, que foi como o caso Alcimar e Sirlei chegou até o final.
  const cpfParaChecar = cpfDaIdentidadeOk ? soDigitos(identidade?.cpf ?? "") : "";
  const cpfConjugeParaChecar = temConjuge && cpfValido(conjuge.cpf) ? soDigitos(conjuge.cpf) : "";
  const [conflitoCpf, setConflitoCpf] = useState<null | { mensagem: string; tipo: string }>(null);

  useEffect(() => {
    // Sem CPF fechado não há o que perguntar. No modo interno, sem empreendimento também não:
    // a duplicidade é POR empreendimento, e no público ele vem do token.
    if (!cpfParaChecar || (!modoPublico && !empImobSel)) {
      setConflitoCpf(null);
      return;
    }
    // `vivo` evita que a resposta de um CPF antigo sobrescreva a de um CPF novo: o operador
    // corrige um dígito e a resposta lenta da consulta anterior chegaria depois, acusando
    // duplicidade de um número que nem está mais na tela.
    let vivo = true;
    void api
      .checarCpf({
        cpf: cpfParaChecar,
        cpfConjuge: cpfConjugeParaChecar,
        enterpriseId: empImobSel || null,
      })
      .then((resultado) => {
        if (vivo) setConflitoCpf(resultado.conflito);
      });
    return () => {
      vivo = false;
    };
  }, [api, cpfConjugeParaChecar, cpfParaChecar, empImobSel, modoPublico]);

  // O QUE FALTA PARA AVANÇAR, DITO NA TELA (pedido do Lucas, 05/08: "o botão não está habilitado,
  // seria ótimo colocar um aviso do que falta a ser preenchido"). Esta etapa exige ONZE coisas, e
  // antes o botão só ficava cinza: o operador não tinha como saber qual campo estava vazio, e
  // ficava caçando na tela com o cliente esperando.
  //
  // ⚠️ A MESMA lista habilita o botão E monta o aviso. Se fossem duas listas, um dia discordariam
  // e a tela diria "está tudo certo" com o botão travado, que é pior do que o silêncio de hoje.
  //
  // NATURALIDADE (incidente 05/08): 8 CADs voltaram recusadas pelo C2X por naturalidade e
  // nacionalidade em branco. Só a naturalidade é cobrada porque a nacionalidade é DERIVADA dela
  // (derivarNacionalidade, lib/apolo/cadastro-cascata.ts). NÃO é trava de OCR (v1.105.0): o campo
  // Naturalidade abre para digitação sempre que a leitura vem vazia.
  const faltamNaIdentidadePf: string[] = identidade
    ? [
        identidade.nome.trim() ? null : "nome",
        cpfDaIdentidadeOk ? null : "CPF válido",
        identidade.naturalidade.trim() ? null : "naturalidade (cidade de nascimento)",
        perfil.sexoId ? null : "sexo",
        perfil.estadoCivilId ? null : "estado civil",
        perfil.escolaridadeId ? null : "escolaridade",
        perfil.rendaId ? null : "faixa de renda",
        // Profissão DIGITADA também vale para avançar — é o ponto do pedido: o corretor não pode
        // mais travar por não achar a dele na lista. A padronização acontece depois, na validação.
        temProfissao(perfil.profissaoId, perfil.profissaoOutro) ? null : "profissão",
        modoPublico || perfil.imobiliariaId ? null : "imobiliária",
        vinculoProspectOk ? null : "empreendimento e corretor",
        emailValido ? null : "e-mail válido",
        conjugeOk ? null : "dados do cônjuge",
      ].filter((item): item is string => item !== null)
    : ["o documento de identificação"];

  const podeAvancarPf = faltamNaIdentidadePf.length === 0 && !conflitoCpf;
  // Imobiliária: não se vincula a outra imobiliária (a Seção "Vínculo" some); em troca, exige ao
  // menos um empreendimento (vínculo de trabalho). CRECI é opcional.
  // Mesma ideia do PF: uma lista só, que habilita o botão e explica o que falta.
  // No público a imobiliária vem do token (o servidor a força) e o browser não a preenche; sem
  // essa exceção, PJ pelo link público nunca habilitaria o avançar.
  const faltamNaIdentidadePj: string[] = isImobiliaria
    ? [
        empresa.documentoLido ? null : "o cartão CNPJ",
        emailRegex.test(empresa.email) ? null : "e-mail válido",
        empreendimentosSel.length > 0 ? null : "ao menos um empreendimento",
      ].filter((item): item is string => item !== null)
    : [
        empresa.documentoLido ? null : "o cartão CNPJ",
        modoPublico || perfil.imobiliariaId ? null : "imobiliária",
        vinculoProspectOk ? null : "empreendimento e corretor",
        emailRegex.test(empresa.email) ? null : "e-mail válido",
      ].filter((item): item is string => item !== null);

  const podeAvancarPj = faltamNaIdentidadePj.length === 0;
  const podeAvancar = isPj ? podeAvancarPj : podeAvancarPf;
  const faltamParaAvancar = isPj ? faltamNaIdentidadePj : faltamNaIdentidadePf;

  return (
    <StepCard title="1. Identificação">
      {isImobiliaria || modoPublico ? null : (
        <Secao title="Vínculo">
          <SearchableSelect
            label="Imobiliária / corretor"
            value={perfil.imobiliariaId}
            options={imobiliarias}
            placeholder="Buscar imobiliária ou corretor…"
            onChange={(v) => onPerfilChange({ imobiliariaId: v })}
          />
          {/* Escolhida a imobiliária, vincula-se o empreendimento (que ela trabalha) e o corretor
              dela. 0 empreendimentos = aviso; 1 = já resolvido (read-only); vários = seletor. */}
          {perfil.imobiliariaId ? (
            <>
              {empImobLista.length === 0 ? (
                <p className="m-0 rounded-lg border border-line bg-subtle px-3 py-2 text-xs text-ink-muted sm:col-span-2 lg:col-span-1">
                  Esta imobiliária não tem empreendimento habilitado.
                </p>
              ) : empImobLista.length === 1 ? (
                <ReadField
                  label="Empreendimento"
                  value={empImobLista[0] ? empImobLista[0].nome : ""}
                />
              ) : (
                <SearchableSelect
                  label="Empreendimento"
                  value={empImobSel}
                  options={empImobLista.map((e) => ({ id: e.enterpriseId, label: e.nome }))}
                  placeholder="Buscar empreendimento…"
                  onChange={onEmpImobChange}
                />
              )}
              <SearchableSelect
                label="Corretor"
                value={corretorImobSel}
                options={corretorImobLista.map((c) => ({ id: c.entityId, label: c.nome }))}
                placeholder="Buscar corretor…"
                onChange={onCorretorImobChange}
              />
            </>
          ) : null}
        </Secao>
      )}

      <p className="m-0 mb-3 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        {isImobiliaria ? (
          <>
            Anexe o <span className="font-semibold">cartão CNPJ</span> da imobiliária. Os dados são
            lidos do próprio documento.
          </>
        ) : (
          <>
            Agora anexe o documento de identificação do cliente:{" "}
            <span className="font-semibold">RG, CNH ou passaporte</span>. Se o cliente for empresa,
            anexe o <span className="font-semibold">cartão CNPJ</span>. Nós identificamos o tipo
            pelo próprio documento, você não precisa escolher nada.
          </>
        )}
      </p>
      <div className="print:hidden">
        <DocUploader
          busy={enriching}
          label={isImobiliaria ? "Adicionar cartão CNPJ da imobiliária" : "Adicionar documento do cliente"}
          hint={
            isImobiliaria
              ? "Cartão CNPJ · foto ou PDF"
              : "Foto ou PDF. Se o documento tiver frente e verso, anexe os dois."
          }
          onFile={onDocumento}
          onExtracted={async (ext) => {
            // No prospect entra identidade (PF) ou cartão CNPJ (PJ); na imobiliária, só o cartão.
            conferirDocumento(
              ext,
              isImobiliaria ? ["cnpj"] : ["identidade", "cnpj"],
              isImobiliaria
                ? "o cartão CNPJ da imobiliária"
                : "o documento de identificação (RG, CNH ou passaporte) ou o cartão CNPJ",
            );
            if (isCnpjDoc(ext.documentType)) {
              onPersona("pj");
              await lerEmpresa(ext);
              return;
            }
            onPersona("pf");
            setEnriching(true);
            let enr: Enrichment = ENRICH_VAZIO;
            try {
              enr = await api.ocr<Enrichment>({
                action: "enrich",
                cpf: ext.cadastro.cpf ?? "",
              });
            } catch (err) {
              enr.warnings = [`Enriquecimento falhou: ${(err as Error).message}`];
            } finally {
              setEnriching(false);
            }
            onExtract(ext, enr);
          }}
        />
      </div>

      {isPj ? (
        empresa.documentoLido ? (
          <>
            <Secao title="Dados da empresa">
              <ReadField label="Tipo" value="Cartão CNPJ" />
              <ReadField label="Razão social" value={titleCase(empresa.razaoSocial)} span2 />
              <ReadField label="Nome fantasia" value={titleCase(empresa.nomeFantasia)} />
              <ReadField label="CNPJ" value={empresa.cnpj} />
              <ReadField label="Abertura" value={formatDateBR(empresa.dataAbertura)} />
              <ReadField label="Situação cadastral" value={empresa.situacaoCadastral} />
              <ReadField label="Natureza jurídica" value={empresa.naturezaJuridica} span2 />
              <ReadField label="Porte" value={empresa.porte} />
              <ReadField label="CNAE" value={empresa.cnae} span2 />
              <ReadField label="Atividade principal" value={empresa.atividade} span2 />
            </Secao>

            {empresa.socios.length ? (
              <Secao title="Sócios registrados no CNPJ">
                {empresa.socios.map((socio, index) => (
                  <ReadField
                    key={`${socio.nome}-${index}`}
                    label={socio.qualificacao || "Sócio"}
                    value={titleCase(socio.nome)}
                    span2
                  />
                ))}
              </Secao>
            ) : null}

            <Secao title="Contato">
              <PhoneField
                value={empresa.telefone}
                sugestoes={[]}
                onChange={(v) => onEmpresaChange({ telefone: v })}
              />
              <div className="sm:col-span-2">
                <EmailField
                  value={empresa.email}
                  onChange={(v) => onEmpresaChange({ email: v })}
                />
              </div>
            </Secao>

            {isImobiliaria ? (
              <>
                <Secao title="CRECI">
                  <TextField
                    editavel
                    label="CRECI Jurídico"
                    value={empresa.creci}
                    onChange={(v) => onEmpresaChange({ creci: v })}
                  />
                </Secao>

                {/* Vindo do portal, a imobiliária já escolheu no passo 1 — não repete aqui. */}
                {empreendimentosHerdados ? null : (
                  <MultiSelectField
                    title="Empreendimentos"
                    hint="Vínculo de trabalho — selecione um ou mais"
                    options={empreendimentos}
                    selected={empreendimentosSel}
                    emptyLabel="Nenhum empreendimento com credenciamento aberto."
                    onChange={onEmpreendimentosChange}
                  />
                )}
              </>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-ink-muted">
            Envie o cartão CNPJ para ler os dados da empresa.
          </p>
        )
      ) : identidade ? (
        <>
          <Secao title="Dados do documento">
            <ReadField label="Tipo" value={mapDocType(identidade.tipoDocumento, "")} />
            {/* CAMPO VAZIO VIRA CAMPO DIGITÁVEL (pedido do Lucas 27/07). O que a leitura trouxe
                continua como texto fixo, pra ninguém sobrescrever dado bom sem querer; o que ela
                NÃO trouxe abre pro operador preencher, em vez de travar o cadastro.
                Caso real que motivou: a Katia Duarte subiu contracheque, conta de luz e carteira
                do CRC. A MOST leu tudo com 95% a 99% e acertou o nome — mas nenhum desses
                documentos TEM CPF, então não havia o que extrair e o cadastro parava ali. */}
            {identidade.nome ? (
              <ReadField label="Nome" value={titleCase(identidade.nome)} span2 />
            ) : (
              <TextField
                editavel
                label="Nome"
                placeholder="Nome completo, como está no documento"
                value={identidade.nome}
                onChange={(v) => onIdentidadeChange({ nome: v })}
              />
            )}
            {/* CPF abre pra edição quando está vazio OU quando não é um CPF de verdade. O
                "ou" não é preciosismo: o contracheque da Katia devolveu `cpf: "Férias Vencidas"`
                e `cpf: "Férias de 04/05/2026 até 02/"`. Se o critério fosse só "vazio", o campo
                apareceria travado com esse lixo e o operador não teria como consertar. */}
            {cpfDaIdentidadeOk ? (
              <ReadField label="CPF" value={identidade.cpf} />
            ) : (
              <TextField
                editavel
                label="CPF"
                placeholder="000.000.000-00"
                value={identidade.cpf}
                onChange={(v) => onIdentidadeChange({ cpf: v })}
              />
            )}
            <ReadField label="Nascimento" value={formatDateBR(identidade.dataNascimento)} />
            <ReadField label="Idade" value={calcIdade(identidade.dataNascimento)} />
            {identidade.nomeMae ? (
              <ReadField label="Nome da mãe" value={titleCase(identidade.nomeMae)} span2 />
            ) : (
              <TextField
                editavel
                label="Nome da mãe"
                placeholder="Nome completo da mãe"
                value={identidade.nomeMae}
                onChange={(v) => onIdentidadeChange({ nomeMae: v })}
              />
            )}
            <CampoDoDocumento
              cidade
              label="Naturalidade (obrigatória)"
              placeholder="Cidade de nascimento, ex.: Goiânia"
              value={identidade.naturalidade}
              onChange={(v) => onIdentidadeChange({ naturalidade: v })}
            />
            <CampoDoDocumento
              label="Nacionalidade"
              placeholder="Brasileira"
              value={identidade.nacionalidade}
              onChange={(v) => onIdentidadeChange({ nacionalidade: v })}
            />
          </Secao>

          {/* O QUE FALTA, DITO NA CARA. Antes o operador seguia com os campos vazios e só
              descobria o problema quando o servidor recusava, lá no fim do cadastro. */}
          {faltaNoDocumento.length > 0 ? (
            <p className="mb-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              A leitura do documento não trouxe: {faltaNoDocumento.join(", ")}. Preencha à mão
              nos campos acima, ou envie um RG, CNH ou passaporte.
            </p>
          ) : null}

          {/* A naturalidade não é "só mais um campo que faltou ler": ela BARRA o avanço, senão o
              C2X recusa a CAD lá na frente ("Naturalidade não pode ficar em branco" — 8 casos em
              produção). A nacionalidade sai dela sozinha, por isso não é cobrada aqui. */}
          {identidade.naturalidade.trim() ? null : (
            <p className="mb-3 rounded-lg border border-rose-300/60 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              Informe a naturalidade (a cidade de nascimento do cliente) para continuar. Sem ela o
              cadastro é recusado depois e volta para refazer.
            </p>
          )}

          <Secao title="Perfil">
            <SelectField
              label="Sexo"
              value={perfil.sexoId}
              options={C2X_SEXO}
              onChange={(v) => onPerfilChange({ sexoId: v })}
            />
            <SelectField
              label="Estado civil"
              value={perfil.estadoCivilId}
              options={C2X_ESTADO_CIVIL}
              onChange={(v) => onPerfilChange({ estadoCivilId: v })}
            />
            <SelectField
              label="Escolaridade"
              value={perfil.escolaridadeId}
              options={C2X_ESCOLARIDADE}
              onChange={(v) => onPerfilChange({ escolaridadeId: v })}
            />
            <SelectField
              label="Faixa de renda"
              value={perfil.rendaId}
              options={C2X_FAIXA_RENDA}
              onChange={(v) => onPerfilChange({ rendaId: v })}
            />
            <TextField
              label="Patrimônio"
              value={perfil.patrimonio}
              placeholder="—"
              onChange={(v) => onPerfilChange({ patrimonio: v })}
            />
            {/* ÚNICO seletor com saída de texto livre (`aoDigitarOutro`). Quem não acha a
                profissão entre as 234 do C2X digita a dele; o backoffice padroniza na validação.
                O texto vai para `profissaoOutro`, NUNCA para `profissaoId` (FK do C2X). */}
            <SearchableSelect
              aoDigitarOutro={(v) => onPerfilChange({ profissaoOutro: v })}
              label="Profissão"
              value={perfil.profissaoId}
              valorOutro={perfil.profissaoOutro}
              options={C2X_PROFISSOES}
              placeholder="Buscar profissão…"
              onChange={(v) => onPerfilChange({ profissaoId: v })}
            />
          </Secao>

          <Secao title="Contato">
            <PhoneField
              value={perfil.telefone}
              sugestoes={enrich?.telefones ?? []}
              onChange={(v) => onPerfilChange({ telefone: v })}
            />
            <div className="sm:col-span-2">
              <EmailField
                value={perfil.email}
                onChange={(v) => onPerfilChange({ email: v })}
              />
            </div>
          </Secao>

          {temConjuge ? (
            <div className="rounded-xl border border-line bg-subtle p-4">
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
                <UserRound className="size-3.5" aria-hidden="true" />
                Cônjuge
              </p>
              <p className="mb-3 text-xs text-ink-muted">
                O cliente é casado ou tem união estável, então precisamos também do cônjuge. Anexe o
                documento de identificação dele: RG, CNH ou passaporte. Os dados são preenchidos
                pela leitura do documento; confira e complete o que faltar.
              </p>
              <div className="print:hidden">
                <DocUploader
                  busy={enrichingConjuge}
                  label="Adicionar documento do cônjuge"
                  hint="RG, CNH ou passaporte · foto ou PDF"
                  onFile={onDocumentoConjuge}
                  onExtracted={lerConjuge}
                />
              </div>

              {conjuge.documentoLido ? (
                <div className="mt-4 grid gap-5">
                  <Secao title="Dados do documento">
                    <ReadField label="Nome" value={titleCase(conjuge.nome)} span2 />
                    <ReadField label="CPF" value={conjuge.cpf} />
                    <ReadField label="Nascimento" value={formatDateBR(conjuge.dataNascimento)} />
                    <ReadField label="Idade" value={calcIdade(conjuge.dataNascimento)} />
                    <ReadField label="Nome da mãe" value={titleCase(conjuge.nomeMae)} span2 />
                    {/* Mesmo tratamento do titular e do sócio: o que a leitura do documento NÃO
                        entregou abre para digitar. A CNH não traz naturalidade impressa, e o RG
                        mal fotografado também falha; travado, o campo ficava "—" para sempre. */}
                    <CampoDoDocumento
                      cidade
                      label="Naturalidade"
                      placeholder="Cidade de nascimento, ex.: Goiânia"
                      value={conjuge.naturalidade}
                      onChange={(v) => onConjugeChange({ naturalidade: v })}
                    />
                    <CampoDoDocumento
                      label="Nacionalidade"
                      placeholder="Brasileira"
                      value={conjuge.nacionalidade}
                      onChange={(v) => onConjugeChange({ nacionalidade: v })}
                    />
                  </Secao>

                  <Secao title="Perfil do cônjuge">
                    <SelectField
                      label="Sexo"
                      value={conjuge.sexoId}
                      options={C2X_SEXO}
                      onChange={(v) => onConjugeChange({ sexoId: v })}
                    />
                    <ReadField label="Estado civil" value={estadoCivilLabel} />
                    <SelectField
                      label="Escolaridade"
                      value={conjuge.escolaridadeId}
                      options={C2X_ESCOLARIDADE}
                      onChange={(v) => onConjugeChange({ escolaridadeId: v })}
                    />
                    <SelectField
                      label="Faixa de renda"
                      value={conjuge.rendaId}
                      options={C2X_FAIXA_RENDA}
                      onChange={(v) => onConjugeChange({ rendaId: v })}
                    />
                    <TextField
                      label="Patrimônio"
                      value={conjuge.patrimonio}
                      placeholder="—"
                      onChange={(v) => onConjugeChange({ patrimonio: v })}
                    />
                    <SearchableSelect
                      aoDigitarOutro={(v) => onConjugeChange({ profissaoOutro: v })}
                      label="Profissão"
                      value={conjuge.profissaoId}
                      valorOutro={conjuge.profissaoOutro}
                      options={C2X_PROFISSOES}
                      placeholder="Buscar profissão…"
                      onChange={(v) => onConjugeChange({ profissaoId: v })}
                    />
                  </Secao>

                  <Secao title="Contato do cônjuge">
                    <PhoneField
                      value={conjuge.telefone}
                      sugestoes={[]}
                      onChange={(v) => onConjugeChange({ telefone: v })}
                    />
                    <div className="sm:col-span-2">
                      <EmailField
                        value={conjuge.email}
                        bloquear={perfil.email}
                        bloqueioMsg="O e-mail do cônjuge não pode ser igual ao do titular."
                        onChange={(v) => onConjugeChange({ email: v })}
                      />
                    </div>
                  </Secao>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {enrich && enrich.source !== "mostqi" ? <EnrichWarn enrich={enrich} /> : null}

      {/* DUPLICIDADE, DITA NA HORA EM QUE O CPF FICA CONHECIDO. Vem antes do aviso de campos
          faltando porque não adianta terminar de preencher: esta CAD não vai poder ser aberta.
          Vermelho, e não âmbar, porque não é "falta algo", é "não vai dar". */}
      {conflitoCpf ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <strong>{conflitoCpf.mensagem}</strong> Fale com a central.
        </p>
      ) : null}

      {/* O QUE FALTA, DITO NA CARA. Sem isto o botão só fica cinza e o operador procura o campo
          vazio na tela inteira, com o cliente esperando. A lista vem da MESMA fonte que habilita
          o botão, então nunca diz "falta X" com o avançar já liberado, nem o contrário. */}
      {podeAvancar || (conflitoCpf && !faltamParaAvancar.length) ? null : (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          Para avançar, ainda falta preencher: <strong>{juntarPtBr(faltamParaAvancar)}</strong>.
        </p>
      )}

      {/* O botão diz o que vem DEPOIS: quem está com o cliente na frente precisa saber se ainda
          falta documento antes de avançar. */}
      <NavButtons
        canNext={podeAvancar}
        nextLabel={
          isPj ? "Avançar para o contrato social" : "Avançar para o comprovante de endereço"
        }
        onNext={onNext}
      />
    </StepCard>
  );
}

// Selo de comprovante atual (últimos 3 meses) ou desatualizado.
function ComprovanteRecencia({ data }: { data: string }) {
  const meses = mesesDesde(data);
  if (meses === null) {
    return null;
  }
  const atual = meses <= 3;
  const quando = meses <= 0 ? "recente" : `há ${meses} ${meses === 1 ? "mês" : "meses"}`;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
        atual
          ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
          : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
      }`}
    >
      {atual ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : (
        <AlertTriangle className="size-4" aria-hidden="true" />
      )}
      Comprovante {atual ? "atual" : "desatualizado"} · emitido em {formatDateBR(data)} ({quando}).
    </div>
  );
}

// Contrato social: documento livre (não é formulário padronizado como o cartão CNPJ), então
// aqui ele é ANEXO — não tentamos ler campo dele. É de onde saem os sócios, que o operador
// cadastra na etapa seguinte.
function StepContratoSocial({
  anexado,
  onBack,
  onDocumento,
  onNext,
}: {
  anexado: boolean;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onNext: () => void;
}) {
  return (
    <StepCard title="2. Contrato social">
      <p className="m-0 mb-3 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] dark:text-[#d9b877]">
        Agora anexe o <span className="font-semibold">contrato social</span> da empresa, ou a última
        alteração consolidada. Anexe todas as páginas: dá para mandar várias de uma vez.
      </p>
      <div className="print:hidden">
        <DocUploader
          label="Adicionar contrato social"
          hint="Todas as páginas · foto ou PDF"
          onFile={onDocumento}
          // Anexo puro: documento livre (nao e formulario padronizado), nao ha campo a ler --
          // e cada arquivo lido seria uma consulta cobrada a toa.
          semLeitura
          onExtracted={() => {}}
        />
      </div>
      <NavButtons
        canNext={anexado}
        nextLabel="Avançar para os sócios"
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

// Um bloco por sócio: identificação + ficha + comprovante DELE, tudo junto. Em etapas separadas
// não dá pra saber qual comprovante é de qual sócio.
function BlocoSocio({
  aoAnexar,
  aoMudar,
  aoRemover,
  indice,
  podeRemover,
  socio,
}: {
  // Anexa via função updater (não pelo closure): subir frente+verso de uma vez chamava onFile
  // 2x no mesmo render e o segundo sobrescrevia o primeiro — salvava só 1 dos 2 documentos.
  aoAnexar: (campo: "arquivosComprovante" | "arquivosIdentificacao", arquivo: ArquivoAnexado) => void;
  aoMudar: (patch: Partial<SocioCadastro>) => void;
  aoRemover: () => void;
  indice: number;
  podeRemover: boolean;
  socio: SocioCadastro;
}) {
  // Enriquecimento do sócio pelo CPF (interno: /api/apolo/mostqi; público: /api/publico/cad/ocr).
  const { api } = useCadastroCtx();
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-ink">
          Sócio {indice + 1}
          {socio.nome ? <span className="text-ink-muted"> · {titleCase(socio.nome)}</span> : null}
        </h3>
        {podeRemover ? (
          <button
            type="button"
            onClick={aoRemover}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Remover
          </button>
        ) : null}
      </div>

      <DocUploader
        label="Adicionar documento de identificação"
        hint="RG, CNH ou passaporte · foto ou PDF"
        onFile={(arquivo) =>
          aoAnexar("arquivosIdentificacao", arquivo)
        }
        onExtracted={async (ext) => {
          conferirDocumento(
            ext,
            ["identidade"],
            "o documento de identificação do sócio (RG, CNH ou passaporte)",
          );
          const c = ext.cadastro;
          // Enriquece o sócio por CPF, igual titular e cônjuge: sexo, telefone e nome da mãe.
          // O await mantém o uploader em "consultando" até terminar.
          let enr: Enrichment = ENRICH_VAZIO;
          try {
            enr = await api.ocr<Enrichment>({ action: "enrich", cpf: c.cpf ?? "" });
          } catch {
            // enriquecimento é best-effort: sem ele, os campos ficam manuais.
          }
          aoMudar({
            cpf: c.cpf ?? "",
            dataNascimento: c.dataNascimento ?? "",
            documentoLido: true,
            nacionalidade: c.nacionalidade ?? "",
            naturalidade: c.naturalidade ?? "",
            nome: c.nome ?? "",
            nomeMae: c.nomeMae || enr.nomeMae || "",
            // Documento manda; enriquecimento é a rede.
            sexoId:
              matchSexoId(c.sexo ?? "")?.toString() ||
              matchSexoId(enr.sexo)?.toString() ||
              socio.sexoId,
            telefone: enr.telefones[0] ?? socio.telefone,
          });
        }}
      />

      {socio.documentoLido ? (
        <>
          <Secao title="Dados do sócio">
            <ReadField label="Nome" value={titleCase(socio.nome)} span2 />
            <ReadField label="CPF" value={socio.cpf} />
            <ReadField label="Nascimento" value={formatDateBR(socio.dataNascimento)} />
            <ReadField label="Nome da mãe" value={titleCase(socio.nomeMae)} span2 />
            {/* Naturalidade/nacionalidade do sócio eram ReadField puro: quando a leitura não
                entregava (CNH não traz naturalidade impressa, e foto ruim de RG também falha), o
                campo ficava "—" e NÃO havia como preencher. Mesmo tratamento do titular. */}
            <CampoDoDocumento
              cidade
              label="Naturalidade"
              placeholder="Cidade de nascimento, ex.: Goiânia"
              value={socio.naturalidade}
              onChange={(v) => aoMudar({ naturalidade: v })}
            />
            <CampoDoDocumento
              label="Nacionalidade"
              placeholder="Brasileira"
              value={socio.nacionalidade}
              onChange={(v) => aoMudar({ nacionalidade: v })}
            />
          </Secao>

          <Secao title="Perfil do sócio">
            <SelectField
              label="Sexo"
              value={socio.sexoId}
              options={C2X_SEXO}
              onChange={(v) => aoMudar({ sexoId: v })}
            />
            {/* Estado civil é manual e NÃO puxa cônjuge: no PJ o cônjuge não interessa ao
                negócio, só a informação (decisão do Lucas 17/jul). */}
            <SelectField
              label="Estado civil"
              value={socio.estadoCivilId}
              options={C2X_ESTADO_CIVIL}
              onChange={(v) => aoMudar({ estadoCivilId: v })}
            />
          </Secao>

          <Secao title="Contato do sócio">
            <PhoneField
              label="Telefone"
              sugestoes={[]}
              value={socio.telefone}
              onChange={(v) => aoMudar({ telefone: v })}
            />
            <EmailField value={socio.email} onChange={(v) => aoMudar({ email: v })} />
          </Secao>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
            <input
              type="checkbox"
              checked={socio.representanteLegal}
              onChange={(e) => aoMudar({ representanteLegal: e.target.checked })}
              className="mt-0.5 size-4 accent-[#A07C3B]"
            />
            <span className="text-xs text-ink-soft">
              <span className="font-semibold text-ink">Representante legal</span> — assina pela
              empresa (conforme o contrato social).
            </span>
          </label>

          <div className="mt-4">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Comprovante de endereço do sócio
            </span>
            <DocUploader
              label="Adicionar comprovante de endereço"
              hint="Conta de luz, água, telefone · foto ou PDF"
              onFile={(arquivo) =>
                aoAnexar("arquivosComprovante", arquivo)
              }
              onExtracted={(ext) => {
                conferirDocumento(
                  ext,
                  ["comprovante"],
                  "um comprovante de endereço (conta de luz, água ou telefone)",
                );
                // Mesma regra do comprovante do titular: vencido ou ilegível AVISA e segue —
                // nunca trava (Lucas, 22/08). A pendência sai na ficha.
                const emissao = acharDataComprovante(ext.fields);
                const meses = emissao ? mesesDesde(emissao) : null;
                if (meses !== null && meses > 3) {
                  ext.avisoQualidade = [
                    ext.avisoQualidade,
                    `Comprovante emitido há ${meses} meses (${formatDateBR(emissao)}); o ideal ` +
                      "são até 3 meses. A CAD segue com essa pendência anotada na ficha.",
                  ]
                    .filter(Boolean)
                    .join(" ");
                }
                const c = ext.cadastro;
                aoMudar({
                  endereco: {
                    bairro: c.bairro ?? "",
                    cep: c.cep ?? "",
                    cidade: c.cidade ?? "",
                    complemento: "",
                    dataDocumento: emissao ?? "",
                    logradouro: c.logradouro ?? "",
                    numero: c.numero ?? "",
                    tipoDocumento: ext.documentType,
                    uf: c.uf ?? "",
                  },
                });
              }}
            />
            {/* Aviso quando a MOST não leu o comprovante (foto ruim/girada): o documento já ficou
                salvo, e o operador reenvia ou preenche pelo CEP. */}
            {socio.arquivosComprovante.length > 0 &&
            !socio.endereco.logradouro &&
            !socio.endereco.cidade ? (
              <p className="m-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
                Não conseguimos ler o endereço no comprovante. O documento foi salvo: fotografe a
                conta inteira, sem cortar as bordas, e anexe de novo, ou preencha pelo CEP abaixo.
              </p>
            ) : null}

            {/* CEP-first: digitou o CEP, o endereço vem sozinho. Aparece após anexar o
                comprovante (preenchido pela leitura quando a MOST lê). */}
            {socio.arquivosComprovante.length > 0 ? (
              <EnderecoEditavel
                endereco={socio.endereco}
                onChange={(patch) => aoMudar({ endereco: { ...socio.endereco, ...patch } })}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function StepSocios({
  onAdicionar,
  onAnexar,
  onBack,
  onMudar,
  onNext,
  onRemover,
  socios,
}: {
  onAdicionar: () => void;
  onAnexar: (
    id: string,
    campo: "arquivosComprovante" | "arquivosIdentificacao",
    arquivo: ArquivoAnexado,
  ) => void;
  onBack: () => void;
  onMudar: (id: string, patch: Partial<SocioCadastro>) => void;
  onNext: () => void;
  onRemover: (id: string) => void;
  socios: SocioCadastro[];
}) {
  // Cada sócio precisa de documento lido, estado civil, sexo, e-mail e comprovante; e alguém tem
  // que assinar pela empresa, senão a CAD não habilita contrato. O e-mail é obrigatório em todo
  // formulário (é a futura credencial de acesso ao Panteon) e não pode repetir.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const completos = socios.every(
    (socio) =>
      socio.documentoLido &&
      socio.sexoId &&
      socio.estadoCivilId &&
      emailRegex.test(socio.email) &&
      socio.arquivosComprovante.length > 0 &&
      socio.endereco.logradouro.trim() &&
      socio.endereco.cidade.trim(),
  );
  const emails = socios.map((s) => s.email.trim().toLowerCase()).filter(Boolean);
  const emailDuplicado = emails.length !== new Set(emails).size;
  const temRepresentante = socios.some((socio) => socio.representanteLegal);

  return (
    <StepCard title="3. Sócios">
      <p className="m-0 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        Cadastre cada sócio da empresa. De cada um precisamos do documento de identificação (RG, CNH
        ou passaporte) e de um comprovante de endereço dos últimos 3 meses. Marque quem assina pela
        empresa.
      </p>
      <div className="grid gap-4">
        {socios.map((socio, index) => (
          <BlocoSocio
            aoAnexar={(campo, arquivo) => onAnexar(socio.id, campo, arquivo)}
            aoMudar={(patch) => onMudar(socio.id, patch)}
            aoRemover={() => onRemover(socio.id)}
            indice={index}
            key={socio.id}
            podeRemover={socios.length > 1}
            socio={socio}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAdicionar}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-subtle px-3 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle/70"
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        Adicionar sócio
      </button>

      {socios.length && !temRepresentante ? (
        <p className="m-0 mt-3 text-xs font-medium text-amber-700 dark:text-amber-300">
          Marque quem é o representante legal (quem assina pela empresa).
        </p>
      ) : null}

      {emailDuplicado ? (
        <p className="m-0 text-xs font-medium text-rose-600 dark:text-rose-300">
          Há sócios com o mesmo e-mail. O e-mail é a credencial de acesso e precisa ser único.
        </p>
      ) : null}

      <NavButtons
        canNext={socios.length > 0 && completos && temRepresentante && !emailDuplicado}
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

// Query do enriquecimento que traz o conselho de classe (CRECI). CARELI_PF_04 inclui o dataset
// class_organization. ATENÇÃO custo: essa query roda vários datasets — trocar por uma query
// enxuta só-conselho quando o MOST criar. Só dispara quando o operador clica "Buscar dados".
const QUERY_ENRICH_CRECI = "CARELI_PF_04";

// Cadastro básico: é dela que sai o NOME COMPLETO (dataset basic_data). A PF_04 não o traz.
//
// ⚠️ CUSTO: são DUAS consultas por corretor, não uma. É o mesmo custo que o portal público já
// paga desde 20/07 pela mesma regra ("o corretor digita o CPF, a MOST traz o nome completo"), e
// as duas rodam UMA VEZ por CPF — o `cpfBuscado` abaixo é o que garante isso.
const QUERY_ENRICH_CADASTRO = "CARELI_PF_01";

// Etapa Corretores (só imobiliária): cadastro SIMPLES e digitado. Cada corretor vira um
// relacionamento de contato. Pode avançar sem nenhum (cadastra depois); os adicionados precisam
// de nome + CPF. O CRECI tenta vir do enriquecimento por CPF; senão, é digitado. Nada além disso
// é obrigatório.
function StepCorretores({
  corretores,
  onAdicionar,
  onBack,
  onMudar,
  onNext,
  onRemover,
}: {
  corretores: CorretorCadastro[];
  onAdicionar: () => void;
  onBack: () => void;
  onMudar: (id: string, patch: Partial<CorretorCadastro>) => void;
  onNext: () => void;
  onRemover: (id: string) => void;
}) {
  // Tudo obrigatório menos o CRECI. O e-mail é a futura credencial de acesso ao Panteon, então
  // não pode repetir entre corretores.
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emails = corretores.map((c) => c.email.trim().toLowerCase()).filter(Boolean);
  const emailDuplicado = emails.length !== new Set(emails).size;
  const completos = corretores.every(
    (c) =>
      c.nome.trim().length > 0 &&
      soDigitos(c.cpf).length === 11 &&
      soDigitos(c.telefone).length >= 10 &&
      emailRegex.test(c.email),
  );

  return (
    <StepCard title="4. Corretores">
      <p className="rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        Corretores da imobiliária. Pode avançar sem nenhum e cadastrar depois.
      </p>

      <div className="grid gap-4">
        {corretores.map((corretor, index) => (
          <BlocoCorretor
            aoMudar={(patch) => onMudar(corretor.id, patch)}
            aoRemover={() => onRemover(corretor.id)}
            corretor={corretor}
            indice={index}
            key={corretor.id}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onAdicionar}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-subtle px-3 py-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle/70"
      >
        <UserRound className="size-3.5" aria-hidden="true" />
        Adicionar corretor
      </button>

      {emailDuplicado ? (
        <p className="m-0 text-xs font-medium text-rose-600 dark:text-rose-300">
          Há corretores com o mesmo e-mail. O e-mail é a credencial de acesso e precisa ser único.
        </p>
      ) : null}

      <NavButtons canNext={completos && !emailDuplicado} onBack={onBack} onNext={onNext} />
    </StepCard>
  );
}

function BlocoCorretor({
  aoMudar,
  aoRemover,
  corretor,
  indice,
}: {
  aoMudar: (patch: Partial<CorretorCadastro>) => void;
  aoRemover: () => void;
  corretor: CorretorCadastro;
  indice: number;
}) {
  // Enriquecimento do CRECI pelo CPF (interno x público).
  const { api } = useCadastroCtx();
  const [buscando, setBuscando] = useState(false);
  const cpfOk = soDigitos(corretor.cpf).length === 11;
  // Último CPF consultado: a busca dispara sozinha ao completar o CPF, e este ref garante UMA
  // consulta por CPF (cada consulta é cobrada).
  const cpfBuscado = useRef("");

  useEffect(() => {
    const digitos = soDigitos(corretor.cpf);
    if (digitos.length !== 11 || cpfBuscado.current === digitos) return;
    cpfBuscado.current = digitos;
    void buscar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corretor.cpf]);

  // Enriquece pelo CPF: NOME COMPLETO, telefone, e-mail e o CRECI. Best-effort — se não vier, os
  // campos ficam manuais.
  //
  // Regra do Lucas (17/08): "é obrigatório informar o CPF, é válido iniciar por essa pergunta e
  // usar a MOST para trazer o nome do corretor, pois é o CPF que valida o corretor na hora de
  // subir CAD". É a mesma regra que o portal público segue desde 20/07; aqui dentro o nome ainda
  // era digitado à mão, e digitar nome à mão é como nasce corretor com grafia diferente da base.
  //
  // ⚠️ AS DUAS QUERIES EM PARALELO, e não em sequência: se o CRECI demorar, o nome ainda chega
  // (e vice-versa). Mesma escolha da rota pública /cad/creci.
  async function buscar() {
    setBuscando(true);

    const [doCadastro, doCreci] = await Promise.all([
      api
        .ocr<Enrichment>({ action: "enrich", cpf: corretor.cpf, query: QUERY_ENRICH_CADASTRO })
        .catch(() => ENRICH_VAZIO),
      api
        .ocr<Enrichment>({ action: "enrich", cpf: corretor.cpf, query: QUERY_ENRICH_CRECI })
        .catch(() => ENRICH_VAZIO),
    ]);

    setBuscando(false);

    // ⚠️ O QUE O OPERADOR DIGITOU GANHA. A busca preenche o que está VAZIO; ela não corrige o
    // que já foi escrito. Sobrescrever seria apagar a correção de quem tem o documento na mão.
    aoMudar({
      creci: corretor.creci || doCreci.creci,
      creciLido: Boolean(doCreci.creci) || corretor.creciLido,
      email: corretor.email || doCadastro.emails[0] || doCreci.emails[0] || "",
      nome: corretor.nome || doCadastro.nome || "",
      telefone: corretor.telefone || doCadastro.telefones[0] || doCreci.telefones[0] || "",
    });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold text-ink">
          Corretor {indice + 1}
          {corretor.nome ? (
            <span className="text-ink-muted"> · {titleCase(corretor.nome)}</span>
          ) : null}
        </h3>
        <button
          type="button"
          onClick={aoRemover}
          className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          Remover
        </button>
      </div>

      <Secao title="Dados do corretor">
        {/* ⚠️ O CPF VEM PRIMEIRO, e a ordem é a regra, não estética. É ele que identifica o
            corretor na hora de subir a CAD, e é dele que a MOST traz o nome. Começar pelo nome
            convidava a digitar tudo à mão e deixar o CPF para depois — e sem CPF o corretor não
            valida no envio. */}
        <TextField
          label="CPF"
          value={corretor.cpf}
          placeholder="000.000.000-00"
          onChange={(v) => aoMudar({ cpf: v })}
        />
        <div className="sm:col-span-2">
          <TextField
            label="Nome completo"
            value={corretor.nome}
            placeholder={cpfOk ? "Nome do corretor" : "Informe o CPF: buscamos o nome"}
            onChange={(v) => aoMudar({ nome: v })}
          />
        </div>
        <PhoneField
          value={corretor.telefone}
          sugestoes={[]}
          onChange={(v) => aoMudar({ telefone: v })}
        />
        <div className="sm:col-span-2">
          <EmailField value={corretor.email} onChange={(v) => aoMudar({ email: v })} />
        </div>
        {/* O CRECI é buscado sozinho quando o CPF fica completo; se não vier, o campo é digitável. */}
        {buscando ? (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Buscando CRECI…
          </div>
        ) : corretor.creciLido ? (
          <ReadField label="CRECI" value={corretor.creci} />
        ) : (
          <TextField
            editavel
            label="CRECI"
            value={corretor.creci}
            onChange={(v) => aoMudar({ creci: v })}
          />
        )}
      </Secao>
    </div>
  );
}

// Multi-seleção com busca (usada nos empreendimentos da imobiliária). Chips dos selecionados +
// lista com checkbox. Clicar no chip remove; clicar na linha alterna.
function MultiSelectField({
  emptyLabel,
  hint,
  onChange,
  options,
  selected,
  title,
}: {
  emptyLabel?: string;
  hint?: string;
  onChange: (ids: string[]) => void;
  options: SelectOption[];
  selected: string[];
  title: string;
}) {
  const [busca, setBusca] = useState("");
  const alvo = normalizeSearch(busca);
  const filtradas = alvo
    ? options.filter((o) => normalizeSearch(o.label).includes(alvo))
    : options;
  const selecionadas = options.filter((o) => selected.includes(String(o.id)));

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">{title}</p>
      {hint ? <p className="mb-2 text-xs text-ink-muted">{hint}</p> : null}

      {selecionadas.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selecionadas.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => toggle(String(o.id))}
              className="inline-flex items-center gap-1 rounded-full border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-medium text-[#7a5e2c] transition-colors hover:bg-[#A07C3B]/20 dark:text-[#d9b877]"
            >
              {o.label}
              <X className="size-3" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}

      {options.length ? (
        <>
          <input
            value={busca}
            onChange={(event) => setBusca(event.target.value)}
            placeholder="Buscar empreendimento…"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <div className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-line">
            {filtradas.map((o) => {
              const on = selected.includes(String(o.id));
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(String(o.id))}
                  className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-subtle"
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-[#A07C3B] bg-[#A07C3B] text-white" : "border-line-strong"
                    }`}
                  >
                    {on ? <Check className="size-3" aria-hidden="true" /> : null}
                  </span>
                  <span className="flex-1 text-ink">{o.label}</span>
                </button>
              );
            })}
            {filtradas.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-muted">Nada encontrado.</p>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-xs text-ink-muted">{emptyLabel ?? "Nenhuma opção disponível."}</p>
      )}
    </div>
  );
}

function StepEndereco({
  endereco,
  onBack,
  onDocumento,
  onEnderecoChange,
  onExtract,
  onNext,
}: {
  endereco: Endereco | null;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onEnderecoChange: (patch: Partial<Endereco>) => void;
  onExtract: (ext: Extraction) => void;
  onNext: () => void;
}) {
  return (
    <StepCard title="2. Comprovante de endereço">
      <p className="m-0 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        Agora anexe o comprovante de endereço do cliente: conta de luz, de água ou de telefone,
        emitida nos últimos 3 meses. Fotografe a conta inteira, sem cortar as bordas.
      </p>
      <div className="print:hidden">
        <DocUploader
          label="Adicionar comprovante de endereço"
          hint="Conta de luz, água ou telefone · foto ou PDF"
          onFile={onDocumento}
          onExtracted={(ext) => {
            // Aqui só entra comprovante: RG/certidão/cartão CNPJ são recusados.
            conferirDocumento(
              ext,
              ["comprovante"],
              "um comprovante de endereço (conta de luz, água ou telefone)",
            );
            // ⚠️ COMPROVANTE NÃO BARRA MAIS (regra do Lucas, 22/08: "certidões, comprovante de
            // endereço não pode travar o processo de subir cad... o restante pode passar mas
            // devemos apontar esse erro"). O throw que existia aqui travava a etapa SEM SAÍDA:
            // ele rodava antes de `onExtract`, então o endereço nunca era setado e o campo
            // manual de CEP nem aparecia — e como os arquivos anexados se acumulam, reanexar um
            // comprovante bom relançava o erro do antigo. Agora o problema vira AVISO na tela e
            // PENDÊNCIA formalizada na ficha (ver `pendenciasDoComprovante`), e a CAD segue.
            const emissao = acharDataComprovante(ext.fields);
            const meses = emissao ? mesesDesde(emissao) : null;
            if (meses !== null && meses > 3) {
              ext.avisoQualidade = [
                ext.avisoQualidade,
                `Comprovante emitido há ${meses} meses (${formatDateBR(emissao)}); o ideal são ` +
                  "até 3 meses. A CAD segue com essa pendência anotada na ficha.",
              ]
                .filter(Boolean)
                .join(" ");
            } else if (!emissao) {
              ext.avisoQualidade = [
                ext.avisoQualidade,
                "Não conseguimos confirmar a data de emissão do comprovante. A CAD segue com " +
                  "essa pendência anotada na ficha.",
              ]
                .filter(Boolean)
                .join(" ");
            }
            onExtract(ext);
          }}
        />
      </div>
      {endereco ? (
        <>
          {/* Aviso quando a MOST não leu o comprovante: documento salvo, preenche pelo CEP. */}
          {!endereco.logradouro && !endereco.cidade ? (
            <p className="m-0 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
              Não conseguimos ler o endereço no comprovante. O documento foi salvo: fotografe a
              conta inteira, sem cortar as bordas, e anexe de novo, ou preencha pelo CEP abaixo.
            </p>
          ) : null}
          <EnderecoEditavel endereco={endereco} onChange={onEnderecoChange} />
          {endereco.dataDocumento ? (
            <ComprovanteRecencia data={endereco.dataDocumento} />
          ) : null}
        </>
      ) : null}
      <NavButtons
        canNext={Boolean(endereco?.logradouro && endereco?.cidade)}
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

function StepCertidao({
  estadoCivilId,
  onBack,
  onDocumento,
  onNext,
  onPerfilChange,
  regimeBensId,
}: {
  estadoCivilId: string;
  onBack: () => void;
  onDocumento: (arquivo: ArquivoAnexado) => void;
  onNext: () => void;
  onPerfilChange: (patch: Partial<Perfil>) => void;
  regimeBensId: string;
}) {
  const [certidao, setCertidao] = useState<Extraction | null>(null);
  const [regimeLido, setRegimeLido] = useState(false);
  const valida = certidao ? isCertidao(certidao.documentType) : null;
  const esperada = certidaoEsperada(estadoCivilId);
  const tituloMinusculo = esperada.titulo.toLowerCase();
  // Regime de bens só existe em casamento / união estável (o C2X guarda em property_regimes).
  const pedeRegime = ["2", "6"].includes(estadoCivilId);

  return (
    <StepCard title="3. Certidão">
      <p className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 print:hidden">
        Agora anexe a <span className="font-semibold">{tituloMinusculo}</span> do cliente. Nós
        conferimos a autenticidade do documento automaticamente.
      </p>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          {esperada.titulo}
        </p>
        <div className="print:hidden">
          <DocUploader
            label={`Adicionar ${tituloMinusculo}`}
            hint={`${esperada.hint} · foto ou PDF`}
            onFile={onDocumento}
            onExtracted={(ext) => {
              conferirDocumento(ext, ["certidao"], `a ${tituloMinusculo}`);
              setCertidao(ext);
              if (!pedeRegime) {
                return;
              }
              // Se o MOST reconheceu o regime na certidão, preenche; senão fica manual.
              const id = acharRegimeCertidao(ext);
              setRegimeLido(Boolean(id));
              if (id) {
                onPerfilChange({ regimeBensId: id });
              }
            }}
          />
        </div>
        {certidao ? (
          valida ? (
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/12 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Autenticidade confirmada ({mapCertidao(certidao.documentType)}).
            </div>
          ) : (
            // Leitura não confirmou = AVISO, não bloqueio (Lucas, 02/08): certidão de cartório
            // foge do padrão que a MOST conhece e ela recusava documento legítimo. O arquivo
            // fica salvo e os campos abrem para o manual; quem confere é a Validação.
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Não conseguimos confirmar a leitura da certidão. O arquivo foi salvo: confira o
              documento e preencha os campos na mão.
            </div>
          )
        ) : null}
      </div>

      {/* O regime só existe depois da certidão lida: antes disso não há o que mostrar (era o
          campo aparecendo em branco, pedindo digitação, antes mesmo do documento). */}
      {pedeRegime && certidao ? (
        <Secao title="Regime de bens">
          {/* Lido da certidão = read-only (o documento é a fonte, não a digitação). Só quando a
              leitura não reconhece o regime é que o campo abre pra seleção manual. */}
          {regimeLido ? (
            <ReadField
              label="Regime de casamento"
              value={
                C2X_REGIME_BENS.find((o) => o.id.toString() === regimeBensId)?.label ?? ""
              }
            />
          ) : (
            <>
              <SelectField
                label="Regime de casamento"
                value={regimeBensId}
                options={C2X_REGIME_BENS}
                onChange={(v) => onPerfilChange({ regimeBensId: v })}
              />
              {certidao ? (
                <p className="m-0 self-center text-xs text-ink-muted sm:col-span-2">
                  Não foi possível ler o regime nesta certidão. Selecione conforme o documento.
                </p>
              ) : null}
            </>
          )}
        </Secao>
      ) : null}

      <NavButtons
        // Avançar exige o documento ENVIADO (não mais a leitura reconhecida — a MOST recusava
        // certidão legítima e trancava o cadastro aqui). O regime segue obrigatório quando
        // o estado civil pede; sem leitura, ele abre para seleção manual.
        canNext={Boolean(certidao) && (!pedeRegime || Boolean(regimeBensId))}
        onBack={onBack}
        onNext={onNext}
        nextLabel="Avançar para revisão"
      />
    </StepCard>
  );
}

// Comprovante de renda: etapa que só existe quando o EMPREENDIMENTO a liga no Setup.
//
// ⚠️ É UM DOCUMENTO, TRÊS FORMAS — e a tela tem que dizer isso. O corretor escolhe qual das três o
// cliente tem em mãos (extrato bancário dos últimos 3 meses, contracheque ou declaração de imposto
// de renda) e anexa SÓ essa. Listar as três como se fossem três anexos faria o corretor ir atrás
// de documento que ninguém pediu; não dizer nada faria ele adivinhar o que serve.
//
// SEM LEITURA (`semLeitura`): contracheque e extrato não são formulários padronizados que a MOST
// reconheça, e cada arquivo mandado para leitura é uma consulta cobrada. Mesma decisão do contrato
// social. Quem confere o documento é a Validação, com o arquivo à vista.
function StepRenda({
  anexados,
  numero,
  onBack,
  onDocumento,
  onNext,
  onTrocarTipo,
}: {
  anexados: DocumentosAnexados;
  // Posição da etapa no wizard: ela cai em 3 (solteiro) ou 4 (com certidão / PJ), então o número
  // do cartão vem de fora em vez de fixo como nos demais.
  numero: number;
  onBack: () => void;
  onDocumento: (categoria: ComprovanteRendaCategoria) => (arquivo: ArquivoAnexado) => void;
  onNext: () => void;
  onTrocarTipo: (categoria: ComprovanteRendaCategoria) => void;
}) {
  // Nasce sem escolha: o corretor tem que dizer QUAL documento está mandando, senão o tipo que
  // chega na ficha seria um chute nosso.
  const [tipo, setTipo] = useState<ComprovanteRendaCategoria | null>(null);
  const escolhida = COMPROVANTE_RENDA_OPCOES.find((opcao) => opcao.categoria === tipo) ?? null;
  const anexado = tipo ? (anexados[tipo] ?? []).length > 0 : false;

  return (
    <StepCard title={`${numero}. Comprovante de renda`}>
      <p className="m-0 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
        Este empreendimento pede o <span className="font-semibold">comprovante de renda</span> do
        cliente. Escolha <span className="font-semibold">um</span> dos três abaixo — o que o cliente
        tiver em mãos — e anexe só ele.
      </p>

      <div className="print:hidden" role="radiogroup" aria-label="Tipo de comprovante de renda">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
          Qual documento o cliente vai mandar?
        </p>
        <div className="grid gap-2">
          {COMPROVANTE_RENDA_OPCOES.map((opcao) => {
            const ativa = opcao.categoria === tipo;
            return (
              <button
                aria-checked={ativa}
                className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  ativa
                    ? "border-ink bg-subtle"
                    : "border-line bg-surface hover:border-line-strong hover:bg-subtle"
                }`}
                key={opcao.categoria}
                onClick={() => {
                  if (ativa) return;
                  setTipo(opcao.categoria);
                  // Descarta o que tiver sido anexado nas outras formas: vale o que está escolhido.
                  onTrocarTipo(opcao.categoria);
                }}
                role="radio"
                type="button"
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
                    ativa ? "border-ink" : "border-line-strong"
                  }`}
                >
                  {ativa ? <span className="size-2 rounded-full bg-ink" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{opcao.tela}</span>
                  <span className="block text-xs text-ink-muted">{opcao.telaHint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {tipo && escolhida ? (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
            {escolhida.tela}
          </p>
          <div className="print:hidden">
            {/* key={tipo}: trocar a forma remonta o uploader, que guarda a lista de arquivos
                internamente — sem isso a tela continuaria mostrando "2 arquivos anexados" do
                documento que acabou de ser descartado. */}
            <DocUploader
              hint={`${escolhida.telaHint} · foto ou PDF`}
              key={tipo}
              label={`Adicionar ${escolhida.tela.toLowerCase()}`}
              onExtracted={() => {}}
              onFile={onDocumento(tipo)}
              // Anexo puro: não é formulário padronizado, não há campo a ler, e cada leitura seria
              // uma consulta cobrada à toa.
              semLeitura
            />
          </div>
        </div>
      ) : null}

      <NavButtons
        // Escolher a forma não basta: o que a CAD precisa é do ARQUIVO. Mesma regra das demais
        // etapas — conta o anexo, nunca leitura nem qualidade.
        canNext={anexado}
        nextLabel="Avançar para revisão"
        onBack={onBack}
        onNext={onNext}
      />
    </StepCard>
  );
}

function StepRevisao({
  conjuge,
  corretores,
  documentos,
  empreendimentos,
  empreendimentosSel,
  empresa,
  endereco,
  exigeComprovanteRenda,
  identidade,
  imobiliarias,
  isImobiliaria,
  onBack,
  onEditar,
  perfil,
  persona,
  // Vínculo vindo do TOKEN no modo público (imobiliária e corretor): a revisão não consegue
  // resolver esses nomes sozinha aqui, ver o comentário em PublicoConfig.
  publico,
  socios,
  steps,
  tipo,
  vinculo,
}: {
  conjuge: Conjuge | null;
  corretores: CorretorCadastro[];
  documentos: DocumentosAnexados;
  empreendimentos: SelectOption[];
  empreendimentosSel: string[];
  empresa: Empresa;
  endereco: Endereco | null;
  // Etapa "Comprovante de renda" ligada no empreendimento desta CAD: entra na lista do que falta e
  // no `disabled` do Enviar, igual aos demais obrigatórios.
  exigeComprovanteRenda: boolean;
  identidade: Identidade | null;
  imobiliarias: SelectOption[];
  isImobiliaria: boolean;
  onBack: () => void;
  // Revisão só é revisão se der pra CORRIGIR: cada etapa vira um atalho de volta (Lucas 18/jul).
  onEditar: (step: number) => void;
  perfil: Perfil;
  persona: Persona;
  // Modo público: os nomes vêm do token (o portão repassa), porque a lista de imobiliárias que
  // resolve o rótulo no interno não é carregada aqui.
  publico?: { corretorNome?: string; imobiliariaNome?: string } | null;
  socios: SocioCadastro[];
  steps: string[];
  tipo: string;
  // Prospect interno: empreendimento + corretor da imobiliária, já resolvido no CadastroFlow.
  vinculo: {
    enterpriseId?: string;
    empreendimentoNome?: string;
    corretorEntityId?: string;
    corretorNome?: string;
    corretorEmail?: string;
  } | null;
}) {
  // Adapter de salvamento (interno: /api/apolo/cadastro/salvar; público: rota gated do modo) +
  // flag público, que redireciona os "sair/novo cadastro" para recarregar em vez de ir ao /apolo.
  const { api, modoPublico } = useCadastroCtx();
  const label = (options: SelectOption[], id: string) =>
    options.find((o) => o.id.toString() === id)?.label ?? "";

  // Empreendimentos vinculados (só imobiliária): resolve os ids selecionados pros rótulos.
  const empreendimentosLabels = empreendimentosSel
    .map((id) => label(empreendimentos, id))
    .filter(Boolean);

  const isPj = persona === "pj";
  const nomeCliente = isPj
    ? titleCase(empresa.razaoSocial || "Empresa")
    : titleCase(identidade?.nome ?? "Cliente");
  const registro = formatRegistro(new Date());
  // O documento da imobiliária é "Imobiliaria - ...", não CAD (a CAD é do prospect).
  const rotuloDoc = isImobiliaria ? "Imobiliaria" : "CAD";
  const cadTitulo = `${rotuloDoc} - ${nomeCliente} - ${registro.completo}`;
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<SalvarResposta | null>(null);

  // 🔒 TRAVA DE OBRIGATÓRIOS NO CLIENTE (incidente 04/08): o Enviar antes só olhava se estava
  // "enviando" — dava para submeter a CAD sem os documentos e ela caía na "correção". Agora o
  // botão fica desabilitado enquanto faltar documento obrigatório, e a lista do que falta aparece
  // ao lado. A trava de verdade é a do servidor (as duas rotas de salvar); esta é só UX/atalho —
  // usa as MESMAS regras (lib/apolo/cadastro-obrigatorios.ts).
  //
  // ⚠️ Conta o ARQUIVO ANEXADO, não o sucesso do OCR (v1.105.0 — [[project_apolo_most_sem_trava]]):
  // `documentos` é preenchido no `onFile`, ANTES de qualquer leitura, então um documento cuja
  // leitura falhou (campos preenchidos à mão) continua contando como anexado.
  const categoriasAnexadas = [
    ...Object.entries(documentos)
      .filter(([, arquivos]) => (arquivos ?? []).length > 0)
      .map(([categoria]) => categoria),
    // Sócios (PJ): o índice não importa para a trava, só a família (id / comprovante) estar presente.
    ...(socios.some((s) => s.arquivosIdentificacao.length > 0) ? ["identificacao_socio_1"] : []),
    ...(socios.some((s) => s.arquivosComprovante.length > 0) ? ["comprovante_socio_1"] : []),
  ];
  const faltando = documentosFaltandoCurto(
    { estadoCivilId: perfil.estadoCivilId, exigeComprovanteRenda, persona },
    categoriasAnexadas,
  );
  const podeEnviar = faltando.length === 0;

  // Certidões, análise financeira (GOLD) e demais consultas sob demanda saíram
  // do cadastro (decisão do Lucas 11/jul): o cadastro/CAD mostra só o que é
  // automático; o sob demanda o operador roda depois, na ficha do Apolo.
  // Envio = nascimento da ENTIDADE pelo papel Prospect: cria o cadastro no Apolo e sobe pro
  // drive os documentos originais anexados + o CAD gerado aqui.
  async function enviar() {
    setEnviando(true);
    setErroEnvio(null);
    try {
      const anexos = Object.entries(documentos).flatMap(([categoria, arquivos]) =>
        (arquivos ?? []).map((arquivo) => ({
          categoria,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
      );

      // A categoria carrega o índice do sócio ("identificacao_socio_1"): sem isso o servidor
      // agruparia os documentos de TODOS os sócios num PDF só.
      const anexosSocios = socios.flatMap((socio, index) => [
        ...socio.arquivosIdentificacao.map((arquivo) => ({
          categoria: `identificacao_socio_${index + 1}`,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
        ...socio.arquivosComprovante.map((arquivo) => ({
          categoria: `comprovante_socio_${index + 1}`,
          fileBase64: arquivo.fileBase64,
          fileName: arquivo.fileName,
          mimeType: arquivo.mimeType,
        })),
      ]);

      // TETO POR DOCUMENTO: 20MB de arquivo de verdade (não de base64). Acima disso não existe
      // caminho, nem o direto — a mensagem diz o limite real e o que fazer.
      const todosDocs: DocumentoEnvio[] = [...anexos, ...anexosSocios];
      const grande = todosDocs.find((d) => bytesDoBase64(d.fileBase64) > TETO_DOCUMENTO_BYTES);
      if (grande) {
        setErroEnvio(
          `O arquivo "${grande.fileName}" tem ${(bytesDoBase64(grande.fileBase64) / 1_048_576).toFixed(1)}MB e ` +
            "o limite é de 20MB por documento. Envie uma versão menor (uma FOTO do documento, em " +
            "vez do PDF, ou o PDF com menos páginas) e tente de novo. Nada do que você preencheu se perde.",
        );
        setEnviando(false);
        return;
      }

      // DOIS CAMINHOS (ver TETO_CORPO_BASE64): o que cabe no corpo vai como sempre; o que não cabe
      // sobe direto pro Storage e viaja só como referência. Se tudo couber, este bloco não faz nada
      // e o envio é byte a byte o de hoje.
      const direto = categoriasParaUploadDireto(todosDocs);
      const documentosEnvio: DocumentoEnvio[] = [];
      for (const doc of todosDocs) {
        if (!direto.has(doc.categoria) || !doc.fileBase64) {
          documentosEnvio.push(doc);
          continue;
        }
        const gravado = await subirDocumentoDireto({
          assinarUpload: api.assinarUpload,
          fileBase64: doc.fileBase64,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
        });
        documentosEnvio.push({
          categoria: doc.categoria,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          sizeBytes: gravado.sizeBytes,
          storagePath: gravado.storagePath,
        });
      }

      const salvo = await api.salvar({
        // Estrutura da CAD: o PDF é montado no servidor, com o código de autenticação.
        cad: montarCadDoc(),
        conjuge: conjuge
          ? {
              // A ficha INTEIRA viaja (23/08): sexo, escolaridade, renda, profissão, patrimônio,
              // naturalidade e nacionalidade só existiam no PDF — a validação abria vazia.
              cpf: conjuge.cpf,
              dataNascimento: conjuge.dataNascimento,
              email: conjuge.email,
              escolaridadeId: conjuge.escolaridadeId,
              nacionalidade: conjuge.nacionalidade,
              naturalidade: conjuge.naturalidade,
              nome: conjuge.nome,
              nomeMae: conjuge.nomeMae,
              patrimonio: conjuge.patrimonio,
              profissaoId: conjuge.profissaoId,
              // Sobe junto: é o que o cliente DECLAROU e o que a validação vai padronizar.
              profissaoOutro: conjuge.profissaoOutro,
              rendaId: conjuge.rendaId,
              sexoId: conjuge.sexoId,
              telefone: conjuge.telefone,
            }
          : null,
        // Corretores da imobiliária → relacionamentos de contato (só ids/dados; sem documento).
        corretores: isImobiliaria
          ? corretores
              .filter((c) => c.nome.trim() && soDigitos(c.cpf).length === 11)
              .map((c) => ({
                cpf: c.cpf,
                creci: c.creci,
                email: c.email,
                nome: c.nome,
                telefone: c.telefone,
              }))
          : undefined,
        documentos: documentosEnvio,
        // Empreendimentos vinculados (só imobiliária) → relacionamentos de trabalho.
        empreendimentos: isImobiliaria
          ? empreendimentosSel.map((id) => ({ id, label: label(empreendimentos, id) }))
          : undefined,
        empresa: isPj ? empresa : null,
        endereco,
        identidade,
        perfil: { ...perfil, imobiliariaLabel: label(imobiliarias, perfil.imobiliariaId) },
        persona,
        role: tipo,
        // Vínculo do prospect interno (empreendimento + corretor da imobiliária). O servidor ignora
        // quando ausente; nos modos imobiliária/público ele nunca é montado (fica null → undefined).
        vinculo: vinculo ?? undefined,
        socios: isPj
          ? socios.map((socio) => ({
              cpf: socio.cpf,
              dataNascimento: socio.dataNascimento,
              email: socio.email,
              endereco: {
                bairro: socio.endereco.bairro,
                cep: socio.endereco.cep,
                cidade: socio.endereco.cidade,
                logradouro: socio.endereco.logradouro,
                numero: socio.endereco.numero,
                uf: socio.endereco.uf,
              },
              estadoCivilId: socio.estadoCivilId,
              nacionalidade: socio.nacionalidade,
              naturalidade: socio.naturalidade,
              nome: socio.nome,
              nomeMae: socio.nomeMae,
              representanteLegal: socio.representanteLegal,
              sexoId: socio.sexoId,
              telefone: socio.telefone,
            }))
          : undefined,
      });
      setResultado(salvo);
      setEnviado(true);
    } catch (error) {
      setErroEnvio((error as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  // Monta o CAD uma vez: serve tanto pro botao Baixar quanto pro arquivo salvo no drive.
  function montarCadDoc(): CadDoc {
    const secoes: CadSecao[] = [];
    if (isPj) {
      // Razão social / nome NÃO entram como campo: já vão em destaque no topo da ficha.
      secoes.push(
        cadSection("Dados da empresa", [
          cadField("Nome fantasia", titleCase(empresa.nomeFantasia)),
          cadField("CNPJ", empresa.cnpj),
          cadField("Porte", empresa.porte),
          cadField("Abertura", formatDateBR(empresa.dataAbertura)),
          cadField("Atualização cadastral", formatDateBR(empresa.dataAtualizacao)),
          cadField("Situação cadastral", empresa.situacaoCadastral),
          cadField("Natureza jurídica", empresa.naturezaJuridica, true),
          cadField("CNAE", empresa.cnae),
          cadField("Atividade principal", empresa.atividade, true),
          // CRECI Jurídico: só entra na ficha da imobiliária (e só se preenchido).
          ...(isImobiliaria && empresa.creci.trim()
            ? [cadField("CRECI Jurídico", empresa.creci)]
            : []),
        ]),
      );
      if (empresa.socios.length) {
        secoes.push(
          cadSection(
            "Quadro societário (QSA)",
            empresa.socios.map((socio) =>
              cadField(socio.qualificacao || "Sócio", titleCase(socio.nome), true),
            ),
          ),
        );
      }
      secoes.push(
        cadSection("Endereço", [
          cadField("Logradouro", titleCase(endereco?.logradouro ?? ""), true),
          cadField("Número", endereco?.numero ?? ""),
          cadField("Bairro", titleCase(endereco?.bairro ?? "")),
          cadField("CEP", endereco?.cep ?? ""),
          cadField("Cidade", titleCase(endereco?.cidade ?? "")),
          cadField("UF", endereco?.uf ?? ""),
        ]),
      );
      secoes.push(
        cadSection("Contato", [
          cadField("Telefone", empresa.telefone),
          cadField("E-mail", empresa.email),
        ]),
      );
      for (const [index, socio] of socios.entries()) {
        secoes.push(
          cadSection(
            `Sócio ${index + 1}${socio.representanteLegal ? " · representante legal" : ""}`,
            [
              cadField("Nome", titleCase(socio.nome), true),
              cadField("CPF", socio.cpf),
              cadField("Nascimento", formatDateBR(socio.dataNascimento)),
              cadField("Sexo", label(C2X_SEXO, socio.sexoId)),
              cadField("Estado civil", label(C2X_ESTADO_CIVIL, socio.estadoCivilId)),
              cadField("Telefone", socio.telefone),
              cadField("E-mail", socio.email, true),
              cadField(
                "Endereço",
                [
                  titleCase(socio.endereco.logradouro),
                  socio.endereco.numero,
                  titleCase(socio.endereco.cidade),
                  socio.endereco.uf,
                ]
                  .filter(Boolean)
                  .join(", "),
                true,
              ),
            ],
          ),
        );
      }
      // Imobiliária: empreendimentos vinculados (trabalho) e corretores (contato).
      if (isImobiliaria && empreendimentosLabels.length) {
        secoes.push(
          cadSection(
            "Empreendimentos vinculados",
            empreendimentosLabels.map((nome, i) =>
              cadField(`Empreendimento ${i + 1}`, titleCase(nome), true),
            ),
          ),
        );
      }
      if (isImobiliaria) {
        const corretoresValidos = corretores.filter(
          (c) => c.nome.trim() && soDigitos(c.cpf).length === 11,
        );
        for (const [index, corretor] of corretoresValidos.entries()) {
          secoes.push(
            cadSection(`Corretor ${index + 1}`, [
              cadField("Nome", titleCase(corretor.nome), true),
              cadField("CPF", corretor.cpf),
              cadField("CRECI", corretor.creci),
              cadField("Telefone", corretor.telefone),
              cadField("E-mail", corretor.email, true),
            ]),
          );
        }
      }
    } else {
      // O nome NÃO entra como campo: já vai em destaque no topo da ficha.
      secoes.push(
        cadSection("Identificação", [
          cadField("CPF", identidade?.cpf ?? ""),
          cadField("Nascimento", formatDateBR(identidade?.dataNascimento ?? "")),
          cadField("Idade", calcIdade(identidade?.dataNascimento ?? "")),
          cadField("Nome da mãe", titleCase(identidade?.nomeMae ?? ""), true),
          cadField("Naturalidade", titleCase(identidade?.naturalidade ?? "")),
          cadField("Nacionalidade", titleCase(identidade?.nacionalidade ?? "")),
          cadField("Sexo", label(C2X_SEXO, perfil.sexoId)),
          cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
          // Regime só entra quando existe (casado / união estável).
          ...(perfil.regimeBensId
            ? [cadField("Regime de bens", label(C2X_REGIME_BENS, perfil.regimeBensId))]
            : []),
        ]),
      );
      secoes.push(
        cadSection("Perfil", [
          cadField("Escolaridade", label(C2X_ESCOLARIDADE, perfil.escolaridadeId)),
          cadField("Faixa de renda", label(C2X_FAIXA_RENDA, perfil.rendaId)),
          cadField("Patrimônio", perfil.patrimonio),
          // Profissão digitada sai na CAD com a marca "(a padronizar)": a pendência tem que estar
          // FORMALIZADA no papel, não só na tela (mesma regra da seção de pendências abaixo).
          cadField("Profissão", profissaoExibida(perfil.profissaoId, perfil.profissaoOutro)),
        ]),
      );
      secoes.push(
        cadSection("Endereço", [
          cadField("Logradouro", titleCase(endereco?.logradouro ?? ""), true),
          cadField("Número", endereco?.numero ?? ""),
          cadField("Complemento", titleCase(endereco?.complemento ?? "")),
          cadField("Bairro", titleCase(endereco?.bairro ?? "")),
          cadField("CEP", endereco?.cep ?? ""),
          cadField("Cidade", titleCase(endereco?.cidade ?? "")),
          cadField("UF", endereco?.uf ?? ""),
        ]),
      );
      secoes.push(
        cadSection("Contato", [
          cadField("Telefone", perfil.telefone),
          cadField("E-mail", perfil.email),
        ]),
      );
      if (conjuge) {
        secoes.push(
          cadSection("Cônjuge", [
            cadField("Nome", titleCase(conjuge.nome), true),
            cadField("CPF", conjuge.cpf),
            cadField("Nascimento", formatDateBR(conjuge.dataNascimento)),
            cadField("Idade", calcIdade(conjuge.dataNascimento)),
            cadField("Nome da mãe", titleCase(conjuge.nomeMae), true),
            cadField("Naturalidade", titleCase(conjuge.naturalidade)),
            cadField("Nacionalidade", titleCase(conjuge.nacionalidade)),
            cadField("Sexo", label(C2X_SEXO, conjuge.sexoId)),
            cadField("Estado civil", label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)),
            // Regime é do CASAMENTO: o cônjuge herda o mesmo do titular.
            ...(perfil.regimeBensId
              ? [cadField("Regime de bens", label(C2X_REGIME_BENS, perfil.regimeBensId))]
              : []),
            cadField("Escolaridade", label(C2X_ESCOLARIDADE, conjuge.escolaridadeId)),
            cadField("Faixa de renda", label(C2X_FAIXA_RENDA, conjuge.rendaId)),
            cadField("Patrimônio", conjuge.patrimonio),
            cadField("Profissão", profissaoExibida(conjuge.profissaoId, conjuge.profissaoOutro)),
            cadField("Telefone", conjuge.telefone),
            cadField("E-mail", conjuge.email, true),
          ]),
        );
      }
    }

    // ⚠️ PENDÊNCIAS DE DOCUMENTAÇÃO — a seção que FORMALIZA o que a leitura não confirmou.
    //
    // Pedido do Lucas (22/08): comprovante e certidão não travam mais o envio, "contudo temos que
    // deixar claro que a cad que subiu tem essa observação no documento que é gerado na hora que
    // finaliza o processo... deixar bem formalizado a pendência para que o corretor e o analista
    // quando for fazer a operação saibam disso". Sem esta seção, o aviso morria na tela do
    // corretor e o analista recebia a CAD como se estivesse completa.
    //
    // Derivada AQUI, do estado final, e não acumulada pelos handlers: reanexar um documento bom
    // limpa a pendência sozinho, sem estado fantasma de um arquivo que já foi substituído.
    const pendencias: string[] = [];
    const mesesComprovante = endereco?.dataDocumento ? mesesDesde(endereco.dataDocumento) : null;
    if (endereco && !endereco.dataDocumento) {
      pendencias.push(
        "Comprovante de endereço: a data de emissão não pôde ser confirmada pela leitura automática (documento ilegível ou sem data).",
      );
    } else if (mesesComprovante !== null && mesesComprovante > 3) {
      pendencias.push(
        `Comprovante de endereço emitido há ${mesesComprovante} meses (${formatDateBR(endereco?.dataDocumento ?? "")}); o ideal são até 3 meses.`,
      );
    }
    if (endereco && !endereco.logradouro && !endereco.cidade) {
      pendencias.push(
        "Endereço não foi lido do comprovante; confirmar os dados preenchidos manualmente.",
      );
    }
    // PROFISSÃO DIGITADA À MÃO: a marca "(a padronizar)" no campo é fácil de passar batido no meio
    // de 30 linhas. Aqui a pendência fica FORMALIZADA no mesmo lugar em que o analista já procura o
    // que falta — e é o que impede a CAD de subir ao C2X como se estivesse completa (o legado só
    // aceita profissão do catálogo, e o envio é POST: padronizar depois não volta para lá).
    if (profissaoPendenteDePadronizacao(perfil.profissaoId, perfil.profissaoOutro)) {
      pendencias.push(
        `Profissão declarada como “${titleCase(normalizarProfissaoLivre(perfil.profissaoOutro))}”, fora da lista do sistema; a equipe padroniza na validação da CAD.`,
      );
    }
    if (conjuge && profissaoPendenteDePadronizacao(conjuge.profissaoId, conjuge.profissaoOutro)) {
      pendencias.push(
        `Profissão do cônjuge declarada como “${titleCase(normalizarProfissaoLivre(conjuge.profissaoOutro))}”, fora da lista do sistema; a equipe padroniza na validação da CAD.`,
      );
    }
    if (pendencias.length) {
      secoes.push(
        cadSection(
          "Pendências de documentação",
          pendencias.map((texto, i) => cadField(`Pendência ${i + 1}`, texto, true)),
        ),
      );
    }

    return {
      arquivo: cadTitulo,
      data: registro.data,
      hora: registro.hora,
      nome: nomeCliente,
      papel: isImobiliaria ? "Imobiliária" : isPj ? "Pessoa jurídica" : "Prospect",
      secoes,
      // A imobiliária não se vincula a outra imobiliária: o campo sai do topo da ficha dela.
      titulo: isImobiliaria ? "Cadastro de Imobiliária" : "Cadastro de CAD",
      vinculo: isImobiliaria ? "" : label(imobiliarias, perfil.imobiliariaId),
    };
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {/* Sem "baixar" antes do envio: a CAD só existe depois de enviada, gerada no servidor e
          autenticada. Assim não circula ficha sem código de autenticação. */}
      <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-inverse text-brand-ink">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {isImobiliaria
                ? "Cadastro de Imobiliária"
                : modoPublico
                  ? "Confira antes de enviar"
                  : "Cadastro de CAD"}
            </h2>
            <p className="text-xs text-ink-muted">
              {nomeCliente} · registro {registro.completo}
            </p>
          </div>
        </div>
      </div>

      {/* No público, o corretor está com o cliente ao lado: dizer o que o Enviar faz evita o
          envio apressado e a ficha voltando para correção. */}
      {enviado || !modoPublico ? null : (
        <p className="mt-4 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-3 py-2 text-xs text-[#7a5e2c] print:hidden dark:text-[#d9b877]">
          {isImobiliaria
            ? "Confira os dados antes de enviar. Ao tocar em Enviar, o cadastro vai para a análise da Careli e não dá mais para editar por aqui."
            : "Confira os dados do cliente com ele ao lado. Ao tocar em Enviar, a ficha vai para a análise da Careli e não dá mais para editar por aqui."}
        </p>
      )}

      {/* Achou erro? volta direto na etapa, sem precisar clicar "Voltar" várias vezes. */}
      {enviado ? null : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-subtle/50 px-3 py-2.5 print:hidden">
          <span className="text-xs font-medium text-ink-soft">Precisa corrigir algo?</span>
          {steps.slice(0, -1).map((nome, index) => (
            <button
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
              key={nome}
              onClick={() => onEditar(index)}
              type="button"
            >
              <Pencil aria-hidden="true" className="size-3" />
              {nome}
            </button>
          ))}
        </div>
      )}

      {isPj ? (
        <>
          <Secao title="Dados da empresa">
            <ReadField label="Razão social" value={nomeCliente} span2 />
            <ReadField label="Nome fantasia" value={titleCase(empresa.nomeFantasia)} />
            <ReadField label="CNPJ" value={empresa.cnpj} />
            <ReadField label="Porte" value={empresa.porte} />
            <ReadField label="Abertura" value={formatDateBR(empresa.dataAbertura)} />
            <ReadField
              label="Atualização cadastral"
              value={formatDateBR(empresa.dataAtualizacao)}
            />
            <ReadField label="Situação cadastral" value={empresa.situacaoCadastral} />
            <ReadField label="Natureza jurídica" value={empresa.naturezaJuridica} span2 />
            <ReadField label="CNAE" value={empresa.cnae} span2 />
            <ReadField label="Atividade principal" value={empresa.atividade} span2 />
          </Secao>

          {empresa.socios.length ? (
            <Secao title="Sócios registrados no CNPJ">
              {empresa.socios.map((socio, index) => (
                <ReadField
                  key={`${socio.nome}-${index}`}
                  label={socio.qualificacao || "Sócio"}
                  value={titleCase(socio.nome)}
                  span2
                />
              ))}
            </Secao>
          ) : null}

          <Secao title="Endereço">
            <ReadField label="Logradouro" value={titleCase(endereco?.logradouro ?? "")} span2 />
            <ReadField label="Número" value={endereco?.numero ?? ""} />
            <ReadField label="Bairro" value={titleCase(endereco?.bairro ?? "")} />
            <ReadField label="CEP" value={endereco?.cep ?? ""} />
            <ReadField label="Cidade" value={titleCase(endereco?.cidade ?? "")} />
            <ReadField label="UF" value={endereco?.uf ?? ""} />
          </Secao>

          <Secao title="Contato e vínculo">
            <ReadField label="Telefone" value={empresa.telefone} />
            <ReadField label="E-mail" value={empresa.email} span2 />
            <ReadField label="Imobiliária" value={label(imobiliarias, perfil.imobiliariaId)} />
          </Secao>

          {socios.map((socio, index) => (
            <Secao
              key={socio.id}
              title={`Sócio ${index + 1}${socio.representanteLegal ? " · representante legal" : ""}`}
            >
              <ReadField label="Nome" value={titleCase(socio.nome)} span2 />
              <ReadField label="CPF" value={socio.cpf} />
              <ReadField label="Nascimento" value={formatDateBR(socio.dataNascimento)} />
              <ReadField label="Sexo" value={label(C2X_SEXO, socio.sexoId)} />
              <ReadField label="Estado civil" value={label(C2X_ESTADO_CIVIL, socio.estadoCivilId)} />
              <ReadField label="Telefone" value={socio.telefone} />
              <ReadField label="E-mail" value={socio.email} span2 />
              <ReadField
                label="Endereço"
                value={[
                  titleCase(socio.endereco.logradouro),
                  socio.endereco.numero,
                  titleCase(socio.endereco.cidade),
                  socio.endereco.uf,
                ]
                  .filter(Boolean)
                  .join(", ")}
                span2
              />
            </Secao>
          ))}
        </>
      ) : (
        <>
          <Secao title="Identificação">
            <ReadField label="Nome" value={nomeCliente} span2 />
            <ReadField label="CPF" value={identidade?.cpf ?? ""} />
            <ReadField label="Nascimento" value={formatDateBR(identidade?.dataNascimento ?? "")} />
            <ReadField label="Idade" value={calcIdade(identidade?.dataNascimento ?? "")} />
            <ReadField label="Nome da mãe" value={titleCase(identidade?.nomeMae ?? "")} span2 />
            <ReadField label="Naturalidade" value={titleCase(identidade?.naturalidade ?? "")} />
            <ReadField label="Nacionalidade" value={titleCase(identidade?.nacionalidade ?? "")} />
            <ReadField label="Sexo" value={label(C2X_SEXO, perfil.sexoId)} />
            <ReadField label="Estado civil" value={label(C2X_ESTADO_CIVIL, perfil.estadoCivilId)} />
            {perfil.regimeBensId ? (
              <ReadField
                label="Regime de bens"
                value={label(C2X_REGIME_BENS, perfil.regimeBensId)}
              />
            ) : null}
          </Secao>

          <Secao title="Perfil">
            <ReadField label="Escolaridade" value={label(C2X_ESCOLARIDADE, perfil.escolaridadeId)} />
            <ReadField label="Faixa de renda" value={label(C2X_FAIXA_RENDA, perfil.rendaId)} />
            <ReadField label="Patrimônio" value={perfil.patrimonio} />
            <ReadField
              label="Profissão"
              value={profissaoExibida(perfil.profissaoId, perfil.profissaoOutro)}
              span2
            />
          </Secao>

          <Secao title="Endereço">
            <ReadField label="Logradouro" value={titleCase(endereco?.logradouro ?? "")} span2 />
            <ReadField label="Número" value={endereco?.numero ?? ""} />
            <ReadField label="Bairro" value={titleCase(endereco?.bairro ?? "")} />
            <ReadField label="CEP" value={endereco?.cep ?? ""} />
            <ReadField label="Cidade" value={titleCase(endereco?.cidade ?? "")} />
            <ReadField label="UF" value={endereco?.uf ?? ""} />
          </Secao>

          <Secao title="Contato e vínculo">
            <ReadField label="Telefone" value={perfil.telefone} />
            <ReadField label="E-mail" value={perfil.email} span2 />
            {/* No público o rótulo vem do token (o portão repassa); no interno, da lista. */}
            <ReadField
              label="Imobiliária"
              value={publico?.imobiliariaNome || label(imobiliarias, perfil.imobiliariaId)}
            />
            {publico?.corretorNome ? (
              <ReadField label="Corretor" value={publico.corretorNome} />
            ) : null}
          </Secao>

          {conjuge ? (
            <Secao title="Cônjuge">
              <ReadField label="Nome" value={titleCase(conjuge.nome)} span2 />
              <ReadField label="CPF" value={conjuge.cpf} />
              <ReadField label="Nascimento" value={formatDateBR(conjuge.dataNascimento)} />
              <ReadField label="Sexo" value={label(C2X_SEXO, conjuge.sexoId)} />
              <ReadField label="Escolaridade" value={label(C2X_ESCOLARIDADE, conjuge.escolaridadeId)} />
              <ReadField label="Faixa de renda" value={label(C2X_FAIXA_RENDA, conjuge.rendaId)} />
              <ReadField label="Patrimônio" value={conjuge.patrimonio} />
              <ReadField
                label="Profissão"
                value={profissaoExibida(conjuge.profissaoId, conjuge.profissaoOutro)}
              />
              <ReadField label="Telefone" value={conjuge.telefone} />
              <ReadField label="E-mail" value={conjuge.email} span2 />
            </Secao>
          ) : null}
        </>
      )}

      {erroEnvio ? (
        <p className="mt-4 rounded-lg border border-rose-200 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
          {erroEnvio}
        </p>
      ) : null}

      {/* Fecho do processo: popup sobre a ficha (fundo embaçado) confirmando o nascimento da
          entidade e entregando a CAD na mão. Fechar volta pro Apolo. */}
      {enviado ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                  <Check className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-base font-semibold text-ink">
                    {isImobiliaria
                      ? "Cadastro enviado com sucesso"
                      : modoPublico
                        ? "Cadastro do cliente enviado"
                        : "CAD enviada com sucesso"}
                  </h2>
                  <p className="m-0 mt-0.5 text-xs text-ink-muted">
                    {nomeCliente} ·{" "}
                    {isImobiliaria ? "Imobiliária" : modoPublico ? "Cliente" : "Prospect"}
                  </p>
                  <p className="m-0 text-xs text-ink-muted">
                    Enviado em {registro.data} às {registro.hora}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => {
                  // No público não há /apolo (sem login): recarrega para reiniciar o mesmo link.
                  if (modoPublico) window.location.reload();
                  else window.location.href = "/apolo";
                }}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            {/* O QUE ACONTECE AGORA: sem esta linha o corretor fica em dúvida se precisa mandar
                a ficha para alguém, e liga para a central para perguntar. */}
            {modoPublico ? (
              <p className="m-0 mt-4 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
                Pronto, você não precisa fazer mais nada. A ficha já chegou para a análise da
                Careli.
                {resultado?.autenticacao
                  ? " Se precisar falar com a central sobre este cliente, informe o código abaixo."
                  : ""}
              </p>
            ) : null}

            {resultado?.autenticacao ? (
              <div className="mt-4 rounded-lg border border-line bg-subtle px-3 py-2">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Código de autenticação
                </p>
                <p className="m-0 mt-0.5 font-mono text-sm font-semibold text-ink">
                  {resultado.autenticacao}
                </p>
              </div>
            ) : null}

            {resultado?.savedDocs.length ? (
              <p className="m-0 mt-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
                {resultado.savedDocs.length}{" "}
                {resultado.savedDocs.length === 1
                  ? "arquivo foi salvo junto com a ficha."
                  : "arquivos foram salvos junto com a ficha."}
              </p>
            ) : null}

            {resultado?.warnings.length ? (
              <p className="m-0 mt-2 rounded-lg bg-amber-50 dark:bg-amber-500/12 px-3 py-2 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                Revisar: {resultado.warnings.join(" · ")}
              </p>
            ) : null}

            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={!resultado?.cadBase64}
                onClick={() => {
                  // Baixa exatamente o PDF que o servidor gerou e guardou (com o código).
                  if (resultado?.cadBase64) {
                    baixarCadBase64(resultado.cadBase64, `${cadTitulo}.pdf`);
                  }
                }}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-50"
              >
                <Download className="size-4" aria-hidden="true" />
                {isImobiliaria ? "Baixar cadastro" : modoPublico ? "Baixar em PDF" : "Baixar CAD"}
              </button>
              <a
                href={modoPublico ? undefined : "/apolo/cadastro"}
                onClick={
                  // Público: "Novo cadastro" recarrega o mesmo link (não existe /apolo sem login).
                  modoPublico
                    ? (event) => {
                        event.preventDefault();
                        window.location.reload();
                      }
                    : undefined
                }
                className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink-soft transition-colors hover:bg-subtle"
              >
                {modoPublico && !isImobiliaria ? "Cadastrar outro cliente" : "Novo cadastro"}
              </a>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft hover:bg-subtle"
        >
          Voltar
        </button>
        {enviado ? null : (
          <div className="flex flex-col items-end gap-1.5">
            {/* O que ainda falta anexar. Some quando está tudo presente (podeEnviar). */}
            {podeEnviar ? null : (
              <p className="m-0 text-right text-xs font-medium text-amber-700 dark:text-amber-300">
                Ainda falta anexar: {juntarPtBr(faltando)}
              </p>
            )}
            <button
              type="button"
              disabled={enviando || !podeEnviar}
              title={podeEnviar ? undefined : `Anexe ${juntarPtBr(faltando)} para enviar.`}
              onClick={() => void enviar()}
              className={`inline-flex h-9 items-center gap-2 rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-60 ${
                enviando ? "disabled:cursor-wait" : "disabled:cursor-not-allowed"
              }`}
            >
              {enviando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              {enviando ? "Enviando" : modoPublico ? "Enviar para a Careli" : "Enviar"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- campos ----------

// Campo que o DOCUMENTO deveria trazer (naturalidade, nome da mãe, nacionalidade): quando a leitura
// entregou, fica travado (é dado do documento, não se digita por cima); quando NÃO entregou, abre
// para digitar — a regra do v1.105.0, a leitura nunca trava o cadastro.
//
// ⚠️ POR QUE UM COMPONENTE, e não o ternário `valor ? ReadField : TextField` que estava aqui: aquele
// ternário decidia pelo VALOR ATUAL, então bastava digitar a PRIMEIRA LETRA para o campo virar
// travado e o input sumir da tela. O operador não conseguia terminar de escrever, e no caso da
// naturalidade (que passou a barrar o avanço) isso trancava o cadastro inteiro. Aqui a decisão é
// tomada UMA VEZ, na montagem: quem nasceu vazio continua digitável enquanto a pessoa escreve.
function CampoDoDocumento({
  cidade,
  label,
  onChange,
  placeholder,
  value,
}: {
  // Naturalidade é uma CIDADE: quando o documento não trouxe e o operador precisa digitar, ele
  // digita com sugestão em vez de escrever à mão (é assim que nascem "NAO INFORMADO", com 569
  // ocorrências, e "Bh" em vez de "Belo Horizonte").
  cidade?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [veioDoDocumento] = useState(() => Boolean(value.trim()));
  if (veioDoDocumento) return <ReadField label={label} value={titleCase(value)} />;
  return (
    <TextField
      cidade={cidade}
      editavel
      label={label}
      onChange={onChange}
      placeholder={placeholder}
      value={value}
    />
  );
}

function ReadField({
  label,
  span2 = false,
  value,
}: {
  label: string;
  span2?: boolean;
  value: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-subtle px-3 py-2 ${
        span2 ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        <Lock className="size-2.5" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-0.5 min-h-[1.25rem] break-words text-sm text-ink">
        {value || <span className="text-ink-muted">—</span>}
      </div>
    </div>
  );
}

function SelectField({
  hint,
  label,
  onChange,
  options,
  value,
}: {
  hint?: string;
  label: string;
  onChange: (value: string) => void;
  options: C2xOption[];
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {hint ? <span className="text-[10px] text-[#A07C3B]">{hint}</span> : null}
      </div>
      {/* O popup do <select> e desenhado pelo browser: com bg-transparent ele cai no branco
          padrao e a <option> herda o text-ink claro do dark -> texto ilegivel. Por isso o
          fundo e a cor das opcoes vao explicitos aqui (o color-scheme global cuida do resto). */}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 w-full bg-surface text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
      >
        <option value="">Selecione…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  cidade,
  editavel,
  label,
  onChange,
  placeholder,
  value,
}: {
  // Liga a sugestão de CIDADE (naturalidade, cidade do endereço): digita e a lista mostra os
  // municípios, com a UF ao lado. Ver `CampoCidade`.
  cidade?: boolean;
  // Mostra o selo "editável" (lápis), o mesmo do telefone: sinaliza campo que o operador digita.
  editavel?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        {editavel ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#A07C3B]">
            <Pencil aria-hidden="true" className="size-2.5" />
            editável
          </span>
        ) : null}
      </div>
      {cidade ? (
        <CampoCidade
          className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          onChange={onChange}
          placeholder={placeholder}
          valor={value}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      )}
    </div>
  );
}

// Endereço editável com CEP-first: o operador digita o CEP e logradouro/bairro/cidade/UF vêm do
// ViaCEP. É o fallback pro comprovante que a MOST não leu (foto ruim/girada) — o documento fica
// salvo e o endereço se completa na mão sem digitar tudo.
function EnderecoEditavel({
  endereco,
  onChange,
}: {
  endereco: Endereco;
  onChange: (patch: Partial<Endereco>) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  // Guarda o último CEP já consultado, para o preenchimento automático rodar UMA vez por CEP e não
  // ficar reescrevendo por cima do que o operador corrigiu à mão.
  const cepConsultado = useRef<string>("");

  async function aoMudarCep(valor: string) {
    onChange({ cep: valor });
    if (soDigitos(valor).length !== 8) return;
    cepConsultado.current = soDigitos(valor);
    setBuscando(true);
    const achado = await buscarEnderecoPorCep(valor);
    setBuscando(false);
    if (achado) {
      onChange({
        bairro: achado.bairro || endereco.bairro,
        cidade: achado.cidade || endereco.cidade,
        logradouro: achado.logradouro || endereco.logradouro,
        uf: achado.uf || endereco.uf,
      });
    }
  }

  // QUANDO O CEP VEM DA LEITURA DO DOCUMENTO (o operador não digitou nada), `aoMudarCep` nunca roda
  // e o endereço fica exatamente como o OCR leu. Em comprovante de baixa confiança isso trazia o
  // rótulo de outro campo no lugar da rua (caso real: logradouro veio "CPF/CNPJ:."). Aqui a busca
  // pelo CEP é disparada mesmo assim.
  //
  // O logradouro dos Correios ganha do lido SÓ quando o CEP é de rua específica (aí `logradouro`
  // vem preenchido na resposta); em CEP geral de cidade a resposta vem sem rua e o que o documento
  // trouxe é preservado. Bairro, cidade e UF só preenchem o que estiver vazio.
  useEffect(() => {
    const cep = soDigitos(endereco.cep);
    if (cep.length !== 8 || cepConsultado.current === cep) return;
    cepConsultado.current = cep;
    let cancelado = false;
    void (async () => {
      setBuscando(true);
      const achado = await buscarEnderecoPorCep(cep);
      if (cancelado) return;
      setBuscando(false);
      if (!achado) return;
      onChange({
        bairro: endereco.bairro || achado.bairro,
        cidade: endereco.cidade || achado.cidade,
        logradouro: achado.logradouro || endereco.logradouro,
        uf: endereco.uf || achado.uf,
      });
    })();
    return () => {
      cancelado = true;
    };
    // Só o CEP dispara: incluir os demais campos faria o efeito correr a cada tecla do operador.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endereco.cep]);

  return (
    <Secao title="Endereço">
      <div className="relative">
        <TextField label="CEP" placeholder="00000-000" value={endereco.cep} onChange={aoMudarCep} />
        {buscando ? (
          <Loader2
            className="absolute right-3 top-3 size-4 animate-spin text-ink-muted"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <TextField
        label="Número"
        value={endereco.numero}
        onChange={(v) => onChange({ numero: v })}
      />
      <TextField
        label="Complemento"
        value={endereco.complemento}
        onChange={(v) => onChange({ complemento: v })}
      />
      <div className="sm:col-span-2">
        <TextField
          label="Logradouro"
          value={endereco.logradouro}
          onChange={(v) => onChange({ logradouro: v })}
        />
      </div>
      <TextField label="Bairro" value={endereco.bairro} onChange={(v) => onChange({ bairro: v })} />
      <TextField label="Cidade" value={endereco.cidade} onChange={(v) => onChange({ cidade: v })} />
      <TextField label="UF" value={endereco.uf} onChange={(v) => onChange({ uf: v })} />
    </Secao>
  );
}

// Combobox com busca (profissão: 234 opções do C2X).
//
// SAÍDA DE TEXTO LIVRE (`aoDigitarOutro`) — habilitada SÓ na profissão. As demais listas (sexo,
// escolaridade, renda, imobiliária, corretor…) continuam fechadas no catálogo: ali um valor fora da
// lista não tem para onde ir. Ver lib/apolo/profissao.ts para o porquê do campo separado.
//
// Digitou algo que não está na lista? A última linha do dropdown oferece usar o texto como está.
// O texto vai para `valorOutro`, `value` fica VAZIO (nada de texto dentro do id da FK) e o campo
// passa a mostrar o que foi digitado com a marca "a padronizar". Escolher da lista desfaz.
function SearchableSelect({
  aoDigitarOutro,
  label,
  onChange,
  options,
  placeholder,
  value,
  valorOutro = "",
}: {
  aoDigitarOutro?: (value: string) => void;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string;
  valorOutro?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id.toString() === value);
  const q = normalizeSearch(query);
  const filtered = (q
    ? options.filter((option) => normalizeSearch(option.label).includes(q))
    : options
  ).slice(0, 60);
  // Texto livre em vigor: só quando NÃO há escolha de lista (a lista sempre ganha).
  const livre = aoDigitarOutro && !selected ? normalizarProfissaoLivre(valorOutro) : "";
  const digitado = normalizarProfissaoLivre(query);
  // Digitou o nome exato de uma profissão do catálogo? Então não é "outro": é ela mesma, escrita de
  // outro jeito — e vira id, para a validação não receber pendência inventada.
  const idExato = aoDigitarOutro ? casarProfissaoNaLista(digitado) : "";
  // Há texto para aproveitar (mesmo que ele case com a lista). É o que impede o gesto mais provável
  // do corretor — digitar e clicar no próximo campo — de jogar fora o que ele escreveu.
  const temDigitado = Boolean(aoDigitarOutro && digitado);
  // A FAIXA "Não encontrou?" só aparece quando o digitado NÃO está no catálogo: com o item idêntico
  // listado logo acima, ela oferecia como "fora da lista" justamente o que está na lista.
  const podeUsarDigitado = temDigitado && !idExato;

  const escolher = (id: string) => {
    onChange(id);
    // Escolheu da lista: o texto livre deixa de valer (a padronização é justamente esta).
    aoDigitarOutro?.("");
    setOpen(false);
  };

  const usarDigitado = () => {
    if (!digitado) return;
    if (idExato) {
      escolher(idExato);
      return;
    }
    onChange("");
    aoDigitarOutro?.(digitado);
    setOpen(false);
  };

  // Fechar o dropdown NÃO pode descartar o que foi digitado — nem pelo clique fora, nem por Enter.
  // Sem isto, quem digitava "piloto de drone", via a lista vazia e clicava no campo seguinte perdia
  // tudo em silêncio (o clique morre no overlay) e só descobria no fim da etapa, na trava de
  // obrigatórios — que é exatamente a fricção que este campo veio eliminar.
  const fechar = () => {
    if (temDigitado && !selected) {
      usarDigitado();
      return;
    }
    setOpen(false);
  };

  // TECLADO: quem busca digitando espera confirmar com Enter. Só vira texto livre quando a busca
  // não achou NADA — com resultados na tela, Enter escolhe (o único filtrado, ou o nome exato),
  // senão "advog" viraria uma pendência inventada com "ADVOGADO(A)" logo ali.
  const aoTeclar = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (idExato) {
      escolher(idExato);
      return;
    }
    if (filtered.length === 1) {
      escolher(filtered[0]!.id.toString());
      return;
    }
    if (temDigitado && filtered.length === 0) usarDigitado();
  };

  return (
    <div className="relative rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <input
        value={open ? query : selected ? titleCase(selected.label) : livre ? titleCase(livre) : ""}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={aoTeclar}
        placeholder={placeholder}
        className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
      />
      {/* A pendência tem que ser VISÍVEL sem clicar em nada: o corretor sabe que aquilo ainda vai
          ser conferido, e a CAD sai marcada do mesmo jeito. */}
      {livre && !open ? (
        <p className="m-0 mt-1 flex items-center gap-1 text-[10px] font-medium text-[#7a5e2c] dark:text-[#d9b877]">
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
          Fora da lista — a equipe padroniza na validação.
        </p>
      ) : null}
      {open ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={fechar}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
            {/* Só a LISTA rola. A saída de texto livre fica FORA do scroll, ancorada embaixo:
                dentro dele, com 60 resultados possíveis, ela ficaria escondida justamente para
                quem tem a busca cheia de resultados e nenhum deles serve. */}
            {/* Sem a faixa embaixo (imobiliária, empreendimento, corretor) a lista fica com a
                altura de sempre: encolher todo mundo por causa de um campo era perda seca. */}
            <div className={`${aoDigitarOutro ? "max-h-48" : "max-h-56"} overflow-y-auto py-1`}>
              {filtered.length ? (
                filtered.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => escolher(option.id.toString())}
                    className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
                  >
                    {titleCase(option.label)}
                  </button>
                ))
              ) : podeUsarDigitado ? null : (
                <p className="m-0 px-3 py-2 text-xs text-ink-muted">
                  {aoDigitarOutro ? "Digite a profissão para poder usá-la." : "Nenhuma opção"}
                </p>
              )}
            </div>
            {podeUsarDigitado ? (
              <button
                type="button"
                onClick={usarDigitado}
                className="block w-full border-t border-line bg-subtle/50 px-3 py-2 text-left text-xs text-ink hover:bg-subtle"
              >
                <span className="font-semibold">Não encontrou?</span> Usar{" "}
                <span className="font-semibold">“{titleCase(digitado)}”</span>
                <span className="block text-[10px] text-ink-muted">
                  A equipe padroniza na validação da CAD.
                </span>
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Telefone internacional: seletor de país (bandeira + DDI), formatação por país
// e ícone indicando que é editável. Se o enriquecimento traz mais de um número,
// um dropdown discreto lista as opções.
function PhoneField({
  label = "Telefone",
  onChange,
  sugestoes,
  value,
}: {
  label?: string;
  onChange: (value: string) => void;
  sugestoes: string[];
  value: string;
}) {
  const [openPais, setOpenPais] = useState(false);
  const [openSug, setOpenSug] = useState(false);
  const { country, national } = parsePhone(value);
  const opcoes = sugestoes.filter(Boolean);
  const temEscolha = opcoes.length > 1;

  return (
    <div className="relative rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {label}
        </span>
        <span className="flex items-center gap-1 text-[9px] font-medium text-ink-muted">
          <Pencil className="size-2.5" aria-hidden="true" />
          editável
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => {
            setOpenPais((v) => !v);
            setOpenSug(false);
          }}
          className="flex shrink-0 items-center gap-1 rounded-md px-1 py-0.5 hover:bg-subtle"
          title={country.name}
        >
          <span className="text-sm leading-none">{country.flag}</span>
          <span className="text-xs text-ink-muted">+{country.dial}</span>
          <ChevronDown className="size-3 text-ink-muted" aria-hidden="true" />
        </button>
        <input
          inputMode="tel"
          value={applyPhoneMask(national, country.mask)}
          onChange={(event) =>
            onChange(composePhone(country, event.target.value.replace(/\D/g, "")))
          }
          onFocus={() => temEscolha && setOpenSug(true)}
          placeholder={country.mask.replace(/#/g, "0")}
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      {openPais ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpenPais(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {PHONE_COUNTRIES.map((c) => (
              <button
                key={c.iso}
                type="button"
                onClick={() => {
                  onChange(composePhone(c, national));
                  setOpenPais(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
              >
                <span className="leading-none">{c.flag}</span>
                <span className="flex-1">{c.name}</span>
                <span className="text-xs text-ink-muted">+{c.dial}</span>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {openSug && temEscolha ? (
        <>
          <button
            type="button"
            aria-label="Fechar"
            onClick={() => setOpenSug(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-line bg-surface py-1 shadow-lg">
            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Números encontrados
            </p>
            {opcoes.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  const parsed = parsePhone(item);
                  onChange(composePhone(parsed.country, parsed.national));
                  setOpenSug(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-subtle"
              >
                {item}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function EmailField({
  bloqueioMsg,
  bloquear,
  onChange,
  value,
}: {
  bloqueioMsg?: string;
  bloquear?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const touched = value.length > 0;
  const formatoOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const duplicado = Boolean(
    bloquear && value.trim().toLowerCase() === bloquear.trim().toLowerCase() && value.length > 0,
  );
  const valid = formatoOk && !duplicado;
  const mensagem = !formatoOk
    ? "Formato de e-mail inválido."
    : duplicado
      ? bloqueioMsg ?? "E-mail já utilizado."
      : "Formato válido. Enviaremos um e-mail de confirmação.";
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        E-mail
      </div>
      <div className="flex items-center gap-2">
        <Mail className="size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="email@dominio.com"
          className="mt-0.5 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
        />
        {touched ? (
          valid ? (
            <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden="true" />
          ) : (
            <X className="size-4 shrink-0 text-rose-500" aria-hidden="true" />
          )
        ) : null}
      </div>
      {touched ? (
        <p className={`mt-1 text-[11px] ${valid ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
          {mensagem}
        </p>
      ) : null}
    </div>
  );
}

function EnrichWarn({ enrich }: { enrich: Enrichment }) {
  const simulado = enrich.source === "mock";
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs print:hidden ${
        simulado
          ? "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/12 text-amber-700 dark:text-amber-300"
          : "border-line bg-subtle text-ink-muted"
      }`}
    >
      <div className="flex items-center gap-2 font-medium">
        {simulado ? (
          <AlertTriangle className="size-3.5" aria-hidden="true" />
        ) : (
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
        )}
        {simulado
          ? "Dados automáticos simulados (ambiente de teste, sem chave)."
          : "Não conseguimos completar os dados automaticamente. Preencha os campos na mão."}
      </div>
    </div>
  );
}
