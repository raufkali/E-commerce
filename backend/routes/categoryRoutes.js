const express = require("express");
const router = express.Router();
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const {
  createCategory,
  getOneCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getProductByCategory,
} = require("../controllers/categoryController");

router.post("/create", authMiddleware, verifyRole("admin"), createCategory);
router.get("/", getAllCategories);
router.get("/:id", getOneCategory);
router.put("/update/:id", authMiddleware, verifyRole("admin"), updateCategory);
router.delete(
  "/delete/:id",
  authMiddleware,
  verifyRole("admin"),
  deleteCategory,
);
router.get("/:id/products", getProductByCategory);

module.exports = router;
