const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const ExcelJS = require("exceljs");
const AWS = require("aws-sdk");
const fs = require("fs");

const s3 = new AWS.S3({
  accessKeyId: process.env.CLOUD_ACCESS_KEY,
  secretAccessKey: process.env.CLOUD_SECRET_KEY,
  region: process.env.CLOUD_REGION,
});

// ===== KONFIGURASI EXCEL =====
const EXCEL_CONFIG = {
  // Opsi 1: Simpan di folder khusus (gampang di-backup)
  FILE_PATH: process.env.EXCEL_PATH || "./data/database_aduan.xlsx",

  // Opsi 2: Simpan di Google Drive (otomatis sync)
  USE_GOOGLE_DRIVE: process.env.USE_GOOGLE_DRIVE === "true",
  GOOGLE_DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || "",

  // Opsi 3: Simpan di cloud storage (AWS S3, etc)
  USE_CLOUD_STORAGE: process.env.USE_CLOUD_STORAGE === "true",
  CLOUD_BUCKET: process.env.CLOUD_BUCKET || "",

  SHEET_NAME: "Aduan",

  // Auto backup settings
  AUTO_BACKUP: true,
  BACKUP_INTERVAL_HOURS: 0.0333, // Backup setiap 6 jam
  MAX_BACKUPS: 10, // Simpan maksimal 10 backup
};

// ===== DAFTAR APLIKASI YANG BISA DIADUKAN =====
const APLIKASI_LIST = [
  { id: 1, nama: "Mobile Banking", emoji: "🏦" },
  { id: 2, nama: "E-Commerce", emoji: "🛒" },
  { id: 3, nama: "Social Media", emoji: "📱" },
  { id: 4, nama: "Streaming", emoji: "🎬" },
  { id: 5, nama: "Game", emoji: "🎮" },
  { id: 6, nama: "Transportasi Online", emoji: "🚗" },
  { id: 7, nama: "Delivery Food", emoji: "🍔" },
  { id: 8, nama: "Lainnya", emoji: "📝" },
];

// ===== SESSION MANAGEMENT =====
const userSessions = new Map();

const SESSION_STATE = {
  IDLE: "idle",
  WAITING_APP_CHOICE: "waiting_app_choice",
  WAITING_NAME: "waiting_name",
  WAITING_COMPLAINT: "waiting_complaint",
  CONFIRMING: "confirming",
};

// ===== CLIENT SETUP =====
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "complaint-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("📱 Scan QR code ini untuk Complaint Bot:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ Complaint Bot siap menerima aduan!");
  console.log(`📋 ${APLIKASI_LIST.length} kategori aplikasi tersedia`);
  console.log(`📂 File Excel: ${EXCEL_CONFIG.FILE_PATH}`);

  // Inisialisasi Excel file
  initExcelFile();

  // === AUTO BACKUP SETUP ===
  if (EXCEL_CONFIG.AUTO_BACKUP) {
    const intervalMs = EXCEL_CONFIG.BACKUP_INTERVAL_HOURS * 60 * 60 * 1000;
    console.log(
      `🕒 Auto backup aktif setiap ${
        EXCEL_CONFIG.BACKUP_INTERVAL_HOURS * 60
      } menit (${intervalMs / 1000} detik)`
    );

    setInterval(autoBackupExcel, intervalMs);
  }
});

// ===== EXCEL FUNCTIONS =====

/**
 * Inisialisasi file Excel jika belum ada
 */
async function initExcelFile() {
  try {
    if (!fs.existsSync(EXCEL_CONFIG.FILE_PATH)) {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(EXCEL_CONFIG.SHEET_NAME);

      // Definisikan kolom dengan width
      worksheet.columns = [
        { width: 8 }, // A: No
        { width: 20 }, // B: Aplikasi
        { width: 25 }, // C: Nama
        { width: 18 }, // D: No. HP
        { width: 50 }, // E: Aduan
        { width: 15 }, // F: Status
        { width: 22 }, // G: Request Date
      ];

      // Tambah header manual di row 1
      const headerRow = worksheet.getRow(1);
      headerRow.values = [
        "No",
        "Aplikasi",
        "Nama",
        "No. HP",
        "Aduan",
        "Status",
        "Request Date",
      ];

      // Style header
      headerRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4472C4" },
      };
      headerRow.alignment = { vertical: "middle", horizontal: "center" };
      headerRow.height = 20;

      await workbook.xlsx.writeFile(EXCEL_CONFIG.FILE_PATH);
      console.log("✅ Excel file created:", EXCEL_CONFIG.FILE_PATH);
    } else {
      console.log("✅ Excel file exists:", EXCEL_CONFIG.FILE_PATH);
    }
  } catch (error) {
    console.error("❌ Error initializing Excel file:", error.message);
  }
}

/**
 * Simpan aduan ke Excel - FIXED VERSION
 */
async function saveToExcel(data) {
  try {
    // Pastikan file exists
    if (!fs.existsSync(EXCEL_CONFIG.FILE_PATH)) {
      await initExcelFile();
    }

    // Buat workbook baru setiap kali
    const workbook = new ExcelJS.Workbook();

    // Read file
    await workbook.xlsx.readFile(EXCEL_CONFIG.FILE_PATH);

    // Get worksheet
    const worksheet = workbook.getWorksheet(EXCEL_CONFIG.SHEET_NAME);

    if (!worksheet) {
      throw new Error(`Sheet "${EXCEL_CONFIG.SHEET_NAME}" tidak ditemukan`);
    }

    // Hitung nomor urut berdasarkan jumlah row yang ada
    let nextNo = 1;
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        // Skip header
        nextNo++;
      }
    });

    // Format tanggal
    const now = new Date();
    const requestDate = now.toLocaleString("id-ID", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    console.log(`📝 Menambahkan data ke Excel...`);
    console.log(`   Ticket #${nextNo}`);
    console.log(`   Aplikasi: ${data.aplikasi}`);
    console.log(`   Nama: ${data.nama}`);

    // Dapatkan row number berikutnya
    const nextRowNumber = worksheet.rowCount + 1;

    // Set values langsung ke cell
    worksheet.getCell(`A${nextRowNumber}`).value = nextNo;
    worksheet.getCell(`B${nextRowNumber}`).value = data.aplikasi;
    worksheet.getCell(`C${nextRowNumber}`).value = data.nama;
    worksheet.getCell(`D${nextRowNumber}`).value = data.nomorHP;
    worksheet.getCell(`E${nextRowNumber}`).value = data.aduan;
    worksheet.getCell(`F${nextRowNumber}`).value = "Pending";
    worksheet.getCell(`G${nextRowNumber}`).value = requestDate;

    // Get the row untuk styling
    const newRow = worksheet.getRow(nextRowNumber);

    // Set alignment untuk semua cell
    newRow.alignment = { vertical: "middle", wrapText: true };

    // Alternate row color (abu-abu muda)
    if (nextNo % 2 === 0) {
      for (let col = 1; col <= 7; col++) {
        worksheet.getCell(nextRowNumber, col).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF2F2F2" },
        };
      }
    }

    // Status column color (kuning untuk pending)
    worksheet.getCell(`F${nextRowNumber}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFD966" },
    };
    worksheet.getCell(`F${nextRowNumber}`).font = { bold: true };

    // Save file
    await workbook.xlsx.writeFile(EXCEL_CONFIG.FILE_PATH);

    console.log(`✅ Data berhasil disimpan ke Excel!`);
    console.log(`   Row: ${nextRowNumber}`);
    console.log(`   Ticket: #${nextNo}`);

    return { success: true, rowNumber: nextNo };
  } catch (error) {
    console.error("❌ Error saving to Excel:", error.message);
    console.error("❌ Stack trace:", error.stack);
    return { success: false, error: error.message };
  }
}

/**
 * Get statistik dari Excel
 */

/**
 * AUTO BACKUP EXCEL FILE
 */
async function autoBackupExcel() {
  if (!EXCEL_CONFIG.AUTO_BACKUP) return;

  const backupFolder = "./backup";
  if (!fs.existsSync(backupFolder)) fs.mkdirSync(backupFolder);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = `${backupFolder}/backup_${timestamp}.xlsx`;

  try {
    if (fs.existsSync(EXCEL_CONFIG.FILE_PATH)) {
      fs.copyFileSync(EXCEL_CONFIG.FILE_PATH, backupFile);
      console.log(`🗂️ Backup dibuat: ${backupFile}`);

      // Upload ke Cloud Storage setiap backup
      await uploadToCloudStorage(
        EXCEL_CONFIG.FILE_PATH,
        `backup_${timestamp}.xlsx`
      );
    } else {
      console.log("⚠️ File Excel belum ada, belum bisa backup.");
    }
  } catch (error) {
    console.error("❌ Gagal membuat backup:", error.message);
  }
}

async function uploadToCloudStorage(filePath, fileName) {
  if (!EXCEL_CONFIG.USE_CLOUD_STORAGE) return;

  try {
    const fileData = fs.readFileSync(filePath);

    const params = {
      Bucket: EXCEL_CONFIG.CLOUD_BUCKET,
      Key: `backups/${fileName}`,
      Body: fileData,
      ContentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    const result = await s3.upload(params).promise();

    console.log(`☁️ File diupload ke Cloud Storage: ${result.Location}`);
    return result.Location;
  } catch (error) {
    console.error("❌ Gagal upload ke cloud storage:", error.message);
  }
}

async function getStatistik() {
  try {
    if (!fs.existsSync(EXCEL_CONFIG.FILE_PATH)) {
      return { total: 0, pending: 0, resolved: 0 };
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_CONFIG.FILE_PATH);
    const worksheet = workbook.getWorksheet(EXCEL_CONFIG.SHEET_NAME);

    let total = 0;
    let pending = 0;
    let resolved = 0;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        // Skip header
        total++;
        const status = row.getCell(6).value; // Kolom F
        if (status === "Pending") pending++;
        if (status === "Resolved") resolved++;
      }
    });

    return { total, pending, resolved };
  } catch (error) {
    console.error("Error getting stats:", error.message);
    return { total: 0, pending: 0, resolved: 0 };
  }
}

// ===== BOT FUNCTIONS =====

function getUserSession(userId) {
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      state: SESSION_STATE.IDLE,
      data: {},
    });
  }
  return userSessions.get(userId);
}

function updateSession(userId, updates) {
  const session = getUserSession(userId);
  Object.assign(session, updates);
  userSessions.set(userId, session);
}

function clearSession(userId) {
  userSessions.delete(userId);
}

async function sendWelcomeMessage(message) {
  const welcomeMsg =
    `👋 *Selamat Datang di Layanan Aduan*\n\n` +
    `Silakan pilih kategori aplikasi yang ingin Anda adukan dengan mengetik *nomor* pilihannya:\n\n` +
    APLIKASI_LIST.map((app) => `${app.emoji} *${app.id}.* ${app.nama}`).join(
      "\n"
    ) +
    `\n\n_Contoh: Ketik *1* untuk Mobile Banking_`;

  await message.reply(welcomeMsg);
  updateSession(message.from, { state: SESSION_STATE.WAITING_APP_CHOICE });
}

async function handleAppChoice(message, choice) {
  const appIndex = parseInt(choice);

  if (isNaN(appIndex) || appIndex < 1 || appIndex > APLIKASI_LIST.length) {
    await message.reply(
      "❌ Pilihan tidak valid. Silakan pilih nomor 1-" + APLIKASI_LIST.length
    );
    return;
  }

  const selectedApp = APLIKASI_LIST[appIndex - 1];

  updateSession(message.from, {
    state: SESSION_STATE.WAITING_NAME,
    data: { aplikasi: selectedApp.nama },
  });

  const msg =
    `${selectedApp.emoji} *${selectedApp.nama}* dipilih\n\n` +
    `📝 *Format Aduan:*\n\n` +
    `Silakan masukkan *nama lengkap* Anda:`;

  await message.reply(msg);
}

async function handleNameInput(message, name) {
  if (name.length < 3) {
    await message.reply(
      "❌ Nama terlalu pendek. Minimal 3 karakter. Silakan coba lagi:"
    );
    return;
  }

  const session = getUserSession(message.from);
  session.data.nama = name;
  session.data.nomorHP = message.from.replace("@c.us", "");

  updateSession(message.from, {
    state: SESSION_STATE.WAITING_COMPLAINT,
    data: session.data,
  });

  const msg =
    `✅ Nama: *${name}*\n\n` +
    `Sekarang, silakan tulis *aduan* Anda secara detail:\n\n` +
    `_Contoh: Aplikasi sering error saat login, sudah coba reinstall tapi masih bermasalah_`;

  await message.reply(msg);
}

async function handleComplaintInput(message, complaint) {
  if (complaint.length < 10) {
    await message.reply(
      "❌ Aduan terlalu singkat. Minimal 10 karakter. Silakan jelaskan lebih detail:"
    );
    return;
  }

  const session = getUserSession(message.from);
  session.data.aduan = complaint;

  updateSession(message.from, {
    state: SESSION_STATE.CONFIRMING,
    data: session.data,
  });

  const summaryMsg =
    `📋 *Ringkasan Aduan Anda:*\n\n` +
    `📱 *Aplikasi:* ${session.data.aplikasi}\n` +
    `👤 *Nama:* ${session.data.nama}\n` +
    `📞 *No. HP:* ${session.data.nomorHP}\n` +
    `📝 *Aduan:*\n${session.data.aduan}\n\n` +
    `Apakah data sudah benar?\n\n` +
    `Ketik *YA* untuk submit\n` +
    `Ketik *TIDAK* untuk mengulang`;

  await message.reply(summaryMsg);
}

async function handleConfirmation(message, response) {
  const answer = response.toLowerCase().trim();

  if (answer === "ya" || answer === "yes" || answer === "y") {
    const session = getUserSession(message.from);

    await message.reply("⏳ Memproses aduan Anda...");

    const result = await saveToExcel(session.data);

    if (result.success) {
      const successMsg =
        `✅ *Aduan Berhasil Dikirim!*\n\n` +
        `📋 Nomor Tiket: *#${result.rowNumber}*\n` +
        `📅 Tanggal: ${new Date().toLocaleDateString("id-ID")}\n` +
        `📂 Tersimpan di: ${EXCEL_CONFIG.FILE_PATH}\n\n` +
        `Aduan Anda telah kami terima dan akan segera ditindaklanjuti.\n\n` +
        `Terima kasih telah menggunakan layanan kami! 🙏\n\n` +
        `_Ketik *ADUAN* untuk membuat aduan baru_`;

      await message.reply(successMsg);
    } else {
      await message.reply(
        `❌ *Gagal menyimpan aduan*\n\nError: ${result.error}\n\nSilakan coba lagi atau hubungi admin.`
      );
    }

    clearSession(message.from);
  } else if (answer === "tidak" || answer === "no" || answer === "n") {
    clearSession(message.from);
    await message.reply(
      "🔄 Aduan dibatalkan.\n\nKetik *ADUAN* untuk memulai dari awal."
    );
  } else {
    await message.reply(
      "❌ Jawaban tidak valid.\n\nKetik *YA* untuk submit atau *TIDAK* untuk mengulang."
    );
  }
}

// ===== MESSAGE HANDLER =====
client.on("message", async (message) => {
  try {
    const chat = await message.getChat();
    if (chat.isGroup) return;
    if (message.fromMe) return;

    const userInput = message.body.trim();
    const session = getUserSession(message.from);

    console.log(
      `\n📨 [${session.state}] Message from ${
        message.from
      }: ${userInput.substring(0, 50)}`
    );

    switch (session.state) {
      case SESSION_STATE.IDLE:
        if (
          userInput.toLowerCase().includes("aduan") ||
          userInput.toLowerCase() === "/start" ||
          userInput.toLowerCase() === "halo" ||
          userInput.toLowerCase() === "hi" ||
          userInput.toLowerCase() === "hello"
        ) {
          await sendWelcomeMessage(message);
        } else {
          await sendWelcomeMessage(message);
        }
        break;

      case SESSION_STATE.WAITING_APP_CHOICE:
        await handleAppChoice(message, userInput);
        break;

      case SESSION_STATE.WAITING_NAME:
        await handleNameInput(message, userInput);
        break;

      case SESSION_STATE.WAITING_COMPLAINT:
        await handleComplaintInput(message, userInput);
        break;

      case SESSION_STATE.CONFIRMING:
        await handleConfirmation(message, userInput);
        break;

      default:
        await sendWelcomeMessage(message);
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
    await message.reply(
      "❌ Terjadi kesalahan. Silakan coba lagi atau ketik *ADUAN* untuk memulai."
    );
    clearSession(message.from);
  }
});

// ===== ADMIN COMMANDS =====
client.on("message", async (message) => {
  const chat = await message.getChat();
  if (chat.isGroup) return;

  const text = message.body.toLowerCase().trim();

  if (text === "/reset" || text === "reset") {
    clearSession(message.from);
    await message.reply("✅ Session direset. Ketik *ADUAN* untuk memulai.");
  }

  if (text === "/help" || text === "help" || text === "bantuan") {
    const helpMsg =
      `🤖 *Complaint Bot - Panduan*\n\n` +
      `*Cara Menggunakan:*\n` +
      `1️⃣ Ketik *ADUAN* untuk memulai\n` +
      `2️⃣ Pilih kategori aplikasi (1-${APLIKASI_LIST.length})\n` +
      `3️⃣ Masukkan nama lengkap\n` +
      `4️⃣ Tulis aduan Anda\n` +
      `5️⃣ Konfirmasi dengan *YA*\n\n` +
      `*Commands:*\n` +
      `• ADUAN - Mulai aduan baru\n` +
      `• RESET - Reset session\n` +
      `• HELP - Tampilkan panduan\n` +
      `• STATS - Lihat statistik aduan\n\n` +
      `_Bot ini aktif 24/7 untuk melayani aduan Anda_`;

    await message.reply(helpMsg);
  }

  if (text === "/stats" || text === "stats") {
    const stats = await getStatistik();
    const statsMsg =
      `📊 *Statistik Aduan*\n\n` +
      `📋 Total Aduan: ${stats.total}\n` +
      `⏳ Pending: ${stats.pending}\n` +
      `✅ Resolved: ${stats.resolved}\n\n` +
      `📂 File: ${EXCEL_CONFIG.FILE_PATH}`;

    await message.reply(statsMsg);
  }

  if (text === "/status") {
    const session = getUserSession(message.from);
    const statusMsg =
      `📊 *Session Status*\n\n` +
      `State: ${session.state}\n` +
      `Data: ${JSON.stringify(session.data, null, 2)}`;
    await message.reply(statusMsg);
  }
});

// ===== ERROR HANDLER =====
client.on("disconnected", (reason) => {
  console.log("⚠️ Client was disconnected:", reason);
});

process.on("unhandledRejection", (error) => {
  console.error("❌ Unhandled promise rejection:", error);
});

// ===== START BOT =====
client.initialize();

console.log("🤖 WhatsApp Complaint Bot starting...");
console.log("📋 Configuration:");
console.log(`   - Excel File: ${EXCEL_CONFIG.FILE_PATH}`);
console.log(`   - Sheet Name: ${EXCEL_CONFIG.SHEET_NAME}`);
console.log(`   - Available categories: ${APLIKASI_LIST.length}`);
