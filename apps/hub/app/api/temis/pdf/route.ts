import { authorizeApoloRead } from "@/lib/apolo/auth";
import { imprimirHtmlEmPdf } from "@/lib/temis/contrato-servico";

// O HTML DA MINUTA VOLTA COMO PDF.
//
// A conversão inteira mora em `lib/temis/html-para-pdf.ts`, e o tratamento do pedido (teto, nome do
// arquivo, cabeçalhos) em `imprimirHtmlEmPdf` (`lib/temis/contrato-servico.ts`). A porta do portal
// foi apagada em 16/09/2026 (decisão do Lucas): nenhuma tela a usava, e ela entregava o Chromium a
// quem é de fora da Careli. Aqui só entra quem pode. A separação é a mesma do resto da Têmis: a
// regra fica na lib (com teste), a rota é só a porta.
//
// ⚠️ AUTENTICADA COMO AS OUTRAS ROTAS DA TÊMIS (`authorizeApoloRead`, Bearer da sessão Supabase).
// Não é sobre o PDF: é sobre o CHROMIUM. Uma rota aberta que abre um navegador por requisição é um
// amplificador de custo — cada chamada custa ~1 GB de memória e segundos de função, e o HTML vem
// de quem chama. Sem o portão, qualquer um lá fora derruba a conta da Vercel mandando HTML pesado
// em sequência.
//
// ⚠️ `runtime = "nodejs"` NÃO É DECORAÇÃO. O Chromium é um processo do sistema operacional; no
// runtime Edge não existe `child_process` nem `/tmp`, e o `@sparticuz/chromium` nem carrega.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Subir o Chromium (descompactar o binário no `/tmp` na primeira invocação da instância) custa
// alguns segundos, e um contrato de 60 páginas com imagem leva mais. O teto da Vercel é 300.
export const maxDuration = 300;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  return imprimirHtmlEmPdf(request);
}
