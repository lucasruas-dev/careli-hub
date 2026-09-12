"use client";

import { AlertTriangle, ArrowDown, ArrowUp, FileSignature, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ordenarSignatarios } from "@/lib/assinatura/ordem";
import type { CorpoDoEnvio, RespostaDoEnvio, RespostaDoPreparo } from "@/lib/assinatura/preparo";
import { chaveDoSignatario, type PapelNoContrato, rotuloDoPapel } from "@/lib/assinatura/tipos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A ORGANIZAÇÃO DA ASSINATURA — o trabalho da etapa "contrato", dentro da própria etapa.
//
// Lucas, 11/09/2026: *"nessa tela tem que vir a organizacao de assinatura (…) o que vamos fazer e
// validar a organizacao da assinatura, se tudo esta correto, ou se precisa fazer algum ajuste (…) ao
// clicar enviar para assinatura o contrato tem que ser enviado para click"*. E sobre gerar outra
// versão daqui: *"nao precisa, nessa etapa e para somente organizar as assinatura, caso queira fazer
// algum ajuste no contrato, podemos ter um botao para voltar o contrato a etapa anterior, corrigir e
// mandar para assinatura"*. Ou seja: esta etapa NÃO produz documento, ela CONFERE quem assina.
//
// ⚠️ ELE MORREU COMO MODAL DE PROPÓSITO. Isto era uma janela que abria por cima do quadro
// (`enviar-para-assinatura.tsx`, apagado junto com esta entrega), e o custo era o de sempre: quem
// conferia a lista de signatários não tinha o contrato na tela para conferir CONTRA. Aqui a lista
// vive ao lado do documento da etapa, que é onde a pergunta "está tudo certo?" pode ser respondida.
//
// ⚠️ E ELE É AUTOSSUFICIENTE. Quem o usa passa a proposta e recebe um aviso quando o envelope
// existir — nada mais. O preparo, os e-mails editados, a ordem, o impedimento e o próprio botão de
// enviar moram aqui dentro. Um componente irreversível cuja metade do estado vive no pai é um
// componente que a segunda tela a usá-lo vai montar errado.
//
// ⚠️ A PROPOSTA, NUNCA O CARD. Este é o defeito que a entrega conserta, e ele estava MEDIDO em
// produção: `tela-de-trabalho.tsx` mandava `card.id` para onde o destino espera `proposta_id`. O
// card 88a53e18 tem `proposta_id` 332315b6, e `hercules_documentos` tem DOIS contratos com
// `proposta_id = 332315b6` e ZERO com o id do card — por isso a tela respondia "Esta proposta ainda
// não tem contrato gerado" com o contrato aberto do lado. Dois ids uuid, nenhum erro de tipo, e uma
// mensagem que acusa o operador de não ter feito o que ele acabou de fazer.
//
// ⚠️ A CONTA DA CLICKSIGN É DE PRODUÇÃO (Lucas, 08/09/2026 — o sandbox deles está com problema).
// Cada envelope tem CUSTO e, depois de ativado, não se apaga: só se cancela, e o cancelado continua
// na lista. Tudo que dá para descobrir antes é mostrado antes.

/** Quem assina, com a ordem já resolvida e o rótulo do papel pronto para a tela. */
type NaTela = {
  email: string;
  nome: string;
  ordem: number;
  papel: PapelNoContrato;
  papelRotulo: string;
};

export function OrganizacaoDaAssinatura({
  aoEnviar,
  aoMudarEnvio,
  compacto = false,
  propostaId,
}: {
  /** Chamado DEPOIS de o envelope existir na Clicksign. Quem recebe fecha a tela e avisa o quadro. */
  aoEnviar?: (envelope: { envelopeId: string; nome: string }) => void;
  /**
   * O envio está no ar (`true`) ou acabou (`false`, inclusive quando falhou).
   *
   * ⚠️ O PAI PRECISA SABER, E ANTES ELE NÃO SABIA. O POST são até 16 chamadas HTTP com o PDF
   * inteiro em base64: leva de 40 a 90 segundos, e nesse intervalo a etapa continuava oferecendo
   * "Voltar para análise". O comparar-e-trocar do servidor PASSA, porque o card só sai de
   * "contrato" na última linha do envio — então o card voltava para Análise com o envelope a
   * caminho, e uma v2 gerada ali deixaria o comprador assinando a v1 enquanto o Panteon aponta a
   * v2 como a que vale. Quem desabilita o botão é o pai; este painel só avisa.
   */
  aoMudarEnvio?: (enviando: boolean) => void;
  /** Versão estreita, para a coluna de ~320px da etapa contrato. */
  compacto?: boolean;
  /** A PROPOSTA, nunca o card. Ver a nota do topo. */
  propostaId: null | string;
}) {
  const [preparo, setPreparo] = useState<null | RespostaDoPreparo>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviado, setEnviado] = useState<null | { envelopeId: string; nome: string }>(null);
  /**
   * O botão NÃO VOLTA: pode ter sobrado envelope na conta, e só quem olhar a Clicksign resolve.
   *
   * ⚠️ AQUI "ERRO DE JSON NA TELA" É TIMEOUT DA VERCEL, e não recusa da Clicksign
   * ([[reference_vercel_timeout_vira_erro_de_json]]). O POST são até 16 chamadas HTTP e a rota tem
   * `maxDuration 120`: quando o relógio vence, a função morre com o envelope possivelmente JÁ
   * CRIADO. Devolver o botão nesse estado seria convidar ao segundo envelope do mesmo contrato —
   * e os dois cobram. Por isso, sem resposta, o botão não volta: alguém confere a conta primeiro.
   *
   * ⚠️ E O SERVIDOR RESPONDER TAMBÉM PODE CAIR AQUI. Existe um desfecho em que o 502 diz, com
   * todas as letras, que "o envelope X ficou ATIVO na Clicksign e os convites NÃO saíram"
   * (`lib/assinatura/envio-db.ts`). Antes esse caminho só escrevia o erro e devolvia o botão — e
   * quem lê "os convites não saíram" conclui "então manda de novo", clica, e sai um SEGUNDO
   * envelope, este completo. Os dois cobram e nenhum se apaga. Falha do servidor e silêncio do
   * servidor terminam no mesmo lugar: ninguém clica de novo antes de conferir a conta.
   */
  const [precisaConferirNaClicksign, setPrecisaConferirNaClicksign] = useState(false);

  // A ordem editada NESTE envio. Nasce igual à do cadastro e nunca volta para lá.
  const [ordenada, setOrdenada] = useState(false);
  const [papeis, setPapeis] = useState<PapelNoContrato[]>([]);
  /** E-mails trocados na tela, por `chaveDoSignatario`. Vazio = vale o que veio da ficha. */
  const [emails, setEmails] = useState<Record<string, string>>({});
  /** Pedir CPF na assinatura. Ligado por padrão; desligar vale só para este envio. */
  const [pedirCpf, setPedirCpf] = useState(true);

  useEffect(() => {
    if (!propostaId) {
      setCarregando(false);
      return;
    }

    // ⚠️ A GUARDA `vivo` NÃO É CERIMÔNIA. Trocar de card enquanto o preparo do anterior está no ar
    // faria a resposta antiga chegar depois e pintar a tela com os signatários da OUTRA venda — com
    // o botão de enviar em cima deles.
    let vivo = true;
    setCarregando(true);
    setErro(null);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/temis/assinatura/enviar?proposta=${encodeURIComponent(propostaId)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await resposta.json()) as { data?: RespostaDoPreparo; erro?: string };
        if (!vivo) return;
        if (!resposta.ok || !payload.data) {
          setErro(payload.erro ?? "Não consegui montar o envio.");
          return;
        }
        setPreparo(payload.data);
        setOrdenada(payload.data.ordem.ordenada);
        setPapeis(payload.data.ordem.papeis);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não consegui montar o envio.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  /**
   * A lista com a ordem que o operador está vendo AGORA.
   *
   * ⚠️ RECALCULADA NO NAVEGADOR PELA MESMA FUNÇÃO DO SERVIDOR (`ordenarSignatarios`). Reimplementar
   * a numeração aqui — "o índice + 1" — daria uma tela que mostra 1,2,3 e um envelope que sai 1,1,2:
   * quem tem o mesmo papel assina JUNTO, e os números se compactam quando um papel não existe no
   * contrato. Duas contas para o mesmo número é a divergência que só aparece com o envelope já pago
   * na conta.
   */
  const emOrdem = useMemo<NaTela[]>(() => {
    if (!preparo) return [];
    const pessoas = preparo.signatarios.map((s) => ({
      email: s.email,
      nome: s.nome,
      papel: s.papel,
    }));
    return ordenarSignatarios(pessoas, { ordenada, papeis })
      .map((s) => ({ ...s, papelRotulo: rotuloDoPapel(s.papel) }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [ordenada, papeis, preparo]);

  const mover = useCallback((indice: number, direcao: -1 | 1) => {
    setPapeis((atual) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [movido] = copia.splice(indice, 1);
      if (movido) copia.splice(destino, 0, movido);
      return copia;
    });
  }, []);

  // Só os papéis que EXISTEM neste contrato aparecem para reordenar: mostrar "testemunha" e
  // "interveniente" num contrato que não tem nenhum dos dois é pedir para a pessoa arrumar uma fila
  // que não vai acontecer.
  const papeisPresentes = useMemo(() => {
    const presentes = new Set((preparo?.signatarios ?? []).map((s) => s.papel));
    return papeis.filter((p) => presentes.has(p));
  }, [papeis, preparo]);

  /** Quem recebe o convite AGORA, se a ordem estiver ligada. É o que a confirmação promete. */
  const primeiros = useMemo(
    () =>
      emOrdem
        .filter((s) => s.ordem === 1)
        .map((s) => s.nome)
        .join(", "),
    [emOrdem],
  );

  /**
   * Liga e desliga o "enviando" AQUI E NO PAI no mesmo gesto.
   *
   * ⚠️ OS DOIS ANDAM JUNTOS OU NÃO ANDAM. Dois `setEnviando(false)` espalhados pelos desfechos do
   * envio (sucesso, recusa, silêncio) é o jeito mais curto de esquecer um deles e deixar a etapa
   * com "Voltar para análise" travado para sempre — ou, pior, destravado enquanto o POST corre.
   */
  const marcarEnvio = useCallback(
    (noAr: boolean) => {
      setEnviando(noAr);
      aoMudarEnvio?.(noAr);
    },
    [aoMudarEnvio],
  );

  async function enviar() {
    if (!propostaId) return;
    setErro(null);
    marcarEnvio(true);
    try {
      const accessToken = await getApoloAccessToken();
      // ⚠️ `semCpf` VAI COMO `true` OU NÃO VAI. O servidor só liga a bandeira com `=== true`; mandar
      // `false` funciona hoje e depende de uma comparação que ninguém garante amanhã.
      const corpo: CorpoDoEnvio = {
        emails,
        ordem: { ordenada, papeis },
        propostaId,
        ...(pedirCpf ? {} : { semCpf: true }),
      };
      const resposta = await fetch("/api/temis/assinatura/enviar", {
        body: JSON.stringify(corpo),
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await resposta.json()) as {
        data?: RespostaDoEnvio;
        /**
         * ⚠️ O SERVIDOR DIZ SE SOBROU ENVELOPE, e este campo é a resposta dele — não é o `data`.
         * Vem no CORPO DE ERRO, ao lado do `erro`.
         */
        envelopeAtivo?: boolean;
        erro?: string;
      };
      if (!resposta.ok || !payload.data) {
        // ⚠️ O TEXTO É A REDE PARA O SERVIDOR ANTIGO. `envelopeAtivo` é novo; enquanto a versão em
        // produção não o mandar, a única pista de que ficou envelope na conta é a frase do 502
        // ("o envelope X ficou ATIVO na Clicksign"). Confiar só no campo faria a trava não existir
        // exatamente no dia do deploy, que é quando ela mais precisa existir.
        //
        // ⚠️ MAS A REDE É PARCIAL, E POR ISSO O CAMPO EXISTE. A frase com "ficou ativo" só sai no
        // passo `notificar`; quando o rascunho não pôde ser apagado, a recusa diz "pode ter ficado"
        // — envelope na conta do mesmo jeito, e a regex não o pega. O servidor desta mesma entrega
        // responde `envelopeAtivo` nos dois casos (`envio-db.ts`, `FalhaAoEnviar`).
        const sobrouEnvelope =
          payload.envelopeAtivo === true || /ficou ativo/i.test(payload.erro ?? "");
        if (sobrouEnvelope) setPrecisaConferirNaClicksign(true);
        setErro(
          sobrouEnvelope
            ? `${payload.erro ?? "O envelope ficou ativo na Clicksign e os convites não saíram."} ⚠️ NÃO MANDE DE NOVO: confira a conta da Clicksign primeiro — o segundo envelope também é cobrado e também não se apaga.`
            : (payload.erro ?? "Não consegui enviar."),
        );
        setConfirmando(false);
        return;
      }
      setEnviado({ envelopeId: payload.data.envelopeId, nome: payload.data.nome });
      aoEnviar?.({ envelopeId: payload.data.envelopeId, nome: payload.data.nome });
    } catch (e) {
      // ⚠️ NENHUMA RESPOSTA NÃO É "NÃO ENVIOU". Ver a nota de `precisaConferirNaClicksign`: a
      // mensagem não pode convidar a tentar de novo às cegas, porque o envelope pode estar lá,
      // ativo e pago.
      console.error("[temis][assinatura] o POST de envio não respondeu", e);
      setPrecisaConferirNaClicksign(true);
      setConfirmando(false);
      setErro(
        "A resposta do envio não chegou. ⚠️ ISSO NÃO QUER DIZER QUE NÃO FOI: a função tem teto de " +
          "120s e o envelope pode ter sido criado assim mesmo. Confira a lista da Clicksign ANTES de " +
          "mandar de novo — o segundo envelope também é cobrado e também não se apaga.",
      );
    } finally {
      marcarEnvio(false);
    }
  }

  if (!propostaId) {
    return (
      <Linha tom="aviso">
        Este card não tem venda ligada, então não há contrato nem signatários para organizar. Ele
        nasceu antes de a Têmis passar a receber a proposta do Hércules.
      </Linha>
    );
  }

  const bloqueado =
    Boolean(preparo?.impedimento) ||
    Boolean(preparo?.configuracaoPendente) ||
    enviando ||
    precisaConferirNaClicksign;

  return (
    <div className={compacto ? "" : "p-3"}>
      {carregando ? (
        <p className="m-0 flex items-center gap-2 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Montando a organização da assinatura…
        </p>
      ) : null}

      {enviado ? (
        <div className="rounded-lg border border-emerald-300/70 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
          <p className="m-0 font-semibold">Enviado para assinatura.</p>
          <p className="m-0 mt-1 break-words">
            O envelope <span className="font-semibold">{enviado.nome}</span> foi criado, ativado e os
            convites saíram. Id na Clicksign: {enviado.envelopeId}.
          </p>
        </div>
      ) : null}

      {erro ? <Linha tom="erro">{erro}</Linha> : null}

      {preparo && !enviado ? (
        <>
          {/* ⚠️ O AMBIENTE E A CONFIGURAÇÃO VÊM PRIMEIRO. Contrato assinado no sandbox não tem
              validade jurídica e a API responde 200 igual; chave faltando só apareceria no 503,
              DEPOIS da confirmação. Os dois têm de ser lidos antes do resto. */}
          {preparo.avisoDeAmbiente ? (
            <p className="m-0 mb-3 rounded-lg border border-amber-300/70 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              {preparo.avisoDeAmbiente}
            </p>
          ) : null}

          {/* ⚠️ NO MODO COMPACTO O CONTRATO NÃO SE REPETE: a etapa já mostra o documento logo acima,
              e repetir o nome dele aqui rouba as poucas linhas que a coluna tem. */}
          {compacto ? null : (
            <div className="mb-3 rounded-lg border border-line bg-subtle/40 p-2.5">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                O papel que vai
              </p>
              <p className="m-0 mt-1 break-words text-xs font-semibold text-ink">
                {preparo.contrato.nome}
              </p>
              <p className="m-0 mt-0.5 text-[0.7rem] text-ink-muted">
                É a versão vigente. Esta etapa não gera outra — para corrigir o texto, o contrato
                volta à etapa anterior.
              </p>
            </div>
          )}

          {preparo.impedimento ? <Linha tom="erro">{preparo.impedimento}</Linha> : null}

          {preparo.avisos.map((aviso) => (
            <Linha key={aviso} tom="aviso">
              {aviso}
            </Linha>
          ))}

          {/* ── QUEM ASSINA ──
              ⚠️ O E-MAIL É EDITÁVEL, E VALE SÓ PARA ESTE ENVIO. Lucas, 09/09/2026: *"coloca o meu
              e-mail e da nivea"* — no ZZ TESTE os e-mails da ficha são fictícios e nenhum convite
              chegaria. Num contrato de verdade é o comprador que deu o e-mail errado no cadastro:
              dá para corrigir aqui sem parar o envio, e sem mexer na ficha dele por um caminho que
              não é o do cadastro.

              ⚠️ É O CAMPO QUE DECIDE PARA ONDE VAI O CONTRATO — por isso ele é um input de verdade,
              com o valor à vista, e não um "editar" escondido atrás de um ícone. Em coluna
              estreita ele desce para a linha inteira em vez de encolher: e-mail cortado no meio é
              exatamente o que não se confere. */}
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Quem assina ({emOrdem.length})
          </p>
          <div className="mt-1.5 grid gap-1.5">
            {emOrdem.map((s) => {
              const chave = chaveDoSignatario(s.papel, s.nome);
              return (
                <div className="rounded-lg border border-line bg-subtle/40 px-2.5 py-2" key={chave}>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-inverse text-[10px] font-semibold text-white">
                      {ordenada ? s.ordem : "•"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink" title={s.nome}>
                        {s.nome}
                      </span>
                      <span className="block text-[0.7rem] text-ink-muted">{s.papelRotulo}</span>
                    </span>
                  </div>
                  <input
                    aria-label={`E-mail de ${s.nome}`}
                    className="mt-1.5 w-full rounded border border-line bg-surface px-1.5 py-1 text-[0.72rem] text-ink outline-none focus-visible:border-ink"
                    disabled={enviando}
                    onChange={(e) => setEmails((atual) => ({ ...atual, [chave]: e.target.value }))}
                    placeholder="sem e-mail"
                    title={emails[chave] ?? s.email}
                    type="email"
                    value={emails[chave] ?? s.email}
                  />
                </div>
              );
            })}
          </div>

          {/* ── O CPF ──
              ⚠️ A CLICKSIGN VALIDA O CPF CONTRA A RECEITA, e é por isso que este controle existe.
              Medido em 09/09/2026 com o ZZ TESTE: o CPF fictício `999.999.004-53` passa no dígito
              verificador e mesmo assim volta 422 no PASSO 3 — com o envelope do passo 1 já criado,
              e apagado logo em seguida. Lucas: *"vamos sem cpf"*.

              ⚠️ E SERVE ALÉM DO TESTE: CPF suspenso na Receita, ou com o nome desatualizado lá,
              recusa igual — e sem esta saída o contrato de um cliente real ficaria travado sem
              caminho nenhum. */}
          <div className="mt-3 rounded-lg border border-line p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="m-0 min-w-0 text-xs font-semibold text-ink">Pedir CPF na assinatura</p>
              <Interruptor
                desligado={enviando}
                ligado={pedirCpf}
                onClick={() => setPedirCpf((v) => !v)}
                rotulo="Pedir CPF na assinatura"
              />
            </div>
            <p className="m-0 mt-1 text-[0.7rem] text-ink-muted">
              {pedirCpf
                ? "⚠️ A Clicksign confere o CPF na Receita e RECUSA o envio se o número não existir lá. Em contrato de teste, desligue."
                : "O contrato sai sem CPF: quem assina se autentica só pelo e-mail."}
            </p>
          </div>

          {/* ── A ORDEM ──
              ⚠️ VEM PREENCHIDA E PODE SER MUDADA AQUI — e o que se muda aqui NÃO volta para o
              cadastro do empreendimento. Lucas, 08/09/2026: *"claro que temos que ter a opção de
              alterar antes de enviar o contrato, mas vem preenchido por padrão"*. Uma exceção de um
              contrato não pode virar a política de todos os contratos daquele produto. */}
          <div className="mt-3 rounded-lg border border-line p-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="m-0 min-w-0 text-xs font-semibold text-ink">Assinam em ordem</p>
              <Interruptor
                desligado={enviando}
                ligado={ordenada}
                onClick={() => setOrdenada((v) => !v)}
                rotulo="Assinam em ordem"
              />
            </div>
            <p className="m-0 mt-1 text-[0.7rem] text-ink-muted">
              Veio {preparo.ordem.origemDescrita}. O que mudar aqui vale só para este envio.
            </p>

            {ordenada ? (
              <div className="mt-2 grid gap-1">
                {papeisPresentes.map((papel) => {
                  const i = papeis.indexOf(papel);
                  const rotulo = rotuloDoPapel(papel);
                  return (
                    <div
                      className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5"
                      key={papel}
                    >
                      <span className="min-w-0 flex-1 truncate text-[0.7rem] text-ink" title={rotulo}>
                        {rotulo}
                      </span>
                      <button
                        aria-label={`Subir ${rotulo}`}
                        className="rounded border border-line p-0.5 text-ink-muted disabled:opacity-30"
                        disabled={i <= 0 || enviando}
                        onClick={() => mover(i, -1)}
                        title={`Subir ${rotulo}`}
                        type="button"
                      >
                        <ArrowUp className="size-3" />
                      </button>
                      <button
                        aria-label={`Descer ${rotulo}`}
                        className="rounded border border-line p-0.5 text-ink-muted disabled:opacity-30"
                        disabled={i < 0 || i >= papeis.length - 1 || enviando}
                        onClick={() => mover(i, 1)}
                        title={`Descer ${rotulo}`}
                        type="button"
                      >
                        <ArrowDown className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="m-0 mt-1.5 text-[0.7rem] text-ink-muted">
                Todos recebem o convite ao mesmo tempo.
              </p>
            )}
          </div>

          {/* ── O BOTÃO ──
              ⚠️ A CONFIRMAÇÃO ACONTECE NO LUGAR DO BOTÃO, sem diálogo novo por cima. O que a pessoa
              precisa reler para decidir — quem assina, com que e-mail, em que ordem — está NESTA
              tela; uma janela por cima taparia justamente a lista que ela ia conferir.

              ⚠️ E OS DOIS BOTÕES FICAM `disabled` ENQUANTO ENVIA. O POST são até 16 chamadas HTTP:
              o duplo clique não é impaciência, é o segundo envelope do mesmo contrato — e os dois
              cobram.

              ⚠️ O BLOCO É RODAPÉ GRUDADO, e isso foi MEDIDO — a 1920x900, com a sub-coluna de 320px
              valendo 620px de altura, o conteúdo dá 656px com 2 signatários (o botão aparece por
              36px), 746px com 3 (o botão nasce 54px ABAIXO da dobra) e piora com 4 e 5. Comprador +
              cônjuge + vendedora já são três, ou seja: o contrato comum nasce com a ação principal
              fora da tela, que é a mesma sensação de "a tela está cortando" que abriu este pedido.
              `sticky` prende o rodapé ao fim da área que rola sem mexer em nenhum dos seis elos de
              altura da etapa — eles foram medidos no navegador e estão certos.

              ⚠️ O FUNDO É SÓLIDO E TEM BORDA DE PROPÓSITO. Transparente, o texto que rola por baixo
              atravessaria o botão que manda o contrato para o cliente assinar. */}
          {precisaConferirNaClicksign ? null : (
            <div className="sticky bottom-0 mt-3 border-t border-line bg-canvas pb-1 pt-2.5">
              {confirmando ? (
                <div className="grid gap-1.5">
                  <p className="m-0 text-[0.7rem] text-ink-muted">
                    Isto cria o envelope na Clicksign e manda o convite. O envelope é pago e não se
                    apaga depois de ativado: só se cancela, e o cancelado continua na lista.
                  </p>
                  <p className="m-0 text-[0.7rem] text-ink-muted">
                    {ordenada && primeiros
                      ? `Primeiro convite: ${primeiros}.`
                      : `Os ${emOrdem.length} recebem o convite ao mesmo tempo.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                      disabled={enviando}
                      onClick={() => void enviar()}
                      type="button"
                    >
                      {enviando ? "Enviando…" : "Confirmo: enviar agora"}
                    </button>
                    <button
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted disabled:opacity-60"
                      disabled={enviando}
                      onClick={() => setConfirmando(false)}
                      type="button"
                    >
                      Voltar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={bloqueado}
                  onClick={() => setConfirmando(true)}
                  title={
                    preparo.impedimento ??
                    (preparo.configuracaoPendente
                      ? `Falta configurar: ${preparo.configuracaoPendente.join(", ")}`
                      : "Enviar para assinatura")
                  }
                  type="button"
                >
                  <FileSignature className="size-3.5" />
                  Enviar para assinatura
                </button>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/** Um aviso de uma linha. Dois tons só: o que impede (erro) e o que a pessoa precisa saber (aviso). */
function Linha({ children, tom }: { children: React.ReactNode; tom: "aviso" | "erro" }) {
  const cor =
    tom === "erro"
      ? "border-rose-300/70 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300"
      : "border-amber-300/60 bg-amber-50/70 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  return (
    <p className={`m-0 mb-2 flex items-start gap-1.5 rounded-lg border p-2.5 text-xs font-medium ${cor}`}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** O interruptor de "sim/não" da casa — o mesmo desenho nos dois usos desta tela. */
function Interruptor({
  desligado,
  ligado,
  onClick,
  rotulo,
}: {
  desligado: boolean;
  ligado: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      aria-checked={ligado}
      aria-label={rotulo}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        ligado ? "bg-inverse" : "bg-line-strong"
      }`}
      disabled={desligado}
      onClick={onClick}
      role="switch"
      type="button"
    >
      <span
        className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${
          ligado ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
