import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";
import { montarContratoDaProposta } from "@/lib/temis/contrato-da-proposta";
import {
  baseMudou,
  impressaoDaBase,
  variaveisAindaEmBranco,
} from "@/lib/temis/contrato-editado";
import { lerEdicao } from "@/lib/temis/contrato-editado-db";

// A PRÉVIA DO CONTRATO — a minuta publicada mais os dados da proposta, preenchidos.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar"*. E, na mesma manhã: *"garante então a construção
// para a gente emitir contratos, precisamos testar isso hoje"*.
//
// ⚠️ A PRÉVIA VEM ANTES DO PDF, E ANTES DE QUALQUER ENVIO. É o passo onde alguém confere se o
// contrato saiu certo — e é barato: HTML na tela, sem Chromium, sem gravar nada, sem gastar
// documento na plataforma de assinatura. Um contrato errado descoberto aqui custa um clique; o
// mesmo contrato descoberto depois de assinado custa um aditivo.
//
// ⚠️ ELA NÃO GRAVA NADA. Nenhuma linha em `temis_*`, nenhum arquivo no storage. Gerar prévia é uma
// LEITURA — e isso é o que permite gerá-la quantas vezes for preciso enquanto se ajusta a minuta,
// sem encher a base de rascunhos que ninguém vai olhar. Quem grava é
// `/api/temis/contrato/gerar`, e ele monta o contrato PELA MESMA FUNÇÃO — ver
// `lib/temis/contrato-da-proposta.ts`. É a única coisa que faz a conferência desta tela valer para
// o papel que sai do outro lado.
//
// ⚠️ E ELA DIZ O QUE FALTOU. `semValor` são as variáveis que o texto pedia e os dados não
// responderam; `avisos` são os dados que a proposta não tinha. As duas listas voltam para a tela
// porque a alternativa é a pessoa procurar `[cpf_cliente]` no meio de 50 mil caracteres — e porque
// `semValor` é o que BLOQUEIA a geração do documento do outro lado.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    minutaId?: unknown;
    propostaId?: unknown;
  };
  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId : "";
  if (!propostaId) {
    return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const montado = await montarContratoDaProposta(sb, {
    minutaId: typeof corpo.minutaId === "string" ? corpo.minutaId : "",
    propostaId,
  });

  if (!montado.ok) {
    return NextResponse.json({ erro: montado.erro }, { status: montado.status });
  }

  // ⚠️ A EDIÇÃO VIGENTE SÓ APARECE PARA QUEM PODE EMITIR. Esta rota autoriza com o papel de
  // LEITURA, porque conferir contrato é de todo mundo — inclusive do comercial no portal da
  // Gurgel. Mas o texto alterado à mão é rascunho do jurídico, ainda não emitido: mostrá-lo lá
  // faria o comercial ler como "o contrato" uma cláusula que ainda está sendo escrita.
  //
  // ⚠️ E É UMA SEGUNDA CHECAGEM, NÃO UMA SEGUNDA TRAVA: quem fecha a edição é a própria rota
  // `/api/temis/contrato/edicao`. Aqui só se decide o que a resposta carrega.
  const podeEmitir = (await autorizarEmissaoDeContrato(request)).ok;
  const edicao = podeEmitir ? await lerEdicao(sb, propostaId) : null;

  // ⚠️ O QUE FALTA É MEDIDO NO TEXTO QUE VAI VIRAR PAPEL. Com uma alteração manual salva, a
  // lista da montagem deixa de valer: quem digitou o CPF por cima do `[cpf_cliente]` preencheu
  // o contrato. Manter a lista velha faria a tela apontar em vermelho um buraco que não existe
  // mais — e, pior, discordar da trava da geração, que já mede o texto final.
  const semValor = edicao
    ? variaveisAindaEmBranco(edicao.html, montado.semValor)
    : montado.semValor;

  return NextResponse.json({
    avisos: montado.avisos,
    // A impressão da base VOLTA COM A PRÉVIA e volta no salvamento: é a foto do contrato que a
    // pessoa realmente tinha na tela quando começou a escrever. Ver `contrato-editado.ts`.
    baseImpressao: podeEmitir ? impressaoDaBase(montado.html) : undefined,
    edicao: edicao
      ? {
          atualizadoEm: edicao.atualizadoEm,
          // ⚠️ A COMPARAÇÃO É FEITA AQUI, e não na tela: o HTML da base tem dezenas de milhares
          // de caracteres e mandar os dois para o navegador comparar dobraria a resposta.
          baseMudou: baseMudou(edicao, montado.html),
          editadoPorNome: edicao.editadoPorNome,
          html: edicao.html,
        }
      : null,
    html: montado.html,
    minuta: montado.minuta,
    semValor,
    vezesDoLaco: montado.vezesDoLaco,
  });
}
