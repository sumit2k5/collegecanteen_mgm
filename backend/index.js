require("dotenv").config();
const nodemailer = require("nodemailer");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { OAuth2Client } = require("google-auth-library");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ================= GOOGLE AUTH =================
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.send("Backend running");
});

// ================= GOOGLE LOGIN =================
app.post("/api/auth/google", async (req, res) => {
  try {
    const { token } = req.body;

    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name } = payload;

    let { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert([{ email, name, role: "user" }])
        .select()
        .single();

      if (error) return res.status(400).json(error);
      user = newUser;
    }

    res.json({
  user: {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    canteen_id: user.canteen_id,
  },
});

  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Google auth failed" });
  }
});

// ================= GET CANTEENS =================
app.get("/api/canteens", async (req, res) => {
  const { data, error } = await supabase
    .from("canteens")
    .select("*")
    .eq("is_active", true);

  if (error) return res.status(400).json(error);
  res.json(data);
});

// ================= GET MENU BY CANTEEN =================
app.get("/api/menu/:canteenId", async (req, res) => {
  const { canteenId } = req.params;

  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("canteen_id", Number(canteenId))
    .eq("available", true);

  if (error) {
    console.error("MENU ERROR:", error);
    return res.status(400).json(error);
  }

  res.json(data);
});
/* =======================
   PLACE ORDER
======================= */
// ================= CREATE PENDING ORDER =================
app.post("/api/orders", async (req, res) => {
  const { userId, canteenId, cart, total } = req.body;

  try {
    // create pending order
    const { data: order, error } = await supabase
      .from("orders")
      .insert([
        {
          user_id: userId,
          canteen_id: canteenId,
          total_amount: total,
          payment_status: "PENDING",
        },
      ])
      .select()
      .single();

    if (error) return res.status(400).json(error);

    // temporarily store cart items
    const orderItems = cart.map((item) => ({
      order_id: order.id,
      item_name: item.item_name,
      price: item.price,
      quantity: item.quantity,
    }));

    await supabase.from("order_items").insert(orderItems);

    // return orderId only
    res.json({
      orderId: order.id,
      message: "Proceed to payment",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Order creation failed" });
  }
});
// ================= CONFIRM PAYMENT =================
app.post("/api/orders/confirm-payment", async (req, res) => {
  const { orderId, transactionId } = req.body;

  try {
    // get order + user email
    const { data: order } = await supabase
      .from("orders")
      .select("id, user_id")
      .eq("id", orderId)
      .single();

    const { data: user } = await supabase
      .from("users")
      .select("email, name")
      .eq("id", order.user_id)
      .single();

    // update order
    await supabase
      .from("orders")
      .update({
        transaction_id: transactionId,
        payment_status: "PAID",
        o_status: "PLACED",
      })
      .eq("id", orderId);

    // send email
    await transporter.sendMail({
      from: `"Canteen Management" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: "Order Placed Successfully 🍽️",
      html: `
        <h3>Hello ${user.name},</h3>
        <p>Your order has been placed successfully.</p>
        <p><strong>Order ID:</strong> ${orderId}</p>
        <p>Please wait while your order is being prepared.</p>
        <br/>
        <p>Thank you for using the Canteen Management System.</p>
      `,
    });

    res.json({
      message:
        "Payment successful! Order confirmed. Email sent to your registered email.",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Payment confirmation failed" });
  }
});
// ================= STAFF: GET ORDERS =================
app.get("/api/staff/orders/:canteenId", async (req, res) => {
  const { canteenId } = req.params;

  const { data, error } = await supabase
    .from("orders")
    .select(`
      id,
      total_amount,
      o_status,
      created_at,
      users(name)
    `)
    .eq("canteen_id", canteenId)
    .order("created_at", { ascending: false });

  if (error) return res.status(400).json(error);
  res.json(data);
});

// ================= STAFF: UPDATE ORDER STATUS =================
app.put("/api/staff/orders/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  try {
    // update order status
    const { data: order, error } = await supabase
      .from("orders")
      .update({ o_status: status })
      .eq("id", orderId)
      .select("id, user_id")
      .single();

    if (error) return res.status(400).json(error);

    // if READY → send email
    if (status === "READY") {
      const { data: user } = await supabase
        .from("users")
        .select("email, name")
        .eq("id", order.user_id)
        .single();

      await transporter.sendMail({
        from: `"Canteen Management" <${process.env.EMAIL_USER}>`,
        to: user.email,
        subject: "Your Order is Ready 🍽️",
        html: `
          <h3>Hello ${user.name},</h3>
          <p>Your order <strong>#${orderId}</strong> is now <b>READY</b>.</p>
          <p>Please collect it from the canteen.</p>
          <br/>
          <p>Thank you!</p>
        `,
      });
    }

    res.json({ message: "Order status updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Status update failed" });
  }
});
// ================= ADMIN: TOGGLE CANTEEN =================
app.put("/api/admin/canteens/:id", async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  const { error } = await supabase
    .from("canteens")
    .update({ is_active })
    .eq("id", id);

  if (error) return res.status(400).json(error);
  res.json({ message: "Canteen status updated" });
});
// ================= ADMIN: GET ALL CANTEENS =================
app.get("/api/admin/canteens", async (req, res) => {
  const { data, error } = await supabase
    .from("canteens")
    .select("*");

  if (error) return res.status(400).json(error);
  res.json(data);
});
// ================= ADMIN: GET MENU =================
app.get("/api/admin/menu/:canteenId", async (req, res) => {
  const { canteenId } = req.params;

  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .eq("canteen_id", canteenId);

  if (error) return res.status(400).json(error);
  res.json(data);
});
// ================= ADMIN: ADD MENU ITEM =================
app.post("/api/admin/menu", async (req, res) => {
  const { canteen_id, item_name, price } = req.body;

  const { error } = await supabase
    .from("menu_items")
    .insert([
      {
        canteen_id,
        item_name,
        price,
        available: true,
      },
    ]);

  if (error) return res.status(400).json(error);
  res.json({ message: "Menu item added" });
});
// ================= ADMIN: UPDATE MENU ITEM =================
app.put("/api/admin/menu/:id", async (req, res) => {
  const { id } = req.params;
  const { price, available } = req.body;

  const { error } = await supabase
    .from("menu_items")
    .update({ price, available })
    .eq("id", id);

  if (error) return res.status(400).json(error);
  res.json({ message: "Menu item updated" });
});
cron.schedule("0 0 * * *", async () => {
  console.log("⏰ Running daily sales report job");

  // ===== TESTING MODE (today) =====
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];

  const start = `${dateStr}T00:00:00.000Z`;
  const end = `${dateStr}T23:59:59.999Z`;

  console.log("📅 Checking orders for:", dateStr);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("canteen_id, total_amount, created_at")
    .eq("payment_status", "PAID")
    .gte("created_at", start)
    .lte("created_at", end);

  if (error) {
    console.error("❌ Supabase error:", error);
    return;
  }

  if (!orders || orders.length === 0) {
    console.log("⚠️ No orders found for", dateStr);
    return;
  }

  console.log("✅ Orders found:", orders.length);

  // ===== GROUP BY CANTEEN =====
  const report = {};
  orders.forEach((o) => {
    if (!report[o.canteen_id]) {
      report[o.canteen_id] = { total: 0, count: 0 };
    }
    report[o.canteen_id].total += o.total_amount;
    report[o.canteen_id].count += 1;
  });

  // ===== SEND MAIL TO STAFF =====
  for (const canteenId in report) {
    const { data: staff } = await supabase
      .from("users")
      .select("email, name")
      .eq("role", "staff")
      .eq("canteen_id", canteenId)
      .single();

    if (!staff) continue;

    await transporter.sendMail({
      to: staff.email,
      subject: "Daily Sales Report",
      html: `
        <h3>Daily Sales Report</h3>
        <p><b>Date:</b> ${dateStr}</p>
        <p><b>Total Orders:</b> ${report[canteenId].count}</p>
        <p><b>Total Sales:</b> ₹${report[canteenId].total}</p>
      `,
    });

    console.log(`📧 Report sent to ${staff.email}`);
  }

  console.log("🎉 Daily sales report completed");
});




// ================= START SERVER =================
const PORT = 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});



