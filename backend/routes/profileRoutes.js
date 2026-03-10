const express = require("express");
const router = express.Router();
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const {
  getMyProfile,
  updateMyProfile,
} = require("../controllers/profileController.js");

router.get("/", authMiddleware, getMyProfile);
router.put("/update", authMiddleware, updateMyProfile);

module.exports = router;
