import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirConfiguracao, pareceSandbox } from "@/lib/assinatura/clicksign/cliente";
import { enviarContratoParaAssinatura, prepararEnvio } from "@/lib/assinatura/envio-db";
import { descreverRegra, gruposDaRegra, lerRegraDeOrdem, type RegraDeOrdem } from "@/lib/assinatura/ordem";
import type { AmbienteDoEnvio, RespostaDoEnvio, RespostaDoPreparo } from "@/lib/assinatura/preparo";
import { rotuloDoPapel } from "@/lib/assinatura/tipos";

import type { UsoDoAlcance } from "./alcance-da-estrutura";
import type { AtorDaTemis } from "./ator";
import {
  type Alcance,
  alcanceDaProposta,
  alcanceDaPropostaPara,
  alcanceDaPropostaParaEscrever,
  autorDoAto,
  registrarAtoDoPortal,
  respostaDoAlcance,
} from "./contrato-servico";
import { reenviarConvite, trocarEmailDoSignatario } from "./trocar-signatario";

// A ASSINATURA DO CONTRATO, PARA QUEM ESTIVER OPERANDO — preparar, enviar e consertar signatário.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio manda os contratos que ela confecciona para
// assinatura *pela Clicksign da conta da Careli*, com registro de quem enviou. A conta é a MESMA
// (`lib/assinatura/clicksign/*`, as mesmas chaves): não existe "Clicksign do portal". O que o
// portal ganha é a porta, o recorte e o nome dele no registro.
//
// ⚠️ UM CÓDIGO SÓ, pelo mesmo motivo de `contrato-servico.ts`, e aqui ele pesa mais: a conta é de
// PRODUÇÃO, cada envelope custa e NÃO SE APAGA. A guarda contra o segundo envelope, a conferência de
// e-mail repetido e a leitura do envelope no nosso banco antes de falar com a Clicksign moram em
// `lib/assinatura/envio-db.ts` e `lib/temis/trocar-signatario.ts`; uma cópia da rota para o portal
// seria a primeira a esquecer uma delas.
//
// ⚠️ O RECORTE É DA PROPOSTA, E O DO ENVELOPE PASSA POR ELA. O id do envelope vem do corpo do POST;
// antes de qualquer chamada à Clicksign ele é traduzido na proposta dele, e a proposta passa por
// `alcanceDaProposta`. Sem isso, um envelope da Gurgel (contrato da Careli) teria signatário removido
// por alguém de fora, dentro da conta da Careli.
//
// ⚠️ MANDAR ASSINAR E CONSERTAR SIGNATÁRIO SÃO ESCRITA (decisão do Lucas, 16/09/2026: escrita só no
// que a Cecílio opera). Os dois passam por `alcanceDaPropostaParaEscrever`: a venda do portal num
// produto que ele só consulta responde 403 só consulta antes de qualquer chamada à Clicksign. O
// preparo (GET) continua sendo leitura.
//
// ⚠️ O DIAGNÓSTICO NÃO TEM PORTA NO PORTAL. `/api/temis/assinatura/diagnostico` descreve a
// configuração da integração da Careli (nomes das chaves, base URL) e dispara uma sonda de várias
// chamadas contra a conta de produção a cada pedido. O que o portal precisa saber antes de enviar
// (sandbox, chave faltando) já volta no GET do envio (`ambiente()`), sem sonda.

// ── O ALCANCE DO ENVELOPE ───────────────────────────────────────────────────

/**
 * O envelope (id da Clicksign) está no alcance deste ator?
 *
 * Hub: sempre, sem consulta — `trocar-signatario.ts` continua fazendo a leitura dele, como sempre.
 *
 * Portal: o envelope precisa estar registrado em `temis_envelopes` com UMA proposta só, e essa
 * proposta precisa estar no alcance. Envelope sem proposta (o registro antigo, o `on delete set
 * null`) não tem dono conferível: fica fora.
 *
 * `uso: "escrever"` (consertar signatário) aplica à proposta a régua de quem opera o produto.
 */
export async function alcanceDoEnvelope(
  sb: SupabaseClient,
  ator: AtorDaTemis,
  envelopeId: string,
  uso: UsoDoAlcance = "ler",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const alvo = typeof envelopeId === "string" ? envelopeId.trim() : "";
  if (!alvo) return "fora";

  const { data, error } = await sb
    .from("temis_envelopes")
    .select("proposta_id")
    .eq("envelope_id", alvo)
    .limit(20);

  if (error) {
    console.error("[temis][portal] falha ao conferir o envelope", error);
    return "indisponivel";
  }

  const linhas = (data ?? []) as Array<{ proposta_id: null | string }>;
  const propostas = new Set(linhas.map((l) => String(l.proposta_id ?? "").trim()));

  // ⚠️ UMA PROPOSTA E SÓ UMA. Linha sem proposta, ou o mesmo id apontando para duas vendas, é um
  // registro que não dá para atribuir — e o que não dá para atribuir não é do portal.
  if (linhas.length === 0 || propostas.size !== 1 || propostas.has("")) return "fora";

  const [propostaId] = [...propostas];
  return alcanceDaPropostaPara(uso)(sb, ator, propostaId ?? "");
}

// ── O PREPARO E O ENVIO ─────────────────────────────────────────────────────

/** GET `?proposta=` — quem assina, em que ordem, e o que impede. Nada é criado na Clicksign. */
export async function preparoDoEnvio(ator: AtorDaTemis, request: Request): Promise<NextResponse> {
  const propostaId = (new URL(request.url).searchParams.get("proposta") ?? "").trim();
  if (!propostaId) {
    return NextResponse.json({ erro: "Informe a proposta." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // ⚠️ A LISTA TEM E-MAIL E NOME DE COMPRADOR E CÔNJUGE: o recorte vem antes da leitura.
  const recusa = respostaDoAlcance(await alcanceDaProposta(sb, ator, propostaId));
  if (recusa) return recusa;

  const preparo = await prepararEnvio(sb, propostaId);
  if (!preparo.ok) return NextResponse.json({ erro: preparo.erro }, { status: preparo.status });

  return NextResponse.json(
    { data: corpoDaResposta(preparo) },
    // ⚠️ `no-store`: a resposta lista e-mail e nome de comprador e cônjuge.
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** POST `{ propostaId, emails?, mensagem?, ordem?, prazoEmDias?, semCpf? }` — envia de verdade. */
export async function enviarContratoDoAtor(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
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

  // ⚠️ NO PORTAL, SÓ O CONTRATO QUE ELE CONFECCIONA — antes da conferência de chaves, antes do
  // registro, antes do PDF. É o ato mais caro da casa, feito com a conta da Careli. E só no produto
  // que o portal opera.
  const recusa = respostaDoAlcance(await alcanceDaPropostaParaEscrever(sb, ator, propostaId));
  if (recusa) return recusa;

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
  // o contrato, mas vem preenchido por padrão"*.
  //
  // ⚠️ E ELA PASSA POR `lerRegraDeOrdem`, o mesmo saneador do jsonb do banco: papel que o código não
  // conhece é descartado e o que falta é completado, em vez de a lista do navegador entrar crua.
  const ordemEscolhida: null | RegraDeOrdem =
    corpo.ordem && typeof corpo.ordem === "object" ? lerRegraDeOrdem(corpo.ordem) : null;

  // ⚠️ O E-MAIL TROCADO NA TELA VALE SÓ PARA ESTE ENVIO, como a ordem — não volta para a ficha do
  // cliente. E ENTRA SANEADO: só chave e valor de texto, e o valor precisa PARECER e-mail.
  const emailsEscolhidos = lerEmailsEscolhidos(corpo.emails);

  // ⚠️ O AUTOR SAI DO ATOR, E VAI PARA O REGISTRO DO ENVELOPE E PARA A PASSAGEM DE ETAPA. No portal,
  // `enviado_por` é o usuário do portal e `enviado_por_nome` diz a origem (ver `autorDoAto`): é o
  // "registro de quem enviou" que o Lucas pediu para os envios feitos com a conta da Careli.
  const autor = autorDoAto(ator);

  const enviado = await enviarContratoParaAssinatura(sb, {
    emailsEscolhidos,
    semCpf: corpo.semCpf === true,
    ordemEscolhida,
    propostaId,
    usuarioId: autor.id,
    usuarioNome: autor.nome,
    ...(typeof corpo.mensagem === "string" && corpo.mensagem.trim()
      ? { mensagem: corpo.mensagem.trim() }
      : {}),
    ...(typeof corpo.prazoEmDias === "number" && corpo.prazoEmDias > 0
      ? { prazoEmDias: corpo.prazoEmDias }
      : {}),
  });

  // ⚠️ O CORPO DE ERRO LEVA `envelopeAtivo` QUANDO SOBROU ENVELOPE NA CONTA, e é o único jeito de a
  // tela saber que o botão NÃO pode voltar. E ELE SÓ VAI COMO `true`: a tela compara com `=== true`.
  if (!enviado.ok) {
    registrarAtoDoPortal(ator, "tentou mandar o contrato para assinatura e falhou", {
      envelopeAtivo: enviado.envelopeAtivo === true,
      propostaId,
      status: enviado.status,
    });
    return NextResponse.json(
      {
        erro: enviado.erro,
        ...(enviado.envelopeAtivo ? { envelopeAtivo: true } : {}),
      },
      { status: enviado.status },
    );
  }

  registrarAtoDoPortal(ator, "mandou o contrato para assinatura", {
    envelopeId: enviado.envelopeId,
    propostaId,
    registroId: enviado.registroId,
  });

  // ⚠️ TIPADO PELO MESMO ARQUIVO QUE A TELA LÊ. Este corpo chega numa tela que acabou de fazer algo
  // irreversível: se um campo sumir daqui, a confirmação do envelope pago aparece vazia — e o
  // `envelopeId`, que é o número que o suporte da Clicksign pede, é justamente o que se perde.
  const data: RespostaDoEnvio = {
    ...ambiente(),
    ...(enviado.avisoDoHercules ? { avisoDoHercules: enviado.avisoDoHercules } : {}),
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

// ── O SIGNATÁRIO DE ENVELOPE JÁ ENVIADO ─────────────────────────────────────

/**
 * POST `{ acao: "reenviar", envelopeId, signerId }` ou `{ acao: "trocar_email", email, envelopeId,
 * signerId }`.
 *
 * Ver o cabeçalho de `app/api/temis/assinatura/signatario/route.ts` para o porquê de cada recusa.
 */
export async function consertarSignatario(
  ator: AtorDaTemis,
  request: Request,
): Promise<NextResponse> {
  const corpo = (await request.json().catch(() => ({}))) as {
    acao?: unknown;
    email?: unknown;
    envelopeId?: unknown;
    signerId?: unknown;
  };

  const envelopeId = texto(corpo.envelopeId);
  const signerId = texto(corpo.signerId);
  if (!envelopeId) return NextResponse.json({ erro: "Sem envelope." }, { status: 400 });
  if (!signerId) return NextResponse.json({ erro: "Sem signatário." }, { status: 400 });

  // ⚠️ O SUPABASE NÃO É ENFEITE AQUI, E NÃO DÁ PARA PULÁ-LO. As duas ações leem `temis_envelopes`
  // pelo `envelope_id` ANTES de falar com a Clicksign, e é essa leitura que prova que o id vindo do
  // navegador é de um envelope NOSSO. A conta da Clicksign é de PRODUÇÃO, com contratos de outras
  // vendas dentro.
  const sb = createApoloAdminClient();
  if (!sb) return NextResponse.json({ erro: "Supabase indisponível." }, { status: 503 });

  // ⚠️ E NO PORTAL O ENVELOPE PRECISA SER DE UMA PROPOSTA DELE. "É nosso" (da conta da Careli) não
  // basta para quem é de fora: `trocar_email` REMOVE uma pessoa de um envelope pago.
  const recusa = respostaDoAlcance(await alcanceDoEnvelope(sb, ator, envelopeId, "escrever"));
  if (recusa) return recusa;

  if (corpo.acao === "reenviar") {
    const reenvio = await reenviarConvite(sb, { envelopeId, signerId });
    if (!reenvio.ok) {
      return NextResponse.json({ erro: reenvio.erro }, { status: reenvio.status });
    }
    registrarAtoDoPortal(ator, "reenviou o convite de assinatura", { envelopeId, signerId });
    return NextResponse.json({ data: { aviso: null, signerId } });
  }

  if (corpo.acao === "trocar_email") {
    const email = texto(corpo.email);
    // ⚠️ CONFERIDO AQUI ANTES DE SAIR DAQUI, e o motivo é o que a ação faz: o primeiro passo da
    // troca é REMOVER a pessoa do envelope. Um endereço vazio ou torto vindo do navegador tiraria
    // o signatário e falharia no passo seguinte, deixando o envelope de produção com uma pessoa a
    // menos e ninguém para assinar no lugar dela.
    //
    // ⚠️ A REGRA É SIMPLES DE PROPÓSITO, a mesma do envio (`lerEmailsEscolhidos`): quem valida
    // e-mail de verdade é a Clicksign, e uma regex ambiciosa aqui recusaria endereço legítimo.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ erro: "Informe um e-mail válido." }, { status: 400 });
    }

    const troca = await trocarEmailDoSignatario(sb, { email, envelopeId, signerId });

    if (!troca.ok) {
      // ⚠️ `removido` SOBE JUNTO COM O ERRO, e é a diferença entre duas falhas que não se parecem em
      // nada: antes da remoção o envelope está inteiro; depois dela há uma pessoa FORA de um
      // contrato que não fecha mais sozinho.
      registrarAtoDoPortal(ator, "tentou trocar o e-mail de um signatário e falhou", {
        envelopeId,
        removido: troca.removido,
        signerId,
      });
      return NextResponse.json({ erro: troca.erro, removido: troca.removido }, { status: troca.status });
    }

    registrarAtoDoPortal(ator, "trocou o e-mail de um signatário", {
      envelopeId,
      signerIdAntigo: signerId,
      signerIdNovo: troca.signerId,
    });

    // ⚠️ `aviso` NÃO É ERRO, E RESPONDER 200 AQUI É O PONTO. O signatário novo JÁ ESTÁ no envelope,
    // com os dois requisitos: devolver erro faria o operador clicar em trocar de novo — e o segundo
    // clique REMOVERIA quem acabou de entrar.
    return NextResponse.json({
      data: { aviso: troca.aviso, email: troca.email, nome: troca.nome, signerId: troca.signerId },
    });
  }

  return NextResponse.json({ erro: "Ação desconhecida." }, { status: 400 });
}

// ── AS PEÇAS DA RESPOSTA ────────────────────────────────────────────────────

/** Campo de texto do corpo, já aparado. Qualquer outra coisa vira string vazia. */
function texto(bruto: unknown): string {
  return typeof bruto === "string" ? bruto.trim() : "";
}

/**
 * O que a tela mostra antes de confirmar.
 *
 * ⚠️ O TIPO DE RETORNO É DECLARADO, E NÃO INFERIDO. Enquanto ele era inferido, a tela carregava uma
 * cópia do tipo escrita à mão — e as duas divergiram sem ninguém notar. `RespostaDoPreparo`
 * (`lib/assinatura/preparo.ts`) é a única descrição, e é ela que quebra o build quando um campo muda
 * de um lado só.
 *
 * ⚠️ E O AMBIENTE ENTRA AQUI DENTRO, em vez de ser espalhado pelo chamador. Ele faz parte do que a
 * tela precisa saber ANTES de confirmar (sandbox e chave faltando param o botão).
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
      // A fila que a regra descreve, achatada: o corpo da resposta continua sendo uma LISTA de
      // papeis, porque e o que a tela desenha. O empate entre dois papeis some aqui e sobrevive
      // em `ordenarSignatarios`, que e quem numera de verdade.
      papeis: gruposDaRegra(preparo.regra).flat(),
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
 * verdade.
 *
 * ⚠️ A CONFERÊNCIA DE VERDADE CONTINUA SENDO `conferirSignatarios`, lá no preparo — é ela que
 * recusa e-mail repetido entre titular e cônjuge. Esta função só garante o formato.
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
 * ⚠️ SEM ISTO A TELA FICAVA MUDA NO CASO PIOR: com a env ausente o aviso saía `null`, o botão ficava
 * habilitado, e o operador só descobria no 503 — DEPOIS de confirmar um ato irreversível. A pergunta
 * "dá para enviar?" tem de ser respondida no GET, que é quando ainda não custou nada.
 *
 * ⚠️ E A CAUSA MAIS PROVÁVEL VAI ESCRITA NA FRASE, porque ela não se deduz: variável marcada como
 * "Sensitive" na Vercel EXISTE no painel e chega VAZIA no runtime, sem erro nenhum
 * ([[reference_vercel_env_sensitive]]).
 *
 * ⚠️ `CLICKSIGN_WEBHOOK_SECRET` FICA DE FORA da lista que bloqueia. Sem ela o contrato SAI; o que
 * não acontece é ele VOLTAR sozinho. Bloquear o envio por causa de atualização de status seria parar
 * a venda pelo motivo errado.
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
