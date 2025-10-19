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
          content: `Service name: ${service}. You are an assistant that finds official subscription cancellation links and step-by-step instructions.

Your task:
1. Search the web for accurate and up-to-date information.
2. Identify the official cancellation link for the service.
3. Provide clear, step-by-step cancellation instructions.

Return the answer strictly in this JSON format:
{
  "service": "<SERVICE_NAME>",
  "cancellation_link": "<official URL or null>",
  "instructions": "<detailed step-by-step guide>"
}`
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

    // ✅ 5. Parse the HF response safely
    const result = await response.json();

    let content;

    // Case 1: Hugging Face returns OpenAI-format with choices[]
    if (result.choices && result.choices[0]?.message?.content) {
      content = result.choices[0].message.content;
    } else {
      // Case 2: Raw JSON/object/string fallback
      content = result;
    }

    let data;
    if (typeof content === "string") {
      try {
        data = JSON.parse(content);
      } catch (err) {
        return res.status(500).json({
          error: "Model returned invalid JSON string",
          raw: content,
        });
      }
    } else {
      data = content;
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
