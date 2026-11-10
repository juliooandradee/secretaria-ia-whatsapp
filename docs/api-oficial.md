# Conectar pela API oficial do WhatsApp (Meta Cloud API)

É o caminho mais estável e dentro das regras da Meta. Leva mais tempo para configurar
na primeira vez, mas é o que eu recomendo para o atendimento definitivo.

## O que você precisa

- Uma conta empresarial na Meta (Gerenciador de Negócios / Meta Business Suite).
- Um número de telefone para a clínica que receba SMS ou ligação de verificação.
  O número não pode estar ativo no aplicativo comum do WhatsApp ao mesmo tempo, a não
  ser pelo modo de **coexistência** (cadastro incorporado de um provedor oficial).
- Um cartão cadastrado na Meta para as mensagens cobradas.
- Este servidor no ar com HTTPS (veja [deploy.md](deploy.md)): a Meta só chama endereços públicos.

## Passo a passo

1. Em [developers.facebook.com](https://developers.facebook.com/apps), crie um app do tipo
   **Empresa** e adicione o produto **WhatsApp**.
2. Em **WhatsApp → Configuração da API**, adicione e verifique o número da clínica.
   Anote o **Phone number ID** (identificação do número) → `META_PHONE_NUMBER_ID`.
3. Gere um token **permanente**: no Gerenciador de Negócios, crie um *usuário do sistema*,
   dê acesso ao app e ao número, e gere o token com as permissões
   `whatsapp_business_messaging` e `whatsapp_business_management` → `META_ACCESS_TOKEN`.
   (O token temporário da tela de testes expira em 24 horas.)
4. Em **Configurações do app → Básico**, copie a **Chave secreta do app** → `META_APP_SECRET`.
   Ela confere que cada aviso que chega veio mesmo da Meta.
5. Invente uma frase longa e aleatória → `META_VERIFY_TOKEN`.
6. Em **WhatsApp → Configuração → Webhook**:
   - URL de retorno: `https://SEU-SERVIDOR/webhooks/oficial`
   - Token de verificação: o mesmo `META_VERIFY_TOKEN`
   - Clique em **Verificar e salvar** e assine o campo **messages**.
7. No `.env`: `WHATSAPP_CHANNEL=oficial`, reinicie o servidor e mande um "oi" de outro
   celular. A conversa aparece no painel na hora.

## A janela de 24 horas e os modelos (templates)

- Quando o **paciente** escreve, abre uma janela de 24 horas: dentro dela a clínica (e a IA)
  responde com texto livre.
- Fora da janela, a Meta só aceita **modelos aprovados**. É o caso da confirmação de
  consulta e do retorno automáticos. Se a equipe tentar escrever livre fora da janela, o
  painel mostra o aviso "Fora da janela de 24 horas".

Crie os dois modelos em **WhatsApp Manager → Modelos de mensagem**, idioma Português (BR):

| Nome (`.env`) | Categoria sugerida | Texto |
| --- | --- | --- |
| `confirmacao_consulta` | Utilidade | Olá, {{1}}! Passando para confirmar sua consulta {{2}} com {{3}}. Você confirma? Se precisar, responda aqui que eu remarco. |
| `retorno_paciente` | Utilidade | Oi, {{1}}! Como você está depois da consulta com {{2}}? Se precisar de algo, é só responder por aqui. |

O servidor preenche `{{1}}` com o primeiro nome, `{{2}}` com dia e hora (na confirmação)
e o último parâmetro com o nome da profissional (`clinica/agenda.json`). A Meta pode
reclassificar a categoria na aprovação.

## Custos da Meta

A Meta cobra por mensagem de modelo, conforme a categoria e o país. Respostas dentro da
janela de 24 horas aberta pelo paciente seguem regras próprias. Confira sempre a tabela
atual em [developers.facebook.com/docs/whatsapp/pricing](https://developers.facebook.com/docs/whatsapp/pricing).

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| A verificação do webhook falha | Confira se o servidor está no ar com HTTPS e se o `META_VERIFY_TOKEN` é idêntico nos dois lados. |
| Mensagens chegam com erro 401 no log | `META_APP_SECRET` errado: copie de novo em Configurações do app → Básico. |
| Envio falha com código 131047 | Fora da janela de 24 horas: use um modelo aprovado. |
| Envio falha com erro de permissão | Token sem as duas permissões ou sem acesso ao número. Gere de novo pelo usuário do sistema. |
| Telefone chega sem o 9º dígito | Normal em contas antigas. O sistema compara as duas formas e responde no identificador que o WhatsApp mandou. |
