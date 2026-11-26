const http = require("http");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "index.html"));
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(page);
}).listen(process.env.PORT || 8080);
