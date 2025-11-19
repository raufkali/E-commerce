const express = require("express");
const cors = require("cors");

// using app
const app = express();

// middlewares
app.use(cors());
app.use(express.json());

// routes

// ports
const PORT = process.env.PORT || 5000;

// server
app.listen(PORT, () => {
  console.log("SERVER STARTED ON PORT:", PORT);
});
