const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const waController = require('./controllers/waControllers');

// ========================
// CLEANUP FUNCTION
// ========================
const cleanupAuth = () => {
    const authPath = path.join(__dirname, '.wwebjs_auth');
    const cachePath = path.join(__dirname, '.wwebjs_cache');
    
    try {
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log('🗑️ Folder .wwebjs_auth dihapus');
        }
        if (fs.existsSync(cachePath)) {
            fs.rmSync(cachePath, { recursive: true, force: true });
            console.log('🗑️ Folder .wwebjs_cache dihapus');
        }
    } catch (err) {
        console.log('⚠️ Error cleanup:', err.message);
    }
};

// Cleanup saat startup
cleanupAuth();

// ========================
// CLIENT CONFIGURATION (MINIMAL & STABLE)
// ========================
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'wa-commerce-bot'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ],
        timeout: 120000  // 2 menit timeout
    },
    restartOnCrash: true,
    takeoverOnConflict: true,
    qrMaxRetries: 5
});

// ========================
// STATE TRACKING
// ========================
let isAuthenticated = false;
let qrDisplayed = false;
let disconnectCount = 0;

// ========================
// EVENT HANDLERS
// ========================

client.on('qr', (qr) => {
    disconnectCount = 0; // Reset counter saat dapat QR baru
    
    if (!qrDisplayed) {
        console.log('\n========================================');
        console.log('📱 SCAN QR CODE DENGAN WHATSAPP ANDA 👇');
        console.log('========================================\n');
        qrcode.generate(qr, { small: true });
        console.log('⏳ Tunggu hingga terkoneksi (30-60 detik)...\n');
        qrDisplayed = true;
    }
});

client.on('authenticated', (session) => {
    console.log('✅ Session berhasil di-authenticate!');
    console.log('💾 Session disimpan secara lokal...');
    isAuthenticated = true;
    qrDisplayed = false;
});

client.on('auth_failure', (msg) => {
    console.error('❌ Authentication gagal:', msg);
    isAuthenticated = false;
    qrDisplayed = false;
});

client.on('ready', () => {
    console.log('\n========================================');
    console.log('✅ WhatsApp Bot siap digunakan!');
    console.log('========================================\n');
    isAuthenticated = true;
    disconnectCount = 0;
});

client.on('disconnected', (reason) => {
    console.log('\n⚠️ Bot disconnected!');
    console.log('Reason:', reason);
    console.log('Disconnect count:', disconnectCount + 1);
    
    isAuthenticated = false;
    disconnectCount++;
    
    // Jika disconnect lebih dari 3x, cleanup dan exit
    if (disconnectCount > 3) {
        console.log('\n🛑 Disconnect berulang kali, cleaning up...');
        cleanupAuth();
        console.log('❌ Bot stop. Jalankan lagi: node app.js');
        process.exit(1);
    }
});

// ========================
// MESSAGE HANDLER
// ========================
client.on('message_create', async (message) => {
    try {
        if (message.fromMe) return;

        const chat = await message.getChat();
        if (chat.isGroup) return;

        console.log(`📨 [${new Date().toLocaleTimeString()}] Pesan dari ${message.from}: ${message.body}`);

        if (!client.info) {
            console.error('❌ ERROR: Client tidak connected!');
            return;
        }

        await waController.handleMessage(client, message);
        console.log('✅ Message handled successfully\n');

    } catch (error) {
        console.error('❌ Error in message handler:', error.message);
        try {
            await message.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
        } catch (replyError) {
            console.error('❌ Error sending reply:', replyError.message);
        }
    }
});

client.on('message', async (message) => {
    try {
        if (message.fromMe) return;

        const chat = await message.getChat();
        if (chat.isGroup) return;

        if (!message.fromMe) {
            console.log(`📨 [Fallback] Pesan dari ${message.from}: ${message.body}`);
            await waController.handleMessage(client, message);
        }

    } catch (error) {
        console.error('❌ Error in fallback message handler:', error.message);
    }
});

// ========================
// ERROR HANDLING
// ========================
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

// ========================
// GRACEFUL SHUTDOWN
// ========================
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);

    try {
        // Jangan logout, langsung destroy
        console.log('🔌 Destroying client...');
        await client.destroy().catch(() => {});

        console.log('✅ Bot shutdown complete');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during shutdown:', err.message);
        process.exit(1);
    }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ========================
// INITIALIZE CLIENT
// ========================
console.log('🚀 Memulai WhatsApp Bot...');
console.log('📝 Tips: Jika disconnect berulang, pastikan:');
console.log('   1. Update WhatsApp di phone ke versi terbaru');
console.log('   2. Jangan buka WhatsApp di browser/device lain saat bot aktif');
console.log('   3. Pastikan internet stabil\n');

client.initialize().catch(err => {
    console.error('❌ Failed to initialize client:', err.message);
    console.log('\n🔍 Debugging:');
    console.log('   - Cek folder .wwebjs_auth ada atau tidak');
    console.log('   - Coba update whatsapp-web.js: npm update whatsapp-web.js');
    process.exit(1);
});

module.exports = client;