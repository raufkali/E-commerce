const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    age: {
      type: Number,
      required: true,
      min: 0,
    },
    role: {
      type: String,
      enum: ["user", "seller", "admin"],
      default: "user",
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("User", userSchema);
