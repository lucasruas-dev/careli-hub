"use client";

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock3,
  Keyboard,
  ListChecks,
  Loader2,
  RefreshCw,
  ScanLine,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  bipDaSecretariaRemoto,
  bipDoSalaoRemoto,
  chamarDoSalaoRemoto,
  fazerCheckInRemoto,
  fetchEventos,
  fetchFila,
  linkDaFilaRemoto,
  marcarNoShowRemoto,
} from "../../data/prometeu-operations";
import { CapturaDaPa, SeloDaPa } from "./captura-da-pa";
import { usarLeitorQr } from "./usar-leitor-qr";
import {
  telefoneParaWhatsapp,
  urlDoConviteNoWhatsapp,
} from "@/lib/prometeu/convite-da-fila";
import {
  codigoDaCredencial,
  credencialCasaComCodigo,
  ehIdDeCredencial,
  normalizarCodigoDigitado,
} from "@/lib/prometeu/credencial";
import { nomeDoLancamento } from "@/lib/prometeu/lancamento";
import type { PrometeuCredenciado, PrometeuEvento } from "@/lib/prometeu/types";
import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";

// CHECK-IN do organizador, no celular.
//
// Quem usa: o organizador que fica EM PÉ na entrada, com a fila andando na frente dele. Isso
// dita a tela inteira: câmera ocupando quase tudo, retorno enorme e imediato, nada de menu.
// Os atendentes usam notebook e não passam por aqui.
//
// O que a tela precisa deixar claro em menos de um segundo, sem ninguém ler texto:
//   - deu certo (verde) / é a pessoa errada ou já entrou (âmbar/vermelho);
//   - quem é a pessoa;
//   - se ela pagou o PIX de R$ 1.000.

type Resultado =
  | { credenciado: PrometeuCredenciado; naJanela: boolean; tipo: "ok" }
  | { credenciado: PrometeuCredenciado; tipo: "ja-entrou" }
  | { candidatos: PrometeuCredenciado[]; tipo: "ambiguo" }
  // O SALÃO RECUSOU porque a pessoa não foi chamada. É diferente de "erro": não deu problema
  // técnico nenhum, o sistema funcionou e está barrando de propósito. A tela mostra em âmbar,
  // com o nome, pra o organizador dizer "aguarde a chamada" em vez de tentar de novo.
  | { credenciado: PrometeuCredenciado; texto: string; tipo: "recusado" }
  | { texto: string; tipo: "erro" };

// OS TRÊS POSTOS DO TRILHO FÍSICO. A tela é a MESMA (câmera grande, retorno imediato, nada de
// menu) porque o organizador está EM PÉ nos três casos; muda o que o bip significa:
//   • recepcao   — entrada no evento, monta a fila;
//   • salao      — confirma a chamada. Recusa quem não foi chamado (anti-fura-fila);
//   • secretaria — registra a chegada de quem foi por conta própria e fecha a etapa anterior.
export type PostoDoOrganizador = "recepcao" | "salao" | "secretaria";

const TEXTOS_DO_POSTO: Record<
  PostoDoOrganizador,
  { acao: string; titulo: string; vazio: string }
> = {
  recepcao: {
    acao: "Check-in",
    titulo: "Check-in",
    vazio: "Aponte para o QR da etiqueta para dar entrada.",
  },
  salao: {
    acao: "Entrada no salão",
    titulo: "Salão",
    vazio: "Aponte para o QR de quem foi chamado.",
  },
  secretaria: {
    acao: "Chegada na secretaria",
    titulo: "Secretaria",
    vazio: "Aponte para o QR de quem chegou na secretaria.",
  },
};

// Trava anti-leitura-dupla: a câmera lê o mesmo crachá muitas vezes por segundo enquanto ele
// está na frente dela. Sem isso, o organizador dispara dezenas de check-in da mesma pessoa.
const JANELA_ANTI_REPETICAO_MS = 2500;

// Hora do check-in (HH:MM, fuso de Brasília) — o que a aba fila mostra por pessoa.
function horaCheckin(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function vibrar(padrao: number | number[]) {
  try {
    navigator.vibrate?.(padrao);
  } catch {
    /* navegador sem vibração: o retorno visual já cobre */
  }
}

export function CheckinView({
  posto = "recepcao",
}: {
  posto?: PostoDoOrganizador;
} = {}) {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  // Estado próprio, separado de `credenciados`: aquele é o cadastro inteiro (395 pessoas), este
  // é a FILA de quem já chegou, na ordem em que vai ser chamada.
  const [filaRecepcao, setFilaRecepcao] = useState<PrometeuCredenciado[]>([]);
  const [filaSalao, setFilaSalao] = useState<PrometeuCredenciado[]>([]);
  const [filaSecretaria, setFilaSecretaria] = useState<PrometeuCredenciado[]>([]);
  // Chamados que nao apareceram: ficam no FIM da fila, marcados, pra poder chamar de novo.
  const [noShow, setNoShow] = useState<PrometeuCredenciado[]>([]);
  // Quem foi chamado e ainda nao apareceu. Do BANCO: varios organizadores chamam ao mesmo tempo.
  const [emTransito, setEmTransito] = useState<
    { chamadoEm: string; credenciadoId: string }[]
  >([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Polls seguidos que falharam — 3+ acende o aviso de desconexão no lugar do silêncio.
  const falhasDePoll = useRef(0);
  const [camera, setCamera] = useState(true);
  const [digitando, setDigitando] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [registrando, setRegistrando] = useState(false);
  // Duas abas: ler o QR (check-in) e conferir a fila (quem já entrou / quem falta). O
  // organizador quer ver, na hora, se o check-in deu certo.
  // NO SALÃO A TELA ABRE NA FILA (pedido do Lucas 27/07). O organizador do salão não fica
  // bipando: ele OLHA a fila, chama o próximo e só então usa o QR para confirmar que quem
  // apareceu foi a pessoa certa. Na recepção é o contrário — lá a câmera é o trabalho.
  const [aba, setAba] = useState<"checkin" | "fila" | "noshow">(
    posto === "salao" ? "fila" : "checkin",
  );
  // Quem acabou de ser bipado na secretaria e ainda nao teve a PA fotografada.
  const [paPendente, setPaPendente] = useState<PrometeuCredenciado | null>(null);
  const [buscaFila, setBuscaFila] = useState("");
  const ultimaLeitura = useRef<{ em: number; valor: string }>({ em: 0, valor: "" });

  useEffect(() => {
    void (async () => {
      const { data } = await fetchEventos();
      const lista = data ?? [];
      setEventos(lista);
      const ativo = eventoDoDia(lista);
      if (ativo) setEventoId(ativo.id);
      else setCarregando(false);
    })();
  }, []);

  // `silencioso` = recarga de fundo (o relógio de 10s). Não acende "Carregando..." nem apaga o
  // erro na cara do operador: a tela tem que continuar utilizável enquanto os dados chegam.
  const carregar = useCallback(async (silencioso = false) => {
    if (!eventoId) return;
    if (!silencioso) {
      setCarregando(true);
      setErro(null);
    }
    const { data, error } = await fetchFila(eventoId);
    // SEM PAYLOAD, MANTÉM O QUE ESTÁ NA TELA (mesma regra do atendente e da Central): um blip de
    // rede no poll silencioso zerava fila, trânsito e credenciados — a fila "sumia" por 10s e o
    // próximo bip caía em "Ainda carregando os credenciados".
    if (!data) {
      if (!silencioso) setErro(error ?? "Não consegui ler a fila. Tente de novo.");
      // 3 polls seguidos falhando = tela congelada em silêncio (sessão vencida, rede fora).
      // A faixa avisa em vez de deixar o organizador bipando contra uma lista velha.
      falhasDePoll.current += 1;
      if (falhasDePoll.current >= 3) {
        setErro("SEM CONEXÃO COM O SERVIDOR — recarregue a página; se não voltar, entre de novo.");
      }
      setCarregando(false);
      return;
    }
    falhasDePoll.current = 0;
    // A conexão voltou: o aviso de desconexão sai sozinho (o resto dos erros fica até o
    // próximo carregar explícito).
    setErro((atual) => (atual?.startsWith("SEM CONEXÃO") ? null : atual));
    if (error && !silencioso) setErro(error);
    setCredenciados(data?.credenciados ?? []);
    // A FILA DA RECEPÇÃO vem PRONTA do servidor, já na ordem que vale no dia (com o check-in
    // ligado, quem pagou o PIX antes vem na frente; desligado, ordem de chegada). Não dá pra
    // reordenar isso no cliente sem repetir a regra — e regra repetida é regra que diverge.
    setFilaRecepcao(data?.filaRecepcao ?? []);
    setFilaSalao(data?.filaSalao ?? []);
    setFilaSecretaria(data?.filaSecretaria ?? []);
    setEmTransito(data?.emTransito ?? []);
    // No-show é POR POSTO: cada posto vê só o "não veio" que ELE marcou (metadata.noShow.zona). A
    // etapa NÃO muda no no-show, então ela não serve pra dizer o posto — o salão chama de quem está
    // em "recepcao", e filtrar por etapa fazia o no-show do salão vazar pra tela da recepção
    // (bug que o Lucas viu, 29/07). Fallback pela etapa só para no-shows ANTIGOS, gravados antes de
    // passarmos a guardar a zona (some no reset de ensaio, que limpa metadata.noShow).
    const etapaDoPosto = posto === "salao" ? "negociacao" : posto;
    setNoShow(
      (data?.noShow ?? []).filter((c) =>
        c.noShowZona ? c.noShowZona === posto : c.etapa === etapaDoPosto,
      ),
    );
    setCarregando(false);
  }, [eventoId, posto]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // ATUALIZA SOZINHO (pedido do Lucas, 27/07). No dia são vários celulares na mesma fila: uma
  // pessoa chama, outra bipa, a recepção segue dando entrada. Sem isso cada aparelho mostrava o
  // retrato do último toque, e o organizador chamava alguém que o colega já tinha chamado.
  //
  // 10 segundos, e SÓ com a aba na frente: o evento dura algumas horas com poucos aparelhos, e
  // pausar em segundo plano evita a conta de polling que já nos mordeu no Hermes.
  useEffect(() => {
    if (!eventoId) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void carregar(true);
    }, 10_000);

    return () => window.clearInterval(timer);
  }, [carregar, eventoId]);

  const evento = useMemo(
    () => eventos.find((e) => e.id === eventoId) ?? null,
    [eventos, eventoId],
  );

  const registrar = useCallback(
    async (credenciado: PrometeuCredenciado) => {
      // "Já entrou" só vale na RECEPÇÃO: lá o check-in acontece uma vez por pessoa. No salão e
      // na secretaria, passar o mesmo QR de novo é o organizador conferindo, não erro.
      if (posto === "recepcao" && credenciado.entrouEm) {
        vibrar([60, 40, 60]);
        setResultado({ credenciado, tipo: "ja-entrou" });
        return;
      }

      setRegistrando(true);
      const { data, error, status } =
        posto === "salao"
          ? await bipDoSalaoRemoto({ credenciadoId: credenciado.id, eventoId })
          : posto === "secretaria"
            ? await bipDaSecretariaRemoto({
                credenciadoId: credenciado.id,
                eventoId,
              })
            : await fazerCheckInRemoto({
                credenciadoId: credenciado.id,
                eventoId,
              });
      setRegistrando(false);

      if (error) {
        vibrar([60, 40, 60]);
        // 409 = o SALÃO barrou porque não houve chamada. Vibração longa e tela âmbar com o
        // nome, pra o organizador mandar aguardar em vez de insistir no QR.
        setResultado(
          status === 409
            ? { credenciado, texto: error, tipo: "recusado" }
            : { texto: error, tipo: "erro" },
        );
        return;
      }

      vibrar(90);

      // O BIP FECHOU UMA CHAMADA: o salão volta para a fila e RECARREGA, porque quem acabou de
      // ser confirmado tem que sair da lista de "aguardando chegar" na hora — inclusive nos
      // celulares dos outros organizadores, na próxima volta do relógio de 10s.
      if (posto === "salao") {
        setAba("fila");
      }

      // SECRETARIA: logo depois do bip, pede a foto da PA. É o momento certo — a pessoa está
      // ali na frente com a folha na mão. Não trava: a tela tem "Seguir sem a PA".
      if (posto === "secretaria") {
        setPaPendente(credenciado);
      }

      void carregar(true);

      setResultado({
        credenciado,
        naJanela:
          (data as { naJanela?: boolean } | null)?.naJanela ?? false,
        tipo: "ok",
      });
      // Atualiza a lista local na hora: o próximo QR do mesmo crachá já cai em "já entrou"
      // mesmo antes do recarregamento.
      setCredenciados((atual) =>
        atual.map((c) =>
          c.id === credenciado.id
            ? { ...c, entrouEm: new Date().toISOString() }
            : c,
        ),
      );
    },
    // `posto` entra aqui: sem ele, trocar de posto sem recarregar a página deixaria o
    // callback preso no posto antigo e o bip iria para a ação errada. Typecheck não acusa.
    // `carregar` idem: sem ele o refresh pós-bip usaria uma versão velha da função.
    [carregar, eventoId, posto],
  );

  const identificar = useCallback(
    (valor: string) => {
      const agora = Date.now();
      if (
        ultimaLeitura.current.valor === valor &&
        agora - ultimaLeitura.current.em < JANELA_ANTI_REPETICAO_MS
      ) {
        return;
      }
      ultimaLeitura.current = { em: agora, valor };

      // A lista ainda não chegou: sem ela, TODO credenciamento cairia em "não é deste
      // lançamento" (a tela não tem contra o que conferir). Avisa para tentar de novo em vez de
      // acusar o credenciamento errado.
      if (carregando || credenciados.length === 0) {
        vibrar([60, 40, 60]);
        setResultado({
          texto: "Ainda carregando os credenciados. Tente ler de novo em um instante.",
          tipo: "erro",
        });
        return;
      }

      if (ehIdDeCredencial(valor)) {
        const achado = credenciados.find(
          (c) => c.id.toLowerCase() === valor.trim().toLowerCase(),
        );

        if (!achado) {
          vibrar([60, 40, 60]);
          setResultado({
            texto: "Este credenciamento não é deste lançamento.",
            tipo: "erro",
          });
          return;
        }

        void registrar(achado);
        return;
      }

      // Não é um id de credencial: pode ser o código curto digitado, ou um QR de outra coisa.
      const alvo = normalizarCodigoDigitado(valor);

      if (alvo.length < 6) {
        vibrar([60, 40, 60]);
        setResultado({ texto: "Código não reconhecido.", tipo: "erro" });
        return;
      }

      const candidatos = credenciados.filter((c) =>
        credencialCasaComCodigo(c.id, alvo),
      );

      if (candidatos.length === 0) {
        vibrar([60, 40, 60]);
        setResultado({ texto: `Nada encontrado para ${alvo}.`, tipo: "erro" });
        return;
      }

      // O código curto é ambíguo por natureza (ver credencial.ts). Nunca escolher sozinho:
      // check-in na pessoa errada é pior do que um toque a mais.
      if (candidatos.length > 1) {
        vibrar([60, 40, 60]);
        setResultado({ candidatos, tipo: "ambiguo" });
        return;
      }

      const unico = candidatos[0];
      if (unico) void registrar(unico);
    },
    [carregando, credenciados, registrar],
  );

  // O LINK DA FILA NA MÃO DO ORGANIZADOR (decisão D1 do Lucas). O cliente deveria ter recebido
  // este link no check-in; enquanto o envio não é automático, quem está na porta consegue mandar
  // a qualquer momento pela lista: abre o WhatsApp do próprio celular com o texto pronto, e o
  // organizador aperta enviar. Custo zero, sem template e sem depender de aprovação da Meta.
  const enviarLinkDaFila = useCallback(
    async (alvo: PrometeuCredenciado) => {
      // Aba aberta AINDA NO TOQUE: depois do await o navegador do celular bloqueia como pop-up.
      const janela = window.open("", "_blank");

      const { data, error } = await linkDaFilaRemoto({
        credenciadoId: alvo.id,
        eventoId,
      });

      if (error || !data?.link) {
        janela?.close();
        setErro(error ?? "Não consegui montar o link da fila.");
        return;
      }

      const url = urlDoConviteNoWhatsapp({
        lancamento: nomeDoLancamento(evento),
        link: data.link,
        nome: alvo.nome,
        telefone: alvo.telefone,
      });

      // Sem telefone na ficha o WhatsApp abre no seletor de contatos. O aviso evita o
      // organizador achar que a tela travou.
      if (!telefoneParaWhatsapp(alvo.telefone)) {
        setErro(`${alvo.nome} está sem telefone na ficha. Escolha o contato no WhatsApp.`);
      }

      if (janela) {
        janela.opener = null;
        janela.location.replace(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    },
    [evento, eventoId],
  );

  const { canvasRef, estado, videoRef } = usarLeitorQr({
    // A câmera só roda na aba de check-in: na aba fila não faz sentido ler QR (e economiza bateria).
    // E PARA enquanto o overlay da PA está aberto: o leitor seguia decodificando por baixo — o
    // crachá do PRÓXIMO da fila entrava no quadro, bipava invisível e TROCAVA o overlay em
    // silêncio, e a folha de PA da Maria era fotografada no cadastro do João.
    // ⚠️ `resultado` NÃO entra na condição (entrou em 01/08 e PAROU O BIP da secretaria na
    // hora): a operação real bipa o próximo crachá com a tela verde do anterior ainda aberta —
    // desligar a câmera nesse estado trava a fila da porta.
    ativo: camera && !digitando && aba === "checkin" && !paPendente,
    aoLer: identificar,
  });

  const naFila = credenciados.filter((c) => !c.entrouEm).length;
  const jaEntraram = credenciados.length - naFila;

  // CADA POSTO OLHA A FILA DO POSTO ANTERIOR (regra do Lucas, 27/07). O salão chama de quem
  // está esperando na recepção; a secretaria chama de quem está no salão. Mostrar a fila geral
  // do evento em todos era o erro do print: o salão via 391 pessoas, das quais a esmagadora
  // maioria nem tinha chegado.
  // A SECRETARIA ve a fila DELA (quem ela ja bipou na chegada), nao a do salao: o bip dela e
  // ela MONTANDO a propria fila de atendimento (correcao do Lucas, 27/07).
  const filaDoPosto = posto === "secretaria" ? filaSecretaria : filaRecepcao;

  // TODOS os chamados em aberto, não só o último. No dia uma pessoa chama cinco de uma vez e
  // elas chegam na ordem que quiserem — quem bipar primeiro é confirmado primeiro.
  const chamadosEmTransito = useMemo(() => {
    const porId = new Map(credenciados.map((c) => [c.id, c]));

    return emTransito
      .map((t) => {
        const credenciado = porId.get(t.credenciadoId);
        return credenciado ? { chamadoEm: t.chamadoEm, credenciado } : null;
      })
      .filter((item): item is { chamadoEm: string; credenciado: PrometeuCredenciado } =>
        item !== null,
      );
  }, [credenciados, emTransito]);

  const listaFila = useMemo(() => {
    const termo = buscaFila.trim().toLowerCase();
    // A FILA DA RECEPÇÃO: só quem já fez check-in, NA ORDEM DE CHAMADA (pedido do Lucas 27/07).
    //
    // Antes esta lista era ordenada pelo horário do bip, do mais recente para o mais antigo —
    // isso é o LOG de entradas, não a fila: mostrava o último a chegar no topo, o contrário de
    // quem vai ser chamado primeiro. Agora vem pronta do servidor, com a posição 1, 2, 3 do
    // jeito que o dia manda.
    //
    // A busca filtra sem reordenar: as posições continuam sendo as da fila cheia, senão
    // procurar alguém faria a pessoa "virar a primeira" na tela.
    const base = termo
      ? filaDoPosto.filter((c) =>
          `${c.nome} ${c.documento ?? ""} ${c.imobiliaria ?? ""}`
            .toLowerCase()
            .includes(termo),
        )
      : filaDoPosto;

    const daFila = base.map((c) => ({
      credenciado: c,
      posicao: filaDoPosto.findIndex((f) => f.id === c.id) + 1,
    }));

    return daFila;
  }, [buscaFila, filaDoPosto]);

  // OS QUE NÃO VIERAM têm ABA PRÓPRIA (Lucas, 27/07: "gostaria de separar as filas"). Junto da
  // fila eles confundiam duas coisas diferentes: quem está esperando a vez e quem já foi
  // chamado e sumiu. A posição 0 faz a lista mostrar um traço no lugar do número.
  const listaNoShow = useMemo(() => {
    const termo = buscaFila.trim().toLowerCase();
    const base = termo
      ? noShow.filter((c) =>
          `${c.nome} ${c.documento ?? ""} ${c.imobiliaria ?? ""}`
            .toLowerCase()
            .includes(termo),
        )
      : noShow;

    return base.map((c) => ({ credenciado: c, posicao: 0 }));
  }, [buscaFila, noShow]);

  // h-full (e não min-h-dvh): o MobileViewport já trava 100dvh com overflow-hidden, então
  // altura mínima própria empurraria a barra de ações para fora da tela do celular.
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b1017] text-white">
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          {/* O posto tem que estar VISÍVEL o tempo todo: o mesmo organizador pode trocar de
              posto no meio do dia, e bipar achando que está na recepção quando está no salão
              faria a leitura ir para a ação errada. */}
          <p className="m-0 text-sm font-bold">{TEXTOS_DO_POSTO[posto].titulo}</p>
          <p className="m-0 truncate text-[11px] text-white/60">
            {nomeDoLancamento(evento) || "Sem lançamento configurado"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-right">
          {/* O CONTADOR É DO POSTO, não do evento (Lucas, 27/07: "no print do salão fala que 4
              entraram e tem 391, está errado"). Na recepção ainda faz sentido falar do evento
              inteiro — é ela que controla quem falta chegar. Nos outros postos o número que
              importa é quantos estão esperando NAQUELA fila. */}
          {/* SÓ O NÚMERO E DE ONDE ELE VEM (Lucas, 27/07). "esperando na recepção" no topo do
              Salão soava como se o próprio salão estivesse esperando. O que o organizador
              precisa ler ali é a origem da fila que ele está chamando: o salão chama da
              Recepção, a secretaria chama do Salão de vendas. */}
          <div className="text-[11px] leading-tight text-white/60">
            {posto === "recepcao" ? (
              <>
                <b className="text-white">{jaEntraram}</b> entraram
                <br />
                <b className="text-white">{naFila}</b> a chegar
              </>
            ) : (
              // O TOPO MOSTRA O POSTO ANTERIOR — de onde vem gente para este. A LISTA abaixo é
              // a fila deste posto. Eram duas coisas diferentes e eu tinha misturado: a
              // secretaria mostrava o número da PRÓPRIA fila com o rótulo "Salão de vendas",
              // então dizia 1 quando havia 5 em negociação.
              <>
                <b className="text-white">
                  {posto === "salao" ? filaRecepcao.length : filaSalao.length}
                </b>{" "}
                {posto === "salao" ? "Recepção" : "Salão de vendas"}
              </>
            )}
          </div>
          <button
            aria-label="Atualizar"
            className="grid size-9 place-items-center rounded-lg border border-white/15"
            onClick={() => void carregar()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className="size-4" />
          </button>
        </div>
      </header>

      {/* O SALÃO NÃO TEM ABAS (Lucas, 27/07: "a tela dele só chama e bipa, ele não faz
          check-in"). Lá o trabalho é a fila, e a câmera abre sozinha quando ele toca em
          "Bipar para confirmar" no cartão do chamado. Duas abas ali só dariam a chance de o
          organizador ficar na tela errada no meio do evento. */}
      {/* No salão a barra só aparece quando há gente que não veio — é a única aba que ele
          precisa alcançar por ali; o "Ler QR" dele abre pelo botão do painel de chamados. */}
      {posto === "salao" && noShow.length === 0 ? null : (
        <div className="mx-4 mb-3 flex rounded-full bg-white/10 p-[3px]">
          {posto === "salao" ? null : (
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition ${
              aba === "checkin" ? "bg-[#cba25a] text-[#101820]" : "text-white/70"
            }`}
            onClick={() => setAba("checkin")}
            type="button"
          >
            {/* "Ler QR" e não o nome do posto: o posto já está no cabeçalho, e escrever
                "Check-in" aqui dentro dos outros postos dizia a coisa errada. */}
            <ScanLine aria-hidden="true" className="size-4" /> Ler QR
          </button>
          )}
          <button
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-[13px] font-semibold transition ${
              aba === "fila" ? "bg-[#cba25a] text-[#101820]" : "text-white/70"
            }`}
            onClick={() => setAba("fila")}
            type="button"
          >
            <ListChecks aria-hidden="true" className="size-4" /> Fila
          </button>
          {/* A aba de no-show só existe quando há alguém nela: numa tela de celular, aba vazia
              é espaço tirado das duas que o organizador usa o tempo todo. */}
          {noShow.length > 0 ? (
            <button
              className={`flex shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold transition ${
                aba === "noshow" ? "bg-red-500 text-white" : "text-red-300"
              }`}
              onClick={() => setAba("noshow")}
              type="button"
            >
              Não vieram {noShow.length}
            </button>
          ) : null}
        </div>
      )}

      {erro ? (
        <p className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="size-4 shrink-0" /> {erro}
        </p>
      ) : null}

      {/* QUEM ESTÁ SENDO CHAMADO fica FIXO no topo, acima das abas, nas duas telas: o
          organizador troca para a câmera para bipar e não pode perder de vista quem ele
          chamou. É o mesmo cartão do mockup, com "Compareceu" trocado pelo bip. */}
      {posto === "salao" && chamadosEmTransito.length > 0 ? (
        <PainelEmTransito
          chamados={chamadosEmTransito}
          onNoShow={(c) => {
            void marcarNoShowRemoto({ credenciadoId: c.id, zona: posto }).then(() =>
              carregar(true),
            );
          }}
          onIrParaCamera={() => {
            // LIMPA O RESULTADO ANTERIOR antes de abrir a câmera. Sem isso, voltar para o
            // leitor mostrava primeiro a tela verde do bip passado — o organizador tocava em
            // "Bipar" e via a confirmação de OUTRA pessoa, tendo que fechar para só então
            // conseguir ler o próximo QR.
            setResultado(null);
            setAba("checkin");
          }}
          onRechamar={(c) => {
            void chamarDoSalaoRemoto({ credenciadoId: c.id, eventoId }).then(() =>
              carregar(true),
            );
          }}
        />
      ) : null}

      {aba === "fila" || aba === "noshow" ? (
        <AbaFila
          busca={buscaFila}
          carregando={carregando}
          lista={aba === "noshow" ? listaNoShow : listaFila}
          mostrarPa={posto === "secretaria"}
          onBusca={setBuscaFila}
          onEnviarLink={enviarLinkDaFila}
          onChamar={
            // Na aba de no-show o Chamar existe SEMPRE: e o caminho de volta de quem reapareceu.
            posto === "salao" || aba === "noshow"
              ? async (c) => {
                  // O CAMINHO DE VOLTA É O DO PRÓPRIO POSTO. Na SECRETARIA, "chamar" quem
                  // reapareceu era `chamar-do-salao`: abria chamada zona=salão, a pessoa SUMIA
                  // da fila das 18 mesas (em trânsito), aparecia "aguardando chegar" no posto
                  // errado e o WhatsApp a mandava para o salão. O rebipe limpa a marca e a
                  // devolve à fila da secretaria, na posição original — sem chamada nenhuma.
                  const { error } =
                    posto === "secretaria"
                      ? await bipDaSecretariaRemoto({ credenciadoId: c.id, eventoId })
                      : await chamarDoSalaoRemoto({ credenciadoId: c.id, eventoId });

                  if (error) {
                    setErro(error);
                    return;
                  }

                  // Recarrega em vez de guardar no estado local: quem manda em "quem está em
                  // trânsito" é o banco, para os outros celulares enxergarem também.
                  await carregar(true);
                }
              : undefined
          }
          total={jaEntraram}
        />
      ) : (
      <>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- vídeo da câmera, sem áudio */}
        <video
          className="size-full object-cover"
          muted
          playsInline
          ref={videoRef}
        />
        <canvas className="hidden" ref={canvasRef} />

        {/* Mira: dá ao organizador onde encostar o crachá. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="size-56 rounded-2xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,.45)]" />
        </div>

        {estado !== "lendo" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#0b1017]/90 p-6 text-center">
            {estado === "pedindo-camera" ? (
              <p className="m-0 flex items-center gap-2 text-sm text-white/80">
                <Loader2 className="size-4 animate-spin" /> Abrindo a câmera...
              </p>
            ) : estado === "sem-permissao" ? (
              <div>
                <Camera aria-hidden="true" className="mx-auto size-8 text-white/60" />
                <p className="mt-2 text-sm font-semibold">
                  O navegador bloqueou a câmera.
                </p>
                <p className="m-0 mt-1 text-xs text-white/60">
                  Libere o acesso à câmera nas permissões do site e toque em atualizar. Enquanto
                  isso, dá para digitar o código do credenciamento.
                </p>
              </div>
            ) : estado === "sem-camera" ? (
              <div>
                <Camera aria-hidden="true" className="mx-auto size-8 text-white/60" />
                <p className="mt-2 text-sm font-semibold">
                  Não achei câmera neste aparelho.
                </p>
                <p className="m-0 mt-1 text-xs text-white/60">
                  Use o código do credenciamento para fazer o check-in.
                </p>
              </div>
            ) : (
              <p className="m-0 text-sm text-white/70">Câmera pausada.</p>
            )}
          </div>
        ) : null}

        {/* A PA vem DEPOIS da confirmação verde: o cliente já entrou na fila, e agora é a hora
            de fotografar a folha que ele tem na mão. Fica por cima de tudo (z-50) porque é uma
            decisão do organizador — fotografar ou seguir sem. */}
        {paPendente ? (
          <CapturaDaPa
            credenciado={paPendente}
            eventoId={eventoId}
            onFechar={() => setPaPendente(null)}
            onRegistrada={() => {
              setPaPendente(null);
              void carregar(true);
            }}
          />
        ) : null}

        {resultado ? (
          <ResultadoDoCheckin
            aoFechar={() => setResultado(null)}
            aoEscolher={(c) => void registrar(c)}
            registrando={registrando}
            resultado={resultado}
          />
        ) : null}
      </div>

      <div className="shrink-0 border-t border-white/10 p-3">
        {digitando ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!codigo.trim()) return;
              identificar(codigo);
              setCodigo("");
            }}
          >
            <input
              autoFocus
              className="h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 font-mono text-base uppercase text-white outline-none placeholder:text-white/35"
              inputMode="text"
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="APL-000000"
              value={codigo}
            />
            <button
              className="h-11 shrink-0 rounded-lg bg-[#cba25a] px-4 text-sm font-bold text-[#101820]"
              type="submit"
            >
              Buscar
            </button>
            <button
              aria-label="Voltar para a câmera"
              className="grid size-11 shrink-0 place-items-center rounded-lg border border-white/15"
              onClick={() => {
                setDigitando(false);
                setCodigo("");
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm font-semibold"
              onClick={() => setDigitando(true)}
              type="button"
            >
              <Keyboard aria-hidden="true" className="size-4" /> Digitar o código
            </button>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold"
              onClick={() => setCamera((v) => !v)}
              type="button"
            >
              <Camera aria-hidden="true" className="size-4" />
              {camera ? "Pausar" : "Ligar"}
            </button>
            {/* Sem abas, o salão precisa de uma saída da câmera. Se ele desistir de bipar (a
                pessoa não apareceu, chamou errado), tem que dar para voltar à fila. */}
            {posto === "salao" ? (
              <button
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold"
                onClick={() => setAba("fila")}
                type="button"
              >
                <ListChecks aria-hidden="true" className="size-4" /> Fila
              </button>
            ) : null}
          </div>
        )}
        {carregando ? (
          <p className="m-0 mt-2 flex items-center justify-center gap-2 text-[11px] text-white/50">
            <Loader2 className="size-3 animate-spin" /> Carregando a lista...
          </p>
        ) : null}
      </div>
      </>
      )}
    </div>
  );
}

// QUEM O SALÃO ESTÁ CHAMANDO. Segue o cartão que o Lucas aprovou, com uma troca central: onde
// havia "Compareceu" agora existe o BIP. Confirmar no clique é confiar na palavra de quem
// chegou; confirmar no QR é conferir a etiqueta na mão da pessoa — e é essa conferência que
// impede alguém de atender no lugar de outro.
// Relógio de espera que anda sozinho. Usado no painel de chamados e na fila: o Lucas quer ver
// HÁ QUANTO TEMPO a pessoa espera, não a que horas ela chegou — número parado não diz se a
// fila está andando ou travada.
function useRelogio(intervaloMs = 1000) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(timer);
  }, [intervaloMs]);

  return agora;
}

function tempoDesde(iso: string | null | undefined, agora: number): string {
  if (!iso) return "";

  const inicio = new Date(iso).getTime();
  if (Number.isNaN(inicio)) return "";

  const segundos = Math.max(0, Math.floor((agora - inicio) / 1000));
  const minutos = Math.floor(segundos / 60);

  if (minutos < 60) {
    return `${minutos}:${String(segundos % 60).padStart(2, "0")}`;
  }

  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

// QUEM FOI CHAMADO E AINDA NÃO APARECEU — o destaque da tela do salão.
//
// É uma LISTA, não um cartão: no dia uma pessoa chama várias de uma vez e elas chegam na ordem
// que quiserem. Fundo escuro com desfoque por cima da fila para o organizador não confundir
// "chamei" com "está esperando" — os dois grupos vivem na mesma tela.
function PainelEmTransito({
  chamados,
  onIrParaCamera,
  onNoShow,
  onRechamar,
}: {
  chamados: { chamadoEm: string; credenciado: PrometeuCredenciado }[];
  onIrParaCamera: () => void;
  onNoShow: (credenciado: PrometeuCredenciado) => void;
  onRechamar: (credenciado: PrometeuCredenciado) => void;
}) {
  const agora = useRelogio();
  // Confirmacao do rechamar: sem isso o organizador toca e nada muda na tela — ele nao sabe se
  // funcionou e acaba tocando de novo. Volta ao normal em 2s.
  const [rechamado, setRechamado] = useState<string | null>(null);

  return (
    <div className="mx-3 mb-2 shrink-0 overflow-hidden rounded-2xl border-2 border-[#cba25a] bg-[#cba25a]/15 shadow-[0_8px_30px_rgba(203,162,90,0.25)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 bg-[#cba25a] px-3 py-1.5">
        <p className="m-0 text-[11px] font-black uppercase tracking-widest text-[#101820]">
          Chamando · aguardando chegar
        </p>
        <span className="rounded-full bg-[#101820] px-2 py-0.5 text-[11px] font-black text-[#cba25a]">
          {chamados.length}
        </span>
      </div>

      {/* max-h em VH, não em rem: com 5 chamados a lista fixa cortava gente no meio (o Lucas
          chamou 5 e "começou a cortar"). Assim ela cresce com a tela e o scroll só entra
          quando realmente não couber. */}
      <ul className="m-0 max-h-[45vh] list-none overflow-y-auto p-2">
        {chamados.map(({ chamadoEm, credenciado }) => (
          <li
            className="flex items-center gap-2 rounded-xl px-2 py-2"
            key={credenciado.id}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-black leading-tight text-white">
                {credenciado.nome}
              </span>
              <span className="block truncate text-[11px] text-white/60">
                {credenciado.imobiliaria ?? "Sem imobiliária"}
                {credenciado.corretor ? ` · ${credenciado.corretor}` : ""}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {/* O tempo conta desde a PRIMEIRA chamada e NÃO reinicia ao rechamar: é ele que
                  diz quando desistir e marcar no-show. */}
              <span className="block text-sm font-black tabular-nums text-[#cba25a]">
                {tempoDesde(chamadoEm, agora)}
              </span>
              {/* BOTÕES DE VERDADE, SEPARADOS (Lucas, 27/07: "ficou um próximo do outro, a
                  chance de clicar errado é bem grande"). Eram dois textos colados; num celular,
                  com a mão apressada, marcar no-show sem querer manda a pessoa pro fim. Agora
                  cada um tem caixa, cor e área de toque própria, com espaço entre eles. */}
              <span className="mt-1 flex items-center justify-end gap-2">
                <button
                  className="rounded-lg border border-white/20 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-white/70"
                  onClick={() => {
                    onRechamar(credenciado);
                    setRechamado(credenciado.id);
                    window.setTimeout(() => setRechamado(null), 2000);
                  }}
                  type="button"
                >
                  {rechamado === credenciado.id ? "Chamado!" : "Rechamar"}
                </button>
                {/* SEM ISSO A FILA TRAVA: só o bip do QR fecha a chamada, e quem não veio não
                    tem QR pra bipar. O no-show tira da tela sem perder a pessoa — se ela
                    aparecer depois, é só chamar de novo. */}
                <button
                  className="rounded-lg border border-red-400/40 bg-red-500/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide text-red-300"
                  onClick={() => onNoShow(credenciado)}
                  type="button"
                >
                  Não veio
                </button>
              </span>
            </span>
          </li>
        ))}
      </ul>

      <button
        className="flex w-full items-center justify-center gap-2 bg-emerald-500 py-3 text-sm font-black text-white"
        onClick={onIrParaCamera}
        type="button"
      >
        <ScanLine aria-hidden="true" className="size-4" />
        Bipar quem chegou
      </button>
    </div>
  );
}

// O ícone do WhatsApp não existe no lucide (é marca registrada): mesmo path do mockup do
// atendente, para o botão ser reconhecido igual nas duas telas.
const ICONE_WPP = (
  <svg aria-hidden="true" fill="currentColor" height="16" viewBox="0 0 24 24" width="16">
    <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.3 0-.5.1-.6l.5-.6.3-.5v-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.2 3.4 5.4 4.7.7.3 1.3.5 1.8.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.3.2-1.4l-.6-.3ZM12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Z" />
  </svg>
);

function AbaFila({
  busca,
  carregando,
  lista,
  onBusca,
  onChamar,
  onEnviarLink,
  mostrarPa,
  total,
}: {
  busca: string;
  carregando: boolean;
  // Vem com a POSIÇÃO junto: a ordem é decidida no servidor e a busca não pode reescrevê-la.
  lista: { credenciado: PrometeuCredenciado; posicao: number }[];
  onBusca: (valor: string) => void;
  // Reenvia o link de acompanhamento da fila pelo WhatsApp. Existe em TODOS os postos: o cliente
  // que perdeu a mensagem pergunta a quem estiver mais perto, e no dia isso é o organizador.
  onEnviarLink?: (credenciado: PrometeuCredenciado) => void | Promise<void>;
  // Só o SALÃO chama. Na recepção a lista é consulta: quem organiza a entrada não chama
  // ninguém, e um botão de chamar ali seria um jeito fácil de furar a fila sem querer.
  onChamar?: (credenciado: PrometeuCredenciado) => void | Promise<void>;
  // Selo de PA: so a secretaria mostra (e la que a folha e fotografada).
  mostrarPa?: boolean;
  total: number;
}) {
  // Relogio proprio: a lista mostra HA QUANTO TEMPO cada um espera, e isso tem que andar.
  const agora = useRelogio();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-2">
        <label className="flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3">
          <Search aria-hidden="true" className="size-4 text-white/40" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            onChange={(e) => onBusca(e.target.value)}
            placeholder="Buscar por nome, CPF ou imobiliária..."
            value={busca}
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {carregando ? (
          <p className="m-0 flex items-center justify-center gap-2 py-8 text-xs text-white/50">
            <Loader2 className="size-4 animate-spin" /> Carregando a lista...
          </p>
        ) : lista.length === 0 ? (
          <p className="m-0 py-8 text-center text-xs text-white/50">
            {/* A mensagem seguia o total do EVENTO, então com a fila vazia por já ter chamado
                todo mundo ela dizia "nada encontrado para a busca" sem ninguém ter buscado. */}
            {busca.trim()
              ? "Nada encontrado para a busca."
              : "Ninguém esperando nesta fila."}
          </p>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0">
            {lista.map(({ credenciado: c, posicao }) => (
              <li
                key={c.id}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                  c.entrouEm
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-white/10 bg-white/5"
                }`}
              >
                {/* A POSIÇÃO NA FILA no lugar do ícone de "check" (pedido do Lucas 27/07). O
                    ícone só repetia o que a lista inteira já dizia — todo mundo aqui fez
                    check-in. O que o organizador precisa saber é QUEM É O PRÓXIMO. */}
                {/* A ORDEM EM DESTAQUE (Lucas, 27/07: "quero a numeração em destaque, pode
                    deixar o laranja do primeiro em todos"). É o dado que o organizador lê
                    primeiro na tela, então todos ganham o mesmo peso visual. */}
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full text-[14px] font-black tabular-nums ${
                    posicao === 0
                      ? "bg-red-500/20 text-red-300"
                      : "bg-[#cba25a] text-[#101820]"
                  }`}
                  title={
                    posicao === 0
                      ? "Não veio quando foi chamado. Chame de novo se aparecer."
                      : posicao === 1
                        ? "Próximo da fila"
                        : `${posicao}º da fila`
                  }
                >
                  {posicao === 0 ? "—" : String(posicao).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {c.nome}
                  </span>
                  {/* IMOBILIÁRIA · CORRETOR (Lucas, 27/07). Quem chama precisa saber por quem
                      o cliente veio: o corretor costuma estar no salão esperando o dele. */}
                  <span className="block truncate text-[11px] text-white/50">
                    {c.imobiliaria ?? "Sem imobiliária"}
                    {c.corretor ? ` · ${c.corretor}` : ""}
                  </span>
                </span>
                {c.pagoEm ? (
                  <span
                    aria-label="PIX pago"
                    className="grid size-5 shrink-0 place-items-center rounded-full bg-white text-[10px] font-black text-emerald-700"
                    title="PIX de R$ 1.000 pago"
                  >
                    $
                  </span>
                ) : null}
                {/* Só na SECRETARIA: é lá que a PA é fotografada, e o selo é o que faz o
                    organizador voltar em quem ficou sem antes de ir para o remoto. */}
                {mostrarPa ? <SeloDaPa temPa={c.paPath !== null} /> : null}
                {/* O LINK DA FILA. Ícone só, sem texto: numa linha de celular o que não pode
                    faltar é o nome e a posição. Área de toque de 36px para não brigar com o
                    "Chamar" ao lado, que é ação irreversível. */}
                {onEnviarLink ? (
                  <button
                    aria-label={`Enviar o link da fila para ${c.nome} no WhatsApp`}
                    className="grid size-9 shrink-0 place-items-center rounded-lg border border-[#25d366]/40 bg-[#25d366]/15 text-[#25d366]"
                    onClick={() => void onEnviarLink(c)}
                    title="Enviar o link de acompanhamento da fila no WhatsApp"
                    type="button"
                  >
                    {ICONE_WPP}
                  </button>
                ) : null}
                {onChamar ? (
                  <button
                    className="shrink-0 rounded-lg bg-[#cba25a] px-3 py-2 text-xs font-black text-[#101820]"
                    onClick={() => void onChamar(c)}
                    type="button"
                  >
                    Chamar
                  </button>
                ) : null}
                {/* CRONÔMETRO em cima, hora do check-in embaixo (Lucas, 27/07: "prefiro um
                    cronômetro do que a hora, pode ter os dois"). O tempo de espera é o que diz
                    se a fila está andando; a hora só serve para conferir depois. */}
                <span className="shrink-0 text-right">
                  <span className="block text-[13px] font-black tabular-nums text-[#cba25a]">
                    {tempoDesde(c.entrouEm, agora)}
                  </span>
                  <span className="block text-[10px] text-white/40">
                    {horaCheckin(c.entrouEm)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResultadoDoCheckin({
  aoEscolher,
  aoFechar,
  registrando,
  resultado,
}: {
  aoEscolher: (credenciado: PrometeuCredenciado) => void;
  aoFechar: () => void;
  registrando: boolean;
  resultado: Resultado;
}) {
  // O aviso de sucesso some sozinho: o organizador não tem mão livre para fechar a cada pessoa.
  useEffect(() => {
    if (resultado.tipo !== "ok") return;
    const timer = window.setTimeout(aoFechar, 2600);
    return () => window.clearTimeout(timer);
  }, [aoFechar, resultado]);

  const fundo =
    resultado.tipo === "ok"
      ? "bg-emerald-600"
      : resultado.tipo === "ja-entrou" || resultado.tipo === "recusado"
        ? // Âmbar, não vermelho: o sistema está barrando de propósito, nada quebrou.
          "bg-amber-500"
        : "bg-red-600";

  return (
    <div className={`absolute inset-0 grid place-items-center p-5 ${fundo}`}>
      <div className="w-full text-center text-white">
        {resultado.tipo === "ok" ? (
          <>
            <CheckCircle2 aria-hidden="true" className="mx-auto size-14" />
            <p className="mt-3 text-2xl font-black leading-tight">
              {resultado.credenciado.nome}
            </p>
            <p className="m-0 mt-1 text-sm font-semibold opacity-90">
              {resultado.credenciado.imobiliaria ?? "Sem imobiliária"}
              {resultado.credenciado.corretor
                ? ` · ${resultado.credenciado.corretor}`
                : ""}
            </p>
            {resultado.credenciado.pagoEm ? (
              <p className="m-0 mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-black text-emerald-700">
                PIX de R$ 1.000 pago
              </p>
            ) : null}
            {/* O texto de janela SAIU (Lucas, 27/07): quem está bipando não decide nada com
                essa informação, e ela ocupava a linha mais visível da confirmação. A regra da
                fila continua valendo no servidor — só não é mais anunciada a cada bip. */}
          </>
        ) : resultado.tipo === "ja-entrou" ? (
          <>
            <AlertTriangle aria-hidden="true" className="mx-auto size-14" />
            <p className="mt-3 text-2xl font-black leading-tight">
              {resultado.credenciado.nome}
            </p>
            <p className="m-0 mt-1 text-sm font-bold">já fez check-in</p>
          </>
        ) : resultado.tipo === "recusado" ? (
          // O SALÃO BARROU. Nome grande porque o organizador vai falar com a pessoa agora, e a
          // instrução em vez do erro cru: ele precisa saber o que dizer, não o que aconteceu.
          <>
            <AlertTriangle aria-hidden="true" className="mx-auto size-14" />
            <p className="mt-3 text-2xl font-black leading-tight">
              {resultado.credenciado.nome}
            </p>
            <p className="m-0 mt-2 text-base font-bold">ainda não foi chamado</p>
            <p className="m-0 mt-3 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-black text-amber-700">
              Peça para aguardar a chamada
            </p>
          </>
        ) : resultado.tipo === "ambiguo" ? (
          <>
            <AlertTriangle aria-hidden="true" className="mx-auto size-10" />
            <p className="mt-2 text-base font-bold">
              Esse código serve para mais de uma pessoa. Toque em quem está na sua frente:
            </p>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {resultado.candidatos.map((c) => (
                <li key={c.id}>
                  <button
                    className="w-full rounded-xl bg-white/15 px-3 py-2.5 text-left"
                    disabled={registrando}
                    onClick={() => aoEscolher(c)}
                    type="button"
                  >
                    <span className="block text-sm font-bold">{c.nome}</span>
                    <span className="block text-[11px] opacity-80">
                      {c.imobiliaria ?? "Sem imobiliária"} · {codigoDaCredencial(c.id)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <AlertTriangle aria-hidden="true" className="mx-auto size-14" />
            <p className="mt-3 text-lg font-bold">{resultado.texto}</p>
          </>
        )}

        {/* SEM BOTÃO NO SUCESSO (Lucas, 27/07): "bipou, processou, abre o check-in novamente".
            O verde já some sozinho em 2,6s e a câmera volta — pedir um toque a cada pessoa é
            atrito puro numa fila andando, e o organizador está de pé, com o celular numa mão.
            Nos outros casos o botão fica: recusa e erro exigem que ele LEIA antes de seguir. */}
        {resultado.tipo === "ok" ? null : (
          <button
            className="mt-5 h-11 w-full rounded-xl bg-black/25 text-sm font-bold"
            onClick={aoFechar}
            type="button"
          >
            Fechar
          </button>
        )}
      </div>
    </div>
  );
}
