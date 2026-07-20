// Leitura PAGA dos documentos das CADs do Asana (iOCR da MOST).
//
// ⚠️ ESTE É O CAMINHO QUE CUSTA DINHEIRO. R$ 0,506 por IMAGEM (most-precos.ts, OCR-100, plano
// atual), e RG frente+verso conta como 2. Por isso o fluxo é sempre em duas etapas:
//
//   1. ORÇAR  (grátis): conta CADs, anexos e quanto vai custar. Nada é lido.
//   2. LER    (pago): só depois de confirmação explícita na tela.
//
// Três economias embutidas, em ordem de importância:
//   a) CPF no TEXTO da task — se o cadastro já traz o CPF escrito, a CAD custa ZERO.
//   b) dedup por SHA-256 do arquivo (apolo_ocr_reads) — o mesmo documento nunca é pago duas
//      vezes. Isto não é hipótese: 5 pessoas têm CAD repetida no Vale do Ouro, com o mesmo
//      documento anexado nas duas.
//   c) arquivo que não é documento (planilha, zip, doc) nem é enviado.
//
// E uma armadilha DESLIGADA de propósito: o wizard, ao receber extração vazia, gira a imagem e
// reenvia em [0, 90, 270, 180] — até 4 cobranças pelo mesmo arquivo. Aqui isso não acontece:
// documento ilegível fica para o operador resolver na validação, que é mais barato que 4
// tentativas cegas.
import { createHash } from "node:crypto";

import { extractDocument } from "@/lib/apolo/mostqi";
import { custoOcrImagem } from "@/lib/apolo/most-precos";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const ASANA_API = "https://app.asana.com/api/1.0";
const TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024;

// Extensões que o iOCR consegue ler. Mandar planilha ou zip é pagar por nada.
const EXTENSOES_LEGIVEIS = new Set(["jpg", "jpeg", "png", "webp", "pdf", "bmp", "tiff"]);

function token(): string {
  return process.env.ASANA_ACCESS_TOKEN?.trim() ?? "";
}

export function ehDocumentoLegivel(nome: string | null | undefined): boolean {
  const match = /\.([a-z0-9]+)$/i.exec(nome ?? "");
  const ext = match?.[1]?.toLowerCase();
  return ext ? EXTENSOES_LEGIVEIS.has(ext) : false;
}

// CPF escrito no texto da CAD. Achando aqui, a leitura do documento fica desnecessária.
const RE_CPF = /\b(\d{3}\.?\d{3}\.?\d{3}-?\d{2})\b/g;

export function acharCpfNoTexto(texto: string | null | undefined): string | null {
  const alvo = String(texto ?? "");
  for (const achado of alvo.matchAll(RE_CPF)) {
    const digitos = (achado[1] ?? "").replace(/\D/g, "");
    if (cpfValido(digitos)) return digitos;
  }
  return null;
}

// Valida o dígito verificador. createApoloEntity só CONTA 11 dígitos, não valida — sem isto,
// lixo de OCR (e número de protocolo) entraria como CPF.
export function cpfValido(valor: string): boolean {
  const cpf = String(valor ?? "").replace(/\D/g, "");
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) {
      soma += Number(cpf[i]) * (ate + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

export type AnexoCandidato = {
  downloadUrl: string | null;
  gid: string;
  legivel: boolean;
  nome: string;
  tamanho: number | null;
};

// Tudo que veio da CAD do Asana (campos + descrição do formulário). Viaja junto do orçamento
// até a criação da entidade: é dado de graça que não pode se perder no caminho.
export type CadParaLeitura = {
  anexos: AnexoCandidato[];
  conjuge?: {
    email?: string;
    escolaridade?: string;
    nome?: string;
    profissao?: string;
    renda?: string;
    telefone?: string;
  };
  cpfNoTexto: string | null;
  email: string | null;
  escolaridade?: string | null;
  estadoCivil?: string | null;
  gid: string;
  imobiliaria: string | null;
  nome: string;
  profissao?: string | null;
  renda?: string | null;
  telefone: string | null;
};

export type Orcamento = {
  // Quanto custa, em reais, se você mandar ler tudo que está pendente.
  custoEstimado: number;
  custoPorImagem: number;
  // CADs que não precisam de leitura porque o CPF já está no texto.
  gratisPorTexto: number;
  imagensAPagar: number;
  // Arquivos que já foram lidos antes (dedup por hash) — não serão cobrados de novo.
  jaLidos: number;
  naoLegiveis: number;
  totalCads: number;
};

async function listarAnexos(taskGid: string): Promise<AnexoCandidato[]> {
  const url = new URL(`${ASANA_API}/tasks/${taskGid}/attachments`);
  url.searchParams.set("opt_fields", "name,download_url,size");

  const resposta = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!resposta.ok) return [];

  const json = (await resposta.json()) as {
    data: { download_url?: string | null; gid: string; name?: string | null; size?: number | null }[];
  };

  return (json.data ?? []).map((anexo) => ({
    downloadUrl: anexo.download_url ?? null,
    gid: anexo.gid,
    legivel: ehDocumentoLegivel(anexo.name),
    nome: anexo.name ?? `anexo-${anexo.gid}`,
    tamanho: anexo.size ?? null,
  }));
}

// ORÇAMENTO — read-only e sem custo. Nenhuma chamada à MOST acontece aqui.
export async function orcarLeitura(input: {
  cads: (Omit<CadParaLeitura, "anexos" | "cpfNoTexto"> & { notas: string | null })[];
  client: AdminClient;
}): Promise<{ itens: CadParaLeitura[]; orcamento: Orcamento }> {
  const custoPorImagem = custoOcrImagem();
  const itens: CadParaLeitura[] = [];

  let imagensAPagar = 0;
  let gratisPorTexto = 0;
  let naoLegiveis = 0;

  for (const cad of input.cads) {
    // Economia (a): CPF já escrito no cadastro = zero consulta.
    const cpfNoTexto = acharCpfNoTexto(cad.notas);
    const anexos = cpfNoTexto ? [] : await listarAnexos(cad.gid);

    if (cpfNoTexto) {
      gratisPorTexto += 1;
    } else {
      for (const anexo of anexos) {
        if (!anexo.legivel) naoLegiveis += 1;
        else imagensAPagar += 1;
      }
    }

    // Repassa a CAD inteira: só `anexos` e `cpfNoTexto` são descobertos aqui.
    itens.push({ ...cad, anexos, cpfNoTexto });
  }

  // Economia (b): o que já foi lido antes não será cobrado. Só dá para saber com certeza
  // depois de baixar (o hash é do byte), então aqui é o teto — o custo real tende a ser menor.
  const { count: jaLidos } = await input.client
    .from("apolo_ocr_reads")
    .select("id", { count: "exact", head: true });

  return {
    itens,
    orcamento: {
      custoEstimado: Number((imagensAPagar * custoPorImagem).toFixed(2)),
      custoPorImagem,
      gratisPorTexto,
      imagensAPagar,
      jaLidos: jaLidos ?? 0,
      naoLegiveis,
      totalCads: input.cads.length,
    },
  };
}

export type ResultadoLeitura = {
  cpfsAchados: number;
  erros: { cad: string; motivo: string }[];
  gastoBrl: number;
  imagensPagas: number;
  reaproveitados: number;
  semCpf: number;
};

// TUDO que a MOST devolveu e serve para preencher a ficha — não só o CPF.
// Cada campo aqui é algo que já foi PAGO: descartar qualquer um deles é jogar dinheiro fora e
// deixar o operador digitando à mão o que a máquina já tinha lido.
export type CadastroExtraido = {
  cidade?: string;
  cpf: string;
  dataNascimento?: string;
  nacionalidade?: string;
  naturalidade?: string;
  nome?: string;
  nomeMae?: string;
  nomePai?: string;
  orgaoEmissor?: string;
  rg?: string;
  uf?: string;
};

// Aproveita o que veio preenchido, ignorando string vazia (a MOST devolve "" para o que não
// achou). O `undefined` é o que faz o campo NÃO sobrescrever dado bom que já exista na ficha.
export function extrairCadastro(
  bruto: Record<string, unknown> | null | undefined,
  cpf: string,
): CadastroExtraido {
  const texto = (chave: string): string | undefined => {
    const valor = String((bruto ?? {})[chave] ?? "").trim();
    return valor || undefined;
  };

  return {
    cidade: texto("cidade"),
    cpf,
    dataNascimento: texto("dataNascimento"),
    nacionalidade: texto("nacionalidade"),
    naturalidade: texto("naturalidade"),
    nome: texto("nome"),
    nomeMae: texto("nomeMae"),
    nomePai: texto("nomePai"),
    orgaoEmissor: texto("orgaoEmissor"),
    rg: texto("rg"),
    uf: texto("uf"),
  };
}

// Junta o que veio de VÁRIOS documentos da mesma pessoa: o RG traz filiação, a CNH traz órgão
// emissor, o comprovante traz cidade. O primeiro valor preenchido ganha.
export function mesclarCadastros(lista: CadastroExtraido[]): CadastroExtraido | null {
  const comCpf = lista.filter((item) => item.cpf);
  if (comCpf.length === 0) return null;

  const saida: CadastroExtraido = { cpf: comCpf[0]!.cpf };
  for (const item of comCpf) {
    for (const [chave, valor] of Object.entries(item)) {
      if (valor && !saida[chave as keyof CadastroExtraido]) {
        (saida as Record<string, unknown>)[chave] = valor;
      }
    }
  }
  return saida;
}

// LEITURA PAGA. Só rode depois de confirmação explícita.
export async function lerDocumentosDoLote(input: {
  client: AdminClient;
  itens: CadParaLeitura[];
  lidoPor?: string | null;
}): Promise<{
  porCad: Record<string, CadastroExtraido>;
  resultado: ResultadoLeitura;
}> {
  const custoPorImagem = custoOcrImagem();
  const resultado: ResultadoLeitura = {
    cpfsAchados: 0,
    erros: [],
    gastoBrl: 0,
    imagensPagas: 0,
    reaproveitados: 0,
    semCpf: 0,
  };
  // gid da CAD -> TUDO que foi lido dela (não só o CPF: cada campo aqui já foi pago).
  const porCad: Record<string, CadastroExtraido> = {};

  for (const item of input.itens) {
    // Economia (a): CPF no texto, custo zero. Aqui só temos o CPF mesmo.
    if (item.cpfNoTexto) {
      porCad[item.gid] = { cpf: item.cpfNoTexto };
      resultado.cpfsAchados += 1;
      continue;
    }

    let cpfDaCad: string | null = null;
    // Guarda o que cada documento devolveu: o RG traz filiação, a CNH traz órgão emissor.
    // Todos já foram pagos, então todos entram na ficha.
    const extraidos: CadastroExtraido[] = [];

    for (const anexo of item.anexos) {
      if (cpfDaCad) break;
      if (!anexo.legivel || !anexo.downloadUrl) continue;
      if (anexo.tamanho && anexo.tamanho > TAMANHO_MAXIMO_BYTES) continue;

      try {
        const resposta = await fetch(anexo.downloadUrl, { cache: "no-store" });
        if (!resposta.ok) continue;

        const buffer = Buffer.from(await resposta.arrayBuffer());
        if (buffer.byteLength > TAMANHO_MAXIMO_BYTES) continue;

        // Economia (b): já lemos este arquivo antes? O hash é do BYTE.
        const hash = createHash("sha256").update(buffer).digest("hex");
        const { data: jaLido } = await input.client
          .from("apolo_ocr_reads")
          .select("extracao")
          .eq("file_sha256", hash)
          .maybeSingle();

        if (jaLido) {
          const extracao = (jaLido as {
            extracao: { cadastro?: Record<string, unknown>; cpf?: string };
          }).extracao;
          resultado.reaproveitados += 1;

          if (extracao?.cpf && cpfValido(extracao.cpf)) {
            cpfDaCad = extracao.cpf;
            // Reaproveita a ficha inteira, não só o CPF: já foi pago uma vez.
            extraidos.push(extrairCadastro(extracao.cadastro, extracao.cpf));
          }
          continue;
        }

        // ⚠️ AQUI A CONSULTA É COBRADA. Sem rotação: documento ilegível fica para o operador.
        const extracao = await extractDocument({
          fileBase64: buffer.toString("base64"),
          fileName: anexo.nome,
        });

        // Uma imagem por arquivo enviado. PDF de várias páginas pode ser faturado por página
        // pela MOST, mas o retorno não diz quantas — então isto é o piso, não a verdade.
        const paginas = 1;
        resultado.imagensPagas += 1;
        resultado.gastoBrl += custoPorImagem;

        const cpfBruto = String(extracao.cadastro?.cpf ?? "").replace(/\D/g, "");
        const cpfOk = cpfValido(cpfBruto) ? cpfBruto : null;
        if (cpfOk) {
          cpfDaCad = cpfOk;
          // TUDO que veio no documento vai para a ficha — nome, nascimento, RG, órgão
          // emissor, cidade, UF. Guardar só o CPF seria pagar pelo resto e descartar.
          extraidos.push(
            extrairCadastro(
              extracao.cadastro as unknown as Record<string, unknown>,
              cpfOk,
            ),
          );
        }

        // Registra SEMPRE, inclusive leitura ruim: ela também foi cobrada, e guardar evita
        // repagar a mesma foto ilegível numa reimportação.
        await input.client.from("apolo_ocr_reads").insert({
          confianca: extracao.confiancaDocumento ?? null,
          custo_brl: custoPorImagem,
          extracao: {
            cadastro: extracao.cadastro ?? {},
            cpf: cpfOk,
            documentType: extracao.documentType ?? null,
          },
          file_name: anexo.nome,
          file_sha256: hash,
          lido_por: input.lidoPor ?? null,
          paginas,
          size_bytes: buffer.byteLength,
          source_id: anexo.gid,
          source_system: "asana",
          tipo: "iocr",
        });
      } catch (erro) {
        resultado.erros.push({ cad: item.nome, motivo: (erro as Error).message });
      }
    }

    const mesclado = mesclarCadastros(extraidos);
    if (mesclado) {
      porCad[item.gid] = mesclado;
      resultado.cpfsAchados += 1;
    } else if (cpfDaCad) {
      porCad[item.gid] = { cpf: cpfDaCad };
      resultado.cpfsAchados += 1;
    } else {
      resultado.semCpf += 1;
    }
  }

  resultado.gastoBrl = Number(resultado.gastoBrl.toFixed(2));
  return { porCad, resultado };
}
