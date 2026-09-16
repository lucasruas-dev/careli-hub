"use client";

import { Download, LoaderCircle, Upload } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as KeyboardEventDoReact,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { ROTULO_DO_TIPO_DE_PRODUTO, type TipoProduto } from "@/lib/hercules/produto-novo";
import {
  type CampoDaUnidade,
  chaveDaColunaDeUnidades,
  codigoDaUnidade,
  colunasDaPlanilha,
  conferirPlanilhaDeUnidades,
  type ErrosDaUnidade,
  type LinhaDaPlanilhaDeUnidades,
  lerCsvDeUnidades,
  MAXIMO_DE_UNIDADES_POR_ENVIO,
  type ProblemaDaLinhaDeUnidade,
  rotuloDaUnidade,
  validarUnidade,
} from "@/lib/hercules/unidade-nova";

import { T } from "../tema";
import {
  cabecalhoDaColuna,
  camposDoFormulario,
  type CamposDaUnidade,
  camposVaziosDaUnidade,
  COLUNAS_DE_TEXTO,
  contagemDaConferencia,
  type EstadoDaLinha,
  exemploDeCodigoDaUnidade,
  instrucoesDoModelo,
  lerRespostaDaConferencia,
  lerRespostaDaCriacao,
  lerRespostaDaImportacao,
  type LinhaConferida,
  linhasConferidas,
  linhasDaConferenciaDaRota,
  linhaDoFormulario,
  linhaTemConteudo,
  nomeDoArquivoDoModelo,
  problemasNoFormulario,
  type RetornoNoFormulario,
  SITUACOES_DO_FORMULARIO,
  type UnidadeGravadaNaTela,
  valorDaCelula,
} from "./cadastro-na-tela";
import { CampoDoCadastro, CSS_DO_FORMULARIO, cabecalhosDaChamada, JanelaDoCadastro } from "./janela-do-cadastro";

// CADASTRO DE UNIDADES NO PANTEON: uma a uma ou por planilha, lote ou apartamento.
//
// Decisão do Lucas (16/09/2026): unidade cadastrada pelo portal grava no Panteon
// (`hercules_unidades`), nunca no C2X, que é SOMENTE LEITURA. E prédio tem colunas próprias
// (torre, andar, apartamento, tipologia, vagas): apartamento nunca é encaixado em quadra e lote.
//
// ⚠️ O DESENHO É O DO `AdicionarUnidades` DO APOLO (modules/apolo/blocks/empreendimentos/
// adicionar-unidades.tsx), de propósito: as duas abas, o modelo no topo, a conferência antes da
// escrita e o resumo conferido no banco. O time da Cecílio vai usar as duas telas lado a lado com
// quem já cadastra no Apolo; o que muda é o destino (Panteon) e os campos do tipo.
//
// ⚠️ O PRODUTO VEM DO CONTEXTO, NUNCA DE UM SELETOR. A escolha mais perigosa do processo (subir 300
// lotes no empreendimento errado) não existe aqui: quem monta esta tela já está dentro da ficha do
// produto, e `emp`, `tipoProduto` e `prefixo` descem de lá.
//
// ⚠️ CONFERIR ANTES DE GRAVAR NÃO É ETAPA DECORATIVA. Cadastro no Panteon não tem desfazer pela
// tela, e a unidade errada aparece na Venda, no espelho e no VGV no minuto seguinte. O botão de
// gravar só acende depois que a ROTA conferiu (a conferência da tela não enxerga o que já existe
// no produto), e a tela mostra, linha por linha, o que entra, o que entra com aviso e o que não
// entra.
//
// CONTRATO DA ROTA: o de `executarCadastroDeUnidades` (lib/hercules/cadastrar-unidades-panteon-server.ts),
// o mesmo nas duas portas. O produto vai em `?emp=` (a porta do portal lê daí, e o escopo sai do
// cookie) e em `enterpriseId` no corpo (a porta do hub lê daí). As ações:
//   { acao: "conferir", linhas } → julga a planilha, não grava;
//   { acao: "importar", linhas } → a planilha INTEIRA num envio, tudo ou nada (até 500 linhas);
//   { acao: "criar", unidade }   → uma unidade.
// A leitura das respostas mora em ./cadastro-na-tela.ts, com teste; o teste de comportamento desta
// tela roda contra a rota do portal de verdade, para os dois lados não voltarem a divergir.
//
// ⚠️ SEM ENVIO EM LOTES. A rota grava a planilha num insert só, e é isso que impede a importação
// parcial: com lotes, o erro do terceiro lote deixava os dois primeiros gravados, e a planilha
// corrigida voltava acusando "já cadastrada" nas linhas que tinham entrado. Planilha acima de 500
// linhas é recusada ANTES de enviar, com o pedido de dividir por quadra ou por torre.

export const ROTA_DO_CADASTRO_DE_UNIDADES = "/api/incorporador/produto/unidades/cadastrar";

type Props = {
  aoConcluir: () => void;
  /** Avisa quem monta a tela quando há gravação no ar (a janela não fecha nesse meio tempo). */
  aoMudarOcupado?: (ocupado: boolean) => void;
  /** O produto da ficha, como as outras abas recebem ("pai:<uuid>" ou o id). A rota confere o escopo. */
  emp: string;
  endpoint?: string;
  /** Só para o cabeçalho da planilha modelo. */
  nomeDoProduto?: string;
  /** O `codigo` do produto: o começo do código de cada unidade. */
  prefixo: string;
  /** `false` = porta do hub (Bearer do Apolo). Padrão: portal, pelo cookie da sessão. */
  semToken?: boolean;
  tipoProduto: TipoProduto;
};

const CSS_DAS_UNIDADES = `
  .inc-und { color: ${T.text}; display: grid; gap: 14px; }
  .inc-und-topo { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
  .inc-und-abas {
    background: ${T.soft}; border: 1px solid ${T.border}; border-radius: 10px; display: inline-flex;
    gap: 2px; padding: 3px;
  }
  .inc-und-aba {
    background: transparent; border: none; border-radius: 8px; color: ${T.muted}; cursor: pointer;
    font: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 12px;
  }
  .inc-und-aba[aria-selected="true"] { background: ${T.card}; box-shadow: 0 1px 2px rgb(0 0 0 / .08); color: ${T.text}; }
  .inc-und-aba:disabled { cursor: default; opacity: .6; }
  .inc-und-numeros { display: flex; flex-wrap: wrap; gap: 8px 22px; }
  .inc-und-numero-valor { font-size: 20px; font-variant-numeric: tabular-nums; font-weight: 650; }
  .inc-und-filtros { display: flex; flex-wrap: wrap; gap: 6px; }
  .inc-und-filtro {
    background: transparent; border: 1px solid ${T.border}; border-radius: 999px; color: ${T.sub};
    cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; padding: 4px 11px;
  }
  .inc-und-filtro[aria-pressed="true"] { background: ${T.soft}; border-color: ${T.gold}; color: ${T.text}; }
  .inc-und-tabela-caixa { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 12px; max-height: 340px; overflow: auto; }
  .inc-und-tabela { border-collapse: collapse; font-size: 12.5px; width: 100%; }
  .inc-und-tabela th {
    background: ${T.soft}; color: ${T.muted}; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
    padding: 7px 10px; position: sticky; text-align: left; text-transform: uppercase; top: 0; z-index: 1;
  }
  .inc-und-tabela td { border-top: 1px solid ${T.border}; padding: 8px 10px; vertical-align: top; }
  .inc-und-col-linha, .inc-und-col-codigo { color: ${T.muted}; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .inc-und-so-celular { display: none; }
  .inc-und-sem-nome { color: ${T.muted}; font-style: italic; }
  .inc-und-motivos { display: grid; font-size: 11.5px; gap: 2px; list-style: none; margin: 4px 0 0; padding: 0; }
  .inc-und-motivo--erro { color: ${T.danger}; }
  .inc-und-motivo--aviso { color: ${T.gold}; }
  .inc-und-selo {
    align-items: center; border-radius: 999px; display: inline-flex; font-size: 11px; font-weight: 700;
    gap: 4px; padding: 2px 8px; white-space: nowrap;
  }
  .inc-und-selo--ok { background: ${T.okBg}; color: ${T.ok}; }
  .inc-und-selo--aviso { background: ${T.soft}; color: ${T.gold}; }
  .inc-und-selo--erro { background: ${T.dangerBg}; color: ${T.danger}; }
  .inc-und-acoes { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; }
  .inc-arquivo:focus-within { outline: 2px solid ${T.gold}; outline-offset: 2px; }
  /* NO CELULAR A TABELA VIRA CARTÃO: quatro colunas em 360px espremem o motivo, que é justamente
     o que a pessoa precisa ler para corrigir a linha. */
  @media (max-width: 640px) {
    .inc-und-tabela thead { display: none; }
    .inc-und-tabela tr {
      border-top: 1px solid ${T.border}; display: grid; gap: 2px 10px;
      grid-template-areas: "unidade resultado" "info info"; grid-template-columns: minmax(0, 1fr) auto;
      padding: 8px 10px;
    }
    .inc-und-tabela tr:first-child { border-top: none; }
    .inc-und-tabela td { border: none; padding: 0; }
    .inc-und-col-unidade { grid-area: unidade; }
    .inc-und-col-resultado { grid-area: resultado; }
    .inc-und-col-linha { font-size: 11px; grid-area: info; }
    .inc-und-col-codigo { display: none; }
    .inc-und-so-celular { display: inline; }
  }
`;

type Chamada = { corpo: unknown; status: number };

/**
 * A chamada à rota do cadastro de unidades, pelas duas portas. Exportada para a correção de unidade
 * (`EdicaoDaUnidade.tsx`) falar com a rota do MESMO jeito, e não por uma segunda cópia.
 */
export async function chamarCadastroDeUnidades(
  endpoint: string,
  semToken: boolean,
  emp: string,
  corpo: Record<string, unknown>,
): Promise<Chamada> {
  // O produto nas duas formas que as portas leem: a query (portal) e o corpo (hub). Nenhuma das duas
  // amplia nada: o portal confere o `emp` contra a sessão, e o hub já alcança qualquer produto.
  const separador = endpoint.includes("?") ? "&" : "?";
  const resposta = await fetch(`${endpoint}${separador}emp=${encodeURIComponent(emp)}`, {
    body: JSON.stringify({ ...corpo, enterpriseId: emp }),
    headers: await cabecalhosDaChamada(semToken),
    method: "POST",
  });
  // ⚠️ `.json()` PODE FALHAR COM 200: a Vercel devolve página de erro em texto quando a função
  // estoura o tempo, e o "Unexpected token" viraria a mensagem da tela. Sem corpo, quem lê a
  // resposta cai na mensagem padrão.
  return { corpo: await resposta.json().catch(() => null), status: resposta.status };
}

/**
 * O cadastro de unidades de UM produto: as abas "Uma unidade" e "Importar planilha".
 *
 * Monta direto numa aba ou dentro de uma janela (`JanelaDeCadastroDeUnidades`, abaixo). As duas
 * abas ficam montadas o tempo todo, e só uma aparece: trocar de aba no meio de uma conferência não
 * pode jogar a conferência fora.
 */
export function CadastroDeUnidades({
  aoConcluir,
  aoMudarOcupado,
  emp,
  endpoint = ROTA_DO_CADASTRO_DE_UNIDADES,
  nomeDoProduto,
  prefixo,
  semToken = true,
  tipoProduto,
}: Props) {
  const [aba, setAba] = useState<"planilha" | "uma">("uma");
  const [ocupadoNaUma, setOcupadoNaUma] = useState(false);
  const [ocupadoNaPlanilha, setOcupadoNaPlanilha] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [falhaDoModelo, setFalhaDoModelo] = useState<null | string>(null);
  const id = useId();
  const ocupado = ocupadoNaUma || ocupadoNaPlanilha;

  const avisarOcupado = useRef(aoMudarOcupado);
  useEffect(() => {
    avisarOcupado.current = aoMudarOcupado;
  }, [aoMudarOcupado]);
  useEffect(() => {
    avisarOcupado.current?.(ocupado);
  }, [ocupado]);

  const abas = [
    { chave: "uma" as const, rotulo: "Uma unidade" },
    { chave: "planilha" as const, rotulo: "Importar planilha" },
  ];

  const aoTeclarNaAba = (evento: KeyboardEventDoReact<HTMLButtonElement>, indice: number) => {
    if (evento.key !== "ArrowRight" && evento.key !== "ArrowLeft") return;
    evento.preventDefault();
    const proxima = abas[(indice + (evento.key === "ArrowRight" ? 1 : -1) + abas.length) % abas.length];
    if (!proxima) return;
    setAba(proxima.chave);
    document.getElementById(`${id}-aba-${proxima.chave}`)?.focus();
  };

  async function baixar() {
    setBaixando(true);
    setFalhaDoModelo(null);
    try {
      await baixarModelo(tipoProduto, prefixo, nomeDoProduto);
    } catch {
      setFalhaDoModelo("Não consegui montar a planilha modelo agora. Tente de novo.");
    } finally {
      setBaixando(false);
    }
  }

  const exemplo = exemploDeCodigoDaUnidade(prefixo, tipoProduto);

  return (
    <div className="inc-und">
      <style>{CSS_DO_FORMULARIO}</style>
      <style>{CSS_DAS_UNIDADES}</style>

      <div className="inc-und-topo">
        <div aria-label="Como cadastrar" className="inc-und-abas" role="tablist">
          {abas.map((item, indice) => (
            <button
              aria-controls={`${id}-painel-${item.chave}`}
              aria-selected={aba === item.chave}
              className="inc-und-aba inc-foco"
              disabled={ocupado && aba !== item.chave}
              id={`${id}-aba-${item.chave}`}
              key={item.chave}
              onClick={() => setAba(item.chave)}
              onKeyDown={(e) => aoTeclarNaAba(e, indice)}
              role="tab"
              tabIndex={aba === item.chave ? 0 : -1}
              type="button"
            >
              {item.rotulo}
            </button>
          ))}
        </div>
        {/* ⚠️ NO TOPO, e não dentro da aba de importação (o mesmo cuidado do Apolo): quem abre para
            cadastrar uma unidade e percebe que são trezentas precisa achar o modelo sem caçar. */}
        <button className="inc-botao inc-botao--discreto inc-foco" disabled={baixando} onClick={() => void baixar()} type="button">
          {baixando ? (
            <LoaderCircle aria-hidden="true" className="inc-cad-girando" size={15} />
          ) : (
            <Download aria-hidden="true" size={15} />
          )}
          Planilha modelo
        </button>
      </div>

      <p className="inc-form-dica" style={{ fontSize: 12 }}>
        {ROTULO_DO_TIPO_DE_PRODUTO[tipoProduto]} · as unidades entram em <b style={{ color: T.text }}>{prefixo}</b>
        {exemplo ? (
          <>
            {" "}
            com código no formato <b style={{ color: T.text }}>{exemplo}</b>
          </>
        ) : null}
        .
      </p>
      {falhaDoModelo ? <p className="inc-recado inc-recado--erro">{falhaDoModelo}</p> : null}

      <div aria-labelledby={`${id}-aba-uma`} hidden={aba !== "uma"} id={`${id}-painel-uma`} role="tabpanel">
        <UmaUnidade
          aoConcluir={aoConcluir}
          aoOcupar={setOcupadoNaUma}
          emp={emp}
          endpoint={endpoint}
          prefixo={prefixo}
          semToken={semToken}
          tipoProduto={tipoProduto}
        />
      </div>
      <div aria-labelledby={`${id}-aba-planilha`} hidden={aba !== "planilha"} id={`${id}-painel-planilha`} role="tabpanel">
        <ImportarPlanilha
          aoConcluir={aoConcluir}
          aoOcupar={setOcupadoNaPlanilha}
          emp={emp}
          endpoint={endpoint}
          prefixo={prefixo}
          semToken={semToken}
          tipoProduto={tipoProduto}
        />
      </div>
    </div>
  );
}

/**
 * O cadastro dentro de uma janela, para o botão "Adicionar unidades" da ficha. Enquanto grava, a
 * janela não fecha: fechar não cancela o envio, só esconde o resultado.
 */
export function JanelaDeCadastroDeUnidades({
  aberto,
  aoFechar,
  ...props
}: Omit<Props, "aoMudarOcupado"> & { aberto: boolean; aoFechar: () => void }) {
  const [ocupado, setOcupado] = useState(false);
  if (!aberto) return null;

  return (
    <JanelaDoCadastro
      aoFechar={aoFechar}
      bloqueada={ocupado}
      descricao={props.nomeDoProduto ? `${props.nomeDoProduto} · ${props.prefixo}` : props.prefixo}
      largura={760}
      titulo="Adicionar unidades"
    >
      <CadastroDeUnidades {...props} aoMudarOcupado={setOcupado} />
    </JanelaDoCadastro>
  );
}

// ── UMA UNIDADE ─────────────────────────────────────────────────────────────

type PropsDaAba = {
  aoConcluir: () => void;
  aoOcupar: (ocupado: boolean) => void;
  emp: string;
  endpoint: string;
  prefixo: string;
  semToken: boolean;
  tipoProduto: TipoProduto;
};

/** O campo que recebe o foco depois de gravar: o que muda de uma unidade para a próxima. */
const CAMPO_DA_PROXIMA: Record<TipoProduto, CampoDaUnidade> = { loteamento: "lote", vertical: "apartamento" };

function UmaUnidade({ aoConcluir, aoOcupar, emp, endpoint, prefixo, semToken, tipoProduto }: PropsDaAba) {
  const [campos, setCampos] = useState<CamposDaUnidade>(camposVaziosDaUnidade);
  const [tentou, setTentou] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [doServidor, setDoServidor] = useState<RetornoNoFormulario>({ avisos: {}, erros: {}, gerais: [] });
  const [mensagem, setMensagem] = useState<null | string>(null);
  const [pronto, setPronto] = useState<null | string>(null);
  const formulario = useRef<HTMLFormElement | null>(null);
  // ⚠️ O FOCO DEPOIS DA RESPOSTA ESPERA OS CAMPOS VOLTAREM. Enquanto grava, todo campo está
  // desabilitado e `.focus()` num campo desabilitado não faz nada: o foco cairia no <body>, fora da
  // janela, e o Esc e o Tab deixariam de funcionar até a pessoa clicar de novo.
  const focoPendente = useRef<CampoDaUnidade | null>(null);

  useEffect(() => {
    aoOcupar(gravando);
    if (gravando || !focoPendente.current) return;
    const campo = focoPendente.current;
    focoPendente.current = null;
    formulario.current?.querySelector<HTMLElement>(`[data-campo="${campo}"]`)?.focus();
  }, [aoOcupar, gravando]);

  const linha = linhaDoFormulario(tipoProduto, campos);
  const validacao = validarUnidade(tipoProduto, linha);
  const errosDaTela: ErrosDaUnidade = tentou && !validacao.ok ? validacao.erros : {};
  // O aviso só aparece com a unidade inteira preenchida: antes disso, "sem preço" no meio da
  // digitação é ruído, não conferência.
  const avisosDaTela: ErrosDaUnidade = validacao.ok ? validacao.avisos : {};
  const erroDe = (campo: CampoDaUnidade) => doServidor.erros[campo] ?? errosDaTela[campo] ?? null;
  const avisoDe = (campo: CampoDaUnidade) => doServidor.avisos[campo] ?? avisosDaTela[campo] ?? null;

  const codigoPrevisto = validacao.ok ? codigoDaUnidade(prefixo, tipoProduto, validacao.unidade) : "";
  const rotuloPrevisto = validacao.ok ? rotuloDaUnidade(tipoProduto, validacao.unidade) : "";

  const mudar = (campo: CampoDaUnidade, valor: string) => {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    setPronto(null);
    setDoServidor((atual) => {
      if (!atual.erros[campo] && !atual.avisos[campo] && atual.gerais.length === 0) return atual;
      const erros = { ...atual.erros };
      const avisos = { ...atual.avisos };
      delete erros[campo];
      delete avisos[campo];
      return { avisos, erros, gerais: [] };
    });
  };

  const focar = (campo: CampoDaUnidade) =>
    formulario.current?.querySelector<HTMLElement>(`[data-campo="${campo}"]`)?.focus();

  const ordem = [...camposDoFormulario(tipoProduto).map((c) => c.chave), "situacao", "motivoDoBloqueio"] as CampoDaUnidade[];

  async function gravar(evento: FormEvent) {
    evento.preventDefault();
    if (gravando) return;
    setTentou(true);
    setMensagem(null);
    setPronto(null);

    if (!validacao.ok) {
      const primeiro = ordem.find((c) => validacao.erros[c]);
      if (primeiro) focar(primeiro);
      return;
    }

    setGravando(true);
    try {
      const { corpo, status } = await chamarCadastroDeUnidades(endpoint, semToken, emp, { acao: "criar", unidade: linha });
      const lida = lerRespostaDaCriacao(status, corpo);

      if (!lida.ok) {
        const retorno = problemasNoFormulario(lida.problemas);
        setDoServidor(retorno);
        const primeiro = ordem.find((c) => retorno.erros[c]);
        focoPendente.current = primeiro ?? null;
        if (lida.mensagem) setMensagem(lida.mensagem);
        else if (!primeiro && retorno.gerais.length === 0) setMensagem("Nada foi gravado. Confira os campos e tente de novo.");
        return;
      }

      const criada = lida.unidade;
      setPronto(`${criada.rotulo || rotuloPrevisto} cadastrada (${criada.codigo}).`);
      setDoServidor({ avisos: {}, erros: {}, gerais: [] });
      setTentou(false);
      // ⚠️ A QUADRA (OU A TORRE) FICA: quem cadastra à mão cadastra em sequência, e a quadra é a
      // mesma de uma unidade para a próxima. O resto limpa, para o preço de uma não ir na outra.
      setCampos(() => ({
        ...camposVaziosDaUnidade(),
        ...(tipoProduto === "vertical" ? { torre: campos.torre } : { quadra: campos.quadra }),
      }));
      focoPendente.current = CAMPO_DA_PROXIMA[tipoProduto];
      aoConcluir();
    } catch {
      setMensagem("Sem resposta do servidor. Confira a conexão e tente de novo.");
    } finally {
      setGravando(false);
    }
  }

  const bloqueada = campos.situacao === "Bloqueada";

  return (
    <form aria-busy={gravando} noValidate onSubmit={(e) => void gravar(e)} ref={formulario} style={{ display: "grid", gap: 12 }}>
      <div className="inc-form-grade">
        {camposDoFormulario(tipoProduto).map((c) => (
          <CampoDoCadastro
            aviso={avisoDe(c.chave)}
            controle={(a) => (
              <input
                {...a}
                autoComplete="off"
                className="inc-form-campo"
                data-campo={c.chave}
                disabled={gravando}
                inputMode={c.teclado}
                onChange={(e) => mudar(c.chave, e.target.value)}
                placeholder={c.exemplo}
                value={campos[c.chave]}
              />
            )}
            dica={c.dica}
            erro={erroDe(c.chave)}
            key={c.chave}
            obrigatorio={c.obrigatoria}
            rotulo={c.rotulo}
          />
        ))}
        <CampoDoCadastro
          controle={(a) => (
            <select
              {...a}
              className="inc-form-campo"
              data-campo="situacao"
              disabled={gravando}
              onChange={(e) => mudar("situacao", e.target.value)}
              value={campos.situacao}
            >
              {SITUACOES_DO_FORMULARIO.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          dica="Reserva e venda acontecem pela tela Venda."
          erro={erroDe("situacao")}
          rotulo="Situação"
        />
        {bloqueada ? (
          <CampoDoCadastro
            aviso={avisoDe("motivoDoBloqueio")}
            classe="inc-form-inteira"
            controle={(a) => (
              <input
                {...a}
                autoComplete="off"
                className="inc-form-campo"
                data-campo="motivoDoBloqueio"
                disabled={gravando}
                maxLength={200}
                onChange={(e) => mudar("motivoDoBloqueio", e.target.value)}
                placeholder="Permuta"
                value={campos.motivoDoBloqueio}
              />
            )}
            erro={erroDe("motivoDoBloqueio")}
            rotulo="Motivo do bloqueio"
          />
        ) : null}
      </div>

      {codigoPrevisto ? (
        <p aria-live="polite" className="inc-recado inc-recado--neutro">
          Vai entrar como <b>{rotuloPrevisto}</b> · código <b>{codigoPrevisto}</b>
        </p>
      ) : null}

      {tentou && !validacao.ok ? (
        <p className="inc-recado inc-recado--erro" role="alert">
          Confira os campos marcados.
        </p>
      ) : null}
      {doServidor.gerais.length > 0 ? (
        <p className="inc-recado inc-recado--erro" role="alert">
          {doServidor.gerais.join(" ")}
        </p>
      ) : null}
      {mensagem ? (
        <p className="inc-recado inc-recado--erro" role="alert">
          {mensagem}
        </p>
      ) : null}
      {pronto ? (
        <p className="inc-recado inc-recado--ok" role="status">
          {pronto}
        </p>
      ) : null}

      <div className="inc-und-acoes">
        <button className="inc-botao inc-foco" disabled={gravando} type="submit">
          {gravando ? <LoaderCircle aria-hidden="true" className="inc-cad-girando" size={15} /> : null}
          {gravando ? "Cadastrando…" : "Cadastrar unidade"}
        </button>
        <span className="inc-form-dica">A unidade entra no Panteon e aparece na lista na hora.</span>
      </div>
    </form>
  );
}

// ── IMPORTAR PLANILHA ───────────────────────────────────────────────────────

type Fase = "concluida" | "conferida" | "conferindo" | "gravando" | "lendo" | "vazia";

type Conferencia = {
  /** Preenchido quando a rota confere mas não pode gravar (ex.: prédio com a migration pendente). */
  bloqueio: null | string;
  /** `true` só quando a ROTA conferiu: é a única conferência que enxerga o que já existe. */
  doServidor: boolean;
  linhas: LinhaConferida[];
  unidadesHoje: null | number;
};

type ResultadoDaImportacao = { avisos: ProblemaDaLinhaDeUnidade[]; unidades: UnidadeGravadaNaTela[] };

type Filtro = "todas" | EstadoDaLinha;

const ROTULO_DO_ESTADO: Record<EstadoDaLinha, string> = {
  aviso: "Entra com aviso",
  erro: "Não entra",
  ok: "Entra",
};

function ImportarPlanilha({ aoConcluir, aoOcupar, emp, endpoint, prefixo, semToken, tipoProduto }: PropsDaAba) {
  const [fase, setFase] = useState<Fase>("vazia");
  const [arquivo, setArquivo] = useState<null | string>(null);
  const [brutas, setBrutas] = useState<LinhaDaPlanilhaDeUnidades[]>([]);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaImportacao | null>(null);
  const [mensagem, setMensagem] = useState<null | string>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const seletor = useRef<HTMLInputElement | null>(null);
  const resumo = useRef<HTMLElement | null>(null);

  const gravando = fase === "gravando";
  useEffect(() => {
    aoOcupar(gravando);
  }, [aoOcupar, gravando]);

  // O botão de cadastrar some quando o envio começa, e o foco iria junto para o <body>. No fim, o
  // foco vai para o resumo: é ali que o leitor de tela precisa começar a ler.
  useEffect(() => {
    if (fase === "concluida") resumo.current?.focus();
  }, [fase]);

  const colunas = colunasDaPlanilha(tipoProduto);

  function recomecar() {
    setFase("vazia");
    setArquivo(null);
    setBrutas([]);
    setConferencia(null);
    setResultado(null);
    setMensagem(null);
    setFiltro("todas");
    if (seletor.current) seletor.current.value = "";
  }

  async function escolher(file: File) {
    recomecar();
    setArquivo(file.name);
    setFase("lendo");

    let lidas: LinhaDaPlanilhaDeUnidades[];
    try {
      lidas = await lerPlanilhaDeUnidades(tipoProduto, file);
    } catch (erro) {
      setMensagem(
        erro instanceof FormatoRecusado
          ? erro.message
          : "Não consegui ler o arquivo. Use a planilha modelo, ou um .xlsx ou .csv simples.",
      );
      setFase("vazia");
      return;
    }

    if (lidas.length === 0) {
      setMensagem(
        "Não achei nenhuma linha com dados. A primeira linha precisa ser o cabeçalho com os nomes das colunas, como na planilha modelo.",
      );
      setFase("vazia");
      return;
    }
    setBrutas(lidas);

    // A conferência da TELA aparece na hora (formato, obrigatórios, repetidas dentro da planilha),
    // e a da ROTA vem por cima com o que já existe no produto.
    const local = conferirPlanilhaDeUnidades(tipoProduto, lidas, { prefixo });
    const linhasLocais = linhasConferidas(tipoProduto, prefixo, lidas, local);
    setConferencia({ bloqueio: null, doServidor: false, linhas: linhasLocais, unidadesHoje: null });

    // ⚠️ O TETO VEM ANTES DA REDE: a rota recusa acima dele, e o botão ficaria apagado sem motivo.
    if (lidas.length > MAXIMO_DE_UNIDADES_POR_ENVIO) {
      setMensagem(
        `A planilha tem ${lidas.length} linhas. Envie no máximo ${MAXIMO_DE_UNIDADES_POR_ENVIO} por vez: divida por quadra ou por torre e importe cada parte.`,
      );
      setFase("conferida");
      return;
    }

    if (contagemDaConferencia(linhasLocais).prontas === 0) {
      setFase("conferida");
      return;
    }

    setFase("conferindo");
    try {
      const { corpo, status } = await chamarCadastroDeUnidades(endpoint, semToken, emp, { acao: "conferir", linhas: lidas });
      const lida = lerRespostaDaConferencia(status, corpo);
      if (!lida.ok) {
        setMensagem(`${lida.mensagem} Sem a conferência com o cadastro, nada é gravado.`);
      } else {
        setConferencia({
          bloqueio: lida.bloqueioDaGravacao,
          doServidor: true,
          linhas: linhasDaConferenciaDaRota(tipoProduto, prefixo, lidas, lida.linhas),
          unidadesHoje: lida.unidadesHoje,
        });
      }
    } catch {
      setMensagem("Sem resposta do servidor para conferir a planilha. Confira a conexão e escolha o arquivo de novo.");
    } finally {
      setFase("conferida");
    }
  }

  async function gravar() {
    if (!conferencia?.doServidor || conferencia.bloqueio) return;
    if (contagemDaConferencia(conferencia.linhas).erro > 0) return;

    setMensagem(null);
    setFase("gravando");
    try {
      // A planilha INTEIRA, as mesmas linhas conferidas: a rota confere de novo e grava num insert só.
      const { corpo, status } = await chamarCadastroDeUnidades(endpoint, semToken, emp, { acao: "importar", linhas: brutas });
      const lida = lerRespostaDaImportacao(status, corpo);

      if (lida.ok) {
        setResultado({ avisos: lida.avisos, unidades: lida.unidades });
        setFase("concluida");
        if (lida.unidades.length > 0) aoConcluir();
        return;
      }

      // Nada entrou. Se a rota refez a conferência (alguém cadastrou a mesma unidade entre a
      // conferência e o clique), a tabela volta a mostrar o motivo por linha. Em qualquer caso o
      // botão só volta a acender com uma conferência nova.
      setConferencia({
        bloqueio: null,
        doServidor: false,
        linhas: lida.linhas ? linhasDaConferenciaDaRota(tipoProduto, prefixo, brutas, lida.linhas) : conferencia.linhas,
        unidadesHoje: conferencia.unidadesHoje,
      });
      setMensagem(
        lida.faltando.length > 0
          ? `${lida.mensagem} Não apareceram: ${lida.faltando.join(", ")}.`
          : `${lida.mensagem} Escolha o arquivo de novo para conferir.`,
      );
      setFase("conferida");
    } catch {
      setConferencia({ ...conferencia, doServidor: false });
      setMensagem("Sem resposta do servidor. Confira a lista do produto antes de escolher o arquivo de novo.");
      setFase("conferida");
    }
  }

  const linhas = conferencia?.linhas ?? [];
  const contagem = contagemDaConferencia(linhas);
  const visiveis = filtro === "todas" ? linhas : linhas.filter((l) => l.estado === filtro);
  // ⚠️ TUDO OU NADA NA TELA TAMBÉM: com uma linha que não entra, a rota recusaria a planilha inteira.
  const podeGravar =
    fase === "conferida" &&
    Boolean(conferencia?.doServidor) &&
    !conferencia?.bloqueio &&
    contagem.erro === 0 &&
    contagem.prontas > 0;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* ── O ARQUIVO ────────────────────────────────────────────────────── */}
      <section className="inc-caixa" style={{ display: "grid", gap: 8 }}>
        <div className="inc-und-acoes">
          <label className="inc-botao inc-arquivo" style={gravando ? { opacity: 0.5, pointerEvents: "none" } : undefined}>
            <Upload aria-hidden="true" size={15} />
            {arquivo ? "Escolher outra planilha" : "Escolher planilha"}
            <input
              accept=".xlsx,.csv"
              className="inc-so-leitor"
              disabled={gravando}
              onChange={(e) => {
                const escolhido = e.target.files?.[0];
                if (escolhido) void escolher(escolhido);
              }}
              ref={seletor}
              type="file"
            />
          </label>
          {arquivo ? <span className="inc-form-dica">{arquivo}</span> : null}
        </div>
        <p className="inc-form-dica">
          Colunas: {colunas.map(cabecalhoDaColuna).join(" · ")}. As com * são obrigatórias. A planilha entra
          inteira ou não entra: uma linha com erro segura as outras; linha com aviso entra e o aviso fica à vista
          aqui. Até {MAXIMO_DE_UNIDADES_POR_ENVIO} linhas por arquivo.
        </p>
      </section>

      <div aria-live="polite">
        {fase === "lendo" ? <p className="inc-recado inc-recado--neutro">Lendo a planilha…</p> : null}
        {fase === "conferindo" ? (
          <p className="inc-recado inc-recado--neutro">Conferindo com as unidades que já existem no produto…</p>
        ) : null}
      </div>

      {mensagem ? (
        <p className="inc-recado inc-recado--erro" role="alert">
          {mensagem}
        </p>
      ) : null}

      {/* ── A CONFERÊNCIA, antes de qualquer escrita ─────────────────────── */}
      {conferencia && fase !== "concluida" ? (
        <section style={{ display: "grid", gap: 10 }}>
          <div className="inc-caixa inc-und-numeros">
            <Numero rotulo="Linhas" valor={contagem.total} />
            <Numero rotulo="Entram" tom="ok" valor={contagem.prontas} />
            <Numero rotulo="Com aviso" tom={contagem.aviso ? "aviso" : undefined} valor={contagem.aviso} />
            <Numero rotulo="Não entram" tom={contagem.erro ? "erro" : undefined} valor={contagem.erro} />
            {conferencia.unidadesHoje !== null ? <Numero rotulo="No produto hoje" valor={conferencia.unidadesHoje} /> : null}
          </div>

          {!conferencia.doServidor && fase === "conferida" && contagem.prontas === 0 ? (
            <p className="inc-recado inc-recado--neutro">
              Nenhuma linha pode entrar. Corrija a planilha e escolha o arquivo de novo.
            </p>
          ) : conferencia.doServidor && contagem.erro > 0 ? (
            <p className="inc-recado inc-recado--neutro">
              A planilha entra inteira ou não entra. Corrija {contagem.erro === 1 ? "a linha que não entra" : `as ${contagem.erro} linhas que não entram`} e
              escolha o arquivo de novo.
            </p>
          ) : null}
          {conferencia.bloqueio ? (
            <p className="inc-recado inc-recado--erro" role="alert">
              {conferencia.bloqueio}
            </p>
          ) : null}

          <FiltroEListaDeLinhas filtro={filtro} linhas={linhas} setFiltro={setFiltro} visiveis={visiveis} contagem={contagem} />

          <div className="inc-und-acoes">
            <button className="inc-botao inc-foco" disabled={!podeGravar} onClick={() => void gravar()} type="button">
              {gravando ? (
                <LoaderCircle aria-hidden="true" className="inc-cad-girando" size={15} />
              ) : (
                <Upload aria-hidden="true" size={15} />
              )}
              {gravando
                ? "Cadastrando…"
                : contagem.prontas === 1
                  ? "Cadastrar 1 unidade"
                  : `Cadastrar ${contagem.prontas} unidades`}
            </button>
            <button className="inc-botao inc-botao--discreto inc-foco" disabled={gravando} onClick={recomecar} type="button">
              Descartar
            </button>
            {gravando ? (
              <span aria-live="polite" className="inc-form-dica" style={{ fontSize: 12 }}>
                Não feche esta tela.
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── O RESULTADO, conferido no banco ──────────────────────────────── */}
      {fase === "concluida" && resultado ? (
        <Resumo aoRecomecar={recomecar} referencia={resumo} resultado={resultado} />
      ) : null}
    </div>
  );
}

function FiltroEListaDeLinhas({
  contagem,
  filtro,
  linhas,
  setFiltro,
  visiveis,
}: {
  contagem: ReturnType<typeof contagemDaConferencia>;
  filtro: Filtro;
  linhas: readonly LinhaConferida[];
  setFiltro: (f: Filtro) => void;
  visiveis: readonly LinhaConferida[];
}) {
  const opcoes: { chave: Filtro; rotulo: string; total: number }[] = [
    { chave: "todas", rotulo: "Todas", total: contagem.total },
    { chave: "erro", rotulo: "Não entram", total: contagem.erro },
    { chave: "aviso", rotulo: "Com aviso", total: contagem.aviso },
    { chave: "ok", rotulo: "Entram sem aviso", total: contagem.ok },
  ];

  if (linhas.length === 0) return null;

  return (
    <>
      <div aria-label="Mostrar linhas" className="inc-und-filtros" role="group">
        {opcoes.map((o) => (
          <button
            aria-pressed={filtro === o.chave}
            className="inc-und-filtro inc-foco"
            disabled={o.chave !== "todas" && o.total === 0}
            key={o.chave}
            onClick={() => setFiltro(o.chave)}
            type="button"
          >
            {o.rotulo} ({o.total})
          </button>
        ))}
      </div>
      <div className="inc-und-tabela-caixa">
        <table className="inc-und-tabela">
          <thead>
            <tr>
              <th scope="col">Linha</th>
              <th scope="col">Unidade</th>
              <th scope="col">Código</th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((l) => (
              <tr key={l.linha}>
                <td className="inc-und-col-linha">
                  <span className="inc-und-so-celular">Linha </span>
                  {l.linha}
                  {l.codigo ? <span className="inc-und-so-celular"> · {l.codigo}</span> : null}
                </td>
                <td className="inc-und-col-unidade">
                  {l.rotulo ? l.rotulo : <span className="inc-und-sem-nome">sem identificação</span>}
                  {l.mensagens.length > 0 ? (
                    <ul className="inc-und-motivos">
                      {l.mensagens.map((m, i) => (
                        <li className={m.soAviso ? "inc-und-motivo--aviso" : "inc-und-motivo--erro"} key={`${m.campo}-${i}`}>
                          {m.motivo}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="inc-und-col-codigo">{l.codigo}</td>
                <td className="inc-und-col-resultado">
                  <span className={`inc-und-selo inc-und-selo--${l.estado}`}>{ROTULO_DO_ESTADO[l.estado]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Resumo({
  aoRecomecar,
  referencia,
  resultado,
}: {
  aoRecomecar: () => void;
  referencia: RefObject<HTMLElement | null>;
  resultado: ResultadoDaImportacao;
}) {
  const criadas = resultado.unidades.length;

  return (
    <section
      aria-label="Resultado do cadastro"
      className="inc-caixa"
      ref={referencia}
      style={{ display: "grid", gap: 10, outline: "none" }}
      tabIndex={-1}
    >
      <div className="inc-und-numeros">
        <Numero rotulo="Cadastradas" tom="ok" valor={criadas} />
        <Numero rotulo="Com aviso" tom={resultado.avisos.length ? "aviso" : undefined} valor={new Set(resultado.avisos.map((a) => a.linha)).size} />
      </div>

      {/* ⚠️ O BANCO É A PROVA: a rota relê pelo código cada unidade gravada, e só responde sucesso
          quando achou todas. O número aqui é o que voltou dessa releitura, não o que foi enviado. */}
      <p className="inc-recado inc-recado--ok" role="status">
        {criadas === 1 ? "1 unidade conferida no cadastro" : `${criadas} unidades conferidas no cadastro`} depois da gravação.
      </p>

      {resultado.avisos.length > 0 ? (
        <ul className="inc-und-motivos" style={{ maxHeight: 200, overflow: "auto" }}>
          {resultado.avisos.map((a, i) => (
            <li className="inc-und-motivo--aviso" key={`${a.linha}-${a.campo}-${i}`}>
              Linha {a.linha}: {a.motivo}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="inc-und-acoes">
        <button className="inc-botao inc-botao--discreto inc-foco" onClick={aoRecomecar} type="button">
          Importar outra planilha
        </button>
      </div>
    </section>
  );
}

function Numero({ rotulo, tom, valor }: { rotulo: string; tom?: "aviso" | "erro" | "ok"; valor: number }) {
  const cor = tom === "ok" ? T.ok : tom === "erro" ? T.danger : tom === "aviso" ? T.gold : T.text;
  return (
    <div style={{ minWidth: 84 }}>
      <div className="inc-form-rotulo">{rotulo}</div>
      <div className="inc-und-numero-valor" style={{ color: cor }}>
        {valor}
      </div>
    </div>
  );
}

// ── A PLANILHA NO NAVEGADOR ─────────────────────────────────────────────────

class FormatoRecusado extends Error {}

async function textoDoArquivo(arquivo: File): Promise<string> {
  if (typeof arquivo.text === "function") return arquivo.text();
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result ?? ""));
    leitor.onerror = () => reject(leitor.error);
    leitor.readAsText(arquivo);
  });
}

/**
 * Lê a planilha NO NAVEGADOR e devolve as linhas com as chaves da validação.
 *
 * ⚠️ O ARQUIVO NÃO SOBE (o mesmo cuidado do Apolo): só as linhas vão em JSON. Uma planilha de 300
 * lotes tem uns 30KB de dados e passa fácil de 1MB com a formatação, e a Vercel recusa corpo grande
 * com 413. O `exceljs` entra por import dinâmico, para não pesar em quem nunca importa.
 */
async function lerPlanilhaDeUnidades(tipo: TipoProduto, arquivo: File): Promise<LinhaDaPlanilhaDeUnidades[]> {
  const nome = arquivo.name.toLowerCase();

  if (nome.endsWith(".csv")) return lerCsvDeUnidades(tipo, await textoDoArquivo(arquivo));
  if (!nome.endsWith(".xlsx")) {
    throw new FormatoRecusado("Formato não aceito. Use .xlsx (Excel) ou .csv. Arquivo .xls antigo: salve de novo como .xlsx.");
  }

  const ExcelJS = (await import("exceljs")).default;
  const livro = new ExcelJS.Workbook();
  await livro.xlsx.load(await arquivo.arrayBuffer());

  // A aba "Unidades" da planilha modelo; sem ela (planilha feita à mão), a primeira.
  const aba = livro.getWorksheet("Unidades") ?? livro.worksheets[0];
  if (!aba) return [];

  const chaves: ("" | CampoDaUnidade)[] = [];
  aba.getRow(1).eachCell((celula, coluna) => {
    chaves[coluna] = chaveDaColunaDeUnidades(tipo, String(celula.text ?? ""));
  });

  const linhas: LinhaDaPlanilhaDeUnidades[] = [];
  aba.eachRow((linha, numero) => {
    if (numero === 1) return;
    const registro: LinhaDaPlanilhaDeUnidades = {};
    linha.eachCell((celula, coluna) => {
      const chave = chaves[coluna];
      if (chave) registro[chave] = valorDaCelula(celula.value, celula.text);
    });
    if (linhaTemConteudo(registro)) linhas.push(registro);
  });
  return linhas;
}

/**
 * Baixa a planilha modelo do TIPO do produto, com a aba "Como preencher".
 *
 * ⚠️ AS COLUNAS SAEM DA MESMA CONSTANTE QUE A VALIDAÇÃO LÊ (`colunasDaPlanilha`), e as de quadra,
 * lote, torre, apartamento e matrícula vão como TEXTO: numa célula de número, "01" vira 1 e
 * "0304" vira 304 antes de a pessoa perceber (a régua iguala os dois, mas a matrícula "025.862"
 * perderia o zero).
 */
async function baixarModelo(tipo: TipoProduto, prefixo: string, nome?: string) {
  const ExcelJS = (await import("exceljs")).default;
  const livro = new ExcelJS.Workbook();
  const colunas = colunasDaPlanilha(tipo);

  const aba = livro.addWorksheet("Unidades", { views: [{ state: "frozen", ySplit: 1 }] });
  aba.columns = colunas.map((c) => ({
    header: cabecalhoDaColuna(c),
    key: c.chave,
    style: COLUNAS_DE_TEXTO.has(c.chave) ? { numFmt: "@" } : {},
    width: Math.max(14, c.rotulo.length + 6),
  }));
  aba.getRow(1).font = { bold: true };
  aba.getRow(1).fill = { fgColor: { argb: "FFEFEFEF" }, pattern: "solid", type: "pattern" };

  const ajuda = livro.addWorksheet("Como preencher");
  ajuda.columns = [{ width: 26 }, { width: 90 }];
  for (const [coluna, texto] of instrucoesDoModelo(tipo, { codigo: prefixo, nome })) {
    const linha = ajuda.addRow([coluna, texto]);
    if (coluna === "Coluna" || coluna === "Exemplo de linha") linha.font = { bold: true };
  }

  const buffer = await livro.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = nomeDoArquivoDoModelo(prefixo, tipo);
  link.href = url;
  // No documento: o Firefox ignora o clique num link solto. E o endereço só é liberado depois,
  // porque revogar na mesma volta cancela o download em alguns navegadores.
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
