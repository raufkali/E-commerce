const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    quantity: { type: Number, required: true },
  },
  { _id: false },
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String, required: true },
    city: { type: String, required: true },
    postalCode: { type: String },
    country: { type: String, default: "Pakistan" },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    orderItems: [orderItemSchema],
    shippingAddress: shippingAddressSchema,
    paymentMethod: {
      type: String,
      required: true,
      enum: ["stripe"],
      default: "stripe",
    },

    // STRIPE PAYMENT FIELDS (ADD THESE)
    stripePaymentIntentId: {
      type: String,
      sparse: true, // Allows multiple null values
    },
    stripeClientSecret: {
      type: String,
    },

    // PAYMENT STATUS - Modified to include Stripe states
    paymentStatus: {
      type: String,
      enum: [
        "pending", // Order created, no payment yet
        "requires_payment_method", // Payment failed, retry
        "requires_capture", // Funds held in escrow (AUTHORIZED)
        "captured", // Funds released to you (CAPTURED)
        "paid", // Legacy, kept for compatibility
        "failed",
        "refunded",
      ],
      default: "pending",
    },

    // ESCROW FIELDS
    escrowStatus: {
      type: String,
      enum: [
        "held", // Funds in escrow (authorized)
        "released", // Funds captured/released to you
        "refunded", // Funds returned to buyer
        "disputed",
      ],
      default: "held",
    },
    heldUntil: {
      type: Date, // Auto-release date (e.g., 14 days after delivery)
    },
    releasedAt: Date,

    // Amount fields (already have these)
    itemsPrice: { type: Number, required: true, default: 0 },
    shippingPrice: { type: Number, required: true, default: 0 },
    taxPrice: { type: Number, required: true, default: 0 },
    totalPrice: { type: Number, required: true, default: 0 },

    // Status flags
    isPaid: { type: Boolean, default: false },
    paidAt: Date,
    isDelivered: { type: Boolean, default: false },
    isCancelled: { type: Boolean, default: false },
    deliveredAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Order", orderSchema);
