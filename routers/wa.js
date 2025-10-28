const express = require("express")
const api = require ("../controllers/waControllers")

const router = express.Router()

router.get("/api", api);

module.exports = router;
