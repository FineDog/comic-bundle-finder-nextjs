export default async function handler(req, res) {
  const { id } = req.query;

  const auth = Buffer.from(
    `${process.env.METRON_USERNAME}:${process.env.METRON_PASSWORD}`
  ).toString("base64");

  let metronRes;
  try {
    metronRes = await fetch(
      `https://metron.cloud/api/character/${id}/`,
      { headers: { Authorization: `Basic ${auth}` } }
    );
  } catch {
    return res.status(502).json({ error: "Could not reach Metron API" });
  }

  if (!metronRes.ok) {
    return res.status(metronRes.status).json({ error: "Character not found" });
  }

  return res.json(await metronRes.json());
}
