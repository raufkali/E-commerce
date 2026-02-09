const express = require("express");
const router = express.Router();
const { authMiddleware } = require("../middlewares/authMiddleware");

router.get("/me", authMiddleware, (req, res) => {
  res.status(200).json({
    user: {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
    },
    exp: req.user.exp,
  });
});

module.exports = router;
