import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirConfiguracao, pareceSandbox } from "@/lib/assinatura/clicksign/cliente";
import { enviarContratoParaAssinatura, prepararEnvio } from "@/lib/assinatura/envio-db";
import { descreverRegra, lerRegraDeOrdem, type RegraDeOrdem } from "@/lib/assinatura/ordem";
import type { AmbienteDoEnvio, RespostaDoEnvio, RespostaDoPreparo } from "@/lib/assinatura/preparo";
import { rotuloDoPapel } from "@/lib/assinatura/tipos";
import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";

// MANDAR O CONTRATO PARA ASSINATURA — o passo depois de gerar.
//
//   GET  ?proposta=…   o que vai ser enviado: quem assina, em que ordem, e o que impede.
//   POST               envia de verdade.
//
// ⚠️ O GET EXISTE PARA QUE NINGUÉM DESCUBRA DEPOIS DE CLICAR. A conta da Clicksign é de PRODUÇÃO
// (Lucas, 08/09/2026 — o sandbox deles está com problema), cada envelope tem custo e, uma vez
// ativado, NÃO SE APAGA. A tela mostra a lista de signatários, a ordem e a origem dela ANTES de
// existir envelope; sem isso, o primeiro clique seria também a primeira conferência.
//
// ⚠️ O POST USA O MESMO PORTÃO DE EMITIR CONTRATO (`autorizarEmissaoDeContrato`), e não a leitura.
// Mandar para assinatura é mais grave do que gerar: gerar produz um PDF numa gaveta, enviar põe o
// documento na mão do comprador e começa a contar prazo. O GET fica no mesmo recorte de propósito —
// ele lista e-mail de comprador e cônjuge, que é dado de pessoa, e quem não pode enviar não precisa
// da lista.
//
// ⚠️ E A RESPOSTA DIZ QUAL AMBIENTE. Um contrato assinado no sandbox não tem validade jurídica, e a
// API responde 200 igual nos dois. O aviso viaja junto para a tela poder gritar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O envio são até 16 chamadas HTTP (1 envelope + 1 upload + 2 por signatário + ativar + notificar),
// e o upload leva o PDF inteiro em base64. O teto alto é o que evita o "erro de JSON na tela" que um
// timeout da Vercel produz.
export const maxDuration = 120;

export async function GET(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ erro: "Informe a proposta." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  const preparo = await prepararEnvio(sb, propostaId);
  if (!preparo.ok) return NextResponse.json({ erro: preparo.erro }, { status: preparo.status });

  return NextResponse.json(
    { data: corpoDaResposta(preparo) },
    // ⚠️ `no-store`: a resposta lista e-mail e nome de comprador e cônjuge.
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const autorizacao = await autorizarEmissaoDeContrato(request);
  if (!autorizacao.ok) return autorizacao.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    emails?: unknown;
    mensagem?: unknown;
    ordem?: unknown;
    prazoEmDias?: unknown;
    propostaId?: unknown;
    semCpf?: unknown;
  };

  const propostaId = typeof corpo.propostaId === "string" ? corpo.propostaId.trim() : "";
  if (!propostaId) return NextResponse.json({ erro: "Sem proposta." }, { status: 400 });

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // ⚠️ SEM CHAVE, NEM COMEÇA. `chamar` já recusaria, mas só na primeira chamada — e a essa altura a
  // linha de registro já teria nascido. Aqui a resposta diz a causa mais provável, que é a armadilha
  // do "Sensitive" da Vercel: a variável existe no painel e chega VAZIA na função, sem erro nenhum
  // ([[reference_vercel_env_sensitive]]).
  const chaves = conferirConfiguracao();
  if (chaves.faltando.includes("CLICKSIGN_API_BASE_URL") || chaves.faltando.includes("CLICKSIGN_TOKEN_API")) {
    return NextResponse.json(
      {
        erro:
          `A Clicksign não está configurada: falta ${chaves.faltando.join(", ")}. ` +
          "⚠️ Confira se as variáveis não estão marcadas como 'Sensitive' na Vercel — assim elas chegam vazias, sem erro.",
      },
      { status: 503 },
    );
  }

  // ⚠️ A ORDEM ESCOLHIDA VALE SÓ PARA ESTE ENVIO. Ela NÃO é gravada em
  // `apolo_enterprise_settings` nem em `temis_categorias`: quem muda o cadastro é a aba Setup do
  // empreendimento. Lucas, 08/09/2026: *"claro que temos que ter a opção de alterar antes de enviar
  // o contrato, mas vem preenchido por padrão"* — alterar antes de enviar é uma exceção daquele
  // contrato, e transformá-la na política do empreendimento inteiro seria um efeito colateral que
  // ninguém pediu.
  //
  // ⚠️ E ELA PASSA POR `lerRegraDeOrdem`, o mesmo saneador do jsonb do banco: papel que o código não
  // conhece é descartado e o que falta é completado, em vez de a lista do navegador entrar crua.
  const ordemEscolhida: null | RegraDeOrdem =
    corpo.ordem && typeof corpo.ordem === "object" ? lerRegraDeOrdem(corpo.ordem) : null;

  // ⚠️ O E-MAIL TROCADO NA TELA VALE SÓ PARA ESTE ENVIO, como a ordem — não volta para a ficha do
  // cliente. Lucas, 09/09/2026: *"coloca o meu e-mail e da nivea"*, com os do ZZ TESTE sendo
  // fictícios; num contrato de verdade é o comprador que deu o e-mail errado no cadastro, e
  // corrigir a ficha é outro gesto, em outra tela, feito por quem cuida do cadastro.
  //
  // ⚠️ E ENTRA SANEADO: só chave e valor de texto, e o valor precisa PARECER e-mail. Um objeto
  // solto do navegador viraria e-mail inventado dentro de um envelope que não se apaga.
  const emailsEscolhidos = lerEmailsEscolhidos(corpo.emails);

  const enviado = await enviarContratoParaAssinatura(sb, {
    emailsEscolhidos,
    semCpf: corpo.semCpf === true,
    ordemEscolhida,
    propostaId,
    usuarioId: autorizacao.userId,
    usuarioNome: await nomeDoUsuario(sb, autorizacao.userId),
    ...(typeof corpo.mensagem === "string" && corpo.mensagem.trim()
      ? { mensagem: corpo.mensagem.trim() }
      : {}),
    ...(typeof corpo.prazoEmDias === "number" && corpo.prazoEmDias > 0
      ? { prazoEmDias: corpo.prazoEmDias }
      : {}),
  });

  // ⚠️ O CORPO DE ERRO LEVA `envelopeAtivo` QUANDO SOBROU ENVELOPE NA CONTA, e é o único jeito de a
  // tela saber que o botão NÃO pode voltar. Sem este campo ela dependeria de reconhecer a frase da
  // recusa, e a frase é redação: o desfecho em que o rascunho não pôde ser apagado não diz "ficou
  // ativo", e o dourado voltava vivo com um envelope pago do lado de lá.
  //
  // ⚠️ E ELE SÓ VAI COMO `true`. A tela compara com `=== true`; mandar `false` nos desfechos em que
  // nada ficou na conta funciona hoje e depende de uma comparação que ninguém garante amanhã.
  if (!enviado.ok) {
    return NextResponse.json(
      {
        erro: enviado.erro,
        ...(enviado.envelopeAtivo ? { envelopeAtivo: true } : {}),
      },
      { status: enviado.status },
    );
  }

  // ⚠️ TIPADO PELO MESMO ARQUIVO QUE A TELA LÊ. Este corpo chega numa tela que acabou de fazer algo
  // irreversível: se um campo sumir daqui, a confirmação do envelope pago aparece vazia — e o
  // `envelopeId`, que é o número que o suporte da Clicksign pede, é justamente o que se perde.
  const data: RespostaDoEnvio = {
    ...ambiente(),
    envelopeId: enviado.envelopeId,
    nome: enviado.nome,
    registroId: enviado.registroId,
    signatarios: enviado.signatarios.map((s) => ({
      email: s.email,
      nome: s.nome,
      ordem: s.ordem,
      papel: s.papel,
      papelRotulo: rotuloDoPapel(s.papel),
    })),
  };

  return NextResponse.json({ data });
}

/**
 * O que a tela mostra antes de confirmar.
 *
 * ⚠️ O TIPO DE RETORNO É DECLARADO, E NÃO INFERIDO. Enquanto ele era inferido, a tela carregava uma
 * cópia do tipo escrita à mão — e as duas divergiram sem ninguém notar: faltavam `contrato.unidadeId`
 * e `ordem.origem` do lado do navegador. `RespostaDoPreparo` (`lib/assinatura/preparo.ts`) é agora a
 * única descrição, e é ela que quebra o build quando um campo muda de um lado só.
 *
 * ⚠️ E O AMBIENTE ENTRA AQUI DENTRO, em vez de ser espalhado pelo chamador. Ele faz parte do que a
 * tela precisa saber ANTES de confirmar (sandbox e chave faltando param o botão), e deixá-lo de fora
 * do corpo era o que permitia uma resposta sair sem ele.
 */
function corpoDaResposta(
  preparo: Extract<Awaited<ReturnType<typeof prepararEnvio>>, { ok: true }>,
): RespostaDoPreparo {
  return {
    ...ambiente(),
    avisos: preparo.avisos,
    contrato: preparo.contrato,
    // A frase que diz se alguém tem de corrigir cadastro antes. `null` = dá para enviar.
    impedimento: preparo.impedimento,
    ordem: {
      descricao: descreverRegra(preparo.regra, rotuloDoPapel),
      ordenada: preparo.regra.ordenada,
      origem: preparo.origemDaRegra,
      origemDescrita: preparo.origemDescrita,
      papeis: preparo.regra.papeis,
    },
    signatarios: preparo.signatarios.map((s) => ({
      email: s.email,
      nome: s.nome,
      ordem: s.ordem,
      papel: s.papel,
      papelRotulo: rotuloDoPapel(s.papel),
    })),
  };
}

/**
 * Os e-mails escolhidos na tela, saneados — `null` quando não veio nada aproveitável.
 *
 * ⚠️ NÃO CONFIA NO NAVEGADOR. Chave e valor têm de ser texto, e o valor tem de parecer e-mail:
 * o destino disso é um envelope de produção que não se apaga, com o nome de um comprador de
 * verdade. Um `{}` ou um objeto aninhado vindo daqui não pode virar signatário.
 *
 * ⚠️ A CONFERÊNCIA DE VERDADE CONTINUA SENDO `conferirSignatarios`, lá no preparo — é ela que
 * recusa e-mail repetido entre titular e cônjuge. Esta função só garante que o que chega é do
 * formato certo, e não que o conjunto faz sentido.
 */
function lerEmailsEscolhidos(bruto: unknown): null | Record<string, string> {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto as Record<string, unknown>)) {
    if (typeof valor !== "string") continue;
    const email = valor.trim();
    // Simples de propósito: quem valida e-mail de verdade é a Clicksign, e uma regex ambiciosa
    // aqui recusaria endereço legítimo (`+`, subdomínio, TLD longo).
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    limpo[chave] = email;
  }
  return Object.keys(limpo).length > 0 ? limpo : null;
}

/**
 * Em que ambiente a conta aponta, e o que falta para conseguir enviar.
 *
 * ⚠️ SEM ISTO A TELA FICAVA MUDA NO CASO PIOR. A função só olhava `pareceSandbox`, e com a env
 * ausente o ambiente é `null`, `pareceSandbox(null)` é `false` e o aviso saía `null`: a tela não
 * dizia nada, o botão ficava habilitado, e o operador só descobria no 503 — DEPOIS de confirmar um
 * ato que ele acabou de ler que é irreversível. A pergunta "dá para enviar?" tem de ser respondida
 * no GET, que é quando ainda não custou nada.
 *
 * ⚠️ E A CAUSA MAIS PROVÁVEL VAI ESCRITA NA FRASE, porque ela não se deduz: variável marcada como
 * "Sensitive" na Vercel EXISTE no painel e chega VAZIA no runtime, sem erro nenhum. Foi o que
 * aconteceu com cinco chaves do Asaas ([[reference_vercel_env_sensitive]]), e quem lê "falta
 * CLICKSIGN_TOKEN_API" olhando para a variável preenchida no painel conclui que o erro é nosso.
 *
 * ⚠️ `CLICKSIGN_WEBHOOK_SECRET` FICA DE FORA da lista que bloqueia. Sem ela o contrato SAI; o que
 * não acontece é ele VOLTAR sozinho — o webhook chega e é recusado, e o estado congela em
 * "aguardando" aqui enquanto o cliente já assinou lá. Bloquear o envio por causa de atualização de
 * status seria parar a venda pelo motivo errado.
 */
function ambiente(): AmbienteDoEnvio {
  const cfg = conferirConfiguracao();
  const pendentes = cfg.faltando.filter((nome) => nome !== "CLICKSIGN_WEBHOOK_SECRET");

  const frases: string[] = [];
  if (pendentes.length > 0) {
    frases.push(
      `⚠️ A Clicksign não está configurada: falta ${pendentes.join(", ")}. Enviar daqui não vai funcionar. ` +
        'Confira se a variável não está marcada como "Sensitive" na Vercel — assim ela aparece preenchida no painel e chega VAZIA na função, sem erro nenhum.',
    );
  }
  if (pareceSandbox(cfg.ambiente)) {
    frases.push("⚠️ A base URL aponta para SANDBOX. Contrato assinado daqui não tem validade jurídica.");
  }

  return {
    ambiente: cfg.ambiente,
    avisoDeAmbiente: frases.length > 0 ? frases.join(" ") : null,
    configuracaoPendente: pendentes.length > 0 ? pendentes : null,
  };
}

/**
 * O nome de quem mandou, para a linha de registro.
 *
 * ⚠️ FALHA VIRA `null` E NUNCA DERRUBA O ENVIO — mesma disciplina da rota de gerar. Um contrato sem
 * autor no registro é ruim; um contrato que não sai porque a consulta do nome falhou é pior.
 */
async function nomeDoUsuario(
  sb: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  userId: string,
): Promise<null | string> {
  try {
    const { data } = await sb
      .from("hub_users")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    return (data as null | { display_name: null | string })?.display_name ?? null;
  } catch {
    return null;
  }
}
