# UZ-LANG STUDIO

Plataforma de transcrição, tradução e TTS (com bridge ElevenLabs) para vídeos do YouTube usando Firebase (Hosting, Functions, Firestore, Storage) e um worker Python.

## Arquitetura
- Web (Hosting): SPA servida pelo Firebase Hosting.
- Functions (Node.js): API em `/api/**` incluindo bridge de TTS/Clonagem de voz (ElevenLabs) e endpoints utilitários.
- Firestore + Storage: persistência de dados e arquivos.
- Worker (Python): executa jobs de processamento.

## Pré-requisitos
- Node.js 18+ (inclui `npm`).
- Firebase CLI (`npm i -g firebase-tools`).
- Docker + Docker Compose (para o worker).
- Projeto Firebase com Firestore, Storage e Functions habilitados.
- APIs do YouTube (Data v3 e Analytics) habilitadas no Google Cloud.
- Conta ElevenLabs (para TTS/Clonagem de voz) se `TTS_PROVIDER=eleven`.

## Variáveis de Ambiente (.env)
Copie `.env.example` para `.env` e preencha:

```
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_APP_ID=...
YOUTUBE_API_KEY=...
OAUTH_CLIENT_ID=...
OAUTH_CLIENT_SECRET=...
TRANSLATE_PROVIDER=deepl|gcloud|azure
TRANSLATE_API_KEY=...
TTS_PROVIDER=eleven|azure|gcloud
TTS_API_KEY=...
TTS_VOICE_ID=blast
TTS_ENABLED=false
```

Notas:
- Para ElevenLabs, use `TTS_PROVIDER=eleven` e `TTS_API_KEY` como sua chave ElevenLabs.
- Em dev, o bridge também pode ler `ELEVENLABS_API_KEY` via `functions:config:set secret.elevenlabs_api_key`.

## Instalação
```
npm install
(cd functions && npm install)
```
Se aparecer “npm não é reconhecido”, instale o Node.js 18+ e reabra seu terminal (PowerShell).

## Emuladores (dev)
```
firebase emulators:start
```
- Web: http://localhost:5000
- Functions: http://localhost:5001
- Emulator UI: http://localhost:4000

Importante: As rewrites de `/api/**` só funcionam quando acessado via Hosting (porta 5000). Servidores estáticos (ex.: 8000) não aplicam rewrites.

Opcional (preview estático): se for abrir a UI em http://localhost:8000, configure `window.env.API_BASE = 'http://localhost:5000'` em `web/env.js` para apontar as chamadas da UI para o emulador na 5000.

## Worker
```
docker compose up --build
```
O worker buscará jobs em Firestore, definidos pela aplicação.

## Deploy
```
firebase deploy --only functions,hosting
```

## Endpoints principais
- YouTube Analytics (stub): `/api/analytics/:videoId` (trocar por integração real com OAuth).
- Bridge ElevenLabs:
  - `GET /api/bridge/voices` — lista vozes disponíveis (ElevenLabs + perfis internos). Requer Authorization (ID Token Firebase).
  - `POST /api/bridge/voices/clone` — clona/cria uma voz nova no ElevenLabs.
    - Body: `{ name, language?, gender?, consent: true, training_files: string[] }`
  - `GET /api/bridge/voices/:voiceId/status` — status de treino/processamento.
  - `POST /api/bridge/tts/generate` — gera TTS.
    - Body: `{ text, voice_id, model?: string, voice_settings?: {...} }`

Autenticação: enviar `Authorization: Bearer <ID_TOKEN_DO_FIREBASE>`.

### Testes rápidos (curl)
```
# Listar vozes
curl -H "Authorization: Bearer $ID_TOKEN" http://localhost:5000/api/bridge/voices

# Clonar voz
curl -X POST -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"UZ Golden PT-BR","consent":true,"training_files":["https://SEU_DOMINIO/audio1.wav"]}' \
  http://localhost:5000/api/bridge/voices/clone

# Status da voz
curl -H "Authorization: Bearer $ID_TOKEN" http://localhost:5000/api/bridge/voices/VOICE_ID/status

# TTS
curl -X POST -H "Authorization: Bearer $ID_TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Olá, mundo!","voice_id":"VOICE_ID"}' \
  http://localhost:5000/api/bridge/tts/generate
```

## Segurança e privacidade
- Não comite segredos. Use `.env` local e `functions:config:set` para segredos em Functions.
- Respeite consentimento explícito em clonagem de voz e só utilize material de treino com autorização.
- Regras de Firestore e Storage estão configuradas e devem ser mantidas.

## Checklist mínimo de funcionamento
1. Node.js + npm instalados e reconhecidos.
2. `npm install` na raiz e em `functions` concluído.
3. `ELEVENLABS_API_KEY` configurado (via `.env`/`functions:config:set`).
4. Emuladores rodando (`firebase emulators:start`).
5. UI aberta em http://localhost:5000 (Hosting com rewrites).
6. Aba “Vozes”: listar, clonar voz com consentimento, ver status e gerar TTS.

## A11y
- A11y: foco visível, contraste AA; Lighthouse ≥ 90 esperado.

---

## Coleta de APIs e credenciais necessárias (para integração)
- Firebase (Web App): `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `FIREBASE_APP_ID`.
- YouTube: `YOUTUBE_API_KEY` (Data API v3) e `OAUTH_CLIENT_ID` + `OAUTH_CLIENT_SECRET` (para Analytics/OAuth do canal).
- ElevenLabs: `ELEVENLABS_API_KEY` (ou usar `TTS_API_KEY` quando `TTS_PROVIDER=eleven`).
- Tradução (opcional, conforme `TRANSLATE_PROVIDER`): chaves da DeepL/Google/Azure.
- TTS (se não for ElevenLabs): chaves dos respectivos provedores (Azure/GCloud).
- Materiais de treino de voz: links/arquivos com consentimento do titular (mín. 1–3 amostras).

## Plano de continuidade (Agente + Você) [CONTINUITY_PLAN]
- Próximas melhorias:
  - Adicionar botão “Ver status” na aba Vozes e barra de progresso de treino.
  - Permitir configuração de `API_BASE` via `env.js` por padrão.
  - Integração de webhook de treino para atualização automática de status.
  - Testes automatizados dos endpoints do bridge e da UI.
- Como trabalharemos:
  - Você coleta/valida as credenciais acima.
  - Eu (Agente) conecto e testo os endpoints, ajusto UI/backend conforme necessário.
  - Iteramos: planejar → implementar → validar no emulador → documentar.

Fale comigo quando quiser que eu avance para o próximo item do [CONTINUITY_PLAN] ou quando tiver as credenciais; eu seguirei com as integrações e testes imediatamente.