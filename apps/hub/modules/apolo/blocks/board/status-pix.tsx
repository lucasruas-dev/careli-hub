"use client";

import {
  AlertTriangle,
  Check,
  CheckCheck,
  Copy,
  Download,
  Loader2,
  Mail,
  QrCode,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// PRÉ-VENDA — o que aconteceu com o PIX desta ficha: gerou, enviou, recebeu.
//
// Antes esta etapa mostrava só o texto da regra. Para saber se a cobrança saiu, para qual número
// foi e se o cliente pagou, era preciso abrir o Asaas ou consultar o banco. Aqui as três coisas
// aparecem juntas, na ordem em que acontecem — e os ERROS aparecem em vermelho, que é o que
// interessa quando um disparo falha no meio de um lote.

type Envio = {
  canal: "email" | "whatsapp";
  destinatario: string | null;
  entregueEm: string | null;
  erro: string | null;
  lidoEm: string | null;
  quando: string;
  status: string | null;
  template: string | null;
  tipo: string | null;
};

type StatusPix = {
  cobranca: { criadoEm: string | null; paymentId: string; valor: number } | null;
  envios: Envio[];
  pagamento: { quando: string; valor: number } | null;
  // O PIX na mão do operador, para reenviar por fora quando o cliente pede no atendimento.
  // Só vem enquanto não está pago.
  pix: {
    copiaECola: string | null;
    link: string | null;
    qrBase64: string | null;
    vencimento: string | null;
  } | null;
};

function hora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

// Erro do provedor -> frase que diz O QUE FAZER. "Message undeliverable" não ajuda ninguém a
// tratar 450 disparos; "o número não tem WhatsApp" ajuda. A mensagem técnica original continua no
// tooltip, pra investigar quando o caso fugir da lista.
//
// Cada entrada casa por trecho (a Meta muda o texto e o código com frequência, então procuramos
// pelo que é estável) e responde a pergunta do operador: é problema do cliente ou nosso?
const TRADUCOES: ReadonlyArray<{ para: string; quando: RegExp }> = [
  // --- Problema no contato do cliente (ação: corrigir o cadastro) ---
  { para: "O número não tem WhatsApp", quando: /message undeliverable|131026/i },
  { para: "Número de telefone inválido", quando: /131009|invalid.*phone|phone.*not valid/i },
  { para: "Número não registrado no WhatsApp", quando: /133010|not registered/i },
  { para: "E-mail inválido", quando: /invalid to header|invalid.*recipient|invalidargument/i },
  { para: "E-mail não existe (caixa não encontrada)", quando: /mailbox.*not found|550/i },

  // --- Problema nosso: configuração (ação: avisar a engenharia) ---
  { para: "Número de teste: a conta da Meta só envia para números autorizados", quando: /not in allowed list|131030/i },
  { para: "Template não existe ou não está aprovado na Meta", quando: /132001|template name does not exist/i },
  { para: "As variáveis do template não batem com o texto aprovado", quando: /132000|number of parameters/i },
  { para: "Texto do template ficou longo demais", quando: /132005|too long/i },
  { para: "Falha ao anexar a ficha (a Meta não conseguiu baixar o PDF)", quando: /131053|media.*(upload|download)/i },
  { para: "Sessão do e-mail expirada — precisa reconectar a conta", quando: /invalid credentials|unauthorized|401/i },

  // --- Limite / bloqueio (ação: parar e reavaliar) ---
  { para: "Limite de envio da Meta atingido — aguardar antes de continuar", quando: /130429|rate limit/i },
  { para: "Muitas mensagens para o mesmo número em pouco tempo", quando: /131056|pair rate/i },
  { para: "Conta do WhatsApp bloqueada pela Meta", quando: /131031|account.*lock/i },
  { para: "Limite diário de e-mails atingido", quando: /daily limit exceeded/i },

  // --- Nossos próprios (a ficha está incompleta) ---
  { para: "A ficha não tem telefone cadastrado", quando: /sem telefone na ficha/i },
  { para: "A ficha não tem e-mail cadastrado", quando: /sem e-mail na ficha/i },
];

function resumirErro(erro: string): string {
  const limpo = erro.replace(/^erro:\s*/i, "").trim();

  const traduzido = TRADUCOES.find((t) => t.quando.test(limpo));
  if (traduzido) return traduzido.para;

  // Sem tradução: mostra a frase do JSON (o Gmail devolve o corpo inteiro do erro).
  const doJson = limpo.match(/"message"\s*:\s*"([^"]+)"/);
  if (doJson?.[1]) return doJson[1];
  return limpo.length > 90 ? `${limpo.slice(0, 90)}…` : limpo;
}

function dataBR(iso: string): string {
  // O Asaas manda o vencimento como yyyy-mm-dd; `new Date` nesse formato cai em UTC e volta um
  // dia no nosso fuso.
  const [ano, mes, dia] = iso.split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

// Copiar é o gesto principal desta caixa: o operador está com o cliente na linha.
function BotaoCopiar({ rotulo, valor }: { rotulo: string; valor: string }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <button
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
      onClick={() => {
        void navigator.clipboard.writeText(valor).then(() => {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        });
      }}
      type="button"
    >
      {copiado ? (
        <>
          <Check className="size-3.5 text-emerald-600" /> copiado
        </>
      ) : (
        <>
          <Copy className="size-3.5" /> {rotulo}
        </>
      )}
    </button>
  );
}

function moeda(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    currency: "BRL",
    minimumFractionDigits: 2,
    style: "currency",
  });
}

export function StatusPixPrevenda({ entityId }: { entityId: string }) {
  const [dados, setDados] = useState<StatusPix | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/apolo/board/${entityId}/pix`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json()) as { data?: StatusPix };
      setDados(corpo.data ?? null);
    } catch {
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [entityId]);

  // GERAR O PIX + disparar a cobrança nos dois canais. Ao terminar, recarrega o status: o
  // cliclo gerou -> enviou aparece na hora, sem sair da ficha.
  const gerar = useCallback(async () => {
    setGerando(true);
    setErroGerar(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/apolo/board/${entityId}/gerar-pix`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const corpo = (await r.json()) as { data?: unknown; error?: string };
      if (!r.ok) setErroGerar(corpo.error ?? `Falha (${r.status}).`);
      else await carregar();
    } catch (e) {
      setErroGerar((e as Error).message);
    } finally {
      setGerando(false);
    }
  }, [carregar, entityId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <p className="m-0 mt-4 flex items-center gap-2 text-xs text-ink-muted">
        <Loader2 className="size-3.5 animate-spin" /> Carregando o status do PIX...
      </p>
    );
  }

  // Sem cobrança e sem envio: a pré-venda ainda não começou pra esta ficha. Aqui é onde o operador
  // dispara: gera o PIX e manda a cobrança nos dois canais, num clique.
  if (!dados || (!dados.cobranca && dados.envios.length === 0)) {
    return (
      <div className="mt-4 rounded-lg border border-line bg-surface p-4">
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <QrCode aria-hidden="true" className="size-4" /> Gerar o PIX do credenciamento
        </p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          Emite a cobrança de R$ 1.000,00 e já envia no WhatsApp e no e-mail do cliente, com a
          ficha (CAD) anexada. É a mesma cobrança que ele paga para concluir o cadastro.
        </p>

        <button
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-inverse px-4 py-2 text-sm font-bold text-brand-ink disabled:opacity-60"
          disabled={gerando}
          onClick={() => void gerar()}
          type="button"
        >
          {gerando ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <QrCode aria-hidden="true" className="size-4" />
          )}
          {gerando ? "Gerando e enviando..." : "Gerar PIX e enviar cobrança"}
        </button>

        {erroGerar ? (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            {erroGerar}
          </p>
        ) : null}
      </div>
    );
  }

  const cobrancas = dados.envios.filter((e) => e.tipo === "prevenda_cobranca");
  const recibos = dados.envios.filter((e) => e.tipo === "prevenda_recibo");
  const comErro = dados.envios.filter((e) => e.erro);

  const linhaEnvio = (envio: Envio) => {
    const Icone = envio.canal === "email" ? Mail : Send;
    const falhou = Boolean(envio.erro);
    return (
      <li
        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
        key={`${envio.tipo}-${envio.canal}-${envio.quando}`}
      >
        <Icone
          aria-hidden="true"
          className={`size-3.5 shrink-0 ${falhou ? "text-rose-600" : "text-ink-muted"}`}
        />
        <span className="text-ink-soft">{envio.canal === "email" ? "E-mail" : "WhatsApp"}</span>
        <span className="text-ink-muted">{envio.destinatario ?? "—"}</span>
        {falhou ? (
          <span className="font-semibold text-rose-600" title={envio.erro ?? undefined}>
            falhou: {resumirErro(envio.erro ?? "")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
            {envio.lidoEm ? (
              <>
                <CheckCheck className="size-3.5" /> lido
              </>
            ) : envio.entregueEm ? (
              <>
                <CheckCheck className="size-3.5" /> entregue
              </>
            ) : (
              <>
                <Check className="size-3.5" /> enviado
              </>
            )}
          </span>
        )}
        <span className="text-ink-muted">· {hora(envio.quando)}</span>
      </li>
    );
  };

  return (
    <div className="mt-4 grid gap-3">
      {/* 1) A cobrança */}
      <div className="rounded-lg border border-line bg-surface p-3">
        <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-ink">
          <QrCode aria-hidden="true" className="size-3.5" /> PIX gerado
        </p>
        {dados.cobranca ? (
          <p className="m-0 mt-1 text-xs text-ink-soft">
            {moeda(dados.cobranca.valor)} · {hora(dados.cobranca.criadoEm)}
            <span className="ml-2 font-mono text-[11px] text-ink-muted">
              {dados.cobranca.paymentId}
            </span>
          </p>
        ) : (
          <p className="m-0 mt-1 text-xs text-ink-muted">Ainda não gerado.</p>
        )}
      </div>

      {/* 1.5) O PIX na mão: copiar link, copiar código, baixar o QR */}
      {dados.pix && (dados.pix.link || dados.pix.copiaECola) ? (
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-ink">
            <QrCode aria-hidden="true" className="size-3.5" /> Reenviar este PIX
          </p>
          <p className="m-0 mt-1 text-[11px] text-ink-muted">
            É a MESMA cobrança já emitida: reenviar não cobra de novo.
            {dados.pix.vencimento ? ` Vence em ${dataBR(dados.pix.vencimento)}.` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {dados.pix.link ? (
              <BotaoCopiar rotulo="Copiar link de pagamento" valor={dados.pix.link} />
            ) : null}
            {dados.pix.copiaECola ? (
              <BotaoCopiar rotulo="Copiar PIX copia e cola" valor={dados.pix.copiaECola} />
            ) : null}
            {dados.pix.qrBase64 ? (
              <a
                className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                download="pix-credenciamento.png"
                href={`data:image/png;base64,${dados.pix.qrBase64}`}
              >
                <Download className="size-3.5" /> Baixar QR Code
              </a>
            ) : null}
          </div>

          {dados.pix.qrBase64 ? (
            /* eslint-disable-next-line @next/next/no-img-element -- data URI vinda do Asaas */
            <img
              alt="QR Code do PIX"
              className="mt-2 size-32 rounded border border-line bg-white p-1"
              src={`data:image/png;base64,${dados.pix.qrBase64}`}
            />
          ) : null}
        </div>
      ) : null}

      {/* 2) Os envios */}
      <div className="rounded-lg border border-line bg-surface p-3">
        <p className="m-0 text-xs font-semibold text-ink">Cobrança enviada</p>
        {cobrancas.length ? (
          <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">{cobrancas.map(linhaEnvio)}</ul>
        ) : (
          <p className="m-0 mt-1 text-xs text-ink-muted">Nenhum envio registrado.</p>
        )}
      </div>

      {/* 3) O pagamento e o recibo */}
      <div
        className={`rounded-lg border p-3 ${
          dados.pagamento
            ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10"
            : "border-line bg-surface"
        }`}
      >
        <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-ink">
          {dados.pagamento ? <Check aria-hidden="true" className="size-3.5" /> : null}
          Pagamento
        </p>
        {dados.pagamento ? (
          <p className="m-0 mt-1 text-xs text-emerald-800 dark:text-emerald-200">
            Recebido {moeda(dados.pagamento.valor)} em {hora(dados.pagamento.quando)} — é esta hora
            que ordena a fila do lançamento.
          </p>
        ) : (
          <p className="m-0 mt-1 text-xs text-ink-muted">Aguardando o pagamento do cliente.</p>
        )}

        {recibos.length ? (
          <>
            <p className="m-0 mt-2 text-xs font-semibold text-ink">Recibo enviado</p>
            <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">{recibos.map(linhaEnvio)}</ul>
          </>
        ) : null}
      </div>

      {comErro.length ? (
        <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-rose-600">
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          {comErro.length} envio(s) com falha — veja o motivo acima.
        </p>
      ) : null}
    </div>
  );
}
