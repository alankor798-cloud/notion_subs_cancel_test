export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // If Notion sends text/plain, attempt to parse safely.
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const service = body?.service || body?.Service || body?.name || "";
    if (!service) {
      return res.status(400).json({ error: "Missing 'service' in request body" });
    }

    const prompt = `
You are an expert in subscription services.
Return ONLY the official cancellation page URL and short steps for: "${service}".

Format EXACTLY as:
URL: <link>
Steps: <1-3 sentences of concise, actionable instructions>
`;

    // Call Hugging Face Inference API
    const hfResponse = await fetch(
      "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: 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,
        },
        body: JSON.stringify({ inputs: prompt }),
      }
    );

    if (!hfResponse.ok) {
      const errorText = await hfResponse.text();
      return res.status(502).json({ error: `Hugging Face API error: ${errorText}` });
    }

    const data = await hfResponse.json();

    let textResponse = "";
    if (Array.isArray(data)) {
      textResponse = data[0]?.generated_text || "";
    } else if (data?.generated_text) {
      textResponse = data.generated_text;
    } else if (typeof data === "string") {
      textResponse = data;
    }

    // Parse lines like:
    //  URL: https://...
    //  Steps: ...
    const urlMatch = textResponse.match(/URL:\s*<?(https?:\/\/[^\s>]+)>?/i);
    const stepsMatch = textResponse.match(/Steps:\s*([\s\S]+)/i);

    const url = urlMatch?.[1]?.trim() || "";
    let steps = stepsMatch?.[1]?.trim() || "";
    // Compact steps to a single short paragraph
    steps = steps.replace(/\n+/g, " ").slice(0, 600);

    if (!url || !steps) {
      // Friendly fallback so Notion can still write something useful
      return res.status(200).json({
        "Cancellation Link": "",
        "How to Cancel":
          `Couldn’t auto-detect a confirmed official link for "${service}". ` +
          `Try searching the official support/help center or account settings, then paste the link here.`,
        _debug_raw: textResponse
      });
    }

    return res.status(200).json({
      "Cancellation Link": url,
      "How to Cancel": steps
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
