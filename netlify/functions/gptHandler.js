// netlify/functions/chatDirect.js
// Chiamata diretta Chat Completions: ogni richiesta usa estratti dal CV e dalla Storyline

import { OpenAI } from "openai";
import fs from "fs/promises";
import path from "path";
import pdfParse from "pdf-parse";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

let corpusCache = null;

async function loadCorpus(){
  if (corpusCache) return corpusCache;
  const base = path.dirname(new URL(import.meta.url).pathname);
  const root = path.resolve(base, "../../");
  const storyPath = path.join(root, "storyline_manuel.txt");
  const cvPath = path.join(root, "cv_MFE.pdf");

  const [storyText, cvBuf] = await Promise.all([
    fs.readFile(storyPath, "utf8").catch(()=>""),
    fs.readFile(cvPath).catch(()=>null)
  ]);

  let cvText = "";
  if (cvBuf){
    try{ const parsed = await pdfParse(cvBuf); cvText = parsed.text || ""; }catch(e){ cvText = ""; }
  }

  corpusCache = { storyText, cvText };
  return corpusCache;
}

function chunk(text, size = 1200, overlap = 120){
  if (!text) return [];
  const out = []; let i = 0; const n = text.length;
  while (i < n){ out.push(text.slice(i, i + size)); i += Math.max(1, size - overlap); }
  return out;
}

function pickRelevant(query, chunks, topK = 6){
  const q = (query || "").toLowerCase().split(/[^a-zà-ù0-9]+/i).filter(Boolean);
  const score = (c) => {
    const lc = c.toLowerCase();
    let s = 0; for (const t of q){ if (!t) continue; const hits = lc.split(t).length - 1; s += hits * (t.length > 3 ? 2 : 1); }
    return s;
  };
  const scored = chunks.map(c => ({ c, s: score(c) }));
  scored.sort((a,b)=>b.s-a.s);
  return scored.slice(0, Math.min(topK, scored.length)).map(o=>o.c);
}

export async function handler(event){
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };
  try{
    const { message, behavior = "", history = [] } = JSON.parse(event.body || "{}");
    if (!message) return { statusCode: 400, body: JSON.stringify({ ok:false, error:"Parametro 'message' mancante" }) };

    const { storyText, cvText } = await loadCorpus();
    const allChunks = [ ...chunk(storyText), ...chunk(cvText) ];
    const q = [ ...history.filter(h=>h.role==='user').slice(-2).map(h=>h.text), message ].join(" \n ");
    const ctx = pickRelevant(q, allChunks, 6);

    const system = [
      "Sei l'assistente privato di Manuel. Regole:",
      "- Rispondi in italiano, conciso e diretto.",
      "- Quando la domanda riguarda profilo/cv/esperienze/skill, usa SOLO le informazioni nei CONTENUTI allegati.",
      "- Se l'informazione non è nei documenti, dillo chiaramente.",
      "- Niente opinioni o inferenze personali.",
      behavior ? `- Comportamento extra: ${behavior}` : null
    ].filter(Boolean).join("\n");

    const contentBlock = ctx.length ? `=== CONTENUTI (estratti) ===\n${ctx.join("\n---\n")}\n=== FINE CONTENUTI ===` : "";

    const messages = [
      { role: "system", content: system },
      contentBlock ? { role: "system", content: contentBlock } : null,
      ...history.map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.text })),
      { role: "user", content: message }
    ].filter(Boolean);

    const completion = await openai.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
    });

    const reply = completion.choices?.[0]?.message?.content || "";
    return { statusCode: 200, headers:{"content-type":"application/json"}, body: JSON.stringify({ ok:true, reply }) };
  }catch(err){
    console.error("DIRECT ERROR:", err);
    return { statusCode: 200, headers:{"content-type":"application/json"}, body: JSON.stringify({ ok:false, error: String(err?.message || err) }) };
  }
}
