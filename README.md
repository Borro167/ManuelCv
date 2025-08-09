# Manuel Assistant — Chat Pura (Netlify)

- **Assistant ID** via `OPENAI_ASSISTANT_ID`
- Switch **Formale/Informale**: ad ogni invio passa `additional_instructions` coerenti al tuo Assistant.

## Variabili ambiente
- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_ID`

## Struttura
- `public/index.html`
- `netlify/functions/gptHandler.js`
- `netlify.toml`
- `package.json`

Deploy su Netlify: publish `public/`, functions `netlify/functions/`.
