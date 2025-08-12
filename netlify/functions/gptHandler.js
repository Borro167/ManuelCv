/**
 * Netlify Function: /api/chat
 * Proxi a OpenAI Responses API con streaming. Richiede variabile OPENAI_API_KEY su Netlify.
 * Modern Functions API: default export handler(Request, Context) -> Response
 */
const OPENAI_URL = "https://api.openai.com/v1/responses";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export default async (request, context) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({error:"Method not allowed"}), { status: 405 });
  }
  const { message } = await request.json().catch(() => ({ message: "" }));
  const sys = [
    "Sei l’assistente-recruiter di Manuel. Sei conciso, pratico e fai domande mirate.",
    "Lingua di default: italiano. Se l’utente chiede inglese, rispondi in inglese.",
    "Evita preamboli lunghi. Se la risposta supera 8 righe, proponi riassunto."
  ];

  // Chiama OpenAI con stream:true
  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: sys.join(" ") },
        { role: "user", content: message || "Iniziamo il colloquio. Fai tu le domande." }
      ],
      stream: true
    })
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(()=>"");
    return new Response(JSON.stringify({error:"Upstream error", detail:text}), { status: 500 });
  }

  // Parser SSE OpenAI -> SSE semplice con solo testo
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8");

  const stream = new ReadableStream({
    start(controller){
      let buffer = "";
      const reader = upstream.body.getReader();

      const pump = () => reader.read().then(({done, value}) => {
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream:true });

        // Gli eventi OpenAI sono nel formato SSE: "event: <type>\n data: {...}\n\n"
        // Estraggo solo i delta di testo: event 'response.output_text.delta'
        let sep;
        while((sep = buffer.indexOf("\n\n")) >= 0){
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const lines = block.split("\n");
          let ev=null, data="";

          for(const ln of lines){
            if (ln.startsWith("event:")) ev = ln.slice(6).trim();
            if (ln.startsWith("data:"))  data = ln.slice(5).trim();
          }

          if (!data) continue;
          if (data === "[DONE]") {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close(); return;
          }
          // Parso json, prendo 'delta' se disponibile, altrimenti ignoro
          try {
            const obj = JSON.parse(data);
            if (ev === "response.output_text.delta" && obj.delta){
              controller.enqueue(encoder.encode(`data: ${obj.delta}\n\n`));
            }
          } catch(_) { /* ignora frammenti non JSON */ }
        }
        pump();
      }).catch(err => {
        controller.error(err);
      });

      pump();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    }
  });
};
