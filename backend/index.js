// modules
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const connectDB = require("./config/database");
const cors = require("cors");

dotenv.config();
connectDB();
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
// middlewares
const app = express();
// builtins
app.use(express.json());

// FrontEnd - BackEnd
app.use(
  cors({
    origin: [process.env.FRONTEND_URL1, process.env.FRONTEND_URL2],
    credentials: true,
  }),
);

// user defined
app.use("/user", userRoutes);
app.use("/auth", authRoutes);
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log("App started on PORT:", PORT);
});
