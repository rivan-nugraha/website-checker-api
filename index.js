// proxy-server.js
const http = require("http");
const https = require("https");
const axios = require("axios");
const { URL } = require("url");
const dotenv = require('dotenv');
const dns = require("dns");

dotenv.config();

const fs = require('fs');
const path = require('path');
const GOOGLE_URL = "https://script.google.com/macros/s/AKfycbwYFqEheXULi9gB-ZThvC8-9l41sqn2k6D5WCedN35Ik5fVN9-kAO1YzrLb3Vu7b6bK/exec";

const keyPath = path.join("/home/nodeapp/cert", 'private.key');
const certPath = path.join("/home/nodeapp/cert", 'fullchain.pem');
const caPath = path.join("/home/nodeapp/cert", 'ca_bundle.crt');

function safeEnd(res, statusCode, payload) {
  if (res.writableEnded) return; // pastikan belum dikirim
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function requestHandler(req, res) {
  try {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url.startsWith("/check")) {
      try {
        const query = new URL(req.url, `http://${req.headers.host}`);
        const targetUrl = query.searchParams.get("url");

        if (!targetUrl) {
          safeEnd(res, 400, { error: "url parameter is required" });
        } else {
          const client = targetUrl.startsWith("https") ? https : http;
          const request = client.get(
            targetUrl,
            { timeout: 10000 }, // atur timeout 10 detik
            (resp) => {
              let data = "";
              resp.on("data", (chunk) => (data += chunk));
              resp.on("end", () => {
                let isCloudflare =
                  data.includes("cloudflare") ||
                  data.includes("Checking your browser") ||
                  data.includes("Verifikasi bahwa Anda adalah manusia");

                safeEnd(res, 200, {
                  status: resp.statusCode === 200 && !isCloudflare,
                  code: resp.statusCode,
                  cloudflareBlocked: isCloudflare,
                });
              });
            }
          );

          request.on("timeout", () => {
            request.destroy(); // stop supaya nggak lanjut ke error
            safeEnd(res, 200, {
              status: false,
              error: "Time Out",
            });
          });

          request.on("error", (err) => {
            safeEnd(res, 200, {
              status: false,
              error: err.code || err.message,
            });
          });
        }
      } catch (err) {
        safeEnd(res, 500, { error: err.message });
      }
    }

    if (req.url.startsWith("/get-data-client")) {
      try {
        const query = new URL(req.url, `http://${req.headers.host}`);

        const page = query.searchParams.get("page") || 1;
        const limit = query.searchParams.get("limit") || 10;
        const selectedServer = query.searchParams.get("selectedServer") || "ALL";
        const search = query.searchParams.get("search");

        const { data, err } = await axios.get(`${GOOGLE_URL}?page=${page}&limit=${limit}&selectedServer=${selectedServer}&search=${search}`).then((response) => {
          return {
            data: response.data,
            err: null
          }
        }).catch(error => ({data: null, err: error.message}));
        if (err) {
          console.log(err);
          throw new Error(err);
        }

        // kalau mau mapping
        const dataGsMapped = data.data.map((row) => {
          row.backend_url = row.backend_url + `:${row.port}` + "/api/v1/system/get";
          row.is_terpusat = !row.is_terpusat.length ? "TIDAK TERPUSAT" : row.is_terpusat;
          row.apk_name = !row.apk_name.length ? "TIDAK ADA" : row.apk_name;
          row.status_backup = !row.status_backup.length ? "TIDAK ADA" : row.status_backup;
          return row;
        });

        const dataGsRevamp = dataGsMapped.map((data) => {
          return {
            server_location: data.server_name,
            program_name: data.backend_folder_name,
            domain_name: data.domain_name,
            backend_url: data.backend_url,
          }
        })

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: true, data: {
          page: data.page,
          limit: data.limit,
          total: data.total,
          totalPages: data.totalPages,
          items: dataGsRevamp
        } }));
      } catch (error) {
        throw new Error(error);
      }
    }
  } catch (error) {
    console.log(error);
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
