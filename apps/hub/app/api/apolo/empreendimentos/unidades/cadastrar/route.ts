import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { conferirPlanilha, type LinhaDaPlanilha } from "@/lib/apolo/cadastrar-unidades";
import {
  conferirImportacao,
  destinoDoC2x,
  importarUnidades,
  prefixoSugerido,
} from "@/lib/apolo/cadastrar-unidades-server";

// CADASTRO DE UNIDADES NO C2X — uma a uma ou por planilha.
//
// Pedido do Lucas (20/08/2026): *"botão de adicionar (pode ser uma ou importação), aí você já vai
// ter a referência do empreendimento"*, e *"quando finalizar o cadastro ou a importação, tem que
// ir para o C2X"*.
//
// ⚠️ ESCRITA NO LEGADO, E SEM DESFAZER. O C2X não expõe exclusão de unidade por esta API: uma
// unidade errada só sai pela tela dele, à mão, e enquanto isso ela aparece no estoque, no
// masterplan e na conta de VGV. Por isso:
//
//   • `authorizeApoloWrite` (e não `Read`, que o resto do módulo usa para ler);
//   • `conferir` NÃO escreve nada e é o caminho obrigatório antes de `importar`;
//   • o destino (`C2X_WRITE_API_URL`) volta em TODA resposta, para a tela mostrar antes do clique
//     — em dev ele aponta para `teste.careli.adm.br`, e foi assim que 8 cadastros de cliente
//     foram parar no ambiente errado em 01/08, todos com resposta de sucesso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Uma planilha de loteamento passa de 300 linhas, e cada uma é um POST serial no C2X.
export const maxDuration = 300;

type Corpo = {
  acao?: string;
  enterpriseId?: number | string;
  linhas?: LinhaDaPlanilha[];
  prefixo?: string;
  /** Para a ação `criar`: os campos de UMA unidade, no mesmo formato de uma linha da planilha. */
  unidade?: LinhaDaPlanilha;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as Corpo | null;
  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const enterpriseId = Number(corpo.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) {
    return NextResponse.json({ error: "Empreendimento não informado." }, { status: 400 });
  }

  // ── CONFERIR: lê a planilha, valida e compara com o que já está no C2X. Não escreve. ──────
  if (corpo.acao === "conferir") {
    const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : [];
    if (linhas.length === 0) {
      return NextResponse.json({ error: "A planilha veio vazia." }, { status: 400 });
    }

    const resultado = await conferirImportacao({ enterpriseId, linhas });
    if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 503 });

    return NextResponse.json({ data: resultado.dados });
  }

  // ── CRIAR: uma unidade só, pelo formulário. Passa pelas MESMAS regras da planilha. ────────
  //
  // ⚠️ MESMA VALIDAÇÃO DE PROPÓSITO. Um formulário com regra própria divergiria da planilha na
  // primeira mudança, e aí a mesma unidade seria aceita por um caminho e recusada pelo outro.
  if (corpo.acao === "criar") {
    if (!corpo.unidade) return NextResponse.json({ error: "Unidade não informada." }, { status: 400 });

    const conferencia = await conferirImportacao({ enterpriseId, linhas: [corpo.unidade] });
    if (!conferencia.ok) return NextResponse.json({ error: conferencia.erro }, { status: 503 });

    const erros = conferencia.dados.problemas.filter((p) => !p.soAviso);
    if (erros.length > 0) {
      return NextResponse.json(
        { data: { problemas: conferencia.dados.problemas }, error: erros[0]!.motivo },
        { status: 400 },
      );
    }

    if (conferencia.dados.jaExistem.length > 0) {
      const j = conferencia.dados.jaExistem[0]!;
      return NextResponse.json(
        { error: `A quadra ${j.quadra} lote ${j.lote} já existe neste empreendimento.` },
        { status: 409 },
      );
    }

    const envio = await importarUnidades({
      enterpriseId,
      prefixo: corpo.prefixo?.trim() || prefixoSugerido(conferencia.dados.empreendimento.code),
      unidades: conferencia.dados.prontas,
    });

    if (!envio.ok) return NextResponse.json({ error: envio.erro }, { status: 503 });

    if (envio.dados.criadas === 0) {
      const falha = envio.dados.falhas[0];
      return NextResponse.json(
        { data: envio.dados, error: falha?.erro ?? "O C2X não criou a unidade." },
        { status: 502 },
      );
    }

    return NextResponse.json({ data: envio.dados });
  }

  // ── IMPORTAR: o lote inteiro. ────────────────────────────────────────────────────────────
  if (corpo.acao === "importar") {
    const linhas = Array.isArray(corpo.linhas) ? corpo.linhas : [];
    if (linhas.length === 0) {
      return NextResponse.json({ error: "A planilha veio vazia." }, { status: 400 });
    }

    // ⚠️ RECONFERE NO SERVIDOR, sem confiar no que a tela mandou. A tela envia as linhas cruas de
    // novo (e não a lista já aprovada) justamente para que a validação e a checagem de
    // duplicidade rodem AGORA: entre a conferência e o clique, alguém pode ter criado a unidade
    // pela tela do C2X.
    const conferencia = await conferirImportacao({ enterpriseId, linhas });
    if (!conferencia.ok) return NextResponse.json({ error: conferencia.erro }, { status: 503 });

    if (conferencia.dados.prontas.length === 0) {
      return NextResponse.json(
        { data: conferencia.dados, error: "Nenhuma unidade para importar." },
        { status: 400 },
      );
    }

    const envio = await importarUnidades({
      enterpriseId,
      prefixo: corpo.prefixo?.trim() || prefixoSugerido(conferencia.dados.empreendimento.code),
      unidades: conferencia.dados.prontas,
    });

    if (!envio.ok) return NextResponse.json({ error: envio.erro }, { status: 503 });

    return NextResponse.json({ data: envio.dados });
  }

  return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
}

/** O destino e o modelo de planilha, para a tela montar a orientação sem chutar. */
export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  // `conferirPlanilha` entra aqui só para o modelo sair com as MESMAS colunas que a validação
  // espera — se alguém acrescentar uma coluna lá, o modelo acompanha sozinho.
  const exemplo = conferirPlanilha([
    { area: "1000,00", lote: "01", matricula: "25.862", quadra: "01", status: "Disponível", tipo: "Unidade interna", valor: "140401,00" },
  ]);

  return NextResponse.json({
    data: {
      destino: destinoDoC2x(),
      exemploValido: exemplo.unidades.length === 1,
    },
  });
}
