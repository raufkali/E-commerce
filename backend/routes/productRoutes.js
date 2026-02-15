const express = require("express");
const router = express.Router();
const {
  getAllProducts,
  createProduct,
  deleteProduct,
  getOneProduct,
  updateProduct,
  getMyProducts,
} = require("../controllers/productController");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
router.get("/", getAllProducts);

router.post("/create", authMiddleware, verifyRole("seller"), createProduct);
router.get("/my-products", authMiddleware, verifyRole("seller"), getMyProducts);
router
  .route("/:id")
  .delete(authMiddleware, verifyRole("admin", "seller"), deleteProduct)
  .get(getOneProduct)
  .put(authMiddleware, verifyRole("admin", "seller"), updateProduct);

module.exports = router;
