import { enrichCompany, enrichPerson, extractDocument } from "@/lib/apolo/mostqi";
import { anotarContexto } from "@/lib/publico/cad/log-erros";
import { erro, json, lerCorpo, prepararRota, recusar, responder } from "@/lib/publico/cad/rotas";
import { preSessaoImobDoRequest, sessaoDoRequest } from "@/lib/publico/cad/sessao";

// S6 — leitura/enriquecimento pela MOST (iOCR). Espelho público de /api/apolo/mostqi.
//
// ⚠️ MULTIPLEXER POR `action` (extract | enrich | enrich-company): o wizard COMPLETO é reusado
// no público, e ele chama as três. A resposta sai no MESMO shape do interno — `{ data }` com a
// `Extraction` inteira (fields, crop, confiancaDocumento, overallConfidence) —, então o wizard
// roda idêntico sem tradução no cliente. A rota pública antiga podava `fields`/`crop` e girava
// o documento sozinha; aqui NÃO se rotaciona no servidor (o loop de rotação segue no wizard e
// para no primeiro acerto).
//
// ⚠️ TORNEIRA PAGA: ~R$ 0,50 por imagem (extract) e ~R$ 1,60 por consulta (enrich). Por isso a
// rota EXIGE sessão: a do CORRETOR (x-cad-sessao, CAD) OU a pré-sessão da IMOBILIÁRIA
// (x-cad-pre-sessao-imob, auto-cadastro). O CPF cadastrado / CNPJ conferido É a trava, somada
// ao teto diário por IP (balde `ocr`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O enrichment roda datasets on-demand e pode passar de 100s; damos folga (igual ao interno).
export const maxDuration = 300;

// Base64 de ~8MB de arquivo. Foto de celular cabe folgada; base64 infla ~33% na memória.
export const MAX_BASE64_PUBLICO = 11_000_000;

type Corpo = {
  action?: string;
  cnpj?: string;
  cpf?: string;
  datasets?: string[];
  fileBase64?: string;
  fileName?: string;
  query?: string;
};

export async function POST(request: Request) {
  // Uma das duas sessões basta. Ambas provam que a antessala foi vencida NO SERVIDOR (CPF
  // cadastrado ou CNPJ conferido) — é a autorização que paga a consulta.
  const sessaoCorretor = sessaoDoRequest(request);
  const preImob = preSessaoImobDoRequest(request);
  if (!sessaoCorretor.ok && !preImob.ok) {
    return recusar(
      request,
      erro("Sua sessão expirou. Reabra o link e informe o seu CPF ou CNPJ de novo.", 401),
    );
  }

  if (sessaoCorretor.ok) {
    anotarContexto(request, {
      corretorNome: sessaoCorretor.sessao.corretorNome,
      empreendimentoId: sessaoCorretor.sessao.enterpriseId,
      imobiliariaEntityId: sessaoCorretor.sessao.imobiliariaEntityId,
      imobiliariaNome: sessaoCorretor.sessao.imobiliariaNome,
    });
  } else if (preImob.ok) {
    anotarContexto(request, { imobiliariaCnpj: preImob.pre.cnpj });
  }

  const preparo = await prepararRota(request, "ocr");
  if (!preparo.ok) return preparo.response;
  const { inicio } = preparo;

  const corpo = await lerCorpo<Corpo>(request);
  const action = String(corpo?.action ?? "extract");

  if (action === "extract") {
    const fileBase64 = String(corpo?.fileBase64 ?? "");
    if (!fileBase64) return responder(request, inicio, erro("Anexe a foto do documento para continuar."));
    if (fileBase64.length > MAX_BASE64_PUBLICO) {
      return responder(
        request,
        inicio,
        erro("A foto ficou grande demais. Tire outra com menos zoom ou anexe um arquivo menor.", 413),
      );
    }
    try {
      // returnImage: pega o recorte tratado da MOST (endireitado, sem fundo) — é o que vai pro
      // drive. includeRaw fica FALSE: o JSON cru da MOST é dado demais para trafegar em 4G e o
      // wizard não o lê (só fields/crop/documentType/confiancaDocumento).
      const extraction = await extractDocument({
        fileBase64: stripDataUrl(fileBase64),
        fileName: String(corpo?.fileName ?? "documento.jpg"),
        returnImage: true,
      });
      return responder(request, inicio, json({ data: extraction }));
    } catch {
      // Falha real de leitura vira erro HTTP (o wizard já trata: deixa preencher na mão).
      return responder(
        request,
        inicio,
        erro("Não conseguimos ler a foto agora. O arquivo fica salvo: preencha os dados na mão.", 502),
      );
    }
  }

  if (action === "enrich") {
    try {
      const enr = await enrichPerson(String(corpo?.cpf ?? ""), {
        datasets: Array.isArray(corpo?.datasets) ? corpo?.datasets : undefined,
        query: typeof corpo?.query === "string" ? corpo?.query : undefined,
      });
      return responder(request, inicio, json({ data: enr }));
    } catch {
      return responder(
        request,
        inicio,
        erro("Não conseguimos completar os dados pelo CPF agora. Preencha os campos na mão.", 502),
      );
    }
  }

  if (action === "enrich-company") {
    try {
      const enr = await enrichCompany(String(corpo?.cnpj ?? ""), {
        query: typeof corpo?.query === "string" ? corpo?.query : undefined,
      });
      return responder(request, inicio, json({ data: enr }));
    } catch {
      return responder(
        request,
        inicio,
        erro("Não conseguimos consultar o CNPJ agora. Preencha os campos na mão.", 502),
      );
    }
  }

  return responder(request, inicio, erro(`Ação desconhecida: ${action}`));
}

// Aceita "data:image/...;base64,XXXX" ou o base64 puro (igual /api/apolo/mostqi).
function stripDataUrl(value: string): string {
  const comma = value.indexOf(",");
  return value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
}
