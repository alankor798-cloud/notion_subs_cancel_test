const NOTION_VERSION = "2022-06-28";

function extractServiceName(serviceProperty) {
  if (!serviceProperty) return null;

  const { type } = serviceProperty;

  if (type === "title" && Array.isArray(serviceProperty.title)) {
    return serviceProperty.title.map((item) => item.plain_text || "").join(" ").trim();
  }

  if (type === "rich_text" && Array.isArray(serviceProperty.rich_text)) {
    return serviceProperty.rich_text
      .map((item) => item.plain_text || "")
      .join(" ")
      .trim();
  }

  if (type === "select" && serviceProperty.select) {
    return serviceProperty.select.name || null;
  }

  if (type === "url") {
    return serviceProperty.url || null;
  }

  if (type === "formula" && serviceProperty.formula) {
    const { string, number } = serviceProperty.formula;
    return (string ?? number?.toString()) || null;
  }

  return null;
}

function notionRichTextFromString(value) {
  return [
    {
      type: "text",
      text: {
        content: value,
      },
    },
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pageId } = req.body || {};

  if (!pageId) {
    return res.status(400).json({ error: "Missing pageId in request body" });
  }

  const notionToken = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!notionToken) {
    return res.status(500).json({ error: "Notion API key not configured" });
  }

  const hfToken = process.env.HF_TOKEN || process.env.HF_API_KEY;
  if (!hfToken) {
    return res.status(500).json({ error: "Hugging Face API key not configured" });
  }

  try {
    const notionResponse = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
      },
    });

    if (!notionResponse.ok) {
      const errorText = await notionResponse.text();
      console.error("Notion API Error:", errorText);
      return res.status(500).json({ error: "Failed to retrieve Notion page", raw: errorText });
    }

    const notionData = await notionResponse.json();
    const serviceName = extractServiceName(notionData?.properties?.Service);

    if (!serviceName) {
      return res.status(400).json({ error: "Could not determine service name from Notion page" });
    }

    const hfResponse = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${hfToken}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: `Service name: ${serviceName}. Return ONLY a JSON object with three fields: 'service', 'cancellation_link', and 'instructions'. The 'cancellation_link' should be the official page where users can cancel their subscription. The 'instructions' should briefly describe how to cancel the subscription as of today. Do not include additional commentary.`,
          },
        ],
        model: "openai/gpt-oss-20b",
        stream: false,
      }),
    });

    if (!hfResponse.ok) {
      const errorText = await hfResponse.text();
      console.error("Hugging Face API Error:", errorText);
      return res.status(500).json({ error: "Hugging Face API error", raw: errorText });
    }

    const hfData = await hfResponse.json();
    const hfMessage = hfData?.choices?.[0]?.message?.content;

    if (!hfMessage) {
      return res.status(500).json({ error: "Invalid response from Hugging Face" });
    }

    let hfResult;
    try {
      hfResult = JSON.parse(hfMessage);
    } catch (parseError) {
      console.error("Failed to parse Hugging Face response", hfMessage);
      return res.status(500).json({ error: "Malformed response from Hugging Face", raw: hfMessage });
    }

    const { cancellation_link: cancellationLink, instructions } = hfResult;

    if (!cancellationLink || !instructions) {
      return res.status(500).json({ error: "Hugging Face response missing required fields", raw: hfResult });
    }

    const notionUpdateResponse = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          "Cancellation Link": {
            url: cancellationLink,
          },
          Instructions: {
            rich_text: notionRichTextFromString(instructions),
          },
        },
      }),
    });

    if (!notionUpdateResponse.ok) {
      const errorText = await notionUpdateResponse.text();
      console.error("Notion update error:", errorText);
      return res.status(500).json({ error: "Failed to update Notion page", raw: errorText });
    }

    return res.status(200).json({
      service: hfResult.service ?? serviceName,
      cancellationLink,
      instructions,
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
