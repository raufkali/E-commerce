const express = require("express");
const router = express.Router();

const {
  addToCart,
  getMyCart,
  removeFromCart,
  emptyCart,
  updateCartItem,
} = require("../controllers/cartController");

const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

router.post("/add", authMiddleware, verifyRole("user"), addToCart);
router.get("/", authMiddleware, verifyRole("user"), getMyCart);
router.put("/remove/:id", authMiddleware, verifyRole("user"), removeFromCart);
router.put("/removeAll", authMiddleware, verifyRole("user"), emptyCart);
router.put("/update/:id", authMiddleware, verifyRole("user"), updateCartItem);

module.exports = router;
