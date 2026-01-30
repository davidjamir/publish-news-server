async function sendNotify(payload) {
  if (!process.env.NOTIFY_SERVER_ENDPOINT_API) {
    throw new Error("Missing NOTIFY_SERVER_ENDPOINT_API");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // 5s là đủ

  try {
    const r = await fetch(process.env.NOTIFY_SERVER_ENDPOINT_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NOTIFY_SERVER_SECRET}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await r.json().catch(() => null);

    if (!r.ok) {
      throw new Error(
        `Notify server error ${r.status}: ${JSON.stringify(data)}`,
      );
    }

    return data;
  } catch (e) {
    console.error("sendNotify error:", e?.message || e);
    return null; // notify fail KHÔNG làm fail job chính
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { sendNotify };
