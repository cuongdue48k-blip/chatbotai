import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

// 🎯 PROMPT hệ thống tối ưu cho tư vấn vết thương
const SYSTEM_PROMPT = `
Bạn là trợ lý AI chuyên tư vấn sơ cứu vết thương ngoài da.
Luôn trả lời bằng tiếng Việt.

Bạn sẽ nhận được:
- Văn bản người dùng mô tả vấn đề
- Nhãn dự đoán từ mô hình phân tích ảnh (6 loại):
  • Bỏng mức 1
  • Bỏng mức 2
  • Bỏng mức 3
  • Vết rách
  • Trầy xước
  • Da thường

Quy tắc:
- Luôn dựa vào nhãn dự đoán để tư vấn (rất quan trọng).
- Nếu “Da thường”: nói da bình thường, không cần sơ cứu.
- Nếu là bỏng: hướng dẫn theo mức độ 1–3.
- Nếu trầy xước: hướng dẫn rửa sạch, sát trùng, băng lại.
- Nếu vết rách: hướng dẫn cầm máu, vệ sinh, và cảnh báo đi viện nếu sâu.
- Trả lời rõ ràng, từng bước, dễ hiểu.
- Không bao giờ nói “không hiểu yêu cầu”.
`;

// ---------------------------------------------------------
// 🚀 PHẦN LOCAL Q&A – KỊCH BẢN TỰ TRAIN (KHÔNG GỌI AI)
// ---------------------------------------------------------

// Hàm bỏ dấu tiếng Việt → giúp match từ khoá dễ dàng
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9 ]/g, " ");
}

// Danh sách câu trả lời local
const LOCAL_QA = [
  {
    id: "trayxuoc_basic",
    keywords: ["tray xuoc", "trầy xước", "xay da", "tia vet tray"],
    answer: `Nếu bạn bị trầy xước nhẹ, có thể làm như sau:
1. Rửa tay sạch với xà phòng.
2. Rửa vết thương dưới vòi nước mát để loại bỏ bụi bẩn.
3. Dùng khăn sạch/gạc lau khô nhẹ.
4. Sát khuẩn nhẹ bằng povidone-iodine hoặc chlorhexidine.
5. Băng lại nếu vùng da dễ bị cọ xát.

Nếu sưng nhiều, đau tăng, chảy mủ hoặc sốt → đi khám bác sĩ.`
  },
  {
    id: "bong_muc1",
    keywords: ["bong muc 1", "bỏng mức 1", "bong nhe"],
    answer: `Bỏng mức 1 thường chỉ đỏ da và rát nhẹ. Cách xử lý:
1. Làm mát vùng bỏng bằng nước mát chạy liên tục 10–20 phút.
2. Không dùng kem đánh răng, nước mắm, dầu gió...
3. Giữ vùng da sạch và khô.
4. Cơn đau có thể giảm với paracetamol (đúng liều).

Nếu bỏng diện rộng hoặc ở mặt, hãy đi khám để được đánh giá chi tiết.`
  },
  {
    id: "khi_nao_di_benh_vien",
    keywords: ["khi nao di benh vien", "luc nao can di benh vien", "co can di vien khong"],
    answer: `Bạn nên đi bệnh viện ngay nếu:
- Bỏng mức 3, bỏng sâu, da trắng bệch hoặc cháy đen.
- Vết rách sâu, chảy máu không cầm sau 10–15 phút.
- Vết thương ở mắt, mặt, bộ phận sinh dục.
- Có dấu hiệu nhiễm trùng: đỏ – sưng – nóng – đau – chảy mủ – sốt.

Trong các trường hợp này, sơ cứu tại nhà không đủ, cần bác sĩ kiểm tra.`
  }
];

// Tìm xem câu hỏi có khớp Q&A local không
function findLocalAnswer(userMessage) {
  const normMsg = normalize(userMessage);

  for (const item of LOCAL_QA) {
    const matched = item.keywords.some(kw =>
      normMsg.includes(normalize(kw))
    );
    if (matched) return item;
  }
  return null;
}

// ---------------------------------------------------------
// 🚀 PHẦN CHÍNH: API CHAT
// ---------------------------------------------------------

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history, woundLabel, woundProb } = req.body;

    // 1️⃣ Trả lời bằng Local Q&A trước (không tốn API)
    const local = findLocalAnswer(message);
    if (local) {
      return res.json({
        reply: local.answer,
        source: "local"
      });
    }

    // 2️⃣ Không có Q&A local → gọi Gemini
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      {
        role: "user",
        content: `
Người dùng hỏi: "${message}"

Thông tin từ mô hình ảnh:
- Loại vết thương: ${woundLabel || "Không có dữ liệu"}
- Độ tin cậy: ${(woundProb * 100).toFixed(1)}%

Hãy tư vấn dựa vào loại vết thương này.
`
      }
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "localhost",
        "X-Title": "Wound-AI-Assistant"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages
      })
    });

    const data = await response.json();

    // ❗ Nếu API bị quá tải (429)
    if (data.error && data.error.code === 429) {
      return res.json({
        reply:
          "Hiện tại máy chủ Gemini miễn phí đang quá tải. Bạn vui lòng thử lại sau vài phút nhé!",
        source: "rate_limit"
      });
    }

    if (!data.choices) {
      return res.status(500).json({
        error: "Gemini 2.0 API Error",
        details: data
      });
    }

    const reply = data.choices[0].message.content;
    res.json({ reply, source: "gemini" });

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

// ---------------------------------------------------------

app.listen(PORT, () => {
  console.log(`🚀 Backend Gemini 2.0 Flash chạy tại http://localhost:${PORT}`);
});
