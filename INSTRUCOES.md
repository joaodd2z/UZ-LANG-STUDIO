# Instruções

Guia prático para rodar o projeto localmente com os Emuladores do Firebase e validar a UI e as APIs.

---

## 1) Pré‑requisitos
- Windows 10/11
- Node.js LTS (já instalado neste ambiente)
- NPM (vem junto com o Node)
- Java 17 (necessário para o Firestore Emulator)

Verifique rapidamente:

```
node -v
npm -v
java -version
```

Se o Java não estiver instalado, instale (uma vez só):

```
winget install -e --id EclipseAdoptium.Temurin.17.JDK --silent --accept-package-agreements --accept-source-agreements
```

---

## 2) Instalação de dependências (primeira vez)
Na raiz do projeto:

```
npm install
```

No diretório de Cloud Functions:

```
cd functions
npm install
cd ..
```

Observação: o projeto já está preparado sem o SDK problemático do ElevenLabs. Caso queira atualizar libs depois, avise.

---

## 3) Configuração de ambiente do Front‑end
O arquivo web/env.js já foi preenchido com credenciais "dummy" para desenvolvimento local. Caso precise revisar, o conteúdo deve ser semelhante a:

```
window.env = {
  FIREBASE_API_KEY: "demo",
  FIREBASE_AUTH_DOMAIN: "demo-uz-lang.firebaseapp.com",
  FIREBASE_PROJECT_ID: "demo-uz-lang",
  FIREBASE_STORAGE_BUCKET: "demo-uz-lang.appspot.com",
  FIREBASE_APP_ID: "demo-web",
  API_BASE: "",
  WP_ADMIN_USER: "blastuz",
  WP_ADMIN_PASS: "260103",
  TTS_ENABLED: "false"
};
```

- Em localhost, o app conecta automaticamente aos Emuladores de Firestore (8080), Storage (9199) e Auth (9099).
- O rewrite do Hosting envia chamadas para /api/** à Function "api".

---

## 4) Iniciar os Emuladores
Na raiz do projeto:

```
npm run emulators:start
```

Aguarde aparecerem as URLs:
- Emulator UI: http://127.0.0.1:4000/
- Hosting: http://127.0.0.1:5000/
- Firestore: 127.0.0.1:8080
- Storage: 127.0.0.1:9199
- Auth: 127.0.0.1:9099

Se aparecer aviso "You are not currently authenticated", ignore por ora (login no Firebase CLI não é necessário para usar os emuladores locais).

Se aparecer erro relacionado ao Java (java não encontrado), volte ao passo 1 e instale o Java 17.

---

## 5) Testar a UI (Hosting)
Abra no navegador: http://127.0.0.1:5000/

Valide no console do navegador a mensagem:
- "[Firebase] Emulators conectados (Firestore:8080, Storage:9199, Auth:9099)"

Login:
- O app usa GoogleAuthProvider (popup). Em ambiente de emulador, o login Google pode exigir configurações de OAuth reais. Caso o popup falhe, pule o login e siga com os testes de API abaixo. Se quiser, depois adicionamos Login Anônimo ou e‑mail/senha para facilitar o teste local.

---

## 6) Testar as APIs (Functions via Hosting)
As rotas da API são servidas em /api/** pelo Hosting local.

Teste rápido no navegador:
- Ping: http://127.0.0.1:5000/api/bridge/ping

Outras rotas (se necessário):
- Listar vozes (ElevenLabs – REST): http://127.0.0.1:5000/api/bridge/voices
- Gerar TTS (POST JSON): http://127.0.0.1:5000/api/bridge/tts/generate

Exemplo de corpo (JSON) para TTS (ajuste text/voice_id conforme sua necessidade):
```
{
  "text": "Olá! Este é um teste de TTS pelo emulador.",
  "voice_id": "Rachel", 
  "model_id": "eleven_multilingual_v2"
}
```
Envie com uma ferramenta como Insomnia/Postman. A resposta deve conter metadados e/ou URL de áudio gerado no Storage (quando aplicável).

---

## 7) Troubleshooting rápido
- Node/npm não reconhecido: feche e reabra o terminal; verifique PATH; confirme com `node -v` e `npm -v`.
- Java não reconhecido: instale o Temurin JDK 17 (comando acima) e confirme com `java -version`.
- Portas em uso: pare processos nessas portas (5000, 5001, 8080, 9099, 9199, 4000) e reinicie os emuladores.
- Erros ao instalar pacotes: rode `npm cache clean --force` e tente `npm install` novamente.
- Aviso de versão do firebase-functions: não bloqueia o uso local; podemos atualizar depois se desejar.

---

## 8) Próximos passos (opcionais)
- Login do Firebase CLI: `npx firebase login` (não é necessário para emuladores locais, apenas para deploy/recursos online).
- Deploy (quando tudo estiver funcionando e você quiser publicar):
  - `npm run deploy:functions`
  - `npm run deploy:hosting`

---

## 9) O que eu preciso que você teste
1. A UI abre no Hosting local (http://127.0.0.1:5000/) e aparece a mensagem de conexão aos Emuladores no console.
2. O endpoint de ping responde (http://127.0.0.1:5000/api/bridge/ping).
3. Se possível, tente a listagem de vozes e um teste de TTS (via Postman/Insomnia) e me diga o resultado.

Se algo não funcionar, me relate exatamente:
- Qual passo e qual comando/URL usou;
- Qual foi a mensagem de erro (texto e/ou print);
- Logs relevantes do terminal (se houver).

Com isso eu consigo corrigir rapidamente. Bons testes! 🚀