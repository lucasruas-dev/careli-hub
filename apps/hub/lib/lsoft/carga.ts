// A CARGA DO LSOFT NO ESPELHO: gravar ANTES de apagar, e voltar atrás se qualquer passo falhar.
//
// ⚠️ O QUE ACONTECIA ATÉ 24/09/2026, e está no registro de `lsoft_sincronizacoes`:
//   O importador apagava TODAS as parcelas e depois gravava em lotes de 500. Em 08/09 às 17:06 a
//   carga falhou no CHECK de empreendimento DEPOIS de já ter apagado tudo, e o espelho ficou
//   VAZIO por 41 minutos. Às 17:47 uma carga só do Vale do Ouro apagou o Garden e o Vale do Sol,
//   que só voltaram às 17:48, com uma terceira carga completa. Quem abrisse a tela da Cecílio
//   nessas janelas via a carteira zerada.
//
// O que muda, e por quê:
//   1. As parcelas novas entram PRIMEIRO, todas com a mesma marca em `sincronizado_em`. As antigas
//      só saem depois que TODAS as novas gravaram. Um lote que falha no meio não apaga nada.
//   2. Falhou em qualquer ponto depois de começar a gravar: apaga as parcelas desta carga (a
//      marca) e o espelho volta a ser exatamente o de antes. Não existe estado intermediário
//      permanente.
//   3. Só saem as parcelas antigas DOS EMPREENDIMENTOS QUE VIERAM NESTA CARGA. Antes, uma carga
//      só do Vale do Ouro apagava o Garden. Agora carregar o Giant Towers não encosta no Garden,
//      e é isso que permite subir os empreendimentos um por um.
//
// ⚠️ POR QUE NÃO UMA TRANSAÇÃO: o PostgREST não tem transação entre requisições, e 20 mil linhas
// não cabem numa só. Gravar-antes-de-apagar com marca é o que dá o mesmo efeito para quem lê: em
// qualquer instante o espelho tem a carga velha inteira, ou a nova inteira. A exceção é uma
// janela de segundos entre gravar a nova e apagar a velha, em que as duas coexistem; foi aceita
// em troca de nunca mais existir a janela do espelho vazio.
//
// ⚠️ A MARCA É UM TIMESTAMP EXATO, não um "depois de". `now()` no Postgres é o início de cada
// requisição, então lotes diferentes teriam marcas diferentes. O importador grava o MESMO valor em
// todas as parcelas da carga, e a igualdade identifica a carga sem depender de relógio.
//
// É pura sobre a interface `BancoDaCarga`, e é isso que deixa os testes simularem a falha do
// lote 7, a falha do apagamento e a falha do próprio desfazer, sem banco.

export type ResultadoDoPasso = { erro?: string };

/** O mínimo de banco que a carga usa. O importador liga isto no Supabase; o teste, num falso. */
export type BancoDaCarga = {
  /** Remove as parcelas antigas dos empreendimentos desta carga: `empreendimento in (...)` e marca diferente. */
  apagarAntigas(empreendimentos: string[], marca: string): Promise<ResultadoDoPasso>;
  /** Quantas antigas ainda existem, com o MESMO filtro de `apagarAntigas`. É só leitura. */
  contarAntigas(empreendimentos: string[], marca: string): Promise<{ erro?: string; total?: number }>;
  /** Remove tudo que tem a marca desta carga. É o "desfazer". */
  apagarDaCarga(marca: string): Promise<ResultadoDoPasso>;
  gravarClientes(lote: Array<Record<string, unknown>>): Promise<ResultadoDoPasso>;
  gravarParcelas(lote: Array<Record<string, unknown>>): Promise<ResultadoDoPasso>;
};

export type ResultadoDaCarga =
  | {
      /** O apagamento das antigas respondeu com erro, mas a contagem provou que ele efetivou. */
      aviso?: string;
      clientes: number;
      empreendimentos: string[];
      ok: true;
      parcelas: number;
    }
  | {
      erro: string;
      /** O espelho continua o de antes? Falso só se o próprio desfazer falhou. */
      espelhoIntacto: boolean;
      ok: false;
      /** Em que passo parou, para o registro e para quem for consertar. */
      passo: "apagar_antigas" | "clientes" | "desfazer" | "parcelas" | "validacao";
    };

const TAMANHO_DO_LOTE = 500;

export async function executarCarga(args: {
  aoProgresso?: (etapa: string, feitas: number, total: number) => void;
  banco: BancoDaCarga;
  clientes: Array<Record<string, unknown>>;
  /** Timestamp exato gravado em `sincronizado_em` de todas as parcelas desta carga. */
  marca: string;
  parcelas: Array<Record<string, unknown>>;
}): Promise<ResultadoDaCarga> {
  const { banco, clientes, marca, parcelas } = args;
  const progresso = args.aoProgresso ?? (() => {});

  // ── Validação: nada é tocado se a carga não faz sentido ────────────────────
  if (!marca) return { erro: "carga sem marca de sincronização", espelhoIntacto: true, ok: false, passo: "validacao" };
  if (parcelas.length === 0) {
    // ⚠️ Uma carga vazia com o comportamento antigo apagaria o espelho inteiro e gravaria nada.
    return { erro: "carga sem nenhuma parcela: recusada", espelhoIntacto: true, ok: false, passo: "validacao" };
  }
  const semEmpreendimento = parcelas.filter((p) => !String(p.empreendimento ?? "").trim()).length;
  if (semEmpreendimento > 0) {
    return {
      erro: `${semEmpreendimento} parcela(s) sem empreendimento`,
      espelhoIntacto: true,
      ok: false,
      passo: "validacao",
    };
  }
  const empreendimentos = [...new Set(parcelas.map((p) => String(p.empreendimento)))].sort();

  // ── Clientes: upsert por código, não destrutivo ─────────────────────────────
  // Falhar aqui não deixa estrago: nenhuma parcela foi tocada, e o upsert é idempotente.
  for (let i = 0; i < clientes.length; i += TAMANHO_DO_LOTE) {
    const r = await banco.gravarClientes(clientes.slice(i, i + TAMANHO_DO_LOTE));
    if (r.erro) return { erro: `clientes: ${r.erro}`, espelhoIntacto: true, ok: false, passo: "clientes" };
    progresso("clientes", Math.min(i + TAMANHO_DO_LOTE, clientes.length), clientes.length);
  }

  // A partir daqui qualquer falha desfaz o que esta carga gravou.
  const desfazer = async (passo: "apagar_antigas" | "parcelas", erro: string): Promise<ResultadoDaCarga> => {
    const r = await banco.apagarDaCarga(marca);
    if (r.erro) {
      // ⚠️ O PIOR CASO, e o único em que o espelho não volta sozinho: gravou parte, falhou, e não
      // conseguiu tirar o que gravou. As parcelas antigas continuam lá, então nada se perdeu; o
      // que sobra são as novas pela metade, identificáveis pela marca. Rodar a carga de novo limpa.
      return {
        erro: `${erro} · E O DESFAZER FALHOU: ${r.erro}. Parcelas com sincronizado_em = ${marca} estão sobrando; rode a carga de novo.`,
        espelhoIntacto: false,
        ok: false,
        passo: "desfazer",
      };
    }
    return { erro, espelhoIntacto: true, ok: false, passo };
  };

  // ── Parcelas novas: entram com a marca, antes de qualquer apagamento ───────
  const comMarca = parcelas.map((p) => ({ ...p, sincronizado_em: marca }));
  for (let i = 0; i < comMarca.length; i += TAMANHO_DO_LOTE) {
    const r = await banco.gravarParcelas(comMarca.slice(i, i + TAMANHO_DO_LOTE));
    if (r.erro) return desfazer("parcelas", `parcelas (lote que começa em ${i}): ${r.erro}`);
    progresso("parcelas", Math.min(i + TAMANHO_DO_LOTE, comMarca.length), comMarca.length);
  }

  // ── Só agora as antigas saem, e só dos empreendimentos desta carga ─────────
  const r = await banco.apagarAntigas(empreendimentos, marca);
  if (!r.erro) return { clientes: clientes.length, empreendimentos, ok: true, parcelas: parcelas.length };

  // ⚠️ ERRO NO APAGAMENTO NÃO QUER DIZER QUE ELE NÃO ACONTECEU. Um DELETE pode efetivar no banco e a
  // resposta se perder no caminho (timeout, queda de rede). Se o desfazer rodasse às cegas, ele
  // apagaria as parcelas NOVAS, que a essa altura são a ÚNICA cópia daqueles empreendimentos, e o
  // registro ainda diria "espelho intacto". Achado da revisão adversarial de 24/09/2026.
  //
  // A regra: só desfaz com PROVA de que as antigas ainda estão lá. Sem prova, não mexe. Parcela em
  // dobro se conserta rodando a carga de novo; empreendimento vazio na tela da Cecílio, não.
  const antigas = await banco.contarAntigas(empreendimentos, marca);
  if (antigas.erro !== undefined || antigas.total === undefined) {
    return {
      erro: `apagar as parcelas antigas respondeu "${r.erro}", e não deu para contar o que sobrou (${antigas.erro ?? "sem total"}). NADA foi desfeito de propósito: rode a carga de novo, que ela limpa o que estiver em dobro.`,
      espelhoIntacto: false,
      ok: false,
      passo: "apagar_antigas",
    };
  }
  if (antigas.total === 0) {
    // O apagamento efetivou; só a resposta se perdeu. A carga deu certo.
    return {
      aviso: `o apagamento das antigas respondeu "${r.erro}", mas a contagem mostra que ele efetivou`,
      clientes: clientes.length,
      empreendimentos,
      ok: true,
      parcelas: parcelas.length,
    };
  }
  return desfazer("apagar_antigas", `apagar as parcelas antigas: ${r.erro}`);
}
