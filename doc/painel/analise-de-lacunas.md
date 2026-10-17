# PAINEL × BudgetOS — análise de lacunas

Base: *PAINEL — Especificação de integração v1.0* (out/2026) comparada com o código do fork
`miguel2987kl-droid/BudgetOS` (branch `main`, commit `feda587`). Aqui o **Sistema Existente é o
próprio BudgetOS**: onde a especificação fala em "integrar com o Existente", a capacidade é
implementada dentro do app.

Legenda: ✅ já atende · 🟡 atende em parte · ❌ não existe

## Premissas (seção 2)

| ID | Situação no BudgetOS | Decisão |
|---|---|---|
| PR-01 Autenticação | ✅ Sessão com cookie, login, reset de senha, papéis `user`/`admin`/`super_admin`. | Reaproveitar. |
| PR-02 Empresas | ✅ `client_workspaces` (clientes do BPO) com moeda e formato pt-BR. Sem PF/PJ. | Reaproveitar; PF/PJ fica na conta (titularidade). |
| PR-03 Usuário × várias empresas | 🟡 Tabela `client_workspace_members` existe, mas só o criador entra (papel `owner`) e não há tela/API para vincular outros. | **R1**: API e tela de membros. |
| PR-04 Permissões por recurso/ação | ❌ Só papéis globais. | **R1**: matriz própria (RF-IN-07) com o catálogo da seção 10.2. |
| PR-05 Notificações | 🟡 Só e-mail transacional (reset de senha). Sem sino. | R4. |
| PR-06 Arquivos | 🟡 Upload só de imagens de favorecidos; tabela `attachments` sem uso. | R5. |
| PR-07 Auditoria | ❌ Nenhuma trilha. | **R1**: trilha própria com antes/depois. |
| PR-08 Menu e rotas | ✅ Menu React configurável no código. | **R1**: reordenar e filtrar por permissão. |
| PR-09 Pessoas | 🟡 `payees` (favorecidos) por empresa. | R5 (INT-10) sugere favorecidos. |
| PR-10 Convite por e-mail | ❌ Só cadastro manual pelo super admin. | Vincular usuários já cadastrados; convite fica para depois. |

## Por release

### R1 — Fundação (PR #4, integrado)

| Requisito | Antes | Entrega |
|---|---|---|
| RF-IN-01/02 Papéis → atores | ❌ | Papel do membro na empresa (`owner`, `collaborator`, `client`) mapeado por configuração para Administrador/Operador/Cliente/nenhum. Sem mapeamento: menu oculto e API 403. |
| RF-IN-03/04/05 Chaves | ✅ | Ids UUID estáveis; registros já pertencem à empresa (via identidade interna 1:1). Auditoria guarda `workspace_id` e o id do usuário real. |
| RF-IN-06 Falha de auditoria | ❌ | Gravação fora da resposta, com fila de reenvio automático e falhas visíveis ao super admin. |
| RF-IN-07 Matriz própria | ❌ | Catálogo 10.2 com padrões por ator, ajustável pelo super admin. |
| RF-IN-08 Empresa desativada | 🟡 Desativar hoje **bloqueia até a consulta**. | Passa a ficar somente leitura. |
| RF-IN-09 Padrões da empresa | 🟡 Categorias padrão já criadas. | Adiciona categoria protegida "Recorrências" e parâmetros financeiros iniciais. |
| RF-IN-13 Menu | 🟡 | Ordem da especificação, cada item com sua permissão. |
| RF-IN-14 Tema | ✅ | Mesmo tema do app. |
| RF-IN-16 / INT-07 Auditoria | ❌ | Toda inclusão, edição e exclusão das rotas financeiras gera `registro.alterado` com antes/depois; histórico por registro. |
| RN-16 Exclusão de empresa | ❌ Excluía na hora. | Arquivamento por 90 dias (configurável), restauração e expurgo automático. |
| E1 Contas (RF-CT-01..08) | 🟡 Contas, tipos, saldo inicial/atual, desativação. | Titularidade PF/PJ, final da conta, cheque especial, data do saldo, atualização de saldos em lote (por movimento de ajuste, RN-03), alerta de desatualização, cartão vinculado e histórico. |

### R2 — Operação financeira (este PR)

Cada registro de origem (pagamento de fatura, parcela de venda, entrada, parcela de recorrência, parcela de receita) é dono dos movimentos de conta que gera (`transactions.source_type/source_id`). Desfazer ou excluir o registro estorna os movimentos, e esses movimentos não podem ser alterados pela tela de lançamentos (RN-03).

| Épico | Antes | Entrega |
|---|---|---|
| E2 Cartões e faturas | 🟡 Cartões com ciclo, parcelamento e débito da fatura. | Tela **Faturas**: total = compras − estornos; competência = mês de fechamento; situação aberta/fechada/parcial/paga/vencida; pagamento parcial com conta, bloqueado acima do pendente; o pagamento é transferência, nunca despesa (RN-04); resumo dos cartões com limite usado, disponível, vencido e compromissos futuros; nova compra, estorno ou ajuste direto da tela. |
| E3 Vendas no cartão | ❌ | Venda com bandeira, operadora, taxa, desconto, parcelas e dias até o crédito; parcelas a receber pelo líquido; creditar e desfazer (movimento de liquidação, sem nova receita, RN-06); venda já creditada (débito ou antecipação); indicadores. |
| E4 Entradas bancárias | 🟡 Transações de receita e transferências. | Entrada com pagador, documento e forma; transferência entre contas próprias fora da receita (RN-05); aviso de duplicidade (mesma conta, valor e data) com confirmação; visão por banco. |
| E5 Recorrências | 🟡 `planned_transactions` gera lançamentos. | N parcelas ou sem prazo (gera 12 meses à frente), parcelas pagas antes do sistema fora de saldos (RN-11), pagar com conta ou fora das contas (RN-10), desfazer, reajuste, encerramento, saldo devedor e **Contas do mês**. Os lançamentos previstos antigos continuam em "Lançamentos previstos". |
| E6 Receitas | ❌ | Boleto, dinheiro e outras, com parcelas, recebimento com ou sem conta, vencido automático, cancelar mantendo histórico (RN-12); visão consolidada do mês com vendas no cartão (bruto), entradas e receitas, por origem e categoria (RN-02). |

Auditoria: cada operação grava `registro.alterado` com o registro inteiro (parcelas incluídas) antes e depois. O DRE por competência que usa esses dados chega na R3.

### R3 — Gestão

| Épico | Situação | Lacuna principal |
|---|---|---|
| E7 Visão geral | 🟡 Dashboard com totais e gráficos. | Competência × caixa, por banco/transação, link ao registro de origem. |
| E8 Relatórios | 🟡 Despesa por categoria, tendência, comparação. | Fluxo de caixa (3 tipos × 3 granularidades), DRE (3 variantes), DRE gerencial, classificação, CSV/PDF. |
| E13 Migração | ❌ (há importação de extrato CSV/OFX/QIF). | Importar backup JSON do PAINEL com prévia e reconciliação. |

### R4 — Cliente

| Épico | Situação | Lacuna principal |
|---|---|---|
| E10 Fechamento e Área do cliente | ❌ | Publicar/republicar mês, telas do cliente, a pagar/receber. |
| E14 / INT-05 Notificações | ❌ | Eventos da seção 8, sino, preferências, regra de não repetição. |

### R5 — Complementos

| Épico | Situação | Lacuna principal |
|---|---|---|
| E9 Planejamento e previsão | 🟡 Previsão de saldo e tabela `budgets`. | Orçado × realizado por linha do DRE, cenários, indicadores. |
| E11 Documentos e mensagens | ❌ | Pedidos, envio, avaliação, mensagens. |
| E12 Precificação | ❌ | Calculadora completa. |
| INT-09 Leads / INT-10 Pessoas | ❌ / 🟡 | Formulário de lead; sugestão de favorecidos. |

## Questões em aberto que afetam o código

- **Q-01** (papéis): adotado `owner`→Administrador, `collaborator`→Operador, `client`→Cliente, ajustável em Administração.
- **Q-07** (retenção): 90 dias, ajustável em Administração.
- **Q-11** (operador vê todas as empresas?): só as que tiver vínculo.
- Q-03, Q-08, Q-09 pesam na R4; Q-04, Q-06, Q-10 na R5.
