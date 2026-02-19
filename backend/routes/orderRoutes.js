const express = require("express");
const router = express.Router();
const {
  createOrder,
  getMyOrders,
  updateOrderStatus,
  cancelOrder,
  getOrderById,
  getAllOrders,
  getSellerOrders,
} = require("../controllers/orderControllers");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// Buyer routes
router.post("/create", authMiddleware, verifyRole("buyer"), createOrder);
router.put(
  "/cancel/:id",
  authMiddleware,
  verifyRole("buyer, admin"),
  cancelOrder,
);
router.get("/my-orders", authMiddleware, verifyRole("buyer"), getMyOrders);

// Seller Routes
router.put("/update", authMiddleware, verifyRole("seller"), updateOrderStatus);
router.get("/seller", authMiddleware, verifyRole("seller"), getSellerOrders);

// Admin routes
router.get("/", authMiddleware, verifyRole("admin"), getAllOrders);

// Shared Routes
router.get("/:id", authMiddleware, getOrderById);

module.exports = router;
