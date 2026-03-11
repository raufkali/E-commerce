const express = require("express");
const router = express.Router();
const stripe = require("../config/stripe");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

// Create Stripe Connect account for seller and generate onboarding link
router.post(
  "/create-connect-account",
  authMiddleware,
  verifyRole("seller"),
  async (req, res) => {
    try {
      const { country = "US" } = req.body; // Default to US if not specified
      const userId = req.user.id;

      // Check if user already has a Stripe account
      const user = await User.findById(userId);
      if (user.stripeAccountId) {
        return res.status(400).json({
          success: false,
          message: "Seller already has a Stripe account connected",
        });
      }

      // Create a Stripe Connect account (Express type for simpler onboarding)
      const account = await stripe.accounts.create({
        type: "express", // Use "express" for Stripe-hosted onboarding
        country: country,
        email: req.user.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: "individual",
        metadata: {
          userId: userId.toString(),
        },
      });

      // Save the Stripe account ID to your database
      user.stripeAccountId = account.id;
      user.stripeAccountStatus = "pending";
      await user.save();

      // Also update wallet with Stripe account info
      const wallet = await Wallet.findOne({ user: userId });
      if (wallet) {
        wallet.stripeAccountId = account.id;
        wallet.stripeAccountStatus = "pending";
        await wallet.save();
      }

      // Create an account link for onboarding
      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${process.env.FRONTEND_URL}/seller/onboarding/refresh`,
        return_url: `${process.env.FRONTEND_URL}/seller/onboarding/complete`,
        type: "account_onboarding",
      });

      res.json({
        success: true,
        message: "Stripe Connect account created",
        onboardingUrl: accountLink.url,
        accountId: account.id,
      });
    } catch (error) {
      console.error("Error creating Stripe Connect account:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

// Handle onboarding completion (called from frontend after return)
router.get(
  "/onboarding-complete",
  authMiddleware,
  verifyRole("seller"),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      if (!user.stripeAccountId) {
        return res.status(400).json({
          success: false,
          message: "No Stripe account found",
        });
      }

      // Retrieve the account to check its status
      const account = await stripe.accounts.retrieve(user.stripeAccountId);

      // Check if onboarding is complete
      const isOnboarded =
        account.charges_enabled &&
        account.payouts_enabled &&
        account.details_submitted;

      if (isOnboarded) {
        user.stripeAccountStatus = "verified";
        await user.save();

        // Update wallet
        const wallet = await Wallet.findOne({ user: userId });
        if (wallet) {
          wallet.stripeAccountStatus = "verified";
          await wallet.save();
        }
      }

      res.json({
        success: true,
        isOnboarded,
        account: {
          id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
        },
      });
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

// Get seller's Stripe account status
router.get(
  "/account-status",
  authMiddleware,
  verifyRole("seller"),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);

      if (!user.stripeAccountId) {
        return res.json({
          success: true,
          hasAccount: false,
        });
      }

      // Retrieve the account to get current status
      const account = await stripe.accounts.retrieve(user.stripeAccountId);

      res.json({
        success: true,
        hasAccount: true,
        status: user.stripeAccountStatus,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
      });
    } catch (error) {
      console.error("Error fetching account status:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

module.exports = router;
