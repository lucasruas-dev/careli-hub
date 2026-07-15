# Mensagem para a house do C2X (integração com o Panteon/Apolo)

> Rascunho no tom do Lucas para enviar ao Arthur (house que desenvolve o C2X). O objetivo
> é abrir a conversa da integração: como o Apolo (nosso CRM) alimenta o C2X, e o que
> precisamos deles para performance. Deixa eles proporem o caminho técnico e os campos.
> Checklist técnico interno no final.

---

## Mensagem (copiar/adaptar e enviar)

Pessoal, tudo bem?

Complementando a conversa que tive com o Arthur na segunda: a gente tem uma frente aqui na
Careli que é o desenvolvimento de um hub próprio, o **Panteon**. A ideia é a seguinte: o
**C2X continua sendo o nosso módulo operacional**, o coração da operação, fazendo tudo que
já faz hoje, cadastro de unidades, reserva, proposta, contrato e financeiro. Isso não muda.
Os outros módulos que eu tinha no Odoo a gente está trazendo pra dentro, desenvolvendo
internamente no Panteon.

Um desses módulos é o nosso **CRM, o Apolo**. A partir de agora o cadastro do cliente vai
acontecer nele. E aí entra o que eu preciso de vocês: pra não ter que cadastrar a mesma
pessoa duas vezes (uma no CRM e outra no C2X), o **Apolo vai alimentar o C2X** com esses
dados. Ou seja, quando eu cadastrar ou atualizar um cliente no Apolo, isso precisa chegar
automaticamente no C2X.

Preciso que vocês me digam o **melhor caminho pra isso do lado de vocês**: se é API,
webhook, o que for. E me passem o "contrato": o que eu preciso mandar e como mandar, pra eu
construir a nossa parte aqui. Junto com isso, me digam também **quais campos vocês precisam
receber pra cadastrar cada tipo de registro** no C2X, porque cada um tem sua regra:
**imobiliária, corretor, cliente e incorporador**. (Um detalhe: no nosso CRM a gente
trabalha com "prospect", mas sei que no C2X a pessoa só vira cliente quando tem proposta,
então me orientem como vocês querem receber isso.)

A segunda parte é **performance**. Hoje vários módulos do Panteon são alimentados por dados
do C2X, e a gente lê isso direto do banco de vocês. Pra deixar rápido e sem pesar na
produção, eu preciso de:

1. Um jeito de vocês me **avisarem quando algo importante muda** no C2X (proposta faturada,
   novo cliente, distrato, mudança de estágio), por webhook ou notificação. Hoje eu fico
   varrendo o banco pra descobrir, e isso é lento e pesado.
2. Um **acesso de leitura que não dispute com a produção** de vocês, uma réplica dedicada
   ou uma API de leitura, porque do jeito que está eu concorro por conexão com o sistema de
   vocês.
3. Que vocês me **avisem antes de mexer na estrutura do banco** (renomear coluna, mudar
   tabela), porque hoje qualquer mudança dessas quebra do nosso lado sem aviso.

Me falem o que precisam da minha parte pra tocar isso e um panorama de esforço e prazo.
Qualquer coisa a gente marca uma call pra alinhar os detalhes técnicos.

Abraço.

---

## Checklist técnico (interno, para acompanhar a resposta da house)

O que estamos pedindo e o que esperamos receber de volta:

### 1. Escrita Apolo → C2X (alimentar o C2X)
- [ ] **Caminho técnico** (decisão deles): API REST, fila, ou outro. Queremos escrita
      **automática** (sem tela/aprovação manual), com **idempotência** (retry não duplica)
      e **erro claro** na validação.
- [ ] **Contrato**: endpoints/payload para **criar** e **atualizar** cadastro.
- [ ] **Campos obrigatórios por tipo** (eles informam): imobiliária, corretor, cliente,
      incorporador. (Prospect é conceito do Apolo; no C2X vira cliente só com proposta.)
- [ ] Retorno do **id do registro no C2X** (para casarmos de volta).

### 2. Performance da comunicação (leitura/eventos)
- [ ] **Webhooks/eventos** do C2X: faturado, novo cliente, distrato, mudança de estágio
      (elimina o polling atual).
- [ ] **Acesso de leitura dedicado**: read-replica ou API, para não disputar conexão com o
      Rails de produção (o banco tem `max_connections` escasso).
- [ ] **Aviso prévio de mudança de schema** enquanto a leitura for direta no banco.

### 3. Nosso lado (Apolo) — não depende da house
- Marca de origem (`metadata.source = "apolo"`) em tudo que criamos/editamos, pra o sync do
  C2X não sobrescrever e sabermos o que enviar.
- Fila de envio + idempotência (guardar cada requisição e o id do C2X quando aplicada).
