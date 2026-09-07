import { NextResponse } from "next/server";

// WEBHOOK DA CLICKSIGN — modo DESCOBERTA.
//
// Lucas, 07/09/2026, com o painel da Clicksign aberto: *"está pedindo a url do webhook"*, e antes
// disso *"o sandbox está com problemas, vamos de prod mesmo"*.
//
// ⚠️ ESTA ROTA AINDA NÃO PROCESSA NADA, E ISSO É DE PROPÓSITO. Ela existe para a URL cadastrada no
// painel ter para onde apontar HOJE, e para descobrirmos o formato real dos eventos antes de
// escrever o processador. O Asaas passou por exatamente esta fase (ver a nota de "modo DESCOBERTA
// da bancada" em `app/api/publico/asaas/webhook/route.ts`), e ela evita o erro mais caro de
// integração de webhook: escrever o parser a partir da documentação e descobrir em produção que o
// corpo chega em outro formato. No D4Sign é literalmente isso — a doc mostra JSON e o webhook chega
// em form-data; um `request.json()` recebe vazio e não falha de forma óbvia.
//
// ⚠️ RESPONDER 200 RÁPIDO É A FUNÇÃO PRINCIPAL. Provedor de assinatura reenvia o evento quando não
// recebe 200, e retentativa em cima de rota lenta vira tempestade. Aqui não há consulta a banco, não
// há disparo, não há await de rede: lê o corpo, registra, responde.
//
// ⚠️ NADA DE SEGREDO NO LOG. Os headers são registrados para descobrirmos COMO a Clicksign assina o
// callback, mas os que carregam credencial saem antes de imprimir.
//
// O QUE VEM DEPOIS (com OK do Lucas): a tabela `temis_assinatura_eventos` no molde de
// `apolo_asaas_eventos` (payload cru, headers, carimbo NOSSO de recebimento, chave de idempotência),
// a conferência do HMAC e o processador que move o card da Têmis.
// Ver [[reference_d4sign_escrita_armadilhas]] e [[project_contrato_so_no_panteon]].

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Não faz trabalho: o teto baixo é a garantia de que nunca vai segurar a conexão do provedor.
export const maxDuration = 10;

/** Cabeçalhos que NÃO podem ir para o log — carregam credencial. */
const SEGREDOS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "asaas-access-token",
  "clicksign-access-token",
]);

function headersSeguros(request: Request): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of request.headers.entries()) {
    const nome = chave.toLowerCase();
    // ⚠️ A ASSINATURA DO CALLBACK FICA, e é o motivo de registrar headers: precisamos descobrir em
    // que cabeçalho a Clicksign manda o HMAC e sobre o que ele é calculado. No D4Sign o
    // `Content-Hmac` é sobre o UUID do documento e não sobre o corpo — autentica origem, não
    // protege replay, e isso muda o desenho da idempotência.
    saida[nome] = SEGREDOS.has(nome) ? "(omitido)" : valor;
  }
  return saida;
}

export async function POST(request: Request) {
  // ⚠️ LÊ COMO TEXTO, e não como JSON. É o único jeito de ver o que realmente chegou: se vier
  // form-data (como no D4Sign), `request.json()` devolveria vazio sem erro e a descoberta terminaria
  // com a conclusão errada — "a Clicksign manda corpo vazio".
  const cru = await request.text().catch(() => "");

  const tipoDoCorpo = request.headers.get("content-type") ?? "(sem content-type)";

  console.info("[clicksign][webhook] evento recebido", {
    // O carimbo é NOSSO: o horário do provedor pode vir sem fuso, ou não vir.
    recebidoEm: new Date().toISOString(),
    tipoDoCorpo,
    tamanhoDoCorpo: cru.length,
    headers: headersSeguros(request),
    // Teto de 20 mil caracteres: um payload gigante não pode entupir o log (e a conta dele).
    corpo: cru.slice(0, 20_000),
    truncado: cru.length > 20_000,
  });

  // Sempre 200: nesta fase, qualquer outra resposta faria a Clicksign reenviar o mesmo evento por
  // horas. O que não soubermos tratar fica registrado no log, e é dele que sai o processador.
  return NextResponse.json({ ok: true });
}

// A Clicksign (como vários provedores) pode fazer um GET de verificação ao cadastrar a URL.
// Responder 200 aqui é o que faz o painel aceitar o cadastro.
export function GET() {
  return NextResponse.json({ ok: true, servico: "clicksign-webhook", modo: "descoberta" });
}
