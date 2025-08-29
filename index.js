// proxy-server.js
const http = require("http");
const https = require("https");
const axios = require("axios");
const { URL } = require("url");
const dotenv = require('dotenv');
dotenv.config();

const fs = require('fs');
const path = require('path');
const GOOGLE_URL = "https://script.google.com/macros/s/AKfycbwYFqEheXULi9gB-ZThvC8-9l41sqn2k6D5WCedN35Ik5fVN9-kAO1YzrLb3Vu7b6bK/exec";

const keyPath = path.join("/home/nodeapp/cert", 'private.key');
const certPath = path.join("/home/nodeapp/cert", 'fullchain.pem');
const caPath = path.join("/home/nodeapp/cert", 'ca_bundle.crt');

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
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "url parameter is required" }));
          return;
        }

        // pilih protocol http / https
        const client = targetUrl.startsWith("https") ? https : http;

        client
          .get(targetUrl, (resp) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: resp.statusCode === 200, code: resp.statusCode }));
          })
          .on("error", (err) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: false, error: err.message }));
          });
      } catch (err) {
        throw new Error(err);
      }
    }

    if (req.url.startsWith("/get-data-client")) {
      try {
        const query = new URL(req.url, `http://${req.headers.host}`);

        const page = query.searchParams.get("page") || 1;
        const limit = query.searchParams.get("limit") || 10;
        const selectedServer = query.searchParams.get("selectedServer") || "ALL";

        const { data, err } = await axios.get(`${GOOGLE_URL}?page=${page}&limit=${limit}&selectedServer=${selectedServer}`).then((response) => {
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
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: false, error: error.message }));
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
