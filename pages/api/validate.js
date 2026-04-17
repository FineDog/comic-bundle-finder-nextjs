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
  const prompt = `You are a comic book expert and spell checker. A user has typed a list of comic book issues to search for on eBay. Your job is to identify and fix ANY typo or misspelling in the series title, no matter how obvious.

Rules:
- If the series name looks like a scrambled or mistyped version of a real comic title, correct it. For example "Btaman" -> "Batman", "Spiderman" -> "Spider-Man", "Xmen" -> "X-Men", "Wolverien" -> "Wolverine".
- Be aggressive: if something looks wrong, flag it. Do not give the benefit of the doubt to a misspelled word.
- Preserve the issue number and year exactly as entered, only fix the series title.
- If the title looks completely correct, leave it unchanged.

Return ONLY a JSON array. No markdown, no explanation, no extra text. Each element:
- "original": the exact original string
- "suggested": corrected version (or same as original if correct)
- "changed": true if you changed anything, false if not

Examples:
Input: "Btaman #5" -> output suggested: "Batman #5", changed: true
Input: "Amazing Spider-Man #300" -> output suggested: "Amazing Spider-Man #300", changed: false
Input: "Spiderman 42" -> output suggested: "Spider-Man 42", changed: true

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

    if (!response.ok) {
          const errText = await response.text();
          console.error("Anthropic API error:", response.status, errText);
          return res.status(200).json(noChange);
    }


    const data = await response.json();
    const raw = data.content?.[0]?.text?.trim() || "";
    const text = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/,"").trim();
    const corrections = JSON.parse(text);
    const any_changed = corrections.some((c) => c.changed);
    return res.status(200).json({ corrections, any_changed });
  } catch {
    return res.status(200).json(noChange);
  }
}
