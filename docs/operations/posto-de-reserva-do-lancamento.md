# Posto de reserva do lançamento — como deixar a máquina pronta

Guia da máquina que fica na **posição de reserva** do evento: monitor em pé, leitor fixo no
balcão, impressora de cupom ao lado. O objetivo é o fluxo rodar **sem clique nenhum** além de
escolher os lotes na tela.

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
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing --kiosk --app=https://c2x.app.br/prometeu
```

3. Nomeie como **Posto de Reserva** e use SEMPRE esse atalho na máquina do evento.

O que cada parte faz:

- `--kiosk-printing` → **imprime direto, sem diálogo**. É o que resolve o pedido.
- `--kiosk` → tela cheia de verdade, sem barra de endereço (o cliente não navega para outro lugar).
- `--app=` → abre já no Prometeu.

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

Ajustes no driver da impressora de cupom, se o papel sair com problema — as lições da PC42t valem
aqui ([[reference_prometeu_etiqueta_termica]]): **Pontilhado = Nenhum** (o "difusão de erro"
borra QR e preto sólido) e margens **Nenhuma** no Chrome.

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
4. **spacedesk**, SÓ se a tela for um tablet ([spacedesk.net/download](https://www.spacedesk.net/download/)
   no PC + app na Play Store). Com monitor comum, pular.

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
