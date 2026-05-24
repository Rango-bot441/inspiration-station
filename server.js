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

const DEFAULT_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro", "qwen3.6-plus"];
const MODEL_TIMEOUT_MS = 35000;

function getModelFallbacks() {
  const models = (process.env.AI_MODEL_FALLBACKS || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return models.length ? models : DEFAULT_MODELS;
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  send(response, statusCode, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

async function callModel({ systemPrompt, userPrompt }) {
  const baseUrl = (process.env.AI_API_BASE_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.AI_API_KEY || "";

  if (!baseUrl || !apiKey) {
    const error = new Error("AI service is not configured");
    error.statusCode = 500;
    throw error;
  }

  const errors = [];
  for (const model of getModelFallbacks()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

    try {
      const upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.82
        })
      });
      clearTimeout(timeout);

      const raw = await upstream.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (error) {
        data = null;
      }

      if (upstream.ok) {
        return {
          content: data?.choices?.[0]?.message?.content || raw || "",
          model
        };
      }

      const message = data?.error?.message || raw || "";
      errors.push({ model, status: upstream.status, message });
      if (upstream.status === 401 || /invalid token|unauthorized/i.test(message)) break;
    } catch (error) {
      clearTimeout(timeout);
      errors.push({ model, status: 0, message: error.name === "AbortError" ? "request timeout" : error.message });
    }
  }

  const error = new Error("AI service unavailable");
  error.statusCode = errors.some((item) => item.status === 401 || /invalid token|unauthorized/i.test(item.message)) ? 401 : 503;
  error.details = errors;
  throw error;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/api/chat" && request.method === "POST") {
    try {
      const payload = await readJsonBody(request);
      if (!payload.systemPrompt || !payload.userPrompt) {
        sendJson(response, 400, { error: "Missing prompt" });
        return;
      }

      const result = await callModel(payload);
      sendJson(response, 200, result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      sendJson(response, statusCode, {
        error: statusCode === 401
          ? "AI 服务暂时不可用，请联系管理员检查服务配置。"
          : "AI 服务当前繁忙，请稍后再试。"
      });
    }
    return;
  }

  if (url.pathname === "/config.js") {
    send(response, 200, "window.CREATOR_STATION_CONFIG = {};\n", MIME_TYPES[".js"]);
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
