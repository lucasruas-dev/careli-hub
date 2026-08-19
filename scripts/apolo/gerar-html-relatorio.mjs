// Gera o relatorio HTML completo (nominal) a partir de dados-nominais.json.
//   node scripts/apolo/gerar-html-relatorio.mjs <caminho-de-saida.html>
import fs from "node:fs";
import path from "node:path";

const d = JSON.parse(fs.readFileSync("scripts/apolo/dados-nominais.json", "utf8"));
const saida = process.argv[2];
if (!saida) throw new Error("informe o caminho do html de saída");

const esc = (v) =>
  String(v ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Agrupa o "vários lotes" por cliente: é assim que a decisão vai ser tomada.
const porCliente = new Map();
for (const l of d.variosLotes) {
  const atual = porCliente.get(l.cpf) ?? { cliente: l.cliente, cpf: l.cpf, pixEm: l.pixEm, unidades: [] };
  atual.unidades.push(l.unidade);
  porCliente.set(l.cpf, atual);
}
const grupos = [...porCliente.values()].sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));

const linhasFeitas = d.feitas
  .map(
    (f) => `<tr data-busca="${esc((f.cliente + " " + f.cpf + " " + f.unidade).toLowerCase())}">
          <td>${esc(f.cliente)}</td>
          <td class="mono">${esc(f.cpf)}</td>
          <td class="mono">${esc(f.unidade)}</td>
          <td class="mono num">${esc(f.pagoEm)}</td>
        </tr>`,
  )
  .join("\n");

const linhasGrupos = grupos
  .map(
    (g) => `<tr data-busca="${esc((g.cliente + " " + g.cpf + " " + g.unidades.join(" ")).toLowerCase())}">
          <td>${esc(g.cliente)}</td>
          <td class="mono">${esc(g.cpf)}</td>
          <td class="mono">${g.unidades.map(esc).join(" · ")}</td>
          <td class="num">${g.unidades.length}</td>
          <td class="mono num">${esc(g.pixEm)}</td>
        </tr>`,
  )
  .join("\n");

const linhasSemRegistro = d.semRegistro
  .map(
    (s) => `<tr data-busca="${esc((s.cliente + " " + s.cpf + " " + s.unidade).toLowerCase())}">
          <td>${esc(s.cliente)}</td>
          <td class="mono">${esc(s.cpf)}</td>
          <td class="mono">${esc(s.unidade)}</td>
          <td class="mono num">${esc(s.vence)}</td>
        </tr>`,
  )
  .join("\n");

const linhasDevolucao = d.devolucao
  .map((v) => {
    const critico = /assinatura/i.test(v.estagio);
    return `<tr data-busca="${esc((v.cliente + " " + v.cpf + " " + v.unidade).toLowerCase())}">
          <td>${esc(v.cliente)}</td>
          <td class="mono">${esc(v.cpf)}</td>
          <td class="mono">${esc(v.unidade)}</td>
          <td>${critico ? `<span class="marca">${esc(v.estagio)}</span>` : esc(v.estagio)}</td>
          <td class="mono num">${esc(v.pixEm)}</td>
        </tr>`;
  })
  .join("\n");

const html = `<title>Regularização do Ato · Vale do Ouro</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">

<style>
  :root {
    --ground: #f7f7f5;
    --surface: #ffffff;
    --surface-sunk: #f1f1ee;
    --ink: #16181c;
    --ink-soft: #5b6068;
    --ink-faint: #8b9098;
    --rule: #e2e2dd;
    --rule-strong: #cfcfc8;
    --gold: #8a6b2f;
    --done: #2f6b4f;
    --done-bg: #e8f0ea;
    --decide: #a6741b;
    --decide-bg: #f7efdf;
    --alert: #8c3a31;
    --alert-bg: #f7e9e6;
    --shadow: 0 1px 2px rgba(22, 24, 28, .05), 0 8px 24px -16px rgba(22, 24, 28, .25);
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #131417;
      --surface: #1a1c20;
      --surface-sunk: #212429;
      --ink: #ecece8;
      --ink-soft: #a4a8b0;
      --ink-faint: #7b8089;
      --rule: #2b2e34;
      --rule-strong: #3a3e45;
      --gold: #c9a563;
      --done: #7cc2a0;
      --done-bg: #1c2a24;
      --decide: #d9ac5c;
      --decide-bg: #2c2418;
      --alert: #d99187;
      --alert-bg: #2c1e1c;
      --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px -16px rgba(0, 0, 0, .6);
    }
  }

  :root[data-theme="dark"] {
    --ground: #131417;
    --surface: #1a1c20;
    --surface-sunk: #212429;
    --ink: #ecece8;
    --ink-soft: #a4a8b0;
    --ink-faint: #7b8089;
    --rule: #2b2e34;
    --rule-strong: #3a3e45;
    --gold: #c9a563;
    --done: #7cc2a0;
    --done-bg: #1c2a24;
    --decide: #d9ac5c;
    --decide-bg: #2c2418;
    --alert: #d99187;
    --alert-bg: #2c1e1c;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px -16px rgba(0, 0, 0, .6);
  }

  * { box-sizing: border-box; }

  body {
    background: var(--ground);
    color: var(--ink);
    font-family: "IBM Plex Sans", system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    margin: 0;
  }

  .folha {
    display: flex;
    flex-direction: column;
    gap: 44px;
    margin: 0 auto;
    max-width: 980px;
    padding: 56px 28px 96px;
  }

  .cabeca { display: flex; flex-direction: column; gap: 14px; }

  .eyebrow {
    align-items: center;
    color: var(--gold);
    display: flex;
    font-size: 12px;
    font-weight: 500;
    gap: 10px;
    letter-spacing: .14em;
    text-transform: uppercase;
  }
  .eyebrow::after { background: var(--rule-strong); content: ""; flex: 1; height: 1px; }

  h1 {
    font-family: Newsreader, Georgia, serif;
    font-size: clamp(30px, 5vw, 42px);
    font-weight: 500;
    letter-spacing: -.01em;
    line-height: 1.15;
    margin: 0;
    text-wrap: balance;
  }

  .subtitulo { color: var(--ink-soft); font-size: 16.5px; margin: 0; max-width: 62ch; }

  .carimbo {
    color: var(--ink-faint);
    display: flex;
    flex-wrap: wrap;
    font-family: "IBM Plex Mono", monospace;
    font-size: 12.5px;
    gap: 6px 18px;
  }

  .sigilo {
    background: var(--alert-bg);
    border-radius: 3px;
    color: var(--alert);
    font-size: 13.5px;
    padding: 10px 14px;
  }

  .placar {
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: 4px;
    display: grid;
    gap: 1px;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    overflow: hidden;
  }

  .placar > div {
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 20px 22px;
  }

  .placar dt {
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: .08em;
    margin: 0;
    text-transform: uppercase;
  }

  .placar dd {
    font-family: "IBM Plex Mono", monospace;
    font-size: 30px;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    letter-spacing: -.02em;
    line-height: 1.1;
    margin: 0;
  }

  .placar .nota { color: var(--ink-faint); font-size: 13px; }
  .valor-ok { color: var(--done); }
  .valor-atencao { color: var(--decide); }

  section { display: flex; flex-direction: column; gap: 18px; }

  h2 {
    border-bottom: 1px solid var(--rule-strong);
    font-family: Newsreader, Georgia, serif;
    font-size: 25px;
    font-weight: 500;
    margin: 0;
    padding-bottom: 10px;
  }

  h3 { font-size: 16.5px; font-weight: 600; margin: 0; }
  p { margin: 0; max-width: 68ch; }
  .apoio { color: var(--ink-soft); }
  strong { font-weight: 600; }

  .busca {
    background: var(--surface);
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    color: var(--ink);
    font-family: inherit;
    font-size: 15px;
    max-width: 340px;
    padding: 9px 12px;
    width: 100%;
  }
  .busca:focus-visible { border-color: var(--gold); outline: 2px solid var(--gold); outline-offset: 1px; }
  .busca::placeholder { color: var(--ink-faint); }

  .rolagem {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: 3px;
    overflow-x: auto;
  }

  table { border-collapse: collapse; font-size: 14.5px; width: 100%; }

  th {
    background: var(--surface-sunk);
    border-bottom: 1px solid var(--rule-strong);
    color: var(--ink-soft);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: .08em;
    padding: 10px 16px;
    position: sticky;
    text-align: left;
    text-transform: uppercase;
    top: 0;
    white-space: nowrap;
  }

  td { border-bottom: 1px solid var(--rule); padding: 10px 16px; vertical-align: top; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: var(--surface-sunk); }

  .mono { font-family: "IBM Plex Mono", monospace; font-size: 13.5px; font-variant-numeric: tabular-nums; }
  .num { text-align: right; white-space: nowrap; }

  .marca { color: var(--alert); font-weight: 600; }

  .vazio { color: var(--ink-faint); display: none; font-size: 14px; padding: 16px; }

  .pendencia {
    background: var(--surface);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--rule-strong);
    border-radius: 3px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 22px 24px;
  }

  .pendencia.decidir { border-left-color: var(--decide); }
  .pendencia.verificar { border-left-color: var(--alert); }
  .pendencia.devolver { border-left-color: var(--gold); }

  .topo-pendencia {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: space-between;
  }

  .selo {
    border-radius: 2px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .09em;
    padding: 3px 9px;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .selo.decidir { background: var(--decide-bg); color: var(--decide); }
  .selo.verificar { background: var(--alert-bg); color: var(--alert); }
  .selo.devolver { background: var(--surface-sunk); color: var(--gold); }

  .contagem { font-family: "IBM Plex Mono", monospace; font-size: 15px; font-variant-numeric: tabular-nums; }

  .acao { background: var(--surface-sunk); border-radius: 3px; font-size: 14.5px; padding: 12px 14px; }
  .acao b { font-weight: 600; }

  .metodo {
    background: var(--surface-sunk);
    border-radius: 3px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
  }
  .metodo ul { display: flex; flex-direction: column; gap: 9px; margin: 0; padding-left: 20px; }
  .metodo li { color: var(--ink-soft); font-size: 14.5px; }
  .metodo li b { color: var(--ink); font-weight: 600; }

  .rodape { border-top: 1px solid var(--rule); color: var(--ink-faint); font-size: 13px; padding-top: 20px; }

  @media (max-width: 560px) {
    .folha { gap: 36px; padding: 36px 16px 72px; }
    .placar dd { font-size: 26px; }
    th, td { padding-left: 12px; padding-right: 12px; }
  }
</style>

<div class="folha">

  <header class="cabeca">
    <div class="eyebrow">Regularização financeira</div>
    <h1>Baixa do Ato de R$ 1.000 no Vale do Ouro</h1>
    <p class="subtitulo">
      Conciliação entre os PIX de pré-venda recebidos pelo Panteon e as parcelas de Ato em aberto
      no C2X, com a baixa das que tinham pagamento comprovado.
    </p>
    <div class="carimbo">
      <span>19 de agosto de 2026</span>
      <span>VOC · VOL</span>
      <span>Ato de R$ 1.000</span>
    </div>
    <p class="sigilo">
      Documento interno. Contém nome e CPF de clientes — circule apenas por canal controlado.
    </p>
  </header>

  <dl class="placar">
    <div>
      <dt>Baixas realizadas</dt>
      <dd class="valor-ok">79</dd>
      <span class="nota">R$ 79.000 conciliados</span>
    </div>
    <div>
      <dt>Aguardam decisão</dt>
      <dd class="valor-atencao">11</dd>
      <span class="nota">clientes com vários lotes</span>
    </div>
    <div>
      <dt>Sem registro</dt>
      <dd class="valor-atencao">31</dd>
      <span class="nota">nenhum pagamento localizado</span>
    </div>
    <div>
      <dt>Provável devolução</dt>
      <dd class="valor-atencao">23</dd>
      <span class="nota">pagaram, venda não seguiu</span>
    </div>
  </dl>

  <section>
    <h2>O que foi feito</h2>
    <p>
      Os clientes pagaram a pré-venda por PIX gerado no Panteon, mas essas entradas não haviam sido
      lançadas no C2X — as parcelas de Ato seguiam marcadas como atrasadas mesmo com o dinheiro
      recebido. Cruzamos os dois sistemas cliente a cliente e demos baixa apenas onde havia
      pagamento comprovado.
    </p>
    <p>
      Cada baixa foi lançada com a <strong>data real do PIX</strong>, entre 23 e 30 de julho, e não
      com a data de hoje. Isso mantém o histórico fiel e permite conferir a carteira contra o
      extrato bancário do período.
    </p>
    <div class="rolagem">
      <table>
        <thead>
          <tr>
            <th>Empreendimento</th>
            <th class="num">Pagas</th>
            <th class="num">Em aberto</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Vale do Ouro · Cecílio <span class="apoio">(VOC)</span></td><td class="num mono">62</td><td class="num mono">26</td><td class="num mono">88</td></tr>
          <tr><td>Vale do Ouro · Lino <span class="apoio">(VOL)</span></td><td class="num mono">59</td><td class="num mono">16</td><td class="num mono">75</td></tr>
          <tr><td><strong>Total</strong></td><td class="num mono"><strong>121</strong></td><td class="num mono"><strong>42</strong></td><td class="num mono"><strong>163</strong></td></tr>
        </tbody>
      </table>
    </div>
    <p class="apoio">Antes desta conciliação, apenas 42 das 163 parcelas estavam quitadas.</p>
  </section>

  <section>
    <h2>Clientes regularizados</h2>
    <p class="apoio">
      As 79 unidades que receberam baixa, com a data em que o PIX foi pago. Todas conferidas na
      base do C2X após o lançamento.
    </p>
    <input class="busca" data-alvo="tab-feitas" placeholder="Buscar por nome, CPF ou unidade" type="search" aria-label="Buscar nos clientes regularizados">
    <div class="rolagem">
      <table id="tab-feitas">
        <thead>
          <tr><th>Cliente</th><th>CPF</th><th>Unidade</th><th class="num">PIX pago em</th></tr>
        </thead>
        <tbody>
${linhasFeitas}
        </tbody>
      </table>
      <p class="vazio">Nenhum cliente encontrado com esse termo.</p>
    </div>
  </section>

  <section>
    <h2>O que ficou pendente</h2>
    <p>
      As pendências não são um bloco único: cada grupo tem uma causa diferente e exige um
      encaminhamento diferente.
    </p>

    <div class="pendencia decidir">
      <div class="topo-pendencia">
        <h3>Cliente com vários lotes e um único PIX</h3>
        <span class="selo decidir">Precisa de decisão</span>
      </div>
      <p class="contagem">11 unidades · ${grupos.length} clientes · R$ 11.000</p>
      <p>
        A pré-venda foi cobrada <strong>por pessoa</strong> (R$ 1.000 por CAD), mas o Ato é gerado
        <strong>por unidade</strong>. Quem comprou três lotes pagou mil reais, não três mil. Dar
        baixa em todas seria registrar como recebido um valor que não entrou.
      </p>
      <div class="rolagem">
        <table>
          <thead>
            <tr><th>Cliente</th><th>CPF</th><th>Unidades com Ato em aberto</th><th class="num">Lotes</th><th class="num">PIX pago em</th></tr>
          </thead>
          <tbody>
${linhasGrupos}
          </tbody>
        </table>
      </div>
      <p class="acao">
        <b>Encaminhamento:</b> definir se o valor pago cobre a pré-venda inteira do cliente — e, em
        caso positivo, em qual lote lançar a baixa — ou se os demais lotes ainda têm o Ato a receber.
      </p>
    </div>

    <div class="pendencia verificar">
      <div class="topo-pendencia">
        <h3>Sem registro de pagamento</h3>
        <span class="selo verificar">Precisa de verificação</span>
      </div>
      <p class="contagem">31 unidades · R$ 31.000</p>
      <p>
        Não há PIX de pré-venda no Panteon nem baixa no C2X para esses clientes. Pelo que os dois
        sistemas mostram, o valor não foi recebido — por isso nada foi lançado.
      </p>
      <input class="busca" data-alvo="tab-sem-registro" placeholder="Buscar por nome, CPF ou unidade" type="search" aria-label="Buscar nos clientes sem registro">
      <div class="rolagem">
        <table id="tab-sem-registro">
          <thead>
            <tr><th>Cliente</th><th>CPF</th><th>Unidade</th><th class="num">Venceu em</th></tr>
          </thead>
          <tbody>
${linhasSemRegistro}
          </tbody>
        </table>
        <p class="vazio">Nenhum cliente encontrado com esse termo.</p>
      </div>
      <p class="acao">
        <b>Encaminhamento:</b> confirmar com o comercial e o financeiro se algum desses clientes
        pagou por outro meio (transferência, dinheiro ou diretamente na imobiliária). Havendo
        comprovante, a baixa é imediata.
      </p>
    </div>

    <div class="pendencia devolver">
      <div class="topo-pendencia">
        <h3>Pagaram a pré-venda e a venda não seguiu</h3>
        <span class="selo devolver">Provável devolução</span>
      </div>
      <p class="contagem">23 clientes · R$ 23.000</p>
      <p>
        Pagaram o PIX de R$ 1.000 e não têm parcela de Ato para receber a baixa: 15 não têm proposta
        registrada no Vale do Ouro, 7 estão com a proposta cancelada e 2 não foram localizados no
        C2X. O dinheiro entrou e a venda não avançou.
      </p>
      <p>
        Uma exceção merece olhar à parte: um cliente aparece <strong>em assinatura</strong>, com o
        PIX pago e nenhuma parcela gerada — não é cancelamento, é uma venda em andamento sem o
        financeiro montado. Está destacado na tabela.
      </p>
      <input class="busca" data-alvo="tab-devolucao" placeholder="Buscar por nome, CPF ou unidade" type="search" aria-label="Buscar nos clientes para devolução">
      <div class="rolagem">
        <table id="tab-devolucao">
          <thead>
            <tr><th>Cliente</th><th>CPF</th><th>Unidade</th><th>Situação da proposta</th><th class="num">PIX pago em</th></tr>
          </thead>
          <tbody>
${linhasDevolucao}
          </tbody>
        </table>
        <p class="vazio">Nenhum cliente encontrado com esse termo.</p>
      </div>
      <p class="acao">
        <b>Encaminhamento:</b> tratar como devolução de pré-venda, não como baixa. O caso em
        assinatura deve ser conferido separadamente, para gerar as parcelas.
      </p>
    </div>
  </section>

  <section>
    <h2>Como os números foram conferidos</h2>
    <div class="metodo">
      <ul>
        <li>
          <b>Uma baixa por pagamento.</b> Cada PIX recebido vale uma única baixa de R$ 1.000. Onde
          o mesmo pagamento aparecia ligado a mais de um lote, nada foi lançado.
        </li>
        <li>
          <b>Conferência antes de cada lançamento.</b> Unidade, valor da parcela e ausência de baixa
          anterior foram validados um a um; qualquer divergência interrompia o lançamento.
        </li>
        <li>
          <b>Conferência depois, direto no banco.</b> As 79 baixas foram reconferidas na base do
          C2X — status, valor e data — e não pela mensagem de confirmação da tela.
        </li>
        <li>
          <b>A conta fecha.</b> Dos 108 clientes com PIX pago: 80 estão com o Ato quitado, 5 são os
          casos de vários lotes e 23 não têm parcela porque a venda não seguiu.
        </li>
      </ul>
    </div>
  </section>

  <footer class="rodape">
    Levantamento e conciliação realizados em 19 de agosto de 2026 sobre as bases do Panteon e do C2X.
  </footer>

</div>

<script>
  // Busca por nome, CPF ou unidade: filtra as linhas da tabela indicada em data-alvo.
  for (const campo of document.querySelectorAll(".busca")) {
    campo.addEventListener("input", () => {
      const termo = campo.value.trim().toLowerCase();
      const tabela = document.getElementById(campo.dataset.alvo);
      const vazio = tabela.parentElement.querySelector(".vazio");
      let visiveis = 0;
      for (const linha of tabela.tBodies[0].rows) {
        const bate = !termo || linha.dataset.busca.includes(termo);
        linha.style.display = bate ? "" : "none";
        if (bate) visiveis += 1;
      }
      vazio.style.display = visiveis === 0 ? "block" : "none";
    });
  }
</script>
`;

fs.writeFileSync(path.resolve(saida), html);
console.log("html gerado: " + saida);
console.log("linhas: " + d.feitas.length + " baixadas · " + grupos.length + " grupos · " +
  d.semRegistro.length + " sem registro · " + d.devolucao.length + " devolução");
