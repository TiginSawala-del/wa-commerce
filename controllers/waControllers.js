const { Client, LocalAuth } = require('whatsapp-web.js');
const qrCode = require('qrcode-terminal')

const client = new Client({
    authStrategy: new LocalAuth()
});

client.on("qr", (qr) => {
  qrCode.generate(qr, { small: true });
});

client.on("ready", () => {
    console.log("Client is ready");
});

client.initialize();

const api = async (req, res) => {
    let phone_number = req.query.phone_number;
    const message = req.query.message;

    try {
        if (phone_number.startsWith("0")) {
            phone_number = "62" + phone_number.slice(1) + "@c.us";
        } else if (phone_number.startsWith("62")) {
            phone_number = phone_number + "@c.us";
        } else {
            phone_number = "62" + phone_number + "@c.us";
        }

        const user = await client.isRegisteredUser(phone_number);

        if (user) {
            await client.sendMessage(phone_number, message);
            return res.status(200).json({
                error: false,
                message: "Berhasil mengirim pesan",
            });
        } else {
            return res.status(400).json({
                error: true,
                message: "Nomor tidak valid",
            });
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            error: true,
            message: "Server Error"
        });
    }
};

module.exports = api;
