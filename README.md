# Manuel Assistant — Netlify

UI di chat super leggera + funzione Netlify con OpenAI Assistants API.

## Variabili ambiente (Netlify → Site settings → Environment)
- `OPENAI_API_KEY` **(obbligatoria)**
- `OPENAI_ASSISTANT_ID` **(obbligatoria)** — ID dell’Assistant già configurato su platform.openai.com

## Deploy
1. Carica questo repository su GitHub.
2. Connetti il repo a Netlify.
3. Verifica che il `publish` sia `public/` e le Functions siano in `netlify/functions/` (già nel `netlify.toml`).
4. Deploy.

## Sviluppo locale (opzionale)
- `npx netlify-cli dev` (richiede `netlify-cli`)
- Oppure qualsiasi server statico per `public/` e un proxy verso `/.netlify/functions/gptHandler`.

## Funzioni utili
- **Nuova chat**: resetta la conversazione e lo `threadId`.
- **Esporta PDF**: stampa solo i messaggi (usa `⌘/Ctrl + P` → Salva come PDF).
- **Tema**: chiaro/scuro.
- **Musica**: carica un MP3, parte alla prima interazione (limite dei browser).