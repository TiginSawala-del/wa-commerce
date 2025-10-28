const express = require('express')
const app = express()
const port = 3000
const router = require("./routers/wa")

app.use("/", router);

app.listen(port, () => {
    console.log(`running on port ${port}`)
})