"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import { dataBr, hojeEmBrasilia } from "@/lib/apolo/extrato-cliente";
import {
  descreverConferencia,
  FRASE_DO_FORMATO_DO_VALOR,
  LIMITE_DA_OBSERVACAO_DA_CONFERENCIA,
  lerValorEmReaisBr,
  type ResultadoDaConferencia,
} from "@/lib/apolo/valor-em-reais-br";

import { getApoloAccessToken } from "../../data/apolo-operations";

// A CONFERÊNCIA DA CORRETAGEM ZERO, NO EXTRATO DO CLIENTE — registrar, ver e corrigir.
//
// Lucas (30/09/2026): quando o contrato de corretagem registra R$ 0,00, a Simulação de Rescisão
// recusa e a COORDENAÇÃO (admin e líder) confere o contrato assinado. Este componente é o formulário
// dessa conferência; quem decide se ele aparece para o usuário é o painel (`extrato-cliente-panel`),
// e a rota `conferencia-corretagem` repete o portão (defesa em profundidade).
//
// ⚠️ É UM COMPONENTE À PARTE PORQUE O ESTADO É DE UM CONTRATO SÓ, e o painel o monta com
// `key={contrato.id}`: trocar de contrato no seletor DESMONTA o formulário, e com ele somem o
// formulário aberto, a confirmação, o erro e o histórico (01/10/2026, achado da revisão da
// Publicação: a mensagem de sucesso e o erro do contrato anterior ficavam presos na tela do
// seguinte). Nada de efeito para "limpar ao trocar": a chave resolve por construção.
//
// ⚠️ CONFIRMAR ANTES DE ENVIAR, SEM `window.confirm`. O valor digitado é lido pela MESMA função que a
// rota usa (`lerValorEmReaisBr`) e escrito por extenso ("sete mil reais") para a coordenação
// conferir o número com os olhos antes de gravá-lo num papel que vai ao cliente. Valor ilegível
// nem chega ao envio: a frase do formato aparece aqui mesmo.
//
// ⚠️ GRAVAR É SEMPRE UM REGISTRO NOVO (histórico, migration 0202). "Corrigir" não edita o antigo: o
// formulário abre preenchido com o atual, e o Salvar cria outro registro que passa a valer. O
// histórico recente aparece abaixo, para a coordenação ver quem registrou o quê e quando.

type Registro = {
  conferido_em: null | string;
  conferido_por_nome: null | string;
  observacao: null | string;
  resultado: null | string;
  valor: null | number;
};

type Props = {
  c2xId: number;
  /** Qual conferência o último PDF usou, ou nulo. Com isso aparece o "Ver ou corrigir". */
  conferenciaUsada: null | ResultadoDaConferencia;
  contratoId: number;
  /** Chamado depois de gravar, com a mensagem de sucesso que o painel mostra. */
  onSalva: (mensagem: string) => void;
  /** A rota do PDF acabou de recusar com `motivo: "corretagem_zero"`: o formulário abre sozinho. */
  recusado: boolean;
};

function resultadoConhecido(valor: null | string): null | ResultadoDaConferencia {
  return valor === "sem_corretagem" || valor === "com_corretagem" ? valor : null;
}

/** "7000.5" → "7.000,50": o texto que o próprio parser estrito lê de volta. */
function valorParaOCampo(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function linhaDoHistorico(registro: Registro): string {
  const quando = registro.conferido_em ? dataBr(hojeEmBrasilia(new Date(registro.conferido_em))) : "-";
  const quem = registro.conferido_por_nome?.trim() || "sem nome";
  const resultado = resultadoConhecido(registro.resultado);
  const oQue = resultado ? descreverConferencia(resultado, registro.valor) : "resultado desconhecido";
  return `${quando} · ${quem} · ${oQue}`;
}

export function ConferenciaDaCorretagem({
  c2xId,
  conferenciaUsada,
  contratoId,
  onSalva,
  recusado,
}: Props) {
  const [verCorrigir, setVerCorrigir] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [historico, setHistorico] = useState<Registro[]>([]);
  const [resultado, setResultado] = useState<"" | ResultadoDaConferencia>("");
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);

  const aberto = recusado || verCorrigir;

  const abrirParaCorrigir = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    try {
      const token = await getApoloAccessToken();
      const query = new URLSearchParams({ c2xId: String(c2xId), contrato: String(contratoId) });
      const response = await fetch(`/api/apolo/rescisao/conferencia-corretagem?${query.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { atual?: Registro | null; historico?: Registro[] };
        error?: string;
      } | null;

      if (!response.ok) {
        setErro(payload?.error ?? "Não foi possível ler a conferência da corretagem.");
        return;
      }

      const atual = payload?.data?.atual ?? null;
      setHistorico(payload?.data?.historico ?? []);
      // O formulário abre PREENCHIDO com o registro que vale hoje.
      setResultado(resultadoConhecido(atual?.resultado ?? null) ?? "");
      setValor(atual?.valor != null ? valorParaOCampo(atual.valor) : "");
      setObservacao(atual?.observacao ?? "");
      setConfirmando(false);
      setVerCorrigir(true);
    } catch {
      setErro("Não foi possível ler a conferência da corretagem.");
    } finally {
      setCarregando(false);
    }
  }, [c2xId, contratoId]);

  const preparar = useCallback(() => {
    setErro(null);
    if (!resultado) return;

    // ⚠️ A MESMA LEITURA DA ROTA: o que não é legível não chega ao envio.
    if (resultado === "com_corretagem" && lerValorEmReaisBr(valor) === null) {
      setErro(FRASE_DO_FORMATO_DO_VALOR);
      return;
    }
    setConfirmando(true);
  }, [resultado, valor]);

  const enviar = useCallback(async () => {
    if (!resultado) return;
    const valorLido = resultado === "com_corretagem" ? lerValorEmReaisBr(valor) : null;
    if (resultado === "com_corretagem" && valorLido === null) {
      setConfirmando(false);
      setErro(FRASE_DO_FORMATO_DO_VALOR);
      return;
    }

    setSalvando(true);
    setErro(null);

    try {
      const token = await getApoloAccessToken();
      const response = await fetch("/api/apolo/rescisao/conferencia-corretagem", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PUT",
        // O que vai é o NÚMERO já lido, e não o texto digitado: a confirmação e a gravação não
        // podem divergir por uma segunda interpretação.
        body: JSON.stringify({
          c2xId,
          contrato: contratoId,
          observacao,
          resultado,
          ...(valorLido !== null ? { valor: valorLido } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        data?: { resultado?: string; valor?: null | number };
        error?: string;
      } | null;

      if (!response.ok) {
        setConfirmando(false);
        setErro(payload?.error ?? "Não foi possível registrar a conferência.");
        return;
      }

      // ⚠️ A MENSAGEM USA O QUE A ROTA DEVOLVEU (`data.valor`), e não o que a tela digitou: é a prova
      // do que ficou gravado.
      const gravado = resultadoConhecido(payload?.data?.resultado ?? null);
      const mensagem = gravado
        ? `Conferência registrada: ${descreverConferencia(gravado, payload?.data?.valor ?? null)}. Clique em Rescisão para gerar a simulação.`
        : "Conferência registrada. Clique em Rescisão para gerar a simulação.";

      setConfirmando(false);
      setVerCorrigir(false);
      setResultado("");
      setValor("");
      setObservacao("");
      setHistorico([]);
      onSalva(mensagem);
    } catch {
      setConfirmando(false);
      setErro("Não foi possível registrar a conferência.");
    } finally {
      setSalvando(false);
    }
  }, [c2xId, contratoId, observacao, onSalva, resultado, valor]);

  if (!aberto) {
    if (!conferenciaUsada) return null;

    return (
      <div className="mt-3 flex flex-col gap-1">
        <p className="m-0 flex flex-wrap items-center gap-1.5 text-xs font-medium text-ink-muted">
          Corretagem conferida no contrato assinado.
          <button
            className="inline-flex items-center gap-1 rounded text-xs font-semibold text-[#8A6A2F] underline outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
            disabled={carregando}
            onClick={() => void abrirParaCorrigir()}
            type="button"
          >
            {carregando ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}
            Ver ou corrigir
          </button>
        </p>
        {erro ? (
          <p className="m-0 text-xs font-semibold text-rose-600 dark:text-rose-300">{erro}</p>
        ) : null}
      </div>
    );
  }

  const travado = salvando || confirmando;
  const valorLido = resultado === "com_corretagem" ? lerValorEmReaisBr(valor) : null;

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line bg-subtle p-3">
      <p className="m-0 text-xs font-semibold text-ink-soft">Registrar conferência da corretagem</p>
      <div className="flex flex-col gap-2 text-sm text-ink">
        <label className="inline-flex items-center gap-2">
          <input
            checked={resultado === "sem_corretagem"}
            disabled={travado}
            name={`resultado-da-conferencia-${contratoId}`}
            onChange={() => setResultado("sem_corretagem")}
            type="radio"
          />
          Não houve corretagem
        </label>
        <label className="inline-flex flex-wrap items-center gap-2">
          <input
            checked={resultado === "com_corretagem"}
            disabled={travado}
            name={`resultado-da-conferencia-${contratoId}`}
            onChange={() => setResultado("com_corretagem")}
            type="radio"
          />
          Houve corretagem de R$
          <input
            aria-label="Valor da corretagem em reais"
            className="h-9 w-32 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
            disabled={travado || resultado !== "com_corretagem"}
            inputMode="decimal"
            onChange={(event) => setValor(event.target.value)}
            placeholder="7.000,00"
            value={valor}
          />
        </label>
      </div>
      <div className="flex flex-col gap-1">
        <textarea
          aria-label="Observação da conferência"
          className="min-h-[64px] w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
          disabled={travado}
          maxLength={LIMITE_DA_OBSERVACAO_DA_CONFERENCIA}
          onChange={(event) => setObservacao(event.target.value)}
          placeholder="O que você viu no contrato assinado (obrigatório)"
          value={observacao}
        />
        <span className="self-end text-[11px] font-medium text-ink-muted">
          {observacao.length}/{LIMITE_DA_OBSERVACAO_DA_CONFERENCIA}
        </span>
      </div>
      {erro ? (
        <p className="m-0 text-xs font-semibold text-rose-600 dark:text-rose-300">{erro}</p>
      ) : null}

      {confirmando && resultado ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
          <p className="m-0 flex-1 text-sm font-semibold text-ink">
            Confirmar: {descreverConferencia(resultado, valorLido)}
          </p>
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-soft outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={salvando}
            onClick={() => void enviar()}
            type="button"
          >
            {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Confirmar
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
            disabled={salvando}
            onClick={() => setConfirmando(false)}
            type="button"
          >
            Voltar
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-soft outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              !resultado ||
              !observacao.trim() ||
              (resultado === "com_corretagem" && !valor.trim())
            }
            onClick={preparar}
            type="button"
          >
            Salvar
          </button>
          {verCorrigir && !recusado ? (
            <button
              className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-ink-muted outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onClick={() => setVerCorrigir(false)}
              type="button"
            >
              Fechar
            </button>
          ) : null}
        </div>
      )}

      {verCorrigir && historico.length ? (
        <div className="flex flex-col gap-1">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Histórico (o primeiro é o que vale)
          </p>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs text-ink-muted">
            {historico.map((registro, indice) => (
              <li key={`${registro.conferido_em ?? "sem-data"}-${indice}`}>{linhaDoHistorico(registro)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
