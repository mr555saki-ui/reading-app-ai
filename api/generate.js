export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST method only" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "Vercelの環境変数に GEMINI_API_KEY が設定されていません。"
    });
  }

  // 混雑時に自動で試すモデルの優先順位リスト
  const candidateModels = [
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-pro"
  ];

  const { profile } = req.body || {};

  const prompt = `あなたは日本人学習者向けの「英語読解・チャンク処理特化型コーチ」です。
【学習者の特性と目標】
- 目標: 「1単語ずつ日本語に訳す」のを脱却し、「英語を意味のまとまり（チャンク）で前から直接処理する」状態。
- 得意: 文構造の把握、文脈からの推測、考える問題やクイズを解くこと。
- 課題: 単語想起速度の遅さ、熟語・コロケーションの弱さ、目が滑って戻り読みしてしまう癖。
- 方針: 大量暗記は禁止。1セッション15〜25分。過去につまずいた表現を新しい文脈で自然に再登場させて定着させる。

【過去の学習履歴・弱点データ】
${JSON.stringify(profile || {}, null, 2)}

【生成ルール】
1. topic: 学習者が興味を持てる話題（心理学、動物行動学、脳科学、社会現象、テクノロジーなど）。
2. warmups: 3〜4文。短文とターゲットとなるコロケーション（単語単体ではなく複数語のまとまり）。
3. passage: 5〜7文のミニ長文。少し歯ごたえがあるが文脈推測できるレベル。
4. passageChunks: ミニ長文を、前から読み進められる自然な意味のまとまり（チャンク）に分割した配列。
5. keyCollocations: 今回の文章で特に重要なコロケーション（2〜4個）と日本語解説。過去の弱点表現があれば1〜2個自然に組み込むこと。
6. questions: 読解理解クイズ2問。各問に選択肢3つ、正解インデックス(0始まり)、日本語の解説をつける。
7. reviewTargets: 今回再登場させた復習表現のリスト。

必ず指定されたJSONスキーマに準拠して出力してください。`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      topic: { type: "STRING" },
      warmups: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING" },
            collocation: { type: "STRING" },
            desc: { type: "STRING" }
          },
          required: ["text", "collocation", "desc"]
        }
      },
      passage: { type: "STRING" },
      passageChunks: {
        type: "ARRAY",
        items: { type: "STRING" }
      },
      keyCollocations: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            collocation: { type: "STRING" },
            desc: { type: "STRING" }
          },
          required: ["collocation", "desc"]
        }
      },
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            q: { type: "STRING" },
            options: { type: "ARRAY", items: { type: "STRING" } },
            answer: { type: "INTEGER" },
            explanation: { type: "STRING" }
          },
          required: ["q", "options", "answer", "explanation"]
        }
      },
      reviewTargets: {
        type: "ARRAY",
        items: { type: "STRING" }
      }
    },
    required: ["topic", "warmups", "passage", "passageChunks", "keyCollocations", "questions"]
  };

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
      temperature: 0.6,
      maxOutputTokens: 3500
    }
  };

  let lastError = null;

  // 混雑時は順に別モデルへ切り替えてリトライ
  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await r.json();

      if (r.ok) {
        let rawText = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "{}";
        rawText = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const parsed = JSON.parse(rawText);
        return res.status(200).json(parsed);
      }

      lastError = data?.error?.message || `Model ${model} failed`;
      // 混雑エラー等の場合は次のモデルを試行
      console.warn(`Model ${model} returned error: ${lastError}. Trying next model...`);
    } catch (e) {
      lastError = e.message;
    }
  }

  return res.status(503).json({
    error: `AIサーバーが混雑しています。10〜20秒ほど置いて再読み込みしてください。（詳細: ${lastError}）`
  });
}
