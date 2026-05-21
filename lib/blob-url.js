// Construct a public Vercel Blob URL from a pathname without calling list().
//
// Vercel injects BLOB_READ_WRITE_TOKEN in format: vercel_blob_rw_{storeId}_{hash}
// The public store URL is deterministic: https://{storeId}.public.blob.vercel-storage.com
// This lets us build URLs directly and avoid list() (an "Advanced Operation" with a
// tight free-tier quota) on every user-facing request.

function getBlobBaseUrl() {
  if (process.env.BLOB_BASE_URL) return process.env.BLOB_BASE_URL.replace(/\/$/, "");
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const match = token.match(/^vercel_blob_rw_([A-Za-z0-9]+)_/);
  if (match) return `https://${match[1]}.public.blob.vercel-storage.com`;
  throw new Error(
    "Cannot determine Vercel Blob base URL. Set BLOB_BASE_URL env var to your blob store URL."
  );
}

export function getBlobUrl(pathname) {
  return `${getBlobBaseUrl()}/${pathname}`;
}
