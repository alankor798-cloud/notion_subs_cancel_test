export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Safely parse body
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const service = body?.service;
    if (!service) {
      return res.status(400).json({ error: "Missing 'service' in request body" });
    }

    const prompt = `
You are an expert in subscription services.
Provide the OFFICIAL cancellation link and short instructions for the service: "${service}".

Format the response EXACTLY as:

URL: <link>
Steps: <1-3 sentences of instructions>
`;

    // ✅ CHANGE THIS to use either your env var or a hardcoded key for now
    const HF_API_KEY = process.env.HUGGINGFACE_API_KEY || "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";

    const hfResponse = await fetch(
      "https://api-inference.huggingface.co/models/tiiuae/falcon-7b-instruct",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${HF_API_KEY}`,
        },
        body: JSON.stringify({ inputs: prompt }),
      }
    );

    const raw = await hfResponse.text();
    console.log("🔍 Hugging Face raw response:", raw);

    if (!hfResponse.ok) {
      return res.status(500).json({
        error: "Hugging Face API error",
        raw
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      // Model might return plain text instead of JSON
      data = raw;
    }

    let textResponse = "";

    if (Array.isArray(data) && data[0]?.generated_text) {
      textResponse = data[0].generated_text;
    } else if (typeof data === "string") {
      textResponse = data;
    } else if (data?.generated_text) {
      textResponse = data.generated_text;
    } else {
      return res.status(500).json({
        error: "Unrecognized response format from Hugging Face",
        raw: data
      });
    }

    // Parse the result
    const urlMatch = textResponse.match(/URL:\s*<?(https?:\/\/[^\s>]+)>?/i);
    const stepsMatch = textResponse.match(/Steps:\s*([\s\S]+)/i);

    const url = urlMatch?.[1]?.trim() || "";
    let steps = stepsMatch?.[1]?.trim() || "";
    steps = steps.replace(/\n+/g, " ").slice(0, 600);

    if (!url || !steps) {
      return res.status(200).json({
        "Cancellation Link": "",
        "How to Cancel": `Could not extract a proper link or instructions for "${service}". Check the raw response.`,
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
