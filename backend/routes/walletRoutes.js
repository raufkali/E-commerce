const express = require("express");
const router = express.Router();
const {
  getMyWallet,
  getBalance,
  getTransactions,
  withdrawToBank,
  getWithdrawalHistory,
  addBankAccount,
  updateWithdrawalSettings,
  // Admin only
  adminGetAllWallets,
  adminAdjustBalance,
  adminFreezeWallet,
} = require("../controllers/walletController");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");

// ============================================
// USER ROUTES (Authenticated users)
// ============================================

// Get current user's wallet
router.get("/me", authMiddleware, getMyWallet);

// Get wallet balance
router.get("/balance", authMiddleware, getBalance);

// Get transaction history
router.get("/transactions", authMiddleware, getTransactions);

// ============================================
// SELLER ROUTES
// ============================================

// Add/update bank account for withdrawals
router.post(
  "/bank-account",
  authMiddleware,
  verifyRole("seller"),
  addBankAccount,
);

// Withdraw funds to bank account
router.post("/withdraw", authMiddleware, verifyRole("seller"), withdrawToBank);

// Get withdrawal history
router.get(
  "/withdrawals",
  authMiddleware,
  verifyRole("seller"),
  getWithdrawalHistory,
);

// Update withdrawal settings
router.put(
  "/settings",
  authMiddleware,
  verifyRole("seller"),
  updateWithdrawalSettings,
);

// ============================================
// ADMIN ROUTES
// ============================================

// Get all wallets (admin only)
router.get(
  "/admin/all",
  authMiddleware,
  verifyRole("admin"),
  adminGetAllWallets,
);

// Adjust wallet balance (admin only - for disputes)
router.post(
  "/admin/adjust",
  authMiddleware,
  verifyRole("admin"),
  adminAdjustBalance,
);

// Freeze/unfreeze wallet (admin only)
router.put(
  "/admin/freeze/:userId",
  authMiddleware,
  verifyRole("admin"),
  adminFreezeWallet,
);

module.exports = router;
