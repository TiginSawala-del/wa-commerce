const mysql = require('mysql2/promise');
require('dotenv').config();

// ========================
// KONFIGURASI DATABASE (dari .env)
// ========================
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wa_commerce',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0
};

// ========================
// STATE MANAGEMENT
// ========================
const userStates = new Map();

// ========================
// KONFIGURASI ADMIN (dari .env)
// ========================
const ADMIN_NUMBER = process.env.ADMIN_NUMBER || '628123456789@c.us';

// ========================
// DATABASE CONNECTION (dengan error handling)
// ========================
const getConnection = async () => {
    try {
        const conn = await mysql.createConnection(dbConfig);
        return conn;
    } catch (error) {
        console.error('❌ Database connection error:', error.message);
        throw error;
    }
};

// ⭐ Helper function untuk safely close connection
const safeCloseConnection = async (conn) => {
    if (!conn) return;
    try {
        await conn.end();
    } catch (err) {
        console.warn('⚠️ Warning saat close connection:', err.message);
    }
};

// ========================
// MAIN HANDLER
// ========================
const handleMessage = async (client, msg) => {
    const sender = msg.from;
    const message = msg.body.trim();
    
    // Cek apakah pengirim adalah admin
    const isAdmin = sender === ADMIN_NUMBER;
    
    // Ambil state user
    let state = userStates.get(sender) || { step: 'menu' };
    
    // Handle command untuk kembali ke menu
    if (message.toLowerCase() === '/start' || message.toLowerCase() === 'menu') {
        state = { step: 'menu' };
        userStates.set(sender, state);
        
        if (isAdmin) {
            await sendAdminMenu(msg);
        } else {
            await sendCustomerMenu(msg);
        }
        return;
    }
    
    // Routing berdasarkan role
    if (isAdmin) {
        await handleAdminFlow(client, msg, state);
    } else {
        await handleCustomerFlow(client, msg, state);
    }
};

// ========================
// MENU FUNCTIONS
// ========================
const sendAdminMenu = async (msg) => {
    const menu = `*🛍️ MENU ADMIN*\n\n` +
                 `Halo Admin! Pilih menu:\n\n` +
                 `1️⃣ Tambah Produk\n` +
                 `2️⃣ Lihat Produk\n` +
                 `3️⃣ Edit Produk\n` +
                 `4️⃣ Hapus Produk\n` +
                 `5️⃣ Lihat Pesanan\n\n` +
                 `━━━━━━━━━━━━━━━━\n` +
                 `Ketik *nomor menu* untuk memilih\n` +
                 `Ketik *menu* untuk kembali`;
    
    await msg.reply(menu);
};

const sendCustomerMenu = async (msg) => {
    const menu = `*🛒 SELAMAT DATANG*\n\n` +
                 `Terima kasih telah menghubungi kami!\n\n` +
                 `Silakan pilih menu:\n\n` +
                 `1️⃣ Lihat Produk\n` +
                 `2️⃣ Pesan Produk\n` +
                 `3️⃣ Cek Pesanan Saya\n\n` +
                 `━━━━━━━━━━━━━━━━\n` +
                 `Ketik *nomor menu* untuk memilih\n` +
                 `Ketik *menu* untuk kembali`;
    
    await msg.reply(menu);
};

// ========================
// ADMIN FLOW HANDLER
// ========================
const handleAdminFlow = async (client, msg, state) => {
    const sender = msg.from;
    const message = msg.body.trim();
    
    switch (state.step) {
        case 'menu':
            if (message === '1') {
                state.step = 'add_product_name';
                userStates.set(sender, state);
                await msg.reply('*➕ TAMBAH PRODUK*\n\nMasukkan nama produk:');
            } else if (message === '2') {
                await showProducts(msg);
            } else if (message === '3') {
                state.step = 'edit_product_select';
                userStates.set(sender, state);
                await showProductsForEdit(msg);
            } else if (message === '4') {
                state.step = 'delete_product_select';
                userStates.set(sender, state);
                await showProductsForDelete(msg);
            } else if (message === '5') {
                await showOrders(msg);
            } else {
                await msg.reply('❌ Menu tidak valid. Ketik *menu* untuk melihat pilihan.');
            }
            break;
            
        case 'add_product_name':
            state.productData = { name: message };
            state.step = 'add_product_price';
            userStates.set(sender, state);
            await msg.reply('💰 Masukkan harga produk (angka saja, tanpa titik/koma):\n\nContoh: 50000');
            break;
            
        case 'add_product_price':
            const price = parseFloat(message);
            if (isNaN(price) || price <= 0) {
                await msg.reply('❌ Harga tidak valid. Masukkan angka yang benar:\n\nContoh: 50000');
                return;
            }
            state.productData.price = price;
            state.step = 'add_product_stock';
            userStates.set(sender, state);
            await msg.reply('📊 Masukkan jumlah stok (angka saja):\n\nContoh: 100');
            break;
            
        case 'add_product_stock':
            const stock = parseInt(message);
            if (isNaN(stock) || stock < 0) {
                await msg.reply('❌ Stok tidak valid. Masukkan angka yang benar:\n\nContoh: 100');
                return;
            }
            state.productData.stock = stock;
            
            try {
                await addProduct(state.productData);
                
                const summary = `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
                              `📦 Nama: ${state.productData.name}\n` +
                              `💰 Harga: Rp ${state.productData.price.toLocaleString('id-ID')}\n` +
                              `📊 Stok: ${state.productData.stock} unit\n\n` +
                              `Ketik *menu* untuk kembali ke menu utama.`;
                
                await msg.reply(summary);
            } catch (err) {
                console.error('❌ Error adding product:', err.message);
                await msg.reply('❌ Gagal menambah produk. Silakan coba lagi.');
            }
            
            state.step = 'menu';
            userStates.set(sender, state);
            break;
            
        case 'edit_product_select':
            const editId = parseInt(message);
            if (isNaN(editId)) {
                await msg.reply('❌ ID produk tidak valid. Masukkan angka ID produk.');
                return;
            }
            
            try {
                const productExists = await checkProductExists(editId);
                if (!productExists) {
                    await msg.reply('❌ Produk dengan ID tersebut tidak ditemukan.\n\nKetik *menu* untuk kembali.');
                    state.step = 'menu';
                    userStates.set(sender, state);
                    return;
                }
                
                state.editProductId = editId;
                state.step = 'edit_product_field';
                userStates.set(sender, state);
                
                const editMenu = `*✏️ EDIT PRODUK ID: ${editId}*\n\n` +
                               `Pilih yang ingin diubah:\n\n` +
                               `1️⃣ Nama Produk\n` +
                               `2️⃣ Harga\n` +
                               `3️⃣ Stok\n\n` +
                               `Ketik nomor pilihan:`;
                
                await msg.reply(editMenu);
            } catch (err) {
                console.error('❌ Error checking product:', err.message);
                await msg.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
            }
            break;
            
        case 'edit_product_field':
            if (message === '1') {
                state.editField = 'name';
                state.step = 'edit_product_value';
                userStates.set(sender, state);
                await msg.reply('📝 Masukkan nama produk baru:');
            } else if (message === '2') {
                state.editField = 'price';
                state.step = 'edit_product_value';
                userStates.set(sender, state);
                await msg.reply('💰 Masukkan harga baru (angka saja):\n\nContoh: 75000');
            } else if (message === '3') {
                state.editField = 'stock';
                state.step = 'edit_product_value';
                userStates.set(sender, state);
                await msg.reply('📊 Masukkan stok baru (angka saja):\n\nContoh: 50');
            } else {
                await msg.reply('❌ Pilihan tidak valid. Pilih 1, 2, atau 3.');
            }
            break;
            
        case 'edit_product_value':
            let newValue = message;
            
            if (state.editField === 'price') {
                newValue = parseFloat(message);
                if (isNaN(newValue) || newValue <= 0) {
                    await msg.reply('❌ Harga tidak valid. Masukkan angka yang benar.');
                    return;
                }
            } else if (state.editField === 'stock') {
                newValue = parseInt(message);
                if (isNaN(newValue) || newValue < 0) {
                    await msg.reply('❌ Stok tidak valid. Masukkan angka yang benar.');
                    return;
                }
            }
            
            try {
                await updateProduct(state.editProductId, state.editField, newValue);
                
                const fieldName = state.editField === 'name' ? 'Nama' : 
                                state.editField === 'price' ? 'Harga' : 'Stok';
                
                await msg.reply(`✅ *${fieldName} BERHASIL DIUPDATE!*\n\nKetik *menu* untuk kembali ke menu utama.`);
            } catch (err) {
                console.error('❌ Error updating product:', err.message);
                await msg.reply('❌ Gagal update produk. Silakan coba lagi.');
            }
            
            state.step = 'menu';
            userStates.set(sender, state);
            break;
            
        case 'delete_product_select':
            const deleteId = parseInt(message);
            if (isNaN(deleteId)) {
                await msg.reply('❌ ID produk tidak valid. Masukkan angka ID produk.');
                return;
            }
            
            try {
                const productToDelete = await checkProductExists(deleteId);
                if (!productToDelete) {
                    await msg.reply('❌ Produk dengan ID tersebut tidak ditemukan.\n\nKetik *menu* untuk kembali.');
                    state.step = 'menu';
                    userStates.set(sender, state);
                    return;
                }
                
                await deleteProduct(deleteId);
                await msg.reply('✅ *PRODUK BERHASIL DIHAPUS!*\n\nKetik *menu* untuk kembali ke menu utama.');
            } catch (err) {
                console.error('❌ Error deleting product:', err.message);
                await msg.reply('❌ Gagal hapus produk. Silakan coba lagi.');
            }
            
            state.step = 'menu';
            userStates.set(sender, state);
            break;
    }
};

// ========================
// CUSTOMER FLOW HANDLER
// ========================
const handleCustomerFlow = async (client, msg, state) => {
    const sender = msg.from;
    const message = msg.body.trim();
    
    switch (state.step) {
        case 'menu':
            if (message === '1') {
                await showProducts(msg);
            } else if (message === '2') {
                state.step = 'order_select_product';
                userStates.set(sender, state);
                await showProductsForOrder(msg);
            } else if (message === '3') {
                await showCustomerOrders(msg, sender);
            } else {
                await msg.reply('❌ Menu tidak valid. Ketik *menu* untuk melihat pilihan.');
            }
            break;
            
        case 'order_select_product':
            const productId = parseInt(message);
            if (isNaN(productId)) {
                await msg.reply('❌ ID produk tidak valid. Masukkan angka ID produk.');
                return;
            }
            
            try {
                const product = await getProductById(productId);
                if (!product) {
                    await msg.reply('❌ Produk tidak ditemukan.\n\nKetik *menu* untuk kembali.');
                    state.step = 'menu';
                    userStates.set(sender, state);
                    return;
                }
                
                if (product.stock <= 0) {
                    await msg.reply('😔 Maaf, stok produk ini habis.\n\nSilakan pilih produk lain atau ketik *menu* untuk kembali.');
                    return;
                }
                
                state.productId = productId;
                state.productName = product.name;
                state.productPrice = product.price;
                state.maxStock = product.stock;
                state.step = 'order_quantity';
                userStates.set(sender, state);
                
                await msg.reply(`📦 *${product.name}*\n💰 Rp ${product.price.toLocaleString('id-ID')}\n📊 Stok tersedia: ${product.stock} unit\n\n` +
                              `Masukkan jumlah yang ingin dipesan (maksimal ${product.stock}):`);
            } catch (err) {
                console.error('❌ Error getting product:', err.message);
                await msg.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
            }
            break;
            
        case 'order_quantity':
            const qty = parseInt(message);
            if (isNaN(qty) || qty <= 0) {
                await msg.reply('❌ Jumlah tidak valid. Masukkan angka lebih dari 0:');
                return;
            }
            
            if (qty > state.maxStock) {
                await msg.reply(`❌ Stok tidak mencukupi. Maksimal pemesanan: ${state.maxStock} unit\n\nMasukkan jumlah yang valid:`);
                return;
            }
            
            state.quantity = qty;
            state.subtotal = qty * state.productPrice;
            state.step = 'order_notes';
            userStates.set(sender, state);
            
            await msg.reply(`📝 Masukkan catatan pesanan Anda\n(Contoh: warna merah, ukuran L)\n\nAtau ketik *skip* jika tidak ada catatan:`);
            break;
            
        case 'order_notes':
            const notes = message.toLowerCase() === 'skip' ? '' : message;
            
            try {
                const orderId = await createOrder(sender, notes);
                await addOrderDetail(orderId, state.productId, state.quantity, state.productPrice);
                
                const orderSummary = `✅ *PESANAN BERHASIL DIBUAT!*\n\n` +
                                   `━━━━━━━━━━━━━━━━\n` +
                                   `🆔 Order ID: *${orderId}*\n` +
                                   `━━━━━━━━━━━━━━━━\n\n` +
                                   `📦 ${state.productName}\n` +
                                   `💰 Rp ${state.productPrice.toLocaleString('id-ID')} x ${state.quantity}\n` +
                                   `➖➖➖➖➖➖➖➖\n` +
                                   `💵 *Total: Rp ${state.subtotal.toLocaleString('id-ID')}*\n\n`;
                
                const finalMessage = notes ? 
                    orderSummary + `📝 Catatan: ${notes}\n\n━━━━━━━━━━━━━━━━\n\nTerima kasih atas pesanan Anda!\nKetik *menu* untuk kembali.` :
                    orderSummary + `━━━━━━━━━━━━━━━━\n\nTerima kasih atas pesanan Anda!\nKetik *menu* untuk kembali.`;
                
                await msg.reply(finalMessage);
            } catch (err) {
                console.error('❌ Error creating order:', err.message);
                await msg.reply('❌ Gagal membuat pesanan. Silakan coba lagi.');
            }
            
            state.step = 'menu';
            userStates.set(sender, state);
            break;
    }
};

// ========================
// PRODUCT DATABASE FUNCTIONS
// ========================
const addProduct = async (productData) => {
    const conn = await getConnection();
    try {
        await conn.execute(
            'INSERT INTO products (name, price, stock) VALUES (?, ?, ?)',
            [productData.name, productData.price, productData.stock]
        );
    } finally {
        await safeCloseConnection(conn);
    }
};

const showProducts = async (msg) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT * FROM products WHERE stock > 0 ORDER BY id DESC');
        
        if (rows.length === 0) {
            await msg.reply('📦 Belum ada produk tersedia saat ini.');
            return;
        }
        
        let message = '*📦 DAFTAR PRODUK*\n\n';
        rows.forEach((product, index) => {
            message += `${index + 1}. *${product.name}*\n`;
            message += `   💰 Harga: Rp ${product.price.toLocaleString('id-ID')}\n`;
            message += `   📊 Stok: ${product.stock} unit\n`;
            message += `   🆔 ID: ${product.id}\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `Ketik *menu* untuk kembali`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

const showProductsForEdit = async (msg) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT * FROM products ORDER BY id DESC');
        
        if (rows.length === 0) {
            await msg.reply('📦 Belum ada produk yang bisa diedit.');
            return;
        }
        
        let message = '*✏️ PILIH PRODUK UNTUK DIEDIT*\n\n';
        rows.forEach((product) => {
            message += `🆔 ID: *${product.id}*\n`;
            message += `📦 ${product.name}\n`;
            message += `💰 Rp ${product.price.toLocaleString('id-ID')}\n`;
            message += `📊 Stok: ${product.stock}\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `Masukkan *ID produk* yang ingin diedit:`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

const showProductsForDelete = async (msg) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT * FROM products ORDER BY id DESC');
        
        if (rows.length === 0) {
            await msg.reply('📦 Belum ada produk yang bisa dihapus.');
            return;
        }
        
        let message = '*🗑️ PILIH PRODUK UNTUK DIHAPUS*\n\n';
        rows.forEach((product) => {
            message += `🆔 ID: *${product.id}*\n`;
            message += `📦 ${product.name}\n`;
            message += `💰 Rp ${product.price.toLocaleString('id-ID')}\n`;
            message += `📊 Stok: ${product.stock}\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `⚠️ *PERHATIAN:* Produk yang dihapus tidak dapat dikembalikan!\n\n`;
        message += `Masukkan *ID produk* yang ingin dihapus:`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

const showProductsForOrder = async (msg) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT * FROM products WHERE stock > 0 ORDER BY id DESC');
        
        if (rows.length === 0) {
            await msg.reply('😔 Maaf, produk sedang tidak tersedia.\n\nSilakan coba lagi nanti atau ketik *menu* untuk kembali.');
            return;
        }
        
        let message = '*🛒 PILIH PRODUK YANG INGIN DIPESAN*\n\n';
        rows.forEach((product) => {
            message += `🆔 ID: *${product.id}*\n`;
            message += `📦 ${product.name}\n`;
            message += `💰 Rp ${product.price.toLocaleString('id-ID')}\n`;
            message += `📊 Stok tersedia: ${product.stock} unit\n\n`;
        });
        
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `Masukkan *ID produk* yang ingin dipesan:`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

const updateProduct = async (id, field, value) => {
    const conn = await getConnection();
    try {
        const allowedFields = ['name', 'price', 'stock'];
        if (!allowedFields.includes(field)) {
            throw new Error('Invalid field');
        }
        
        const query = `UPDATE products SET ${field} = ? WHERE id = ?`;
        await conn.execute(query, [value, id]);
    } finally {
        await safeCloseConnection(conn);
    }
};

const deleteProduct = async (id) => {
    const conn = await getConnection();
    try {
        await conn.execute('DELETE FROM products WHERE id = ?', [id]);
    } finally {
        await safeCloseConnection(conn);
    }
};

const checkProductExists = async (id) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT id FROM products WHERE id = ?', [id]);
        return rows.length > 0;
    } finally {
        await safeCloseConnection(conn);
    }
};

const getProductById = async (id) => {
    const conn = await getConnection();
    try {
        const [rows] = await conn.execute('SELECT * FROM products WHERE id = ?', [id]);
        return rows.length > 0 ? rows[0] : null;
    } finally {
        await safeCloseConnection(conn);
    }
};

// ========================
// ORDER DATABASE FUNCTIONS
// ========================
const createOrder = async (customer, notes = '') => {
    const conn = await getConnection();
    try {
        const [result] = await conn.execute(
            'INSERT INTO orders (customer, notes, date_order) VALUES (?, ?, NOW())',
            [customer, notes]
        );
        return result.insertId;
    } finally {
        await safeCloseConnection(conn);
    }
};

const addOrderDetail = async (orderId, productId, qty, price) => {
    const conn = await getConnection();
    try {
        await conn.execute(
            'INSERT INTO order_detail (id_order, id_product, qty, temp_price) VALUES (?, ?, ?, ?)',
            [orderId, productId, qty, price]
        );
        
        await conn.execute(
            'UPDATE products SET stock = stock - ? WHERE id = ?',
            [qty, productId]
        );
    } finally {
        await safeCloseConnection(conn);
    }
};

const showOrders = async (msg) => {
    const conn = await getConnection();
    try {
        const [orders] = await conn.execute(`
            SELECT o.*, COUNT(od.id) as items 
            FROM orders o 
            LEFT JOIN order_detail od ON o.id = od.id_order 
            GROUP BY o.id 
            ORDER BY o.date_order DESC 
            LIMIT 20
        `);
        
        if (orders.length === 0) {
            await msg.reply('📋 Belum ada pesanan masuk.');
            return;
        }
        
        let message = '*📋 DAFTAR PESANAN*\n\n';
        
        for (let order of orders) {
            const [details] = await conn.execute(`
                SELECT SUM(qty * temp_price) as total 
                FROM order_detail 
                WHERE id_order = ?
            `, [order.id]);
            
            const total = details[0].total || 0;
            
            message += `🆔 Order ID: *${order.id}*\n`;
            message += `👤 Customer: ${order.customer.replace('@c.us', '')}\n`;
            message += `📦 Items: ${order.items}\n`;
            message += `💵 Total: Rp ${total.toLocaleString('id-ID')}\n`;
            message += `📅 ${new Date(order.date_order).toLocaleString('id-ID')}\n`;
            
            if (order.notes) {
                message += `📝 Catatan: ${order.notes}\n`;
            }
            
            message += `\n`;
        }
        
        message += `━━━━━━━━━━━━━━━━\n`;
        message += `Menampilkan 20 pesanan terakhir\nKetik *menu* untuk kembali`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

const showCustomerOrders = async (msg, customer) => {
    const conn = await getConnection();
    try {
        const [orders] = await conn.execute(`
            SELECT o.*, COUNT(od.id) as items 
            FROM orders o 
            LEFT JOIN order_detail od ON o.id = od.id_order 
            WHERE o.customer = ?
            GROUP BY o.id 
            ORDER BY o.date_order DESC
        `, [customer]);
        
        if (orders.length === 0) {
            await msg.reply('📋 Anda belum memiliki pesanan.\n\nKetik *menu* untuk mulai berbelanja!');
            return;
        }
        
        let message = '*📋 RIWAYAT PESANAN ANDA*\n\n';
        
        for (let order of orders) {
            const [details] = await conn.execute(`
                SELECT od.*, p.name 
                FROM order_detail od 
                JOIN products p ON od.id_product = p.id 
                WHERE od.id_order = ?
            `, [order.id]);
            
            let total = 0;
            
            message += `🆔 Order ID: *${order.id}*\n`;
            message += `📅 ${new Date(order.date_order).toLocaleString('id-ID')}\n\n`;
            
            details.forEach(item => {
                const subtotal = item.qty * item.temp_price;
                total += subtotal;
                message += `📦 ${item.name}\n`;
                message += `   ${item.qty} x Rp ${item.temp_price.toLocaleString('id-ID')} = Rp ${subtotal.toLocaleString('id-ID')}\n`;
            });
            
            message += `\n💵 *Total: Rp ${total.toLocaleString('id-ID')}*\n`;
            
            if (order.notes) {
                message += `📝 Catatan: ${order.notes}\n`;
            }
            
            message += `\n━━━━━━━━━━━━━━━━\n\n`;
        }
        
        message += `Ketik *menu* untuk kembali`;
        
        await msg.reply(message);
    } finally {
        await safeCloseConnection(conn);
    }
};

// ========================
// EXPORTS
// ========================
module.exports = {
    handleMessage
}