/**
 * Netlify Function: intake-to-sheets
 *
 * Fires on every Netlify Forms submission for the "intake" form.
 * Appends a row to the Google Sheet "aidankaye.com — Intake Log".
 *
 * Environment variables required (set in Netlify UI → Site → Environment variables):
 *   GOOGLE_CLIENT_ID      — OAuth 2.0 client ID
 *   GOOGLE_CLIENT_SECRET  — OAuth 2.0 client secret
 *   GOOGLE_REFRESH_TOKEN  — Refresh token for reliablerootssa@gmail.com
 *   SHEET_ID              — Google Spreadsheet ID
 *
 * Trigger: Netlify form submission event (not an HTTP endpoint —
 * this is a background function invoked by Netlify internally).
 */

const https = require("https");

const SHEET_ID = process.env.SHEET_ID;
const SHEET_TAB = "Intake Log";

// ── Step 1: Exchange refresh token for access token ───────────────────────────
async function getAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    };

    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const data = JSON.parse(body);
        if (data.access_token) {
          resolve(data.access_token);
        } else {
          reject(new Error("Token exchange failed: " + body));
        }
      });
    });

    req.on("error", reject);
    req.write(params.toString());
    req.end();
  });
}

// ── Step 2: Append a row to the Sheet ────────────────────────────────────────
async function appendRow(accessToken, values) {
  const range = `${SHEET_TAB}!A:H`;
  const body = JSON.stringify({
    values: [values],
  });

  const path =
    `/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "sheets.googleapis.com",
      path,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseBody));
        } else {
          reject(
            new Error(
              `Sheets API error ${res.statusCode}: ${responseBody}`
            )
          );
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Netlify sends form submissions as background function events.
  // The payload is in event.body as JSON.
  try {
    const payload = JSON.parse(event.body);

    // Netlify form submission payload structure:
    // { payload: { data: { "first-name": "...", ... }, created_at: "...", ... } }
    const submission = payload.payload || payload;
    const data = submission.data || submission;
    const createdAt = submission.created_at || new Date().toISOString();

    // Format timestamp: "Mon Mar 24 2026, 3:33 AM"
    const ts = new Date(createdAt).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });

    // Build row — column order matches Sheet headers:
    // Timestamp | First Name | Last Name | Email | Phone | Heard From | Sport/Background | What They Want to Address
    const row = [
      ts,
      data["first-name"] || "",
      data["last-name"] || "",
      data["email"] || "",
      data["phone"] || "",
      data["heard-from"] || "",
      data["sport-background"] || "",
      data["what-to-address"] || "",
    ];

    const accessToken = await getAccessToken();
    await appendRow(accessToken, row);

    console.log(
      `[intake-to-sheets] Row appended: ${row[1]} ${row[2]} <${row[3]}>`
    );

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error("[intake-to-sheets] Error:", err.message);
    // Return 200 anyway so Netlify doesn't retry indefinitely
    return { statusCode: 200, body: "Error logged" };
  }
};
