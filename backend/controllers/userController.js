const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");
const Wallet = require("../models/Wallet");
const Cart = require("../models/Cart");
// GET ALL USERS
const getAllUsers = asyncHandler(async (req, res) => {
  const allUsers = await User.find();
  res.status(200).json({
    message: "Success! Users fetched",
    users: allUsers,
  });
});

// CREATE USER
const createUser = asyncHandler(async (req, res) => {
  const data = req.body;
  console.log(data);
  // determine allowed roles
  let allowedRoles = ["user", "seller"];
  if (req.user && req.user.role == "admin") {
    allowedRoles.push("admin");
  }

  if (!allowedRoles.includes(data.role)) {
    res.status(403);
    throw new Error("Access Denied: Invalid Role");
  }

  if (!data.email || !data.password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const existingUser = await User.findOne({ email: data.email });
  if (existingUser) {
    res.status(409);
    throw new Error("User already exists");
  }

  // hash password
  const hashedPass = await bcrypt.hash(data.password, 10);
  data.password = hashedPass;

  const user = await User.create(data);
  // create wallet for user
  await Wallet.create({
    user: user._id,
    role: data.role,
  });
  // generate JWT
  if (req.user && req.user.role == "admin") {
    res.status(201).json({
      status: "success",
      message: "User created successfully",
      user: { id: user._id, email: user.email, role: user.role },
    });
  } else {
    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    res.status(201).json({
      status: "success",
      message: "User created successfully",
      token,
      user: { id: user._id, email: user.email, role: user.role },
    });
  }
});

// LOGIN USER
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const user = await User.findOne({ email });
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const isValidUser = await bcrypt.compare(password, user.password);
  if (!isValidUser) {
    res.status(401);
    throw new Error("Invalid credentials");
  }

  const token = jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.status(200).json({
    message: "User logged in successfully",
    token,
    user: { id: user._id, email: user.email, role: user.role },
  });
});

const deleteUser = asyncHandler(async (req, res) => {
  if (!req.params.id || !req.user.id) {
    res.status(400);
    throw new Error("Invalid Token or Invalid ID");
  }
  const userId = req.user.id;
  // delete user wallet
  const wallet = await Wallet.findOne({ userId });
  if (wallet) {
    await Wallet.findByIdAndDelete(wallet._id);
  }
  // remove cart
  const cart = await Cart.findOne({ userId });
  if (cart) {
    await Cart.findByIdAndDelete(cart._id);
  }
  // delete the user
  const user = await User.findByIdAndDelete(req.params.id);
  res.status(200).json({
    success: true,
    user,
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const id = req.params.id;
  console.log(id);
  if (!id || !req.user?.id) {
    res.status(400);
    throw new Error("Invalid Token or Invalid ID");
  }
  const { fullname, email, role } = req.body;
  const updatedUser = await User.findByIdAndUpdate(
    id,
    {
      fullname,
      email,
      role,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedUser) {
    res.status(404);
    throw new Error("User not found");
  }

  res.status(200).json({
    success: true,
    data: updatedUser,
  });
});
module.exports = { createUser, loginUser, getAllUsers, deleteUser, updateUser };
