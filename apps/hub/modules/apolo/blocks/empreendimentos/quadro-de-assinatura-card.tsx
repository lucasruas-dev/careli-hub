"use client";

import { Check, FileSignature, Loader2, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import type {
  AssinanteDoQuadro,
  PapelDoQuadro,
} from "@/app/api/temis/assinantes/route";
import { useApiDaTemis } from "@/modules/temis/api-da-temis";

// O QUADRO DE ASSINATURA DO EMPREENDIMENTO — quem assina, além do comprador.
//
// Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante (...) Testemunha a mesma
// coisa, e coordenador de vendas a mesma coisa, eu posso ter mais de um como coordenador"*.
//
// ⚠️ FORA DO CARD DE ORDEM, e isso foi pedido: *"mesmo desligado, eu tenho que cadastrar as
// testemunha"*. O card "Assinam em ordem" apaga a lista inteira quando está desligado — que é como
// os contratos saem hoje. O cadastro lá dentro sumiria justamente na configuração em uso.
//
// ⚠️ "COORDENADOR DE VENDAS" É A PESSOA; a EMPRESA é a "Coordenação de Vendas", e ela não mora
// aqui — vem do cadastro do empreendimento e sai no texto do contrato com CNPJ e endereço. Trocar
// essas duas palavras já custou caro uma vez: o Panteon tinha pendurado como representante da
// coordenação o CAPTADOR, que é outro campo e outra pessoa.
//
// ⚠️ A PORTA É A DA TÊMIS (`useApiDaTemis`, revisão da onda 3, achado 21). No hub, sem provedor, as
// chamadas saem como sempre: `/api/temis/assinantes` com o Bearer do hub. Dentro do
// `ApiDaTemisProvider` do portal que confecciona (a aba Minutas do produto), saem por
// `/api/incorporador/temis/assinantes` com o cookie do portal, e a rota de lá recorta pelo escopo e
// pelo produto que o portal opera.
//
// ⚠️ SEM CADEADO, E TODA LINHA SE EDITA E SE EXCLUI (25/09/2026). Até esta data o cartão mostrava o
// representante legal da empresa (lido da ficha, sem id) com um cadeado "do cadastro", e ele
// aparecia na linha 1 do papel mesmo quando o envio não o levava: no VOR a tela mostrava o Fabricio
// e o contrato saía sem ele. Lucas: *"todas assinaturas eu tenho que conseguir excluir e editar,
// esse cadeado esta errado"*. O servidor passou a devolver só o que está gravado (a migration 0191
// gravou quem era herdado), e cada linha ganhou lápis e lixeira.

type Bloco = { ajuda: string; papel: PapelDoQuadro; titulo: string };

const BLOCOS: Bloco[] = [
  {
    ajuda: "Quem assina pela empresa vendedora. Pode ser mais de um, e todos assinam.",
    papel: "vendedora",
    titulo: "Vendedora",
  },
  {
    ajuda:
      "Quem coordena a venda deste empreendimento. Pode ser mais de um, e todos assinam.",
    papel: "coordenador",
    titulo: "Coordenador de Vendas",
  },
  {
    ajuda:
      "Testemunham um documento já assinado pelas partes, por isso costumam assinar por último.",
    papel: "testemunha",
    titulo: "Testemunhas",
  },
];

// ⚠️ SEPARADO DOS TRÊS DE CIMA, E NÃO UM QUARTO ITEM DA LISTA. Os três primeiros assinam o CONTRATO
// de venda: o nome deles sai impresso na qualificação e o jurídico confere contra a procuração.
// Este assina os TERMOS que a Careli emite sobre a carteira (hoje o termo de acordo do Hades) e não
// entra em contrato nenhum. Enfileirá-lo no mesmo `map` faria a tela apresentar as duas coisas como
// se fossem a mesma, que é justamente a confusão que o papel novo existe para desfazer.
const BLOCO_DOS_TERMOS: Bloco = {
  ajuda:
    "Quem a incorporadora aponta para assinar os termos da carteira pela vendedora. Não precisa ser o representante legal: pode ser alguém do jurídico, um analista, quem ela indicar.",
  papel: "termos_vendedora",
  titulo: "Assinatura de termos (vendedora)",
};

const RASCUNHO = { cpf: "", email: "", nome: "", ordemAssinatura: "", posicao: "" };

/** A linha aberta no lápis: os campos como texto, do jeito que a tela os edita. */
type Edicao = typeof RASCUNHO & { id: string; papel: PapelDoQuadro };

/** De onde veio a pessoa que a caixa dos termos mostra. Ver `filaDosTermos`. */
type OrigemDosTermos = "apontado" | "ninguem" | "vendedora";

/**
 * QUEM ASSINA OS TERMOS HOJE, na MESMA ordem que o envio usa — e é por isso que ela existe.
 *
 * O envio do termo de acordo (`lib/hades/acordo/envio-db.ts`) escolhe assim:
 *
 *     apontado para TERMOS  →  quem está no bloco Vendedora
 *
 * ⚠️ A CAIXA DESCREVIA OUTRA QUEDA, E ISSO É CARO (revisão de 20/09/2026). Ela prometia o
 * representante legal da empresa e o bloqueio do envio, e as duas coisas viravam mentira no instante
 * em que alguém preenchia o bloco Vendedora: quem recebe o convite passa a ser a pessoa do CONTRATO.
 * Envelope é pago, não se apaga e chega na caixa do cliente: o nome lido antes de clicar tem de ser
 * o nome que assina.
 *
 * ⚠️ ERAM TRÊS DEGRAUS ATÉ 25/09/2026. O terceiro era o representante legal herdado da ficha da
 * empresa, que o servidor mandava como linha sem id. A herança saiu das duas pontas (o quadro é a
 * única fonte de quem assina), e a fila ficou com os dois degraus que existem na tabela.
 */
function filaDosTermos(lista: AssinanteDoQuadro[]): {
  linhas: AssinanteDoQuadro[];
  origem: OrigemDosTermos;
} {
  const porPosicao = (a: AssinanteDoQuadro, b: AssinanteDoQuadro) => a.posicao - b.posicao;

  const apontados = lista.filter((a) => a.papel === "termos_vendedora").sort(porPosicao);
  if (apontados.length > 0) return { linhas: apontados, origem: "apontado" };

  const doBlocoVendedora = lista.filter((a) => a.papel === "vendedora").sort(porPosicao)[0];
  if (doBlocoVendedora) return { linhas: [doBlocoVendedora], origem: "vendedora" };

  return { linhas: [], origem: "ninguem" };
}

export function QuadroDeAssinaturaCard({
  comAssinantesDeTermos = false,
  enterpriseId,
}: {
  /**
   * Mostra o campo de quem assina os TERMOS pela vendedora.
   *
   * ⚠️ NASCE DESLIGADO, E ISSO É O PORTAL. Lucas (20/09/2026) pediu o campo em *"essa tela"* — a do
   * empreendimento no Apolo, onde a Careli monta o quadro. Este mesmo cartão é a tela de minutas do
   * portal da Cecílio, e o termo de acordo é instrumento da COBRANÇA da Careli: ligá-lo lá poria,
   * numa tela sobre confecção de contrato, um campo sobre um documento que aquela equipe não emite.
   *
   * ⚠️ E ESCONDER NÃO É FECHAR: QUEM FECHA É O SERVIDOR. As duas portas do quadro chamam as MESMAS
   * `incluirAssinante`, `editarAssinante` e `removerAssinante`, então esta propriedade só governa o
   * que se VÊ. A recusa do papel `termos_vendedora` para o ator do portal mora em
   * `PAPEL_SO_DA_CARELI` (`lib/temis/estrutura-servico.ts`); ligar o campo lá um dia é mudar as duas
   * coisas, não uma.
   */
  comAssinantesDeTermos?: boolean;
  enterpriseId: string;
}) {
  const [lista, setLista] = useState<AssinanteDoQuadro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<null | PapelDoQuadro>(null);
  const [erro, setErro] = useState<null | string>(null);
  /**
   * De qual bloco é a frase de erro, ou `null` quando ela é do cartão inteiro (falha de leitura).
   *
   * ⚠️ ERRO SEM ENDEREÇO É ERRO QUE NINGUÉM LÊ. São quatro blocos empilhados e uma frase só no topo:
   * quem clicou Incluir na caixa dos termos, que é a última, não via a recusa do servidor.
   */
  const [papelDoErro, setPapelDoErro] = useState<null | PapelDoQuadro>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, typeof RASCUNHO>>({});
  /**
   * A linha aberta no lápis, ou `null`. UMA de cada vez: duas edições abertas no mesmo papel são
   * duas gravações disputando a mesma trava de linha, e a segunda recusaria sem o operador entender.
   */
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const { temisFetch } = useApiDaTemis();

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await temisFetch(`/assinantes?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
        cache: "no-store",
      });
      const corpo = (await r.json()) as { assinantes?: AssinanteDoQuadro[]; error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao ler o quadro.");
      setLista(corpo.assinantes ?? []);
      setErro(null);
      setPapelDoErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler o quadro.");
      setPapelDoErro(null);
    } finally {
      setCarregando(false);
    }
  }, [enterpriseId, temisFetch]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const doPapel = (papel: PapelDoQuadro) => lista.filter((a) => a.papel === papel);

  /**
   * ⚠️ O CAMPO LINHA NASCE PREENCHIDO, e até 22/09/2026 o número ali era só um PLACEHOLDER cinza.
   * O campo ia vazio, e vazio significava "a próxima livre" só na hora de gravar — então a tela
   * mostrava o número certo e aceitava qualquer número repetido por cima. Nívea, 22/09/2026, depois
   * de digitar 4 numa linha que já era da YASMIN: *"Ele nao esta aceitando 02 testemunhas"*. Nos
   * logs do Postgres daquela madrugada são QUATRO recusas, todas da mesma constraint de posição.
   *
   * Agora o rascunho de cada papel já vem com a próxima linha livre assim que a lista chega, e
   * quem quiser outra troca o número de propósito.
   */
  useEffect(() => {
    if (carregando) return;
    setRascunhos((atuais) => {
      let mudou = false;
      const novos = { ...atuais };
      for (const bloco of [...BLOCOS, BLOCO_DOS_TERMOS]) {
        const atual = novos[bloco.papel] ?? RASCUNHO;
        if (atual.posicao) continue;
        const proxima = String(proximaPosicao(lista.filter((a) => a.papel === bloco.papel)));
        novos[bloco.papel] = { ...atual, posicao: proxima };
        mudou = true;
      }
      return mudou ? novos : atuais;
    });
  }, [carregando, lista]);

  const rascunho = (papel: PapelDoQuadro) => rascunhos[papel] ?? RASCUNHO;

  function mexer(papel: PapelDoQuadro, campo: keyof typeof RASCUNHO, valor: string) {
    setRascunhos((r) => ({ ...r, [papel]: { ...rascunho(papel), [campo]: valor } }));
  }

  async function adicionar(papel: PapelDoQuadro) {
    const atual = rascunho(papel);
    setSalvando(papel);
    setErro(null);
    setPapelDoErro(null);
    try {
      const r = await temisFetch("/assinantes", {
        body: JSON.stringify({
          cpf: atual.cpf,
          email: atual.email,
          enterpriseId,
          nome: atual.nome,
          ordemAssinatura: atual.ordemAssinatura,
          papel,
          posicao: atual.posicao || String(proximaPosicao(doPapel(papel))),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao gravar.");
      setRascunhos((x) => ({ ...x, [papel]: RASCUNHO }));
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.");
      setPapelDoErro(papel);
    } finally {
      setSalvando(null);
    }
  }

  async function remover(id: string, papel: PapelDoQuadro) {
    setErro(null);
    setPapelDoErro(null);
    try {
      const r = await temisFetch(`/assinantes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!r.ok) {
        const corpo = (await r.json()) as { error?: string };
        throw new Error(corpo.error ?? "Falha ao remover.");
      }
      if (edicao?.id === id) setEdicao(null);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao remover.");
      setPapelDoErro(papel);
    }
  }

  function abrirEdicao(a: AssinanteDoQuadro) {
    setErro(null);
    setPapelDoErro(null);
    setEdicao({
      // ⚠️ O CPF VAI COMO A TELA O RECEBEU. No portal ele chega mascarado (`***.***.***-NN`), e o
      // servidor lê o `*` como "manter o gravado": quem não mexe no campo não apaga o documento.
      cpf: a.cpf ?? "",
      email: a.email ?? "",
      id: a.id,
      nome: a.nome,
      ordemAssinatura: a.ordemAssinatura == null ? "" : String(a.ordemAssinatura),
      papel: a.papel,
      posicao: String(a.posicao),
    });
  }

  function mexerNaEdicao(campo: keyof typeof RASCUNHO, valor: string) {
    setEdicao((atual) => (atual ? { ...atual, [campo]: valor } : atual));
  }

  /**
   * Grava a linha aberta no lápis.
   *
   * ⚠️ OS TERMOS NÃO MANDAM LINHA NEM ASSINA EM, pelo mesmo motivo que não os oferecem (ver
   * `secaoDoBloco`). O servidor mantém o que não vem, então a posição do apontado não muda por uma
   * edição de e-mail.
   */
  async function salvarEdicao() {
    if (!edicao) return;
    const doContrato = edicao.papel !== "termos_vendedora";
    setSalvandoEdicao(true);
    setErro(null);
    setPapelDoErro(null);
    try {
      const r = await temisFetch(`/assinantes?id=${encodeURIComponent(edicao.id)}`, {
        body: JSON.stringify({
          cpf: edicao.cpf,
          email: edicao.email,
          nome: edicao.nome,
          ...(doContrato
            ? { ordemAssinatura: edicao.ordemAssinatura, posicao: edicao.posicao }
            : {}),
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao gravar a edição.");
      setEdicao(null);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar a edição.");
      setPapelDoErro(edicao.papel);
    } finally {
      setSalvandoEdicao(false);
    }
  }

  function teclaDaEdicao(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void salvarEdicao();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEdicao(null);
    }
  }

  /**
   * A testemunha vai assinar ANTES de alguem que ela deveria testemunhar?
   *
   * ⚠️ A TESTEMUNHA TESTEMUNHA UM DOCUMENTO JÁ ASSINADO, e é o que o próprio texto de ajuda do
   * bloco diz. No VOC a única testemunha ficou com "Assina em 1", que a põe junto com a vendedora
   * e o comprador — e a ordem está LIGADA naquele produto, então o convite sai assim. O quadro não
   * conhece a ordem do comprador (ele vem da proposta), mas conhece a dos outros papéis: se a
   * testemunha tem número menor ou igual ao de alguem de outro papel, ela assina antes.
   */
  function testemunhaNaFrente(): null | string {
    const ordem = (a: AssinanteDoQuadro) => a.ordemAssinatura ?? null;
    const testemunhas = lista.filter((a) => a.papel === "testemunha" && ordem(a) !== null);
    const outros = lista.filter((a) => a.papel !== "testemunha" && ordem(a) !== null);
    if (testemunhas.length === 0 || outros.length === 0) return null;

    const maiorDosOutros = Math.max(...outros.map((a) => ordem(a) as number));
    const adiantada = testemunhas.find((a) => (ordem(a) as number) <= maiorDosOutros);
    if (!adiantada) return null;
    return (
      `${adiantada.nome} assina em ${String(ordem(adiantada))}, junto ou antes de quem ela testemunha. ` +
      "Testemunha costuma assinar por último: deixe o campo Assina em vazio, ou ponha um número maior."
    );
  }

  /**
   * Os campos da linha aberta no lápis, no lugar do nome e do e-mail.
   *
   * ⚠️ RÓTULO POR `aria-label`, E NÃO `<label><span>` COMO NO INCLUIR. O formulário de incluir do
   * mesmo bloco continua na tela durante a edição, e dois "Nome completo" com a mesma forma no mesmo
   * bloco fariam quem lê a tela (e quem a testa) digitar no campo errado.
   */
  function camposDaEdicao(e: Edicao, doContrato: boolean) {
    const entrada = "h-8 min-w-0 rounded-lg border border-line bg-surface px-2 text-ink text-sm";
    return (
      <div
        className="flex min-w-0 flex-1 basis-full flex-wrap items-center gap-1.5 sm:basis-auto"
        onKeyDown={teclaDaEdicao}
      >
        <input
          aria-label="Nome completo"
          className={`${entrada} flex-1 basis-40`}
          onChange={(ev) => mexerNaEdicao("nome", ev.target.value)}
          placeholder="Nome completo"
          value={e.nome}
        />
        <input
          aria-label="CPF"
          className={`${entrada} w-32`}
          onChange={(ev) => mexerNaEdicao("cpf", ev.target.value)}
          placeholder="CPF"
          value={e.cpf}
        />
        <input
          aria-label="E-mail"
          className={`${entrada} flex-1 basis-40`}
          onChange={(ev) => mexerNaEdicao("email", ev.target.value)}
          placeholder="E-mail"
          value={e.email}
        />
        {doContrato ? (
          <>
            <input
              aria-label="Linha"
              className={`${entrada} w-14 text-center`}
              inputMode="numeric"
              onChange={(ev) => mexerNaEdicao("posicao", ev.target.value)}
              title="A linha do contrato em que esta pessoa aparece."
              value={e.posicao}
            />
            <input
              aria-label="Assina em"
              className={`${entrada} w-16 text-center`}
              inputMode="numeric"
              onChange={(ev) => mexerNaEdicao("ordemAssinatura", ev.target.value)}
              placeholder="-"
              title="Quando ela assina. Em branco, segue a ordem do papel."
              value={e.ordemAssinatura}
            />
          </>
        ) : null}
      </div>
    );
  }

  /**
   * Uma seção do quadro: a lista de quem já está lá, e a linha para incluir mais um.
   *
   * ⚠️ UMA FUNÇÃO, E NÃO O CORPO DO `map`, porque a seção dos TERMOS usa exatamente os mesmos campos
   * dos três papéis do contrato. Lucas pediu *"mais um campo"* nesta tela, e um campo novo com outra
   * cara é um campo que o operador aprende de novo. Copiar este JSX faria a cópia envelhecer calada
   * no primeiro ajuste.
   *
   * ⚠️ E O QUE MUDA NOS TERMOS É SÓ O QUE SERIA MENTIRA. "Linha" é qual linha do CONTRATO é da
   * pessoa e "Assina em" é a ordem dentro do papel: o termo de acordo não tem linhas de
   * qualificação e tem fila fixa (comprador, incorporador, Careli). Oferecer os dois campos ali
   * prometeria um controle que o envio ignora.
   */
  function secaoDoBloco(bloco: Bloco) {
    const gente = doPapel(bloco.papel);
    const r = rascunho(bloco.papel);
    const avisoDaOrdem = bloco.papel === "testemunha" ? testemunhaNaFrente() : null;
    const doContrato = bloco.papel !== "termos_vendedora";
    // ⚠️ O QUE A CAIXA MOSTRA NÃO É O QUE ESTÁ GRAVADO NAQUELE PAPEL, e só nos TERMOS. Ver
    // `filaDosTermos`: ali a tela tem de mostrar quem o ENVIO usaria, que pode ser a pessoa do bloco
    // Vendedora. O `gente` continua sendo a lista do papel, porque é ela que numera a próxima linha.
    const dosTermos = filaDosTermos(lista);
    const fila = doContrato ? gente : dosTermos.linhas;
    const origem: OrigemDosTermos = doContrato ? "apontado" : dosTermos.origem;
    // ⚠️ A LINHA EMPRESTADA DO BLOCO VENDEDORA SE MOSTRA, MAS NÃO SE MEXE AQUI. Ela está gravada (tem
    // lápis e lixeira lá em cima); editar ou excluir pela caixa dos termos mudaria quem assina a
    // COMPRA E VENDA a partir de uma caixa que diz não entrar no contrato.
    const emprestada = !doContrato && origem !== "apontado";
    return (
      <section key={bloco.papel}>
        <p className="m-0 font-semibold text-ink text-sm">{bloco.titulo}</p>
        <p className="m-0 mb-1.5 text-ink-muted text-xs">{bloco.ajuda}</p>

        {/* ⚠️ A TESTEMUNHA QUE VAI ASSINAR CEDO DEMAIS. Ela testemunha um documento já assinado
            pelas partes; com um número baixo em "Assina em", o convite sai junto com o do comprador.
            É aviso, e não trava: pode haver um caso em que a ordem seja proposital. */}
        {avisoDaOrdem ? (
          <p className="m-0 mb-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {avisoDaOrdem}
          </p>
        ) : null}

        {/* ⚠️ A QUEDA INTEIRA, NA ORDEM DE VERDADE, sempre que ninguém foi apontado. Ver
            `filaDosTermos`: são dois degraus, e a frase cita os dois. */}
        {doContrato ? null : origem === "apontado" ? null : (
          <p className="m-0 mb-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {origem === "vendedora" ? (
              <>
                Ninguém apontado. Como ninguém foi apontado aqui, quem assina o termo é a pessoa
                cadastrada como vendedora no quadro, mostrada abaixo. Aponte alguém para que o termo
                deixe de ir para quem assina a compra e venda.
              </>
            ) : (
              <>
                Ninguém apontado. Sem ninguém aqui, o termo vai para quem estiver cadastrado como
                vendedora no quadro. Como não há ninguém lá também, o envio fica bloqueado.
              </>
            )}
          </p>
        )}

        {fila.length === 0 ? (
          doContrato ? (
            <p className="m-0 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-xs dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Ninguém aqui. O contrato vai para assinatura sem este papel, e a linha dele sai vazia
              no papel impresso.
            </p>
          ) : null
        ) : (
          <div className="grid gap-1.5">
            {fila.map((a, indice) => {
              const aberta = !emprestada && edicao?.id === a.id ? edicao : null;
              return (
                <div
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-subtle/40 px-3 py-2"
                  data-assinante={a.id}
                  key={a.id}
                >
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-inverse font-semibold text-[11px] text-white">
                    {a.posicao}
                  </span>
                  {aberta ? (
                    camposDaEdicao(aberta, doContrato)
                  ) : (
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate font-medium text-ink text-sm">{a.nome}</p>
                      <p className="m-0 truncate text-ink-muted text-xs">
                        {a.cpf ?? "sem CPF"} · {a.email ?? "sem e-mail"}
                      </p>
                    </div>
                  )}
                  {/* ⚠️ "ASSINA OS TERMOS" VALE PARA UMA PESSOA SÓ, E É A PRIMEIRA. O envio leva a de
                      menor posição (`assinanteDeTermosDaVendedora`, `order("posicao").limit(1)`); a
                      caixa não tem campo Linha, então quem quer TROCAR de pessoa inclui a nova e deixa
                      a antiga — e era a antiga que continuava assinando, com as duas etiquetadas
                      igual. */}
                  {aberta ? null : (
                    <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">
                      {doContrato
                        ? a.ordemAssinatura
                          ? `assina em ${a.ordemAssinatura}`
                          : "segue o papel"
                        : indice === 0
                          ? "assina os termos"
                          : "não assina, remova ou reordene"}
                    </span>
                  )}
                  {emprestada ? (
                    <span
                      className="shrink-0 rounded-md bg-subtle px-1.5 py-1 text-[10px] text-ink-muted"
                      title="Esta pessoa está no bloco Vendedora deste quadro e assina a compra e venda. Para mudar os dados dela, edite lá. Para outra pessoa assinar os termos, aponte alguém aqui."
                    >
                      edite no bloco Vendedora
                    </span>
                  ) : aberta ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        aria-label={`Salvar ${a.nome}`}
                        className="rounded-md bg-inverse p-1 text-brand-ink transition-opacity disabled:opacity-60"
                        disabled={salvandoEdicao}
                        onClick={() => void salvarEdicao()}
                        title="Salvar"
                        type="button"
                      >
                        {salvandoEdicao ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Check className="size-3.5" />
                        )}
                      </button>
                      <button
                        aria-label="Cancelar edição"
                        className="rounded-md border border-line p-1 text-ink-muted transition-colors hover:bg-subtle"
                        disabled={salvandoEdicao}
                        onClick={() => setEdicao(null)}
                        title="Cancelar"
                        type="button"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        aria-label={`Editar ${a.nome}`}
                        className="rounded-md border border-line p-1 text-ink-muted transition-colors hover:bg-subtle"
                        onClick={() => abrirEdicao(a)}
                        title="Editar"
                        type="button"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        aria-label={`Remover ${a.nome}`}
                        className="rounded-md border border-line p-1 text-ink-muted transition-colors hover:bg-subtle"
                        onClick={() => void remover(a.id, a.papel)}
                        title="Excluir"
                        type="button"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ⚠️ A RECUSA APARECE AO LADO DO BOTÃO QUE FOI CLICADO (revisão de 20/09/2026). A caixa dos
            termos é a ÚLTIMA do cartão, e a frase do servidor ("Informe o e-mail…") era renderizada
            lá em cima: quem clicou Incluir aqui embaixo não via o motivo e clicava de novo. */}
        {erro && papelDoErro === bloco.papel ? (
          <p className="m-0 mt-1.5 font-medium text-rose-600 text-xs dark:text-rose-300">{erro}</p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[160px] flex-1 flex-col gap-1">
            <span className="font-medium text-[11px] text-ink-muted">Nome completo</span>
            <input
              className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
              onChange={(e) => mexer(bloco.papel, "nome", e.target.value)}
              value={r.nome}
            />
          </label>
          <label className="flex w-32 flex-col gap-1">
            <span className="font-medium text-[11px] text-ink-muted">CPF</span>
            <input
              className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
              onChange={(e) => mexer(bloco.papel, "cpf", e.target.value)}
              value={r.cpf}
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1">
            <span className="font-medium text-[11px] text-ink-muted">E-mail</span>
            <input
              className="h-8 rounded-lg border border-line bg-surface px-2 text-ink text-sm"
              onChange={(e) => mexer(bloco.papel, "email", e.target.value)}
              value={r.email}
            />
          </label>
          {doContrato ? (
            <>
              <label className="flex w-14 flex-col gap-1">
                <span
                  className="font-medium text-[11px] text-ink-muted"
                  title="Qual linha do contrato é dela"
                >
                  Linha
                </span>
                <input
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-center text-ink text-sm"
                  inputMode="numeric"
                  onChange={(e) => mexer(bloco.papel, "posicao", e.target.value)}
                  placeholder={String(proximaPosicao(gente))}
                  title="A linha do contrato em que esta pessoa aparece. Já vem com a próxima livre deste papel."
                  value={r.posicao}
                />
              </label>
              <label className="flex w-20 flex-col gap-1">
                <span
                  className="font-medium text-[11px] text-ink-muted"
                  title="Quando ela assina. Em branco, segue a ordem do papel."
                >
                  Assina em
                </span>
                <input
                  className="h-8 rounded-lg border border-line bg-surface px-2 text-center text-ink text-sm"
                  inputMode="numeric"
                  onChange={(e) => mexer(bloco.papel, "ordemAssinatura", e.target.value)}
                  placeholder="-"
                  value={r.ordemAssinatura}
                />
              </label>
            </>
          ) : null}
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 font-semibold text-brand-ink text-xs disabled:opacity-60"
            disabled={salvando === bloco.papel}
            onClick={() => void adicionar(bloco.papel)}
            type="button"
          >
            {salvando === bloco.papel ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Incluir
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 flex items-center gap-2 font-semibold text-[11px] text-ink-muted uppercase tracking-wide">
        <Users className="size-3.5" />
        {/* ⚠️ "DO EMPREENDIMENTO", E NÃO MAIS "DO CONTRATO" (20/09/2026). O cartão passou a guardar
            também quem assina os TERMOS da carteira, que não é contrato — e a frase de impedimento
            do termo de acordo manda o operador ao "Quadro de assinatura do empreendimento" desde que
            nasceu. Os dois nomes divergindo era o operador procurando uma tela com outro nome. */}
        Quadro de assinatura do empreendimento
      </p>
      <p className="m-0 mt-1 text-ink-muted text-xs">
        Quem assina além do comprador. O comprador e o cônjuge saem da proposta e não se digitam
        aqui.
      </p>

      {/* A frase de um bloco sai DENTRO dele; esta aqui é a do cartão inteiro (falha de leitura). */}
      {erro && papelDoErro === null ? (
        <p className="m-0 mt-2 font-medium text-rose-600 text-xs dark:text-rose-300">{erro}</p>
      ) : null}

      {carregando ? (
        <p className="m-0 mt-3 text-ink-muted text-sm">Lendo…</p>
      ) : (
        <>
          <div className="mt-3 grid gap-4">{BLOCOS.map(secaoDoBloco)}</div>

          {/* ⚠️ CAIXA PRÓPRIA, COM A FRONTEIRA DITA EM PORTUGUÊS. Os três de cima assinam o CONTRATO
              de venda; esta pessoa assina os TERMOS da carteira. Quem mistura as duas coisas põe um
              analista na qualificação de uma compra e venda. */}
          {comAssinantesDeTermos ? (
            <div className="mt-4 rounded-lg border border-line border-dashed bg-subtle/30 p-3">
              <p className="m-0 flex items-center gap-2 font-semibold text-[11px] text-ink-muted uppercase tracking-wide">
                <FileSignature className="size-3.5" />
                Termos da carteira
              </p>
              <p className="m-0 mt-1 mb-2 text-ink-muted text-xs">
                Vale para o termo de acordo e para os próximos termos que a Careli emitir sobre esta
                carteira. <strong>Não entra no contrato de venda</strong>, nem na ordem de assinatura
                dele.
              </p>
              {secaoDoBloco(BLOCO_DOS_TERMOS)}
            </div>
          ) : null}
        </>
      )}

      <p className="m-0 mt-3 border-line border-t pt-2 text-ink-muted text-xs">
        <strong>Linha</strong> é qual linha do contrato é da pessoa. <strong>Assina em</strong> é
        quando ela recebe o convite; em branco, segue a ordem cadastrada para o papel. As duas são
        independentes: quem assina primeiro pode ser quem aparece embaixo no papel. Toda pessoa do
        quadro se corrige no lápis e sai na lixeira.
      </p>
    </div>
  );
}

/** A próxima linha livre DENTRO do papel: vendedora 1 e testemunha 1 convivem. */
function proximaPosicao(gente: AssinanteDoQuadro[]): number {
  const usadas = new Set(gente.map((a) => a.posicao));
  for (let n = 1; n <= 9; n += 1) if (!usadas.has(n)) return n;
  return 9;
}
