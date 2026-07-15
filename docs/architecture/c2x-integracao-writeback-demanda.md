# Necessidade de integração Panteon/Apolo ↔ C2X — para o time técnico da house

> Follow-up técnico após a reunião do Lucas com o Arthur (dono da house). Dirigido ao
> **time técnico** que vai avaliar/orçar. Objetivo: descrever a necessidade de integração
> e deixar que **eles** proponham o caminho (API/webhook) e informem os campos por tipo.
> Checklist técnico interno no final.

---

## Mensagem (copiar/adaptar e enviar ao time técnico)

Pessoal, tudo bem?

Conforme conversei com o Arthur na nossa reunião, estou passando pra vocês (time técnico) a
nossa necessidade de integração com o C2X, pra a gente já começar a alinhar o técnico.

Contexto rápido: a gente está desenvolvendo um hub próprio aqui na Careli, o **Panteon**. O
**C2X segue como o nosso módulo operacional**, o coração da operação, fazendo tudo que já
faz hoje: cadastro de unidades, reserva, proposta, contrato e financeiro. Isso não muda. Os
outros módulos que eu tinha no Odoo a gente está trazendo pra dentro, desenvolvendo
internamente no Panteon.

Um desses módulos é o nosso **CRM, o Apolo**. A partir de agora o cadastro do cliente vai
acontecer nele. E é aí que preciso de vocês: pra não cadastrar a mesma pessoa duas vezes
(uma no CRM e outra no C2X), o **Apolo vai alimentar o C2X** com esses dados. Ou seja,
quando eu cadastrar ou atualizar um cliente no Apolo, isso precisa chegar automaticamente no
C2X.

O que eu preciso de vocês nessa primeira frente:

1. **Qual o melhor caminho** pra isso do lado de vocês (API, webhook, o que for) e o
   **"contrato"**: o que eu preciso mandar, como mandar, e o que recebo de volta (pelo menos
   o id do registro criado no C2X, pra eu casar de volta). Do meu lado, o ideal é escrita
   **automática** (sem tela/aprovação manual), com validação de vocês retornando erro claro
   quando algo não passa.
2. **Quais campos vocês precisam receber** pra cadastrar cada tipo no C2X, porque cada um
   tem sua regra: **imobiliária, corretor, cliente e incorporador**. (Detalhe: no nosso CRM
   a gente trabalha com "prospect", mas sei que no C2X a pessoa só vira cliente quando tem
   proposta, então me orientem como querem receber isso.)

A segunda frente é **performance**. Hoje vários módulos do Panteon são alimentados por dados
do C2X, e a gente lê direto do banco de vocês. Pra deixar rápido e sem pesar na produção,
preciso de:

3. Um jeito de vocês me **avisarem quando algo importante muda** no C2X (proposta faturada,
   novo cliente, distrato, mudança de estágio), por webhook ou notificação. Hoje eu fico
   varrendo o banco pra descobrir, e isso é lento e pesado.
4. Um **acesso de leitura que não dispute com a produção** de vocês, uma réplica dedicada ou
   uma API de leitura, porque do jeito que está eu concorro por conexão com o sistema de
   vocês.
5. Que vocês me **avisem antes de mexer na estrutura do banco** (renomear coluna, mudar
   tabela), porque hoje qualquer mudança dessas quebra do nosso lado sem aviso.

Me retornem o caminho que faz mais sentido pra vocês, o contrato e os campos por tipo, e um
panorama de esforço e prazo. Se ficar melhor, a gente marca uma call técnica pra fechar os
detalhes. Fico à disposição.

Abraço.

---

## Checklist técnico (interno, para acompanhar a resposta)

### 1. Escrita Apolo → C2X (alimentar o C2X)
- [ ] **Caminho técnico** (decisão deles): API REST, webhook, fila. Queremos escrita
      **automática** (sem aprovação manual), **idempotente** (retry não duplica) e com
      **erro claro** na validação.
- [ ] **Contrato**: como criar e atualizar cadastro + retorno do **id do C2X**.
- [ ] **Campos por tipo** (eles informam): imobiliária, corretor, cliente, incorporador.
      Prospect é conceito do Apolo (no C2X vira cliente só com proposta).

### 2. Performance da comunicação (leitura/eventos)
- [ ] **Webhooks/eventos** do C2X: faturado, novo cliente, distrato, mudança de estágio.
- [ ] **Leitura dedicada**: read-replica ou API, pra não disputar conexão com o Rails de
      produção (`max_connections` escasso).
- [ ] **Aviso prévio de mudança de schema** enquanto a leitura for direta no banco.

### 3. Nosso lado (Apolo) — não depende da house
- Marca de origem (`metadata.source = "apolo"`) em tudo que criamos/editamos.
- Fila de envio + idempotência (guardar cada requisição e o id do C2X quando aplicada).
