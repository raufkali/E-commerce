const express = require("express");
const router = express.Router();
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
} = require("../controllers/userController");
const { getAdminDashboard } = require("../controllers/adminControllers");

router.get("/users", authMiddleware, verifyRole("admin"), getAllUsers);
router.post("/create-admin", authMiddleware, verifyRole("admin"), createUser);
router.put("/update/:id", authMiddleware, verifyRole("admin"), updateUser);
router.delete("/delete/:id", authMiddleware, verifyRole("admin"), deleteUser);

router.get(
  "/dashboard",
  authMiddleware,
  verifyRole("admin"),
  getAdminDashboard,
);

module.exports = router;
