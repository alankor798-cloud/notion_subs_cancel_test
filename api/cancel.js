export default async function handler(req, res) {
  try {
    // ✅ 1. Get the service name from the incoming Notion webhook
    const { service } = req.body;
    if (!service) {
      return res.status(400).json({ error: "Missing 'service' in request body" });
    }

    // ✅ 2. Hugging Face API config
    const HF_API_URL = "https://router.huggingface.co/v1/chat/completions";
    const HF_TOKEN = process.env.HF_TOKEN; // make sure this is set in Vercel env vars

    if (!HF_TOKEN) {
      return res.status(500).json({ error: "Missing Hugging Face API token" });
    }

    // ✅ 3. Build the prompt using the new JSON format
    const payload = {
      messages: [
        {
          role: "user",
          content: `Service name: ${service}. Return ONLY a JSON object with three fields: 'service', 'cancellation_link', and 'instructions'. The 'cancellation_link' should be the official page where users can cancel their subscription. The 'instructions' should briefly describe how to cancel the subscription as of today. Do not include additional commentary.`
        }
      ],
      model: "openai/gpt-oss-20b",
      stream: false
    };

    // ✅ 4. Call the Hugging Face API
    const response = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${HF_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const raw = await response.text();
      return res.status(500).json({
        error: "Hugging Face API error",
        raw
      });
    }

    // ✅ 5. Parse the HF response (model might return a string or object)
    const result = await response.json();

    let data;
    if (typeof result === "string") {
      try {
        data = JSON.parse(result);
      } catch {
        return res.status(500).json({
          error: "Model returned invalid JSON string",
          raw: result,
        });
      }
    } else {
      data = result;
    }

    const { service: svc, cancellation_link, instructions } = data;
    if (!cancellation_link || !instructions) {
      return res.status(500).json({
        error: "The model did not return the required fields",
        raw: data,
      });
    }

    // ✅ 6. Respond in a way Notion can use
    return res.status(200).json({
      service: svc || service,
      cancellation_link,
      instructions
    });

  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
