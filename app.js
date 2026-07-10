import express from "express";
import { createClient } from "redis";

const app = express();

const redisClient = createClient({
  url: "redis://redis:6379",
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

async function startServer() {
  await redisClient.connect();

  app.get("/count", async (req, res) => {
    const count = await redisClient.get("count");
    res.json({
      count: count ? parseInt(count, 10) : 0,
    });
  });

  app.get("/increment", async (req, res) => {
    const newCount = await redisClient.incr("count");
    res.json({
      count: newCount,
    });
  });

  app.listen(3000, () => {
    console.log("App running on port 3000");
  });
}

startServer();