const { Redis } = require("@upstash/redis");

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

if (!url) throw new Error("Missing KV_REST_API_URL");
if (!token) throw new Error("Missing KV_REST_API_TOKEN");

const redis = new Redis({
  url,
  token,
  automaticDeserialization: false,
});

module.exports = { redis };
