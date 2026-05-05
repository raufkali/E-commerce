const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

const connectDB = require("./config/database");
const cors = require("cors");
const errorHandler = require("./middlewares/errorHandler");
const {
  uploadProductImage,
  uploadProfileImage,
  uploadMultipleProducts,
  uploadSingleProduct,
  uploadSingleProfile,
} = require("./middlewares/uploadMiddleware");

dotenv.config();
connectDB();

// ── Start cron jobs AFTER env + db are ready ──────────────────────────────
require("./autoRelease");

// routes
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const walletRoutes = require("./routes/walletRoutes");
const profileRoutes = require("./routes/profileRoutes");
const sellerRoutes = require("./routes/sellerRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

// Webhook MUST receive raw body before express.json() parses it
app.use("/payment/webhook", express.raw({ type: "application/json" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.locals.upload = {
  singleProduct: uploadSingleProduct,
  multipleProducts: uploadMultipleProducts,
  profile: uploadSingleProfile,
  uploadProductImage,
  uploadProfileImage,
  uploadMultipleProducts,
  uploadSingleProduct,
  uploadSingleProfile,
};

app.use(cors());

// Static files
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));
app.use("/img", express.static(path.join(__dirname, "public/img")));

// API routes
app.use("/user", userRoutes);
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/products", productRoutes);
app.use("/cart", cartRoutes);
app.use("/category", categoryRoutes);
app.use("/orders", orderRoutes);
app.use("/payment", paymentRoutes);
app.use("/wallet", walletRoutes);
app.use("/profile", profileRoutes);
app.use("/seller", sellerRoutes);
app.use("/notifications", notificationRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("App started on PORT:", PORT);
});
