// modules
const express = require("express");
const path = require("path");
const dotenv = require("dotenv");
const connectDB = require("./config/database");
const cors = require("cors");
const errorHandler = require("./middlewares/errorHandler");

dotenv.config();
connectDB();

// routes
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
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
app.use("/admin", adminRoutes);
app.use("/products", productRoutes);
app.use("/cart", cartRoutes);
app.use("/category", categoryRoutes);
app.use("/orders", orderRoutes);
app.use("/payment", paymentRoutes);

app.use(errorHandler);

const PORT = process.env.PORT || 8080;
// Server
app.listen(PORT, () => {
  console.log("App started on PORT:", PORT);
});
