/**
 * AS REGRAS DA CARGA DOS COMPRADORES DA CECÍLIO NO APOLO (02/10/2026).
 *
 * Funções puras: recebem o que o script `scripts/apolo/importar-compradores-cecilio.mjs` leu do banco
 * e devolvem o PLANO — quem entra, em que ficha, com que contatos e com que status. O script só lê,
 * mostra o plano e grava. Separado assim, cada regra abaixo tem teste (carga-comprador-cecilio.test.ts).
 *
 * Lucas, 02/10/2026: *"O principal objetivo é o time conseguir fazer contato para realizar cobrança."*
 *
 * ⚠️ A CHAVE É O CPF/CNPJ, SÓ COM DÍGITOS, E NADA MAIS. Nunca casa por nome, telefone ou e-mail: casar
 * por nome já pôs o CPF de uma pessoa no boleto de outra (reference_boletos_chave_e_a_unidade) e já
 * mostrou a carteira de uma compradora para um WhatsApp cujo único elo era o primeiro nome (incidente
 * da Lavra do Ouro, AT-000743).
 *
 * ⚠️ NÃO HÁ ÍNDICE ÚNICO DE DOCUMENTO NO APOLO (caiu na 0026). A ficha existente é procurada nas DUAS
 * pernas, `apolo_entities.document_hash` e `apolo_entity_identifiers.value_hash`, como faz
 * `fichasDoDocumento`. Insert cego duplicaria a pessoa.
 *
 * ⚠️ O C2X NÃO É FONTE NEM DESTINO. A Cecílio não tem vínculo com o legado (Lucas, 29/09/2026). Por isso
 * `metadata.source` é 'cecilio', NUNCA 'apolo': 'apolo' põe a ficha no lote de envio ao C2X
 * (c2x-write-server.ts) e no levantamento pago da MOST (enriquecer-most.ts). E a fonte nunca é gravada
 * com `source_table = 'users'`: o mapeamento do C2X filtra só por essa tabela e leria o código do LSoft
 * como usuário do legado, ou seja, outra pessoa.
 */

import { createHash } from "node:crypto";

import { telefonePadrao } from "./boletos/telefone-padrao";
import { PERFIL_COMPRADOR_CECILIO, ROTULO_COMPRADOR_CECILIO } from "./comprador-cecilio";

/** Etiqueta de tudo que a carga grava. É por ela que `--desfazer` acha o que remover, e só isso. */
export const ETIQUETA_DA_CARGA = "compradores-cecilio";

export type LinhaDeBoleto = {
  contato: string | null;
  documento: string | null;
  empreendimento: string;
  id: string;
  nome: string | null;
  unidade: string | null;
};

export type ClienteLsoft = {
  bairro: string | null;
  celular: string | null;
  cep: string | null;
  cidade: string | null;
  codigo: string;
  complemento: string | null;
  conjuge: string | null;
  cpf: string | null;
  email: string | null;
  endereco: string | null;
  escolaridade: string | null;
  estado: string | null;
  estado_civil: string | null;
  faixa_renda: string | null;
  mae: string | null;
  nacionalidade: string | null;
  nascimento: string | null;
  naturalidade: string | null;
  nome: string | null;
  nome_pai: string | null;
  numero: string | null;
  pai: string | null;
  profissao: string | null;
  regime_bens: string | null;
  rg: string | null;
  sexo: string | null;
  telefone: string | null;
};

/** Uma linha de `lsoft_carteira_por_cliente_empreendimento`. */
export type CarteiraLsoft = {
  codigo: string;
  empreendimento: string;
  parcelas_abertas: number;
};

/** Uma carteira do escopo, com o nome oficial e a chave dela em `lsoft_parcelas.empreendimento`. */
export type CarteiraDoEscopo = {
  chaveLsoft: string;
  nome: string;
  slug: string;
};

export type FichaExistente = {
  contatos: { contact_type: string; normalized_value: string | null; value: string }[];
  displayName: string;
  id: string;
  identificadores: { identifier_type: string; value_hash: string }[];
  metadata: Record<string, unknown> | null;
  perfis: string[];
  status: string;
  temEndereco: boolean;
};

export type EntradaDoPlano = {
  boletos: LinhaDeBoleto[];
  carteirasLsoft: CarteiraLsoft[];
  clientesLsoft: ClienteLsoft[];
  /** A data da carga (AAAA-MM-DD), que vai na origem gravada. */
  data: string;
  escopo: CarteiraDoEscopo[];
  /** Fichas NÃO arquivadas do Apolo, por documento (só dígitos). */
  fichasPorDocumento: Map<string, FichaExistente[]>;
  /** Hash de identificador `phone`/`email` que já existe no Apolo → as fichas que o têm. */
  identificadoresExistentes: Map<string, Set<string>>;
  /** Dígitos nacionais (DDD + número) dos telefones que já receberam o boleto com entrega confirmada. */
  telefonesEntregues: Set<string>;
};

export type ContatoPlanejado = {
  compartilhado: boolean;
  identificar: boolean;
  label: string;
  normalizado: string;
  origem: "boleto" | "lsoft";
  primario: boolean;
  status: "attention" | "pending" | "verified";
  tipo: "email" | "phone" | "whatsapp";
  valor: string;
};

export type IdentificadorPlanejado = {
  confidence_score: number;
  identifier_type: "cnpj" | "cpf" | "email" | "legacy_id" | "phone";
  is_primary: boolean;
  value_hash: string;
  value_masked: string;
};

export type FontePlanejada = {
  metadata: Record<string, unknown>;
  source_id: string;
  source_table: "boletos_documentos" | "lsoft_clientes";
};

export type UnidadePlanejada = { carteira: string; unidade: string | null };

export type PessoaPlanejada = {
  acao: "ja-carregada" | "nova" | "reaproveitar";
  cadastro: Record<string, string>;
  carteiras: string[];
  contatos: ContatoPlanejado[];
  documento: string;
  endereco: Record<string, string | null> | null;
  entityId: string;
  fontes: FontePlanejada[];
  identificadores: IdentificadorPlanejado[];
  kind: "pf" | "pj";
  nome: string;
  primaryCity: string | null;
  primaryState: string | null;
  unidades: UnidadePlanejada[];
};

export type ListasDeConferencia = {
  /** Documento com mais de uma ficha ativa no Apolo: ninguém escolhe qual é a certa por ele. */
  fichasAmbiguas: { documento: string; fichas: string[] }[];
  /** Par em que o boleto e o LSoft trocam os titulares. FORA da carga até o Lucas conferir. */
  cruzados: { documentos: [string, string]; carteiras: string[] }[];
  documentoInvalido: { carteira: string; nome: string | null; unidade: string | null }[];
  emailsCompartilhados: { documentos: string[]; email: string }[];
  /** Nome do boleto e do LSoft com o primeiro nome diferente (fora os pares cruzados). */
  nomeDiferente: { documento: string; grafia: boolean; kind: "pf" | "pj"; nomeBoleto: string; nomeLsoft: string }[];
  /** Recado no lugar do contato (ex.: "PAGA AQUI - NÃO FAZER"): não vira contato. */
  recados: { carteira: string; unidade: string | null }[];
  /** Cliente do LSoft com parcela aberta no escopo e sem CPF/CNPJ válido. */
  semDocumento: { carteiras: string[]; codigo: string; nome: string | null }[];
  telefonesCompartilhados: { documentos: string[]; outrasFichas: string[]; telefone: string }[];
  telefoneNaoReconhecido: { documento: string; origem: string; valor: string }[];
  /** Linhas de boleto com o código do LSoft no lugar da unidade (reference_boletos_chave_e_a_unidade). */
  unidadeComCodigo: { carteira: string; documento: string | null }[];
};

export type PlanoDaCarga = {
  listas: ListasDeConferencia;
  pessoas: PessoaPlanejada[];
};

// ─── utilitários ────────────────────────────────────────────────────────────────────────────────

export function soDigitos(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Igual ao `hashIdentifier` de lib/apolo/server.ts (sha256 de `apolo-identifier:<tipo>:<valor>`). */
export function hashDoIdentificador(tipo: string, valor: string): string {
  return createHash("sha256")
    .update(`apolo-identifier:${tipo}:${valor.trim().toLowerCase()}`)
    .digest("hex");
}

/** Igual ao `deterministicUuid` de lib/apolo/server.ts. O script confere contra uma ficha real do C2X. */
export function uuidDeterministico(semente: string): string {
  const chars = createHash("sha1").update(semente).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = (8 + (Number.parseInt(chars[16] ?? "0", 16) % 4)).toString(16);
  const hex = chars.join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join("-");
}

export function cpfValido(digitos: string): boolean {
  if (!/^\d{11}$/.test(digitos) || /^(\d)\1{10}$/.test(digitos)) return false;
  const dv = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((acc, d, i) => acc + Number(d) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(digitos.slice(0, 9), 10) === Number(digitos[9]) && dv(digitos.slice(0, 10), 11) === Number(digitos[10]);
}

export function cnpjValido(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos) || /^(\d)\1{13}$/.test(digitos)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = [...base].reduce((acc, d, i) => acc + Number(d) * (pesos[i] ?? 0), 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  return dv(digitos.slice(0, 12)) === Number(digitos[12]) && dv(digitos.slice(0, 13)) === Number(digitos[13]);
}

/** O tipo do documento quando ele é VÁLIDO (dígito verificador conferido); `null` caso contrário. */
export function tipoDoDocumento(digitos: string): "cnpj" | "cpf" | null {
  if (cpfValido(digitos)) return "cpf";
  if (cnpjValido(digitos)) return "cnpj";
  return null;
}

export function documentoFormatado(digitos: string): string {
  if (digitos.length === 11) return digitos.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  return digitos.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function documentoMascarado(digitos: string): string {
  return digitos.length === 11
    ? `***.***.***-${digitos.slice(-2)}`
    : `**.***.***/****-${digitos.slice(-2)}`;
}

/** Sem acento, maiúsculas, pontuação virando espaço. Dois nomes só são "o mesmo" se ficarem idênticos. */
export function nomeNormalizado(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function primeiroNome(valor: unknown): string {
  return nomeNormalizado(valor).split(" ")[0] ?? "";
}

const CONECTIVOS = new Set(["DA", "DAS", "DE", "DO", "DOS", "E"]);

function palavras(valor: unknown): string[] {
  return nomeNormalizado(valor).split(" ").filter((p) => p && !CONECTIVOS.has(p));
}

/**
 * Os dois nomes são, provavelmente, a mesma pessoa escrita de outro jeito? Mesmo primeiro nome, e
 * todas as palavras do mais curto presentes no mais longo: o boleto ABREVIA ("CELSO BRANDÃO"
 * contra "CELSO BRANDAO DE ARAUJO", nomes inventados). Serve só para detectar o par cruzado — nunca para casar.
 */
export function mesmaPessoaProvavel(a: unknown, b: unknown): boolean {
  const pa = palavras(a);
  const pb = palavras(b);
  if (!pa.length || !pb.length || pa[0] !== pb[0]) return false;
  const [curto, longo] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  return curto.every((p) => longo.includes(p));
}

/**
 * Só a GRAFIA do primeiro nome muda ("TIAGO"/"THIAGO", "ANA"/"ANNA"), e o resto do nome é
 * igual. É a mesma pessoa com erro de digitação: o telefone do boleto não fica em atenção por isso.
 *
 * ⚠️ AS DUAS TRAVAS SÃO DE PROPÓSITO: o resto do nome tem de ter pelo menos DUAS palavras iguais
 * ("MARIA DA SILVA" e "JOSE DA SILVA" só dividem "SILVA", e são pessoas diferentes), e o primeiro nome
 * pode diferir em no máximo DUAS letras. Na dúvida, o telefone fica em atenção, que é o lado seguro.
 */
export function soAGrafiaMuda(a: unknown, b: unknown): boolean {
  const pa = palavras(a);
  const pb = palavras(b);
  return (
    pa.length >= 3 &&
    pa.length === pb.length &&
    pa.slice(1).join(" ") === pb.slice(1).join(" ") &&
    distancia(pa[0] ?? "", pb[0] ?? "") <= 2
  );
}

/** Distância de edição (Levenshtein) entre duas palavras curtas. */
function distancia(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    for (let j = 1; j <= b.length; j += 1) {
      atual[j] = Math.min((anterior[j] ?? 0) + 1, (atual[j - 1] ?? 0) + 1, (anterior[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[b.length] ?? 0;
}

function texto(valor: unknown): string | null {
  const t = String(valor ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
}

function textoDeBusca(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * As formas do mesmo telefone que a Iris tenta na hora de casar o WhatsApp
 * (app/api/iris/apolo/phone-match/route.ts, `buildBrazilPhoneVariants`). A checagem de colisão com
 * fichas que já existem usa as MESMAS, senão um número gravado com DDI passaria por livre.
 */
export function variantesDoTelefone(valor: string): string[] {
  const digitos = soDigitos(valor);
  const variantes = new Set<string>();
  if (digitos.length >= 8) variantes.add(digitos);
  const nacional = digitos.startsWith("55") ? digitos.slice(2) : digitos;
  if (nacional.length >= 8) {
    variantes.add(nacional);
    variantes.add(`55${nacional}`);
  }
  if (nacional.length === 11 && nacional[2] === "9") {
    const semNono = `${nacional.slice(0, 2)}${nacional.slice(3)}`;
    variantes.add(semNono);
    variantes.add(`55${semNono}`);
  }
  if (nacional.length === 10) {
    const comNono = `${nacional.slice(0, 2)}9${nacional.slice(2)}`;
    variantes.add(comNono);
    variantes.add(`55${comNono}`);
  }
  return [...variantes].filter((v) => v.length >= 8);
}

export type ContatoLido =
  | { tipo: "email"; valor: string }
  | { tipo: "recado"; valor: string }
  | { normalizado: string; tipo: "telefone"; valor: string }
  | { tipo: "nao-reconhecido"; valor: string }
  | { tipo: "vazio" };

/**
 * O que está escrito num campo de contato. O campo `contato` do boleto às vezes é e-mail, às vezes
 * vazio, e no Ed. Rubi é o RECADO de bloqueio ("PAGA AQUI - NÃO FAZER"): recado não vira contato.
 * O telefone passa pela regra de produção (`telefonePadrao`), que põe o nono dígito no celular antigo
 * e deixa o fixo como está.
 */
export function lerContato(bruto: unknown): ContatoLido {
  const valor = String(bruto ?? "").trim();
  if (!valor) return { tipo: "vazio" };
  if (valor.includes("@")) {
    const email = valor.toLowerCase().replace(/\s+/g, "");
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { tipo: "email", valor: email } : { tipo: "nao-reconhecido", valor };
  }
  const digitos = soDigitos(valor);
  if (digitos.length < 8) return { tipo: "recado", valor };
  const padrao = telefonePadrao(valor);
  if (!padrao || !/^\(\d{2}\) \d{4,5}-\d{4}$/.test(padrao)) return { tipo: "nao-reconhecido", valor };
  return { normalizado: soDigitos(padrao), tipo: "telefone", valor: padrao };
}

/** Normaliza um valor de contato gravado no Apolo para comparar: dígitos sem DDI, ou e-mail minúsculo. */
function chaveDeContatoGravado(contato: { normalized_value: string | null; value: string }): string {
  const bruto = contato.value ?? "";
  if (bruto.includes("@")) return bruto.trim().toLowerCase();
  const d = soDigitos(contato.normalized_value && /^\d+$/.test(contato.normalized_value) ? contato.normalized_value : bruto);
  return d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : d;
}

// ─── o plano ────────────────────────────────────────────────────────────────────────────────────

type Pessoa = {
  boletos: LinhaDeBoleto[];
  carteirasLsoft: string[];
  documento: string;
  kind: "pf" | "pj";
  lsoft: ClienteLsoft[];
};

export function montarPlano(entrada: EntradaDoPlano): PlanoDaCarga {
  const listas: ListasDeConferencia = {
    cruzados: [],
    documentoInvalido: [],
    emailsCompartilhados: [],
    fichasAmbiguas: [],
    nomeDiferente: [],
    recados: [],
    semDocumento: [],
    telefoneNaoReconhecido: [],
    telefonesCompartilhados: [],
    unidadeComCodigo: [],
  };
  const porSlug = new Map(entrada.escopo.map((c) => [c.slug, c]));
  const porChaveLsoft = new Map(entrada.escopo.map((c) => [c.chaveLsoft, c]));
  const pessoas = new Map<string, Pessoa>();
  const pessoa = (documento: string, kind: "pf" | "pj") => {
    let p = pessoas.get(documento);
    if (!p) {
      p = { boletos: [], carteirasLsoft: [], documento, kind, lsoft: [] };
      pessoas.set(documento, p);
    }
    return p;
  };

  // 1. Boletos do escopo. As carteiras de teste ficam fora porque não estão no escopo.
  for (const linha of entrada.boletos) {
    const carteira = porSlug.get(linha.empreendimento);
    if (!carteira) continue;
    if (/^\d{8}$/.test(String(linha.unidade ?? "").trim())) {
      listas.unidadeComCodigo.push({ carteira: carteira.nome, documento: soDigitos(linha.documento) || null });
      continue;
    }
    const documento = soDigitos(linha.documento);
    const kind = tipoDoDocumento(documento);
    if (!kind) {
      listas.documentoInvalido.push({ carteira: carteira.nome, nome: texto(linha.nome), unidade: texto(linha.unidade) });
      continue;
    }
    pessoa(documento, kind === "cpf" ? "pf" : "pj").boletos.push(linha);
  }

  // 2. LSoft: quem tem parcela ABERTA numa carteira do escopo. O LSoft não é a régua de quem deve (a
  // baixa atrasa); é só o filtro de quem ainda tem relação ativa com a carteira.
  const abertasPorCodigo = new Map<string, string[]>();
  for (const linha of entrada.carteirasLsoft) {
    const carteira = porChaveLsoft.get(linha.empreendimento);
    if (!carteira || !(Number(linha.parcelas_abertas) > 0)) continue;
    const atual = abertasPorCodigo.get(linha.codigo) ?? [];
    if (!atual.includes(carteira.nome)) atual.push(carteira.nome);
    abertasPorCodigo.set(linha.codigo, atual);
  }
  const lsoftPorDocumento = new Map<string, ClienteLsoft[]>();
  for (const cliente of entrada.clientesLsoft) {
    const documento = soDigitos(cliente.cpf);
    const kind = tipoDoDocumento(documento);
    const abertas = abertasPorCodigo.get(cliente.codigo) ?? [];
    if (!kind) {
      if (abertas.length) listas.semDocumento.push({ carteiras: abertas, codigo: cliente.codigo, nome: texto(cliente.nome) });
      continue;
    }
    lsoftPorDocumento.set(documento, [...(lsoftPorDocumento.get(documento) ?? []), cliente]);
    // Entra quem tem parcela aberta no escopo; quem já entrou pelo boleto ganha o cadastro do LSoft.
    if (abertas.length || pessoas.has(documento)) {
      const p = pessoa(documento, kind === "cpf" ? "pf" : "pj");
      p.lsoft.push(cliente);
      for (const nome of abertas) if (!p.carteirasLsoft.includes(nome)) p.carteirasLsoft.push(nome);
    }
  }

  // 3. Nome do boleto contra o do LSoft. O par CRUZADO (o documento A no boleto com o nome de B, e o B
  // com o nome de A) sai da carga: casando por CPF, a cobrança ligaria para a pessoa errada.
  const nomeBoleto = (p: Pessoa) => texto(p.boletos.find((b) => texto(b.nome))?.nome);
  const nomeLsoft = (p: Pessoa) => texto(p.lsoft.find((c) => texto(c.nome))?.nome);
  const divergentes = [...pessoas.values()].filter((p) => {
    const b = nomeBoleto(p);
    const l = nomeLsoft(p);
    return b && l && primeiroNome(b) !== primeiroNome(l);
  });
  const fora = new Set<string>();
  for (const a of divergentes) {
    for (const b of divergentes) {
      if (a.documento >= b.documento) continue;
      // O boleto abrevia o nome, então a comparação é "mesma pessoa provável", e não igualdade.
      if (mesmaPessoaProvavel(nomeLsoft(a), nomeBoleto(b)) && mesmaPessoaProvavel(nomeLsoft(b), nomeBoleto(a))) {
        listas.cruzados.push({
          carteiras: [...new Set([...a.boletos, ...b.boletos].map((l) => porSlug.get(l.empreendimento)?.nome ?? l.empreendimento))],
          documentos: [a.documento, b.documento],
        });
        fora.add(a.documento);
        fora.add(b.documento);
      }
    }
  }
  const nomeDivergentePf = new Set<string>();
  for (const p of divergentes) {
    if (fora.has(p.documento)) continue;
    const grafia = soAGrafiaMuda(nomeBoleto(p), nomeLsoft(p));
    listas.nomeDiferente.push({ documento: p.documento, grafia, kind: p.kind, nomeBoleto: nomeBoleto(p) ?? "", nomeLsoft: nomeLsoft(p) ?? "" });
    if (p.kind === "pf" && !grafia) nomeDivergentePf.add(p.documento);
  }

  // 4. A ficha de cada pessoa. Mais de uma ativa para o mesmo documento: fica fora, e a lista diz quais.
  type Destino = { acao: PessoaPlanejada["acao"]; entityId: string; ficha: FichaExistente | null };
  const destinos = new Map<string, Destino>();
  for (const p of pessoas.values()) {
    if (fora.has(p.documento)) continue;
    const fichas = entrada.fichasPorDocumento.get(p.documento) ?? [];
    if (fichas.length > 1) {
      listas.fichasAmbiguas.push({ documento: p.documento, fichas: fichas.map((f) => f.id) });
      fora.add(p.documento);
      continue;
    }
    const ficha = fichas[0] ?? null;
    if (ficha) {
      const jaCarregada = (ficha.metadata as { carga?: unknown } | null)?.carga === ETIQUETA_DA_CARGA;
      destinos.set(p.documento, { acao: jaCarregada ? "ja-carregada" : "reaproveitar", entityId: ficha.id, ficha });
      continue;
    }
    const lsoftOrdenado = [...p.lsoft].sort((a, b) => a.codigo.localeCompare(b.codigo));
    const boletosOrdenados = [...p.boletos].sort((a, b) => a.id.localeCompare(b.id));
    const semente = lsoftOrdenado[0]
      ? `apolo:cecilio:lsoft:${lsoftOrdenado[0].codigo}`
      : `apolo:cecilio:boleto:${boletosOrdenados[0]?.id}`;
    destinos.set(p.documento, { acao: "nova", entityId: uuidDeterministico(semente), ficha: null });
  }

  // 5. Os contatos candidatos de cada pessoa, e quem divide telefone ou e-mail com quem.
  type Candidato = { label: string; normalizado: string; origem: "boleto" | "lsoft"; tipo: ContatoPlanejado["tipo"]; valor: string };
  const candidatos = new Map<string, Candidato[]>();
  const telefoneDe = new Map<string, Set<string>>();
  const emailDe = new Map<string, Set<string>>();
  for (const p of pessoas.values()) {
    const lista: Candidato[] = [];
    const add = (c: Candidato) => {
      if (lista.some((x) => x.normalizado === c.normalizado)) return;
      lista.push(c);
      const mapa = c.tipo === "email" ? emailDe : telefoneDe;
      mapa.set(c.normalizado, (mapa.get(c.normalizado) ?? new Set()).add(p.documento));
    };
    for (const b of p.boletos) {
      const lido = lerContato(b.contato);
      if (lido.tipo === "telefone") add({ label: "WhatsApp do boleto", normalizado: lido.normalizado, origem: "boleto", tipo: "whatsapp", valor: lido.valor });
      else if (lido.tipo === "email") add({ label: "E-mail do boleto", normalizado: lido.valor, origem: "boleto", tipo: "email", valor: lido.valor });
      else if (lido.tipo === "recado") listas.recados.push({ carteira: porSlug.get(b.empreendimento)?.nome ?? b.empreendimento, unidade: texto(b.unidade) });
      else if (lido.tipo === "nao-reconhecido") listas.telefoneNaoReconhecido.push({ documento: p.documento, origem: "boleto", valor: lido.valor });
    }
    for (const c of p.lsoft) {
      for (const [campo, label] of [["celular", "Celular (LSoft)"], ["telefone", "Telefone (LSoft)"]] as const) {
        const lido = lerContato(c[campo]);
        if (lido.tipo === "telefone") add({ label, normalizado: lido.normalizado, origem: "lsoft", tipo: "phone", valor: lido.valor });
        else if (lido.tipo !== "vazio") listas.telefoneNaoReconhecido.push({ documento: p.documento, origem: `lsoft.${campo}`, valor: lido.valor });
      }
      const email = lerContato(c.email);
      if (email.tipo === "email") add({ label: "E-mail (LSoft)", normalizado: email.valor, origem: "lsoft", tipo: "email", valor: email.valor });
    }
    candidatos.set(p.documento, lista);
  }

  /** Fichas do Apolo, que NÃO são a desta pessoa, que já têm este telefone/e-mail como identificador. */
  const outrasFichasCom = (tipo: "email" | "phone", normalizado: string, destino: Destino | undefined) => {
    const hashes = tipo === "phone" ? variantesDoTelefone(normalizado).map((v) => hashDoIdentificador("phone", v)) : [hashDoIdentificador("email", normalizado)];
    const outras = new Set<string>();
    for (const h of hashes) for (const id of entrada.identificadoresExistentes.get(h) ?? []) if (id !== destino?.entityId) outras.add(id);
    return [...outras];
  };

  for (const [telefone, docs] of telefoneDe) {
    const outras = new Set<string>();
    for (const d of docs) for (const id of outrasFichasCom("phone", telefone, destinos.get(d))) outras.add(id);
    if (docs.size > 1 || outras.size) listas.telefonesCompartilhados.push({ documentos: [...docs], outrasFichas: [...outras], telefone });
  }
  for (const [email, docs] of emailDe) {
    if (docs.size > 1) listas.emailsCompartilhados.push({ documentos: [...docs], email });
  }

  // 6. O plano de cada pessoa.
  const resultado: PessoaPlanejada[] = [];
  for (const p of pessoas.values()) {
    const destino = destinos.get(p.documento);
    if (!destino || fora.has(p.documento)) continue;
    const ficha = destino.ficha;
    const lsoft = [...p.lsoft].sort((a, b) => a.codigo.localeCompare(b.codigo))[0] ?? null;
    const nome = texto(lsoft?.nome) ?? nomeBoleto(p) ?? "Cliente Cecílio";

    const jaGravados = new Set((ficha?.contatos ?? []).map(chaveDeContatoGravado));
    const contatos: ContatoPlanejado[] = [];
    let temWhatsappPrimario = (ficha?.contatos ?? []).some((c) => c.contact_type === "whatsapp");
    for (const c of candidatos.get(p.documento) ?? []) {
      if (jaGravados.has(c.normalizado)) continue;
      const tipoId = c.tipo === "email" ? "email" : "phone";
      const compartilhado =
        (tipoId === "phone" ? (telefoneDe.get(c.normalizado)?.size ?? 0) : (emailDe.get(c.normalizado)?.size ?? 0)) > 1 ||
        outrasFichasCom(tipoId, c.normalizado, destino).length > 0;
      // O telefone do boleto de quem tem nome divergente pode ser de outra pessoa (cônjuge, parente).
      const duvidoso = compartilhado || (c.origem === "boleto" && nomeDivergentePf.has(p.documento));
      const primario = c.tipo === "whatsapp" && !temWhatsappPrimario;
      if (primario) temWhatsappPrimario = true;
      contatos.push({
        compartilhado,
        identificar: !duvidoso,
        label: c.label,
        normalizado: c.normalizado,
        origem: c.origem,
        primario,
        status: duvidoso
          ? "attention"
          : c.tipo === "whatsapp" && entrada.telefonesEntregues.has(c.normalizado)
            ? "verified"
            : "pending",
        tipo: c.tipo,
        valor: c.valor,
      });
    }

    const docTipo = p.kind === "pf" ? "cpf" : "cnpj";
    const idsGravados = new Set((ficha?.identificadores ?? []).map((i) => `${i.identifier_type}:${i.value_hash}`));
    const identificadores: IdentificadorPlanejado[] = [];
    const addId = (id: IdentificadorPlanejado) => {
      if (idsGravados.has(`${id.identifier_type}:${id.value_hash}`)) return;
      if (identificadores.some((x) => x.identifier_type === id.identifier_type && x.value_hash === id.value_hash)) return;
      identificadores.push(id);
    };
    addId({ confidence_score: 90, identifier_type: docTipo, is_primary: true, value_hash: hashDoIdentificador(docTipo, p.documento), value_masked: documentoMascarado(p.documento) });
    for (const c of contatos) {
      if (!c.identificar) continue;
      if (c.tipo === "email") {
        addId({ confidence_score: 80, identifier_type: "email", is_primary: false, value_hash: hashDoIdentificador("email", c.normalizado), value_masked: `${c.normalizado.slice(0, 1)}***@${c.normalizado.split("@")[1] ?? ""}` });
      } else {
        addId({ confidence_score: 80, identifier_type: "phone", is_primary: false, value_hash: hashDoIdentificador("phone", c.normalizado), value_masked: `(**) *****-**${c.normalizado.slice(-2)}` });
      }
    }
    for (const c of p.lsoft) {
      addId({ confidence_score: 100, identifier_type: "legacy_id", is_primary: false, value_hash: hashDoIdentificador("legacy_id", c.codigo), value_masked: c.codigo });
    }

    // Unidades: só do BOLETO. Quem só está no LSoft entra com a carteira e sem unidade (o LSoft não
    // guarda a unidade de forma confiável, e no Garden guarda o lote ANTIGO).
    const unidades: UnidadePlanejada[] = [];
    for (const b of p.boletos) {
      const carteira = porSlug.get(b.empreendimento)?.nome ?? b.empreendimento;
      const unidade = texto(b.unidade);
      if (!unidades.some((u) => u.carteira === carteira && u.unidade === unidade)) unidades.push({ carteira, unidade });
    }
    for (const carteira of p.carteirasLsoft) {
      if (!unidades.some((u) => u.carteira === carteira)) unidades.push({ carteira, unidade: null });
    }
    const carteiras = [...new Set(unidades.map((u) => u.carteira))];

    const fontes: FontePlanejada[] = [
      ...p.lsoft.map((c) => ({ metadata: { carga: ETIQUETA_DA_CARGA }, source_id: c.codigo, source_table: "lsoft_clientes" as const })),
      ...p.boletos.map((b) => ({
        metadata: { carga: ETIQUETA_DA_CARGA, carteira: porSlug.get(b.empreendimento)?.nome ?? b.empreendimento, unidade: texto(b.unidade) },
        source_id: b.id,
        source_table: "boletos_documentos" as const,
      })),
    ];

    const temEnderecoLsoft = lsoft && (texto(lsoft.endereco) || texto(lsoft.cep) || texto(lsoft.cidade));
    const endereco =
      temEnderecoLsoft && !ficha?.temEndereco
        ? {
            city: texto(lsoft.cidade),
            complement: texto(lsoft.complemento),
            district: texto(lsoft.bairro),
            number: texto(lsoft.numero),
            postal_code: texto(lsoft.cep),
            state: texto(lsoft.estado),
            street: texto(lsoft.endereco),
          }
        : null;

    const cadastro: Record<string, string> = {};
    if (lsoft) {
      const campos: [string, unknown][] = [
        ["dataNascimento", lsoft.nascimento],
        ["nomeMae", lsoft.mae],
        ["nomePai", lsoft.nome_pai ?? lsoft.pai],
        ["rg", lsoft.rg],
        ["sexo", lsoft.sexo],
        ["estadoCivil", lsoft.estado_civil],
        ["regimeBens", lsoft.regime_bens],
        ["escolaridade", lsoft.escolaridade],
        ["profissao", lsoft.profissao],
        ["naturalidade", lsoft.naturalidade],
        ["nacionalidade", lsoft.nacionalidade],
        ["faixaRenda", lsoft.faixa_renda],
        ["conjuge", lsoft.conjuge],
      ];
      for (const [chave, valor] of campos) {
        const t = texto(valor);
        if (t) cadastro[chave] = t;
      }
    }

    resultado.push({
      acao: destino.acao,
      cadastro,
      carteiras,
      contatos,
      documento: p.documento,
      endereco,
      entityId: destino.entityId,
      fontes,
      identificadores,
      kind: p.kind,
      nome,
      primaryCity: texto(lsoft?.cidade),
      primaryState: texto(lsoft?.estado),
      unidades,
    });
  }

  resultado.sort((a, b) => a.documento.localeCompare(b.documento));
  return { listas, pessoas: resultado };
}

// ─── as linhas que o script grava ───────────────────────────────────────────────────────────────

/** `metadata.cecilio` da ficha: o que a tela lê (`unidadesDaCarteiraCecilio`) e o rastro da carga. */
export function metadataCecilio(p: PessoaPlanejada, data: string) {
  return {
    carga: ETIQUETA_DA_CARGA,
    carteiras: p.carteiras,
    importadoEm: data,
    lsoftCodigos: p.fontes.filter((f) => f.source_table === "lsoft_clientes").map((f) => f.source_id),
    unidades: p.unidades,
  };
}

/** A linha de `apolo_entities` de uma ficha NOVA. */
export function linhaDaFichaNova(p: PessoaPlanejada, data: string) {
  return {
    display_name: p.nome,
    document_hash: hashDoIdentificador(p.kind === "pf" ? "cpf" : "cnpj", p.documento),
    document_kind: p.kind === "pf" ? "cpf" : "cnpj",
    document_masked: documentoFormatado(p.documento),
    entity_kind: p.kind,
    id: p.entityId,
    legal_name: p.kind === "pj" ? p.nome : null,
    metadata: {
      cadastro: p.cadastro,
      carga: ETIQUETA_DA_CARGA,
      cecilio: metadataCecilio(p, data),
      origem: `carteira-cecilio-${data}`,
      // ⚠️ 'cecilio', NUNCA 'apolo': ver o cabeçalho deste arquivo.
      source: "cecilio",
    },
    next_action: "Contato de cobrança (carteira Cecílio Rocha)",
    primary_city: p.primaryCity,
    primary_state: p.primaryState,
    quality_score: 50,
    // 'active', e não 'review': com 'review' e origem do Apolo a ficha cairia na fila de validação do Board.
    status: "active",
    workspace_id: "careli",
  };
}

/** A linha de `apolo_search_entries` de uma ficha NOVA. Sem ela, a busca do CRM e a da Iris não acham. */
export function linhaDeBusca(p: PessoaPlanejada) {
  const termos = [
    p.nome,
    documentoFormatado(p.documento),
    p.documento,
    p.primaryCity,
    p.primaryState,
    ROTULO_COMPRADOR_CECILIO,
    "cecilio rocha",
    ...p.carteiras,
    ...p.unidades.map((u) => u.unidade),
    ...p.contatos.map((c) => c.valor),
  ];
  return {
    display_name: p.nome,
    document_masked: documentoFormatado(p.documento),
    entity_id: p.entityId,
    entity_kind: p.kind,
    last_synced_at: new Date().toISOString(),
    location_label: [p.primaryCity, p.primaryState].filter(Boolean).join(" - ") || null,
    metadata: { carga: ETIQUETA_DA_CARGA, source: "cecilio" },
    normalized_text: textoDeBusca(termos.filter(Boolean).join(" ")),
    profile_labels: [ROTULO_COMPRADOR_CECILIO],
    quality_score: 50,
    status: "active",
  };
}

/** Os papéis: o da Cecílio sempre; PF/PJ só na ficha nova (a existente já tem o dela). */
export function perfisDaPessoa(p: PessoaPlanejada): string[] {
  return p.acao === "nova"
    ? [PERFIL_COMPRADOR_CECILIO, p.kind === "pf" ? "pessoa_fisica" : "pessoa_juridica"]
    : [PERFIL_COMPRADOR_CECILIO];
}
