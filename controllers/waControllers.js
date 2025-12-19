const mysql = require("mysql2/promise");
require("dotenv").config();

// ========================
// KONFIGURASI DATABASE
// ========================
let pool = null;

const initializePool = async () => {
  if (pool) return pool;

  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "localhost",
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "wa_commerce",
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 10,
    });

    console.log("✅ Database connection pool initialized");
    return pool;
  } catch (error) {
    console.error("❌ Pool initialization error:", error.message);
    throw error;
  }
};

// ========================
// STATE MANAGEMENT
// ========================
const userStates = new Map();
const STATE_TIMEOUT = 30 * 60 * 1000;
const processedMessages = new Set();

const clearAllStates = () => {
  const oldSize = userStates.size;
  userStates.clear();
  if (oldSize > 0) {
    console.log(`🗑️ Cleared ${oldSize} user states`);
  }
};

clearAllStates();

const setUserState = (sender, state) => {
  userStates.set(sender, state);
  setTimeout(() => {
    if (userStates.has(sender)) {
      userStates.delete(sender);
      console.log(`🗑️ State cleaned for ${sender}`);
    }
  }, STATE_TIMEOUT);
};

const getUserState = (sender) => {
  return userStates.get(sender) || { step: "menu" };
};

const isMessageProcessed = (messageId) => {
  return processedMessages.has(messageId);
};

const markMessageAsProcessed = (messageId) => {
  processedMessages.add(messageId);
  setTimeout(() => {
    processedMessages.delete(messageId);
  }, 5000);
};

// ⭐ Normalize input (baca Menu, menu, MeNu semua sama)
const normalizeInput = (input) => {
  return input.trim().toLowerCase();
};

// ========================
// KONFIGURASI ADMIN
// ========================
const ADMIN_NUMBER = process.env.ADMIN_NUMBER;

if (!ADMIN_NUMBER.includes("@c.us")) {
  console.warn(
    `⚠️ WARNING: ADMIN_NUMBER format salah! Gunakan format: 628xxx@c.us`
  );
}

console.log(`✅ Admin number set to: ${ADMIN_NUMBER}`);

// ========================
// DATABASE CONNECTION
// ========================
const getConnection = async () => {
  try {
    const p = await initializePool();
    return await p.getConnection();
  } catch (error) {
    console.error("❌ Database connection error:", error.message);
    throw error;
  }
};

const safeCloseConnection = async (conn) => {
  if (!conn) return;
  try {
    await conn.release();
  } catch (err) {
    console.warn("⚠️ Warning saat release connection:", err.message);
  }
};

// ========================
// MAIN HANDLER
// ========================
const handleMessage = async (client, msg) => {
  try {
    if (isMessageProcessed(msg.id)) {
      console.log(`⏭️ Pesan ${msg.id} sudah diproses, skip...`);
      return;
    }
    markMessageAsProcessed(msg.id);

    const sender = msg.from;
    const message = msg.body.trim();

    if (msg.fromMe) return;

    const isAdmin = sender === ADMIN_NUMBER;
    let state = getUserState(sender);

    console.log(`📨 [${sender}] ${message} | Admin: ${isAdmin}`);

    const normalMsg = normalizeInput(message);

    if (normalMsg === "/start" || normalMsg === "menu") {
      state = { step: "menu" };
      setUserState(sender, state);

      if (isAdmin) {
        await sendAdminMenu(msg);
      } else {
        await sendCustomerMenu(msg);
      }
      return;
    }

    if (isAdmin) {
      await handleAdminFlow(client, msg, state);
    } else {
      await handleCustomerFlow(client, msg, state);
    }
  } catch (error) {
    console.error("❌ Error in handleMessage:", error.message);
    try {
      await msg.reply("❌ Terjadi kesalahan. Silakan coba lagi.");
    } catch (e) {
      console.error("❌ Error replying:", e.message);
    }
  }
};

// ========================
// MENU FUNCTIONS
// ========================
const sendAdminMenu = async (msg) => {
  const menu =
    `MENU ADMIN\n\n` +
    `1. Tambah Produk\n` +
    `2. Lihat Produk\n` +
    `3. Edit Produk\n` +
    `4. Hapus Produk\n` +
    `5. Lihat Pesanan Hari Ini\n` +
    `6. Filter Pesanan Berdasarkan Tanggal\n\n` +
    `Ketik nomor menu untuk memilih\n` +
    `Ketik menu untuk kembali`;

  await msg.reply(menu);
};

const sendCustomerMenu = async (msg) => {
  const menu =
    `*🛒 SELAMAT DATANG*\n\n` +
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
  const normMsg = normalizeInput(message);

  switch (state.step) {
    case "menu":
      if (normMsg === "1") {
        state.step = "add_product";
        setUserState(sender, state);
        await msg.reply(
          "*➕ TAMBAH PRODUK*\n\n" +
            "Format:\n" +
            "nama: [nama produk]\n" +
            "harga: [harga]\n" +
            "stok: [jumlah]\n\n" +
            "Contoh:\n" +
            "nama: Laptop Dell\n" +
            "harga: 5000000\n" +
            "stok: 10"
        );
      } else if (normMsg === "2") {
        await showProducts(msg);
        state.step = "menu";
        setUserState(sender, state);
      } else if (normMsg === "3") {
        state.step = "edit_product";
        setUserState(sender, state);
        await msg.reply(
          "*✏️ EDIT PRODUK*\n\n" +
            "Format:\n" +
            "edit: [id]\n" +
            "field: [nama|harga|stok]\n" +
            "value: [nilai baru]\n\n" +
            "Contoh:\n" +
            "edit: 1\n" +
            "field: harga\n" +
            "value: 7500000"
        );
      } else if (normMsg === "4") {
        state.step = "delete_product";
        setUserState(sender, state);
        await msg.reply(
          "*🗑️ HAPUS PRODUK*\n\n" +
            "Format:\n" +
            "hapus: [id produk]\n\n" +
            "Contoh:\n" +
            "hapus: 1"
        );
      } else if (normMsg === "5") {
        // Langsung tampil pesanan hari ini tanpa input
        const today = new Date().toISOString().split("T")[0];
        try {
          await showOrdersByDate(msg, today);
        } catch (err) {
          console.error("Error getting orders:", err.message);
          await msg.reply("Gagal mengambil data pesanan. Silakan coba lagi.");
        }
      } else if (normMsg === "6") {
        state.step = "export_orders_date";
        setUserState(sender, state);
        await msg.reply(
          `FILTER PESANAN BERDASARKAN RANGE TANGGAL\n\n` +
            `Format:\n` +
            `dari: YYYY-MM-DD\n` +
            `sampai: YYYY-MM-DD\n\n` +
            `Contoh:\n` +
            `dari: 2025-12-01\n` +
            `sampai: 2025-12-17`
        );
      } else {
        await msg.reply(
          "❌ Menu tidak valid. Ketik *menu* untuk melihat pilihan."
        );
      }
      break;

    case "add_product":
      const hasNama = message.toLowerCase().includes("nama:");
      const hasHarga = message.toLowerCase().includes("harga:");
      const hasStok = message.toLowerCase().includes("stok:");

      if (!hasNama || !hasHarga || !hasStok) {
        await msg.reply(
          "❌ Format tidak lengkap. Harus ada 3 field:\n\n" +
            "nama: [nama produk]\n" +
            "harga: [harga]\n" +
            "stok: [jumlah]\n\n" +
            "Contoh:\n" +
            "nama: Laptop Dell\n" +
            "harga: 5000000\n" +
            "stok: 10"
        );
        return;
      }

      const lines = message.split("\n").map((l) => l.trim());
      const productData = {};

      for (const line of lines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith("nama:")) {
          productData.name = line.substring(5).trim();
        } else if (lowerLine.startsWith("harga:")) {
          productData.price = parseFloat(line.substring(6).trim());
        } else if (lowerLine.startsWith("stok:")) {
          productData.stock = parseInt(line.substring(5).trim());
        }
      }

      if (!productData.name || !productData.name.trim()) {
        await msg.reply("❌ Nama produk tidak boleh kosong!");
        return;
      }

      if (isNaN(productData.price) || productData.price <= 0) {
        await msg.reply(
          "❌ Harga tidak valid. Harus angka > 0\n\nContoh:\nharga: 50000"
        );
        return;
      }

      if (isNaN(productData.stock) || productData.stock < 0) {
        await msg.reply(
          "❌ Stok tidak valid. Harus angka >= 0\n\nContoh:\nstok: 100"
        );
        return;
      }

      try {
        await addProduct(productData);

        const summary =
          `✅ *PRODUK BERHASIL DITAMBAHKAN!*\n\n` +
          `📦 Nama: ${productData.name}\n` +
          `💰 Harga: Rp ${productData.price.toLocaleString("id-ID")}\n` +
          `📊 Stok: ${productData.stock} unit\n\n` +
          `Ketik *menu* untuk kembali.`;

        await msg.reply(summary);
        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("❌ Error adding product:", err.message);
        await msg.reply("❌ Gagal menambah produk. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "edit_product":
      const hasEdit = message.toLowerCase().includes("edit:");
      const hasField = message.toLowerCase().includes("field:");
      const hasValue = message.toLowerCase().includes("value:");

      if (!hasEdit || !hasField || !hasValue) {
        await msg.reply(
          "❌ Format tidak lengkap. Harus ada 3 field:\n\n" +
            "edit: [id]\n" +
            "field: [nama|harga|stok]\n" +
            "value: [nilai baru]\n\n" +
            "Contoh:\n" +
            "edit: 1\n" +
            "field: harga\n" +
            "value: 7500000"
        );
        return;
      }

      const editLines = message.split("\n").map((l) => l.trim());
      const editData = {};

      for (const line of editLines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith("edit:")) {
          editData.id = parseInt(line.substring(5).trim());
        } else if (lowerLine.startsWith("field:")) {
          editData.field = line.substring(6).trim().toLowerCase();
        } else if (lowerLine.startsWith("value:")) {
          editData.value = line.substring(6).trim();
        }
      }

      if (isNaN(editData.id)) {
        await msg.reply(
          "❌ ID produk tidak valid. Harus angka\n\nContoh:\nedit: 1"
        );
        return;
      }

      if (
        !["nama", "name", "harga", "price", "stok", "stock"].includes(
          editData.field
        )
      ) {
        await msg.reply(
          "❌ Field tidak valid. Gunakan: nama, harga, atau stok"
        );
        return;
      }

      try {
        const productExists = await checkProductExists(editData.id);
        if (!productExists) {
          await msg.reply("❌ Produk dengan ID tersebut tidak ditemukan.");
          state.step = "menu";
          setUserState(sender, state);
          return;
        }

        const fieldMap = {
          nama: "name",
          name: "name",
          harga: "price",
          price: "price",
          stok: "stock",
          stock: "stock",
        };
        const normalizedField = fieldMap[editData.field];

        let newValue = editData.value;

        if (normalizedField === "price") {
          newValue = parseFloat(editData.value);
          if (isNaN(newValue) || newValue <= 0) {
            await msg.reply("❌ Harga tidak valid. Harus angka > 0");
            return;
          }
        } else if (normalizedField === "stock") {
          newValue = parseInt(editData.value);
          if (isNaN(newValue) || newValue < 0) {
            await msg.reply("❌ Stok tidak valid. Harus angka >= 0");
            return;
          }
        }

        await updateProduct(editData.id, normalizedField, newValue);

        const fieldDisplay =
          normalizedField === "name"
            ? "Nama"
            : normalizedField === "price"
            ? "Harga"
            : "Stok";
        await msg.reply(
          `✅ *${fieldDisplay} BERHASIL DIUPDATE!*\n\nID: ${editData.id}\n${fieldDisplay}: ${newValue}`
        );

        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("❌ Error updating product:", err.message);
        await msg.reply("❌ Gagal update produk. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "delete_product":
      if (!message.toLowerCase().includes("hapus:")) {
        await msg.reply(
          "❌ Format tidak valid.\n\n" +
            "Gunakan:\n" +
            "hapus: [id]\n\n" +
            "Contoh:\n" +
            "hapus: 1"
        );
        return;
      }

      let deleteId = null;

      if (message.toLowerCase().startsWith("hapus:")) {
        deleteId = parseInt(message.substring(6).trim());
      }

      if (isNaN(deleteId)) {
        await msg.reply(
          "❌ Format tidak valid.\n\n" +
            "Gunakan:\n" +
            "hapus: [id]\n\n" +
            "Contoh:\n" +
            "hapus: 1"
        );
        return;
      }

      try {
        const productExists = await checkProductExists(deleteId);
        if (!productExists) {
          await msg.reply("❌ Produk dengan ID tersebut tidak ditemukan.");
          state.step = "menu";
          setUserState(sender, state);
          return;
        }

        await deleteProduct(deleteId);
        await msg.reply(
          `✅ *PRODUK BERHASIL DIHAPUS!*\n\nID: ${deleteId}\n\nKetik *menu* untuk kembali.`
        );

        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("❌ Error deleting product:", err.message);
        await msg.reply("❌ Gagal hapus produk. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "orders_by_date":
      if (!message.toLowerCase().includes("tanggal:")) {
        await msg.reply(
          "❌ Format tidak valid.\n\n" +
            "Gunakan:\n" +
            "tanggal: [YYYY-MM-DD]\n\n" +
            "Contoh:\n" +
            "tanggal: 2024-12-17"
        );
        return;
      }

      const dateMatch = message.match(/tanggal:\s*([\d\-]+)/i);
      if (!dateMatch) {
        await msg.reply("❌ Format tanggal tidak valid. Gunakan: YYYY-MM-DD");
        return;
      }

      const selectedDate = dateMatch[1];
      try {
        await showOrdersByDate(msg, selectedDate);
        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("❌ Error getting orders:", err.message);
        await msg.reply("❌ Gagal mengambil data pesanan. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "filter_orders_date":
      const hasTanggal = message.toLowerCase().includes("tanggal:");

      if (!hasTanggal) {
        await msg.reply(
          `Format tidak valid.\n\n` +
            `Format:\n` +
            `tanggal: YYYY-MM-DD\n\n` +
            `Contoh:\n` +
            `tanggal: 2025-12-16`
        );
        return;
      }

      const tanggalMatch = message.match(/tanggal:\s*([\d\-]+)/i);
      if (!tanggalMatch) {
        await msg.reply("Format tanggal tidak valid. Gunakan: YYYY-MM-DD");
        return;
      }

      try {
        await showOrdersByDate(msg, tanggalMatch[1]);
        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("Error getting orders:", err.message);
        await msg.reply("Gagal mengambil data pesanan. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "export_orders_date":
      const hasDari = message.toLowerCase().includes("dari:");
      const hasSampai = message.toLowerCase().includes("sampai:");

      if (!hasDari || !hasSampai) {
        await msg.reply(
          `Format tidak lengkap.\n\n` +
            `Format:\n` +
            `dari: YYYY-MM-DD\n` +
            `sampai: YYYY-MM-DD\n\n` +
            `Contoh:\n` +
            `dari: 2025-12-01\n` +
            `sampai: 2025-12-17`
        );
        return;
      }

      const dariMatch = message.match(/dari:\s*([\d\-]+)/i);
      const sampaiMatch = message.match(/sampai:\s*([\d\-]+)/i);

      if (!dariMatch || !sampaiMatch) {
        await msg.reply("Format tanggal tidak valid. Gunakan: YYYY-MM-DD");
        return;
      }

      try {
        await showOrdersByDateRange(msg, dariMatch[1], sampaiMatch[1]);
        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("Error getting orders:", err.message);
        await msg.reply("Gagal mengambil data pesanan. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;
  }
};

// ========================
// CUSTOMER FLOW HANDLER
// ========================
const handleCustomerFlow = async (client, msg, state) => {
  const sender = msg.from.split('@')[0];
  const message = msg.body.trim();
  const normMsg = normalizeInput(message);

  switch (state.step) {
    case "menu":
      if (normMsg === "1") {
        await showProducts(msg);
        state.step = "menu";
        setUserState(sender, state);
      } else if (normMsg === "2") {
        state.step = "order_select_product";
        setUserState(sender, state);
        await showProductsForOrder(msg);
      } else if (normMsg === "3") {
        await showCustomerOrders(msg, sender);
        state.step = "menu";
        setUserState(sender, state);
      } else {
        await msg.reply(
          "❌ Menu tidak valid. Ketik *menu* untuk melihat pilihan."
        );
      }
      break;

    case "order_select_product":
      const productId = parseInt(message);
      if (isNaN(productId)) {
        await msg.reply("❌ ID produk tidak valid. Masukkan angka ID produk.");
        return;
      }

      try {
        const product = await getProductById(productId);
        if (!product) {
          await msg.reply(
            "❌ Produk tidak ditemukan.\n\nKetik *menu* untuk kembali."
          );
          state.step = "menu";
          setUserState(sender, state);
          return;
        }

        if (product.stock <= 0) {
          await msg.reply(
            "😔 Maaf, stok produk ini habis.\n\nSilakan pilih produk lain atau ketik *menu* untuk kembali."
          );
          return;
        }

        state.productId = productId;
        state.productName = product.name;
        state.productPrice = product.price;
        state.maxStock = product.stock;
        state.step = "order_input";
        setUserState(sender, state);

        await msg.reply(
          `📦 *${product.name}*\n💰 Rp ${product.price.toLocaleString(
            "id-ID"
          )}\n📊 Stok tersedia: ${product.stock} unit\n\n` +
            `Format pemesanan:\n` +
            `nama: [nama anda]\n` +
            `qty: [jumlah]\n` +
            `catatan: [opsional]\n\n` +
            `Contoh:\n` +
            `nama: Budi Santoso\n` +
            `qty: 2\n` +
            `catatan: warna merah`
        );
      } catch (err) {
        console.error("❌ Error getting product:", err.message);
        await msg.reply("❌ Terjadi kesalahan. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
      break;

    case "order_input":
      const hasNama = message.toLowerCase().includes("nama:");
      const hasQty = message.toLowerCase().includes("qty:");

      if (!hasNama || !hasQty) {
        await msg.reply(
          "❌ Format tidak lengkap. Harus ada nama dan qty:\n\n" +
            "nama: [nama anda]\n" +
            "qty: [jumlah]\n" +
            "catatan: [opsional]\n\n" +
            "Contoh:\n" +
            "nama: Budi Santoso\n" +
            "qty: 2\n" +
            "catatan: warna merah"
        );
        return;
      }

      const orderLines = message.split("\n").map((l) => l.trim());
      const orderData = {};

      for (const line of orderLines) {
        const lowerLine = line.toLowerCase();
        if (lowerLine.startsWith("nama:")) {
          orderData.customerName = line.substring(5).trim();
        } else if (lowerLine.startsWith("qty:")) {
          orderData.qty = parseInt(line.substring(4).trim());
        } else if (lowerLine.startsWith("catatan:")) {
          orderData.notes = line.substring(8).trim();
        }
      }

      if (!orderData.customerName) {
        await msg.reply("❌ Nama tidak boleh kosong!");
        return;
      }

      if (isNaN(orderData.qty) || orderData.qty <= 0) {
        await msg.reply("❌ Qty tidak valid. Harus angka > 0");
        return;
      }

      if (orderData.qty > state.maxStock) {
        await msg.reply(
          `❌ Stok tidak mencukupi. Maksimal: ${state.maxStock} unit`
        );
        return;
      }

      try {
        const orderId = await createOrder(
          sender,
          orderData.customerName,
          orderData.notes || ""
        );
        await addOrderDetail(
          orderId,
          state.productId,
          orderData.qty,
          state.productPrice
        );

        const subtotal = orderData.qty * state.productPrice;
        const orderSummary =
          `✅ *PESANAN BERHASIL DIBUAT!*\n\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `🆔 Order ID: *${orderId}*\n` +
          `👤 Nama: ${orderData.customerName}\n` +
          `━━━━━━━━━━━━━━━━\n\n` +
          `📦 ${state.productName}\n` +
          `💰 Rp ${state.productPrice.toLocaleString("id-ID")} x ${
            orderData.qty
          }\n` +
          `➖➖➖➖➖➖➖➖\n` +
          `💵 *Total: Rp ${subtotal.toLocaleString("id-ID")}*\n\n`;

        const finalMessage = orderData.notes
          ? orderSummary +
            `📝 Catatan: ${orderData.notes}\n\n━━━━━━━━━━━━━━━━\n\nTerima kasih atas pesanan Anda!\nKetik *menu* untuk kembali.`
          : orderSummary +
            `━━━━━━━━━━━━━━━━\n\nTerima kasih atas pesanan Anda!\nKetik *menu* untuk kembali.`;

        await msg.reply(finalMessage);
        state.step = "menu";
        setUserState(sender, state);
      } catch (err) {
        console.error("❌ Error creating order:", err.message);
        await msg.reply("❌ Gagal membuat pesanan. Silakan coba lagi.");
        state.step = "menu";
        setUserState(sender, state);
      }
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
      "INSERT INTO products (name, price, stock) VALUES (?, ?, ?)",
      [productData.name, productData.price, productData.stock]
    );
  } finally {
    await safeCloseConnection(conn);
  }
};

const showProducts = async (msg) => {
  const conn = await getConnection();
  try {
    // Check if user is admin
    const isAdmin = msg.from === process.env.ADMIN_NUMBER;
    
    // Query berbeda tergantung admin atau user biasa
    let query = "SELECT * FROM products";
    
    if (!isAdmin) {
      query += " WHERE stock > 0";
    }
    
    query += " ORDER BY id DESC LIMIT 50";
    
    const [rows] = await conn.execute(query);

    if (rows.length === 0) {
      await msg.reply("📦 Belum ada produk tersedia saat ini.");
      return;
    }

    let message = "*📦 DAFTAR PRODUK*\n\n";
    
    // Tambahkan label jika admin
    if (isAdmin) {
      message += "🔐 *MODE ADMIN* - Tampil semua produk\n\n";
    }
    
    rows.forEach((product, index) => {
      message += `${index + 1}. *${product.name}*\n`;
      message += `   💰 Harga: Rp ${product.price.toLocaleString("id-ID")}\n`;
      message += `   📊 Stok: ${product.stock} unit\n`;
      
      // Highlight stok 0 untuk admin
      if (isAdmin && product.stock === 0) {
        message += `   ⚠️ STOK HABIS\n`;
      }
      
      message += `   🆔 ID: ${product.id}\n\n`;
    });

    message += `━━━━━━━━━━━━━━━━\n`;
    message += `Ketik *menu* untuk kembali`;

    await msg.reply(message);
  } finally {
    await safeCloseConnection(conn);
  }
};

const showProductsForOrder = async (msg) => {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute(
      "SELECT * FROM products WHERE stock > 0 ORDER BY id DESC LIMIT 50"
    );

    if (rows.length === 0) {
      await msg.reply(
        "😔 Maaf, produk sedang tidak tersedia.\n\nSilakan coba lagi nanti atau ketik *menu* untuk kembali."
      );
      return;
    }

    let message = "*🛒 PILIH PRODUK YANG INGIN DIPESAN*\n\n";
    rows.forEach((product) => {
      message += `🆔 ID: *${product.id}*\n`;
      message += `📦 ${product.name}\n`;
      message += `💰 Rp ${product.price.toLocaleString("id-ID")}\n`;
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
    const allowedFields = ["name", "price", "stock"];
    if (!allowedFields.includes(field)) {
      throw new Error("Invalid field");
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
    await conn.execute("DELETE FROM products WHERE id = ?", [id]);
  } finally {
    await safeCloseConnection(conn);
  }
};

const checkProductExists = async (id) => {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute("SELECT id FROM products WHERE id = ?", [
      id,
    ]);
    return rows.length > 0;
  } finally {
    await safeCloseConnection(conn);
  }
};

const getProductById = async (id) => {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute("SELECT * FROM products WHERE id = ?", [
      id,
    ]);
    return rows.length > 0 ? rows[0] : null;
  } finally {
    await safeCloseConnection(conn);
  }
};

// ========================
// ORDER DATABASE FUNCTIONS
// ========================
const createOrder = async (customer, customerName, notes = "") => {
  const conn = await getConnection();
  try {
    const [result] = await conn.execute(
      "INSERT INTO orders (customer, customer_name, notes, date_order) VALUES (?, ?, ?, NOW())",
      [customer, customerName, notes]
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
      "INSERT INTO order_detail (id_order, id_product, qty, temp_price) VALUES (?, ?, ?, ?)",
      [orderId, productId, qty, price]
    );

    await conn.execute("UPDATE products SET stock = stock - ? WHERE id = ?", [
      qty,
      productId,
    ]);
  } finally {
    await safeCloseConnection(conn);
  }
};

// Lihat pesanan per hari
const showOrdersByDate = async (msg, date) => {
  const conn = await getConnection();
  try {
    const [orders] = await conn.execute(
      `
        SELECT 
            o.*,
            COUNT(od.id) AS items,
            COALESCE(SUM(od.qty * od.temp_price), 0) AS total
        FROM orders o
        LEFT JOIN order_detail od ON o.id = od.id_order
        WHERE DATE(o.date_order) = ?
        GROUP BY o.id
        ORDER BY o.date_order ASC
        `,
      [date]
    );

    if (orders.length === 0) {
      await msg.reply(`Tidak ada pesanan pada tanggal ${date}`);
      return;
    }

    let message = `PESANAN TANGGAL ${date}\n`;
    message += `${"=".repeat(90)}\n`;
    message += `NO | ID | NAMA | NO TELP | QTY | TOTAL | CATATAN\n`;
    message += `${"-".repeat(90)}\n`;

    let totalRevenue = 0;
    let no = 1;

    for (let order of orders) {
      totalRevenue += Number(order.total);

      const phone = (order.customer || "-").replace("@c.us", "");
      const customerName = (order.customer_name || "-").substring(0, 8);
      const notes = (order.notes || "-").substring(0, 10);
      const totalFormatted = Number(order.total).toLocaleString("id-ID");

      message += `${String(no).padEnd(2)} | `;
      message += `${String(order.id).padEnd(3)} | `;
      message += `${customerName.padEnd(8)} | `;
      message += `${phone.substring(0, 6).padEnd(7)} | `;
      message += `${String(order.items).padEnd(3)} | `;
      message += `${totalFormatted.padEnd(14)} | ${notes}\n`;

      no++;
    }

    message += `${"-".repeat(90)}\n`;
    message += `TOTAL PESANAN: ${
      orders.length
    } | TOTAL REVENUE: Rp ${totalRevenue.toLocaleString("id-ID")}\n`;
    message += `${"=".repeat(90)}`;

    await msg.reply("```\n" + message + "\n```");
  } finally {
    await safeCloseConnection(conn);
  }
};

const showOrdersByDateRange = async (msg, startDate, endDate) => {
  const conn = await getConnection();
  try {
    const [orders] = await conn.execute(
    `
    SELECT 
        o.*,
        COUNT(od.id) AS items,
        COALESCE(SUM(od.qty * od.temp_price), 0) AS total
    FROM orders o
    LEFT JOIN order_detail od ON o.id = od.id_order
    WHERE o.date_order BETWEEN ? AND ?
    GROUP BY o.id
    ORDER BY o.date_order ASC
    `,
    [`${startDate} 00:00:00`, `${endDate} 23:59:59`]
    );


    if (orders.length === 0) {
      await msg.reply(`Tidak ada pesanan dari ${startDate} sampai ${endDate}`);
      return;
    }

    let message = `PESANAN ${startDate} s/d ${endDate}\n`;
    message += `${"=".repeat(95)}\n`;
    message += `NO | ID | NAMA | NO TELP | QTY | TOTAL | CATATAN | WAKTU\n`;
    message += `${"-".repeat(95)}\n`;

    let totalRevenue = 0;
    let no = 1;

    for (let order of orders) {
        totalRevenue += Number(order.total);

        const phone = (order.customer || "-").replace("@c.us", "");
        const customerName = (order.customer_name || "-").substring(0, 8);
        const notes = (order.notes || "-").substring(0, 10);
        const totalFormatted = Number(order.total).toLocaleString("id-ID");

        const time = new Date(order.date_order).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
        });

        message += `${String(no).padEnd(2)} | `;
        message += `${String(order.id).padEnd(3)} | `;
        message += `${customerName.padEnd(8)} | `;
        message += `${phone.substring(0, 6).padEnd(7)} | `;
        message += `${String(order.items).padEnd(3)} | `;
        message += `${totalFormatted.padEnd(14)} | `;
        message += `${notes.padEnd(10)} | `;
        message += `${time}\n`;

        no++;
    }

    message += `${"-".repeat(95)}\n`;
    message += `TOTAL PESANAN: ${
      orders.length
    } | TOTAL REVENUE: Rp ${totalRevenue.toLocaleString("id-ID")}\n`;
    message += `${"=".repeat(95)}`;

    await msg.reply("```\n" + message + "\n```");
  } finally {
    await safeCloseConnection(conn);
  }
};

const showCustomerOrders = async (msg) => {
  const conn = await getConnection();
  try {
    // Extract nomor HP dari msg.from (format: 628xxxxxx@c.us)
    const phoneNumber = msg.from.split('@')[0];
    const today = new Date().toISOString().split("T")[0];

    const [orders] = await conn.execute(
    `
        SELECT o.*, COUNT(od.id) as items 
        FROM orders o 
        LEFT JOIN order_detail od ON o.id = od.id_order 
        WHERE o.customer = ? 
        AND DATE(o.date_order) = ?
        GROUP BY o.id 
        ORDER BY o.date_order DESC
        LIMIT 50
    `,
    [phoneNumber, today]
    );

    if (orders.length === 0) {
      await msg.reply(
        "📋 Anda belum memiliki pesanan.\n\nKetik *menu* untuk mulai berbelanja!"
      );
      return;
    }

    let message = "*📋 RIWAYAT PESANAN ANDA*\n\n";

    for (let order of orders) {
      const [details] = await conn.execute(
        `
          SELECT od.*, p.name 
          FROM order_detail od 
          JOIN products p ON od.id_product = p.id 
          WHERE od.id_order = ?
        `,
        [order.id]
      );

      let total = 0;

      message += `🆔 Order ID: *${order.id}*\n`;
      message += `📅 ${new Date(order.date_order).toLocaleString("id-ID")}\n`;
      message += `📊 Status: *${order.status || 'Pending'}*\n\n`;

      details.forEach((item) => {
        const subtotal = item.qty * item.temp_price;
        total += subtotal;
        message += `📦 ${item.name}\n`;
        message += `   ${item.qty} x Rp ${item.temp_price.toLocaleString(
          "id-ID"
        )} = Rp ${subtotal.toLocaleString("id-ID")}\n`;
      });

      message += `\n💵 *Total: Rp ${total.toLocaleString("id-ID")}*\n`;

      if (order.notes) {
        message += `📝 Catatan: ${order.notes}\n`;
      }

      message += `\n━━━━━━━━━━━━━━━━\n\n`;
    }

    message += `Ketik *menu* untuk kembali`;

    await msg.reply(message);
  } catch (error) {
    console.error('❌ Error showing customer orders:', error.message);
    await msg.reply('❌ Terjadi kesalahan. Silakan coba lagi.');
  } finally {
    await safeCloseConnection(conn);
  }
};

// ========================
// EXPORTS
// ========================
module.exports = {
  handleMessage,
};
