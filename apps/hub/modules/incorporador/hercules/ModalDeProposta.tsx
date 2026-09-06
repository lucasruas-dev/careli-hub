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
  PRAZO_PADRAO_DA_PROPOSTA,
  PRAZOS_DA_PROPOSTA,
} from "@/lib/hercules/proposta";
import {
  faltaParaFechar,
  lerPercentualDigitado,
  participacoesIguais,
  somaDasParticipacoes,
} from "@/lib/hercules/proposta-na-tela";
import { type ProponenteEncontrado, termoDaBusca } from "@/lib/hercules/busca-de-proponente";
import { comoFoiOAviso, vencimentoEmDias } from "@/lib/hercules/reserva";

import {
  type CondicoesDaProposta,
  SimuladorDeProposta,
} from "./SimuladorDeProposta";

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
// prazo de parcelamento vêm do simulador; as datas e a série vêm de `montarCronograma`, a MESMA
// função que o PDF e a rota usam; os dias de validade e o padrão vêm de `proposta.ts`
// (`PRAZOS_DA_PROPOSTA`), e a data que eles produzem, de `vencimentoEmDias`. O que esta tela faz
// com dinheiro e com prazo é escrever o que recebeu — duas contas para o mesmo boleto é como a PA
// e o carnê passam a discordar.

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
  unidade: {
    enterpriseId: string;
    id: string;
    nome: string;
    preco: number;
    produto: string;
  };
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

const MOEDA = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  style: "currency",
});

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
  /** Os candidatos que a base devolveu para o que está escrito no campo de nome. */
  const [candidatos, setCandidatos] = useState<ProponenteEncontrado[]>([]);
  const [buscando, setBuscando] = useState(false);
  /**
   * A busca FALHOU (rede, 500, sessão caída) — diferente de "não achou".
   *
   * ⚠️ AS DUAS COISAS DIZIAM A MESMA FRASE, e a frase manda agir: "CAD não encontrada, abra a CAD
   * antes de incluí-lo". Numa falha de servidor isso é uma instrução errada — o corretor abre uma
   * CAD duplicada para alguém que já tem a dele credenciada.
   */
  const [falhouABusca, setFalhouABusca] = useState(false);
  /** A lista fechada por clique fora ou Escape, sem perder o que já foi digitado. */
  const [listaFechada, setListaFechada] = useState(false);
  /**
   * A CAD escolhida na lista.
   *
   * ⚠️ ELA É O QUE AUTORIZA O "ADICIONAR". Enquanto for nula, o que está no campo é só um texto de
   * busca: sem CAD escolhida não há CPF, e sem CPF não há comprador. É isto que fecha a porta que a
   * digitação livre deixava aberta.
   */
  const [escolhido, setEscolhido] = useState<null | ProponenteEncontrado>(null);
  const [condicoes, setCondicoes] = useState<CondicoesDaProposta | null>(null);
  /**
   * Por quantos dias a proposta vale.
   *
   * ⚠️ MORA AQUI, E NÃO DENTRO DO SIMULADOR. O prazo não é condição comercial: ele não muda
   * parcela, entrada nem plano, e `CondicoesDaProposta` é justamente o que o cockpit calcula e
   * devolve. Guardá-lo lá dentro faria a validade viajar junto com dinheiro por um caminho que
   * existe para dinheiro, e o dia em que o simulador for reaproveitado em outra tela ele levaria
   * junto uma regra de prazo que não é dele.
   */
  const [prazoEmDias, setPrazoEmDias] = useState<number>(
    PRAZO_PADRAO_DA_PROPOSTA,
  );
  const [enviando, setEnviando] = useState(false);
  /** A prévia no ar. Estado próprio: ela não prende a modal como o envio prende. */
  const [buscandoPrevia, setBuscandoPrevia] = useState(false);
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
          setFalhaDoPortao(
            corpo.error ?? "Não foi possível abrir a proposta desta unidade.",
          );
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
        if (vivo)
          setFalhaDoPortao("Não foi possível abrir a proposta desta unidade.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [unidade.id]);

  // ⚠️ ESTÁVEL, POR CAUSA DO EFEITO DO SIMULADOR. Ele chama esta função de dentro de um `useEffect`
  // que a tem nas dependências: uma função nova a cada render faria o efeito rodar em laço.
  const receberCondicoes = useCallback(
    (c: CondicoesDaProposta | null) => setCondicoes(c),
    [],
  );

  /**
   * Até quando a proposta vale, em ISO — o fim do dia do último dia do prazo.
   *
   * ⚠️ A CONTA É DE `vencimentoEmDias`, A MESMA DA RESERVA. Ela é quem sabe que o fim do prazo é o
   * último segundo do dia no fuso da operação (−03:00 fixo): uma conta escrita aqui com
   * `Date.now() + dias * 86_400_000` faria a proposta de 7 dias vencer às 14h da quinta, no meio
   * do expediente em que o cliente ia responder, e ainda erraria o dia para quem gera de noite.
   */
  // ⚠️ ISTO AQUI É SÓ A PRÉVIA — QUEM CONTA OS DIAS DE VERDADE É O SERVIDOR. A tela envia o NÚMERO
  // de dias, não esta data: com a data pronta, quem decidia o vencimento era o relógio do
  // navegador, e abrir a modal às 23h55 para enviar às 00h05 gravava o prazo contado a partir de
  // ontem — o chip dizia três dias e o cliente recebia dois e pouco. Uma aba deixada aberta além do
  // prazo passava a receber 422 sobre uma data que ninguém digitou, e clicar no mesmo prazo não
  // recalculava nada. Aqui a data existe para a frase "vence em 11/09"; o que vale é o número.
  const validadeEm = useMemo(
    () => vencimentoEmDias(new Date().toISOString(), prazoEmDias),
    [prazoEmDias],
  );

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
    // ⚠️ OS DOIS CAMPOS QUE FALTAVAM AQUI DESARMAVAM METADE DA RÉGUA NA TELA. Sem
    // `entradaParcelas`, a conferência do cliente não via a montagem: uma entrada montada somando
    // MENOS que o combinado deixava o botão "Gerar proposta" aceso, e a pessoa só descobria o
    // problema no 422 do servidor, depois de clicar. Sem `planosDaTabela`, a faixa do prazo não era
    // conferida aqui — mesma coisa com a proposta de 30x a 10%.
    //
    // ⚠️ É A MESMA RÉGUA DOS DOIS LADOS, e é isso que a torna útil: a tela adianta a conversa, o
    // servidor decide. Alimentar só um dos dois faz a tela prometer o que a rota recusa.
    entradaParcelas: condicoes?.entradaParcelas ?? null,
    entradaValor: condicoes?.entradaValor ?? 0,
    entradaVezes: condicoes?.entradaVezes ?? 0,
    parcelas: condicoes?.parcelasMensais ?? 0,
    planosDaTabela: (portao?.planos ?? []).map((p) => ({
      entradaPercentual: p.entradaPercentual,
      nome: p.nome,
      parcelas: p.parcelas,
    })),
    primeiraParcelaEm: condicoes?.primeiraParcelaEm ?? "",
    reservaId: portao?.reserva.id ?? "",
    unidadeId: unidade.id,
    validadeEm,
    valorNegociado: condicoes?.valorNegociado ?? 0,
    vencimentoDia: condicoes?.diaDeVencimento ?? 0,
  };

  // ⚠️ A MESMA RÉGUA DOS DOIS LADOS, como na reserva: `conferirProposta` roda aqui para apagar o
  // botão e roda de novo na rota, que é quem grava. A tela adianta a conversa; ela não decide.
  const erros = portao
    ? conferirProposta(pedido, new Date().toISOString())
    : [];
  const errosDoPortao = erros.filter((e) => CAMPOS_DO_PORTAO.includes(e.campo));
  const credenciado = portao?.credenciamento.credenciado === true;
  const podeMontar =
    Boolean(portao) && credenciado && errosDoPortao.length === 0;

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
          entradaParcelas: condicoes.entradaParcelas,
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
        erro:
          erro instanceof Error
            ? erro.message
            : "Estas condições não fecham um cronograma.",
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
    podeMontar &&
    Boolean(condicoes) &&
    erros.length === 0 &&
    fluxo.cronograma !== null;

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
    // ⚠️ A % NÃO É OPCIONAL (Lucas, 05/09/2026: *"% não é opcional, ela é uma informação que vai
    // estar no contrato, não pode ser opcional"*). Ela nasceu como conveniência — em branco, a tela
    // dividia igualmente — e a conveniência escondia uma decisão jurídica: quanto do imóvel é de
    // cada um sai escrito na minuta e vai para o cartório. Deixar o sistema escolher por omissão é
    // deixar o sistema decidir a partilha; e 50/50 "óbvio" do casal deixa de ser óbvio no dia em que
    // um deles entrou com a entrada inteira.
    const digitada = lerPercentualDigitado(novo.participacao);
    if (!(digitada > 0)) {
      setErroDoNovo("Informe a % de participação: ela vai no contrato.");
      return;
    }
    if (digitada >= 100) {
      setErroDoNovo("A participação do proponente tem que ser menor que 100%.");
      return;
    }
    // ⚠️ A CONTA É CONTRA O QUE JÁ FOI DADO, e não só contra 100. Com um proponente de 70% na lista,
    // digitar 50% para o segundo levava o titular a −20% — e o `Math.max(0, ...)` abaixo zerava a
    // parte dele CALADO, deixando a soma em 120% num número que vai escrito na minuta e no cartório.
    const jaDadoAosOutros =
      Math.round(
        compradores.filter((c) => !c.titular).reduce((total, c) => total + c.participacao, 0) * 100,
      ) / 100;
    const sobraParaOTitular = Math.round((100 - jaDadoAosOutros - digitada) * 100) / 100;
    if (sobraParaOTitular <= 0) {
      setErroDoNovo(
        jaDadoAosOutros > 0
          ? `Os demais proponentes já somam ${jaDadoAosOutros}%. Sobra no máximo ${
              Math.round((100 - jaDadoAosOutros) * 100) / 100
            }% para este, e o titular precisa ficar com alguma parte.`
          : "A participação do proponente tem que ser menor que 100%.",
      );
      return;
    }

    setErroDoNovo(null);
    setCompradores((atuais) => {
      // ⚠️ O TITULAR ABSORVE O RESTANTE, e é isto que mantém a soma em 100% sem pedir dois números
      // para a mesma conta: quem digita 40% para a esposa está dizendo que o titular fica com 60%.
      // Os DEMAIS proponentes ficam como estão — eles já tiveram a sua % informada quando entraram.
      const dosOutros = atuais
        .filter((c) => !c.titular)
        .reduce((total, c) => total + c.participacao, 0);
      const doTitular = Math.round((100 - dosOutros - digitada) * 100) / 100;

      return [
        ...atuais.map((c) =>
          c.titular ? { ...c, participacao: Math.max(0, doTitular) } : c,
        ),
        { cpf, nome, participacao: digitada, telefone: null, titular: false },
      ];
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

  /**
   * Busca na base enquanto ele digita.
   *
   * ⚠️ ESPERA 300ms ANTES DE PERGUNTAR. Sem isso sai uma consulta por tecla — dez requisições para
   * escrever "Larissa", numa casa que já teve incidente de fatura por chamada demais. E o termo
   * curto nem chega ao servidor: a régua de `termoDaBusca` roda dos dois lados.
   */
  useEffect(() => {
    const termo = novo.nome.trim();
    // ⚠️ A MESMA RÉGUA DOS DOIS LADOS, e não só no servidor. Uma letra digitada disparava consulta
    // e voltava vazia, e a tela anunciava "CAD não encontrada" para quem tinha acabado de encostar
    // no teclado — a frase mais cara da modal, dita cedo demais.
    const decidido = termoDaBusca(termo);
    if (escolhido || termo.length === 0 || decidido.tipo === "curto") {
      setCandidatos([]);
      setBuscando(false);
      setFalhouABusca(false);
      return;
    }

    let vivo = true;
    setBuscando(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await fetch(
            `/api/incorporador/venda/proponentes?unidade=${encodeURIComponent(
              unidade.id,
            )}&q=${encodeURIComponent(termo)}`,
            { cache: "no-store" },
          );
          const j = (await r.json().catch(() => null)) as null | {
            data?: { encontrados: ProponenteEncontrado[] };
          };
          if (!vivo) return;
          // ⚠️ CONFERE QUE É LISTA, e não só que a resposta veio. `r.ok` com um corpo de outro
          // formato (um 200 de proxy, uma rota que mudou de contrato) guardaria `undefined` aqui, e
          // o `candidatos.length` do render seguinte derrubaria a modal inteira — com as condições
          // que o coordenador acabou de montar dentro dela.
          const achados = j?.data?.encontrados;
          const deuCerto = r.ok && Array.isArray(achados);
          setCandidatos(deuCerto ? achados : []);
          setFalhouABusca(!deuCerto);
        } catch {
          if (vivo) {
            setCandidatos([]);
            setFalhouABusca(true);
          }
        } finally {
          if (vivo) setBuscando(false);
        }
      })();
    }, 300);

    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [escolhido, novo.nome, unidade.id]);

  /**
   * O corpo do pedido — o MESMO para a prévia e para a geração.
   *
   * ⚠️ UM OBJETO SÓ, DE PROPÓSITO. Se a prévia montasse o dela, bastaria um campo esquecido para o
   * papel conferido sair diferente do papel gerado — e a prévia existe justamente para o
   * coordenador conferir o que vai ser enviado.
   */
  function corpoDoPedido(condicoesAgora: NonNullable<typeof condicoes>) {
    return {
      anuaisQuantidade: condicoesAgora.anuaisQuantidade,
      anuaisValor: condicoesAgora.anuaisValor,
      compradores: compradores.map((c) => ({
        cpf: c.cpf,
        nome: c.nome,
        participacao: c.participacao,
        ...(c.telefone ? { telefone: c.telefone } : {}),
      })),
      diaDeVencimento: condicoesAgora.diaDeVencimento,
      entradaValor: condicoesAgora.entradaValor,
      entradaParcelas: condicoesAgora.entradaParcelas,
      entradaVezes: condicoesAgora.entradaVezes,
      parcelasMensais: condicoesAgora.parcelasMensais,
      planoNome: condicoesAgora.planoNome,
      primeiraParcelaEm: condicoesAgora.primeiraParcelaEm,
      // ⚠️ VAI O NÚMERO DE DIAS, E NÃO A DATA. Quem transforma prazo em vencimento é o servidor,
      // com o relógio dele: a data pronta punha o relógio do navegador para decidir quando a
      // proposta vence, e uma modal aberta antes da meia-noite gravava o prazo contado a partir
      // de ontem. A data que a tela mostra ao lado dos chips é prévia, e prévia não se envia.
      prazoEmDias,
      unidadeId: unidade.id,
      valorNegociado: condicoesAgora.valorNegociado,
    };
  }

  /**
   * VER O PAPEL ANTES DE GERAR (Lucas, 05/09/2026: *"podia ter um botão para ter uma prévia da
   * proposta"*).
   *
   * ⚠️ A ABA ABRE ANTES DO `fetch`, e não depois. Chamar `window.open` já com o PDF pronto seria
   * chamá-lo fora do clique — todo navegador com bloqueio de pop-up engole essa janela, e o
   * coordenador clica num botão que não faz nada.
   */
  async function verPrevia() {
    setTentou(true);
    setErroDoServidor(null);
    if (!condicoes || !propostaInteira) return;

    // ⚠️ SEM `noopener` NAS FEATURES: com ele, `window.open` devolve NULL por especificação — o
    // recado de pop-up bloqueado apareceria em TODO clique, com uma aba em branco órfã aberta ao
    // lado, e a prévia nunca abriria. O opener é cortado na mão logo abaixo, que dá a mesma
    // proteção sem o efeito colateral.
    const aba = window.open("", "_blank");
    setBuscandoPrevia(true);
    try {
      const r = await fetch("/api/incorporador/venda/proposta", {
        body: JSON.stringify({ ...corpoDoPedido(condicoes), previa: true }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      if (!r.ok) {
        aba?.close();
        const corpo = (await r.json().catch(() => null)) as null | {
          erros?: ErroDaProposta[];
          error?: string;
        };
        setErroDoServidor(
          corpo?.error ??
            corpo?.erros?.map((e) => e.mensagem).join(" ") ??
            "Não foi possível montar a prévia.",
        );
        return;
      }

      const endereco = URL.createObjectURL(await r.blob());
      if (aba) {
        // A aba é nossa e o destino é um `blob:` deste documento; ainda assim ela vai sem opener.
        aba.opener = null;
        aba.location.href = endereco;
      }
      // ⚠️ SEM ABA NÃO HÁ SILÊNCIO: o bloqueio de pop-up é do navegador, e sem este recado o botão
      // simplesmente não responde.
      else
        setErroDoServidor(
          "Libere as janelas deste site no navegador para ver a prévia.",
        );
      // O endereço vive enquanto a aba carrega; segurá-lo para sempre vazaria o PDF na memória.
      setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
    } catch {
      aba?.close();
      setErroDoServidor("Não foi possível montar a prévia agora.");
    } finally {
      setBuscandoPrevia(false);
    }
  }

  async function gerar() {
    setTentou(true);
    setErroDoServidor(null);
    if (!condicoes || !propostaInteira) return;

    setEnviando(true);
    try {
      const r = await fetch("/api/incorporador/venda/proposta", {
        body: JSON.stringify(corpoDoPedido(condicoes)),
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
          // ⚠️ O TETO DE 900px ERA O QUE CRIAVA A BARRA DE ROLAGEM (Lucas, 05/09/2026: *"aumenta
          // essa tela para não ter barra de rolagem"*). Numa tela de 1080 sobravam mais de 100px
          // de altura sem uso, e o cockpit da esquerda — lote, parcela, entrada, cobrança, um
          // embaixo do outro — rolava mesmo com espaço livre logo abaixo da modal. Na montagem o
          // limite passa a ser só a janela; o 900 continua valendo no modo estreito (o portão),
          // que é curto e não deve esticar numa tela grande.
          height: naMontagem ? "92vh" : undefined,
          maxHeight: naMontagem ? "92vh" : "min(92vh, 900px)",
          overflow: "hidden",
          width: naMontagem ? "min(97vw, 1440px)" : "min(94vw, 620px)",
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
              {naMontagem ? "Condições da proposta" : "Gerar proposta"} ·{" "}
              {unidade.nome}
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
            <p style={{ color: T.danger, fontSize: 13, margin: 0 }}>
              {falhaDoPortao}
            </p>
          </div>
        ) : !portao ? (
          <div style={{ padding: 16 }}>
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Carregando…
            </p>
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
                <div
                  style={{
                    background: T.page,
                    flex: "1 1 auto",
                    minHeight: 0,
                    padding: 14,
                  }}
                >
                  <SimuladorDeProposta
                    aoMudarCondicoes={receberCondicoes}
                    entradaMinimaPercentual={portao.entradaMinimaPercentual}
                    planos={portao.planos}
                    previa={
                      fluxo.cronograma ? (
                        <PreviaDaProposta
                          cronograma={fluxo.cronograma}
                          diaDeVencimento={condicoes?.diaDeVencimento ?? 0}
                        />
                      ) : null
                    }
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
                    erro={fluxo.erro}
                    semComposicao={condicoes === null}
                    semPlano={condicoes !== null && planoDaProposta === null}
                  />

                  {/* ⚠️ O PRAZO FICA NO RODAPÉ, JUNTO DO BOTÃO — e não no cockpit do simulador. Ele
                      não é condição comercial: não muda parcela, entrada nem plano, e nada do que
                      está acima se recalcula quando ele troca. O que ele decide é o ATO de gerar
                      ("até quando este papel vale"), e é aqui, na mesma linha de leitura do "o que
                      vai sair" e do clique, que a pessoa confere a promessa inteira antes de
                      soltá-la. No meio do cockpit ele viraria mais um campo de simulação, e o
                      coordenador acabaria mexendo nele enquanto procura a parcela. */}
                  <PrazoDaProposta
                    aoMudar={setPrazoEmDias}
                    dias={prazoEmDias}
                    validadeEm={validadeEm}
                  />

                  {tentou && erros.length > 0 ? (
                    <div style={{ display: "grid", gap: 3 }}>
                      {erros.map((e) => (
                        <Erro
                          key={`${e.campo}-${e.mensagem}`}
                          texto={e.mensagem}
                        />
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
                      style={{
                        color: enviando ? T.sub : T.muted,
                        fontSize: 11.5,
                      }}
                    >
                      {enviando
                        ? "Gerando a proposta e enviando o PDF por WhatsApp. Não feche esta janela até terminar."
                        : "Ao gerar, a proposta fica cadastrada e o PDF vai por WhatsApp para coordenador, imobiliária e corretor."}
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {/* ⚠️ DISCRETO AO LADO DO SÓLIDO. Dois botões do mesmo peso lado a lado fazem
                          o coordenador clicar no que está mais perto do dedo — e aqui um deles
                          cadastra a venda e dispara três WhatsApps. O que anda é o cheio; o que só
                          mostra o papel é de contorno. */}
                      <button
                        disabled={enviando || buscandoPrevia}
                        onClick={verPrevia}
                        style={{
                          background: "transparent",
                          border: `1px solid ${T.border}`,
                          borderRadius: 9,
                          color: enviando || buscandoPrevia ? T.muted : T.sub,
                          cursor:
                            enviando || buscandoPrevia ? "default" : "pointer",
                          font: "inherit",
                          fontSize: 12.5,
                          fontWeight: 600,
                          padding: "9px 14px",
                          whiteSpace: "nowrap",
                        }}
                        type="button"
                      >
                        {buscandoPrevia ? "Montando…" : "Ver prévia"}
                      </button>
                      <button
                        // ⚠️ TAMBÉM APAGADO ENQUANTO A PRÉVIA MONTA: os dois botões são vizinhos, e
                        // gerar a proposta enquanto se espera para CONFERI-LA é exatamente o clique
                        // que a prévia existe para evitar.
                        disabled={enviando || buscandoPrevia}
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
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  overflow: "auto",
                  padding: 16,
                }}
              >
                <section style={bloco}>
                  <div style={rotulo}>O cliente da reserva</div>
                  <div
                    style={{ alignItems: "baseline", display: "flex", gap: 8 }}
                  >
                    <b style={{ fontSize: 13.5 }}>
                      {portao.reserva.titular.nome}
                    </b>
                    <span style={{ color: T.muted, fontSize: 11.5 }}>
                      {formatarDocumento(
                        soDigitos(portao.reserva.titular.cpf),
                      ) || portao.reserva.titular.cpf}
                    </span>
                  </div>
                  <div style={{ color: T.muted, fontSize: 11.5, marginTop: 2 }}>
                    {portao.reserva.imobiliaria?.nome ?? "Sem imobiliária"}
                    {portao.reserva.corretor
                      ? ` · ${portao.reserva.corretor.nome}`
                      : ""}
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
                    <b
                      style={{
                        color: credenciado ? T.ok : T.danger,
                        fontSize: 12,
                      }}
                    >
                      {credenciado
                        ? "CAD credenciada neste empreendimento"
                        : "CAD não credenciada"}
                    </b>
                    <div style={{ color: T.sub, fontSize: 11.5, marginTop: 2 }}>
                      {credenciado
                        ? "A reserva pode virar proposta."
                        : (portao.credenciamento.motivo ??
                          "A CAD deste cliente ainda não está credenciada neste empreendimento.")}
                    </div>
                  </div>

                  <p
                    style={{ color: T.muted, fontSize: 11, margin: "8px 0 0" }}
                  >
                    O cliente é o da reserva e não se troca. Para trocar,
                    cancele a reserva e reserve de novo.
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

                        <span
                          style={{
                            alignItems: "center",
                            display: "flex",
                            gap: 8,
                          }}
                        >
                          {/* ⚠️ COM UM COMPRADOR SÓ O CAMPO NEM APARECE: ele tem 100%, e digitar isso
                              seria trabalho para confirmar o óbvio. */}
                          {compradores.length > 1 ? (
                            <CampoDeParticipacao
                              aoMudar={(v) =>
                                setCompradores((atuais) =>
                                  atuais.map((outro, j) =>
                                    j === i
                                      ? { ...outro, participacao: v }
                                      : outro,
                                  ),
                                )
                              }
                              valor={c.participacao}
                            />
                          ) : (
                            <span style={{ color: T.muted, fontSize: 12 }}>
                              100%
                            </span>
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
                      <span
                        style={{
                          color: falta === 0 ? T.ok : T.muted,
                          fontSize: 11.5,
                        }}
                      >
                        Soma{" "}
                        {soma.toLocaleString("pt-BR", {
                          maximumFractionDigits: 2,
                        })}
                        %
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
                            return atuais.map((c, i) => ({
                              ...c,
                              participacao: iguais[i] ?? 0,
                            }));
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
                  <div
                    style={{
                      borderTop: `1px dashed ${T.border}`,
                      marginTop: 12,
                      paddingTop: 12,
                    }}
                  >
                    <div style={{ ...rotulo, marginBottom: 6 }}>
                      Adicionar proponente
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      {/* ⚠️ O NOME É BUSCA, NÃO DIGITAÇÃO (Lucas, 05/09/2026: *"os demais proponentes
                          têm que ser buscados; eu digitei o nome da Larissa, deveria puxar a CAD dela
                          caso a mesma tenha uma CAD credenciada (nome, CPF); se não estiver
                          credenciada, fala que CAD não encontrada"*). Digitar criava um comprador que
                          o Apolo nunca viu — sem CAD, sem crédito analisado — e ele entrava no PDF,
                          na minuta e no contrato como se fosse cadastrado. */}
                      <div
                        onBlur={(e) => {
                          // ⚠️ A LISTA COBRE A % E O "ADICIONAR" enquanto está aberta, e antes só
                          // fechava ao escolher alguém: quem desistia da busca ficava sem alcançar
                          // os dois campos que vêm logo abaixo. Fecha ao sair do bloco (campo +
                          // lista), e não a cada blur do input — senão o clique no candidato
                          // fecharia a lista antes de virar clique.
                          if (!e.currentTarget.contains(e.relatedTarget as null | Node)) {
                            setListaFechada(true);
                          }
                        }}
                        onKeyDown={(e) => {
                          // ⚠️ O ESCAPE AQUI NÃO CHEGA NA MODAL. Sem isto, fechar a lista com Esc
                          // fechava a modal inteira — com as condições montadas dentro.
                          if (e.key === "Escape" && !listaFechada) {
                            e.stopPropagation();
                            setListaFechada(true);
                          }
                        }}
                        style={{ position: "relative" }}
                      >
                        <input
                          onChange={(e) => {
                            const texto = e.target.value;
                            setNovo((a) => ({ ...a, cpf: "", nome: texto }));
                            setEscolhido(null);
                            setErroDoNovo(null);
                            setListaFechada(false);
                          }}
                          onFocus={() => setListaFechada(false)}
                          placeholder="Buscar por nome ou CPF na base"
                          style={campo}
                          value={novo.nome}
                        />

                        {/* A lista de candidatos, ancorada no campo. */}
                        {novo.nome.trim().length > 0 && !escolhido && !listaFechada ? (
                          <div
                            style={{
                              background: T.page,
                              border: `1px solid ${T.border}`,
                              borderRadius: 10,
                              boxShadow: T.sombra,
                              display: "grid",
                              left: 0,
                              maxHeight: 220,
                              overflow: "auto",
                              position: "absolute",
                              right: 0,
                              top: "calc(100% + 4px)",
                              zIndex: 5,
                            }}
                          >
                            {buscando ? (
                              <span
                                style={{
                                  color: T.muted,
                                  fontSize: 11.5,
                                  padding: "9px 12px",
                                }}
                              >
                                Procurando…
                              </span>
                            ) : falhouABusca ? (
                              // ⚠️ FALHA NÃO É AUSÊNCIA. Dizer "abra a CAD" quando o servidor caiu
                              // manda abrir uma CAD duplicada para quem já tem a dele credenciada.
                              <span
                                style={{
                                  color: T.danger,
                                  fontSize: 11.5,
                                  padding: "9px 12px",
                                }}
                              >
                                Não foi possível consultar a base agora. Tente
                                de novo em instantes.
                              </span>
                            ) : candidatos.length === 0 ? (
                              // ⚠️ A FRASE DIZ O QUE FAZER. "Nada encontrado" deixa o coordenador
                              // sem saber se digitou errado ou se falta a CAD — e a resposta muda o
                              // que ele faz em seguida.
                              <span
                                style={{
                                  color: T.muted,
                                  fontSize: 11.5,
                                  padding: "9px 12px",
                                }}
                              >
                                CAD não encontrada neste empreendimento. Abra a
                                CAD do proponente antes de incluí-lo na
                                proposta.
                              </span>
                            ) : (
                              candidatos.map((c) => (
                                <button
                                  // ⚠️ SEM CPF NÃO DÁ PARA ESCOLHER. O campo ao lado é só leitura:
                                  // escolher alguém cujo documento não veio deixaria o proponente
                                  // sem CPF e sem como digitá-lo — um beco. A rota monta o CPF a
                                  // partir do documento da entidade, que pode vir vazio.
                                  disabled={!c.credenciado || !cpfValido(c.cpf)}
                                  key={c.id}
                                  onClick={() => {
                                    setEscolhido(c);
                                    setNovo((a) => ({
                                      ...a,
                                      cpf: c.cpf,
                                      nome: c.nome,
                                    }));
                                    setErroDoNovo(null);
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    borderBottom: `1px solid ${T.border}`,
                                    cursor:
                                      c.credenciado && cpfValido(c.cpf)
                                        ? "pointer"
                                        : "default",
                                    display: "grid",
                                    font: "inherit",
                                    gap: 2,
                                    opacity: c.credenciado ? 1 : 0.6,
                                    padding: "8px 12px",
                                    textAlign: "left",
                                  }}
                                  type="button"
                                >
                                  <b style={{ fontSize: 12.5 }}>{c.nome}</b>
                                  <span
                                    style={{ color: T.muted, fontSize: 11 }}
                                  >
                                    {c.cpf}
                                    {/* ⚠️ QUEM NÃO PASSA APARECE COM O MOTIVO, e não some da lista:
                                        sumir faria o coordenador concluir que a pessoa não tem
                                        cadastro, quando ela tem e está em análise de crédito. */}
                                    {c.credenciado
                                      ? cpfValido(c.cpf)
                                        ? null
                                        : " · sem CPF no cadastro"
                                      : ` · ${c.motivo ?? "CAD não credenciada"}`}
                                  </span>
                                </button>
                              ))
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gap: 6,
                          gridTemplateColumns: "1fr 110px 96px",
                        }}
                      >
                        {/* ⚠️ O CPF NÃO SE DIGITA MAIS: ele vem da CAD escolhida. Um campo livre aqui
                            seria a porta que a busca acabou de fechar. */}
                        <input
                          disabled
                          placeholder="CPF (vem da CAD)"
                          style={{ ...campo, background: T.soft, color: T.sub }}
                          value={novo.cpf}
                        />
                        <input
                          inputMode="decimal"
                          onChange={(e) =>
                            setNovo((a) => ({
                              ...a,
                              participacao: e.target.value,
                            }))
                          }
                          placeholder="% no contrato"
                          style={campo}
                          value={novo.participacao}
                        />
                        <button
                          onClick={adicionarProponente}
                          style={botaoDiscreto}
                          type="button"
                        >
                          Adicionar
                        </button>
                      </div>
                    </div>
                    {erroDoNovo ? <Erro texto={erroDoNovo} /> : null}
                    <p
                      style={{
                        color: T.muted,
                        fontSize: 11,
                        margin: "6px 0 0",
                      }}
                    >
                      A % de cada comprador vai escrita no contrato. O titular
                      fica com o que sobra, e a soma tem que fechar 100%.
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
 * O que impede a proposta de sair — e só isso.
 *
 * ⚠️ O RESUMO DE TEXTO SAIU DAQUI (Lucas, 05/09/2026: *"ainda ficou esse texto"*, e antes: *"não
 * precisa, podia ter um botão para ter uma prévia da proposta"*). Ele contava em duas linhas
 * corridas o que a `PreviaDaProposta` agora mostra em tabela, com todas as datas e todas as faixas
 * de reajuste — dizer a mesma coisa duas vezes, uma delas pior, é o que fazia o rodapé parecer
 * sobra. O que este componente ainda faz é o que a prévia NÃO pode fazer: explicar por que não há
 * prévia nenhuma (sem composição, sem plano cadastrado, condições que não fecham um cronograma).
 *
 * ⚠️ E ELE NÃO SOME QUANDO ESTÁ TUDO CERTO: devolve `null`, e o rodapé fica só com o prazo e o
 * botão. Um espaço vazio reservado "para o caso de dar erro" empurraria o botão para baixo em toda
 * proposta que dá certo.
 */
function FluxoQueVaiSair({
  cronograma,
  erro,
  semComposicao,
  semPlano,
}: {
  cronograma: null | ReturnType<typeof montarCronograma>;
  erro: null | string;
  semComposicao: boolean;
  semPlano: boolean;
}) {
  if (semComposicao) {
    return (
      <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>
        Monte as condições acima: nenhuma composição fecha com o que está na
        tela.
      </p>
    );
  }
  if (semPlano) {
    return (
      <p style={{ color: T.danger, fontSize: 12, margin: 0 }}>
        Este produto não tem plano comercial cadastrado, e a proposta sai do
        plano. Cadastre em Política Comercial antes de gerar.
      </p>
    );
  }
  if (erro || !cronograma) {
    return <p style={{ color: T.danger, fontSize: 12, margin: 0 }}>{erro}</p>;
  }

  // Deu tudo certo: quem conta o que vai sair é a `PreviaDaProposta`, na coluna de cima.
  return null;
}

/**
 * A PRÉVIA DO QUE VAI PARA O PAPEL — o fluxo de pagamento inteiro, antes de gerar.
 *
 * Lucas (05/09/2026): *"podia ter um botão para ter uma prévia da proposta"* e, olhando a coluna
 * direita vazia depois que as alternativas saíram: *"como podemos aproveitar melhor essa tela? tem
 * um espaço grande, UI está ruim"*.
 *
 * ⚠️ AS DUAS COISAS SÃO A MESMA COISA. O espaço que sobrou é exatamente onde a prévia deve morar:
 * quem está montando a proposta quer ver o que o cliente vai receber, e isso é o CALENDÁRIO — as
 * datas da entrada, quando a mensal começa, quanto ela vira em cada aniversário. O rodapé resumia
 * tudo isso em duas linhas de texto corrido ("Entrada R$ 14.000,00 em 1x, a primeira de..."), que
 * é o que cabe num rodapé e não é o que a pergunta pede.
 *
 * ⚠️ É O MESMO `montarCronograma` DO PDF E DA ROTA. Não há uma segunda conta aqui: o que esta
 * prévia desenha é o objeto que vai virar papel. Uma prévia com conta própria seria a terceira
 * versão do calendário da casa — e a que ninguém confere.
 */
function PreviaDaProposta({
  cronograma,
  diaDeVencimento,
}: {
  cronograma: ReturnType<typeof montarCronograma>;
  diaDeVencimento: number;
}) {
  // ⚠️ MESMO DEGRAU DE CINZA DO SIMULADOR. As três tabelas da prévia (entrada, reajuste, reforços)
  // são visualmente idênticas, e o título é a única coisa que as separa: no cinza mais claro da
  // paleta ele pesava menos que os números que ele nomeia.
  const tituloDaSecao = {
    color: T.sub,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  } as const;

  const celula = { fontSize: 11.5, padding: "5px 0" } as const;
  const cabecalho = {
    ...tituloDaSecao,
    fontSize: 9.5,
    paddingBottom: 4,
  } as const;

  /**
   * ⚠️ O FLUXO LONGO É CORTADO, E O CORTE É DECLARADO. Um contrato de 120 mensais não cabe em
   * tela nenhuma, e listar as quatro primeiras sem dizer que há mais faria a prévia mentir por
   * omissão. As mensais têm a tabela de reajuste, que conta a série inteira em quatro linhas.
   */
  const MAX = 6;
  const entrada = cronograma.entrada.slice(0, MAX);
  const anuais = cronograma.anuais.slice(0, MAX);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <div style={{ ...tituloDaSecao, marginBottom: 6 }}>
          Prévia da proposta
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gap: 16,
          // Duas colunas quando há espaço: entrada de um lado, reajuste do outro. A largura da
          // coluna direita da modal comporta, e empilhado sobra o mesmo vazio de antes.
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        }}
      >
        {/* ── PAGAMENTO DA ENTRADA ── */}
        <section
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <div style={{ ...tituloDaSecao, marginBottom: 6 }}>
            Pagamento da entrada
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cabecalho, textAlign: "left" }}>Parcela</th>
                <th style={{ ...cabecalho, textAlign: "left" }}>Vencimento</th>
                <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {entrada.map((p) => (
                <tr
                  key={p.numero}
                  style={{ borderTop: `1px solid ${T.border}` }}
                >
                  <td style={{ ...celula, color: T.sub }}>
                    {p.numero} de {p.total}
                  </td>
                  <td style={celula}>{dataEscrita(p.vencimento)}</td>
                  <td
                    style={{ ...celula, fontWeight: 650, textAlign: "right" }}
                  >
                    {dinheiro(p.valor)}
                  </td>
                </tr>
              ))}
              {cronograma.entrada.length > MAX ? (
                <tr>
                  <td
                    colSpan={3}
                    style={{ ...celula, color: T.muted, fontSize: 10.5 }}
                  >
                    e mais {cronograma.entrada.length - MAX}, no mesmo dia dos
                    meses seguintes
                  </td>
                </tr>
              ) : null}
              <tr style={{ borderTop: `1px solid ${T.border}` }}>
                <td colSpan={2} style={{ ...celula, fontWeight: 700 }}>
                  Total da entrada
                </td>
                <td style={{ ...celula, fontWeight: 700, textAlign: "right" }}>
                  {dinheiro(cronograma.totais.entrada)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* ── AS MENSAIS, PELA TABELA DE REAJUSTE ──
            ⚠️ NÃO SE LISTA 120 PARCELAS: a série inteira cabe em quatro linhas quando se conta por
            FAIXA — de tal parcela a tal parcela, neste período, vale este valor. É a mesma tabela
            que o PDF imprime, e é o que responde "quanto meu cliente vai pagar daqui a três anos". */}
        <section
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "10px 12px",
          }}
        >
          <div style={{ ...tituloDaSecao, marginBottom: 6 }}>
            {cronograma.reajustes.length > 1
              ? "Reajuste da parcela"
              : "Parcelas mensais"}
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cabecalho, textAlign: "left" }}>Período</th>
                <th style={{ ...cabecalho, textAlign: "left" }}>Parcelas</th>
                <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {cronograma.reajustes.map((f) => (
                <tr
                  key={f.ciclo}
                  style={{ borderTop: `1px solid ${T.border}` }}
                >
                  <td style={{ ...celula, color: T.sub }}>
                    {cronograma.reajustes.length === 1
                      ? "Todo o contrato"
                      : `${f.ciclo}º ano`}
                  </td>
                  <td style={celula}>
                    {f.parcelaInicial} a {f.parcelaFinal}
                  </td>
                  <td
                    style={{ ...celula, fontWeight: 650, textAlign: "right" }}
                  >
                    {dinheiro(f.valor)}
                    {f.temIpca ? (
                      <span style={{ color: T.muted }}> + IPCA</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ color: T.muted, fontSize: 10.5, marginTop: 6 }}>
            Todo dia {diaDeVencimento}, a primeira em{" "}
            {dataEscrita(cronograma.mensais[0]?.vencimento ?? "")}.
          </div>
        </section>

        {/* ── AS ANUAIS, SÓ QUANDO EXISTEM ──
            Lucas: *"se tem anuais, tem que ter também o fluxo delas"*. Sem reforço, uma seção
            dizendo "não há" gastaria espaço para não dizer nada. */}
        {anuais.length > 0 ? (
          <section
            style={{
              background: T.card,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div style={{ ...tituloDaSecao, marginBottom: 6 }}>
              Parcelas anuais
            </div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...cabecalho, textAlign: "left" }}>Parcela</th>
                  <th style={{ ...cabecalho, textAlign: "left" }}>
                    Vencimento
                  </th>
                  <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
                </tr>
              </thead>
              <tbody>
                {anuais.map((p) => (
                  <tr
                    key={p.numero}
                    style={{ borderTop: `1px solid ${T.border}` }}
                  >
                    <td style={{ ...celula, color: T.sub }}>
                      {p.numero} de {p.total}
                    </td>
                    <td style={celula}>{dataEscrita(p.vencimento)}</td>
                    <td
                      style={{ ...celula, fontWeight: 650, textAlign: "right" }}
                    >
                      {dinheiro(p.valor)}
                    </td>
                  </tr>
                ))}
                {cronograma.anuais.length > MAX ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{ ...celula, color: T.muted, fontSize: 10.5 }}
                    >
                      e mais {cronograma.anuais.length - MAX}, um por ano
                    </td>
                  </tr>
                ) : null}
                <tr style={{ borderTop: `1px solid ${T.border}` }}>
                  <td colSpan={2} style={{ ...celula, fontWeight: 700 }}>
                    Total dos reforços
                  </td>
                  <td
                    style={{ ...celula, fontWeight: 700, textAlign: "right" }}
                  >
                    {dinheiro(cronograma.totais.anuais)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Até quando a proposta vale — os quatro atalhos e a data que eles produzem.
 *
 * Lucas (05/09/2026): *"vamos fazer igual a reserva, colocar os dias de prazo, 3 - 5 - 7 - 10"*.
 *
 * ⚠️ A LISTA E O PADRÃO VÊM DA LIB, IMPORTADOS. Um `[3, 5, 7, 10]` escrito aqui seria a segunda
 * regra de prazo do módulo: no dia em que ele pedir 15 dias, `PRAZOS_DA_PROPOSTA` mudaria e a tela
 * continuaria oferecendo os quatro antigos, sem ninguém errar nada de propósito. Quem decide o
 * teto (`PRAZO_MAXIMO_DA_PROPOSTA`) é `conferirProposta`, dos dois lados.
 *
 * ⚠️ E A DATA É ESCRITA POR `dataEscrita`, a mesma do fluxo acima e do WhatsApp. Ela lê o ISO no
 * fuso da operação; um `toLocaleDateString` sem `timeZone` mostraria o dia seguinte para quem
 * abrir a tela num navegador em UTC, e o "vale até" da tela discordaria do PDF.
 */
function PrazoDaProposta({
  aoMudar,
  dias,
  validadeEm,
}: {
  aoMudar: (dias: number) => void;
  dias: number;
  validadeEm: string;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      <span style={{ ...rotulo, marginBottom: 0 }}>Vale por</span>
      {PRAZOS_DA_PROPOSTA.map((d) => (
        <button
          // ⚠️ QUAL ESTÁ ESCOLHIDO NÃO PODE SER SÓ A COR DA BORDA. Um grupo de chips onde a
          // escolha só existe em pixel não diz nada a leitor de tela nem a teste: é `aria-pressed`
          // que conta que este é o prazo em vigor, e é por ele que o teste confere o padrão.
          aria-pressed={dias === d}
          key={d}
          onClick={() => aoMudar(d)}
          style={{
            background: dias === d ? T.soft : "transparent",
            border: `1px solid ${dias === d ? T.gold : T.border}`,
            borderRadius: 999,
            color: dias === d ? T.text : T.sub,
            cursor: "pointer",
            font: "inherit",
            fontSize: 12,
            fontWeight: 600,
            padding: "5px 12px",
          }}
          type="button"
        >
          {/* "dias" seco, sem o singular do chip da reserva: o prazo mais curto daqui é 3, e um
              ternário para um caso que `PRAZOS_DA_PROPOSTA` não tem é código que ninguém executa
              — o TypeScript, com a lista literal na mão, chega a acusar a comparação impossível. */}
          {d} dias
        </button>
      ))}
      <span style={{ color: T.muted, fontSize: 11.5 }}>
        Vence em <b style={{ color: T.sub }}>{dataEscrita(validadeEm)}</b>, no
        fim do dia.
      </span>
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
      lerPercentualDigitado(atual) === Math.round(valor * 100) / 100
        ? atual
        : escreve(valor),
    );
  }, [valor]);

  return (
    <span
      style={{ alignItems: "center", display: "flex", position: "relative" }}
    >
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
  color: T.sub,
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
  return (
    <p style={{ color: T.danger, fontSize: 11.5, margin: "5px 0 0" }}>
      {texto}
    </p>
  );
}
