"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Check,
  ChevronDown,
  ExternalLink,
  Loader2,
  MessageCircle,
  Pencil,
  RefreshCw,
  Send,
  X,
  Zap,
} from "lucide-react";

import { valorDigitado, valorParaOCampo } from "@/lib/apolo/boletos/valor-digitado";

import { T } from "./tema";

// A EMISSÃO DE BOLETOS NO PORTAL — a carteira do mês já aberta, e um botão que emite.
//
// Pedido do Lucas (01/09/2026): *"vamos ter uma aba trazendo o consolidado de tudo, vamos ter cada
// produto sua aba. vai ter uma tabela igual temos na carteira hoje... nome, cpf, valor da fatura,
// emissão vencimento, data de pagamento, vencido e tal. além do link do boleto"*. E, vendo a
// primeira versão: *"não quero importar planilha, já traz isso pronto, vc já tem os dados pode
// montar a tela e ter o botão de gerar boleto e pronto"*.
//
// ⚠️ A PLANILHA SAIU DO CAMINHO. Ela virou a origem de uma CARGA (`boletos_parcelas`), não a fonte
// que a tela consulta. Antes, quem abrisse a tela precisava ter o arquivo na mão, e duas pessoas com
// versões diferentes dele viam números diferentes do mesmo mês.
//
// ⚠️ A TELA NÃO MANDA VALOR NENHUM. O corpo do POST leva competência, empreendimento e, quando o
// operador escolhe, as unidades. Valor, CPF e vencimento a rota busca no banco: o preço do boleto
// não passa pelo lado que o operador consegue editar.

type Carteira = {
  conta: null | string;
  contaConfigurada: boolean;
  nome: string;
  slug: string;
};

type ParcelaAEmitir = {
  bloqueio: null | string;
  /** ⚠️ O CPF/CNPJ INTEIRO, para conferir e corrigir na tela. Pedido do Lucas (02/09/2026). */
  documento: null | string;
  documentoValido: boolean;
  empreendimento: string;
  /** O que impede a emissão, em uma frase. `null` = apto. */
  pendencia: null | string;
  jaEmitido: boolean;
  nome: string;
  nomeNaPlanilha: string;
  unidade: string;
  valor: null | number;
  vencimentoDia: null | number;
};

type EventoDoBoleto = {
  autor: null | string;
  canal: null | string;
  cobrancaId: null | string;
  detalhe: null | string;
  entrega: null | { em: null | string; status: string };
  ok: boolean;
  quando: string;
  telefone: null | string;
  tipo: "cancelamento" | "emissao" | "envio";
};

type Historico = {
  contato: null | string;
  eventos: EventoDoBoleto[];
  nome: null | string;
  unidade: string;
};

type BoletoEmitido = {
  cobranca: string;
  contato: null | string;
  documento: null | string;
  emissao: null | string;
  empreendimento: string;
  link: null | string;
  nome: string;
  pagamento: null | string;
  situacao: string;
  unidade: string;
  valor: number;
  vencido: boolean;
  vencimento: string;
  whatsappEnviadoEm: null | string;
  whatsappErro: null | string;
};

type Previa = {
  contato: null | string;
  impedimento: null | string;
  nome: string;
  texto: null | string;
  unidade: string;
};

type Envio = {
  canal: string;
  empreendimento: string;
  enviados: number;
  envios: { erro: null | string; nome: string; ok: boolean; telefone?: null | string; unidade: string }[];
  falhas: number;
};

type Emissao = {
  conta: string;
  emitidos: number;
  empreendimento: string;
  /** Quantas mensagens saíram junto com a emissão. Ausente quando o envio automático foi desligado. */
  enviados?: number;
  falhas: number;
  repetidos: number;
  resultados: {
    cobranca: null | string;
    erro: null | string;
    ja_existia: boolean;
    link: null | string;
    nome: string;
    unidade: string;
    valor: number;
  }[];
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

/**
 * `2026-09-15` → `15/09/2026`.
 *
 * ⚠️ FATIANDO A STRING, sem `new Date`. A data vem do Asaas como `AAAA-MM-DD`; passada por `new Date`
 * ela vira meia-noite UTC e, exibida no Brasil (UTC−3), mostra o DIA ANTERIOR: um vencimento dia 1º
 * apareceria como do mês passado.
 */
function dia(iso: null | string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function rotuloDaCompetencia(c: string): string {
  const [ano, mes] = c.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}

/** Do mês corrente para trás e para a frente: o administrativo emite o corrente, confere os passados. */
function competenciasSugeridas(): string[] {
  const hoje = new Date();
  const lista: string[] = [];
  for (let i = 3; i >= -3; i -= 1) {
    const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() - i, 1));
    lista.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return lista.reverse();
}

/**
 * A aba que junta as seis carteiras de teste.
 *
 * ⚠️ SÃO SEIS CARTEIRAS NO BACKEND E UMA ABA NA TELA. Pedido do Lucas (01/09/2026): *"pode fazer na
 * mesma aba do teste, so incluir o empreendimento diferente"*. Elas precisam ser empreendimentos
 * separados porque a conta do Asaas vem do EMPREENDIMENTO (testar a chave do Garden exige emitir por
 * um cujo `conta` seja `garden`), mas seis abas de teste ao lado de nove reais é ruído.
 */
const ABA_TESTE = "__teste__";

const ehTeste = (slug: string) => slug.startsWith("teste");

export function TelaBoletos() {
  const [competencia, setCompetencia] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  });
  const [carteiras, setCarteiras] = useState<Carteira[]>([]);
  const [aEmitir, setAEmitir] = useState<ParcelaAEmitir[]>([]);
  const [emitidos, setEmitidos] = useState<BoletoEmitido[]>([]);
  const [falhas, setFalhas] = useState<{ conta: string; erro: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [aba, setAba] = useState<string>("consolidado");

  const [emitindo, setEmitindo] = useState<null | string>(null);
  const [emissao, setEmissao] = useState<null | Emissao>(null);

  // O envio do link por WhatsApp: prévia primeiro, disparo depois.
  const [previas, setPrevias] = useState<null | { itens: Previa[]; slug: string }>(null);
  const [enviando, setEnviando] = useState(false);
  const [envio, setEnvio] = useState<null | Envio>(null);

  // A linha aberta: o histórico do boleto, logo abaixo dela.
  const [aberta, setAberta] = useState<null | string>(null);
  const [historico, setHistorico] = useState<null | Historico>(null);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);
  const [ocupado, setOcupado] = useState<null | string>(null);

  // ⚠️ LIGADO POR PADRÃO: *"o disparo tem que ser automatico quando gerado o boleto"* (Lucas,
  // 01/09/2026). Fica visível e desmarcável porque emitir sem avisar é caso legítimo, e porque
  // mandar mensagem sem querer não tem desfazer.
  const [enviarAoEmitir, setEnviarAoEmitir] = useState(true);
  // A unidade que o operador escolheu emitir sozinha. Vazio = o lote inteiro daquela carteira.
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/incorporador/boletos?competencia=${competencia}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`Não consegui carregar (${r.status}).`);
      const j = (await r.json()) as {
        data?: {
          aEmitir: ParcelaAEmitir[];
          boletos: BoletoEmitido[];
          carteiras: Carteira[];
          falhas: { conta: string; erro: string }[];
        };
      };
      setAEmitir(j.data?.aEmitir ?? []);
      setEmitidos(j.data?.boletos ?? []);
      setCarteiras(j.data?.carteiras ?? []);
      setFalhas(j.data?.falhas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar.");
    } finally {
      setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  useEffect(() => {
    setEmissao(null);
    setPrevias(null);
    setEnvio(null);
    setSelecionadas(new Set());
  }, [competencia]);

  /**
   * Emite o lote da aba.
   *
   * ⚠️ UMA CHAMADA POR EMPREENDIMENTO, porque a conta do Asaas vem dele. Na aba de teste são seis
   * empreendimentos diferentes (um por conta), e mandar `__teste__` como slug devolveria 404: essa
   * aba existe só na tela.
   */
  const emitir = useCallback(
    async (alvos: string[], unidades?: string[]) => {
      if (alvos.length === 0) return;
      setEmitindo(alvos[0]!);
      setErro(null);
      setEmissao(null);

      const juntos: Emissao[] = [];
      const problemas: string[] = [];

      try {
        // Em série: cada uma cria cobranças de verdade, e paralelizar embaralharia os resultados.
        for (const slug of alvos) {
          const r = await fetch("/api/incorporador/boletos", {
            body: JSON.stringify({
              competencia,
              confirmar: true,
              empreendimento: slug,
              // ⚠️ Por enquanto o automático sai pelo Relacionamento: o template ainda não foi
              // aprovado pela Meta, e o Atendimento devolveria "template não existe" em todos.
              ...(enviarAoEmitir ? { enviarAoEmitir: "relacionamento" } : {}),
              ...(unidades && unidades.length > 0 ? { unidades } : {}),
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
          });
          const j = (await r.json()) as { data?: Emissao; error?: string };
          // ⚠️ UMA CARTEIRA QUE FALHA NÃO PARA AS OUTRAS. Na aba de teste é exatamente o esperado:
          // a conta sem chave devolve erro e as cinco com chave precisam emitir mesmo assim.
          if (!r.ok) {
            problemas.push(`${slug}: ${j.error ?? `falhou (${r.status})`}`);
            continue;
          }
          if (j.data) juntos.push(j.data);
        }

        if (juntos.length > 0) {
          setEmissao(
            juntos.length === 1
              ? juntos[0]!
              : {
                  conta: [...new Set(juntos.map((e) => e.conta))].join(", "),
                  emitidos: juntos.reduce((a, e) => a + e.emitidos, 0),
                  empreendimento: juntos.map((e) => e.empreendimento).join(", "),
                  enviados: juntos.reduce((a, e) => a + (e.enviados ?? 0), 0),
                  falhas: juntos.reduce((a, e) => a + e.falhas, 0),
                  repetidos: juntos.reduce((a, e) => a + e.repetidos, 0),
                  resultados: juntos.flatMap((e) => e.resultados),
                },
          );
        }
        if (problemas.length > 0) setErro(problemas.join(" · "));

        setSelecionadas(new Set());
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui falar com o servidor.");
      } finally {
        setEmitindo(null);
      }
    },
    [carregar, competencia, enviarAoEmitir],
  );

  /**
   * Pede a PRÉVIA do que seria enviado, sem mandar nada.
   *
   * ⚠️ MENSAGEM ENVIADA NÃO VOLTA. Ler o texto exato que cada cliente receberia é a única chance de
   * pegar um nome trocado ou um valor fora de lugar enquanto isso ainda custa zero.
   */
  const conferirEnvio = useCallback(
    async (slug: string, unidades: string[]) => {
      setEnviando(true);
      setErro(null);
      setEnvio(null);
      try {
        const r = await fetch("/api/incorporador/boletos", {
          body: JSON.stringify({
            acao: "enviar",
            competencia,
            empreendimento: slug,
            ...(unidades.length > 0 ? { unidades } : {}),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const j = (await r.json()) as { data?: { previas: Previa[] }; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        setPrevias({ itens: j.data?.previas ?? [], slug });
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui montar a prévia.");
      } finally {
        setEnviando(false);
      }
    },
    [competencia],
  );

  const enviar = useCallback(
    async (slug: string, unidades: string[], canal: "relacionamento" | "template") => {
      setEnviando(true);
      setErro(null);
      try {
        const r = await fetch("/api/incorporador/boletos", {
          body: JSON.stringify({
            acao: "enviar",
            canal,
            competencia,
            confirmar: true,
            empreendimento: slug,
            ...(unidades.length > 0 ? { unidades } : {}),
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const j = (await r.json()) as { data?: Envio; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        setEnvio(j.data ?? null);
        setPrevias(null);
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui enviar.");
      } finally {
        setEnviando(false);
      }
    },
    [carregar, competencia],
  );

  const abrirHistorico = useCallback(
    async (empreendimento: string, unidade: string) => {
      const chave = `${empreendimento}|${unidade}`;
      if (aberta === chave) {
        setAberta(null);
        setHistorico(null);
        return;
      }
      setAberta(chave);
      setHistorico(null);
      setCarregandoHistorico(true);
      try {
        const r = await fetch(
          `/api/incorporador/boletos?competencia=${competencia}` +
            `&historico=${encodeURIComponent(unidade)}` +
            `&empreendimento=${encodeURIComponent(empreendimento)}`,
          { cache: "no-store" },
        );
        const j = (await r.json()) as { data?: Historico; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        setHistorico(j.data ?? null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui carregar o histórico.");
        setAberta(null);
      } finally {
        setCarregandoHistorico(false);
      }
    },
    [aberta, competencia],
  );

  /** Reenviar, cancelar e editar: as três mexem numa unidade só, e recarregam a tela. */
  const acaoNaUnidade = useCallback(
    async (
      empreendimento: string,
      unidade: string,
      corpo: Record<string, unknown>,
    ): Promise<boolean> => {
      setOcupado(`${empreendimento}|${unidade}`);
      setErro(null);
      try {
        const r = await fetch("/api/incorporador/boletos", {
          body: JSON.stringify({ competencia, empreendimento, unidades: [unidade], ...corpo }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const j = (await r.json()) as { data?: unknown; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        await carregar();
        // O histórico ganhou linha nova: recarrega o que está aberto.
        if (aberta === `${empreendimento}|${unidade}`) {
          setAberta(null);
          await abrirHistorico(empreendimento, unidade);
        }
        return true;
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui completar a ação.");
        return false;
      } finally {
        setOcupado(null);
      }
    },
    [aberta, abrirHistorico, carregar, competencia],
  );

  // ── O que cada aba mostra ──────────────────────────────────────────────────

  const pendentes = useMemo(
    () => aEmitir.filter((p) => !p.bloqueio && !p.jaEmitido && (p.valor ?? 0) > 0),
    [aEmitir],
  );

  /** A aba mostra esta carteira? A de teste mostra as seis; o consolidado, todas menos as de teste. */
  const naAba = useCallback(
    (slug: string) => {
      if (aba === ABA_TESTE) return ehTeste(slug);
      // ⚠️ O CONSOLIDADO NÃO SOMA OS TESTES. Eles são boletos de R$ 5,00 no CPF do Lucas: entrar no
      // total do mês faria o número que o administrativo confere não bater com a planilha.
      if (aba === "consolidado") return !ehTeste(slug);
      return slug === aba;
    },
    [aba],
  );

  const visiveisPendentes = pendentes.filter((p) => naAba(p.empreendimento));
  const visiveisEmitidos = emitidos.filter((b) => naAba(b.empreendimento));
  const visiveisFora = aEmitir.filter((p) => p.bloqueio && naAba(p.empreendimento));

  const totais = useMemo(() => {
    const pagos = visiveisEmitidos.filter((b) => b.pagamento);
    const vencidos = visiveisEmitidos.filter((b) => b.vencido);
    return {
      aEmitir: visiveisPendentes.reduce((a, p) => a + (p.valor ?? 0), 0),
      emitido: visiveisEmitidos.reduce((a, b) => a + b.valor, 0),
      pago: pagos.reduce((a, b) => a + b.valor, 0),
      pagos: pagos.length,
      vencido: vencidos.reduce((a, b) => a + b.valor, 0),
      vencidos: vencidos.length,
    };
  }, [visiveisEmitidos, visiveisPendentes]);

  const contagemPorCarteira = useMemo(() => {
    const m = new Map<string, { emitidos: number; pendentes: number }>();
    for (const c of carteiras) m.set(c.slug, { emitidos: 0, pendentes: 0 });
    // As seis de teste somam num contador só, o da aba agrupada.
    m.set(ABA_TESTE, { emitidos: 0, pendentes: 0 });

    for (const p of pendentes) {
      const chave = ehTeste(p.empreendimento) ? ABA_TESTE : p.empreendimento;
      const e = m.get(chave);
      if (e) e.pendentes += 1;
    }
    for (const b of emitidos) {
      const chave = ehTeste(b.empreendimento) ? ABA_TESTE : b.empreendimento;
      const e = m.get(chave);
      if (e) e.emitidos += 1;
    }
    return m;
  }, [carteiras, emitidos, pendentes]);

  // ⚠️ SÓ AS CARTEIRAS REAIS CONTAM AQUI. Uma conta de teste sem chave é a mesma conta real sem
  // chave, e listar as duas faria o aviso dizer "Teste On Sky, On Sky" para um problema só.
  /** Os empreendimentos que o botão da aba atinge. Na de teste são seis; nas outras, um. */
  const alvosDaAba =
    aba === ABA_TESTE
      ? [...new Set(visiveisPendentes.map((p) => p.empreendimento))]
      : aba === "consolidado"
        ? []
        : [aba];

  const semChave = carteiras.filter((c) => !c.contaConfigurada && !ehTeste(c.slug));

  const podeEmitir =
    aba === ABA_TESTE
      ? carteiras.some((c) => ehTeste(c.slug) && c.contaConfigurada)
      : aba !== "consolidado" && Boolean(carteiras.find((c) => c.slug === aba)?.contaConfigurada);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Cabecalho
        aoAtualizar={() => void carregar()}
        carregando={carregando}
        competencia={competencia}
        onCompetencia={setCompetencia}
      />

      {semChave.length > 0 ? (
        <Aviso tom="alerta">
          Sem chave do Asaas configurada: {semChave.map((c) => c.nome).join(", ")}. Enquanto ela não
          entrar no ambiente, estes empreendimentos não emitem.
        </Aviso>
      ) : null}
      {falhas.map((f) => (
        <Aviso key={f.conta} tom="erro">
          Não consegui ler a conta {f.conta} no Asaas: {f.erro}
        </Aviso>
      ))}
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}
      {emissao ? <ResultadoDaEmissao emissao={emissao} /> : null}
      {envio ? <ResultadoDoEnvio envio={envio} /> : null}
      {previas ? (
        <PainelDeEnvio
          aoCancelar={() => setPrevias(null)}
          aoEnviar={(canal) =>
            void enviar(previas.slug, [...selecionadas], canal)
          }
          enviando={enviando}
          previas={previas.itens}
        />
      ) : null}

      <Abas
        aba={aba}
        carteiras={carteiras}
        contagem={contagemPorCarteira}
        onAba={(a) => {
          setAba(a);
          setSelecionadas(new Set());
        }}
        totalEmitidos={emitidos.length}
        totalPendentes={pendentes.length}
      />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <Cartao
          nota={`${visiveisPendentes.length} boleto(s)`}
          rotulo="A emitir"
          tom={visiveisPendentes.length > 0 ? "destaque" : undefined}
          valor={moeda(totais.aEmitir)}
        />
        <Cartao
          nota={`${visiveisEmitidos.length} boleto(s)`}
          rotulo="Emitido"
          valor={moeda(totais.emitido)}
        />
        <Cartao nota={`${totais.pagos} boleto(s)`} rotulo="Pago" valor={moeda(totais.pago)} />
        <Cartao
          nota={`${totais.vencidos} boleto(s)`}
          rotulo="Vencido"
          tom={totais.vencidos > 0 ? "alerta" : undefined}
          valor={moeda(totais.vencido)}
        />
      </div>

      {carregando ? (
        <p style={{ color: T.sub, fontSize: 14, padding: 24, textAlign: "center" }}>
          <Loader2 className="inc-girando" size={16} style={{ verticalAlign: "middle" }} /> Lendo a
          carteira e o Asaas…
        </p>
      ) : (
        <>
          {visiveisPendentes.length > 0 ? (
            <AEmitir
              acaoNaUnidade={acaoNaUnidade}
              aoEmitir={(unidades) => void emitir(alvosDaAba, unidades)}
              emitindo={emitindo === aba}
              enviarAoEmitir={enviarAoEmitir}
              mostrarPredio={aba === "consolidado" || aba === ABA_TESTE}
              ocupado={ocupado}
              onEnviarAoEmitir={setEnviarAoEmitir}
              parcelas={visiveisPendentes}
              podeEmitir={Boolean(podeEmitir)}
              selecionadas={selecionadas}
              onSelecionadas={setSelecionadas}
            />
          ) : null}

          <Emitidos
            aberta={aberta}
            acaoNaUnidade={acaoNaUnidade}
            aoAbrir={abrirHistorico}
            aoConferirEnvio={
              // Na aba de teste o envio em lote não faz sentido (cada linha é de uma conta), e o
              // botão de reenviar de cada linha resolve.
              aba !== "consolidado" && aba !== ABA_TESTE && visiveisEmitidos.length > 0
                ? () => void conferirEnvio(aba, [...selecionadas])
                : null
            }
            boletos={visiveisEmitidos}
            carregandoHistorico={carregandoHistorico}
            enviando={enviando}
            historico={historico}
            mostrarPredio={aba === "consolidado" || aba === ABA_TESTE}
            ocupado={ocupado}
          />

          {visiveisFora.length > 0 ? (
            <ForaDaEmissao
              acaoNaUnidade={acaoNaUnidade}
              mostrarPredio={aba === "consolidado" || aba === ABA_TESTE}
              ocupado={ocupado}
              parcelas={visiveisFora}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

// ── CABEÇALHO ───────────────────────────────────────────────────────────────

function Cabecalho({
  aoAtualizar,
  carregando,
  competencia,
  onCompetencia,
}: {
  aoAtualizar: () => void;
  carregando: boolean;
  competencia: string;
  onCompetencia: (c: string) => void;
}) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 700, margin: 0 }}>
          Emissão de boletos
        </h1>
        <p style={{ color: T.sub, fontSize: 13, margin: "4px 0 0" }}>
          Competência de {rotuloDaCompetencia(competencia)}
        </p>
      </div>

      <select
        onChange={(e) => onCompetencia(e.target.value)}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          fontSize: 14,
          padding: "8px 12px",
        }}
        value={competencia}
      >
        {competenciasSugeridas().map((c) => (
          <option key={c} value={c}>
            {rotuloDaCompetencia(c)}
          </option>
        ))}
      </select>

      <button
        disabled={carregando}
        onClick={aoAtualizar}
        style={{
          alignItems: "center",
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          cursor: carregando ? "default" : "pointer",
          display: "inline-flex",
          fontSize: 14,
          gap: 6,
          padding: "8px 12px",
        }}
        type="button"
      >
        {carregando ? <Loader2 className="inc-girando" size={15} /> : <RefreshCw size={15} />}
        Atualizar
      </button>
    </div>
  );
}

// ── EDITAR NA PRÓPRIA LINHA ─────────────────────────────────────────────────
//
// ⚠️ 32 UNIDADES ESTAO SEM CPF E O ASAAS NAO CRIA CLIENTE SEM ELE. Pedido do Lucas (02/09/2026):
// *"deixa por favor o CPF todo legivel e editavel, vou pedir alguem para atualizar"* e *"quero
// poder tambem alterar a data de vencimento"*. Mandar a pessoa abrir a planilha, corrigir e pedir
// recarga para cada linha e o caminho que faz ninguem corrigir.
//
// ⚠️ SALVA NO BLUR E NO ENTER, NAO A CADA TECLA: um CPF tem 11 digitos e salvar a cada um deles
// mandaria 11 requisicoes, dez delas com documento invalido. Escape desiste e devolve o valor
// anterior.
//
// ⚠️ O SERVIDOR CONFERE O DIGITO VERIFICADOR e devolve o erro; aqui a linha so pinta de vermelho o
// que ele recusou. Validar so no cliente deixaria a rota aceitar qualquer coisa vinda de fora.

function CelulaEditavel({
  ajuda,
  aoSalvar,
  invalido,
  largura,
  ocupado,
  placeholder,
  valor,
}: {
  ajuda?: string;
  aoSalvar: (novo: string) => Promise<boolean>;
  invalido?: boolean;
  largura: number;
  ocupado: boolean;
  placeholder: string;
  valor: string;
}) {
  const [texto, setTexto] = useState(valor);
  const [salvando, setSalvando] = useState(false);

  // O valor do servidor volta a mandar quando a lista recarrega (ex.: outra pessoa editou).
  useEffect(() => {
    setTexto(valor);
  }, [valor]);

  const salvar = async () => {
    const limpo = texto.trim();
    if (limpo === valor.trim()) return;
    if (!limpo) {
      setTexto(valor);
      return;
    }
    setSalvando(true);
    const ok = await aoSalvar(limpo);
    setSalvando(false);
    if (!ok) setTexto(valor);
  };

  return (
    <input
      aria-label={ajuda}
      disabled={ocupado || salvando}
      onBlur={() => void salvar()}
      onChange={(e) => setTexto(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") setTexto(valor);
      }}
      placeholder={placeholder}
      style={{
        background: "transparent",
        border: `1px solid ${invalido ? T.danger : texto.trim() ? "transparent" : T.gold}`,
        borderRadius: 6,
        color: invalido ? T.danger : T.text,
        fontSize: 13,
        fontVariantNumeric: "tabular-nums",
        opacity: salvando ? 0.5 : 1,
        padding: "4px 6px",
        width: largura,
      }}
      title={ajuda}
      type="text"
      value={texto}
    />
  );
}

/** `12345678901` → `123.456.789-01`; `12345678000199` → `12.345.678/0001-99`. */
function documentoLegivel(documento: null | string): string {
  const d = String(documento ?? "").replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return d;
}

/** A situação da linha: apta, ou o que falta. */
function Situacao({ pendencia }: { pendencia: null | string }) {
  if (!pendencia) {
    return (
      <span
        style={{
          alignItems: "center",
          color: T.ok,
          display: "inline-flex",
          fontSize: 12.5,
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        <Check size={13} /> Apto a enviar
      </span>
    );
  }
  return (
    <span style={{ color: T.danger, display: "inline-block", fontSize: 12.5, lineHeight: 1.35 }}>
      {pendencia}
    </span>
  );
}

// ── A EMITIR ────────────────────────────────────────────────────────────────

function AEmitir({
  acaoNaUnidade,
  aoEmitir,
  emitindo,
  enviarAoEmitir,
  mostrarPredio,
  ocupado,
  onEnviarAoEmitir,
  onSelecionadas,
  parcelas,
  podeEmitir,
  selecionadas,
}: {
  acaoNaUnidade: (e: string, u: string, corpo: Record<string, unknown>) => Promise<boolean>;
  aoEmitir: (unidades: string[]) => void;
  emitindo: boolean;
  enviarAoEmitir: boolean;
  mostrarPredio: boolean;
  ocupado: null | string;
  onEnviarAoEmitir: (v: boolean) => void;
  onSelecionadas: (s: Set<string>) => void;
  parcelas: ParcelaAEmitir[];
  podeEmitir: boolean;
  selecionadas: Set<string>;
}) {
  const total = parcelas.reduce((a, p) => a + (p.valor ?? 0), 0);
  const escolhidas = parcelas.filter((p) => selecionadas.has(p.unidade));
  const totalEscolhido = escolhidas.reduce((a, p) => a + (p.valor ?? 0), 0);
  const alvo = escolhidas.length > 0 ? escolhidas : parcelas;
  const todasMarcadas = parcelas.length > 0 && escolhidas.length === parcelas.length;
  const algumasMarcadas = escolhidas.length > 0;

  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.gold}`,
        borderRadius: 12,
        display: "grid",
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <strong style={{ color: T.text, fontSize: 15 }}>
          {parcelas.length} pronto(s) para emitir · {moeda(total)}
        </strong>

        {podeEmitir ? (
          <button
            disabled={emitindo}
            onClick={() => aoEmitir(escolhidas.map((p) => p.unidade))}
            style={{
              alignItems: "center",
              background: T.btnBg,
              border: "none",
              borderRadius: 8,
              color: T.btnFg,
              cursor: emitindo ? "default" : "pointer",
              display: "inline-flex",
              fontSize: 14,
              fontWeight: 600,
              gap: 6,
              marginLeft: "auto",
              padding: "9px 16px",
            }}
            type="button"
          >
            {emitindo ? <Loader2 className="inc-girando" size={15} /> : <Zap size={15} />}
            {emitindo
              ? "Emitindo…"
              : escolhidas.length > 0
                ? `Gerar ${escolhidas.length} boleto(s) · ${moeda(totalEscolhido)}`
                : `Gerar os ${parcelas.length} boletos`}
          </button>
        ) : (
          // ⚠️ NO CONSOLIDADO NÃO HÁ BOTÃO, e é de propósito: cada carteira tem a sua conta, e um
          // "emitir tudo" esconderia em qual CNPJ cada boleto está saindo. Abrir a aba do prédio é
          // o passo que faz o operador ver de quem é a conta antes de clicar.
          <span style={{ color: T.sub, fontSize: 13, marginLeft: "auto" }}>
            Abra a aba do empreendimento para emitir
          </span>
        )}
      </div>

      {podeEmitir ? (
        <label
          style={{
            alignItems: "center",
            color: T.sub,
            cursor: "pointer",
            display: "inline-flex",
            fontSize: 13,
            gap: 7,
          }}
        >
          <input
            checked={enviarAoEmitir}
            onChange={(e) => onEnviarAoEmitir(e.target.checked)}
            type="checkbox"
          />
          Mandar o link ao cliente logo depois de gerar
        </label>
      ) : null}

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 640, width: "100%" }}>
          <thead>
            <tr style={{ color: T.sub, textAlign: "left" }}>
              {podeEmitir ? (
                <th style={{ padding: "6px 8px", width: 32 }}>
                  {/* ⚠️ SELECIONAR TUDO NO CABEÇALHO, e não um botão à parte. Pedido do Lucas
                      (02/09/2026): *"os aptos (aí eu posso selecionar tudo) e os que falta
                      correção, assim eu posso adiantar o que está pronto"*. Só alcança as linhas
                      desta aba: no consolidado não há emissão, e cada aba é uma conta do Asaas. */}
                  <input
                    aria-label={
                      todasMarcadas ? "Desmarcar todas as unidades" : "Selecionar todas as unidades"
                    }
                    checked={todasMarcadas}
                    onChange={(e) => {
                      const nova = new Set(selecionadas);
                      for (const p of parcelas) {
                        if (e.target.checked) nova.add(p.unidade);
                        else nova.delete(p.unidade);
                      }
                      onSelecionadas(nova);
                    }}
                    ref={(el) => {
                      // O traço do "alguns marcados": sem ele, meia seleção parece nenhuma.
                      if (el) el.indeterminate = algumasMarcadas && !todasMarcadas;
                    }}
                    title={todasMarcadas ? "Desmarcar todas" : "Selecionar todas"}
                    type="checkbox"
                  />
                </th>
              ) : null}
              <th style={cabecalho}>Cliente</th>
              {mostrarPredio ? <th style={cabecalho}>Prédio</th> : null}
              <th style={cabecalho}>Unidade</th>
              <th style={cabecalho}>CPF/CNPJ</th>
              <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
              <th style={cabecalho}>Vence dia</th>
              <th style={cabecalho}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => (
              <tr key={`${p.empreendimento}|${p.unidade}`} style={{ borderTop: `1px solid ${T.border}` }}>
                {podeEmitir ? (
                  <td style={{ padding: "7px 8px" }}>
                    <input
                      aria-label={`Selecionar ${p.nome}`}
                      checked={selecionadas.has(p.unidade)}
                      onChange={(e) => {
                        const nova = new Set(selecionadas);
                        if (e.target.checked) nova.add(p.unidade);
                        else nova.delete(p.unidade);
                        onSelecionadas(nova);
                      }}
                      type="checkbox"
                    />
                  </td>
                ) : null}
                <td style={{ color: T.text, padding: "7px 8px" }}>
                  {p.nome}
                  {/* ⚠️ O nome da planilha aparece quando difere do cadastro: o boleto sai no CPF do
                      cadastro, e se o imóvel trocou de dono é aqui que se vê. */}
                  {p.nomeNaPlanilha !== p.nome ? (
                    <span style={{ color: T.sub, display: "block", fontSize: 12 }}>
                      na planilha: {p.nomeNaPlanilha}
                    </span>
                  ) : null}
                </td>
                {mostrarPredio ? (
                  <td style={{ color: T.sub, padding: "7px 8px", whiteSpace: "nowrap" }}>
                    {p.empreendimento}
                  </td>
                ) : null}
                <td style={{ color: T.sub, padding: "7px 8px" }}>{p.unidade}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                  <CelulaEditavel
                    ajuda={`CPF ou CNPJ de ${p.nome}`}
                    aoSalvar={(novo) =>
                      acaoNaUnidade(p.empreendimento, p.unidade, {
                        acao: "cadastro",
                        documento: novo,
                      })
                    }
                    invalido={Boolean(p.documento) && !p.documentoValido}
                    largura={150}
                    ocupado={ocupado === `${p.empreendimento}|${p.unidade}`}
                    placeholder="sem CPF"
                    valor={documentoLegivel(p.documento)}
                  />
                </td>
                <td style={numero}>{p.valor === null ? "—" : moeda(p.valor)}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                  <CelulaEditavel
                    ajuda="Dia do vencimento (1 a 31)"
                    aoSalvar={(novo) =>
                      acaoNaUnidade(p.empreendimento, p.unidade, {
                        acao: "cadastro",
                        vencimentoDia: Number(novo.replace(/\D/g, "")),
                      })
                    }
                    largura={46}
                    ocupado={ocupado === `${p.empreendimento}|${p.unidade}`}
                    placeholder="dia"
                    valor={p.vencimentoDia ? String(p.vencimentoDia) : ""}
                  />
                </td>
                <td style={{ maxWidth: 260, padding: "7px 8px" }}>
                  <Situacao pendencia={p.pendencia} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── EMITIDOS ────────────────────────────────────────────────────────────────

function Emitidos({
  aberta,
  acaoNaUnidade,
  aoAbrir,
  aoConferirEnvio,
  boletos,
  carregandoHistorico,
  enviando,
  historico,
  mostrarPredio,
  ocupado,
}: {
  aberta: null | string;
  acaoNaUnidade: (
    empreendimento: string,
    unidade: string,
    corpo: Record<string, unknown>,
  ) => Promise<boolean>;
  aoAbrir: (empreendimento: string, unidade: string) => void;
  /** `null` no consolidado: enviar é por carteira, para o operador ver de qual conta saiu. */
  aoConferirEnvio: (() => void) | null;
  boletos: BoletoEmitido[];
  carregandoHistorico: boolean;
  enviando: boolean;
  historico: null | Historico;
  mostrarPredio: boolean;
  ocupado: null | string;
}) {
  if (boletos.length === 0) {
    return (
      <p
        style={{
          background: T.card,
          border: `1px dashed ${T.border}`,
          borderRadius: 12,
          color: T.sub,
          fontSize: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        Nenhum boleto emitido nesta competência.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {aoConferirEnvio ? (
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
          <strong style={{ color: T.text, fontSize: 14 }}>
            {boletos.length} boleto(s) emitido(s)
          </strong>
          <button
            disabled={enviando}
            onClick={aoConferirEnvio}
            style={{
              alignItems: "center",
              background: "transparent",
              border: `1px solid ${T.gold}`,
              borderRadius: 8,
              color: T.text,
              cursor: enviando ? "default" : "pointer",
              display: "inline-flex",
              fontSize: 13.5,
              fontWeight: 600,
              gap: 6,
              marginLeft: "auto",
              padding: "7px 14px",
            }}
            type="button"
          >
            {enviando ? (
              <Loader2 className="inc-girando" size={14} />
            ) : (
              <MessageCircle size={14} />
            )}
            Enviar link por WhatsApp
          </button>
        </div>
      ) : null}

      {/* ⚠️ A ROLAGEM É DA TABELA, e não da página: com dez colunas no celular, deixar o corpo
          rolar de lado empurra o menu do portal para fora da tela. */}
      <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 900, width: "100%" }}>
        <thead>
          <tr style={{ color: T.sub, textAlign: "left" }}>
            <th style={{ ...cabecalho, width: 26 }} />
            <th style={cabecalho}>Cliente</th>
            {mostrarPredio ? <th style={cabecalho}>Prédio</th> : null}
            <th style={cabecalho}>Unidade</th>
            <th style={cabecalho}>CPF/CNPJ</th>
            <th style={cabecalho}>Telefone</th>
            <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
            <th style={cabecalho}>Vencimento</th>
            <th style={cabecalho}>Pagamento</th>
            <th style={cabecalho}>Situação</th>
            <th style={cabecalho}>Enviado</th>
            <th style={cabecalho}>Boleto</th>
          </tr>
        </thead>
        <tbody>
          {boletos.map((b) => {
            const chave = `${b.empreendimento}|${b.unidade}`;
            const estaAberta = aberta === chave;
            const colunas = mostrarPredio ? 12 : 11;

            return (
              <Fragment key={b.cobranca}>
                {/* ⚠️ A LINHA INTEIRA ABRE O HISTÓRICO. Pedido do Lucas (01/09/2026): *"ao clicar na
                    linha que abrisse um modal abaixo mostrando o histórico"*. O link do boleto para
                    a propagação, senão abrir o boleto abriria o painel junto. */}
                <tr
                  onClick={() => aoAbrir(b.empreendimento, b.unidade)}
                  style={{
                    background: estaAberta ? T.soft : "transparent",
                    borderTop: `1px solid ${T.border}`,
                    cursor: "pointer",
                  }}
                >
                  <td style={{ color: T.sub, padding: "8px 4px 8px 10px" }}>
                    <ChevronDown
                      size={14}
                      style={{
                        transform: estaAberta ? "rotate(0deg)" : "rotate(-90deg)",
                        transition: "transform .15s",
                      }}
                    />
                  </td>
                  <td style={{ color: T.text, padding: "8px 10px" }}>{b.nome}</td>
                  {mostrarPredio ? (
                    <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                      {b.empreendimento}
                    </td>
                  ) : null}
                  <td style={{ color: T.sub, padding: "8px 10px" }}>{b.unidade}</td>
                  <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {b.documento ?? "—"}
                  </td>
                  <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {b.contato ?? <span style={{ color: T.danger }}>sem telefone</span>}
                  </td>
                  <td style={numero}>{moeda(b.valor)}</td>
                  <td style={celulaFraca}>{dia(b.vencimento)}</td>
                  <td style={celulaFraca}>{dia(b.pagamento)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <Selo boleto={b} />
                  </td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                    {b.whatsappEnviadoEm ? (
                      <span style={{ color: T.ok, fontSize: 12.5 }}>
                        <Check size={11} style={{ verticalAlign: "middle" }} />{" "}
                        {dia(b.whatsappEnviadoEm)}
                      </span>
                    ) : b.whatsappErro ? (
                      <span style={{ color: T.danger, fontSize: 12.5 }}>falhou</span>
                    ) : (
                      <span style={{ color: T.sub, fontSize: 12.5 }}>não enviado</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 10px" }} onClick={(e) => e.stopPropagation()}>
                    {b.link ? (
                      <a
                        href={b.link}
                        rel="noreferrer"
                        style={{
                          alignItems: "center",
                          color: T.gold,
                          display: "inline-flex",
                          gap: 4,
                          textDecoration: "none",
                        }}
                        target="_blank"
                      >
                        Abrir <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span style={{ color: T.sub }}>—</span>
                    )}
                  </td>
                </tr>

                {estaAberta ? (
                  <tr>
                    <td colSpan={colunas} style={{ padding: 0 }}>
                      <PainelDoBoleto
                        acaoNaUnidade={acaoNaUnidade}
                        boleto={b}
                        carregando={carregandoHistorico}
                        historico={historico}
                        ocupado={ocupado === chave}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── O PAINEL DE UM BOLETO ───────────────────────────────────────────────────

/** `2026-09-01T14:32:10Z` → `01/09 14:32`. Sem `new Date`, para não escorregar de fuso. */
function quandoCurto(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  // O horário vem em UTC; a Careli opera em UTC−3.
  const utc = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
  const local = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${mi}`;
}

const ROTULO_DO_EVENTO: Record<string, string> = {
  cancelamento: "Cancelado",
  emissao: "Boleto gerado",
  envio: "Link enviado",
};

/**
 * O que aconteceu com este boleto, e o que dá para consertar.
 *
 * ⚠️ ABRE ABAIXO DA LINHA, e não numa janela por cima. Pedido do Lucas (01/09/2026): *"ao clicar na
 * linha que abrisse um modal abaixo"*. A tabela continua à vista, e comparar duas linhas não exige
 * fechar nada.
 */
function PainelDoBoleto({
  acaoNaUnidade,
  boleto,
  carregando,
  historico,
  ocupado,
}: {
  acaoNaUnidade: (
    empreendimento: string,
    unidade: string,
    corpo: Record<string, unknown>,
  ) => Promise<boolean>;
  boleto: BoletoEmitido;
  carregando: boolean;
  historico: null | Historico;
  ocupado: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [telefone, setTelefone] = useState(boleto.contato ?? "");
  const [valor, setValor] = useState(valorParaOCampo(boleto.valor));
  const [vencimento, setVencimento] = useState(boleto.vencimento);
  const [confirmandoCancelar, setConfirmandoCancelar] = useState(false);
  const [erroLocal, setErroLocal] = useState<null | string>(null);

  const salvar = async () => {
    setErroLocal(null);
    const edicao: Record<string, unknown> = {};
    if (telefone.trim() !== (boleto.contato ?? "")) edicao.telefone = telefone.trim();
    // ⚠️ LIDO COMO BRASILEIRO. `Number("1.850".replace(",", "."))` devolve 1.85, e a edição não
    // falhava: o boleto saía com um real e oitenta e cinco. Ver `valor-digitado.ts`.
    const novoValor = valorDigitado(valor);
    if (valor.trim() && novoValor === null) {
      setErroLocal("Não entendi o valor. Escreva como 2.102,58.");
      return;
    }
    if (novoValor !== null && novoValor !== boleto.valor) edicao.valor = novoValor;
    if (vencimento && vencimento !== boleto.vencimento) edicao.vencimento = vencimento;

    if (Object.keys(edicao).length === 0) {
      setEditando(false);
      return;
    }
    const ok = await acaoNaUnidade(boleto.empreendimento, boleto.unidade, { acao: "editar", edicao });
    if (ok) setEditando(false);
  };

  return (
    <div
      style={{
        background: T.soft,
        borderBottom: `1px solid ${T.border}`,
        display: "grid",
        gap: 14,
        padding: "16px 20px",
      }}
    >
      {/* ⚠️ O ERRO DE LEITURA DO VALOR APARECE AQUI, e a edição não segue. Antes, texto que não
          virava número era descartado por um `Number.isFinite` e o editor fechava como se tivesse
          salvado — o operador saía achando que mudou o valor. */}
      {erroLocal ? (
        <p style={{ color: T.danger, fontSize: 13, margin: 0 }}>{erroLocal}</p>
      ) : null}

      {/* ── O que aconteceu ─────────────────────────────────────────────── */}
      <div>
        <div
          style={{
            color: T.sub,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.04em",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Histórico
        </div>

        {carregando ? (
          <p style={{ color: T.sub, fontSize: 13.5, margin: 0 }}>
            <Loader2 className="inc-girando" size={14} style={{ verticalAlign: "middle" }} />{" "}
            Carregando…
          </p>
        ) : !historico || historico.eventos.length === 0 ? (
          <p style={{ color: T.sub, fontSize: 13.5, margin: 0 }}>
            Sem histórico registrado. Boletos gerados antes desta tela não têm eventos guardados.
          </p>
        ) : (
          <ul style={{ display: "grid", gap: 7, listStyle: "none", margin: 0, padding: 0 }}>
            {historico.eventos.map((e, i) => (
              <li
                key={`${e.quando}-${i}`}
                style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 8 }}
              >
                <span
                  style={{
                    color: T.sub,
                    fontSize: 12.5,
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 74,
                  }}
                >
                  {quandoCurto(e.quando)}
                </span>

                <span
                  style={{
                    background: e.ok ? T.okBg : T.dangerBg,
                    borderRadius: 999,
                    color: e.ok ? T.ok : T.danger,
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "2px 9px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ROTULO_DO_EVENTO[e.tipo] ?? e.tipo}
                  {e.ok ? "" : " (falhou)"}
                </span>

                <span style={{ color: T.text, fontSize: 13 }}>
                  {e.tipo === "envio" && e.telefone ? (
                    <>
                      para {e.telefone}
                      {e.canal ? ` · ${e.canal === "relacionamento" ? "Relacionamento" : "Atendimento"}` : ""}
                      {/* ⚠️ "sem confirmação" NÃO É "não entregue". O webhook pode não ter chegado, e
                          o Relacionamento não passa pela Meta, então nunca terá status. As duas
                          coisas levam a ações opostas. */}
                      {e.ok ? (
                        <span style={{ color: e.entrega ? T.ok : T.sub }}>
                          {" · "}
                          {e.entrega ? e.entrega.status : "sem confirmação de entrega"}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {e.detalhe ? <span style={{ color: T.danger }}>{e.detalhe}</span> : null}
                  {e.autor ? (
                    <span style={{ color: T.sub }}> · por {e.autor}</span>
                  ) : e.tipo === "envio" ? (
                    <span style={{ color: T.sub }}> · automático</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── O que dá para fazer ─────────────────────────────────────────── */}
      {editando ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <Campo
              onChange={setTelefone}
              rotulo="Telefone"
              valor={telefone}
            />
            <Campo onChange={setValor} rotulo="Valor (R$)" valor={valor} />
            <Campo onChange={setVencimento} rotulo="Vencimento" tipo="date" valor={vencimento} />
          </div>

          {/* ⚠️ MUDAR VALOR OU VENCIMENTO GERA BOLETO NOVO no Asaas: a linha digitável antiga morre.
              Quem já recebeu o link precisa receber de novo. */}
          <p style={{ color: T.sub, fontSize: 12.5, margin: 0 }}>
            Mudar valor ou vencimento gera um boleto novo no Asaas, e a linha digitável antiga deixa
            de valer. Reenvie o link depois de salvar.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              disabled={ocupado}
              onClick={() => void salvar()}
              style={botao(T.btnBg, T.btnFg, ocupado)}
              type="button"
            >
              {ocupado ? <Loader2 className="inc-girando" size={14} /> : <Check size={14} />}
              Salvar
            </button>
            <button
              onClick={() => setEditando(false)}
              style={botao("transparent", T.sub, false, T.border)}
              type="button"
            >
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            disabled={ocupado}
            onClick={() =>
              void acaoNaUnidade(boleto.empreendimento, boleto.unidade, {
                acao: "enviar",
                canal: "relacionamento",
                confirmar: true,
              })
            }
            style={botao(T.btnBg, T.btnFg, ocupado)}
            type="button"
          >
            {ocupado ? <Loader2 className="inc-girando" size={14} /> : <Send size={14} />}
            {boleto.whatsappEnviadoEm ? "Reenviar link" : "Enviar link"}
          </button>

          <button
            disabled={ocupado}
            onClick={() => setEditando(true)}
            style={botao("transparent", T.text, ocupado, T.border)}
            type="button"
          >
            <Pencil size={14} /> Editar
          </button>

          {/* ⚠️ CANCELAR PEDE CONFIRMAÇÃO NO PRÓPRIO BOTÃO. O boleto pode estar no aplicativo do
              banco do cliente ou agendado: cancelar impede o pagamento e exige avisar a pessoa. */}
          {confirmandoCancelar ? (
            <>
              <button
                disabled={ocupado}
                onClick={() =>
                  void acaoNaUnidade(boleto.empreendimento, boleto.unidade, {
                    acao: "cancelar",
                  }).then(() => setConfirmandoCancelar(false))
                }
                style={botao(T.danger, "#fff", ocupado)}
                type="button"
              >
                {ocupado ? <Loader2 className="inc-girando" size={14} /> : <Ban size={14} />}
                Confirmar cancelamento
              </button>
              <button
                onClick={() => setConfirmandoCancelar(false)}
                style={botao("transparent", T.sub, false, T.border)}
                type="button"
              >
                Não
              </button>
            </>
          ) : (
            <button
              disabled={ocupado || Boolean(boleto.pagamento)}
              onClick={() => setConfirmandoCancelar(true)}
              style={botao("transparent", T.danger, ocupado || Boolean(boleto.pagamento), T.danger)}
              title={boleto.pagamento ? "Boleto pago não pode ser cancelado" : undefined}
              type="button"
            >
              <Ban size={14} /> Cancelar boleto
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Campo({
  onChange,
  rotulo,
  tipo = "text",
  valor,
}: {
  onChange: (v: string) => void;
  rotulo: string;
  tipo?: string;
  valor: string;
}) {
  return (
    <label style={{ display: "grid", gap: 3 }}>
      <span
        style={{
          color: T.sub,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </span>
      <input
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          // ⚠️ 16px não é estética: abaixo disso o Safari do iOS dá zoom ao focar e a tela "pula".
          fontSize: 16,
          padding: "7px 10px",
          width: 170,
        }}
        type={tipo}
        value={valor}
      />
    </label>
  );
}

function botao(
  fundo: string,
  cor: string,
  desabilitado: boolean,
  borda?: string,
): React.CSSProperties {
  return {
    alignItems: "center",
    background: fundo,
    border: borda ? `1px solid ${borda}` : "none",
    borderRadius: 8,
    color: cor,
    cursor: desabilitado ? "default" : "pointer",
    display: "inline-flex",
    fontSize: 13.5,
    fontWeight: 600,
    gap: 6,
    opacity: desabilitado ? 0.5 : 1,
    padding: "7px 14px",
  };
}

// ── O ENVIO DO LINK POR WHATSAPP ────────────────────────────────────────────

/**
 * A prévia do que cada cliente receberia, e os dois botões que mandam.
 *
 * ⚠️ O TEXTO INTEIRO FICA À VISTA. Mensagem enviada não volta, e o cliente lê o que chegou: ver o
 * corpo montado com os dados reais é a única chance de pegar um nome trocado ou um valor fora de
 * lugar enquanto isso ainda custa zero.
 */
function PainelDeEnvio({
  aoCancelar,
  aoEnviar,
  enviando,
  previas,
}: {
  aoCancelar: () => void;
  aoEnviar: (canal: "relacionamento" | "template") => void;
  enviando: boolean;
  previas: Previa[];
}) {
  const prontos = previas.filter((p) => !p.impedimento);
  const travados = previas.filter((p) => p.impedimento);
  const exemplo = prontos[0]?.texto ?? null;

  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.gold}`,
        borderRadius: 12,
        display: "grid",
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <MessageCircle size={18} style={{ color: T.gold }} />
        <strong style={{ color: T.text, fontSize: 15 }}>
          {prontos.length} cliente(s) vão receber o link
        </strong>
        <button
          onClick={aoCancelar}
          style={{
            background: "transparent",
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.sub,
            cursor: "pointer",
            fontSize: 13,
            marginLeft: "auto",
            padding: "6px 12px",
          }}
          type="button"
        >
          Cancelar
        </button>
      </div>

      {exemplo ? (
        <div>
          <div
            style={{
              color: T.sub,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.04em",
              marginBottom: 5,
              textTransform: "uppercase",
            }}
          >
            A mensagem que vai sair
          </div>
          <pre
            style={{
              background: T.soft,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              color: T.text,
              fontFamily: "inherit",
              fontSize: 13.5,
              lineHeight: 1.55,
              margin: 0,
              overflowX: "auto",
              padding: "12px 14px",
              whiteSpace: "pre-wrap",
            }}
          >
            {exemplo}
          </pre>
        </div>
      ) : null}

      {prontos.length > 1 ? (
        <p style={{ color: T.sub, fontSize: 13, margin: 0 }}>
          Os outros {prontos.length - 1} recebem a mesma mensagem, com os dados de cada um:{" "}
          {prontos.slice(1, 6).map((p) => `${p.nome} (${p.unidade})`).join(", ")}
          {prontos.length > 6 ? ` e mais ${prontos.length - 6}` : ""}.
        </p>
      ) : null}

      {travados.length > 0 ? (
        <Aviso tom="alerta">
          {travados.length} não recebem:{" "}
          {travados.map((p) => `${p.nome} (${p.unidade}) — ${p.impedimento}`).join("; ")}
        </Aviso>
      ) : null}

      {prontos.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {/* ⚠️ DOIS CANAIS, E O PADRÃO É O ATENDIMENTO. O Relacionamento fala sem template porque
              não passa pela Meta, e é por isso que serve para testar antes de a aprovação sair. A
              regra da casa é que cliente recebe pelo Atendimento. */}
          <button
            disabled={enviando}
            onClick={() => aoEnviar("template")}
            style={{
              alignItems: "center",
              background: T.btnBg,
              border: "none",
              borderRadius: 8,
              color: T.btnFg,
              cursor: enviando ? "default" : "pointer",
              display: "inline-flex",
              fontSize: 14,
              fontWeight: 600,
              gap: 6,
              padding: "9px 16px",
            }}
            type="button"
          >
            {enviando ? <Loader2 className="inc-girando" size={15} /> : <MessageCircle size={15} />}
            Enviar pelo Atendimento
          </button>

          <button
            disabled={enviando}
            onClick={() => aoEnviar("relacionamento")}
            style={{
              alignItems: "center",
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.text,
              cursor: enviando ? "default" : "pointer",
              display: "inline-flex",
              fontSize: 14,
              gap: 6,
              padding: "9px 16px",
            }}
            type="button"
          >
            Enviar pelo Relacionamento
          </button>

          <span style={{ alignSelf: "center", color: T.sub, fontSize: 12.5 }}>
            O Relacionamento dispensa template aprovado. Use enquanto a Meta não libera.
          </span>
        </div>
      ) : null}
    </section>
  );
}

function ResultadoDoEnvio({ envio }: { envio: Envio }) {
  const canal = envio.canal === "relacionamento" ? "Relacionamento" : "Atendimento";

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Aviso tom={envio.falhas > 0 ? "alerta" : "ok"}>
        {envio.enviados} mensagem(ns) enviada(s) pelo {canal}
        {envio.falhas > 0 ? ` · ${envio.falhas} não saiu(íram)` : ""}
      </Aviso>

      {envio.envios
        .filter((e) => e.erro)
        .map((e) => (
          <Aviso key={e.unidade} tom="erro">
            {e.nome} ({e.unidade}): {e.erro}
          </Aviso>
        ))}
    </div>
  );
}

// ── QUEM NÃO RECEBE, E POR QUÊ ──────────────────────────────────────────────

function ForaDaEmissao({
  acaoNaUnidade,
  mostrarPredio,
  ocupado,
  parcelas,
}: {
  acaoNaUnidade: (e: string, u: string, corpo: Record<string, unknown>) => Promise<boolean>;
  mostrarPredio: boolean;
  ocupado: null | string;
  parcelas: ParcelaAEmitir[];
}) {
  const semCpf = parcelas.filter((p) => !p.documento).length;

  return (
    // ⚠️ UMA LISTA QUE SÓ MOSTRA QUEM EMITE ESCONDE O CLIENTE ESQUECIDO, e o esquecido só reclama no
    // mês seguinte. Fica recolhido para não competir com o que precisa de ação, mas fica.
    //
    // ⚠️ E AQUI SE CONSERTA, NÃO SÓ SE LÊ. Era uma lista de texto: dizia "sem CPF/CNPJ cadastrado"
    // e não dava o que fazer a respeito, então a correção exigia planilha nova e recarga. Agora as
    // mesmas células editáveis da tabela de cima estão aqui, que é onde o problema aparece.
    <details
      open={semCpf > 0}
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "12px 16px",
      }}
    >
      <summary style={{ color: T.sub, cursor: "pointer", fontSize: 13.5 }}>
        {parcelas.length} precisa(m) de correção — não saem neste mês
        {semCpf > 0 ? ` · ${semCpf} só falta(m) o CPF/CNPJ, dá para preencher aqui` : ""}
      </summary>

      <div style={{ marginTop: 10, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 640, width: "100%" }}>
          <thead>
            <tr style={{ color: T.sub, textAlign: "left" }}>
              <th style={cabecalho}>Cliente</th>
              {mostrarPredio ? <th style={cabecalho}>Prédio</th> : null}
              <th style={cabecalho}>Unidade</th>
              <th style={cabecalho}>CPF/CNPJ</th>
              <th style={{ ...cabecalho, textAlign: "right" }}>Valor</th>
              <th style={cabecalho}>Vence dia</th>
              <th style={cabecalho}>O que falta</th>
            </tr>
          </thead>
          <tbody>
            {parcelas.map((p) => (
              <tr
                key={`${p.empreendimento}|${p.unidade}`}
                style={{ borderTop: `1px solid ${T.border}` }}
              >
                <td style={{ color: T.text, padding: "7px 8px" }}>{p.nome}</td>
                {mostrarPredio ? (
                  <td style={{ color: T.sub, padding: "7px 8px", whiteSpace: "nowrap" }}>
                    {p.empreendimento}
                  </td>
                ) : null}
                <td style={{ color: T.sub, padding: "7px 8px" }}>{p.unidade}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                  <CelulaEditavel
                    ajuda={`CPF ou CNPJ de ${p.nome}`}
                    aoSalvar={(novo) =>
                      acaoNaUnidade(p.empreendimento, p.unidade, {
                        acao: "cadastro",
                        documento: novo,
                      })
                    }
                    invalido={Boolean(p.documento) && !p.documentoValido}
                    largura={150}
                    ocupado={ocupado === `${p.empreendimento}|${p.unidade}`}
                    placeholder="sem CPF"
                    valor={documentoLegivel(p.documento)}
                  />
                </td>
                <td style={numero}>{p.valor === null ? "—" : moeda(p.valor)}</td>
                <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>
                  <CelulaEditavel
                    ajuda="Dia do vencimento (1 a 31)"
                    aoSalvar={(novo) =>
                      acaoNaUnidade(p.empreendimento, p.unidade, {
                        acao: "cadastro",
                        vencimentoDia: Number(novo.replace(/\D/g, "")),
                      })
                    }
                    largura={46}
                    ocupado={ocupado === `${p.empreendimento}|${p.unidade}`}
                    placeholder="dia"
                    valor={p.vencimentoDia ? String(p.vencimentoDia) : ""}
                  />
                </td>
                <td style={{ maxWidth: 300, padding: "7px 8px" }}>
                  <Situacao pendencia={p.pendencia ?? p.bloqueio} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ── RESULTADO ───────────────────────────────────────────────────────────────

function ResultadoDaEmissao({ emissao }: { emissao: Emissao }) {
  const comLink = emissao.resultados.filter((r) => r.link);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Aviso tom={emissao.falhas > 0 ? "alerta" : "ok"}>
        {emissao.emitidos} boleto(s) emitido(s) em {emissao.empreendimento}, na conta {emissao.conta}
        {emissao.repetidos > 0 ? ` · ${emissao.repetidos} já existia(m)` : ""}
        {emissao.falhas > 0 ? ` · ${emissao.falhas} falhou(ram)` : ""}
      </Aviso>

      {emissao.resultados
        .filter((r) => r.erro)
        .map((r) => (
          <Aviso key={r.unidade} tom="erro">
            {r.nome} ({r.unidade}): {r.erro}
          </Aviso>
        ))}

      {comLink.length > 0 ? (
        <div
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            display: "grid",
            gap: 5,
            padding: "10px 12px",
          }}
        >
          {comLink.map((r) => (
            <a
              href={r.link!}
              key={r.unidade}
              rel="noreferrer"
              style={{
                alignItems: "center",
                color: T.gold,
                display: "inline-flex",
                fontSize: 13.5,
                gap: 5,
                textDecoration: "none",
              }}
              target="_blank"
            >
              {r.nome} ({r.unidade}) · {moeda(r.valor)} <ExternalLink size={12} />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── ABAS ────────────────────────────────────────────────────────────────────

function Abas({
  aba,
  carteiras,
  contagem,
  onAba,
  totalEmitidos,
  totalPendentes,
}: {
  aba: string;
  carteiras: Carteira[];
  contagem: Map<string, { emitidos: number; pendentes: number }>;
  onAba: (a: string) => void;
  totalEmitidos: number;
  totalPendentes: number;
}) {
  const reais = carteiras.filter((c) => !c.slug.startsWith("teste"));
  const temTeste = carteiras.some((c) => c.slug.startsWith("teste"));

  const itens = [
    { chave: "consolidado", emitidos: totalEmitidos, pendentes: totalPendentes, rotulo: "Consolidado" },
    ...reais.map((c) => ({
      chave: c.slug,
      emitidos: contagem.get(c.slug)?.emitidos ?? 0,
      pendentes: contagem.get(c.slug)?.pendentes ?? 0,
      rotulo: c.nome,
    })),
    // A aba de teste vai por último: é a que sai quando os testes servirem.
    ...(temTeste
      ? [
          {
            chave: ABA_TESTE,
            emitidos: contagem.get(ABA_TESTE)?.emitidos ?? 0,
            pendentes: contagem.get(ABA_TESTE)?.pendentes ?? 0,
            rotulo: "Teste",
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {itens.map((i) => {
        const ativa = aba === i.chave;
        return (
          <button
            key={i.chave}
            onClick={() => onAba(i.chave)}
            style={{
              alignItems: "center",
              background: ativa ? T.soft : "transparent",
              border: `1px solid ${ativa ? T.gold : T.border}`,
              borderRadius: 999,
              color: ativa ? T.text : T.sub,
              cursor: "pointer",
              display: "inline-flex",
              fontSize: 13,
              fontWeight: ativa ? 600 : 500,
              gap: 6,
              padding: "6px 14px",
            }}
            type="button"
          >
            {i.rotulo}
            {/* O número que pede ação vem primeiro e em destaque; o já resolvido fica discreto. */}
            {i.pendentes > 0 ? (
              <span
                style={{
                  background: T.gold,
                  borderRadius: 999,
                  color: T.btnFg,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "1px 7px",
                }}
              >
                {i.pendentes}
              </span>
            ) : null}
            {i.emitidos > 0 ? (
              <span style={{ color: T.sub, fontSize: 12, fontWeight: 500 }}>
                {i.emitidos} emitido{i.emitidos > 1 ? "s" : ""}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const cabecalho: React.CSSProperties = {
  borderBottom: `1px solid ${T.border}`,
  fontWeight: 600,
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

const numero: React.CSSProperties = {
  color: T.text,
  fontVariantNumeric: "tabular-nums",
  padding: "8px 10px",
  textAlign: "right",
  whiteSpace: "nowrap",
};

const celulaFraca: React.CSSProperties = {
  color: T.sub,
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

/**
 * O estado do boleto em uma palavra.
 *
 * ⚠️ PAGO VENCE VENCIDO. Quem pagou com atraso tem data de pagamento E venceu; mostrar "vencido"
 * para quem já quitou é o tipo de erro que gera ligação de cliente.
 */
function Selo({ boleto }: { boleto: BoletoEmitido }) {
  const [fundo, cor, texto] = boleto.pagamento
    ? [T.okBg, T.ok, "Pago"]
    : boleto.vencido
      ? [T.dangerBg, T.danger, "Vencido"]
      : [T.soft, T.sub, "Em aberto"];

  return (
    <span
      style={{
        background: fundo,
        borderRadius: 999,
        color: cor,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}

function Cartao({
  nota,
  rotulo,
  tom,
  valor,
}: {
  nota?: string;
  rotulo: string;
  tom?: "alerta" | "destaque";
  valor: string;
}) {
  const cor = tom === "alerta" ? T.danger : tom === "destaque" ? T.gold : T.border;

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${cor}`,
        borderRadius: 10,
        flex: "1 1 150px",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          color: T.sub,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {valor}
      </div>
      {nota ? <div style={{ color: T.sub, fontSize: 12, marginTop: 1 }}>{nota}</div> : null}
    </div>
  );
}

function Aviso({ children, tom }: { children: React.ReactNode; tom: "alerta" | "erro" | "ok" }) {
  const cor = tom === "ok" ? T.ok : T.danger;
  const fundo = tom === "ok" ? T.okBg : T.dangerBg;

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: fundo,
        border: `1px solid ${cor}`,
        borderRadius: 10,
        color: T.text,
        display: "flex",
        fontSize: 13.5,
        gap: 8,
        padding: "10px 12px",
      }}
    >
      {tom === "ok" ? (
        <Check size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      ) : (
        <AlertTriangle size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      )}
      <span>{children}</span>
    </div>
  );
}
