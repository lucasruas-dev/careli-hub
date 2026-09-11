"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  Pencil,
  Save,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

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

/** A alteração manual vigente desta venda, como o servidor a devolve. */
type EdicaoNaTela = {
  atualizadoEm: string;
  /**
   * O contrato da minuta mudou DEPOIS que esta alteração foi salva.
   *
   * ⚠️ O TEXTO EDITADO É UMA FOTO. Se alguém corrigiu o CPF no Apolo, publicou outra minuta ou
   * mudou o valor da proposta depois da edição, o que está na tela contém o dado ANTIGO — e o
   * contrato sai errado sem ninguém ter feito nada errado. Esta bandeira é o único aviso.
   */
  baseMudou: boolean;
  editadoPorNome: null | string;
  html: string;
};

type Resposta = {
  avisos?: string[];
  /** sha-256 do contrato montado agora; volta no salvamento. Ver `contrato-editado.ts`. */
  baseImpressao?: string;
  edicao?: EdicaoNaTela | null;
  erro?: string;
  html?: string;
  minuta?: { id: string; nome: string; versao: null | number };
  semValor?: string[];
  vezesDoLaco?: number;
};

export function PreviaDoContrato({
  aoFechar,
  aoGerar,
  comAvisos = false,
  podeEditar = false,
  podeGerar,
  propostaId,
}: {
  aoFechar: () => void;
  /**
   * O contrato acabou de ser gerado e guardado.
   *
   * ⚠️ QUEM ABRIU A PRÉVIA DECIDE O QUE FAZER DEPOIS, e é por isso que isto é um aviso e não uma
   * navegação daqui. Na Têmis, gerar encerra a etapa: a tela fecha e o quadro mostra o recado. No
   * portal comercial, que nem gera, ninguém escuta. Um `router.push` aqui dentro amarraria a prévia
   * a uma tela só.
   */
  aoGerar?: (contrato: { nome: string; versao: number }) => void;
  /** Liga o resumo do que falta. Só a Têmis usa: ver a nota do topo. */
  comAvisos?: boolean;
  /**
   * Deixa alterar o contrato à mão antes de fechar.
   *
   * Lucas (10/09/2026): *"quando eu clicar no abrir contrato, esse contrato tem que me permitir
   * fazer alteração manual, salvar, fechar contrato"*.
   *
   * ⚠️ PADRÃO `false`, AO CONTRÁRIO DE `podeGerar`. A diferença é de risco: uma tela nova que
   * esqueça `podeGerar` não compila, porque emitir contrato sem querer é grave; uma que esqueça
   * esta prop apenas não deixa editar, que é o comportamento de hoje em todo lugar. Exigir as
   * duas obrigaria a mexer no portal da Gurgel para ligar um recurso que ele não vai ter.
   *
   * ⚠️ E ELA NÃO É A TRAVA: quem fecha a edição é `autorizarEmissaoDeContrato`, no servidor.
   */
  podeEditar?: boolean;
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
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  /** O que a faxina do servidor tirou do texto colado. Vazio = nada mexeu. */
  const [faxina, setFaxina] = useState<string[]>([]);

  /**
   * A folha, para ler o que a pessoa escreveu.
   *
   * ⚠️ O TEXTO EDITADO NÃO VIRA ESTADO A CADA TECLA, e isso é deliberado: guardar o `innerHTML`
   * em `useState` no `onInput` faria o React reescrever a folha inteira a cada letra digitada, e o
   * cursor voltaria para o começo do documento. Quem edita é o navegador; o React só lê o
   * resultado quando se clica em salvar.
   */
  const folha = useRef<HTMLDivElement>(null);
  /** Conta os pedidos em voo: resposta velha não sobrescreve tela nova. */
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
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
      if (meu !== pedido.current) return;
      setResposta(dados);
      setGuardados(lista.data?.contratos ?? []);
    } catch (e) {
      // ⚠️ O MOTIVO CHEGA À TELA. Uma prévia que falha calada manda a pessoa tentar de novo sem
      // saber o que mudar — e foi exatamente o que custou duas rodadas de teste no agente da
      // minuta, na mesma semana.
      if (meu !== pedido.current) return;
      setResposta({ erro: e instanceof Error ? e.message : "Falha ao gerar a prévia." });
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [propostaId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

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
      aoGerar?.({ nome: j.data.nome, versao: j.data.versao });
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
  }, [aoGerar, propostaId]);

  /**
   * Grava a alteração manual.
   *
   * ⚠️ DEPOIS DE SALVAR, A PRÉVIA É RECARREGADA — e não só por capricho. O servidor faxina o
   * texto antes de gravar, e o que ele guardou pode não ser byte a byte o que saiu do navegador;
   * ele também recalcula o que ficou sem valor sobre o texto novo. Sem a releitura, a tela mostra
   * uma coisa e o papel sai outra — exatamente o que esta tela existe para impedir.
   */
  const salvar = useCallback(async () => {
    const html = folha.current?.innerHTML ?? "";
    setSalvando(true);
    setErroDaGeracao(null);
    setFaxina([]);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/temis/contrato/edicao", {
        body: JSON.stringify({
          baseImpressao: resposta?.baseImpressao,
          html,
          minutaId: resposta?.minuta?.id,
          propostaId,
        }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "PUT",
      });
      const j = (await r.json().catch(() => ({}))) as {
        data?: { removeu: string[] };
        erro?: string;
      };
      if (!r.ok) throw new Error(j.erro ?? `Não consegui salvar (${r.status}).`);

      setFaxina(j.data?.removeu ?? []);
      setEditando(false);
      await carregar();
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não consegui salvar a alteração.");
    } finally {
      setSalvando(false);
    }
  }, [carregar, propostaId, resposta?.baseImpressao, resposta?.minuta?.id]);

  /** Joga fora a alteração manual: o contrato volta a ser o texto da minuta. */
  const descartar = useCallback(async () => {
    setSalvando(true);
    setErroDaGeracao(null);
    setFaxina([]);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/contrato/edicao?proposta=${encodeURIComponent(propostaId)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          method: "DELETE",
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { erro?: string };
        throw new Error(j.erro ?? `Não consegui descartar (${r.status}).`);
      }
      setEditando(false);
      await carregar();
    } catch (e) {
      setErroDaGeracao(e instanceof Error ? e.message : "Não consegui descartar a alteração.");
    } finally {
      setSalvando(false);
    }
  }, [carregar, propostaId]);

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

  const edicao = resposta?.edicao ?? null;
  /**
   * O texto que vale — o alterado à mão quando existe, senão o da minuta.
   *
   * ⚠️ É O MESMO CRITÉRIO DO SERVIDOR (`gerar/route.ts`). A folha na tela e o PDF que sai têm de
   * ser o mesmo documento; um critério aqui e outro lá faria a conferência não provar nada.
   */
  const htmlDaFolha = edicao?.html ?? resposta?.html ?? "";
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
  // ⚠️ O RODAPÉ ESPERA O CONTRATO CHEGAR. Aparecendo durante a carga, ele nasce com o botão
  // apagado e some/volta quando a resposta chega — um segundo salto de ~50px por cima do
  // primeiro. As ações só fazem sentido sobre um documento que já está na tela.
  const temRodape =
    !carregando &&
    !resposta?.erro &&
    (podeGerar || podeEditar || Boolean(vigente) || Boolean(erroDaGeracao));

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
          // ⚠️ O PISO IMPEDE O COLAPSO. Sem ele a altura era a soma dos filhos: com a frase de
          // carregamento o cartão inteiro media ~176px — um balão de aviso, não um documento — e
          // saltava para 92vh quando o contrato chegava. O `min()` cede primeiro em janela
          // baixa, para o cartão nunca passar do `maxHeight`.
          minHeight: "min(92vh, 680px)",
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

        {/* `flex: 1` anda junto com o piso do painel: sem ele o miolo continua do tamanho do
            conteúdo e a altura nova viraria uma faixa vazia depois do rodapé. */}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
          {carregando ? (
            <FolhaEsqueleto />
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
              {/* ⚠️ O AVISO DA BASE VEM ANTES DE TUDO, inclusive das variáveis em branco. Uma
                  alteração manual feita sobre dados que mudaram depois é o único defeito desta tela
                  que a leitura do contrato NÃO revela: o texto está impecável, só que com o CPF
                  antigo. Quem lê não tem como perceber — só o sistema sabe. */}
              {edicao?.baseMudou ? (
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
                    O contrato mudou depois desta alteração
                  </div>
                  <p style={{ color: T.sub, fontSize: 11.5, margin: "6px 0 0" }}>
                    O cadastro, a proposta ou a minuta foram alterados depois que este texto foi
                    salvo — o que está na tela pode conter dado antigo. Confira o que mudou, ou
                    descarte a alteração para partir do contrato de hoje e refazer o ajuste.
                  </p>
                </div>
              ) : null}

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
              {/* ⚠️ `contentEditable` NO PRÓPRIO DOCUMENTO, e não um editor ao lado. O que se
                  confere é a folha com a cara do papel; abrir o texto num segundo componente
                  faria a pessoa escrever num lugar e conferir noutro, com dois CSS diferentes.

                  ⚠️ O `dangerouslySetInnerHTML` CONVIVE COM A EDIÇÃO porque `htmlDaFolha` não
                  muda enquanto se digita — o React só reescreve a folha quando o texto vem do
                  servidor (ao salvar, ao descartar, ao recarregar). Ver a nota do `ref`. */}
              <div
                className="previa-do-contrato"
                contentEditable={editando}
                dangerouslySetInnerHTML={{ __html: htmlDaFolha }}
                ref={folha}
                spellCheck={editando}
                style={{
                  background: "#fff",
                  border: `1px solid ${editando ? T.gold : T.border}`,
                  borderRadius: 8,
                  boxShadow: editando ? `0 0 0 3px ${T.gold}22` : undefined,
                  outline: "none",
                  padding: "40px 48px",
                }}
                suppressContentEditableWarning
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

            {/* ⚠️ A ETIQUETA DE QUEM MEXEU FICA COLADA NAS AÇÕES. Um contrato com cláusula
                reescrita à mão é indistinguível do texto da minuta para quem lê — as duas coisas
                são só parágrafos na folha. Sem esta linha, quem abre a tela depois não tem como
                saber que está conferindo um texto ajustado. */}
            {edicao && !editando ? (
              <div
                style={{
                  alignItems: "center",
                  color: T.sub,
                  display: "flex",
                  fontSize: 11.5,
                  gap: 6,
                }}
              >
                <Pencil aria-hidden="true" size={12} style={{ flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  Alterado à mão
                  {edicao.editadoPorNome ? ` por ${edicao.editadoPorNome}` : ""} ·{" "}
                  {new Date(edicao.atualizadoEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              </div>
            ) : null}

            {/* O que a faxina do servidor tirou do que foi colado — ver a rota `edicao`. */}
            {faxina.length > 0 ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Ao salvar, foi retirado do texto: {faxina.join("; ")}. O resto foi mantido.
              </p>
            ) : null}

            {/* ⚠️ UM BOTÃO POR VEZ — Lucas (11/09/2026): *"deixa o botão de abrir, se abrir ter o
                botão de fechar, não precisa ter os dois"* e *"não precisa de um botão de salvar,
                automaticamente ao fechar o contrato salva"*.

                O par ABRIR/FECHAR controla a EDIÇÃO, e nada mais: abriu, o texto fica editável;
                fechou, o que foi escrito é salvo e a folha volta a ser só leitura. Antes eram três
                botões ao mesmo tempo — alterar, salvar, sair sem salvar — e a pessoa tinha de
                decidir qual era qual antes de poder escrever uma vírgula.

                ⚠️ "DESCARTAR" SOBREVIVEU porque é a única saída de quem se arrependeu do que já
                está salvo: ele apaga a alteração e devolve o texto da minuta. Fica pequeno, ao
                lado, e só aparece quando existe alteração para jogar fora. */}
            {!podeEditar ? null : (
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={salvando}
                  onClick={() => {
                    if (editando) {
                      void salvar();
                      return;
                    }
                    setFaxina([]);
                    setEditando(true);
                  }}
                  style={{
                    alignItems: "center",
                    background: "transparent",
                    border: `1px solid ${editando ? T.gold : T.border}`,
                    borderRadius: 8,
                    color: T.text,
                    cursor: salvando ? "wait" : "pointer",
                    display: "flex",
                    flex: 1,
                    fontSize: 12,
                    fontWeight: 700,
                    gap: 6,
                    justifyContent: "center",
                    padding: "8px 12px",
                  }}
                  type="button"
                >
                  {salvando ? (
                    <Loader2 aria-hidden="true" className="animate-spin" size={13} />
                  ) : editando ? (
                    <Save aria-hidden="true" size={13} />
                  ) : (
                    <Pencil aria-hidden="true" size={13} />
                  )}
                  {salvando
                    ? "Salvando…"
                    : editando
                      ? "Fechar o contrato"
                      : "Abrir o contrato"}
                </button>

                {!editando && edicao ? (
                  <button
                    disabled={salvando}
                    onClick={() => void descartar()}
                    style={{
                      alignItems: "center",
                      background: "transparent",
                      border: `1px solid ${T.border}`,
                      borderRadius: 8,
                      color: T.muted,
                      cursor: "pointer",
                      display: "flex",
                      fontSize: 12,
                      gap: 6,
                      padding: "8px 12px",
                    }}
                    title="Joga fora a alteração e volta ao texto da minuta"
                    type="button"
                  >
                    <Undo2 aria-hidden="true" size={13} />
                    Descartar
                  </button>
                ) : null}
              </div>
            )}

            {!podeGerar ? null : (
              <button
                disabled={!prontoParaGerar || gerando || editando}
                onClick={() => void gerar()}
                style={{
                  alignItems: "center",
                  // ⚠️ O DESTAQUE É DELE — Lucas: *"gerar contrato merece um destaque"*. É a ação
                  // que encerra a etapa; o resto do rodapé é preparação para ela.
                  background: prontoParaGerar && !gerando ? T.gold : "transparent",
                  border: `1px solid ${prontoParaGerar && !gerando ? T.gold : T.border}`,
                  borderRadius: 8,
                  // ⚠️ A TINTA VEM DO TOKEN, e não cravada: `#1a1a1a` sobre o fundo invertido do
                  // hub escuro (que é BRANCO) dava grafite sobre branco no portal e some no
                  // tema escuro da Têmis. `btnFg` é o par certo de `btnBg` nos dois temas.
                  color: prontoParaGerar && !gerando ? T.btnFg : T.muted,
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
                {/* ⚠️ "FECHAR" NA TÊMIS, "GERAR" NO PORTAL — Lucas (10/09/2026): *"fazer
                    alteração manual, salvar, fechar contrato"*. Onde se pode alterar o texto, o
                    botão encerra um trabalho: ele congela o texto em PDF, guarda na gaveta da
                    venda e o card anda. Onde não se altera nada, ele só gera o documento — e
                    chamar isso de "fechar" prometeria um efeito que ali não existe. */}
                {/* ⚠️ O NOME É SEMPRE "GERAR", e isso é o conserto de uma ambiguidade que este
                    botão carregava: onde dava para editar, ele se chamava "Fechar o contrato" — a
                    mesma palavra que agora fecha a EDIÇÃO, logo acima. Duas ações vizinhas com o
                    mesmo nome e efeitos completamente diferentes (uma salva texto, a outra emite um
                    PDF e move o card) é o tipo de coisa que faz alguém clicar sem querer. */}
                {gerando
                  ? "Gerando o PDF…"
                  : guardados.length > 0
                    ? `Gerar a versão ${proximaVersao}`
                    : "Gerar contrato"}
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
            ) : podeEditar ? (
              <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>
                Fechar gera o PDF{edicao ? " com a alteração manual" : ""}, guarda na gaveta desta
                venda e faz o card andar. O texto continua editável depois — cada fechamento vira
                uma versão nova, e nenhuma se apaga.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A silhueta de uma folha de contrato: o título, a qualificação das partes e as cláusulas, cada
 * uma com o seu rótulo curto. Larguras em %, para o desenho acompanhar a folha em qualquer janela.
 */
const BLOCOS_DA_FOLHA: string[][] = [
  ["58%", "34%"],
  ["100%", "100%", "96%", "72%"],
  ["44%"],
  ["100%", "97%", "100%", "61%"],
  ["51%"],
  ["100%", "100%", "93%", "46%"],
  ["38%"],
  ["100%", "95%", "100%", "68%"],
];

/**
 * A FOLHA ENQUANTO ELA NÃO CHEGA.
 *
 * Lucas (10/09/2026): *"esse carregando está ruim"*.
 *
 * ⚠️ ELE EXISTE PARA A MOLDURA NÃO MUDAR DE TAMANHO. A frase "Montando o contrato…" ocupava ~95px
 * no meio de um cartão sem altura: a prévia nascia como uma tira fina e saltava para a tela inteira
 * quando o contrato chegava. O esqueleto tem a altura de uma folha, então a prévia abre no tamanho
 * que vai ter, e o contrato só preenche um desenho que já estava lá.
 *
 * ⚠️ ELE COPIA A MOLDURA DA FOLHA REAL — mesmo fundo, mesmo raio, mesmo `padding: "40px 48px"`.
 * É o que faz a troca ser um preenchimento, e não uma substituição.
 *
 * ⚠️ OS CINZAS SÃO FIXOS, e não token de tema. A folha imita PAPEL e é branca nos dois temas (ver
 * `css-do-documento.ts`); um cinza que clareasse no escuro sumiria dentro do branco.
 */
function FolhaEsqueleto() {
  return (
    <div
      aria-label="Montando o contrato"
      className="animate-pulse"
      role="status"
      style={{
        background: "#fff",
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        padding: "40px 48px",
      }}
    >
      {BLOCOS_DA_FOLHA.map((grupo, i) => (
        <div
          key={`g${i}`}
          style={{
            display: "grid",
            gap: 9,
            justifyItems: i === 0 ? "center" : "stretch",
            marginTop: i === 0 ? 0 : 22,
          }}
        >
          {grupo.map((largura, j) => (
            <div
              key={`g${i}l${j}`}
              style={{
                background: "#e9ecf1",
                borderRadius: 4,
                height: i === 0 ? 13 : 11,
                width: largura,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
