/** Ready-to-paste instructions for ChatGPT or other AI tools (served as a download). */

import { messagesFor, type Language } from '$lib/shared/i18n';

/**
 * The prompt in the household language: Dutch keeps its own wording, the other languages
 * share the English prompt and ask for the explanation in their own language.
 */
export function aiPrompt(language: Language): string {
	if (language === 'nl') return AI_PROMPT_NL;
	const m = messagesFor(language);
	return AI_PROMPT_EN.replace('%LANGUAGE%', ENGLISH_NAMES[language]).replace(
		'%MENU%',
		`${m.nav.suggestions} → ${m.ai.title} → ${m.ai.importOpen}`
	);
}

const ENGLISH_NAMES: Record<Language, string> = {
	en: 'English',
	nl: 'Dutch',
	de: 'German',
	fr: 'French',
	es: 'Spanish'
};

const AI_PROMPT_EN = `# Task for your AI assistant (8star Groceries)

Attached is the export of my grocery list (file \`8star-export-*.json\`, format
"8star-grocery-export"). \`data.products\` holds products with a fixed \`id\`;
\`data.purchaseEvents\` holds every time a product was put on the list and whether it was
bought (\`completedAt\`) or cancelled. Times are ISO 8601 (UTC).

Analyse my buying behaviour and suggest what I will probably need soon.

Answer ONLY with one JSON document in exactly this format (no explanation around it):

\`\`\`json
{
  "format": "8star-ai-recommendations",
  "formatVersion": 1,
  "generatedAt": "2026-10-24T08:00:00Z",
  "source": "ChatGPT",
  "recommendations": [
    {
      "productId": "<id from data.products>",
      "productName": "<name of that product, as a check>",
      "suggestedQuantity": 2,
      "unit": "l",
      "nextPurchaseDate": "2026-10-28",
      "confidence": 0.82,
      "reasoning": "Short explanation in %LANGUAGE%, max. 1000 characters."
    }
  ]
}
\`\`\`

Rules:
- Only use existing \`productId\` values from \`data.products\`; do not invent products.
- \`confidence\` is a number from 0 up to and including 1 (e.g. 0.82, not 82).
- \`suggestedQuantity\` (number > 0), \`unit\` and \`nextPurchaseDate\` (ISO 8601 date) are optional;
  leave them out or set them to null if you do not know.
- Allowed units (stored codes): stuks (pieces), g, kg, ml, l, pak (pack), fles (bottle),
  blik (can), zak (bag), bos (bunch), doos (box), pot (jar).
- At most one suggestion per product.

Save the answer as a \`.json\` file and import it in the app via
%MENU%.
`;

const AI_PROMPT_NL = `# Opdracht voor je AI-assistent (8star Boodschappen)

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
