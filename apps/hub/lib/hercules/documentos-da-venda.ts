// OS DOCUMENTOS E A CONVERSA DE UMA VENDA — as regras, sem banco e sem tela.
//
// Lucas (06/09/2026): *"documentos é para transitar documentos referente àquela reserva, proposta
// de forma segura e formalizada (...) os documentos têm que ser agrupados por protocolo, código. A
// proposta, bem como o contrato, boletos também podem ser guardados nessa aba"*.
//
// ⚠️ O AGRUPADOR É O PROTOCOLO, E ISSO NÃO É DETALHE DE ARRUMAÇÃO. Um lote passa por várias vendas
// — o 01 04 do Portal dos Vales teve proposta de sete clientes em quatro dias de julho/2024 —, e o
// RG do comprador que desistiu não pode aparecer misturado com o do comprador seguinte. O
// protocolo nasce na reserva e a proposta o copia, então ele é o único campo que junta o que é da
// mesma negociação sem juntar o que apenas divide o terreno.

/** Quanto o upload aceita, em bytes. */
export const TAMANHO_MAXIMO = 20 * 1024 * 1024;

/**
 * ⚠️ 20 MB, O MESMO DO APOLO E DO LSOFT — e o primeiro número que eu escrevi aqui (4 MB) era uma
 * regressão que eu mesmo me impus. O teto de 4,5 MB é do CORPO de uma função da Vercel, e só vale
 * para quem manda o arquivo POR ELA. O portal já tem o caminho certo em produção: o servidor apenas
 * ASSINA a permissão de gravar (requisição minúscula), o navegador grava os bytes DIRETO no
 * Storage, e o registro confere o tamanho real depois. Medido no Apolo: 24 documentos guardados
 * passam de 4 MB, o maior com 13,5 MB — com o limite antigo, boleto e contrato escaneado seriam
 * recusados por decisão minha, não por um limite de verdade.
 *
 * ⚠️ E O NÚMERO É O MESMO DOS VIZINHOS DE PROPÓSITO: o Apolo aceita 20, o LSoft aceita 20, e uma
 * terceira régua faria a mesma pessoa ter três limites na cabeça para o mesmo gesto.
 */
export const TAMANHO_MAXIMO_ESCRITO = "20 MB";

/** A pasta de cada unidade dentro do bucket. */
export function prefixoDaUnidade(unidadeId: string): string {
  return `hercules/documentos/${String(unidadeId ?? "").trim()}/`;
}

/**
 * O caminho que voltou do navegador é mesmo desta unidade?
 *
 * ⚠️ NO UPLOAD DIRETO O CAMINHO VOLTA DO CLIENTE — e essa é a superfície que o envio pelo servidor
 * não tinha. Sem esta conferência, um caminho forjado registra na venda A um arquivo que está na
 * pasta da venda B, e a abertura confia na LINHA: entregaria o documento errado com cara de certo.
 * É o irmão de `caminhoDoClienteValido` (LSoft) e de `caminhoUploadDiretoValido` (Apolo).
 *
 * ⚠️ E O CAMINHO É POR UNIDADE, NÃO POR PROTOCOLO. O protocolo pode nascer entre assinar e
 * registrar (a reserva vira proposta no meio), e um caminho carimbado com o protocolo velho viraria
 * uma segunda verdade sobre o mesmo arquivo. Quem agrupa é a COLUNA `protocolo_numero`.
 */
export function caminhoDaUnidadeValido(caminho: string, unidadeId: string): boolean {
  const limpo = String(caminho ?? "").trim();
  if (!limpo || limpo.includes("..")) return false;
  return limpo.startsWith(prefixoDaUnidade(unidadeId));
}

/** O que o campo aceita. PDF e imagem cobrem o que circula numa venda; o resto entra como anexo. */
const EXTENSOES = new Set([
  "doc",
  "docx",
  "heic",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "webp",
  "xls",
  "xlsx",
]);

export type TipoDeDocumento = "boleto" | "contrato" | "documento" | "proposta";

/** Como cada tipo se escreve na tela. */
export const NOME_DO_TIPO_DE_DOCUMENTO: Record<TipoDeDocumento, string> = {
  boleto: "Boleto",
  contrato: "Contrato",
  documento: "Documento",
  proposta: "Proposta",
};

/**
 * O tipo é do SISTEMA quando o papel foi gerado por ele.
 *
 * ⚠️ ISSO SEPARA O QUE VALE COMO PROVA. A proposta e o contrato saem do Panteon com número, data e
 * conteúdo que ninguém digitou; um PDF que alguém subiu com o nome "proposta.pdf" é outra coisa. Na
 * tela, os dois não podem parecer a mesma.
 */
export const GERADO_PELO_SISTEMA: ReadonlySet<string> = new Set(["boleto", "contrato", "proposta"]);

export type DocumentoDaVenda = {
  criado_em: string;
  enviado_por_nome: null | string;
  id: string;
  mime: null | string;
  nome: string;
  observacao?: null | string;
  protocolo_numero: null | number;
  tamanho_bytes: null | number;
  tipo: string;
};

export type GrupoDeDocumentos = {
  /** `000006`, ou `null` no que chegou sem protocolo. */
  codigo: null | string;
  documentos: DocumentoDaVenda[];
  protocolo: null | number;
};

/**
 * Os documentos em grupos, um por protocolo, do mais recente para o mais antigo.
 *
 * ⚠️ O GRUPO SEM PROTOCOLO VAI POR ÚLTIMO, e não some: ele é o que chegou fora de uma venda (ou
 * antes de o protocolo existir). Escondê-lo faria um documento desaparecer da tela sem que ninguém
 * tivesse apagado nada — o pior jeito de perder papel.
 */
export function agruparPorProtocolo(
  documentos: DocumentoDaVenda[],
  codigoDaVenda: (protocolo: null | number | undefined) => string,
): GrupoDeDocumentos[] {
  const grupos = new Map<string, GrupoDeDocumentos>();

  for (const doc of documentos) {
    const protocolo = typeof doc.protocolo_numero === "number" ? doc.protocolo_numero : null;
    const chave = protocolo === null ? "sem" : String(protocolo);
    const grupo = grupos.get(chave) ?? {
      codigo: protocolo === null ? null : codigoDaVenda(protocolo) || null,
      documentos: [],
      protocolo,
    };
    grupo.documentos.push(doc);
    grupos.set(chave, grupo);
  }

  return [...grupos.values()]
    .map((g) => ({
      ...g,
      // Dentro do grupo, o mais novo primeiro: é onde está o que acabou de ser trocado.
      documentos: [...g.documentos].sort((a, b) => b.criado_em.localeCompare(a.criado_em)),
    }))
    .sort((a, b) => {
      if (a.protocolo === null) return 1;
      if (b.protocolo === null) return -1;
      return b.protocolo - a.protocolo;
    });
}

/** "1,4 MB", "312 KB". Vazio quando o tamanho não veio. */
export function tamanhoEscrito(bytes: null | number | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}

/**
 * O nome do arquivo como ele vai para o storage.
 *
 * ⚠️ ACENTO E ESPAÇO QUEBRAM O CAMINHO DO BUCKET, e o erro aparece só na hora de baixar — com o
 * arquivo já gravado e o registro já criado, apontando para um lugar que não existe. Aqui o nome
 * vira ASCII simples; o nome bonito continua na coluna `nome`, que é o que a tela mostra.
 */
export function nomeSeguroDeArquivo(bruto: string): string {
  const limpo = String(bruto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return limpo.slice(0, 80) || "arquivo";
}

export type RecusaDoArquivo = { motivo: string; ok: false } | { ok: true };

/**
 * O arquivo pode entrar?
 *
 * ⚠️ A EXTENSÃO É CONFERIDA PELO NOME, E NÃO PELO `mime` DO NAVEGADOR. O tipo declarado no upload
 * vem do cliente e mente com frequência (o Safari manda `application/octet-stream` para PDF, o
 * Android manda vazio para foto). Recusar por ele barraria arquivo legítimo; a extensão é o que a
 * pessoa vê e escolheu.
 */
export function conferirArquivo(arquivo: { nome: string; tamanho: number }): RecusaDoArquivo {
  const nome = String(arquivo.nome ?? "").trim();
  if (!nome) return { motivo: "Escolha um arquivo.", ok: false };

  if (!Number.isFinite(arquivo.tamanho) || arquivo.tamanho <= 0) {
    return { motivo: "O arquivo chegou vazio. Tente de novo.", ok: false };
  }
  if (arquivo.tamanho > TAMANHO_MAXIMO) {
    return {
      motivo: `O arquivo tem ${tamanhoEscrito(arquivo.tamanho)} e o limite é ${TAMANHO_MAXIMO_ESCRITO}. Reduza o tamanho ou mande em partes.`,
      ok: false,
    };
  }

  const extensao = nome.includes(".") ? nome.split(".").pop()?.toLowerCase() : "";
  if (!extensao || !EXTENSOES.has(extensao)) {
    return {
      motivo: "Formato não aceito. Mande PDF, imagem, Word ou Excel.",
      ok: false,
    };
  }

  return { ok: true };
}

/** O tipo da mensagem no chat da venda. */
export type TipoDaMensagem = "formalizacao" | "mensagem" | "observacao";

export const NOME_DO_TIPO_DE_MENSAGEM: Record<TipoDaMensagem, string> = {
  formalizacao: "Formalização",
  mensagem: "Mensagem",
  observacao: "Observação",
};

/** O texto da mensagem, aparado. Vazio ou só espaço não vira registro. */
export function textoDaMensagem(bruto: unknown): null | string {
  const t = String(bruto ?? "").trim();
  if (t.length === 0) return null;
  // ⚠️ TETO DE 4.000, e não de banco de dados. `text` no Postgres não tem limite prático; o limite
  // é de leitura: uma "mensagem" de dez páginas na conversa da venda é um documento disfarçado, e
  // documento tem a aba dele.
  return t.slice(0, 4000);
}
