export default async function handler(req, res) {
  // Enforce POST-only
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse request body
  const { serviceName } = req.body;
  if (!serviceName) {
    return res.status(400).json({ error: "Missing serviceName in request body" });
  }

  try {
    // ✅ Get the token from environment (this MUST exist in Vercel settings)
    const hfToken = process.env.HF_API_KEY;
    if (!hfToken) {
      return res.status(500).json({ error: "Hugging Face API key not configured" });
    }

    // ✅ Call Hugging Face Inference API endpoint
    const response = await fetch(
      "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-v0.3",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${hfToken}`, // ✅ Correct usage
        },
        body: JSON.stringify({
          inputs: `Provide a direct URL for canceling the subscription to: ${serviceName}. If none exists, reply "No URL available".`,
        }),
      }
    );

    // Handle failed requests
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Hugging Face API Error:", errorText);
      return res.status(500).json({
        error: "Hugging Face API error",
        raw: errorText,
      });
    }

    // Parse Hugging Face response
    const data = await response.json();
    const output =
      data && data.length > 0 && data[0].generated_text
        ? data[0].generated_text
        : "No URL available";

    return res.status(200).json({ url: output });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
