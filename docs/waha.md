# Conectar pelo WAHA (API não oficial, por QR code)

O [WAHA](https://waha.devlike.pro) roda o WhatsApp Web dentro de um contêiner e oferece
uma API. Você conecta lendo um QR code, como faz no computador. É o jeito mais rápido de
começar: em minutos o WhatsApp já está dentro do painel.

> **Atenção:** é uma conexão **não oficial**. Mudanças no WhatsApp podem desconectar a
> sessão e existe risco de restrição do número. Use um número dedicado à clínica, nada de
> disparos em massa, e prefira a [API oficial](api-oficial.md) para o atendimento definitivo.

## Subir com Docker

1. Instale o [Docker](https://www.docker.com/products/docker-desktop/).
2. No `.env`:
   ```dotenv
   WHATSAPP_CHANNEL=waha
   WAHA_API_KEY=uma-chave-longa-e-aleatoria
   WAHA_WEBHOOK_SECRET=outra-chave-longa-e-aleatoria-com-24-ou-mais
   ```
   Para gerar chaves: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. Suba a secretária e o WAHA juntos:
   ```bash
   docker compose --profile waha up -d --build
   ```
   No Mac com chip Apple, se a imagem padrão não rodar, use `WAHA_IMAGE=devlikeapro/waha:arm` no `.env`.
4. Abra o painel → **Ajustes → WhatsApp → Conectar e gerar QR code**.
5. No celular da clínica: WhatsApp → **Dispositivos conectados → Conectar dispositivo** e leia o QR.
6. Quando o painel mostrar "conectado", mande um "oi" de outro celular.

Sem Docker Compose? Rode o WAHA onde quiser e aponte `WAHA_URL` para ele. O webhook é
criado automaticamente apontando para `PUBLIC_URL/webhooks/waha` (ou para
`WAHA_WEBHOOK_URL`, se você definir).

## Cuidados que o código já tem

| Situação | O que o código já faz | O que você faz |
| --- | --- | --- |
| Sessão "FAILED" | Ao clicar em Conectar, reinicia a sessão (o WAHA ignora um simples "start") | Se insistir, gere outro QR |
| Contato chega como `@lid` (sem telefone) | Consulta o número real no WAHA antes de decidir | Nada |
| Eco das nossas próprias mensagens | Reconhece e ignora; não confunde com resposta da equipe | Nada |
| A equipe responde pelo celular | A IA sai daquela conversa até alguém devolver | Use **Devolver à IA** no painel |
| Envio sem confirmação | Fica como "envio incerto" e **não** é repetido | Confira no celular antes de reenviar |
| Volumes do Docker | Sessão e dados ficam em volumes | Nunca use `docker compose down -v` (apaga a sessão) |

## Desligar

`docker compose --profile waha stop` para pausar. Para desconectar de vez, remova o
dispositivo em **Dispositivos conectados** no celular.
