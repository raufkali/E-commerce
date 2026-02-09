const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const createUser = async (req, res) => {
  try {
    const data = req.body;

    if (!data.email || !data.password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const existingUser = await User.findOne({ email: data.email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const hashedPass = await bcrypt.hash(data.password, 10);
    data.password = hashedPass;

    const user = await User.create(data);
    // granting access
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
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// just login the user
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    // checking for exsisting email
    const exsisted = await User.findOne({ email });
    if (!exsisted) {
      return res.status(404).send("User Not Found!");
    }
    // if found what to do
    const isValidUser = await bcrypt.compare(password, exsisted.password);
    if (isValidUser) {
      const token = jwt.sign(
        {
          id: exsisted._id,
          email,
          role: exsisted.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" },
      );
      res.status(200).json({
        message: "User Login Successfully!",
        token,
      });
    }
  } catch (error) {
    return res.status(400).send("Something went wrong while Login User!");
  }
};

module.exports = { createUser, loginUser };
