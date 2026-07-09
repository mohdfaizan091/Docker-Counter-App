import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const FILE_PATH = path.join(DATA_DIR, "count.txt");

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

// Load count from file if it exists, else start at 0
let count = 0;
if (fs.existsSync(FILE_PATH)) {
  count = parseInt(fs.readFileSync(FILE_PATH, "utf-8")) || 0;
}

app.get("/count", (req, res) => {
  res.json({ count });
});

app.get("/increment", (req, res) => {
  count++;
  fs.writeFileSync(FILE_PATH, String(count));
  res.json({ count });
});

app.listen(3000, () => {
  console.log("App running on port 3000");
});