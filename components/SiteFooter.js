export default function SiteFooter() {
  return (
    <div className="panel" style={{ textAlign: "center", fontSize: "0.8rem", fontWeight: 400, color: "#666", padding: "0.85rem 1.75rem" }}>
      Bugs? Feature requests? Email us at{" "}
      <a href="mailto:hello@comicbundlefinder.com" style={{ color: "#003399", fontWeight: 600 }}>
        hello@comicbundlefinder.com
      </a>
      <div style={{ marginTop: "0.75rem" }}>
        <a
          href="https://ko-fi.com/O4O31ZDFTF"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            background: "#003399", color: "#fffdf4",
            border: "2px solid #1a1a1a", boxShadow: "3px 3px 0 #1a1a1a",
            fontFamily: "'Oswald', sans-serif", fontWeight: 600,
            fontSize: "0.82rem", letterSpacing: "1px", textTransform: "uppercase",
            padding: "0.35rem 1rem", textDecoration: "none",
          }}
        >
          ☕ Support me on Ko-fi
        </a>
      </div>
    </div>
  );
}
