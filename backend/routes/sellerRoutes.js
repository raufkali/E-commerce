const express = require("express");
const router = express.Router();
const stripe = require("../config/stripe");
const { authMiddleware, verifyRole } = require("../middlewares/authMiddleware");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

// Helper to check if account is onboarded
const isAccountOnboarded = (account) => {
  return (
    account.charges_enabled &&
    account.payouts_enabled &&
    account.details_submitted
  );
};

// Create Stripe Connect account for seller and generate onboarding link
router.post(
  "/create-connect-account",
  authMiddleware,
  verifyRole("seller"),
  async (req, res) => {
    try {
      const { country = "US" } = req.body;
      const userId = req.user.id;

      // Check if user already has a Stripe account
      const user = await User.findById(userId);

      if (user.stripeAccountId) {
        // Account exists - check if it's complete or not
        try {
          const existingAccount = await stripe.accounts.retrieve(
            user.stripeAccountId,
          );

          if (isAccountOnboarded(existingAccount)) {
            return res.status(400).json({
              success: false,
              message: "Seller already has a verified Stripe account connected",
            });
          } else {
            // Account exists but incomplete - generate a new account link
            const accountLink = await stripe.accountLinks.create({
              account: user.stripeAccountId,
              refresh_url: `${process.env.FRONTEND_URL1}/seller/onboarding/refresh`,
              return_url: `${process.env.FRONTEND_URL1}/seller/onboarding/complete`,
              type: "account_onboarding",
            });

            return res.json({
              success: true,
              message: "Resuming incomplete Stripe account setup",
              onboardingUrl: accountLink.url,
              accountId: user.stripeAccountId,
              isResume: true,
            });
          }
        } catch (stripeError) {
          console.error("Error retrieving existing account:", stripeError);
          // If account retrieval fails, reset and create a new one
          user.stripeAccountId = null;
          user.stripeAccountStatus = "pending";
          await user.save();
        }
      }

      // ✅ WORKING VERSION - No business_profile needed for test mode
      const account = await stripe.accounts.create({
        type: "express",
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
        refresh_url: `${process.env.FRONTEND_URL1}/seller/onboarding/refresh`,
        return_url: `${process.env.FRONTEND_URL1}/seller/onboarding/complete`,
        type: "account_onboarding",
      });

      res.json({
        success: true,
        message: "Stripe Connect account created",
        onboardingUrl: accountLink.url,
        accountId: account.id,
        isResume: false,
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

// Handle onboarding completion
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

      const account = await stripe.accounts.retrieve(user.stripeAccountId);
      const isOnboarded = isAccountOnboarded(account);

      if (isOnboarded) {
        user.stripeAccountStatus = "verified";
        await user.save();

        const wallet = await Wallet.findOne({ user: userId });
        if (wallet) {
          wallet.stripeAccountStatus = "verified";
          await wallet.save();
        }
      } else {
        user.stripeAccountStatus = "pending";
        await user.save();
      }

      res.json({
        success: true,
        isOnboarded,
        account: {
          id: account.id,
          charges_enabled: account.charges_enabled,
          payouts_enabled: account.payouts_enabled,
          details_submitted: account.details_submitted,
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

      const account = await stripe.accounts.retrieve(user.stripeAccountId);
      const isOnboarded = isAccountOnboarded(account);

      res.json({
        success: true,
        hasAccount: true,
        isComplete: isOnboarded,
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

// Resume incomplete onboarding
router.post(
  "/resume-onboarding",
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

      const accountLink = await stripe.accountLinks.create({
        account: user.stripeAccountId,
        refresh_url: `${process.env.FRONTEND_URL1}/seller/onboarding/refresh`,
        return_url: `${process.env.FRONTEND_URL1}/seller/onboarding/complete`,
        type: "account_onboarding",
      });

      res.json({
        success: true,
        onboardingUrl: accountLink.url,
        accountId: user.stripeAccountId,
      });
    } catch (error) {
      console.error("Error resuming onboarding:", error);
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

module.exports = router;
