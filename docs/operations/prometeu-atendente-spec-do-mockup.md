<!-- Gerado em 27/07/2026 a partir de public/prometeu/atendente.html (mockup APROVADO pelo Lucas).
     Serve para PORTAR ITEM A ITEM. Nao improvisar layout: o mockup e a especificacao.
     Contexto: o Lucas cortou 3 versoes por falta de fidelidade ao mockup. -->

# SPEC DE PORTABILIDADE — Atendente (mockup → React)

Mockup: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\public\prometeu\atendente.html` (870 linhas)
React: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\modules\prometeu\blocks\atendente\atendente-view.tsx` (593 linhas)
Tipos: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\lib\prometeu\types.ts`
Dados: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\modules\prometeu\data\prometeu-operations.ts` (`FilaPayload`, linhas 158-178)
Servidor: `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\lib\prometeu\data.ts` + `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\app\api\prometeu\credenciados\route.ts`

Recorte assumido: a tela React é EXCLUSIVA de secretaria + papel Atendente (decisão do Lucas, 27/07, comentário nas linhas 32-40 do TSX). No mockup isso equivale a `body.can-atender` com `data-posto="secretaria"`. Tudo que o mockup mostra só em outro posto vai marcado como FORA DE ESCOPO, mas continua listado (o Lucas cortou versões por item faltando sem justificativa).

---

## 1. INVENTÁRIO DO MOCKUP (ordem da tela, rótulos exatos)

### 1. Cabeçalho (`<header>`, linhas 307-324)
1.1 Ícone do módulo — quadrado 44x44, canto 11px, fundo `#232832`, SVG de lista/fila.
1.2 Título `h1`: **"Central · Atendente"**
1.3 Subtítulo: **"PROMETEU · GESTÃO DE FILA"** (11px, caixa alta, tracking .14em)
1.4 Seletor de POSTO (pílula de 3 botões): **"Recepção"** · **"Salão de vendas"** · **"Secretaria"**
1.5 Seletor de PAPEL (pílula de 2 botões): **"Organizador"** · **"Atendente"** (Atendente fica `disabled`, opacidade .32, fora da secretaria)
1.6 Operador logado: avatar 34x34 com iniciais (**"AP"**) + nome (**"Ana Paula"**) + linha pequena **"Organizador · Salão de vendas"** (papel · posto, dinâmica)
1.7 Relógio `#clock` — **"10:42"**, 20px bold, tabular-nums, `setInterval` de 1s
1.8 Botão de tema (ícone lua, 38x38) — alterna `body.dark`

### 2. Faixa de INDICADORES (`.kpis`, linhas 327-332) — 4 colunas iguais, gap 14px
Cada card: ícone 40x40 colorido + valor 24px extra-bold tabular + rótulo 12px cinza. Sem sublabel.
2.1 Verde (`ok`, ícone prancheta com check) — valor `#kpi-atd` · rótulo **"Atendimentos hoje"**
2.2 Azul (`info`, ícone relógio) — valor `#kpi-tmed` no formato `m:ss` · rótulo **"Tempo médio"**
2.3 Âmbar (`warn`, ícone pessoas) — valor `#kpi-espera` · rótulo **"Em espera"**
2.4 Vermelho (`danger`, ícone ampulheta) — valor `#kpi-espera-max` (`"37 min"` / `"1h05"` / `"—"`) · rótulo **"Maior espera"**
Regra: só existe com `body.can-atender`; some quando o atendimento está inline; volta quando o card é popado (linhas 294-296).

### 3. Grid principal (`1fr 430px`, linha 49)

#### 3A. Card da FILA (coluna esquerda, linhas 336-348)
3.1 Título dinâmico `#fila-tit`: **"Fila da secretaria"** (na secretaria) / "Fila da recepção" (recepção e salão). HTML estático nasce com "Espera · a chamar".
3.2 Aba **"Fila"** + pílula de contagem `#n-fila`
3.3 Aba **"Aguardando retorno"** + pílula de contagem `#n-retorno` (a ativa ganha sublinhado 2px)
3.4 Linha da fila (`.frow`), da esquerda para a direita:
  a) `.fpos` — quadrado 34x34 com a posição (1, 2, 3…); na aba de retorno vira **"↩"**; a primeira linha (`.prox`) fica INVERTIDA (fundo escuro, texto claro)
  b) `.fav` — avatar 42x42 com as INICIAIS do nome
  c) Nome 16px bold, clicável (sublinha no hover) + selo **"★ plano personalizado"** (dourado) quando aplicável
  d) Segunda linha: **"Imobiliária · Corretor"**
  e) `.fwait` — **"⏱ 12 min"** / **"⏱ 1h05"** — fica VERMELHO a partir de 45 min
  f) Botão WhatsApp 34x34 verde, tooltip **"Enviar acompanhamento da fila no WhatsApp"**
  g) Botão **"Chamar"** (na aba retorno: **"Rechamar"** + botão vermelho **"No-show"**, tooltip "Cliente foi embora / desistiu")
  h) Linha inteira com barra dourada de 3px na borda esquerda quando `perso`
3.5 Vazio: **"Fila vazia."** / **"Ninguém aguardando retorno."**
3.6 Rodapé de ações (`.cta`, 3 botões lado a lado):
  a) **"Chamar próximo"** — botão grande escuro 19px com ícone de play, sombra; `disabled` se `ocupado || atendimento`
  b) **"Bipar entrada"** — contorno, ícone de código de barras, hover dourado
  c) **"Ocupado"** — toggle; ligado = âmbar sólido

#### 3B. Coluna lateral (430px, 3 cards empilhados)
3.7 Card **"Fila do salão · em negociação"** + badge **"N no salão"** — linhas com avatar, nome clicável (+ selo perso), "imob · corretor", cronômetro **"⏱ m:ss"** correndo, chip verde **"em negociação"**, botão WhatsApp. Vazio: **"Ninguém em negociação ainda."** (`max-height:52vh`; só posto salão)
3.8 Card **"Minha mesa"** + badge de estado à direita. Corpo: número da mesa em bloco 66x66 fonte 28px (**"03"**) + rótulo **"Mesa da secretaria"** + subtítulo. Três estados:
  - livre → badge **"Disponível"**, sub **"pronta para o próximo"**, cinza
  - ocupada → badge **"Aguardando cliente"**, sub = nome do chamado ou **"chamada enviada"**, ÂMBAR
  - atendimento → badge **"Em atendimento"**, sub = nome do cliente, VERDE
3.9 Card **"Últimas chamadas"** (`flex:1`) — até 8 linhas: avatar 32x32, nome clicável, destino (**"Secretaria · Mesa 03"**, **"→ Salão · em negociação"**, **"→ Não compareceu"**, **"→ Secretaria · em espera"**, **"→ Fila da recepção"**) + pílula de status: verde para **"em atendimento"** / **"finalizado"** / **"credenciado"** / **"em espera"** / **"em negociação"**; vermelha para **"não veio"** / **"no-show"**; azul para **"direcionado"**. Vazio: **"Sem chamadas ainda."**

### 4. Overlay de CHAMADA (`#chamada`, linhas 461-474)
Tela cheia escurecida com blur 7px, card com animação de pop.
4.1 **"● Chamando"** (pulso azul, tracking .2em)
4.2 Nome gigante `clamp(48px, 7vw, 80px)`
4.3 Linha **"Imobiliária · Corretor · ★ plano personalizado"**
4.4 Pílula azul grande 26px: **"📍 Secretaria · Mesa 03"**
4.5 **"chamado há 0:12"** contando (inicial: "chamado agora")
4.6 Botões: **"🔁 Rechamar"** · **"✕ Não veio"** (vermelho) · **"✓ Compareceu"** (verde). Fora da secretaria o terceiro vira ícone QR + **"Bipar · ler QR"**.

### 5. Painel de ATENDIMENTO (`#atendimento`, linhas 370-391)
5.1 Cabeçalho VERDE: pulso branco + **"Em atendimento"** (vira **"Pausado"** e cabeçalho ÂMBAR)
5.2 Botão de pop-out (seta diagonal), tooltip **"Abrir em janela flutuante"**
5.3 Cronômetro 27px `00:00` (`mm:ss`), congela quando pausa
5.4 Corpo: avatar 46x46 + nome 19px + subtítulo **"imob · corretor · destino"**
5.5 Chips monoespaçados das unidades (**"VOR0312"**)
5.6 Selo dourado **"★ Plano personalizado"**
5.7 Ações: **"Pausar"** (vira **"Retomar"**) · **"Direcionar"** · **"Finalizar"** (verde sólido)
5.8 Inline: centralizado, `top:78px`, `min(720px,94vw)`, ESCONDE o grid e os KPIs. Popado (Document PiP, 400x340): a aba volta a mostrar fila e KPIs.

### 6. Modal DIRECIONAR (`#dir-modal`, linhas 394-407)
6.1 Título **"Direcionar cliente"**
6.2 Texto **"Devolve o cliente para uma etapa anterior. Informe o motivo."**
6.3 Label **"Direcionar para"** + 4 chips: **"Negociação (salão)"** · **"Reserva"** · **"Recepção"** · **"Financeiro"**
6.4 Label **"Motivo do direcionamento"** + textarea, placeholder **"Ex.: corrigir a proposta comercial, revisar condição de pagamento..."**
6.5 Botões **"Cancelar"** / **"Confirmar direcionamento"**
6.6 Sem destino: `alert("Escolha o destino do direcionamento.")`

### 7. Modal BIPAR (`#bip-modal`, 640px, fundo com blur, linhas 410-432)
7.1 Título: **"Bipar · secretaria"** (secretaria) / **"Credenciar entrada"** (recepção)
7.2 Subtítulo secretaria: **"Cliente chegou na secretaria. Registre a foto da PA e marque se é plano personalizado."**
7.3 Área de leitura de QR (tracejada) — **"Abrindo câmera… leia o QR"**; após ler fica VERDE sólida com nome 24px, **"código · imobiliária"**, **"Corretor · X"**, **"CPF … · telefone"**
7.4 **"Não conseguiu ler o QR? Digite o código do crachá"** + input placeholder **"Ex.: APL-00015"** (Enter vale) + botão **"Usar código"**
7.5 Só secretaria: label **"Foto da PA (proposta de aquisição)"** + área clicável **"Tirar foto da PA"** → **"Foto da PA registrada ✓"** (fica verde)
7.6 Só secretaria: checkbox **"Plano personalizado"** + `<small>` **"(fica marcado na fila)"**
7.7 Botões **"Cancelar"** / **"Registrar na fila da secretaria"** (recepção: **"Credenciar"**)

### 8. Modal FICHA DO CLIENTE (`#cli-modal`, linhas 435-458 + `openCliente` 600-628)
8.1 Avatar 58x58 + nome 22px + **"Imobiliária · Corretor Fulano"** + selo **"★ Plano personalizado"**
8.2 Botão grande **"WhatsApp"** (ícone + texto), tooltip "Enviar acompanhamento da fila no WhatsApp"
8.3 Grade 2 colunas: **"CPF"** · **"TELEFONE"** · **"IMOBILIÁRIA"** · **"CORRETOR"**
8.4 Seção **"Unidades (N)"** + chips monoespaçados
8.5 Seção **"Jornada no evento"** — timeline vertical, linha e bolinhas verdes, item atual em azul com halo. Marcos com hora HH:MM: **"Credenciado na entrada"**, **"Entrou na fila da recepção"**, **"Chamado ao salão de vendas"**, **"Em negociação com o corretor X"**, **"Reservou a unidade VORxxxx"** (uma por unidade), **"Direcionado à secretaria"**, **"PA registrada"** (+ **" · plano personalizado"**), **"Em espera na secretaria"**, **"Atendido por X · Mesa 03"**
8.6 Botão **"Fechar"**

### 9. TOASTS (`#toast`, pílula escura no rodapé central)
9.1 **"🔊 Chamando <b>Nome</b> | aviso enviado no WhatsApp"** (3200 ms)
9.2 **"[wpp] <b>Nome</b> → em negociação | aviso enviado via WhatsApp"** / **"→ fila da secretaria | aviso enviado via WhatsApp"** / **"→ fila da recepção | senha da fila enviada via WhatsApp"** (3400 ms)
9.3 **"[wpp] Acompanhamento enviado para <b>Nome</b> | +55 31 9xxxx-xxxx"** (3000 ms)
9.4 Avisos `⚠️` (2600 ms): **"Finalize o atendimento antes de chamar."** · **"Finalize o atendimento antes de bipar."** · **"Digite o código do crachá."** · **"Faça a leitura do QR primeiro."** · **"Registre a foto da PA antes de concluir."**

### 10. Ponte com o telão
10.1 `BroadcastChannel("prometeu-fila")` — toda chamada publica `{id, nome, imob, corretor, tipo, mesa, proximos:[4 nomes]}`

### 11. Barra de mesas — NÃO EXISTE nesta tela
O CSS `.mesas-strip` está `display:none` e não há markup; `renderMesas(){ renderMinhaMesa(); } // (overview das mesas foi pra Central)` (linha 553). Não portar nada de "quem está sentado em cada mesa" — isso é invenção da versão React.

---

## 2. O QUE A VERSÃO REACT JÁ TEM

| Item | Situação |
|---|---|
| 3.1 Título "Fila da secretaria" | **OK** (linha 535 do TSX, como rótulo do card lateral) |
| 3.4a Posição na fila | **PARCIAL** — numera todos igual, em dourado, com `padStart(2,"0")` ("01"); falta o destaque do próximo |
| 3.4d Imobiliária | **PARCIAL** — mostra `imobiliaria ?? "Sem imobiliária"` + " · sem PA"; falta o corretor |
| 3.4e Tempo de espera | **PARCIAL** — `esperaDesde(c.etapaDesde)`, mesmo formato "12 min"/"1h05"; falta o vermelho ≥ 45 min |
| 3.4g Botão "Chamar" por linha | **OK** (linha 579) |
| 3.5 Estado vazio | **PARCIAL** — texto diferente: "Ninguém esperando na secretaria." |
| 3.6a "Chamar próximo" | **OK** (linha 524), com `disabled` por ocupado/fila vazia |
| 3.6c Toggle Ocupado | **PARCIAL** — botão pequeno no header alternando "Disponível"/"Ocupado", âmbar quando ligado; falta o peso visual do rodapé |
| 4.1-4.6 Overlay de chamada | **OK** — nome gigante, pílula "Secretaria · Mesa N", "chamado há …", 3 botões (Rechamar / Não veio / Compareceu) |
| 3.8 Número da mesa | **PARCIAL** — só "Mesa N" no header, sem card, sem estado, sem badge |
| — Escolha de mesa + localStorage + "Sair da mesa" | EXTRA (não está no mockup, mas resolve o "viria do Setup" da linha 551) |
| — Visualizador da PA inline, badges "PIX de R$ 1.000 pago" / "PA pendente", botão atualizar, faixa de erro, polling 10s | EXTRA |

Divergência de comportamento já conhecida: `rechamar()` no mockup REINICIA o `calledAt` (linha 675); no React não reinicia de propósito (comentário na linha 207). Manter a decisão do React, mas ela precisa de OK do Lucas porque contraria o mockup.

---

## 3. O QUE FALTA (exaustivo)

### A. Cabeçalho

**A1. Ícone do módulo (1.1)** — quadrado 44x44 escuro à esquerda do título. Onde: primeiro filho do `<header>`. Dado: nenhum (estático, `Lucide ListOrdered` ou o mesmo SVG).

**A2. Título "Central · Atendente" + subtítulo "PROMETEU · GESTÃO DE FILA" (1.2/1.3)** — o React usa "Atendimento · Secretaria" / "Mesa N". Onde: bloco da marca no header. Dado: estático; o nome do lançamento (`nomeDoLancamento(evento)`) pode virar uma terceira linha, mas o par de textos do mockup manda.

**A3. Operador logado (1.6)** — avatar com iniciais + nome + "Atendente · Secretaria". Onde: `.h-right`, antes do relógio. Dado: `fetchOperadorEu()` → `PrometeuOperadorEu.nome`, `.perfil` (label via `PROMETEU_PAPEIS`), `.zona` (label via `PROMETEU_ZONAS`). Já existe rota (`prometeu-operations.ts:426`) e a tela NÃO a consome hoje.

**A4. Relógio ao vivo (1.7)** — `HH:MM`, 20px bold, tabular. Onde: `.h-right`, entre o operador e o botão de tema. Dado: `useRelogio()` já existe no arquivo (linha 44) e está subutilizado.

**A5. Botão de tema (1.8)** — lua 38x38. Onde: extremo direito do header. Dado: nenhum; o hub já tem dark mode global (não precisa de toggle local se o shell do hub já dá — confirmar com o Lucas; no mockup ele existe).

**A6. Seletor de POSTO (1.4) e A7. Seletor de PAPEL (1.5)** — FORA DE ESCOPO por decisão do Lucas (27/07). Declarar explicitamente no PR, não portar.

### B. Indicadores — o buraco principal (a faixa inteira não existe)

**B1. Card "Atendimentos hoje" (2.1)** — verde, ícone prancheta+check, número inteiro. Onde: faixa de 4 colunas ENTRE o header e o grid, largura total, `padding:16px 16px 0`, gap 14px. Dado: **não existe no `FilaPayload`**. Fonte natural: tabela `prometeu_chamadas` (`mesa_id`, `credenciado_id`, `chamado_em`, `atendido_em`) — contar linhas com `atendido_em` no dia, `mesa_id = minha mesa`; ou contar credenciados que passaram para `etapa = "concluido"` hoje via `prometeu_movimentacoes`. **Exige campo novo no payload** (ex.: `resumoDaMesa: { atendimentosHoje, tempoMedioMs }`). Sem isso não há como acender o KPI 1.

**B2. Card "Tempo médio" (2.2)** — azul, ícone relógio, formato `m:ss`. Onde: 2ª coluna da faixa. Dado: também de `prometeu_chamadas` — média de `(liberação da mesa) − atendido_em`. O fim do atendimento hoje NÃO é carimbado por credenciado (o `liberarMesa` só muda a mesa e a etapa), então isso precisa de: (a) coluna `encerrado_em` em `prometeu_chamadas` ou (b) derivar de `prometeu_movimentacoes` (entrada em `concluido`/`cancelado`) menos `atendido_em`. **Decidir antes de implementar.** Como referência de meta existe `evento.config.metas.tempoMedioAtendimento`.

**B3. Card "Em espera" (2.3)** — âmbar, ícone pessoas. Onde: 3ª coluna. Dado: `fetchFila().filaSecretaria.length` — JÁ CHEGA na tela (usado hoje só como badge minúsculo na linha 537). Zero trabalho de backend.

**B4. Card "Maior espera" (2.4)** — vermelho, ícone ampulheta, "37 min" / "1h05" / "—". Onde: 4ª coluna. Dado: `min(filaSecretaria[].etapaDesde)` formatado com a mesma `esperaDesde()` que já existe (linha 55). Zero backend.

**B5. Regra de exibição dos KPIs** — somem quando o atendimento ocupa a tela inline e voltam quando popado (linhas 294-296). Precisa da mesma condicional na versão React se o item E for portado.

### C. Fila (coluna esquerda)

**C1. Abas "Fila" / "Aguardando retorno" com pílulas de contagem (3.2/3.3)** — Onde: topo do card da fila, abaixo do título. Dado: `FilaPayload.filaSecretaria` (aba 1) e `FilaPayload.noShow` (aba 2, `PrometeuCredenciado[]`, já vem no payload e a tela IGNORA). O flag por pessoa é `credenciado.noShow` (`metadata.noShow`).

**C2. Destaque do PRÓXIMO (`.frow.prox`) (3.4a)** — primeira linha com a posição invertida (fundo escuro/texto claro). Hoje todas as posições são iguais e douradas. Dado: índice 0 da lista.

**C3. Símbolo "↩" na posição, na aba de retorno (3.4a)** — Dado: aba ativa.

**C4. Avatar com iniciais por linha (3.4b)** — 42x42, canto 11px. Dado: `credenciado.nome` (helper `iniciais`).

**C5. Corretor na segunda linha (3.4d)** — hoje só imobiliária. Dado: `PrometeuCredenciado.corretor` (já vem, é usado só no overlay da chamada).

**C6. Selo "★ plano personalizado" + barra dourada na linha (3.4c/3.4h)** — **BLOQUEIO DE DADO**: não existe campo. `PrometeuCredenciado` não tem `perso`/`planoPersonalizado`. Caminho barato: gravar em `prometeu_credenciados.metadata` (o mesmo jsonb já usado por `noShow`, ver `data.ts:626`) no bip da secretaria, e expor no tipo. Onde aparece: linha da fila, ficha do cliente, painel de atendimento, overlay da chamada, destino em Últimas chamadas.

**C7. Espera em VERMELHO a partir de 45 min (3.4e)** — hoje sempre cinza. Dado: `etapaDesde`; só CSS condicional. Item barato e muito visível.

**C8. Ícone "⏱" antes do tempo (3.4e)** — o mockup prefixa o tempo. Detalhe visual.

**C9. Botão WhatsApp por linha (3.4f)** — 34x34, verde `#25d366`, tooltip "Enviar acompanhamento da fila no WhatsApp". Onde: entre o tempo e o botão Chamar. Dado: `PrometeuCredenciado.telefone` (existe, opcional, vem da ficha do Apolo). **O disparo real não existe** — não há rota de envio no `prometeu-operations.ts`. Duas opções: (a) botão abre `wa.me/<telefone>` (sem custo, sem template) ou (b) rota nova via Iris. No mockup é só toast; decidir com o Lucas.

**C10. Nome clicável abrindo a FICHA (3.4c)** — hoje o nome não é clicável em lugar nenhum. Ver item F1.

**C11. Botão "Rechamar" na aba de retorno (3.4g)** — Dado: `chamarCredenciadoRemoto({credenciadoId, eventoId, mesaId})` — já existe, é a mesma chamada.

**C12. Botão "No-show" vermelho na aba de retorno (3.4g)** — tira de vez e registra em Últimas chamadas. Dado: `marcarNoShemoto`… correto: `marcarNoShowRemoto({credenciadoId})` — já existe. Hoje o React usa essa função para o botão "Não veio" do overlay, o que é semanticamente diferente do mockup: lá "Não veio" manda para o **Aguardando retorno** (`ausencia()`, linha 676) e "No-show" é quem **remove de vez** (linha 683). Como o backend só tem um verbo, a aba de retorno = `FilaPayload.noShow`, e o "No-show" precisaria de um `moverCredenciado({etapa:"cancelado"})` ou verbo novo. **Ponto a decidir.**

**C13. Textos de estado vazio (3.5)** — trocar "Ninguém esperando na secretaria." por **"Fila vazia."** e criar **"Ninguém aguardando retorno."**.

**C14. Rodapé de ações com os 3 botões lado a lado (3.6)** — hoje "Chamar próximo" vive no meio do card do cliente e "Ocupado" no header. O mockup põe os três no RODAPÉ do card da fila, com "Chamar próximo" grande (19px, ícone play, sombra) e "Ocupado" âmbar sólido quando ligado. Reposicionamento puro, alto impacto de reconhecimento.

**C15. Botão "Bipar entrada" (3.6b)** — FORA DE ESCOPO no recorte do atendente (no mockup só aparece com `can-bipar`, isto é, recepção ou secretaria/organizador). Declarar no PR.

### D. Coluna lateral (os 3 cards de 430px)

**D1. Card "Fila do salão · em negociação" (3.7)** — FORA DE ESCOPO (só posto salão). Declarar. Se o Lucas pedir, o dado existe: `FilaPayload.filaSalao`.

**D2. Card "Minha mesa" (3.8)** — Onde: coluna direita, acima de "Últimas chamadas". Conteúdo: número em bloco 66x66/28px, rótulo fixo **"Mesa da secretaria"**, subtítulo dinâmico, badge de estado no cabeçalho, número E badge coloridos juntos. Dado: `PrometeuMesa.numero`, `PrometeuMesa.estado` (`livre` → "Disponível"/"pronta para o próximo"/cinza; `ocupada` → "Aguardando cliente"/nome do chamado/âmbar; `atendimento` → "Em atendimento"/nome do cliente/verde) e `credenciados.find(id === mesa.credenciadoId).nome`. **Tudo já está na tela hoje** (`mesa` na linha 141, `cliente` na 148). Zero backend.

**D3. Card "Últimas chamadas" (3.9)** — Onde: coluna direita, `flex:1`. Dado: **`FilaPayload.chamadas: PrometeuChamada[]`** (`chamadoEm`, `nome`, `mesa`, `zona`) — JÁ VEM no payload e o `fetchFila` da tela o descarta (linhas 112-115 só guardam filaSecretaria, mesas, credenciados, emTransito). Falta o STATUS colorido: `PrometeuChamada` não traz desfecho. Derivar: `atendido_em` preenchido + credenciado com `etapa` atual → "em atendimento"; credenciado com `noShow` → "não veio"; etapa `concluido` → "finalizado". **Ou** somar o status ao tipo no servidor. Destino textual: `"Secretaria · Mesa " + chamada.mesa`. Limite: 8 linhas.

### E. Painel de atendimento

**E1. Cabeçalho verde "● Em atendimento" com pulso (5.1)** — hoje o React reaproveita o mesmo card branco, com um rótulo cinza minúsculo ("Em atendimento"/"Chamado"). Dado: `mesa.estado === "atendimento"`.

**E2. Cronômetro do atendimento `mm:ss` 27px (5.3)** — Dado: início = `atendido_em` da chamada em aberto. **Não chega na tela**: `emTransito` só traz `chamadoEm` de chamadas ainda NÃO atendidas. Precisa de um campo novo no payload (ex.: `emAtendimento: { credenciadoId, atendidoEm }[]`), ou usar `credenciado.etapaDesde` como aproximação (menos fiel: a etapa pode não mudar ao atender — `marcarEmAtendimento` em `data.ts:1420` só mexe na mesa e na chamada).

**E3. "Pausar" / "Retomar" (5.7)** — cabeçalho vira âmbar, status vira **"Pausado"**, cronômetro congela, tempo pausado é descontado do KPI de tempo médio. **BLOQUEIO DE DADO**: não existe pausa no banco. Ou é estado local (perde no F5) ou vira `metadata.pausas` no credenciado / coluna em `prometeu_chamadas`. Decidir com o Lucas.

**E4. Botão "Direcionar" + modal (5.7 / seção 6)** — Onde: ação do meio no rodapé do card de atendimento. Dado: `moverCredenciado({credenciadoId, etapa, motivo})` já aceita motivo, e `liberarMesaRemoto({mesaId, etapa, motivo})` faz os dois num ato. Mapa dos 4 destinos do mockup para `PROMETEU_ETAPAS`: "Negociação (salão)" → `negociacao`; "Reserva" → `reserva`; "Recepção" → `recepcao`; **"Financeiro" → não existe etapa com esse nome** — o mais próximo é `pagamento`. Confirmar o rótulo com o Lucas antes de trocar o texto do chip.

**E5. Chips das unidades (5.5)** — monoespaçados, "VOR0312". Dado: `PrometeuCredenciado.unidades[].codigo` (existe, `PrometeuUnidade` tem `codigo`, `quadra`, `lote`, `situacao`) — a tela NÃO usa hoje.

**E6. Selo "★ Plano personalizado" no atendimento (5.6)** — depende do C6.

**E7. Janela flutuante Document PiP + botão de pop-out (5.2/5.8)** — `documentPictureInPicture.requestWindow({width:400,height:340})`, copia as folhas de estilo, move o card, liga `pip-out`, `pagehide` devolve o card sem finalizar. Item de maior custo técnico da lista; portar POR ÚLTIMO.

**E8. Layout inline que esconde fila e KPIs (5.8)** — hoje o React mantém o grid de 2 colunas sempre. Portar junto com E1.

**E9. Textos dos botões (5.7)** — o React usa **"Chegou na mesa"** (mockup: **"Compareceu"**), **"Concluir atendimento"** (mockup: **"Finalizar"**) e **"Cancelar"** (mockup: no rodapé do atendimento não existe Cancelar — existe **"Direcionar"**). Ajuste de texto puro, custo zero, alto impacto de reconhecimento.

**E10. Avatar + nome 19px + subtítulo "imob · corretor · destino" (5.4)** — o React mostra o nome em 3xl e "imobiliária · corretor" sem o destino, e sem avatar.

### F. Modais ausentes

**F1. Ficha do cliente (seção 8)** — Onde: abre pelo clique no nome (fila, últimas chamadas, negociação). Dados por bloco:
- Cabeçalho: `nome`, `imobiliaria`, `corretor` → "Imobiliária · Corretor X"; selo perso (C6); botão WhatsApp (`telefone`)
- Grade: **CPF** → `PrometeuCredenciado.documento`; **Telefone** → `telefone`; **Imobiliária** → `imobiliaria`; **Corretor** → `corretor`
- **Unidades (N)**: `unidades[].codigo` + `unidades.length`
- **Jornada no evento**: `FilaPayload.atividade: PrometeuAtividade[]` (`deEtapa`, `paraEtapa`, `em`, `motivo`, `nome`) — vem do payload e a tela ignora; é o feed do evento inteiro, então precisa filtrar pela pessoa (hoje `PrometeuAtividade` traz `nome`, não o `credenciadoId` — **conferir se dá para casar sem ambiguidade; se não, somar `credenciadoId` ao tipo**). Complementos fora da `atividade`: "Credenciado na entrada" = `entrouEm`; a data da CAD = `chegouEm`; "PA registrada" = existência de `paPath`; "Etiqueta impressa" = `etiquetaImpressaEm`; "PIX pago" = `pagoEm`. Fonte bruta: `prometeu_movimentacoes`.

**F2. Modal Bipar (seção 7)** — FORA DE ESCOPO na tela do atendente (é do organizador/recepção). Já existem os verbos no backend (`bipDaSecretariaRemoto`, `enviarPaRemoto`, `fazerCheckInRemoto`). Declarar como não-portado.

### G. Diversos

**G1. Toasts (seção 9)** — nenhum feedback transitório existe hoje; o React só tem uma faixa de erro vermelha estática. Onde: pílula escura fixa no rodapé central, `z-index` acima de tudo. Textos exatos no item 9.

**G2. Avisos de bloqueio** — "Finalize o atendimento antes de chamar." não existe no React (lá o botão fica `disabled`, o que é aceitável, mas o aviso é o que o Lucas viu).

**G3. `BroadcastChannel("prometeu-fila")` (10.1)** — o React não avisa o telão. Payload do mockup: `{id, nome, imob, corretor, tipo, mesa, proximos:[4 nomes]}`. Verificar se o telão React já escuta outro canal antes de portar.

**G4. Ordem visual do grid** — o mockup é `1fr 430px` com a FILA à esquerda e a coluna de cards à direita. O React é `1fr 360px` com o CLIENTE à esquerda e a fila à direita. **A fila trocou de lado.** Esse é o item que mais muda a leitura da tela: no mockup a coluna esquerda é sempre a fila e o cliente só aparece em atendimento (inline, sobrepondo).

**G5. Tela de escolha de mesa mostrando quem está sentado** — invenção da versão React (o mockup não tem overview de mesas nesta tela; ver item 11). Não é erro, mas o "quem está sentado" mostra o nome do CLIENTE (`credenciadoId`), não do atendente — o rótulo pode confundir. Revisar o texto.

---

## 4. CLICÁVEIS (elemento → o que abre)

**Não clicáveis:** os 4 cards de KPI (sem `onclick`, sem `cursor:pointer`, sem filtro), o card "Minha mesa", o relógio.

| Elemento | Abre / faz |
|---|---|
| Nome do cliente na FILA | modal **Ficha do cliente** (`openCliente`) |
| Nome em **Últimas chamadas** | mesma ficha (quando há `cliId`) |
| Nome na fila **em negociação** | mesma ficha |
| Botão WhatsApp na linha (fila, negociação, ficha) | **toast** "Acompanhamento enviado para …" (não abre modal) |
| Aba "Fila" / "Aguardando retorno" | troca a lista (filtro, sem modal) |
| "Chamar" (linha, aba Fila) | **overlay de CHAMADA** em tela cheia |
| "Rechamar" (linha, aba Retorno) | tira do retorno e abre o mesmo overlay |
| "No-show" (linha, aba Retorno) | remove da fila + registra em Últimas chamadas (sem modal) |
| "Chamar próximo" | **overlay de CHAMADA** com o índice 0 |
| "Bipar entrada" | **modal BIPAR** (câmera simulada em 900 ms) |
| "Ocupado" | toggle; desabilita "Chamar próximo" |
| No overlay: "🔁 Rechamar" | zera o "chamado há" e reemite o toast |
| No overlay: "✕ Não veio" | manda para **Aguardando retorno**, libera a mesa, fecha o overlay |
| No overlay: "✓ Compareceu" | abre o **painel de ATENDIMENTO** (que por sua vez tenta abrir a janela PiP) |
| No overlay (fora da secretaria): "Bipar · ler QR" | joga o cliente para a fila de negociação |
| Seta no cabeçalho verde do atendimento | **janela flutuante do SO** (Document PiP) |
| "Pausar" / "Retomar" | alterna a pausa (cabeçalho âmbar, status "Pausado") |
| "Direcionar" | **modal DIRECIONAR** (4 chips + motivo) |
| "Finalizar" | fecha o atendimento, libera a mesa, **alimenta os KPIs 1 e 2** |
| No modal Bipar: área do QR | auto-preenche em 900 ms |
| No modal Bipar: "Usar código" (ou Enter) | preenche o cartão pelo código digitado |
| No modal Bipar: "Tirar foto da PA" | marca a PA, card fica verde |
| No modal Bipar: checkbox "Plano personalizado" | marca/desmarca |
| No modal Bipar: "Registrar na fila da secretaria" | valida QR + PA e empurra pra fila |
| Na ficha: botão WhatsApp grande | mesmo toast de acompanhamento |
| Na ficha: "Fechar" | fecha o modal |
| Header: botões de posto/papel | trocam a tela inteira (fora de escopo) |
| Header: lua | dark mode |

---

## 5. ORDEM DE PORTE (para a tela ficar reconhecível pro Lucas)

**Lote 0 — 30 minutos, zero backend, é o que ele "vê" primeiro**
1. **G4**: inverter o grid — fila à ESQUERDA (`1fr`), coluna de cards à DIREITA (430px).
2. **B3 + B4**: acender já os KPIs "Em espera" e "Maior espera" com o dado que a tela tem; deixar os cards 1 e 2 na faixa com placeholder ("—") para o layout de 4 colunas existir desde o primeiro print. Rótulos exatos, ícones e cores do item 2.
3. **A2 + A4**: título "Central · Atendente" / "PROMETEU · GESTÃO DE FILA" + relógio ao vivo (`useRelogio` já existe).
4. **E9**: renomear botões — "Compareceu", "Finalizar", "Direcionar" no lugar de "Chegou na mesa", "Concluir atendimento", "Cancelar". **C13**: "Fila vazia.".

**Lote 1 — a fila fica igual ao mockup (só front)**
5. **C4** avatar com iniciais · **C5** corretor na segunda linha · **C8** ícone ⏱ · **C7** vermelho ≥ 45 min · **C2/C3** destaque do próximo e "↩".
6. **C14**: rodapé com "Chamar próximo" grande + "Ocupado" âmbar sólido lado a lado.
7. **D2**: card "Minha mesa" com número 66x66, badge de estado e os 3 pares de cor/subtítulo (dado 100% disponível).

**Lote 2 — a coluna direita ganha vida (dado já no payload, hoje descartado)**
8. **D3**: "Últimas chamadas" a partir de `FilaPayload.chamadas` (+ derivar o status colorido).
9. **C1 + C11**: abas "Fila" / "Aguardando retorno" a partir de `FilaPayload.noShow`, com contagens e "Rechamar". Decidir o C12 (No-show que remove de vez) junto.
10. **A3**: operador logado via `fetchOperadorEu()`.

**Lote 3 — o atendimento vira uma tela (front + 1 campo no payload)**
11. **E1 + E8 + E10 + E5**: cabeçalho verde, layout inline que esconde a fila e os KPIs, avatar/nome/subtítulo com destino, chips das unidades.
12. **E2**: cronômetro — exige `atendidoEm` no payload.
13. **E4**: modal Direcionar (backend já existe; fechar o rótulo "Financeiro" com o Lucas).
14. **G1 + G2**: toasts com os textos exatos.

**Lote 4 — o que depende de decisão do Lucas / migration**
15. **B1 + B2**: KPIs "Atendimentos hoje" e "Tempo médio" — exige agregação nova (`prometeu_chamadas` / `prometeu_movimentacoes`) e possivelmente um `encerrado_em`.
16. **C6 + E6**: plano personalizado — exige campo (`metadata` do credenciado) e o bip da secretaria gravando.
17. **F1**: ficha do cliente com a timeline "Jornada no evento" (`atividade` + `entrouEm`/`chegouEm`/`paPath`/`pagoEm`; conferir se dá para casar a atividade por pessoa).
18. **C9**: botão WhatsApp por linha — definir wa.me x rota via Iris.
19. **E3**: Pausar/Retomar — definir onde a pausa mora.
20. **E7**: janela flutuante Document PiP (maior custo, menor risco de o Lucas sentir falta antes).
21. **G3**: BroadcastChannel para o telão (checar antes o que o telão React já escuta).

**Declarar explicitamente como NÃO PORTADO no PR** (para não parecer esquecimento): A6/A7 seletores de posto e papel, C15 botão "Bipar entrada", D1 card "Fila do salão · em negociação", F2 modal Bipar, e o item 11 (barra de mesas — que também não existe no mockup).
---

## 6. O QUE É NOVO (não está no mockup, decidido pelo Lucas em 27/07)

O mockup nasceu com a mesa FIXA (`#mm-num` chumbado em "03"). Estes itens são adições que o
Lucas pediu depois e que o porte NÃO pode perder ao seguir o HTML:

**N1. Escolha da mesa ao entrar.** "eu tenho que selecionar a mesa que eu irei atender como
gestor". Grade de mesas, mesa não-livre bloqueada, escolha guardada em
`localStorage['prometeu:mesa-do-atendente']`, botão "Sair da mesa" no cabeçalho.
⚠️ Cada card de mesa mostra o NOME de quem está sentado, não "em uso".

**N2. Sem seletor de posto/papel.** A tela é exclusiva do atendimento da secretaria — os dois
seletores do mockup (itens 1.4 e 1.5) NÃO entram.

**N3. A PA abre DENTRO da tela** (overlay), nunca em outra aba.

**N4. No-show com volta.** Quem não veio sai da fila e vai para a lista de no-show; chamar de
novo o traz de volta ao fluxo (o `chamarCredenciado` limpa a marca sozinho).

**N5. Rechamar NÃO reinicia o cronômetro** — o tempo conta desde a primeira chamada.

**N6. Auto-refresh de 10s** com gate de `visibilityState`, porque são 18 mesas na mesma fila.

---

## 7. DECISÕES DO LUCAS (27/07, noite) — pendentes de implementação

**D1. Botão WhatsApp na linha da fila = REENVIO do link da fila.**
Não é mensagem nova: é reenviar ao cliente o MESMO link que ele deveria ter recebido no
check-in, para acompanhar a posição dele no celular.
⚠️ DEPENDE da página pública do cliente, que ainda NÃO existe (task "Prometeu: página do cliente
para acompanhar a fila no celular"). Sem ela o botão não tem o que enviar.
Telefone já chega no payload (`PrometeuCredenciado.telefone`).

**D2. "No-show" = EXCLUSÃO.** O termo fica reservado para tirar de vez.
Hoje "Não veio" manda para a aba "Aguardando retorno" (recuperável). O botão vermelho de
no-show remove em definitivo. Ver item C12 da secção 3.

**D3. Operador logado no cabeçalho: SIM.** Portar o item A3 — avatar com iniciais, nome e
"papel · zona", via `fetchOperadorEu()` (a rota existe e a tela não consome).

**D4. "Atendimentos hoje" conta a partir do CHECK-IN — confirmado pelo Lucas.**
"atendimento é caracterizado a partir do check-in": os direcionados CONTAM. Se a pessoa sentou
e foi atendida, foi atendimento, mesmo que o desfecho tenha sido devolvê-la para a Reserva.
Manter como está.

---

## 8. O MÉTODO DEFINITIVO (27/07, noite) — "pega o código do mockado e habilita o motor"

O Lucas cortou a tela do Atendente três vezes. Na terceira ele disse a frase que fecha o assunto:

> "acho que vc não entendeu, é para ser igual, pega o codigo do mockado e habilitar motor na esteira"

**Portar NÃO é reimplementar em Tailwind seguindo uma lista.** É pegar o CSS e o markup do
mockup como estão e trocar SÓ a origem do dado.

### Como se faz

1. **CSS**: rodar o escopador (`scratchpad/escopar-css.mjs`, versionar se sumir) sobre o
   `.html` do mockup. Ele:
   - prefixa toda regra com o wrapper (`.pcx` na Central, `.pat` no Atendente);
   - traduz `:root`/`body` para o wrapper;
   - traduz `body.dark` para `[data-uix-theme="dark"] <wrapper>` (o tema do Panteon fica no
     `<html>`, via `providers/theme-provider.tsx`);
   - move o ESTADO que o mockup punha no body (`body.can-atender`, `body[data-posto=…]`,
     `body.em-atendimento`, `body.pip-out`) para o wrapper;
   - prefixa os `@keyframes` para não colidirem entre telas.
   Saída: `cockpit-estilo.ts` / `atendente-estilo.ts`. **Não editar à mão** — regerar.
2. **Markup**: copiar a estrutura e as CLASSES do mockup para o JSX. Mesma ordem, mesmos
   rótulos.
3. **Motor**: trocar o array inventado pelos dados das tabelas `prometeu_*`.
4. **Ajustes**: só o que o mockup não previa por ser página inteira (`height:100vh` →
   `100%`) fica num bloco `AJUSTES_NO_HUB` separado, dentro do `.tsx`. Nunca no arquivo gerado.

### Como se confere (o typecheck NÃO pega isto)

`scratchpad/conferir-classes.mjs` compara as classes usadas no JSX com as declaradas no CSS.
Classe fora da lista = peça sem estilo. Foi assim que apareceram, nesta rodada:
- `unid-chip` (do cockpit) usada no Atendente, onde a classe certa é `u-chip`;
- `clt-txt`/`clt-when` inventadas, quando o mockup usa `clt-t`/`clt-w`.

### O que ficou fora, e por quê
- **Bipar entrada** (`#bip-modal`): o bip é no celular do organizador, não no notebook da mesa.
- **`.postos` e `.roletog`** viraram INDICADOR desabilitado: no mockup eram para alternar entre
  as três telas do protótipo; na tela real o posto vem da sessão do operador.
- **Jornada**: o mockup montava os passos por índice (inventado). Aqui só entram os carimbos
  reais da pessoa (CAD, PIX, check-in, etiqueta, PA, etapa atual).
- **R$ do funil**: sem fonte (virá do C2X). Travessão, nunca número inventado.

### O que a revisão adversarial pegou (27/07, noite)

21 achados levantados por 5 lentes independentes, 11 sobreviveram à tentativa de refutação. Os
que valem lembrança:

1. **[ALTA] Blip de rede expulsava o atendente do atendimento.** `carregar()` aplicava
   `setMesas(data?.mesas ?? [])` mesmo quando o fetch falhava. Um poll de 10s sem resposta zerava
   as mesas → `mesa` virava null → a tela do atendimento em curso era trocada pela pergunta "Em
   qual mesa você vai atender?", dizendo ainda "Nenhuma mesa cadastrada no Setup". E como o poll
   é silencioso, nem erro aparecia. **A Central já fazia o guard certo; o Atendente não.**
   Regra: **sem payload, mantém o que está na tela.**
2. **Ações que liberavam a mesa sem conferir se o servidor aceitou.** "Finalizar" e "Não veio"
   descartavam o `{error}`. A tela dizia "concluído", o banco mantinha a pessoa em `secretaria`,
   ela voltava para a fila e outra das 18 mesas a chamava de novo. "Rechamar" pintava "Chamado!"
   sem chamada. As outras quatro ações do arquivo já conferiam — era omissão, não decisão.
3. **Keyframe prefixado duas vezes.** O `atendente.html` declara `@keyframes pulse` DUAS vezes; o
   escopador montava a lista sem `Set` e a segunda passada gerava `pat-pat-pulse`, nome
   inexistente. O ponto pulsante da chamada em destaque ficava parado. Corrigido no script com
   `new Set(...)` — quem regerar o CSS precisa da versão corrigida.
4. **`id` do mockup não é decoração.** `#cli-modal` e `#cli-unids` carregam o padding do card da
   ficha; sem eles o modal caía na regra genérica e ganhava 24px de moldura sobre o padding que
   cada seção já tem. O conferidor de CLASSES não pega isso: ele não olha id.
5. **A janela flutuante (PiP) é outro documento.** Não tem o preflight do Tailwind, e o reset do
   mockup virou `.pat *`, que não alcança o `<body>` de lá. Faltavam `body{margin:0}` e
   `.pat.pip-solo{padding:0}`, senão a faixa de botões saía para fora da janela.
6. **`#ana-lista`/`#ana-kanban` são o scrollport do Analítico.** Sem os dois contêineres, a barra
   de busca e as sub-abas rolavam junto com as 400 linhas e o cabeçalho fixo da tabela ficava sem
   o container para o qual foi escrito.
7. **Modal da Central congelava a lista.** Guardava as PESSOAS no estado; passou a guardar as
   ETAPAS e derivar a lista no render, então a lista aberta acompanha o polling de 10s.

**Lição transversal:** o typecheck, os testes e o `next build` passaram nas duas telas ANTES de
qualquer um desses defeitos ser encontrado. Porte de mockup precisa de revisão própria: fidelidade
(peça a peça), tradução do CSS, regressão contra a versão anterior e runtime do React.
