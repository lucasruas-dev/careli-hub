"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { cpfValido, formatarDocumento, soDigitos } from "@/lib/apolo/documento";
import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import { montarCronograma } from "@/lib/hercules/cronograma";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import {
  conferirProposta,
  dataEscrita,
  type ErroDaProposta,
  type PedidoDeProposta,
} from "@/lib/hercules/proposta";
import {
  faltaParaFechar,
  lerPercentualDigitado,
  participacoesIguais,
  somaDasParticipacoes,
} from "@/lib/hercules/proposta-na-tela";
import { comoFoiOAviso } from "@/lib/hercules/reserva";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

import { T } from "../tema";

// GERAR A PROPOSTA — o segundo caminho da reserva, e o irmão de `ModalDeReserva`.
//
// Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar"*, *"o
// cliente é o da reserva e não se troca, se quiser trocar cancela a reserva e reserva de novo"*,
// *"dá para adicionar proponentes, cada um informa a % de participação"*, *"para virar proposta a
// CAD do titular tem que estar credenciada naquele empreendimento"*, e sobre a montagem: *"depois
// vem o simulador, com a data da primeira parcela da entrada e o dia de vencimento"*.
//
// ⚠️ DOIS MOMENTOS, UMA MODAL SÓ. Primeiro o PORTÃO (quem compra e se a CAD passa), depois a
// MONTAGEM (o simulador com os dois campos de cobrança). Não é um wizard: são duas telas porque a
// segunda é grande — o simulador inteiro — e porque a primeira decide se a segunda existe. Um
// wizard de três passos foi recusado no irmão da reserva pelo motivo oposto (seis campos não
// precisam de passo nenhum); aqui o passo é o próprio portão, e ele existe para ninguém montar dez
// minutos de condição comercial para descobrir no fim que a CAD do cliente está em análise.
//
// ⚠️ O PORTÃO NÃO PERGUNTA O CPF, ELE BUSCA. *"o clique em gerar proposta já busca sozinho o CPF
// que está na reserva"*: o titular vem do GET, com o selo do credenciamento junto. Um campo de CPF
// aqui seria uma segunda porta de entrada de cliente, por fora da trava de reserva por unidade — e
// a proposta sairia no nome de quem foi digitado, não de quem reservou.
//
// ⚠️ E A RECUSA DIZ EM QUE ETAPA A CAD ESTÁ. "Não credenciado" sozinho manda o coordenador ligar
// para a coordenação para descobrir o óbvio; a frase vem pronta do servidor
// (`cliente-credenciado.ts`), que é quem sabe ler a esteira, e a tela só a mostra.
//
// ⚠️ NENHUM NÚMERO NASCE AQUI. Preço, planos e piso de entrada vêm do GET; parcela, entrada e
// prazo vêm do simulador; as datas e a série vêm de `montarCronograma`, a MESMA função que o PDF e
// a rota usam. O que esta tela faz com dinheiro é escrever o que recebeu — duas contas para o mesmo
// boleto é como a PA e o carnê passam a discordar.

type CredenciamentoNaTela = {
  credenciado: boolean;
  desde: null | string;
  etapa: null | string;
  motivo: null | string;
};

type ReservaNaTela = {
  codigo: string;
  corretor: null | { id: string; nome: string };
  criadoEm: string;
  id: string;
  imobiliaria: null | { id: string; nome: string };
  titular: { cpf: string; nome: string; telefone: string };
  validadeEm: null | string;
};

/** O que o GET entrega — o contrato da rota, escrito do lado de cá. */
type PortaoDaProposta = {
  credenciamento: CredenciamentoNaTela;
  entradaMinimaPercentual: null | number;
  planos: PlanoDaVenda[];
  reserva: ReservaNaTela;
  unidade: { enterpriseId: string; id: string; nome: string; preco: number; produto: string };
};

/**
 * Um comprador na lista.
 *
 * ⚠️ O TITULAR É O PRIMEIRO E NÃO SAI. Ele é o cliente da reserva; a marca `titular` viaja no
 * pedido porque `conferirProposta` exige exatamente um, e é ela que impede a proposta de sair no
 * nome de um proponente que entrou depois.
 */
type CompradorNaTela = {
  cpf: string;
  nome: string;
  participacao: number;
  /** Só o titular tem — veio da reserva. Proponente adicionado não pede telefone. */
  telefone: null | string;
  titular: boolean;
};

/** Os campos de erro que o PORTÃO resolve. Os de dinheiro e prazo são da montagem. */
const CAMPOS_DO_PORTAO: ErroDaProposta["campo"][] = [
  "compradores",
  "cpf",
  "participacao",
  "titular",
];

const MOEDA = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

/** "R$ 178.100,00" — com espaço comum, e não o não quebrável do `Intl` (ver `reais` em `proposta.ts`). */
const dinheiro = (valor: number): string =>
  MOEDA.format(Number.isFinite(valor) ? valor : 0).replace(/\u00a0/g, " ");

export function ModalDeProposta({
  onFechar,
  onGerada,
  unidade,
}: {
  onFechar: () => void;
  onGerada: (mensagem: string) => void;
  /** O mesmo formato dos irmãos (reserva e cancelamento): o que a ficha já tem na mão. */
  unidade: { id: string; nome: string; produto: string };
}) {
  const [portao, setPortao] = useState<null | PortaoDaProposta>(null);
  const [falhaDoPortao, setFalhaDoPortao] = useState<null | string>(null);
  const [momento, setMomento] = useState<"montagem" | "portao">("portao");
  /**
   * A montagem já foi aberta alguma vez?
   *
   * ⚠️ É O QUE FAZ O "VOLTAR" NÃO APAGAR DEZ MINUTOS DE TRABALHO. Enquanto for `false` o simulador
   * nem existe no DOM — nada de rodar os efeitos dele por trás de um portão ainda fechado. Do
   * primeiro "Montar as condições" em diante ele fica montado para sempre, e o `momento` apenas o
   * ESCONDE. Guardar as condições aqui em cima em vez disso seria duplicar o cockpit inteiro do
   * simulador; esconder custa uma linha de estilo.
   */
  const [montagemJaAberta, setMontagemJaAberta] = useState(false);
  const [compradores, setCompradores] = useState<CompradorNaTela[]>([]);
  const [novo, setNovo] = useState({ cpf: "", nome: "", participacao: "" });
  const [erroDoNovo, setErroDoNovo] = useState<null | string>(null);
  const [condicoes, setCondicoes] = useState<CondicoesDaProposta | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<null | string>(null);
  const [tentou, setTentou] = useState(false);

  // ⚠️ ENQUANTO ENVIA, O ESC NÃO FECHA. Fechar a modal não cancela o POST: a proposta grava, a
  // reserva vira proposta e os três WhatsApps saem com o PDF — mas `onGerada` morre junto com a
  // tela, então não há recado na faixa nem recarga da lista. O coordenador conclui que não
  // aconteceu nada e clica de novo, e a mesma reserva gera a SEGUNDA proposta. A janela só solta
  // depois do `finally`; o rodapé diz por que ela está presa.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !enviando) onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [enviando, onFechar]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(
          `/api/incorporador/venda/proposta?unidade=${encodeURIComponent(unidade.id)}`,
          { cache: "no-store" },
        );
        const texto = await r.text();
        const corpo = texto
          ? (JSON.parse(texto) as { data?: PortaoDaProposta; error?: string })
          : {};
        if (!vivo) return;
        if (!r.ok || !corpo.data) {
          setFalhaDoPortao(corpo.error ?? "Não foi possível abrir a proposta desta unidade.");
          return;
        }
        setPortao(corpo.data);
        // ⚠️ SOZINHO, O TITULAR FICA COM 100% E SEM CAMPO. Perguntar a participação de quem compra
        // sozinho é pedir que a pessoa digite "100" para que a tela deixe ela seguir.
        setCompradores([
          {
            cpf: corpo.data.reserva.titular.cpf,
            nome: corpo.data.reserva.titular.nome,
            participacao: 100,
            telefone: corpo.data.reserva.titular.telefone,
            titular: true,
          },
        ]);
      } catch {
        if (vivo) setFalhaDoPortao("Não foi possível abrir a proposta desta unidade.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [unidade.id]);

  // ⚠️ ESTÁVEL, POR CAUSA DO EFEITO DO SIMULADOR. Ele chama esta função de dentro de um `useEffect`
  // que a tem nas dependências: uma função nova a cada render faria o efeito rodar em laço.
  const receberCondicoes = useCallback((c: CondicoesDaProposta | null) => setCondicoes(c), []);

  const participacoes = compradores.map((c) => c.participacao);
  const soma = somaDasParticipacoes(participacoes);
  const falta = faltaParaFechar(participacoes);

  const pedido: PedidoDeProposta = {
    anuaisQuantidade: condicoes?.anuaisQuantidade ?? 0,
    anuaisValor: condicoes?.anuaisValor ?? 0,
    compradores: compradores.map((c) => ({
      cpf: c.cpf,
      nome: c.nome,
      participacao: c.participacao,
      titular: c.titular,
    })),
    entradaMinimaPercentual: portao?.entradaMinimaPercentual ?? null,
    entradaValor: condicoes?.entradaValor ?? 0,
    entradaVezes: condicoes?.entradaVezes ?? 0,
    parcelas: condicoes?.parcelasMensais ?? 0,
    primeiraParcelaEm: condicoes?.primeiraParcelaEm ?? "",
    reservaId: portao?.reserva.id ?? "",
    unidadeId: unidade.id,
    valorNegociado: condicoes?.valorNegociado ?? 0,
    vencimentoDia: condicoes?.diaDeVencimento ?? 0,
  };

  // ⚠️ A MESMA RÉGUA DOS DOIS LADOS, como na reserva: `conferirProposta` roda aqui para apagar o
  // botão e roda de novo na rota, que é quem grava. A tela adianta a conversa; ela não decide.
  const erros = portao ? conferirProposta(pedido, new Date().toISOString()) : [];
  const errosDoPortao = erros.filter((e) => CAMPOS_DO_PORTAO.includes(e.campo));
  const credenciado = portao?.credenciamento.credenciado === true;
  const podeMontar = Boolean(portao) && credenciado && errosDoPortao.length === 0;

  const planoDaProposta = useMemo(
    () => portao?.planos.find((p) => p.nome === condicoes?.planoNome) ?? null,
    [condicoes?.planoNome, portao],
  );

  /**
   * O fluxo de pagamento que vai sair — datado.
   *
   * ⚠️ É `montarCronograma`, A MESMA DO PDF E DA ROTA. O rodapé mostra a entrada com data e a
   * mensal; se ele calculasse isso por conta própria, a folha que o cliente recebe poderia trazer
   * outra data ou outro valor do que a tela prometeu no clique.
   *
   * ⚠️ E ELA QUEBRA DE PROPÓSITO quando a composição não fecha (entrada + reforços valendo mais que
   * o lote). O `catch` não é para esconder o erro: é para transformá-lo na frase que apaga o botão,
   * em vez de derrubar a modal inteira com a proposta pela metade.
   */
  const fluxo = useMemo(() => {
    if (!condicoes || !planoDaProposta) return { cronograma: null, erro: null };
    try {
      return {
        cronograma: montarCronograma({
          anuaisQuantidade: condicoes.anuaisQuantidade,
          anuaisValor: condicoes.anuaisValor,
          diaDeVencimento: condicoes.diaDeVencimento,
          entradaValor: condicoes.entradaValor,
          entradaVezes: condicoes.entradaVezes,
          parcelasMensais: condicoes.parcelasMensais,
          plano: planoDaProposta as unknown as PlanoComercial,
          primeiraParcelaDaEntrada: condicoes.primeiraParcelaEm,
          valorNegociado: condicoes.valorNegociado,
        }),
        erro: null,
      };
    } catch (erro) {
      return {
        cronograma: null,
        erro: erro instanceof Error ? erro.message : "Estas condições não fecham um cronograma.",
      };
    }
  }, [condicoes, planoDaProposta]);

  /**
   * A proposta está inteira?
   *
   * ⚠️ ISTO NÃO APAGA O BOTÃO "GERAR PROPOSTA" — é o que o clique confere. O botão da montagem
   * segue o irmão da reserva: ele clica, e a tela responde POR QUE não deu. Apagado, o botão vira
   * um enigma numa tela com dez campos ("está cinza, e agora?"), e o erro que explica tudo — a
   * entrada abaixo do mínimo, a data no passado — ficaria escondido esperando um clique impossível.
   * Quem fica apagado é o botão do PORTÃO, onde o motivo está a dois centímetros dele.
   */
  const propostaInteira =
    podeMontar && Boolean(condicoes) && erros.length === 0 && fluxo.cronograma !== null;

  /**
   * Entra mais um comprador na lista.
   *
   * ⚠️ CPF INVÁLIDO E CPF REPETIDO PARAM AQUI. A régua compartilhada (`conferirProposta`) confere a
   * soma das participações e o titular único, e a soma FECHA com o mesmo CPF duas vezes: cola-se o
   * CPF do titular no lugar do da esposa e a lista vira "João 50% / João 50%", 100% redondos, sem
   * erro nenhum — até o PDF sair com o mesmo comprador repetido e o contrato nascer com uma pessoa
   * que não existe. A comparação é por DÍGITOS porque o titular vem do GET e pode chegar cru
   * ("12345678909") enquanto o campo daqui entrega formatado ("123.456.789-09").
   */
  function adicionarProponente() {
    const nome = novo.nome.trim();
    const cpf = novo.cpf.trim();
    const digitos = soDigitos(cpf);
    if (!nome || !cpf) {
      setErroDoNovo("Informe o nome e o CPF do proponente.");
      return;
    }
    if (!cpfValido(digitos)) {
      setErroDoNovo("CPF inválido. Confira os números antes de adicionar.");
      return;
    }
    if (compradores.some((c) => soDigitos(c.cpf) === digitos)) {
      setErroDoNovo("Este CPF já está entre os compradores.");
      return;
    }
    setErroDoNovo(null);
    const digitada = lerPercentualDigitado(novo.participacao);
    setCompradores((atuais) => {
      const lista: CompradorNaTela[] = [
        ...atuais,
        { cpf, nome, participacao: digitada, telefone: null, titular: false },
      ];
      // ⚠️ SEM PARTICIPAÇÃO DIGITADA, DIVIDE IGUAL. É o caso do casal (50/50) e o dos irmãos
      // (33,34 / 33,33 / 33,33), que é a esmagadora maioria — e sai fechando 100% de primeira, em
      // vez de nascer com um zero que a régua recusa. Quem quer 70/30 digita e a lista fica como
      // ele escreveu.
      if (digitada > 0) return lista;
      const iguais = participacoesIguais(lista.length);
      return lista.map((c, i) => ({ ...c, participacao: iguais[i] ?? 0 }));
    });
    setNovo({ cpf: "", nome: "", participacao: "" });
  }

  function removerProponente(indice: number) {
    setCompradores((atuais) => {
      const lista = atuais.filter((_, i) => i !== indice);
      // Sobrando só o titular, ele volta aos 100% — e o campo some junto.
      return lista.length === 1
        ? lista.map((c) => ({ ...c, participacao: 100 }))
        : lista;
    });
  }

  async function gerar() {
    setTentou(true);
    setErroDoServidor(null);
    if (!condicoes || !propostaInteira) return;

    setEnviando(true);
    try {
      const r = await fetch("/api/incorporador/venda/proposta", {
        body: JSON.stringify({
          anuaisQuantidade: condicoes.anuaisQuantidade,
          anuaisValor: condicoes.anuaisValor,
          compradores: compradores.map((c) => ({
            cpf: c.cpf,
            nome: c.nome,
            participacao: c.participacao,
            ...(c.telefone ? { telefone: c.telefone } : {}),
          })),
          diaDeVencimento: condicoes.diaDeVencimento,
          entradaValor: condicoes.entradaValor,
          entradaVezes: condicoes.entradaVezes,
          parcelasMensais: condicoes.parcelasMensais,
          planoNome: condicoes.planoNome,
          primeiraParcelaEm: condicoes.primeiraParcelaEm,
          unidadeId: unidade.id,
          valorNegociado: condicoes.valorNegociado,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const texto = await r.text();
      const corpo = texto
        ? (JSON.parse(texto) as {
            data?: {
              avisos: Array<{ motivo?: string; ok: boolean; para: string }>;
              codigo?: string;
            };
            erros?: ErroDaProposta[];
            error?: string;
          })
        : {};

      if (!r.ok) {
        setErroDoServidor(
          corpo.error ??
            corpo.erros?.map((e) => e.mensagem).join(" ") ??
            "Não foi possível gerar a proposta.",
        );
        return;
      }

      // O COD na frente, como no recado da reserva: é o número que ele anota e repete no telefone.
      const cod = corpo.data?.codigo ? `${corpo.data.codigo} · ` : "";
      onGerada(
        `${cod}Proposta de ${unidade.nome} gerada. ${comoFoiOAviso(corpo.data?.avisos ?? [])}`,
      );
    } catch {
      setErroDoServidor("Não foi possível gerar a proposta agora.");
    } finally {
      setEnviando(false);
    }
  }

  const naMontagem = momento === "montagem" && portao !== null;

  return (
    <div
      style={{
        background: "rgb(0 0 0 / .55)",
        display: "grid",
        inset: 0,
        padding: 24,
        placeItems: "center",
        position: "fixed",
        zIndex: 70,
      }}
    >
      {/* ⚠️ A MOLDURA CRESCE NO SEGUNDO MOMENTO. O portão tem a largura do irmão da reserva (é um
          formulário curto); a montagem tem a do simulador, que precisa das duas colunas — cockpit à
          esquerda, leitura à direita. Uma largura só deixaria o portão perdido num salão vazio ou o
          simulador espremido numa coluna. */}
      <div
        style={{
          background: T.page,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          color: T.text,
          display: "flex",
          flexDirection: "column",
          height: naMontagem ? "min(92vh, 900px)" : undefined,
          maxHeight: "min(92vh, 900px)",
          overflow: "hidden",
          width: naMontagem ? "min(96vw, 1280px)" : "min(94vw, 620px)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <div>
            <b style={{ fontSize: 14 }}>
              {naMontagem ? "Condições da proposta" : "Gerar proposta"} · {unidade.nome}
            </b>
            <div style={{ color: T.muted, fontSize: 11.5 }}>
              {portao?.reserva.codigo ? `COD ${portao.reserva.codigo} · ` : ""}
              {unidade.produto || portao?.unidade.produto || ""}
              {portao && portao.unidade.preco > 0
                ? ` · ${dinheiro(portao.unidade.preco)} de tabela`
                : ""}
            </div>
          </div>
          {/* ⚠️ OS DOIS SOMEM DE SERVIÇO ENQUANTO ENVIA, pelo mesmo motivo do Esc: o POST não
              volta atrás, e sair da tela no meio dele esconde uma proposta que já foi gerada. */}
          <div style={{ display: "flex", gap: 6 }}>
            {naMontagem ? (
              <button
                disabled={enviando}
                onClick={() => setMomento("portao")}
                style={enviando ? botaoDiscretoApagado : botaoDiscreto}
                type="button"
              >
                Voltar
              </button>
            ) : null}
            <button
              disabled={enviando}
              onClick={onFechar}
              style={enviando ? botaoDiscretoApagado : botaoDiscreto}
              type="button"
            >
              Fechar
            </button>
          </div>
        </div>

        {falhaDoPortao ? (
          <div style={{ padding: 16 }}>
            <p style={{ color: T.danger, fontSize: 13, margin: 0 }}>{falhaDoPortao}</p>
          </div>
        ) : !portao ? (
          <div style={{ padding: 16 }}>
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
          </div>
        ) : (
          <>
            {/* ═══ A MONTAGEM ═══════════════════════════════════════════════
                ⚠️ ESCONDIDA, NUNCA DESMONTADA. Trocar de ramo aqui jogava fora o
                `SimuladorDeProposta` e, com ele, o estado local inteiro: plano, valor negociado,
                entrada, vezes, prazo, reforços, dia de vencimento e a data da primeira parcela. O
                "Voltar" serve para conferir um CPF no portão, não para mandar remontar dez minutos
                de condição comercial — que é exatamente o que o portão existe para evitar. */}
            {montagemJaAberta ? (
              <div
                style={{
                  display: naMontagem ? "flex" : "none",
                  flex: "1 1 auto",
                  flexDirection: "column",
                  minHeight: 0,
                }}
              >
                <div style={{ background: T.page, flex: "1 1 auto", minHeight: 0, padding: 14 }}>
                  <SimuladorDeProposta
                    aoMudarCondicoes={receberCondicoes}
                    entradaMinimaPercentual={portao.entradaMinimaPercentual}
                    planos={portao.planos}
                    unidade={unidade.nome}
                    valorDaUnidade={portao.unidade.preco}
                  />
                </div>

                <div
                  style={{
                    borderTop: `1px solid ${T.border}`,
                    display: "grid",
                    gap: 10,
                    padding: "12px 16px",
                  }}
                >
                  <FluxoQueVaiSair
                    cronograma={fluxo.cronograma}
                    diaDeVencimento={condicoes?.diaDeVencimento ?? 0}
                    erro={fluxo.erro}
                    semComposicao={condicoes === null}
                    semPlano={condicoes !== null && planoDaProposta === null}
                  />

                  {tentou && erros.length > 0 ? (
                    <div style={{ display: "grid", gap: 3 }}>
                      {erros.map((e) => (
                        <Erro key={`${e.campo}-${e.mensagem}`} texto={e.mensagem} />
                      ))}
                    </div>
                  ) : null}
                  {erroDoServidor ? <Erro texto={erroDoServidor} /> : null}

                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: 12,
                      justifyContent: "space-between",
                    }}
                  >
                    {/* ⚠️ DURANTE O ENVIO A FRASE MUDA, e é ela que explica a janela presa — o Esc e
                        o Fechar estão desligados de propósito. Sem esse recado a modal parada parece
                        travada, e o coordenador vai procurar um jeito de sair dela, que é justamente o
                        caminho que faz a proposta nascer sem ninguém ficar sabendo. */}
                    <span
                      role="status"
                      style={{ color: enviando ? T.sub : T.muted, fontSize: 11.5 }}
                    >
                      {enviando
                        ? "Gerando a proposta e enviando o PDF por WhatsApp. Não feche esta janela até terminar."
                        : "Ao gerar, a proposta fica cadastrada e o PDF vai por WhatsApp para coordenador, imobiliária e corretor."}
                    </span>
                    <button
                      disabled={enviando}
                      onClick={gerar}
                      style={{
                        background: enviando ? T.soft : T.btnBg,
                        border: `1px solid ${enviando ? T.border : "transparent"}`,
                        borderRadius: 9,
                        color: enviando ? T.muted : T.btnFg,
                        cursor: enviando ? "default" : "pointer",
                        font: "inherit",
                        fontSize: 13,
                        fontWeight: 650,
                        padding: "9px 20px",
                        whiteSpace: "nowrap",
                      }}
                      type="button"
                    >
                      {enviando ? "Gerando…" : "Gerar proposta"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ═══ O PORTÃO ═════════════════════════════════════════════════
                Escondido pelo mesmo motivo: a lista de participações e o proponente meio digitado
                continuam onde estavam quando a montagem volta ao ar. */}
            <div
              style={{
                display: naMontagem ? "none" : "flex",
                flexDirection: "column",
                minHeight: 0,
                overflow: "hidden",
              }}
            >
              <div style={{ display: "grid", gap: 14, overflow: "auto", padding: 16 }}>
                <section style={bloco}>
                  <div style={rotulo}>O cliente da reserva</div>
                  <div style={{ alignItems: "baseline", display: "flex", gap: 8 }}>
                    <b style={{ fontSize: 13.5 }}>{portao.reserva.titular.nome}</b>
                    <span style={{ color: T.muted, fontSize: 11.5 }}>
                      {formatarDocumento(soDigitos(portao.reserva.titular.cpf)) ||
                        portao.reserva.titular.cpf}
                    </span>
                  </div>
                  <div style={{ color: T.muted, fontSize: 11.5, marginTop: 2 }}>
                    {portao.reserva.imobiliaria?.nome ?? "Sem imobiliária"}
                    {portao.reserva.corretor ? ` · ${portao.reserva.corretor.nome}` : ""}
                  </div>

                  {/* ⚠️ O SELO É A DECISÃO, e vem inteiro do servidor. Verde: segue. Vermelho: a frase
                      diz em que etapa a CAD está e desde quando — é com ela que o coordenador sabe a
                      quem cobrar, em vez de ligar para descobrir o que a tela já sabia. */}
                  <div
                    style={{
                      background: credenciado ? T.okBg : T.dangerBg,
                      border: `1px solid ${credenciado ? T.ok : T.danger}`,
                      borderRadius: 10,
                      marginTop: 10,
                      padding: "8px 11px",
                    }}
                  >
                    <b style={{ color: credenciado ? T.ok : T.danger, fontSize: 12 }}>
                      {credenciado ? "CAD credenciada neste empreendimento" : "CAD não credenciada"}
                    </b>
                    <div style={{ color: T.sub, fontSize: 11.5, marginTop: 2 }}>
                      {credenciado
                        ? "A reserva pode virar proposta."
                        : (portao.credenciamento.motivo ??
                          "A CAD deste cliente ainda não está credenciada neste empreendimento.")}
                    </div>
                  </div>

                  <p style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}>
                    O cliente é o da reserva e não se troca. Para trocar, cancele a reserva e reserve
                    de novo.
                  </p>
                </section>

                {/* ── QUEM COMPRA ──────────────────────────────────────────── */}
                <section style={bloco}>
                  <div style={rotulo}>Quem compra</div>

                  <div style={{ display: "grid", gap: 6 }}>
                    {compradores.map((c, i) => (
                      <div
                        key={`${c.cpf}-${i}`}
                        style={{
                          alignItems: "center",
                          background: T.soft,
                          border: `1px solid ${T.border}`,
                          borderRadius: 10,
                          display: "flex",
                          gap: 10,
                          justifyContent: "space-between",
                          padding: "8px 11px",
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <b style={{ fontSize: 12.5 }}>{c.nome}</b>
                          <div style={{ color: T.muted, fontSize: 11 }}>
                            {formatarDocumento(soDigitos(c.cpf)) || c.cpf}
                            {c.titular ? " · titular" : ""}
                          </div>
                        </span>

                        <span style={{ alignItems: "center", display: "flex", gap: 8 }}>
                          {/* ⚠️ COM UM COMPRADOR SÓ O CAMPO NEM APARECE: ele tem 100%, e digitar isso
                              seria trabalho para confirmar o óbvio. */}
                          {compradores.length > 1 ? (
                            <CampoDeParticipacao
                              aoMudar={(v) =>
                                setCompradores((atuais) =>
                                  atuais.map((outro, j) =>
                                    j === i ? { ...outro, participacao: v } : outro,
                                  ),
                                )
                              }
                              valor={c.participacao}
                            />
                          ) : (
                            <span style={{ color: T.muted, fontSize: 12 }}>100%</span>
                          )}
                          {c.titular ? null : (
                            <button
                              onClick={() => removerProponente(i)}
                              style={{ ...botaoDiscreto, padding: "4px 9px" }}
                              type="button"
                            >
                              Tirar
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* A SOMA, e quanto falta. ⚠️ Ela não decide nada: quem apaga o botão é o erro de
                      `conferirProposta`, logo abaixo. Esta linha existe para a pessoa não ter que
                      somar de cabeça enquanto digita. */}
                  {compradores.length > 1 ? (
                    <div
                      style={{
                        alignItems: "baseline",
                        display: "flex",
                        gap: 10,
                        justifyContent: "space-between",
                        marginTop: 8,
                      }}
                    >
                      <span style={{ color: falta === 0 ? T.ok : T.muted, fontSize: 11.5 }}>
                        Soma {soma.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                        {falta === 0
                          ? " · fecha"
                          : falta > 0
                            ? ` · faltam ${falta.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
                            : ` · passou ${(-falta).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
                      </span>
                      <button
                        onClick={() =>
                          setCompradores((atuais) => {
                            const iguais = participacoesIguais(atuais.length);
                            return atuais.map((c, i) => ({ ...c, participacao: iguais[i] ?? 0 }));
                          })
                        }
                        style={{
                          background: "transparent",
                          border: "none",
                          color: T.gold,
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: 11,
                          fontWeight: 700,
                          padding: 0,
                        }}
                        type="button"
                      >
                        dividir igualmente
                      </button>
                    </div>
                  ) : null}

                  {errosDoPortao.map((e) => (
                    <Erro key={`${e.campo}-${e.mensagem}`} texto={e.mensagem} />
                  ))}

                  {/* ── ADICIONAR PROPONENTE ──────────────────────────────── */}
                  <div style={{ borderTop: `1px dashed ${T.border}`, marginTop: 12, paddingTop: 12 }}>
                    <div style={{ ...rotulo, marginBottom: 6 }}>Adicionar proponente</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <input
                        onChange={(e) => setNovo((a) => ({ ...a, nome: e.target.value }))}
                        placeholder="Nome completo"
                        style={campo}
                        value={novo.nome}
                      />
                      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr 110px 96px" }}>
                        <input
                          onChange={(e) =>
                            setNovo((a) => ({
                              ...a,
                              cpf: formatarDocumento(soDigitos(e.target.value).slice(0, 11)) ||
                                e.target.value,
                            }))
                          }
                          placeholder="CPF"
                          style={campo}
                          value={novo.cpf}
                        />
                        <input
                          inputMode="decimal"
                          onChange={(e) => setNovo((a) => ({ ...a, participacao: e.target.value }))}
                          placeholder="% (opcional)"
                          style={campo}
                          value={novo.participacao}
                        />
                        <button onClick={adicionarProponente} style={botaoDiscreto} type="button">
                          Adicionar
                        </button>
                      </div>
                    </div>
                    {erroDoNovo ? <Erro texto={erroDoNovo} /> : null}
                    <p style={{ color: T.muted, fontSize: 11, margin: "6px 0 0" }}>
                      Sem a %, a tela divide igualmente entre todos os compradores.
                    </p>
                  </div>
                </section>

                {erroDoServidor ? <Erro texto={erroDoServidor} /> : null}
              </div>

              <div
                style={{
                  alignItems: "center",
                  borderTop: `1px solid ${T.border}`,
                  display: "flex",
                  gap: 10,
                  justifyContent: "space-between",
                  padding: "12px 16px",
                }}
              >
                <span style={{ color: T.muted, fontSize: 11.5 }}>
                  {credenciado
                    ? "Depois vem a montagem: plano, entrada, prazo e as datas de cobrança."
                    : "Sem a CAD credenciada neste empreendimento a proposta não pode ser gerada."}
                </span>
                <button
                  disabled={!podeMontar}
                  onClick={() => {
                    // ⚠️ SÓ SOBE, NUNCA DESCE: é a marca de que o simulador já foi montado. Do
                    // segundo clique em diante este `setMomento` apenas o revela de novo.
                    setMontagemJaAberta(true);
                    setMomento("montagem");
                  }}
                  style={{
                    background: podeMontar ? T.btnBg : T.soft,
                    border: `1px solid ${podeMontar ? "transparent" : T.border}`,
                    borderRadius: 9,
                    color: podeMontar ? T.btnFg : T.muted,
                    cursor: podeMontar ? "pointer" : "default",
                    font: "inherit",
                    fontSize: 13,
                    fontWeight: 650,
                    padding: "9px 20px",
                    whiteSpace: "nowrap",
                  }}
                  type="button"
                >
                  Montar as condições
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * O rodapé da montagem: a entrada datada e a parcela, como o comprador vai ler.
 *
 * ⚠️ TUDO SAI DO CRONOGRAMA, INCLUSIVE AS DATAS. Nenhum número é recalculado aqui — nem o valor de
 * cada parte da entrada, nem o dia da primeira mensal. O que a tela promete no clique é o que o PDF
 * imprime depois, porque os dois leem a mesma função.
 */
function FluxoQueVaiSair({
  cronograma,
  diaDeVencimento,
  erro,
  semComposicao,
  semPlano,
}: {
  cronograma: null | ReturnType<typeof montarCronograma>;
  diaDeVencimento: number;
  erro: null | string;
  semComposicao: boolean;
  semPlano: boolean;
}) {
  if (semComposicao) {
    return (
      <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>
        Monte as condições acima: nenhuma composição fecha com o que está na tela.
      </p>
    );
  }
  if (semPlano) {
    return (
      <p style={{ color: T.danger, fontSize: 12, margin: 0 }}>
        Este produto não tem plano comercial cadastrado, e a proposta sai do plano. Cadastre em
        Política Comercial antes de gerar.
      </p>
    );
  }
  if (erro || !cronograma) {
    return <p style={{ color: T.danger, fontSize: 12, margin: 0 }}>{erro}</p>;
  }

  const primeiraDaEntrada = cronograma.entrada[0];
  const primeiraMensal = cronograma.mensais[0];
  const primeiraAnual = cronograma.anuais[0];

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        display: "grid",
        gap: 4,
        padding: "9px 12px",
      }}
    >
      <div style={{ ...rotulo, marginBottom: 2 }}>O que vai sair</div>
      {primeiraDaEntrada ? (
        <span style={{ fontSize: 12.5 }}>
          Entrada <b>{dinheiro(cronograma.totais.entrada)}</b> em{" "}
          <b>{cronograma.entrada.length}x</b>, a primeira de{" "}
          <b>{dinheiro(primeiraDaEntrada.valor)}</b> em{" "}
          <b>{dataEscrita(primeiraDaEntrada.vencimento)}</b>
        </span>
      ) : (
        <span style={{ color: T.muted, fontSize: 12.5 }}>Sem entrada.</span>
      )}
      {primeiraMensal ? (
        <span style={{ fontSize: 12.5 }}>
          Depois <b>{cronograma.mensais.length}x</b> de{" "}
          <b>{dinheiro(primeiraMensal.valor)}</b>, todo dia <b>{diaDeVencimento}</b>, a primeira em{" "}
          <b>{dataEscrita(primeiraMensal.vencimento)}</b>
          {/* ⚠️ O AVISO DO DEGRAU. No SACOC a parcela sobe no 13º mês, e anunciar "120x de X" sem
              dizer isso é a promessa que o boleto do ano seguinte desmente — o mesmo cuidado que
              `avisosDaProposta` tem no texto do WhatsApp. */}
          {cronograma.reajustes.length > 1 ? " (o valor muda no aniversário do contrato)" : ""}
        </span>
      ) : null}
      {primeiraAnual ? (
        <span style={{ fontSize: 12.5 }}>
          E <b>{cronograma.anuais.length}x</b> de <b>{dinheiro(primeiraAnual.valor)}</b> ao ano, a
          primeira em <b>{dataEscrita(primeiraAnual.vencimento)}</b>
        </span>
      ) : null}
    </div>
  );
}

/**
 * A participação de um comprador, em %.
 *
 * ⚠️ O TEXTO É DA PESSOA ENQUANTO ELA DIGITA — o mesmo cuidado dos campos do simulador. Reescrever
 * o campo a cada tecla come a vírgula de "33,33" no instante em que ela é escrita.
 */
function CampoDeParticipacao({
  aoMudar,
  valor,
}: {
  aoMudar: (v: number) => void;
  valor: number;
}) {
  const escreve = (v: number) =>
    v > 0 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "";
  const [texto, setTexto] = useState(escreve(valor));

  useEffect(() => {
    setTexto((atual) =>
      lerPercentualDigitado(atual) === Math.round(valor * 100) / 100 ? atual : escreve(valor),
    );
  }, [valor]);

  return (
    <span style={{ alignItems: "center", display: "flex", position: "relative" }}>
      <input
        inputMode="decimal"
        onBlur={() => setTexto(escreve(valor))}
        onChange={(e) => {
          setTexto(e.target.value);
          aoMudar(lerPercentualDigitado(e.target.value));
        }}
        placeholder="0"
        style={{ ...campo, paddingRight: 24, textAlign: "right", width: 78 }}
        value={texto}
      />
      <span
        style={{
          color: T.muted,
          fontSize: 11.5,
          fontWeight: 600,
          pointerEvents: "none",
          position: "absolute",
          right: 8,
        }}
      >
        %
      </span>
    </span>
  );
}

const bloco = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 12,
} as const;

const rotulo = {
  color: T.muted,
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  marginBottom: 8,
  textTransform: "uppercase",
} as const;

const campo = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  font: "inherit",
  fontSize: 13,
  padding: "8px 10px",
  width: "100%",
} as const;

const botaoDiscreto = {
  background: "transparent",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.sub,
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  padding: "5px 12px",
} as const;

/** O mesmo botão, apagado — é o Fechar e o Voltar enquanto a proposta está sendo enviada. */
const botaoDiscretoApagado = {
  ...botaoDiscreto,
  color: T.muted,
  cursor: "default",
} as const;

function Erro({ texto }: { texto: string }) {
  return <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>{texto}</p>;
}
