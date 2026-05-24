const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function buildRuntimeConfig() {
  const models = (process.env.AI_MODEL_FALLBACKS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return `window.CREATOR_STATION_CONFIG = ${JSON.stringify({
    API_BASE_URL: process.env.AI_API_BASE_URL || "",
    API_KEY: process.env.AI_API_KEY || "",
    MODEL_FALLBACKS: models.length ? models : ["deepseek-v4-flash", "deepseek-v4-pro", "qwen3.6-plus"]
  }, null, 2)};\n`;
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/config.js") {
    send(response, 200, buildRuntimeConfig(), MIME_TYPES[".js"]);
    return;
  }

  const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, relativePath));

  if (!filePath.startsWith(ROOT)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }

    send(response, 200, data, MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(PORT, () => {
  console.log(`Creator Inspiration Station running at http://localhost:${PORT}`);
});
