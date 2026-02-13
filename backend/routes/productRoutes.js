const express = require("express");
const router = express.Router();
const {
  getAllProducts,
  createProduct,
  deleteProduct,
  getOneProduct,
  updateProduct,
} = require("../controllers/productController");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

router.get("/", getAllProducts);

router.post("/create", authMiddleware, verifyRole("seller"), createProduct);
router
  .route("/:id")
  .delete(deleteProduct)
  .get(getOneProduct)
  .put(updateProduct);

module.exports = router;
