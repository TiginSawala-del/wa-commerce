const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const waController = require('./controllers/waControllers');

// ========================
// CLEANUP & INITIALIZATION
// ========================
const authPath = path.join(__dirname, '.wwebjs_auth');

// Bersihkan session yang corrupt saat startup
const initializeAuth = async () => {
    if (fs.existsSync(authPath)) {
        try {
            const sessionPath = path.join(authPath, 'session');
            // Cek apakah session file ada
            if (!fs.existsSync(sessionPath)) {
                console.log('⚠️ Session file tidak lengkap, membersihkan...');
                fs.rmSync(authPath, { recursive: true, force: true });
            }
        } catch (err) {
            console.log('⚠️ Error checking session:', err.message);
        }
    }
};

// Jalankan cleanup
initializeAuth();

// ========================
// CLIENT CONFIGURATION
// ========================
const client = new Client({
    authStrategy: new LocalAuth({
        // ⭐ Tambahkan ini untuk debugging
        clientId: 'wa-commerce-bot'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',  // ⭐ PENTING untuk fix memory issue
            '--disable-gpu'
        ],
        timeout: 60000  // Timeout 60 detik
    }
});

// ========================
// EVENT HANDLERS
// ========================

// Track apakah sudah authenticated
let isAuthenticated = false;
let qrDisplayed = false;

client.on('qr', (qr) => {
    // Hanya tampilkan QR sekali saja
    if (!qrDisplayed) {
        console.log('\n========================================');
        console.log('📱 SCAN QR CODE DENGAN WHATSAPP ANDA 👇');
        console.log('========================================\n');
        qrcode.generate(qr, { small: true });
        console.log('⏳ Tunggu hingga terkoneksi...\n');
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
    console.log('🔄 Silakan scan QR code lagi...');
    qrDisplayed = false;
});

client.on('ready', () => {
    console.log('\n========================================');
    console.log('✅ WhatsApp Bot siap digunakan!');
    console.log('========================================\n');
    isAuthenticated = true;
});

client.on('disconnected', (reason) => {
    console.log('🔴 Bot disconnected:', reason);
    isAuthenticated = false;
    qrDisplayed = false;
    
    // ⭐ Auto-reconnect setelah 5 detik
    console.log('🔄 Mencoba reconnect dalam 5 detik...\n');
    setTimeout(() => {
        client.initialize().catch(err => {
            console.error('❌ Gagal reconnect:', err.message);
        });
    }, 5000);
});

client.on('message', async (msg) => {
    try {
        // ⭐ Ignore message dari bot sendiri
        if (msg.fromMe) {
            return;
        }
        
        console.log(`📨 Pesan dari ${msg.from}: ${msg.body}`);
        await waController.handleMessage(client, msg);
    } catch (error) {
        console.error('❌ Error handling message:', error.message);
        try {
            await msg.reply('Maaf, terjadi kesalahan. Silakan coba lagi.');
        } catch (replyError) {
            console.error('❌ Error sending reply:', replyError.message);
        }
    }
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (isAuthenticated) {
            await client.logout().catch(() => {});
        }
        
        await client.destroy();
        
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
console.log('🚀 Memulai WhatsApp Bot...\n');

client.initialize().catch(err => {
    console.error('❌ Failed to initialize client:', err.message);
    process.exit(1);
});

module.exports = client;