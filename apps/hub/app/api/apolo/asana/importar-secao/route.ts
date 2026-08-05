import { NextResponse } from "next/server";

import {
  aplicarVinculos,
  asanaConfigurado,
  criarEntidadesDoLote,
  escanearCads,
  separarPorConflito,
  type EtapaImportacao,
} from "@/lib/apolo/asana-import";
import { acharCpfNoTexto } from "@/lib/apolo/asana-ocr";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lookupApoloByDocument } from "@/lib/iris/caca-agent";

// IMPORTAÇÃO DE UMA SEÇÃO INTEIRA do Asana para a esteira do Board.
//
// Diferente da tela de importação (que casa por NOME e depende de a pessoa já existir), este canal
// resolve a identidade pelo CPF ESCRITO NA CAD — o formulário do Asana pede o CPF, e achá-lo no
// texto é de graça. Com o CPF em mãos:
//
//   • pessoa nova            -> cria a entidade e a ficha na esteira;
//   • JÁ É COMPRADOR nosso   -> REAPROVEITA a entidade (nunca duplica a pessoa) e cria a ficha
//                               como prospect daquele empreendimento, com a nova imobiliária e o
//                               novo corretor. É o caso "comprador volta a comprar em outro
//                               lançamento", que a tela antiga não cobria;
//   • já tem ficha no MESMO empreendimento -> NÃO sobrescreve. Se a imobiliária for outra, isso é
//                               DISPUTA DE COMISSÃO: bloqueia e reporta, porque decidir de quem é
//                               o cliente é do negócio, não do importador.
//
// `dryRun: true` (padrão) não grava nada: devolve exatamente o que faria. Ver [[project_apolo]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Corpo = {
  analistaId?: string | null;
  dryRun?: boolean;
  empreendimento?: string;
  etapa?: EtapaImportacao;
  secao?: string;
};

const ETAPAS: EtapaImportacao[] = ["validacao", "credito", "credenciado"];

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json({ error: "Asana não configurado." }, { status: 503 });
  }
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as Corpo;
  const secao = (corpo.secao ?? "").trim();
  const empreendimento = (corpo.empreendimento ?? "").trim();
  const etapa = ETAPAS.includes(corpo.etapa as EtapaImportacao)
    ? (corpo.etapa as EtapaImportacao)
    : "validacao";
  // Só grava quando pedirem explicitamente: importar é irreversível na prática.
  const dryRun = corpo.dryRun !== false;

  if (!secao) {
    return NextResponse.json({ error: "Informe a seção do Asana." }, { status: 400 });
  }

  const { cads, secoesEncontradas } = await escanearCads({
    empreendimento,
    secoes: [secao],
  });

  if (cads.length === 0) {
    return NextResponse.json({
      data: {
        aviso: "Nenhuma CAD nessa seção com esse empreendimento.",
        secoesEncontradas,
        total: 0,
      },
    });
  }

  // 1) IDENTIDADE pelo CPF escrito na CAD. Sem CPF não dá para criar ficha com segurança: a
  // pessoa iria para o Board sem identificador, e duas homônimas viram a mesma.
  const comCpf: Array<{ cad: (typeof cads)[number]; cpf: string }> = [];
  const semCpf: string[] = [];
  for (const cad of cads) {
    const cpf = acharCpfNoTexto(cad.notas);
    if (cpf) comCpf.push({ cad, cpf });
    else semCpf.push(cad.nome);
  }

  // Resolve a identidade pelo CPF. O dry-run só CONSULTA — e precisa consultar, senão não teria
  // como mostrar os conflitos, que são o motivo de existir a simulação.
  const entidadePorCad: Record<string, string> = {};
  const pessoasNovas: string[] = [];
  for (const { cad, cpf } of comCpf) {
    const achada = await lookupApoloByDocument(client, cpf);
    if (achada?.entityId) entidadePorCad[cad.gid] = achada.entityId;
    else pessoasNovas.push(cad.nome);
  }

  // Na execução real, cria quem ainda não existe (e reaproveita quem já é cliente nosso).
  let criacao: Awaited<ReturnType<typeof criarEntidadesDoLote>>["resultado"] | null = null;
  if (!dryRun) {
    const r = await criarEntidadesDoLote({
      client,
      itens: comCpf.map(({ cad, cpf }) => ({
        conjuge: cad.conjuge,
        cpf,
        email: cad.email,
        empreendimento: cad.empreendimento,
        escolaridade: cad.escolaridade,
        estadoCivil: cad.estadoCivil,
        gid: cad.gid,
        imobiliaria: cad.imobiliaria,
        nome: cad.nomeProponente || cad.nome,
        profissao: cad.profissao,
        renda: cad.renda,
        telefone: cad.telefone,
      })),
      ownerUserId: auth.userId,
    });
    criacao = r.resultado;
    Object.assign(entidadePorCad, r.entidadePorCad);
  }

  // 3) CONFLITO: quem já tem ficha na esteira. A regra do negócio é que a mesma pessoa não pode
  // ser prospect duas vezes no mesmo empreendimento — ainda mais por imobiliárias diferentes.
  // A MESMA função é usada pela leitura de documentos: a regra mora num lugar só.
  const identificados = comCpf.filter(({ cad }) => entidadePorCad[cad.gid]);
  const { conflitos, liberados } = await separarPorConflito({
    client,
    itens: identificados.map(({ cad }) => ({
      empreendimento: cad.empreendimento,
      entityId: entidadePorCad[cad.gid]!,
      gid: cad.gid,
      imobiliaria: cad.imobiliaria,
      nome: cad.nome,
    })),
  });

  const paraVincular = identificados
    .filter(({ cad }) => liberados.has(cad.gid))
    .map(({ cad }) => ({
      corretor: cad.corretor,
      criadoEm: cad.criadoEm,
      email: cad.email,
      empreendimento: cad.empreendimento,
      entityId: entidadePorCad[cad.gid]!,
      gid: cad.gid,
      imobiliaria: cad.imobiliaria,
      secao: cad.secao,
      telefone: cad.telefone,
    }));

  const aplicacao = dryRun
    ? null
    : await aplicarVinculos({
        analistaId: corpo.analistaId ?? null,
        client,
        etapa,
        itens: paraVincular,
        porUsuario: auth.userId,
      });

  return NextResponse.json({
    data: {
      aplicacao,
      conflitos,
      criacao,
      dryRun,
      etapa,
      // O que dá para importar de graça vs o que precisa da leitura paga do documento.
      resumo: {
        comCpfNoTexto: comCpf.length,
        conflitos: conflitos.length,
        // Quem tem CPF na CAD mas ainda não existe no Apolo: seriam pessoas NOVAS.
        pessoasNovas: pessoasNovas.length,
        semCpf: semCpf.length,
        total: cads.length,
        vinculaveis: paraVincular.length,
      },
      secoesEncontradas,
      semCpf: semCpf.slice(0, 100),
    },
  });
}
