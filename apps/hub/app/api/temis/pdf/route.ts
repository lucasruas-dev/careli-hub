import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { gerarPdfDoHtml } from "@/lib/temis/html-para-pdf";

// O HTML DA MINUTA VOLTA COMO PDF.
//
// A conversão inteira mora em `lib/temis/html-para-pdf.ts` — aqui só entra quem pode, o corpo é
// conferido e os bytes voltam. A separação é a mesma do resto da Têmis: a regra fica na lib (com
// teste), a rota é só a porta.
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

/**
 * Teto do HTML aceito.
 *
 * ⚠️ EXISTE PARA PROTEGER A MEMÓRIA DA FUNÇÃO, não para julgar o contrato. A maior minuta que
 * temos (JDG) tem ~87 KB de `conteudo_html`; 4 MB dá folga de ordens de grandeza para imagem em
 * base64 e ainda barra o payload que faria o Chromium estourar a RAM da função e devolver um erro
 * sem explicação.
 */
const TETO_DE_HTML = 4_000_000;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    estiloExtra?: unknown;
    html?: unknown;
    nome?: unknown;
  };

  const html = typeof corpo.html === "string" ? corpo.html : "";
  const estiloExtra =
    typeof corpo.estiloExtra === "string" ? corpo.estiloExtra : undefined;

  if (!html.trim()) {
    return NextResponse.json({ erro: "Sem HTML para imprimir." }, { status: 400 });
  }

  if (html.length > TETO_DE_HTML) {
    return NextResponse.json(
      {
        erro: `O HTML tem ${html.length.toLocaleString("pt-BR")} caracteres e o teto é ${TETO_DE_HTML.toLocaleString("pt-BR")}.`,
      },
      { status: 413 },
    );
  }

  let pdf: Uint8Array;
  try {
    pdf = await gerarPdfDoHtml(html, { estiloExtra });
  } catch (e) {
    // A mensagem real vai para o log, não para a tela: o erro do Chromium costuma citar caminho de
    // binário e flag de linha de comando — informação de infraestrutura que não ajuda quem está
    // tentando imprimir um contrato e não deve vazar para o navegador.
    console.error(
      "[temis][pdf] falha ao gerar o PDF",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json(
      { erro: "Não foi possível gerar o PDF. Tente de novo." },
      { status: 502 },
    );
  }

  const nome = nomeDoArquivo(corpo.nome);

  return new Response(new Uint8Array(pdf), {
    headers: {
      // ⚠️ `no-store`: contrato tem nome, CPF e valor. Um `Cache-Control` permissivo aqui deixaria
      // o PDF de um comprador guardado em proxy ou CDN no caminho de outro.
      "Cache-Control": "no-store",
      "Content-Disposition": `inline; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "Content-Type": "application/pdf",
    },
    status: 200,
  });
}

/**
 * Nome do arquivo, em ASCII.
 *
 * ⚠️ O CABEÇALHO HTTP NÃO É UTF-8. "Contrato — João.pdf" no `filename` simples faz alguns clientes
 * truncarem o nome ou recusarem a resposta inteira. Aqui o acento é removido (NFD + corte dos
 * diacríticos) para o `filename`, e o `filename*` leva o nome de verdade percent-encoded — mesma
 * dupla usada no extrato do cliente.
 */
function nomeDoArquivo(bruto: unknown): string {
  const base = typeof bruto === "string" && bruto.trim() ? bruto.trim() : "contrato";
  const semAcento = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .slice(0, 120);
  return semAcento.toLowerCase().endsWith(".pdf") ? semAcento : `${semAcento}.pdf`;
}
