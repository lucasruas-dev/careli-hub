// AS FOTOS E OS VÍDEOS DO PRODUTO — as regras, sem banco e sem tela.
//
// Lucas (16/09/2026): *"vamos subir videos, imagens dos produtos para que eles na hora que estiver
// negociando com o cliente possa mostrar essas fotos, imagens e videos, o ideal e organizar em
// miniatura (para que eles possam visualizar antes de abrir) quando abrir ter a opcao de ver em
// tela cheia"*.
//
// ⚠️ ESTE ARQUIVO É LIDO PELO NAVEGADOR E PELO SERVIDOR, e por isso não importa nada que toque
// banco. A mesma régua recusa o arquivo grande ANTES de subir (poupando a espera de um vídeo
// inteiro) e DEPOIS de subir (porque o número do navegador pode mentir). Duas réguas escritas em
// dois lugares seriam dois limites na prática, e o primeiro a divergir aceitaria no botão o que o
// servidor recusa depois do upload.
//
// ⚠️ O ESCOPO (quais empreendimentos a sessão alcança) NÃO MORA AQUI: ele depende das leituras do
// portal, e está em `arquivos-do-produto-servidor.ts`. Aqui só o que é pura forma.

/** O bucket privado criado pela migration 0169. */
export const BUCKET_DO_PRODUTO = "produto-arquivos";

export type TipoDeArquivo = "documento" | "imagem" | "video";

const MIB = 1024 * 1024;

/**
 * O teto de cada tipo, em bytes.
 *
 * ⚠️ 25 MB DE FOTO É FOLGA, NÃO ALVO: a foto de celular moderno tem de 3 a 12 MB, e a de câmera
 * profissional exportada em JPEG de qualidade máxima fica perto de 20. Passar disso é quase sempre
 * TIFF ou panorama sem compressão, que nem abre bem no celular do corretor.
 *
 * ⚠️ 500 MB DE VÍDEO É O TETO DO BUCKET (0169), e só vale se o limite GLOBAL do projeto no Supabase
 * também permitir. Um minuto de 4K do iPhone passa de 350 MB; o vídeo de apresentação editado,
 * exportado em 1080p, fica bem abaixo.
 */
export const LIMITE_EM_BYTES: Readonly<Record<TipoDeArquivo, number>> = {
  // ⚠️ 200 MB DE PDF PORQUE A APRESENTAÇÃO É FEITA DE RENDER. A do Garden Resort, que motivou o
  // tipo (22/09/2026), tem 70 páginas e 124 MB: cada página carrega uma foto de 4396x2472. Um PDF
  // de texto do mesmo tamanho não existe, e o teto do bucket (500 MB) continua sendo o do vídeo.
  documento: 200 * MIB,
  imagem: 25 * MIB,
  video: 500 * MIB,
};

export const LIMITE_ESCRITO: Readonly<Record<TipoDeArquivo, string>> = {
  documento: "200 MB",
  imagem: "25 MB",
  video: "500 MB",
};

/** A miniatura é JPEG pequeno; 2 MB já é dez vezes o que uma de 480 px ocupa. */
export const TAMANHO_MAXIMO_DA_MINIATURA = 2 * MIB;

/** O lado maior da miniatura, em px. 480 cobre a grade em tela de alta densidade sem pesar. */
export const LADO_MAIOR_DA_MINIATURA = 480;

/**
 * Os formatos aceitos — os MESMOS do `allowed_mime_types` do bucket (0169).
 *
 * ⚠️ GIF, AVI, MKV E TIFF FICAM DE FORA DE PROPÓSITO: o celular do corretor não toca AVI nem MKV, e
 * a foto que não abre na frente do cliente é pior do que a foto que não foi enviada. HEIC entra
 * porque é o que o iPhone grava; a tela sabe que o Chrome não o desenha (ver `miniatura_path`).
 */
const FORMATOS: Readonly<Record<string, { extensao: string; tipo: TipoDeArquivo }>> = {
  // ⚠️ SÓ PDF COMO DOCUMENTO, de propósito. DOCX e PPTX não abrem no navegador sem converter, e
  // uma apresentação que baixa em vez de abrir na frente do cliente é pior do que não estar lá.
  "application/pdf": { extensao: "pdf", tipo: "documento" },
  "image/heic": { extensao: "heic", tipo: "imagem" },
  "image/heif": { extensao: "heif", tipo: "imagem" },
  "image/jpeg": { extensao: "jpg", tipo: "imagem" },
  "image/png": { extensao: "png", tipo: "imagem" },
  "image/webp": { extensao: "webp", tipo: "imagem" },
  "video/mp4": { extensao: "mp4", tipo: "video" },
  "video/quicktime": { extensao: "mov", tipo: "video" },
  "video/webm": { extensao: "webm", tipo: "video" },
};

/** Extensão → MIME, para quando o navegador não diz o tipo (HEIC no Windows chega com `type` vazio). */
const PELA_EXTENSAO: Readonly<Record<string, string>> = {
  heic: "image/heic",
  pdf: "application/pdf",
  heif: "image/heif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
};

/** Apelidos que navegadores e celulares mandam para o mesmo formato. */
const APELIDOS: Readonly<Record<string, string>> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "video/x-m4v": "video/mp4",
};

function extensaoDoNome(nome: null | string | undefined): string {
  const limpo = String(nome ?? "").trim().toLowerCase();
  const ponto = limpo.lastIndexOf(".");
  if (ponto < 0 || ponto === limpo.length - 1) return "";
  return limpo.slice(ponto + 1);
}

/**
 * O MIME canônico do arquivo, ou `null` quando o formato não é aceito.
 *
 * ⚠️ O MIME DECLARADO GANHA DA EXTENSÃO quando é conhecido. A extensão só decide quando o navegador
 * não disse nada (ou disse `application/octet-stream`): é o caso do HEIC arrastado no Windows. Um
 * `.jpg` que o navegador diz ser `video/mp4` vira vídeo, porque é o MIME que o bucket confere.
 */
export function mimeDoArquivo(
  nome: null | string | undefined,
  mime: null | string | undefined,
): null | string {
  const declarado = String(mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const canonico = APELIDOS[declarado] ?? declarado;

  if (canonico && canonico !== "application/octet-stream") {
    return FORMATOS[canonico] ? canonico : null;
  }

  return PELA_EXTENSAO[extensaoDoNome(nome)] ?? null;
}

/** Imagem, vídeo ou nada (formato fora da lista). */
export function tipoDoArquivo(
  nome: null | string | undefined,
  mime: null | string | undefined,
): null | TipoDeArquivo {
  const canonico = mimeDoArquivo(nome, mime);
  return canonico ? (FORMATOS[canonico]?.tipo ?? null) : null;
}

/** A extensão que vai no caminho do bucket, derivada do MIME canônico (nunca do nome digitado). */
export function extensaoDoMime(mime: null | string | undefined): null | string {
  return FORMATOS[String(mime ?? "")]?.extensao ?? null;
}

/**
 * O nome original, limpo para EXIBIR.
 *
 * ⚠️ O NOME NUNCA VAI PARA O CAMINHO DO BUCKET (lá é `<uuid>.<ext>`), então o saneamento aqui é de
 * apresentação: tira pasta ("C:\fotos\portaria.jpg" que alguns navegadores antigos mandam),
 * caractere de controle e espaço repetido, e corta o tamanho preservando a extensão, para a
 * miniatura não ganhar um título de 400 caracteres.
 */
export function nomeSeguro(nome: null | string | undefined): string {
  const semPasta = String(nome ?? "").split(/[\\/]/).pop() ?? "";
  const limpo = semPasta
    .normalize("NFC")
    // Quebra e tabulação separam palavras: viram espaço antes de o resto do controle sumir.
    .replace(/[\t\n\v\f\r]/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!limpo || /^\.+$/.test(limpo)) return "arquivo";

  const MAXIMO = 120;
  if (limpo.length <= MAXIMO) return limpo;

  const extensao = extensaoDoNome(limpo);
  const sufixo = extensao && extensao.length <= 5 ? `.${extensao}` : "";
  return `${limpo.slice(0, MAXIMO - sufixo.length).trimEnd()}${sufixo}`;
}

export type ConferenciaDoArquivo =
  | { extensao: string; mime: string; ok: true; tipo: TipoDeArquivo }
  | { motivo: string; ok: false };

/** A régua única de aceitação: formato e tamanho. Usada no botão, no `preparar` e no `registrar`. */
export function conferirArquivoDoProduto(entrada: {
  mime: null | string | undefined;
  nome: null | string | undefined;
  tamanho: number;
}): ConferenciaDoArquivo {
  const mime = mimeDoArquivo(entrada.nome, entrada.mime);
  const formato = mime ? FORMATOS[mime] : undefined;

  if (!mime || !formato) {
    return {
      motivo: "Formato não aceito. Envie foto (JPG, PNG, WEBP, HEIC) ou vídeo (MP4, MOV, WEBM).",
      ok: false,
    };
  }

  const tamanho = Number(entrada.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0) {
    return { motivo: "O arquivo está vazio.", ok: false };
  }

  if (tamanho > LIMITE_EM_BYTES[formato.tipo]) {
    return {
      motivo:
        formato.tipo === "imagem"
          ? `Cada foto pode ter até ${LIMITE_ESCRITO.imagem}.`
          : `Cada vídeo pode ter até ${LIMITE_ESCRITO.video}.`,
      ok: false,
    };
  }

  return { extensao: formato.extensao, mime, ok: true, tipo: formato.tipo };
}

// ── O CAMINHO NO BUCKET ─────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O id pode virar pasta do bucket?
 *
 * ⚠️ SÓ ID REAL: "37", "39", ou o id de um empreendimento que só existe no Panteon. "group:…" e
 * "pai:…" ficam de fora (ATENCAO 1 da 0169), e qualquer barra ou ponto também — o id é a primeira
 * parte do caminho, e "../" nele seria gravar na pasta de outro empreendimento.
 */
export function idDeDestinoValido(id: null | string | undefined): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(id ?? ""));
}

export function uuidValido(valor: null | string | undefined): boolean {
  return UUID.test(String(valor ?? ""));
}

/** `<enterprise_id>/<uuid>.<ext>` */
export function caminhoDoArquivo(enterpriseId: string, uuid: string, extensao: string): string {
  return `${enterpriseId}/${uuid.toLowerCase()}.${extensao}`;
}

/** `<enterprise_id>/<uuid>.thumb.jpg` */
export function caminhoDaMiniatura(enterpriseId: string, uuid: string): string {
  return `${enterpriseId}/${uuid.toLowerCase()}.thumb.jpg`;
}

/**
 * Lê o caminho que VOLTOU DO NAVEGADOR no `registrar` e confere que é deste empreendimento.
 *
 * ⚠️ NO UPLOAD DIRETO O CAMINHO VOLTA DO CLIENTE, e é a superfície que o envio pela rota não tinha.
 * Sem esta conferência, um caminho forjado registraria no Garden um arquivo gravado na pasta do VOC,
 * e a grade confia na LINHA. Irmã de `caminhoDaUnidadeValido` (documentos da venda).
 */
export function lerCaminhoDoArquivo(
  caminho: null | string | undefined,
  enterpriseId: string,
): null | { extensao: string; mime: string; tipo: TipoDeArquivo; uuid: string } {
  if (!idDeDestinoValido(enterpriseId)) return null;

  const partes = String(caminho ?? "").trim().split("/");
  if (partes.length !== 2 || partes[0] !== enterpriseId) return null;

  const arquivo = partes[1] ?? "";
  const ponto = arquivo.indexOf(".");
  if (ponto <= 0) return null;

  const uuid = arquivo.slice(0, ponto);
  const extensao = arquivo.slice(ponto + 1);
  if (!uuidValido(uuid) || uuid !== uuid.toLowerCase()) return null;

  const mime = PELA_EXTENSAO[extensao];
  // Só as extensões que `extensaoDoMime` produz: "jpeg" e "m4v" existem na tabela de leitura, mas
  // nenhum caminho nosso nasce com elas.
  if (!mime || extensaoDoMime(mime) !== extensao) return null;

  const formato = FORMATOS[mime];
  if (!formato) return null;

  return { extensao, mime, tipo: formato.tipo, uuid };
}

/** A miniatura que voltou do navegador é a DESTE arquivo (mesma pasta, mesmo uuid)? */
export function miniaturaCombina(
  miniatura: null | string | undefined,
  enterpriseId: string,
  uuid: string,
): boolean {
  if (!idDeDestinoValido(enterpriseId) || !uuidValido(uuid)) return false;
  return String(miniatura ?? "").trim() === caminhoDaMiniatura(enterpriseId, uuid);
}

// ── O DESTINO DO ENVIO ──────────────────────────────────────────────────────

/**
 * Em qual empreendimento REAL o arquivo novo é gravado.
 *
 * ⚠️ O PRODUTO ABERTO PODE COBRIR MAIS DE UM ID (o pai do Vale do Ouro com VOC, VOL e VOR, para quem
 * tem os três). Gravar "no produto" não existe: a foto mora numa divisão, e quem só tem a outra não a
 * vê. Então:
 *   • um id real só → ele (o caso do Cecílio: VOC e Garden);
 *   • vários → o que a tela escolheu, SE estiver entre eles; sem escolha, nenhum (a rota responde
 *     422 e a tela mostra o seletor). Escolher o primeiro por conta própria esconderia a foto de
 *     quem tem só a segunda divisão, sem ninguém ter decidido isso.
 */
export function destinoDoEnvio(
  idsDoProduto: string[],
  escolhido?: null | string,
): null | string {
  const reais = [
    ...new Set(idsDoProduto.map((id) => String(id ?? "").trim()).filter(idDeDestinoValido)),
  ];
  const pedido = String(escolhido ?? "").trim();

  if (pedido) return reais.includes(pedido) ? pedido : null;
  return reais.length === 1 ? (reais[0] ?? null) : null;
}

/**
 * O destino que veio no corpo do POST: o que a tela escolheu, ou, no `registrar` sem escolha, a
 * pasta do caminho. Nos dois casos o valor ainda passa por `destinoDoEnvio` (só vale se for do
 * recorte do pedido): isto só LÊ o corpo, não autoriza nada.
 */
export function destinoPedidoNoCorpo(corpo: {
  acao?: unknown;
  caminho?: unknown;
  destino?: unknown;
}): null | string {
  if (typeof corpo.destino === "string" && corpo.destino.trim()) return corpo.destino.trim();
  if (corpo.acao === "registrar" && typeof corpo.caminho === "string") {
    const pasta = corpo.caminho.trim().split("/")[0] ?? "";
    return pasta || null;
  }
  return null;
}

/**
 * Os destinos possíveis com o rótulo que a tela mostra no seletor (código do cadastro do Panteon,
 * depois o do catálogo do C2X, e o próprio id quando nenhum dos dois conhece).
 */
export function rotulosDosDestinos(
  idsDoProduto: string[],
  cadastro: ReadonlyArray<{ c2xEnterpriseId: null | string; codigo: string; nome: string }>,
  catalogo: ReadonlyArray<{ codes: string[]; stageIds: string[] }>,
): Array<{ id: string; rotulo: string }> {
  const reais = [
    ...new Set(idsDoProduto.map((id) => String(id ?? "").trim()).filter(idDeDestinoValido)),
  ];

  return reais.map((id) => {
    const doCadastro = cadastro.find((linha) => linha.c2xEnterpriseId === id);
    if (doCadastro?.codigo) {
      return { id, rotulo: `${doCadastro.codigo} · ${doCadastro.nome}` };
    }
    for (const emp of catalogo) {
      const i = emp.stageIds.findIndex((stageId) => String(stageId) === id);
      const code = i >= 0 ? emp.codes[i] : undefined;
      if (code) return { id, rotulo: code };
    }
    return { id, rotulo: id };
  });
}

// ── A LEITURA ───────────────────────────────────────────────────────────────

/**
 * A ordem da grade: a ordem manual quando existe, depois o MAIS NOVO primeiro.
 *
 * ⚠️ MAIS NOVO PRIMEIRO porque quem acabou de enviar procura o que enviou — com a ordem de chegada,
 * a foto nova iria para o fim de uma grade de 60 e pareceria que o envio falhou. A `ordem` fica
 * reservada (0169) para quando o Lucas pedir "a foto da portaria sempre primeiro".
 */
export function ordenarArquivos<T extends { criadoEm: string; id: string; ordem: null | number }>(
  lista: readonly T[],
): T[] {
  return [...lista].sort((a, b) => {
    const temA = typeof a.ordem === "number";
    const temB = typeof b.ordem === "number";
    if (temA && temB && a.ordem !== b.ordem) return (a.ordem as number) - (b.ordem as number);
    if (temA !== temB) return temA ? -1 : 1;
    if (a.criadoEm !== b.criadoEm) return a.criadoEm < b.criadoEm ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
}

/** Número inteiro positivo ou `null` (largura, altura). */
function inteiroPositivo(valor: unknown): null | number {
  const n = Math.round(Number(valor));
  return Number.isFinite(n) && n > 0 && n <= 100_000 ? n : null;
}

/**
 * Os metadados que o navegador mediu, sem confiar neles para nada além de exibir.
 *
 * ⚠️ VÊM DO CLIENTE: a rota não abre o vídeo para conferir. Por isso só entram números plausíveis, e
 * a duração só em vídeo (imagem com "duração" é lixo de um formulário forjado).
 */
export function metadadosSeguros(entrada: {
  altura?: unknown;
  duracao?: unknown;
  largura?: unknown;
  tipo: TipoDeArquivo;
}): { altura: null | number; duracaoSegundos: null | number; largura: null | number } {
  const duracao = Number(entrada.duracao);
  const duracaoValida =
    entrada.tipo === "video" && Number.isFinite(duracao) && duracao > 0 && duracao < 24 * 3600;

  return {
    altura: inteiroPositivo(entrada.altura),
    duracaoSegundos: duracaoValida ? Math.round(duracao * 100) / 100 : null,
    largura: inteiroPositivo(entrada.largura),
  };
}

/** A legenda digitada: sem controle, sem espaço sobrando, até 200 caracteres. Vazia = `null`. */
export function legendaSegura(valor: unknown): null | string {
  const limpa = String(valor ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
    .trim();
  return limpa || null;
}

// ── A TELA ──────────────────────────────────────────────────────────────────

/**
 * O tamanho da miniatura: reduz para o lado maior caber em `ladoMaior`, NUNCA amplia.
 * Foto menor que 480 px fica do tamanho dela: ampliar só gastaria bytes para borrar.
 */
export function dimensoesDaMiniatura(
  largura: number,
  altura: number,
  ladoMaior: number = LADO_MAIOR_DA_MINIATURA,
): { altura: number; largura: number } {
  const l = Number(largura);
  const a = Number(altura);
  if (!(l > 0) || !(a > 0) || !(ladoMaior > 0)) return { altura: 0, largura: 0 };

  const escala = Math.min(1, ladoMaior / Math.max(l, a));
  return {
    altura: Math.max(1, Math.round(a * escala)),
    largura: Math.max(1, Math.round(l * escala)),
  };
}

/** Em que segundo tirar o quadro do vídeo: ~1 s, ou o meio do vídeo quando ele é mais curto. */
export function momentoDoQuadro(duracao: number): number {
  const d = Number(duracao);
  if (!Number.isFinite(d) || d <= 0) return 0;
  return d > 2 ? 1 : d / 2;
}

/** "0:07", "1:05", "1:02:03". */
export function duracaoEscrita(segundos: null | number | undefined): string {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = String(total % 60).padStart(2, "0");
  return horas > 0
    ? `${horas}:${String(minutos).padStart(2, "0")}:${resto}`
    : `${minutos}:${resto}`;
}

/** "830 KB", "4,2 MB", "1,3 GB" — com vírgula, como o resto da casa. */
export function tamanhoEscrito(bytes: null | number | undefined): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < MIB) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * MIB) return `${(n / MIB).toFixed(1).replace(".", ",")} MB`;
  return `${(n / (1024 * MIB)).toFixed(1).replace(".", ",")} GB`;
}

/** "3 fotos · 1 vídeo · 1 documento" (ou "Nenhum arquivo"). */
export function resumoDaGaleria(lista: ReadonlyArray<{ tipo: TipoDeArquivo }>): string {
  const fotos = lista.filter((item) => item.tipo === "imagem").length;
  const videos = lista.filter((item) => item.tipo === "video").length;
  // ⚠️ CONTADO POR TIPO, E NÃO PELO QUE SOBRA. Enquanto eram dois tipos, "o resto é vídeo"
  // funcionava; com o documento (22/09/2026), a mesma linha passaria a chamar PDF de vídeo.
  const documentos = lista.filter((item) => item.tipo === "documento").length;
  const partes: string[] = [];
  if (fotos > 0) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
  if (videos > 0) partes.push(`${videos} ${videos === 1 ? "vídeo" : "vídeos"}`);
  if (documentos > 0) {
    partes.push(`${documentos} ${documentos === 1 ? "documento" : "documentos"}`);
  }
  return partes.length > 0 ? partes.join(" · ") : "Nenhum arquivo";
}
