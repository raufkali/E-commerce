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

// routes
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const productRoutes = require("./routes/productRoutes");
const cartRoutes = require("./routes/cartRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const orderRoutes = require("./routes/orderRoutes");
// const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
app.use(express.json());

// Make upload middleware available throughout the app
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

// FrontEnd - BackEnd
app.use(
  cors({
    origin: [process.env.FRONTEND_URL1, process.env.FRONTEND_URL2],
    credentials: true,
  }),
);

// Serve static files from public directory
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));

// user defined routes
app.use("/user", userRoutes);
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/products", productRoutes);
app.use("/cart", cartRoutes);
app.use("/category", categoryRoutes);
app.use("/orders", orderRoutes);

// app.use("/payment", paymentRoutes);

// Error handling middleware
app.use(errorHandler);

const PORT = process.env.PORT || 8080;

// Server
app.listen(PORT, () => {
  console.log("App started on PORT:", PORT);
});
