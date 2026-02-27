const User = require("../models/User");
const Orders = require("../models/Order");
const Category = require("../models/Category");
const Product = require("../models/Product");
const asyncHandler = require("express-async-handler");

const getAdminDashboard = asyncHandler(async (req, res) => {
  const allUsers = await User.find();
  const allOrders = await Orders.find().populate("user");
  const allCategories = await Category.find();
  const allProducts = await Product.find();

  res.status(200).json({
    success: true,
    items: {
      allUsers,
      allOrders,
      allCategories,
      allProducts,
    },
  });
});

module.exports = { getAdminDashboard };
