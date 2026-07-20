import { extractDocument } from "@/lib/apolo/mostqi";
import { erro, json, lerCorpo, prepararRota, responder } from "@/lib/publico/cad/rotas";
import { sessaoDoRequest } from "@/lib/publico/cad/sessao";

// S6 — leitura do documento pela MOST (iOCR). Espelho público de /api/apolo/mostqi.
//
// ⚠️ TORNEIRA PAGA: ~R$ 0,50 por imagem, e o wizard interno chega a tentar 4 rotações num
// documento deitado (4x o custo). Aqui a rota EXIGE sessão completa: só um corretor com CPF
// cadastrado e imobiliária credenciada chega até esta chamada. É a trava que o Lucas definiu
// ("o CPF cadastrado É a trava"), somada ao teto diário por IP.
//
// TETO DE BYTES: 8MB por arquivo, contra os 20MB do interno. Não existe teto nenhum hoje em
// documentos.ts, e base64 infla ~33% rodando inteiro na memória da function. Foto de celular
// cabe folgada em 8MB.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export const MAX_BASE64_PUBLICO = 11_000_000; // ~8MB de arquivo

// Rotações tentadas. O interno tenta [0, 90, 270, 180]; aqui paramos em duas porque cada
// tentativa é uma consulta COBRADA e a tela já orienta a fotografar na horizontal.
const ROTACOES_IMAGEM = [0, 90];

export async function POST(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao.ok) return erro("Sua sessão expirou. Informe o CPF novamente.", 401);

  const preparo = await prepararRota(request, "ocr");
  if (!preparo.ok) return preparo.response;
  const { inicio } = preparo;

  const corpo = await lerCorpo<{ fileBase64?: string; fileName?: string }>(request);
  const fileBase64 = String(corpo?.fileBase64 ?? "");
  if (!fileBase64) return responder(inicio, erro("Envie a foto do documento."));
  if (fileBase64.length > MAX_BASE64_PUBLICO) {
    return responder(
      inicio,
      erro("A foto ficou grande demais. Tire outra com menos zoom ou envie um arquivo menor.", 413),
    );
  }

  const fileName = String(corpo?.fileName ?? "documento.jpg");
  const ehPdf = /\.pdf$/i.test(fileName);

  try {
    const leitura = await extractDocument({ fileBase64, fileName });
    return responder(
      inicio,
      json({
        cadastro: leitura.cadastro,
        confianca: leitura.confiancaDocumento,
        documentType: leitura.documentType,
        // `raw` e `crop` NÃO saem: raw é o JSON cru da MOST (dado demais para o browser) e
        // crop é a foto 3x4 do rosto, que não temos por que devolver a ninguém.
        rotacoes: ehPdf ? 1 : ROTACOES_IMAGEM.length,
      }),
    );
  } catch {
    // Falha de leitura não bloqueia: a tela deixa o corretor digitar os dados na mão.
    return responder(
      inicio,
      json({ cadastro: null, erroLeitura: "Não conseguimos ler a foto. Você pode preencher os dados na mão." }),
    );
  }
}
