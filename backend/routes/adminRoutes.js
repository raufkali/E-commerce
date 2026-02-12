const express = require("express");
const router = express.Router();
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const { getAllUsers, createUser } = require("../controllers/userController");

router.get("/users", authMiddleware, verifyRole("admin"), getAllUsers);
router.post("/create-admin", authMiddleware, createUser);

module.exports = router;
