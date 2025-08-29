// proxy-server.js
const http = require("http");
const https = require("https");
const axios = require("axios");
const { URL } = require("url");
const dotenv = require('dotenv');
const cron = require("node-cron");

dotenv.config();

const fs = require('fs');
const path = require('path');
const users = require('./user');
const GOOGLE_URL = "https://script.google.com/macros/s/AKfycbwYFqEheXULi9gB-ZThvC8-9l41sqn2k6D5WCedN35Ik5fVN9-kAO1YzrLb3Vu7b6bK/exec";
const CACHE_FILE = path.join(__dirname, "data-cache.json");

let cacheData = { updatedAt: null, data: null };

const keyPath = path.join("/home/nodeapp/cert", 'private.key');
const certPath = path.join("/home/nodeapp/cert", 'fullchain.pem');
const caPath = path.join("/home/nodeapp/cert", 'ca_bundle.crt');

function safeEnd(res, statusCode, payload) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function fetchAndCacheData() {
  try {
    console.log("⏳ Fetching data from Google Sheets...");
    const response = await axios.get(`${GOOGLE_URL}?page=1&limit=99999&selectedServer=ALL`);
    cacheData = { updatedAt: new Date().toISOString(), data: response.data };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cacheData, null, 2));
    console.log("✅ Data cached at", cacheData.updatedAt);
  } catch (err) {
    console.error("❌ Failed to fetch data:", err.message);
  }
}

if (fs.existsSync(CACHE_FILE)) {
  try {
    cacheData = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    console.log("📂 Loaded cache from file:", cacheData.updatedAt);
  } catch (err) {
    console.error("❌ Failed to load cache file:", err.message);
  }
} else {
  fetchAndCacheData();
}

cron.schedule("59 * * * *", fetchAndCacheData);

async function handleCheck(req, res) {
  try {
    const query = new URL(req.url, `http://${req.headers.host}`);
    const targetUrl = query.searchParams.get("url");
    if (!targetUrl) {
      safeEnd(res, 400, { error: "url parameter is required" });
      return;
    }
    const client = targetUrl.startsWith("https") ? https : http;
    const request = client.get(
      targetUrl,
      { timeout: 10000 },
      (resp) => {
        let data = "";
        resp.on("data", (chunk) => (data += chunk));
        resp.on("end", () => {
          safeEnd(res, 200, {
            status: resp.statusCode === 200,
            code: resp.statusCode,
            cloudflareBlocked: resp.statusCode === 403,
          });
        });
      }
    );
    request.on("timeout", () => {
      request.destroy();
      safeEnd(res, 200, { status: false, error: "Time Out" });
    });
    request.on("error", (err) => {
      safeEnd(res, 200, { status: false, error: err.code || err.message });
    });
  } catch (err) {
    safeEnd(res, 500, { error: err.message });
  }
}

async function handleGetDataClient(req, res) {
  try {
    const query = new URL(req.url, `http://${req.headers.host}`);
    const page = query.searchParams.get("page") || 1;
    const limit = query.searchParams.get("limit") || 10;
    const selectedServer = query.searchParams.get("selectedServer") || "ALL";
    const search = query.searchParams.get("search");
    const json = cacheData.data;
    if (!json) {
      throw new Error("No cached data available");
    }

    const dataGsMapped = json.data.map((row) => {
      row.backend_url = row.backend_url + `:${row.port}` + "/api/v1/system/get";
      row.is_terpusat = !row.is_terpusat.length ? "TIDAK TERPUSAT" : row.is_terpusat;
      row.apk_name = !row.apk_name.length ? "TIDAK ADA" : row.apk_name;
      row.status_backup = !row.status_backup.length ? "TIDAK ADA" : row.status_backup;
      return row;
    });

    const sorted = dataGsMapped.sort((a, b) => {
      if (a.server_name === b.server_name) {
        return a.domain_name.localeCompare(b.domain_name);
      }
      return a.server_name.localeCompare(b.server_name);
    });

    let rowsV2 = sorted;
    if (selectedServer !== "ALL") {
      rowsV2 = sorted.filter(row => row.server_name === selectedServer);
    }

    let rows = rowsV2;
    if (search) {
      rows = rowsV2.filter(row => {
        const domainName = String(row.domain_name || "").toLowerCase();
        const backendFolder = String(row.backend_folder_name || "").toLowerCase();
        return domainName.includes(search) || backendFolder.includes(search);
      });
    }

    const dataGsRevamp = rows.map((data) => ({
      server_location: data.server_name,
      program_name: data.backend_folder_name,
      domain_name: data.domain_name,
      backend_url: data.backend_url,
    }));

    const total = dataGsRevamp.length;

    // pagination
    const start = (page - 1) * limit;
    const paginatedData = dataGsRevamp.slice(start, start + limit);
    safeEnd(res, 200, {
      status: true,
      data: {
        page: page,
        limit: limit,
        total: total,
        totalPages: Math.ceil(total / limit),
        items: paginatedData,
      },
    });
  } catch (error) {
    safeEnd(res, 500, { error: error.message });
  }
}

function handleLogin(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const { username, password } = JSON.parse(body);
      const user = users.find((u) => u.username === username && u.password === password);
      if (user) {
        safeEnd(res, 200, { status: true, message: "Login successful" });
      } else {
        safeEnd(res, 401, { status: false, message: "Invalid credentials" });
      }
    } catch (err) {
      safeEnd(res, 400, { status: false, error: "Invalid request body" });
    }
  });
}

async function requestHandler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.url.startsWith("/check")) {
      await handleCheck(req, res);
      return;
    }
    if (req.url.startsWith("/get-data-client")) {
      await handleGetDataClient(req, res);
      return;
    }
    if (req.url.startsWith("/login") && req.method === "POST") {
      handleLogin(req, res);
      return;
    }
    safeEnd(res, 404, { error: "Not Found" });
  } catch (err) {
    safeEnd(res, 500, { error: err.message });
  }
}

let server;
let isHttps = false;
if (fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(caPath)) {
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ca: fs.readFileSync(caPath)
  };
  server = https.createServer(options, requestHandler);
  isHttps = true;
} else {
  server = http.createServer(requestHandler);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  if (isHttps) {
    console.log(`Proxy running at https://localhost:${PORT}`);
  } else {
    console.log(`Proxy running at http://localhost:${PORT}`);
    console.log('HTTPS certs not found, running in HTTP mode.');
  }
});