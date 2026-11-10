# Segurança, LGPD e limites da IA

Conversas com pacientes são **dados pessoais sensíveis** (saúde) pela LGPD. Este código
ajuda, mas a responsabilidade pelo tratamento é da clínica. Converse com quem cuida da
privacidade e das regras do seu conselho profissional antes de ir ao ar.

## O que a IA não faz

- Não diagnostica, não interpreta exames e não indica ou ajusta remédios.
- Não promete preço, desconto ou horário que não esteja na base ou na agenda.
- Não pede documentos, cartão ou senhas pelo WhatsApp.
- Diante de sinais de emergência, orienta ligar **192 (SAMU)** e passa para a equipe.

Essas regras estão em `clinica/roteiro.md` e em proteções que rodam **antes** da IA
(`src/guard.js`). O detector é conservador: revise os cenários do laboratório sempre que
mudar o roteiro.

## Transparência

- A secretária se apresenta como **assistente virtual** e confirma isso se perguntarem.
- Informe no primeiro contato ou na sua política de privacidade que o atendimento usa IA
  e que a equipe acompanha as conversas.

## Mínimo necessário

- A IA recebe a conversa recente, o nome que o paciente usa no WhatsApp, os 4 últimos
  dígitos do telefone e as consultas dele. Não recebe o número completo.
- As lições de aprendizado passam por uma máscara de e-mail, CPF e telefone e **sempre**
  por revisão humana antes de entrar nas instruções. Máscara automática não é anonimização
  garantida: leia antes de aprovar.
- Defina por quanto tempo guarda as conversas e apague o que passar do prazo
  (`DATA_DIR/db.json`).

## Servidor

- Senha forte no painel (`PANEL_PASSWORD`) e HTTPS sempre.
- Webhooks conferidos por assinatura (Meta) ou segredo (WAHA). Não desligue essa checagem.
- Chaves só nas variáveis do servidor. Nunca no código, no GitHub ou no chat.
- Backups criptografados e com acesso restrito.
- Limite diário de respostas da IA para conter custo e abuso (`AI_DAILY_LIMIT`).

## Provedor de IA

Leia os termos comerciais e a política de retenção de dados da Anthropic para a API e
configure a conta da clínica de acordo. Use uma chave por projeto e acompanhe o consumo
no console.
