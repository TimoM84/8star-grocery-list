/** Ready-to-paste instructions for ChatGPT, Claude or other tools (served as a download). */

export const AI_PROMPT = `# Opdracht voor je AI-assistent (8star Boodschappen)

Bijgevoegd is de export van mijn boodschappenlijst (bestand \`8star-export-*.json\`, formaat
"8star-grocery-export"). \`data.products\` bevat producten met een vaste \`id\`;
\`data.purchaseEvents\` bevat elke keer dat een product op de lijst kwam en of het gekocht
(\`completedAt\`) of geannuleerd werd. Tijden zijn ISO 8601 (UTC).

Analyseer mijn koopgedrag en geef suggesties voor wat ik binnenkort waarschijnlijk nodig heb.

Antwoord UITSLUITEND met één JSON-document in precies dit formaat (geen uitleg eromheen):

\`\`\`json
{
  "format": "8star-ai-recommendations",
  "formatVersion": 1,
  "generatedAt": "2026-10-24T08:00:00Z",
  "source": "ChatGPT",
  "recommendations": [
    {
      "productId": "<id uit data.products>",
      "productName": "<naam van dat product, ter controle>",
      "suggestedQuantity": 2,
      "unit": "l",
      "nextPurchaseDate": "2026-10-28",
      "confidence": 0.82,
      "reasoning": "Korte uitleg in het Nederlands, max. 1000 tekens."
    }
  ]
}
\`\`\`

Regels:
- Gebruik alleen bestaande \`productId\`-waarden uit \`data.products\`; verzin geen producten.
- \`confidence\` is een getal van 0 tot en met 1 (bijv. 0.82, niet 82).
- \`suggestedQuantity\` (getal > 0), \`unit\` en \`nextPurchaseDate\` (ISO 8601-datum) zijn optioneel;
  laat ze weg of zet ze op null als je het niet weet.
- Toegestane eenheden: stuks, g, kg, ml, l, pak, fles, blik, zak, bos, doos, pot.
- Hooguit één suggestie per product.

Sla het antwoord op als \`.json\`-bestand en importeer het in de app via
Suggesties → AI-suggesties → AI-bestand importeren.
`;
