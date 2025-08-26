// proxy-server.js
const http = require("http");
const https = require("https");
const { URL } = require("url");
const dotenv = require('dotenv');
dotenv.config();

const fs = require('fs');
const path = require('path');

const keyPath = path.join("/home/nodeapp/cert", 'private.key');
const certPath = path.join("/home/nodeapp/cert", 'fullchain.pem');
const caPath = path.join("/home/nodeapp/cert", 'ca_bundle.crt');

function requestHandler(req, res) {
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
      console.log(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: false, error: err.message }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
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
