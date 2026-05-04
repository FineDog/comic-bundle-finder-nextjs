// pages/api/validate.js
// Checks issue names for typos using Claude.
// Runs server-side — the Anthropic API key never reaches the browser.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  const issues = (req.body.issues || []).map((i) => i.trim()).filter(Boolean);
  const noChange = {
    corrections: issues.map((i) => ({ original: i, suggested: i, changed: false })),
    any_changed: false,
  };

  if (!ANTHROPIC_API_KEY || !issues.length) return res.status(200).json(noChange);

  const issueList = issues.map((i) => `- ${i}`).join("\n");
  const prompt = `You are a comic book expert and spell checker. A user has typed a list of comic book issues to search for on eBay. Your job is to identify genuine misspellings in the series title.

Rules:
- ONLY flag actual misspellings or typos — words that are spelled wrong. For example "Btaman" -> "Batman", "Wolverien" -> "Wolverine", "Spiderman" -> "Spider-Man".
- Do NOT change capitalization. "astonishing x-men" and "Astonishing X-Men" are the same thing — ignore case entirely.
- Do NOT change punctuation or hyphens unless a word is genuinely misspelled. "x men" and "x-men" are acceptable variants — do not flag them.
- Do NOT reformat issue numbers or years. Leave them exactly as entered.
- If the only difference between the input and your suggestion would be capitalization or punctuation, set changed: false and leave the original unchanged.
- When in doubt, do not flag it. Only flag something if a word is clearly misspelled.

Return ONLY a JSON array. No markdown, no explanation, no extra text. Each element:
- "original": the exact original string, unchanged
- "suggested": corrected version if there is a real misspelling, otherwise identical to original
- "changed": true ONLY if you fixed an actual misspelling, false for everything else

Examples:
Input: "Btaman #5" -> suggested: "Batman #5", changed: true
Input: "astonishing x-men 4 2004" -> suggested: "astonishing x-men 4 2004", changed: false
Input: "Amazing Spider-Man #300" -> suggested: "Amazing Spider-Man #300", changed: false
Input: "Wolverien 5" -> suggested: "Wolverine 5", changed: true
Input: "daredevil 250 1988" -> suggested: "daredevil 250 1988", changed: false

Issues to check:
${issueList}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) return res.status(200).json(noChange);

    const data = await response.json();
    const raw = data.content?.[0]?.text?.trim() || "";
    const text = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/,"").trim();
    const corrections = JSON.parse(text);
    // Ignore corrections that only differ by capitalization — not a real typo
    for (const c of corrections) {
      if (c.changed && c.original.toLowerCase() === c.suggested.toLowerCase()) {
        c.changed = false;
        c.suggested = c.original;
      }
    }
    const any_changed = corrections.some((c) => c.changed);
    return res.status(200).json({ corrections, any_changed });
  } catch {
    return res.status(200).json(noChange);
  }
}
