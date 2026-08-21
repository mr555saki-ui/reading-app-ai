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

  const candidateModels = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-pro"
  ];

  const { profile } = req.body || {};

  // トピックの多様化シード
  const seedKeywords = [
    "deep sea creatures", "coffee culture & biology", "sleep cycles & dreaming",
    "architecture & city secrets", "ancient inventions", "plant communication",
    "cognitive biases in shopping", "space exploration challenges", "memory tricks",
    "bird intelligence", "sound and psychology", "food science & fermentation",
    "microbiome & gut health", "subtle body language", "origins of everyday idioms",
    "animal navigation skills", "history of everyday tools", "neuroscience of habits"
  ];
  const randomSeed = seedKeywords[Math.floor(Math.random() * seedKeywords.length)];

  // 復習対象（過去に学習して一定間隔が空いたもの）の選定
  const dueReviewPhrases = (profile?.dueReviews || []).slice(0, 2);

  const prompt = `あなたは日本人学習者向けの「英語読解・チャンク処理特化型コーチ」です。
【学習者の特性と目標】
- 目標: 英語を意味のまとまり（チャンク）で前から直接処理する。
- 課題: 単語想起速度の遅さ、熟語・コロケーションの弱さ、戻り読みの癖。

【重要：分散復習（Spaced Repetition）の必須ルール】
${dueReviewPhrases.length > 0 ? `
以下の「過去につまずき、時間が経って復習タイミングを迎えた表現」を【必ず1〜2個自然に長文および短文に組み込んで】ください。
■ 今回の復習対象表現:
${dueReviewPhrases.map(p => `- ${p}`).join('\n')}
※ これらを新しい文脈・ストーリーの中で自然に使わせることで、記憶の定着を図ります。
` : `
過去の復習対象がまだないため、魅力的で実用的な新しいコロケーションを選出してください。
`}

【コロケーションの多様性ルール】
- 頻出テンプレ表現（play a key role in, pay attention to 等）の単調な繰り返しは厳禁。
- 「${randomSeed}」に関する知的で面白い雑学やエピソードを展開してください。

【生成ルール】
1. topic: 具体的で知的好奇心を刺激するタイトル。
2. keyCollocations: 今回の長文で核となる重要なコロケーション（2〜3個）と日本語解説。復習対象を入れた場合はそれも含めること。
3. warmups: 3〜4文。keyCollocations を使った短文。
4. passage: 5〜7文のミニ長文。知的で面白い内容にし、keyCollocations を自然に含めること。
5. passageChunks: ミニ長文を、前から読み進められる自然な意味のまとまり（チャンク）に分割した配列。
6. questions: 読解理解クイズ2問。各問に選択肢3つ、正解インデックス(0始まり)、日本語の解説をつける。
7. reviewTargets: 今回実際に復習として再登場させた表現のリスト（なければ空配列）。

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
      temperature: 0.9,
      maxOutputTokens: 3500
    }
  };

  let lastError = null;

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
    } catch (e) {
      lastError = e.message;
    }
  }

  return res.status(500).json({ error: `教材生成に失敗しました: ${lastError}` });
}
