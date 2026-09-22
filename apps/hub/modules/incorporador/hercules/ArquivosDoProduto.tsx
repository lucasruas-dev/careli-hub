"use client";

import {
  FileText,
  Film,
  ImageIcon,
  Images,
  Loader2,
  Play,
  Trash2,
  Upload,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  type MidiaDoVisualizador,
  VisualizadorDeMidia,
} from "@/components/galeria/VisualizadorDeMidia";
import {
  conferirArquivoDoProduto,
  dimensoesDaMiniatura,
  duracaoEscrita,
  momentoDoQuadro,
  resumoDaGaleria,
  TAMANHO_MAXIMO_DA_MINIATURA,
  tamanhoEscrito,
  type TipoDeArquivo,
} from "@/lib/apolo/arquivos-do-produto";
import type {
  ArquivoDoProduto,
  PreparoDoEnvio,
} from "@/lib/apolo/arquivos-do-produto-servidor";
import { getHubSupabaseClient, hubSupabaseConfig } from "@/lib/supabase/client";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import { T } from "../tema";

// A ABA ARQUIVOS DA FICHA DO PRODUTO — fotos e vídeos em miniatura, abertos em popup.
//
// Lucas (16/09/2026): *"vamos subir videos, imagens dos produtos para que eles na hora que estiver
// negociando com o cliente possa mostrar essas fotos, imagens e videos, o ideal e organizar em
// miniatura (para que eles possam visualizar antes de abrir) quando abrir ter a opcao de ver em
// tela cheia, lembrando que nao precisa abrir em nova aba ou algo do tipo, abre como um popup
// mesmo"*.
//
// ⚠️ O ARQUIVO NÃO PASSA PELO SERVIDOR. Três passos: a rota assina (`preparar`), o navegador grava
// DIRETO no bucket, a rota confere e cria a linha (`registrar`). Vídeo de produto passa dos 4,5 MB
// do corpo da Vercel no primeiro segundo; é o mesmo desenho dos documentos da venda.
//
// ⚠️ O ENVIO É POR XMLHttpRequest, E NÃO PELO `uploadToSignedUrl` DO SUPABASE, por um motivo só: a
// barra de progresso. O `fetch` não informa progresso de upload, e um vídeo de 300 MB subindo sem
// barra parece travado — a pessoa recarrega a página na metade. O corpo é o MESMO que a biblioteca
// monta (FormData com `cacheControl` e o arquivo), e se o XHR for recusado na porta (rede, 401/403)
// a biblioteca entra como plano B, sem barra mas funcionando.
//
// ⚠️ A MINIATURA NASCE AQUI, NO NAVEGADOR (ATENCAO 3 da 0169): foto reduzida num <canvas> até 480 px
// no lado maior; vídeo com um quadro perto de 1 s, lido por um <video> fora da tela, que também
// mede a duração e o tamanho. Formato que o navegador não decodifica (HEIC no Chrome, HEVC no
// Windows) sobe SEM miniatura, e a grade mostra o ícone. Nunca trava o envio por causa dela.
//
// ⚠️ `accept="image/*,video/*"` E NÃO A LISTA DE MIMES. No iPhone, a lista explícita com
// `image/heic` faz o seletor entregar o HEIC cru (que o Chrome do cliente não abre); com `image/*`
// o iOS converte para JPEG na hora de anexar. O formato ainda é conferido antes de subir, pela
// mesma régua do servidor.
//
// ⚠️ SERVE ÀS DUAS PORTAS. Sem `api`, fala com o portal pelo cookie; com `api={{ rota, semToken:
// false }}`, fala com o Apolo com o Bearer do hub (mesmo desenho da UnidadesTab). As cores são os
// tokens `T` do portal, que caem nos `--uix-*` do hub fora dele.

const ROTA_DO_PORTAL = "/api/incorporador/produto/arquivos";

/** Depois disso, os links assinados (1 h) estão perto de vencer: a tela relê antes de abrir. */
const RELER_DEPOIS_DE_MS = 45 * 60 * 1000;

/**
 * Como cada tipo se chama na tela.
 *
 * ⚠️ UM MAPA, E NÃO UM TERNÁRIO. Enquanto eram dois tipos, `tipo === "video" ? ... : ...` passava;
 * com o documento (22/09/2026) cada ternário desses vira um lugar onde o PDF se chama "foto".
 */
const ROTULO_DO_TIPO: Readonly<Record<TipoDeArquivo, string>> = {
  documento: "documento",
  imagem: "foto",
  video: "vídeo",
};

/** O mesmo, com artigo, para a frase da remoção ("Remover o vídeo “…”?"). */
const ARTIGO_DO_TIPO: Readonly<Record<TipoDeArquivo, string>> = {
  documento: "o documento",
  imagem: "a foto",
  video: "o vídeo",
};

type Fase = "enviando" | "erro" | "fila" | "preparando" | "pronto" | "registrando";

type Envio = {
  chave: string;
  erro?: string;
  fase: Fase;
  nome: string;
  /** 0 a 1. */
  progresso: number;
  tamanho: number;
};

type Destino = { id: string; rotulo: string };

type RespostaDaLista = {
  data?: { arquivos: ArquivoDoProduto[]; destinos: Destino[]; podeEnviar: boolean };
  error?: string;
};

export function ArquivosDoProduto({
  api,
  emp,
  podeEditar,
}: {
  /** A porta do Apolo. Sem ela, a do portal (cookie). */
  api?: { rota: string; semToken: boolean };
  /** O `linha.id` da ficha ("pai:<uuid>" ou id do C2X). A rota recorta pelo escopo. */
  emp: string;
  /** Quem pode enviar e remover. A rota confere de novo; isto só decide os botões. */
  podeEditar: boolean;
}) {
  // Deps como PRIMITIVOS: `api={{ ... }}` inline seria um objeto novo a cada render.
  const rota = api?.rota ?? ROTA_DO_PORTAL;
  const semToken = api?.semToken ?? true;

  const [arquivos, setArquivos] = useState<ArquivoDoProduto[]>([]);
  const [destinos, setDestinos] = useState<Destino[]>([]);
  const [podeEnviarNoServidor, setPodeEnviarNoServidor] = useState(false);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("carregando");
  const [erroDaCarga, setErroDaCarga] = useState<null | string>(null);
  const [destino, setDestino] = useState("");
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [removendo, setRemovendo] = useState<ArquivoDoProduto | null>(null);
  const [erroDaRemocao, setErroDaRemocao] = useState<null | string>(null);
  const [removendoAgora, setRemovendoAgora] = useState(false);
  const [aberto, setAberto] = useState<null | number>(null);
  const [miniaturasQuebradas, setMiniaturasQuebradas] = useState<ReadonlySet<string>>(new Set());

  const campo = useRef<HTMLInputElement | null>(null);
  const botaoCancelar = useRef<HTMLButtonElement | null>(null);
  const carregadoEm = useRef(0);
  const pedidoAtual = useRef(0);

  const podeEnviar = podeEditar && podeEnviarNoServidor;

  const cabecalhos = useCallback(async (): Promise<Record<string, string>> => {
    if (semToken) return {};
    const token = await getApoloAccessToken();
    return { Authorization: `Bearer ${token}` };
  }, [semToken]);

  const carregar = useCallback(async (): Promise<ArquivoDoProduto[] | null> => {
    // Só a resposta do pedido MAIS NOVO pinta a tela: trocar de produto no meio de uma leitura lenta
    // mostraria as fotos do produto anterior na ficha do novo.
    const meu = ++pedidoAtual.current;
    try {
      const resposta = await fetch(`${rota}?emp=${encodeURIComponent(emp)}`, {
        cache: "no-store",
        headers: await cabecalhos(),
      });
      const corpo = (await resposta.json().catch(() => null)) as null | RespostaDaLista;
      if (meu !== pedidoAtual.current) return null;

      if (!resposta.ok || !corpo?.data) {
        setErroDaCarga(corpo?.error ?? "Não foi possível carregar as fotos e vídeos agora.");
        setEstado("erro");
        return null;
      }

      setArquivos(corpo.data.arquivos);
      setDestinos(corpo.data.destinos);
      setPodeEnviarNoServidor(corpo.data.podeEnviar);
      setMiniaturasQuebradas(new Set());
      setErroDaCarga(null);
      setEstado("pronto");
      carregadoEm.current = Date.now();
      return corpo.data.arquivos;
    } catch {
      if (meu !== pedidoAtual.current) return null;
      setErroDaCarga("Não foi possível carregar as fotos e vídeos agora.");
      setEstado("erro");
      return null;
    }
  }, [cabecalhos, emp, rota]);

  useEffect(() => {
    // Produto novo começa limpo: a grade do anterior não pode aparecer nem por um instante.
    setArquivos([]);
    setEstado("carregando");
    setAberto(null);
    setRemovendo(null);
    void carregar();
  }, [carregar]);

  // O destino escolhido tem de continuar valendo depois de uma releitura; se sumiu, o primeiro.
  useEffect(() => {
    setDestino((atual) =>
      destinos.some((d) => d.id === atual) ? atual : (destinos[0]?.id ?? ""),
    );
  }, [destinos]);

  useEffect(() => {
    if (removendo) botaoCancelar.current?.focus();
  }, [removendo]);

  // ── ENVIO ─────────────────────────────────────────────────────────────────

  const atualizarEnvio = useCallback((chave: string, parcial: Partial<Envio>) => {
    setEnvios((lista) => lista.map((e) => (e.chave === chave ? { ...e, ...parcial } : e)));
  }, []);

  const enviarUm = useCallback(
    async (arquivo: File, chave: string): Promise<boolean> => {
      const conferido = conferirArquivoDoProduto({
        mime: arquivo.type,
        nome: arquivo.name,
        tamanho: arquivo.size,
      });
      if (!conferido.ok) {
        atualizarEnvio(chave, { erro: conferido.motivo, fase: "erro" });
        return false;
      }

      atualizarEnvio(chave, { fase: "preparando" });
      const midia = await lerMidia(arquivo, conferido.tipo);

      try {
        const jsonComToken = {
          "content-type": "application/json",
          ...(await cabecalhos()),
        };

        const preparo = await fetch(rota, {
          body: JSON.stringify({
            acao: "preparar",
            comMiniatura: Boolean(midia.miniatura),
            destino,
            emp,
            mime: conferido.mime,
            nome: arquivo.name,
            tamanho: arquivo.size,
          }),
          headers: jsonComToken,
          method: "POST",
        });
        const p = (await preparo.json().catch(() => null)) as null | {
          data?: PreparoDoEnvio;
          error?: string;
        };
        if (!preparo.ok || !p?.data) {
          atualizarEnvio(chave, {
            erro: p?.error ?? "Não foi possível preparar o envio.",
            fase: "erro",
          });
          return false;
        }

        atualizarEnvio(chave, { fase: "enviando", progresso: 0 });

        // ⚠️ O TIPO VAI NO BLOB: o bucket confere o `content-type` da parte, e o HEIC arrastado no
        // Windows chega com `type` vazio (viraria `application/octet-stream` e seria recusado).
        const corpo =
          arquivo.type === p.data.mime ? arquivo : arquivo.slice(0, arquivo.size, p.data.mime);

        await subirParaOStorage({
          arquivo: corpo,
          assinatura: p.data.original,
          aoProgredir: (fracao) => atualizarEnvio(chave, { progresso: fracao * 0.96 }),
          bucket: p.data.bucket,
        });

        let caminhoDaMiniatura: null | string = null;
        if (midia.miniatura && p.data.miniatura) {
          try {
            await subirParaOStorage({
              arquivo: midia.miniatura,
              assinatura: p.data.miniatura,
              bucket: p.data.bucket,
            });
            caminhoDaMiniatura = p.data.miniatura.caminho;
          } catch {
            // Sem miniatura a foto sobe do mesmo jeito; a grade mostra o ícone.
          }
        }

        atualizarEnvio(chave, { fase: "registrando", progresso: 0.98 });

        const registro = await fetch(rota, {
          body: JSON.stringify({
            acao: "registrar",
            altura: midia.altura,
            caminho: p.data.original.caminho,
            destino,
            duracao: midia.duracao,
            emp,
            largura: midia.largura,
            miniatura: caminhoDaMiniatura,
            nome: arquivo.name,
          }),
          headers: jsonComToken,
          method: "POST",
        });
        const r = (await registro.json().catch(() => null)) as null | { error?: string };
        if (!registro.ok) {
          atualizarEnvio(chave, {
            erro: r?.error ?? "O arquivo subiu, mas não foi registrado. Tente de novo.",
            fase: "erro",
          });
          return false;
        }

        atualizarEnvio(chave, { fase: "pronto", progresso: 1 });
        return true;
      } catch (erro) {
        atualizarEnvio(chave, {
          erro: erro instanceof ErroDoEnvio ? erro.message : "Não foi possível enviar agora.",
          fase: "erro",
        });
        return false;
      }
    },
    [atualizarEnvio, cabecalhos, destino, emp, rota],
  );

  const enviarLote = useCallback(
    async (lista: File[]) => {
      if (!podeEnviar || enviando || lista.length === 0) return;

      const base = Date.now();
      const novos: Envio[] = lista.map((arquivo, i) => ({
        chave: `${base}-${i}`,
        fase: "fila",
        nome: arquivo.name,
        progresso: 0,
        tamanho: arquivo.size,
      }));
      setEnvios(novos);
      setEnviando(true);

      // ⚠️ UM DE CADA VEZ. Cinco vídeos em paralelo dividem a banda do 4G do corretor em cinco e
      // nenhum termina; em fila, cada um que termina já aparece como pronto.
      let algumDeuCerto = false;
      for (let i = 0; i < lista.length; i += 1) {
        const arquivo = lista[i];
        const envio = novos[i];
        if (!arquivo || !envio) continue;
        if (await enviarUm(arquivo, envio.chave)) algumDeuCerto = true;
      }

      if (algumDeuCerto) await carregar();
      setEnviando(false);
      // Os que deram certo saem da lista; os erros ficam até a pessoa ler.
      setEnvios((atual) => atual.filter((e) => e.fase === "erro"));
    },
    [carregar, enviando, enviarUm, podeEnviar],
  );

  // ── REMOÇÃO ───────────────────────────────────────────────────────────────

  const confirmarRemocao = useCallback(async () => {
    if (!removendo) return;
    setRemovendoAgora(true);
    setErroDaRemocao(null);
    try {
      const resposta = await fetch(
        `${rota}?emp=${encodeURIComponent(emp)}&id=${encodeURIComponent(removendo.id)}`,
        { headers: await cabecalhos(), method: "DELETE" },
      );
      const corpo = (await resposta.json().catch(() => null)) as null | { error?: string };
      if (!resposta.ok) {
        setErroDaRemocao(corpo?.error ?? "Não foi possível remover agora.");
        return;
      }
      setArquivos((lista) => lista.filter((a) => a.id !== removendo.id));
      setRemovendo(null);
    } catch {
      setErroDaRemocao("Não foi possível remover agora.");
    } finally {
      setRemovendoAgora(false);
    }
  }, [cabecalhos, emp, removendo, rota]);

  // ── VISUALIZADOR ──────────────────────────────────────────────────────────

  const itensDoVisualizador = useMemo<MidiaDoVisualizador[]>(
    () =>
      arquivos.map((a) => ({
        id: a.id,
        legenda: a.legenda,
        miniaturaUrl: a.miniaturaUrl,
        nome: a.nome,
        tipo: a.tipo,
        url: a.url,
      })),
    [arquivos],
  );

  const abrir = useCallback(
    async (id: string) => {
      // ⚠️ O LINK ASSINADO VENCE (1 h). A aba aberta de manhã e clicada à tarde abriria "arquivo não
      // encontrado" na frente do cliente; relê antes, e abre pelo ID (a ordem pode ter mudado).
      let lista: ArquivoDoProduto[] | null = arquivos;
      if (Date.now() - carregadoEm.current > RELER_DEPOIS_DE_MS) {
        lista = await carregar();
      }
      const indice = (lista ?? []).findIndex((a) => a.id === id);
      if (indice >= 0) setAberto(indice);
    },
    [arquivos, carregar],
  );

  // ── TELA ──────────────────────────────────────────────────────────────────

  const aoEscolher = (evento: ChangeEvent<HTMLInputElement>) => {
    const lista = Array.from(evento.target.files ?? []);
    evento.target.value = "";
    void enviarLote(lista);
  };

  const concluidos = envios.filter((e) => e.fase === "pronto").length;
  const emAndamento = envios.find(
    (e) => e.fase === "enviando" || e.fase === "preparando" || e.fase === "registrando",
  );
  const vazio = estado === "pronto" && arquivos.length === 0;

  const botaoEnviar = (
    <button
      className="arq-enviar"
      disabled={enviando || destinos.length === 0}
      onClick={() => campo.current?.click()}
      title={destinos.length === 0 ? "Sem empreendimento para receber o envio" : undefined}
      type="button"
    >
      {enviando ? (
        <Loader2 aria-hidden="true" className="arq-girando" size={16} />
      ) : (
        <Upload aria-hidden="true" size={16} />
      )}
      {enviando ? "Enviando…" : "Enviar fotos e vídeos"}
    </button>
  );

  return (
    <section
      aria-label="Fotos e vídeos do produto"
      className={`arq${arrastando ? " arq--arrastando" : ""}`}
      onDragLeave={(evento) => {
        if (evento.currentTarget.contains(evento.relatedTarget as Node | null)) return;
        setArrastando(false);
      }}
      onDragOver={(evento) => {
        if (!podeEnviar || enviando) return;
        if (!Array.from(evento.dataTransfer.types).includes("Files")) return;
        evento.preventDefault();
        setArrastando(true);
      }}
      onDrop={(evento) => {
        if (!podeEnviar || enviando) return;
        evento.preventDefault();
        setArrastando(false);
        void enviarLote(Array.from(evento.dataTransfer.files));
      }}
    >
      <style>{ESTILO}</style>

      <header className="arq-topo">
        <div className="arq-titulos">
          <h3 className="arq-titulo">Fotos e vídeos</h3>
          <p className="arq-sub">
            {estado === "carregando" && arquivos.length === 0
              ? "Carregando…"
              : resumoDaGaleria(arquivos)}
          </p>
        </div>

        {podeEnviar && !vazio ? (
          <div className="arq-acoes">
            {destinos.length > 1 ? (
              <label className="arq-destino">
                <span className="arq-oculto">Empreendimento que recebe o envio</span>
                <select
                  disabled={enviando}
                  onChange={(evento) => setDestino(evento.target.value)}
                  value={destino}
                >
                  {destinos.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.rotulo}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {botaoEnviar}
          </div>
        ) : null}

        {podeEnviar ? (
          <input
            accept="image/*,video/*,application/pdf"
            className="arq-oculto"
            multiple
            onChange={aoEscolher}
            ref={campo}
            tabIndex={-1}
            type="file"
          />
        ) : null}
      </header>

      {/* ── CONFIRMAÇÃO DE REMOÇÃO: faixa fixa no topo da aba, sem modal por cima de modal ── */}
      {removendo ? (
        <div aria-labelledby="arq-remover-titulo" className="arq-confirmar" role="alertdialog">
          <div className="arq-confirmar-texto">
            <strong id="arq-remover-titulo">
              Remover {ARTIGO_DO_TIPO[removendo.tipo]} “{removendo.nome}”?
            </strong>
            <span>Deixa de aparecer para todos que veem este produto.</span>
            {erroDaRemocao ? <span className="arq-erro-texto">{erroDaRemocao}</span> : null}
          </div>
          <div className="arq-confirmar-acoes">
            <button
              className="arq-botao"
              disabled={removendoAgora}
              onClick={() => {
                setRemovendo(null);
                setErroDaRemocao(null);
              }}
              ref={botaoCancelar}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="arq-botao arq-botao--perigo"
              disabled={removendoAgora}
              onClick={() => void confirmarRemocao()}
              type="button"
            >
              {removendoAgora ? "Removendo…" : "Remover"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── ENVIOS EM ANDAMENTO ── */}
      {envios.length > 0 ? (
        <div aria-live="polite" className="arq-envios">
          {enviando ? (
            <p className="arq-envios-titulo">
              Enviando {Math.min(concluidos + 1, envios.length)} de {envios.length}
              {emAndamento ? ` · ${emAndamento.nome}` : ""}
            </p>
          ) : null}
          <ul className="arq-envios-lista">
            {envios.map((e) => (
              <li className="arq-envio" key={e.chave}>
                <div className="arq-envio-linha">
                  <span className="arq-envio-nome" title={e.nome}>
                    {e.nome}
                  </span>
                  <span className={e.fase === "erro" ? "arq-erro-texto" : "arq-envio-estado"}>
                    {rotuloDaFase(e)}
                  </span>
                </div>
                {e.fase !== "erro" ? (
                  <div
                    aria-label={`Progresso de ${e.nome}`}
                    aria-valuemax={100}
                    aria-valuemin={0}
                    aria-valuenow={Math.round(e.progresso * 100)}
                    className="arq-barra"
                    role="progressbar"
                  >
                    <span style={{ width: `${Math.round(e.progresso * 100)}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {!enviando ? (
            <button className="arq-link" onClick={() => setEnvios([])} type="button">
              Dispensar avisos
            </button>
          ) : null}
        </div>
      ) : null}

      {estado === "erro" && erroDaCarga ? (
        <div className="arq-aviso" role="alert">
          <span>{erroDaCarga}</span>
          <button className="arq-link" onClick={() => void carregar()} type="button">
            Tentar de novo
          </button>
        </div>
      ) : null}

      {/* ── CARREGANDO: o esqueleto da grade, sem pular a tela quando as fotos chegam ── */}
      {estado === "carregando" && arquivos.length === 0 ? (
        <ul aria-hidden="true" className="arq-grade">
          {Array.from({ length: 8 }, (_, i) => (
            <li className="arq-cartao" key={i}>
              <span className="arq-miniatura arq-esqueleto" />
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── VAZIO ── */}
      {vazio ? (
        <div className="arq-vazio">
          <span className="arq-vazio-icone">
            <Images aria-hidden="true" size={28} />
          </span>
          <strong>Nenhuma foto ou vídeo ainda</strong>
          <p>
            {podeEnviar
              ? "Envie as fotos e os vídeos deste produto para mostrar ao cliente durante a negociação."
              : "Quando a equipe enviar fotos e vídeos deste produto, eles aparecem aqui."}
          </p>
          {podeEnviar ? (
            <div className="arq-acoes">
              {destinos.length > 1 ? (
                <label className="arq-destino">
                  <span className="arq-oculto">Empreendimento que recebe o envio</span>
                  <select
                    disabled={enviando}
                    onChange={(evento) => setDestino(evento.target.value)}
                    value={destino}
                  >
                    {destinos.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.rotulo}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {botaoEnviar}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── A GRADE ── */}
      {arquivos.length > 0 ? (
        <ul className="arq-grade">
          {arquivos.map((a) => {
            const rotulo = ROTULO_DO_TIPO[a.tipo];
            const semMiniatura = !a.miniaturaUrl || miniaturasQuebradas.has(a.id);
            return (
              <li className="arq-cartao" key={a.id}>
                <button
                  aria-label={`Abrir ${rotulo} ${a.nome}`}
                  className="arq-miniatura"
                  onClick={() => void abrir(a.id)}
                  title={[a.nome, a.tamanhoBytes ? tamanhoEscrito(a.tamanhoBytes) : ""]
                    .filter(Boolean)
                    .join(" · ")}
                  type="button"
                >
                  {semMiniatura ? (
                    <span className="arq-sem-miniatura">
                      {a.tipo === "video" ? (
                        <Film aria-hidden="true" size={26} />
                      ) : a.tipo === "documento" ? (
                        <FileText aria-hidden="true" size={26} />
                      ) : (
                        <ImageIcon aria-hidden="true" size={26} />
                      )}
                      <span className="arq-sem-miniatura-nome">{a.nome}</span>
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, sem otimizador
                    <img
                      alt=""
                      decoding="async"
                      loading="lazy"
                      onError={() =>
                        setMiniaturasQuebradas((atual) => new Set([...atual, a.id]))
                      }
                      src={a.miniaturaUrl ?? undefined}
                    />
                  )}
                  {a.tipo === "video" ? (
                    <>
                      <span aria-hidden="true" className="arq-play">
                        <Play size={18} />
                      </span>
                      {a.duracaoSegundos ? (
                        <span className="arq-duracao">{duracaoEscrita(a.duracaoSegundos)}</span>
                      ) : null}
                    </>
                  ) : null}
                </button>
                {podeEnviar ? (
                  <button
                    aria-label={`Remover ${rotulo} ${a.nome}`}
                    className="arq-remover"
                    disabled={removendoAgora}
                    onClick={() => {
                      setErroDaRemocao(null);
                      setRemovendo(a);
                    }}
                    title="Remover"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                ) : null}
                {a.legenda ? <p className="arq-legenda">{a.legenda}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {arrastando ? (
        <div aria-hidden="true" className="arq-soltar">
          <Upload size={22} />
          Solte para enviar
        </div>
      ) : null}

      <VisualizadorDeMidia
        indice={aberto}
        itens={itensDoVisualizador}
        onFechar={() => setAberto(null)}
        onIndice={setAberto}
        rotulo="Fotos e vídeos do produto"
      />
    </section>
  );
}

function rotuloDaFase(envio: Envio): string {
  switch (envio.fase) {
    case "fila":
      return "Na fila";
    case "preparando":
      return "Preparando…";
    case "enviando":
      return `${Math.round(envio.progresso * 100)}% de ${tamanhoEscrito(envio.tamanho)}`;
    case "registrando":
      return "Finalizando…";
    case "pronto":
      return "Enviado";
    case "erro":
      return envio.erro ?? "Não foi possível enviar.";
  }
}

// ── LEITURA DA MÍDIA NO NAVEGADOR (miniatura + medidas) ──────────────────────

type MidiaLida = {
  altura: null | number;
  duracao: null | number;
  largura: null | number;
  miniatura: Blob | null;
};

const SEM_MIDIA: MidiaLida = { altura: null, duracao: null, largura: null, miniatura: null };

/** Nunca lança: formato que o navegador não lê devolve tudo nulo e o envio segue sem miniatura. */
async function lerMidia(arquivo: File, tipo: TipoDeArquivo): Promise<MidiaLida> {
  try {
    return tipo === "video" ? await lerVideo(arquivo) : await lerImagem(arquivo);
  } catch {
    return SEM_MIDIA;
  }
}

function esperar<T extends HTMLElement>(elemento: T, evento: string, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const limpar = () => {
      window.clearTimeout(relogio);
      elemento.removeEventListener(evento, ok);
      elemento.removeEventListener("error", falhou);
    };
    const ok = () => {
      limpar();
      resolve();
    };
    const falhou = () => {
      limpar();
      reject(new Error(`falha ao ler (${evento})`));
    };
    const relogio = window.setTimeout(falhou, ms);
    elemento.addEventListener(evento, ok, { once: true });
    elemento.addEventListener("error", falhou, { once: true });
  });
}

function paraJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.size <= TAMANHO_MAXIMO_DA_MINIATURA ? blob : null),
      "image/jpeg",
      0.8,
    );
  });
}

function desenhar(
  fonte: CanvasImageSource,
  largura: number,
  altura: number,
): Promise<Blob | null> {
  const medida = dimensoesDaMiniatura(largura, altura);
  if (medida.largura === 0) return Promise.resolve(null);

  const canvas = document.createElement("canvas");
  canvas.width = medida.largura;
  canvas.height = medida.altura;
  const contexto = canvas.getContext("2d");
  if (!contexto) return Promise.resolve(null);

  // PNG com transparência viraria fundo preto no JPEG.
  contexto.fillStyle = "#ffffff";
  contexto.fillRect(0, 0, medida.largura, medida.altura);
  contexto.imageSmoothingQuality = "high";
  contexto.drawImage(fonte, 0, 0, medida.largura, medida.altura);
  return paraJpeg(canvas);
}

async function lerImagem(arquivo: File): Promise<MidiaLida> {
  const url = URL.createObjectURL(arquivo);
  try {
    const imagem = new Image();
    imagem.decoding = "async";
    const pronta = esperar(imagem, "load", 20_000);
    imagem.src = url;
    await pronta;

    // A orientação do EXIF já vem aplicada: `naturalWidth` e o `drawImage` usam a imagem virada.
    const largura = imagem.naturalWidth;
    const altura = imagem.naturalHeight;
    if (!largura || !altura) return SEM_MIDIA;

    return { altura, duracao: null, largura, miniatura: await desenhar(imagem, largura, altura) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function lerVideo(arquivo: File): Promise<MidiaLida> {
  const url = URL.createObjectURL(arquivo);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    const metadados = esperar(video, "loadedmetadata", 20_000);
    video.src = url;
    await metadados;

    const duracao = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const largura = video.videoWidth || null;
    const altura = video.videoHeight || null;
    if (!largura || !altura) return { altura: null, duracao, largura: null, miniatura: null };

    let miniatura: Blob | null = null;
    try {
      const momento = momentoDoQuadro(duracao ?? 0);
      if (momento > 0) {
        const buscou = esperar(video, "seeked", 15_000);
        video.currentTime = momento;
        await buscou;
      }
      // HAVE_CURRENT_DATA: sem o quadro decodificado, o canvas sai preto (Safari).
      if (video.readyState < 2) await esperar(video, "loadeddata", 10_000);
      miniatura = await desenhar(video, largura, altura);
    } catch {
      miniatura = null;
    }

    return { altura, duracao, largura, miniatura };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

// ── A SUBIDA DIRETA AO STORAGE ───────────────────────────────────────────────

class ErroDoEnvio extends Error {}

type Assinatura = { caminho: string; signedUrl: string; token: string };

function mensagemDoStorage(status: number, texto: string): string {
  const t = texto.toLowerCase();
  if (status === 413 || t.includes("maximum allowed size") || t.includes("payload too large")) {
    return "O armazenamento recusou o tamanho deste arquivo.";
  }
  if (t.includes("mime type") || t.includes("invalid_mime_type")) {
    return "O armazenamento recusou o formato deste arquivo.";
  }
  if (status === 409 || t.includes("already exists")) {
    return "Este envio já foi feito. Recarregue a aba.";
  }
  return "O arquivo não subiu. Tente de novo.";
}

function subirPorXhr(
  arquivo: Blob,
  assinatura: Assinatura,
  aoProgredir?: (fracao: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", assinatura.signedUrl);
    // A chave pública identifica o projeto no gateway; quem AUTORIZA a gravação é o token da URL.
    if (hubSupabaseConfig.anonKey) xhr.setRequestHeader("apikey", hubSupabaseConfig.anonKey);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable && evento.total > 0) aoProgredir?.(evento.loaded / evento.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        aoProgredir?.(1);
        resolve();
        return;
      }
      reject(Object.assign(new ErroDoEnvio(mensagemDoStorage(xhr.status, xhr.responseText)), {
        status: xhr.status,
      }));
    };
    xhr.onerror = () =>
      reject(Object.assign(new ErroDoEnvio("O arquivo não subiu. Tente de novo."), { status: 0 }));

    const formulario = new FormData();
    formulario.append("cacheControl", "3600");
    formulario.append("", arquivo);
    xhr.send(formulario);
  });
}

async function subirParaOStorage(entrada: {
  aoProgredir?: (fracao: number) => void;
  arquivo: Blob;
  assinatura: Assinatura;
  bucket: string;
}): Promise<void> {
  try {
    await subirPorXhr(entrada.arquivo, entrada.assinatura, entrada.aoProgredir);
    return;
  } catch (erro) {
    const status = (erro as { status?: number }).status ?? 0;
    // Recusa de conteúdo (tamanho, formato, duplicado) não melhora tentando de novo por outro
    // caminho: devolve a mensagem.
    if (status !== 0 && status !== 401 && status !== 403) throw erro;
  }

  // Plano B: a biblioteca do Supabase, sem barra de progresso.
  const supabase = getHubSupabaseClient();
  if (!supabase) throw new ErroDoEnvio("Envio indisponível agora. Recarregue a página.");

  const subida = await supabase.storage
    .from(entrada.bucket)
    .uploadToSignedUrl(entrada.assinatura.caminho, entrada.assinatura.token, entrada.arquivo, {
      contentType: entrada.arquivo.type || "application/octet-stream",
    });
  if (subida.error) {
    throw new ErroDoEnvio(mensagemDoStorage(0, subida.error.message));
  }
  entrada.aoProgredir?.(1);
}

// ⚠️ CSS EM TEXTO COM PREFIXO `arq-`: estilo inline não alcança :hover, :focus-visible nem media
// query, e o componente não pode depender do Tailwind (a ficha do portal remapeia as `--color-*`,
// mas a aba precisa funcionar montada em qualquer lugar). As cores são os tokens `T`.
const ESTILO = `
.arq {
  position: relative; display: flex; flex-direction: column; gap: 12px;
  flex: 1; min-height: 0; overflow: auto; color: ${T.text};
  padding-bottom: 8px;
}
.arq--arrastando { outline: 2px dashed ${T.gold}; outline-offset: -2px; border-radius: 12px; }
.arq-topo { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.arq-titulos { min-width: 0; }
.arq-titulo { margin: 0; font-size: 14px; font-weight: 600; color: ${T.text}; }
.arq-sub { margin: 2px 0 0; font-size: 12px; color: ${T.muted}; }
.arq-acoes { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.arq-oculto {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.arq-destino select {
  height: 36px; max-width: 220px; padding: 0 10px; border-radius: 8px; font: inherit; font-size: 12.5px;
  border: 1px solid ${T.border}; background: ${T.card}; color: ${T.text};
}
.arq-enviar {
  display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px;
  border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600;
  background: ${T.btnBg}; color: ${T.btnFg};
}
.arq-enviar:disabled { opacity: .6; cursor: default; }
.arq-enviar:focus-visible, .arq-botao:focus-visible, .arq-link:focus-visible,
.arq-miniatura:focus-visible, .arq-remover:focus-visible, .arq-destino select:focus-visible {
  outline: 2px solid ${T.gold}; outline-offset: 2px;
}
.arq-girando { animation: arq-girar 1s linear infinite; }
.arq-grade {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.arq-cartao { position: relative; min-width: 0; }
.arq-miniatura {
  position: relative; display: block; width: 100%; aspect-ratio: 4 / 3; padding: 0;
  border: 1px solid ${T.border}; border-radius: 10px; overflow: hidden; cursor: pointer;
  background: ${T.soft}; color: ${T.muted};
}
.arq-miniatura img { display: block; width: 100%; height: 100%; object-fit: cover; }
.arq-miniatura:hover img { opacity: .92; }
.arq-sem-miniatura {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  width: 100%; height: 100%; padding: 8px; box-sizing: border-box;
}
.arq-sem-miniatura-nome {
  max-width: 100%; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.arq-play {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 999px; padding-left: 2px; box-sizing: border-box;
  background: rgb(0 0 0 / .55); color: #fff; pointer-events: none;
}
.arq-duracao {
  position: absolute; right: 6px; bottom: 6px; padding: 2px 6px; border-radius: 6px;
  font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;
  background: rgb(0 0 0 / .65); color: #fff; pointer-events: none;
}
.arq-remover {
  position: absolute; top: 6px; right: 6px;
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border: 0; border-radius: 8px; cursor: pointer;
  background: rgb(0 0 0 / .55); color: #fff; opacity: 0;
}
.arq-cartao:hover .arq-remover, .arq-remover:focus-visible { opacity: 1; }
@media (hover: none) { .arq-remover { opacity: 1; } }
.arq-legenda {
  margin: 4px 2px 0; font-size: 11.5px; color: ${T.sub};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.arq-esqueleto { cursor: default; animation: arq-pulsar 1.4s ease-in-out infinite; }
.arq-vazio {
  display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center;
  padding: 40px 16px; border: 1px dashed ${T.border}; border-radius: 12px; background: ${T.card};
}
.arq-vazio strong { font-size: 14px; color: ${T.text}; }
.arq-vazio p { margin: 0 0 6px; max-width: 420px; font-size: 12.5px; color: ${T.muted}; }
.arq-vazio .arq-acoes { justify-content: center; }
.arq-vazio-icone {
  display: inline-flex; align-items: center; justify-content: center;
  width: 56px; height: 56px; border-radius: 999px; background: ${T.soft}; color: ${T.gold};
}
.arq-confirmar {
  position: sticky; top: 0; z-index: 3;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
  padding: 12px; border-radius: 10px; border: 1px solid ${T.border};
  background: ${T.card}; box-shadow: ${T.sombra};
}
.arq-confirmar-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 12.5px; color: ${T.sub}; }
.arq-confirmar-texto strong { color: ${T.text}; font-size: 13px; overflow-wrap: anywhere; }
.arq-confirmar-acoes { display: flex; gap: 8px; }
.arq-botao {
  height: 34px; padding: 0 12px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12.5px;
  border: 1px solid ${T.border}; background: ${T.card}; color: ${T.text};
}
/* Texto na cor do FUNDO da página: branco sobre o vermelho do claro, quase preto sobre o salmão do
   escuro. Branco fixo some no salmão (contraste abaixo de 3:1). */
.arq-botao--perigo { border-color: transparent; background: ${T.danger}; color: ${T.page}; font-weight: 600; }
.arq-botao:disabled { opacity: .6; cursor: default; }
.arq-envios {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 12px;
  border: 1px solid ${T.border}; border-radius: 10px; background: ${T.card};
}
.arq-envios-titulo { margin: 0; font-size: 12.5px; font-weight: 600; color: ${T.text}; overflow-wrap: anywhere; }
.arq-envios-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.arq-envio-linha { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
.arq-envio-nome { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${T.text}; }
.arq-envio-estado { flex-shrink: 0; color: ${T.muted}; font-variant-numeric: tabular-nums; }
.arq-erro-texto { color: ${T.danger}; font-size: 12px; }
.arq-barra { height: 4px; margin-top: 4px; border-radius: 999px; overflow: hidden; background: ${T.soft}; }
.arq-barra span { display: block; height: 100%; border-radius: inherit; background: ${T.gold}; }
.arq-link {
  align-self: flex-start; padding: 0; border: 0; background: none; cursor: pointer;
  font: inherit; font-size: 12px; color: ${T.sub}; text-decoration: underline;
}
.arq-aviso {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
  padding: 10px 12px; border-radius: 10px; font-size: 12.5px;
  background: ${T.dangerBg}; color: ${T.danger};
}
.arq-soltar {
  position: absolute; inset: 0; z-index: 4; pointer-events: none;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  border-radius: 12px; font-size: 14px; font-weight: 600;
  background: rgb(0 0 0 / .08); color: ${T.text};
}
@media (max-width: 400px) {
  .arq-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .arq-enviar { flex: 1; justify-content: center; }
  .arq-acoes { width: 100%; }
  .arq-destino, .arq-destino select { width: 100%; max-width: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .arq-barra span { transition: width .2s linear; }
}
@media (prefers-reduced-motion: reduce) {
  .arq-esqueleto { animation: none; }
  .arq-girando { animation-duration: 2.4s; }
}
@keyframes arq-girar { to { transform: rotate(360deg); } }
@keyframes arq-pulsar { 50% { opacity: .55; } }
`;
