const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const asyncHandler = require("express-async-handler");

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

  // determine allowed roles
  let allowedRoles = ["user", "seller"];
  if (req.user && req.user.role === "admin") {
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

  // generate JWT
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
  // delete the user
  const user = await User.findByIdAndDelete(req.params.id);
  res.status(200).json({
    success: true,
    user,
  });
});

const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!id || !req.user?.id) {
    res.status(400);
    throw new Error("Invalid Token or Invalid ID");
  }
  if (req.user.id !== id) {
    res.status(403);
    throw new Error("Not authorized to update this user");
  }
  const { name, email } = req.body;
  const updatedUser = await User.findByIdAndUpdate(
    id,
    {
      name,
      email,
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
