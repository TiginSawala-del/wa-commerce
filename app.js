const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const express = require('express');
const waController = require('./controllers/waControllers');

// ========================
// EXPRESS SETUP
// ========================
const app = express();
app.use(express.json());

// ========================
// STATE TRACKING
// ========================
let isAuthenticated = false;
let qrDisplayed = false;
let disconnectCount = 0;
let currentQR = null;

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
// CLIENT CONFIGURATION
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
        timeout: 120000
    },
    restartOnCrash: true,
    takeoverOnConflict: true,
    qrMaxRetries: 5
});

// ========================
// EVENT HANDLERS
// ========================

client.on('qr', (qr) => {
    disconnectCount = 0;
    currentQR = qr; // Simpan QR Code
    
    if (!qrDisplayed) {
        console.log('\n========================================');
        console.log('📱 SCAN QR CODE DENGAN WHATSAPP ANDA 👇');
        console.log('========================================\n');
        qrcode.generate(qr, { small: true });
        
        // Save QR ke file PNG dengan async handling
        QRCode.toFile(
            path.join(__dirname, 'wa_qr_latest.png'),
            qr,
            { 
                errorCorrectionLevel: 'M',
                type: 'image/png',
                width: 400,
                margin: 2
            },
            (err) => {
                if (err) {
                    console.error('❌ Error saving QR:', err.message);
                } else {
                    console.log('✅ QR Code PNG saved successfully');
                    console.log('📡 Access via: http://localhost:3000/api/wa/qr');
                    console.log('🔗 Atau buka: http://localhost:3000/scan');
                }
            }
        );
        
        console.log('⏳ Tunggu hingga terkoneksi (30-60 detik)...\n');
        qrDisplayed = true;
    }
});

client.on('authenticated', (session) => {
    console.log('✅ Session berhasil di-authenticate!');
    console.log('💾 Session disimpan secara lokal...');
    isAuthenticated = true;
    qrDisplayed = false;
    currentQR = null;
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
// API ENDPOINTS
// ========================
// Endpoint untuk check status QR
app.get('/api/wa/status', (req, res) => {
    res.json({
        success: true,
        authenticated: isAuthenticated,
        qrAvailable: currentQR !== null,
        status: isAuthenticated ? 'connected' : (currentQR ? 'waiting_scan' : 'generating')
    });
});

// Endpoint untuk reset + wait QR
app.get('/api/wa/qr/reset', async (req, res) => {
    try {
        const authPath = path.join(__dirname, '.wwebjs_auth');
        const cachePath = path.join(__dirname, '.wwebjs_cache');
        
        console.log('🔄 Starting WhatsApp reset...');
        
        // Reset state
        isAuthenticated = false;
        qrDisplayed = false;
        currentQR = null;
        
        // Logout dulu
        if (client && client.info) {
            try {
                console.log('📴 Logging out...');
                await client.logout();
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
                console.warn('⚠️ Logout error:', err.message);
            }
        }
        
        // Destroy client
        if (client) {
            try {
                console.log('🔌 Destroying client...');
                await client.destroy();
                await new Promise(resolve => setTimeout(resolve, 3000));
            } catch (err) {
                console.warn('⚠️ Destroy error:', err.message);
            }
        }
        
        // Delete auth folder
        if (fs.existsSync(authPath)) {
            try {
                fs.rmSync(authPath, { recursive: true, force: true });
                console.log('🗑️ Folder .wwebjs_auth dihapus');
            } catch (err) {
                console.error('❌ Error deleting auth:', err.message);
            }
        }
        
        // Delete cache folder
        if (fs.existsSync(cachePath)) {
            try {
                fs.rmSync(cachePath, { recursive: true, force: true });
                console.log('🗑️ Folder .wwebjs_cache dihapus');
            } catch (err) {
                console.error('❌ Error deleting cache:', err.message);
            }
        }
        
        // Wait untuk process fully close
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Reinitialize client
        console.log('🚀 Reinitializing client...');
        client.initialize().catch(err => {
            console.error('❌ Error reinitializing client:', err.message);
        });
        
        // Poll untuk QR sampai tersedia (max 30 detik)
        let qrReady = false;
        const maxAttempts = 30;
        let attempts = 0;
        
        const checkQR = setInterval(() => {
            attempts++;
            
            if (currentQR) {
                clearInterval(checkQR);
                qrReady = true;
                console.log('✅ QR Code ready!');
                
                res.json({
                    success: true,
                    message: 'WhatsApp bot reset. QR Code generated.',
                    status: 'qr_ready',
                    qrUrl: '/api/wa/qr',
                    attempts: attempts
                });
            } else if (attempts >= maxAttempts) {
                clearInterval(checkQR);
                console.warn('⚠️ QR timeout after 30 seconds');
                
                if (!res.headersSent) {
                    res.json({
                        success: false,
                        message: 'QR Code generation timeout. Try again in a moment.',
                        status: 'timeout',
                        attempts: attempts
                    });
                }
            }
        }, 1000);
        
    } catch (error) {
        console.error('❌ Reset error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Endpoint untuk get QR (hanya serve, ga delete)
app.get('/api/wa/qr', (req, res) => {
    try {
        const qrPath = path.join(__dirname, 'wa_qr_latest.png');
        
        if (!fs.existsSync(qrPath)) {
            return res.status(400).json({
                success: false,
                message: 'QR Code not available yet',
                status: isAuthenticated ? 'authenticated' : 'pending'
            });
        }

        // Serve PNG file dengan cache busting
        res.type('image/png');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(qrPath);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});
// Get QR Code as JSON (for debugging)
app.get('/api/wa/qr/json', (req, res) => {
    try {
        if (!currentQR) {
            return res.status(400).json({
                success: false,
                message: 'QR Code not available',
                status: isAuthenticated ? 'authenticated' : 'pending'
            });
        }

        QRCode.toDataURL(currentQR, (err, url) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: 'Error generating QR Code'
                });
            }

            res.json({
                success: true,
                qr: url,
                message: 'QR Code as base64'
            });
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        waStatus: isAuthenticated ? 'connected' : 'disconnected'
    });
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
// START SERVER
// ========================
const PORT = process.env.PORT || 3000;

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

// Start Express server
app.listen(PORT, () => {
    console.log(`\n📡 API Server running on http://localhost:${PORT}`);
    console.log(`📊 Status: http://localhost:${PORT}/health`);
    console.log(`📱 QR Code: http://localhost:${PORT}/api/wa/qr\n`);
});

module.exports = client;