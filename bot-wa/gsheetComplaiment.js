const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ===== KONFIGURASI GOOGLE SHEETS =====
const GOOGLE_SHEETS_CONFIG = {
    SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID', // Ganti dengan ID spreadsheet kamu
    CLIENT_EMAIL: 'YOUR_SERVICE_ACCOUNT_EMAIL', // Email service account
    PRIVATE_KEY: 'YOUR_PRIVATE_KEY', // Private key service account
    SHEET_NAME: 'Aduan' // Nama sheet
};

// ===== DAFTAR APLIKASI YANG BISA DIADUKAN =====
const APLIKASI_LIST = [
    { id: 1, nama: 'Mobile Banking', emoji: '🏦' },
    { id: 2, nama: 'E-Commerce', emoji: '🛒' },
    { id: 3, nama: 'Social Media', emoji: '📱' },
    { id: 4, nama: 'Streaming', emoji: '🎬' },
    { id: 5, nama: 'Game', emoji: '🎮' },
    { id: 6, nama: 'Transportasi Online', emoji: '🚗' },
    { id: 7, nama: 'Delivery Food', emoji: '🍔' },
    { id: 8, nama: 'Lainnya', emoji: '📝' }
];

// ===== SESSION MANAGEMENT =====
// Tracking user session untuk multi-step conversation
const userSessions = new Map();

// Session states
const SESSION_STATE = {
    IDLE: 'idle',
    WAITING_APP_CHOICE: 'waiting_app_choice',
    WAITING_NAME: 'waiting_name',
    WAITING_COMPLAINT: 'waiting_complaint',
    CONFIRMING: 'confirming'
};

// ===== CLIENT SETUP =====
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'complaint-bot' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('📱 Scan QR code ini untuk Complaint Bot:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('✅ Complaint Bot siap menerima aduan!');
    console.log(`📋 ${APLIKASI_LIST.length} kategori aplikasi tersedia`);
});

// ===== GOOGLE SHEETS FUNCTIONS =====

/**
 * Inisialisasi Google Sheets
 */
async function initGoogleSheets() {
    try {
        const serviceAccountAuth = new JWT({
            email: GOOGLE_SHEETS_CONFIG.CLIENT_EMAIL,
            key: GOOGLE_SHEETS_CONFIG.PRIVATE_KEY.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const doc = new GoogleSpreadsheet(GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID, serviceAccountAuth);
        await doc.loadInfo();
        
        console.log('✅ Google Sheets connected:', doc.title);
        return doc;
    } catch (error) {
        console.error('❌ Error connecting to Google Sheets:', error.message);
        return null;
    }
}

/**
 * Simpan aduan ke Google Sheets
 */
async function saveToGoogleSheets(data) {
    try {
        const doc = await initGoogleSheets();
        if (!doc) throw new Error('Failed to connect to Google Sheets');

        // Cari atau buat sheet
        let sheet = doc.sheetsByTitle[GOOGLE_SHEETS_CONFIG.SHEET_NAME];
        if (!sheet) {
            sheet = await doc.addSheet({ 
                title: GOOGLE_SHEETS_CONFIG.SHEET_NAME,
                headerValues: ['No', 'Aplikasi', 'Nama', 'No. HP', 'Aduan', 'Status', 'Request Date']
            });
        }

        // Load existing rows
        await sheet.loadCells();

        // Cari baris kosong pertama
        const rows = await sheet.getRows();
        const nextRow = rows.length + 2; // +2 karena header di row 1

        // Format tanggal
        const requestDate = new Date().toLocaleString('id-ID', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        // Tambah data ke row baru
        await sheet.addRow({
            'No': nextRow - 1,
            'Aplikasi': data.aplikasi,
            'Nama': data.nama,
            'No. HP': data.nomorHP,
            'Aduan': data.aduan,
            'Status': 'Pending',
            'Request Date': requestDate
        });

        console.log(`✅ Data saved to Google Sheets (Row ${nextRow})`);
        return { success: true, rowNumber: nextRow - 1 };

    } catch (error) {
        console.error('❌ Error saving to Google Sheets:', error.message);
        return { success: false, error: error.message };
    }
}

// ===== BOT FUNCTIONS =====

/**
 * Get atau create user session
 */
function getUserSession(userId) {
    if (!userSessions.has(userId)) {
        userSessions.set(userId, {
            state: SESSION_STATE.IDLE,
            data: {}
        });
    }
    return userSessions.get(userId);
}

/**
 * Update user session
 */
function updateSession(userId, updates) {
    const session = getUserSession(userId);
    Object.assign(session, updates);
    userSessions.set(userId, session);
}

/**
 * Clear user session
 */
function clearSession(userId) {
    userSessions.delete(userId);
}

/**
 * Kirim pesan welcome dan daftar aplikasi
 */
async function sendWelcomeMessage(message) {
    const welcomeMsg = `👋 *Selamat Datang di Layanan Aduan*\n\n` +
        `Silakan pilih kategori aplikasi yang ingin Anda adukan dengan mengetik *nomor* pilihannya:\n\n` +
        APLIKASI_LIST.map(app => `${app.emoji} *${app.id}.* ${app.nama}`).join('\n') +
        `\n\n_Contoh: Ketik *1* untuk Mobile Banking_`;

    await message.reply(welcomeMsg);
    updateSession(message.from, { state: SESSION_STATE.WAITING_APP_CHOICE });
}

/**
 * Handle pilihan aplikasi
 */
async function handleAppChoice(message, choice) {
    const appIndex = parseInt(choice);
    
    if (isNaN(appIndex) || appIndex < 1 || appIndex > APLIKASI_LIST.length) {
        await message.reply('❌ Pilihan tidak valid. Silakan pilih nomor 1-' + APLIKASI_LIST.length);
        return;
    }

    const selectedApp = APLIKASI_LIST[appIndex - 1];
    
    updateSession(message.from, {
        state: SESSION_STATE.WAITING_NAME,
        data: { aplikasi: selectedApp.nama }
    });

    const msg = `${selectedApp.emoji} *${selectedApp.nama}* dipilih\n\n` +
        `📝 *Format Aduan:*\n\n` +
        `Silakan masukkan *nama lengkap* Anda:`;

    await message.reply(msg);
}

/**
 * Handle input nama
 */
async function handleNameInput(message, name) {
    if (name.length < 3) {
        await message.reply('❌ Nama terlalu pendek. Minimal 3 karakter. Silakan coba lagi:');
        return;
    }

    const session = getUserSession(message.from);
    session.data.nama = name;
    session.data.nomorHP = message.from.replace('@c.us', '');
    
    updateSession(message.from, {
        state: SESSION_STATE.WAITING_COMPLAINT,
        data: session.data
    });

    const msg = `✅ Nama: *${name}*\n\n` +
        `Sekarang, silakan tulis *aduan* Anda secara detail:\n\n` +
        `_Contoh: Aplikasi sering error saat login, sudah coba reinstall tapi masih bermasalah_`;

    await message.reply(msg);
}

/**
 * Handle input aduan
 */
async function handleComplaintInput(message, complaint) {
    if (complaint.length < 10) {
        await message.reply('❌ Aduan terlalu singkat. Minimal 10 karakter. Silakan jelaskan lebih detail:');
        return;
    }

    const session = getUserSession(message.from);
    session.data.aduan = complaint;
    
    updateSession(message.from, {
        state: SESSION_STATE.CONFIRMING,
        data: session.data
    });

    // Tampilkan ringkasan untuk konfirmasi
    const summaryMsg = `📋 *Ringkasan Aduan Anda:*\n\n` +
        `📱 *Aplikasi:* ${session.data.aplikasi}\n` +
        `👤 *Nama:* ${session.data.nama}\n` +
        `📞 *No. HP:* ${session.data.nomorHP}\n` +
        `📝 *Aduan:*\n${session.data.aduan}\n\n` +
        `Apakah data sudah benar?\n\n` +
        `Ketik *YA* untuk submit\n` +
        `Ketik *TIDAK* untuk mengulang`;

    await message.reply(summaryMsg);
}

/**
 * Handle konfirmasi
 */
async function handleConfirmation(message, response) {
    const answer = response.toLowerCase().trim();
    
    if (answer === 'ya' || answer === 'yes' || answer === 'y') {
        const session = getUserSession(message.from);
        
        // Kirim "processing" message
        await message.reply('⏳ Memproses aduan Anda...');

        // Simpan ke Google Sheets
        const result = await saveToGoogleSheets(session.data);

        if (result.success) {
            const successMsg = `✅ *Aduan Berhasil Dikirim!*\n\n` +
                `📋 Nomor Tiket: *#${result.rowNumber}*\n` +
                `📅 Tanggal: ${new Date().toLocaleDateString('id-ID')}\n\n` +
                `Aduan Anda telah kami terima dan akan segera ditindaklanjuti.\n\n` +
                `Terima kasih telah menggunakan layanan kami! 🙏\n\n` +
                `_Ketik *ADUAN* untuk membuat aduan baru_`;
            
            await message.reply(successMsg);
        } else {
            await message.reply(`❌ *Gagal menyimpan aduan*\n\nError: ${result.error}\n\nSilakan coba lagi atau hubungi admin.`);
        }

        // Clear session
        clearSession(message.from);

    } else if (answer === 'tidak' || answer === 'no' || answer === 'n') {
        clearSession(message.from);
        await message.reply('🔄 Aduan dibatalkan.\n\nKetik *ADUAN* untuk memulai dari awal.');
    } else {
        await message.reply('❌ Jawaban tidak valid.\n\nKetik *YA* untuk submit atau *TIDAK* untuk mengulang.');
    }
}

// ===== MESSAGE HANDLER =====
client.on('message', async (message) => {
    try {
        // Hanya proses personal chat (bukan grup)
        const chat = await message.getChat();
        if (chat.isGroup) return;

        // Skip pesan dari bot sendiri
        if (message.fromMe) return;

        const userInput = message.body.trim();
        const session = getUserSession(message.from);

        console.log(`\n📨 [${session.state}] Message from ${message.from}: ${userInput.substring(0, 50)}`);

        // State machine untuk handle conversation flow
        switch (session.state) {
            case SESSION_STATE.IDLE:
                // Trigger: kata kunci "aduan" atau command "/start"
                if (userInput.toLowerCase().includes('aduan') || 
                    userInput.toLowerCase() === '/start' ||
                    userInput.toLowerCase() === 'halo' ||
                    userInput.toLowerCase() === 'hi' ||
                    userInput.toLowerCase() === 'hello') {
                    await sendWelcomeMessage(message);
                } else {
                    // Auto trigger welcome untuk user baru
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
        console.error('❌ Error handling message:', error);
        await message.reply('❌ Terjadi kesalahan. Silakan coba lagi atau ketik *ADUAN* untuk memulai.');
        clearSession(message.from);
    }
});

// ===== ADMIN COMMANDS (opsional) =====
client.on('message', async (message) => {
    const chat = await message.getChat();
    if (chat.isGroup) return;

    const text = message.body.toLowerCase().trim();

    // Command: Reset session
    if (text === '/reset' || text === 'reset') {
        clearSession(message.from);
        await message.reply('✅ Session direset. Ketik *ADUAN* untuk memulai.');
    }

    // Command: Help
    if (text === '/help' || text === 'help' || text === 'bantuan') {
        const helpMsg = `🤖 *Complaint Bot - Panduan*\n\n` +
            `*Cara Menggunakan:*\n` +
            `1️⃣ Ketik *ADUAN* untuk memulai\n` +
            `2️⃣ Pilih kategori aplikasi (1-${APLIKASI_LIST.length})\n` +
            `3️⃣ Masukkan nama lengkap\n` +
            `4️⃣ Tulis aduan Anda\n` +
            `5️⃣ Konfirmasi dengan *YA*\n\n` +
            `*Commands:*\n` +
            `• ADUAN - Mulai aduan baru\n` +
            `• RESET - Reset session\n` +
            `• HELP - Tampilkan panduan\n\n` +
            `_Bot ini aktif 24/7 untuk melayani aduan Anda_`;
        
        await message.reply(helpMsg);
    }

    // Command: Status (untuk cek session)
    if (text === '/status') {
        const session = getUserSession(message.from);
        const statusMsg = `📊 *Session Status*\n\n` +
            `State: ${session.state}\n` +
            `Data: ${JSON.stringify(session.data, null, 2)}`;
        await message.reply(statusMsg);
    }
});

// ===== ERROR HANDLER =====
client.on('disconnected', (reason) => {
    console.log('⚠️ Client was disconnected:', reason);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

// ===== START BOT =====
client.initialize();

console.log('🤖 WhatsApp Complaint Bot starting...');
console.log('📋 Configuration:');
console.log(`   - Spreadsheet ID: ${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}`);
console.log(`   - Sheet Name: ${GOOGLE_SHEETS_CONFIG.SHEET_NAME}`);
console.log(`   - Available categories: ${APLIKASI_LIST.length}`);