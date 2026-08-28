// LOGO DO INCORPORADOR — a marca que veste a PORTA (`/incorporador/<slug>`), antes de qualquer
// login. Duas variantes por portal: a `clara` (tema claro) e a `escura` (fundo escuro, OPCIONAL —
// sem ela o portal usa a clara nos dois temas, que é o que `Marca` em modules/incorporador/tema.tsx
// já faz quando `escuraUrl` é nulo).
//
// Pedido do Lucas (28/08/2026): *"pode colocar o campo de logo"*. Até aqui a única logo no ar
// (Cecílio Rocha) entrou por INSERT manual apontando um arquivo commitado do repo, e os outros 6
// portais ficaram sem marca porque publicar arte exigia deploy.
//
// ── POR QUE NÃO SIGNED URL ───────────────────────────────────────────────────────────────────
// O molde do repo para logo (`lib/apolo/enterprise-logos.ts`) devolve URL assinada com TTL de 1h.
// Aqui isso NÃO serve: a tela de login é pública e fica aberta a manhã inteira; quando o link
// vencesse, a porta do cliente ficaria com a imagem quebrada. Por isso a leitura passa por uma
// rota própria (`/api/incorporador/[slug]/logo`) que baixa do bucket privado e devolve os bytes.
//
// ── O FORMATO GRAVADO EM `logo_path` ─────────────────────────────────────────────────────────
// SEM coluna nova e SEM migration: a mesma coluna guarda as duas formas, e quem lê decide.
//
//   • `/marcas/cecilio-rocha.svg`  → arquivo do repo (public/), servido como asset estático.
//     É o que já está em PRODUÇÃO no Cecílio; continua valendo sem tocar em nada.
//   • `storage:incorporador-logos/<chave>/<variante>.<ext>?v=<epoch>` → objeto no bucket privado.
//     O `?v=` é só carimbo de troca: entra na URL pública para furar o cache do navegador quando
//     o operador sobe uma arte nova (o objeto no storage tem nome FIXO, upsert). Quem serve
//     ignora o `v` — ele nunca vira parte do caminho.
//
// ── A LIÇÃO DO LAGOA BONITA ──────────────────────────────────────────────────────────────────
// `chaveDaLogo` em enterprise-logos.ts existe porque quem GRAVA e quem PROCURA precisam usar a
// mesma transformação — o id `group:Lagoa Bonita` virava `group_Lagoa_Bonita` no storage e o
// consumidor procurava a chave crua, nunca achava. Aqui a chave é o slug, que já nasce
// normalizado (`normalizarSlug`), mas a transformação continua sendo UMA só e exportada.
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const LOGO_PREFIX = "incorporador-logos";

export type VarianteDaLogo = "clara" | "escura";

export const VARIANTES_DA_LOGO: VarianteDaLogo[] = ["clara", "escura"];

export function ehVarianteDaLogo(valor: unknown): valor is VarianteDaLogo {
  return valor === "clara" || valor === "escura";
}

/** As únicas extensões que podem existir no storage — e, por tabela, os únicos content-types. */
export const TIPOS_ACEITOS = {
  png: "image/png",
  svg: "image/svg+xml",
} as const;

export type ExtensaoDaLogo = keyof typeof TIPOS_ACEITOS;

// ⚠️ A Vercel corta a requisição por volta de 4,5MB (incidente conhecido: upload de CAD devolvia
// 413 sem mensagem). Logo de marca é arquivo pequeno; 2MB é folga larga e mantém o base64
// (~1,37x) em ~2,8MB, bem abaixo do teto da plataforma.
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MAX_LABEL = "2MB";
export const MENSAGEM_LOGO_GRANDE = `A logo pode ter até ${LOGO_MAX_LABEL}. Envie um arquivo menor.`;
export const MENSAGEM_LOGO_FORMATO = "A logo precisa ser SVG ou PNG.";
/** Teto do corpo em base64, conferido antes de decodificar (defesa no servidor). */
export const LOGO_MAX_BASE64 = Math.ceil((LOGO_MAX_BYTES * 4) / 3) + 1024;

/**
 * A chave do portal dentro do bucket. O slug já chega normalizado do cadastro, mas ISTO é o
 * portão: nada que não seja `[a-z0-9-]` entra na composição de caminho. Barra, `..`, `%2e` e
 * espaço morrem aqui — é o que impede a rota pública de virar proxy de outro objeto do bucket
 * (os documentos de CAD moram no MESMO bucket).
 */
export function chaveDoPortal(slug: string): string {
  return String(slug ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export type ReferenciaDeLogo =
  /** Arquivo do próprio app (`public/`). É o caso do Cecílio, em produção. */
  | { href: string; tipo: "asset" }
  /** Coluna nula/vazia — o portal cai no nome escrito. */
  | { tipo: "vazio" }
  /** Qualquer coisa que não case com as duas formas conhecidas. NUNCA vira caminho. */
  | { tipo: "invalido" }
  | {
      chave: string;
      extensao: ExtensaoDaLogo;
      /** Caminho REAL no bucket, sem query. */
      objeto: string;
      tipo: "storage";
      variante: VarianteDaLogo;
      versao: null | string;
    };

// `storage:incorporador-logos/<chave>/<variante>.<ext>` — âncoras nas duas pontas de propósito.
const RE_STORAGE = new RegExp(
  `^${LOGO_PREFIX}/([a-z0-9-]{1,60})/(clara|escura)\\.(svg|png)$`,
);

/**
 * Lê o que está gravado em `logo_path` / `logo_escura_path` e diz o que aquilo É.
 *
 * Função PURA e o coração da segurança: nenhum outro lugar do código pode montar caminho de
 * storage a partir de string do banco ou da URL — todo mundo passa por aqui.
 */
export function interpretarReferenciaDeLogo(valor: null | string | undefined): ReferenciaDeLogo {
  const bruto = String(valor ?? "").trim();
  if (!bruto) return { tipo: "vazio" };

  if (bruto.startsWith("/")) {
    // `//host` é URL protocol-relative (sairia do nosso domínio); `\` e `..` são travessia.
    if (bruto.startsWith("//") || bruto.includes("\\") || bruto.includes("..")) {
      return { tipo: "invalido" };
    }
    return { href: bruto, tipo: "asset" };
  }

  if (!bruto.startsWith("storage:")) return { tipo: "invalido" };

  const semPrefixo = bruto.slice("storage:".length);
  const corte = semPrefixo.indexOf("?");
  const caminho = corte >= 0 ? semPrefixo.slice(0, corte) : semPrefixo;
  const consulta = corte >= 0 ? semPrefixo.slice(corte + 1) : "";

  const casou = RE_STORAGE.exec(caminho);
  if (!casou) return { tipo: "invalido" };

  const [, chave, variante, extensao] = casou;
  // O carimbo é informativo; só dígitos entram, para não passar sujeira adiante na URL.
  const versao = /^v=(\d{1,20})$/.exec(consulta)?.[1] ?? null;

  return {
    chave: chave as string,
    extensao: extensao as ExtensaoDaLogo,
    objeto: caminho,
    tipo: "storage",
    variante: variante as VarianteDaLogo,
    versao,
  };
}

/** Monta a referência que vai para o banco. Único lugar que escreve o formato. */
export function montarReferenciaDeLogo(entrada: {
  extensao: ExtensaoDaLogo;
  slug: string;
  variante: VarianteDaLogo;
  versao?: number;
}): null | string {
  const chave = chaveDoPortal(entrada.slug);
  if (!chave) return null;
  const carimbo = entrada.versao ?? Date.now();
  return `storage:${LOGO_PREFIX}/${chave}/${entrada.variante}.${entrada.extensao}?v=${carimbo}`;
}

/**
 * ⚠️ O PONTO MAIS SENSÍVEL DA TAREFA. A rota `/api/incorporador/[slug]/logo` é PÚBLICA (a porta
 * ainda não tem sessão) e serve arquivo de um bucket PRIVADO onde também moram os documentos de
 * CAD. Esta função é o único caminho até um path de storage, e ela só devolve caminho quando:
 *
 *   1. a referência veio do REGISTRO daquele slug no banco (não da URL);
 *   2. o caminho casa com o padrão fechado `incorporador-logos/<chave>/<variante>.<ext>`;
 *   3. a chave do caminho é EXATAMENTE a chave do slug pedido — logo do portal A nunca sai pela
 *      porta do portal B, nem quando alguém escreve a referência errada direto no banco;
 *   4. a variante do caminho é a variante pedida.
 *
 * Falha em qualquer item = `null`, e a rota responde 404 sem contar o motivo.
 */
export function objetoDaLogoDoPortal(entrada: {
  referencia: null | string | undefined;
  slug: string;
  variante: VarianteDaLogo;
}): null | { contentType: string; objeto: string } {
  const chave = chaveDoPortal(entrada.slug);
  if (!chave) return null;

  const ref = interpretarReferenciaDeLogo(entrada.referencia);
  if (ref.tipo !== "storage") return null;
  if (ref.chave !== chave) return null;
  if (ref.variante !== entrada.variante) return null;

  return { contentType: TIPOS_ACEITOS[ref.extensao], objeto: ref.objeto };
}

/**
 * O `src` que a porta usa. Mantém o caso em produção (asset do repo) e soma o caso novo
 * (storage → rota própria). Qualquer outra coisa vira `null` e o portal mostra o nome escrito.
 */
export function resolverLogoDoPortal(entrada: {
  referencia: null | string | undefined;
  slug: string;
  variante: VarianteDaLogo;
}): null | string {
  const ref = interpretarReferenciaDeLogo(entrada.referencia);

  if (ref.tipo === "asset") return ref.href;
  if (ref.tipo !== "storage") return null;

  const chave = chaveDoPortal(entrada.slug);
  if (!chave || ref.chave !== chave || ref.variante !== entrada.variante) return null;

  const versao = ref.versao ? `&v=${ref.versao}` : "";
  return `/api/incorporador/${chave}/logo?variante=${ref.variante}${versao}`;
}

/**
 * O que o POST de gravação aceita em `logo_path`. Sem isto o banco viraria depósito de string
 * arbitrária vinda do corpo da requisição — e é essa string que a rota pública lê depois.
 * Referência de storage só passa se for do slug que está sendo salvo.
 */
export function referenciaAceitavelParaGravar(
  valor: null | string | undefined,
  slug: string,
): { erro: string; ok: false } | { ok: true; valor: null | string } {
  const ref = interpretarReferenciaDeLogo(valor);

  if (ref.tipo === "vazio") return { ok: true, valor: null };
  if (ref.tipo === "asset") return { ok: true, valor: ref.href };
  if (ref.tipo === "invalido") return { erro: "Referência de logo inválida.", ok: false };

  if (ref.chave !== chaveDoPortal(slug)) {
    return { erro: "A logo enviada não pertence a este portal.", ok: false };
  }
  return { ok: true, valor: String(valor).trim() };
}

// ── LEITURA DO ARQUIVO ENVIADO ───────────────────────────────────────────────────────────────

/** Tira o cabeçalho `data:` do FileReader e devolve os bytes. `null` = base64 quebrado. */
export function bytesDoBase64(valor: string): null | Uint8Array {
  try {
    const cru =
      valor.startsWith("data:") && valor.includes(",")
        ? valor.slice(valor.indexOf(",") + 1)
        : valor;
    const bytes = Uint8Array.from(Buffer.from(cru, "base64"));
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Que formato é este arquivo, DE VERDADE.
 *
 * O content-type do navegador é palpite (SVG chega como `image/svg+xml`, mas também como vazio,
 * `text/xml` ou `application/octet-stream`), então o desempate é o CONTEÚDO: PNG tem assinatura
 * fixa nos 8 primeiros bytes; SVG tem que trazer uma tag `<svg`. Isso é o que impede subir um
 * HTML com nome de `.svg`.
 */
export function formatoDaLogo(entrada: {
  bytes: Uint8Array;
  contentType?: null | string;
  nomeArquivo?: null | string;
}): { erro: string; ok: false } | { extensao: ExtensaoDaLogo; ok: true } {
  const { bytes } = entrada;
  if (!bytes.length) return { erro: "Arquivo vazio.", ok: false };
  if (bytes.length > LOGO_MAX_BYTES) return { erro: MENSAGEM_LOGO_GRANDE, ok: false };

  const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ehPng =
    bytes.length > ASSINATURA_PNG.length &&
    ASSINATURA_PNG.every((byte, i) => bytes[i] === byte);
  if (ehPng) return { extensao: "png", ok: true };

  // SVG é texto. Olho só o começo: um `<svg` depois de 4KB de prólogo não é arquivo de arte.
  //
  // ⚠️ DUAS APERTADAS, e as duas têm motivo:
  //   • a tag é `/<svg[\s>]/` — a MESMA regex de `sanitizarSvg`. Com um `includes("<svg")` solto,
  //     um `<svgx>` passava aqui e morria lá adiante, com recado que não explicava nada;
  //   • documento HTML é recusado ANTES, mesmo trazendo um `<svg>` inline no meio. Sem isso, uma
  //     página inteira entrava como `image/svg+xml` só por ter um ícone embutido nos 4KB iniciais.
  const inicio = Buffer.from(bytes.slice(0, 4096)).toString("utf8");
  const ehHtml = /^\s*(?:<!doctype\s+html|<html[\s>])/i.test(inicio);
  if (!ehHtml && /<svg[\s>]/i.test(inicio)) return { extensao: "svg", ok: true };

  const pista = (entrada.nomeArquivo ?? entrada.contentType ?? "").toLowerCase();
  if (pista.includes("jpg") || pista.includes("jpeg") || pista.includes("pdf")) {
    return { erro: `${MENSAGEM_LOGO_FORMATO} Converta o arquivo antes de enviar.`, ok: false };
  }
  return { erro: MENSAGEM_LOGO_FORMATO, ok: false };
}

/**
 * SVG É EXECUTÁVEL. Um arquivo subido por alguém com acesso ao Setup não pode virar XSS na porta
 * pública de outro cliente — e a porta roda no MESMO domínio do hub (`c2x.app.br`), então script
 * ali dentro estaria na origem que tem os cookies de sessão.
 *
 * Defesa em DUAS camadas, de propósito:
 *   1. aqui, na gravação: tira o que executa (`<script>`, `on*=`, `javascript:`, `<foreignObject>`)
 *      e RECUSA o que não dá para limpar com segurança (`<!ENTITY`, porta de XXE/billion laughs);
 *   2. na entrega: `Content-Security-Policy` + `X-Content-Type-Options: nosniff` na rota pública,
 *      para o caso de algo escapar daqui.
 *
 * Não é um parser de XML — é uma faxina conservadora sobre arquivo de arte. A segunda camada é
 * que garante o resultado; esta reduz a superfície e deixa o arquivo limpo no bucket.
 */
export function sanitizarSvg(texto: string): { erro: string; ok: false } | { ok: true; svg: string } {
  if (!/<svg[\s>]/i.test(texto)) return { erro: MENSAGEM_LOGO_FORMATO, ok: false };
  if (/<!ENTITY/i.test(texto)) {
    return { erro: "Este SVG declara entidades XML e não pode ser publicado.", ok: false };
  }

  const limpo = texto
    // <script>…</script>, inclusive sem fechamento (o resto do arquivo vai junto).
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[\s\S]*$/gi, "")
    // <foreignObject> carrega HTML dentro do SVG — inclusive <iframe> e handlers.
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, "")
    .replace(/<foreignObject\b[^>]*\/?>/gi, "")
    // onload=, onclick=, onmouseover=… com aspas duplas, simples ou sem aspas.
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    // href="javascript:…" e afins, em href e xlink:href.
    .replace(/\s(?:xlink:)?href\s*=\s*"(?:\s|&#\d+;)*javascript:[^"]*"/gi, "")
    .replace(/\s(?:xlink:)?href\s*=\s*'(?:\s|&#\d+;)*javascript:[^']*'/gi, "")
    // <a xlink:href> que sobrou sem destino continua inofensivo; o que não pode é o handler.
    .replace(/<\s*(iframe|object|embed)\b[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed)\b[^>]*\/?>/gi, "");

  return { ok: true, svg: limpo };
}

/**
 * Passa o arquivo pelo funil inteiro (tamanho → formato → faxina) e devolve os bytes que vão para
 * o bucket. Pura: não toca em rede. É o que o teste consegue exercitar de ponta a ponta.
 */
export function prepararArquivoDaLogo(entrada: {
  contentType?: null | string;
  fileBase64: string;
  nomeArquivo?: null | string;
}): { erro: string; ok: false } | { bytes: Uint8Array; extensao: ExtensaoDaLogo; ok: true } {
  if (entrada.fileBase64.length > LOGO_MAX_BASE64) {
    return { erro: MENSAGEM_LOGO_GRANDE, ok: false };
  }

  const bytes = bytesDoBase64(entrada.fileBase64);
  if (!bytes) return { erro: "Não foi possível ler a imagem enviada.", ok: false };

  const formato = formatoDaLogo({
    bytes,
    contentType: entrada.contentType,
    nomeArquivo: entrada.nomeArquivo,
  });
  if (!formato.ok) return formato;

  if (formato.extensao === "png") return { bytes, extensao: "png", ok: true };

  const limpo = sanitizarSvg(Buffer.from(bytes).toString("utf8"));
  if (!limpo.ok) return limpo;
  return { bytes: new Uint8Array(Buffer.from(limpo.svg, "utf8")), extensao: "svg", ok: true };
}

// ── STORAGE ──────────────────────────────────────────────────────────────────────────────────

function caminhoNoBucket(slug: string, variante: VarianteDaLogo, extensao: ExtensaoDaLogo): null | string {
  const chave = chaveDoPortal(slug);
  return chave ? `${LOGO_PREFIX}/${chave}/${variante}.${extensao}` : null;
}

/**
 * Sobe (ou substitui) uma variante da logo. Nome FIXO por portal+variante, com `upsert`: a arte
 * nova ocupa o lugar da antiga em vez de acumular lixo no bucket. Quem fura o cache do navegador
 * é o `?v=` da referência devolvida.
 *
 * Trocar de PNG para SVG (ou o contrário) deixaria o arquivo antigo para trás, então a outra
 * extensão é varrida — mas SÓ DEPOIS do upload dar certo.
 *
 * ⚠️ A ORDEM É A CORREÇÃO, não estilo. Apagando antes, um upload que falhasse (storage instável,
 * rede, quota) deixava a porta SEM marca: o `clara.png` já tinha ido embora e a coluna do banco
 * continuava apontando para ele. O operador via "Falha ao enviar a logo", não salvava nada — e
 * mesmo assim a logo do cliente sumia. Subindo primeiro, uma falha aqui não muda nada no que
 * está no ar; no pior caso sobra um arquivo da extensão antiga que ninguém serve.
 */
export async function subirLogoDoIncorporador(entrada: {
  adminClient: AdminClient;
  contentType?: null | string;
  fileBase64: string;
  nomeArquivo?: null | string;
  slug: string;
  variante: VarianteDaLogo;
}): Promise<{ erro: string; ok: false } | { ok: true; referencia: string }> {
  const chave = chaveDoPortal(entrada.slug);
  if (!chave) return { erro: "Endereço de acesso inválido.", ok: false };

  const arquivo = prepararArquivoDaLogo({
    contentType: entrada.contentType,
    fileBase64: entrada.fileBase64,
    nomeArquivo: entrada.nomeArquivo,
  });
  if (!arquivo.ok) return arquivo;

  const caminho = `${LOGO_PREFIX}/${chave}/${entrada.variante}.${arquivo.extensao}`;
  const outra: ExtensaoDaLogo = arquivo.extensao === "svg" ? "png" : "svg";

  const envio = await entrada.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .upload(caminho, arquivo.bytes, {
      cacheControl: "3600",
      contentType: TIPOS_ACEITOS[arquivo.extensao],
      upsert: true,
    });

  if (envio.error) return { erro: `Falha ao enviar a logo: ${envio.error.message}`, ok: false };

  // A arte nova já está no ar; agora sim o resto da extensão anterior pode sair. Falha aqui é
  // faxina que não aconteceu — o arquivo sobra no bucket e ninguém o serve.
  await entrada.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .remove([`${LOGO_PREFIX}/${chave}/${entrada.variante}.${outra}`])
    .catch(() => null);

  const referencia = montarReferenciaDeLogo({
    extensao: arquivo.extensao,
    slug: chave,
    variante: entrada.variante,
  });
  if (!referencia) return { erro: "Endereço de acesso inválido.", ok: false };

  return { ok: true, referencia };
}

// Aqui existia `removerLogoDoIncorporador(client, slug, variante)`, que apagava as duas extensões
// de uma variante a partir de um SLUG. Ela saiu junto com o DELETE da rota de upload: quem apagava
// era a lixeira da tela, no clique, ANTES de salvar — então desistir e fechar o formulário deixava
// a coluna do banco apontando para um arquivo que já não existia, e a porta do cliente passava a
// mostrar imagem quebrada sem ninguém ter salvo nada. Hoje a lixeira só zera o campo, e o objeto
// sai na gravação, depois que a coluna deixou de apontar para ele, via `removerObjetoDaLogo` —
// que apaga UM caminho conferido, não um par derivado de texto digitado.

/** Baixa os bytes de UM objeto já validado por `objetoDaLogoDoPortal`. Nunca receba path cru. */
export async function baixarLogoDoIncorporador(
  adminClient: AdminClient,
  objeto: string,
): Promise<null | Uint8Array> {
  const { data, error } = await adminClient.storage.from(APOLO_DOCS_BUCKET).download(objeto);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * O operador renomeou o endereço de acesso depois de já ter subido a logo. Como a chave do
 * caminho é o slug, a referência antiga deixaria de casar com o portal (item 3 de
 * `objetoDaLogoDoPortal`) e a marca sumiria da porta sem ninguém entender por quê.
 *
 * Mover no Storage é operação de METADADO — os bytes não passam por aqui. Devolve a referência já
 * apontando para o endereço novo; `null` em `referencia` quando não havia nada para mover.
 *
 * ⚠️ QUEM CHAMA PRECISA DESFAZER. O move acontece ANTES da gravação no banco, e a gravação pode
 * falhar depois (endereço duplicado, banco fora). Se ninguém desfizer, o objeto fica no prefixo
 * NOVO enquanto a coluna continua apontando para o ANTIGO: caminho que não existe mais, 404 na
 * rota pública, marca sumida da porta — e o operador só vê "não foi possível gravar". Por isso o
 * retorno traz `movido` (o de-para), para `desfazerMovimentoDeLogo` colocar tudo no lugar.
 */
export type MovimentoDeLogo = { de: string; para: string };

export async function migrarLogoDeSlug(entrada: {
  adminClient: AdminClient;
  referencia: null | string | undefined;
  slugDestino: string;
}): Promise<
  | { erro: string; ok: false }
  | { movido?: MovimentoDeLogo; ok: true; referencia: null | string }
> {
  const ref = interpretarReferenciaDeLogo(entrada.referencia);
  if (ref.tipo === "vazio") return { ok: true, referencia: null };
  // Asset do repo (o caso do Cecílio) não tem o que migrar: o arquivo é do deploy, não do bucket.
  if (ref.tipo === "asset") return { ok: true, referencia: ref.href };
  if (ref.tipo === "invalido") return { erro: "Referência de logo inválida.", ok: false };

  const destino = chaveDoPortal(entrada.slugDestino);
  if (!destino) return { erro: "Endereço de acesso inválido.", ok: false };
  if (ref.chave === destino) return { ok: true, referencia: String(entrada.referencia).trim() };

  const novoCaminho = `${LOGO_PREFIX}/${destino}/${ref.variante}.${ref.extensao}`;
  const { error } = await entrada.adminClient.storage
    .from(APOLO_DOCS_BUCKET)
    .move(ref.objeto, novoCaminho);

  if (error) {
    return {
      erro: "O endereço de acesso mudou e a logo não pôde ser movida. Envie a logo de novo.",
      ok: false,
    };
  }

  return {
    movido: { de: ref.objeto, para: novoCaminho },
    ok: true,
    referencia: montarReferenciaDeLogo({
      extensao: ref.extensao,
      slug: destino,
      variante: ref.variante,
    }),
  };
}

/**
 * Coloca de volta um objeto que `migrarLogoDeSlug` já tinha movido, porque a gravação no banco
 * falhou depois. Best-effort de propósito: o erro que interessa ao operador é o da gravação, e
 * uma segunda falha aqui não pode virar a mensagem da tela.
 *
 * Os dois caminhos passam pelo padrão fechado antes de tocar no bucket — este método recebe dados
 * que já vieram validados, mas ele é o último ponto antes de uma operação de escrita no storage
 * onde moram os documentos de CAD, e conferir de novo custa uma regex.
 */
export async function desfazerMovimentoDeLogo(
  adminClient: AdminClient,
  movimento: MovimentoDeLogo,
): Promise<void> {
  if (!RE_STORAGE.test(movimento.de) || !RE_STORAGE.test(movimento.para)) return;
  try {
    await adminClient.storage.from(APOLO_DOCS_BUCKET).move(movimento.para, movimento.de);
  } catch {
    // Silêncio proposital: ver o comentário acima.
  }
}

/** O caminho no bucket de uma referência gravada — `null` quando ela não é de storage. */
export function objetoDaReferencia(referencia: null | string | undefined): null | string {
  const ref = interpretarReferenciaDeLogo(referencia);
  return ref.tipo === "storage" ? ref.objeto : null;
}

/**
 * Apaga UM objeto de logo do bucket. Usado só na faxina de depois da gravação, quando a coluna
 * deixou de apontar para o arquivo antigo.
 *
 * ⚠️ O `RE_STORAGE` aqui é portão, não formalidade: é a garantia de que nenhum caminho fora de
 * `incorporador-logos/<chave>/<variante>.<ext>` chega num `remove` sobre o bucket que também
 * guarda RG, CPF e comprovante de renda dos cadastros.
 */
export async function removerObjetoDaLogo(
  adminClient: AdminClient,
  objeto: string,
): Promise<void> {
  if (!RE_STORAGE.test(objeto)) return;
  try {
    await adminClient.storage.from(APOLO_DOCS_BUCKET).remove([objeto]);
  } catch {
    // Lixo que sobrou no bucket não pode derrubar uma gravação que já deu certo.
  }
}

// Só o caminho, para quem precisa montar o path sem passar pela referência (uso interno/teste).
export { caminhoNoBucket as caminhoDaLogoNoBucket };
