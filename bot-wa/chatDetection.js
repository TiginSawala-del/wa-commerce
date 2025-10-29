const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

// ===== KONFIGURASI =====
const SPAM_THRESHOLD = 0.7;
const MAX_MESSAGES_PER_MINUTE = 5;

// Database kata kasar dasar (sebagai foundation)
const KATA_KASAR_BASE = [
  "anjing",
  "anjir",
  "asu",
  "bangsat",
  "babi",
  "kampret",
  "tolol",
  "goblok",
  "idiot",
  "bodoh",
  "tai",
  "ngentot",
  "memek",
  "kontol",
  "jancok",
  "cok",
  "bajingan",
  "monyet",
  "brengsek",
  "sialan",
  "setan",
  "iblis",
  "pantek",
  "puki",
  "anjg",
  "bgst",
  "tlol",
  "gblk",
  "njir",
  "b4bi",
  "k0nt0l",
];

// Keyword untuk deteksi ajakan main ML
const ML_KEYWORDS = [
  "main ml",
  "mabar ml",
  "ml yuk",
  "mobile legend",
  "mobile legends",
  "push rank",
  "classic ml",
  "ranked ml",
  "ml bareng",
  "mabar mobile",
  "ada yang ml",
  "ml gak",
  "ml ga",
  "yuk ml",
  "gas ml",
  "ml dulu",
  "ngajakin ml",
  "ajak ml",
  "main mole",
  "mabar mole",
];

const SUSPICIOUS_KEYWORDS = [
  "klik link",
  "menang hadiah",
  "gratis",
  "promo",
  "diskon 90%",
  "jangan lewatkan",
  "buruan",
  "terbatas",
  "claim sekarang",
  "transfer sekarang",
  "investasi cuan",
  "passive income",
];

// ===== SMART LEARNING SYSTEM =====

const learnedPatterns = {
  suspiciousWords: new Map(),
  userViolations: new Map(),
  contextPatterns: new Map(),
  variations: new Set(),
};

// Tracking
const userMessageTracker = new Map();
const toxicWarnings = new Map();
const messageHistory = [];

// ===== CLIENT SETUP =====
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("Scan QR code ini:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Bot WhatsApp siap!");
  console.log("📋 Fitur aktif:");
  console.log("   - Deteksi Spam");
  console.log("   - AI Learning: Deteksi Kata Kasar Otomatis 🧠");
  console.log("   - Auto Tag untuk Ajakan Main ML");
});

// ===== SMART DETECTION FUNCTIONS =====

/**
 * Analisis similarity antara 2 kata (Levenshtein Distance)
 */
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return 1 - distance / maxLen; // Return similarity score 0-1
}

/**
 * Deteksi variasi kata kasar (typo, leet speak, dll)
 */
function findKataKasarVariations(word) {
  const found = [];

  // 1. Cek exact match
  for (const kasar of KATA_KASAR_BASE) {
    if (word === kasar) {
      found.push({ word: kasar, confidence: 1.0, type: "exact" });
    }
  }

  // 2. Cek contains (kata kasar dalam kata)
  for (const kasar of KATA_KASAR_BASE) {
    if (word.includes(kasar) && word !== kasar) {
      found.push({ word: kasar, confidence: 0.9, type: "contains" });
    }
  }

  // 3. Cek similarity (typo, variasi)
  for (const kasar of KATA_KASAR_BASE) {
    const similarity = calculateSimilarity(word, kasar);
    if (similarity > 0.75 && similarity < 1.0) {
      found.push({ word: kasar, confidence: similarity, type: "similar" });
    }
  }

  // 4. Cek learned variations
  for (const variation of learnedPatterns.variations) {
    if (word === variation) {
      found.push({ word: variation, confidence: 0.85, type: "learned" });
    }
  }

  // 5. Deteksi leet speak (a=4, e=3, i=1, o=0)
  const deLeet = word
    .replace(/4/g, "a")
    .replace(/3/g, "e")
    .replace(/1/g, "i")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/\$/g, "s");

  if (deLeet !== word) {
    for (const kasar of KATA_KASAR_BASE) {
      if (deLeet.includes(kasar)) {
        found.push({ word: kasar, confidence: 0.8, type: "leetspeak" });
      }
    }
  }

  // 6. Deteksi spasi/simbol dalam kata (a n j i n g, a-n-j-i-n-g)
  const cleanWord = word.replace(/[\s\-_\.]+/g, "");
  if (cleanWord !== word) {
    for (const kasar of KATA_KASAR_BASE) {
      if (cleanWord.includes(kasar)) {
        found.push({ word: kasar, confidence: 0.85, type: "spaced" });
      }
    }
  }

  return found;
}

/**
 * Analisis konteks pesan untuk deteksi toxic behavior
 */
function analyzeMessageContext(message, userHistory) {
  let toxicScore = 0;
  const indicators = [];

  // 1. Cek repetisi kata (spam kata yang sama)
  const words = message.body.toLowerCase().split(/\s+/);
  const wordFreq = {};
  words.forEach((w) => (wordFreq[w] = (wordFreq[w] || 0) + 1));
  const maxRepeat = Math.max(...Object.values(wordFreq));
  if (maxRepeat > 3) {
    toxicScore += 0.2;
    indicators.push("Repetisi kata berlebihan");
  }

  // 2. Cek CAPS + tanda seru berlebihan
  const capsCount = (message.body.match(/[A-Z]/g) || []).length;
  const exclamationCount = (message.body.match(/!/g) || []).length;
  if (capsCount > 10 && exclamationCount > 3) {
    toxicScore += 0.25;
    indicators.push("Berteriak (CAPS + !!!)");
  }

  // 3. Cek histori user (apakah sering toxic?)
  if (userHistory && userHistory.length > 3) {
    const recentToxic = userHistory.slice(-5).filter((h) => h.isToxic).length;
    if (recentToxic >= 3) {
      toxicScore += 0.3;
      indicators.push("Histori toxic behavior");
    }
  }

  // 4. Cek mention attack (mention banyak orang + kata agresif)
  const mentionCount = (message.body.match(/@/g) || []).length;
  const aggressiveWords = ["payah", "jelek", "buruk", "sampah", "noob", "nub"];
  const hasAggressiveWord = aggressiveWords.some((w) =>
    message.body.toLowerCase().includes(w)
  );
  if (mentionCount > 2 && hasAggressiveWord) {
    toxicScore += 0.35;
    indicators.push("Mention attack");
  }

  return {
    toxicScore: Math.min(toxicScore, 1),
    indicators: indicators,
  };
}

/**
 * Learning system: belajar dari pesan yang di-report
 */
function learnFromMessage(message, isToxic) {
  const words = message.body.toLowerCase().split(/\s+/);

  words.forEach((word) => {
    // Hanya pelajari kata yang cukup panjang
    if (word.length < 3) return;

    if (!learnedPatterns.suspiciousWords.has(word)) {
      learnedPatterns.suspiciousWords.set(word, { toxic: 0, normal: 0 });
    }

    const stats = learnedPatterns.suspiciousWords.get(word);
    if (isToxic) {
      stats.toxic++;

      // Jika kata ini sering muncul di konteks toxic, tambahkan ke variations
      if (stats.toxic > 3 && stats.toxic > stats.normal * 2) {
        learnedPatterns.variations.add(word);
        console.log(`🧠 Learned new toxic word: "${word}"`);
      }
    } else {
      stats.normal++;
    }
  });

  // Simpan ke message history
  messageHistory.push({
    timestamp: Date.now(),
    author: message.author,
    body: message.body,
    isToxic: isToxic,
  });

  // Batas histori 500 pesan terakhir
  if (messageHistory.length > 500) {
    messageHistory.shift();
  }
}

/**
 * MAIN: Deteksi kata kasar dengan AI learning
 */
function detectKataKasar(message) {
  const text = message.body.toLowerCase();
  const words = text.split(/\s+/);

  const foundViolations = [];
  let totalConfidence = 0;

  // Cek setiap kata
  for (const word of words) {
    const variations = findKataKasarVariations(word);

    if (variations.length > 0) {
      // Ambil yang confidence tertinggi
      const best = variations.sort((a, b) => b.confidence - a.confidence)[0];
      foundViolations.push({
        original: word,
        matched: best.word,
        confidence: best.confidence,
        type: best.type,
      });
      totalConfidence += best.confidence;
    }
  }

  // Analisis konteks
  const userHistory = messageHistory.filter((m) => m.author === message.author);
  const contextAnalysis = analyzeMessageContext(message, userHistory);

  // Gabungkan skor
  const finalConfidence = Math.min(
    (totalConfidence + contextAnalysis.toxicScore) / 2,
    1
  );
  const isToxic = foundViolations.length > 0 || finalConfidence > 0.5;

  return {
    isToxic: isToxic,
    violations: foundViolations,
    confidence: finalConfidence,
    contextIndicators: contextAnalysis.indicators,
    severity:
      finalConfidence > 0.8 ? "high" : finalConfidence > 0.5 ? "medium" : "low",
  };
}

/**
 * Deteksi ajakan main ML
 */
function detectAjakanML(message) {
  const text = message.body.toLowerCase();

  for (const keyword of ML_KEYWORDS) {
    if (text.includes(keyword)) {
      return {
        isMLInvitation: true,
        matchedKeyword: keyword,
      };
    }
  }

  return {
    isMLInvitation: false,
    matchedKeyword: null,
  };
}

/**
 * Deteksi spam berdasarkan rules
 */
function detectSpamRuleBased(message) {
  const text = message.body.toLowerCase();
  let spamScore = 0;
  const reasons = [];

  const keywordMatches = SUSPICIOUS_KEYWORDS.filter((kw) =>
    text.includes(kw.toLowerCase())
  );
  if (keywordMatches.length > 0) {
    spamScore += 0.3 * keywordMatches.length;
    reasons.push(`Keyword mencurigakan: ${keywordMatches.join(", ")}`);
  }

  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (urlCount > 2) {
    spamScore += 0.3;
    reasons.push(`Terlalu banyak link (${urlCount})`);
  }

  const emojiCount = (
    text.match(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
    ) || []
  ).length;
  if (emojiCount > 10) {
    spamScore += 0.2;
    reasons.push("Emoji berlebihan");
  }

  const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (capsRatio > 0.6 && text.length > 20) {
    spamScore += 0.2;
    reasons.push("CAPS LOCK berlebihan");
  }

  if (text.length > 1000) {
    spamScore += 0.15;
    reasons.push("Pesan terlalu panjang");
  }

  return {
    isSpam: spamScore >= SPAM_THRESHOLD,
    score: Math.min(spamScore, 1),
    reasons: reasons,
  };
}

function detectSpamRate(message) {
  const userId = message.author || message.from;
  const now = Date.now();

  if (!userMessageTracker.has(userId)) {
    userMessageTracker.set(userId, []);
  }

  const userMessages = userMessageTracker.get(userId);
  const recentMessages = userMessages.filter((time) => now - time < 60000);
  recentMessages.push(now);
  userMessageTracker.set(userId, recentMessages);

  return {
    isFlooding: recentMessages.length > MAX_MESSAGES_PER_MINUTE,
    messageCount: recentMessages.length,
  };
}

function handleToxicWarning(userId) {
  if (!toxicWarnings.has(userId)) {
    toxicWarnings.set(userId, { count: 0, lastWarning: Date.now() });
  }

  const userData = toxicWarnings.get(userId);
  userData.count++;
  userData.lastWarning = Date.now();
  toxicWarnings.set(userId, userData);

  return userData;
}

// ===== MESSAGE HANDLER =====
client.on("message_create", async (message) => {
  try {
    const chat = await message.getChat();
    if (!chat.isGroup) return;
    if (message.fromMe) return;

    console.log(
      `\n📨 Pesan dari ${message.author}: ${message.body.substring(0, 50)}...`
    );

    // 1. DETEKSI KATA KASAR (SMART AI)
    const toxicDetection = detectKataKasar(message);

    if (toxicDetection.isToxic) {
      console.log("🤬 KATA KASAR TERDETEKSI!");
      console.log(
        "Confidence:",
        (toxicDetection.confidence * 100).toFixed(1) + "%"
      );
      console.log("Violations:", toxicDetection.violations);
      console.log("Context:", toxicDetection.contextIndicators);

      // Learning: catat sebagai toxic
      learnFromMessage(message, true);

      const userData = handleToxicWarning(message.author);
      const contact = await message.getContact();

      let warningMsg = "";
      let detailMsg = "";

      // Detail pelanggaran
      if (toxicDetection.violations.length > 0) {
        const detected = toxicDetection.violations
          .map((v) => {
            const typeEmoji = {
              exact: "🎯",
              similar: "🔄",
              contains: "📍",
              learned: "🧠",
              leetspeak: "🔢",
              spaced: "📏",
            };
            return `${typeEmoji[v.type] || "⚠️"} "${v.original}" (${(
              v.confidence * 100
            ).toFixed(0)}% mirip "${v.matched}")`;
          })
          .join("\n");
        detailMsg = `\n\n*Terdeteksi:*\n${detected}`;
      }

      if (toxicDetection.contextIndicators.length > 0) {
        detailMsg += `\n\n*Indikator:* ${toxicDetection.contextIndicators.join(
          ", "
        )}`;
      }

      if (userData.count === 1) {
        warningMsg = `⚠️ *PERINGATAN 1/3*\n\n@${
          message.author.split("@")[0]
        }, mohon jaga bahasa di grup ini ya! 🙏${detailMsg}\n\n_Confidence: ${(
          toxicDetection.confidence * 100
        ).toFixed(0)}%_`;
      } else if (userData.count === 2) {
        warningMsg = `⚠️ *PERINGATAN 2/3*\n\n@${
          message.author.split("@")[0]
        }, ini peringatan kedua! Harap gunakan bahasa yang sopan. ⚠️${detailMsg}`;
      } else if (userData.count >= 3) {
        warningMsg = `🚨 *KICK OTOMATIS*\n\n@${
          message.author.split("@")[0]
        } telah melanggar aturan 3 kali!\n\n${detailMsg}\n\n_Member akan di-kick dari grup..._`;

        await chat.sendMessage(warningMsg, {
          mentions: [message.author],
        });

        // AUTO KICK setelah 2 detik
        setTimeout(async () => {
          try {
            await chat.removeParticipants([message.author]);
            console.log(`✅ User ${message.author} berhasil di-kick!`);

            await chat.sendMessage(
              `✅ *Member Removed*\n\nUser telah di-kick karena pelanggaran berulang (3x toxic warning).`
            );

            // Reset warning count untuk user ini
            toxicWarnings.delete(message.author);
          } catch (error) {
            console.error("❌ Gagal kick user:", error);
            await chat.sendMessage(
              "⚠️ Gagal kick member. Pastikan bot adalah admin grup!"
            );
          }
        }, 2000);
      }

      await chat.sendMessage(warningMsg, {
        mentions: [message.author],
      });
    } else {
      // Learning: catat sebagai normal
      learnFromMessage(message, false);
    }

    // 2. DETEKSI AJAKAN MAIN ML
    const mlDetection = detectAjakanML(message);

    if (mlDetection.isMLInvitation) {
      console.log("🎮 AJAKAN MAIN ML TERDETEKSI!");
      console.log("Keyword:", mlDetection.matchedKeyword);

      const participants = chat.participants.map((p) => p.id._serialized);
      const mentions = participants.filter(
        (p) => p !== client.info.wid._serialized
      );

      const contact = await message.getContact();
      const mlMsg =
        `🎮 *MOBILE LEGENDS PARTY!* 🎮\n\n` +
        `@${message.author.split("@")[0]} ngajak mabar nih!\n\n` +
        `📢 Calling all gamers! Ada yang mau ikutan?\n\n` +
        `Yang minat langsung chat ya! 🔥`;

      await chat.sendMessage(mlMsg, {
        mentions: mentions,
      });

      console.log(`✅ ${mentions.length} members di-tag!`);
    }

    // 3. DETEKSI SPAM
    const ruleDetection = detectSpamRuleBased(message);
    const rateDetection = detectSpamRate(message);
    const isSpam = ruleDetection.isSpam || rateDetection.isFlooding;

    if (isSpam) {
      console.log("🚨 SPAM TERDETEKSI!");

      const contact = await message.getContact();
      const warningMsg =
        `🚨 *SPAM ALERT*\n\n` +
        `👤 Pengirim: @${message.author.split("@")[0]}\n` +
        `📊 Spam Score: ${(ruleDetection.score * 100).toFixed(0)}%\n` +
        `📝 Alasan: ${ruleDetection.reasons.join(", ")}`;

      await chat.sendMessage(warningMsg, {
        mentions: [message.author],
      });
    }
  } catch (error) {
    console.error("❌ Error processing message:", error);
  }
});

// ===== ADMIN COMMANDS =====
client.on("message", async (message) => {
  const chat = await message.getChat();
  if (!chat.isGroup) return;

  const text = message.body.toLowerCase();

  if (text === "!spam-stats") {
    const stats = Array.from(userMessageTracker.entries())
      .map(([user, messages]) => ({
        user: user.split("@")[0],
        count: messages.length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const statsMsg =
      "📊 *Spam Statistics*\n\n" +
      (stats.length > 0
        ? stats
            .map((s, i) => `${i + 1}. @${s.user}: ${s.count} pesan/menit`)
            .join("\n")
        : "Tidak ada aktivitas mencurigakan");

    await message.reply(statsMsg);
  }

  if (text === "!toxic-stats") {
    const stats = Array.from(toxicWarnings.entries())
      .map(([user, data]) => ({
        user: user.split("@")[0],
        count: data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const statsMsg =
      "🤬 *Toxic User Statistics*\n\n" +
      (stats.length > 0
        ? stats
            .map((s, i) => `${i + 1}. @${s.user}: ${s.count} peringatan`)
            .join("\n")
        : "Tidak ada pelanggaran 🎉");

    await message.reply(statsMsg);
  }

  if (text === "!learned-words") {
    const learned = Array.from(learnedPatterns.variations);
    const suspiciousStats = Array.from(
      learnedPatterns.suspiciousWords.entries()
    )
      .filter(([word, stats]) => stats.toxic > 2)
      .sort((a, b) => b[1].toxic - a[1].toxic)
      .slice(0, 10);

    let msg = "🧠 *AI Learning Stats*\n\n";
    msg += `📚 Learned toxic words: ${learned.length}\n`;
    msg += `📊 Total analyzed words: ${learnedPatterns.suspiciousWords.size}\n`;
    msg += `📜 Message history: ${messageHistory.length}\n\n`;

    if (suspiciousStats.length > 0) {
      msg += "*Top Suspicious Words:*\n";
      msg += suspiciousStats
        .map(
          ([word, stats]) =>
            `• ${word}: ${stats.toxic} toxic / ${stats.normal} normal`
        )
        .join("\n");
    }

    await message.reply(msg);
  }

  if (text === "!toxic-reset") {
    toxicWarnings.clear();
    await message.reply("✅ Semua peringatan toxic telah di-reset");
  }

  if (text === "!spam-reset") {
    userMessageTracker.clear();
    await message.reply("✅ Spam tracker telah di-reset");
  }

  if (text === "!learning-reset") {
    learnedPatterns.suspiciousWords.clear();
    learnedPatterns.variations.clear();
    messageHistory.length = 0;
    await message.reply("✅ AI learning data telah di-reset");
  }

  if (text === "!bot-help") {
    const helpMsg =
      `🤖 *Bot Command List*\n\n` +
      `📊 *Statistik:*\n` +
      `• !spam-stats - Lihat statistik spam\n` +
      `• !toxic-stats - Lihat user toxic\n` +
      `• !learned-words - Lihat AI learning stats 🧠\n\n` +
      `🔧 *Admin:*\n` +
      `• !toxic-reset - Reset peringatan\n` +
      `• !spam-reset - Reset spam tracker\n` +
      `• !learning-reset - Reset AI learning\n` +
      `• !bot-help - Tampilkan menu ini\n\n` +
      `🛡️ *Fitur Otomatis:*\n` +
      `✓ AI learning kata kasar (deteksi variasi)\n` +
      `✓ Auto-tag saat ada ajakan main ML\n` +
      `✓ Deteksi spam & flooding\n` +
      `✓ Context analysis (CAPS, mention attack, dll)`;

    await message.reply(helpMsg);
  }
});

client.initialize();

console.log("🤖 WhatsApp AI Moderator Bot dimulai...");
console.log("📝 Fitur:");
console.log("   ✓ Anti-spam");
console.log("   ✓ AI Learning: Anti-toxic (belajar dari pesan)");
console.log("   ✓ Auto-tag untuk ajakan ML");
