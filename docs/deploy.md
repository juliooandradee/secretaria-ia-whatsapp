# Colocar no ar

A secretária precisa de um servidor ligado 24 horas, com HTTPS e um disco que não se
apague (os dados ficam em `DATA_DIR`). Dá para começar no seu computador, mas leve para um
servidor logo no início: assim o atendimento não depende do computador ligado.

## Variáveis obrigatórias

| Variável | Exemplo |
| --- | --- |
| `PANEL_PASSWORD` | uma senha longa (12+ caracteres) |
| `PUBLIC_URL` | `https://minha-secretaria.up.railway.app` |
| `ANTHROPIC_API_KEY` | chave criada em platform.claude.com |
| `WHATSAPP_CHANNEL` | `oficial` ou `waha` |
| `DATA_DIR` | `/data` (um volume persistente) |

Mais as variáveis do canal escolhido (`META_*` ou `WAHA_*`, veja o `.env.example`).
Configure tudo **antes** do primeiro deploy: sem elas o servidor recusa subir e diz o que falta.

## Railway

1. Crie um projeto a partir do seu fork no GitHub. O Railway detecta o `Dockerfile`.
2. Em **Variables**, preencha as variáveis acima.
3. Em **Volumes**, crie um volume montado em `/data`.
4. Em **Settings → Networking**, gere um domínio para a porta `3000` e use-o em `PUBLIC_URL`.
5. Health check: `/health`.
6. Para o WAHA, crie um segundo serviço com a imagem `devlikeapro/waha`, variável
   `WAHA_API_KEY`, volume em `/app/.sessions`, uma réplica só e reinício automático.
   Na secretária, `WAHA_URL` aponta para o endereço interno desse serviço e
   `WAHA_WEBHOOK_URL` para o endereço interno da secretária + `/webhooks/waha`.

## Render

Crie um **Web Service** com Docker, adicione um **Persistent Disk** em `/data` e as variáveis.
Use um plano que não "durma" quando ninguém acessa.

## VPS com Docker

```bash
git clone https://github.com/SEU-USUARIO/secretaria-ia-whatsapp.git
cd secretaria-ia-whatsapp && cp .env.example .env   # preencha
docker compose up -d --build                         # ou --profile waha para incluir o WAHA
```

Coloque um proxy com HTTPS na frente (Caddy ou Nginx) apontando para `127.0.0.1:3000`.

## Depois do deploy

1. Abra `https://SEU-ENDERECO/health`: deve responder `{"ok":true}`.
2. Entre no painel e confira, em Ajustes, a fase **Laboratório** (padrão).
3. Conecte o WhatsApp e faça um teste com o seu número na fase **Só números de teste**.
4. Faça backup de `DATA_DIR/db.json` regularmente (é um arquivo só).
