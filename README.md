# Chat Manuel Assistant – Improved

**Hosting**: Netlify (Functions + static).

## Variabili d’ambiente (Netlify → Site Settings → Environment Variables)
- `OPENAI_API_KEY`
- `OPENAI_ASSISTANT_ID`

## Struttura
```
/index.html
/netlify/functions/gptHandler.js
/netlify.toml
/package.json
/README.md
```
## Note
- Polling robusto fino a ~55s per evitare `Timeout risposta AI`.
- Modello di riassunto: `gpt-4o-mini` (economico/veloce).
- UI più fluida (autoscroll intelligente, typing indicator, tema persistente, invio con Invio).
- Nessun testo “autocelebrativo”: messaggio iniziale semplice e chiaro.
