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
  const prompt = `You are a comic book expert. A user has entered the following list of comic issues to search for.
Check each one for typos, misspellings, or formatting issues. Pay attention to:
- Series title spelling (e.g. "Btaman" should be "Batman", "Spiderman" should be "Spider-Man")
- Proper use of hyphens in names (e.g. "Spider Man" -> "Spider-Man", "X men" -> "X-Men")
- Common publisher series names and their correct formatting
- Issue numbers should be in the format #N (e.g. "#5", not "No. 5" or "issue 5")

Return ONLY a JSON array, no other text, no markdown, no explanation. Each element must have:
- "original": the original string exactly as entered
- "suggested": your corrected version (same as original if no correction needed)
- "changed": true if you made a correction, false if not

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
    const text = data.content?.[0]?.text?.trim() || "";
    const corrections = JSON.parse(text);
    const any_changed = corrections.some((c) => c.changed);
    return res.status(200).json({ corrections, any_changed });
  } catch {
    return res.status(200).json(noChange);
  }
}
