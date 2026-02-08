
import { GoogleLogin } from "@react-oauth/google";
import "./App.css";
import { useState, useEffect } from "react";

function App() {
  // ================= STATES =================
  const [user, setUser] = useState(null);
  const [canteens, setCanteens] = useState([]);
  const [selectedCanteen, setSelectedCanteen] = useState(null);
  const [menu, setMenu] = useState([]);
  const [cart, setCart] = useState([]);
  const [showPayment, setShowPayment] = useState(false);
  const [currentOrderId, setCurrentOrderId] = useState(null);
  const [transactionId, setTransactionId] = useState("");
  const [staffOrders, setStaffOrders] = useState([]);
  
  // ================= LOGOUT =================
  const logoutUser = () => {
    setUser(null);
    setCanteens([]);
    setSelectedCanteen(null);
    setMenu([]);
    setCart([]);
    setStaffOrders([]);
    setShowPayment(false);
  };

  // ================= GOOGLE LOGIN =================
  const handleGoogleLogin = async (credentialResponse) => {
    const res = await fetch("http://localhost:3000/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: credentialResponse.credential }),
    });

    const data = await res.json();
    setUser(data.user);

    if (data.user.role === "user") {
      const c = await fetch("http://localhost:3000/api/canteens");
      setCanteens(await c.json());
    }
  };

  // ================= STAFF =================
  const loadStaffOrders = async () => {
    const res = await fetch(
      `http://localhost:3000/api/staff/orders/${user.canteen_id}`
    );
    setStaffOrders(await res.json());
  };

  const updateOrderStatus = async (id, status) => {
    await fetch(`http://localhost:3000/api/staff/orders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    loadStaffOrders();
  };

  useEffect(() => {
    if (user?.role === "staff") loadStaffOrders();
  }, [user]);

  // ================= USER =================
  const loadMenu = async (canteen) => {
    setSelectedCanteen(canteen);
    setCart([]);
    const res = await fetch(`http://localhost:3000/api/menu/${canteen.id}`);
    setMenu(await res.json());
  };

  const addToCart = (item) => {
    const existing = cart.find((i) => i.id === item.id);
    if (existing) {
      setCart(
        cart.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
    } else {
      setCart([...cart, { ...item, quantity: 1 }]);
    }
  };

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const placeOrder = async () => {
    const res = await fetch("http://localhost:3000/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        canteenId: selectedCanteen.id,
        cart,
        total: totalAmount,
      }),
    });

    const data = await res.json();
    setCurrentOrderId(data.orderId);
    setShowPayment(true);
  };

  // ================= LOGIN =================
  if (!user) {
    return (
      <div className="login-box">
        <h2>CAMPUS4BITES</h2>
        <h4>(Powered by NIT Delhi Students)</h4>
        <GoogleLogin onSuccess={handleGoogleLogin} />
      </div>
    );
  }
// ================= ADMIN DASHBOARD =================
if (user.role === "admin") {
  return <AdminDashboard user={user} logoutUser={logoutUser} />;
}

  // ================= STAFF DASHBOARD =================
  if (user.role === "staff") {
    return (
      <div className="container">
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2>Staff Dashboard</h2>
          <button style={{ background: "#e74c3c" }} onClick={logoutUser}>
            Logout
          </button>
        </div>

        {staffOrders.length === 0 ? (
          <p>No orders yet</p>
        ) : (
          staffOrders.map((o) => (
            <div key={o.id} className="canteen-card">
              <p><b>Order:</b> {o.id}</p>
              <p><b>User:</b> {o.users?.name}</p>
              <p><b>Total:</b> ₹{o.total_amount}</p>
              <p><b>Status:</b> {o.o_status}</p>

              {o.o_status === "PLACED" && (
                <button onClick={() => updateOrderStatus(o.id, "PREPARING")}>
                  Mark PREPARING
                </button>
              )}
              {o.o_status === "PREPARING" && (
                <button onClick={() => updateOrderStatus(o.id, "READY")}>
                  Mark READY
                </button>
              )}
            </div>
          ))
        )}
      </div>
    );
  }

  // ================= PAYMENT =================
  if (showPayment) {
    return (
      <div className="container">
        <h2>Complete Payment</h2>
        <p><b>UPI ID:</b> canteen@upi</p>

        <img
          src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=canteen@upi"
          alt="QR"
        />

        <input
          placeholder="Enter Transaction ID"
          value={transactionId}
          onChange={(e) => setTransactionId(e.target.value)}
        />

        <button
          onClick={async () => {
            await fetch("http://localhost:3000/api/orders/confirm-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: currentOrderId,
                transactionId,
              }),
            });
            alert("Payment successful");
            logoutUser();
          }}
        >
          Confirm Payment
        </button>
      </div>
    );
  }

  // ================= USER DASHBOARD =================
  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Welcome, {user.name}</h2>
        <button style={{ background: "#e74c3c" }} onClick={logoutUser}>
          Logout
        </button>
      </div>

      <h3>Select a Canteen</h3>
      <div className="canteen-grid">
        {canteens.map((c) => (
          <div key={c.id} className="canteen-card" onClick={() => loadMenu(c)}>
            {c.name}
          </div>
        ))}
      </div>

      {menu.map((item) => (
        <div key={item.id} className="menu-item">
          {item.item_name} – ₹{item.price}
          <button onClick={() => addToCart(item)}>Add</button>
        </div>
      ))}

      {cart.length > 0 && (
        <div className="cart-box">
          <h3>Cart</h3>
          {cart.map((i) => (
            <p key={i.id}>
              {i.item_name} × {i.quantity}
            </p>
          ))}
          <b>Total: ₹{totalAmount}</b>
          <button onClick={placeOrder}>Place Order</button>
        </div>
      )}
    </div>
  );
}
function AdminDashboard({ user, logoutUser }) {
  // ================= STATES =================
  const [canteens, setCanteens] = useState([]);
  const [selectedCanteen, setSelectedCanteen] = useState("");
  const [menu, setMenu] = useState([]);
  const [orders, setOrders] = useState([]);

  // ================= LOAD CANTEENS =================
  const loadCanteens = async () => {
    const res = await fetch("http://localhost:3000/api/admin/canteens");
    setCanteens(await res.json());
  };

  // ================= LOAD MENU =================
  const loadMenu = async (canteenId) => {
    const res = await fetch(
      `http://localhost:3000/api/admin/menu/${canteenId}`
    );
    setMenu(await res.json());
  };

  // ================= LOAD ORDERS =================
  const loadOrders = async () => {
    const res = await fetch("http://localhost:3000/api/admin/orders");
    setOrders(await res.json());
  };

  // ================= ON LOAD =================
  useEffect(() => {
    loadCanteens();
    loadOrders();
  }, []);

  return (
    <div className="container">
      {/* HEADER */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>Admin Dashboard</h2>
        <button style={{ background: "#e74c3c" }} onClick={logoutUser}>
          Logout
        </button>
      </div>

      <p>
        <b>Admin:</b> {user.email}
      </p>

      <hr />

      {/* ================= CANTEEN MANAGEMENT ================= */}
      <h3>Canteen Management</h3>

      {canteens.map((c) => (
        <div key={c.id} className="canteen-card">
          <b>{c.name}</b>
          <p>Status: {c.is_active ? "OPEN" : "CLOSED"}</p>

          <button
            onClick={async () => {
              await fetch(
                `http://localhost:3000/api/admin/canteens/${c.id}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ is_active: !c.is_active }),
                }
              );
              loadCanteens();
            }}
          >
            {c.is_active ? "Disable" : "Enable"}
          </button>
        </div>
      ))}

      <hr />

      {/* ================= MENU MANAGEMENT ================= */}
      <h3>Menu Management</h3>

      <select
        value={selectedCanteen}
        onChange={(e) => {
          setSelectedCanteen(e.target.value);
          loadMenu(e.target.value);
        }}
      >
        <option value="">Select Canteen</option>
        {canteens.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {menu.map((item) => (
        <div key={item.id} className="menu-item">
          {item.item_name} – ₹{item.price} (
          {item.available ? "Available" : "Disabled"})
          <br />

          <button
            onClick={async () => {
              await fetch(
                `http://localhost:3000/api/admin/menu/${item.id}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    price: item.price + 10,
                    available: item.available,
                  }),
                }
              );
              loadMenu(selectedCanteen);
            }}
          >
            Increase Price +10
          </button>

          <button
            onClick={async () => {
              await fetch(
                `http://localhost:3000/api/admin/menu/${item.id}`,
                {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    price: item.price,
                    available: !item.available,
                  }),
                }
              );
              loadMenu(selectedCanteen);
            }}
          >
            {item.available ? "Disable" : "Enable"}
          </button>
        </div>
      ))}

      <hr />

      {/* ================= VIEW ALL ORDERS ================= */}
      <h3>All Orders</h3>

      {orders.length === 0 ? (
        <p>No orders yet</p>
      ) : (
        orders.map((o) => (
          <div key={o.id} className="canteen-card">
            <p>
              <b>Order ID:</b> {o.id}
            </p>
            <p>
              <b>User:</b> {o.users.name}
            </p>
            <p>
              <b>Canteen:</b> {o.canteens.name}
            </p>
            <p>
              <b>Total:</b> ₹{o.total_amount}
            </p>
            <p>
              <b>Status:</b> {o.o_status}
            </p>
          </div>
        ))
      )}
    </div>
  );
}


export default App;


