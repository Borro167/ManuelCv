// netlify/functions/gptHandler.js
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  // Check env
  if (!process.env.OPENAI_API_KEY) {
    return { statusCode: 500, body: "Manca la chiave OPENAI_API_KEY nelle variabili di ambiente!" };
  }

  try {
    const { message } = JSON.parse(event.body);

    // SEMPLICE CHAT STANDARD, non threads
    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // o quello che hai
      messages: [
        { role: "system", content: "Sei l’assistente digitale di Manuel. Rispondi in modo naturale, contestualizzato, e rispetta la privacy. Se l’utente specifica il ruolo (HR, IT, Tecnico), adatta la risposta." },
        { role: "user", content: message }
      ],
      temperature: 0.7,
      max_tokens: 600,
    });

    const reply = completion.choices?.[0]?.message?.content || "Risposta non trovata.";
    return {
      statusCode: 200,
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno nel server: " + (err.message || "Unknown") }),
    };
  }
}
