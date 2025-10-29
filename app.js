const express = require('express')
const app = express()
const port = 3000
const bodyParser = require("body-parser")
const router = require("./routers/wa")

app.use(bodyParser.json());
app.use("/", router);

app.listen(port, () => {
    console.log(`running on port ${port}`)
})