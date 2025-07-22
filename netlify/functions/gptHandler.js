const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    // Verifica variabili d'ambiente
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ reply: "Variabili d'ambiente mancanti!" }),
      };
    }

    const body = JSON.parse(event.body);
    const userMessage = body.message;
    const threadId = body.thread_id;
    let thread;

    if (threadId) {
      thread = { id: threadId };
    } else {
      thread = await openai.beta.threads.create();
    }

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // Attendi completamento (polling)
    let completedRun;
    let waitCount = 0;
    while (true) {
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (completedRun.status === "completed") break;
      // Timeout di sicurezza dopo 30 tentativi (~30 secondi)
      if (++waitCount > 30) throw new Error("Timeout risposta OpenAI");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Prendi ultimo messaggio assistant
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.reverse().find((msg) => msg.role === "assistant");

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: assistantMessage ? assistantMessage.content[0].text.value : "Nessuna risposta.",
        thread_id: thread.id
      }),
    };
  } catch (error) {
    // Stampa l’errore anche nei log Netlify
    console.error("Errore backend:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ reply: "Errore nel backend: " + (error.message || error.toString()) }),
    };
  }
};
