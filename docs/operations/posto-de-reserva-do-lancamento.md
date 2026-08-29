# Posto de reserva do lançamento — como deixar a máquina pronta

Guia da máquina que fica na **posição de reserva** do evento: a tela no suporte, leitor fixo no
balcão, impressora de cupom ao lado. O objetivo é o fluxo rodar **sem clique nenhum** além de
escolher os lotes na tela.

**A tela do próximo evento é o tablet, deitado** (Lucas, 28/08: *"pode deixar melhor deitado, o
suporte que tenho fica bom assim"*). Isso muda o formato da tela, **não** o resto do posto: o
computador, o leitor e a impressora continuam sendo os mesmos, pelo motivo da seção 6.

Escrito em 28/08/2026, depois do primeiro teste com hardware real (evento Villa Paris).

---

## 1. O leitor de código (2D USB)

Ele funciona como teclado: "digita" o conteúdo do QR e dá Enter. Não precisa de driver.

**Dois ajustes, lidos no manual do próprio aparelho (são QR codes de configuração):**

| ajuste | onde costuma estar no manual | por quê |
|---|---|---|
| **Layout de teclado → Português (Brasil) / ABNT2** | "Keyboard Country", "Language" | Sem isso o hífen do código sai como `;` — foi o que aconteceu no primeiro teste |
| **Sufixo Enter ligado** | "Add Enter Suffix", "Terminator: CR" | É o Enter que avisa a tela que a leitura terminou |

**Como conferir em 10 segundos:** abra o Bloco de Notas e bipe uma etiqueta. Tem que aparecer o
código **com hífens** e **pular linha sozinho**. Se aparecer com `;` no lugar do hífen, é o
layout; se não pular linha, é o sufixo.

> ⚠️ O sistema tem uma rede para o caso do separador trocado (`lib/prometeu/leitura-qr.ts`), então
> a leitura funciona mesmo com o leitor desconfigurado. Mas configure assim mesmo: a rede existe
> para o dia em que alguém plugar outro aparelho no meio do evento.

---

## 2. O Chrome em modo quiosque (é isto que tira o diálogo de impressão)

Por padrão o navegador **sempre** mostra a janela "Imprimir / Cancelar" — é decisão dele, não do
sistema. Com o modo quiosque de impressão, o papel sai direto na impressora padrão.

**Crie um atalho do Chrome só para esta máquina:**

1. Área de trabalho → botão direito → **Novo → Atalho**
2. No campo do caminho, cole (ajuste o caminho do Chrome se for diferente):

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk --window-position=2560,0 --user-data-dir="C:\PostoReserva" --app=https://c2x.app.br/prometeu
```

3. Nomeie como **Posto de Reserva** e use SEMPRE esse atalho na máquina do evento.

O que cada parte faz:

- `--kiosk-printing` → **imprime direto, sem diálogo**. É o que resolve o pedido.
- `--kiosk` → tela cheia de verdade, sem barra de endereço (o cliente não navega para outro lugar).
- `--window-position=` → **em qual tela o posto abre.** Ver o aviso das duas telas.
- `--user-data-dir=` → perfil separado. **Não é opcional, ver o aviso abaixo.**
- `--app=` → abre já no Prometeu.

> ⚠️ **SEM O `--user-data-dir`, A FLAG É IGNORADA quando o Chrome já está aberto.** O Chrome não
> sobe um processo novo para cada atalho: havendo janela aberta com o mesmo perfil, ele só manda
> abrir mais uma aba naquele processo — que foi iniciado sem `--kiosk-printing`. O sintoma
> engana, porque o atalho *parece* certo: abre a tela do posto e mesmo assim mostra o diálogo.
> Com perfil próprio, o posto sempre sobe como processo independente.
>
> Consequência prática: esse perfil é uma instalação limpa, então **faça o login do Panteon uma
> vez** nele. Depois fica salvo.

> ⚠️ **COM DUAS TELAS, O `--kiosk` ABRE NA PRINCIPAL.** Se a tela do posto é a segunda — o
> tablet no suporte, um monitor extra — o quiosque vai para o monitor errado e a tela do posto
> fica mostrando a área de trabalho. Quem resolve é o `--window-position`, que recebe a
> coordenada X onde aquela tela começa.
>
> **Para descobrir a coordenada na máquina em uso**, rode no PowerShell:
>
> ```powershell
> Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::AllScreens | Select-Object DeviceName, Primary, @{n='Posicao';e={"$($_.Bounds.X),$($_.Bounds.Y)"}}, @{n='Tamanho';e={"$($_.Bounds.Width)x$($_.Bounds.Height)"}}
> ```
>
> A tela do posto é a que tem o tamanho do tablet (1920×1200 no Redmi Pad SE); copie a
> `Posicao` dela para o `--window-position`. No notebook do Lucas, em 28/08, era `2560,0`.
>
> ⚠️ **Refaça essa conta na máquina do evento.** A coordenada depende de quantas telas existem
> e de como estão arrumadas, então no mini PC ela quase certamente será outra. A alternativa,
> se preferir não mexer no atalho, é marcar a tela do posto como **principal** no Windows.

> ⚠️ **A impressora que sair o cupom precisa ser a PADRÃO do Windows** nessa máquina. Em modo
> quiosque não há escolha de destino: vai para a padrão, sempre. Configure em
> *Configurações → Bluetooth e dispositivos → Impressoras*, e **desligue** "Deixar o Windows
> gerenciar minha impressora padrão" — senão o Windows troca sozinho para a última usada.

---

## 3. A impressora do cupom

⚠️ **O cupom NÃO é a etiqueta.** São duas impressoras diferentes e é fácil confundir:

| | impressora | papel | o que sai |
|---|---|---|---|
| Recepção / check-in | **Honeywell PC42t** | etiqueta 100×50mm | a credencial do cliente |
| Posto de reserva | **impressora de cupom 80mm** (Elgin i9 ou equivalente) | bobina contínua 80mm | o comprovante de reserva |

**Sintoma de estar imprimindo o cupom na impressora errada:** o diálogo mostra **"3 folhas de
papel"** e o comprovante aparece picotado em várias páginas. Foi o que aconteceu no teste de
28/08, com a PC42t selecionada: o cupom é contínuo (`@page { size: 80mm auto }`) e a etiquetadora
tem papel de tamanho fixo, então ele é fatiado em várias etiquetas.

Com a impressora de cupom correta e papel contínuo, sai uma tira só.

> **A tira em branco no topo de cada cupom é física, não é erro.** Entre a cabeça térmica e a
> lâmina da guilhotina existe um vão de uns 15 a 20mm; depois de cada corte esse pedaço de
> papel já passou pela cabeça sem ser impresso, e ele sai como cabeçalho em branco no cupom
> seguinte. Toda impressora de cupom faz isso, e nenhum ajuste de software elimina — é por
> isso que cupom fiscal de padaria também tem essa sobra.

Ajustes no driver da impressora de cupom, se o papel sair com problema — as lições da PC42t valem
aqui ([[reference_prometeu_etiqueta_termica]]): **Pontilhado = Nenhum** (o "difusão de erro"
borra QR e preto sólido) e margens **Nenhuma** no Chrome.

### Se o texto sair apagado, comece pela DENSIDADE

⚠️ **É o ajuste que mais pesa, e não está nas Preferências de impressão.** Fica em
*Propriedades da impressora → Configurações do Dispositivo → Opções instaláveis →
**Printing Density***. Saindo de fábrica em `default`, metade do cupom imprimia apagada;
subindo o nível, o mesmo arquivo passou a sair chapado.

Depois dela, na ordem:

1. **Meio-tom** (Preferências → Papel/Qualidade → Avançado): use **Seleção Automática**.
   Dither 6x6 e 8x8 existem para FOTO — eles espalham o preto num padrão de pontinhos e é
   isso que deixa o texto com cara de sujo.
2. **Velocidade de impressão**: mais baixa, se o driver oferecer. Mais tempo de cabeça sobre
   o papel, preto mais denso.
3. **Papel**: bobina térmica velha ou de baixa gramatura queima mal, por melhor que esteja a
   configuração.

### E o CSS, o que garante

No primeiro cupom impresso de verdade (28/08) o texto em **negrito** saiu perfeito e o de peso
normal saiu tão fraco que "COMPROVANTE DE RESERVA" imprimiu **"PESERVA"** — o R não marcou.

A causa é o meio-tom: o Chrome desenha texto fino com antialiasing, ou seja, em **cinza**. A
térmica não tem cinza, ela queima o ponto ou não queima; o driver aproxima o cinza por
pontilhado e o traço de 1px vira uma fileira de furos.

O cupom segue três regras, presas por teste em `imprimir-cupom.test.ts`:

1. **fonte de traço grosso** (Arial, não Courier) — a monoespaçada é fina por desenho e
   pinta pouco papel mesmo em negrito;
2. **nada abaixo de 11px**;
3. `-webkit-font-smoothing: none`, para o Chrome não suavizar a borda das letras.

Quem for acrescentar campo novo ao cupom não precisa lembrar disso: o teste reprova sozinho.

> Enquanto a densidade estava baixa, **tudo** no cupom precisava ser negrito para marcar. Com
> ela corrigida, o negrito voltou a ser hierarquia: destaque no que se lê de longe, peso
> normal no resto. Se o cupom voltar a sair fraco, **o problema é a densidade**, não o CSS.

---

## 4. Conferência final, antes do evento abrir

1. Abrir pelo atalho **Posto de Reserva** (não pelo Chrome comum).
2. Bipar uma credencial de teste → o cliente aparece na tela.
3. Escolher um lote → **Finalizar**.
4. O cupom deve sair **sozinho, em uma tira só**, sem nenhuma janela aparecer.
5. Bipar o cupom no posto da PA → a proposta sai.

Se em algum passo aparecer o diálogo de impressão, o Chrome não está com `--kiosk-printing`:
foi aberto pelo atalho errado.

---

## 5. A máquina do evento é DEDICADA (mini PC)

Decisão do Lucas (28/08): o posto roda num **mini PC exclusivo**, não no notebook de trabalho.
É o certo — máquina dedicada não tem atualização surpresa, notificação no meio da tela nem
alguém fechando o navegador sem querer.

**O que instalar nela, em ordem:**

1. **Google Chrome**.
2. **Driver da Elgin i8** — [elgin.com.br/download-center](https://www.elgin.com.br/download-center),
   filtrar por Automação, buscar i8, baixar o **Driver Spooler** (mesmo pacote da linha i7/i8/i9).
   Na instalação, apontar para a porta **USB** onde ela aparece (ela se identifica como
   `Printer POS-80`).
3. **Leitor 2D** — não precisa de driver; configurar no manual dele o layout **ABNT2** e o
   **sufixo Enter** (seção 1 deste guia).
4. **spacedesk** — é o que põe a tela no tablet
   ([spacedesk.net/download](https://www.spacedesk.net/download/) no PC + app na Play Store).
   Com monitor comum, pular. Ver a seção 6 antes.

**Ajustes do Windows que evitam parada no meio do evento:**

| ajuste | onde | por quê |
|---|---|---|
| **Nunca suspender / nunca desligar a tela** | Configurações → Sistema → Energia | O tótem fica ocioso entre clientes; se dormir, o operador acha que travou |
| **Impressora padrão fixa na Elgin** | Impressoras → Elgin i8 → Definir como padrão, e desligar "Deixar o Windows gerenciar" | O modo quiosque imprime na PADRÃO, sem escolha. Se o Windows trocar, o cupom vai para o lugar errado |
| **Desativar suspensão seletiva de USB** | Energia → Configurações avançadas → USB | Evita o leitor "dormir" e perder o primeiro bipe |
| **Adiar atualizações** | Windows Update → Pausar | Reinício automático no dia do evento é o pior cenário |
| **Login automático no Windows** | opcional | Se faltar energia, a máquina volta sozinha sem alguém digitar senha |

**Deixar pronto antes de sair:**

- O **atalho de quiosque** (seção 2) na área de trabalho e na inicialização.
- A **sessão do Panteon já logada** no Chrome dessa máquina, com o lançamento certo selecionado.
- Um **cupom de teste impresso e bipado no posto da PA** — é o único teste que prova o ciclo
  inteiro (leitor → tela → impressora → etapa seguinte).

⚠️ **Leve o notebook como reserva.** Se o mini PC falhar, o posto sobe em qualquer máquina com
Chrome, o leitor e a impressora — nada do fluxo depende daquele computador específico.

---

## 6. ⚠️ O tablet é a TELA, não o computador

Parece detalhe e não é: decide se o cupom sai sozinho ou não.

**O jeito certo — tablet como monitor (spacedesk).** O Chrome roda no mini PC; o leitor e a
impressora ficam plugados nele; o tablet mostra a tela e devolve o toque, por USB ou Wi‑Fi. O
tablet fica deitado no suporte, e nada do fluxo muda.

**O jeito que quebra — abrir o Panteon no navegador do próprio tablet.** Aí o posto perde as
duas pontas físicas do fluxo:

| | no mini PC | no navegador do tablet |
|---|---|---|
| **Cupom automático** | `--kiosk-printing` imprime direto | ❌ não existe no Android: toda impressão abre o diálogo do sistema, e a Elgin USB nem aparece como destino |
| **Leitor de balcão** | USB, funciona como teclado | só se for Bluetooth, pareado com o tablet |

Ou seja: no navegador do tablet, o *"finalizou, sai"* que o Lucas pediu vira "finalizou, alguém
toca em imprimir e escolhe a impressora" — em cada cliente. **Não vale a pena.**

**Como ligar o tablet como monitor:**

1. spacedesk **Driver** no mini PC + app **spacedesk** no tablet (Play Store).
2. Conectar por **USB** (tethering USB ligado no tablet) em vez de Wi‑Fi. A rede do salão cai, o
   cabo não.
3. No Windows: *Configurações → Sistema → Tela* → selecionar a tela do tablet →
   **Duplicar** (mais simples: o operador vê o mesmo no tablet e no mini PC, se houver monitor).
4. Confirmar que o **toque funciona** antes do evento: tocar um lote no tablet tem que marcar na
   tela. É a única parte do spacedesk que às vezes precisa de ajuste.

Com o tablet deitado, a tela de reserva já se ajusta sozinha ao formato — cartões e textos um
degrau menores para sobrar lista de lotes. Não há nada para configurar no sistema.
