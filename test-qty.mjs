import "dotenv/config";

const creds = Buffer.from(process.env.EBAY_APP_ID + ":" + process.env.EBAY_SECRET).toString("base64");
const { access_token } = await (await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
  method: "POST",
  headers: { Authorization: "Basic " + creds, "Content-Type": "application/x-www-form-urlencoded" },
  body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope",
})).json();

const params = new URLSearchParams({ q: "absolute batman 20", category_ids: "259104", limit: 50 });
const data = await (await fetch(
  "https://api.ebay.com/buy/browse/v1/item_summary/search?" + params + "&filter=buyingOptions:{FIXED_PRICE},conditions:{NEW|USED}",
  { headers: { Authorization: "Bearer " + access_token, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" } }
)).json();

console.log("Total:", data.total, "| Returned:", data.itemSummaries?.length);
console.log("Keys on first item:", Object.keys(data.itemSummaries?.[0] ?? {}).join(", "));
console.log("");

let found = 0;
for (const item of data.itemSummaries ?? []) {
  if ((item.availableQuantity ?? 0) > 1) {
    found++;
    console.log("MULTI-QTY qty=" + item.availableQuantity, "|", item.seller?.username);
    console.log("  " + item.itemWebUrl);
  }
}
if (found === 0) console.log("No multi-quantity listings found (availableQuantity field may not be returned).");
