# Chat AI con OpenAI Assistants API

## Hosting
Deploy automatico su Netlify da GitHub.

## Requisiti
- `OPENAI_API_KEY` (nel pannello Netlify → Site Settings → Environment Variables)
- `OPENAI_ASSISTANT_ID` (configurato su platform.openai.com → Assistant)

## Struttura
- `public/index.html` → interfaccia utente
- `netlify/functions/gptHandler.js` → backend API sicuro

## Deploy
1. Push su GitHub
2. Netlify lo prende e lo pubblica
