"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, FileDown, FileText, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { regrasParaATela } from "@/lib/temis/css-do-documento";
import { contratoVigente } from "@/lib/temis/contrato-guardado";

import { T } from "../tema";

// A PRÉVIA DO CONTRATO NA TELA — a minuta preenchida com os dados da proposta.
//
// Lucas, 08/09/2026: *"eu havia falado que deveria ter um campo para visualização do contrato
// preenchido, tipo uma prévia antes de enviar, isso foi construído?"*. Não estava: até aquela manhã
// não existia motor nenhum, e as variáveis marcadas na minuta eram lidas só por auditoria.
//
// ⚠️ ESTA É A TELA DE CONFERÊNCIA, e é onde o erro sai barato. Um contrato errado descoberto aqui
// custa um clique; o mesmo contrato descoberto depois de assinado custa um aditivo, uma conversa
// com o cliente e, quando envolve preço, uma renegociação.
//
// ⚠️ AQUI NÃO SE EMITE CONTRATO, E POR ISSO NÃO HÁ AVISO TÉCNICO. Lucas, 08/09/2026: *"não precisa
// ter aquele escrito de alerta de emissão, pois na Gurgel não há emissão de contrato, é somente uma
// prévia. Essas mensagens têm que estar dentro da Têmis"*.
//
// A distinção é de PAPÉIS, não de tela. No portal quem olha é o comercial, e o que ele quer saber é
// como o contrato ficou para aquele cliente — uma lista de nomes de variável entre colchetes não lhe
// diz o que fazer, porque preencher cadastro e ajustar minuta não é trabalho dele. Na Têmis quem
// olha é o jurídico, e ali a mesma lista é a pauta do dia.
//
// ⚠️ O QUE FALTA CONTINUA VISÍVEL NO CORPO, nos dois lugares: `[cpf_cliente]` sai impresso no texto,
// como manda `preencherContrato`. O que muda é só o resumo do topo — quem lê o contrato inteiro vê
// o buraco de qualquer jeito, que é o ponto.
//
// ── GERAR E GUARDAR (09/09/2026) ────────────────────────────────────────────
//
// ⚠️ O BOTÃO NÃO BAIXA UM ARQUIVO: ELE GUARDA. Um "baixar PDF" produziria um contrato que existe
// só na pasta de downloads de quem clicou — e a pergunta seguinte ("cadê o contrato do Henrique?")
// não teria resposta no sistema. O que este botão faz é gravar o documento na gaveta da venda
// (`hercules_documentos`), de onde a aba Documentos, a ficha do cliente no Apolo e o card da Têmis
// já sabem ler.
//
// ⚠️ ELE RECUSA COM VARIÁVEL EM BRANCO, e a recusa é do servidor — a tela só antecipa o motivo. Ver
// a decisão medida em `lib/temis/contrato-guardado.ts`.
//
// ⚠️ E ELE DIZ QUE VAI CRIAR UMA VERSÃO NOVA ANTES DE CRIAR. Descobrir que se gerou a v2 depois de
// gerada é a ordem errada de descobrir, num documento que vai a cartório.
//
// ── QUEM EMITE: A PROP `podeGerar` (08/09/2026) ─────────────────────────────
//
// ⚠️ A PRÉVIA É DE TODO MUNDO; A EMISSÃO NÃO. Lucas, vendo "Gerar e guardar o contrato" no rodapé
// com o portal comercial da Gurgel aberto: *"estou como coordenador, não pode ter esse botão de
// gerar contrato, isso é somente o time administrativo interno"*; e a régua: *"para o perfil da
// gurgel, comercial, pode tirar. Na Têmis só quem tiver relacionado ao setor de contratos e os
// admin"*. Conferir e emitir são de gente diferente — o botão sai, a folha fica inteira.
//
// ⚠️ É PROP EXPLÍCITA, NÃO CHEIRO DE ROTA. Um `usePathname().startsWith("/comercial")` acertaria
// hoje e erraria no dia em que a prévia abrisse num terceiro lugar — e erraria calado, mostrando o
// botão. Sem valor-padrão, a tela nova não compila sem dizer o que quer.
//
// ⚠️ ESCONDER O BOTÃO NÃO É A TRAVA. A rota `/api/temis/contrato/gerar` é chamável direto; quem
// fecha é `autorizarEmissaoDeContrato` (`lib/temis/autorizacao.ts`). Esta prop é a metade da tela.
//
// ⚠️ "ABRIR O CONTRATO GUARDADO" FICA, e fica de propósito: ver o documento já emitido é
// conferência, não emissão — e é justamente o que o comercial precisa fazer no portal.

type ContratoGuardado = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao?: null | string;
  versao: null | number;
};

type Resposta = {
  avisos?: string[];
  erro?: string;
  html?: string;
  minuta?: { id: string; nome: string; versao: null | number };
  semValor?: string[];
  vezesDoLaco?: number;
};

export function PreviaDoContrato({
  aoFechar,
  comAvisos = false,
  podeGerar,
  propostaId,
}: {
  aoFechar: () => void;
  /** Liga o resumo do que falta. Só a Têmis usa: ver a nota do topo. */
  comAvisos?: boolean;
  /**
   * Mostra (ou não) a AÇÃO de emitir. Sem valor-padrão de propósito: quem abrir esta prévia numa
   * tela nova é obrigado a declarar se ali se emite contrato — herdar "sim" por omissão é como o
   * botão foi parar no portal comercial. Ver a nota "QUEM EMITE" acima.
   */
  podeGerar: boolean;
  propostaId: string;
}) {
  const [carregando, setCarregando] = useState(true);
  const [resposta, setResposta] = useState<null | Resposta>(null);
  const [guardados, setGuardados] = useState<ContratoGuardado[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erroDaGeracao, setErroDaGeracao] = useState<null | string>(null);
  const [gerado, setGerado] = useState<null | { id: string; nome: string; versao: number }>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      try {
        const token = await getApoloAccessToken();
        const cabecalho = {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        };

        // ⚠️ AS DUAS LEITURAS JUNTAS. Saber o que JÁ foi gerado é o que muda o texto do botão de
        // "Gerar contrato" para "Gerar a versão 2" — e essa frase é a única chance de alguém parar
        // antes de criar uma segunda folha por engano. Pedir depois faria o botão nascer mentindo.
        const [previa, jaGuardados] = await Promise.all([
          fetch("/api/temis/contrato/previa", {
            body: JSON.stringify({ propostaId }),
            headers: cabecalho,
            method: "POST",
          }),
          fetch(`/api/temis/contrato/gerar?proposta=${encodeURIComponent(propostaId)}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }),
        ]);

        const dados = (await previa.json().catch(() => ({}))) as Resposta;
        const lista = (await jaGuardados.json().catch(() => ({}))) as {
          data?: { contratos: ContratoGuardado[] };
        };
        if (vivo) {
          setResposta(dados);
          setGuardados(lista.data?.contratos ?? []);
        }
      } catch (e) {
        // ⚠️ O MOTIVO CHEGA À TELA. Uma prévia que falha calada manda a pessoa tentar de novo sem
        // saber o que mudar — e foi exatamente o que custou duas rodadas de teste no agente da
        // minuta, na mesma semana.
        if (vivo) {
          setResposta({ erro: e instanceof Error ? e.message : "Falha ao gerar a prévia." });
        }
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  const gerar = useCallback(async () => {
    setGerando(true);
    setErroDaGeracao(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/contrato/gerar", {
        body: JSON.stringify({ propostaId }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "POST",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { documentoId: string; nome: string; versao: number };
        erro?: string;
      };
      if (!r.ok || !j.data) throw new Error(j.erro ?? `Não foi possível gerar (${r.status}).`);

      setGerado({ id: j.data.documentoId, nome: j.data.nome, versao: j.data.versao });
      setGuardados((antes) => [
        {
          criadoEm: new Date().toISOString(),
          id: j.data!.documentoId,
          nome: j.data!.nome,
          versao: j.data!.versao,
        },
        ...antes,
      ]);
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não foi possível gerar o contrato.");
    } finally {
      setGerando(false);
    }
  }, [propostaId]);

  /**
   * ⚠️ A ABA É ABERTA ANTES DO `await` — a URL é assinada no servidor, e um `window.open` depois da
   * ida e volta acontece fora do gesto do usuário: o navegador o bloqueia como pop-up e o clique
   * "não faz nada".
   */
  const abrir = useCallback(async (documentoId: string) => {
    const aba = window.open("", "_blank", "noopener,noreferrer");
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/contrato/gerar?documento=${encodeURIComponent(documentoId)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const j = (await r.json().catch(() => ({}))) as { data?: { url: string }; erro?: string };
      if (!r.ok || !j.data?.url) throw new Error(j.erro ?? "Não foi possível abrir o contrato.");
      if (aba) aba.location.href = j.data.url;
      else window.location.href = j.data.url;
    } catch (e) {
      aba?.close();
      setErroDaGeracao(e instanceof Error ? e.message : "Não foi possível abrir o contrato.");
    }
  }, []);

  const semValor = resposta?.semValor ?? [];
  const semValorVisivel = comAvisos ? semValor : [];
  const avisos = comAvisos ? (resposta?.avisos ?? []) : [];
  const vigente = contratoVigente(guardados);
  const proximaVersao = (vigente?.versao ?? guardados.length) + 1;
  // O CONTRATO ESTÁ EM CONDIÇÃO DE SER EMITIDO — nada a ver com quem está olhando. Quem decide o
  // DIREITO é a prop `podeGerar`; isto aqui decide se o botão, quando existe, está aceso.
  const prontoParaGerar =
    !carregando && !resposta?.erro && Boolean(resposta?.html) && semValor.length === 0;
  // ⚠️ O RODAPÉ SOME INTEIRO QUANDO NÃO SOBRA AÇÃO NENHUMA. Sem isto, o portal ganharia uma faixa
  // com borda e 12px de padding embaixo da folha — a moldura de um botão que foi embora.
  const temRodape = !resposta?.erro && (podeGerar || Boolean(vigente) || Boolean(erroDaGeracao));

  return (
    <div
      onClick={aoFechar}
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,.45)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 20,
        position: "fixed",
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          boxShadow: T.sombra,
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
          maxWidth: 900,
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 10,
            padding: "12px 16px",
          }}
        >
          <FileText aria-hidden="true" size={16} style={{ color: T.gold }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 13.5, fontWeight: 700 }}>
              Prévia do contrato
            </div>
            {/* ⚠️ DIZ QUE NÃO EMITE. O portal mostra o contrato para conferência do comercial; a
                emissão, quando existir, é da Têmis. Sem esta linha alguém fecha a tela achando que
                o contrato foi gerado. */}
            <div style={{ color: T.muted, fontSize: 11 }}>
              {resposta?.minuta ? (
                <>
                  {resposta.minuta.nome}
                  {resposta.minuta.versao ? ` · v${resposta.minuta.versao}` : ""}
                  {resposta.vezesDoLaco
                    ? ` · ${resposta.vezesDoLaco} ${resposta.vezesDoLaco === 1 ? "comprador" : "compradores"}`
                    : ""}
                  {/* ⚠️ A FRASE SEGUE A AÇÃO, NÃO O AVISO. Ela promete "não emite", e quem
                      cumpre a promessa é `podeGerar` — amarrá-la a `comAvisos` faria a linha
                      mentir na primeira tela que ligasse um sem o outro. */}
                  {podeGerar ? "" : " · conferência, não emite"}
                </>
              ) : null}
            </div>
          </div>
          <button
            aria-label="Fechar"
            onClick={aoFechar}
            style={{
              background: "transparent",
              border: "none",
              color: T.muted,
              cursor: "pointer",
              padding: 4,
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div style={{ minHeight: 0, overflow: "auto", padding: 16 }}>
          {carregando ? (
            <div
              style={{
                alignItems: "center",
                color: T.muted,
                display: "flex",
                fontSize: 12.5,
                gap: 8,
                justifyContent: "center",
                padding: "40px 0",
              }}
            >
              <Loader2 aria-hidden="true" className="animate-spin" size={14} />
              Montando o contrato…
            </div>
          ) : resposta?.erro ? (
            <p
              style={{
                background: T.dangerBg,
                borderRadius: 10,
                color: T.danger,
                fontSize: 12.5,
                margin: 0,
                padding: "10px 12px",
              }}
            >
              {resposta.erro}
            </p>
          ) : (
            <>
              {semValorVisivel.length > 0 || avisos.length > 0 ? (
                <div
                  style={{
                    background: T.dangerBg,
                    borderRadius: 10,
                    marginBottom: 14,
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      color: T.danger,
                      display: "flex",
                      fontSize: 12,
                      fontWeight: 700,
                      gap: 6,
                    }}
                  >
                    <AlertTriangle aria-hidden="true" size={13} />
                    Confira antes de emitir
                  </div>
                  {semValorVisivel.length > 0 ? (
                    <p style={{ color: T.sub, fontSize: 11.5, margin: "6px 0 0" }}>
                      {semValorVisivel.length === 1
                        ? "1 variável ficou sem valor e saiu impressa no texto: "
                        : `${semValorVisivel.length} variáveis ficaram sem valor e saíram impressas no texto: `}
                      <span style={{ fontFamily: "ui-monospace, monospace" }}>
                        {semValorVisivel.join(", ")}
                      </span>
                    </p>
                  ) : null}
                  {avisos.map((a) => (
                    <p key={a} style={{ color: T.sub, fontSize: 11.5, margin: "4px 0 0" }}>
                      {a}
                    </p>
                  ))}
                </div>
              ) : null}

              {/* ⚠️ A FOLHA IMITA O PAPEL — fundo branco, margem de página, serifa. Conferir um
                  contrato com a cara do editor esconde justamente os problemas de diagramação que
                  só aparecem no papel.

                  ⚠️ AS REGRAS SÃO AS MESMAS DO PDF (`css-do-documento.ts`), e é isso que faz a
                  conferência valer: se a tela usasse um CSS e o papel outro, aprovar aqui não
                  provaria nada sobre o que o cliente recebe. Elas precisam vir num `<style>` porque
                  o conteúdo entra por `dangerouslySetInnerHTML` — estilo inline no container não
                  alcança os `<p>` de dentro, e o preflight do Tailwind já zerou a margem deles.

                  ⚠️ O HTML VEM DO NOSSO SERIALIZADOR, sobre a nossa minuta e os nossos dados — não é
                  conteúdo de terceiro. */}
              <style>{regrasParaATela(".previa-do-contrato")}</style>
              <div
                className="previa-do-contrato"
                dangerouslySetInnerHTML={{ __html: resposta?.html ?? "" }}
                style={{
                  background: "#fff",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: "40px 48px",
                }}
              />
            </>
          )}
        </div>

        {/* ── O RODAPÉ: GERAR E GUARDAR ─────────────────────────────────────
            ⚠️ ELE FICA FORA DA ÁREA QUE ROLA. Um botão que só aparece no fim de 27 páginas é um
            botão que ninguém acha — e o contrato não é lido de cima a baixo toda vez.

            ⚠️ SEM `podeGerar` SÓ SOBREVIVE O QUE NÃO EMITE: abrir o contrato guardado e o recado de
            erro (que também é o erro de ABRIR — ver `abrir()`). O resto do rodapé é a emissão. */}
        {!temRodape ? null : (
          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              display: "grid",
              gap: 8,
              padding: "10px 16px 12px",
            }}
          >
            {gerado ? (
              <div
                style={{
                  alignItems: "flex-start",
                  background: T.okBg,
                  borderRadius: 10,
                  color: T.ok,
                  display: "flex",
                  fontSize: 12,
                  gap: 8,
                  padding: "9px 11px",
                }}
              >
                <CheckCircle2 aria-hidden="true" size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ minWidth: 0 }}>
                  <b>Contrato guardado.</b> {gerado.nome}
                  <span style={{ color: T.sub, display: "block", fontSize: 11.5 }}>
                    Está na aba Documentos desta venda, na ficha do cliente no Apolo e no card da
                    Têmis.
                  </span>
                </span>
              </div>
            ) : null}

            {erroDaGeracao ? (
              <p
                style={{
                  background: T.dangerBg,
                  borderRadius: 10,
                  color: T.danger,
                  fontSize: 12,
                  margin: 0,
                  padding: "9px 11px",
                }}
              >
                {erroDaGeracao}
              </p>
            ) : null}

            {/* ⚠️ O QUE JÁ EXISTE APARECE ANTES DE SE GERAR MAIS UM — e continua aparecendo DEPOIS
                de gerar. A primeira versão desta tela escondia o botão quando a geração acabava de
                acontecer, e o efeito era o pior possível: a pessoa clicava "Gerar", lia "contrato
                guardado" e não tinha como VER o papel que acabara de criar. */}
            {vigente ? (
              <button
                onClick={() => void abrir(vigente.id)}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  color: T.text,
                  cursor: "pointer",
                  display: "flex",
                  fontSize: 11.5,
                  gap: 6,
                  padding: "7px 10px",
                  textAlign: "left",
                }}
                type="button"
              >
                <ExternalLink aria-hidden="true" size={12} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  {gerado ? "Abrir o contrato que acabou de sair" : "Abrir o contrato guardado"}
                  {vigente.versao ? ` (versão ${vigente.versao})` : ""}
                </span>
              </button>
            ) : null}

            {!podeGerar ? null : (
              <button
                disabled={!prontoParaGerar || gerando}
                onClick={() => void gerar()}
                style={{
                  alignItems: "center",
                  background: prontoParaGerar && !gerando ? T.gold : "transparent",
                  border: `1px solid ${prontoParaGerar && !gerando ? T.gold : T.border}`,
                  borderRadius: 8,
                  color: prontoParaGerar && !gerando ? "#1a1a1a" : T.muted,
                  cursor: prontoParaGerar && !gerando ? "pointer" : "not-allowed",
                  display: "flex",
                  fontSize: 12.5,
                  fontWeight: 700,
                  gap: 7,
                  justifyContent: "center",
                  padding: "9px 12px",
                  width: "100%",
                }}
                title={
                  semValor.length > 0
                    ? "O contrato tem campos em branco. Complete o cadastro ou a minuta antes de gerar."
                    : undefined
                }
                type="button"
              >
                {gerando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={13} />
                ) : (
                  <FileDown aria-hidden="true" size={13} />
                )}
                {gerando
                  ? "Gerando o PDF…"
                  : guardados.length > 0
                    ? `Gerar a versão ${proximaVersao} do contrato`
                    : "Gerar e guardar o contrato"}
              </button>
            )}

            {/* ⚠️ O MOTIVO DA TRAVA, NA LÍNGUA DE QUEM ESTÁ OLHANDO. Na Têmis (comAvisos) os nomes
                das variáveis são a pauta do dia; no portal eles não dizem nada a quem não mexe em
                cadastro nem em minuta — ali o recado útil é quantos campos faltam e de quem é a
                bola. Sem uma frase qualquer, o botão apagado vira "o sistema quebrou".

                ⚠️ AS DUAS FRASES ANDAM COM O BOTÃO. Elas explicam por que ele está apagado e o que
                acontece ao clicar; sem botão viram legenda de nada — e, no portal, ressuscitariam
                pela porta dos fundos o aviso de emissão que o Lucas mandou tirar de lá. */}
            {!podeGerar ? null : semValor.length > 0 ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                {comAvisos
                  ? `${semValor.length === 1 ? "1 variável está" : `${semValor.length} variáveis estão`} sem valor e o documento não pode ser gerado: ${semValor.join(", ")}.`
                  : `${semValor.length === 1 ? "1 campo do contrato está" : `${semValor.length} campos do contrato estão`} em branco. A Têmis precisa completar o cadastro ou a minuta antes de o documento ser gerado.`}
              </p>
            ) : guardados.length > 0 && !gerado ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Já existe contrato guardado. Gerar de novo cria uma versão nova; a anterior continua
                na gaveta, marcada como substituída.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
