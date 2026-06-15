import { fetchReleases, FilterTypes, SortTypes } from "comicgeeks";

export default async function handler(req, res) {
  try {
    const dateStr = req.query.date;
    const date = dateStr ? new Date(dateStr) : new Date();

    const releases = await fetchReleases(date, {
      filter: [FilterTypes.Regular, FilterTypes.Annual],
      sort: SortTypes.MostPulled,
    });

    const sorted = [...releases].sort((a, b) => (b.pulls || 0) - (a.pulls || 0));
    res.status(200).json({ releases: sorted.slice(0, 60), date: date.toISOString() });
  } catch (err) {
    console.error("LCOG releases error:", err);
    res.status(500).json({ error: err.message });
  }
}
