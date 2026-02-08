const express = require("express");
const router = express.Router();
const { OAuth2Client } = require("google-auth-library");
const supabase = require("../config/supabase");

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

router.post("/google", async (req, res) => {
  console.log("🔥 /api/auth/google HIT");

  const { token } = req.body;
  console.log("TOKEN RECEIVED:", token ? "YES" : "NO");

  if (!token) {
    return res.status(400).json({ error: "Token missing" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    console.log("PAYLOAD:", payload);

    const email = payload.email;
    const name = payload.name;
    const userId = payload.sub;

    console.log("USER:", email, name, userId);

    let { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    console.log("EXISTING USER:", user);
    console.log("SELECT ERROR:", error);

    if (!user) {
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert([
          {
            id: userId,
            name,
            email,
            role: "user",
          },
        ])
        .select()
        .single();

      console.log("INSERTED USER:", newUser);
      console.log("INSERT ERROR:", insertError);

      user = newUser;
    }

    res.json({
      message: "Login successful",
      role: user.role,
      user,
    });
  } catch (err) {
    console.error("❌ AUTH ERROR:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
});
